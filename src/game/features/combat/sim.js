// Combat feel - simulation side (Player controller, input (keyboard/mouse/gamepad/touch), active skills + supports, statuses/ailments, VFX, camera, audio.)
//
// Rules for files imported from here: no three.js, no DOM, no window. This entry is
// loaded by the browser AND by Node (scripts/sim.mjs), so everything it registers
// (defs, systems, hooks) must run headless. Rendering / UI code goes in client.js.

export {};
