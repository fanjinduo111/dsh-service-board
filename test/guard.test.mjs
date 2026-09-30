/**
 * Trust-fence tests for the locally patched dsh-process-board host half.
 *
 * Why this file exists: the shipped fence rejected genuine same-origin requests.
 * It demanded `sec-fetch-site: same-origin` or a present `Origin`, but a
 * same-origin GET carries neither in most browsers — the author's browser was
 * getting HTTP 403 from a route that works fine, which is exactly the kind of
 * wrong-but-plausible rule that needs a test rather than an argument.
 *
 * The patch states the rules that matter, so both directions are pinned here:
 * every shape a real browser sends must pass, and every shape an attacker can
 * produce must fail. The interesting one is DNS rebinding: the attacker's page
 * cannot forge `Host`, so a loopback `Host` requirement is the load-bearing rule,
 * not the browser marker.
 *
 * Run: node test/guard.test.mjs
 */

import assert from "node:assert/strict";

import { apply } from "../src/host/index.js";

/** A fake `http.IncomingMessage` carrying only what the guard reads. */
function request(headers, remoteAddress = "127.0.0.1") {
  return {
    method: "POST",
    url: "/api/plugins/process-board/log",
    headers,
    socket: { remoteAddress },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify({ pid: 1, lines: 1 }));
    },
    resume() {},
  };
}

/** A fake `http.ServerResponse` that records what the handler wrote. */
function response() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    writeHead(status, headers) {
      this.statusCode = status;
      this.headers = headers ?? {};
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(body) {
      this.body = typeof body === "string" ? body : "";
    },
  };
}

/** Mount the host half on a stub context and return its routes by path. */
function mountHost() {
  const routes = new Map();
  const jobs = { list: () => [] };
  const ctx = {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    sessions: { get: () => undefined, list: () => [] },
    sessionTitle: { get: () => undefined },
    webServer: {
      register(route) {
        routes.set(route.path, route);
        return () => {};
      },
    },
    effect(execute) {
      return execute() ?? (() => {});
    },
  };
  apply(ctx);
  return routes;
}

/** Send one synthetic request through the real route and return its status. */
async function callLog(route, headers, remoteAddress) {
  const res = response();
  await route.handler(request(headers, remoteAddress), res);
  return res;
}

const routes = mountHost();
const logRoute = routes.get("/api/plugins/process-board/log");
assert.ok(logRoute !== undefined, "the host half registered its log route");

// --- shapes a real browser sends: all must pass the fence ---------------------

// A same-origin GET/POST normally carries no marker at all. This is the exact
// case the shipped fence rejected.
const bare = await callLog(logRoute, { host: "127.0.0.1:19387" });
assert.notEqual(bare.statusCode, 403, "a same-origin request with no marker must not be refused");

const withSite = await callLog(logRoute, { host: "127.0.0.1:19387", "sec-fetch-site": "same-origin" });
assert.notEqual(withSite.statusCode, 403, "a same-origin marker must pass");

// An Electron or file-based renderer reports `none`, not `same-origin`.
const none = await callLog(logRoute, { host: "127.0.0.1:19387", "sec-fetch-site": "none" });
assert.notEqual(none.statusCode, 403, "sec-fetch-site: none must pass");

const withOrigin = await callLog(logRoute, { host: "127.0.0.1:19387", origin: "http://127.0.0.1:19387" });
assert.notEqual(withOrigin.statusCode, 403, "an origin matching the host must pass");

const viaLocalhost = await callLog(logRoute, { host: "localhost:19387" });
assert.notEqual(viaLocalhost.statusCode, 403, "a localhost authority must pass");

const ipv6 = await callLog(logRoute, { host: "[::1]:19387" });
assert.notEqual(ipv6.statusCode, 403, "an IPv6 loopback authority must pass");

// A legitimate refusal still happens for a real reason: the guard runs before
// validation, so a passing fence reaches the handler's own 400.
assert.equal(bare.statusCode, 400, "an allowed request reaches the handler's own validation");

// --- shapes an attacker can produce: all must fail ---------------------------

/** A rebound page reaches the loopback port but cannot forge `Host`. */
const rebound = await callLog(logRoute, { host: "evil.example.com:19387" });
assert.equal(rebound.statusCode, 403, "a non-loopback Host is refused (DNS rebinding)");
assert.equal(JSON.parse(rebound.body).reason, "host-not-loopback", "the refusal names the host rule");

/** A cross-site fetch is refused before its origin is even considered. */
const crossSite = await callLog(logRoute, { host: "127.0.0.1:19387", "sec-fetch-site": "cross-site" });
assert.equal(crossSite.statusCode, 403, "sec-fetch-site: cross-site is refused");

/** An older browser with no fetch metadata sends a foreign Origin. */
const foreignOrigin = await callLog(logRoute, { host: "127.0.0.1:19387", origin: "http://evil.example.com" });
assert.equal(foreignOrigin.statusCode, 403, "a foreign Origin is refused");
assert.equal(JSON.parse(foreignOrigin.body).reason, "origin-not-loopback", "the refusal names the origin rule");

/** A loopback origin on a different port is a different authority. */
const wrongPort = await callLog(logRoute, { host: "127.0.0.1:19387", origin: "http://127.0.0.1:9999" });
assert.equal(wrongPort.statusCode, 403, "a loopback origin on another port is refused");

/** A genuinely remote connection is refused regardless of its headers. */
const remote = await callLog(logRoute, { host: "127.0.0.1:19387" }, "10.0.0.5");
assert.equal(remote.statusCode, 403, "a non-loopback remote address is refused");
assert.equal(JSON.parse(remote.body).reason, "remote-address-not-loopback", "the refusal names the address rule");

// Every refusal must explain itself, so a future failure is diagnosable from the
// wire alone instead of needing a debugger.
for (const refused of [rebound, crossSite, foreignOrigin, wrongPort, remote]) {
  const payload = JSON.parse(refused.body);
  assert.equal(payload.ok, false, "a refusal reports ok: false");
  assert.equal(typeof payload.reason, "string", "a refusal reports a reason");
  assert.equal(refused.headers["content-type"], "application/json; charset=utf-8", "a refusal is JSON");
}

console.log("guard tests passed");

// The host half owns a scan interval through `ctx.effect`; the stub context above
// does not dispose it, so the process would otherwise stay alive after a pass.
process.exit(0);
