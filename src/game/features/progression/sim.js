// Progression & loot - simulation side (XP/levels, items/affixes/rarities/uniques/currency, loot drops, inventory/equipment/stash/vendor/crafting UI, passive skill tree (+UI), save/load.)
//
// Rules for files imported from here: no three.js, no DOM, no window. This entry is
// loaded by the browser AND by Node (scripts/sim.mjs), so everything it registers
// (defs, systems, hooks) must run headless. Rendering / UI code goes in client.js.

export {};
