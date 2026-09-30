/**
 * dsh-process-board host half.
 *
 * 周期扫描 agent 启动的服务（DSH_SESSION_ID 归属 + 监听端口 + 日志标记），
 * 合成三态状态（running / pid-alive / stopped）+ HTTP 探测码；
 * kill 时登记启动参数，支持「启动/重启」重放（采纳 fullstack-orch svc 思路）。
 * 路由（loopback + 浏览器同源标记防护）：state / kill / log / start / config。
 *
 * 本地补丁：配置过滤（config.js）让面板只显示用户关心的服务，而不是全机端口表。
 */

import { scanProcesses } from './scanner.js'
import { portConnectable, pidAlive, httpCodePort, stopTreeGraceful } from './probe.js'
import { remember, recall, recallAll } from './registry.js'
import { DEFAULT_CONFIG, keepEntry, loadConfig, saveConfig, configPath } from './config.js'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

// sessions/sessionTitle 硬注入：cordis ctx 上未 inject 的服务属性运行时直接抛
// "cannot get property without inject"（实测诊断），不是可选属性。web profile
// 宿主必有这两个服务（GUI 会话列表/标题即由它们提供），fiber 等待即刻满足。
export const inject = ['webServer', 'sessions', 'sessionTitle']

const API_PREFIX = '/api/plugins/process-board'
const SCAN_INTERVAL_MS = 10_000

export function apply(ctx) {
  let last = { at: 0, entries: [], error: null }
  let scanning = false

  /**
   * The active filter, re-read from disk on every scan so a user editing
   * config.json by hand sees the effect without restarting anything.
   */
  let config = loadConfig()
  /** Re-read the filter from disk (cheap: one small file, once per scan). */
  const reloadConfig = () => { config = loadConfig() }
  // Exposed for the status payload; the scanner's output is unfiltered on purpose.
  reloadConfig()

  const scan = async () => {
    if (scanning) return
    scanning = true
    try {
      // Pick up a hand-edited config.json on each cycle.
      reloadConfig()
      const entries = await scanProcesses()
      last = { at: Date.now(), entries, error: null }
      // 自动登记：扫描发现的服务记入登记表（供面板展示与人工重放参考）
      for (const e of entries) rememberFromEntry(e)
    } catch (error) {
      last = { ...last, at: Date.now(), error: error instanceof Error ? error.message : String(error) }
    } finally {
      scanning = false
    }
  }

  /**
   * Split a Windows command line into argv.
   *
   * The shipped version stored `argv: null` for discovered services and told the
   * user to register the command explicitly, so the panel's own "启动" button could
   * only ever answer `no-argv`. The scanner already reads the full command line, so
   * the arguments were available all along — they were simply not kept.
   *
   * Rules follow the C runtime's parser, which is what Windows passes to a child:
   * whitespace separates, double quotes group, and a backslash run escapes the
   * quote that follows it (with 2n backslashes before a quote yielding n
   * backslashes and no literal quote).
   * @param {string} commandLine - the raw command line.
   * @returns {string[]} the arguments, empty when the input is blank.
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

  /** 由扫描条目反推登记（含命令行，供面板「启动/重启」重放）。 */
  function rememberFromEntry(e) {
    if (!e.ports?.length && !e.logPath) return
    const name = guessName(e)
    const existing = recall(name)
    if (existing?.argv) return // 显式登记优先，不覆盖
    const argv = splitCommandLine(e.cmd)
    remember({
      name,
      kind: 'discovered',
      pid: e.pid,
      port: e.ports?.[0] ?? null,
      logFile: e.logPath,
      cwd: guessCwd(e.cmd),
      // 采集到的命令行可直接重放；无可执行名时保持 null，面板据此提示无法重放。
      argv: argv.length > 0 ? argv : null,
      session: e.session,
      discoveredAt: new Date().toISOString(),
    })
  }
  function guessName(e) {
    const m = /([\w.\-]+)\.(jar|mjs)$/.exec(e.cmd ?? '')
    if (m) return m[1]
    if (/([\w.\-]+)\.js\b/.test(e.cmd ?? '') && /webpack-dev-server/.test(e.cmd ?? '')) return 'dev-server-' + (e.ports?.[0] ?? e.pid)
    if (/nginx/i.test(e.name)) return 'nginx-' + (e.ports?.[0] ?? e.pid)
    if (/java/.test(e.name)) return 'java-' + (e.ports?.[0] ?? e.pid)
    return `${e.name.replace(/\.exe$/i, '')}-${e.ports?.[0] ?? e.pid}`
  }
  function guessCwd(cmd) {
    const m = /([A-Za-z]:\\[^\s"']+?\\[\w.\-]+(?:\\[\w.\-]+)*)/.exec(cmd ?? '')
    return m ? path.dirname(m[1]) : null
  }

  /** 三态合成（现场探测优先于快照）+ 会话标题解析。 */
  async function statusEntry(e) {
    const alive = pidAlive(e.pid)
    const portUp = e.ports?.length ? await portConnectable(e.ports[0]) : null
    const http = portUp ? await httpCodePort(e.ports[0], '/') : null
    let state
    if (portUp) state = 'running'
    else if (alive) state = 'pid-alive'
    else state = 'stopped'
    return { ...e, state, http, sessionTitle: resolveTitle(e.session) }
  }
  /** 会话 id → GUI 显示标题（ctx.sessionTitle.get；查不到回退 null）。 */
  function resolveTitle(sessionId) {
    if (!sessionId || !sessionId.startsWith('session-')) return null
    try {
      const session = ctx.sessions.get(sessionId)
      if (!session) return null
      return ctx.sessionTitle.get(session)?.title ?? null
    } catch (err) { titleDebugCtx.error = String(err?.message ?? err); return null }
  }
  /** 标题解析诊断（state API 附带，仅本机调试用；稳定后可移除）。 */
  const titleDebugCtx = { services: false, sessionTitle: false, gotSession: false, snap: null, error: null }

  void scan()
  const timer = setInterval(() => { void scan() }, SCAN_INTERVAL_MS)

  const writeJson = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(body))
  }
  // --- request trust fence ---------------------------------------------------
  // Patched locally: the shipped version rejected genuine same-origin requests.
  // It required `sec-fetch-site === 'same-origin'` OR a present `Origin`, but a
  // same-origin GET carries neither in most browsers, so a working request would
  // earn a 403. The check also had the axis backwards: it accepted *any* Origin,
  // which is the case a cross-site caller produces, and ignored `Host`, which is
  // the only header a DNS-rebinding attack cannot forge.
  //
  // The replacement states the two rules that actually matter for a route that
  // skips the harness's own browser-auth fence:
  //   1. the request was addressed to a loopback authority — `Host` is the one
  //      header a rebound attacker gets wrong, so this is the anti-rebinding rule;
  //   2. any browser-supplied provenance agrees with that authority.
  // A missing marker is not suspicious: a same-origin GET has none. A marker that
  // disagrees (a foreign Origin, `sec-fetch-site: cross-site`) is rejected.
  const loopback = (req) => {
    const addr = req.socket.remoteAddress ?? ''
    return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1'
  }
  /** Loopback authority from a `Host`/`Origin` value, or null when it is not one. */
  const loopbackAuthority = (value) => {
    if (typeof value !== 'string' || value === '') return null
    const match = /^(?:https?:\/\/)?(\[[^\]]+\]|[^/?#:]+)(?::(\d+))?/i.exec(value.trim())
    if (!match) return null
    const host = (match[1] ?? '').toLowerCase().replace(/^\[|\]$/g, '')
    const isLoopback = host === 'localhost' || host === '127.0.0.1' || host === '::1'
      || /^127\./.test(host)
    return isLoopback ? { host, port: match[2] ?? null } : null
  }
  const allowedBy = (req) => {
    const host = loopbackAuthority(req.headers.host)
    if (host === null) return 'host-not-loopback'
    const site = req.headers['sec-fetch-site']
    if (typeof site === 'string' && site !== 'same-origin' && site !== 'none') return 'sec-fetch-site'
    const origin = req.headers.origin
    if (typeof origin === 'string' && origin !== 'null' && origin !== '') {
      const originAuthority = loopbackAuthority(origin)
      if (originAuthority === null) return 'origin-not-loopback'
      if (originAuthority.host !== host.host) return 'origin-host-mismatch'
      if (originAuthority.port !== null && host.port !== null && originAuthority.port !== host.port) {
        return 'origin-port-mismatch'
      }
    }
    return null
  }
  const guard = (req, res) => {
    const refusal = allowedBy(req)
    if (refusal === null && loopback(req)) return true
    writeJson(res, 403, {
      ok: false,
      error: 'forbidden',
      reason: refusal ?? 'remote-address-not-loopback',
      remoteAddress: req.socket.remoteAddress ?? null,
      host: req.headers.host ?? null,
      origin: req.headers.origin ?? null,
      secFetchSite: req.headers['sec-fetch-site'] ?? null,
    })
    return false
  }
  async function readBody(req, limit = 64 * 1024) {
    const chunks = []
    let size = 0
    for await (const chunk of req) {
      size += chunk.length
      if (size > limit) throw new Error('body-too-large')
      chunks.push(chunk)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  }
  function recallByPid(pid) {
    return recallAll().find((s) => s.pid === pid) || null
  }

  const routes = [
    {
      kind: 'exact',
      path: `${API_PREFIX}/state`,
      handler: (req, res) => {
        if (req.method !== 'GET') return writeJson(res, 405, { ok: false, error: 'method-not-allowed' })
        if (!guard(req, res)) return
        if (Date.now() - last.at > SCAN_INTERVAL_MS * 3 && !scanning) void scan()
        const probe = async () => {
          try {
            // Apply the user's filter here rather than in the scanner: the scanner's
            // output is the machine's truth, and the panel is the view.
            const visible = last.entries.filter((e) => keepEntry(e, config))
            const probed = []
            for (const e of visible.slice(0, 20)) probed.push(await statusEntry(e))
            writeJson(res, 200, { ok: true, at: last.at, entries: probed, error: last.error, config, hidden: last.entries.length - visible.length })
          } catch (error) {
            writeJson(res, 200, { ok: true, at: last.at, entries: last.entries, error: String(error?.message ?? error), config })
          }
        }
        void probe()
      },
    },
    {
      kind: 'exact',
      path: `${API_PREFIX}/config`,
      handler: async (req, res) => {
        if (!guard(req, res)) return
        if (req.method === 'GET') {
          reloadConfig()
          writeJson(res, 200, { ok: true, config, defaults: DEFAULT_CONFIG, path: configPath() })
          return
        }
        if (req.method !== 'POST') return writeJson(res, 405, { ok: false, error: 'method-not-allowed' })
        try {
          const body = await readBody(req, 16 * 1024)
          // A partial patch is merged onto the current config, so the panel can send
          // one field at a time without having to echo back everything it knows.
          const next = saveConfig({ ...config, ...(body ?? {}) })
          config = next
          writeJson(res, 200, { ok: true, config: next })
          void scan()
        } catch (error) {
          writeJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: `${API_PREFIX}/kill`,
      handler: async (req, res) => {
        if (req.method !== 'POST') return writeJson(res, 405, { ok: false, error: 'method-not-allowed' })
        if (!guard(req, res)) return
        try {
          const body = await readBody(req, 4096)
          const pid = Number(body?.pid)
          if (!Number.isInteger(pid) || pid <= 4) return writeJson(res, 400, { ok: false, error: 'invalid-pid' })
          const entry = last.entries.find((e) => e.pid === pid)
          if (entry) rememberFromEntry(entry)
          const result = await stopTreeGraceful(pid)
          await scan()   // 等 RE-scan 完成再回——POST 返回时状态已收敛，前端无需再等
          writeJson(res, 200, { ok: true, ...result })
        } catch (error) {
          writeJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: `${API_PREFIX}/log`,
      handler: async (req, res) => {
        if (req.method !== 'POST') return writeJson(res, 405, { ok: false, error: 'method-not-allowed' })
        if (!guard(req, res)) return
        try {
          const body = await readBody(req, 4096)
          const pid = Number(body?.pid)
          const lines = Math.max(1, Math.min(500, Number(body?.lines) || 200))
          if (!Number.isInteger(pid) || pid <= 4) return writeJson(res, 400, { ok: false, error: 'invalid-pid' })
          const entry = last.entries.find((e) => e.pid === pid)
          const logPath = entry?.logPath ?? recallByPid(pid)?.logFile
          if (!logPath) return writeJson(res, 404, { ok: false, error: 'no-log' })
          const { readFile } = await import('node:fs/promises')
          const content = await readFile(logPath, 'utf8').catch(() => null)
          if (content === null) return writeJson(res, 404, { ok: false, error: 'log-unreadable' })
          writeJson(res, 200, { ok: true, logPath, lines: content.split(/\r?\n/).slice(-lines) })
        } catch (error) {
          writeJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: `${API_PREFIX}/start`,
      handler: async (req, res) => {
        if (req.method !== 'POST') return writeJson(res, 405, { ok: false, error: 'method-not-allowed' })
        if (!guard(req, res)) return
        try {
          const body = await readBody(req, 16 * 1024)
          let entry = null
          if (body?.argv && Array.isArray(body.argv) && body.argv.length > 0) {
            entry = { name: String(body.name), argv: body.argv.map(String), cwd: body.cwd || null, logFile: body.logFile || null, port: body.port || null, kind: 'manual' }
            remember(entry)
          } else {
            entry = recall(String(body?.name ?? ''))
          }
          if (!entry?.argv) return writeJson(res, 400, { ok: false, error: 'no-argv（自动发现的服务无法还原启动命令；让 agent 显式登记一次后即可重放）' })
          const logFile = entry.logFile || path.join(os.tmpdir(), `pb-${entry.name}.log`)
          fs.mkdirSync(path.dirname(logFile), { recursive: true })
          const out = fs.openSync(logFile, 'a')
          let child
          try {
            child = spawn(entry.argv[0], entry.argv.slice(1), {
              cwd: entry.cwd || undefined,
              detached: true,
              stdio: ['ignore', out, out],
              env: { ...process.env, DSH_PB_LOG: logFile },
            })
          } finally { fs.closeSync(out) }
          child.unref()
          writeJson(res, 200, { ok: true, pid: child.pid, logFile })
          void scan()
        } catch (error) {
          writeJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
  ]

  const disposers = routes.map((route) => ctx.webServer.register(route))
  ctx.effect(() => () => {
    clearInterval(timer)
    for (const dispose of disposers) dispose()
  }, 'process-board: scan loop + routes')
}
