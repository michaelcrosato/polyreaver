// Monsters & encounters - presentation side: render systems, UI panels, input, audio.
// Loaded only in the browser (src/game/main.js), after every sim.js.
//
//   client/plates.js   nameplates + life bars over rares / uniques ( uiPanel 'monster-plates' )
//   client/bossbar.js  boss life bar, phase markers, intro / phase name card ( uiPanel 'boss-bar' )
//   client/auras.js    rarity rings, affix pips, burrow dust ( renderSystem 'monster-auras' )
//
// Bodies are drawn by the creatures feature's rig renderer from model.genome (+ glow,
// tint, hidden); attack visuals by the combat feature's VFX from each area's /
// projectile's `fx` hint. This feature only adds what is specific to monsters.

import './sim.js';
import './client/plates.js';
import './client/bossbar.js';
import './client/auras.js';
