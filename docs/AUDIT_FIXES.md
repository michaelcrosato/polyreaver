# Audit implementation record

This implements all 14 findings from the October 2026 audit, its CPU/crowd optimization proposals,
and the four proposed game features. Original reproductions and the initial profile remain under
`/workspace/scratch/polyreaver-audit` in the cloud task; regression suites below are repository source
so verification does not depend on that scratch directory.

| Finding | Result | Sources / regression coverage |
| --- | --- | --- |
| B01 stale tabs overwrite saves | Exclusive Web Locks, loaded-revision checks, explicit latest reload and protected fresh sessions. Character transitions serialize and invalidate pending autosaves; writes stay suspended while loading/replacing, and delayed ownership callbacks cannot reactivate released sessions. Failed replacements cannot activate stale autosaves. Without usable locks, play/import/export stays available and shared storage stays protected. | [persistence.js](../src/game/features/progression/persistence.js), [save tests](../scripts/save-regression.mjs), real second-tab browser flow |
| B02 Mind over Matter resolves after death | Life-bound hit damage routes to mana before death detection; shield-only hits neither spend mana nor heal life. Stormweaver Mana Shield uses the same contract. | [combat.js](../src/game/core/combat.js), [keystones](../src/game/features/progression/data/keystones.js), [combat tests](../scripts/combat-regression.mjs) |
| B03 Chaos Inoculation misses poison | Explicit chaos immunity covers hits and poison/chaos DOT, including resistance penetration. Other damage remains effective. | [statuses.js](../src/game/features/combat/statuses.js), combat tests |
| B04 item identities repeat after reload | Identities use randomness independent of loot values; reload and migration repair duplicate IDs across equipment, inventory, stash, flasks and vendor. | [items.js](../src/game/features/progression/items.js), [save.js](../src/game/features/progression/save.js), save tests |
| B05 Eldritch Battery cannot use available shield | A shared affordability/payment function consumes shield then mana immediately. Blood Magic consumes life and refuses lethal costs. Resource hooks use actual spending events. | [skill-core.js](../src/game/features/combat/skill-core.js), [mechanics.js](../src/game/features/progression/mechanics.js), combat tests |
| B06 reducing proxies leaves invalid mappings | Removed bodies release mappings before surviving slots are reassigned; newcomers can use freed slots immediately. | [crowd-link.js](../src/physics/crowd-link.js), [render tests](../scripts/render-regression.mjs), GPU integration suite |
| B07 increasing Rapier agents produces NaN steering | New fleets clear old steering; asynchronous reads carry fleet/storage generations and reject short/nonfinite data before updating bodies. | crowd-link.js, real Rapier regression and GPU integration |
| B08 capacity ignores collision storage | Limits include power-of-two collision grids, every storage allocation, skeletons and compute dispatch dimensions. A 128 MiB binding permits 4,194,304 noncollision agents or 2,097,152 collision agents. | [limits.js](../src/crowd/limits.js), [apply.js](../src/app/apply.js), render tests |
| B09 spatial queries miss large bosses | Broadphase uses actual maximum radius; moving bodies update cell membership, and post-movement teleports refresh before effects. | [spatial.js](../src/game/core/spatial.js), [world.js](../src/game/core/world.js), [collision tests](../scripts/collision-regression.mjs) |
| B10 GPU collision checks too few cells | Search size follows agent and obstacle radii; actual cell checks reject hash aliases. Supported radius 0.6 covers agents two cells apart. | [collide.js](../src/crowd/collide.js), render tests and GPU integration |
| B11 fast projectiles tunnel through targets | Swept circle contacts resolve in travel order, clipped to walls, remaining range and return catches; piercing/chain behavior retains priority. | [effects.js](../src/game/core/effects.js), independent closest-point oracle and collision tests |
| B12 nested malformed saves crash repeatedly | Defensive migrations normalize arrays and fields; strict imports validate numeric bounds, item rolls, and actual passive/ascendancy/skill/support IDs and allocations. Current-version local saves also repair invalid references before planner evaluation; displaced valid runes return to inventory. Excess owned items move to visible slots or trigger recoverable failure. Original bytes remain available. | save.js, [item-validation.js](../src/game/features/progression/item-validation.js), save tests and [content tests](../scripts/save-content-regression.mjs) |
| B13 disconnected controllers retain actions | Physical input sources own actions separately. Disconnect/blur/visibility and controller changes release owned state; held gameplay can resume without duplicate press/menu edges. | [input.js](../src/game/features/combat/client/input.js), [input tests](../scripts/input-regression.mjs) |
| B14 reconfiguration retains GPU resources | Capacity/kernel changes dispose owned storage, indirect geometry, compute kernels and animation textures; late readbacks cannot install replaced state. | [crowd.js](../src/crowd/crowd.js), [cull.js](../src/crowd/cull.js), render tests and live GPU ownership counters |

## Features

**Character saves** is available on the HUD and pause menu. It displays save failures/ownership,
exports portable JSON, validates imports before replacement, previews new/imported/recovered characters,
retains an undo snapshot across subsequent autosaves and exposes original recovery data. Character
replacement clears physical input and enters town. Graphics, controls and planning drafts remain
device preferences rather than character data. Shared saving requires Web Locks; when that API or
storage is denied, session play and manual exports remain available.

**Build Planner** copies the character into a separate draft. Choose future levels, passive paths,
ascendancy, owned/catalog equipment, skills and support runes, then inspect stat/DPS deltas, point
budgets and requirements. Versioned `PRB1:` codes round-trip the whole build. The model is also
headless (`planner.create` / `planner.preview`). Imports and previews cannot change live saves or
stat sources. See [planner.js](../src/game/features/progression/planner.js) and its
[regressions](../scripts/planner-regression.mjs).

**Adaptive quality** is opt-in under pause → Graphics, targeting 30 or 60 fps. It samples real frame
intervals and available GPU timestamps, excludes pause/hidden/startup periods, uses hysteresis and
cooldowns, and adjusts resolution between 50% and the selected ceiling. A manual resolution change
disables adaptation. Settings persist on the device; stress benchmark settings remain independent.
See [adaptive-quality.js](../src/game/render/adaptive-quality.js) and
[regressions](../scripts/adaptive-regression.mjs).

**Controls** records keyboard/mouse and standard gamepad bindings separately. Individual removal,
default reset and conflict transfer are visible; gameplay and progression hints follow current
bindings/device. Touch and bots retain their input contract. Storage denial keeps edits usable for
the current session. See [controls.js](../src/game/features/combat/client/controls.js),
[controls UI](../src/game/features/combat/client/controls-ui.js) and input regressions.

## Optimizations and measurement

- Spatial buckets recycle their arrays; nearest/separation searches avoid result-array allocation,
  and nearest compares squared distances.
- Swarm threshold/kill-sweep tests avoid unnecessary distance calculations, invariant steering
  factors move out of the loop, and flow lookups avoid temporary coordinate arrays. Coincident
  ashling/player positions cannot create NaN velocities.
- Crowd initialization dispatches active/new ranges with stable global agent IDs, preserving
  existing plaza state through shrink/regrow and repacking active agents after city packing changes.
  Buffer allocation/upload still uses allocated capacity; dispatch reduction is not a whole-startup
  speedup claim.

`npm run bench:game -- --base-ref 0fd607c --seconds 45 --runs 7` warms and alternates old/new CPU
paths, checks identical seeded swarm/combat state, and reports median times. Combat fixes are shared
by both sides of the comparison, so this measures optimization rather than changed projectile hits.
Wall time is diagnostic and has no CI threshold. Hardware/browser/GPU performance still needs
measurement on a representative physical device; SwiftShader verifies behavior and resource limits.
`npm run profile:game` records a V8 CPU profile and a source-phase breakdown for swarm movement,
neighbor separation, dormant steering and mechanic fields, with inclusive helper costs reported separately.
Current CPU optimizations preserve the original per-step dormant behavior; the comparison asserts identical
state rather than trading simulation fidelity for lower-frequency updates.

The final cloud CPU comparison used seven paired runs after warmup. Every run produced the same
nearest-query checksum and seeded simulation state hash on both paths.

| CPU workload | Original path, median | Optimized path, median | Time reduction |
| --- | ---: | ---: | ---: |
| 100,000 nearest queries | 131.53 ms | 96.32 ms | 26.8% |
| Swarm updates during 45 simulated seconds | 482.31 ms | 443.08 ms | 8.1% |
| Complete 45-second simulation | 996.51 ms | 959.38 ms | 3.7% |

The final depth-25 profile completed in 82.02 simulated seconds. It attributed 522 self samples to
dormant orbit, 333 to neighbor separation, 56 to wall movement and 41 to mechanic fields. These
sample counts locate remaining CPU work; they are not frame-time or campaign difficulty guarantees.

On Chromium's SwiftShader adapter, five alternating initialization measurements with the same
262,144-slot allocation and seed had median GPU timestamps of 0.128 ms for 2,048 active slots and
5.428 ms for all 262,144 slots. The active prefix matched exactly. These measure the initialization
kernel, excluding allocation/upload and whole-page startup. Three warmed reconfiguration cycles
also returned the same ownership counters: three storage attributes (3,145,728 bytes), nine uniform
buffers (944 bytes), ten programs, nine geometries, three textures (2,765,824 bytes) and six pipelines.
Physical GPU timing and adaptive-quality tuning remain follow-up measurements; adaptation stays
opt-in with manual quality as the default.

## Rerunnable validation

```bash
npm run lint
npm run test:regression
npm run test:city
npm run build
npm run test:features
npm run test:render
npm run test:boot
npm run smoke:city-options -- --quick
npm run smoke:game -- --url http://127.0.0.1:5173/game.html --seconds 10
npm run sim -- --depth 1-4 --seconds 120
npm run sim -- --depth 25 --seconds 240
npm run bench:game -- --base-ref 0fd607c --seconds 45 --runs 7
npm run profile:game -- --depth 25 --seconds 240
```

Browser feature/render suites serve the production build over HTTP automatically. Feature-suite
`--url` requires a server exposing both the chosen build and repository `/src` modules for its
second-tab fixture (a Vite dev server or a server rooted at the repository works). A dist-only
preview server works for the render suite. The game smoke URL needs an existing server
(`npm run dev` in another terminal).
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` can select an installed Chromium. The GPU suite constrains
the actual device to eight storage bindings and 128 MiB binding size, checks initialization dispatches
and buffer readbacks, exercises live physics/capacity/render changes, and compares ownership counters
after repeated warmed reconfiguration. Both browser suites fail on runtime or GPU validation errors.
`--hardware` on the feature/render suites uses the browser's default adapter without forcing
SwiftShader. Record the actual adapter identity before treating a run as physical GPU evidence.

CI runs deterministic regressions and both new browser suites on every push/PR; nightly smoke also
retains feature screenshots. Production builds refresh all four tracked standalone downloads.

## Completed validation

| Check | Result |
| --- | --- |
| ESLint | Passed |
| Deterministic regressions | 120 passed: saves 23, save content 8, combat 21, collision 13, input 24, planner 11, adaptive quality 12, renderer lifecycle 7, swarm 1 |
| City geometry/route validation | 14 passed, including the 50-seed corpus |
| Browser feature suite | All 7 flows passed, including live input, import/undo, reload, second-tab takeover and malformed-data recovery |
| Actual WebGPU integration | All 7 checks passed with eight storage bindings and a 128 MiB storage-binding limit |
| Hosted boot suite | All 22 checks passed, including injected startup failures and device loss |
| Unified city smoke | All 20 quick checks passed against the standalone city download served over HTTP |
| Gameplay smoke | Town, live bot, bloom, tuning, all 33 panels and both Workshop galleries passed |
| Restricted HTTP iframe | Actual `getGamepads()` permission denial handled; renderer frames advanced 6 → 10 and simulation frames 25 → 49 with no errors |
| Headless crash smoke | Depths 1–4 ran up to 120 seconds each; depth 25 ran up to 240 seconds and completed at 82.02 seconds; no deaths or crashes |
| Production build | All four tracked standalone downloads regenerated; source build ID and embedded engine payloads verified |

Browser checks used Chromium 151 and SwiftShader. Managed cloud policy blocks `file://` navigation,
so boot testing used hosted HTTP, and a separate same-origin HTTP fixture covered the legacy
file-only restricted-iframe check. This validates denied gamepad access without changing browser
policy. Offline file navigation and physical-device frame rates remain outside this run's evidence.
Detailed logs, screenshots, comparison results and CPU profiles are retained in
`/workspace/scratch/polyreaver-audit`; repository test scripts and the commands above provide the
durable reproductions.
