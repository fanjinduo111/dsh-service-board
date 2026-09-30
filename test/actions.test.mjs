/**
 * Real end-to-end test of the operation endpoints, against real processes.
 *
 * Written after shipping a panel whose "停止" button did nothing: every earlier
 * test either mocked `fetch` or asserted against a stub context, so the code path a
 * click actually takes — POST /kill, real process termination, POST /start, real
 * spawn — had never been executed. This runs the host half's own handlers over a
 * real server and drives real child processes through them.
 *
 * Usage: node test/actions.test.mjs
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createConnection } from "node:net";

const hostFile = resolve(import.meta.dirname, "../src/host/index.js");
const { apply } = await import(`file://${hostFile.replace(/\\/g, "/")}`);

const work = await mkdtemp(join(tmpdir(), "actions-"));
const problems = [];

/** A server script that binds a given port and says so on stdout. */
async function writeServer(name, port) {
  const file = join(work, `${name}.js`);
  await writeFile(
    file,
    `const http=require("http");const s=http.createServer((q,r)=>r.end("ok"));`
    + `s.listen(${port},"127.0.0.1",()=>console.log("READY ${port}"));setInterval(()=>{},1000);`,
    "utf8",
  );
  return file;
}

/** Does anything answer on this port right now? */
function portOpen(port) {
  return new Promise((resolveOpen) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const settle = (value) => { socket.destroy(); resolveOpen(value); };
    socket.setTimeout(1200);
    socket.once("connect", () => settle(true));
    socket.once("error", () => settle(false));
    socket.once("timeout", () => settle(false));
  });
}

/** Mount the host half on a real server and return its port. */
const routes = { exact: new Map() };
const scans = [];
const ctx = {
  logger: { info() {}, warn() {}, error() {}, debug() {} },
  sessions: { get: () => undefined, list: () => [] },
  sessionTitle: { get: () => undefined },
  webServer: {
    register(route) {
      routes.exact.set(route.path, route);
      return () => {};
    },
  },
  effect(execute) {
    scans.push(execute);
    return () => {};
  },
};
apply(ctx);

const server = createServer((req, res) => {
  const path = (req.url ?? "").split("?")[0];
  const route = routes.exact.get(path);
  if (route !== undefined) { void route.handler(req, res); return; }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: false, error: "no-route" }));
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const port = server.address().port;
console.log(`host server    : 127.0.0.1:${port}`);
console.log(`routes         : ${[...routes.exact.keys()].join(", ")}`);

/** One same-origin JSON request, as the panel makes it. */
async function post(path, body) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify(body ?? {}),
  });
  const text = await response.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { /* leave null */ }
  return { status: response.status, body: parsed, raw: text };
}

/** One same-origin GET, as the panel makes it. */
async function get(path) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    headers: { "sec-fetch-site": "same-origin" },
  });
  const text = await response.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { /* leave null */ }
  return { status: response.status, body: parsed, raw: text };
}

try {
  // --- /kill on a real process ------------------------------------------------

  const killPort = 5411;
  const killScript = await writeServer("killme", killPort);
  const victim = spawn(process.execPath, [killScript], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  await once(victim, "spawn");
  await new Promise((r) => setTimeout(r, 1200));
  const aliveBefore = await portOpen(killPort);
  console.log(`\nvictim pid     : ${victim.pid}, port ${killPort} open: ${aliveBefore}`);
  if (!aliveBefore) problems.push("the victim never bound its port, so /kill cannot be judged");

  const killResult = await post("/api/plugins/process-board/kill", { pid: victim.pid });
  console.log(`POST /kill     : ${killResult.status} ${JSON.stringify(killResult.body)}`);
  if (killResult.status !== 200) problems.push(`/kill returned ${killResult.status}: ${killResult.raw}`);
  if (killResult.body?.ok !== true) problems.push(`/kill did not report ok: ${killResult.raw}`);

  // The process must actually die and release the port. This is the assertion whose
  // absence let a dead "停止" button ship.
  let released = false;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((r) => setTimeout(r, 200));
    if (!(await portOpen(killPort))) { released = true; break; }
  }
  console.log(`port released  : ${released}`);
  if (!released) problems.push(`port ${killPort} is still open after /kill, so stopping is not effective`);

  let exited = victim.exitCode !== null || victim.signalCode !== null;
  if (!exited) { await Promise.race([once(victim, "exit"), new Promise((r) => setTimeout(r, 1500))]); exited = victim.exitCode !== null || victim.signalCode !== null; }
  console.log(`victim exited  : ${exited} (code ${victim.exitCode}, signal ${victim.signalCode})`);
  if (!exited) problems.push("the killed process is still running");

  // A second kill must be answered, not crash.
  const killAgain = await post("/api/plugins/process-board/kill", { pid: victim.pid });
  console.log(`POST /kill x2  : ${killAgain.status} ${JSON.stringify(killAgain.body)}`);
  if (killAgain.status >= 500) problems.push("killing an already-dead pid must not be a server error");

  // --- /start from an explicit argv ------------------------------------------

  const startPort = 5422;
  const startScript = await writeServer("startme", startPort);
  const logFile = join(work, "started.log");
  const startResult = await post("/api/plugins/process-board/start", {
    name: "startme",
    argv: [process.execPath, startScript],
    cwd: work,
    logFile,
    port: startPort,
  });
  console.log(`\nPOST /start    : ${startResult.status} ${JSON.stringify(startResult.body)}`);
  if (startResult.status !== 200) problems.push(`/start returned ${startResult.status}: ${startResult.raw}`);
  const startedPid = startResult.body?.pid;
  if (!Number.isInteger(startedPid)) problems.push(`/start did not report a pid: ${startResult.raw}`);

  let started = false;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((r) => setTimeout(r, 250));
    if (await portOpen(startPort)) { started = true; break; }
  }
  console.log(`port open      : ${started}`);
  if (!started) {
    const log = await readFile(logFile, "utf8").catch(() => "(no log)");
    problems.push(`the started process never bound ${startPort}; log: ${JSON.stringify(log)}`);
  }
  const logText = await readFile(logFile, "utf8").catch(() => "");
  console.log(`stdout captured: ${JSON.stringify(logText.trim().slice(0, 80))}`);
  if (!logText.includes("READY")) problems.push("the started process's output was not captured to the log file");

  // --- /log answers for the pid /start has just reported ------------------------
  //
  // The panel's next click on that row is almost always 日志, and /log resolves the pid
  // against the last completed scan. Answering /start before any scan had seen the child
  // is what made a service that was running the whole time report
  // 「日志不可用：no-log」 right after a restart (reported as 我重启之后显示不可用).
  const logResult = await post("/api/plugins/process-board/log", { pid: startedPid, lines: 50 });
  console.log(`POST /log      : ${logResult.status} ${JSON.stringify(logResult.body).slice(0, 140)}`);
  if (logResult.status !== 200 || logResult.body?.ok !== true) {
    problems.push(`/log refused the pid /start had just returned (${logResult.status} ${logResult.raw.slice(0, 120)}) — the panel shows this as 日志不可用`);
  } else if (!Array.isArray(logResult.body.lines) || !logResult.body.lines.some((line) => line.includes("READY"))) {
    problems.push(`/log answered without the child's own output: ${JSON.stringify(logResult.body.lines).slice(0, 140)}`);
  }

  // The service must also be listed under its own pid. The scanner merges a same-name
  // child into its ancestor (the nginx master/worker rule), and while that rule keyed on
  // the name alone, a service started with the same executable as its launcher was merged
  // away: the child left the scan, its port was credited to the launcher, and /log said
  // no-log for a process that was running. This process's launcher is `node.exe` too, so
  // the assertion is about exactly that case.
  const stateAfterStart = await get("/api/plugins/process-board/state");
  const listed = (stateAfterStart.body?.entries ?? []).some((e) => e.pid === startedPid);
  console.log(`listed in /state: ${listed} (of ${stateAfterStart.body?.entries?.length ?? 0} entries)`);
  if (!listed) {
    problems.push(`pid ${startedPid} was started but is not in /state: a same-name launcher chain must not merge a service away`);
  }

  // --- /start with no argv must explain itself --------------------------------

  const noArgv = await post("/api/plugins/process-board/start", { name: "nothing-registered" });
  console.log(`\nPOST /start (no argv): ${noArgv.status} ${JSON.stringify(noArgv.body)}`);
  if (noArgv.status !== 400) problems.push(`a start with no argv should be a 400, got ${noArgv.status}`);
  if (!/argv/i.test(noArgv.body?.error ?? "")) problems.push("the no-argv refusal should name argv");

  // Clean up whatever is still running.
  if (Number.isInteger(startedPid)) {
    await post("/api/plugins/process-board/kill", { pid: startedPid });
  }
} finally {
  await new Promise((done) => server.close(done));
}

await rm(work, { recursive: true, force: true });

if (problems.length > 0) {
  console.error("\nFAILED:");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log("\naction tests passed");
process.exit(0);
