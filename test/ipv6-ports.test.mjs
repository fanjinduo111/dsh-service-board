/**
 * A service that listens only on IPv6 must still show up in the panel.
 *
 * Reported from a machine where a vite dev server bound `[::1]:9528` — vite's default host is
 * `localhost`, which resolves to `::1` there — and the panel showed nothing for it. The scanner
 * asked `netstat -ano -p tcp`, and that switch lists **TCPv4 only**, so the port table had no row
 * for that pid, `ports` came out empty, and the first gate (`ports.length === 0 && (!logPath ||
 * NOISE.test(name))`) dropped the whole entry. Nothing was reported as wrong: one missing row.
 *
 * This starts a real IPv6-only listener in this very process and asks the real scanner whether it
 * can see it. The control runs the command the scanner used to run and asserts it cannot.
 *
 * Run: node test/ipv6-ports.test.mjs
 */
import { execFile } from "node:child_process";
import { createServer } from "node:net";
import { promisify } from "node:util";
import { scanProcesses } from "../src/host/scanner.js";

const execFileAsync = promisify(execFile);

if (process.platform !== "win32") {
  console.log("skipped: the scanner reports nothing on non-Windows platforms");
  process.exit(0);
}

let failures = 0;
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${extra === "" ? "" : ` — ${extra}`}`);
  if (!ok) failures += 1;
};

const server = createServer();
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "::1", resolve);
});
const port = server.address().port;
console.log(`listening on [::1]:${port} (pid ${process.pid})\n`);

try {
  // Control: the exact command the scanner shipped with. If this ever starts matching, the test
  // below stops proving anything, so it is asserted rather than assumed.
  const { stdout: v4 } = await execFileAsync("netstat", ["-ano", "-p", "tcp"], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  const seenByV4Only = v4.split(/\r?\n/).some((line) => {
    const parts = line.replace(/\s+/g, " ").trim().split(" ");
    return parts[0] === "TCP" && parts[3] === "LISTENING" && parts[4] === String(process.pid) && parts[1].endsWith(`:${port}`);
  });
  check("control: `netstat -ano -p tcp` cannot see an IPv6-only listener", !seenByV4Only);

  const entries = await scanProcesses();
  const mine = entries.find((e) => e.pid === process.pid);
  check("the IPv6-only service survives the port gate", mine !== undefined);
  check("its port is reported", mine?.ports?.includes(port) === true, `ports=[${(mine?.ports ?? []).join(",")}]`);
  const bind = (mine?.binds ?? []).find((b) => b.port === port);
  check("its bound address is kept as ::1", bind?.addr === "::1", `binds=${JSON.stringify(mine?.binds ?? [])}`);
} finally {
  server.close();
}

console.log(`\n${failures === 0 ? "PASSED" : `FAILED: ${failures} check(s)`}`);
process.exit(failures === 0 ? 0 : 1);
