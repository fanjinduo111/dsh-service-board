/**
 * 服务登记表（~/.dsh/gate/process-board/services.json）
 *
 * 采纳自 fullstack-orch gate/lib/registry.js 思路：kill 的服务保留启动参数
 * （argv/cwd/env/logFile），面板可「启动/重启」重放。原子写 + mkdir 锁防并发。
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

function boardDir() {
  if (process.env.DSH_GATE_DIR) return path.join(process.env.DSH_GATE_DIR, 'process-board')
  return path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'gate', 'process-board')
}
function registryFile() { return path.join(boardDir(), 'services.json') }

/** 读登记表（损坏=空表，不抛）。 */
export function loadReg() {
  try {
    const raw = JSON.parse(fs.readFileSync(registryFile(), 'utf8'))
    if (Array.isArray(raw.services)) return raw
  } catch { /* 无文件/损坏 → 空表 */ }
  return { services: [] }
}

const LOCK_DIR = () => registryFile() + '.lock'
const STALE_MS = 10_000

function sleepMs(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) }

function withLock(fn) {
  fs.mkdirSync(boardDir(), { recursive: true }) // 锁目录的父目录须先存在
  const deadline = Date.now() + 5000
  for (;;) {
    try { fs.mkdirSync(LOCK_DIR()); break } catch (e) {
      if (e.code !== 'EEXIST') throw e
      try {
        if (Date.now() - fs.statSync(LOCK_DIR()).mtimeMs > STALE_MS) {
          fs.rmSync(LOCK_DIR(), { recursive: true, force: true })
          continue
        }
      } catch { /* 锁刚释放，重试 */ }
      if (Date.now() > deadline) throw new Error('登记表锁获取超时')
      sleepMs(50)
    }
  }
  try { return fn() } finally { try { fs.rmdirSync(LOCK_DIR()) } catch { /* 被强占清理 */ } }
}

function saveReg(reg) {
  fs.mkdirSync(boardDir(), { recursive: true })
  const tmp = registryFile() + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(reg, null, 2) + '\n')
  fs.renameSync(tmp, registryFile())
}

/** 按 key（pid 首启 / name 复用）登记服务启动参数。 */
export function remember(entry) {
  return withLock(() => {
    const reg = loadReg()
    const i = reg.services.findIndex((s) => s.name === entry.name)
    if (i >= 0) reg.services[i] = { ...reg.services[i], ...entry }
    else reg.services.push(entry)
    saveReg(reg)
  })
}

/** 取登记条目。 */
export function recall(name) {
  return loadReg().services.find((s) => s.name === name) || null
}

/** 列全部登记条目。 */
export function recallAll() {
  return loadReg().services
}
