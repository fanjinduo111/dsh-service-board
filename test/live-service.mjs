/**
 * Drives the panel's four operations against one live service.
 *
 * The other action tests start their own throwaway servers. This one takes an
 * already-running service — the demo service on port 37542 — and exercises every
 * endpoint the panel calls, in the order a user would: look, read the log, stop,
 * start again, and stop once more. It asserts on the real process and on the real
 * HTTP responses, so a green run means the panel's buttons do what they say against
 * something the user can also see on screen.
 *
 * Usage: node test/live-service.mjs <pid>
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createConnection } from "node:net";

const pid = Number(process.argv[2]);
if (!Number.isInteger(pid) || pid <= 4) {
  console.error("usage: node test/live-service.mjs <pid of the running demo service>");
  process.exit(2);
}

const MAIN_PORT = 37542;
const SECOND_PORT = 37543;
const hostFile = resolve(import.meta.dirname, "../src/host/index.js");
const { apply } = await import(`file://${hostFile.replace(/\\/g, "/")}?live=${Date.now()}`);

const routes = { exact: new Map() };
const ctx = {
  logger: { info() {}, warn() {}, error() {}, debug() {} },
  sessions: { get: () => undefined, list: () => [] },
  sessionTitle: { get: () => undefined },
  webServer: { register(route) { routes.exact.set(route.path, route); return () => {}; } },
  effect(execute) { return execute() ?? (() => {}); },
};
apply(ctx);

const server = createServer((req, res) => {
  const route = routes.exact.get((req.url ?? "").split("?")[0]);
  if (route !== undefined) { void route.handler(req, res); return; }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: false, error: "no-route" }));
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const base = `http://127.0.0.1:${server.address().port}`;
const headers = { "content-type": "application/json", "sec-fetch-site": "same-origin" };
const problems = [];

/** One panel request. */
async function call(path, method = "GET", body) {
  const response = await fetch(`${base}${path}`, {
    method, headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: (() => { try { return JSON.parse(text); } catch { return null; } })(), raw: text };
}

/** Can the service be reached on this port right now? */
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

/** The service's own JSON, which proves it is serving rather than merely listening. */
async function serviceSays() {
  try {
    const response = await fetch(`http://127.0.0.1:${MAIN_PORT}/`);
    return await response.json();
  } catch {
    return null;
  }
}

/** Wait for a condition, then report whether it held. */
async function until(predicate, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

console.log(`panel server   : ${base}`);
console.log(`target pid     : ${pid}\n`);

try {
  // --- 1. state: does the panel see it, with both ports and its address? --------
  //
  // The first scan is asynchronous: the state route kicks one off and answers with
  // whatever the last scan produced, which on a cold start is nothing. Polling here is
  // the difference between testing the panel and testing when the test happened to ask
  // — an earlier version asserted immediately, read zero entries, and reported the
  // panel blind while the very next request listed the row.
  let entry = null;
  const listed = await until(async () => {
    const response = await call("/api/plugins/process-board/state");
    entry = (response.body?.entries ?? []).find((item) => item.pid === pid) ?? null;
    return entry !== null;
  }, 30000);
  const state = await call("/api/plugins/process-board/state");
  console.log(`1. state       : ${state.status}, ${(state.body?.entries ?? []).length} entries (listed after ${listed ? "polling" : "timeout"})`);
  if (entry === null) {
    problems.push("the panel does not list the service");
  } else {
    const binds = entry.binds.map((bind) => `${bind.addr}:${bind.port}`).join(", ");
    console.log(`   row         : ${entry.name} ${entry.state} http=${entry.http} binds=[${binds}]`);
    console.log(`   logPath     : ${entry.logPath ?? "(none)"}`);
    if (entry.state !== "running") problems.push(`the panel reports state ${entry.state}, expected running`);
    if (entry.http !== 200) problems.push(`the HTTP probe returned ${entry.http}, expected 200`);
    const ports = entry.binds.map((bind) => bind.port).sort((a, b) => a - b);
    if (JSON.stringify(ports) !== JSON.stringify([MAIN_PORT, SECOND_PORT])) {
      problems.push(`the row should show both ports, got ${JSON.stringify(ports)}`);
    }
    if (entry.binds.some((bind) => !bind.addr)) problems.push("a bind is shown without its address");
  }

  // --- 2. the service actually answers ----------------------------------------
  const before = await serviceSays();
  console.log(`2. service     : ${JSON.stringify(before)}`);
  if (before === null || before.ok !== true) problems.push("the service did not answer on its own port");
  else if (before.port !== MAIN_PORT) problems.push(`the service reported port ${before.port}, expected ${MAIN_PORT}`);

  // The log grows on demand, so the log view can be checked against a real change.
  await fetch(`http://127.0.0.1:${MAIN_PORT}/noise`).catch(() => {});
  await new Promise((r) => setTimeout(r, 700));

  // --- 3. log: the panel must return the tail of the real file -----------------
  const log = await call("/api/plugins/process-board/log", "POST", { pid, lines: 200 });
  const lines = log.body?.lines ?? [];
  console.log(`3. log         : ${log.status}, ${lines.length} lines, last: ${JSON.stringify((lines.at(-1) ?? "").slice(0, 60))}`);
  if (log.status !== 200 || log.body?.ok !== true) problems.push(`reading the log failed: ${log.raw}`);
  if (lines.length === 0) problems.push("the log came back empty");
  if (!lines.some((line) => /noise line 40/.test(line))) {
    problems.push("the log tail does not contain the lines the service just wrote");
  }

  // --- 4. stop: the process must die and release its ports ---------------------
  const stopped = await call("/api/plugins/process-board/kill", "POST", { pid });
  console.log(`4. stop        : ${stopped.status} ${JSON.stringify(stopped.body)}`);
  if (stopped.body?.ok !== true) problems.push(`stopping failed: ${stopped.raw}`);
  const releasedMain = await until(async () => !(await portOpen(MAIN_PORT)));
  const releasedSecond = await until(async () => !(await portOpen(SECOND_PORT)));
  console.log(`   ports freed : main=${releasedMain} second=${releasedSecond}`);
  if (!releasedMain || !releasedSecond) problems.push("stopping did not release both ports");
  const listedAfter = await call("/api/plugins/process-board/state");
  const afterStop = (listedAfter.body?.entries ?? []).find((item) => item.pid === pid);
  console.log(`   panel says  : ${afterStop === undefined ? "(row gone)" : afterStop.state}`);
  if (afterStop !== undefined && afterStop.state === "running") {
    problems.push("the panel still reports the stopped service as running");
  }

  // --- 5. start: the panel must bring it back from the command line it read -----
  const argv = ["C:\\Program Files\\nodejs\\node.exe", "D:\\work\\demo-service.js"];
  const started = await call("/api/plugins/process-board/start", "POST", {
    name: "demo-service",
    argv,
    cwd: "D:\\work",
    logFile: "C:\\Users\\FANJIN~1\\AppData\\Local\\Temp\\pb-demo-service.log",
    port: MAIN_PORT,
  });
  console.log(`5. start       : ${started.status} ${JSON.stringify(started.body)}`);
  if (started.body?.ok !== true) problems.push(`starting failed: ${started.raw}`);
  const newPid = started.body?.pid;
  const cameBack = await until(() => portOpen(MAIN_PORT), 12000);
  console.log(`   port back   : ${cameBack} (new pid ${newPid})`);
  if (!cameBack) problems.push("the restarted service never bound its port again");
  const after = await serviceSays();
  console.log(`   service says: ${JSON.stringify(after)}`);
  if (after === null || after.ok !== true) problems.push("the restarted service does not answer");
  // A fresh process means the uptime counter restarted.
  if (after !== null && Number.parseFloat(after.uptime) > 20) {
    problems.push(`the uptime is ${after.uptime}s, so this is not a fresh process`);
  }

  // --- 6. stop the new one, so the machine is left as it was found -------------
  if (Number.isInteger(newPid)) {
    const stoppedAgain = await call("/api/plugins/process-board/kill", "POST", { pid: newPid });
    console.log(`6. stop again  : ${stoppedAgain.status} ${JSON.stringify(stoppedAgain.body)}`);
    const freed = await until(async () => !(await portOpen(MAIN_PORT)));
    if (!freed) problems.push("the restarted service could not be stopped");
    console.log(`   port freed  : ${freed}`);
  }
} finally {
  await new Promise((done) => server.close(done));
}

if (problems.length > 0) {
  console.error("\nFAILED:");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log("\nlive service tests passed");
process.exit(0);
