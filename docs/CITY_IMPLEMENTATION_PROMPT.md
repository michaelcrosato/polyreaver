# Prompt to implement the procedural city

Use this prompt in the same repository with GPT-6.1 Sol and extra effort. The authoritative specification is [CITY_PLAN.md](CITY_PLAN.md); the paths below are relative to the Git root, `/home/micha/dev/polyreaver/polyreaver` in this workspace.

```text
Implement the complete first playable procedural city specified in docs/CITY_PLAN.md.
Read that plan, docs/AGENTS.md, applicable AGENTS.md instructions, and the game-assets
skill before editing. Revalidate current Git state and the source files named in
the plan; the plan was written against d667c05 and local work may have changed.

The outcome is a walkable, recognizable city with exactly 100,000 persistent NPC
citizens plus the player, built on the original WebGPU crowd engine. Deliver the
city entry page and self-contained build, not just generator code or an empty
visual mockup. Use the existing plain JavaScript, three.js WebGPU/TSL, Vite stack.

Follow the plan's six stages in order. Start by proving the deterministic city
data, connected pedestrian graph, valid parcels/addresses, and population capacity.
Then add rendering/player movement, shared routing and GPU citizens, rendering LOD,
the remaining living-city elements, and delivery/validation. Continue through all
six stages; a stage is an implementation checkpoint, not the completed task.

Core requirements:
- Seeded road-first rectangular subdivision: coherent zoning, buildings, sidewalks,
  crossings, services, parks, civic square, water/bridges, utilities, and small traffic
  fleet. Required inventory and invariants are in CITY_PLAN.md.
- Typical buildings are 10-triangle boxes with shader/atlas facade detail. Batch
  static objects by chunk/material, use proper bounds, and report real geometry cost.
- Preserve 100,000 NPC IDs, home/work/leisure assignments, and positions independent
  of the camera. Slot 0 is the player, so active count is 100,001 and default capacity
  is 131,072. All citizens remain on the map, including at destinations.
- Navigation uses bounded routing clusters, shared next-edge tables, and GPU route
  following. No per-citizen A* on the main thread, no 100K Rapier bodies, and no
  walking through buildings or water. Crossings use signal phases and clearance.
- Use fixed simulation ticks, snapshot-based bounded avoidance, overflow diagnostics,
  and render interpolation. Keep the existing render/animation packing contract.
- Far citizens use a dedicated 2-triangle marker shader; nearby citizens reuse
  existing animated models. Preserve original demo model indices and behavior.
- Respect actual device limits and the eight-storage-binding design ceiling.
  Document GPU packing, track allocations, and test full active counts and padding.
- Add city.html and city-demo.html with seed/regenerate, population presets, map,
  cameras, pause, building selection, reports, and a bounded window.city debug API.
- Keep generation/validation pure and testable in Node. Run generation in a worker,
  cancel stale jobs, clean up resources, and verify standalone inline-worker behavior.

Use small explicit extension points in the existing Crowd and camera code. Do not
copy the entire crowd engine, replace the original stress-test entry, rewrite the
action game, or upgrade dependencies as part of this work. Keep existing benchmark
semantics. Routine implementation decisions are yours; do not stop for confirmation.

Inspect package.json and use its existing commands. Add and run test:city,
build:city, smoke:city, and bench:city as specified. Run lint, both existing builds,
the original crowd smoke, and the short existing game simulations. Verify the city
in a headless browser, inspect screenshots, check runtime errors, and test the
standalone artifact offline. Include deterministic seed-corpus and independent
route-reference tests, all-agent GPU validation counters, and regeneration cleanup.

100K at 1080p/60 fps is a measurement target, not an established capability. Test
street, downtown, whole-city, and traversal/congestion scenarios on a recorded
hardware GPU. Report raw timings, dropped simulation time, counts, triangles,
allocations, and errors. SwiftShader can prove correctness, not desktop performance.
If real hardware is inaccessible, clearly leave that gate unverified and provide
the exact benchmark procedure; do not claim the performance target passed.

Finish with the playable URL, files changed, a concise account of the implemented
city and citizen behavior, test/build results, screenshots, measured benchmark
results or the precise unverified gate, and remaining limitations. Preserve the
full completion contract in CITY_PLAN.md throughout the implementation.
```
