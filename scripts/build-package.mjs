/**
 * Build the publishable package into .package/.
 *
 * Why this exists: in this working tree `src/` is a *junction* to the desktop profile's
 * installed copy — that is how an edit here reaches the running application on Ctrl+R.
 * npm does not follow it: with `"files": ["src"]`, `npm pack --dry-run` produced a tarball
 * with 7 files and **no src at all**, i.e. a plugin with no code that installs cleanly and
 * then does nothing. So publishing packs a staging copy where every file is a real file.
 *
 * A `git clone` of this repository does not have that problem (git stores the sources as
 * ordinary blobs), so this script is only needed when publishing from this working tree —
 * which is the one that has the junction.
 *
 * Usage:
 *   node scripts/build-package.mjs              # build .package/
 *   node scripts/build-package.mjs --pack       # build, then npm pack inside .package/
 *   node scripts/build-package.mjs --publish    # build, then npm publish inside .package/
 */
import { cp, mkdir, readFile, readdir, rm, stat, lstat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const out = join(root, ".package");
const FILES = ["src", "cordis.patch.yml", "package.json", "README.md", "CHANGELOG.md", "LICENSE", "docs"];

const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
if (manifest.private === true) {
  console.error("package.json is marked private, so it cannot be published");
  process.exit(1);
}
const placeholder = String(manifest.repository?.url ?? "").includes("GITHUB_OWNER");
if (placeholder) {
  // Packing with the placeholder is legitimate — it is how this package gets verified on a
  // machine that has no GitHub identity yet — but publishing it never is.
  if (process.argv.includes("--publish")) {
    console.error("refusing to publish with the GITHUB_OWNER placeholder: run scripts/set-identity.mjs first");
    process.exit(1);
  }
  console.log("note           : GITHUB_OWNER placeholder present; packing is fine, publishing is not");
}

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

let copied = 0;
let bytes = 0;
for (const entry of FILES) {
  const from = join(root, entry);
  const to = join(out, entry);
  // dereference: true is the point of this script — the junction becomes real files.
  await cp(from, to, { recursive: true, dereference: true, errorOnExist: false });
}

/** Count what actually landed, and refuse to publish a tree that still holds a link. */
const walk = async (dir) => {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, item.name);
    const info = await lstat(path);
    if (info.isSymbolicLink()) {
      console.error(`staged file is still a link: ${path}`);
      process.exit(1);
    }
    if (item.isDirectory()) await walk(path);
    else { copied += 1; bytes += info.size; }
  }
};
await walk(out);

const srcFiles = await readdir(join(out, "src"), { recursive: true });
console.log(`staged         : ${copied} files, ${(bytes / 1024).toFixed(1)} kB -> ${out}`);
console.log(`src entries    : ${srcFiles.filter((name) => !name.endsWith("\\") && name.includes(".")).length}`);
for (const name of srcFiles.filter((entry) => entry.includes("."))) {
  const info = await stat(join(out, "src", name));
  console.log(`  src/${name.replace(/\\/g, "/")}  ${info.size}B`);
}
// The patched bytes must be there, not the published upstream ones: this is the marker
// browser-check.mjs also looks for in the served bundle.
const marker = "dshpb-cfgtoggle";
const client = await readFile(join(out, "src/client/index.js"), "utf8");
if (!client.includes(marker)) {
  console.error(`staged client does not contain ${marker}: this is not the patched source`);
  process.exit(1);
}
console.log(`patch marker   : ${marker} present in the staged client`);

if (process.argv.includes("--pack") || process.argv.includes("--publish")) {
  const args = process.argv.includes("--publish") ? ["publish"] : ["pack"];
  console.log(`\nnpm ${args[0]} (cwd=${out})`);
  const result = spawnSync("npm", args, { cwd: out, stdio: "inherit", shell: true });
  process.exit(result.status ?? 1);
}
