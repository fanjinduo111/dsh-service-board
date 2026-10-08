/**
 * Put your own identity into the package, in one place.
 *
 * The repository fields, the README badges and the install commands all contain the same
 * two facts — your GitHub owner and the npm package name — and a runbook that asks you to
 * edit them by hand is how a README ends up telling people to install a package that does
 * not exist (the plugin-market checklist calls that failure out by name: "README 有命令但
 * 包名与实际仓库不一致，开发者复制即失败"). So they are set here, together.
 *
 * Usage:
 *   node scripts/set-identity.mjs <github-owner> [package-name]
 *   node scripts/set-identity.mjs --check          # report what is still a placeholder
 *
 * Examples:
 *   node scripts/set-identity.mjs alice
 *   node scripts/set-identity.mjs alice my-service-board
 */
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const PLACEHOLDER = "GITHUB_OWNER";
const DEFAULT_NAME = "dsh-service-board";
/** Files that carry the owner or the package name. */
const TEXT_FILES = ["README.md", "PUBLISHING.md", "CHANGELOG.md", "cordis.patch.yml"];
const MANIFEST = "package.json";

const args = process.argv.slice(2).filter((value) => !value.startsWith("--"));
const check = process.argv.includes("--check");
const owner = args[0];
const name = args[1] ?? null;

const manifestPath = join(root, MANIFEST);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const currentName = manifest.name;

if (check) {
  const offenders = [];
  if (String(manifest.repository?.url ?? "").includes(PLACEHOLDER)) offenders.push(`${MANIFEST} repository.url`);
  for (const file of TEXT_FILES) {
    const text = await readFile(join(root, file), "utf8").catch(() => "");
    if (text.includes(PLACEHOLDER)) offenders.push(file);
  }
  if (offenders.length === 0) {
    console.log(`identity       : ok (${currentName}, no placeholders left)`);
    process.exit(0);
  }
  console.error("still contains GITHUB_OWNER:");
  for (const file of offenders) console.error(`  - ${file}`);
  process.exit(1);
}

if (owner === undefined) {
  console.error("usage: node scripts/set-identity.mjs <github-owner> [package-name]");
  console.error("       node scripts/set-identity.mjs --check");
  process.exit(2);
}
if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(owner)) {
  console.error(`"${owner}" does not look like a GitHub owner (letters, digits and dashes)`);
  process.exit(2);
}

const repo = `dsh-service-board`;
manifest.repository = { type: "git", url: `git+https://github.com/${owner}/${repo}.git` };
manifest.homepage = `https://github.com/${owner}/${repo}#readme`;
manifest.bugs = { url: `https://github.com/${owner}/${repo}/issues` };
if (name !== null) {
  if (!/^(@[a-z0-9-]+\/)?[a-z0-9][a-z0-9._-]{0,80}$/.test(name)) {
    console.error(`"${name}" is not a valid npm package name`);
    process.exit(2);
  }
  manifest.name = name;
}
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

const shortName = manifest.name.replace(/^@[^/]+\//, "");
// The client module id must equal the package name: the host derives the boot-graph row id
// from the package name and looks the module up under it. When the two disagree the loader
// falls back to the package's own one-resource URL, the script runs a second time, and the
// entry dies with "duplicate factory registration" — the sidebar entry never appears. So a
// rename has to carry this id along (test/package-identity.test.mjs enforces it).
const clientPath = join(root, "src/client/index.js");
{
  const client = await readFile(clientPath, "utf8");
  const current = client.match(/__ModuleLoader__\.load\(\{\s*\n\s*id: '([^']+)'/)?.[1];
  if (current === undefined) {
    console.error("could not find the client module id in src/client/index.js");
    process.exit(1);
  }
  if (current !== manifest.name) {
    const next = client.replace(
      /(__ModuleLoader__\.load\(\{\s*\n\s*id: ')[^']+(')/,
      `$1${manifest.name}$2`,
    );
    await writeFile(clientPath, next, "utf8");
    console.log(`updated        : src/client/index.js (client module id ${current} -> ${manifest.name})`);
  }
}

for (const file of TEXT_FILES) {
  const path = join(root, file);
  let text = await readFile(path, "utf8").catch(() => null);
  if (text === null) continue;
  const before = text;
  text = text.split(PLACEHOLDER).join(owner);
  if (name !== null && name !== currentName) text = text.split(currentName).join(manifest.name);
  // The plugin row id follows the package name, so two plugins cannot register the same row.
  if (file === "cordis.patch.yml") {
    text = text.replace(/id:\s*ui-[\w-]+/, `id: ui-${shortName.replace(/^dsh-/, "")}`);
  }
  if (text !== before) {
    await writeFile(path, text, "utf8");
    console.log(`updated        : ${file}`);
  }
}
console.log(`identity       : owner=${owner} package=${manifest.name}`);
console.log("next           : node scripts/build-package.mjs --pack   (see PUBLISHING.md)");
