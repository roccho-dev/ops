# cdp-tty

A small C core plus one TTY adapter and a thin CLI. The caller supplies one
already-running page WebSocket on numeric loopback. Chrome owns its process,
tabs, viewport and persistent profile/auth state; this viewer owns only its
connection, current image, coordinate mapping and terminal modes.

Source proposal: roccho-dev/adrs#423. Implementation/proof: roccho-dev/ops#426.
This is a bounded implementation slice, **not complete #423 acceptance**.

## Use and ownership

`cdp-tty [--observe] ws://127.0.0.1:PORT/devtools/page/EXPLICIT_TARGET_ID`

Run in a real Linux TTY, ordinarily through SSH from a compatible terminal.
The terminal must report its cell pixel size and acknowledge Kitty image
transmission. No assumed cell size, remote pathname, shared memory or mux.
Ctrl-Q exits. A lost connection exits; restart explicitly to attach afresh.
There is no automatic reconnection, target switching or input replay.

The core is directly callable through `cdp.h` and `libcdp-tty.a`; `tests/probe.c`
is a second real caller. This is not a separately versioned stable ABI.
The core installs no signal handler, takes no TTY, exits no process and saves
nothing to HOME. The CLI owns cancellation; `tty.c` owns terminal restoration.

Runtime dependencies: libcurl (WebSocket-enabled) and json-c. No Node, Python,
Qt, Chrome launcher, shell wrapper, SSH implementation or automation package.
Python and Chromium are **test inputs**, not viewer runtime dependencies.
Only test code owns its disposable Chrome, fixture setup and recording proxy.
No code is copied from Anoa/casty/cmux. Their licenses are not silently inherited.
The project-wide licensing decision is not changed by this package.

## Finite browser surface

Seven methods, with no arbitrary caller-supplied method/JSON passthrough:

| Method | Purpose |
|---|---|
| `Page.getLayoutMetrics` | CSS viewport geometry, scroll position and zoom limits |
| `Page.getFrameTree` | Main-frame loader identity across navigation |
| `Page.captureScreenshot` | Full existing-view PNG; no clip or temporary emulation |
| `Input.dispatchMouseEvent` | Click pair or wheel |
| `Input.dispatchKeyEvent` | Finite supported key-down/up pairs |
| `Input.insertText` | Committed UTF-8 text |
| `Runtime.evaluate` | One fixed side-effect-checked read of innerWidth/innerHeight/DPR |

A clipped surface capture was observed resetting another CDP client's DPR=2
back to 1. Capture now uses `fromSurface:false` without a clip. The fixed
geometry expression supplies scrollbar-inclusive dimensions absent from
`getLayoutMetrics`; the caller cannot supply JavaScript. `throwOnSideEffect`
rejects page-defined getters that would write state, and the audit checks the
exact expression and flags. No `Runtime.enable` or DOM mutation is added.
Tests cover startup DPR 1/2 and independent-controller DPR 2/1.25.

Before input, compare a new frame/geometry/loader with the acknowledged shown
frame. A change discards the input. This reduces stale-frame mistakes; it is
**not an atomic lock against other clients**. Animation/caret changes can reject
otherwise useful input. Agent/human handoff remains outside this package.

Terminal resize only fits/centres the image locally. Each transmission receives
a new image ID; an old acknowledgement cannot arm a resized image. Only the
current frame is retained. Message, paste, input and output waits are bounded.
Normal exit, SIGTERM and SIGHUP restore the saved TTY settings. SIGKILL cannot
run cleanup and is not promised to restore terminal modes.

## Supported slice and remaining work

Implemented: observe-only, left/middle/right click, wheel, committed UTF-8 text,
bracketed paste, Enter/Tab/Backspace/Delete/Escape/arrows/Home/End/Ctrl-A.
Mouse locations use terminal **cell centres**, not pixel-precise pointer reports.
Drag is rejected instead of degraded into a click. IME composition, general
modifiers, pinch zoom, fractional-DPR/browser-zoom combinations, browser-level
endpoint discovery and transparent reconnect are not claimed.

No browser launch/kill, target create/close, profile/cookie API, navigation,
viewport emulation, DOM injection, console, worker attachment, DB or service.
OS privilege isolation is not supplied by an API allowlist.

## Proof

`make check` builds the CLI and actual static library, then requires real Chrome.
The harness lives at `verification/cdp-tty/proof.py`, outside runtime sources.
`nix-build packages/cdp-tty/proof.nix --no-out-link` uses the repository's existing
nixpkgs lock and this same package recipe, without unrelated private inputs.
The package emits `out` (CLI), `dev` (C library/header), and `proof` (receipts).
The existing nix-check workflow runs the bounded proof as an independent job.

The test controller prepares an offline fixture and a synthetic `.invalid`
cookie. An independent connection records viewer wire methods. A real PTY plus
**simulated Kitty protocol sink** verifies chunks, PNG CRC/decompression,
acknowledgements, mouse/key/text, resize and terminal cleanup. Fault injection
covers fragmented WS/control/UTF-8, malformed JSON, wrong response ID, oversized
messages/paste/numbers, bad PNG envelope, timeout and unknown input completion.
The same mandatory CI entry also logs into a disposable loopback HTTP fixture
and verifies authenticated requests, cookies, targets and viewport survive
normal exit, SIGTERM, SIGHUP and SIGKILL. That is fixture-service evidence,
not a proof of a user's third-party login or an actual SSH disconnect.
Positive input effects are observed with bounded waits across the independent
CDP connections; accepting an input request is not the effect observation.

Receipts keep observations in `raws.jsonl`, a filtered destructive-case view in
`disruptives.jsonl`, source hashes and dependency versions. They contain no page
images, target URLs, user credentials or typed secrets. Missing Chrome or a
failed assertion fails the proof; untested final gates remain `NOT_RUN`.

**Still required before #423 completion:** a real graphical terminal renderer,
Windows -> SSH -> selected OCI deployment, real service login survival,
full drag/required modifiers and sustained CPU/bandwidth measurements. A
synthetic cookie, local HTTP session and PTY sink do not prove third-party
login survival or the human-visible Windows path. Keep the PR Draft until its full acceptance scope
is resolved; do not close #423 or remove existing recovery paths from this proof.

Protocol references: Chrome DevTools Protocol Page/Input, Kitty graphics
protocol, libcurl WebSocket API. Package placement remains ops; envs may later
bind an exact output without copying source or the build recipe.
