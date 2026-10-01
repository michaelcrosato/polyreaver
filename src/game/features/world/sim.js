// World & levels - simulation side (Level layout generators, themes/palettes/lighting, level mechanics (one per level, combinable), campaign + endless level provider, town hub + NPCs, level renderer, minimap.)
//
// Rules for files imported from here: no three.js, no DOM, no window. This entry is
// loaded by the browser AND by Node (scripts/sim.mjs), so everything it registers
// (defs, systems, hooks) must run headless. Rendering / UI code goes in client.js.

export {};
