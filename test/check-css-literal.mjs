/**
 * Guards the embedded stylesheet against the mistake that broke this file twice:
 * a backtick or a `${` inside the CSS template literal terminates it, so the file
 * fails to parse and the whole client half disappears from the UI.
 *
 * Usage: node check-css-literal.mjs <client-file>
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const file = resolve(process.argv[2] ?? "");
const source = await readFile(file, "utf8");

// The closing backtick sits on its own line without a trailing semicolon, so the
// pattern must not require one.
const match = /const CSS = `([\s\S]*?)`/.exec(source);
const problems = [];
if (match === null) {
  problems.push("no `const CSS = `...`;` template literal found");
} else {
  const body = match[1];
  if (body.includes("`")) problems.push("the stylesheet block contains a backtick");
  if (body.includes("${")) problems.push("the stylesheet block contains a `${` interpolation");
  console.log(`stylesheet      : ${body.length} bytes extracted`);
  console.log(`balanced braces : ${(body.match(/\{/g) ?? []).length} open / ${(body.match(/\}/g) ?? []).length} close`);
  if ((body.match(/\{/g) ?? []).length !== (body.match(/\}/g) ?? []).length) {
    problems.push("the stylesheet's braces are unbalanced");
  }
}

// A second template literal anywhere would suggest the first one was truncated
// and the rest of the sheet leaked into executable code.
const literals = [...source.matchAll(/`[\s\S]*?`/g)].length;
console.log(`template literals in file: ${literals}`);

if (problems.length > 0) {
  console.error("\nFAILED:");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log("\nstylesheet literal is intact");
