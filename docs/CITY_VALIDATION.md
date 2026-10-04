# Procedural city implementation and validation

The first city prototype is implemented and available at
[the local city demo](http://localhost:5180/city-demo.html). The development entry
is `city.html`; `npm run build:city` produces the self-contained `city-demo.html`,
including the generation worker. The original crowd demo and Polyreaver game
remain separate entries.

## Delivered city

The default `harbor-100k` seed produces a 2,048 × 2,048 m city with 16 named
neighborhoods, 3,351 buildings, 28 service alleys, parks, a central square,
civic services, parking/loading yards, a canal and three bridges. A separate
fleet contains 64 cars and eight buses; working signal phases and pedestrian
crossing presence control its junction entry.

All 100,000 citizens have persistent integer identities and home/work/leisure
assignments. Slot zero is the player, making the active total 100,001 at capacity
131,072. The default pedestrian graph has 1,233 nodes, 4,712 directed edges, and
22 connected routing clusters. Its shared routing tables occupy 486,676 bytes.
The generation tests establish 180,955 residential slots and 368,589 activity
slots for this seed, using the documented game occupancy assumptions.

The GPU follows graph routes at fixed 30 Hz, applies bounded separation from a
position snapshot, manages exclusive destination slots, and writes animation
state from actual movement. Rendering interpolates positions and uses the
existing animated people nearby, with two-triangle markers in the distance.
Ordinary buildings use ten triangles with shader-painted facade details.

Walking/running, five camera modes, overview labels, minimap, seed regeneration,
population presets, pause, quality selection, building inspection, route
highlighting, reports, and benchmarking are implemented. Player movement uses
swept static collision and camera retraction. Worker failure has a cooperative
generation fallback, and canceled generation cannot replace a newer city.

## Verification evidence

| Check | Result and scope |
| --- | --- |
| Repository lint | Passed with no warnings or errors |
| Generation and CPU validation | Nine tests passed; 50 seeded cities, parameter rejection, independent route comparison, capacities, geometry clearance, packing, cancellation/fallback, and swept player collision |
| Offline standalone city | Passed from `file://` with HTTP requests blocked |
| GPU binding ceiling | Every compute pipeline was audited against eight storage bindings; observed maximum was eight. The installed browser granted a device limit of ten despite requesting eight. |
| Persistent movement | Sampled citizens advanced independently of the camera and retained identity assignments |
| Targeted GPU behavior | Analytical travel matched the CPU reference within tolerance; red/green crossing entry, clearance, bridge traversal, arrival, dwell and reservation release passed |
| Dense queue | An intentionally over-capacity public-space fixture reported bucket overflow and overlaps, maintained finite legal positions, and continued to advance |
| Full population | GPU reduction counted exactly 100,000 citizens plus the player and found zero invalid IDs, corridor violations, water/building intrusions, or excessive displacement |
| Extended HTTP run | 906 GPU ticks and 30.2 simulated seconds; the full-population reduction still passed all checks |
| Lifecycle | Camera/selection, three regenerations, population changes, latest-job-wins cancellation, failed-request retention, resource counts, and worker-disabled browser fallback passed |
| Original crowd regression | All nine quick smoke scenarios passed, including physics, animation, post effects, fixed benchmark view and the fake Claude link |
| Original game regression | Both short Node simulations passed; browser checks covered town, a level, post-processing, all 29 panels, galleries and a restricted iframe |
| All three builds | Crowd, Polyreaver and city single-file builds passed |
| Benchmark procedure | Four fixed-1080p scenarios executed, including 512-citizen bridge pressure; raw JSON, per-scenario timing and state restoration were verified in software mode |

At full-city overview, the verified build submitted all 100,001 agents: 100,000
far markers and one animated player. It reported 393,338 total triangles and
45,688,192 bytes (43.6 MiB) of allocated application geometry/storage/atlas data.
Allocation budgets and renderer-reported memory are recorded separately; canvas
render targets, uniforms, shader programs, driver overhead and temporary readback
allocations are not represented by that application-data subtotal.

Raw evidence generated locally:

- [City smoke results](../artifacts/city/smoke-results.json)
- [Extended simulation results](../artifacts/city/soak-results.json)
- [Software benchmark report](../artifacts/city/benchmark-software.json)
- [Hardware availability check](../artifacts/city/hardware-availability.json)
- [Full city screenshot](../artifacts/city/100k-city.png)

These generated artifacts are ignored by Git and can be recreated with the
commands below. They are evidence from the local run, not hosted reports.

## Hardware performance remains unverified

The available Linux browser exposed SwiftShader, including when the benchmark
runner tried its hardware configuration. Software rendering proves the behavior
and allocation checks above; its frame times cannot establish the desktop
1080p/60 fps target. The saved software report explicitly sets
`performanceClaim: false` and `targetMet: false`.

To measure the target on the user's GPU, open the local page in Windows
Chrome/Edge, select 100,000 citizens, keep the tab visible, and click **Benchmark**.
The test pins physical rendering to 1,920 × 1,080, uses minimal citizen quality,
warms up each scenario for ten seconds, and measures for sixty seconds. Copy the
JSON report after all four scenarios. Inspect the adapter, median/p95/p99 times,
simulation ticks, dropped time, visibility/triangle counts, overflow and errors.
The traversal scenario is explicitly marked as synthetic bridge pressure.
Citizen, player and traffic state are restored afterward.

## Reproduce the checks

```bash
npm ci
npm run lint
npm run test:city
npm run build
npm run build:game
npm run build:city
npm run smoke:quick
npm run smoke:city
npm run smoke:game -- --seconds 5 --shots artifacts/city/game-regression
npm run sim -- --depth 1-4 --seconds 45
npm run sim -- --depth 25 --seconds 30
npm run bench:city -- --software --warmup 0 --seconds 1
```

Use `npm run bench:city` with a real GPU for the full timing gate. The short
software command checks reporting and state behavior, not the sixty-second
hardware acceptance target. The larger extended run can be reproduced in
explicit validation mode with three awaited `window.city.stepTicks(300)` calls,
followed by `window.city.validate({full:true})`.

## Prototype limits

Crowd separation is soft and bounded. Extreme densities can overflow the
eight-entry spatial buckets and permit body overlap; the test intentionally
exercises and reports that behavior. Corridor, building and water constraints
remain enforced. Civic economies, building interiors, transit passengers,
construction mechanics and combat are future game work, as scoped in the plan.
