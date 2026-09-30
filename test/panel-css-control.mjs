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

  if (problems.length > 0) {
    console.error("\nFAILED:");
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log("\nnegative control passed: every patched rule is absent from the published bundle");
} finally {
  await rm(work, { recursive: true, force: true });
}
