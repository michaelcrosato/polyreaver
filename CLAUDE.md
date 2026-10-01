# WebGPU Crowd Stress Test — notes for Claude

three.js r186 (`three/webgpu` + TSL), **WebGPU only, no WebGL fallback**, Rapier 0.19.3 (compat, lazy
loaded), Vite single-file build. README.md has the user-facing docs and the full file layout.

## Commands
- `npm run lint` — ESLint (fast; run after every change).
- `npm run build` — writes `dist/index.html` and the committed `webgpu-crowd-stress.html`. Commit the
  rebuilt HTML with source changes.
- `npm run smoke:quick` (~30 s) / `npm run smoke` (~5-10 min) — headless Chromium + SwiftShader after a
  build. Checks errors only; SwiftShader fps is meaningless.

## Testing policy (from the user)
Don't test on every change. Lint always; run the quick smoke test when a change could plausibly break
rendering/physics, the full one before merging a large change. CI runs the full one nightly.

## Where things are
- `src/main.js` App (entry, `window.app`), `src/app/*` helpers taking `app`.
- `src/crowd/crowd.js` Crowd class; kernels in `sim.js`, GPU-driven cull in `cull.js`, vertex shaders
  and meshes in `materials.js`, animation systems in `anim.js`/`clips.js`, collisions in `collide.js`.
- `src/physics.js` PhysicsDemo; `src/physics/*` modules taking `demo`.
- `src/world.js` World; `src/world/*` modules taking `world`.
- `src/features.js` every setting (+ teaching text) → UI; `src/post.js` post chain; `src/bench.js`.
- `src/bridge.js` Claude link (see below).

## Conventions and hard constraints
- three.js "mdcs" style: tabs, `foo( a, b )`, blank line after an opening function/class brace and
  before the closing one. Comments are teaching notes — keep them accurate.
- Max **8 storage buffers per shader stage** (phone limit). Adding a buffer to a kernel means checking
  the count; the cull is split in two passes for this reason.
- Never `dispose()` crowd geometries (it destroys shared storage buffers); `_freeStorage()` handles it.
- Split modules export functions that take the owning object; classes keep one-line delegates.
- No model names in commits. "Commit, push and merge" = push the work branch, then fast-forward `main`.

## Claude link (benchmarks on the user's real GPU)
Artifact: https://claude.ai/artifact/LePB3jW73zXCViKwbA3RUx (published from `webgpu-crowd-stress.html`
with capabilities `db`, `user`, `assets`). When the user has it open, queue work with the `ArtifactData`
tool: `set` `commands/<id>` = `{ "cmd": "...", "args": {...}, "status": "pending" }`, then read
`results/<id>` (and `commands/<id>.status`). Commands: `ping`, `report`, `settings`, `preset {id}`,
`set {values}`, `reset {keepCount}`, `measure {seconds}`, `maxCrowd {targetFps}`, `effects`,
`screenshot` (asset id → `Artifact` read with `path`), `standard` (fixed-condition benchmark, 1-3 min),
`sequence {steps, continueOnError}`. Optional `target: "mobile"|"desktop"` waits for that kind of device.
`devices/*` lists devices that opened it; `runs/*` holds benchmarks the user ran from the panel.
The tab must be in the foreground; results can take a while (`effects` ≈ 1-2 min).
Measuring: a lightly loaded desktop GPU drops its clocks and its timestamps become noise (±4 ms). Compare
settings at a heavy load (GPU ≥ ~5 ms, e.g. 1M Tetra or 131k Hi agents, direct path) or use `effects`,
which adds the ballast itself. `maxCrowd` judges GPU/CPU time when timestamps exist.
