/**
 * Tests the Windows command-line splitter used to make discovered services
 * restartable.
 *
 * The splitter is extracted from the installed host file and evaluated here, so
 * the test cannot drift from the code it is checking. The cases are the shapes a
 * real command line takes: a quoted executable path with spaces (the common case
 * on Windows), embedded quotes, and trailing backslashes before a quote.
 *
 * Run: node test/cmdline.test.mjs
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const hostFile = resolve(import.meta.dirname, "../src/host/index.js");
const source = await readFile(hostFile, "utf8");

// Pull the real function out of the module and evaluate just that declaration.
const start = source.indexOf("function splitCommandLine");
assert.ok(start !== -1, "the host half declares splitCommandLine");
const open = source.indexOf("{", start);
let depth = 0;
let end = -1;
for (let index = open; index < source.length; index += 1) {
  if (source[index] === "{") depth += 1;
  else if (source[index] === "}") {
    depth -= 1;
    if (depth === 0) { end = index + 1; break; }
  }
}
assert.ok(end !== -1, "the function body is balanced");
const splitCommandLine = new Function(`${source.slice(start, end)}; return splitCommandLine;`)();

const cases = [
  {
    name: "quoted executable with spaces, one argument",
    line: '"C:\\Program Files\\nodejs\\node.exe" D:\\work\\probe-server.js',
    want: ["C:\\Program Files\\nodejs\\node.exe", "D:\\work\\probe-server.js"],
  },
  {
    name: "multiple arguments",
    line: 'node server.js --port 5399 --host 127.0.0.1',
    want: ["node", "server.js", "--port", "5399", "--host", "127.0.0.1"],
  },
  {
    name: "quoted argument containing spaces",
    line: 'node "C:\\my app\\server.js" --name "my service"',
    want: ["node", "C:\\my app\\server.js", "--name", "my service"],
  },
  {
    name: "npm-style wrapper",
    line: '"C:\\Program Files\\nodejs\\node.exe" "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js" run dev',
    want: [
      "C:\\Program Files\\nodejs\\node.exe",
      "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js",
      "run",
      "dev",
    ],
  },
  {
    name: "trailing backslash before a closing quote stays literal",
    line: '"C:\\dir with space\\\\" x',
    want: ["C:\\dir with space\\", "x"],
  },
  {
    name: "collapsed whitespace is not an empty argument",
    line: "node   server.js",
    want: ["node", "server.js"],
  },
  {
    name: "empty input yields no arguments",
    line: "   ",
    want: [],
  },
];

let failures = 0;
for (const testCase of cases) {
  const got = splitCommandLine(testCase.line);
  const ok = JSON.stringify(got) === JSON.stringify(testCase.want);
  if (!ok) failures += 1;
  console.log(`${ok ? "ok  " : "FAIL"}  ${testCase.name}`);
  if (!ok) {
    console.log(`      want ${JSON.stringify(testCase.want)}`);
    console.log(`      got  ${JSON.stringify(got)}`);
  }
}

// The real command line observed from this machine must round-trip, since that is
// exactly what the restart path feeds to spawn().
const live = '"C:\\Program Files\\nodejs\\node.exe" D:\\work\\probe-server.js ';
const liveArgs = splitCommandLine(live);
assert.deepEqual(
  liveArgs,
  ["C:\\Program Files\\nodejs\\node.exe", "D:\\work\\probe-server.js"],
  "the observed live command line splits into an executable and its script",
);
console.log(`ok    observed live command line -> ${JSON.stringify(liveArgs)}`);

if (failures > 0) {
  console.error(`\n${failures} case(s) failed`);
  process.exit(1);
}
console.log("\ncmdline tests passed");
