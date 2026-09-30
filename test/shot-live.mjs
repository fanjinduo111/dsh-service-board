/**
 * Screenshots the panel with the demo service running, through the "仅 Agent 启动"
 * filter, and checks the row the user will be looking at.
 *
 * Usage: node test/shot-live.mjs <base-url-with-token>
 */
import puppeteer from "puppeteer-core";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const url = process.argv[2];
const shots = resolve(import.meta.dirname, "../artifacts");
await mkdir(shots, { recursive: true });
const problems = [];

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

// Give the scan time to produce rows, then switch to the session filter.
await new Promise((r) => setTimeout(r, 9000));
await page.evaluate(() => {
  document.querySelector(".dshpb-cfgtoggle")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
});
await new Promise((r) => setTimeout(r, 600));
const switched = await page.evaluate(async () => {
  const button = document.querySelector('.dshpb-segbtn[data-scope="session"]');
  if (button === null) return false;
  button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  const response = await fetch("/api/plugins/process-board/config");
  return (await response.json()).config.scope;
});
console.log(`filter scope   : ${switched}`);
await new Promise((r) => setTimeout(r, 9000));

const report = await page.evaluate(() => {
  const panel = document.querySelector(".dshpb-panel");
  const rows = [...panel.querySelectorAll(".dshpb-table tbody tr")];
  const services = rows.filter((row) => row.querySelector(".dshpb-svcname") !== null);
  // Which columns are actually rendered, and is the action column inside the panel?
  const headers = [...panel.querySelectorAll(".dshpb-table th")]
    .filter((th) => getComputedStyle(th).display !== "none")
    .map((th) => th.textContent.trim());
  const panelRect = panel.getBoundingClientRect();
  const actionCell = services[0]?.querySelector("td:last-child");
  const actionRect = actionCell?.getBoundingClientRect();
  return {
    panelWidth: Math.round(panelRect.width),
    columnHeaders: headers,
    actionInsidePanel: actionRect === undefined ? null
      : actionRect.right <= panelRect.right + 1 && actionRect.left >= panelRect.left - 1,
    actionRect: actionRect === undefined ? null
      : { left: Math.round(actionRect.left), right: Math.round(actionRect.right) },
    panelRight: Math.round(panelRect.right),
    rowCount: rows.length,
    services: services.map((row) => ({
      name: row.querySelector(".dshpb-svcname")?.textContent ?? "?",
      ports: [...row.querySelectorAll(".dshpb-port")].map((tag) => tag.textContent),
      state: row.querySelector('[class^="dshpb-st-"]')?.textContent ?? "?",
      buttons: [...row.querySelectorAll(".dshpb-btn")].map((button) => button.textContent),
    })),
  };
});
console.log(`panel width    : ${report.panelWidth}px`);
console.log(`columns shown  : ${JSON.stringify(report.columnHeaders)}`);
console.log(`action cell    : ${JSON.stringify(report.actionRect)} panel right edge ${report.panelRight} -> inside=${report.actionInsidePanel}`);
console.log(`rows           : ${report.rowCount} (${report.services.length} services)`);
for (const service of report.services) {
  console.log(`  ${service.name.padEnd(16)} ${service.state.padEnd(6)} ${service.ports.join(" ").padEnd(34)} [${service.buttons.join(" ")}]`);
}

// The action column is the reason the panel exists; it must never be pushed out of it.
if (report.actionInsidePanel !== true) {
  problems.push(`the action column is outside the panel: ${JSON.stringify(report.actionRect)} vs right edge ${report.panelRight}`);
}
if (report.rowCount === 0) problems.push("the panel shows no rows");

// Collapse the filter section and re-shoot, so the picture shows the service rows
// rather than the settings that produced them.
await page.evaluate(() => {
  document.querySelector(".dshpb-cfgtoggle")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
});
await new Promise((r) => setTimeout(r, 600));

const demo = report.services.find((service) => service.ports.some((port) => port.includes("37542")));
if (demo === undefined) problems.push("the demo service is not shown under the session filter");
else {
  if (!demo.ports.includes("127.0.0.1:37542")) problems.push(`port 37542 is not shown with its address: ${JSON.stringify(demo.ports)}`);
  if (!demo.ports.includes("127.0.0.1:37543")) problems.push(`the second port is missing: ${JSON.stringify(demo.ports)}`);
  if (!demo.buttons.includes("停止")) problems.push("the running service has no stop button");
  if (!demo.buttons.includes("重启")) problems.push("a service with a readable command line should offer 重启");
  if (!demo.buttons.includes("日志")) problems.push("a service with a log marker should offer 日志");
}
// The Windows service must not appear under the session filter — that is the point of it.
if (report.services.some((service) => service.name.includes("mysqld"))) {
  problems.push("mysqld is shown under the session filter, which should exclude it");
}

// Full viewport, not a clip: clipping the right-anchored panel repeatedly pushed the
// action column out of the picture, and the whole frame is the honest view anyway.
await page.screenshot({ path: resolve(shots, "live-service.png") });
console.log(`screenshot     : ${resolve(shots, "live-service.png")} (full viewport)`);
await browser.close();

if (problems.length > 0) {
  console.error("\nFAILED:");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log("\nlive panel check passed");
