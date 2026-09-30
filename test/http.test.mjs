/**
 * End-to-end HTTP test of the patched dsh-process-board host half.
 *
 * `guard.test.mjs` calls the route handler with synthetic request objects. This
 * file goes one level further: it mounts the real plugin on a real `node:http`
 * server and speaks to it over a socket, so the request line, headers, and
 * `remoteAddress` are produced by Node's own client rather than by a stub.
 *
 * That distinction matters here: the bug being fixed was a wrong assumption about
 * which headers a browser sends, so the closer the test stands to a real
 * connection, the more it can prove.
 *
 * Usage: node test/http.test.mjs [bundle-file]
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { createConnection } from "node:net";

const bundleArg = process.argv[2] ?? resolve(import.meta.dirname, "../src/host/index.js");
const { apply } = await import(`file://${bundleArg.replace(/\\/g, "/")}`);

/** Mount the host half onto a real HTTP server and return its port. */
async function startServer() {
  const routes = { exact: new Map(), prefix: [] };
  const ctx = {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    sessions: { get: () => undefined, list: () => [] },
    sessionTitle: { get: () => undefined },
    webServer: {
      register(route) {
        if (route.kind === "prefix") routes.prefix.push(route);
        else routes.exact.set(route.path, route);
        return () => {};
      },
    },
    effect(execute) {
      return execute() ?? (() => {});
    },
  };
  apply(ctx);

  const server = createServer((req, res) => {
    const exact = routes.exact.get((req.url ?? "").split("?")[0]);
    if (exact !== undefined) {
      void exact.handler(req, res);
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "no-route" }));
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  return { server, port: server.address().port };
}

/** One raw HTTP request so arbitrary headers can be set. */
function rawRequest(port, path, headers) {
  const lines = [`GET ${path} HTTP/1.1`, `Host: ${headers.host ?? `127.0.0.1:${port}`}`];
  for (const [name, value] of Object.entries(headers)) {
    if (name === "host") continue;
    lines.push(`${name}: ${value}`);
  }
  lines.push("Connection: close", "", "");
  const socket = createConnection({ host: "127.0.0.1", port });
  let raw = "";
  return new Promise((done) => {
    socket.setTimeout(8000);
    socket.on("connect", () => socket.write(lines.join("\r\n")));
    socket.on("data", (chunk) => { raw += chunk.toString("utf8"); });
    socket.on("timeout", () => socket.destroy());
    socket.on("close", () => {
      const [head, ...rest] = raw.split("\r\n\r\n");
      const statusLine = head.split("\r\n")[0] ?? "";
      const status = Number(/^HTTP\/1\.1 (\d+)/.exec(statusLine)?.[1] ?? 0);
      let body = rest.join("\r\n\r\n");
      if (/transfer-encoding: chunked/i.test(head)) {
        // Strip chunk framing: "<hex>\r\n<payload>\r\n0\r\n\r\n".
        const chunks = body.split("\r\n");
        body = chunks.filter((line) => !/^[0-9a-f]+$/i.test(line)).join("");
      }
      done({ status, body: body.trim() });
    });
  });
}

const { server, port } = await startServer();
const path = "/api/plugins/process-board/state";

try {
  // The exact shape a browser sends for a same-origin GET: no Origin, no
  // Sec-Fetch-* on some clients. This was refused before the patch.
  const bare = await rawRequest(port, path, {});
  assert.equal(bare.status, 200, `a bare same-origin request must succeed (got ${bare.status}: ${bare.body})`);
  assert.equal(JSON.parse(bare.body).ok, true, "the state handler answers ok: true");

  const sameOrigin = await rawRequest(port, path, { "sec-fetch-site": "same-origin" });
  assert.equal(sameOrigin.status, 200, "a same-origin marker must succeed");

  const electronLike = await rawRequest(port, path, { "sec-fetch-site": "none" });
  assert.equal(electronLike.status, 200, "sec-fetch-site: none must succeed");

  const withOrigin = await rawRequest(port, path, { origin: `http://127.0.0.1:${port}` });
  assert.equal(withOrigin.status, 200, "a matching Origin must succeed");

  const localhost = await rawRequest(port, path, { host: `localhost:${port}` });
  assert.equal(localhost.status, 200, "a localhost authority must succeed");

  // Attack shapes.
  const rebound = await rawRequest(port, path, { host: `evil.example.com:${port}` });
  assert.equal(rebound.status, 403, "a non-loopback Host must be refused");
  assert.equal(JSON.parse(rebound.body).reason, "host-not-loopback", "the refusal explains itself");

  const crossSite = await rawRequest(port, path, { "sec-fetch-site": "cross-site" });
  assert.equal(crossSite.status, 403, "a cross-site marker must be refused");

  const foreign = await rawRequest(port, path, { origin: "http://evil.example.com" });
  assert.equal(foreign.status, 403, "a foreign Origin must be refused");

  console.log(`server port    : ${port}`);
  console.log(`same-origin    : ${bare.status} (was 403 before the patch)`);
  console.log(`rebinding      : ${rebound.status} (${JSON.parse(rebound.body).reason})`);
  console.log(`cross-site     : ${crossSite.status}`);
  console.log(`foreign origin : ${foreign.status}`);
  console.log("\nhttp tests passed");
} finally {
  await new Promise((done) => server.close(done));
  // The plugin owns a scan interval through `ctx.effect`; this stub context does
  // not dispose it, so the process would otherwise stay alive after a pass.
  process.exit(0);
}
