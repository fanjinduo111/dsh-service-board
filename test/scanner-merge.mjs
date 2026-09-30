/**
 * The master/worker merge, on fabricated process tables.
 *
 * This rule runs inside `scanProcesses()`, which needs the real Windows probe, so it had
 * no test at all — and it silently deleted a real service: a same-name launcher and the
 * service it started were treated as a master and its worker, so the service left the
 * scan, its port was credited to the launcher, and `/log` answered `no-log` for a process
 * that was running the whole time (see README §8). The rule is a pure function now, and
 * these are the cases that must not be conflated again.
 *
 * Usage: node test/scanner-merge.mjs
 */
import assert from "node:assert/strict";
import { resolve } from "node:path";

const scannerPath = resolve(import.meta.dirname, "../src/host/scanner.js");
const { mergeWorkers } = await import(`file://${scannerPath.replace(/\\/g, "/")}`);

const problems = [];
/** @param {string} name @param {object} fields */
const service = (name, fields) => ({
  pid: 0,
  ppid: 0,
  name: "svc.exe",
  cmd: "",
  ports: [],
  logPath: null,
  ...fields,
});

// --- a real master/worker pair is still merged --------------------------------

// nginx: the master holds no socket of its own, the workers hold the listening ones, and
// killing a worker just makes the master fork another one — so one row for the pair, with
// the workers' ports on it, is the row a person can act on.
const nginxMaster = service("nginx", { pid: 100, ppid: 5, name: "nginx.exe", cmd: '"C:\\nginx\\nginx.exe"', ports: [] });
const nginxWorker = service("nginx", { pid: 101, ppid: 100, name: "nginx.exe", cmd: '"C:\\nginx\\nginx.exe"', ports: [80, 443] });
const merged = mergeWorkers([nginxMaster, nginxWorker]);
console.log(`nginx pair     : ${merged.length} row(s), ports=${JSON.stringify(merged[0]?.ports)}`);
if (merged.length !== 1) problems.push(`a same-program master/worker pair must merge to one row, got ${merged.length}`);
if (merged[0]?.pid !== 100) problems.push("the surviving row must be the master (the ancestor)");
if (JSON.stringify(merged[0]?.ports) !== "[80,443]") {
  problems.push(`the master must carry its workers' ports, got ${JSON.stringify(merged[0]?.ports)}`);
}

// A grandchild worker (nginx forks several) must not resurrect as its own row either.
const grandchild = service("nginx", { pid: 102, ppid: 101, name: "nginx.exe", cmd: '"C:\\nginx\\nginx.exe"', ports: [8080] });
const deep = mergeWorkers([nginxMaster, nginxWorker, grandchild]);
console.log(`nginx 3 levels : ${deep.length} row(s), ports=${JSON.stringify(deep[0]?.ports)}`);
if (deep.length !== 1) problems.push(`a three-level chain must merge to one row, got ${deep.length}`);
if (JSON.stringify(deep[0]?.ports) !== "[80,443,8080]") problems.push("a grandchild's ports must reach the master too");

// --- a launcher that merely shares the executable name is not a worker --------

// Measured: the host itself listens (the panel is an HTTP service), and `/start` spawned a
// `node.exe` service. Keyed on the name alone this pair merged, the service disappeared
// from the scan, and `/log` answered 404 no-log for a live process.
const host = service("host", { pid: 200, ppid: 1, name: "node.exe", cmd: '"C:\\Program Files\\nodejs\\node.exe" host.js', ports: [19387] });
const started = service("service", { pid: 201, ppid: 200, name: "node.exe", cmd: '"C:\\Program Files\\nodejs\\node.exe" svc.js 5455', ports: [5455], logPath: "C:\\tmp\\svc.log" });
const kept = mergeWorkers([host, started]);
console.log(`launcher pair  : ${kept.length} row(s), pids=${JSON.stringify(kept.map((e) => e.pid))}`);
if (kept.length !== 2) problems.push(`a launcher and the service it started must both be listed, got ${kept.length}`);
if (kept.find((e) => e.pid === 201) === undefined) {
  problems.push("the started service is missing: its row must not be merged into its launcher");
}
if (JSON.stringify(kept.find((e) => e.pid === 200)?.ports) !== "[19387]") {
  problems.push("the launcher must not be credited with the service's port");
}

// A shim that runs the same program differently (javapath → the real jdk) is the same
// shape: same executable name, different command line.
const shim = service("java", { pid: 300, ppid: 9, name: "java.exe", cmd: '"C:\\Program Files\\Common Files\\Oracle\\Java\\javapath\\java.exe" -jar app.jar', ports: [] });
const real = service("java", { pid: 301, ppid: 300, name: "java.exe", cmd: '"C:\\Program Files\\Java\\jdk-21\\bin\\java.exe" -jar app.jar', ports: [9527], logPath: "C:\\tmp\\java.log" });
const shimKept = mergeWorkers([shim, real]);
console.log(`shim pair      : ${shimKept.length} row(s)`);
if (shimKept.length !== 2) problems.push(`a shim and the real process must both be listed, got ${shimKept.length}`);

// --- a descendant the panel started itself is never a worker ------------------

// Same name and the same command line, but the child carries the log marker and the
// ancestor does not: the child is a service the panel started (`/start` sets DSH_PB_LOG),
// not a fork of the ancestor.
const plain = service("plain", { pid: 400, ppid: 1, name: "worker.exe", cmd: '"C:\\app\\worker.exe" --serve', ports: [7000] });
const marked = service("marked", { pid: 401, ppid: 400, name: "worker.exe", cmd: '"C:\\app\\worker.exe" --serve', ports: [7001], logPath: "C:\\tmp\\marked.log" });
const markedKept = mergeWorkers([plain, marked]);
console.log(`marker case    : ${markedKept.length} row(s)`);
if (markedKept.length !== 2) problems.push(`a marked descendant must keep its own row, got ${markedKept.length}`);

// --- chains that are not parent/child are untouched ---------------------------

const unrelated = mergeWorkers([
  service("a", { pid: 500, ppid: 1, name: "dup.exe", cmd: "dup.exe", ports: [8001] }),
  service("b", { pid: 501, ppid: 2, name: "dup.exe", cmd: "dup.exe", ports: [8002] }),
]);
console.log(`unrelated      : ${unrelated.length} row(s)`);
if (unrelated.length !== 2) problems.push(`two same-name processes with different parents must both be listed, got ${unrelated.length}`);

// A missing command line on both sides must not make them "the same program": an empty
// string is not evidence, and the probe cannot always read one (`mysqld.exe` on this
// machine reports none), so the pair stays two rows.
const noCmd = mergeWorkers([
  service("x", { pid: 600, ppid: 1, name: "blank.exe", cmd: "", ports: [8101] }),
  service("y", { pid: 601, ppid: 600, name: "blank.exe", cmd: "", ports: [8102] }),
]);
console.log(`no command line: ${noCmd.length} row(s)`);
if (noCmd.length !== 2) problems.push(`an unknown command line is not evidence of a worker, got ${noCmd.length}`);

if (problems.length > 0) {
  console.error("\nFAILED:");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log("\nscanner merge tests passed");
process.exit(0);
