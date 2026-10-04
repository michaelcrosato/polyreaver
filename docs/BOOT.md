# Standard boot protocol, version 1

Every browser entry starts the same dependency-free loader in `src/boot/`.
The default brand is Polyreaver. Branding, version, build ID, engine labels and
loader callbacks are supplied to `BootLoader`; lifecycle, codes, diagnostics,
timeouts and the final loop hand-off are shared.

**Crowd stress test** loads `src/main.js`; **Hack and slash** loads
`src/game/main.js`. The stress test's Scene control selects procedural city or plaza
inside one App. Legacy city/classic entry pages select a starting scene; standalone
downloads embed only two engines. The Experience selector reloads the same document
with `?engine=game|stress`, retaining the stress test's settings in session storage.
`?engine=choose` returns to the chooser. Old `?engine=classic` links select the plaza
in the unified stress engine. Hosted pages request only the chosen engine bundle
when boot checks pass.

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
| WORLD | Prepare city/plaza scene, where applicable | WORLD-FAIL / WORLD-TIME |
| WARM | Stress engine: asynchronously compile active compute and all scene chunks, upload buffers, prime shadow/post passes | WARM-FAIL / WARM-TIME |
| FRAME | Render once and wait for submitted GPU work | FRAME-FAIL / FRAME-TIME |
| RUN | Start the animation loop and reveal game UI | JS-ERR / JS-ASYNC / GPU-ERR / GPU-LOST |

Percentages describe two phases: platform boot reaches 100% at READY, then the
selected engine has its own loading progress. There are no artificial delays.
A zero-delay yield lets the browser paint before synchronous initialization.
Async platform/import/renderer work has a 30-second deadline; systems, city
world generation, rendering preparation and first-frame validation allow 120 seconds. The
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

The game and unified crowd stress test need WebGPU compute/storage. Core and
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
about 19 KB) and includes no Three.js, Rapier, gameplay, or game UI dependencies.
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
full UI before READY; both real engine launches, including the generated city in the original App,
scene controls, standalone/offline city/plaza switching and legacy classic routes; first-frame and loop hand-off;
phone layout and keyboard selection; missing GPU/adapter/WebAssembly, device
rejection, compatibility retry, storage denial, device loss, import/system/frame
errors, late initialization after timeout, and JavaScript-disabled diagnostics.
Screenshots go to `artifacts/boot/`. `--url https://…/` checks the deployed site.

`npm run smoke` exercises the plaza scene; `npm run smoke:game` checks town,
combat, graphics, all panels, workshop and restricted iframe behavior;
`npm run smoke:city` checks the unified city/plaza controls, regeneration, 150K agents,
physics, surface constraints, benchmark cancellation, sharing and the eight-buffer ceiling.
Software WebGPU establishes correctness, not hardware frame-rate claims.

`npm test -- --suite zoom` verifies that the first zoom-out and rotation do not
create pipelines, shaders or vertex/index buffers, across direct rendering,
shadows, GPU LOD, MRT post-processing, preset changes and regeneration. The full
active scene is prepared with frustum culling temporarily disabled; original flags
are restored before RUN. Hidden props and disabled effects are prepared when enabled.
Settings and scene changes await preparation with the frame loop suspended, so the
renderer is never used concurrently while compilation owns its target/MRT state.
