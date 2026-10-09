# 发布流程（fork：dsh-service-board）

这份文档是**你**（发布者）的操作手册，面向插件市场（社区 Hub）的收录要求。仓库里有两个脚本，
存在的理由都写在下面——它们各自对应一个已经真实踩到的坑。

> 一句话现状：包已经组装好并通过真机验证（`npm pack` → 装进干净 profile → 启动 → 真浏览器
> 跑 `test/browser-check.mjs` 全绿），缺的只是**你的身份**（GitHub 用户名）和两个账号动作
> （建公开仓库、npm publish）。

## 0. 一次性准备

### 0.1 填身份（一条命令）

包里所有出现 GitHub 用户名的地方都写成了占位符 `fanjinduo111`（package.json 的
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

### 2.1 2FA 与 token 权限（2026-10-08 实测踩到的坑）

账号开了 2FA 时，直接 `npm publish` 会报：

```
E403 ... Two-factor authentication or granular access token with bypass 2fa enabled is required
```

三条路，按推荐顺序：

1. **`npm publish --otp=<认证器 6 位码>`** —— 用本机 `npm login` 的凭据加动态码，一次成功，
   不必生成长期 token（本仓库 0.3.0 第一次真正发布走的就是它）。
2. 建 **Granular Access Token**：权限必须选 **`Read and write (publish and stage)`**，并勾 **Bypass 2FA**。
   ⚠️ 选成旁边那项 **`Read and write (stage only)`** **不会报错**，而是把包送进暂存区：线上出现的
   版本号是占位符 **`0.0.0-stage`**（`latest` 也指向它），真正的 `0.3.0` 要稍后才被放行。
   本次就是这么踩的——第一次发完 `npm view versions` 只有 `0.0.0-stage`。
   所以发布后**必须**核对版本列表里有且只有目标版本：
   ```bash
   npm view dsh-service-board versions --registry=https://registry.npmjs.org
   # 期望 [ '0.3.0' ]；出现 0.0.0-stage 就是 token 权限选错了
   ```
3. Trusted Publishing（CI 专用）或关掉 2FA —— 本机手工发版不适用。

### 2.2 发布后核验（三件，缺一不可）

```bash
# 1) 版本与 latest
npm view dsh-service-board version dist-tags.latest --registry=https://registry.npmjs.org

# 2) 线上 tarball 与本地验证过的文件逐字节一致
npm view dsh-service-board@0.3.0 dist.integrity --registry=https://registry.npmjs.org
node -e "const c=require('crypto'),f=require('fs');console.log('sha512-'+c.createHash('sha512').update(f.readFileSync('.package/dsh-service-board-0.3.0.tgz')).digest('base64'))"

# 3) 按 README 那条命令装一遍，再真机跑浏览器自检
dsh plugin --profile <干净profile> add dsh-service-board --registry=https://registry.npmjs.org
dsh --profile <干净profile> --port 19412 --no-open      # 打印带 token 的 URL
node test/browser-check.mjs "<上面那个 URL>"
```

`--registry=https://registry.npmjs.org` **不能省**：本机 `~/.npmrc` 指向 `registry.npmmirror.com`
（只读镜像），镜像同步有延迟，刚发布的包直接装可能拿到 404。

### 2.3 撤销类操作的额外限制

`npm unpublish` 会被 bypass-2FA 的 granular token 拒绝：

```
E403 ... Granular access tokens that bypass two-factor authentication may not perform this action.
```

要删版本就用 `npm login` 的凭据加 `--otp`，或在 npm 网站的包 Settings 里删。

## 3. 提交到插件市场（免费）

| 市场 | 入口 | 说明 |
|---|---|---|
| DSH Plugin Hub | <https://dsh-plugin.org/zh/submit> | 公开仓库 + `dsh-plugin` topic + README 有 `dsh plugin --profile web add <包名>` + 导出 `apply(ctx)` + 不冒充官方；收录后先是 `unconfirmed`，人工核实后转 `verified` |
| DSH Market | <https://dsh.market/> | 另一家社区市场（上游 README 用的就是它的徽章） |

## 4. 提交前逐条核对

- [ ] `node scripts/set-identity.mjs --check` 通过（无 `fanjinduo111` 残留）
- [ ] 仓库 public，Topics 含 `dsh-plugin`
- [ ] README 第一屏就有 `dsh plugin --profile web add dsh-service-board`
- [ ] README 有截图（`docs/images/*.png`，且在 `files` 里，npm 页面也能显示——上游把图片排除在包外，npm 页面是裂的）
- [ ] README 写清权限/风险 + 「目前只有 Windows 有数据」的诚实说明
- [ ] LICENSE 保留上游版权声明；README 明确写这是 fork、指向原项目
- [ ] `package.json` 的 `version` 与 `CHANGELOG.md` 顶部一致（`test/package-identity.test.mjs` 会查）
- [ ] **客户端模块 id == npm 包名**（改过包名就必须同步；否则入口不出现，且只在真机才暴露）
- [ ] `node scripts/doctor-client-ids.mjs` 全 ok（装完插件后跑；它同时查两件事：客户端 id == 包名，以及带 `dsh.bundle.patch` 的依赖是否出现在 `dsh.profile.bundles` 里）
- [ ] `dsh plugin --profile <干净profile> add <tarball>` 后 `browser-check.mjs` 全绿
- [ ] **`src/` 是真实目录，不是指向已安装插件的 junction**（`test/package-identity.test.mjs` 会拒；见 §8）
- [ ] **profile 的 `dsh.profile.bundles` 列着本包**（缺了它，插件自带的 `cordis.patch.yml` 不生效 → 入口静默消失，无任何报错；见 §9）
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

## 7. 发布记录

| 项 | 值 |
|---|---|
| 仓库 | <https://github.com/fanjinduo111/dsh-service-board>（public，topics 含 `dsh-plugin`，LICENSE 被 GitHub 识别为 MIT） |
| npm | `dsh-service-board@0.3.0`，`latest`；`dist.integrity` = `sha512-B4pwIPoK…R3/9Q==`，与本仓库打出的 `.package/dsh-service-board-0.3.0.tgz` 逐字节一致 |
| git tag | `v0.3.0` |
| 收录申请 | <https://github.com/dshplugin/dsh-plugin-hub/issues/118>（先 `unconfirmed`，人工核实后转 `verified`；README 已含安装命令，爬虫刷新即可发现） |
| 线上遗留 | `0.0.0-stage`（stage-only token 造成的占位版本，见 2.1；不影响安装，`latest` 已是 0.3.0；删除按钮受 2.3 限制） |
| 真机验证 | 按 README 命令从 npm 装入干净 profile，`browser-check.mjs` 通过：`after restart: "node.exe · pid 41112" bad=false fresh=true` |
| 发布后的提交 | 之后对 `README.md` / `docs/` / `test/` 的提交**不改变**已发布的 0.3.0 tarball（`files` 里没有 `test`；npm 上那份 README 仍带收录徽章），下次发版自然跟着更新 |

### 7.1 收录徽章什么时候挂

`https://dsh-plugin.org/plugins/fanjinduo111/dsh-service-board` 在人工核实前是 **404**，
所以 README 里的收录徽章先注释掉了（写「已收录」而页面 404 属于提前声明）。
等这个 URL 返回 200 后再挂回：

```md
[![Listed on dsh-plugin.org](https://dsh-plugin.org/badges/listed.svg)](https://dsh-plugin.org/plugins/fanjinduo111/dsh-service-board)
```

检查一行命令：

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://dsh-plugin.org/plugins/fanjinduo111/dsh-service-board
```

## 8. 别把 `src/` 再做成 junction（2026-10-08 的事故）

这个仓库最初的开发方式是把 `src/` 做成**目录 junction**，指向已安装的插件
（`<profile>/node_modules/dsh-process-board/src`）：改这里、那边 Ctrl+R，很方便。
一旦这个仓库不再等于它所编辑的那个包，方便就变成事故——fork 把客户端模块 id 从
`dsh-process-board` 改成 `dsh-service-board`，这个改动**顺着 junction 写进了用户正在用的
上游同名安装**，于是那台机器的 DSH 网页界面直接打不开（`client-modules: duplicate factory
registration` / `web boot: 1 entry did not activate`）。

现在 `src/` 是真实目录，且 `test/package-identity.test.mjs` 会拒绝被链接的 `src/`。
如果你想继续要"改完立刻生效"的手感，用**复制**代替链接（`scripts/build-package.mjs` 就是
把 `src/` 复制进 `.package/` 再打包的）：

```powershell
# 从仓库推到 profile（单向、显式，坏了也只坏那一个包的副本）
Copy-Item src\* "$env:USERPROFILE\.dsh\profiles\<profile>\node_modules\<包名>\src\" -Recurse -Force
```

使唤完顺手体检一遍：

```powershell
node scripts/doctor-client-ids.mjs
```

要拆 junction 时用 `cmd /c rmdir <目录>`——**不要**用 `Remove-Item -Recurse`，它会顺着链接
删进目标里。

## 9. 入口不见了：按这个顺序查（2026-10-08 两次都踩在这上面）

插件装了、DSH 也能开，但侧边栏就是没有那一行。三个原因、三种症状，别混：

| 症状 | 原因 | 怎么修 |
|---|---|---|
| **整个 DSH 网页打不开**（白屏/转圈，DevTools 里 `duplicate factory registration`、`web boot: 1 entry did not activate`） | 客户端模块 id ≠ 包名（§8 的事故） | 把 id 改成包名；`node scripts/doctor-client-ids.mjs` 会查出来 |
| **界面正常、就是没有那一行**，控制台一条报错都没有 | profile 的 `dsh.profile.bundles` 里没有本包 → 它自带的 `cordis.patch.yml` 不生效，行没被插入 | 加进 bundles：`node scripts/set-bundles.mjs <profile/package.json> add <包名>`（或直接 `dsh plugin --profile <p> add <包名>` 让它自己维护） |
| **网页端有入口、桌面应用里没有**（或反过来） | 装到了另一个 profile：每个 profile 是独立环境 | 装到要用的那个端：`dsh plugin --profile desktop add <包名>`（桌面应用）/ `--profile web`（网页端）；先用 `dsh plugin list` 看本机有哪些 profile |
| **装上完全没反应**，且 `node_modules` 里查不到 | 装错地方（用了 `npm i` / 全局装），DSH 根本不知道它 | 用 `dsh plugin --profile <p> add <包名>` |

改完都要**完全退出 DSH 应用再打开**（侧面栏与客户端启动图是宿主启动时装配的，刷新网页不够）。
一条命令同时体检前两项：

```powershell
node scripts/doctor-client-ids.mjs
```

> 为什么 bundles 会自己少一项？本机这次的清单是 2026-10-08 22:24 被某次 profile 重写改小的
> （同时少了 `dshmarket`）。最可能是当时那个插件**加载失败**触发了应用的整理；无法证实，
> 所以留一句提示：若加回后又消失，先看 `dsh.profile.bundles` 是否又被清掉，再把启动日志/控制台
> 的宿主半报错发出来。
