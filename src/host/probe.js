/**
 * 服务探测原语（采纳自 fullstack-orch gate/lib/probe.js，纯 node 跨平台）
 * + 礼貌停止（SIGTERM/WM_CLOSE → 宽限 → 树杀强停，采纳自 daemon.js stop）
 */

import net from 'node:net'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { killProcessTree } from './scanner.js'

const execFileAsync = promisify(execFile)
const IS_WIN = process.platform === 'win32'

/** 端口可连（双族：127.0.0.1 → ::1）。 */
export function portConnectable(port) {
  return connectableAt(port, '127.0.0.1').then((v4) => (v4 ? true : connectableAt(port, '::1')))
}
function connectableAt(port, host) {
  return new Promise((resolve) => {
    const s = net.connect(port, host)
    s.once('connect', () => { s.destroy(); resolve(true) })
    s.once('error', () => resolve(false))
  })
}

/** pid 活着（信号 0）。 */
export function pidAlive(pid) {
  if (!pid || !Number(pid)) return false
  try { process.kill(Number(pid), 0); return true } catch { return false }
}

/** HTTP 状态码（不可达 = 0；双族）。 */
export async function httpCodePort(port, probePath = '/') {
  const probe = async (base) => {
    try {
      const r = await fetch(`${base}:${port}${probePath}`, { redirect: 'manual', signal: AbortSignal.timeout(3000) })
      return r.status
    } catch { return 0 }
  }
  const v4 = await probe('http://127.0.0.1')
  if (v4 > 0) return v4
  return probe('http://[::1]')
}

/** 轮询等端口监听。 */
export async function waitListen(port, timeoutMs) {
  for (const t0 = Date.now(); Date.now() - t0 < timeoutMs;) {
    if (await portConnectable(port)) return true
    await new Promise((r) => setTimeout(r, 300))
  }
  return false
}

/**
 * 礼貌停止进程树：Windows taskkill /T（无 /F 先礼貌）→ 宽限 → /T /F 强杀；
 * POSIX SIGTERM 进程组 → 宽限 → SIGKILL。返回实际结束的 pid 列表。
 */
export async function stopTreeGraceful(pid, timeoutSec = 3) {
  if (!Number.isInteger(pid) || pid <= 4) throw new Error('invalid pid')
  if (!pidAlive(pid)) return { killed: [] }
  if (IS_WIN) {
    // 第一轮礼貌（发 WM_CLOSE；无窗口的服务进程通常不吃，走宽限强杀）。
    // 宽限默认 3s：dev-server 类无窗口进程礼貌轮无效，10s 死等只会让面板
    // 「停止中…」挂 10s+（实测）；本地开发服务 3s 后直接树杀。
    await execFileAsync('taskkill', ['/PID', String(pid), '/T'], { timeout: 10_000, windowsHide: true }).catch(() => {})
  } else {
    try { process.kill(-pid, 'SIGTERM') } catch { try { process.kill(pid, 'SIGTERM') } catch { /* 已退出 */ } }
  }
  for (let i = 0; i < timeoutSec * 2; i++) {
    if (!pidAlive(pid)) return { killed: [pid] }
    await new Promise((r) => setTimeout(r, 500))
  }
  // 第二轮强杀（树）
  const killed = await killProcessTree(pid)
  return { killed: killed.killed }
}
