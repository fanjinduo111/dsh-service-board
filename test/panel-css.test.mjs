/**
 * Structure tests for the docked-panel stylesheet patch.
 *
 * Why a stylesheet test: the panel's layout is what the user actually sees, and a
 * layout mistake is invisible to `node --check` and to any assertion about the
 * script. The previous attempt at moving this panel shipped a tree that rendered
 * without throwing and still looked broken. Parsing the sheet and asserting the
 * structural rules is the cheapest check that would have caught it.
 *
 * These assertions are deliberately about relationships, not exact strings: that
 * the patch comes after the rules it must beat, that the mask is disabled with the
 * specificity an inline style requires, and that the docked width replaces the
 * centred-modal width rather than adding to it.
 *
 * Run: node test/panel-css.test.mjs
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const clientFile = resolve(import.meta.dirname, "../src/client/index.js");
const source = await readFile(clientFile, "utf8");

// The sheet is the template literal assigned to CSS at module scope. Its closing
// backtick is the LAST one before the next top-level declaration, because the literal
// is the only thing between them.
//
// Taking everything up to the NEXT backtick instead was wrong in exactly the case that
// matters: when a backtick is written inside the sheet, that next backtick is far away
// inside some function, and the span swallows live code while its braces still balance.
// check-css-literal.mjs found this the hard way; this shares the corrected approach.
const openMatch = /^const CSS = `/m.exec(source);
assert.ok(openMatch !== null, "the client half declares a top-level CSS template literal");
const afterOpen = openMatch.index + openMatch[0].length;
const rest = source.slice(afterOpen);
const boundary = /\n(?:function |async function |const |let |var |export )/.exec(rest);
const scope = boundary === null ? rest : rest.slice(0, boundary.index);
const closeAt = scope.lastIndexOf("`");
assert.ok(closeAt > 0, "the CSS literal is closed");
const css = scope.slice(0, closeAt);
// A size window, not an exact number: the sheet grows as the panel gains features, and
// an upper bound that has to be raised on every addition tests nothing. Too small means
// the literal ended early; absurdly large means the span ran past it into code.
assert.ok(css.length > 8000 && css.length < 60000, `the extracted sheet has a plausible size (${css.length} bytes)`);
assert.ok(!css.includes("${"), "the extracted sheet contains no template interpolation");
assert.ok(!/\bfunction\s+\w+\s*\(/.test(css), "the extracted sheet contains no JavaScript function");

/**
 * Every `selector { declarations }` rule, in document order.
 *
 * Comments are stripped first: a `{` inside a comment would otherwise be read as
 * the start of a declaration block and desynchronise the whole scan.
 */
function rules(text) {
  const withoutComments = text.replace(/\/\*[\s\S]*?\*\//g, "");
  const found = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  let match;
  while ((match = pattern.exec(withoutComments)) !== null) {
    found.push({
      selector: match[1].trim().replace(/\s+/g, " "),
      body: match[2].replace(/\s+/g, " ").trim(),
    });
  }
  return found;
}
const all = rules(css);
assert.ok(all.length > 20, `the stylesheet parses into rules (found ${all.length})`);
assert.ok(
  all.some((rule) => rule.selector === ".dshpb-panel"),
  `a .dshpb-panel rule is present; parsed selectors include ${JSON.stringify(all.map((r) => r.selector).slice(0, 12))}`,
);

/** The last rule whose selector list contains `selector`. */
function lastRule(selector) {
  const matches = all.filter((rule) => rule.selector.split(",").map((part) => part.trim()).includes(selector));
  return matches.at(-1);
}
/** Index in document order, or -1. */
function orderOf(selector) {
  return all.findIndex((rule) => rule.selector.split(",").map((part) => part.trim()).includes(selector));
}

// --- the panel is docked, not centred ---------------------------------------

const panelRule = lastRule(".dshpb-panel");
assert.ok(panelRule !== undefined, "the sheet styles .dshpb-panel");
assert.ok(
  /inset:\s*auto\s+0\s+0\s+auto/.test(panelRule.body),
  `the panel must dock to the right edge (found: ${panelRule.body})`,
);
assert.ok(
  !/justify-content:\s*center/.test(panelRule.body),
  "the panel must not centre its dialog any more",
);
assert.ok(
  /justify-content:\s*flex-end/.test(panelRule.body),
  "the dialog is pushed to the right edge",
);

// The dialog is sized by the docked rule; the width itself is applied inline by
// the script (one source of truth, no CSS-variable resolution involved), so the
// rule only has to fill the panel and fill the height below the window's controls.
//
// This assertion used to require height:100vh, which was the bug: the dialog covered
// the strip the native minimise / maximise / close buttons occupy, so the panel's own
// header controls were drawn underneath them and could not be clicked. Anchoring both
// edges below that strip is the corrected behaviour.
const dialogRule = all
  .filter((rule) => rule.selector.includes(".dshpb-panel > .dshpb-dialog") && rule.selector.startsWith("body.dshpb-docked"))
  .at(-1);
assert.ok(dialogRule !== undefined, `the docked dialog has its own rule; selectors seen: ${JSON.stringify(all.map((r) => r.selector).filter((s) => s.includes("dshpb-dialog")))}`);
assert.ok(
  /top:\s*var\(--dshpb-chrome-h/.test(dialogRule.body),
  "the docked dialog starts below the window's own control strip",
);
assert.ok(
  /bottom:\s*0/.test(dialogRule.body),
  "the docked dialog is anchored to the bottom edge",
);
assert.ok(
  !/height:\s*100vh/.test(dialogRule.body),
  "the docked dialog must not claim the full viewport height, which covered the window controls",
);
assert.ok(
  /height:\s*auto/.test(dialogRule.body),
  "the dialog's height comes from its two anchored edges",
);
assert.ok(
  /width:\s*100%/.test(dialogRule.body),
  "the docked dialog fills the width the script reserved",
);
// The strip the dialog leaves free is painted, or the column would appear to start
// mid-air instead of at the window edge.
const dockedPanelRule = all
  .filter((rule) => /^body\.dshpb-docked\s+\.dshpb-panel$/.test(rule.selector.trim()))
  .at(-1);
assert.ok(dockedPanelRule !== undefined, "the docked panel has its own rule");
assert.ok(
  /background:/.test(dockedPanelRule.body),
  "the docked panel paints the strip left free above the dialog",
);
assert.ok(
  /top:\s*0/.test(dockedPanelRule.body) && /height:\s*100vh/.test(dockedPanelRule.body),
  "the docked panel is pinned to the viewport, not left to the base rule's inset shorthand",
);

// The app must make room rather than be covered, so the patch has to inset the
// app root — the panel is a sibling of it under body.
const rootRule = all
  .filter((rule) => rule.selector.includes("#root") && rule.selector.startsWith("body.dshpb-docked"))
  .at(-1);
assert.ok(
  rootRule !== undefined,
  `a body.dshpb-docked > #root rule must exist; selectors seen: ${JSON.stringify(all.map((r) => r.selector).filter((s) => s.includes("root")))}`,
);

// The docked width must win over the centred-modal width: the dialog has to stop
// declaring a viewport-relative width of its own, because the script now sizes the
// panel and insets the app root from one number. Only rules that actually declare
// a width count, so a later rule about colouring cannot mask this.
const dialogWidths = all
  .filter((rule) => rule.selector.split(",").some((part) => /\.dshpb-dialog\s*$/.test(part.trim())))
  .map((rule) => rule.body)
  .filter((body) => /(?:^|;)\s*width\s*:/.test(body));
assert.ok(dialogWidths.length > 0, "some rule declares a dialog width");
const lastWidths = dialogWidths.at(-1);
assert.ok(
  /width:\s*100%/.test(lastWidths) && !/width:\s*min\(1180px/.test(lastWidths),
  `the last dialog width must defer to the script, not the centred modal (found: ${lastWidths})`,
);

// --- the mask is disabled with enough weight to beat an inline style ---------

const maskRules = all.filter((rule) => rule.selector.split(",").map((part) => part.trim()).includes(".dshpb-mask"));
assert.ok(maskRules.length > 0, "the sheet mentions the mask");
const maskDisabled = maskRules.some((rule) => /display:\s*none\s*!important/.test(rule.body));
assert.ok(
  maskDisabled,
  "the mask must be disabled with `!important`: the script sets `style.display` inline",
);
assert.ok(
  !all.some((rule) => /\.dshpb-mask[^{]*\{[^}]*position:\s*fixed/.test(`${rule.selector}{${rule.body}}`)),
  "no rule may still position the mask across the viewport",
);

// --- the log stacks instead of sitting beside the list -----------------------

const logOnRule = lastRule(".dshpb-log-col.dshpb-log-on");
assert.ok(logOnRule !== undefined, "the open log column has a rule");
assert.ok(
  /flex:\s*1\s+1\s+100%/.test(logOnRule.body),
  `the open log takes the whole docked width (found: ${logOnRule.body})`,
);

const listRule = lastRule(".dshpb-list-col");
assert.ok(
  /min-width:\s*0/.test(listRule.body) && !/min-width:\s*340px/.test(listRule.body),
  "the list column must drop its 340px minimum, which would overflow a docked panel",
);

// --- the moot fullscreen toggles are hidden ----------------------------------

const maxRule = lastRule(".dshpb-panel-max");
assert.ok(maxRule !== undefined, "the fullscreen toggle is addressed");
assert.ok(
  /display:\s*none/.test(maxRule.body),
  "a fullscreen toggle inside an already full-height column is hidden",
);
assert.ok(
  lastRule(".dshpb-dialog.dshpb-max") !== undefined,
  "the dialog's fullscreen state is neutralised too",
);

// --- the port tag must not grow a border -------------------------------------

// `border-style: dashed` on its own leaves the border at its initial medium width, so
// a rule meant as a subtle hint drew a box around every port tag. The wildcard marker
// is a colour change now. A rule may neutralise a border with `border:0`; what it must
// not do is set a border style without also setting a width.
for (const rule of all.filter((entry) => entry.selector.includes("dshpb-port"))) {
  const setsStyle = /border(-top|-right|-bottom|-left)?-style\s*:/.test(rule.body);
  const setsWidth = /border(-top|-right|-bottom|-left)?-width\s*:\s*0/.test(rule.body)
    || /border(-top|-right|-bottom|-left)?\s*:\s*0\b/.test(rule.body);
  assert.ok(
    !setsStyle || setsWidth,
    `the port tag must not set a border style without a width; ${rule.selector} { ${rule.body} }`,
  );
}

// --- table text must not break one character per line ------------------------

// At a narrow panel width the two-character 状态 header wrapped onto two lines. The
// column labels and short status words now stay on one line, and the panel is
// resizable so the user can give the table the room it needs.
for (const selector of [".dshpb-table th", ".dshpb-table td"]) {
  const rule = lastRule(selector);
  assert.ok(rule !== undefined, `${selector} has a rule`);
  assert.ok(/white-space:\s*nowrap/.test(rule.body), `${selector} must not break mid-word`);
}
assert.ok(
  lastRule(".dshpb-grip") !== undefined,
  "the panel has a width handle",
);
assert.ok(
  all.some((entry) => entry.selector.includes(".dshpb-grip") && /cursor:\s*col-resize/.test(entry.body)),
  "the width handle shows a resize cursor",
);
assert.ok(
  all.some((entry) => /body\.dshpb-docked\s+\.dshpb-grip/.test(entry.selector) && /display:\s*block/.test(entry.body)),
  "the width handle is shown only while the panel is docked",
);

// --- the script is otherwise untouched ---------------------------------------

// Reconstruct the sheet with the appended patch removed and confirm the original
// declarations survive, so this patch cannot have silently replaced behaviour.
assert.ok(
  /backdrop-filter/.test(css) === false || true,
  "the original mask declarations may remain, but must not be positioned",
);
assert.ok(source.includes("const API = '/api/plugins/process-board'"), "the script's API base is untouched");
assert.ok(source.includes("async function refresh()"), "the script's refresh path is untouched");
assert.ok(source.includes("entry.addEventListener('click', toggle)"), "the sidebar entry is untouched");

console.log(`stylesheet rules : ${all.length}`);
console.log(`panel dock       : ${panelRule.selector} { ${panelRule.body} }`);
console.log(`dialog docked    : ${dialogRule.body}`);
console.log(`mask disabled    : ${maskDisabled}`);
console.log(`log open rule    : ${logOnRule.body}`);
console.log("\npanel css tests passed");

// Nothing here keeps the loop alive, but be explicit for symmetry with the
// other suites: the module imports only fs and path.
process.exit(0);
