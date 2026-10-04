# Standard boot protocol, version 1

Every browser entry starts the same dependency-free loader in `src/boot/`.
The default brand is Polyreaver. Branding, version, build ID, engine labels and
loader callbacks are supplied to `BootLoader`; lifecycle, codes, diagnostics,
timeouts and the final loop hand-off are shared.

The main **Stress test** choice loads `src/city/main.js` (100,000 citizens), while
**Hack and slash** loads `src/game/main.js`. The original `src/main.js` plaza test
has an explicit **Classic crowd test** link in the city panel and a separate
`classic-crowd.html` download (`classic.html` during development). Both main
chooser downloads embed the game and city payloads. Classic uses its own payload;
the city is never replaced by the old demo when opening a standalone chooser.

## Ordered stages

| Code | Work | Failure code |
| --- | --- | --- |
| BOOT | Static HTML and classic watchdog; load startup module | BOOT-JS / BOOT-TIME / JS-OFF |
| PLAT | Secure-context, WebAssembly, worker, storage and API checks | PLAT-FAIL |
| GPU | Core adapter, compatibility retry, device initialization | GPU-FAIL / GPU-TIME |
| CHECK | WebGPU canvas and eight-storage-buffer minimum | CHECK-FAIL |
| READY | 100% boot checks; wait for explicit engine choice | No timeout while choosing |
| LOAD | Request/decode only the chosen engine | LOAD-FAIL / LOAD-TIME |
| SYS | Initialize game systems; nested renderer/world stages | SYS-FAIL / SYS-TIME |
| REN | Initialize the selected engine's renderer | REN-FAIL / REN-TIME |
| WORLD | Generate city/citizens, where applicable | WORLD-FAIL / WORLD-TIME |
| FRAME | Render once and wait for submitted GPU work | FRAME-FAIL / FRAME-TIME |
| RUN | Start the animation loop and reveal game UI | JS-ERR / JS-ASYNC / GPU-ERR / GPU-LOST |

Percentages describe two phases: platform boot reaches 100% at READY, then the
selected engine has its own loading progress. There are no artificial delays.
A zero-delay yield lets the browser paint before synchronous initialization.
Async platform/import/renderer work has a 30-second deadline; systems, city
world generation and first-frame shader compilation allow 120 seconds. The
classic watchdog allows 20 seconds for the startup module itself. Browser
scheduling can delay timers while a tab is suspended or its main thread is busy.

## Integration

An engine exports `async initialize({ gpu, boot })`, mounts its own UI using
`mountLayout()`, initializes required systems and returns `{ frame, start, stop }`.
`initialize` must not start a loop. `frame` renders one verification frame; `start`
begins the loop only after successful initialization; `stop` halts it on failure.
Register `boot.stop` as soon as the renderer exists. Use `boot.step(code, label,
progress, work, timeout)` for awaited initialization, and `boot.assertActive()`
after asynchronous work outside those steps. Late completion after timeout must
never start a loop. Optional systems such as saving may report degraded operation.

The game, city, and classic crowd test need WebGPU compute/storage. Core and
compatibility adapters are tried in that order, including browser-supplied software
adapters. WebGL2 is detected and reported when WebGPU initialization fails; it is
not a working backend for these engines. Adding an engine with a different backend
requires its real renderer initialization and requirement checks, not relabeling
WebGPU errors as a successful fallback.

## Diagnostics and failure handling

`window.__boot` exposes the JSON report: protocol, brand, game version, content build
ID, platform/user-agent, renderer, adapter when disclosed, feature/limit checks,
current stage, ordered stage results, mode, and errors with codes, original stages,
messages, stacks and elapsed milliseconds. No report is uploaded automatically.

The first fatal error remains visible and is not replaced by cascading errors
from device destruction. The loop stops, the engine root is hidden, and the boot
screen reappears with copy/retry controls. The failed report is also saved under
`polyreaver.boot.lastFailure` if storage allows. Clipboard denial/pending permission
still leaves a selectable report. Reload is a clean retry, so partially initialized
systems are never reused. The static shell and ES5 watchdog cover JavaScript/module
load failures; a noscript message covers disabled JavaScript.

## Builds and compatibility

`npm run build` generates all hosted entries in `dist/`, hashed engine payloads in
`dist/engines/`, and the four committed standalone HTML downloads. `build:game`
and `build:city` are aliases. The hosted shell has a hard 35 KB build limit (currently
about 17 KB) and includes no Three.js, Rapier, gameplay, or game UI dependencies.
The chooser appears before any engine request. Standalone downloads carry base64
payloads as inert script data; only the selected payload becomes a JavaScript Blob
module after checks. Standalone files can be opened directly on a WebGPU-capable
browser with Blob modules allowed. An embedding CSP that blocks modules/Blob URLs
will produce an import failure screen instead of a blank game.

The build ID is a deterministic SHA-256 prefix over source, scripts, package/lock
files, Vite config and entry HTML. It can be matched across deployed and local
artifacts without a self-referential commit hash or a nondeterministic timestamp.

## Verification

`npm run test:boot` serves the actual production build and verifies no engine or
full UI before READY; both real engine launches, including 100,001 active city agents,
city controls, standalone/offline city selection and classic navigation; first-frame and loop hand-off;
phone layout and keyboard selection; missing GPU/adapter/WebAssembly, device
rejection, compatibility retry, storage denial, device loss, import/system/frame
errors, late initialization after timeout, and JavaScript-disabled diagnostics.
Screenshots go to `artifacts/boot/`. `--url https://…/` checks the deployed site.

`npm run smoke` exercises the classic crowd engine; `npm run smoke:game` checks town,
combat, graphics, all panels, workshop and restricted iframe behavior;
`npm run smoke:city` checks standalone generation/rendering and 100K citizens.
Software WebGPU establishes correctness, not hardware frame-rate claims.
