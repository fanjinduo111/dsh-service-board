/**
 * Packaging invariants: the things that must agree for `dsh plugin add <package>` to work.
 *
 * The load-bearing one is the client module id. The host builds each client boot-graph row
 * from the *package name* and looks the registered module up under it; a client that
 * registers a different id is not found in the shared batch, so the loader falls back to
 * the package's own one-resource URL, executes the bundle a second time, and the entry dies
 * with `client-modules: duplicate factory registration for "<id>"` — the sidebar entry never
 * appears. That is exactly what happened on the first packaged run of this fork (package
 * renamed to dsh-service-board, client id left at dsh-process-board), and it is invisible in
 * `npm pack` output, so it needs a test rather than care.
 *
 * Also checked: the bundle patch points at a file that exists and names this package, the
 * published file list actually carries the plugin's code (npm does not follow the src
 * junction — see scripts/build-package.mjs), and the license keeps the upstream notice.
 *
 * Run: node test/package-identity.test.mjs
 */
import { readFile, access, lstat, readlink } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
let failures = 0;

const check = (label, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail === "" ? "" : ` — ${detail}`}`);
  if (!ok) failures += 1;
};

const read = (file) => readFile(join(root, file), "utf8");
const pkg = JSON.parse(await read("package.json"));
const client = await read("src/client/index.js");
const patch = await read("cordis.patch.yml");
const license = await read("LICENSE");

// 1. The invariant that decides whether the plugin activates at all.
const registered = client.match(/__ModuleLoader__\.load\(\{\s*\n\s*id: '([^']+)'/)?.[1];
check("client module id equals the package name", registered === pkg.name, `client=${registered} package=${pkg.name}`);

// 2. The bundle patch must name this package, or the roster row loads nothing.
const patched = patch.match(/name:\s*'([^']+)'/)?.[1];
check("cordis.patch.yml names this package", patched === pkg.name, `patch=${patched}`);
const patchPath = pkg.dsh?.bundle?.patch;
check("dsh.bundle.patch points at the shipped file", patchPath === "./cordis.patch.yml" && patchPath !== undefined, String(patchPath));
await access(join(root, "cordis.patch.yml")).then(
  () => check("cordis.patch.yml exists", true),
  () => check("cordis.patch.yml exists", false),
);

// 3. The row id must be this fork's own, so both plugins can be installed side by side.
const rowId = patch.match(/id:\s*([\w-]+)/)?.[1];
check("plugin row id is fork-specific", rowId !== undefined && rowId !== "ui-process-board", String(rowId));

// 4. What ends up in the tarball must include the code (npm skips the src junction).
const files = pkg.files ?? [];
check("published file list carries src", files.includes("src"), JSON.stringify(files));
check("published file list carries the bundle patch", files.includes("cordis.patch.yml"));
check("published file list carries the license", files.includes("LICENSE"));

// 4b. src/ must be this repository's own directory, never a junction onto an installed copy.
// It was one until 2026-10-08, which meant renaming the client id for the fork also renamed
// it inside a working install of the upstream-named package — and that install's DSH web UI
// stopped opening. A shared directory cannot be allowed to come back quietly.
const srcStats = await lstat(join(root, "src"));
check("src/ is a real directory, not a link to an installed plugin", srcStats.isDirectory() && !srcStats.isSymbolicLink(), srcStats.isSymbolicLink() ? `symlink -> ${await readlink(join(root, "src"))}` : "directory");

// 5. Manifest shape the harness reads.
check("dsh.client.platform is web", pkg.dsh?.client?.platform === "web", String(pkg.dsh?.client?.platform));
check("main resolves to the host half", pkg.main === "src/host/index.js", String(pkg.main));
check("engines.node is declared", typeof pkg.engines?.node === "string", String(pkg.engines?.node));
check("not private", pkg.private !== true);
check("has a repository url", typeof pkg.repository?.url === "string" && pkg.repository.url.includes("dsh-service-board"));

// 6. The fork must not pass itself off as the original, and MIT needs the original notice.
check("LICENSE keeps the upstream notice", /dsh-process-board/.test(license) && /mr-liangjx|cyanTao/.test(license));
check("README says this is a fork of the original", /dsh-process-board/.test(await read("README.md")) && /fork|分叉/.test(await read("README.md")));

// 7. Version bookkeeping: the changelog has to describe what is being published.
const changelog = await read("CHANGELOG.md");
check("CHANGELOG documents this version", changelog.includes(pkg.version), `version=${pkg.version}`);

console.log(`\n${failures === 0 ? "PASSED" : `FAILED: ${failures} check(s)`}`);
process.exit(failures === 0 ? 0 : 1);
