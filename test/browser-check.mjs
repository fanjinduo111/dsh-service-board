/**
 * Loads a real DSH web instance in a real Chromium and inspects what the client
 * plugin actually renders.
 *
 * This is the check that every earlier attempt substituted for: reading the served
 * bundle proves the bytes are right, and a jsdom run proves the bundle works against
 * a fake DOM, but neither proves the plugin renders inside the real application.
 * A user reported controls that are present in the bundle and absent on screen, so
 * the question is about the real page.
 *
 * Usage: node test/browser-check.mjs <base-url-with-token>
 */
import puppeteer from "puppeteer-core";
import { writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const url = process.argv[2];
if (url === undefined) {
  console.error("usage: node test/browser-check.mjs <base-url-with-token>");
  process.exit(2);
}

// Which copy is this instance serving?
//
// The first version of this check reported "the patch does not render" when the
// profile's node_modules had been replaced by `pnpm install`, so it was testing the
// published plugin the whole time. The served bundle is fetched first and inspected
// for a marker that only exists in the patch, so the run states its own premise.
const MARKERS = [
  { needle: "dshpb-cfgtoggle", label: "filter control" },
  { needle: "收起服务面板", label: "collapse relabel" },
  { needle: "serviceOwned", label: "service detection" },
];

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const shots = resolve(import.meta.dirname, "../artifacts");
await mkdir(shots, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

const problems = [];
const consoleErrors = [];
const failedRequests = [];

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text().slice(0, 300));
  });
  page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${String(error).slice(0, 300)}`));
  page.on("requestfailed", (request) => failedRequests.push(`${request.url().slice(0, 160)} — ${request.failure()?.errorText}`));

  console.log(`opening        : ${url.replace(/token=[^&]+/, "token=…")}`);

  // Fetch the composed client bundle the page is about to load, and confirm it is
  // the patched build. Without this the check can only say "the buttons are absent",
  // which is true of the published plugin and says nothing about the patch.
  const bundleUrls = [];
  page.on("response", (response) => {
    const target = response.url();
    if (target.includes("/plugins/") && target.includes("client.js")) bundleUrls.push(target);
  });

  await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
  await new Promise((r) => setTimeout(r, 2500));

  // The combo URL serves several plugins in one response, and a shared vendor
  // bundle is fetched too, so every observed bundle is checked rather than only the
  // first one. Checking one produced a false "this is the published plugin" verdict
  // against a page that was demonstrably rendering the patch.
  let servedBundle = "";
  let bundlesInspected = 0;
  const perBundle = [];
  for (const target of bundleUrls.slice(0, 12)) {
    const text = await page.evaluate(async (href) => {
      try {
        const response = await fetch(href);
        return await response.text();
      } catch {
        return "";
      }
    }, target);
    if (text === "") continue;
    bundlesInspected += 1;
    const hits = MARKERS.filter(({ needle }) => text.includes(needle)).length;
    perBundle.push(`${text.length}B/${hits} markers`);
    if (hits > 0) servedBundle = text;
  }
  const markerReport = MARKERS.map(({ needle, label }) => `${label}=${servedBundle.includes(needle)}`);
  console.log(`bundles seen   : ${bundlesInspected} (${perBundle.join(", ")})`);
  console.log(`bundle markers : ${markerReport.join(" ")}`);
  const missingMarkers = MARKERS.filter(({ needle }) => !servedBundle.includes(needle));
  if (bundlesInspected === 0) {
    console.log("bundle markers : no client bundle was observed; markers unverified");
  } else if (servedBundle === "") {
    problems.push(
      "none of the served bundles contains this patch — the profile's "
      + "node_modules/dsh-process-board was probably replaced by pnpm install",
    );
  } else if (missingMarkers.length > 0) {
    problems.push(`the served bundle is missing ${missingMarkers.map((m) => m.label).join(", ")}`);
  }

  // The client bundle registers a sidebar row. Wait for it rather than assuming it.
  const entrySelector = "[data-dsh-processboard-entry]";
  let entryFound = false;
  try {
    await page.waitForSelector(entrySelector, { timeout: 20000 });
    entryFound = true;
  } catch {
    entryFound = false;
  }
  console.log(`sidebar entry  : ${entryFound ? "found" : "MISSING"}`);

  // Whatever plugins are present, report them: a missing entry may mean the client
  // half failed, and the page's own state says which.
  const pluginState = await page.evaluate(() => {
    const out = { entries: [], moduleIds: [], loaderPresent: typeof window.__ModuleLoader__ !== "undefined" };
    for (const el of document.querySelectorAll("[data-dsh-processboard-entry],[data-dsh-servicemonitor-entry],[data-dsh-taskboard-entry]")) {
      out.entries.push(el.getAttribute("data-dsh-processboard-entry") !== null ? "process-board" : el.className);
    }
    try {
      if (window.__ModuleLoader__ !== undefined) out.moduleIds = Object.keys(window.__ModuleLoader__ ?? {});
    } catch { /* ignore */ }
    return out;
  });
  console.log(`plugin state   : ${JSON.stringify(pluginState)}`);

  if (!entryFound) {
    // The panel may still exist if a previous run left it open; check before failing.
    const panelText = await page.evaluate(() => document.querySelector(".dshpb-panel")?.className ?? null);
    problems.push(`the client plugin's sidebar entry is not in the page (panel: ${panelText})`);
  }

  if (entryFound) {
    // Dispatch the click inside the page so the exception the handler throws is
    // captured here rather than becoming an unhandled rejection somewhere else.
    const clickResult = await page.evaluate((selector) => {
      const entry = document.querySelector(selector);
      if (entry === null) return { clicked: false, error: "entry disappeared" };
      try {
        entry.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        return { clicked: true, error: null };
      } catch (error) {
        return { clicked: true, error: String(error && error.stack ? error.stack : error).slice(0, 500) };
      }
    }, entrySelector);
    console.log(`click result   : clicked=${clickResult.clicked} error=${clickResult.error === null ? "none" : clickResult.error.split("\n")[0]}`);
    if (clickResult.error !== null) problems.push(`the click handler threw: ${clickResult.error.split("\n")[0]}`);
    await new Promise((r) => setTimeout(r, 1800));

    const report = await page.evaluate(() => {
      const panel = document.querySelector(".dshpb-panel");
      if (panel === null) return { panel: false };
      const style = getComputedStyle(panel);
      const header = panel.querySelector(".dshpb-head");
      return {
        panel: true,
        open: panel.classList.contains("dshpb-open"),
        display: style.display,
        position: style.position,
        right: style.right,
        filter: panel.querySelector(".dshpb-cfgtoggle") !== null,
        filterVisible: panel.querySelector(".dshpb-cfgtoggle") === null
          ? null
          : getComputedStyle(panel.querySelector(".dshpb-cfgtoggle")).display,
        collapse: panel.querySelector(".dshpb-close:not(.dshpb-log-close)")?.textContent?.trim() ?? null,
        collapseAria: panel.querySelector(".dshpb-close:not(.dshpb-log-close)")?.getAttribute("aria-label") ?? null,
        headerHtml: header === null ? null : header.outerHTML.replace(/\s+/g, " ").slice(0, 400),
        rootInset: getComputedStyle(document.getElementById("root") ?? document.body).paddingRight,
        rowCount: panel.querySelectorAll(".dshpb-table tbody tr").length,
      };
    });

    console.log("panel report   :");
    for (const [key, value] of Object.entries(report)) console.log(`  ${key.padEnd(14)} ${value}`);

    if (!report.panel) problems.push("clicking the entry did not create the panel");
    else {
      if (report.display === "none") problems.push("the panel is display:none after opening");
      if (report.position !== "fixed") problems.push(`the panel is not fixed (${report.position})`);
      if (report.filter !== true) problems.push("the panel header has no filter control");
      if (report.filterVisible === "none") problems.push("the filter control is hidden");
      if (!/收起/.test(report.collapse ?? "")) problems.push(`the collapse control reads ${JSON.stringify(report.collapse)}`);
      if (!(Number.parseFloat(report.rootInset) > 0)) problems.push(`the app did not reserve space (root padding-right ${report.rootInset})`);
    }

    await page.screenshot({ path: resolve(shots, "panel-open.png") });
    console.log(`screenshot     : ${resolve(shots, "panel-open.png")}`);
  } else {
    await page.screenshot({ path: resolve(shots, "no-entry.png") });
    console.log(`screenshot     : ${resolve(shots, "no-entry.png")}`);
  }

} finally {
  // Diagnostic output belongs here so a thrown assertion still shows the cause.
  if (consoleErrors.length > 0) {
    console.log("\nconsole errors :");
    for (const line of consoleErrors.slice(0, 10)) console.log(`  ${line}`);
  }
  if (failedRequests.length > 0) {
    console.log("\nfailed requests:");
    for (const line of failedRequests.slice(0, 10)) console.log(`  ${line}`);
  }
  await browser.close();
}

if (problems.length > 0) {
  console.error("\nFAILED:");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log("\nbrowser check passed");
