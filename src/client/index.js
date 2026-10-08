/**
 * dsh-process-board client half.
 *
 * 侧边栏入口 + 全屏面板（表格布局，采纳 fullstack-orch svc 看板的信息密度）：
 * 三态状态点（running 绿 / pid-alive 黄 / stopped 灰）+ HTTP 探测码列 +
 * 按会话（中文标题）分组 + 启停/重启/日志操作。纯 DOM，失败只打日志不抛错。
 */

// dsh client bundle 契约：host 原样 serve 本文件，插件须自行经
// window.__ModuleLoader__.load({id, factory}) 注册。全部代码留在 factory 闭包内
// ——classic script 顶层 const/let 会进全局词法环境与其他插件撞名。
//
// 这个 id 必须**等于 npm 包名**：宿主按包名生成 boot graph 的 row id，并据此查找本模块。
// 若两者不一致（本仓库改名后曾出现：包名 dsh-service-board、id dsh-process-board），
// 装载器在 batch 里找不到该 row 注册的模块，就回落到本包自己的 one-resource URL 再执行
// 一次脚本 → "client-modules: duplicate factory registration for dsh-process-board"，
// 于是侧边栏入口根本不会出现（打包安装时实测到，见 docs/patches.md）。
// scripts/set-identity.mjs 改名时会一并改这里，test/package-identity.test.mjs 守着它。
window.__ModuleLoader__.load({
  id: 'dsh-service-board',
  factory: () => {

const API = '/api/plugins/process-board'
const ENTRY_ATTR = 'data-dsh-processboard-entry'

const ICON = '<svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" aria-hidden="true"><rect x="2" y="2" width="12" height="6" rx="1.2"/><rect x="2" y="10" width="12" height="4" rx="1.2"/><circle cx="4.4" cy="5" r=".7" fill="currentColor" stroke="none"/><circle cx="4.4" cy="12" r=".7" fill="currentColor" stroke="none"/></svg>'

const CSS = `
.dshpb-entry { display:flex; align-items:center; gap:8px; width:100%; padding:7px 12px; margin:0; border:0; background:transparent; color:inherit; font:inherit; font-size:13px; text-align:left; cursor:pointer; border-radius:6px; }
.dshpb-entry:hover { background:rgba(127,127,127,.12); }
.dshpb-entry[data-active] { background:rgba(63,146,254,.15); color:#3f92fe; }
.dshpb-entry .dshpb-ico { display:inline-flex; width:18px; justify-content:center; opacity:.85; }
/* The mask is left in the sheet but disabled: the script toggles it with an
   inline style.display, and !important is the only thing that beats an inline
   style without editing the script. */
.dshpb-mask { display:none !important; }
.dshpb-head { display:flex; align-items:center; justify-content:space-between; padding:14px 20px; border-bottom:1px solid rgba(127,127,127,.2); }
.dshpb-head b { font-size:15px; }
.dshpb-head small { display:block; color:#8b93a1; font-weight:400; margin-top:3px; font-size:12px; }
.dshpb-close { border:0; background:transparent; color:#8b93a1; font-size:20px; cursor:pointer; padding:4px 10px; border-radius:4px; }
.dshpb-close:hover { background:rgba(127,127,127,.15); color:#fff; }
/* 表格布局（svc 看板式：一行一服务，信息密度高） */
.dshpb-tablewrap { overflow-y:auto; padding:6px 20px 16px; }
table.dshpb-table { border-collapse:collapse; width:100%; font-size:13px; }
.dshpb-table th { text-align:left; padding:9px 10px; color:#8b93a1; font-weight:600; font-size:12px; border-bottom:1px solid rgba(127,127,127,.25); position:sticky; top:0; background:#1e222a; z-index:1; }
.dshpb-table td { padding:9px 10px; border-bottom:1px solid rgba(127,127,127,.12); vertical-align:middle; }
.dshpb-table tr:hover td { background:rgba(127,127,127,.06); }
.dshpb-grouprow td { background:rgba(127,127,127,.04); color:#9aa3b2; font-size:12px; padding:14px 10px 6px; border-bottom:none; }
.dshpb-grouprow tr:hover td { background:rgba(127,127,127,.04); }
.dshpb-gtag { background:rgba(63,146,254,.15); color:#5ba4ff; border-radius:4px; padding:1px 7px; font-size:11px; margin-left:8px; }
.dshpb-dot { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:7px; vertical-align:0; }
.dshpb-dot.dshpb-running { background:#22c55e; box-shadow:0 0 6px rgba(34,197,94,.6); }
.dshpb-dot.dshpb-pid-alive { background:#e0a052; }
.dshpb-dot.dshpb-stopping { background:#e0a052; }
.dshpb-dot.dshpb-stopped { background:#6b7280; }
.dshpb-st-running { color:#4ade80; } .dshpb-st-pid-alive { color:#e0a052; } .dshpb-st-stopping { color:#e0a052; } .dshpb-st-stopped { color:#8b93a1; }
/* The uptime sits under the state word, so a row answers "how long has this been up"
   without a seventh column competing for a 460px panel. It uses the application's
   tertiary label: the same token the log timestamps use, for the same reason — it is
   read after the state, not instead of it. Tabular figures keep a column of ages from
   jittering as the digits change. */
.dshpb-statecell { white-space:nowrap; }
.dshpb-uptime { display:block; margin-top:2px; font-size:11px; line-height:1.3;
  color:var(--dsw-alias-label-tertiary,#8b93a1); font-variant-numeric:tabular-nums; }
.dshpb-code { font-family:Consolas,Menlo,monospace; font-size:12px; color:#c9d1d9; }
.dshpb-http-ok { color:#4ade80; font-weight:600; } .dshpb-http-dead { color:#e05252; font-weight:600; }
/* The port column holds one tag per listening socket, and each tag carries its
   address. Two of those plus the action column do not fit on one line at a modest
   panel width: the column grew and pushed PID and 操作 out of the panel entirely.
   The wrapper must be inline-flex, not a plain span: flex-wrap does nothing on an
   inline element, so the tags stayed on one line and the column stayed wide. */
.dshpb-portcell { display:inline-flex; flex-wrap:wrap; gap:3px 4px; max-width:100%; }
.dshpb-port { display:inline-block; background:rgba(63,146,254,.15); color:#5ba4ff; border-radius:4px; padding:1px 6px; font-family:Consolas,monospace; font-size:11px; white-space:nowrap; }
.dshpb-svcname { font-weight:600; }
/* The service column: the name, with the command line as a dim preview under it.
   The preview is capped tightly on purpose. It was allowed 380px, and the column then
   grew to whatever the preview asked for — at a 700px panel that alone pushed the table
   47px past the panel's right edge and hid the action column. The name is what
   identifies the row; the preview is a hint. */
.dshpb-table td:first-child { max-width:210px; }
.dshpb-table td:first-child > * { max-width:100%; }
.dshpb-svccmd { display:block; color:#8b93a1; font-size:11px; font-family:Consolas,monospace; max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin-top:2px; }
.dshpb-btn { border:1px solid rgba(127,127,127,.4); background:transparent; color:#c9d1d9; font-size:12px; padding:3px 11px; border-radius:4px; cursor:pointer; margin-right:6px; }
.dshpb-btn:hover:not(:disabled) { background:rgba(127,127,127,.15); }
.dshpb-btn:disabled { opacity:.45; cursor:default; }
.dshpb-btn-primary { border-color:#3f92fe; color:#5ba4ff; }
.dshpb-btn-primary:hover:not(:disabled) { background:rgba(63,146,254,.15); }
.dshpb-btn-danger { border-color:rgba(220,74,74,.5); color:#e05252; }
.dshpb-btn-danger:hover:not(:disabled) { background:rgba(220,74,74,.15); }
.dshpb-empty { color:#8b93a1; text-align:center; padding:80px 0; font-size:14px; }
.dshpb-err { color:#e0a052; font-size:12px; padding:8px; }
/* 日志分栏 */
.dshpb-layout { flex:1; display:flex; min-height:0; }
.dshpb-list-col { flex:1 1 52%; min-width:340px; overflow-y:auto; border-right:1px solid rgba(127,127,127,.18); }
.dshpb-log-col { flex:1 1 48%; min-width:0; display:none; flex-direction:column; }
.dshpb-log-col.dshpb-log-on { display:flex; }
.dshpb-log-head { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:10px 16px; border-bottom:1px solid rgba(127,127,127,.18); }
.dshpb-log-head b { font-size:13px; }
.dshpb-log-head small { display:block; color:#8b93a1; font-family:Consolas,monospace; font-size:11px; margin-top:2px; word-break:break-all; max-width:420px; }
/* The log surface takes its background AND its text colour from the application's own
   code-surface token, because those two have to be a matched pair. The previous version
   set the background from an invented token (--dsw-alias-bg-l2: the app defines
   bg-layer-1/2/3, not bg-l2) and took the colour from a real one, so the background was
   always the dark literal while the colour followed the theme: in the light theme that
   is near-black text on near-black, which is what the report saw. A fallback cannot
   rescue this, because the missing token is precisely what the fallback paints. */
.dshpb-log-body { flex:1; overflow:auto; padding:10px 16px 14px; font-family:Consolas,'Courier New',monospace; font-size:12px; line-height:1.6; white-space:pre-wrap; word-break:break-all;
  background:var(--dsw-alias-markdown-code-block,#16181f); color:var(--dsw-alias-label-primary,#e6e8ec); }
.dshpb-logline-err { color:#e05252; }
.dshpb-logline-warn { color:#e0a052; }
/* The timestamp is the one part of a log line that is always the same shape, so it is
   the part to push back: dimming it leaves the message as the thing the eye lands on. */
.dshpb-log-time { color:var(--dsw-alias-label-tertiary,#8b93a1); }
/* 全屏态：面板 dialog 铺满视口 */
.dshpb-dialog.dshpb-max { width:100vw; height:100vh; max-width:100vw; max-height:100vh; border-radius:0; border:none; }
/* 日志全屏态：log-col 覆盖整个 dialog（服务列表隐藏） */
.dshpb-layout.dshpb-log-max .dshpb-list-col { display:none; }
.dshpb-layout.dshpb-log-max .dshpb-log-col { flex:1 1 100%; display:flex; }
/* 头部小按钮（全屏/还原） */
.dshpb-headbtns { display:flex; align-items:center; gap:4px; }
.dshpb-maxbtn { border:0; background:transparent; color:#8b93a1; font-size:15px; cursor:pointer; padding:4px 8px; border-radius:4px; line-height:1; }
.dshpb-maxbtn:hover { background:rgba(127,127,127,.15); color:#fff; }

/* --- patched: dock the panel to the right edge instead of centring it -------
   A centred modal with a full-screen mask covers the conversation, so the user
   cannot keep working while watching services. These rules sit last in the sheet
   so they win on order alone; the mask needs the important flag because the
   script toggles it with an inline style.display. NOTE: no backticks anywhere
   below - this block is inside a JS template literal.

   Every property the base rule sets is restated, not just the ones that change.
   Setting inset without position left the panel position:static, where inset does
   nothing: the panel rendered at the end of the document flow instead of at the
   right edge, which looked like the click doing nothing at all. A real-DOM
   computed-style check caught it. */
.dshpb-panel { position:fixed; top:0; right:0; bottom:0; left:auto; inset:auto 0 0 auto;
  z-index:901; display:none; align-items:stretch; justify-content:flex-end; font-size:13px; padding:0; }
.dshpb-panel.dshpb-open { display:flex; }

/* The panel must sit BESIDE the app, not on top of it. The app is a single
   element under body and the panel is a sibling of it, so reserving the space is
   one inset on that root: the whole interface narrows and slides left, the same
   reflow the product's own right sidebar performs in its default push mode. The
   width itself is applied inline by the script, so the two values cannot drift
   apart and no CSS variable resolution is involved. */
body.dshpb-docked > #root { transition:padding-right .16s ease-out; }
body.dshpb-docked .dshpb-panel > .dshpb-dialog { width:100%; min-width:0; box-sizing:border-box;
  border-radius:0; border:0; border-left:1px solid rgba(127,127,127,.25);
  box-shadow:-16px 0 40px rgba(0,0,0,.35);
  /* Clear the window's own buttons, which occupy the top-right corner of the same
     strip this panel starts in. Without this the panel's header controls are drawn
     underneath them: visible to the DOM and to a test, invisible and unclickable to a
     person.
     This is an inset on the absolutely positioned dialog, NOT a padding-top. With
     height:100vh and box-sizing:border-box, a top padding pushed the whole box up to
     -46px and the content back to 0, so the header did not move at all: the two
     offsets cancelled exactly.
     The variable is redefined here rather than inherited, so the offset does not
     depend on which ancestor happens to carry the class. */
  --dshpb-chrome-h:max(env(titlebar-area-height, 0px), 46px);
  position:absolute; top:var(--dshpb-chrome-h); right:0; bottom:0; left:0;
  height:auto; max-height:none;
  /* The dialog is the panel's column, and this is not decoration: the published sheet
     made the dialog a flex column, docking rewrote that rule for its geometry, and the
     declarations below were dropped on the way. Without them the layout had no flex
     parent - its flex:1 was inert, its height came from its content, and the log's 400
     lines stretched the panel to 1,026,533px inside an 854px dialog (measured in Chrome
     by test/log-band.mjs). None of it overflowed visibly: the panel is fixed, so
     everything past the window edge was simply unreachable, and the log could not
     scroll because nothing bounded it. */
  display:flex; flex-direction:column; min-height:0; overflow:hidden;
}
/* --- patched: the log is a band under the list, not a column beside it ---------
   The log used to be a second column whose flex:1 1 100% was meant to make it "take the
   whole panel while it is open". A flex-basis is not a width: in a nowrap row the list
   keeps its content width and the log takes what is left of it, so the two squeeze each
   other. With long log lines the log's max-content width even won the shrink and the
   column measured 0px wide; with short ones the table was cut in half beside it.
   Stacked instead: the list keeps the panel's full width and the log is a band across
   the bottom, so no line of log text can set the table's width any more.

   The band's height is a clamp rather than a percentage: a percentage flex-basis on the
   log resolves against the layout's height, which flex itself resolves, and a
   percentage max-height against an unresolved height is ignored outright. Clamping
   against the viewport is deterministic both in the docked panel (a full-height column)
   and in a centred dialog. */
.dshpb-layout { flex:1 1 auto; min-height:0; flex-direction:column; }
.dshpb-list-col { flex:1 1 auto; min-width:0; min-height:0; border-right:0; }
/* The separator is the band's own top border, so it exists only while the log is open
   (a closed log column is display:none) and the list needs no border of its own. */
.dshpb-log-col { flex:0 0 auto; min-width:0; min-height:0; border-top:1px solid rgba(127,127,127,.18); }
.dshpb-log-col.dshpb-log-on { display:flex; height:clamp(150px, 38vh, 420px); }
/* 日志全屏：列表让位，横条吃满面板，clamp 必须让开。 */
.dshpb-layout.dshpb-log-max .dshpb-log-col { display:flex; flex:1 1 auto; height:auto; min-height:0; }
/* The panel is already a full-height column, so its fullscreen toggle is moot. */
.dshpb-panel-max, .dshpb-dialog.dshpb-max { display:none; }

/* --- patched: the docked panel follows the application's theme ----------------
   As a centred modal the panel was a raised card, so its own dark palette was
   right. Docked, it is a column of the page and must read as one: the product
   states the same rule for its own right sidebar ("it is a column of the page,
   not a card"). These rules restate the surfaces and text in the app's design
   tokens, each with the previous literal as the fallback, so a light theme does
   not leave a dark slab beside the conversation.

   Deliberately NOT tokenised: the per-service accent colours (port, service
   name, state dot). Those are content, not chrome, and the tokens that exist for
   them are the app's generic state colours rather than this list's semantics. */
body.dshpb-docked .dshpb-dialog { background:var(--dsw-alias-bg-base,#1e222a); color:var(--dsw-alias-label-primary,#e6e8ec);
  border-left:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.25)); box-shadow:none; }
body.dshpb-docked .dshpb-head,
body.dshpb-docked .dshpb-log-head { border-bottom-color:var(--dsw-alias-border-l1,rgba(127,127,127,.2)); }
body.dshpb-docked .dshpb-head small,
body.dshpb-docked .dshpb-log-head small,
body.dshpb-docked .dshpb-sub { color:var(--dsw-alias-label-caption,#8b93a1); }
/* The separator between the list and the log band, in the application's own border
   token, so a light theme does not keep the dark literal. */
body.dshpb-docked .dshpb-log-col { border-top-color:var(--dsw-alias-border-l1,rgba(127,127,127,.18)); }
/* A slim strip the window's own buttons cannot cover: the controls sit in the top
   right, so this row keeps them off the very top edge of the panel. */
body.dshpb-docked .dshpb-grip { display:block; }
.dshpb-grip {
  display:none; position:absolute; top:0; left:0; bottom:0; width:6px; z-index:2;
  cursor:col-resize; background:transparent; border:0; padding:0;
}
.dshpb-grip::after {
  content:""; position:absolute; top:0; bottom:0; left:2px; width:2px; border-radius:1px;
  background:var(--dsw-alias-border-l2,rgba(127,127,127,.35));
}
.dshpb-grip:hover::after, .dshpb-grip[data-dragging="true"]::after {
  background:var(--dsw-alias-brand-primary,#3f92fe);
}
body.dshpb-docked .dshpb-table th {
  background:var(--dsw-alias-bg-base,#1e222a); color:var(--dsw-alias-label-caption,#8b93a1);
  border-bottom-color:var(--dsw-alias-border-l2,rgba(127,127,127,.25)); }
body.dshpb-docked .dshpb-table td { border-bottom-color:var(--dsw-alias-border-l1,rgba(127,127,127,.12)); }
body.dshpb-docked .dshpb-table tr:hover td { background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.06)); }
body.dshpb-docked .dshpb-grouprow td { background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.04)); color:var(--dsw-alias-label-secondary,#9aa3b2); }
/* The log surface deliberately has no docked override: the rule above names a matched
   background and text colour from the theme, and both resolve the same way docked or in
   a centred dialog. Repeating them here is how the dark literal got in last time. */
body.dshpb-docked .dshpb-close,
body.dshpb-docked .dshpb-maxbtn { color:var(--dsw-alias-label-caption,#8b93a1); }
body.dshpb-docked .dshpb-close:hover,
body.dshpb-docked .dshpb-maxbtn:hover { background:var(--dsw-alias-interactive-bg-hover-accent,rgba(127,127,127,.15)); color:var(--dsw-alias-label-primary,#fff); }
body.dshpb-docked .dshpb-btn { color:var(--dsw-alias-label-primary,#e6e8ec); border-color:var(--dsw-alias-border-l2,rgba(127,127,127,.3)); }
body.dshpb-docked .dshpb-btn:hover { background:var(--dsw-alias-interactive-bg-hover-accent,rgba(127,127,127,.15)); }
/* The header sits against the window's own controls, so keep its padding and give
   the collapse control room to breathe away from the corner. */
body.dshpb-docked .dshpb-head { padding:12px 14px; }
body.dshpb-docked .dshpb-headbtns { gap:8px; }

/* Asking a question inside the panel.
   These two strips replace window.confirm and window.alert. A native modal belongs to
   the window, not to the page: in the desktop application it takes keyboard focus and
   hands it back to the window rather than to the composer, which was reported as
   「输入框老是没有光标了」 — the caret was gone until the session was reopened. A question
   the panel asks is the panel's own business, so it is drawn in the panel, where it can
   be tested, styled and dismissed, and where a replayed command line has room to wrap. */
.dshpb-confirmbar, .dshpb-notebar { display:flex; align-items:center; gap:10px; margin:0;
  padding:10px 16px; font-size:12px; line-height:1.5;
  border-bottom:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.2)); }
.dshpb-confirmbar[hidden], .dshpb-notebar[hidden] { display:none; }
.dshpb-confirmbar { background:var(--dsw-alias-interactive-bg-hover-accent,rgba(127,127,127,.12));
  flex-wrap:wrap; }
.dshpb-confirmtext { flex:1 1 220px; min-width:0; white-space:pre-wrap; word-break:break-word;
  color:var(--dsw-alias-label-primary,#e6e8ec); }
.dshpb-notebar { background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.07));
  color:var(--dsw-alias-label-secondary,#9aa3b2); }
.dshpb-notebar .dshpb-notetext { flex:1 1 auto; min-width:0; white-space:pre-wrap; word-break:break-word; }

/* Clear the window's own buttons.
   The docked panel starts at the top of the viewport, and the native title bar's
   minimise / maximise / close buttons occupy that same top-right corner, so the
   panel's own header controls were drawn underneath them: present, and impossible to
   see or click. The dialog is inset below that strip instead (see the rule above).
   env(titlebar-area-height) is the standard way to learn the height when the window
   uses the Window Controls Overlay API; where it is unavailable the fallback covers a
   Windows title bar with the taller caption buttons this desktop app draws. */
body.dshpb-docked { --dshpb-chrome-h:max(env(titlebar-area-height, 0px), 46px); }
/* The strip the dialog leaves free is painted with the panel's own surface, so the
   column reads as continuing to the window edge rather than starting mid-air.
   The edges are stated explicitly rather than left to the base rule's inset shorthand:
   that shorthand resolves top to auto, and the used value then came out as the full
   viewport height, which pushed the whole panel off the bottom of the window. */
body.dshpb-docked .dshpb-panel {
  background:var(--dsw-alias-bg-base,#1e222a);
  top:0; right:0; bottom:0; left:auto; height:100vh;
  /* Above the application's own shell. The app mounts a fixed root at z-index 1000
     that spans the whole viewport, and the panel's original 901 put it underneath:
     the app painted over the panel's left edge, hiding the first two dozen pixels of
     every line — its own left padding. The panel is a sibling of that root, so the
     only thing that decides this is the number. */
  z-index:1100;
}

/* Header controls, made plainly visible.
   The first version styled the collapse control as bare text: no border, no
   background, 12px, sitting in the same corner as the window's own close glyph. A
   user reported that no collapse button existed at all — it was there and
   unfindable. Both header buttons are now solid, labelled controls with a real
   border, a background, and a hit area large enough to aim at. */
body.dshpb-docked .dshpb-headbtns .dshpb-btn,
.dshpb-close.dshpb-collapse {
  display:inline-flex; align-items:center; gap:4px;
  font-size:12px; font-weight:500; line-height:1.2;
  padding:5px 10px; min-height:28px; border-radius:6px;
  border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.35));
  background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.08));
  color:var(--dsw-alias-label-primary,#e6e8ec);
  cursor:pointer; white-space:nowrap;
}
body.dshpb-docked .dshpb-headbtns .dshpb-btn:hover,
.dshpb-close.dshpb-collapse:hover {
  background:var(--dsw-alias-interactive-bg-hover-accent,rgba(127,127,127,.18));
  border-color:var(--dsw-alias-border-l3,rgba(127,127,127,.5));
}
/* The collapse control is the primary action in this header, so it carries the
   accent colour: a labelled button in the accent style reads as "this collapses the
   panel", where a grey glyph in the corner read as "this closes the window".
   The body-qualified selector is deliberate. The docked rule for dshpb-close sets
   the caption colour for the glyph buttons, and without the extra specificity here
   it won, leaving grey text on the accent surface. */
body.dshpb-docked .dshpb-close.dshpb-collapse {
  border-color:var(--dsw-alias-brand-primary,#3f92fe);
  background:var(--dsw-alias-brand-primary,#3f92fe);
  color:#fff; font-weight:600;
  margin-left:6px; box-shadow:0 1px 3px rgba(0,0,0,.22);
}
body.dshpb-docked .dshpb-close.dshpb-collapse:hover {
  border-color:var(--dsw-alias-brand-text,#2f7fe8);
  background:var(--dsw-alias-brand-text,#2f7fe8);
  color:#fff;
}
/* The filter control toggles a section rather than acting, so it stays secondary,
   but it keeps the shared size so both are equally easy to hit. */
.dshpb-cfgtoggle[aria-expanded="true"] {
  border-color:var(--dsw-alias-brand-primary,#3f92fe);
  color:var(--dsw-alias-brand-primary,#5ba4ff);
}
/* A chevron sets the collapse control apart from the window's own buttons, which sit
   a few pixels away in the same corner. The chevron is the literal character: a CSS
   escape like backslash-00BB is an octal escape inside this JavaScript template
   literal and fails to parse. */
.dshpb-close.dshpb-collapse::before { content:"»"; font-size:15px; line-height:1; }

/* A wildcard bind is worth distinguishing at a glance from a loopback one: the first
   is reachable from the network, the second is not. The marker is a colour change, not
   a border: setting border-style alone gives the border its initial medium width, so
   an earlier dashed rule drew a box around every port tag instead of a subtle hint. */
.dshpb-port-any { border:0; background:rgba(127,127,127,.18); color:var(--dsw-alias-label-primary,#c9d1d9); }

/* The action column: buttons keep their label on one line. 142px is the measured width
   three buttons need at the compact size, so this is a floor the table can honour at
   every width the drag handle allows instead of a preference it can squeeze away. */
.dshpb-table td:last-child { white-space:nowrap; min-width:142px; }
.dshpb-btn { white-space:nowrap; }
/* Column labels and short status words must never break mid-word. At a narrow panel
   width the two-character 状态 header wrapped onto two lines — one character per
   line — which reads as a rendering fault rather than a narrow column. */
.dshpb-table th { white-space:nowrap; }
.dshpb-table td { white-space:nowrap; }
.dshpb-svccmd { white-space:nowrap; }
/* A service the SCM owns: the control explains itself instead of inviting a click. */
.dshpb-btn-service { opacity:.75; cursor:default; }

/* The row whose log the band is showing. The band's title names the service, but the
   band is at the bottom of the panel and the row can be anywhere in the list, so the
   list says it too - otherwise the user matches a pid by eye to find out. */
.dshpb-table tr.dshpb-logging td { background:rgba(63,146,254,.10); }
.dshpb-table tr.dshpb-logging td:first-child { box-shadow:inset 2px 0 0 rgba(63,146,254,.9); }

/* --- the filter panel -------------------------------------------------------
   The panel listed every listening process on the machine, so the useful rows were
   buried under whatever else happened to hold a port. These controls state the three
   filters the host applies.

   Laid out as stacked fields rather than a label column: the first version put the
   labels in a fixed 64px column beside their controls and at this width the label
   text ran straight over the inputs. */
.dshpb-config { box-sizing:border-box; padding:14px 16px 12px;
  border-bottom:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.2));
  background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.05)); }
.dshpb-config[hidden] { display:none; }
.dshpb-cfghead { margin-bottom:12px; font-size:13px; font-weight:600; color:var(--dsw-alias-label-primary,#e6e8ec); }
.dshpb-field { margin-bottom:14px; }
.dshpb-flabel { display:block; margin-bottom:6px; font-size:12px; font-weight:500; color:var(--dsw-alias-label-primary,#e6e8ec); }
.dshpb-fhint { margin:6px 0 0; font-size:11px; line-height:1.5; color:var(--dsw-alias-label-caption,#8b93a1); }

/* A segmented control for the two mutually exclusive scopes: the selected side is
   filled with the accent surface, so the current mode reads at a glance instead of
   being inferred from which button happens to be disabled. */
.dshpb-seg { display:flex; border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.35));
  border-radius:7px; overflow:hidden; }
.dshpb-segbtn { flex:1 1 0; min-width:0; padding:7px 8px; border:0; cursor:pointer; font:inherit; font-size:12px;
  background:var(--dsw-alias-bg-base,#1e222a); color:var(--dsw-alias-label-primary,#e6e8ec); }
.dshpb-segbtn + .dshpb-segbtn { border-left:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.35)); }
.dshpb-segbtn:hover { background:var(--dsw-alias-interactive-bg-hover-accent,rgba(127,127,127,.15)); }
.dshpb-segbtn[data-active="true"] { background:var(--dsw-alias-brand-primary,#3f92fe); border-color:transparent;
  color:#fff; font-weight:600; }

.dshpb-input { display:block; width:100%; box-sizing:border-box; padding:7px 10px; border-radius:7px;
  font:inherit; font-size:12px; color:var(--dsw-alias-label-primary,#e6e8ec);
  background:var(--dsw-alias-bg-base,#1e222a);
  border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.35)); }
.dshpb-input::placeholder { color:var(--dsw-alias-label-dimmed,#767e8c); }
.dshpb-input:focus { outline:none; border-color:var(--dsw-alias-brand-primary,#3f92fe);
  box-shadow:0 0 0 2px rgba(63,146,254,.22); }

/* The save button is right-aligned and sized like a control, not a footnote: it was
   smaller than the inputs it commits. */
.dshpb-cfgfoot { display:flex; align-items:center; justify-content:flex-end; margin-top:2px; }
.dshpb-cfgsaved { margin-right:auto; font-size:11px; color:var(--dsw-alias-brand-text,#5ba4ff); }
.dshpb-cfgsave { margin-right:0; padding:7px 20px; min-height:32px; font-size:12px; font-weight:600; }
/* label-dimmed is the app's own placeholder colour, and it is a very light grey in the
   light theme (rgb(225,229,238) on white): right for a placeholder, wrong for anything
   the user is meant to read. The input placeholder keeps it, because that is exactly what
   the app's own Input does; the config path below is content and takes a readable token. */
.dshpb-cfgpath { margin:12px 0 0; padding-top:10px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  font-size:10px; color:var(--dsw-alias-label-tertiary,#767e8c);
  border-top:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.16)); }

/* Six columns do not fit on one line in a narrow column, and letting the table grow
   pushed 操作 — the column of buttons that makes the panel worth opening — outside the
   panel edge. The secondary columns give way instead, and so do the fixed widths that
   were sized for a wide panel.
   These are container queries, not media queries: they measure the panel, so they
   follow the drag handle rather than the window. HTTP goes first, because the state
   dot already answers whether the service responds. */
body.dshpb-docked .dshpb-panel { container-type:inline-size; }
@container (max-width: 780px) {
  .dshpb-table th:nth-child(5), .dshpb-table td:nth-child(5) { display:none; }
}
@container (max-width: 640px) {
  .dshpb-table th:nth-child(4), .dshpb-table td:nth-child(4) { display:none; }
  /* The command preview is the widest fixed thing in the row. */
  .dshpb-svccmd { max-width:150px; }
  .dshpb-table td:first-child { max-width:170px; }
}
@container (max-width: 560px) {
  .dshpb-svccmd { max-width:120px; }
  .dshpb-table td:first-child { max-width:140px; }
  .dshpb-tablewrap { padding-left:10px; padding-right:10px; }
  .dshpb-grouprow td { padding-left:6px; }
}
@container (max-width: 460px) {
  .dshpb-svccmd { max-width:90px; }
  .dshpb-table td:first-child { max-width:110px; }
  .dshpb-table td:last-child { min-width:0; }
  .dshpb-table th, .dshpb-table td { padding:8px 5px; }
  /* The wrapper's padding is part of the budget here: at 380px the horizontal padding
     alone was enough to make it scroll by two pixels. */
  .dshpb-tablewrap { padding-left:6px; padding-right:6px; }
  .dshpb-portcell { gap:2px 3px; }
  .dshpb-btn { padding:3px 8px; margin-right:4px; font-size:11px; }
  .dshpb-port { font-size:10px; padding:1px 5px; }
  /* At the narrowest widths the auto algorithm's minimum content width exceeds the
     panel, and the table overflows no matter how small the caps are. Fixed layout
     trades content-sized columns for declared ones, which is the only way to
     guarantee the action column stays inside. Percentages follow the visible columns:
     the hidden HTTP and PID columns still occupy a slot. */
  .dshpb-table { table-layout:fixed; width:100%; max-width:100%; box-sizing:border-box; }
  /* Zero-minimum cells: at this width a cell's minimum content width is itself enough
     to make the wrapper scroll, even with the table at 100%. */
  .dshpb-table td, .dshpb-table th { min-width:0; }
  .dshpb-table th:nth-child(1), .dshpb-table td:nth-child(1) { width:26%; }
  .dshpb-table th:nth-child(2), .dshpb-table td:nth-child(2) { width:15%; }
  .dshpb-table th:nth-child(3), .dshpb-table td:nth-child(3) { width:23%; }
  .dshpb-table th:nth-child(4), .dshpb-table td:nth-child(4) { width:0; }
  .dshpb-table th:nth-child(5), .dshpb-table td:nth-child(5) { width:0; }
  .dshpb-table th:last-child, .dshpb-table td:last-child { width:36%; }
  .dshpb-table td:first-child, .dshpb-svccmd { max-width:none; overflow:hidden; }
  .dshpb-portcell { max-width:100%; overflow:hidden; }
}
`

function apply(ctx) {
  if (typeof document === 'undefined') return
  if (document.querySelector(`[${ENTRY_ATTR}]`)) return

  injectCss()
  let open = false
  let panel
  let mask
  let refreshTimer
  /** The panel's left-edge width handle. */
  let grip
  // 会话标题：由 host 注入（state API 的 sessionTitle 字段，读自 DSH sessionTitle 服务）
  const sessionTitles = new Map()
  function rememberTitle(sessionId, title) {
    if (sessionId && title) sessionTitles.set(sessionId, title)
  }
  function sessionLabel(sessionId) {
    if (!sessionId) return null
    const title = sessionTitles.get(sessionId)
    if (title) return title.length > 42 ? `${title.slice(0, 42)}…` : title
    return `${sessionId.slice(8, 16)}…`
  }

  // ---------- 侧边栏入口 ----------
  const entry = document.createElement('button')
  entry.type = 'button'
  entry.setAttribute(ENTRY_ATTR, '')
  entry.className = 'dshpb-entry'
  entry.setAttribute('aria-label', '进程面板')
  entry.innerHTML = `<span class="dshpb-ico">${ICON}</span><span>进程面板</span>`
  entry.addEventListener('click', toggle)

  const sidebarRoot = () => {
    const col = document.querySelector('[data-pane="sidebar"], [class*="sidebarCol"]')
    if (!col) return undefined
    return col.querySelector('[class*="logoRow"]')?.parentElement ?? col.firstElementChild
  }
  const placeEntry = () => {
    const root = sidebarRoot()
    if (!root) return false
    if (entry.parentElement !== root) {
      const btn = root.querySelector('button[class*="newSession"]') ?? Array.from(root.children).find((el) => el.tagName === 'BUTTON')
      if (!btn) return false
      const family = Array.from(root.children).filter((el) => el instanceof HTMLElement && el.matches(`[${ENTRY_ATTR}],[data-dsh-taskboard-entry],[data-dsh-ssh-entry]`))
      const base = btn.closest('[class*="logoRow"]')
      const anchor = family.length > 0 ? family[0] : (base && base.parentElement === root ? base.nextElementSibling : btn.nextElementSibling)
      root.insertBefore(entry, anchor)
    }
    return true
  }
  const watcher = new MutationObserver(() => { placeEntry() })
  watcher.observe(document.body, { childList: true, subtree: true })
  placeEntry()

  // ---------- 全屏面板 ----------
  let logColOn = false
  let logTarget = null
  let logTimer = null
  const stLabel = { running: '运行中', 'pid-alive': '启动中/未监听', stopped: '已停止', stopping: '停止中…' }

  /** Seconds between the FILETIME epoch (1601) that the scanner reports and the Unix one. */  const FILETIME_TO_UNIX = 11644473600

  /**
   * How long the process has been running, and when it started.
   *
   * `created` is the process's own creation time as FILETIME seconds — seconds since
   * 1601, which is what the PowerShell probe reads, truncated there to the second rather
   * than rounded — so it is shifted to the Unix epoch here. Nothing else is a guess: the
   * value comes from the process itself, and a row recalled from the registry rather than
   * scanned (a service that is already stopped) has no creation time at all, which is why
   * this returns null instead of inventing "0秒".
   *
   * The relative age is what the row shows, because that is the question a list answers
   * at a glance — did this one restart? The absolute time is carried in the title, where
   * it costs no column width in a panel that is 460px wide by default.
   *
   * @param {object} e - one scanned entry, with `created` in FILETIME seconds.
   * @returns {{label: string, startedAt: string, title: string}|null} the age, or null.
   */
  function uptimeOf(e) {
    const startedSeconds = Number(e.created ?? 0) - FILETIME_TO_UNIX
    if (!Number.isFinite(startedSeconds) || startedSeconds <= 0) return null
    const age = Math.max(0, Math.floor(Date.now() / 1000) - startedSeconds)
    const started = new Date(startedSeconds * 1000)
    const pad = (value) => String(value).padStart(2, '0')
    const label = age < 60 ? `${age}秒`
      : age < 3600 ? `${Math.floor(age / 60)}分`
        : age < 86400 ? `${Math.floor(age / 3600)}时${Math.floor((age % 3600) / 60)}分`
          : `${Math.floor(age / 86400)}天${Math.floor((age % 86400) / 3600)}时`
    const startedAt = `${started.getFullYear()}-${pad(started.getMonth() + 1)}-${pad(started.getDate())} `
      + `${pad(started.getHours())}:${pad(started.getMinutes())}:${pad(started.getSeconds())}`
    return { label, startedAt, title: `启动于 ${startedAt}，已运行 ${label}` }
  }
  // kill 在途记账（按 pid）：自动刷新整表重建 DOM 会丢按钮临时态，记账挂 pid
  // 才能跨 render 存活——期间该行状态列乐观显示「停止中…」且按钮不可再点。
  const killing = new Set()

  /** The pending in-panel confirmation, and the timer that hides a note. */
  let confirmResolve = null
  let noteTimer = null
  /** What had the keyboard when the panel opened, so closing can give it back. */
  let focusBeforePanel = null

  /**
   * Ask before stopping a process, inside the panel.
   *
   * This was `window.confirm`, which in the desktop application is a native modal owned
   * by the window rather than by the page: when it closed, keyboard focus went back to
   * the window and not to the composer, so the caret was missing until the session was
   * reopened — reported as 「dsh的输入框老是没有光标了」. The question also carries a
   * replayed command line, which a native box wraps badly.
   *
   * @param {string} message - what is about to happen, with the command when there is one.
   * @returns {Promise<boolean>} true when the user confirmed.
   */
  function askConfirm(message) {
    const bar = panel?.querySelector('.dshpb-confirmbar')
    if (!bar) return Promise.resolve(false)
    settleConfirm(false)
    bar.replaceChildren()
    const text = document.createElement('span')
    text.className = 'dshpb-confirmtext'
    text.textContent = message
    const cancel = document.createElement('button')
    cancel.className = 'dshpb-btn dshpb-confirmno'
    cancel.textContent = '取消'
    const ok = document.createElement('button')
    ok.className = 'dshpb-btn dshpb-confirmyes'
    ok.textContent = '确认'
    cancel.addEventListener('click', () => settleConfirm(false))
    ok.addEventListener('click', () => settleConfirm(true))
    bar.append(text, cancel, ok)
    bar.hidden = false
    ok.focus()
    return new Promise((resolve) => { confirmResolve = resolve })
  }

  /** Answer the pending confirmation (from a button, Escape, or closing the panel). */
  function settleConfirm(answer) {
    const bar = panel?.querySelector('.dshpb-confirmbar')
    if (bar) {
      bar.hidden = true
      bar.replaceChildren()
    }
    const resolve = confirmResolve
    confirmResolve = null
    if (resolve) resolve(answer)
  }

  /**
   * Report a failure in the panel rather than in a native alert.
   *
   * `alert` blocks the whole page and is untestable; it is also the same modal focus
   * problem as the confirmation above. The note goes away on its own, because the row
   * it is about is usually being rebuilt under it by the eight-second refresh.
   */
  function showNote(message) {
    const bar = panel?.querySelector('.dshpb-notebar')
    if (!bar) return
    bar.replaceChildren()
    const text = document.createElement('span')
    text.className = 'dshpb-notetext'
    text.textContent = String(message)
    const close = document.createElement('button')
    close.className = 'dshpb-btn dshpb-noteclose'
    close.textContent = '知道了'
    close.addEventListener('click', () => { bar.hidden = true; bar.replaceChildren() })
    bar.append(text, close)
    bar.hidden = false
    if (noteTimer) clearTimeout(noteTimer)
    noteTimer = setTimeout(() => { bar.hidden = true; bar.replaceChildren() }, 12_000)
  }

  /** The server's current filter, and what can be restored from. */
  let config = { scope: 'all', ports: [], hide: [] }
  let configPath = ''

  /** Read the server's filter so the panel shows what is in force. */
  async function loadConfig() {
    try {
      const res = await fetch(`${API}/config`, { headers: { accept: 'application/json' } })
      const data = await res.json()
      if (data?.ok === true) {
        config = data.config ?? config
        configPath = data.path ?? ''
        renderConfig()
        // The stored width can only be honoured once this response arrives, and the
        // panel is already open by then, so the dock is re-applied here. Without this
        // a dragged width was saved and then ignored on the next load, leaving the
        // panel at its default.
        if (open) applyDock()
      }
    } catch {
      // A missing config endpoint (an older host) simply leaves the defaults.
    }
  }

  /**
   * Save a filter change.
   *
   * The host merges a partial patch, so one field can be sent at a time. A reload
   * follows because the visible set changes: rows appear and disappear, and the
   * count of what was filtered out is worth showing.
   * @param {object} patch - the fields to change.
   */
  async function saveConfig(patch) {
    try {
      const res = await fetch(`${API}/config`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const data = await res.json()
      if (data?.ok !== true) { showNote(data?.error ?? '保存失败'); return }
      config = data.config ?? config
      renderConfig()
      // Confirm in place: a settings panel that saves silently leaves the user unsure
      // whether the click registered, and the change is otherwise only visible as rows
      // appearing or disappearing in the list.
      const status = panel?.querySelector('.dshpb-cfgsaved')
      if (status) {
        status.textContent = '已保存'
        window.setTimeout(() => { if (status.isConnected) status.textContent = '' }, 2400)
      }
      refresh()
    } catch (error) {
      showNote(describeFailure(error))
    }
  }

  /** Parse a comma/space separated list of ports. */
  function parsePorts(text) {
    return [...new Set(String(text ?? '').split(/[,\s]+/).map((part) => Number(part)).filter((port) => Number.isInteger(port) && port > 0 && port <= 65535))]
  }

  /**
   * Draw the filter controls from the current config.
   *
   * Written after the panel listed every listening process on the machine — a cloud
   * drive's helper, system services, even test runners — so the useful rows were
   * buried. The controls state the three filters the host implements.
   */
  function renderConfig() {
    const box = panel?.querySelector('.dshpb-config')
    if (!box) return
    const scopes = [
      { key: 'all', label: '全部监听', hint: '这台机器上每一个正在监听的进程。' },
      { key: 'session', label: '仅 Agent 启动', hint: '只显示带 DSH 会话标记、或属于宿主进程树的服务。' },
    ]
    const activeHint = (scopes.find((scope) => scope.key === config.scope) ?? scopes[0]).hint
    // Each field is a stacked block: label, control, then the sentence explaining what
    // the field does. The first version put the labels in a fixed narrow column beside
    // the controls, and at this panel width the labels overlapped the inputs.
    box.innerHTML = `
      <div class="dshpb-cfghead">筛选显示的服务</div>
      <div class="dshpb-field">
        <div class="dshpb-flabel">显示范围</div>
        <div class="dshpb-seg" role="group" aria-label="显示范围">
          ${scopes.map((scope) => `
            <button type="button" class="dshpb-segbtn" data-scope="${scope.key}"
              aria-pressed="${config.scope === scope.key}" title="${escapeAttr(scope.hint)}"${config.scope === scope.key ? ' data-active="true"' : ''}>${scope.label}</button>`).join('')}
        </div>
        <p class="dshpb-fhint">${escapeHtml(activeHint)}</p>
      </div>
      <div class="dshpb-field">
        <label class="dshpb-flabel" for="dshpb-ports">只看端口</label>
        <input class="dshpb-input" id="dshpb-ports" inputmode="numeric" autocomplete="off"
          placeholder="3306, 5173" value="${escapeAttr(config.ports.join(', '))}">
        <p class="dshpb-fhint">留空表示不限。填了端口后，只显示这些端口上的服务。</p>
      </div>
      <div class="dshpb-field">
        <label class="dshpb-flabel" for="dshpb-hide">排除名称</label>
        <input class="dshpb-input" id="dshpb-hide" autocomplete="off"
          placeholder="baidu, Windows" value="${escapeAttr(config.hide.join(', '))}">
        <p class="dshpb-fhint">按进程名排除，逗号分隔，不区分大小写。</p>
      </div>
      <div class="dshpb-cfgfoot">
        <span class="dshpb-cfgsaved" role="status" aria-live="polite"></span>
        <button type="button" class="dshpb-btn dshpb-btn-primary dshpb-cfgsave" data-act="cfgsave">保存</button>
      </div>
      <p class="dshpb-cfgpath" title="${escapeAttr(configPath)}">配置文件：${escapeHtml(configPath)}</p>`
  }
  /** The narrowest and widest the panel may be dragged, in pixels. */
  const MIN_DOCK = 360
  const MAX_DOCK_MAX = 1000
  /**
   * The docked width.
   *
   * A stored width wins, because the user set it by dragging. Otherwise the column
   * takes a share of the viewport, clamped: the table has six columns and at too
   * narrow a width its header labels break into one character per line.
   */
  function dockWidth() {
    const viewportMax = Math.max(MIN_DOCK, Math.min(MAX_DOCK_MAX, window.innerWidth - 360))
    if (Number.isInteger(config.width) && config.width > 0) {
      return Math.max(MIN_DOCK, Math.min(viewportMax, config.width))
    }
    return Math.max(MIN_DOCK, Math.min(460, Math.round(window.innerWidth * 0.38), viewportMax))
  }
  /** Apply the reserved space at the current viewport size. */
  function applyDock() {
    const width = dockWidth()
    if (panel) panel.style.width = `${width}px`
    const root = document.getElementById('root')
    if (root) root.style.paddingRight = `${width}px`
    document.body.classList.add('dshpb-docked')
    if (grip) grip.setAttribute('aria-valuenow', String(width))
  }
  /** Give the app back the space the panel was occupying. */
  function releaseDock() {
    document.body.classList.remove('dshpb-docked')
    const root = document.getElementById('root')
    if (root) root.style.paddingRight = ''
    if (panel) panel.style.width = ''
  }
  const onViewportResize = () => { if (open) applyDock() }

  /**
   * Drag the panel's left edge to set its width.
   *
   * The panel and the space reserved for it must move together, so the same width
   * drives both. The value is stored on the host after the drag ends, not during it:
   * a write per pointer move would be a request per frame.
   */
  function startGripDrag(event) {
    if (panel === null || grip === null) return
    event.preventDefault()
    const startX = event.clientX
    const startWidth = panel.getBoundingClientRect().width
    const viewportMax = Math.max(MIN_DOCK, Math.min(MAX_DOCK_MAX, window.innerWidth - 360))
    grip.dataset.dragging = 'true'
    document.body.style.userSelect = 'none'
    const onMove = (moveEvent) => {
      // The handle is on the left edge, so dragging left widens the panel.
      const next = Math.round(startWidth + (startX - moveEvent.clientX))
      const width = Math.max(MIN_DOCK, Math.min(viewportMax, next))
      panel.style.width = `${width}px`
      const root = document.getElementById('root')
      if (root) root.style.paddingRight = `${width}px`
      grip.setAttribute('aria-valuenow', String(width))
    }
    const onEnd = () => {
      delete grip.dataset.dragging
      document.body.style.userSelect = ''
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onEnd)
      window.removeEventListener('pointercancel', onEnd)
      const settled = Math.round(panel.getBoundingClientRect().width)
      if (settled !== config.width) void saveConfig({ width: settled })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onEnd)
    window.addEventListener('pointercancel', onEnd)
  }
  /** Keyboard control for the same handle: a drag target nothing can reach is not accessible. */
  function onGripKey(event) {
    if (panel === null) return
    const step = event.key === 'ArrowLeft' ? 24 : event.key === 'ArrowRight' ? -24 : 0
    if (step === 0) return
    event.preventDefault()
    const viewportMax = Math.max(MIN_DOCK, Math.min(MAX_DOCK_MAX, window.innerWidth - 360))
    const width = Math.max(MIN_DOCK, Math.min(viewportMax, Math.round(panel.getBoundingClientRect().width) + step))
    panel.style.width = `${width}px`
    const root = document.getElementById('root')
    if (root) root.style.paddingRight = `${width}px`
    if (grip) grip.setAttribute('aria-valuenow', String(width))
  }
  function toggle() {
    open = !open
    if (open) {
      // Remember what had the keyboard before the panel took it. The entry is a button
      // in the sidebar and the panel's own controls are focusable, so closing used to
      // leave focus on a hidden button (which the browser then drops on <body>): the
      // caret was gone from whatever the user was typing in, until they clicked it
      // again — or reopened the session, as the report put it.
      focusBeforePanel = document.activeElement instanceof HTMLElement ? document.activeElement : null
      buildPanel()
      panel.classList.add('dshpb-open')
      // Reserve the space instead of covering the app: the whole interface
      // narrows and slides left while the panel is open.
      applyDock()
      window.addEventListener('resize', onViewportResize)
      mask.style.display = 'block'
      entry.dataset.active = 'true'
      void loadConfig()
      refresh()
      refreshTimer = setInterval(refresh, 8_000)
    } else {
      closePanel()
    }
  }
  function closePanel() {
    open = false
    // A pending question dies with the panel: leaving its promise unresolved would leak
    // the click that is awaiting it.
    settleConfirm(false)
    panel?.classList.remove('dshpb-open')
    releaseDock()
    window.removeEventListener('resize', onViewportResize)
    if (mask) mask.style.display = 'none'
    delete entry.dataset.active
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = undefined }
    stopLogStream()
    // Give the keyboard back where it was, if that element is still in the document.
    // Deliberately not conditioned on which element it was: the panel does not need to
    // know the application's DOM to undo its own focus theft, and an element that has
    // been re-rendered away is simply skipped.
    const previous = focusBeforePanel
    focusBeforePanel = null
    if (previous !== null && previous.isConnected && typeof previous.focus === 'function') {
      previous.focus({ preventScroll: true })
    }
  }
  function buildPanel() {
    if (panel) return
    mask = document.createElement('div')
    mask.className = 'dshpb-mask'
    mask.style.display = 'none'
    mask.addEventListener('click', closePanel)
    panel = document.createElement('div')
    panel.className = 'dshpb-panel'
    panel.innerHTML = `
      <div class="dshpb-dialog" role="dialog" aria-label="Agent 服务面板">
        <div class="dshpb-grip" role="separator" aria-orientation="vertical" tabindex="0"
          aria-label="拖动调整面板宽度" title="拖动调整宽度（也可用左右方向键）"></div>
        <div class="dshpb-head">
          <div><b>Agent 服务面板</b><small class="dshpb-sub">由 DSH 会话启动的服务 · 三态探测 · 可启停/看日志</small></div>
          <div class="dshpb-headbtns">
            <button class="dshpb-btn dshpb-cfgtoggle" aria-expanded="false" title="选择要监控哪些服务">筛选</button>
            <button class="dshpb-maxbtn dshpb-panel-max" title="全屏/还原" aria-label="全屏">⛶</button>
            <button class="dshpb-close" aria-label="关闭">×</button>
          </div>
        </div>
        <div class="dshpb-confirmbar" hidden></div>
        <div class="dshpb-notebar" hidden></div>
        <div class="dshpb-config" hidden></div>
        <div class="dshpb-layout">
          <div class="dshpb-list-col dshpb-tablewrap"><div class="dshpb-empty">扫描中…</div></div>
          <div class="dshpb-log-col">
            <div class="dshpb-log-head">
              <div><b class="dshpb-log-title">日志</b><small class="dshpb-log-path"></small></div>
              <div class="dshpb-headbtns">
                <button class="dshpb-maxbtn dshpb-log-maxbtn" title="日志全屏/还原" aria-label="日志全屏">⛶</button>
                <button class="dshpb-close dshpb-log-close" aria-label="关闭日志">×</button>
              </div>
            </div>
            <div class="dshpb-log-body">选择带「日志」按钮的服务查看输出</div>
          </div>
        </div>
      </div>`
    panel.querySelector('.dshpb-close:not(.dshpb-log-close)').addEventListener('click', closePanel)
    panel.querySelector('.dshpb-log-close').addEventListener('click', () => hideLog())
    // 面板全屏/还原（Esc 逐级退出：日志全屏 → 面板全屏 → 关闭）
    panel.querySelector('.dshpb-panel-max').addEventListener('click', () => {
      panel.querySelector('.dshpb-dialog').classList.toggle('dshpb-max')
    })
    // 日志全屏/还原（覆盖整个 dialog，服务列表暂时隐藏）
    panel.querySelector('.dshpb-log-maxbtn').addEventListener('click', () => {
      const layout = panel.querySelector('.dshpb-layout')
      layout.classList.toggle('dshpb-log-max')
    })
    document.body.addEventListener('keydown', panelEscHandler)
    document.body.append(mask, panel)

    // --- the filter controls -------------------------------------------------
    const configBox = panel.querySelector('.dshpb-config')
    const configToggle = panel.querySelector('.dshpb-cfgtoggle')
    configToggle.addEventListener('click', () => {
      const showing = !configBox.hasAttribute('hidden')
      if (showing) configBox.setAttribute('hidden', '')
      else configBox.removeAttribute('hidden')
      configToggle.setAttribute('aria-expanded', String(!showing))
      renderConfig()
    })
    // --- the width handle ----------------------------------------------------
    grip = panel.querySelector('.dshpb-grip')
    if (grip) {
      grip.addEventListener('pointerdown', startGripDrag)
      grip.addEventListener('keydown', onGripKey)
    }
    configBox.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target : null
      if (target === null) return
      const scope = target.closest('[data-scope]')?.getAttribute('data-scope')
      if (scope !== null && scope !== undefined) {
        void saveConfig({ scope })
        return
      }
      if (target.closest('[data-act="cfgsave"]') !== null) {
        void saveConfig({
          ports: parsePorts(configBox.querySelector('#dshpb-ports')?.value),
          hide: String(configBox.querySelector('#dshpb-hide')?.value ?? '')
            .split(',')
            .map((part) => part.trim())
            .filter((part) => part !== ''),
        })
      }
    })

    // The panel's close control sits in the top-right corner, a few pixels from the
    // window's own close button, and both read as "×". Re-label this one as a
    // collapse so the two are never mistaken for each other: the window closes the
    // application, this only docks the panel away. Done here rather than in the
    // markup above so the template stays as published.
    const closeControl = panel.querySelector('.dshpb-close:not(.dshpb-log-close)')
    if (closeControl) {
      closeControl.setAttribute('aria-label', '收起服务面板')
      closeControl.setAttribute('title', '收起服务面板（不影响 DSH 窗口）')
      closeControl.textContent = '收起'
      closeControl.classList.add('dshpb-collapse', 'dshpb-btn-primary')
    }
    const logClose = panel.querySelector('.dshpb-log-close')
    if (logClose) {
      logClose.setAttribute('aria-label', '收起日志')
      logClose.setAttribute('title', '收起日志')
    }
  }
  function panelEscHandler(ev) {
    if (ev.key !== 'Escape' || !open) return
    // Escape answers a pending question first: it is the topmost thing on screen.
    if (confirmResolve !== null) { ev.preventDefault(); settleConfirm(false); return }
    const layout = panel?.querySelector('.dshpb-layout')
    if (layout?.classList.contains('dshpb-log-max')) { layout.classList.remove('dshpb-log-max'); return }
    if (panel?.querySelector('.dshpb-dialog')?.classList.contains('dshpb-max')) { panel.querySelector('.dshpb-dialog').classList.remove('dshpb-max'); return }
    closePanel()
  }

  async function refresh() {
    const body = panel?.querySelector('.dshpb-list-col')
    if (!body) return
    try {
      const res = await fetch(`${API}/state`, { headers: { accept: 'application/json' } })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      // 收 host 注入的会话标题（读自 DSH sessionTitle 服务，与 GUI 侧边栏一致）
      for (const e of data.entries ?? []) rememberTitle(e.session, e.sessionTitle)
      render(body, data)
      const sub = panel.querySelector('.dshpb-sub')
      if (sub) sub.textContent = `由 DSH 会话启动的服务 · 更新于 ${new Date(data.at).toLocaleTimeString()}`
    } catch (error) {
      body.innerHTML = `<div class="dshpb-err">加载失败：${String(error?.message ?? error)}（host 插件未启用？）</div>`
    }
  }

  function render(body, data) {
    if (data.error) {
      body.innerHTML = `<div class="dshpb-err">扫描错误：${escapeHtml(data.error)}</div>`
      return
    }
    const entries = data.entries ?? []
    if (!entries.length) {
      body.innerHTML = '<div class="dshpb-empty">当前没有由 Agent 启动的服务<br><span style="font-size:12px">（仅展示监听端口或带日志标记的进程）</span></div>'
      return
    }
    const groups = new Map()
    for (const e of entries) {
      const key = e.session ?? '(host)'
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(e)
    }
    const table = document.createElement('table')
    table.className = 'dshpb-table'
    table.innerHTML = '<thead><tr><th>服务</th><th>状态</th><th>端口</th><th>HTTP</th><th>PID</th><th>操作</th></tr></thead>'
    const tb = document.createElement('tbody')
    const rank = (s) => (s && s.startsWith('session-') ? 0 : 1)
    for (const [session, list] of [...groups.entries()].sort((a, b) => rank(a[0]) - rank(b[0]))) {
      const isSession = session.startsWith('session-')
      const gr = document.createElement('tr')
      gr.className = 'dshpb-grouprow'
      const cell = document.createElement('td')
      cell.colSpan = 6
      cell.innerHTML = `<span>${escapeHtml(sessionLabel(session) ?? '宿主进程')}</span>` +
        (isSession ? '<span class="dshpb-gtag">会话</span>' : '<span class="dshpb-gtag" style="background:rgba(154,163,178,.15);color:#9aa3b2">宿主</span>')
      gr.append(cell)
      tb.append(gr)
      for (const e of list) tb.append(row(e))
    }
    table.append(tb)
    body.replaceChildren(table)
    // Keep the open log attached to its service across a restart, then re-derive the
    // mark: the rows above are new elements, so a mark on the old ones left with them.
    retargetLog(entries)
    markLogSource()
  }

  /**
   * Follow the open log band across a restart.
   *
   * A restart is a stop and a start, so the service comes back with a new pid. The band
   * was opened on the old one, and once that pid leaves the scan the four-second poll
   * asks the host for a process it no longer has: 404 no-log, and the band — which was
   * showing a live log a moment earlier — turns into 「日志不可用」 while the same service,
   * writing to the same file, sits one row below under a new pid (reported exactly that
   * way: 「我重启之后显示不可用」). So the band follows the service rather than the pid: a
   * row with the same name and a port in common, else the same name, else the same log
   * file. Nothing is assumed when none of those matches — a stopped service keeps its
   * last log on screen.
   *
   * @param {object[]} entries - the entries just rendered.
   */
  function retargetLog(entries) {
    if (!logColOn || logTarget === null) return
    if (entries.some((e) => e.pid === logTarget.pid)) return
    const sameNameAndPort = entries.find((e) => e.name === logTarget.name
      && (e.ports ?? []).some((port) => (logTarget.ports ?? []).includes(port)))
    const sameName = entries.find((e) => e.name === logTarget.name)
    const sameFile = logTarget.logPath
      ? entries.find((e) => e.logPath === logTarget.logPath)
      : undefined
    const replacement = sameNameAndPort ?? sameName ?? sameFile
    if (replacement === undefined) return
    logTarget = replacement
    panel.querySelector('.dshpb-log-title').textContent = `${replacement.name} · pid ${replacement.pid}`
    panel.querySelector('.dshpb-log-path').textContent = replacement.logPath ?? ''
    void loadLogOnce()
  }

  /**
   * The port column: one tag per listening socket, carrying the bound address.
   *
   * The shipped panel showed only `:3306`, so a service bound to `127.0.0.1` and one
   * bound to every interface looked identical — and the address is what decides
   * whether the service is reachable from another machine. A wildcard bind is
   * labelled `0.0.0.0` and gets a title naming that meaning, because the bare
   * address reads like a typo.
   * @param {object} e - one scanned entry.
   * @returns {string} the cell's HTML.
   */
  function bindTags(e) {
    const binds = Array.isArray(e.binds) && e.binds.length > 0
      ? e.binds
      : (e.ports ?? []).map((port) => ({ addr: '', port }))
    if (binds.length === 0) return '<span class="dshpb-code" style="color:#6b7280">—</span>'
    const tags = binds.map((bind) => {
      const wildcard = bind.addr === '0.0.0.0' || bind.addr === '::' || bind.addr === ''
      const label = wildcard ? `0.0.0.0:${bind.port}` : `${bind.addr}:${bind.port}`
      const title = wildcard
        ? `0.0.0.0:${bind.port} — 监听全部网卡，局域网内其他设备可访问`
        : `${bind.addr}:${bind.port} — 仅该地址可访问`
      return `<span class="dshpb-port${wildcard ? ' dshpb-port-any' : ''}" title="${escapeAttr(title)}">${escapeHtml(label)}</span>`
    }).join('')
    // One wrapper per cell, so several tags wrap inside the cell instead of widening
    // the column past the panel's edge.
    return `<span class="dshpb-portcell">${tags}</span>`
  }

  function row(e) {
    const tr = document.createElement('tr')
    // The row carries its pid so the log's source row can be found again after the
    // eight-second refresh has rebuilt every row (see markLogSource).
    tr.dataset.pid = String(e.pid)
    const cmdShort = (e.cmd ?? '').replace(/^"?"?[\w:\\.\-]+\s*/, '').slice(0, 70)
    const state = killing.has(e.pid) ? 'stopping' : e.state   // kill 在途乐观接管状态列
    const c1 = document.createElement('td')
    c1.innerHTML = `<span class="dshpb-svcname">${escapeHtml(e.name)}</span>` +
      (cmdShort ? `<span class="dshpb-svccmd" title="${escapeAttr(e.cmd ?? '')}">${escapeHtml(cmdShort)}</span>` : '')
    const c2 = document.createElement('td')
    c2.className = 'dshpb-statecell'
    // The state, and under it how long it has been in it. The row is two lines tall
    // already (the service name sits above its command), so the second line here costs
    // no height, and a seventh column would only be dropped by the narrow-width rules
    // that already hide HTTP and PID.
    const uptime = uptimeOf(e)
    c2.innerHTML = `<span class="dshpb-dot dshpb-${state}"></span><span class="dshpb-st-${state}">${stLabel[state] ?? state}</span>`
      + (uptime === null ? '' : `<span class="dshpb-uptime" title="${escapeAttr(uptime.title)}">${escapeHtml(uptime.label)}</span>`)
    const c3 = document.createElement('td')
    c3.innerHTML = bindTags(e)
    const c4 = document.createElement('td')
    if (e.http != null && e.ports?.length) {
      c4.innerHTML = e.http > 0
        ? `<span class="dshpb-http-ok">${e.http}</span>`
        : '<span class="dshpb-http-dead">✗</span>'
    } else { c4.innerHTML = '<span class="dshpb-code" style="color:#6b7280">—</span>' }
    const c5 = document.createElement('td')
    c5.innerHTML = `<span class="dshpb-code">${e.pid}</span>`
    const c6 = document.createElement('td')
    const operable = e.state === 'running' || e.state === 'pid-alive'
    if (killing.has(e.pid)) {
      // 在途停止：整格只显示一个禁用的「停止中…」，不再叠加 日志/停止 按钮
      const kb = document.createElement('button')
      kb.className = 'dshpb-btn'
      kb.disabled = true
      kb.textContent = '停止中…'
      c6.append(kb)
    } else if (e.serviceOwned) {
      // A Windows service cannot be stopped from here: the Service Control Manager
      // owns it and restarts it immediately, which is exactly what "I closed it and
      // it started itself again" was. Saying so plainly is better than offering a
      // button that appears to work and then looks like a bug.
      const note = document.createElement('button')
      note.className = 'dshpb-btn dshpb-btn-service'
      note.disabled = true
      note.textContent = 'Windows 服务'
      note.title = '由 Windows 服务管理器持有：结束进程后它会立即自动重启。要停止它请用「服务」管理器，或执行 net stop 服务名。'
      c6.append(note)
      if (e.logPath) c6.append(btn('日志', 'log', e, ''))
    } else {
      if (e.logPath) c6.append(btn('日志', 'log', e, ''))
      // A restart is offered only where it can actually succeed: the scanner must
      // have read a command line to replay. Without one the button is absent rather
      // than present-and-failing, which is what the shipped panel did.
      if (operable && splitCommandLine(e.cmd).length > 0) {
        c6.append(btn('重启', 'restart', e, ''))
      }
      c6.append(operable
        ? btn('停止', 'kill', e, 'dshpb-btn-danger')
        : btn('启动', 'start', e, 'dshpb-btn-primary'))
    }
    tr.append(c1, c2, c3, c4, c5, c6)
    return tr
  }

  function btn(label, action, e, cls) {
    const b = document.createElement('button')
    b.className = `dshpb-btn ${cls}`
    b.textContent = label
    b.addEventListener('click', async () => {
      if (action === 'log') { showLog(e); return }
      if (action === 'kill' && !(await askConfirm(`确定停止 ${e.name} (pid ${e.pid}) 及其子进程？`))) return
      if (action === 'restart') {
        // Confirmed once, because it stops a running process. The command being
        // replayed is shown so the decision is informed rather than a leap of faith.
        const argv = splitCommandLine(e.cmd)
        const shown = argv.map((part) => (part.includes(' ') ? `"${part}"` : part)).join(' ')
        if (!(await askConfirm(`重启 ${e.name}（pid ${e.pid}）？\n会先停止当前进程，然后按原命令行重新启动：\n${shown}`))) return
        b.disabled = true
        b.textContent = '重启中…'
        try {
          if (e.state === 'running' || e.state === 'pid-alive') {
            const stop = await fetch(`${API}/kill`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pid: e.pid }) })
            const stopData = await stop.json()
            if (!stopData.ok) { showNote(stopData.error ?? '停止失败'); return }
          }
          const start = await fetch(`${API}/start`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              name: serviceName(e),
              argv,
              cwd: guessCwd(e.cmd),
              ...(e.logPath ? { logFile: e.logPath } : {}),
              ...(e.ports?.length ? { port: e.ports[0] } : {}),
            }),
          })
          const startData = await start.json()
          if (!startData.ok) { showNote(startData.error ?? '启动失败'); return }
        } catch (error) {
          showNote(String(error?.message ?? error))
        } finally {
          setTimeout(refresh, 900)
        }
        return
      }
      if (action === 'kill') {
        killing.add(e.pid)
        refresh()   // 立即重渲染：状态列显示「停止中…」，防 8s 自动刷新期间重复点击
      }
      b.disabled = true
      const old = b.textContent
      b.textContent = '执行中…'
      try {
        if (action === 'kill') {
          const res = await fetch(`${API}/kill`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pid: e.pid }) })
          const data = await res.json()
          killing.delete(e.pid)
          if (!data.ok) throw new Error(data.error ?? res.status)
          refresh()   // host 已等扫描收敛，立即刷新即见最终态
          return
        } else {
          const name = serviceName(e)
          // The host's /start accepts an explicit argv and spawns it detached with a
          // log file, which is exactly what a restart needs. Sending the command line
          // the scanner read is what makes "启动" work at all: for a discovered
          // service the host has no stored argv, so a name-only request could only
          // ever answer no-argv.
          const argv = splitCommandLine(e.cmd)
          const res = await fetch(`${API}/start`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              name,
              ...(argv.length > 0 ? { argv, cwd: guessCwd(e.cmd) } : {}),
              ...(e.logPath ? { logFile: e.logPath } : {}),
              ...(e.ports?.length ? { port: e.ports[0] } : {}),
            }),
          })
          const data = await res.json()
          if (!data.ok) { showNote(data.error ?? '启动失败'); return }
        }
      } catch (error) {
        killing.delete(e.pid)   // 异常路径也要清在途记账，避免行永久卡「停止中…」
        showNote(describeFailure(error))
      } finally {
        // Restore the control unconditionally. The shipped code restored it only when
        // the button was not disabled, but it disables the button a few lines above —
        // so a successful kill (which returns early) or a failed one left the button
        // disabled with "执行中…" forever, which is what "点了没反应" looked like
        // after the first click.
        b.disabled = false
        b.textContent = old
        setTimeout(refresh, 800)
      }
    })
    return b
  }

  /**
   * Turn a failure into one readable sentence.
   *
   * A rejected `execFile` stringifies to "Command failed: powershell.exe -NoProfile
   * …" — the whole command line. That is what the panel used to show in an alert
   * when a stop failed, which tells the user nothing and hides the actual cause.
   * @param {unknown} error - whatever was thrown.
   * @returns {string} a short Chinese sentence naming the likely cause.
   */
  function describeFailure(error) {
    const raw = String(error?.message ?? error ?? '')
    if (/Command failed|powershell\.exe/i.test(raw)) {
      if (/timeout|timed out/i.test(raw)) return '操作超时：系统在限定时间内没有完成。请稍后重试。'
      return '系统命令执行失败，进程可能已结束或需要更高权限。请刷新后重试。'
    }
    if (/Failed to fetch|NetworkError|load failed/i.test(raw)) return '无法连接宿主插件：请确认 DSH 正在运行，然后重试。'
    if (/401|403/.test(raw)) return '请求被拒绝：请从 DSH 打印的地址重新打开界面。'
    return raw.length > 160 ? `${raw.slice(0, 160)}…` : raw
  }
  /**
   * Split a Windows command line into argv, mirroring the host's parser.
   *
   * Both halves need it: the host stores the arguments for its own restart path,
   * and the client sends them explicitly because that is the /start contract. The
   * two copies are pinned by the same test cases.
   * @param {string} commandLine - the raw command line from the scanner.
   * @returns {string[]} the arguments.
   */
  function splitCommandLine(commandLine) {
    const text = String(commandLine ?? '')
    const args = []
    let current = ''
    let inQuotes = false
    let started = false
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i]
      if (ch === '\\') {
        let slashes = 0
        while (text[i] === '\\') { slashes += 1; i += 1 }
        const next = text[i]
        if (next === '"') {
          current += '\\'.repeat(Math.floor(slashes / 2))
          if (slashes % 2 === 1) current += '"'
          else { inQuotes = !inQuotes; started = true }
          continue
        }
        current += '\\'.repeat(slashes)
        i -= 1
        continue
      }
      if (ch === '"') { inQuotes = !inQuotes; started = true; continue }
      if (!inQuotes && (ch === ' ' || ch === '\t')) {
        if (started || current !== '') { args.push(current); current = ''; started = false }
        continue
      }
      current += ch
      started = true
    }
    if (started || current !== '') args.push(current)
    return args
  }

  /** The working directory a command line implies, when it names a path. */
  function guessCwd(commandLine) {
    const match = /([A-Za-z]:\\[^\s"']+?\\[\w.\-]+(?:\\[\w.\-]+)*)/.exec(commandLine ?? '')
    if (!match) return null
    const parts = match[1].split('\\')
    parts.pop()
    const dir = parts.join('\\')
    return dir.length > 3 ? dir : null
  }

  function serviceName(e) {    const m = /([\w.\-]+)\.(jar|mjs)$/.exec(e.cmd ?? '')
    if (m) return m[1]
    if (/webpack-dev-server/.test(e.cmd ?? '')) return 'dev-server-' + (e.ports?.[0] ?? e.pid)
    if (/nginx/i.test(e.name)) return 'nginx-' + (e.ports?.[0] ?? e.pid)
    if (/java/i.test(e.name)) return 'java-' + (e.ports?.[0] ?? e.pid)
    return `${e.name.replace(/\.exe$/i, '')}-${e.ports?.[0] ?? e.pid}`
  }

  // ---------- 日志分栏（面板底部的横条）----------
  /** The rendered rows of the service list. */
  function logRows() {
    const list = panel?.querySelector('.dshpb-list-col')
    return list === undefined || list === null ? [] : [...list.querySelectorAll('.dshpb-table tbody tr')]
  }
  /**
   * Mark the row whose log the band is showing.
   *
   * The mark cannot live on the element that was clicked: the eight-second refresh
   * rebuilds every row, so it is re-derived from the log's pid after each render. That
   * is also what makes clicking a second service's 日志 move the mark, instead of
   * leaving two rows claiming the band.
   * @param reveal - scroll the row back into view, for a click that may have pushed it
   *   out of the shortened list. Not done on the periodic refresh, which would yank the
   *   list while the user is reading it.
   */
  let markedPid = null
  function markLogSource(reveal = false) {
    const wanted = logColOn && logTarget ? String(logTarget.pid) : null
    for (const tr of logRows()) {
      const isSource = wanted !== null && tr.dataset.pid === wanted
      tr.classList.toggle('dshpb-logging', isSource)
      if (isSource) tr.setAttribute('aria-current', 'true')
      else tr.removeAttribute('aria-current')
    }
    if (reveal && wanted !== null && wanted !== markedPid) {
      const row = logRows().find((tr) => tr.dataset.pid === wanted)
      if (row && typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest' })
    }
    markedPid = wanted
  }
  function showLog(e) {
    logTarget = e
    logColOn = true
    panel.querySelector('.dshpb-log-col')?.classList.add('dshpb-log-on')
    panel.querySelector('.dshpb-log-title').textContent = `${e.name} · pid ${e.pid}`
    panel.querySelector('.dshpb-log-path').textContent = e.logPath ?? ''
    markLogSource(true)
    void loadLogOnce()
    stopLogStream()
    logTimer = setInterval(() => { if (logColOn) void loadLogOnce() }, 4000)
  }
  function hideLog() {
    logColOn = false
    logTarget = null
    stopLogStream()
    panel.querySelector('.dshpb-log-col')?.classList.remove('dshpb-log-on')
    panel.querySelector('.dshpb-layout')?.classList.remove('dshpb-log-max')
    markLogSource()
  }
  function stopLogStream() { if (logTimer) { clearInterval(logTimer); logTimer = null } }
  async function loadLogOnce() {
    const bodyEl = panel?.querySelector('.dshpb-log-body')
    if (!bodyEl || !logTarget) return
    try {
      const res = await fetch(`${API}/log`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pid: logTarget.pid, lines: 400 }),
      })
      const data = await res.json()
      if (!data.ok) {
        // no-log means the host's latest scan has nothing for this pid: the process is
        // gone (stopped, or restarted with its replacement not in the list yet). Repeating
        // the host's error code at the user is what 「日志不可用：no-log」 was; the honest
        // statement is about the process, which is what the user is looking at.
        bodyEl.textContent = data.error === 'no-log'
          ? `进程已结束或正在重启，日志不再更新（pid ${logTarget.pid}）`
          : `日志不可用：${data.error ?? res.status}`
        return
      }
      const nearBottom = bodyEl.scrollHeight - bodyEl.scrollTop - bodyEl.clientHeight < 60
      bodyEl.replaceChildren(...data.lines.map((line) => {
        const d = document.createElement('div')
        if (/\b(ERROR|Exception|FATAL)\b/.test(line)) d.className = 'dshpb-logline-err'
        else if (/\b(WARN)\b/.test(line)) d.className = 'dshpb-logline-warn'
        // The leading timestamp is split out so it can be dimmed: it is the one part of
        // a log line that is always the same shape, and leaving it at full strength made
        // every line look alike. Anything unrecognised stays in the message, so nothing
        // is ever dropped from a log.
        const stamped = /^(\[[^\]\n]{1,40}\]\s*)([\s\S]*)$/.exec(line ?? '')
        if (stamped === null) {
          d.textContent = line || ' '
          return d
        }
        const when = document.createElement('span')
        when.className = 'dshpb-log-time'
        when.textContent = stamped[1]
        d.append(when, document.createTextNode(stamped[2] || ' '))
        return d
      }))
      if (nearBottom) bodyEl.scrollTop = bodyEl.scrollHeight
    } catch (error) {
      bodyEl.textContent = `加载失败：${String(error?.message ?? error)}`
    }
  }

  ctx.effect(() => () => {
    watcher.disconnect()
    if (refreshTimer) clearInterval(refreshTimer)
    stopLogStream()
    document.body.removeEventListener('keydown', panelEscHandler)
    entry.remove()
    mask?.remove()
    panel?.remove()
  }, 'process-board: client surfaces')
}

function injectCss() {
  if (document.getElementById('dshpb-style')) return
  const style = document.createElement('style')
  style.id = 'dshpb-style'
  style.textContent = CSS
  document.head.append(style)
}

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const escapeAttr = escapeHtml

return { apply }
  },
})
