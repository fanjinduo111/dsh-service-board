/**
 * Negative control for `panel-css.test.mjs`.
 *
 * A stylesheet test that passes on any input proves nothing. This downloads the
 * published bundle and asserts that the same rules the patch introduces are
 * *absent* there, so the suite's green result is attributable to the patch.
 *
 * Usage: node test/panel-css-control.mjs
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const work = await mkdtemp(join(tmpdir(), "pb-control-"));
try {
  execFileSync("npm", ["pack", "dsh-process-board@0.2.2", "--registry=https://registry.npmjs.org"], {
    cwd: work,
    stdio: "ignore",
    shell: process.platform === "win32",
  });
  const tgz = execFileSync("cmd", ["/c", "dir", "/b", "*.tgz"], { cwd: work }).toString().trim().split(/\r?\n/)[0];
  execFileSync("tar", ["-xzf", join(work, tgz), "-C", work], { stdio: "ignore" });

  const published = await readFile(join(work, "package", "src", "client", "index.js"), "utf8");
  const css = /const CSS = `([\s\S]*?)`/.exec(published)[1];
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");

  // Every rule the patch adds must be missing from the published sheet.
  const absent = [
    ["the mask is disabled", /\.dshpb-mask\s*\{[^}]*display:\s*none\s*!important/],
    ["the panel is docked", /\.dshpb-panel\s*\{[^}]*inset:\s*auto\s+0\s+0\s+auto/],
    ["the dialog is docked", /\.dshpb-panel\s*>\s*\.dshpb-dialog/],
    ["the dialog is a flex column that clips", /\.dshpb-panel\s*>\s*\.dshpb-dialog\s*\{[^}]*display:\s*flex[^}]*overflow:\s*hidden/],
    ["the layout stacks", /\.dshpb-layout\s*\{[^}]*flex-direction:\s*column/],
    ["the log is a band with its own height", /\.dshpb-log-col\.dshpb-log-on\s*\{[^}]*height:\s*clamp\(/],
    ["the source row is marked", /tr\.dshpb-logging/],
    ["the fullscreen toggle is hidden", /\.dshpb-panel-max[^{]*\{[^}]*display:\s*none/],
    ["the log surface uses the app's code-surface token", /--dsw-alias-markdown-code-block/],
    ["the log timestamp is dimmed", /\.dshpb-log-time\s*\{/],
  ];
  const problems = [];
  for (const [name, pattern] of absent) {
    const present = pattern.test(stripped);
    console.log(`${present ? "PRESENT" : "absent "}  ${name}`);
    if (present) problems.push(`the published bundle already has "${name}", so the test cannot attribute it to the patch`);
  }

  // And the rules the patch replaces must still be there, or the premise is wrong.
  const stillCentred = /\.dshpb-panel\s*\{[^}]*align-items:\s*center[^}]*justify-content:\s*center/.test(stripped);
  console.log(`${stillCentred ? "PRESENT" : "absent "}  the original centred-modal panel rule`);
  if (!stillCentred) problems.push("the published bundle does not centre the panel, so the premise of this patch is wrong");

  const stillMasked = /\.dshpb-mask\s*\{[^}]*position:\s*fixed/.test(stripped);
  console.log(`${stillMasked ? "PRESENT" : "absent "}  the original full-screen mask rule`);
  if (!stillMasked) problems.push("the published bundle has no full-screen mask, so the premise of this patch is wrong");

  // The log used to be a column sharing the row with the list - the layout this patch
  // replaces. If the published bundle already stacked it, the patch would be pointless.
  const stillBeside = /\.dshpb-log-col\s*\{[^}]*flex:\s*1\s+1\s+48%/.test(stripped);
  console.log(`${stillBeside ? "PRESENT" : "absent "}  the original log column beside the list`);
  if (!stillBeside) problems.push("the published bundle does not put the log beside the list, so the premise of this patch is wrong");

  // The dialog the patch restores as a flex column: present in the published sheet,
  // which is why losing it while docking was a regression rather than a design choice.
  const publishedDialogColumn = /\.dshpb-dialog\s*\{[^}]*display:\s*flex;\s*flex-direction:\s*column/.test(stripped);
  console.log(`${publishedDialogColumn ? "PRESENT" : "absent "}  the published dialog's flex column`);
  if (!publishedDialogColumn) problems.push("the published dialog is not a flex column, so the regression this patch repairs did not exist");

  // The report this patch answers was "the log is all pure black, I cannot make anything
  // out", in the light theme. The whole theme-token layer is this repository's: the
  // published sheet paints literal colours only. That is what makes the invented name
  // ours to answer for - the app defines bg-layer-1/2/3 and never bg-l2, so the log's
  // background stayed the dark literal while its text colour, which did resolve,
  // followed the theme into near-black.
  const publishedAliasTokens = [...new Set([...stripped.matchAll(/--dsw-alias-[a-z0-9-]+/g)].map((match) => match[0]))];
  console.log(`${publishedAliasTokens.length === 0 ? "absent " : "PRESENT"}  the published theme-token layer (${publishedAliasTokens.length} tokens)`);
  if (publishedAliasTokens.length > 0) {
    problems.push(`the published sheet already names ${publishedAliasTokens.length} theme tokens, so "this token layer is the patch's" is wrong`);
  }

  const publishedLiteralLog = /\.dshpb-log-body\s*\{[^}]*background:\s*#16181f/.test(stripped);
  console.log(`${publishedLiteralLog ? "PRESENT" : "absent "}  the published log surface as a bare dark literal`);
  if (!publishedLiteralLog) problems.push("the published log surface is not a bare dark literal, so the tokenisation this patch repairs did not start from one");

  if (problems.length > 0) {
    console.error("\nFAILED:");
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log("\nnegative control passed: every patched rule is absent from the published bundle");
} finally {
  await rm(work, { recursive: true, force: true });
}
