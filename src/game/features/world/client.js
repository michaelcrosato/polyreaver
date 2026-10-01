// World & levels - presentation side: render systems, UI panels, input, audio.
// Loaded only in the browser (src/game/main.js), after every sim.js.
//
//   client/level.js      render system 'level': floors, walls (cutaway), liquids, props,
//                        halos, fog, sky, sun + the pooled point lights ('world-lights')
//   client/mech.js       render system 'world-mech': mechanic objects ( model.type 'mech' ),
//                        spikes, beams, rifts, wells, chrono dials, magma, miasma fog,
//                        the exit portal, echo glow
//   client/swarm.js      the Swarm: thousands of ashlings in one instanced draw
//   client/townsfolk.js  the engine's GPU crowd as ambient townsfolk in the plaza
//   client/panels.js     interact prompt + listener, waypoint, level exit, mechanic banner,
//                        objectives, speech bubbles, the training dummy's DPS meter
//   client/minimap.js    corner minimap with explored fog + the large Tab / M map

import './sim.js';
import './client/level.js';
import './client/mech.js';
import './client/swarm.js';
import './client/townsfolk.js';
import './client/panels.js';
import './client/minimap.js';
