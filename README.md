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
