// Creatures & rigs - simulation side: Spore-style genomes (generation, mutation,
// breeding, metrics), body plans and parts, palettes, and the model library (props,
// loot, weapons, NPC looks) as registry defs. Rendering lives in client.js.
//
// Rules for files imported from here: no three.js, no DOM, no window. This entry is
// loaded by the browser AND by Node (scripts/sim.mjs), so everything it registers
// (defs, systems, hooks) must run headless.
//
// Public API for other features (all sim-safe):
//   generateGenome( rng, { plan, size, tags, palette, level, parts, body, gait } ) -> genome JSON
//   mutateGenome( g, rng, amount ), crossGenomes( a, b, rng ), validateGenome( g ), describeGenome( g )
//   genomeMetrics( g ) -> { radius, height, mass, reach, speedMul, flying, attackStyles, hover, legs, parts, bones }
//   applyGenome( entity, genome ) -> sets model, radius, height, mass, data.flying from the metrics
//   buildBody( g ) / templateFor( model ) -> rig templates (part counts, dims, attachment points)

import './palettes.js';
import './plans.js';
import './parts.js';
import './library.js';

export * from './genome.js';
export { buildBody } from './body.js';
export { templateFor, creatureGenome } from './models.js';
export { harmonyPalette, pickPalette } from './palettes.js';
