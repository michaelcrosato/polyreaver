// World & levels - simulation side: layout generators, themes, level mechanics
// (one per level, combinable), the campaign + endless level provider, the town hub
// and its NPCs, interaction, exit portals and level flow.
//
// Rules for files imported from here: no three.js, no DOM, no window. This entry is
// loaded by the browser AND by Node (scripts/sim.mjs), so everything it registers
// (defs, systems, hooks) must run headless. Rendering / UI code goes in client.js.
//
//   themes.js             'theme' defs (12 biomes + the town) and palette shifting
//   models.js             part-list 'model' defs for props and mechanic objects
//   gen/                  'roomTemplate' + 'levelGenerator' defs: dungeon, caves, town, arena
//   mechanics/            the runtime, the shared kit, terrain rules and the 12 mechanics
//   levels.js             'level' defs (depths 1-20) and the two 'levelProvider's
//   town.js               town NPCs, service objects, the 'npc' controller
//   flow.js               interact system, exit portal, level completion
//   api.js                functions + 'apiCommand's for agents ( level.ascii, mechanic.list ... )

import './themes.js';
import './models.js';
import './gen/rooms.js';
import './gen/dungeon.js';
import './gen/caves.js';
import './gen/town.js';
import './gen/arena.js';
import './mechanics/index.js';
import './mechanics/terrain.js';
import './mechanics/powder-keg.js';
import './mechanics/spike-field.js';
import './mechanics/lightless.js';
import './mechanics/black-ice.js';
import './mechanics/conduits.js';
import './mechanics/rift-gates.js';
import './mechanics/magma-tide.js';
import './mechanics/gravity-wells.js';
import './mechanics/echoes.js';
import './mechanics/swarm.js';
import './mechanics/chrono-fields.js';
import './mechanics/miasma.js';
import './levels.js';
import './town.js';
import './flow.js';
import './api.js';

export { levelSpec, generateLevel, levelAscii, describeLevel, describeMechanic, listMechanics, listThemes, describeWorld, campaign } from './api.js';
