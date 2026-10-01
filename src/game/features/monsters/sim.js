// Monsters & encounters - simulation side (Monster families, behaviour archetypes (AI), elite affixes, bosses (phases, attack patterns), encounter director, procedural monster/boss composition.)
//
// Rules for files imported from here: no three.js, no DOM, no window. This entry is
// loaded by the browser AND by Node (scripts/sim.mjs), so everything it registers
// (defs, systems, hooks) must run headless. Rendering / UI code goes in client.js.
//
// Map of the feature (read in this order):
//   util.js        elements, hit templates, telegraphs, timelines, geometry helpers
//   factory.js     spawnMonster(): genome → body → stats → brain → affixes → rewards
//   abilities.js   monsterAbility library (melee, telegraphed heavies, ranged, casters, support)
//   nav.js         flow field + steering;  tactics.js: approach / kite / flock / escort / patrol
//   brain.js       controller 'monster': sense → utility-scored decide → act, attack tokens
//   archetypes.js  14 behaviours;  affixes.js: elite modifiers;  families.js: the bestiary
//   patterns.js    bossPattern library;  bosses.js: boss framework;  boss-defs.js: 12 bosses
//   compose.js     procedural families and bosses for endless depth;  names.js: names
//   director.js    encounter director (population, packs, ambushes, pacing, exit)
//   api.js         public functions + 'monsters.*' agent commands

import './statuses.js';
import './abilities.js';
import './archetypes.js';
import './brain.js';
import './affixes.js';
import './families.js';
import './patterns.js';
import './bosses.js';
import './boss-defs.js';
import './compose.js';
import './director.js';

export * from './api.js';
