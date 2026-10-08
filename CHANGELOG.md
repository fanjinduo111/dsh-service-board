# Changelog

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
