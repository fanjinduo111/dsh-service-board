/**
 * Verifies the port tag, the column labels and the width handle in a real browser.
 *
 * Usage: node test/verify-resize.mjs <base-url-with-token>
 */
import puppeteer from "puppeteer-core";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const url = process.argv[2];
const shots = resolve(import.meta.dirname, "../artifacts");
await mkdir(shots, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: ["--no-sandbox"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
await new Promise((r) => setTimeout(r, 2500));
await page.waitForSelector("[data-dsh-processboard-entry]", { timeout: 20000 });
await page.evaluate(() => {
  document.querySelector("[data-dsh-processboard-entry]").dispatchEvent(new MouseEvent("click", { bubbles: true }));
});
await new Promise((r) => setTimeout(r, 2500));

const problems = [];

/** What the port tags and the column headers actually render as. */
const look = async () => page.evaluate(() => {
  const tag = document.querySelector(".dshpb-port");
  const anyTag = document.querySelector(".dshpb-port-any");
  const headerCells = [...document.querySelectorAll(".dshpb-table th")].map((th) => {
    const rect = th.getBoundingClientRect();
    return { text: th.textContent.trim(), width: Math.round(rect.width), height: Math.round(rect.height) };
  });
  const panel = document.querySelector(".dshpb-panel");
  const grip = document.querySelector(".dshpb-grip");
  return {
    panelWidth: Math.round(panel.getBoundingClientRect().width),
    rootInset: getComputedStyle(document.getElementById("root")).paddingRight,
    portStyle: tag === null ? null : (() => {
      const s = getComputedStyle(tag);
      return { border: `${s.borderTopWidth} ${s.borderTopStyle}`, background: s.backgroundColor, text: tag.textContent };
    })(),
    anyStyle: anyTag === null ? null : (() => {
      const s = getComputedStyle(anyTag);
      return { border: `${s.borderTopWidth} ${s.borderTopStyle}`, background: s.backgroundColor, text: anyTag.textContent };
    })(),
    headerCells,
    grip: grip === null ? null : (() => {
      const s = getComputedStyle(grip);
      const r = grip.getBoundingClientRect();
      return { display: s.display, cursor: s.cursor, width: Math.round(r.width), ariaValueNow: grip.getAttribute("aria-valuenow") };
    })(),
  };
});

const before = await look();
console.log(`panel width    : ${before.panelWidth}px (root inset ${before.rootInset})`);
console.log(`port tag       : ${JSON.stringify(before.portStyle)}`);
console.log(`wildcard tag   : ${JSON.stringify(before.anyStyle)}`);
console.log(`grip           : ${JSON.stringify(before.grip)}`);
console.log("column headers :");
for (const cell of before.headerCells) console.log(`  ${JSON.stringify(cell.text).padEnd(8)} w=${cell.width} h=${cell.height}`);

// 1. The port tag must not be framed.
for (const [name, style] of [["port tag", before.portStyle], ["wildcard tag", before.anyStyle]]) {
  if (style === null) continue;
  if (!style.border.startsWith("0px")) problems.push(`${name} has a border: ${style.border}`);
}
// 2. Column labels must not wrap into a vertical stack.
for (const cell of before.headerCells) {
  if (cell.height > 40) problems.push(`column header ${JSON.stringify(cell.text)} is ${cell.height}px tall, so it wrapped`);
}
// 3. The width handle must be present and usable.
if (before.grip === null) problems.push("the panel has no width handle");
else {
  if (before.grip.display === "none") problems.push("the width handle is hidden while docked");
  if (before.grip.cursor !== "col-resize") problems.push(`the width handle shows cursor ${before.grip.cursor}`);
}

// 4. Dragging it must widen the panel AND the space reserved for it.
if (before.grip !== null) {
  const gripBox = await page.evaluate(() => {
    const r = document.querySelector(".dshpb-grip").getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  });
  await page.mouse.move(gripBox.x, gripBox.y);
  await page.mouse.down();
  await page.mouse.move(gripBox.x - 220, gripBox.y, { steps: 12 });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 1200));

  const after = await look();
  console.log(`after drag     : panel ${after.panelWidth}px (root inset ${after.rootInset}), grip aria-valuenow=${after.grip?.ariaValueNow}`);
  if (after.panelWidth <= before.panelWidth) {
    problems.push(`dragging the handle left did not widen the panel (${before.panelWidth} -> ${after.panelWidth})`);
  }
  if (Number.parseInt(after.rootInset, 10) !== after.panelWidth) {
    problems.push(`the reserved space (${after.rootInset}) does not match the panel width (${after.panelWidth}px)`);
  }
  // The wider panel must relieve the wrapping.
  const stillWrapped = after.headerCells.filter((cell) => cell.height > 40);
  if (stillWrapped.length > 0) problems.push(`headers still wrapped when wide: ${JSON.stringify(stillWrapped)}`);

  await page.screenshot({ path: resolve(shots, "resized-wide.png"), clip: { x: 1440 - after.panelWidth, y: 0, width: after.panelWidth, height: 420 } });
  console.log(`screenshot     : ${resolve(shots, "resized-wide.png")}`);
}

// 5. The chosen width must survive a reload, which is what proves it was stored.
if (before.grip !== null) {
  const stored = after => after;
  void stored;
  await page.reload({ waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 3000));
  await page.waitForSelector("[data-dsh-processboard-entry]", { timeout: 20000 });
  await page.evaluate(() => {
    document.querySelector("[data-dsh-processboard-entry]").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 1800));
  const reloaded = await look();
  console.log(`after reload   : panel ${reloaded.panelWidth}px`);
  const config = await page.evaluate(async () => {
    const res = await fetch("/api/plugins/process-board/config");
    return (await res.json()).config;
  });
  console.log(`stored config  : width=${config.width}`);
  if (config.width === null) problems.push("the dragged width was not stored");
  else if (Math.abs(reloaded.panelWidth - config.width) > 2) {
    problems.push(`the reloaded panel is ${reloaded.panelWidth}px but the stored width is ${config.width}`);
  }
}

await browser.close();

if (problems.length > 0) {
  console.error("\nFAILED:");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log("\nresize verification passed");
