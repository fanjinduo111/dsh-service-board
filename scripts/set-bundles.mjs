/**
 * Adds or removes names in a DSH profile's `dsh.profile.bundles`, with a timestamped backup.
 *
 * Why this is a script and not a hand edit: a profile's plugin tree is composed from "each
 * bundle in package.json's dsh.profile.bundles, then cordis.patch.yml". A package that ships a
 * bundle patch (this plugin does) is therefore invisible — no row, no entry, no error — until
 * its name is listed there. `dsh plugin --profile <p> add <package>` maintains the list for you;
 * this is for repairing a profile that lost an entry some other way.
 *
 * Usage:
 *   node scripts/set-bundles.mjs <profile/package.json> add    dsh-service-board[,other]
 *   node scripts/set-bundles.mjs <profile/package.json> remove dsh-service-board
 *   node scripts/set-bundles.mjs <profile/package.json> check  dsh-service-board
 */
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";

const [manifest, mode, names] = process.argv.slice(2);
const modes = ["add", "remove", "check"];
if (!manifest || !modes.includes(mode)) {
  console.error("usage: node scripts/set-bundles.mjs <profile/package.json> <add|remove|check> <comma,separated,names>");
  process.exit(2);
}
const wanted = (names ?? "").split(",").map((name) => name.trim()).filter(Boolean);
if (wanted.length === 0) {
  console.error("no bundle names given");
  process.exit(2);
}

const data = JSON.parse(readFileSync(manifest, "utf8"));
const profile = (data.dsh ??= {}).profile ??= {};
const current = profile.bundles ?? [];
const missing = wanted.filter((name) => !current.includes(name));

if (mode === "check") {
  for (const name of wanted) {
    console.log(`${current.includes(name) ? "ok  " : "FAIL"}  ${name} ${current.includes(name) ? "is" : "is NOT"} in dsh.profile.bundles`);
  }
  process.exit(missing.length === 0 ? 0 : 1);
}

if (mode === "add" && missing.length === 0) {
  console.log(`already listed: [${current.join(", ")}]`);
  process.exit(0);
}

const next = mode === "add" ? [...current, ...missing] : current.filter((name) => !wanted.includes(name));
const backup = `${manifest}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
copyFileSync(manifest, backup);
profile.bundles = next;
writeFileSync(manifest, `${JSON.stringify(data, null, 2)}\n`, "utf8");
console.log(`bundles ${mode}: [${current.join(", ")}] -> [${next.join(", ")}]`);
console.log(`backup: ${backup}`);
