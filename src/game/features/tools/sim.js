// Agent tools - simulation side: the JSON command API (game.api) and the playtest
// bot. Node-safe (no three.js / DOM): scripts/sim.mjs and tests use the same API
// the browser and the Claude link do.

import './api.js';
export { createBot, astar } from './bot.js';
