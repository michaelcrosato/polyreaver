# Procedural city and 100000 citizen implementation plan

Build a walkable, procedurally generated city using the original WebGPU crowd demo as the engine foundation. The first playable release should contain a complete, recognizable city and **100,000 persistent citizens plus the player**, with simple buildings, purposeful pedestrian movement, and measurable performance.

This is an implementation specification, not a claim that the city exists or that its performance has been measured. It is grounded in commit `d667c05`. The companion [implementation prompt](CITY_IMPLEMENTATION_PROMPT.md) is the handoff for GPT-6.1 Sol at extra effort.

## 1. Product decision and scope

Use the existing controllable character to explore the city. Start in an active civic square, with walking, running, camera rotation, zoom, a map, and clickable building information. A central skyline, a river with bridges, and different neighborhood silhouettes should make the city understandable from both street level and above.

The default is a deliberately busy outdoor city: every citizen has a persistent position, a home address, a work or study address, and a leisure destination. Citizens travel, wait at crossings, and dwell in reserved public areas near destinations. Building interiors are not simulated in this release, so arrival never removes a citizen to make the population target easier.

The play experience is an exploration sandbox and a foundation for a game. Money, construction tools, combat, criminal behavior, needs, production chains, and detailed transit passenger simulation come later. City records must expose the addresses, capacities, service types, and connectivity those systems would need.

### Required city contents

| System | First playable release |
| --- | --- |
| Urban structure | Downtown, mixed commercial streets, apartments, low-rise residential neighborhoods, an industrial and utility district, and a civic center |
| Streets | Connected arterials, narrower local streets, occasional service alleys, junctions, road markings, sidewalks, curb colors, crossings, and signals |
| Buildings | Rectangular footprints and box masses; seeded heights, setbacks, roof colors, doors, window patterns, and functional addresses |
| Civic services | Hospital, schools, fire and police stations, a town hall, market, and a transit terminal; identifiable sites and metadata |
| Public space | A central square, neighborhood parks, playground or sports markings, paths, trees, benches, lamps, bins, and transit stops |
| Water and infrastructure | A river or canal, banks, at least two usable bridges, waterfront paths, a utility yard, industrial yards, and parking/loading areas |
| Traffic | A small separate fleet, initially 64 cars and 8 buses, following connected lanes and the same signal phases as pedestrians; parked vehicles at selected lots |
| Citizens | Exactly 100,000 NPC IDs, distributed throughout the pedestrian network, with persistent destinations, walking variations, and bounded local separation |
| Player and interface | Walk/run, five existing camera modes, city overview, seed/regenerate, population selection, district labels, pause, building selection, and performance report |

Service buildings initially provide destinations and semantic data. Their labels must not imply functioning hospital, education, crime, or utility economies. The small traffic fleet demonstrates city movement; citizens do not board vehicles yet.

## 2. What the repository already provides

| Existing code | Reuse and necessary change |
| --- | --- |
| `src/gpu.js` | WebGPU device creation, adapter reporting, limits, timestamp capability, and browser compatibility shim |
| `src/crowd/crowd.js` | GPU buffers, simulation dispatch, rendering, and diagnostics. Add explicit optional city simulation/render profiles before constructor allocation occurs. Preserve the default profile. |
| `src/crowd/sim.js` | Current movement uses a sunflower distribution and random straight-line targets. City mode needs a different initialization and navigation kernel, while preserving the render/animation packing contract. |
| `src/crowd/cull.js` | Frustum culling, indirect draws, and LOD. It currently allocates four full-capacity position and animation lists and splits culling to fit storage binding limits. |
| `src/crowd/materials.js`, `models.js`, `anim.js` | Existing 24, 52, 168, and 436 triangle people, GPU animation, and materials. Reuse animated geometry for nearby citizens. |
| `src/crowd/collide.js` | Useful snapshot and bounded spatial-hash pattern. Its small circular obstacles, eight-entry buckets, and eight global large obstacles cannot represent a city's building footprints. |
| `src/camera.js`, `src/input.js` | Existing mouse, keyboard, touch, and camera behavior. Extend camera bounds/overview for the city. |
| `src/app/hero.js`, `src/app/apply.js` | Current player boundary and world size depend on a circular plaza and crowd density. City size and collision must be independent of population. |
| `src/world.js` | Lighting/material helpers are reusable. The circular ground and random tree/lamp placement are replaced in the city entry point. |
| `src/game/core/rng.js` | Pure seeded random generator with named forks, suitable for generation without loading the action game's simulation |
| `scripts/smoke.mjs`, `src/bench-standard.js` | Software-WebGPU correctness tests and fixed-resolution benchmarking patterns. Keep the original benchmark's meaning and results intact. |

Create a dedicated `/city.html` development entry and `city-demo.html` single-file build. The original `/` stress test and `/game.html` remain available. A short link between demos makes discovery easy. A dedicated city bootstrap avoids forcing city semantics into plaza-only presets, physics actions, and benchmark settings.

Do not create 100,000 action-game entities or a second copy of the whole crowd renderer. Use the existing GPU crowd with small explicit extension points. Do not monkey-patch private methods after construction: `Crowd` already builds kernels during `setCapacity()` in its constructor.

## 3. Procedural generation

### Algorithm choice

Use **seeded hierarchical rectangular subdivision with road constraints**. Generate the street network first, subdivide the resulting buildable blocks into lots, and derive buildings, paths, and navigation from the same records. This gives controllable density, cheap box geometry, and testable connectivity.

The road-to-lot-to-building hierarchy and separation of global goals from local constraints have precedent in [Parish and Müller, Procedural Modeling of Cities](https://cgl.ethz.ch/Downloads/Publications/Papers/2001/p_Par01.pdf). Our constrained orthogonal subdivision is a project-specific design, not an implementation of their full L-system.

Avoid a general-purpose road-growth research project in this first release. The generator should produce varied, coherent cities through uneven block spacing, T-junctions, district-specific subdivision rules, landmarks, and density gradients. Random placement of boxes is insufficient.

### Defaults and boundaries

- Map extent: 2,048 × 2,048 meters, centered at the origin. This is a proposed starting size.
- Logical neighborhoods: approximately 16. Navigation clusters are separate and may subdivide neighborhoods.
- Typical blocks: 72–144 meters; larger industrial parcels and smaller commercial blocks.
- Initial building target: 3,000–6,000, constrained by usable land and frontage rather than forced through overlaps.
- Flat walking surface at `y = 0`, including bridge decks. Recess water below it; elevated roads, terrain slopes, and multilevel navigation are later extensions.
- Use integer layout units, stable IDs, explicit generator version, and named RNG forks. A prop setting must not reshuffle streets or addresses.

### Ordered generation pipeline

1. **Geography and anchors.** Reserve the river, banks, town square, center of employment, industrial edge, large park, and transit terminal. Use a rectilinear water ribbon with a bounded width and bridge locations reserved before road subdivision. Keep land on both sides of the river.
2. **Arterials.** Connect the anchors and city edges with an orthogonal road skeleton. Place at least two bridge links with continuous pedestrian and vehicle paths. Road intersections become explicit nodes, never merely overlapping meshes.
3. **Neighborhood blocks.** Recursively split sufficiently large buildable rectangles along their longer axis, with district-specific split ranges. Reserve the entire street right-of-way on each split. Snap adjoining segments, create T-junctions explicitly, and refuse narrow slivers. Water-adjacent fragments that cannot form valid lots become bank or park space.
4. **Zoning.** Score blocks by center distance, arterial access, river proximity, and distance from the industrial anchor. Apply quotas and adjacency rules: concentrate height downtown, put shops on accessible streets, provide quieter residential interiors, and buffer industry with green or service space. Reserve civic sites before ordinary lots consume them.
5. **Lots and footprints.** Split frontages into rectangular lots with minimum widths and depths. Add a reachable rear lane or stop subdivision if a split would landlock a lot. Apply setbacks, generate a rectangular building inside each lot, and attach the address to a specific sidewalk segment. Never invent an inaccessible decorative doorway.
6. **Public space and services.** Add at least one pocket park and transit stop per neighborhood, a central square, a large park, waterfront paths, and all listed service types. Give each a reachable entrance and an outdoor dwell area outside the through-walking corridor.
7. **Capacity allocation.** Derive residential and job capacity from footprint area, floors, and explicit tunable occupancy assumptions. Reserve at least 100,000 home slots and 100,000 work/study/activity slots. Adjust floors or eligible lot use within limits; fail clearly if a configuration cannot satisfy capacity. These are game allocation assumptions, not urban population forecasts.
8. **Navigation and traffic.** Generate sidewalk, crossing, park-path, waterfront, entrance, and lane records directly from the accepted layout. Verify both bridge approaches. Signal groups share one clock between pedestrians and vehicles.
9. **Decoration.** Place trees, lamps, benches, bins, signs, parked cars, and loading objects using clearance rules. Keep crossings, doors, bus stops, and minimum sidewalk width free. Project door/window/road patterns in shaders or the surface atlas.
10. **Validation and publication.** Validate geometry, connectivity, capacities, and resource limits; build routing tables and rendering chunks. Publish a complete generated city atomically. A canceled or failed generation must leave the previous city usable.

Use a worker for layout, route precomputation, and population initialization. Transfer typed arrays instead of structured-cloning large object graphs. Progress and cancellation are required. For the standalone build, inline the worker and verify its actual `file://` behavior; provide a cooperative main-thread generation fallback if worker creation fails.

### Generation invariants

Every building lies inside its lot; building footprints do not overlap roads, water, other buildings, or required walk corridors. Every functional address connects to the main pedestrian component. Both sides of the river remain connected by at least two legal crossings. Pedestrian and lane graphs are distinct. Required service counts, housing slots, and route limits are validated before spawning citizens.

Reserve sufficient legal pedestrian area for the outdoor population: report `population / walkableArea`, and target at most 0.35 citizens per square meter on average at 100K. Independently check local spawn densities and choke points; the average does not prove a bridge can handle a crowd. Broaden walks, add public space, or reject an invalid preset rather than silently lowering the population.

## 4. Navigation for 100000 separate citizens

### Shared graph routing

Use a graph of walkable corridors. Each directed edge records start/end coordinates, endpoints, width, reverse edge, surface kind, signal group, and length. Crossings are explicit edges. Building addresses attach to an edge and a distance along it, plus a checked entrance/forecourt connector. Multiple addresses can share one edge without creating thousands of graph junctions.

Partition the graph into connected routing clusters of at most 256 nodes, with at most 32 clusters and 8,192 nodes in the default supported map. Split disconnected pieces before assigning cluster IDs. These are bounded resource limits, not target node counts. Validate generation against them and expose any rejected configuration clearly.

Precompute two compact tables in the worker:

- `towardCluster[node, destinationCluster]`: first directed edge on a shortest path to that cluster, computed by reverse multi-source Dijkstra for each cluster.
- `withinCluster[cluster, localNode, localDestinationNode]`: first edge on a shortest path restricted to that connected cluster.

Distances and positive edge costs are retained by generation tests to prove progress. Only next-edge IDs need to be uploaded for the runtime. At maximum dimensions, uint32 next-edge tables need at most 1 MiB globally plus 8 MiB locally. This cost depends on city graph size, not citizen count.

When a citizen reaches a node, select the next edge with one table lookup. Outside the destination cluster, follow its shared route. Inside it, follow the local route to the destination's anchor node, then traverse the target edge to the exact address attachment and its reserved dwell connector. Define reverse-edge/address-distance conversion explicitly; route departure and arrival must use the same convention. Local shortest routes remain inside their cluster, which prevents oscillation between routing levels.

This can choose a longer route than a whole-city shortest path because it enters the destination cluster before resolving the exact address. That tradeoff is acceptable for this release. Test against Dijkstra for local optimality and global reachability; do not advertise globally optimal routes.

The general idea of sharing navigation work across many people is supported by [Continuum Crowds](https://grail.cs.washington.edu/projects/crowd-flows/). The proposed graph tables are our simpler design; they do not implement that paper's dynamic continuum solver.

### Persistent citizen state

Reserve crowd slot 0 for the hero and slots 1–100,000 for citizens. Allocate capacity 131,072 for this preset rather than inheriting the demo's automatic one-million-slot desktop allocation. Padding slots must neither move nor appear in active counters.

Each citizen receives persistent home, work/study, and leisure address IDs, varied speed, color, route progress, and a staggered schedule phase. Use capacity-weighted assignment without exceeding address capacity. Sample initial positions by legal corridor area with spatial jitter and checked spacing. Spread citizens through the whole city at startup, with a consistent current edge and progress; do not put the entire population at home doors at once.

Routines alternate destinations and bounded dwell intervals, with seeded offsets. Their future destination remains meaningful even when they are far from the camera. They wait before entering red-light crossings, complete crossings they already entered, and turn through connected sidewalk corners. Use an all-red clearance interval sized for crossing width and minimum pedestrian speed before conflicting vehicle movement resumes.

Home/work arrival means reaching the building's public forecourt or door apron. It does not mean moving through a facade. Dwell-area occupancy limits and alternate slots prevent an unlimited pile at one address. Citizens remain present while dwelling. Do not respawn, teleport, or reseed agents when the camera moves.

### Simulation and local avoidance

Run all active citizens on a fixed 30 Hz GPU simulation clock; render independently with root-position interpolation. Bound catch-up work, report dropped simulation time, and suspend cleanly while hidden. Do not replace missed ticks with one large movement step. Start with all citizens updated each simulation tick; distant behavioral throttling is a later optimization only if profiling justifies it.

Use separate kernels for the following stages:

1. Snapshot previous positions and insert them into a bounded spatial hash.
2. Advance destination/routine timers and route progress, respecting crossings and bounded edge transitions.
3. Apply soft separation from the immutable position snapshot and project the result back onto the current legal corridor; update edge progress consistently.
4. Finalize heading, actual movement speed, animation state, and animation phase.
5. At display rate, cull and write interpolated render positions into indirect instance lists.

Separation should examine at most 9 buckets × 8 candidates, reject distant candidates introduced by hash collisions, and cap correction distance. Track bucket overflow and overlapping-agent samples. This is soft crowd separation, not a guarantee of rigid-body nonpenetration under arbitrary density. If default hotspots overflow, fix width, occupancy, or table sizing based on evidence; do not silently drop citizens. Do not instantiate 100K Rapier bodies.

Store a conservative walkability/surface atlas, initially 1,024 × 1,024 at 2 meters per texel. Use exact corridor bounds and footprint queries where the atlas is too coarse, especially at doors and small props. Pedestrian paths are validated after expanding obstacles by citizen radius. Reject a correction that would cross a wall, bank, or illegal road area; a sidewalk atlas lookup alone is not a proof against tunneling.

The player uses a swept circle against nearby static rectangles from a spatial index, with sliding and a bounded number of collision iterations. Apply city bounds instead of the original plaza radius. Camera collision/retraction and a hero marker keep chase views and tall buildings usable. No GPU-wide citizen readback is needed for player movement.

## 5. Geometry and visual design

Keep the stylized, colorful low-poly characters. Give the city a restrained material palette: warm residential blocks, cooler downtown towers, muted industrial buildings, green parks, blue water, and a contrasting player marker. Shape neighborhoods through height and spacing, not random saturated colors on every building.

| Object | Baseline geometry budget | Treatment |
| --- | --- | --- |
| Ordinary building | 10 triangles | Four sides and roof; omit the buried bottom. Rectangular footprint. |
| Landmark or stepped tower | 20–30 triangles | Two or three box masses; reserve these for identifiable sites. |
| Road, path, square, parking surface | 2 triangles per merged rectangle | Greedily merge surface cells; patterns add no geometry. |
| Bridge deck | 10 triangles | Box with omitted bottom where unseen; budget rails separately and omit distant rails. |
| Tree | 12–18 triangles | Simple trunk and one canopy; no stacked high-segment cones. |
| Lamp, bench, bin, stop marker | 8–24 triangles | Minimal primitives; detail only when it is visible. |
| Car or bus | 20 triangles | Two boxes, shader-painted windows and wheels. |
| Citizen above 24 projected pixels | 24 triangles by default | Existing animated Tetra; optional 52/168 triangle quality tiers. |
| Citizen at 6–24 projected pixels | 24 triangles | Existing animated Tetra with simple shading. |
| Citizen below 6 projected pixels | 2 triangles | Opaque, depth-writing camera-facing color marker sized to the citizen; no alpha-blended sprite cloud. |

The 2-triangle tier needs a dedicated shader path that does not expect the existing joint attributes. Keep all original stress-test model indices and materials unchanged through an explicit city render profile. Face far markers toward the full camera basis so they remain visible in the top-down view. Their root still comes from the same citizen simulation. Give the hero a readable minimum tier and marker.

Projected size, not distance alone, controls LOD because the isometric camera is orthographic. Avoid a transparent crossfade that doubles all instances. Start with a crisp size threshold and inspect transitions; add compact hysteresis only if visible flicker warrants its storage cost. At a city-wide view, citizens may naturally become subpixel, but their simulation and population accounting remain active.

Use shader/atlas patterns for windows, doors, zebra crossings, lane markings, roof trim, sports courts, and parking lines. Fade patterns below their pixel footprint to avoid shimmer. Start with cheap directional face shading and hemisphere color, with shadows, bloom, AO, outlines, and crowd blob shadows off. Lamp heads may change color without creating thousands of point lights.

Render static city geometry in spatial chunks, initially 256 × 256 meters, with a few geometry/material families per chunk. Use instance colors and small per-instance attributes; do not create a mesh/material for each building. Compute bounds that include all instances and building heights, and freeze static transforms. [Three.js documents the instancing and bounds lifecycle](https://threejs.org/docs/pages/InstancedMesh.html).

A 5,000-building city at 10 triangles per ordinary building uses approximately 50,000 building triangles. The planning budget is at most 250,000 static triangles including streets, landmarks, infrastructure, vehicles, and props. Rendering all 100K citizens as Tetras costs 2.4 million triangles before extras; 100K distant markers cost 200,000. These are arithmetic budgets, not measured frame-rate predictions.

## 6. Data layout and lifecycle

Keep city generation and validation pure JavaScript with no DOM or three.js imports. Use stable IDs and typed arrays for runtime data. Temporary builder objects in the worker are acceptable; per-frame objects for all citizens are not.

Suggested city output:

```text
CityData
  version, seed, config, layoutHash, bounds
  districts, blocks, lots, buildings, addresses, serviceSites
  walkGraph, laneGraph, signals, routeTables, surfaceAtlas
  renderChunks, staticCollisionIndex, populationAssignments
  validationReport, counts, byteBudget
```

Proposed active citizen layout at capacity 131,072:

| Allocation | Bytes per capacity slot | Size |
| --- | --- | --- |
| Existing render, simulation, animation buffers | 48 | 6 MiB |
| City navigation `uvec4` | 16 | 2 MiB |
| Persistent home/work/leisure/flags `uvec4` | 16 | 2 MiB |
| Previous position `vec2` | 8 | 1 MiB |
| Existing four-tier cull position/animation lists | 128 | 16 MiB |

In the city profile, repurpose `simBuf` for edge distance, lateral offset, dwell timer, and movement data rather than retaining random-target semantics. Keep `renderBuf` and `animBuf` compatible with reused shaders, including citizen index in `animBuf.w`. Store IDs in integer buffers, not in the floating-point color/state packing.

Reserve up to 9 MiB for routing, approximately 4 MiB for the surface atlas, and measure additional graph, address, separation, geometry, and staging allocations. Target no more than 96 MiB of application-owned city/crowd GPU buffers and textures, excluding canvas/depth render targets and browser/driver overhead. Track actual allocations; use a separate estimate for viewport-dependent render targets. CPU generation peak and retained CPU data also belong in reports.

Keep each compute stage within the actual device limits, with **eight storage bindings as the portability design ceiling**. A navigation pass can bind render, simulation, animation, navigation, identity, packed map data, and packed route data: seven bindings. Separation is separate. Existing two-tier culling consumes seven; adding previous positions for interpolation consumes the eighth. Do not casually attach the original physics buffers as well. Validate generated pipelines on an eight-binding configuration.

Pack graph and address records into a documented static map buffer with explicit offsets, and route tables into a separate integer buffer. Document alignment and sizes in code and test the packing. Sampled atlas textures have their own limits. Reject unsupported devices with useful limits information rather than displaying a reduced population as a successful 100K run.

Generation cancellation uses a generation ID. Discard stale worker responses. On successful regeneration, pause simulation, swap the complete validated data set, place the hero at a valid spawn, reset counters, resume, and dispose the old data through supported ownership paths. Audit the current crowd disposal helpers carefully: three.js geometry/storage lifetimes are coupled in this repository. Test repeated regeneration for stable allocations.

## 7. User interface and game foundation

Open with the civic square in view, people moving, one clear route to a park, and the skyline visible. Offer a small City panel with seed, regeneration, population presets (10K, 25K, 50K, 100K), camera mode, pause, overview/map, and a quality preset. Show generation progress and retain the old city if regeneration fails.

Render the minimap once from static city records, then update the player marker and district selection. Avoid reading back every citizen to draw dots. A low-resolution density overlay can use bounded aggregate counters if needed.

Building selection reports its name/type, district, home/job capacity, and reachable address. Provide landmark navigation or a route highlight for the selected destination. These interactions make the first release useful as a game space rather than only a benchmark scene.

The HUD distinguishes **100,000 citizens**, the hero, simulated agents, submitted visible instances per LOD, and any overflow/error counters. It reports actual static and dynamic triangles, draws, GPU/CPU/frame time, and memory estimates. Do not reuse the plaza's `world.propTriangles` total as the whole-city triangle count.

Expose a small local `window.city` debugging API for `describe()`, `validate()`, `regenerate(config)`, `pause(value)`, `sampleCitizens(ids)`, and `benchmark(options)`. Keep sampling bounded and asynchronous; full readback is permitted only in explicit validation mode. Tests must interrogate real runtime state rather than DOM labels alone.

Keep semantic records independent of appearance so later game work can add city management, quests, deliveries, economy, or localized combat. Persist seed, generator version, and options for reproduction; full citizen save games are a later feature.

## 8. Implementation sequence and file ownership

Complete each stage to its acceptance check before increasing complexity. All six stages are required for the first playable release.

| Stage | Work | Exit evidence |
| --- | --- | --- |
| 1. City data | Seeded geography, road/block/lot generation, zoning, civic contents, addresses, capacities, pedestrian/lane graphs, validators | Deterministic hashes; valid connectivity, footprints, services, and 100K capacity across the seed corpus |
| 2. City view | `city.html`, chunked box geometry, surface patterns, props, cameras, map, player collision, selection, worker lifecycle | Usable empty city from all five cameras; player cannot pass through buildings or water |
| 3. Routing and citizens | Cluster tables, small CPU reference navigator, GPU city kernels, persistent IDs, spawn, routines, crossings, avoidance | 10K then 100K live citizens traverse real routes; GPU/CPU fixtures agree within tolerance |
| 4. Visual scale | Far markers, existing near animation, interpolation, static chunk culling, allocation reporting | Correct per-tier counts and triangle totals at street, district, and city scale |
| 5. Living city | Forecourt dwell capacity, small vehicle fleet, signal clearance, all civic/public-space details, complete controls | Destinations work; traffic and crossings agree; required city inventory visibly present |
| 6. Delivery | Standalone build, automated validation, benchmarks, original-demo regressions, README instructions | Reproducible build and test results, screenshots, raw performance report, usable launch URL |

Suggested module boundaries:

```text
src/city/
  config.js, schema.js, generate.js, validate.js, worker.js
  generation/{geography,roads,blocks,lots,zoning,services,props}.js
  navigation/{graph,clusters,routes,reference,packing}.js
  population/{assign,spawn,schedule}.js
  gpu/{simulation,separation,diagnostics}.js
  render/{world,geometry,materials,citizen-profile,chunks}.js
  player.js, traffic.js, minimap.js, ui.js, main.js
scripts/
  city-validate.mjs, city-smoke.mjs, city-benchmark.mjs
  postbuild-city.mjs
city.html
vite.city.config.js
```

Use fewer files where that improves clarity; the boundaries matter more than exact filenames. Add `test:city`, `smoke:city`, `bench:city`, and `build:city` scripts. Add the new Vite config and Node script locations to lint configuration as necessary, ignore `dist-city/` and the generated bundle in lint, and produce `city-demo.html` using the repository's existing single-file packaging pattern.

Shared changes should be concentrated in explicit `Crowd` simulation/render hooks, culling/interpolation hooks, and optional camera bounds. Preserve the original model IDs, default crowd behavior, and benchmark settings. Do not upgrade three.js/Vite or introduce an engine, ECS, pathfinding framework, React, or a large geometry dependency without a demonstrated need.

## 9. Validation and performance gates

### Generation and routing correctness

- Test a fixed corpus of at least 50 seeds plus hostile parameters: narrow water approaches, small blocks, minimal park space, density extremes, invalid numbers, and cancellation during generation.
- Identical seed/version/options produce identical layout, graph, addresses, and assignments. Changing cosmetic decoration must preserve street and address IDs. GPU floating-point and atomic ordering need not be bit-identical across devices.
- Test footprint disjointness, parcel containment, frontage/entrance access, sidewalk clearance, both bridge connections, every required service, and home/activity capacity for every citizen.
- Prove every route entry is a valid outgoing edge or documented terminal/unreachable sentinel. For each populated destination, check reachable source components, decreasing precomputed route distance, and legal transitions. Compare small fixtures to an independent Dijkstra implementation.
- Validate packing, graph limits, buffer sizing, non-power-of-two active counts, and padding sentinels. Reject invalid hash options before allocating buffers.

### Runtime correctness

- Exercise actual browser rendering in software WebGPU at a small population, all five cameras, selection, pause/resume, population changes, and three regenerations. Capture errors and inspect screenshots.
- Separately create the full 100,001 active slots even on software WebGPU, advance a bounded number of fixed ticks, and inspect GPU counts and citizen samples. A slow software run is still useful for allocation and shader correctness, but is not performance evidence.
- In explicit validation mode, run a GPU reduction over all active citizens for NaN positions, illegal edges, bounds violations, building/water intrusion, and active count. Read back only counters during normal diagnostics; use full readback for a failure investigation.
- Route scripted walkers through a T-junction, a bridge, a red/green crossing, an address arrival/departure, and a congested square. Assert signal legality, actual progress, bounded displacement, finite coordinates, and no wall penetration. Exact trajectory identity is not required for soft separation.
- Verify persistence while panning away and returning: sampled IDs retain their assignments and advance along their routes. Verify movement continues independently of visibility.
- Check resource counters after repeated regeneration and population toggles. Confirm staging buffers, workers, geometry, materials, textures, and event listeners are released.
- Verify the built `city-demo.html` from HTTP and directly from disk with network disabled. Check that inline worker generation and external-resource detection actually cover the standalone artifact.

### Hardware performance gate

Performance is currently **unmeasured**. Use the user's desktop GPU through Windows Chrome/Edge for the primary real-device run; Linux headless SwiftShader results cannot establish the 100K performance target. Record the adapter rather than assuming the installed GPU is the one the browser selected.

At 1,920 × 1,080 physical pixels, fixed seed, 100,000 citizens plus hero, default quality, and real-time simulation speed:

1. Warm up each scenario for at least 10 seconds, then record 60 seconds.
2. Measure street-level square, a dense downtown view, a full-city overview, and a scripted camera traversal with a congested bridge/crossing.
3. Record median/p95/p99 frame time, CPU time, GPU compute/render timing when available, simulated ticks, dropped time, per-tier instance counts, triangles, draw calls, memory allocations, and collision overflow.
4. Target median at or below 16.7 ms and p95 at or below 20 ms on the recorded desktop hardware, with no sustained tick dropping. These are acceptance targets, not promised results.
5. Report each scenario separately. A low visible population at street level cannot substitute for full-city rendering, and a frozen simulation cannot satisfy the navigation target.

Report warm-up/compilation separately and include shader errors, fallback-adapter state, render resolution, exact seed/options, and commit. If timing queries are unavailable, mark GPU time unavailable. If the hardware target fails, profile and optimize the observed bottleneck, then re-run the same scenarios. Population reductions must be labeled as a different test.

Design targets for investigation: main-thread p95 below 4 ms, city generation below 5 seconds after code loads, default static draw calls below 400, and application-owned GPU data below 96 MiB. These targets guide profiling; test reports must show actual figures and any remaining gap.

### Required commands for the implementation

```bash
npm ci
npm run lint
npm run test:city
npm run build
npm run build:game
npm run build:city
npm run smoke:quick
npm run smoke:city
npm run sim -- --depth 1-4 --seconds 45
npm run sim -- --depth 25 --seconds 30
```

Run the original game browser smoke if a changed shared component reaches the game renderer. Run `bench:city` on a real GPU, export raw JSON, and link the report. Add generation tests and city build to normal CI and bounded browser smoke to the existing browser-testing workflow. Retain both original single-file artifacts and add the city artifact.

## 10. Completion contract

The implementation is complete when a user can open the new city demo, see and explore all required city elements, regenerate a reproducible city, select an address, and watch 100,000 persistent citizens navigate its actual pedestrian network. The population, routing, collision, triangle, memory, standalone-build, and regression checks above must have evidence.

A beautiful empty city, 100K stationary markers, citizens walking through buildings, a population label backed by fewer live agents, or an unverified frame-rate claim does not meet this contract. If real hardware cannot be tested in the implementation environment, deliver the working build and reproducible benchmark procedure, explicitly leave the hardware gate unverified, and do not mark the performance claim complete.
