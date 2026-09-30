/**
 * 进程扫描器：找出由 DSH Agent 启动的进程（含 Start-Process 分离进程），
 * 归属到会话（DSH_SESSION_ID 环境变量），并关联监听端口。
 *
 * 数据采集在 PowerShell（WMI 进程表 + netstat 端口表 + PEB 环境读取，
 * 分页读取避免跨未映射页整读失败——实测验证）；候选过滤与会话归属在 JS。
 *
 * 归属双通道：
 *  - env 标记：DSH 宿主给 shell 注入 DSH_SESSION_ID，全部后代（含分离进程）继承
 *  - 血缘兜底：宿主进程树后代（MCP 子进程等无 env 标记的）
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const SCAN_TIMEOUT_MS = 20_000
const MARKER_BEGIN = '@@DSHPB-BEGIN@@'
const MARKER_END = '@@DSHPB-END@@'

/** PowerShell 数据采集脚本：输出 JSON（进程表 + 端口表 + 宿主后代集合 + env 会话归属）。 */
const PS_TEMPLATE = `
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition __CS_CODE__

$procs = Get-CimInstance Win32_Process
$children=@{}
foreach($p in $procs){ $k=[int]$p.ParentProcessId; if(-not $children.ContainsKey($k)){ $children[$k]=New-Object System.Collections.Generic.List[object] }; $children[$k].Add($p) }

# 宿主后代集合（pid 数组）
$desc=New-Object 'System.Collections.Generic.HashSet[int]'
$stack=New-Object 'System.Collections.Generic.Stack[int]'
$stack.Push(__HOST_PID__)
while($stack.Count -gt 0){
  $cur=$stack.Pop()
  if($children.ContainsKey($cur)){ foreach($c in $children[$cur]){ if($desc.Add([int]$c.ProcessId)){ $stack.Push([int]$c.ProcessId) } } }
}

# 监听端口 + 绑定地址（面板要显示服务绑在哪个 IP 上，所以地址不能丢）
$ports=@{}
try{
  $nl=(netstat -ano -p tcp) -match 'LISTENING'
  foreach($l in $nl){
    $parts=($l -replace '\\s+',' ').Trim() -split ' '
    if($parts.Count -ge 4){
      $local=$parts[1]; $tp=[int]$parts[-1]
      $i=$local.LastIndexOf(':')
      if($i -gt 0){
        $addr=$local.Substring(0,$i)
        $po=$local.Substring($i+1)
        if($po -match '^\\d+$' -and [int]$po -gt 0){
          if(-not $ports.ContainsKey($tp)){ $ports[$tp]=New-Object 'System.Collections.Generic.List[object]' }
          # 去方括号是展示口径：面板要显示一个可直接粘贴的地址
          $ports[$tp].Add([pscustomobject]@{ addr=($addr -replace '^\\[|\\]$',''); port=[int]$po })
        }
      }
    }
  }
}catch{}

# 输出：desc 与 ports 直接内嵌；进程表逐条带 env 会话读取（仅候选——宿主后代或服务名进程，避免全量 PEB 读）
$svcNames='^(node|java|javaw|nginx|python|pythonw|mvn|npm|pnpm|yarn|go|dotnet|redis-server|mysqld|postgres|codegraph|ruby|php)($|\\.)'
$emit=New-Object 'System.Collections.Generic.List[object]'
foreach($p in $procs){
  $tp=[int]$p.ProcessId
  if($tp -le 4){ continue }
  $inTree=$desc.Contains($tp)
  $name=[string]$p.Name
  $isSvc=($name -match $svcNames)
  # 候选：宿主后代（全部，含 shell——JS 侧再滤噪音）或服务名进程（全机，JS 侧用 env 归属裁决）
  if(-not ($inTree -or $isSvc)){ continue }
  $sess=$null
  $logp=$null
  try{
    $mk=[DshPeb+Env]::ReadMarkers($tp)
    if($mk){ $sess=$mk[0]; $logp=$mk[1] }
  }catch{}
  $pl=@()
  if($ports.ContainsKey($tp)){ $pl=$ports[$tp] }
  $created=0
  # 启动时刻：FILETIME 秒（1601 起），**截断**到秒而不是四舍五入。
  # 原写法 $p.CreationDate.ToFileTimeUtc()/10000000 得到的是 double，[int64] 会就近取整——
  # /1e7 先把 100ns 计数变成小数，再整体加 1，于是小数部分过 .5 的进程会比实际启动时间晚 1 秒；
  # 实测 WMI 报 17:31:53 的进程被算成 17:31:54，而面板要把这个值原样显示成"启动于 17:31:53"。
  # 单位保持不变（仍旧是 1601 起的秒）：客户端只做减偏移，老宿主+新客户端也不会突然错一大截。
  if($p.CreationDate){ try{ $created=[int64][math]::Truncate($p.CreationDate.ToFileTimeUtc()/10000000) }catch{} }
  $emit.Add([pscustomobject]@{
    pid=$tp; ppid=[int]$p.ParentProcessId; name=$name
    cmd=if($p.CommandLine){[string]$p.CommandLine}else{''}
    created=$created; session=$sess; logPath=$logp; inTree=$inTree; binds=$pl
  })
}
Write-Output '__MARKER_BEGIN__'
# 完整父映射一并输出：判断"是否由服务控制管理器持有"需要走整条父链，而被过滤掉的
# 中间进程不在 procs 里，光靠 procs 会把链走断。
# 键必须是字符串：ConvertTo-Json 对整数键的哈希表直接报 NonStringKeyInDictionary。
$parentOf=@{}
foreach($p in $procs){ $parentOf[[string][int]$p.ProcessId]=[int]$p.ParentProcessId }
$servicesPid=0
foreach($p in $procs){ if($p.Name -eq 'services.exe'){ $servicesPid=[int]$p.ProcessId; break } }
$json = ConvertTo-Json -InputObject ([pscustomobject]@{ desc=@($desc); procs=$emit; parents=$parentOf; servicesPid=$servicesPid }) -Depth 4 -Compress
$bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
Write-Output ([System.Convert]::ToBase64String($bytes))
Write-Output '__MARKER_END__'
`

const CS_CODE = `
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
public static class DshPeb {
  public static class Env {
    [StructLayout(LayoutKind.Sequential)]
    struct PROCESS_BASIC_INFORMATION { public IntPtr R1; public IntPtr Peb; public IntPtr R2a; public IntPtr R2b; public IntPtr Pid; public IntPtr R3; }
    [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr h, int c, ref PROCESS_BASIC_INFORMATION pbi, int cb, out int sz);
    [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(int a, bool i, int p);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool ReadProcessMemory(IntPtr h, IntPtr addr, byte[] buf, int size, out int read);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
    static IntPtr RP(IntPtr h, IntPtr a){ byte[] b=new byte[8]; int r; if(!ReadProcessMemory(h,a,b,8,out r)) return IntPtr.Zero; return new IntPtr(BitConverter.ToInt64(b,0)); }
    static byte[] ReadPaged(IntPtr h, IntPtr addr, int max){
      var acc=new byte[max]; int total=0;
      long pageStart=(long)addr & ~0xFFFL;
      long addrEnd=(long)addr+max;
      for(long p=pageStart;p<addrEnd;p+=0x1000){
        int want=(int)Math.Min(0x1000,(int)(addrEnd-p));
        byte[] pb=new byte[0x1000]; int r;
        if(!ReadProcessMemory(h,(IntPtr)p,pb,want,out r)||r==0) break;
        long rel=p-(long)addr;
        int srcOff=(int)Math.Max(0,-rel);
        int dstOff=(int)Math.Max(0,rel);
        int copy=Math.Min(r-srcOff,max-dstOff);
        if(copy<=0) break;
        Array.Copy(pb,srcOff,acc,dstOff,copy);
        total=Math.Max(total,dstOff+copy);
      }
      if(total==0) return null;
      byte[] o=new byte[total]; Array.Copy(acc,o,total); return o;
    }
    public static string[] ReadMarkers(int pid){
      IntPtr h=OpenProcess(0x0410,false,pid);
      if(h==IntPtr.Zero) return null;
      try{
        var pbi=new PROCESS_BASIC_INFORMATION(); int sz;
        if(NtQueryInformationProcess(h,0,ref pbi,Marshal.SizeOf(typeof(PROCESS_BASIC_INFORMATION)),out sz)!=0) return null;
        if(pbi.Peb==IntPtr.Zero) return null;
        IntPtr pp=RP(h,(IntPtr)((long)pbi.Peb+0x20)); if(pp==IntPtr.Zero) return null;
        IntPtr env=RP(h,(IntPtr)((long)pp+0x80)); if(env==IntPtr.Zero) return null;
        byte[] b=ReadPaged(h,env,262144); if(b==null) return null;
        string s=Encoding.Unicode.GetString(b,0,b.Length);
        var m=Regex.Match(s,"DSH_SESSION_ID=([\\\\w\\\\-]+)");
        var lm=Regex.Match(s,"DSH_PB_LOG=([^\\x00]+?)\\x00");
        return new string[]{
          m.Success?m.Groups[1].Value:null,
          lm.Success?lm.Groups[1].Value:null
        };
      } catch { return null; } finally { CloseHandle(h); }
    }
  }
}
`

/** 宿主树内但不展示的噪音（短命 shell / 系统基础设施）。 */
const NOISE = /^(powershell|pwsh|cmd|conhost|bash|sh|wsl|git|curl|tar|where\.exe|findstr|rg|scp|ssh)\.exe$/i

/** 与 DSH 无关的本机服务判定：命令行特征（工作区/工具链）。 */
const WORKSPACE_HINT = /(sncProject|\.dsh|webpack|vite|spring|target\\classes|jenkins|node_modules)/i

/**
 * 第三道闸门的纯函数形态：同名 master-worker 冗余合并（nginx 等）。
 *
 * 规则：同名进程互为父子链时只保留祖先（master）——从 master 停止 = 树杀整组，
 * 且 master 不会被自动 refork（杀 worker 会被 master 立即拉起新的，面板表现为"停不掉"）。
 * master 的端口显示为其同名后代的端口合集（master 常由 worker 持有监听 socket）。
 *
 * 「同名」这一条曾经单独成立，于是任何"同名启动器 → 同名服务"的链条都会把真正的服务当作
 * worker 删掉：实测宿主自身在监听（面板就是 HTTP 服务）时用 /start 拉起一个 `node.exe`
 * 服务，子进程（监听 5455、带 DSH_PB_LOG 标记）整条从扫描结果里消失，端口被并到父进程
 * 身上，紧接着 POST /log 对该 pid 返回 404 no-log —— 面板上就是「日志不可用：no-log」，
 * 而进程一直活着在写日志。master 与 worker 跑的是同一个程序、同一份参数，shim/启动器/
 * 包装脚本只是可执行文件同名，所以合并还要求命令行一致；另外"带日志标记而祖先没有"的后代
 * 本身就是面板直接启动的服务，不能当 worker 吞掉。
 *
 * @param {Array<{pid:number,ppid:number,name:string,cmd:string,ports:number[],logPath:string|null}>} services
 * @returns {object[]} the rows to show, each master carrying its workers' ports.
 */
export function mergeWorkers(services) {
  const normCmd = (value) => String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
  /**
   * True when `kid` is a worker of `master`: same program, not a service in its own right.
   *
   * An empty command line is not evidence of anything (the probe cannot always read one —
   * `mysqld.exe` on this machine reports none), so it never justifies hiding a process.
   */
  const isWorkerOf = (master, kid) => {
    const masterCmd = normCmd(master.cmd)
    return master.name === kid.name
      && masterCmd !== ''
      && masterCmd === normCmd(kid.cmd)
      && !(kid.logPath && !master.logPath)
  }
  const byPid = new Map(services.map((e) => [e.pid, e]))
  const descendantsOf = new Map() // pid -> Set(同名同命令行的后代 pid)
  for (const e of services) {
    let cur = byPid.get(e.ppid)
    let hops = 0
    while (cur && hops < 8) {
      if (isWorkerOf(cur, e)) {
        if (!descendantsOf.has(cur.pid)) descendantsOf.set(cur.pid, new Set())
        descendantsOf.get(cur.pid).add(e.pid)
      }
      cur = byPid.get(cur.ppid)
      hops++
    }
  }
  return services.filter((e) => {
    // 自己是某同名进程的后代 → 剔除（保留祖先）
    for (const [, set] of descendantsOf) {
      if (set.has(e.pid)) return false
    }
    return true
  }).map((e) => {
    // 合并同名后代的端口到 master 显示
    const kids = descendantsOf.get(e.pid)
    if (kids && kids.size > 0) {
      const ports = new Set(e.ports)
      for (const kidPid of kids) {
        for (const p of byPid.get(kidPid)?.ports ?? []) ports.add(p)
      }
      e.ports = [...ports].sort((a, b) => a - b)
    }
    return e
  })
}

/**
 * 执行一次扫描并做 JS 侧过滤/归属。
 * `created` 是进程启动时刻，单位是 FILETIME 秒（1601 起，已截断到秒）；
 * 面板减掉 1601→1970 的偏移后显示"运行 3时12分 / 启动于 …"。
 * @returns {Promise<Array<{pid:number,ppid:number,name:string,cmd:string,created:number,session:string,inTree:boolean,ports:number[],binds:Array<{addr:string,port:number}>}>>}
 */
export async function scanProcesses() {
  if (process.platform !== 'win32') return []
  const script = PS_TEMPLATE
    .replace('__HOST_PID__', String(process.pid))
    .replace('__CS_CODE__', `'${CS_CODE}'`)
    .replace('__MARKER_BEGIN__', MARKER_BEGIN)
    .replace('__MARKER_END__', MARKER_END)
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { timeout: SCAN_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024, windowsHide: true },
  )
  const begin = stdout.indexOf(MARKER_BEGIN)
  const end = stdout.indexOf(MARKER_END)
  if (begin < 0 || end < 0 || end <= begin) throw new Error('process-board: scan markers missing')
  // Base64 传输：进程命令行中的控制字符/引号曾使内联 JSON 在 PS→stdout→node 传输中损坏
  const b64 = stdout.slice(begin + MARKER_BEGIN.length, end).trim().replace(/\s+/g, '')
  const data = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'))
  const desc = new Set(Array.isArray(data.desc) ? data.desc : [])
  const procs = Array.isArray(data.procs) ? data.procs : []

  // Which processes the Service Control Manager owns.
  //
  // A Windows service (MySQL80, for one) is started by `services.exe`, and stopping
  // its process does not stop the service: the SCM restarts it immediately. The panel
  // used to offer a plain "停止" for such a process, so it looked like the service
  // came back by itself. The whole chain is walked, not just the first link:
  // `mysqld.exe` listens from a child whose parent is the process services.exe
  // started directly.
  const parentOf = data.parents !== null && typeof data.parents === 'object' ? data.parents : {}
  const servicesPid = Number(data.servicesPid ?? 0)
  /** True when `pid`'s ancestry passes through the service control manager. */
  const ownedByServices = (pid) => {
    if (!Number.isInteger(servicesPid) || servicesPid <= 4 || pid === undefined) return false
    let cursor = pid
    for (let hops = 0; hops < 16; hops += 1) {
      const parent = Number(parentOf[String(cursor)] ?? parentOf[cursor] ?? 0)
      if (!Number.isInteger(parent) || parent <= 4) return false
      if (parent === servicesPid) return true
      cursor = parent
    }
    return false
  }

  const out = []
  for (const p of procs) {
    const inTree = !!p.inTree || desc.has(p.pid)
    const name = String(p.name ?? '')
    const cmd = String(p.cmd ?? '')
    const session = p.session ?? null
    // 绑定地址：优先用采集到的 binds；缺失时退回旧的纯端口形态，保持向后兼容。
    const rawBinds = Array.isArray(p.binds) ? p.binds : Array.isArray(p.ports) ? p.ports : []
    const binds = []
    const seenBind = new Set()
    for (const item of rawBinds) {
      const port = typeof item === 'object' && item !== null ? Number(item.port) : Number(item)
      if (!Number.isInteger(port) || port <= 0) continue
      const addr = typeof item === 'object' && item !== null && typeof item.addr === 'string' && item.addr !== ''
        ? item.addr
        : '0.0.0.0'
      const key = `${addr}:${port}`
      if (seenBind.has(key)) continue
      seenBind.add(key)
      binds.push({ addr, port })
    }
    binds.sort((left, right) => left.port - right.port)
    const ports = [...new Set(binds.map((bind) => bind.port))]
    const logPath = p.logPath ?? null
    // 第一道闸门：只收"服务"候选（监听端口或带日志标记），其余进程链不进面板。
    // shell 类不承认日志标记：扫描器自身 powershell 的 PEB 读会扫到脚本内存，
    // DSH_PB_LOG 正则误命中脚本源码产生伪 logPath（实测），故 shell 一律按无标记处理。
    if (ports.length === 0 && (!logPath || NOISE.test(name))) continue
    out.push({
      pid: p.pid,
      ppid: p.ppid,
      name,
      cmd,
      created: p.created ?? 0,
      session: p.session ?? null,
      logPath,
      inTree,
      ports,
      binds,
      /** True for a Windows service: stopping it only makes the SCM restart it. */
      serviceOwned: ownedByServices(p.pid),
    })
  }
  // 第二道：剔除进程链中间壳（无端口的启动器/包装器——npm-cli/cross-env/cmd 壳等）
  const byPid = new Map(out.map((e) => [e.pid, e]))
  const WRAPPER_HINT = /(npm-cli\.js|npx-cli\.js|yarn\.js|pnpm\.js|cross-env)/i
  const services = out.filter((e) => {
    if (e.ports.length > 0) return true
    if (byPid.has(e.ppid)) return false
    if (WRAPPER_HINT.test(e.cmd)) return false
    return true
  })
  for (const e of services) {
    if (!e.session) e.session = e.inTree ? 'host' : 'unknown'
  }
  // 第三道：同名 master-worker 冗余合并（nginx 等）。
  // 规则：同名进程互为父子链时只保留祖先（master）——从 master 停止 = 树杀整组，
  // 且 master 不会被自动 refork（杀 worker 会被 master 立即拉起新的，面板表现为"停不掉"）。
  // master 的端口显示为其同名后代的端口合集（master 常由 worker 持有监听 socket）。
  const merged = mergeWorkers(services)
  // 第四道：同名且端口完全重叠的实例去重（master 换代遗留：旧 master 孤儿化后与新 master 并存），
  // 保留较新实例（created 大者）——旧实例由新实例替代，显示一条即可；停止时杀的是显示的实例。
  const portKey = (e) => [...e.ports].sort().join(',')
  const byNamePorts = new Map()
  for (const e of merged) {
    if (e.ports.length === 0) continue
    const key = `${e.name}|${portKey(e)}`
    const prev = byNamePorts.get(key)
    if (!prev || (e.created ?? 0) > (prev.created ?? 0)) byNamePorts.set(key, e)
  }
  const deduped = merged.filter((e) => {
    if (e.ports.length === 0) return true
    return byNamePorts.get(`${e.name}|${portKey(e)}`) === e
  })
  // 会话进程在前，host/unknown 在后；组内按 pid
  const rank = (s) => (s && s.startsWith('session-') ? 0 : 1)
  deduped.sort((a, b) => rank(a.session) - rank(b.session) || a.pid - b.pid)
  return deduped
}

/**
 * 结束进程树（pid + 全部后代，避免孤儿残留）。
 *
 * 本函数**不会**因 PowerShell 失败而 reject。生产环境实测过：当 `taskkill /T`
 * 追不到分离进程时，这里会退回树杀，而 PowerShell 进程自身可能以非零退出
 * （执行策略、超时、输出缓冲区溢出），于是 `execFile` reject、请求变成 400、
 * 面板把整条 PowerShell 命令当作错误弹给用户——用户看到的就是「点了停止没反应，
 * 只跳出一堆命令」。杀进程是"尽力而为"的操作：失败应当以结果告知，而不是抛异常。
 *
 * @returns {Promise<{killed:number[], failed?:string}>} 实际结束的 pid；整体失败时给 failed。
 */
export async function killProcessTree(pid) {
  if (!Number.isInteger(pid) || pid <= 4) throw new Error('invalid pid')
  const fallback = async (reason) => {
    // 树杀失败时至少尽力结束目标本身，让「停止」仍然有效。
    try {
      process.kill(pid)
      return { killed: [pid] }
    } catch {
      return { killed: [], failed: reason }
    }
  }
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
        `$ErrorActionPreference='SilentlyContinue';` +
        `$all=Get-CimInstance Win32_Process;` +
        `$map=@{}; foreach($p in $all){$k=[int]$p.ParentProcessId; if(-not $map.ContainsKey($k)){$map[$k]=@()}; $map[$k]+=[int]$p.ProcessId};` +
        `$dead=@(); $st=New-Object 'System.Collections.Generic.Stack[int]'; $st.Push(${pid});` +
        `$seen=New-Object 'System.Collections.Generic.HashSet[int]';` +
        `while($st.Count -gt 0){ $c=$st.Pop(); if(-not $seen.Add($c)){continue}; $dead+=$c; if($map.ContainsKey($c)){foreach($x in $map[$c]){$st.Push($x)}} };` +
        `foreach($d in ($dead | Sort-Object -Descending)){ Stop-Process -Id $d -Force -ErrorAction SilentlyContinue };` +
        `Write-Output ($dead -join ',')`],
      // 输出缓冲区：默认 1MB，进程表在繁忙机器上会超，超了同样 reject。
      { timeout: 15_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
    )
    const killed = String(stdout ?? '').trim().split(',').map(Number).filter(Number.isInteger)
    return { killed }
  } catch (error) {
    return await fallback(String(error?.message ?? error).split('\n')[0])
  }
}
