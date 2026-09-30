/**
 * Real end-to-end test of the filter configuration.
 *
 * The panel's whole purpose here is to stop listing every listening process on the
 * machine, so the filter has to survive three things a unit test would not catch:
 * the HTTP round trip, a write to disk, and a re-read on the next scan (a user
 * editing config.json by hand must see the effect without a restart).
 *
 * The storage directory is redirected through DSH_GATE_DIR so a test run cannot
 * touch the user's real configuration.
 *
 * Usage: node test/config.test.mjs
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const work = await mkdtemp(join(tmpdir(), "config-test-"));
// Redirect the plugin's storage before it is imported: config.js resolves the
// directory per call, so this keeps the run away from the real ~/.dsh.
process.env.DSH_GATE_DIR = work;

const hostFile = resolve(import.meta.dirname, "../src/host/index.js");
const { apply } = await import(`file://${hostFile.replace(/\\/g, "/")}?t=${Date.now()}`);

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

/** One request to the plugin. */
async function call(path, method = "GET", body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

try {
  const configFile = join(work, "process-board", "config.json");

  // --- the defaults must not filter anything -------------------------------
  const initial = await call("/api/plugins/process-board/config");
  console.log(`GET  /config   : ${initial.status} ${JSON.stringify(initial.body?.config)}`);
  if (initial.status !== 200) problems.push(`GET /config returned ${initial.status}`);
  if (initial.body?.config?.scope !== "all") problems.push("the default scope must not hide anything");
  if (!Array.isArray(initial.body?.config?.ports) || initial.body.config.ports.length !== 0) {
    problems.push("the default port filter must be empty");
  }
  if (typeof initial.body?.path !== "string" || initial.body.path === "") {
    problems.push("the response must name the config file so the user can edit it");
  }

  // --- a change must persist to disk ---------------------------------------
  const saved = await call("/api/plugins/process-board/config", "POST", { scope: "session", ports: [3306, 5173], hide: ["baidu"] });
  console.log(`POST /config   : ${saved.status} ${JSON.stringify(saved.body?.config)}`);
  if (saved.status !== 200 || saved.body?.ok !== true) problems.push(`POST /config failed: ${JSON.stringify(saved.body)}`);
  assert.equal(saved.body?.config?.scope, "session", "the saved scope is echoed back");

  const onDisk = JSON.parse(await readFile(configFile, "utf8"));
  console.log(`on disk        : ${JSON.stringify(onDisk)}`);
  if (onDisk.scope !== "session") problems.push("the scope was not written to disk");
  if (JSON.stringify(onDisk.ports) !== JSON.stringify([3306, 5173])) problems.push(`ports not persisted: ${JSON.stringify(onDisk.ports)}`);
  if (JSON.stringify(onDisk.hide) !== JSON.stringify(["baidu"])) problems.push(`hide not persisted: ${JSON.stringify(onDisk.hide)}`);

  // --- a partial patch must merge, not replace ------------------------------
  const patched = await call("/api/plugins/process-board/config", "POST", { ports: [8080] });
  console.log(`patch          : ${JSON.stringify(patched.body?.config)}`);
  if (patched.body?.config?.scope !== "session") problems.push("a partial patch must keep the other fields");
  if (JSON.stringify(patched.body?.config?.ports) !== JSON.stringify([8080])) problems.push("the patched field must win");

  // --- a hand-edit must be picked up on the next scan -----------------------
  await writeFile(configFile, JSON.stringify({ scope: "all", ports: [], hide: ["hand-edited"] }), "utf8");
  // The state handler reloads the config on each scan; asking for state triggers one.
  await call("/api/plugins/process-board/state");
  const reread = await call("/api/plugins/process-board/config");
  console.log(`after hand-edit: ${JSON.stringify(reread.body?.config)}`);
  if (JSON.stringify(reread.body?.config?.hide) !== JSON.stringify(["hand-edited"])) {
    problems.push("a hand-edited config.json was not picked up");
  }

  // --- a corrupt file must fall back, not blank the panel -------------------
  await writeFile(configFile, "{ this is not json", "utf8");
  const afterCorrupt = await call("/api/plugins/process-board/config");
  console.log(`after corrupt  : ${JSON.stringify(afterCorrupt.body?.config)}`);
  if (afterCorrupt.status !== 200) problems.push(`a corrupt config must still answer 200, got ${afterCorrupt.status}`);
  if (afterCorrupt.body?.config?.scope !== "all" || afterCorrupt.body.config.hide.length !== 0) {
    problems.push("a corrupt config must fall back to the defaults");
  }

  // --- the state payload reports the active filter and the hidden count ------
  const state = await call("/api/plugins/process-board/state");
  if (state.body?.config === undefined) problems.push("the state payload should carry the active filter");
  if (typeof state.body?.hidden !== "number") problems.push("the state payload should report how many entries were filtered out");
  console.log(`state hidden   : ${state.body?.hidden}`);
} finally {
  await new Promise((done) => server.close(done));
}

await rm(work, { recursive: true, force: true }).catch(() => {});

if (problems.length > 0) {
  console.error("\nFAILED:");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log("\nconfig tests passed");
process.exit(0);
