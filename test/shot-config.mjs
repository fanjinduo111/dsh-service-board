/**
 * Screenshots the filter panel with the section open.
 *
 * Usage: node test/shot-config.mjs <base-url-with-token> [out-name]
 */
import puppeteer from "puppeteer-core";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const url = process.argv[2];
const outName = process.argv[3] ?? "config-open.png";
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
await new Promise((r) => setTimeout(r, 1500));

// Open the filter section.
await page.evaluate(() => {
  document.querySelector(".dshpb-cfgtoggle")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
});
await new Promise((r) => setTimeout(r, 700));

const report = await page.evaluate(() => {
  const box = document.querySelector(".dshpb-config");
  if (box === null) return { present: false };
  const rows = [...box.querySelectorAll(".dshpb-cfgrow")].map((row) => {
    const rect = row.getBoundingClientRect();
    return { text: row.textContent.trim().slice(0, 40), height: Math.round(rect.height), top: Math.round(rect.top) };
  });
  return {
    present: true,
    hidden: box.hasAttribute("hidden"),
    height: Math.round(box.getBoundingClientRect().height),
    rows,
    inputCount: box.querySelectorAll("input").length,
  };
});
console.log(JSON.stringify(report, null, 2));

// Crop to the filter section at 2x, so text is legible rather than downscaled.
const clip = await page.evaluate(() => {
  const box = document.querySelector(".dshpb-config");
  const rect = box.getBoundingClientRect();
  return {
    x: Math.max(0, Math.round(rect.x) - 4),
    y: Math.max(0, Math.round(rect.y) - 4),
    width: Math.min(480, Math.round(rect.width) + 8),
    height: Math.min(460, Math.round(rect.height) + 8),
  };
});
await page.screenshot({ path: resolve(shots, outName), clip, captureBeyondViewport: true });
console.log(`screenshot     : ${resolve(shots, outName)}`);
console.log(`clip           : ${JSON.stringify(clip)}`);
await browser.close();
