/**
 * Drives the real client bundle in a real DOM.
 *
 * Why this file exists: the panel "did nothing on click" and reading the source
 * could not explain it. Hand-written DOM stubs had already hidden bugs earlier in
 * this work (seven of them), so this uses jsdom — a real DOM implementation — and
 * executes the shipped file unmodified through the loader contract the host uses.
 *
 * What it proves: `apply` mounts the sidebar row, clicking it builds and reveals
 * the panel, the panel is laid out as a right-docked column rather than a centred
 * modal, the mask stays out of the way, and the state request actually fires.
 *
 * Run: node test/client-dom.test.mjs [client-file]
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";

const clientFile = resolve(process.argv[2] ?? resolve(import.meta.dirname, "../src/client/index.js"));
const source = await readFile(clientFile, "utf8");

// A sidebar shaped like the real one: a single control row containing the New
// Session button, inside the column the bundle looks for. `#root` is the real
// app root, and the panel must make it give up the space the panel occupies
// instead of covering it.
const dom = new JSDOM(
  `<!doctype html><html><head></head><body>
     <div id="root">
       <div data-pane="sidebar">
         <div class="logoRow-host">
           <button class="newSessionButton">New Session</button>
         </div>
       </div>
       <main class="conversation">conversation content</main>
     </div>
   </body></html>`,
  { pretendToBeVisual: true, runScripts: "outside-only" },
);
const { window } = dom;
const { document } = window;

// --- the loader contract -----------------------------------------------------

let registration = null;
window.__ModuleLoader__ = {
  load(value) {
    registration = value;
  },
};

const requests = [];
/**
 * What the stub /state answers with. Kept mutable on purpose: a restart is a service
 * coming back under a new pid, and the log band has to follow it, which can only be
 * tested by changing what the next scan reports.
 */
let stateEntries = [
  {
    pid: 7300,
    name: "node.exe",
    cmd: '"C:\\Program Files\\nodejs\\node.exe" D:\\work\\server.js',
    ports: [5399, 5400, 5401],
    // Three shapes of IPv6 bind, because the scanner now reports them and the old
    // renderer got all three wrong: a specific ``[::1]`` address (vite's default
    // `localhost` on a machine like this one binds exactly that), and a
    // v6-only wildcard, which must not be labelled `0.0.0.0` — it is not reachable
    // over IPv4 at all.
    binds: [
      { addr: "127.0.0.1", port: 5399 },
      { addr: "::1", port: 5400 },
      { addr: "::", port: 5401 },
    ],
    // The scanner reports the creation time as FILETIME seconds (since 1601),
    // which is what the PowerShell probe reads. Exactly two hours ago, so the
    // age the row must show is "2时0分" and not something that has to be guessed.
    created: Math.floor(Date.now() / 1000) + 11644473600 - 7200,
    state: "running",
    http: 200,
    session: "session-abcdef12-3456",
    sessionTitle: "构建服务",
    logPath: "C:\\tmp\\server.log",
    inTree: true,
  },
  {
    // A Windows service: the SCM owns it and restarts it if killed, so the
    // panel must not offer a stop that would look broken.
    pid: 7301,
    name: "mysqld.exe",
    cmd: "",
    ports: [3306],
    // Dual-stack: Windows binds `[::]:3306` alongside `0.0.0.0:3306`, so the port column
    // gets two wildcard binds for one socket pair. They must collapse into one tag —
    // two identical `0.0.0.0:3306` labels look like a rendering bug.
    binds: [
      { addr: "0.0.0.0", port: 3306 },
      { addr: "::", port: 3306 },
    ],
    state: "running",
    http: 0,
    session: "unknown",
    sessionTitle: null,
    logPath: "C:\\tmp\\mysql.log",
    inTree: false,
    serviceOwned: true,
    // No creation time at all: a row that was recalled from the registry rather
    // than scanned has nothing to report, and the panel must not invent "0秒".
  },
];

/** Serve the plugin's API without a network. */
window.fetch = async (url, options) => {
  requests.push({ url: String(url), options });
  if (String(url).includes("/state")) {
    return { ok: true, status: 200, json: async () => ({ ok: true, at: Date.now(), entries: stateEntries }) };
  }
  if (String(url).includes("/log")) {
    // Like the host: a pid the latest scan does not know about has no log to read.
    const asked = Number(JSON.parse(options?.body ?? "{}").pid);
    if (!stateEntries.some((entry) => entry.pid === asked)) {
      return { ok: false, status: 404, json: async () => ({ ok: false, error: "no-log" }) };
    }
    return {
      ok: true,
      status: 200,
      // Two shapes on purpose: lines with a leading timestamp (which the client splits
      // out so it can be dimmed) and one without, which must keep every character.
      json: async () => ({ ok: true, lines: ["[2026-01-01 00:00:01] line one", "[2026-01-01 00:00:02] ERROR boom", "WARN careful"] }),
    };
  }
  if (String(url).includes("/kill")) {
    return { ok: true, status: 200, json: async () => ({ ok: true, killed: [JSON.parse(options?.body ?? "{}").pid] }) };
  }
  if (String(url).includes("/start")) {
    return { ok: true, status: 200, json: async () => ({ ok: true, pid: 7400, logFile: "C:\\tmp\\server.log" }) };
  }
  if (String(url).includes("/config")) {
    return { ok: true, status: 200, json: async () => ({ ok: true, config: { scope: "all", ports: [], hide: [] } }) };
  }
  return { ok: false, status: 404, json: async () => ({}) };
};

// The plugin must not use the window's own dialogs. In the desktop application a native
// modal hands keyboard focus back to the window instead of to the composer, which is the
// reported 「dsh的输入框老是没有光标了」 after using the panel; both are also untestable and
// block the page. Calls are recorded (and answered, so a reintroduction does not hang the
// run) and asserted against at the end.
const nativeDialogCalls = [];
window.confirm = () => { nativeDialogCalls.push("confirm"); return true; };
window.alert = () => { nativeDialogCalls.push("alert"); };

// Evaluate the bundle the way the module loader does: as a classic script whose
// only global writes are the loader registration.
window.eval(source);

const problems = [];
if (registration === null) problems.push("the bundle did not register with __ModuleLoader__");
// The module id must be the package name, because the host derives the boot-graph row id
// from the package name; a mismatch makes the loader execute this bundle twice and the
// entry never appears (measured on the first packaged install of the fork).
const packageName = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).name;
if (registration !== null && registration.id !== packageName) {
  problems.push(`unexpected module id: ${registration.id} (expected the package name ${packageName})`);
}

const bundleExports = registration.factory((name) => {
  throw new Error(`the bundle required ${name}, but this DOM test provides no modules`);
});
if (typeof bundleExports.apply !== "function") problems.push("the factory returned no apply function");

// A client context with just the effect owner the bundle uses.
const effects = [];
bundleExports.apply({ effect: (execute) => { effects.push(execute); return () => {}; } });

// --- the sidebar row ---------------------------------------------------------

const entry = document.querySelector("[data-dsh-processboard-entry]");
if (entry === null) {
  problems.push("apply() did not mount the sidebar row");
} else {
  console.log(`entry          : <${entry.tagName.toLowerCase()}> "${entry.textContent.trim()}"`);
}

// --- clicking it -------------------------------------------------------------

if (entry !== null) {
  let clickError = null;
  try {
    entry.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  } catch (error) {
    clickError = error;
  }
  if (clickError !== null) problems.push(`clicking the entry threw: ${String(clickError)}`);

  const panel = document.querySelector(".dshpb-panel");
  const mask = document.querySelector(".dshpb-mask");
  if (panel === null) {
    problems.push("clicking the entry did not create a panel");
  } else {
    const opened = panel.classList.contains("dshpb-open");
    console.log(`panel open     : ${opened}`);
    if (!opened) problems.push("the panel was created but never marked open");

    // The docked layout: the sheet, applied by a real CSS engine, must position
    // the panel at the right edge and keep the mask out of the way.
    const panelStyle = window.getComputedStyle(panel);
    const maskStyle = mask === null ? null : window.getComputedStyle(mask);
    console.log(`panel position : ${panelStyle.position} / right ${panelStyle.right} / display ${panelStyle.display}`);
    console.log(`mask display   : ${maskStyle === null ? "(no mask)" : maskStyle.display}`);

    if (panelStyle.display === "none") problems.push("the open panel is still display:none by computed style");
    if (panelStyle.position !== "fixed") problems.push(`the panel should be fixed, computed ${panelStyle.position}`);
    if (maskStyle !== null && maskStyle.display !== "none") {
      problems.push(`the mask must stay hidden, computed display ${maskStyle.display}`);
    }

    const dialog = panel.querySelector(".dshpb-dialog");
    if (dialog === null) {
      problems.push("the panel has no dialog element");
    } else {
      const dialogStyle = window.getComputedStyle(dialog);
      // The dialog's height comes from anchoring both edges below the window's own
      // control strip. An earlier version instead required a concrete height, which
      // was the bug: it made the dialog cover that strip, so the panel's header
      // controls were drawn underneath the window buttons.
      console.log(`dialog edges   : top=${dialogStyle.top} bottom=${dialogStyle.bottom} position=${dialogStyle.position}`);
      if (dialogStyle.position !== "absolute") {
        problems.push(`the docked dialog should be absolutely positioned, got ${dialogStyle.position}`);
      }
      if (!/46px|var\(--dshpb-chrome-h/.test(dialogStyle.top)) {
        problems.push(`the docked dialog should start below the window controls, got top=${dialogStyle.top}`);
      }
      if (/100vh/.test(dialogStyle.height)) {
        problems.push("the docked dialog must not claim the full viewport height");
      }
    }

    // --- the app must make room, not be covered ------------------------------
    // The panel is a child of <body> and the app is <div id="root">, so reserving
    // space is a right inset on the root. A panel that merely overlays the app is
    // the defect this checks for.
    const root = document.getElementById("root");
    const bodyRight = window.getComputedStyle(document.body).paddingRight;
    const rootRight = window.getComputedStyle(root).paddingRight || window.getComputedStyle(root).marginRight;
    console.log(`root inset     : ${rootRight} (body ${bodyRight})`);
    const reserved = Number.parseFloat(rootRight) || Number.parseFloat(bodyRight) || 0;
    if (!(reserved > 0)) {
      problems.push(`the app must reserve space for the panel; computed root inset is ${rootRight} and body padding-right is ${bodyRight}`);
    }
    const panelWidth = Number.parseFloat(window.getComputedStyle(panel).width) || 0;
    console.log(`panel width    : ${panelWidth}`);
    if (reserved > 0 && panelWidth > 0 && Math.abs(reserved - panelWidth) > 2) {
      problems.push(`the reserved space (${reserved}) should match the panel width (${panelWidth})`);
    }

    // --- bound addresses and restart affordances ----------------------------
    // The table renders from the /state response, which is async, so let it settle.
    await new Promise((resolve) => setTimeout(resolve, 30));
    const rows = [...panel.querySelectorAll(".dshpb-table tbody tr")];
    // Rows include one group header per session, so there are more rows than
    // services: the assertions below are about the services, not the row count.
    const serviceRows = rows.filter((row) => row.querySelector(".dshpb-svcname") !== null);
    console.log(`table rows     : ${rows.length} (${serviceRows.length} services, ${rows.length - serviceRows.length} group headers)`);
    if (serviceRows.length !== 2) problems.push(`expected 2 rendered service rows, got ${serviceRows.length}`);

    const portTags = [...panel.querySelectorAll(".dshpb-port")];
    const portLabels = portTags.map((tag) => tag.textContent);
    console.log(`port tags      : ${JSON.stringify(portLabels)}`);
    // The address must be visible, not just the port: that is what says whether the
    // service is reachable from elsewhere.
    if (!portLabels.some((label) => label.includes("127.0.0.1:5399"))) {
      problems.push(`the loopback bind is not shown with its address (got ${JSON.stringify(portLabels)})`);
    }
    if (!portLabels.some((label) => label.includes("0.0.0.0:3306"))) {
      problems.push(`the wildcard bind is not shown with its address (got ${JSON.stringify(portLabels)})`);
    }
    // IPv6 addresses carry brackets: `::1:5400` is neither a legal URL nor readable as an
    // address, and `[::1]:5400` is what netstat prints and what pastes into a browser.
    if (!portLabels.some((label) => label.includes("[::1]:5400"))) {
      problems.push(`a specific IPv6 bind is not shown with brackets (got ${JSON.stringify(portLabels)})`);
    }
    // A v6-only wildcard must not be labelled `0.0.0.0`: that would claim IPv4 reachability
    // it does not have.
    const v6Only = portLabels.filter((label) => label === "[::]:5401");
    if (v6Only.length !== 1) {
      problems.push(`a v6-only wildcard should read [::]:5401 exactly once (got ${JSON.stringify(portLabels)})`);
    }
    const v6OnlyTitle = portTags.find((tag) => tag.textContent === "[::]:5401")?.getAttribute("title") ?? "";
    if (!/IPv6/.test(v6OnlyTitle)) {
      problems.push(`a v6-only wildcard should say it is IPv6-only in its title (got ${JSON.stringify(v6OnlyTitle)})`);
    }
    // The dual-stack pair collapses: one tag, not two identical ones.
    const dualStack = portLabels.filter((label) => label === "0.0.0.0:3306");
    if (dualStack.length !== 1) {
      problems.push(`a dual-stack wildcard pair should render one tag, got ${dualStack.length} (${JSON.stringify(portLabels)})`);
    }
    const anyTag = portTags.find((tag) => tag.textContent.includes("0.0.0.0"));
    if (anyTag !== undefined && !/局域网|全部网卡/.test(anyTag.getAttribute("title") ?? "")) {
      problems.push("a wildcard bind should explain what 0.0.0.0 means");
    }

    // Every row has to say when its process started. The age is relative (that is the
    // question a list answers at a glance) and the absolute time rides in the title, so a
    // scanned process shows both and a recalled one shows neither.
    const uptimes = serviceRows.map((row) => ({
      name: row.querySelector(".dshpb-svcname").textContent,
      label: row.querySelector(".dshpb-uptime")?.textContent ?? null,
      title: row.querySelector(".dshpb-uptime")?.getAttribute("title") ?? null,
    }));
    console.log(`uptimes        : ${JSON.stringify(uptimes)}`);
    const scanned = uptimes.find((entry) => entry.name === "node.exe");
    if (scanned?.label !== "2时0分") {
      problems.push(`a process started two hours ago should read 2时0分, got ${JSON.stringify(scanned?.label)}`);
    }
    if (!/^启动于 \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}，已运行 2时0分$/.test(scanned?.title ?? "")) {
      problems.push(`the uptime title should carry the absolute start time, got ${JSON.stringify(scanned?.title)}`);
    }
    const recalled = uptimes.find((entry) => entry.name === "mysqld.exe");
    if (recalled?.label !== null) {
      problems.push(`a row with no creation time must not claim an age, got ${JSON.stringify(recalled?.label)}`);
    }

    const actionLabels = [...panel.querySelectorAll(".dshpb-btn")].map((button) => button.textContent);
    console.log(`action buttons : ${JSON.stringify(actionLabels)}`);
    // The readable-command row must offer a restart; the unreadable one must not,
    // because a button that cannot work is worse than an absent one.
    const restartButtons = [...panel.querySelectorAll(".dshpb-btn")].filter((button) => button.textContent === "重启");
    if (restartButtons.length !== 1) {
      problems.push(`exactly the one restartable row should offer 重启, found ${restartButtons.length}`);
    }
    const noCommandRow = serviceRows.find((row) => row.textContent.includes("mysqld.exe"));
    if (noCommandRow !== undefined && noCommandRow.textContent.includes("重启")) {
      problems.push("a service with no readable command line must not offer 重启");
    }
    // A service the Service Control Manager owns must not offer a stop: killing it
    // only makes Windows start it again, which the user rightly read as a bug.
    if (noCommandRow !== undefined) {
      const serviceActionLabels = [...noCommandRow.querySelectorAll(".dshpb-btn")].map((b) => b.textContent);
      console.log(`service row    : ${JSON.stringify(serviceActionLabels)}`);
      if (serviceActionLabels.includes("停止")) {
        problems.push("a Windows-service row must not offer 停止");
      }
      if (!serviceActionLabels.some((label) => label.includes("Windows 服务"))) {
        problems.push("a Windows-service row should say why it cannot be stopped here");
      }
      const note = noCommandRow.querySelector(".dshpb-btn-service");
      if (note !== null && !/自动重启|服务管理器/.test(note.getAttribute("title") ?? "")) {
        problems.push("the service note should explain that Windows restarts it");
      }
    }

    // A state request must have been issued, so the panel is not merely visible.
    const stateRequests = requests.filter((request) => request.url.includes("/state"));
    console.log(`state requests : ${stateRequests.length}`);
    if (stateRequests.length === 0) problems.push("opening the panel issued no state request");
  }
}

// --- the log band switches between services ----------------------------------
//
// The band sits at the bottom of the panel, so which service it belongs to is not
// obvious from the row that was clicked. The row is marked, and clicking a second
// service's 日志 must move both the band and the mark. jsdom has no layout engine, so
// the geometry is `log-band.mjs`'s job in a real browser; what is checked here is the
// behaviour: which log is on screen, which request was made, and which row says so.

if (entry !== null && document.querySelector(".dshpb-panel") !== null) {
  const panel = document.querySelector(".dshpb-panel");
  const logCol = panel.querySelector(".dshpb-log-col");
  const logTitle = panel.querySelector(".dshpb-log-title");
  const logPath = panel.querySelector(".dshpb-log-path");
  const logBody = panel.querySelector(".dshpb-log-body");
  const logRequests = () => requests.filter((request) => request.url.includes("/log"));
  const markedRows = () => [...panel.querySelectorAll(".dshpb-table tbody tr.dshpb-logging")];
  /** The 日志 button of the row naming `name`, or null. */
  const logButtonOf = (name) => {
    const row = [...panel.querySelectorAll(".dshpb-table tbody tr")]
      .find((candidate) => candidate.querySelector(".dshpb-svcname")?.textContent === name);
    return row === undefined ? null : [...row.querySelectorAll(".dshpb-btn")].find((b) => b.textContent === "日志") ?? null;
  };

  console.log(`log at rest    : open=${logCol.classList.contains("dshpb-log-on")} marked=${markedRows().length}`);
  if (logCol.classList.contains("dshpb-log-on")) problems.push("the log column is open before anything was clicked");
  if (markedRows().length !== 0) problems.push("a row claims the log before any log was opened");

  const firstButton = logButtonOf("node.exe");
  const secondButton = logButtonOf("mysqld.exe");
  if (firstButton === null || secondButton === null) {
    problems.push(`both rows with a log marker should offer 日志 (node=${firstButton !== null}, mysqld=${secondButton !== null})`);
  } else {
    firstButton.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 40));
    console.log(`opened         : "${logTitle.textContent}" <- ${logPath.textContent} marked=${markedRows().map((tr) => tr.querySelector(".dshpb-svcname").textContent).join(",")}`);
    if (!logCol.classList.contains("dshpb-log-on")) problems.push("clicking 日志 did not open the log");
    if (!/node\.exe/.test(logTitle.textContent) || !/7300/.test(logTitle.textContent)) {
      problems.push(`the log title does not name the service it belongs to: "${logTitle.textContent}"`);
    }
    if (logPath.textContent !== "C:\\tmp\\server.log") problems.push(`the log path is wrong: ${logPath.textContent}`);
    const firstRequests = logRequests();
    if (firstRequests.length !== 1) problems.push(`expected one /log request, got ${firstRequests.length}`);
    else if (!/"pid":7300/.test(String(firstRequests[0].options.body))) {
      problems.push(`the /log request asked for the wrong pid: ${String(firstRequests[0].options.body)}`);
    }
    if (/不可用|加载失败/.test(logBody.textContent)) problems.push(`the log body reports a failure: ${logBody.textContent}`);
    if (logBody.querySelectorAll("div").length !== 3) {
      problems.push(`the log rendered ${logBody.querySelectorAll("div").length} lines, expected 3`);
    }
    if (!/dshpb-logline-err/.test(logBody.innerHTML)) problems.push("an ERROR line is not highlighted");

    // The timestamp is split out so it can be dimmed against the message. Two things have
    // to hold: the split happens only for a line that really starts with one, and the
    // concatenated line still reads exactly as the host sent it, so no log text is ever
    // reformatted or dropped.
    const renderedLines = [...logBody.querySelectorAll("div")];
    const stamped = renderedLines.filter((line) => line.querySelector(".dshpb-log-time") !== null);
    if (stamped.length !== 2) problems.push(`${stamped.length} of 3 lines carry a timestamp span, expected 2`);
    if (stamped[0]?.querySelector(".dshpb-log-time")?.textContent !== "[2026-01-01 00:00:01] ") {
      problems.push(`the timestamp span holds the wrong text: ${JSON.stringify(stamped[0]?.querySelector(".dshpb-log-time")?.textContent)}`);
    }
    const roundTrip = renderedLines.map((line) => line.textContent).join("\n");
    const original = "[2026-01-01 00:00:01] line one\n[2026-01-01 00:00:02] ERROR boom\nWARN careful";
    if (roundTrip !== original) problems.push(`the rendered log does not read as it arrived:\n${JSON.stringify(roundTrip)}`);
    if (markedRows().length !== 1 || markedRows()[0].querySelector(".dshpb-svcname").textContent !== "node.exe") {
      problems.push(`the wrong row is marked as the log's source: ${markedRows().map((tr) => tr.textContent.slice(0, 24)).join(" / ")}`);
    }
    if (markedRows()[0]?.getAttribute("aria-current") !== "true") {
      problems.push("the marked row does not announce itself as the log's source");
    }

    // A second service's 日志 switches the band and moves the mark: one source, not two.
    secondButton.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 40));
    console.log(`switched       : "${logTitle.textContent}" <- ${logPath.textContent} marked=${markedRows().map((tr) => tr.querySelector(".dshpb-svcname").textContent).join(",")}`);
    if (!/mysqld\.exe/.test(logTitle.textContent) || !/7301/.test(logTitle.textContent)) {
      problems.push(`the log did not switch to the second service: "${logTitle.textContent}"`);
    }
    if (logPath.textContent !== "C:\\tmp\\mysql.log") problems.push(`the switched log path is wrong: ${logPath.textContent}`);
    if (!logRequests().some((request) => /"pid":7301/.test(String(request.options.body)))) {
      problems.push("no /log request was made for the second service");
    }
    if (markedRows().length !== 1) {
      problems.push(`${markedRows().length} rows claim the log after switching, expected exactly 1`);
    } else if (markedRows()[0].querySelector(".dshpb-svcname").textContent !== "mysqld.exe") {
      problems.push("the mark did not move to the second service");
    }

    // Closing the band clears the mark and stops the poll: a closed panel must not keep
    // asking the host for a log nobody is looking at.
    panel.querySelector(".dshpb-log-close").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    const afterClose = logRequests().length;
    if (logCol.classList.contains("dshpb-log-on")) problems.push("收起日志 did not close the log");
    if (markedRows().length !== 0) problems.push(`${markedRows().length} rows stay marked after the log is closed`);
    await new Promise((resolve) => setTimeout(resolve, 4300));
    console.log(`after 收起     : open=${logCol.classList.contains("dshpb-log-on")} /log requests ${afterClose} -> ${logRequests().length}`);
    if (logRequests().length !== afterClose) {
      problems.push(`the log poll kept running after the log was closed (${afterClose} -> ${logRequests().length} requests)`);
    }
  }
}

// --- the panel's own controls ------------------------------------------------

if (entry !== null) {
  // The window's own minimise/maximise/close belong to the desktop shell and no
  // plugin can reach them. This asserts the bundle never tries, so the two sets of
  // controls cannot be confused in the code.
  if (/window\.close\s*\(/.test(source)) {
    problems.push("the bundle must not call window.close: the panel may only close itself");
  }

  const panel = document.querySelector(".dshpb-panel");

  // Every control the header markup declares must reach the DOM. A screenshot
  // showed a header with no buttons visible at all, so this states the expectation
  // instead of trusting the template string.
  const headerControls = {
    filter: panel === null ? null : panel.querySelector(".dshpb-cfgtoggle"),
    collapse: panel === null ? null : panel.querySelector(".dshpb-close:not(.dshpb-log-close)"),
    fullscreen: panel === null ? null : panel.querySelector(".dshpb-panel-max"),
  };
  console.log(`header controls: ${Object.entries(headerControls).map(([key, node]) => `${key}=${node === null ? "MISSING" : "ok"}`).join(" ")}`);
  if (headerControls.filter === null) problems.push("the header has no filter control");
  else {
    if (!/筛选/.test(headerControls.filter.textContent)) problems.push("the filter control should read 筛选");
    const filterStyle = window.getComputedStyle(headerControls.filter);
    console.log(`filter shown   : display=${filterStyle.display}`);
    if (filterStyle.display === "none") problems.push("the filter control must be visible");
  }

  const closeButton = panel === null ? null : panel.querySelector(".dshpb-close:not(.dshpb-log-close)");
  const closeLabel = closeButton === null ? "" : closeButton.textContent.trim();
  console.log(`close control  : "${closeLabel}" aria-label=${closeButton?.getAttribute("aria-label")}`);
  if (closeButton === null) problems.push("the panel has no close control of its own");
  // It lives in the same corner as the window's own close button, so it must not
  // also read as an "×": that is the confusion this relabelling removes.
  if (closeButton !== null && closeLabel === "×") {
    problems.push("the panel's close control still reads as the window's close glyph");
  }
  if (closeButton !== null && !/收起/.test(closeLabel)) {
    problems.push(`the panel's close control should read as a collapse (got "${closeLabel}")`);
  }

  // A control the panel hides must not look like a broken one: the fullscreen
  // toggle is suppressed in the docked layout, so it must be hidden by the sheet
  // rather than present and inert.
  const maxButton = panel === null ? null : panel.querySelector(".dshpb-panel-max");
  if (maxButton !== null) {
    const maxStyle = window.getComputedStyle(maxButton);
    console.log(`fullscreen btn : display ${maxStyle.display}`);
    if (maxStyle.display !== "none") {
      problems.push("the fullscreen toggle is meaningless in the docked layout and must be hidden");
    }
  }

  if (closeButton !== null) {
    closeButton.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    const afterClose = document.querySelector(".dshpb-panel");
    if (afterClose !== null && afterClose.classList.contains("dshpb-open")) {
      problems.push("the panel's own close button did not close the panel");
    } else {
      console.log("close button   : closed the panel");
    }
    const insetAfter = window.getComputedStyle(document.getElementById("root")).paddingRight;
    if ((Number.parseFloat(insetAfter) || 0) > 0) {
      problems.push(`the close button left the app inset in place (${insetAfter})`);
    } else {
      console.log("space released : yes");
    }
  }

  // Re-opening through the sidebar entry must still work after that.
  entry.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  const reopened = document.querySelector(".dshpb-panel");
  if (reopened === null || !reopened.classList.contains("dshpb-open")) {
    problems.push("the entry did not re-open the panel after its close button was used");
  } else {
    console.log("re-open        : ok");
  }
  entry.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  if (reopened !== null && reopened.classList.contains("dshpb-open")) {
    problems.push("a second click on the entry did not close the panel");
  } else {
    console.log("second click   : closed");
  }
}

// --- asking before stopping, inside the panel --------------------------------

if (entry !== null) {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const click = (node) => node.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  const panel = document.querySelector(".dshpb-panel");
  const buttonOn = (rowName, label) => {
    const row = [...panel.querySelectorAll(".dshpb-table tbody tr")]
      .find((tr) => tr.querySelector(".dshpb-svcname")?.textContent.includes(rowName));
    return [...(row?.querySelectorAll("button") ?? [])].find((b) => b.textContent.includes(label)) ?? null;
  };

  // The previous block left the panel closed; the entry toggles it back open.
  click(entry);
  await wait(40);
  console.log(`confirm setup  : panel open=${panel.classList.contains("dshpb-open")}`);

  const stop = buttonOn("node.exe", "停止");
  if (stop === null) {
    problems.push("the node.exe row offers no 停止 button, so the confirmation cannot be tested");
  } else {
    click(stop);
    await wait(20);
    const bar = panel.querySelector(".dshpb-confirmbar");
    const text = bar?.textContent ?? "";
    console.log(`confirm asked  : "${text.trim().slice(0, 60)}"`);
    if (bar === null || bar.hidden) problems.push("clicking 停止 asked nothing: no confirmation appeared in the panel");
    else if (!/确定停止 node\.exe \(pid 7300\)/.test(text)) {
      problems.push(`the confirmation should name the process and its pid, got "${text.trim()}"`);
    }

    // 取消 must not reach the host at all.
    const killsBefore = requests.filter((request) => request.url.includes("/kill")).length;
    const cancel = panel.querySelector(".dshpb-confirmno");
    if (cancel === null) problems.push("the confirmation offers no way to cancel");
    else {
      click(cancel);
      await wait(30);
      const killsAfter = requests.filter((request) => request.url.includes("/kill")).length;
      console.log(`cancel         : /kill requests ${killsBefore} -> ${killsAfter}, bar hidden=${bar.hidden}`);
      if (killsAfter !== killsBefore) problems.push("cancelling the confirmation still sent /kill to the host");
      if (!bar.hidden) problems.push("cancelling left the confirmation bar on screen");
    }

    // 确认 runs it, and the row says so while the host is working.
    click(stop);
    await wait(20);
    const yes = panel.querySelector(".dshpb-confirmyes");
    if (yes === null) problems.push("the confirmation has no 确认 button");
    else {
      click(yes);
      await wait(40);
      const killRequests = requests.filter((request) => request.url.includes("/kill"));
      const killed = killRequests.at(-1) === undefined ? null : JSON.parse(killRequests.at(-1).options.body).pid;
      console.log(`confirm        : /kill requests=${killRequests.length} last pid=${killed}`);
      if (killRequests.length === 0) problems.push("confirming did not send /kill");
      else if (killed !== 7300) problems.push(`confirming stopped pid ${killed} instead of 7300`);
      if (!bar.hidden) problems.push("the confirmation stayed on screen after it was answered");
    }

    // A restart has to show the command it will replay: the decision is not informed
    // otherwise, and that text used to live in a native confirm window.
    const restartButton = buttonOn("node.exe", "重启");
    if (restartButton === null) problems.push("the node.exe row offers no 重启 button");
    else {
      click(restartButton);
      await wait(20);
      const restartText = (panel.querySelector(".dshpb-confirmbar")?.textContent ?? "").trim();
      console.log(`restart asks   : "${restartText.replace(/\s+/g, " ").slice(0, 80)}"`);
      if (!/重启 node\.exe/.test(restartText)) problems.push("the restart confirmation does not name the process");
      if (!/server\.js/.test(restartText)) problems.push("the restart confirmation does not show the command it will replay");
      const cancels = panel.querySelector(".dshpb-confirmno");
      if (cancels !== null) click(cancels);
      await wait(20);
    }
  }
}

// --- the log band across a restart -------------------------------------------

if (entry !== null) {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const panel = document.querySelector(".dshpb-panel");
  const logButton = [...panel.querySelectorAll(".dshpb-table tbody tr")]
    .find((tr) => tr.querySelector(".dshpb-svcname")?.textContent.includes("node.exe"))
    ?.querySelector("button");
  const logBody = () => panel.querySelector(".dshpb-log-body");
  const logTitle = () => panel.querySelector(".dshpb-log-title")?.textContent ?? "";
  const logRequests = () => requests.filter((request) => request.url.includes("/log"));

  if (logButton === null || logButton === undefined) {
    problems.push("the node.exe row offers no 日志 button, so the restart behaviour cannot be tested");
  } else {
    logButton.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await wait(40);
    console.log(`band opened    : "${logTitle()}" lines=${logBody()?.children.length ?? 0}`);
    if (!/pid 7300/.test(logTitle())) problems.push(`the band should be on pid 7300, title is "${logTitle()}"`);

    // The service comes back under a new pid, as it does after 重启: same name, same
    // port, same log file. The band must follow it instead of asking for a pid that
    // has left the scan — which is what produced 「日志不可用：no-log」 after a restart.
    stateEntries = stateEntries.map((e) => (e.pid === 7300 ? { ...e, pid: 7400 } : e));
    const poller = window.setInterval;
    // The band polls every four seconds; wait for one poll to happen, without waiting
    // for the eight-second table refresh to also fire.
    await wait(4300);
    const asked = logRequests().at(-1) === undefined ? null : JSON.parse(logRequests().at(-1).options.body).pid;
    console.log(`after restart  : title "${logTitle()}" last /log pid=${asked} body="${(logBody()?.textContent ?? "").trim().slice(0, 40)}"`);
    if (!/pid 7400/.test(logTitle())) {
      problems.push(`the band did not follow the service to its new pid (title "${logTitle()}")`);
    }
    if (asked !== 7400) problems.push(`the band still asked for pid ${asked} after the restart`);
    if (/日志不可用|进程已结束/.test(logBody()?.textContent ?? "")) {
      problems.push("the band reported the log as unavailable for a service that is running under a new pid");
    }

    // And when the service really is gone, say that instead of repeating the host's
    // error code: "日志不可用：no-log" told the user nothing about their process.
    stateEntries = stateEntries.filter((e) => e.pid !== 7400);
    await wait(4300);
    const goneText = (logBody()?.textContent ?? "").trim();
    console.log(`service gone   : "${goneText.slice(0, 60)}"`);
    if (!/进程已结束/.test(goneText)) problems.push(`a stopped service should say so, got "${goneText.slice(0, 60)}"`);
    if (/no-log/.test(goneText)) problems.push("the panel still shows the host's raw no-log code to the user");
    void poller;
  }
}

if (nativeDialogCalls.length > 0) {
  problems.push(`the panel used the window's own dialogs (${nativeDialogCalls.join(", ")}): they take focus from the composer in the desktop app — ask inside the panel instead`);
}

if (problems.length > 0) {
  console.error("\nFAILED:");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}console.log("\nclient dom tests passed");
process.exit(0);
