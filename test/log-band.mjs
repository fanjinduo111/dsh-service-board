/**
 * Measures the log area in a real browser: it must be a band UNDER the list, as
 * wide as the panel, and bounded so the panel never grows past the window.
 *
 * Why this file exists: the log was a second *column* beside the service list, and
 * `panel-css.test.mjs` asserted the rule that was supposed to make it take the row
 * (`flex:1 1 100%`) while the user still saw two columns squeezed side by side — a
 * flex-basis is not a width, and the list kept its content width. A stylesheet test
 * cannot tell the difference; only a layout engine can. So this drives the real
 * client bundle in real Chromium with a stubbed API and measures rectangles.
 *
 * It also catches the failure a stylesheet test cannot see at all: the panel is a
 * fixed, full-height element, so anything that stretches its content past the
 * window is not merely ugly, it is unreachable — no scrollbar can reach it.
 *
 * No DSH instance is needed: the bundle registers with `window.__ModuleLoader__`,
 * which this page provides, and every request it makes is answered by a stub.
 *
 * It also has to carry the application's theme. The sheet reaches most of its colours
 * through var(--dsw-alias-…), and a page with none of those defined exercises every
 * fallback instead: that is how a log whose background was an invented token name came
 * out readable here (dark fallback, light fallback text) while the user saw near-black
 * on near-black in the light theme. The style block below is the application's own
 * theme, resolved through its var() chain, and the last section measures contrast in
 * both themes rather than assuming either one.
 *
 * Usage: node test/log-band.mjs [client-file]
 *
 * Where Chrome cannot be spawned from here (a sandbox that forbids piped stdio
 * fails the launch with `spawn EPERM`), start it yourself and point this at it:
 *   chrome --headless=new --remote-debugging-port=9333 --user-data-dir=<tmp>
 *   PB_CHROME_WS=http://127.0.0.1:9333 node test/log-band.mjs
 */
import puppeteer from "puppeteer-core";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const clientFile = resolve(process.argv[2] ?? resolve(import.meta.dirname, "../src/client/index.js"));
const source = await readFile(clientFile, "utf8");
const shots = resolve(import.meta.dirname, "../artifacts");
await mkdir(shots, { recursive: true });

const problems = [];
/** How many service rows the stub state returns: enough that the list itself must scroll. */
const SERVICE_COUNT = 24;

const chromeUrl = process.env.PB_CHROME_WS ?? null;
const browser = chromeUrl === null
  ? await puppeteer.launch({
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
    args: ["--no-sandbox"],
  })
  : await puppeteer.connect({ browserURL: chromeUrl, defaultViewport: null });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
page.on("pageerror", (error) => problems.push(`the page threw: ${error.message}`));

// A sidebar shaped like the real one plus the app root the dock insets, and a stub
// API: /state lists the services, /log returns 400 long lines for whichever pid is
// asked for, /config reports the defaults.
await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
  /* The application's own theme, taken from the installed sheet
     (resources/app.asar -> lib/welcome/welcome.css, whose light block is "body" and
     whose dark block is "body[data-ds-dark-theme]") and resolved there through each
     alias's var() chain down to the literal colour. Only the tokens this plugin names
     are listed. Without this block every var() below falls back to the dark literals
     the sheet was written with, so the harness would be testing the one theme where the
     reported black-on-black log cannot happen. */
  body {
    --dsw-alias-bg-base: rgb(255, 255, 255);
    --dsw-alias-border-l1: rgba(0, 0, 0, .04);
    --dsw-alias-border-l2: rgba(0, 0, 0, .1);
    --dsw-alias-border-l3: rgba(0, 0, 0, .12);
    --dsw-alias-brand-primary: rgb(15, 17, 21);
    --dsw-alias-brand-text: rgb(15, 17, 21);
    --dsw-alias-interactive-bg-hover: rgba(38, 49, 72, .06);
    --dsw-alias-interactive-bg-hover-accent: rgba(38, 49, 72, .14);
    --dsw-alias-label-caption: rgb(173, 178, 184);
    --dsw-alias-label-dimmed: rgb(225, 229, 238);
    --dsw-alias-label-primary: rgb(15, 17, 21);
    --dsw-alias-label-secondary: rgb(97, 102, 107);
    --dsw-alias-label-tertiary: rgb(129, 133, 140);
    --dsw-alias-markdown-code-block: rgb(249, 250, 251);
  }
  body[data-ds-dark-theme] {
    --dsw-alias-bg-base: rgb(21, 21, 23);
    --dsw-alias-border-l1: rgba(255, 255, 255, .06);
    --dsw-alias-border-l2: rgba(255, 255, 255, .12);
    --dsw-alias-border-l3: rgba(255, 255, 255, .16);
    --dsw-alias-brand-primary: rgb(249, 250, 251);
    --dsw-alias-brand-text: rgb(249, 250, 251);
    --dsw-alias-interactive-bg-hover: rgba(255, 255, 255, .08);
    --dsw-alias-interactive-bg-hover-accent: rgba(255, 255, 255, .24);
    --dsw-alias-label-caption: rgb(129, 133, 140);
    --dsw-alias-label-dimmed: rgb(67, 69, 74);
    --dsw-alias-label-primary: rgb(249, 250, 251);
    --dsw-alias-label-secondary: rgb(207, 211, 214);
    --dsw-alias-label-tertiary: rgb(173, 178, 184);
    --dsw-alias-markdown-code-block: rgb(27, 27, 28);
  }
</style></head><body>
  <div id="root">
    <div data-pane="sidebar"><div class="logoRow"><button class="newSessionButton">新会话</button></div></div>
    <main>conversation</main>
  </div>
  <script>
    window.__ModuleLoader__ = { load(value) { window.__registration = value } };
    const services = Array.from({ length: ${SERVICE_COUNT} }, (_, index) => ({
      pid: 4100 + index,
      name: 'svc-' + (index + 1) + '.exe',
      cmd: '"C:\\\\Program Files\\\\nodejs\\\\node.exe" D:\\\\work\\\\svc-' + (index + 1) + '.js',
      ports: [5000 + index],
      binds: [{ addr: '127.0.0.1', port: 5000 + index }],
      state: 'running',
      http: 200,
      session: 'session-aaaa1111-2222',
      sessionTitle: '构建服务',
      logPath: 'C:\\\\tmp\\\\svc-' + (index + 1) + '.log',
      // FILETIME seconds, as the scanner reports them: each service started an hour
      // later than the one above it, so svc-1 reads 1时0分 and svc-2 reads 2时0分.
      created: Math.floor(Date.now() / 1000) + 11644473600 - (index + 1) * 3600,
      inTree: true,
    }));
    window.fetch = async (url, options) => {
      const path = String(url);
      const body = (value) => ({ ok: true, status: 200, json: async () => value });
      if (path.includes('/state')) return body({ ok: true, at: Date.now(), entries: services });
      if (path.includes('/log')) {
        const pid = JSON.parse(options.body).pid;
        // Long lines on purpose: they are what made the side-by-side row too wide.
        return body({ ok: true, lines: Array.from({ length: 400 }, (_, index) =>
          '[pid ' + pid + '] line ' + index + ' ' + 'detail '.repeat(20)) });
      }
      if (path.includes('/config')) return body({ ok: true, config: { scope: 'all', ports: [], hide: [] }, path: 'C:/tmp/config.json' });
      return { ok: false, status: 404, json: async () => ({ ok: false }) };
    };
  </script>
</body></html>`, { waitUntil: "load" });

await page.addScriptTag({ content: source });
await page.evaluate(() => {
  const exports = window.__registration.factory((name) => { throw new Error(`unexpected require ${name}`); });
  exports.apply({ effect: (execute) => { void execute; return () => {}; } });
  document.querySelector("[data-dsh-processboard-entry]").dispatchEvent(new MouseEvent("click", { bubbles: true }));
});
await new Promise((r) => setTimeout(r, 600));

/** Click the 日志 button of the nth service row (1-based) and let its request land. */
async function openLogOf(index) {
  await page.evaluate((wanted) => {
    const row = [...document.querySelectorAll(".dshpb-table tbody tr")]
      .filter((tr) => tr.querySelector(".dshpb-svcname") !== null)[wanted - 1];
    [...row.querySelectorAll(".dshpb-btn")].find((button) => button.textContent === "日志").click();
  }, index);
  await new Promise((r) => setTimeout(r, 400));
}

/** Everything measured, in one round trip: rectangles, computed styles, scroll state. */
const geometry = () => page.evaluate(() => {
  const box = (element) => {
    if (element === null || element === undefined) return null;
    const rect = element.getBoundingClientRect();
    return {
      top: Math.round(rect.top), bottom: Math.round(rect.bottom),
      left: Math.round(rect.left), right: Math.round(rect.right),
      width: Math.round(rect.width), height: Math.round(rect.height),
    };
  };
  const panel = document.querySelector(".dshpb-panel");
  const dialog = panel.querySelector(".dshpb-dialog");
  const layout = panel.querySelector(".dshpb-layout");
  const list = panel.querySelector(".dshpb-list-col");
  const log = panel.querySelector(".dshpb-log-col");
  const logBody = panel.querySelector(".dshpb-log-body");
  const table = panel.querySelector(".dshpb-table");
  const highlighted = [...panel.querySelectorAll(".dshpb-table tbody tr.dshpb-logging")];
  const serviceRows = [...panel.querySelectorAll(".dshpb-table tbody tr")]
    .filter((tr) => tr.querySelector(".dshpb-svcname") !== null);
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    docked: document.body.classList.contains("dshpb-docked"),
    logOn: log.classList.contains("dshpb-log-on"),
    panel: box(panel), dialog: box(dialog), layout: box(layout),
    list: box(list), log: box(log), logBody: box(logBody), table: box(table),
    // The state cell carries the age under the state word, so every service row has one
    // and the action column still has to fit inside the panel beside it.
    uptimes: serviceRows.map((tr) => tr.querySelector(".dshpb-uptime")?.textContent ?? null),
    uptimeTitles: serviceRows.map((tr) => tr.querySelector(".dshpb-uptime")?.getAttribute("title") ?? null),
    firstRowuptime: serviceRows[0]?.querySelector(".dshpb-uptime")?.textContent ?? null,
    actions: box(serviceRows[0]?.querySelector("td:last-child")),
    layoutDirection: getComputedStyle(layout).flexDirection,
    logTitle: panel.querySelector(".dshpb-log-title").textContent,
    logPath: panel.querySelector(".dshpb-log-path").textContent,
    logLines: logBody.querySelectorAll("div").length,
    logScrolls: logBody.scrollHeight > logBody.clientHeight + 4,
    logInnerHeight: Math.round(logBody.clientHeight),
    listScrolls: list.scrollHeight > list.clientHeight + 4,
    logOpenError: /不可用|加载失败/.test(logBody.textContent) ? logBody.textContent.slice(0, 80) : null,
    highlightedRows: highlighted.length,
    highlightedText: highlighted.map((tr) => tr.querySelector(".dshpb-svcname")?.textContent ?? "?"),
    documentScrollHeight: document.documentElement.scrollHeight,
  };
});

await openLogOf(1);
const first = await geometry();
console.log(`docked         : ${first.docked} (layout flex-direction: ${first.layoutDirection})`);
console.log(`panel          : ${first.panel.width}x${first.panel.height} at ${first.panel.left}..${first.panel.right}`);
console.log(`list           : ${first.list.width}x${first.list.height} at ${first.list.top}..${first.list.bottom}`);
console.log(`log            : ${first.log.width}x${first.log.height} at ${first.log.top}..${first.log.bottom}`);
console.log(`log body       : ${first.logBody.width}x${first.logInnerHeight} (scrolling=${first.logScrolls})`);
console.log(`log title      : ${first.logTitle} <- ${first.logPath}`);
console.log(`log lines      : ${first.logLines}, error shown: ${first.logOpenError ?? "no"}`);
console.log(`layout height  : ${first.layout.height} vs dialog ${first.dialog.height} (viewport ${first.viewport.height})`);
console.log(`uptimes        : ${first.uptimes.length} rows, first = ${first.firstRowuptime} (${first.uptimeTitles[0]})`);

// The age of each process is a second line inside the state cell. Every service row must
// carry one, it must read as an age rather than a placeholder, and the line must not push
// the action column out of the panel: this viewport is 460px of panel, which is the width
// a user actually gets, and the buttons are the reason the panel is open.
if (first.uptimes.some((label) => label === null)) {
  problems.push(`${first.uptimes.filter((label) => label === null).length} service rows show no uptime`);
}
if (!first.uptimes.every((label) => /^\d+[秒分时天]/.test(label ?? ""))) {
  problems.push(`an uptime does not read as an age: ${JSON.stringify(first.uptimes.slice(0, 4))}`);
}
if (!/^启动于 \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}，已运行 /.test(first.uptimeTitles[0] ?? "")) {
  problems.push(`the uptime carries no absolute start time in its title: ${JSON.stringify(first.uptimeTitles[0])}`);
}
if (first.actions === null || first.actions.right > first.panel.right + 1) {
  problems.push(`the action column ends at ${first.actions?.right} outside the panel edge at ${first.panel.right}`);
}

// 1. The log is a band under the list, not a column beside it.
if (first.log === null || first.list === null) problems.push("the panel has no list column or no log column");
else {
  if (!(first.log.top >= first.list.bottom - 1)) {
    problems.push(`the log is not under the list: log top ${first.log.top} vs list bottom ${first.list.bottom}`);
  }
  // A band and not a column: it spans the panel rather than sharing the row.
  const widthGap = first.panel.width - first.log.width;
  if (widthGap > 4) {
    problems.push(`the log band is ${first.log.width}px wide inside a ${first.panel.width}px panel, so it still shares the row`);
  }
  // The list keeps the full width, which is the point of moving the log down.
  const listGap = first.panel.width - first.list.width;
  if (listGap > 4) {
    problems.push(`the list is ${first.list.width}px wide inside a ${first.panel.width}px panel: the log is still taking its width`);
  }
  if (first.list.height < 120) {
    problems.push(`the list is squeezed to ${first.list.height}px while the log is open`);
  }
  if (first.log.height < 120) problems.push(`the log band is only ${first.log.height}px tall`);
  if (first.log.height > first.panel.height * 0.75) {
    problems.push(`the log band takes ${first.log.height}px of a ${first.panel.height}px panel, which is most of it`);
  }
}

// 2. Nothing may grow past the panel: a fixed panel's overflow is unreachable.
if (first.dialog === null || first.layout === null) problems.push("the panel has no dialog or no layout");
else {
  if (first.layout.height > first.dialog.height + 1) {
    problems.push(`the layout is ${first.layout.height}px tall inside a ${first.dialog.height}px dialog: the content stretches the panel`);
  }
  if (first.dialog.bottom > first.viewport.height + 1) {
    problems.push(`the dialog ends at ${first.dialog.bottom}, past the ${first.viewport.height}px viewport`);
  }
  if (first.documentScrollHeight > first.viewport.height + 1) {
    problems.push(`the page scrolls to ${first.documentScrollHeight}px, so the panel's content left the window`);
  }
}

// 3. The log itself scrolls, so all 400 lines are reachable.
if (!first.logOn) problems.push("clicking 日志 did not open the log");
if (first.logOpenError !== null) problems.push(`the log view reports an error: ${first.logOpenError}`);
if (first.logLines < 400) problems.push(`only ${first.logLines} log lines rendered, expected 400`);
if (!first.logScrolls) problems.push("the log body does not scroll, so the older lines are unreachable");
if (!first.listScrolls) problems.push(`the list does not scroll with ${SERVICE_COUNT} services, so rows are unreachable`);

// 4. Opening another service's log switches the band to that service.
await openLogOf(2);
const second = await geometry();
console.log(`switched to    : ${second.logTitle} <- ${second.logPath}`);
if (!/svc-2\.exe/.test(second.logTitle) || !/svc-2\.log$/.test(second.logPath)) {
  problems.push(`the log did not switch to the second service: ${second.logTitle} <- ${second.logPath}`);
}
if (!/pid 4101/.test(second.logTitle)) problems.push(`the switched log names the wrong pid: ${second.logTitle}`);
if (second.highlightedRows !== 1) {
  problems.push(`${second.highlightedRows} rows are marked as the log's source, expected exactly 1`);
} else if (!/svc-2\.exe/.test(second.highlightedText[0])) {
  problems.push(`the wrong row is marked as the log's source: ${second.highlightedText[0]}`);
}

// 5. The mark must survive the 8s auto-refresh, which rebuilds every row.
await new Promise((r) => setTimeout(r, 9000));
const afterRefresh = await geometry();
console.log(`after refresh  : ${afterRefresh.highlightedRows} highlighted row(s), log still on ${afterRefresh.logTitle}`);
if (afterRefresh.highlightedRows !== 1) {
  problems.push(`the auto-refresh dropped the source-row mark (${afterRefresh.highlightedRows} rows marked)`);
}
// The age is derived on every render, so it has to be there after a rebuild too — and it
// has to be the age of the process in that row, not the first row's age repeated.
if (afterRefresh.firstRowuptime !== "1时0分") {
  problems.push(`the first row's uptime reads ${JSON.stringify(afterRefresh.firstRowuptime)} after the refresh, expected 1时0分`);
}
if (new Set(afterRefresh.uptimes).size < 2) {
  problems.push(`every row shows the same age (${JSON.stringify(afterRefresh.uptimes.slice(0, 3))}), so it is not the row's own process`);
}
if (!afterRefresh.logOn || !/svc-2\.exe/.test(afterRefresh.logTitle)) {
  problems.push("the auto-refresh closed or re-targeted the log");
}

await page.screenshot({ path: resolve(shots, "log-band.png") });
console.log(`screenshot     : ${resolve(shots, "log-band.png")} (full viewport)`);

// 6. 日志全屏 must still hand the band the whole panel. The band's height is stated as
//    a clamp now, and a clamp is exactly the kind of declaration that silently wins over
//    a later rule: if it did, the button would look inert on a tall panel.
await page.evaluate(() => document.querySelector(".dshpb-log-maxbtn").click());
await new Promise((r) => setTimeout(r, 300));
const maximised = await page.evaluate(() => {
  const panel = document.querySelector(".dshpb-panel");
  const list = panel.querySelector(".dshpb-list-col");
  const log = panel.querySelector(".dshpb-log-col");
  const layout = panel.querySelector(".dshpb-layout");
  return {
    listDisplay: getComputedStyle(list).display,
    logHeight: Math.round(log.getBoundingClientRect().height),
    logWidth: Math.round(log.getBoundingClientRect().width),
    layoutHeight: Math.round(layout.getBoundingClientRect().height),
  };
});
console.log(`日志全屏       : log ${maximised.logWidth}x${maximised.logHeight} in a ${maximised.layoutHeight}px layout (list display ${maximised.listDisplay})`);
if (maximised.listDisplay !== "none") problems.push(`日志全屏 did not hide the list (display: ${maximised.listDisplay})`);
if (maximised.logHeight < maximised.layoutHeight - 4) {
  problems.push(`日志全屏 left the band at ${maximised.logHeight}px of a ${maximised.layoutHeight}px layout: the clamp was not released`);
}

// 7. The log has to be readable in the theme the user is in, which is a contrast ratio
//    and not an opinion. The report was "the log is all pure black, I cannot make
//    anything out": the background came from a token the application does not define, so
//    it kept the dark literal, while the text colour followed the theme into near-black.
//    Both themes are measured, because the failure was invisible in one of them.
const luminance = (colour) => {
  const channel = (value) => {
    const scaled = value / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(colour[0]) + 0.7152 * channel(colour[1]) + 0.0722 * channel(colour[2]);
};
const parseColour = (value) => {
  const match = /rgba?\(([^)]+)\)/.exec(value ?? "");
  if (match === null) return null;
  const parts = match[1].split(/[,\s/]+/).filter((part) => part !== "").map(Number);
  return parts.length >= 3 ? [parts[0], parts[1], parts[2], parts[3] ?? 1] : null;
};
/** A translucent colour as painted over an opaque one, so a tinted row is measured. */
const over = (front, back) => [
  front[0] * front[3] + back[0] * (1 - front[3]),
  front[1] * front[3] + back[1] * (1 - front[3]),
  front[2] * front[3] + back[2] * (1 - front[3]),
];
const contrast = (foreground, background) => {
  const [high, low] = [luminance(foreground), luminance(background)].sort((left, right) => right - left);
  return (high + 0.05) / (low + 0.05);
};

// The previous section left the band fullscreen; colours do not depend on geometry, but
// the screenshots below should show the band as it is normally seen.
await page.evaluate(() => document.querySelector(".dshpb-log-maxbtn").click());
await new Promise((r) => setTimeout(r, 300));

const sampleColours = () => page.evaluate(() => {
  const panel = document.querySelector(".dshpb-panel");
  const logBody = panel.querySelector(".dshpb-log-body");
  const line = [...logBody.querySelectorAll("div")].find((entry) => entry.querySelector(".dshpb-log-time") !== null);
  const groupCell = panel.querySelector(".dshpb-grouprow td");
  const style = (node) => (node === null || node === undefined ? null : getComputedStyle(node).color);
  const background = (node) => (node === null || node === undefined ? null : getComputedStyle(node).backgroundColor);
  return {
    dark: document.body.hasAttribute("data-ds-dark-theme"),
    logBackground: background(logBody),
    logText: style(line ?? logBody),
    timestamp: style(line?.querySelector(".dshpb-log-time")),
    groupLabel: style(groupCell),
    groupCellBackground: background(groupCell),
    panelBackground: background(panel.querySelector(".dshpb-dialog")),
  };
});

for (const theme of ["light", "dark"]) {
  await page.evaluate((wanted) => {
    if (wanted === "dark") document.body.setAttribute("data-ds-dark-theme", "");
    else document.body.removeAttribute("data-ds-dark-theme");
  }, theme);
  await new Promise((r) => setTimeout(r, 200));

  const sample = await sampleColours();
  const logBackground = parseColour(sample.logBackground);
  const logText = parseColour(sample.logText);
  const timestamp = parseColour(sample.timestamp);
  const groupLabel = parseColour(sample.groupLabel);
  const groupBackground = parseColour(sample.groupCellBackground);
  const panelBackground = parseColour(sample.panelBackground);

  const textRatio = logText === null || logBackground === null ? 0 : contrast(logText, logBackground);
  const timeRatio = timestamp === null || logBackground === null ? 0 : contrast(timestamp, logBackground);
  const groupRatio = groupLabel === null || groupBackground === null || panelBackground === null
    ? 0
    : contrast(groupLabel, over(groupBackground, panelBackground));
  // What the missing token painted: the light theme's own text colour on #16181f.
  const brokenRatio = logText === null ? 0 : contrast(logText, [22, 24, 31]);

  console.log(`${theme} theme   : log text ${sample.logText} on ${sample.logBackground} = ${textRatio.toFixed(2)}:1`);
  console.log(`             timestamp ${sample.timestamp} = ${timeRatio.toFixed(2)}:1`);
  console.log(`             group label ${sample.groupLabel} on ${sample.groupCellBackground} = ${groupRatio.toFixed(2)}:1`);
  console.log(`             (the same text on the missing token's #16181f fallback: ${brokenRatio.toFixed(2)}:1)`);

  if (sample.dark !== (theme === "dark")) problems.push(`the ${theme} pass did not put the page in the ${theme} theme`);
  if (textRatio < 4.5) problems.push(`the log text is only ${textRatio.toFixed(2)}:1 on its own background in the ${theme} theme`);
  if (timeRatio < 3) problems.push(`the log timestamp is only ${timeRatio.toFixed(2)}:1 in the ${theme} theme, so the dimming went too far`);
  if (groupRatio < 4.5) problems.push(`the group label is only ${groupRatio.toFixed(2)}:1 on the panel in the ${theme} theme`);

  const shot = resolve(shots, theme === "light" ? "log-band-light.png" : "log-band.png");
  await page.screenshot({ path: shot });
  console.log(`             screenshot: ${shot}`);
}

await browser.close();

if (problems.length > 0) {
  console.error("\nFAILED:");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log("\nlog band check passed");
