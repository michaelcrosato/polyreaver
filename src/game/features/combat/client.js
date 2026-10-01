// Combat feel - presentation side. Loaded only in the browser (src/game/main.js),
// after every sim.js. Everything here READS the simulation and listens to its
// events; the only things it writes are the input state and render objects.
//
//   client/input.js      inputProvider 'default': keyboard + mouse, gamepad, touch twin-stick
//   client/camera.js     renderSystem 'camera': iso / chase / top, look-ahead, framing, shake
//   client/fx.js         renderSystem 'combat-fx': the VFX conductor (events -> batches below)
//     particles.js       GPU particles (TSL compute spawn + update, one sprite draw)
//     decals.js          ground decals: telegraphs, burning / frozen ground, shockwaves
//     ribbons.js         slash arcs, weapon trails, lightning beams
//     billboards.js      glow halos and damage-number glyphs
//     meshes.js          projectile bodies, crystals, meteors, spectral minions
//     numbers.js         pooled damage numbers      lights.js   pooled dynamic point lights
//   client/audio.js      renderSystem 'combat-audio': procedural WebAudio SFX
//   client/hud.js        uiPanel 'skillbar': skill slots, buffs, touch overlay, pause options
//     icons.js           procedural canvas icons     settings.js per-device options
//     palette.js         element colours shared by every visual

import './sim.js';
import './client/camera.js';
import './client/input.js';
import './client/fx.js';
import './client/audio.js';
import './client/hud.js';
