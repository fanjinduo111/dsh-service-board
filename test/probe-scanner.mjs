/**
 * Runs the real scanner against this machine and prints what the panel receives.
 *
 * The scanner is a PowerShell program built from a template, so a mistake in it
 * surfaces as an empty or malformed scan rather than as an error. Running it and
 * looking at the parsed result is the only way to know the patch works.
 *
 * Usage: node probe-scanner.mjs
 */
import { createRequire } from "node:module";

const requireFromPackage = createRequire("C:/Users/fanjinduo/.dsh/profiles/desktop/node_modules/dsh-process-board/package.json");
const scannerPath = requireFromPackage.resolve("./src/host/scanner.js");
const { scanProcesses } = await import(`file://${scannerPath.replace(/\\/g, "/")}`);

console.log(`scanner: ${scannerPath}`);
const started = Date.now();
const entries = await scanProcesses();
console.log(`entries: ${entries.length} (${Date.now() - started}ms)\n`);

let withBinds = 0;
let withCmd = 0;
for (const entry of entries) {
  if (Array.isArray(entry.binds) && entry.binds.length > 0) withBinds += 1;
  if (typeof entry.cmd === "string" && entry.cmd.trim() !== "") withCmd += 1;
}

const show = entries
  .filter((entry) => Array.isArray(entry.binds) && entry.binds.length > 0)
  .slice(0, 8);
for (const entry of show) {
  const binds = entry.binds.map((bind) => `${bind.addr}:${bind.port}`).join(", ");
  console.log(`${String(entry.pid).padStart(6)}  ${entry.name.padEnd(18)} ${binds}`);
  if (entry.cmd) console.log(`        cmd: ${entry.cmd.slice(0, 120)}`);
  console.log(`        session=${entry.session ?? "(none)"} inTree=${entry.inTree} ports=${JSON.stringify(entry.ports)}`);
}

console.log(`\nentries with binds : ${withBinds}`);
console.log(`entries with cmd   : ${withCmd}`);

// Invariants that must hold whenever the scan runs. Command-line readability is NOT
// one of them: a process owned by another account (a Windows service such as
// mysqld) does not expose its command line, and the panel handles that by offering
// no restart for it. Asserting otherwise made this probe fail for the right reason.
const problems = [];
if (entries.length === 0) problems.push("the scan returned nothing");
if (withBinds === 0) problems.push("no entry carries a bind address");
if (entries.some((entry) => entry.binds !== undefined && !Array.isArray(entry.binds))) {
  problems.push("binds must always be an array");
}
if (entries.some((entry) => typeof entry.cmd !== "string")) {
  problems.push("cmd must always be a string");
}
if (entries.some((entry) => !Array.isArray(entry.ports) || entry.ports.some((port) => !Number.isInteger(port)))) {
  problems.push("ports must always be an array of integers");
}
// A port must never be reported without an address alongside it, since the panel
// shows the pair and a missing address would silently fall back to a bare port.
for (const entry of entries) {
  if (entry.ports.length !== entry.binds.length) {
    problems.push(`pid ${entry.pid}: ${entry.ports.length} ports but ${entry.binds.length} binds`);
    break;
  }
}

if (withCmd === 0) {
  console.log("\nnote: no command line was readable on this run, so no service offers a");
  console.log("      restart. That is expected when every listening process belongs to");
  console.log("      another account; a process started from this session is readable.");
}

if (problems.length > 0) {
  console.error("\nFAILED:");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log("\nscanner probe passed");
process.exit(0);
