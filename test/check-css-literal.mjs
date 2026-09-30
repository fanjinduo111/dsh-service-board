/**
 * Guards the embedded stylesheet against the mistake that broke this file three
 * times: a backtick or a `${` written inside the CSS terminates the template
 * literal, so the sheet is lost and the client half disappears from the UI.
 *
 * The first version of this guard asked for the text between `const CSS = ` and the
 * NEXT backtick. That is exactly the wrong span once the mistake has been made: the
 * next backtick is then far away, inside some function below, and everything between
 * — including live JavaScript — was taken for the stylesheet. Its brace counts came
 * out balanced and it reported the file healthy while every docked style had silently
 * stopped applying. The span is found by locating the literal's real end instead.
 *
 * Usage: node check-css-literal.mjs <client-file>
 */
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

const argument = process.argv[2];
if (argument === undefined || argument.trim() === "") {
  console.error("usage: node check-css-literal.mjs <client-file>");
  process.exit(2);
}
const file = resolve(argument);
// resolve("") yields the working directory, so a missing argument would otherwise
// have this read a directory and fail with a confusing ENAMETOOLONG.
const info = await stat(file).catch(() => null);
if (info === null || !info.isFile()) {
  console.error(`not a file: ${file}`);
  process.exit(2);
}
const source = await readFile(file, "utf8");
const problems = [];

// The stylesheet is the template literal assigned to CSS at module scope. Its closing
// backtick is the LAST one before the next top-level declaration, because the literal
// is the only thing between them.
const open = /^const CSS = `/m.exec(source);
if (open === null) {
  problems.push("no top-level `const CSS = ` literal found");
} else {
  const afterOpen = open.index + open[0].length;
  const rest = source.slice(afterOpen);
  // The next top-level declaration: a function or another const at column zero.
  const boundary = /\n(?:function |async function |const |let |var |export )/.exec(rest);
  const scope = boundary === null ? rest : rest.slice(0, boundary.index);
  const closeAt = scope.lastIndexOf("`");

  if (closeAt === -1) {
    problems.push("the stylesheet literal is never closed");
  } else {
    const body = scope.slice(0, closeAt);
    const trailing = scope.slice(closeAt + 1).trim();

    console.log(`stylesheet      : ${body.length} bytes extracted`);
    console.log(`balanced braces : ${(body.match(/\{/g) ?? []).length} open / ${(body.match(/\}/g) ?? []).length} close`);
    console.log(`literal ends    : with ${JSON.stringify(trailing.slice(0, 12))}`);

    if (body.includes("`")) problems.push("the stylesheet block contains a backtick");
    if (body.includes("${")) problems.push("the stylesheet block contains a `${` interpolation");
    if ((body.match(/\{/g) ?? []).length !== (body.match(/\}/g) ?? []).length) {
      problems.push("the stylesheet's braces are unbalanced");
    }
    // The sheet is large; a small span means the literal ended early, or that the
    // anchor above drifted onto some other literal.
    if (body.length < 4000) {
      problems.push(`the extracted stylesheet is only ${body.length} bytes, which is too small to be the whole sheet`);
    }
    // Stylesheets do not contain function declarations. Finding one proves the span
    // ran past the literal and swallowed executable code — the failure this guard
    // previously passed as healthy.
    const leaked = /\b(function\s+\w+\s*\(|=>\s*\{|await\s|return\s)/.exec(body);
    if (leaked !== null) {
      problems.push(`the stylesheet span swallowed executable code near ${JSON.stringify(leaked[0])}`);
    }
    // A semicolon after the closing backtick is optional, but nothing else belongs here.
    if (trailing !== "" && trailing !== ";") {
      problems.push(`unexpected text after the stylesheet literal: ${JSON.stringify(trailing.slice(0, 40))}`);
    }
  }
}

const literals = [...source.matchAll(/`[\s\S]*?`/g)].length;
console.log(`template literals in file: ${literals}`);

if (problems.length > 0) {
  console.error("\nFAILED:");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log("\nstylesheet literal is intact");
