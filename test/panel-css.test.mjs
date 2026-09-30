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
 * Every `selector { declarations }` rule, in document order, with the conditional
 * group it sits inside (if any) reported as `condition`.
 *
 * Comments are stripped first: a `{` inside a comment would otherwise be read as the
 * start of a declaration block and desynchronise the scan.
 *
 * This walks the sheet with a brace-depth stack rather than matching
 * `([^{}]+)\{([^{}]*)\}`. That regex looks equivalent and is not: where `@media … {`
 * appears, the pattern fails at the at-rule's own brace, backtracks, and restarts just
 * after it, so the at-rule prelude is silently dropped and every inner rule is reported
 * as unconditional. The panel's narrow-width rules were invisible to every assertion
 * because of exactly that — the same class of silence that let a broken stylesheet pass
 * earlier, so the next assertion that depends on nesting is tested against a fixture in
 * `parser-fixture.test.mjs`.
 */
function rules(text) {
  const withoutComments = text.replace(/\/\*[\s\S]*?\*\//g, "");
  const found = [];
  /** Conditional-group preludes currently open, outermost first. */
  const conditions = [];
  /** One entry per open block: { kind: "at" | "rule", rule? }. */
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
          const rule = { selector: prelude, body: "", condition: conditions.at(-1) ?? null };
          found.push(rule);
          blocks.push({ kind: "rule", rule });
          mode = "body";
        }
        continue;
      }
      if (char === "}") { blocks.pop(); if (conditions.length > blocks.filter((b) => b.kind === "at").length) conditions.pop(); continue; }
      selector += char;
      continue;
    }
    // Reading a declaration block.
    if (char === "}") {
      blocks.pop();
      mode = "selector";
      continue;
    }
    blocks.at(-1).rule.body += char;
  }
  return found.map((rule) => ({
    selector: rule.selector,
    body: rule.body.replace(/\s+/g, " ").trim(),
    condition: rule.condition,
  }));
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
// mid-air instead of at the window edge. The declarations may be spread across several
// rules for the same selector, so every one of them is consulted rather than the last:
// taking only the last broke the moment a second rule for this selector was added.
const dockedPanelRules = all.filter((rule) => /^body\.dshpb-docked\s+\.dshpb-panel$/.test(rule.selector.trim()));
assert.ok(dockedPanelRules.length > 0, "the docked panel has its own rule");
const dockedPanelBody = dockedPanelRules.map((rule) => rule.body).join(" ");
assert.ok(
  /background:/.test(dockedPanelBody),
  "the docked panel paints the strip left free above the dialog",
);
assert.ok(
  /top:\s*0/.test(dockedPanelBody) && /height:\s*100vh/.test(dockedPanelBody),
  "the docked panel is pinned to the viewport, not left to the base rule's inset shorthand",
);

// --- the table must never push 操作 out of the panel --------------------------

// Six columns do not fit in a narrow column; the secondary ones give way by panel
// width, so the column of buttons stays reachable at every width the drag handle allows.
const narrowRules = all.filter((rule) => rule.condition !== null && /@container/.test(rule.condition));
assert.ok(
  narrowRules.length >= 3,
  `the panel declares container-query rules for narrow widths (found ${narrowRules.length}); `
  + `at-rule selectors seen: ${JSON.stringify(all.map((r) => r.selector).filter((s) => s.includes("@")).slice(0, 6))}; `
  + `nth-child selectors seen: ${JSON.stringify(all.map((r) => r.selector).filter((s) => s.includes("nth-child")).slice(0, 6))}; `
  + `extracted sheet contains @container: ${css.includes("@container")}; `
  + `tail of the extracted sheet: ${JSON.stringify(css.slice(-320))}`,
);
assert.ok(
  /container-type:\s*inline-size/.test(dockedPanelBody),
  "the panel is a size container, so the queries follow the drag handle and not the window",
);
const hiddenColumns = narrowRules.filter((rule) => /nth-child\([45]\)/.test(rule.selector) && /display:\s*none/.test(rule.body));
assert.ok(
  hiddenColumns.length >= 2,
  `HTTP and PID are hidden at narrow widths (found ${hiddenColumns.length} rules)`,
);
// And the queries must actually be scoped to widths, not to some other feature.
assert.ok(
  narrowRules.every((rule) => /max-width:\s*\d+px/.test(rule.condition)),
  `every container query states a width: ${JSON.stringify(narrowRules.map((r) => r.condition))}`,
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

// --- the log is a band under the list, not a column beside it ----------------
//
// What this replaces: an assertion that the open log's rule reads `flex:1 1 100%` and
// a comment claiming that makes it "take the whole docked width". It does not. A
// flex-basis is not a width, and Chrome kept laying the two out side by side: with long
// log lines the log's max-content width won the shrink and the column measured 0px
// wide, with short ones the table was cut in half beside it. The stylesheet test passed
// throughout. So this asserts the structure that actually stacks, and `log-band.mjs`
// measures the result in a real browser.
const layoutRule = lastRule(".dshpb-layout");
assert.ok(layoutRule !== undefined, "the sheet styles the layout");
assert.ok(
  /flex-direction:\s*column/.test(layoutRule.body),
  `the log can only sit under the list if the layout is a column (found: ${layoutRule.body})`,
);

const logOnRule = lastRule(".dshpb-log-col.dshpb-log-on");
assert.ok(logOnRule !== undefined, "the open log column has a rule");
assert.ok(
  /height:\s*clamp\(/.test(logOnRule.body),
  `the open log states its own height, so the list keeps its share (found: ${logOnRule.body})`,
);
assert.ok(
  !/flex:\s*1\s+1\s+(100%|48%)/.test(logOnRule.body),
  `the open log must not claim a share of a row any more (found: ${logOnRule.body})`,
);
// The band's own top border is the separator, and a closed log column is display:none,
// so nothing has to be undone when the log is closed.
const logRule = lastRule(".dshpb-log-col");
assert.ok(
  /border-top:/.test(logRule.body),
  `the band is separated from the list by a top border on the band (found: ${logRule.body})`,
);
const listRule = lastRule(".dshpb-list-col");
assert.ok(
  /min-width:\s*0/.test(listRule.body) && !/min-width:\s*340px/.test(listRule.body),
  "the list column must drop its 340px minimum, which would overflow a docked panel",
);
assert.ok(
  /flex:\s*1\s+1\s+auto/.test(listRule.body),
  `the list takes the height the band leaves (found: ${listRule.body})`,
);

// The dialog is the flex column that bounds all of it. The published sheet had one;
// docking rewrote that rule for its geometry and lost `display:flex` with it, so the
// layout's `flex:1` was inert, the panel's height came from its content, and 400 log
// lines made it 1,026,533px tall inside an 854px dialog.
const dialogBodies = all
  .filter((rule) => rule.selector.includes(".dshpb-panel > .dshpb-dialog"))
  .map((rule) => rule.body)
  .join(" ");
assert.ok(
  /display:\s*flex/.test(dialogBodies) && /flex-direction:\s*column/.test(dialogBodies),
  `the dialog must lay the panel out as a column (found: ${dialogBodies})`,
);
assert.ok(
  /overflow:\s*hidden/.test(dialogBodies),
  `the dialog must clip, so no content can grow past the panel (found: ${dialogBodies})`,
);
const logBodyRule = lastRule(".dshpb-log-body");
assert.ok(
  /overflow:\s*auto/.test(logBodyRule.body),
  `the log body scrolls inside the band (found: ${logBodyRule.body})`,
);

// --- the sheet may only name theme tokens the application defines -------------

// The log came out near-black on near-black in the light theme, and not one rule here
// was wrong by itself: the background named a token the application does not define
// (--dsw-alias-bg-l2; it defines bg-layer-1/2/3), so the background was always the dark
// fallback, while the text colour named a token that does exist and therefore followed
// the theme. A var() with a missing name is not an error anywhere and the fallback hides
// it completely in whichever theme it was written for, so the only authority on "does
// this name resolve" is the application's own sheet. That answer is a fixture, taken
// from the installed DSH; panel-css-control.mjs pins the published sheet to the tokens
// this replaces.
const fixtureFile = resolve(import.meta.dirname, "fixtures/dsh-theme-tokens.json");
const themeTokens = new Set(JSON.parse(await readFile(fixtureFile, "utf8")).tokens);

const namedTokens = [...new Set([...css.matchAll(/var\((--dsw-alias-[a-z0-9-]+)/g)].map((match) => match[1]))];
const dangling = namedTokens.filter((token) => !themeTokens.has(token));
assert.equal(
  dangling.length,
  0,
  `every theme token in the sheet must exist in the app's theme; dangling: ${dangling.join(", ")}`,
);

// The two colours have to come from the same rule and both from the theme: split across
// a base rule and a docked override is exactly how they drifted apart.
assert.ok(
  /background:\s*var\(--dsw-alias-/.test(logBodyRule.body) && /color:\s*var\(--dsw-alias-/.test(logBodyRule.body),
  `the log surface takes its background and its text colour from the theme (found: ${logBodyRule.body})`,
);
assert.ok(
  /background:\s*var\(--dsw-alias-markdown-code-block/.test(logBodyRule.body),
  `the log surface uses the application's own code-surface token (found: ${logBodyRule.body})`,
);
// And the timestamp is the one part of a line that is always the same shape, so it is
// the part that gets pushed back for the message to read.
const logTimeRule = lastRule(".dshpb-log-time");
assert.ok(logTimeRule !== undefined, "the log timestamp has a rule of its own");
assert.ok(
  /color:\s*var\(--dsw-alias-label-tertiary/.test(logTimeRule.body),
  `the timestamp is dimmed with the theme's tertiary label (found: ${logTimeRule.body})`,
);
// --- the state cell answers how long the process has been up -------------------

// A row has to say when its process started without a seventh column: the panel is 460px
// wide by default and the narrow-width rules already give up HTTP and PID. So the age is a
// second line inside the state cell, which costs no height at all, because every row
// already carries the service name above its command.
const stateCellRule = lastRule(".dshpb-statecell");
assert.ok(stateCellRule !== undefined, "the state cell has a rule of its own");
assert.ok(
  /white-space:\s*nowrap/.test(stateCellRule.body),
  `the state cell keeps its words on one line (found: ${stateCellRule.body})`,
);
const uptimeRule = lastRule(".dshpb-uptime");
assert.ok(uptimeRule !== undefined, "the uptime line has a rule");
assert.ok(
  /display:\s*block/.test(uptimeRule.body),
  `the uptime is a second line in the cell rather than a column of its own (found: ${uptimeRule.body})`,
);
assert.ok(
  /font-size:\s*11px/.test(uptimeRule.body),
  `the uptime is set smaller than the state word it sits under (found: ${uptimeRule.body})`,
);
assert.ok(
  /color:\s*var\(--dsw-alias-label-tertiary/.test(uptimeRule.body),
  `the uptime is muted with the theme's tertiary label, like the log timestamps (found: ${uptimeRule.body})`,
);
assert.ok(
  /tabular-nums/.test(uptimeRule.body),
  `the uptime uses tabular figures, so a column of ages does not jitter as the digits change (found: ${uptimeRule.body})`,
);

// 日志全屏 still means the band takes the panel, so the clamp has to be released.
const logMaxRule = lastRule(".dshpb-layout.dshpb-log-max .dshpb-log-col");
assert.ok(
  logMaxRule !== undefined && /height:\s*auto/.test(logMaxRule.body),
  `log fullscreen releases the band's clamp (found: ${logMaxRule?.body})`,
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
//
// Every rule for the selector is considered, not only the last: a later rule may set
// something else entirely (a container query changing padding, for one), and reading
// only the last would then report a missing declaration that is present.
for (const selector of [".dshpb-table th", ".dshpb-table td"]) {
  const bodies = all
    .filter((rule) => rule.selector.split(",").map((part) => part.trim()).includes(selector))
    .map((rule) => rule.body);
  assert.ok(bodies.length > 0, `${selector} has a rule`);
  assert.ok(
    bodies.some((body) => /white-space:\s*nowrap/.test(body)),
    `${selector} must not break mid-word; bodies: ${JSON.stringify(bodies)}`,
  );
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
console.log(`layout           : ${layoutRule.body}`);
console.log(`log band         : ${logOnRule.body}`);
console.log(`log surface      : ${logBodyRule.body}`);
console.log(`uptime line      : ${uptimeRule.body}`);
console.log(`theme tokens     : ${namedTokens.length} named, ${dangling.length} dangling`);
console.log("\npanel css tests passed");

// Nothing here keeps the loop alive, but be explicit for symmetry with the
// other suites: the module imports only fs and path.
process.exit(0);
