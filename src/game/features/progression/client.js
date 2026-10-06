// Progression & loot - presentation side: render systems, UI panels, input, audio.
// Loaded only in the browser (src/game/main.js), after every sim.js.
//
//   ui/hud.js        flask belt, buffs, menu buttons, loot labels, pickup feed, service listener
//   ui/inventory.js  inventory + equipment (I)        ui/character.js  character sheet (C)
//   ui/tree.js       passive tree + ascendancy (T)   ui/skills.js     skills + supports (K)
//   ui/vendor.js     merchant / gambling             ui/stash.js      stash tabs
//   ui/craft.js      blacksmith (currency, quality)  ui/common.js     tooltips, grids, drag & drop
//   render/beams.js  rarity rings, beams and unique lights

import './sim.js';
import './ui/style.js';
import './ui/hud.js';
import './ui/inventory.js';
import './ui/character.js';
import './ui/tree.js';
import './ui/skills.js';
import './ui/vendor.js';
import './ui/stash.js';
import './ui/craft.js';
import './ui/save-manager.js';
import './ui/planner.js';
import './render/beams.js';
