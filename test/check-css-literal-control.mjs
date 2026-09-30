/**
 * Negative control for the stylesheet guard.
 *
 * The guard reported the file healthy while a bad edit had swallowed every docked
 * style, so its ability to fail is the property worth pinning. This reproduces the
 * exact corruption — CSS appended inside a template literal further down the file —
 * and asserts the guard rejects it.
 *
 * Usage: node test/check-css-literal-control.mjs <client-file>
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const guard = resolve(import.meta.dirname, "check-css-literal.mjs");
const argument = process.argv[2];
if (argument === undefined || argument.trim() === "") {
  console.error("usage: node check-css-literal-control.mjs <client-file>");
  process.exit(2);
}
const target = resolve(argument);
console.log(`control target : ${target}`);
// Validate before reading: a malformed path would otherwise surface as an unrelated
// ENAMETOOLONG from open() and bury the real message.
const info = await stat(target).catch(() => null);
if (info === null || !info.isFile()) {
  console.error(`not a file: ${target}`);
  process.exit(2);
}
const source = await readFile(target, "utf8");
const work = await mkdtemp(join(tmpdir(), "css-guard-"));
const problems = [];

/** Run the guard and report whether it accepted the file. */
async function guardAccepts(file) {
  try {
    await execFileAsync(process.execPath, [guard, file], { windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

try {
  // 1. The real file must pass.
  const cleanPath = join(work, "clean.js");
  await writeFile(cleanPath, source, "utf8");
  const cleanAccepted = await guardAccepts(cleanPath);
  console.log(`clean file accepted      : ${cleanAccepted}`);
  if (!cleanAccepted) problems.push("the guard rejects the real, healthy file");

  // 2. The corruption that slipped through: the stylesheet's closing backtick went
  //    missing, so the literal ran on and swallowed the code below it. The guard's
  //    first version reported this as healthy, because it took everything up to the
  //    NEXT backtick as the stylesheet and found its braces balanced.
  const cssClose = /\n`\n\nfunction apply\(ctx\) \{/.exec(source);
  if (cssClose === null) {
    problems.push("could not build the corrupted fixture; the stylesheet's end was not found");
  } else {
    const injected = source.replace(cssClose[0], "\n\nfunction apply(ctx) {");
    const brokenPath = join(work, "broken.js");
    await writeFile(brokenPath, injected, "utf8");
    const brokenAccepted = await guardAccepts(brokenPath);
    console.log(`swallowed-code accepted  : ${brokenAccepted}`);
    if (brokenAccepted) {
      problems.push("the guard accepts a file whose stylesheet literal ran on and swallowed executable code");
    }
  }

  // 3. A backtick written inside the stylesheet.
  //    The inserted character must be a real backtick: an earlier version of this case
  //    used an apostrophe in the comment, so it never exercised what it claimed to.
  //    The anchor is the port tag rule, which is stable; an earlier anchor named a rule
  //    that a later change removed, and the case then stopped running without saying so.
  const withBacktick = source.replace(
    /(\.dshpb-port \{ display:inline-block;)/,
    "/* a backtick follows -> ` <- and it must be rejected */\n$1",
  );
  if (withBacktick === source) {
    problems.push("could not build the backtick fixture; the anchor did not match");
  } else {
    const backtickPath = join(work, "backtick.js");
    // Path first, then contents: the arguments were swapped here once, which made the
    // stylesheet text the path and produced an unrelated ENAMETOOLONG.
    await writeFile(backtickPath, withBacktick, "utf8");
    const backtickAccepted = await guardAccepts(backtickPath);
    console.log(`backtick-in-css accepted : ${backtickAccepted}`);
    if (backtickAccepted) problems.push("the guard accepts a backtick inside the stylesheet");
  }
} finally {
  await rm(work, { recursive: true, force: true }).catch(() => {});
}

if (problems.length > 0) {
  console.error("\nFAILED:");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log("\nstylesheet guard control passed");
