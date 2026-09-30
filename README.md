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
node test/probe-scanner.mjs       # the real scanner against this machine
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

Two things it taught, both the hard way:

- **The `desktop` profile cannot be booted this way**; the Electron application owns
  it. Clone its `package.json`, then copy its `node_modules/dsh-process-board` across
  to check the same bytes.
- **`pnpm install` replaces `node_modules/dsh-process-board` with the published
  package**, discarding every patch here. The first `browser-check` run reported the
  *published* plugin's behaviour, which read as "the patch does not render" for
  several rounds. The check now prints which copy it found before judging it.

## Reverting

```sh
npm pack dsh-process-board@0.2.2
tar -xzf dsh-process-board-0.2.2.tgz -C <somewhere>
cp <somewhere>/package/src/host/index.js "$HOME/.dsh/profiles/desktop/node_modules/dsh-process-board/src/host/index.js"
cp <somewhere>/package/src/client/index.js "$HOME/.dsh/profiles/desktop/node_modules/dsh-process-board/src/client/index.js"
```

Restart the harness afterwards. Those two files are the only changes; the other
seven files in the package are byte-identical to the published tarball.
