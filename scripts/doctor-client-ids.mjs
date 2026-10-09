/**
 * Doctor for the invariant that made the DSH web UI fail to open on 2026-10-08.
 *
 * A plugin's client bundle registers itself with `window.__ModuleLoader__.load({ id })`, and
 * the host derives each client boot-graph row id from the *package name*. When the two
 * disagree the loader cannot find the row it was handed, falls back to the package's own
 * one-resource URL, the bundle executes twice, and the shell reports
 * `client-modules: duplicate factory registration` plus `web boot: 1 entry did not activate`
 * — a web UI that never renders.
 *
 * That is exactly how it was reached here: this repository's `src/` used to be a directory
 * junction onto `<profile>/node_modules/dsh-process-board/src`, so renaming the client id for
 * the fork silently renamed it inside a *working* install of the upstream-named package.
 *
 * Checks every profile under ~/.dsh/profiles, every installed package, every .js file in it.
 * Exits 1 on any mismatch, so it can be wired into a release check.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PROFILES = process.env.DSH_PROFILES ?? join(homedir(), ".dsh", "profiles");
const LOAD = /__ModuleLoader__\s*\.\s*load\(\s*\{\s*id:\s*'([^']+)'/;
const SKIP = new Set(["node_modules", ".git", "dist", "build"]);

/** Every .js file of one package, minus nested dependency trees. Follows symlinks, because
 * pnpm installs plugins as links into its content-addressed store. */
const jsFiles = (dir, depth = 0) => {
  if (depth > 4) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    let stats;
    try {
      stats = statSync(full);
    } catch {
      continue;
    }
    if (stats.isDirectory()) out.push(...jsFiles(full, depth + 1));
    else if (entry.name.endsWith(".js") && stats.size < 4_000_000) out.push(full);
  }
  return out;
};

/** Every installed package in a profile, scopes included, symlinks followed. */
const packages = (profileDir) => {
  const root = join(profileDir, "node_modules");
  const out = [];
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  const usable = (entry) => (entry.isDirectory() || entry.isSymbolicLink()) && entry.name !== ".bin";
  for (const entry of entries) {
    if (!usable(entry)) continue;
    const full = join(root, entry.name);
    if (entry.name.startsWith("@")) {
      let scopedEntries = [];
      try {
        scopedEntries = readdirSync(full, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const scoped of scopedEntries) {
        if ((scoped.isDirectory() || scoped.isSymbolicLink()) && scoped.name !== ".bin") out.push(join(full, scoped.name));
      }
    } else {
      out.push(full);
    }
  }
  return out;
};

let profiles = [];
try {
  profiles = readdirSync(PROFILES, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => join(PROFILES, e.name));
} catch {
  console.error(`no profiles directory at ${PROFILES}`);
  process.exit(2);
}

let checked = 0;
let skipped = 0;
const problems = [];
for (const profile of profiles) {
  const short = profile.split(/[\\/]/).pop();

  // Second invariant, learned the hard way on 2026-10-08: a profile's tree is composed from
  // "each bundle listed in package.json's dsh.profile.bundles, then cordis.patch.yml". A
  // package that ships a bundle patch only reaches the roster while its name is in that list.
  // Dropping the name removes every row the bundle inserts, silently: no error, no console
  // message, just one entry fewer in the web UI. Only direct dependencies are compared,
  // because transitive bundles belong to whoever depends on them.
  let bundles = [];
  let deps = [];
  try {
    const profileManifest = JSON.parse(readFileSync(join(profile, "package.json"), "utf8"));
    bundles = profileManifest.dsh?.profile?.bundles ?? [];
    deps = Object.keys(profileManifest.dependencies ?? {});
  } catch {
    // A profile with no readable manifest has nothing to compare against.
  }

  for (const pkgDir of packages(profile)) {
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
    } catch {
      continue;
    }
    if (manifest.dsh?.bundle?.patch !== undefined && deps.includes(manifest.name) && !bundles.includes(manifest.name)) {
      problems.push(`${short}/${manifest.name}: ships a bundle patch (${manifest.dsh.bundle.patch}) and is a direct dependency, but is missing from dsh.profile.bundles — none of its rows are inserted, so its panel entry never appears`);
      console.log(`FAIL  ${short}/${manifest.name}@${manifest.version}  bundle patch ${manifest.dsh.bundle.patch} is NOT in dsh.profile.bundles`);
    }
    let registered = null;
    let where = null;
    for (const file of jsFiles(pkgDir)) {
      const found = LOAD.exec(readFileSync(file, "utf8"));
      if (found !== null) {
        registered = found[1];
        where = file.slice(pkgDir.length + 1);
        break;
      }
    }
    if (registered === null) {
      skipped += 1;
      continue;
    }
    checked += 1;
    const ok = registered === manifest.name;
    console.log(`${ok ? "ok  " : "FAIL"}  ${short}/${manifest.name}@${manifest.version}  client id=${registered}${where === null ? "" : ` (${where})`}`);
    if (!ok) problems.push(`${short}/${manifest.name}: client id "${registered}" != package name "${manifest.name}" — this package will fail to activate its web entry`);
  }
}
console.log(`\n${checked} package(s) with a client bundle checked, ${skipped} without one skipped`);
if (problems.length > 0) {
  console.error("\nPROBLEMS:");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log("every client module id matches its package name, and every bundle patch is listed");
