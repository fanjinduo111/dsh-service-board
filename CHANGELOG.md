# Changelog

## 0.3.1 — 只绑 IPv6 的服务不再凭空消失；扫描失败也不再只报命令

### Fixed

- **只监听 IPv6 的服务整条看不见。** 取端口的命令写的是 `netstat -ano -p tcp`，而这个开关
  **只列 TCPv4**；`localhost` 在装了 IPv6 的机器上常被解析成 `::1`，于是 vite / Node 这类只绑
  `[::1]:9528` 的服务在端口表里查不到 PID，`ports` 为空，随即被第一道闸门
  （`ports.length === 0 && (!logPath || NOISE.test(name))`）整条丢弃——面板上什么都没有，
  也**没有任何报错**。实测本机：`-p tcp` 69 条、`-p tcpv6` 16 条、`-ano` 85 条（正好相加），
  只绑 IPv6 的监听有 16 个。改用 `netstat -ano`（UDP 行没有 `LISTENING` 状态，实测 113 行里
  0 行命中，会被过滤掉，不引入噪音）。
- **端口列的 IPv6 显示三处错误。** 具体地址现在带方括号（`[::1]:9528`；`::1:9528` 既不是合法
  URL 也不像地址）；仅 IPv6 的通配绑定显示为 `[::]:p` 并在 title 里说明 IPv4 下不可访问，
  不再冒充 `0.0.0.0:p`；双栈服务（`0.0.0.0:p` + `[::]:p`）合并成一条标签，而不是两条一模一样的。
- **扫描失败的报错只剩命令、没有原因。** 用户报回来的原话是「扫描错误：`Command failed:
  powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command
  $ErrorActionPreference='Stop' Add-Type …`」——六千米长的内嵌 C# 与 PowerShell，**一个字的
  真正原因都没有**。`execFile` 的 reject 消息本来就只是命令行；真正的原因（stderr：`Add-Type`
  被策略禁止、`Get-CimInstance` 报 `The RPC server is unavailable`、受限语言模式、执行策略拒绝）
  留在 error 对象里，从来没有被读过。现在宿主把 stderr 归一成一句话，认出四类常见原因并直接
  点名，附退出码与最多 400 字详情，**任何情况下都不再把命令行带回消息里**。

### Tests

- `test/ipv6-ports.test.mjs`：真起一个 `[::1]` 监听，再跑真扫描器，断言它带着端口与 `::1` 地址
  出现在结果里；对照断言 `netstat -ano -p tcp` **看不见**它（证明这条测试在修复前必然失败）。
- `test/client-dom.test.mjs`：`[::1]:5400` 必须带方括号、`[::]:5401` 只出现一次且 title 说明
  仅 IPv6、双栈的 `0.0.0.0:3306` 只渲染一条。
- `test/scan-error.test.mjs`：用 `execFile` 真实会产生的错误对象覆盖四类原因 + spawn ENOENT，
  并守住「新消息里不得再出现 `-ExecutionPolicy Bypass`」这条反向对照。

## 0.3.0 — 第一次分叉发布（fork of dsh-process-board 0.2.2）

基线是上游 [dsh-process-board](https://github.com/cyanTao/dsh-process-board) **0.2.2**（作者
mr-liangjx，MIT）。这一版把该基线上的面板改造与缺陷修复一起发布；每一项都能在
[docs/patches.md](docs/patches.md) 里找到「症状 → 实测原因 → 修复 → 验证」的完整记录。

### Fixed

- **重启后日志变成「日志不可用：no-log」。** `/log` 按「最近一次*完成*的扫描」解析 pid，而
  `/start` 是回包之后才触发扫描（`/kill` 一直是等扫描收敛的）。测试里复现：`/start` 返回
  pid、端口已监听、日志里已有子进程输出，`POST /log` 仍答 `404 no-log`。现在 `/start` 等一次
  扫描看到该 pid 才回包。
- **扫描器把真服务合并没了。** master/worker 合并规则（为 nginx 而设）原先只按进程名判断，
  于是任何「同名启动器 → 同名服务」都会被当成 master/worker：实测宿主自身在监听时用
  `/start` 拉起 `node.exe` 服务，子进程整条从扫描结果消失、端口算到父进程、`/log` 返回
  no-log。现在合并还要求**命令行一致且非空**，且「带日志标记而祖先没有」的后代永不合并。
- **日志带跟 pid 而不是跟服务。** 重启后是新 pid，带子仍轮询旧 pid，于是变成「日志不可用」，
  而同名服务就在下面一行。现在自动改跟（同名+共同端口 → 同名 → 同一日志文件）；服务真的停了
  显示「进程已结束或正在重启（pid …）」而不是把宿主的 `no-log` 原样抛给用户。
- **面板抢走输入框焦点。** 停止/重启的确认与所有报错原先走 `window.confirm` / `window.alert`；
  在桌面端那是窗口级原生模态，关闭后焦点回到窗口而不是 composer（表现为「输入框没有光标，
  必须重开会话」）。现在确认与报错都在面板内显示（Esc / 关面板 = 取消），关面板时把键盘焦点
  还给打开面板前的元素。
- **日志正文在浅色主题下几乎不可见。** 日志容器用了 `--dsw-alias-bg-l2` 这个应用从未定义的
  token，背景固定为深色而文字跟随浅色主题，对比度 1.07:1。改用真实存在的 token 组合后为
  18.08:1（浅色）/ 16.47:1（深色）。
- **启动时间四舍五入慢 1 秒。** PowerShell 的 `[int64]($ft/1e7)` 会按最近取整（WMI 说
  `17:31:53`，探针报 `17:31:54`）。改为 `[math]::Truncate`。
- **改名分叉后侧边栏入口不出现**（只有打包安装才暴露）。客户端模块 id 必须等于 npm 包名：宿主按
  包名生成客户端 boot graph 的 row id 并据此查找模块，id 不一致时装载器回落到本包自己的
  one-resource URL 再执行一次脚本，报 `client-modules: duplicate factory registration for
  "dsh-process-board"`，入口静默消失。`test/package-identity.test.mjs` 守着这条不变量（反向对照：
  改回旧 id 必须 FAIL），`scripts/set-identity.mjs` 改名时会一并改它。

### Added

- **每行运行时长**：状态列第二行显示 `3时12分`，精确启动时间在元素 `title` 里。
- **停靠式面板**：不再以居中模态遮住界面，改为占住右侧、App 内容滑动让位；宽度可拖拽
  （300–1000px，方向键亦可）并记忆；窄宽度下按容器查询依次收起 HTTP、PID 列。
- **日志带**：日志从右侧独立栏改为列表下方的带子，可全屏，时间戳弱化、ERROR/WARN 高亮。
- **筛选**：`scope` / `ports` / `hide` 三项写入 `~/.dsh/gate/process-board/config.json`，
  手改也在下次扫描生效。

### Verified

14 条自检（见 README「测试」），其中 5 条会起真进程或开真浏览器：`actions.test.mjs`、`restart-path.mjs`、`probe-scanner.mjs`、`log-band.mjs`、`browser-check.mjs`。真机端到端：
把服务日志带打开 → 面板内确认重启 → 日志带跟到新 pid 且内容继续增长
（`band opened: "node.exe · pid 1596"` → `after restart: "node.exe · pid 30936" bad=false fresh=true`）。

**打包安装同样验证过**（不是只在开发副本上验证）：`node scripts/build-package.mjs --pack` 产出
tarball → `dsh plugin --profile forkverify add <tarball>` 装进一个从零建的 profile → 启动 →
`node test/browser-check.mjs "http://127.0.0.1:19412/?token=…"`：`browser check passed`
（入口存在、composer 光标 `caret=true typed=true restored=true`、fixture 行有 日志/重启/停止、
日志带 `node.exe · pid 21088` 有真输出、面板内重启后跟到 `pid 6692` 且 `bad=false fresh=true`）。

## 0.2.2 — 上游基线

分叉起点。上游功能与行为见
[原项目 README](https://github.com/cyanTao/dsh-process-board)。
