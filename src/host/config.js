/**
 * 面板配置：决定"显示什么"。
 *
 * 生产环境实测的问题：面板会把机器上**所有**监听进程都列出来——百度网盘、系统服务、
 * 甚至我自己的测试进程都混在里面。用户要的是"我要监控哪几个服务"，而不是一张全机
 * 端口表。这个文件提供三个正交的过滤口径，任意组合：
 *
 *  - `scope: 'session'` 只显示属于某个 DSH 会话的服务（Agent 启动的才是真正相关的）
 *  - `scope: 'all'`     显示全部（原行为）
 *  - `ports: [3306, 5173]`  显式端口白名单，优先级最高
 *  - `hide: [...]`      按名称片段排除（大小写不敏感）
 *
 * 配置存在 `~/.dsh/gate/process-board/config.json`，与 `services.json` 同目录，
 * 用户可以直接编辑；面板里也能改。读失败一律回退到"不过滤"，因为一个坏掉的配置
 * 文件不应该让面板空白。
 *
 * @module process-board/config
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

function boardDir() {
  if (process.env.DSH_GATE_DIR) return path.join(process.env.DSH_GATE_DIR, 'process-board')
  return path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'gate', 'process-board')
}
function configFile() { return path.join(boardDir(), 'config.json') }

/** 配置文件的绝对路径（面板会显示它，方便用户直接编辑）。 */
export function configPath() { return configFile() }

/** 默认配置：与原行为一致（不过滤），用户不改就不会有意外。 */
export const DEFAULT_CONFIG = {
  scope: 'all',
  ports: [],
  hide: [],
}

/** 一个值是否像端口列表。 */
function asPorts(value) {
  if (!Array.isArray(value)) return []
  const out = []
  for (const item of value) {
    const port = Number(item)
    if (Number.isInteger(port) && port > 0 && port <= 65535 && !out.includes(port)) out.push(port)
  }
  return out.sort((a, b) => a - b)
}

/** 一个值是否像名称片段列表。 */
function asNames(value) {
  if (!Array.isArray(value)) return []
  const out = []
  for (const item of value) {
    const name = String(item ?? '').trim()
    if (name !== '' && !out.includes(name)) out.push(name)
  }
  return out
}

/** 把任意输入规整成一份合法配置。 */
export function normalizeConfig(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  const scope = source.scope === 'session' ? 'session' : 'all'
  return {
    scope,
    ports: asPorts(source.ports),
    hide: asNames(source.hide),
  }
}

/** 读配置（损坏/缺失一律回退默认，不抛）。 */
export function loadConfig() {
  try {
    return normalizeConfig(JSON.parse(fs.readFileSync(configFile(), 'utf8')))
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

/** 写配置（原子写：先写临时文件再改名，避免半截 JSON）。 */
export function saveConfig(raw) {
  const config = normalizeConfig(raw)
  fs.mkdirSync(boardDir(), { recursive: true })
  const target = configFile()
  const temp = `${target}.tmp`
  fs.writeFileSync(temp, JSON.stringify(config, null, 2), 'utf8')
  fs.renameSync(temp, target)
  return config
}

/**
 * 按配置过滤一条扫描结果。
 *
 * 判定顺序：端口白名单（配置了就只认白名单）→ 名称排除 → 会话范围。
 * 端口白名单优先，因为"我明确要看 3306"比任何范围规则都更具体。
 *
 * @param {{ports:number[], session:string|null, name:string, inTree:boolean}} entry - 扫描条目。
 * @param {object} config - 已规整的配置。
 * @returns {boolean} 是否应当显示。
 */
export function keepEntry(entry, config) {
  const ports = Array.isArray(entry.ports) ? entry.ports : []
  if (config.ports.length > 0) {
    if (!ports.some((port) => config.ports.includes(port))) return false
  }
  const name = String(entry.name ?? '').toLowerCase()
  for (const needle of config.hide) {
    if (name.includes(needle.toLowerCase())) return false
  }
  if (config.scope === 'session') {
    // "本机 Agent 启动的"= 带 DSH 会话标记，或属于宿主进程树。
    const marked = typeof entry.session === 'string' && entry.session.startsWith('session-')
    if (!marked && entry.inTree !== true) return false
  }
  return true
}
