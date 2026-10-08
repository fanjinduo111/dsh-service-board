# dsh-process-board patches

Local patches for the installed `dsh-process-board` plugin, with the tests that
justify them.

## Why this directory exists

The plugin is installed from npm into a DSH profile, so the patch itself lives in
`node_modules` — that is where the running host loads it from, and there is no
package-level hook to override one file. Keeping the patch here means the change
is reviewable, the reasoning is written down, and the tests run against the real
installed file instead of a copy.

`src/` is a junction to the installed package, so `test/guard.test.mjs` and
`test/http.test.mjs` import *the code that is actually running*.

## The patches

### 1. `src/host/index.js` — the request trust fence (`guard`)

**Symptom:** the panel showed `加载失败：HTTP 403`. The message even ships with
the plugin (`（host 插件未启用？）`), so it was the plugin's own refusal, not the
harness's browser fence.

**Cause:** the shipped fence accepted a request only when

```js
req.socket.remoteAddress is loopback
  && (req.headers['sec-fetch-site'] === 'same-origin' || typeof req.headers.origin === 'string')
```

A same-origin `fetch` from a page normally carries **neither** header — `Origin`
is omitted for same-origin GET, and `Sec-Fetch-Site` is not sent by every client.
So ordinary, entirely legitimate requests were refused. The condition had the
axis wrong as well: it accepted *any* `Origin`, which is precisely what a
cross-site caller supplies, while ignoring `Host`, which is the one header a
DNS-rebinding attack cannot forge.

**Fix:** state the two rules that matter for a route that skips the harness's own
browser-auth fence:

1. the request was addressed to a loopback authority — the anti-rebinding rule;
2. any provenance the browser did send (`Origin`, `Sec-Fetch-Site`) agrees with
   that authority.

A missing marker is not suspicious (a same-origin GET has none); a marker that
disagrees is refused. Every refusal now returns a JSON body naming the rule that
fired, so a future failure is diagnosable from the wire alone.

### 2. `src/client/index.js` — a docked column, not a centred modal

**Symptom:** opening the panel covered the conversation with a full-screen modal
and its mask, so the user could not keep working while watching services.

**Fix:** the panel is docked to the right edge, the mask is disabled, and the app
**makes room** for it instead of being covered. The panel is a sibling of the app
root, so reserving the space is one inset on `#root`: the whole interface narrows
and slides left, which is the reflow the product's own right sidebar performs in
its default `push` mode. The script applies the width inline from a single
`dockWidth()`, so the panel width and the reserved inset cannot drift apart, and a
`resize` listener keeps both correct.

Three defects were found and fixed while building this, each by a test rather than
by reading the code:

1. **`position: static`.** The first patch set `inset` without restating
   `position`, so the panel rendered at the end of the document flow — outside the
   viewport — and the click appeared to do nothing. A computed-style assertion in
   `client-dom.test.mjs` caught it.
2. **A control that looked like the window's.** The panel's collapse control sat a
   few pixels from the desktop shell's own close button and also read as `×`, so
   the two were indistinguishable in the same corner. It is now relabelled `收起`
   with an aria-label and title saying it collapses the panel, not the DSH window.
   The fullscreen toggle is hidden rather than left inert, since a docked
   full-height column has nothing to expand into.
3. **A hardcoded dark palette.** As a centred modal the panel was a raised card, so
   its own colours were right; docked it is a column of the page and must follow the
   application's theme. The surfaces, borders, and text now use the app's design
   tokens (each with the previous literal as fallback), so a light theme does not
   leave a dark slab beside the conversation. The per-service accent colours are
   deliberately **not** tokenised: they are content, not chrome.

**Verified by:** `test/panel-css.test.mjs` parses the sheet and asserts the
structural rules, `test/panel-css-control.mjs` is a negative control — it downloads
the published bundle and confirms every rule the patch adds is absent there and the
rules it replaces are present, so a green result is attributable to the patch rather
than to a test that passes on any input — and `test/client-dom.test.mjs` drives the
shipped file in jsdom, asserting the panel docks, the app reserves matching space,
the space is released on every close path, and each control does what its label
says.

### 4. `src/host/config.js` + `/config` — a filter, because the panel listed the whole machine

**Symptom:** the panel showed every listening process on the computer — a cloud
drive's helper, system services, even test runners — so the services the user cared
about were buried. There was no way to say what to watch.

**Fix:** a `config.json` beside the registry with three orthogonal filters, applied
in the state handler rather than in the scanner (the scanner's output is the
machine's truth; the panel is a view):

| Field | Meaning |
|---|---|
| `scope: 'session'` | only services with a DSH session marker or inside the host's process tree; `'all'` is the default, unchanged behaviour |
| `ports: [3306]` | an explicit port allowlist, which wins over every other rule |
| `hide: ['baidu']` | name fragments to exclude, case-insensitive |

The panel grows a `筛选` control for all three, and the host supports `GET`/`POST
/api/plugins/process-board/config` with partial merging, so one field can be sent at
a time. The file is re-read on every scan, so a hand edit takes effect without a
restart, and a corrupt file falls back to the defaults rather than blanking the
panel.

### 5. `src/client/index.js` — the log is a band under the list, not a column beside it

**Symptom:** 「现在日志跟列表在同一行，导致一行太宽了，日志应该出现在整个面板的靠下位置」.
Clicking 日志 squeezed the service list instead of opening the log somewhere of its own.

**Cause, measured rather than read.** `test/log-band.mjs` loads the real client file in
real Chrome with a stubbed API and measures rectangles. Before this patch it reported:

```
layout height  : 1026533 vs dialog 854 (viewport 900)
log            : 0x1026533 at 112..1026645
log body       : 32x1026363 (scrolling=false)
```

1. **The log was a column, and `flex:1 1 100%` was believed to make it "take the whole
   panel".** A flex-basis is not a width. In a nowrap row the list keeps its content
   width and the log takes what is left, so the two squeeze each other — and with long
   log lines the log's max-content width won the shrink, leaving the column 0px wide.
   `panel-css.test.mjs` asserted that very rule and repeated its claim in a comment,
   which is why this arrived as a person's report rather than as a failing test.
2. **The panel's height came from its content.** The published sheet made `.dshpb-dialog`
   a flex column (`display:flex; flex-direction:column; overflow:hidden`); docking
   rewrote that rule for its geometry and lost those three declarations, so
   `.dshpb-layout`'s `flex:1` had no flex parent to apply to. Nothing overflowed
   *visibly* — the panel is `position:fixed` — so 400 log lines grew the panel to
   1,026,533px inside an 854px dialog, and the log could not scroll either: everything
   past the window edge was simply unreachable.

**Fix:** the layout is a column, the list keeps the panel's full width, and the log is a
band across the bottom with a height of its own and its own scrolling body. The height is
a `clamp(150px, 38vh, 420px)` rather than a percentage: a percentage flex-basis on the log
resolves against the layout's height, which flex itself resolves, and a percentage
`max-height` against an unresolved height is ignored outright. The dialog is a flex column
again and clips, so nothing can grow past the panel. The separator between the two is the
band's own top border, which exists only while the log is open, so closing the log needs
nothing undone.

Clicking another service's 日志 switches the band to that service and **marks the source
row** in the list (accent bar, background, `aria-current`): the band is at the bottom and
the row can be anywhere in the list, so an unmarked list leaves the user matching a pid by
eye to find out what is on screen. The mark is re-derived from the log's pid after every
render, because the eight-second refresh rebuilds every row — which is also what makes a
second click move the mark instead of leaving two rows claiming the band. Opening the band
shortens the list, so the clicked row is scrolled back into view if that pushed it out;
the periodic refresh deliberately does not, which would yank the list while it is read.

**Verified by:** `test/log-band.mjs` drives the real client file in real Chromium — no DSH
instance is needed, because the page provides the `window.__ModuleLoader__` the bundle
registers with and stubs every request it makes — and asserts that the band is under the
list, spans the panel, scrolls on its own, that the layout is never taller than the dialog,
that the dialog never leaves the viewport, that a second service's 日志 switches the band
and moves the mark, and that the mark survives an auto-refresh. `test/panel-css.test.mjs`
asserts the structure that actually stacks, `test/panel-css-control.mjs` confirms every
rule of it is absent from the published bundle *and* that the published sheet is the
side-by-side, flex-column-dialog version this patch replaces, and `test/client-dom.test.mjs`
drives the switch, the mark and the poll stopping on 收起 in jsdom.

### 6. `src/client/index.js` + `test/fixtures/dsh-theme-tokens.json` — the log named a theme token that does not exist

**Symptom:** 「怎么日志里面字体都是纯黑的啊，看不出来东西」. In the light theme the log
band painted near-black text on a near-black field: the lines were there, and unreadable.

**Cause, measured from the application's own sheet rather than read from the plugin.** The
log's colours were supposed to be a *pair*, and only one half of it resolved:

| half | what the sheet said | what the application resolves it to |
|---|---|---|
| background | `var(--dsw-alias-bg-l2, #16181f)` | nothing — the app defines `bg-layer-1/2/3` and never `bg-l2`, so `#16181f` was what always painted |
| text | `var(--dsw-alias-label-primary, #e6e8ec)` | the light theme's `rgb(15, 17, 21)` |

So the light theme rendered `rgb(15, 17, 21)` on `#16181f` = **1.07:1**, while the same page
in the dark theme rendered 16.96:1. That asymmetry is why every earlier check passed:

1. A `var()` naming something the page does not define is not an error anywhere — the
   fallback *is* the mechanism — so no assertion about the stylesheet could notice. The
   stylesheet test even repeated the claim in a comment.
2. `log-band.mjs` defined no theme tokens at all, so every `var()` in the sheet fell back to
   the dark literals it was written with: the harness was exercising the one theme in which
   this bug cannot happen. It had been testing the broken state's twin.

The invented name came in with this repository's own tokenisation of the panel (commit
`f183a37`, "so a light theme does not leave a dark slab beside the conversation"); the
published 0.2.2 sheet names no `--dsw-alias-*` token at all, which `panel-css-control.mjs` now
asserts. Two more names from that same block, `--dsw-alias-fill-l1` and `--dsw-alias-fill-l2`,
do not exist either (the app's are `--dsw-alias-interactive-bg-hover` and `…-hover-accent`);
their fallbacks happened to be translucent greys, so those two were wrong *quietly*.

**Fix:** the log surface takes both of its colours from the application's own code-surface
pair — `--dsw-alias-markdown-code-block` with `--dsw-alias-label-primary`, the two the app's
own code blocks use — in a single rule, with no docked override to drift away from it, since
the override is where the dark literal got in. The two invented fill names are replaced by the
real interaction tokens, and each line's leading timestamp is split out and dimmed with
`--dsw-alias-label-tertiary`, so a line has a shape and the message is what the eye lands on.
Two further misuses of `--dsw-alias-label-dimmed` — `rgb(225, 229, 238)` in the light theme,
which is the app's *placeholder* colour — moved to readable tokens: the session group heading
to `label-secondary` (5.21:1) and the config path to `label-tertiary`, while the input
placeholder keeps `label-dimmed`, because the app's own `Input` uses it for exactly that.

**Verified by:** `test/fixtures/dsh-theme-tokens.json` is the application's real token list,
taken from its installed sheet, and `panel-css.test.mjs` asserts that no `--dsw-alias-*` name
the plugin uses is missing from it — the check that would have caught this class of bug.
`test/log-band.mjs` now carries the application's own theme, both blocks, resolved through
their `var()` chains, and measures contrast in **both** themes instead of assuming one:

```
light theme : log text rgb(15, 17, 21) on rgb(249, 250, 251) = 18.08:1
              timestamp rgb(129, 133, 140) = 3.55:1
              group label rgb(97, 102, 107) = 5.21:1
              (the same text on the missing token's #16181f fallback: 1.07:1)
dark theme  : log text rgb(249, 250, 251) on rgb(27, 27, 28) = 16.47:1
```

with a screenshot of each (`artifacts/log-band-light.png`, `artifacts/log-band.png`), and
`client-dom.test.mjs` asserts the timestamp split both ways: a line that has one still reads
exactly as it arrived, and a line that does not is left alone.

### 7. `src/client/index.js` + `src/host/scanner.js` — every row says how long its process has been up

**Asked for:** 「给每个监控的任务上加一个启动时间，或者运行时间」. A row should say when the
process it names started, or how long it has been running.

**Both, in one place.** The age is what a list answers at a glance — did this one restart? —
so it sits in the state cell under the state word (`运行中 / 3时12分`), and the exact
wall-clock start time rides in that element's `title`. No new scanner field was needed: the
probe has reported `created` since the first version, and the published panel simply never
showed it.

It is a second line inside the state cell rather than a seventh column, for a measured
reason: the panel is 460px wide by default and the narrow-width container queries ahead of it
already give up HTTP and then PID, so a new column would have been the first thing hidden and
the last thing missed. The row is two lines tall already — the service name sits above its
command — so this line costs no height at all, and nothing has to be renumbered: those
queries select columns by `nth-child`.

**The value was wrong before it was ever displayed.** `created` is FILETIME seconds (since
1601), and the probe built it as `[int64]($p.CreationDate.ToFileTimeUtc()/10000000)`:
PowerShell divides in floating point and the cast then *rounded to the nearest* second, so a
process that started at `17:31:53.7` was reported as `17:31:54`. That was invisible while the
value was only used to order two instances of the same port — and it becomes a wrong 「启动于」
the moment it is put in front of a person. The probe truncates now (`[math]::Truncate`), and
`probe-scanner.mjs` reads WMI independently to compare every scanned process against it, which
is the check that caught the extra second: `start times : 2 comparable, 0 wrong`. The unit was
deliberately left as FILETIME seconds rather than switched to the Unix epoch, because a
browser refresh outruns a host restart: a client expecting Unix seconds while an older host
was still running would have shown `0秒` on every row, with a year-2395 tooltip.

**Verified by:** `client-dom.test.mjs` renders a process that started exactly two hours ago and
asserts the cell reads `2时0分` with `启动于 …，已运行 2时0分` in the title — and that a row with
no creation time at all (a service recalled from the registry, not scanned) claims no age
rather than inventing one. `log-band.mjs` asserts that all 24 rows carry an age in real
Chromium at 460px, that the ages differ per row instead of one value repeating, that they
survive the eight-second refresh, and that the action column still ends inside the panel with
the line in place. `panel-css.test.mjs` pins the shape: a `display:block` second line, smaller
than the state word, muted with the theme's tertiary label — the same token as the log
timestamps — in tabular figures so a column of ages does not jitter as the digits change.

### 8. `/start`, the scanner's merge, and the log band — 「我重启之后显示不可用」

**Reported:** `java.exe · pid 38784 / …\pb-java-backend.log / ⛶ / ×` with the log reading
`日志不可用：no-log`, and 「我重启之后显示不可用」. A service restarted from the panel could not
be watched afterwards, although it was demonstrably running and writing to the same file.

Three separate causes, each measured rather than inferred.

**The start route answered before its own rescan.** `/log` resolves a pid against the last
*completed* scan, and `/start` replied and then called `scan()` without waiting — the opposite
of `/kill`, which already waited for exactly this reason. Reproduced in `actions.test.mjs`: the
route returned pid 30252, the port was open and the log file contained the child's own
`READY 5422` banner, and `POST /log` still answered `404 no-log`. `/start` now awaits a scan and
answers only once the pid is in it. (For that to mean anything, `scan()` also returns the
in-flight promise instead of a bare `return`: awaiting it now means "a scan finished", not "a
scan is already running".)

**The scanner's master/worker merge deleted a real service.** The rule exists for nginx: when a
same-name process is a descendant of another, only the ancestor is listed, because killing a
worker just makes the master fork a new one — and the worker's listening sockets are merged into
the ancestor's row. Keyed on the *name alone*, that rule swallowed any "launcher and service
happen to share an executable name" chain. Measured with the host itself listening (as it does —
the panel is served over HTTP) and a `node.exe` service started by `/start`: the child
disappeared from the scan entirely, its port 5455 was credited to the launcher, and `/log`
answered `no-log` for a process that was running the whole time. The merge now also requires the
same command line — a master and its workers run the same program with the same arguments, while
a shim or a wrapper script is a different program — and never merges away a descendant carrying a
log marker its ancestor lacks, which is a process the panel started itself. Nothing covered this:
`restart-path.mjs` passed throughout, because the process that starts its probe binds no port and
so never entered the merge at all.

**The band followed a pid, not a service.** A restart is a stop and a start, so the service comes
back under a new pid; the band kept polling the old one and became `日志不可用` while the same
service, writing to the same log file, sat one row below. The band now re-targets on the next
render — same name and a port in common, else the same name, else the same log file — and when
the service really is gone it says so (`进程已结束或正在重启，日志不再更新（pid …）`) instead of
repeating the host's error code at someone who is looking at their process.

**Verified by:** `actions.test.mjs` now starts a real process and immediately asks `/log` for the
pid it was just given (it must return the child's own output) and asserts `/state` still lists
that pid, since the merge case is exactly a service whose launcher shares its name.
`client-dom.test.mjs` drives the client with a stub that moves the service to a new pid mid-poll:
the band must end up asking for `7400` and must not report the log unavailable — and with the
service removed, the honest message and never the raw `no-log`. `browser-check.mjs` does the whole
thing against a real instance with a real fixture service (127.0.0.1:37699, a real log file):
watch its log, click 重启, confirm, and the band follows it —
`band opened : "node.exe · pid 28204"` → `after restart : "node.exe · pid 26704" bad=false
fresh=true`.

The merge itself is a pure function now, because it had no test at all and that is how it deleted a
service. `scanner-merge.mjs` pins both directions on fabricated process tables: an nginx-shaped
master/worker chain (including a grandchild) still collapses to one row carrying every worker's
ports, while a launcher and the service it started, a javapath-style shim and the real process, a
marked descendant, and a pair whose command lines could not be read all keep their own rows. The
last two are deliberate about the direction of the trade: a duplicate row is visible and the user
can act on it, a hidden service is a silent `no-log`. If some master/worker pair does not share its
command line after all, it now shows two rows rather than one — the failure mode is noise, not
loss.

### 9. `src/client/index.js` — the composer lost its caret after the panel was used

**Reported:** 「我把页面关闭之后，dsh的输入框老是没有光标了，必须重新关闭打开一个，才能有光标，
进行文字输入」.

**First, the part that could not be reproduced.** Driving a real Chromium against a real DSH
instance, the composer takes the caret at every step: before the panel is touched, while it is
open, after 收起, after the log band is opened and closed, and after typing into the panel's
filter first (`caret=true typed=true` every time). The one thing about this plugin that behaves
differently in the desktop application than in a plain browser page is that it used the *window's*
dialogs: `window.confirm` for 停止 and 重启, and `window.alert` for every failure. In Electron those
are modals owned by the window rather than by the page, and when they close, focus goes back to
the window instead of to the composer — which is the reported missing caret, and re-opening a
session re-mounts the composer, which is the workaround that was described. They were also
untestable, blocked the page, and wrapped a replayed command line badly.

So the panel now asks its questions itself: a strip under its header with 取消 and 确认, cancelled
by Escape or by closing the panel, and a second strip for failures that expires on its own.
`client-dom.test.mjs` clicks both (取消 must not reach `/kill`, 确认 must stop the pid whose row was
clicked, 重启 must show the command it will replay), and asserts that `window.confirm` and
`window.alert` are never called at all.

**Second, the focus the panel does take legitimately.** Opening it moves the keyboard to its own
controls, and closing it used to leave focus on a button that `display:none` then drops to
`<body>`. It now remembers what had the keyboard when it opened and gives it back on close, if
that element is still in the document — the panel does not need to know the application's DOM to
undo its own focus theft.

**Honest limit:** the desktop application itself was not driven (it belongs to the user), so the
caret is asserted in a real page, not in that exact window. `browser-check.mjs` measures it there —
`benchmark, panel untouched: caret=true typed=true` and `composer after 收起: caret=true
typed=true` — so the reported behaviour is now checked in the real UI instead of assumed.

## Three defects found by testing operations against real processes

The first round of work on this plugin shipped a `停止` button that did nothing for
the user. The cause was not one bug but a chain, and every one of them lived exactly
where the earlier tests had stubbed:

1. **The button stayed disabled.** The handler disabled the control, then restored it
   in `finally` only `if (!b.disabled)` — which was never true, because it had just
   disabled the button itself. So the first click left the row showing `执行中…`
   permanently, with no further effect: indistinguishable from "no reaction".
2. **Failures showed raw commands.** A rejected `execFile` stringifies to
   `Command failed: powershell.exe -NoProfile …`, so a failed stop alerted the user
   with an entire PowerShell command line instead of a cause.
3. **`killProcessTree` rejected on paths where it had still worked.** PowerShell may
   exit non-zero (execution policy, timeout, output buffer) while the processes are
   already dead; the rejection became an HTTP 400, which is what produced (2). It now
   reports failure as a result — `{ killed, failed }` — and falls back to signalling
   the target directly.

## Two defects that only a real browser could show

A user reported that the panel had no collapse button. It did: the header markup
declared one, `client-dom.test.mjs` found it, and `browser-check.mjs` measured it. It
was simply impossible to see or click, for two separate reasons.

1. **It was under the window's own buttons.** The docked panel starts at the top of
   the viewport, and the native minimise / maximise / close buttons occupy the same
   top-right corner. The header controls were drawn underneath them. The dialog is now
   inset below that strip.
2. **It was under the application's root.** Once the header moved down, its text was
   still clipped by about 24px on the left. Every `getBoundingClientRect` said the text
   was inside the panel; the pixels disagreed. The app mounts a fixed root at
   `z-index: 1000` and the panel's original `901` put the panel *underneath* it, so the
   app's own 24px left padding painted over the first two dozen pixels of every line.
   The panel is now `1100`, and `browser-check.mjs` asserts with `elementFromPoint`
   that a point inside the panel actually reaches the panel — the only kind of check
   that sees this class of bug.

A third defect in the same family was self-inflicted and worth recording: the docked
rule used a `padding-top` to clear the control strip, on a dialog that was
`height: 100vh` with `box-sizing: border-box`. The padding pushed the box to `-46px`
and the content back to `0`, so the two offsets cancelled and the header did not move.
Anchoring both edges is the version that works.

**And one that was invisible for several rounds:** a stylesheet edit was applied by
matching `...res.status}\`; return }` in a function below the sheet, so the CSS landed
*inside* a template literal and `const CSS` never closed. Every docked style silently
stopped applying, while `check-css-literal.mjs` reported the file healthy — its span
ran from `const CSS = \`` to the *next* backtick, which was then far away, so it took
the whole polluted region for the stylesheet and found its braces balanced.
`check-css-literal-control.mjs` now reproduces that exact corruption and asserts the
guard rejects it, and the guard locates the literal's real end instead.

## Two more that a user's screenshot found

**The port tags wore a box.** A wildcard bind was marked with
`border-style: dashed` — but setting the style alone leaves the border at its initial
`medium` width, so every port tag grew a frame. The marker is a colour change now, and
`panel-css.test.mjs` asserts that no port rule sets a border style without a width.

**The column headers wrapped one character per line.** At a 460px panel the
two-character `状态` header had roughly twelve pixels per character, so it stacked
vertically. Cell text is `nowrap` now, and — the real answer to the report — the panel
is **resizable**: a drag handle on its left edge, 300–1000px, with arrow-key support,
and the chosen width stored in `config.json` so it survives a reload. The panel and the
space reserved for it are driven by the same number, so they cannot disagree.

`verify-resize.mjs` drives all of that in a real browser: the port tag has no border,
no column header exceeds 40px tall, dragging widens the panel *and* the reserved space
together, and after a reload the panel returns at the stored width.

## A live service to exercise the panel with

`D:\work\demo-service.js` is a throwaway service built for exactly that: it binds two
loopback ports so a row shows more than one bound address, prints a startup banner and
a heartbeat, exposes `/noise` to make the log grow on demand, and handles SIGTERM so
"停止" has a graceful path to take as well as a hard one.

```powershell
$env:DSH_PB_LOG = "$env:TEMP\pb-demo-service.log"   # the marker the panel reads
node D:\work\demo-service.js
```

Both operation checks use it: `live-service.mjs` drives the four endpoints against an
already-running instance — polling for the first scan, because the state route answers
from the previous scan and a cold start legitimately has nothing — and `shot-live.mjs`
photographs the result through the session filter.

## Three narrow-width defects, all found by measuring

The action column is the reason the panel is open at all, and it kept leaving the
panel. Each cause was only visible in a measurement:

| Symptom | Cause |
|---|---|
| Two ports widened the row until PID and the buttons left the panel | the port tags' wrapper was a plain `<span>`, and `flex-wrap` does nothing on an inline element |
| The table overflowed by 47px at 700px | the service column grew to whatever the command preview asked for; the preview was allowed 380px |
| Overflow returned at the narrowest widths | the table's minimum content width exceeded the panel regardless of the caps |

The first two are fixed by wrapping the tags in an `inline-flex` box and capping the
preview and its column. The third needs `table-layout: fixed` with declared column
widths, which is the only way to guarantee the buttons stay reachable rather than
merely likely. The panel's minimum is 360px rather than 300, because below that six
columns cannot fit and a service list that scrolls horizontally past its own buttons is
worse than a floor.

`verify-resize.mjs` sweeps ten widths and asserts, at each one, that the table stays
inside the panel and the action column still holds its buttons — plus that a dragged
width survives a reload.

## Tests

```sh
node test/actions.test.mjs        # /kill and /start against real child processes
node test/restart-path.mjs        # start, scan, stop, replay from argv, rescan
node test/config.test.mjs         # the filter: HTTP, disk, hand-edit, corruption
node test/guard.test.mjs          # the fence's decisions, via the real route handler
node test/http.test.mjs           # the same decisions over a real socket and server
node test/panel-css.test.mjs      # the docked-panel stylesheet structure
node test/panel-css-control.mjs   # negative control against the published bundle
node test/client-dom.test.mjs     # the shipped client bundle driven in jsdom
node test/check-css-literal.mjs src/client/index.js
node test/log-band.mjs            # the log band under the list, measured in Chrome
node test/cmdline.test.mjs        # Windows command-line splitting
node test/scanner-merge.mjs       # the master/worker merge, on fabricated process tables
node test/probe-scanner.mjs       # the real scanner against this machine
node test/browser-check.mjs <url> # a real instance in Chromium: panel, caret, restart
```

`actions.test.mjs` and `restart-path.mjs` exist because a button the user pressed did
nothing while every test passed: the operations had only ever been tested against
stubs. They run real processes and assert on the processes, not on the responses.

`config.test.mjs` covers what a unit test would miss — that a change survives the
round trip *and* a write to disk, that a partial patch merges rather than replaces,
that a hand-edited file is picked up on the next scan, and that a corrupt file falls
back instead of blanking the panel.

`guard.test.mjs` pins both directions: every shape a real browser sends passes,
and every shape an attacker can produce fails — including DNS rebinding
(`Host: evil.example.com`), cross-site fetch metadata, a foreign `Origin`, a
loopback `Origin` on another port, and a non-loopback remote address.

`http.test.mjs` mounts the plugin on a real `node:http` server and speaks to it
over a socket, so Node's own client produces the request line and headers rather
than a stub. That matters because the bug was a wrong belief about which headers
a browser sends; the closer the test stands to a real connection, the more it
proves.

`check-css-literal.mjs` exists because the stylesheet lives inside a JavaScript
template literal: a single backtick written in a CSS comment terminates the string
and the whole client half disappears from the UI. That mistake was made twice
while writing this patch, so it is now a test.

### Checking the real interface

`client-dom.test.mjs` runs the bundle against a fake DOM, which cannot tell you
whether the plugin renders inside the running application. `browser-check.mjs` loads
a real DSH instance in real Chromium, clicks the sidebar entry, and reports what the
panel actually contains:

```sh
# Boot a profile that is NOT owned by the desktop application. Before trusting the
# run, confirm which copy the profile holds:
#   Select-String <profile>/node_modules/dsh-process-board/src/client/index.js -Pattern dshpb-cfgtoggle
dsh --profile <profile> --port 19410 --no-open
node test/browser-check.mjs "http://127.0.0.1:19410/?token=<token printed by that line>"
```

It fails when the sidebar entry never appears, when the panel does not open, when it
is not a docked column, when the app does not reserve space for it, or when a header
control is missing — and it prints the console errors and failed requests that
explain why.

It also drives the two behaviours a fake DOM cannot judge: it types into the
application's own composer before and after the panel is collapsed (the caret the
desktop report was about), and it spawns a real fixture service on 127.0.0.1:37699 with
its own log file, watches that log, restarts the service through the panel's own 確認
button and asserts the band follows it to the new pid. That fixture is temporary: it is
stopped and its directory removed at the end of the run, and the profile's own
「预览版说明」 modal is dismissed first, because it covers the composer while it is up.

Two things it taught, both the hard way:

- **The `desktop` profile cannot be booted this way**; the Electron application owns
  it. Clone its `package.json`, then copy its `node_modules/dsh-process-board` across
  to check the same bytes.
- **`pnpm install` replaces `node_modules/dsh-process-board` with the published
  package**, discarding every patch here. The first `browser-check` run reported the
  *published* plugin's behaviour, which read as "the patch does not render" for
  several rounds. The check now prints which copy it found before judging it.

## Publishing it as a fork: two defects only `npm pack` + a real install could show

The fork ships as its own npm package (`dsh-service-board`), and the packaging itself
turned out to have two traps. Neither is visible in the source tree, in `npm pack`
output, or in the jsdom tests — both need a packed tarball installed into a clean
profile.

**1. `npm pack` does not follow the `src/` junction.** In this working tree `src/` is a
junction to the desktop profile's installed copy, which is the whole development loop
(edit here, Ctrl+R, see it). `npm pack --dry-run` with `"files": ["src"]` produced
**7 files and no `src` at all** — a package that installs cleanly and then does nothing.
`git clone` is unaffected (git stores ordinary blobs), so this only bites the working
tree it was developed in. Fixed with `scripts/build-package.mjs`, which copies every
file into `.package/` with `dereference: true`, refuses to continue if a link survived
or if the staged client lacks the patch marker, and packs from there.

**2. The client module id must equal the package name.** The first packaged install
failed to render at all:

```
sidebar entry  : MISSING
pageerror: client-modules: duplicate factory registration for "dsh-process-board"
               (bundle executed twice without invalidate?)
patch bundle   : /plugins/??@deepseek-ai/dsh-client-ui-open-in-app/client.js,…  (10465707B)
patch bundle   : /plugins/??dsh-service-board/client.js&rev=bfb91663475f       (77978B)
```

Both bundles carried this client, and the second execution threw. The host builds each
client boot-graph row from the **package name** (`dsh-service-board`) and the loader
looks the module up under it; this client still registered the upstream id
`dsh-process-board`. Reading the loader
(`@deepseek-ai/dsh-client-modules/lib/client.js`) explains the mechanism: the boot
manifest's entries each belong to exactly one batch, a batch that does not register the
row makes the loader fall back to that package's own one-resource URL ("one failed batch
costs at most three requests per missing row"), and the fallback then executes a bundle
that already ran. Renaming the id to the package name fixed it. Guarded by
`test/package-identity.test.mjs` (negative control: putting `dsh-process-board` back must
FAIL, and does), and `scripts/set-identity.mjs` now rewrites the id when the package is
renamed.

Verified end to end on the packed tarball, installed with `dsh plugin --profile
forkverify add <tarball>` into a from-scratch profile and driven by
`test/browser-check.mjs`: `browser check passed` — sidebar entry present, composer caret
`caret=true typed=true restored=true` before and after 收起, fixture row with
日志/重启/停止, band opened on `node.exe · pid 21088` with the fixture's own output, and
after the in-panel restart the band followed to `node.exe · pid 6692` with
`bad=false fresh=true`.

## Reverting

```sh
npm pack dsh-process-board@0.2.2
tar -xzf dsh-process-board-0.2.2.tgz -C <somewhere>
cp <somewhere>/package/src/host/index.js "$HOME/.dsh/profiles/desktop/node_modules/dsh-process-board/src/host/index.js"
cp <somewhere>/package/src/client/index.js "$HOME/.dsh/profiles/desktop/node_modules/dsh-process-board/src/client/index.js"
```

Restart the harness afterwards. Those two files are the only changes; the other
seven files in the package are byte-identical to the published tarball.
