/**
 * Checks the stylesheet parser against a hand-written fixture.
 *
 * The panel's assertions reported no at-rule selectors while the sheet plainly contains
 * `@container`, so the parser is being tested against a known input rather than against
 * the sheet it keeps misreading.
 *
 * Usage: node test/parser-fixture.test.mjs
 */
import assert from "node:assert/strict";

/** The same scan the panel test uses, on a fixture small enough to reason about. */
function rules(text) {
  const withoutComments = text.replace(/\/\*[\s\S]*?\*\//g, "");
  const found = [];
  const conditions = [];
  const blocks = [];
  let selector = "";
  let mode = "selector";
  for (const char of withoutComments) {
    if (mode === "selector") {
      if (char === "{") {
        const prelude = selector.trim().replace(/\s+/g, " ");
        selector = "";
        if (prelude.startsWith("@")) {
          conditions.push(prelude);
          blocks.push({ kind: "at" });
        } else {
          found.push({ selector: prelude, body: "", condition: conditions.at(-1) ?? null });
          blocks.push({ kind: "rule", rule: found.at(-1) });
          mode = "body";
        }
        continue;
      }
      if (char === "}") {
        blocks.pop();
        if (conditions.length > blocks.filter((b) => b.kind === "at").length) conditions.pop();
        continue;
      }
      selector += char;
      continue;
    }
    if (char === "}") { blocks.pop(); mode = "selector"; continue; }
    blocks.at(-1).rule.body += char;
  }
  return found.map((rule) => ({ ...rule, body: rule.body.replace(/\s+/g, " ").trim() }));
}

const fixture = `
.a { color:red; }
@media (max-width: 600px) {
  .b { color:blue; }
}
@container card (max-width: 400px) {
  .c { color:green; }
  .d { display:none; }
}
`;

const found = rules(fixture);
console.log("parsed:");
for (const rule of found) {
  console.log(`  selector=${JSON.stringify(rule.selector)} condition=${JSON.stringify(rule.condition)} body=${JSON.stringify(rule.body)}`);
}

const problems = [];
const inner = found.filter((rule) => rule.condition !== null);
if (inner.length !== 3) problems.push(`expected 3 rules inside at-rules, got ${inner.length}`);
for (const rule of inner) {
  if (!/@(media|container)/.test(rule.condition ?? "")) {
    problems.push(`condition not detected for ${rule.selector}: ${JSON.stringify(rule.condition)}`);
  }
}
if (!found.some((rule) => rule.body === "display:none;")) problems.push("the nested display:none rule was lost");

if (problems.length > 0) {
  console.error("\nFAILED:");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log("\nparser fixture passed");
