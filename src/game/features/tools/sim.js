// Agent tools - simulation side (window.game API commands, headless bot, inspectors, Workshop labs, contact sheets, Claude link game commands.)
//
// Rules for files imported from here: no three.js, no DOM, no window. This entry is
// loaded by the browser AND by Node (scripts/sim.mjs), so everything it registers
// (defs, systems, hooks) must run headless. Rendering / UI code goes in client.js.

export {};
