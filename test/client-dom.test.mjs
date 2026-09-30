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
/** Serve the plugin's API without a network. */
window.fetch = async (url, options) => {
  requests.push({ url: String(url), options });
  if (String(url).includes("/state")) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        at: Date.now(),
        entries: [
          {
            pid: 7300,
            name: "node.exe",
            cmd: '"C:\\Program Files\\nodejs\\node.exe" D:\\work\\server.js',
            ports: [5399],
            binds: [{ addr: "127.0.0.1", port: 5399 }],
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
            binds: [{ addr: "0.0.0.0", port: 3306 }],
            state: "running",
            http: 0,
            session: "unknown",
            sessionTitle: null,
            logPath: null,
            inTree: false,
            serviceOwned: true,
          },
        ],
      }),
    };
  }
  return { ok: false, status: 404, json: async () => ({}) };
};

// Evaluate the bundle the way the module loader does: as a classic script whose
// only global writes are the loader registration.
window.eval(source);

const problems = [];
if (registration === null) problems.push("the bundle did not register with __ModuleLoader__");
if (registration !== null && registration.id !== "dsh-process-board") {
  problems.push(`unexpected module id: ${registration.id}`);
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
    const anyTag = portTags.find((tag) => tag.textContent.includes("0.0.0.0"));
    if (anyTag !== undefined && !/局域网|全部网卡/.test(anyTag.getAttribute("title") ?? "")) {
      problems.push("a wildcard bind should explain what 0.0.0.0 means");
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

if (problems.length > 0) {
  console.error("\nFAILED:");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log("\nclient dom tests passed");
process.exit(0);
