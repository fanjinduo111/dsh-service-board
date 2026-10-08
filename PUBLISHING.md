# 发布流程（fork：dsh-service-board）

这份文档是**你**（发布者）的操作手册，面向插件市场（社区 Hub）的收录要求。仓库里有两个脚本，
存在的理由都写在下面——它们各自对应一个已经真实踩到的坑。

> 一句话现状：包已经组装好并通过真机验证（`npm pack` → 装进干净 profile → 启动 → 真浏览器
> 跑 `test/browser-check.mjs` 全绿），缺的只是**你的身份**（GitHub 用户名）和两个账号动作
> （建公开仓库、npm publish）。

## 0. 一次性准备

### 0.1 填身份（一条命令）

包里所有出现 GitHub 用户名的地方都写成了占位符 `GITHUB_OWNER`（package.json 的
repository/homepage/bugs、README 的 git 安装方式）。跑一次即可全部替换：

```bash
node scripts/set-identity.mjs <你的GitHub用户名>

# 想同时改包名（会一并改 cordis.patch.yml 的 name、客户端模块 id、README 命令）：
node scripts/set-identity.mjs <你的GitHub用户名> my-service-board

# 检查还有没有残留占位符（没填完会退 1）
node scripts/set-identity.mjs --check
```

`--check` 也是 `scripts/build-package.mjs` 的前置条件：**没填身份就打不了包**，这样不会有
「README 让人装一个不存在的包」的事故（市场核查明确点过这个失败模式）。

### 0.2 起仓库

```bash
git remote add origin https://github.com/<你>/dsh-service-board.git
git branch -M main
git push -u origin main
```

仓库要**公开**（市场收录硬要求）。推上去之后在仓库的 **Settings → Topics** 加上主题
**`dsh-plugin`**——爬虫按这个主题识别，漏了就不会被收录。

### 0.3 npm 账号

```bash
npm login          # 或用 token：npm config set //registry.npmjs.org/:_authToken=...
npm whoami         # 必须打印出你的用户名
npm view dsh-service-board version   # 期望 E404（名字还空着）
```

## 1. 本地预演（发布前每次都做）

```bash
node test/package-identity.test.mjs   # 打包不变量：模块 id = 包名、files 带 src、patch 指对文件
node scripts/build-package.mjs --pack # 产出 .package/dsh-service-board-<版本>.tgz
tar -tzf .package/dsh-service-board-0.3.0.tgz   # 必须看到 package/src/** 六个文件
```

**为什么要 `build-package.mjs` 而不是直接 `npm pack`**：本仓库工作区的 `src/` 是指向桌面
profile 已安装副本的**目录联接（junction）**——这正是「改这里 → Ctrl+R 就能看到」的开发通路。
**npm 不跟随 junction**：直接 `npm pack` 打出的包里根本没有 `src/`（实测 7 个文件、0 个源码），
装上去是个「装得上、什么都不做」的空插件。`git clone` 出来的仓库没有这个问题（git 存的是普通
文件），所以脚本只服务于「从本工作区发布」这一条路径。

然后把 tarball 真装一次（不要用 `link:`，要验证包本身）：

```bash
# 造一个干净 profile（manifest 必须是无 BOM 的 UTF-8 JSON，否则 dsh plugin 会 JSON.parse 失败）
node -e "require('fs').writeFileSync(process.argv[1],JSON.stringify({name:'dsh-profile-forkverify',private:true,dependencies:{},dsh:{profile:{bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app']}}},null,2)+'\n')" "$USERPROFILE/.dsh/profiles/forkverify/package.json"

dsh plugin --profile forkverify add <tarball 绝对路径>   # 会自动把包加进 dsh.profile.bundles
dsh --profile forkverify --port 19412 --no-open         # 记下打印的 token
node test/browser-check.mjs "http://127.0.0.1:19412/?token=<token>"
```

`browser-check.mjs` 通过的标准输出末尾是 `browser check passed`，其中必须包含
`sidebar entry` 存在、`caret=true typed=true restored=true`、以及日志带在重启后跟到新 pid
（`after restart: "node.exe · pid <新>" bad=false fresh=true`）。

## 2. 发布

```bash
npm publish --access public      # publishConfig.access 已设 public
git tag v0.3.0 && git push --tags
```

## 3. 提交到插件市场（免费）

| 市场 | 入口 | 说明 |
|---|---|---|
| DSH Plugin Hub | <https://dsh-plugin.org/zh/submit> | 公开仓库 + `dsh-plugin` topic + README 有 `dsh plugin --profile web add <包名>` + 导出 `apply(ctx)` + 不冒充官方；收录后先是 `unconfirmed`，人工核实后转 `verified` |
| DSH Market | <https://dsh.market/> | 另一家社区市场（上游 README 用的就是它的徽章） |

## 4. 提交前逐条核对

- [ ] `node scripts/set-identity.mjs --check` 通过（无 `GITHUB_OWNER` 残留）
- [ ] 仓库 public，Topics 含 `dsh-plugin`
- [ ] README 第一屏就有 `dsh plugin --profile web add dsh-service-board`
- [ ] README 有截图（`docs/images/*.png`，且在 `files` 里，npm 页面也能显示——上游把图片排除在包外，npm 页面是裂的）
- [ ] README 写清权限/风险 + 「目前只有 Windows 有数据」的诚实说明
- [ ] LICENSE 保留上游版权声明；README 明确写这是 fork、指向原项目
- [ ] `package.json` 的 `version` 与 `CHANGELOG.md` 顶部一致（`test/package-identity.test.mjs` 会查）
- [ ] **客户端模块 id == npm 包名**（改过包名就必须同步；否则入口不出现，且只在真机才暴露）
- [ ] `dsh plugin --profile <干净profile> add <tarball>` 后 `browser-check.mjs` 全绿
- [ ] 别和上游 `dsh-process-board` 同时装在同一个 profile（会插两行侧边栏入口）

## 5. 之后每次发版

1. 改 `package.json` 的 `version`，在 `CHANGELOG.md` 顶部记这次改了什么（症状→原因→验证）
2. `node test/package-identity.test.mjs` + 全套 `test/*.mjs`
3. `node scripts/build-package.mjs --publish`
4. `git tag v<版本> && git push --tags`

## 6. 已知的、故意的取舍

- **只在 Windows 有数据**：`src/host/scanner.js` 在非 win32 直接返回空数组；POSIX 扫描器（`ps` +
  `lsof -i` + `/proc/<pid>/environ`）尚未实现。README 明写了这一点，别在市场描述里含糊。
- **重启会等一次扫描**（1–3 秒）：这是修「重启后 no-log」的直接代价，`/start` 要等新进程进入
  扫描结果才回包。按钮上表现为短暂「执行中…」。
- **同时装上游会重复两行入口**：两个包各自注册自己的插件行，这是设计使然，不是 bug。
