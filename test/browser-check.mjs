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
import { writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { openSync, closeSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";

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
    if (hits > 0) {
      servedBundle = text;
      // Which bundle carried the plugin matters when one is served twice: a duplicate
      // client registration ("bundle executed twice without invalidate?") is exactly how
      // a packaged install can fail to activate, and the URL says which copy it was.
      console.log(`patch bundle   : ${target.slice(0, 120)} (${text.length}B)`);
    }
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
        // The collapse control existed but was unfindable: bare 12px text with no
        // border or background. Its rendered box and colour are asserted now, because
        // "present in the DOM" was not the same as "visible to a person".
        collapseBox: (() => {
          const node = panel.querySelector(".dshpb-close:not(.dshpb-log-close)");
          if (node === null) return null;
          const rect = node.getBoundingClientRect();
          const nodeStyle = getComputedStyle(node);
          return {
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            top: Math.round(rect.top),
            fontSize: nodeStyle.fontSize,
            background: nodeStyle.backgroundColor,
            color: nodeStyle.color,
            border: `${nodeStyle.borderTopWidth} ${nodeStyle.borderTopStyle}`,
            visible: nodeStyle.display !== "none" && nodeStyle.visibility !== "hidden" && rect.width > 0,
          };
        })(),
        filterBox: (() => {
          const node = panel.querySelector(".dshpb-cfgtoggle");
          if (node === null) return null;
          const rect = node.getBoundingClientRect();
          return { width: Math.round(rect.width), height: Math.round(rect.height), top: Math.round(rect.top) };
        })(),
        // Does a point inside the panel actually hit the panel? The app mounts a
        // fixed root at z-index 1000; the panel's original 901 put it underneath, so
        // the app's 24px left padding covered the first two dozen pixels of every line
        // while getBoundingClientRect still reported the text inside the panel.
        // elementFromPoint is the direct question: what does a click there reach?
        hitTest: (() => {
          const probe = (selector) => {
            const node = panel.querySelector(selector);
            if (node === null) return null;
            const rect = node.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return { skipped: selector };
            const x = Math.round(rect.left) + 2;
            const y = Math.round(rect.top + rect.height / 2);
            const hit = document.elementFromPoint(x, y);
            return {
              selector,
              point: `${x},${y}`,
              hit: hit === null ? null : `${hit.tagName.toLowerCase()}.${String(hit.className).slice(0, 28)}`,
              insidePanel: hit !== null && hit.closest(".dshpb-panel") !== null,
            };
          };
          return [probe(".dshpb-head"), probe(".dshpb-tablewrap")].filter((entry) => entry !== null);
        })(),
      };
    });

    console.log("panel report   :");
    for (const [key, value] of Object.entries(report)) {
      // Nested boxes are printed field by field; the default serialisation showed
      // them as [object Object], which hid the measurements this check exists for.
      if (Array.isArray(value)) {
        console.log(`  ${key.padEnd(14)} ${value.map((entry) => JSON.stringify(entry)).join(" ")}`);
      } else if (value !== null && typeof value === "object") {
        console.log(`  ${key.padEnd(14)} ${Object.entries(value).map(([k, v]) => `${k}=${v}`).join(" ")}`);
      } else {
        console.log(`  ${key.padEnd(14)} ${value}`);
      }
    }

    if (!report.panel) problems.push("clicking the entry did not create the panel");
    else {
      if (report.display === "none") problems.push("the panel is display:none after opening");
      if (report.position !== "fixed") problems.push(`the panel is not fixed (${report.position})`);
      if (report.filter !== true) problems.push("the panel header has no filter control");
      if (report.filterVisible === "none") problems.push("the filter control is hidden");
      if (!/收起/.test(report.collapse ?? "")) problems.push(`the collapse control reads ${JSON.stringify(report.collapse)}`);
      if (!(Number.parseFloat(report.rootInset) > 0)) problems.push(`the app did not reserve space (root padding-right ${report.rootInset})`);

      // A control nobody can find is not a control. These bounds come from the
      // complaint that the buttons were too small to notice or aim at. They are
      // minimums for a usable hit area, not targets: the same report asked for the
      // panel to take less room, so the buttons are deliberately compact.
      const MIN_W = 40;
      const MIN_H = 24;
      const MIN_FONT = 12;
      const box = report.collapseBox;
      if (box === null || box.visible !== true) {
        problems.push("the collapse control is not visible");
      } else {
        if (box.height < MIN_H) problems.push(`the collapse control is only ${box.height}px tall`);
        if (box.width < MIN_W) problems.push(`the collapse control is only ${box.width}px wide`);
        if (Number.parseFloat(box.fontSize) < MIN_FONT) problems.push(`the collapse control's text is ${box.fontSize}`);
        const background = String(box.background);
        const transparent = background === "rgba(0, 0, 0, 0)" || background === "transparent";
        if (transparent) problems.push("the collapse control has no background, so it reads as plain text");
        if (!/solid/.test(box.border)) problems.push(`the collapse control has no border (${box.border})`);
      }
      const filterBox = report.filterBox;
      if (filterBox === null) problems.push("the filter control has no box");
      else {
        if (filterBox.height < MIN_H) problems.push(`the filter control is only ${filterBox.height}px tall`);
        if (filterBox.width < MIN_W) problems.push(`the filter control is only ${filterBox.width}px wide`);
      }

      // The window's own minimise / maximise / close buttons occupy the top-right
      // corner of the strip the panel starts in. Header controls drawn there are
      // present in the DOM and unreachable in practice, which is exactly what a user
      // reported, so their position is asserted and not just their existence.
      const CHROME_H = 46;
      for (const [name, box] of [["collapse", report.collapseBox], ["filter", report.filterBox]]) {
        if (box === null) continue;
        if (box.top < CHROME_H) {
          problems.push(`the ${name} control sits ${box.top}px from the top, inside the window's control strip (${CHROME_H}px)`);
        }
      }

      // And a point inside the panel must actually reach the panel. This is the check
      // that catches the app painting over it: the panel's original z-index of 901 sat
      // below the app's fixed root at 1000, so the app's 24px left padding covered the
      // first two dozen pixels of every line of text.
      const hits = report.hitTest;
      if (!Array.isArray(hits) || hits.length === 0) {
        problems.push("could not test whether the panel receives clicks");
      } else {
        for (const hit of hits) {
          if (hit.skipped !== undefined) {
            problems.push(`${hit.skipped} has no box to test`);
            continue;
          }
          if (hit.insidePanel !== true) {
            problems.push(`a point inside the panel (${hit.point}) is covered: elementFromPoint returned ${hit.hit}`);
          }
        }
      }
    }

    await page.screenshot({ path: resolve(shots, "panel-open.png") });
    console.log(`screenshot     : ${resolve(shots, "panel-open.png")}`);
  } else {
    await page.screenshot({ path: resolve(shots, "no-entry.png") });
    console.log(`screenshot     : ${resolve(shots, "no-entry.png")}`);
  }

  // --- the composer keeps its caret after the panel is used ----------------------
  //
  // The reported defect: 「我把页面关闭之后，dsh的输入框老是没有光标了，必须重新关闭打开一个」. The
  // panel used to ask its questions with window.confirm / window.alert, which in the
  // desktop application are native modals owned by the window: keyboard focus went back
  // to the window rather than to the composer. Asking inside the panel is the fix, and
  // this measures the real page: the composer takes the caret, still takes it after the
  // panel is collapsed, and typing reaches it.
  {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    // The profile's own intro modal covers the composer while it is up.
    const dismissed = await page.evaluate(() => {
      const dialog = document.querySelector('div[class*="_dialog_"]');
      if (dialog === null) return null;
      const button = [...dialog.querySelectorAll("button")].find((b) => /继续|知道了|确定|开始/.test(b.textContent));
      if (button === undefined) return null;
      const text = button.textContent.trim();
      button.click();
      return text;
    });
    if (dismissed !== null) console.log(`intro modal    : dismissed with "${dismissed}"`);
    await wait(700);

    /** Click the composer and type one character, then take it back. */
    const typeIntoComposer = async (label) => {
      const point = await page.evaluate(() => {
        const node = document.querySelector('[role="textbox"][contenteditable="true"]');
        if (node === null) return null;
        const rect = node.getBoundingClientRect();
        return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
      });
      if (point === null) return { available: false };
      const read = () => page.evaluate(() => ({
        text: document.querySelector('[role="textbox"][contenteditable="true"]')?.textContent ?? "",
        focused: document.activeElement !== null && document.activeElement.closest('[role="textbox"]') !== null,
      }));
      await page.mouse.click(point.x, point.y);
      await wait(200);
      const before = await read();
      await page.keyboard.type("z");
      await wait(250);
      const after = await read();
      if (after.text.length > before.text.length) await page.keyboard.press("Backspace");
      await wait(200);
      const restored = await read();
      const result = { available: true, focused: after.focused, typed: after.text.length > before.text.length, restored: restored.text.length === before.text.length };
      console.log(`  ${label}: caret=${result.focused} typed=${result.typed} restored=${result.restored}`);
      return result;
    };

    const baseline = await typeIntoComposer("benchmark, panel untouched");
    if (!baseline.available) {
      problems.push("no composer ([role=textbox]) is on the page, so the caret cannot be checked");
    }
    // The panel is open from the checks above; collapse it the way the user does and
    // type again. This is the reported sequence, in order.
    await page.evaluate(() => document.querySelector(".dshpb-close:not(.dshpb-log-close)")?.click());
    await wait(600);
    const afterCollapse = await typeIntoComposer("composer after 收起");
    if (afterCollapse.available && (!afterCollapse.focused || !afterCollapse.typed)) {
      problems.push("the composer does not take the caret after the panel is collapsed (the reported missing caret)");
    }
    if (baseline.available && (!afterCollapse.focused || !afterCollapse.typed)) {
      problems.push("the panel changed whether the composer accepts typing");
    }
    // Leave the page as it was found, so a user watching the instance sees no residue.
    await page.evaluate(() => {
      const node = document.querySelector('[role="textbox"][contenteditable="true"]');
      if (node !== null && node.textContent === "") node.blur();
    });
  }

  // --- the log band survives a restart, on a real service ------------------------
  //
  // Reproduces 「我重启之后显示不可用」 end to end: watch a real service's log, restart it
  // from the panel, and the log must still be readable afterwards. The service is a
  // real child process with a real log file, so the scanner, /kill, /start and /log all
  // take part. The panel's restart also has to be confirmed inside the panel, which is
  // what replaced the native dialog.
  {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const work = await mkdtemp(join(tmpdir(), "pb-browser-"));
    const fixturePort = 37699;
    const fixtureLog = join(work, "fixture.log");
    const fixtureScript = join(work, "fixture.js");
    await writeFile(
      fixtureScript,
      'const http=require("http");let n=0;'
      + `http.createServer((q,r)=>r.end("ok")).listen(${fixturePort},"127.0.0.1",()=>console.log("["+new Date().toISOString()+"] fixture listening"));`
      + 'setInterval(()=>console.log("["+new Date().toISOString()+"] tick "+(++n)),700);',
      "utf8",
    );
    const out = openSync(fixtureLog, "a");
    let fixture = null;
    try {
      fixture = spawn(process.execPath, [fixtureScript, String(fixturePort)], {
        detached: true,
        stdio: ["ignore", out, out],
        windowsHide: true,
        env: { ...process.env, DSH_PB_LOG: fixtureLog },
      });
    } finally { closeSync(out); }
    fixture.unref();
    console.log(`\nfixture        : pid ${fixture.pid} on 127.0.0.1:${fixturePort}`);
    await wait(2000);

    /** The panel's row for the fixture, if the scan has shown it yet. */
    const findRow = () => page.evaluate((port) => {
      const row = [...document.querySelectorAll(".dshpb-table tbody tr")]
        .find((tr) => tr.textContent.includes(String(port)));
      if (row === undefined) return null;
      return { pid: Number(row.dataset.pid), buttons: [...row.querySelectorAll("button")].map((b) => b.textContent.trim()) };
    }, fixturePort);
    const readBand = () => page.evaluate(() => ({
      title: document.querySelector(".dshpb-log-title")?.textContent ?? "",
      text: (document.querySelector(".dshpb-log-body")?.textContent ?? "").trim(),
    }));
    const clickInRow = (port, label) => page.evaluate((wanted, text) => {
      const row = [...document.querySelectorAll(".dshpb-table tbody tr")]
        .find((tr) => tr.textContent.includes(String(wanted)));
      const button = row === undefined ? null : [...row.querySelectorAll("button")].find((b) => b.textContent.trim() === text);
      if (button === undefined || button === null) return false;
      button.click();
      return true;
    }, port, label);

    // The panel refreshes every eight seconds; open it and wait for the row.
    await page.evaluate(() => document.querySelector("[data-dsh-processboard-entry]")?.click());
    let row = null;
    for (let attempt = 0; attempt < 12 && row === null; attempt += 1) {
      await wait(1000);
      row = await findRow();
    }
    console.log(`fixture row    : ${row === null ? "not found" : `pid ${row.pid} buttons ${JSON.stringify(row.buttons)}`}`);
    if (row === null) {
      problems.push(`the fixture service on port ${fixturePort} never appeared as a row, so the restart path cannot be checked`);
    } else if (!(await clickInRow(fixturePort, "日志"))) {
      problems.push("the fixture row has no 日志 button");
    } else {
      await wait(1800);
      const opened = await readBand();
      console.log(`band opened    : "${opened.title}" watching="${opened.text.slice(0, 40)}"`);
      if (!/fixture listening|tick/.test(opened.text)) problems.push(`the log band shows no output for the fixture: "${opened.text.slice(0, 60)}"`);
      // A screenshot of the band holding real log content, for the README's 效果预览.
      await page.screenshot({ path: resolve(shots, "panel-log.png") });
      console.log(`screenshot     : ${resolve(shots, "panel-log.png")}`);

      if (!(await clickInRow(fixturePort, "重启"))) {
        problems.push("the fixture row has no 重启 button");
      } else {
        await wait(400);
        const asked = await page.evaluate(() => ({
          hidden: document.querySelector(".dshpb-confirmbar")?.hidden ?? true,
          text: (document.querySelector(".dshpb-confirmbar")?.textContent ?? "").trim(),
        }));
        console.log(`restart confirm: hidden=${asked.hidden} "${asked.text.replace(/\s+/g, " ").slice(0, 60)}"`);
        if (asked.hidden) problems.push("clicking 重启 asked for no confirmation");
        const confirmed = await page.evaluate(() => {
          const button = document.querySelector(".dshpb-confirmyes");
          if (button === null) return false;
          button.click();
          return true;
        });
        if (!confirmed) problems.push("the restart confirmation offered no 确认 button");

        // The host answers only once its rescan has seen the new process, so the band
        // should show the new pid and a live log — not 日志不可用：no-log, which is what
        // the report saw.
        let settled = null;
        const deadline = Date.now() + 25_000;
        while (Date.now() < deadline) {
          await wait(1500);
          const band = await readBand();
          const bad = /日志不可用|进程已结束/.test(band.text);
          const fresh = /fixture listening|tick/.test(band.text) && !new RegExp(`pid ${row.pid}\\b`).test(band.title);
          if (bad || fresh) { settled = { band, bad, fresh }; break; }
        }
        console.log(`after restart  : ${settled === null ? "no change seen" : `"${settled.band.title}" bad=${settled.bad} fresh=${settled.fresh}`}`);
        if (settled === null) problems.push("the log band never settled after the restart");
        else if (settled.bad) problems.push(`the band reported the log unavailable after a restart: "${settled.band.text.slice(0, 60)}"`);
        else if (!settled.fresh) problems.push("the band did not follow the service to its new pid after the restart");
      }
    }

    // Clean up: the restarted service is detached and owned by the host, so find it by
    // its port and stop it, then drop the temporary directory.
    const newPid = await page.evaluate(async (port) => {
      const res = await fetch("/api/plugins/process-board/state", { headers: { "sec-fetch-site": "same-origin" } });
      const data = await res.json().catch(() => null);
      return (data?.entries ?? []).find((e) => (e.ports ?? []).includes(port))?.pid ?? null;
    }, fixturePort);
    for (const pid of [row?.pid, newPid]) {
      if (!Number.isInteger(pid)) continue;
      try { process.kill(pid); } catch { /* already gone */ }
    }
    await wait(500);
    await rm(work, { recursive: true, force: true }).catch(() => {});
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
