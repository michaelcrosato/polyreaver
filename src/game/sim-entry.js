// Everything the SIMULATION needs, in registration order. Node scripts import this
// file (no three.js, no DOM); the browser imports it through main.js. Later
// definitions replace earlier ones with the same id, so features override baseline.

import './content/baseline.js';
import './features/creatures/sim.js';
import './features/combat/sim.js';
import './features/monsters/sim.js';
import './features/progression/sim.js';
import './features/world/sim.js';
import './features/tools/sim.js';
import './features/examples/sim.js';

export { Game } from './game.js';
