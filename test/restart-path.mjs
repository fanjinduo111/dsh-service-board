/**
 * End-to-end check of the restart data path.
 *
 * The panel's restart is three steps: the scanner reads a process's command line,
 * the splitter turns it into argv, and the host's `/start` spawns that argv with the
 * controlled `stdio: ['ignore', out, out]` pattern. Each piece is unit-tested, but
 * only running the whole path proves the data is actually reusable — and a restart
 * that silently fails to bind is the failure a user would notice last.
 *
 * Usage: node test/restart-path.mjs
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
import { rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const packageDir = "C:/Users/fanjinduo/.dsh/profiles/desktop/node_modules/dsh-process-board";
const requireFromPackage = createRequire(`${packageDir}/package.json`);
const scannerPath = requireFromPackage.resolve("./src/host/scanner.js");
const { scanProcesses } = await import(`file://${scannerPath.replace(/\\/g, "/")}`);

/** The splitter, taken from the installed client so the test tracks the real code. */
const clientSource = await (await import("node:fs/promises")).readFile(join(packageDir, "src/client/index.js"), "utf8");
const start = clientSource.indexOf("function splitCommandLine");
const open = clientSource.indexOf("{", start);
let depth = 0;
let end = -1;
for (let index = open; index < clientSource.length; index += 1) {
  if (clientSource[index] === "{") depth += 1;
  else if (clientSource[index] === "}") { depth -= 1; if (depth === 0) { end = index + 1; break; } }
}
const splitCommandLine = new Function(`${clientSource.slice(start, end)}; return splitCommandLine;`)();

// A server script the scanner can see and that prints its own banner, so the port
// is observable from the log rather than from a second scan.
const work = await mkdtemp(join(tmpdir(), "restart-path-"));
const script = join(work, "svc.js");
await (await import("node:fs/promises")).writeFile(
  script,
  'const http=require("http");const s=http.createServer((q,r)=>r.end("ok"));s.listen(5499,"127.0.0.1",()=>console.log("READY 127.0.0.1:5499"));setInterval(()=>{},1000);',
  "utf8",
);

const problems = [];
const original = spawn(process.execPath, [script], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
let originalOut = "";
original.stdout.on("data", (chunk) => { originalOut += chunk.toString(); });
await once(original, "spawn");
await new Promise((resolve) => setTimeout(resolve, 1500));
console.log(`original       : pid ${original.pid} (${originalOut.trim() || "no banner"})`);
if (!originalOut.includes("5499")) problems.push("the probe server never reported its port");

// 1. The scanner must see it, with a command line.
const scan = await scanProcesses();
const seen = scan.find((entry) => entry.pid === original.pid);
if (seen === undefined) {
  problems.push("the scanner did not report the probe process");
} else {
  console.log(`scanner sees   : ${seen.name} binds=${JSON.stringify(seen.binds)}`);
  console.log(`scanner cmd    : ${seen.cmd}`);
  if (!Array.isArray(seen.binds) || seen.binds.length === 0) problems.push("the scan reported no bind for the probe");
  if (typeof seen.cmd !== "string" || seen.cmd === "") problems.push("the scan reported no command line for the probe");
}

// 2. The splitter must turn that command line back into the argv that started it.
let argv = [];
if (seen !== undefined && seen.cmd !== "") {
  argv = splitCommandLine(seen.cmd);
  console.log(`split argv     : ${JSON.stringify(argv)}`);
  if (argv.length < 2) problems.push("the command line did not split into an executable and a script");
  if (argv[0] !== process.execPath) problems.push(`argv[0] should be the node executable, got ${argv[0]}`);
}

// 3. Stopping the original and starting from argv must reproduce a listening server.
original.kill();
await once(original, "close");
console.log("original       : stopped");

const logFile = join(work, "restart.log");
let restarted = null;
let restartedOut = "";
if (argv.length >= 2) {
  const out = (await import("node:fs")).openSync(logFile, "a");
  try {
    restarted = spawn(argv[0], argv.slice(1), { cwd: work, detached: true, stdio: ["ignore", out, out], windowsHide: true });
  } finally {
    (await import("node:fs")).closeSync(out);
  }
  restarted.unref();
  await new Promise((resolve) => setTimeout(resolve, 1500));
  restartedOut = await (await import("node:fs/promises")).readFile(logFile, "utf8").catch(() => "");
  console.log(`restarted      : pid ${restarted.pid} (${restartedOut.trim().split("\n").at(-1) ?? "no output"})`);
  if (!restartedOut.includes("5499")) {
    problems.push(`the restarted process did not report its port; log was ${JSON.stringify(restartedOut)}`);
  }
  // The restarted process must appear in a fresh scan on the same port, which is
  // what the panel's refresh shows the user.
  const rescan = await scanProcesses();
  const found = rescan.find((entry) => entry.pid === restarted.pid);
  if (found === undefined) problems.push("a fresh scan did not report the restarted process");
  else console.log(`rescan sees    : pid ${found.pid} binds=${JSON.stringify(found.binds)}`);
} else {
  problems.push("no argv was derived, so the restart path could not run");
}

try { if (restarted !== null && restarted.pid !== undefined) process.kill(restarted.pid); } catch { /* already gone */ }
// Wait for the restarted process to release the directory before removing it:
// removing first raised EBUSY and turned a passing run into a crash.
await new Promise((r) => setTimeout(r, 600));
await rm(work, { recursive: true, force: true }).catch(() => {});

if (problems.length > 0) {
  console.error("\nFAILED:");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log("\nrestart path tests passed");
process.exit(0);
