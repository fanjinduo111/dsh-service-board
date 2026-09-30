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
window.__ModuleLoader__.load({
  id: 'dsh-process-board',
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
.dshpb-code { font-family:Consolas,Menlo,monospace; font-size:12px; color:#c9d1d9; }
.dshpb-http-ok { color:#4ade80; font-weight:600; } .dshpb-http-dead { color:#e05252; font-weight:600; }
.dshpb-port { display:inline-block; background:rgba(63,146,254,.15); color:#5ba4ff; border-radius:4px; padding:1px 7px; font-family:Consolas,monospace; font-size:12px; margin-right:4px; }
.dshpb-svcname { font-weight:600; }
.dshpb-svccmd { display:block; color:#8b93a1; font-size:11px; font-family:Consolas,monospace; max-width:380px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin-top:2px; }
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
.dshpb-log-body { flex:1; overflow:auto; padding:10px 16px 14px; font-family:Consolas,'Courier New',monospace; font-size:12px; line-height:1.6; white-space:pre-wrap; word-break:break-all; background:#16181f; }
.dshpb-logline-err { color:#e05252; }
.dshpb-logline-warn { color:#e0a052; }
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
body.dshpb-docked .dshpb-panel > .dshpb-dialog { width:100%; min-width:0; height:100vh; max-height:100vh;
  border-radius:0; border:0; border-left:1px solid rgba(127,127,127,.25);
  box-shadow:-16px 0 40px rgba(0,0,0,.35); }
/* At this width two side-by-side columns would each be too narrow to read, so the
   log takes the whole panel and the list hides while it is open. */
.dshpb-list-col { flex:1 1 auto; min-width:0; border-right:0; }
.dshpb-log-col { flex:1 1 auto; min-width:0; }
.dshpb-log-col.dshpb-log-on { flex:1 1 100%; }
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
body.dshpb-docked .dshpb-list-col { border-right-color:var(--dsw-alias-border-l1,rgba(127,127,127,.18)); }
body.dshpb-docked .dshpb-table th { background:var(--dsw-alias-bg-base,#1e222a); color:var(--dsw-alias-label-caption,#8b93a1);
  border-bottom-color:var(--dsw-alias-border-l2,rgba(127,127,127,.25)); }
body.dshpb-docked .dshpb-table td { border-bottom-color:var(--dsw-alias-border-l1,rgba(127,127,127,.12)); }
body.dshpb-docked .dshpb-table tr:hover td { background:var(--dsw-alias-fill-l1,rgba(127,127,127,.06)); }
body.dshpb-docked .dshpb-grouprow td { background:var(--dsw-alias-fill-l1,rgba(127,127,127,.04)); color:var(--dsw-alias-label-dimmed,#9aa3b2); }
body.dshpb-docked .dshpb-log-body { background:var(--dsw-alias-bg-l2,#16181f); color:var(--dsw-alias-label-primary,#e6e8ec); }
body.dshpb-docked .dshpb-close,
body.dshpb-docked .dshpb-maxbtn { color:var(--dsw-alias-label-caption,#8b93a1); }
body.dshpb-docked .dshpb-close:hover,
body.dshpb-docked .dshpb-maxbtn:hover { background:var(--dsw-alias-fill-l2,rgba(127,127,127,.15)); color:var(--dsw-alias-label-primary,#fff); }
body.dshpb-docked .dshpb-btn { color:var(--dsw-alias-label-primary,#e6e8ec); border-color:var(--dsw-alias-border-l2,rgba(127,127,127,.3)); }
body.dshpb-docked .dshpb-btn:hover { background:var(--dsw-alias-fill-l2,rgba(127,127,127,.15)); }
/* The header sits against the window's own controls, so keep its padding and give
   the collapse control room to breathe away from the corner. */
body.dshpb-docked .dshpb-head { padding:12px 14px; }
body.dshpb-docked .dshpb-headbtns { gap:6px; }
/* The collapse control is a text button, not a glyph, so it cannot be confused
   with the window's own close button a few pixels away in the same corner. */
.dshpb-close.dshpb-collapse { font-size:12px; padding:4px 10px; line-height:1.4; }
`

function apply(ctx) {
  if (typeof document === 'undefined') return
  if (document.querySelector(`[${ENTRY_ATTR}]`)) return

  injectCss()
  let open = false
  let panel
  let mask
  let refreshTimer
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
  // kill 在途记账（按 pid）：自动刷新整表重建 DOM 会丢按钮临时态，记账挂 pid
  // 才能跨 render 存活——期间该行状态列乐观显示「停止中…」且按钮不可再点。
  const killing = new Set()

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
      if (data?.ok !== true) { alert(data?.error ?? '保存失败'); return }
      config = data.config ?? config
      renderConfig()
      refresh()
    } catch (error) {
      alert(describeFailure(error))
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
    box.innerHTML = `
      <div class="dshpb-cfgrow">
        <label class="dshpb-cfglabel">显示范围</label>
        <button class="dshpb-btn dshpb-scope" data-scope="all" ${config.scope === 'all' ? 'disabled' : ''}>全部监听</button>
        <button class="dshpb-btn dshpb-scope" data-scope="session" ${config.scope === 'session' ? 'disabled' : ''}>仅 Agent 启动</button>
      </div>
      <div class="dshpb-cfgrow">
        <label class="dshpb-cfglabel" for="dshpb-ports">只看端口</label>
        <input class="dshpb-input" id="dshpb-ports" placeholder="如 3306, 5173（留空=不限）" value="${escapeAttr(config.ports.join(', '))}">
      </div>
      <div class="dshpb-cfgrow">
        <label class="dshpb-cfglabel" for="dshpb-hide">排除名称</label>
        <input class="dshpb-input" id="dshpb-hide" placeholder="如 baidu, Windows（逗号分隔）" value="${escapeAttr(config.hide.join(', '))}">
      </div>
      <div class="dshpb-cfgfoot">
        <button class="dshpb-btn dshpb-btn-primary" data-act="cfgsave">保存</button>
        <span class="dshpb-cfghint">${configPath ? `配置文件：${escapeHtml(configPath)}` : ''}</span>
      </div>`
  }
  function dockWidth() {
    return Math.max(360, Math.round(Math.min(560, window.innerWidth * 0.46)))
  }
  /** Apply the reserved space at the current viewport size. */
  function applyDock() {
    const width = dockWidth()
    if (panel) panel.style.width = `${width}px`
    const root = document.getElementById('root')
    if (root) root.style.paddingRight = `${width}px`
    document.body.classList.add('dshpb-docked')
  }
  /** Give the app back the space the panel was occupying. */
  function releaseDock() {
    document.body.classList.remove('dshpb-docked')
    const root = document.getElementById('root')
    if (root) root.style.paddingRight = ''
    if (panel) panel.style.width = ''
  }
  const onViewportResize = () => { if (open) applyDock() }
  function toggle() {
    open = !open
    if (open) {
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
    panel?.classList.remove('dshpb-open')
    releaseDock()
    window.removeEventListener('resize', onViewportResize)
    if (mask) mask.style.display = 'none'
    delete entry.dataset.active
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = undefined }
    stopLogStream()
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
        <div class="dshpb-head">
          <div><b>Agent 服务面板</b><small class="dshpb-sub">由 DSH 会话启动的服务 · 三态探测 · 可启停/看日志</small></div>
          <div class="dshpb-headbtns">
            <button class="dshpb-btn dshpb-cfgtoggle" aria-expanded="false" title="选择要监控哪些服务">筛选</button>
            <button class="dshpb-maxbtn dshpb-panel-max" title="全屏/还原" aria-label="全屏">⛶</button>
            <button class="dshpb-close" aria-label="关闭">×</button>
          </div>
        </div>
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
      closeControl.classList.add('dshpb-collapse')
    }
    const logClose = panel.querySelector('.dshpb-log-close')
    if (logClose) {
      logClose.setAttribute('aria-label', '收起日志')
      logClose.setAttribute('title', '收起日志')
    }
  }
  function panelEscHandler(ev) {
    if (ev.key !== 'Escape' || !open) return
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
    return binds.map((bind) => {
      const wildcard = bind.addr === '0.0.0.0' || bind.addr === '::' || bind.addr === ''
      const label = wildcard ? `0.0.0.0:${bind.port}` : `${bind.addr}:${bind.port}`
      const title = wildcard
        ? `0.0.0.0:${bind.port} — 监听全部网卡，局域网内其他设备可访问`
        : `${bind.addr}:${bind.port} — 仅该地址可访问`
      return `<span class="dshpb-port${wildcard ? ' dshpb-port-any' : ''}" title="${escapeAttr(title)}">${escapeHtml(label)}</span>`
    }).join('')
  }

  function row(e) {
    const tr = document.createElement('tr')
    const cmdShort = (e.cmd ?? '').replace(/^"?"?[\w:\\.\-]+\s*/, '').slice(0, 70)
    const state = killing.has(e.pid) ? 'stopping' : e.state   // kill 在途乐观接管状态列
    const c1 = document.createElement('td')
    c1.innerHTML = `<span class="dshpb-svcname">${escapeHtml(e.name)}</span>` +
      (cmdShort ? `<span class="dshpb-svccmd" title="${escapeAttr(e.cmd ?? '')}">${escapeHtml(cmdShort)}</span>` : '')
    const c2 = document.createElement('td')
    c2.innerHTML = `<span class="dshpb-dot dshpb-${state}"></span><span class="dshpb-st-${state}">${stLabel[state] ?? state}</span>`
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
      if (action === 'kill' && !window.confirm(`确定停止 ${e.name} (pid ${e.pid}) 及其子进程？`)) return
      if (action === 'restart') {
        // Confirmed once, because it stops a running process. The command being
        // replayed is shown so the decision is informed rather than a leap of faith.
        const argv = splitCommandLine(e.cmd)
        const shown = argv.map((part) => (part.includes(' ') ? `"${part}"` : part)).join(' ')
        if (!window.confirm(`重启 ${e.name}（pid ${e.pid}）？\n\n会先停止当前进程，然后按原命令行重新启动：\n${shown}`)) return
        b.disabled = true
        b.textContent = '重启中…'
        try {
          if (e.state === 'running' || e.state === 'pid-alive') {
            const stop = await fetch(`${API}/kill`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pid: e.pid }) })
            const stopData = await stop.json()
            if (!stopData.ok) { alert(stopData.error ?? '停止失败'); return }
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
          if (!startData.ok) { alert(startData.error ?? '启动失败'); return }
        } catch (error) {
          alert(String(error?.message ?? error))
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
          if (!data.ok) { alert(data.error ?? '启动失败'); return }
        }
      } catch (error) {
        killing.delete(e.pid)   // 异常路径也要清在途记账，避免行永久卡「停止中…」
        alert(describeFailure(error))
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

  // ---------- 日志分栏 ----------
  function showLog(e) {
    logTarget = e
    logColOn = true
    panel.querySelector('.dshpb-log-col')?.classList.add('dshpb-log-on')
    panel.querySelector('.dshpb-log-title').textContent = `${e.name} · pid ${e.pid}`
    panel.querySelector('.dshpb-log-path').textContent = e.logPath ?? ''
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
      if (!data.ok) { bodyEl.textContent = `日志不可用：${data.error ?? res.status}/* A wildcard bind is worth distinguishing at a glance from a loopback one: the
   first is reachable from the network, the second is not. */
.dshpb-port-any { border-style:dashed; }

/* --- the filter panel -------------------------------------------------------
   The panel listed every listening process on the machine, so the useful rows were
   buried under whatever else happened to hold a port. These controls state the
   three filters the host applies. */
.dshpb-config { padding:10px 14px; border-bottom:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.2)); background:var(--dsw-alias-fill-l1,rgba(127,127,127,.04)); }
.dshpb-config[hidden] { display:none; }
.dshpb-cfgrow { display:flex; align-items:center; margin-bottom:8px; }
.dshpb-cfglabel { flex:0 0 64px; font-size:12px; color:var(--dsw-alias-label-caption,#8b93a1); }
.dshpb-input { flex:1 1 auto; min-width:0; box-sizing:border-box; padding:5px 8px; border-radius:6px; font:inherit; font-size:12px;
  color:var(--dsw-alias-label-primary,#e6e8ec); background:var(--dsw-alias-bg-l1,transparent);
  border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3)); }
.dshpb-input:focus { outline:none; border-color:var(--dsw-alias-brand-primary,#3f92fe); }
.dshpb-scope { margin-right:6px; }
.dshpb-scope[disabled] { opacity:.55; cursor:default; }
.dshpb-cfgfoot { display:flex; align-items:center; margin-top:2px; }
.dshpb-cfghint { margin-left:10px; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:11px; color:var(--dsw-alias-label-caption,#8b93a1); }
`; return }
      const nearBottom = bodyEl.scrollHeight - bodyEl.scrollTop - bodyEl.clientHeight < 60
      bodyEl.replaceChildren(...data.lines.map((line) => {
        const d = document.createElement('div')
        if (/\b(ERROR|Exception|FATAL)\b/.test(line)) d.className = 'dshpb-logline-err'
        else if (/\b(WARN)\b/.test(line)) d.className = 'dshpb-logline-warn'
        d.textContent = line || ' '
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
