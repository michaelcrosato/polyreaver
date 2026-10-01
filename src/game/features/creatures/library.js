// Model library: every static and lightly animated thing in the game, as `model`
// defs (docs/GAME.md §5). The world feature places props by id, progression drops
// loot by id, NPC placement picks NPC looks by id:
//
//   entity.model = { type: 'prop', id: 'brazier', state?: 'off', palette?: {...}, tint?, scale? }
//   entity.model = { type: 'loot', id: 'potion', rarity?: 'rare', color?: '#ff3030' }
//   entity.model = { type: 'loot', id: 'weapon-axe', rarity: 'unique' }   (any weapon lies on the ground)
//   entity.model = { type: 'npc', id: 'blacksmith' }    entity.model = { type: 'npc', id: 'townsfolk', seed: 7 }
//
// MODEL DEF FORMAT
//   define( 'model', {
//     id, name, type: 'prop' | 'loot' | 'weapon' | 'tool' | 'npc' | 'creature', tags,
//     palette?: { primary, secondary, accent, skin, metal, glow, dark }   defaults for palette keys
//     size?: [ w, h, d ]           footprint for placement / colliders (metres)
//     bones?: [ { name, parent?: 'root', pos?: [x,y,z], rot?: [x,y,z], fx? } ]
//     parts: [ { shape, bone?: 'root', pos: [x,y,z], rot: [x,y,z], scale: [x,y,z],
//                color: '#rrggbb' | paletteKey, emissive?: 0..1, shade?: 0.5..1.5 } ]
//   } )
//   Shapes and their unit sizes: rig.js SHAPES. Positions in metres, origin on the
//   ground at the model's centre, +Y up, +Z front. `rot` is a three.js XYZ Euler.
//   Bone fx (animate.js applyFx): spin, bob, sway, flicker, pulse, orbit, wobble, and
//   'state' - a pose per entity.model.state ( chest lid 'open', brazier 'off', trap 'up').
//
// Weapons are held in weapon space: grip at the origin, the blade / head along +Y,
// the edge facing +Z. Extra fields: weaponClass, hand ('R' | 'L'), length (tip y),
// base (where the blade starts), grip2 (second hand on two-handed hafts).
// NPC defs carry a humanoid LOOK ( humanoid.js ) instead of parts, plus `emote`.

import { define } from '../../core/registry.js';

const M = ( def ) => define( 'model', def );
const p = ( shape, pos, scale, color, rot = [ 0, 0, 0 ], extra = {} ) => ( { shape, pos, rot, scale, color, ...extra } );
const D = Math.PI / 180;

export const PROP_PALETTE = { primary: '#7a5230', secondary: '#8d8a82', accent: '#a83a2a', skin: '#d8cfb8', metal: '#636973', glow: '#ffa040', dark: '#2a211a' };

// --- weapons ---------------------------------------------------------------------------------

const W = ( id, weaponClass, parts, extra = {} ) => M( { id: 'weapon-' + id, name: id[ 0 ].toUpperCase() + id.slice( 1 ), type: 'weapon', weaponClass, hand: 'R', tags: [ 'weapon', weaponClass ], parts, ...extra } );

W( 'sword', 'sword', [
	p( 'blade', [ 0, 0.52, 0 ], [ 0.095, 0.74, 0.03 ], 'metal' ),
	p( 'box', [ 0, 0.135, 0 ], [ 0.26, 0.04, 0.06 ], 'accent' ),
	p( 'cyl', [ 0, 0.03, 0 ], [ 0.042, 0.18, 0.042 ], '#3a2a20' ),
	p( 'octa', [ 0, - 0.08, 0 ], [ 0.065, 0.065, 0.065 ], 'accent' ),
	p( 'octa', [ 0, 0.135, 0.032 ], [ 0.045, 0.045, 0.02 ], 'glow' )
], { length: 0.9, base: 0.16 } );

W( 'greatsword', 'greatsword', [
	p( 'blade', [ 0, 0.72, 0 ], [ 0.15, 1.08, 0.035 ], 'metal' ),
	p( 'box', [ 0, 0.17, 0 ], [ 0.38, 0.05, 0.07 ], 'accent' ),
	p( 'cyl', [ 0, - 0.02, 0 ], [ 0.045, 0.34, 0.045 ], '#3a2a20' ),
	p( 'octa', [ 0, - 0.2, 0 ], [ 0.075, 0.075, 0.075 ], 'accent' ),
	p( 'octa', [ 0, 0.17, 0.036 ], [ 0.055, 0.055, 0.02 ], 'glow' )
], { length: 1.26, base: 0.2, grip2: - 0.14 } );

W( 'axe', 'axe', [
	p( 'cyl', [ 0, 0.28, 0 ], [ 0.045, 0.72, 0.045 ], '#6b4a2e' ),
	p( 'box', [ 0, 0.56, 0.07 ], [ 0.035, 0.12, 0.13 ], 'metal' ),
	p( 'wedge', [ 0, 0.56, 0.2 ], [ 0.03, 0.3, 0.16 ], 'metal', [ 0, Math.PI, 0 ] ),
	p( 'spike', [ 0, 0.56, - 0.09 ], [ 0.04, 0.12, 0.04 ], 'metal', [ - Math.PI / 2, 0, 0 ] ),
	p( 'octa', [ 0, 0.56, 0.0 ], [ 0.05, 0.05, 0.05 ], 'glow' )
], { length: 0.7, base: 0.45 } );

W( 'mace', 'mace', [
	p( 'cyl', [ 0, 0.25, 0 ], [ 0.045, 0.6, 0.045 ], '#4a3a30' ),
	p( 'octa', [ 0, 0.6, 0 ], [ 0.17, 0.2, 0.17 ], 'metal' ),
	p( 'spike', [ 0.1, 0.6, 0 ], [ 0.05, 0.1, 0.05 ], 'metal', [ 0, 0, - Math.PI / 2 ] ),
	p( 'spike', [ - 0.1, 0.6, 0 ], [ 0.05, 0.1, 0.05 ], 'metal', [ 0, 0, Math.PI / 2 ] ),
	p( 'spike', [ 0, 0.6, 0.1 ], [ 0.05, 0.1, 0.05 ], 'metal', [ Math.PI / 2, 0, 0 ] ),
	p( 'spike', [ 0, 0.72, 0 ], [ 0.05, 0.12, 0.05 ], 'glow' )
], { length: 0.72, base: 0.5 } );

W( 'dagger', 'dagger', [
	p( 'blade', [ 0, 0.27, 0 ], [ 0.07, 0.36, 0.025 ], 'metal' ),
	p( 'box', [ 0, 0.085, 0 ], [ 0.15, 0.03, 0.04 ], 'accent' ),
	p( 'cyl', [ 0, 0.0, 0 ], [ 0.038, 0.14, 0.038 ], '#3a2a20' ),
	p( 'octa', [ 0, 0.085, 0.022 ], [ 0.035, 0.035, 0.015 ], 'glow' )
], { length: 0.45, base: 0.1 } );

W( 'spear', 'spear', [
	p( 'cyl', [ 0, 0.25, 0 ], [ 0.04, 1.65, 0.04 ], '#6b4a2e' ),
	p( 'blade', [ 0, 1.18, 0 ], [ 0.09, 0.26, 0.03 ], 'metal' ),
	p( 'ring', [ 0, 1.04, 0 ], [ 0.07, 0.25, 0.07 ], 'accent' ),
	p( 'octa', [ 0, 1.06, 0 ], [ 0.04, 0.04, 0.04 ], 'glow' ),
	p( 'cone', [ 0, - 0.6, 0 ], [ 0.05, 0.07, 0.05 ], 'metal', [ Math.PI, 0, 0 ] )
], { length: 1.3, base: 1.05, grip2: 0.42 } );

W( 'staff', 'staff', [
	p( 'cyl', [ 0, 0.3, 0 ], [ 0.045, 1.6, 0.045 ], '#5a3e28' ),
	p( 'ring', [ 0, 1.12, 0 ], [ 0.2, 0.4, 0.2 ], 'accent', [ Math.PI / 2, 0, 0 ] ),
	p( 'sphere', [ 0, 1.12, 0 ], [ 0.13, 0.13, 0.13 ], 'glow', [ 0, 0, 0 ], { emissive: 1 } ),
	p( 'spike', [ 0, 1.26, 0 ], [ 0.04, 0.12, 0.04 ], 'accent' )
], { length: 1.15, base: 1.0, grip2: 0.42 } );

W( 'wand', 'wand', [
	p( 'cyl', [ 0, 0.14, 0 ], [ 0.03, 0.36, 0.03 ], '#3a2a20' ),
	p( 'ring', [ 0, 0.3, 0 ], [ 0.06, 0.2, 0.06 ], 'accent' ),
	p( 'octa', [ 0, 0.37, 0 ], [ 0.07, 0.1, 0.07 ], 'glow', [ 0, 0, 0 ], { emissive: 1 } )
], { length: 0.4, base: 0.3 } );

W( 'hammer', 'hammer', [
	p( 'cyl', [ 0, 0.3, 0 ], [ 0.05, 1.15, 0.05 ], '#5a3e28' ),
	p( 'box', [ 0, 0.86, 0 ], [ 0.17, 0.2, 0.36 ], 'metal' ),
	p( 'box', [ 0, 0.86, 0.19 ], [ 0.19, 0.22, 0.04 ], 'accent' ),
	p( 'octa', [ 0, 0.86, - 0.19 ], [ 0.06, 0.06, 0.06 ], 'glow' )
], { length: 0.98, base: 0.76, grip2: 0.32 } );

W( 'scythe', 'scythe', [
	p( 'cyl', [ 0, 0.35, 0 ], [ 0.042, 1.55, 0.042 ], '#3a2a20' ),
	p( 'blade', [ 0, 1.06, 0.3 ], [ 0.1, 0.62, 0.03 ], 'metal', [ Math.PI / 2 + 0.3, Math.PI / 2, 0 ] ),
	p( 'octa', [ 0, 1.1, 0 ], [ 0.05, 0.05, 0.05 ], 'glow' )
], { length: 1.15, base: 1.0, grip2: 0.45 } );

W( 'bow', 'bow', [
	p( 'cyl', [ 0, 0, 0.04 ], [ 0.05, 0.14, 0.05 ], '#3a2a20' ),
	p( 'cone', [ 0, 0.28, 0.0 ], [ 0.045, 0.46, 0.035 ], '#6b4a2e', [ - 0.32, 0, 0 ] ),
	p( 'cone', [ 0, - 0.28, 0.0 ], [ 0.045, 0.46, 0.035 ], '#6b4a2e', [ Math.PI + 0.32, 0, 0 ] ),
	p( 'cyl', [ 0, 0, - 0.1 ], [ 0.008, 0.98, 0.008 ], '#e8e0c8' ),
	p( 'octa', [ 0, 0.0, 0.07 ], [ 0.04, 0.04, 0.04 ], 'glow' )
], { length: 0.5, base: 0, hand: 'L' } );

W( 'crossbow', 'crossbow', [
	p( 'box', [ 0, 0.2, 0 ], [ 0.06, 0.5, 0.06 ], '#5a3e28' ),
	p( 'cyl', [ 0, 0.42, 0 ], [ 0.03, 0.62, 0.03 ], 'metal', [ 0, 0, Math.PI / 2 ] ),
	p( 'octa', [ 0, 0.1, 0.04 ], [ 0.04, 0.04, 0.04 ], 'glow' )
], { length: 0.5, base: 0.3 } );

W( 'claw', 'claw', [
	p( 'box', [ 0, 0.02, 0 ], [ 0.1, 0.1, 0.1 ], 'metal' ),
	p( 'spike', [ 0.03, 0.2, 0.0 ], [ 0.03, 0.3, 0.02 ], 'metal' ),
	p( 'spike', [ - 0.03, 0.2, 0.0 ], [ 0.03, 0.3, 0.02 ], 'metal' ),
	p( 'octa', [ 0, 0.05, 0.05 ], [ 0.03, 0.03, 0.03 ], 'glow' )
], { length: 0.35, base: 0.05 } );

W( 'shield', 'shield', [
	p( 'disc', [ 0, 0, 0.06 ], [ 0.5, 0.6, 0.5 ], 'accent', [ Math.PI / 2, 0, 0 ] ),
	p( 'sphere', [ 0, 0, 0.1 ], [ 0.12, 0.12, 0.06 ], 'metal' ),
	p( 'ring', [ 0, 0, 0.06 ], [ 0.52, 0.4, 0.52 ], 'metal', [ Math.PI / 2, 0, 0 ] )
], { length: 0.3, base: 0, hand: 'L' } );

// --- NPC tools (held like weapons) ---------------------------------------------------------------

const TOOL = ( id, parts, extra = {} ) => M( { id: 'tool-' + id, type: 'tool', hand: 'R', tags: [ 'tool' ], parts, ...extra } );

TOOL( 'hammer', [
	p( 'cyl', [ 0, 0.14, 0 ], [ 0.04, 0.42, 0.04 ], '#6b4a2e' ),
	p( 'box', [ 0, 0.36, 0 ], [ 0.09, 0.09, 0.2 ], 'metal' )
], { length: 0.4 } );
TOOL( 'broom', [
	p( 'cyl', [ 0, 0.15, 0 ], [ 0.035, 1.3, 0.035 ], '#8a6a42' ),
	p( 'cone', [ 0, - 0.55, 0 ], [ 0.18, 0.3, 0.1 ], '#c8a860' )
], { length: 0.8 } );
TOOL( 'ledger', [
	p( 'box', [ 0, 0.05, 0.02 ], [ 0.2, 0.26, 0.05 ], '#6b2a2a' ),
	p( 'box', [ 0, 0.05, 0.02 ], [ 0.18, 0.24, 0.055 ], '#f0e6c8' )
], { hand: 'L', length: 0.2 } );
TOOL( 'staff', [
	p( 'cyl', [ 0, 0.25, 0 ], [ 0.04, 1.6, 0.04 ], '#4a3424' ),
	p( 'octa', [ 0, 1.1, 0 ], [ 0.12, 0.18, 0.12 ], 'glow', [ 0, 0, 0 ], { emissive: 1 } ),
	p( 'ring', [ 0, 1.1, 0 ], [ 0.2, 0.3, 0.2 ], 'accent' )
], { length: 1.15 } );
TOOL( 'spear', [
	p( 'cyl', [ 0, 0.3, 0 ], [ 0.04, 1.8, 0.04 ], '#6b4a2e' ),
	p( 'blade', [ 0, 1.3, 0 ], [ 0.09, 0.28, 0.03 ], 'metal' )
], { length: 1.4 } );
TOOL( 'lantern', [
	p( 'box', [ 0, - 0.12, 0.05 ], [ 0.12, 0.16, 0.12 ], 'glow', [ 0, 0, 0 ], { emissive: 1 } ),
	p( 'cone', [ 0, - 0.01, 0.05 ], [ 0.15, 0.08, 0.15 ], 'metal' )
], { hand: 'L', length: 0.2 } );
TOOL( 'shield', [
	p( 'box', [ 0, 0, 0.07 ], [ 0.45, 0.6, 0.05 ], 'accent', [ 0, 0, 0 ] ),
	p( 'box', [ 0, 0, 0.1 ], [ 0.08, 0.5, 0.02 ], 'metal' )
], { hand: 'L', length: 0.3 } );

// --- props -----------------------------------------------------------------------------------------

const PR = ( id, name, parts, extra = {} ) => M( { id, name, type: 'prop', tags: [ 'prop', ...( extra.tags || [] ) ], palette: { ...PROP_PALETTE, ...( extra.palette || {} ) }, parts, ...extra } );

PR( 'barrel', 'Barrel', [
	p( 'cyl', [ 0, 0.45, 0 ], [ 0.66, 0.88, 0.66 ], 'primary' ),
	p( 'ring', [ 0, 0.2, 0 ], [ 0.7, 0.4, 0.7 ], 'metal' ),
	p( 'ring', [ 0, 0.7, 0 ], [ 0.7, 0.4, 0.7 ], 'metal' ),
	p( 'disc', [ 0, 0.9, 0 ], [ 0.58, 0.4, 0.58 ], 'primary', [ 0, 0, 0 ], { shade: 0.8 } )
], { size: [ 0.7, 0.9, 0.7 ], tags: [ 'breakable' ] } );

PR( 'explosive-barrel', 'Explosive barrel', [
	p( 'cyl', [ 0, 0.45, 0 ], [ 0.66, 0.88, 0.66 ], 'accent' ),
	p( 'ring', [ 0, 0.45, 0 ], [ 0.7, 0.9, 0.7 ], '#f2c12e' ),
	p( 'ring', [ 0, 0.15, 0 ], [ 0.7, 0.4, 0.7 ], 'metal' ),
	p( 'ring', [ 0, 0.75, 0 ], [ 0.7, 0.4, 0.7 ], 'metal' ),
	p( 'disc', [ 0, 0.9, 0 ], [ 0.58, 0.4, 0.58 ], 'dark' ),
	p( 'cyl', [ 0.12, 0.98, 0 ], [ 0.04, 0.16, 0.04 ], 'dark', [ 0, 0, 0 ], { bone: 'fuse' } ),
	p( 'octa', [ 0.12, 1.08, 0 ], [ 0.09, 0.12, 0.09 ], 'glow', [ 0, 0, 0 ], { emissive: 1, bone: 'fuse' } )
], { size: [ 0.7, 0.9, 0.7 ], tags: [ 'breakable', 'explosive' ], palette: { accent: '#b8261c', glow: '#ff7a1a' }, bones: [ { name: 'fuse', fx: { type: 'flicker', amp: 0.3 } } ] } );

PR( 'crate', 'Crate', [
	p( 'box', [ 0, 0.4, 0 ], [ 0.8, 0.8, 0.8 ], 'primary', [ 0, 0, 0 ], { shade: 1.1 } ),
	p( 'box', [ 0, 0.4, 0.41 ], [ 0.12, 0.82, 0.03 ], 'primary', [ 0, 0, 0.78 ], { shade: 0.7 } ),
	p( 'box', [ 0, 0.4, - 0.41 ], [ 0.12, 0.82, 0.03 ], 'primary', [ 0, 0, - 0.78 ], { shade: 0.7 } ),
	p( 'box', [ 0, 0.81, 0 ], [ 0.84, 0.04, 0.12 ], 'primary', [ 0, 0, 0 ], { shade: 0.7 } )
], { size: [ 0.8, 0.8, 0.8 ], tags: [ 'breakable' ] } );

PR( 'brazier', 'Brazier', [
	p( 'cyl', [ 0.22, 0.32, 0 ], [ 0.05, 0.7, 0.05 ], 'metal', [ 0, 0, 0.3 ] ),
	p( 'cyl', [ - 0.11, 0.32, 0.19 ], [ 0.05, 0.7, 0.05 ], 'metal', [ - 0.26, 0, - 0.15 ] ),
	p( 'cyl', [ - 0.11, 0.32, - 0.19 ], [ 0.05, 0.7, 0.05 ], 'metal', [ 0.26, 0, - 0.15 ] ),
	p( 'cone', [ 0, 0.72, 0 ], [ 0.62, 0.3, 0.62 ], 'metal', [ Math.PI, 0, 0 ] ),
	p( 'sphere', [ 0, 0.82, 0 ], [ 0.42, 0.12, 0.42 ], '#2a1a12' ),
	p( 'cone', [ 0, 0.18, 0 ], [ 0.36, 0.45, 0.36 ], 'glow', [ 0, 0, 0 ], { emissive: 1, bone: 'flame' } ),
	p( 'cone', [ 0.08, 0.12, 0.05 ], [ 0.2, 0.3, 0.2 ], '#fff0a0', [ 0, 0, 0 ], { emissive: 1, bone: 'flame' } )
], { size: [ 0.7, 1.2, 0.7 ], tags: [ 'light', 'fire' ], bones: [ { name: 'flame', pos: [ 0, 0.8, 0 ], fx: { type: 'flicker', amp: 0.25 } }, { name: 'flameState', parent: 'flame', fx: { type: 'state', states: { off: { scl: [ 0.01, 0.01, 0.01 ] } } } } ] } );

PR( 'torch', 'Wall torch', [
	p( 'cyl', [ 0, 0.8, 0 ], [ 0.07, 1.6, 0.07 ], 'primary', [ 0, 0, 0 ], { shade: 0.7 } ),
	p( 'cone', [ 0, 1.62, 0 ], [ 0.16, 0.14, 0.16 ], 'metal', [ Math.PI, 0, 0 ] ),
	p( 'cone', [ 0, 0.14, 0 ], [ 0.18, 0.32, 0.18 ], 'glow', [ 0, 0, 0 ], { emissive: 1, bone: 'flame' } ),
	p( 'cone', [ 0, 0.1, 0 ], [ 0.09, 0.2, 0.09 ], '#fff0a0', [ 0, 0, 0 ], { emissive: 1, bone: 'flame' } )
], { size: [ 0.3, 1.9, 0.3 ], tags: [ 'light', 'fire' ], bones: [ { name: 'flame', pos: [ 0, 1.66, 0 ], fx: { type: 'flicker', amp: 0.3 } } ] } );

PR( 'pillar', 'Pillar', [
	p( 'box', [ 0, 0.15, 0 ], [ 0.95, 0.3, 0.95 ], 'secondary', [ 0, 0, 0 ], { shade: 0.85 } ),
	p( 'cyl', [ 0, 1.6, 0 ], [ 0.65, 2.7, 0.65 ], 'secondary' ),
	p( 'box', [ 0, 3.05, 0 ], [ 0.95, 0.3, 0.95 ], 'secondary', [ 0, 0, 0 ], { shade: 0.85 } )
], { size: [ 1, 3.2, 1 ], tags: [ 'stone', 'solid' ] } );

PR( 'broken-pillar', 'Broken pillar', [
	p( 'box', [ 0, 0.15, 0 ], [ 0.95, 0.3, 0.95 ], 'secondary', [ 0, 0, 0 ], { shade: 0.85 } ),
	p( 'cyl', [ 0, 0.8, 0 ], [ 0.65, 1.1, 0.65 ], 'secondary' ),
	p( 'tetra', [ 0.05, 1.42, 0.05 ], [ 0.6, 0.35, 0.6 ], 'secondary', [ 0.2, 0.5, 0.1 ] ),
	p( 'cyl', [ 0.9, 0.3, 0.4 ], [ 0.6, 1.2, 0.6 ], 'secondary', [ 0, 0.4, 1.45 ], { shade: 0.9 } ),
	p( 'octa', [ - 0.6, 0.12, - 0.5 ], [ 0.35, 0.25, 0.3 ], 'secondary', [ 0, 0.6, 0 ], { shade: 0.8 } )
], { size: [ 1.6, 1.6, 1.2 ], tags: [ 'stone', 'solid' ] } );

PR( 'statue', 'Statue', [
	p( 'box', [ 0, 0.3, 0 ], [ 1.0, 0.6, 1.0 ], 'secondary', [ 0, 0, 0 ], { shade: 0.8 } ),
	p( 'cyl', [ 0, 1.15, 0 ], [ 0.5, 1.1, 0.34 ], 'secondary' ),
	p( 'cyl', [ 0, 1.95, 0 ], [ 0.6, 0.55, 0.36 ], 'secondary' ),
	p( 'sphere', [ 0, 2.45, 0.02 ], [ 0.3, 0.36, 0.3 ], 'secondary', [ 0, 0, 0 ], { shade: 1.1 } ),
	p( 'cyl', [ 0.38, 1.85, 0.12 ], [ 0.13, 0.7, 0.13 ], 'secondary', [ - 0.5, 0, - 0.2 ] ),
	p( 'cyl', [ - 0.38, 2.15, 0.0 ], [ 0.13, 0.7, 0.13 ], 'secondary', [ 0, 0, - 2.6 ] ),
	p( 'blade', [ - 0.55, 2.9, 0 ], [ 0.12, 1.0, 0.04 ], 'secondary', [ 0, 0, 0.1 ], { shade: 1.15 } )
], { size: [ 1, 3.4, 1 ], tags: [ 'stone', 'solid' ] } );

PR( 'shrine', 'Shrine', [
	p( 'cyl', [ 0, 0.1, 0 ], [ 1.5, 0.2, 1.5 ], 'secondary', [ 0, 0, 0 ], { shade: 0.85 } ),
	p( 'cyl', [ 0, 0.35, 0 ], [ 0.5, 0.5, 0.5 ], 'secondary' ),
	p( 'cone', [ 0.55, 0.6, 0.55 ], [ 0.18, 1.0, 0.18 ], 'secondary', [ 0, 0, 0 ], { shade: 0.9 } ),
	p( 'cone', [ - 0.55, 0.6, 0.55 ], [ 0.18, 1.0, 0.18 ], 'secondary', [ 0, 0, 0 ], { shade: 0.9 } ),
	p( 'cone', [ 0.55, 0.6, - 0.55 ], [ 0.18, 1.0, 0.18 ], 'secondary', [ 0, 0, 0 ], { shade: 0.9 } ),
	p( 'cone', [ - 0.55, 0.6, - 0.55 ], [ 0.18, 1.0, 0.18 ], 'secondary', [ 0, 0, 0 ], { shade: 0.9 } ),
	p( 'octa', [ 0, 0, 0 ], [ 0.32, 0.55, 0.32 ], 'glow', [ 0, 0, 0 ], { emissive: 1, bone: 'gem' } ),
	p( 'ring', [ 0, 0, 0 ], [ 0.7, 0.3, 0.7 ], 'glow', [ 0.3, 0, 0 ], { emissive: 0.6, bone: 'halo' } )
], { size: [ 1.5, 1.8, 1.5 ], tags: [ 'magic', 'interact' ], palette: { glow: '#6ad7ff' }, bones: [ { name: 'gem', pos: [ 0, 1.15, 0 ], fx: { type: 'bob', amp: 0.08, speed: 1.7 } }, { name: 'halo', parent: 'gem', fx: { type: 'spin', speed: 1.4 } } ] } );

PR( 'chest', 'Chest', [
	p( 'box', [ 0, 0.25, 0 ], [ 0.9, 0.5, 0.6 ], 'primary' ),
	p( 'box', [ 0, 0.25, 0 ], [ 0.94, 0.08, 0.64 ], 'metal' ),
	p( 'box', [ 0.32, 0.25, 0 ], [ 0.06, 0.52, 0.64 ], 'metal' ),
	p( 'box', [ - 0.32, 0.25, 0 ], [ 0.06, 0.52, 0.64 ], 'metal' ),
	p( 'cyl', [ 0, 0.06, 0.3 ], [ 0.9, 0.62, 0.36 ], 'primary', [ 0, 0, Math.PI / 2 ], { bone: 'lid', shade: 1.1 } ),
	p( 'box', [ 0, 0.06, 0.62 ], [ 0.12, 0.14, 0.05 ], 'accent', [ 0, 0, 0 ], { bone: 'lid', shine: true } )
], { size: [ 0.9, 0.8, 0.6 ], tags: [ 'interact', 'container' ], palette: { accent: '#e0b040' }, bones: [ { name: 'lid', pos: [ 0, 0.5, - 0.3 ], fx: { type: 'state', speed: 5, states: { open: { rot: [ - 1.9, 0, 0 ] } } } } ] } );

PR( 'stash', 'Stash', [
	p( 'box', [ 0, 0.3, 0 ], [ 1.3, 0.6, 0.8 ], 'primary' ),
	p( 'box', [ 0, 0.3, 0 ], [ 1.34, 0.1, 0.84 ], 'accent', [ 0, 0, 0 ], { shine: true } ),
	p( 'box', [ 0.5, 0.3, 0 ], [ 0.08, 0.62, 0.84 ], 'accent' ),
	p( 'box', [ - 0.5, 0.3, 0 ], [ 0.08, 0.62, 0.84 ], 'accent' ),
	p( 'cyl', [ 0, 0.08, 0.4 ], [ 1.3, 0.8, 0.46 ], 'primary', [ 0, 0, Math.PI / 2 ], { bone: 'lid', shade: 1.1 } ),
	p( 'octa', [ 0, 0.12, 0.82 ], [ 0.14, 0.18, 0.06 ], 'glow', [ 0, 0, 0 ], { bone: 'lid', emissive: 0.8 } )
], { size: [ 1.3, 1, 0.8 ], tags: [ 'interact', 'container' ], palette: { accent: '#e0b040', glow: '#6ad7ff', primary: '#5a3a24' }, bones: [ { name: 'lid', pos: [ 0, 0.6, - 0.4 ], fx: { type: 'state', speed: 5, states: { open: { rot: [ - 1.8, 0, 0 ] } } } } ] } );

PR( 'portal', 'Portal', [
	p( 'cyl', [ 0, 0.08, 0 ], [ 2.4, 0.16, 1.0 ], 'secondary', [ 0, 0, 0 ], { shade: 0.8 } ),
	p( 'ring', [ 0, 0, 0 ], [ 2.4, 2.0, 2.4 ], 'secondary', [ Math.PI / 2, 0, 0 ], { bone: 'arch' } ),
	p( 'disc', [ 0, 0, 0 ], [ 2.05, 0.3, 2.05 ], 'glow', [ Math.PI / 2, 0, 0 ], { emissive: 1, bone: 'swirl' } ),
	p( 'disc', [ 0, 0, 0.04 ], [ 1.2, 0.3, 1.2 ], '#ffffff', [ Math.PI / 2, 0, 0 ], { emissive: 0.8, bone: 'swirl2' } ),
	p( 'octa', [ 0, 1.3, 0 ], [ 0.22, 0.3, 0.22 ], 'glow', [ 0, 0, 0 ], { emissive: 1, bone: 'arch' } )
], { size: [ 2.4, 2.6, 0.8 ], tags: [ 'magic', 'interact', 'exit' ], palette: { glow: '#7a5aff' }, bones: [
	{ name: 'arch', pos: [ 0, 1.3, 0 ] }, { name: 'swirl', parent: 'arch', fx: { type: 'spin', axis: 'z', speed: 1.8 } }, { name: 'swirl2', parent: 'arch', fx: { type: 'pulse', amp: 0.12, speed: 3 } } ] } );

PR( 'pylon', 'Pylon', [
	p( 'box', [ 0, 0.15, 0 ], [ 0.8, 0.3, 0.8 ], 'metal' ),
	p( 'cone', [ 0, 1.1, 0 ], [ 0.5, 1.8, 0.5 ], 'metal', [ 0, 0, 0 ], { shade: 0.8 } ),
	p( 'ring', [ 0, 0.9, 0 ], [ 0.62, 0.4, 0.62 ], 'accent' ),
	p( 'octa', [ 0, 0, 0 ], [ 0.3, 0.5, 0.3 ], 'glow', [ 0, 0, 0 ], { emissive: 1, bone: 'core' } )
], { size: [ 0.8, 2.6, 0.8 ], tags: [ 'lightning', 'mechanic' ], palette: { glow: '#7ad7ff', accent: '#ffe45a' }, bones: [ { name: 'core', pos: [ 0, 2.3, 0 ], fx: { type: 'spin', speed: 2.5 } } ] } );

PR( 'spike-trap', 'Spike trap', [
	p( 'box', [ 0, 0.04, 0 ], [ 1.6, 0.08, 1.6 ], 'metal', [ 0, 0, 0 ], { shade: 0.7 } ),
	...[ [ - 0.45, - 0.45 ], [ 0, - 0.45 ], [ 0.45, - 0.45 ], [ - 0.45, 0 ], [ 0, 0 ], [ 0.45, 0 ], [ - 0.45, 0.45 ], [ 0, 0.45 ], [ 0.45, 0.45 ] ].map( ( [ x, z ] ) => p( 'spike', [ x, 0.1, z ], [ 0.14, 0.5, 0.14 ], 'metal', [ 0, 0, 0 ], { bone: 'spikes', shine: true } ) )
], { size: [ 1.6, 0.6, 1.6 ], tags: [ 'hazard', 'mechanic' ], bones: [ { name: 'spikes', pos: [ 0, - 0.3, 0 ], fx: { type: 'state', speed: 18, states: { up: { off: [ 0, 0.35, 0 ] } } } } ] } );

PR( 'anvil', 'Anvil', [
	p( 'cyl', [ 0, 0.25, 0 ], [ 0.5, 0.5, 0.5 ], 'primary', [ 0, 0, 0 ], { shade: 0.8 } ),
	p( 'box', [ 0, 0.58, 0 ], [ 0.26, 0.16, 0.22 ], 'metal' ),
	p( 'box', [ 0, 0.72, 0 ], [ 0.5, 0.12, 0.26 ], 'metal', [ 0, 0, 0 ], { shine: true } ),
	p( 'cone', [ 0.36, 0.72, 0 ], [ 0.14, 0.26, 0.12 ], 'metal', [ 0, 0, - Math.PI / 2 ], { shine: true } )
], { size: [ 0.8, 0.8, 0.5 ], tags: [ 'town', 'solid' ] } );

PR( 'market-stall', 'Market stall', [
	...[ [ - 0.9, - 0.5 ], [ 0.9, - 0.5 ], [ - 0.9, 0.5 ], [ 0.9, 0.5 ] ].map( ( [ x, z ] ) => p( 'cyl', [ x, 1.0, z ], [ 0.08, 2.0, 0.08 ], 'primary' ) ),
	p( 'box', [ 0, 0.8, 0.2 ], [ 1.9, 0.08, 0.8 ], 'primary', [ 0, 0, 0 ], { shade: 1.15 } ),
	p( 'box', [ 0, 0.42, 0.55 ], [ 1.9, 0.75, 0.05 ], 'primary', [ 0, 0, 0 ], { shade: 0.8 } ),
	p( 'wedge', [ 0, 2.12, 0.05 ], [ 2.1, 0.35, 1.4 ], 'accent', [ 0, Math.PI, 0 ] ),
	p( 'sphere', [ - 0.5, 0.92, 0.2 ], [ 0.25, 0.18, 0.25 ], '#d9822b' ),
	p( 'sphere', [ - 0.2, 0.92, 0.3 ], [ 0.2, 0.16, 0.2 ], '#c94a3a' ),
	p( 'box', [ 0.4, 0.95, 0.2 ], [ 0.3, 0.22, 0.25 ], '#6a8a3a' ),
	p( 'cyl', [ 0.75, 0.95, 0.25 ], [ 0.16, 0.25, 0.16 ], '#e0b040' )
], { size: [ 2, 2.3, 1.2 ], tags: [ 'town', 'solid' ], palette: { accent: '#b8402e' } } );

PR( 'banner', 'Banner', [
	p( 'cyl', [ 0, 1.4, 0 ], [ 0.07, 2.8, 0.07 ], 'metal' ),
	p( 'cyl', [ 0, 2.7, 0 ], [ 0.05, 0.9, 0.05 ], 'metal', [ 0, 0, Math.PI / 2 ] ),
	p( 'box', [ 0, - 0.5, 0 ], [ 0.8, 1.0, 0.03 ], 'accent', [ 0, 0, 0 ], { bone: 'cloth' } ),
	p( 'wedge', [ 0, - 1.12, 0 ], [ 0.8, 0.03, 0.25 ], 'accent', [ - Math.PI / 2, 0, 0 ], { bone: 'cloth', shade: 0.85 } ),
	p( 'octa', [ 0, - 0.45, 0.025 ], [ 0.25, 0.3, 0.02 ], 'glow', [ 0, 0, 0 ], { bone: 'cloth', emissive: 0.3 } )
], { size: [ 0.9, 2.9, 0.3 ], tags: [ 'town', 'decor' ], palette: { glow: '#ffd23f' }, bones: [ { name: 'cloth', pos: [ 0, 2.68, 0 ], fx: { type: 'sway', amp: 0.18, speed: 1.4 } } ] } );

PR( 'rock', 'Rock', [
	p( 'octa', [ 0, 0.35, 0 ], [ 1.1, 0.8, 0.9 ], 'secondary', [ 0.2, 0.5, 0.1 ] ),
	p( 'tetra', [ 0.45, 0.2, 0.3 ], [ 0.6, 0.5, 0.6 ], 'secondary', [ 0.3, 1.2, 0 ], { shade: 0.85 } ),
	p( 'octa', [ - 0.4, 0.15, - 0.35 ], [ 0.5, 0.35, 0.45 ], 'secondary', [ 0, 0.9, 0.2 ], { shade: 0.9 } )
], { size: [ 1.4, 0.8, 1.2 ], tags: [ 'stone', 'solid', 'nature' ] } );

PR( 'crystal', 'Crystal cluster', [
	p( 'octa', [ 0, 0.6, 0 ], [ 0.4, 1.3, 0.4 ], 'glow', [ 0.1, 0, 0.1 ], { emissive: 0.8 } ),
	p( 'octa', [ 0.3, 0.35, 0.15 ], [ 0.25, 0.8, 0.25 ], 'glow', [ 0.2, 0, - 0.5 ], { emissive: 0.6 } ),
	p( 'octa', [ - 0.25, 0.3, - 0.1 ], [ 0.22, 0.7, 0.22 ], 'glow', [ - 0.2, 0, 0.6 ], { emissive: 0.6 } ),
	p( 'octa', [ 0, 0.08, 0 ], [ 0.8, 0.2, 0.7 ], 'secondary', [ 0, 0.4, 0 ] )
], { size: [ 0.9, 1.3, 0.9 ], tags: [ 'magic', 'light', 'crystal' ], palette: { glow: '#9a6aff' } } );

PR( 'bones', 'Bone pile', [
	p( 'sphere', [ 0.1, 0.12, 0.05 ], [ 0.22, 0.2, 0.25 ], 'skin' ),
	p( 'box', [ 0.1, 0.07, 0.17 ], [ 0.14, 0.06, 0.1 ], 'skin', [ 0, 0, 0 ], { shade: 0.85 } ),
	p( 'cyl', [ - 0.2, 0.05, - 0.1 ], [ 0.05, 0.5, 0.05 ], 'skin', [ Math.PI / 2, 0.6, 0 ] ),
	p( 'cyl', [ 0.15, 0.04, - 0.25 ], [ 0.05, 0.45, 0.05 ], 'skin', [ Math.PI / 2, - 0.9, 0 ] ),
	p( 'ring', [ - 0.3, 0.1, 0.25 ], [ 0.3, 0.6, 0.2 ], 'skin', [ 0.3, 0.4, 1.2 ] )
], { size: [ 0.8, 0.3, 0.8 ], tags: [ 'decor', 'undead' ] } );

PR( 'tree', 'Tree', [
	p( 'cyl', [ 0, 0.9, 0 ], [ 0.32, 1.8, 0.32 ], 'primary', [ 0, 0, 0 ], { shade: 0.75 } ),
	p( 'cone', [ 0, 1.0, 0 ], [ 2.2, 1.6, 2.2 ], '#3f6a34', [ 0, 0, 0 ], { bone: 'crown' } ),
	p( 'cone', [ 0, 1.85, 0 ], [ 1.7, 1.4, 1.7 ], '#4a7a3a', [ 0, 0.5, 0 ], { bone: 'crown' } ),
	p( 'cone', [ 0, 2.6, 0 ], [ 1.1, 1.1, 1.1 ], '#5a8a42', [ 0, 1, 0 ], { bone: 'crown' } )
], { size: [ 1, 4, 1 ], tags: [ 'nature', 'solid' ], bones: [ { name: 'crown', pos: [ 0, 1.0, 0 ], fx: { type: 'sway', amp: 0.04, speed: 0.8 } } ] } );

PR( 'lamp', 'Lamp post', [
	p( 'cyl', [ 0, 1.3, 0 ], [ 0.1, 2.6, 0.1 ], 'metal' ),
	p( 'box', [ 0, 0.08, 0 ], [ 0.4, 0.16, 0.4 ], 'metal', [ 0, 0, 0 ], { shade: 0.8 } ),
	p( 'box', [ 0, 2.75, 0 ], [ 0.3, 0.36, 0.3 ], 'glow', [ 0, 0, 0 ], { emissive: 1 } ),
	p( 'cone', [ 0, 3.03, 0 ], [ 0.46, 0.22, 0.46 ], 'metal' )
], { size: [ 0.5, 3.2, 0.5 ], tags: [ 'town', 'light' ], palette: { glow: '#ffd27a' } } );

PR( 'door', 'Door', [
	p( 'box', [ - 0.85, 1.25, 0 ], [ 0.3, 2.5, 0.4 ], 'secondary' ),
	p( 'box', [ 0.85, 1.25, 0 ], [ 0.3, 2.5, 0.4 ], 'secondary' ),
	p( 'box', [ 0, 2.6, 0 ], [ 2.0, 0.3, 0.42 ], 'secondary', [ 0, 0, 0 ], { shade: 0.9 } ),
	p( 'box', [ 0.7, 1.15, 0 ], [ 1.4, 2.3, 0.1 ], 'primary', [ 0, 0, 0 ], { bone: 'leaf' } ),
	p( 'box', [ 0.7, 1.7, 0.06 ], [ 1.42, 0.08, 0.04 ], 'metal', [ 0, 0, 0 ], { bone: 'leaf' } ),
	p( 'box', [ 0.7, 0.6, 0.06 ], [ 1.42, 0.08, 0.04 ], 'metal', [ 0, 0, 0 ], { bone: 'leaf' } ),
	p( 'ring', [ 1.2, 1.15, 0.08 ], [ 0.14, 0.4, 0.14 ], 'accent', [ Math.PI / 2, 0, 0 ], { bone: 'leaf' } )
], { size: [ 2, 2.75, 0.4 ], tags: [ 'interact', 'solid' ], palette: { accent: '#e0b040' }, bones: [ { name: 'leaf', pos: [ - 0.7, 0, 0 ], fx: { type: 'state', speed: 4, states: { open: { rot: [ 0, - 1.6, 0 ] } } } } ] } );

PR( 'waypoint', 'Waypoint obelisk', [
	p( 'cyl', [ 0, 0.12, 0 ], [ 1.6, 0.24, 1.6 ], 'secondary', [ 0, 0, 0 ], { shade: 0.8 } ),
	p( 'cone', [ 0, 1.4, 0 ], [ 0.7, 2.6, 0.7 ], 'secondary' ),
	p( 'box', [ 0, 1.2, 0.2 ], [ 0.12, 0.7, 0.05 ], 'glow', [ 0, 0, 0 ], { emissive: 0.9 } ),
	p( 'ring', [ 0, 0, 0 ], [ 1.4, 0.3, 1.4 ], 'glow', [ 0, 0, 0 ], { emissive: 0.8, bone: 'ring' } )
], { size: [ 1.6, 2.8, 1.6 ], tags: [ 'interact', 'magic' ], palette: { glow: '#5ad1ff' }, bones: [ { name: 'ring', pos: [ 0, 1.1, 0 ], fx: { type: 'spin', speed: 0.9 } }, { name: 'ringBob', parent: 'ring', fx: { type: 'bob', amp: 0.15, speed: 1.2 } } ] } );

PR( 'dummy', 'Training dummy', [
	p( 'cyl', [ 0, 0.3, 0 ], [ 0.1, 0.6, 0.1 ], 'primary', [ 0, 0, 0 ], { shade: 0.8 } ),
	p( 'cyl', [ 0, 0.08, 0 ], [ 0.6, 0.16, 0.6 ], 'primary', [ 0, 0, 0 ], { shade: 0.6 } ),
	p( 'capsule', [ 0, 0.55, 0 ], [ 0.48, 0.9, 0.38 ], '#c8a868', [ 0, 0, 0 ], { bone: 'body' } ),
	p( 'sphere', [ 0, 1.15, 0 ], [ 0.32, 0.34, 0.32 ], '#c8a868', [ 0, 0, 0 ], { bone: 'body', shade: 1.1 } ),
	p( 'cyl', [ 0, 0.75, 0 ], [ 0.07, 1.1, 0.07 ], 'primary', [ 0, 0, Math.PI / 2 ], { bone: 'body' } ),
	p( 'ring', [ 0, 0.55, 0.0 ], [ 0.5, 0.3, 0.4 ], 'accent', [ 0, 0, 0 ], { bone: 'body' } ),
	p( 'disc', [ 0, 0.6, 0.2 ], [ 0.22, 0.4, 0.22 ], 'accent', [ Math.PI / 2, 0, 0 ], { bone: 'body' } )
], { size: [ 0.6, 1.5, 0.6 ], tags: [ 'town', 'interact' ], palette: { accent: '#b8261c' }, bones: [ { name: 'body', pos: [ 0, 0.55, 0 ], fx: { type: 'wobble' } } ] } );

// --- loot (drawn bobbing and turning on the ground) ------------------------------------------------

const LT = ( id, name, parts, extra = {} ) => M( { id, name, type: 'loot', tags: [ 'loot', ...( extra.tags || [] ) ], palette: { ...PROP_PALETTE, ...( extra.palette || {} ) }, parts, ...extra } );

LT( 'bag', 'Loot bag', [
	p( 'sphere', [ 0, 0.15, 0 ], [ 0.32, 0.3, 0.3 ], '#8a6a42' ),
	p( 'cone', [ 0, 0.33, 0 ], [ 0.14, 0.12, 0.14 ], '#8a6a42', [ 0, 0, 0 ], { shade: 0.85 } ),
	p( 'ring', [ 0, 0.29, 0 ], [ 0.16, 0.3, 0.16 ], 'accent' )
], { palette: { accent: '#e0b040' } } );

LT( 'coins', 'Gold', [
	p( 'disc', [ 0, 0.03, 0 ], [ 0.2, 0.4, 0.2 ], 'accent', [ 0, 0, 0 ], { shine: true } ),
	p( 'disc', [ 0.12, 0.05, 0.05 ], [ 0.2, 0.4, 0.2 ], 'accent', [ 0.3, 0, 0.2 ], { shine: true } ),
	p( 'disc', [ - 0.06, 0.08, - 0.08 ], [ 0.2, 0.4, 0.2 ], 'accent', [ - 0.2, 0, 0.4 ], { shine: true } ),
	p( 'disc', [ 0.02, 0.1, 0.02 ], [ 0.2, 0.4, 0.2 ], 'accent', [ 0.1, 0, - 0.3 ], { shine: true, emissive: 0.3 } )
], { palette: { accent: '#f2c12e' } } );

LT( 'ring', 'Ring', [
	p( 'ring', [ 0, 0.1, 0 ], [ 0.16, 0.4, 0.16 ], 'accent', [ Math.PI / 2, 0, 0 ], { shine: true } ),
	p( 'octa', [ 0, 0.18, 0 ], [ 0.06, 0.06, 0.06 ], 'glow', [ 0, 0, 0 ], { emissive: 0.8 } )
], { palette: { accent: '#e8c860' } } );

LT( 'amulet', 'Amulet', [
	p( 'ring', [ 0, 0.18, 0 ], [ 0.22, 0.15, 0.22 ], 'metal', [ Math.PI / 2, 0, 0 ] ),
	p( 'disc', [ 0, 0.05, 0 ], [ 0.14, 0.5, 0.14 ], 'accent', [ Math.PI / 2, 0, 0 ], { shine: true } ),
	p( 'octa', [ 0, 0.05, 0.02 ], [ 0.07, 0.07, 0.04 ], 'glow', [ 0, 0, 0 ], { emissive: 0.9 } )
], { palette: { accent: '#e8c860' } } );

LT( 'potion', 'Potion', [
	p( 'sphere', [ 0, 0.11, 0 ], [ 0.2, 0.2, 0.2 ], 'glow', [ 0, 0, 0 ], { emissive: 0.6 } ),
	p( 'cyl', [ 0, 0.24, 0 ], [ 0.07, 0.1, 0.07 ], '#c8d8e0' ),
	p( 'cyl', [ 0, 0.3, 0 ], [ 0.06, 0.05, 0.06 ], '#8a6a42' )
], { palette: { glow: '#ff3040' } } );

LT( 'rune', 'Rune', [
	p( 'box', [ 0, 0.12, 0 ], [ 0.22, 0.26, 0.06 ], 'secondary' ),
	p( 'box', [ 0, 0.13, 0.032 ], [ 0.04, 0.18, 0.01 ], 'glow', [ 0, 0, 0 ], { emissive: 1 } ),
	p( 'box', [ 0, 0.16, 0.032 ], [ 0.13, 0.03, 0.01 ], 'glow', [ 0, 0, 0.5 ], { emissive: 1 } )
], { palette: { glow: '#9a6aff' } } );

LT( 'gem', 'Gem', [
	p( 'octa', [ 0, 0.12, 0 ], [ 0.14, 0.2, 0.14 ], 'glow', [ 0, 0, 0 ], { emissive: 0.8, shine: true } )
], { palette: { glow: '#5ef08a' } } );

LT( 'scroll', 'Scroll', [
	p( 'cyl', [ 0, 0.06, 0 ], [ 0.1, 0.32, 0.1 ], '#f0e6c8', [ 0, 0, Math.PI / 2 ] ),
	p( 'ring', [ 0, 0.06, 0 ], [ 0.12, 0.3, 0.12 ], 'accent', [ 0, 0, Math.PI / 2 ] )
], { palette: { accent: '#b8261c' } } );

LT( 'helm', 'Helm', [
	p( 'sphere', [ 0, 0.14, 0 ], [ 0.3, 0.26, 0.32 ], 'metal', [ 0, 0, 0 ], { shine: true } ),
	p( 'cyl', [ 0, 0.06, 0 ], [ 0.32, 0.06, 0.34 ], 'metal', [ 0, 0, 0 ], { shade: 0.8 } ),
	p( 'box', [ 0, 0.25, 0 ], [ 0.03, 0.1, 0.26 ], 'glow', [ 0, 0, 0 ], { emissive: 0.4 } )
] );
LT( 'armor', 'Body armour', [
	p( 'cyl', [ 0, 0.2, 0 ], [ 0.42, 0.36, 0.26 ], 'metal', [ 0, 0, 0 ], { shine: true } ),
	p( 'sphere', [ 0.22, 0.34, 0 ], [ 0.16, 0.12, 0.16 ], 'metal', [ 0, 0, 0 ], { shade: 0.85 } ),
	p( 'sphere', [ - 0.22, 0.34, 0 ], [ 0.16, 0.12, 0.16 ], 'metal', [ 0, 0, 0 ], { shade: 0.85 } ),
	p( 'octa', [ 0, 0.22, 0.13 ], [ 0.07, 0.08, 0.03 ], 'glow', [ 0, 0, 0 ], { emissive: 0.5 } )
] );
LT( 'boots', 'Boots', [
	p( 'box', [ 0.08, 0.1, 0 ], [ 0.1, 0.2, 0.12 ], 'primary' ),
	p( 'box', [ 0.08, 0.03, 0.06 ], [ 0.1, 0.06, 0.22 ], 'primary', [ 0, 0, 0 ], { shade: 0.8 } ),
	p( 'box', [ - 0.08, 0.1, 0 ], [ 0.1, 0.2, 0.12 ], 'primary' ),
	p( 'box', [ - 0.08, 0.03, 0.06 ], [ 0.1, 0.06, 0.22 ], 'primary', [ 0, 0, 0 ], { shade: 0.8 } )
] );
LT( 'gloves', 'Gloves', [
	p( 'box', [ 0.08, 0.06, 0 ], [ 0.1, 0.12, 0.08 ], 'primary' ),
	p( 'cyl', [ 0.08, 0.15, 0 ], [ 0.1, 0.08, 0.1 ], 'metal' ),
	p( 'box', [ - 0.08, 0.06, 0 ], [ 0.1, 0.12, 0.08 ], 'primary' ),
	p( 'cyl', [ - 0.08, 0.15, 0 ], [ 0.1, 0.08, 0.1 ], 'metal' )
] );
LT( 'belt', 'Belt', [
	p( 'ring', [ 0, 0.05, 0 ], [ 0.32, 0.4, 0.26 ], '#4a3324' ),
	p( 'box', [ 0, 0.05, 0.13 ], [ 0.07, 0.06, 0.02 ], 'accent', [ 0, 0, 0 ], { shine: true } )
], { palette: { accent: '#e0b040' } } );
LT( 'shield', 'Shield', [
	p( 'disc', [ 0, 0.06, 0 ], [ 0.5, 0.6, 0.5 ], 'accent' ),
	p( 'sphere', [ 0, 0.1, 0 ], [ 0.12, 0.06, 0.12 ], 'metal' ),
	p( 'ring', [ 0, 0.06, 0 ], [ 0.52, 0.4, 0.52 ], 'metal' )
] );

// --- creatures with fixed designs ----------------------------------------------------------------
// model = { type: 'creature', id: 'husk', seed } -> this genome, mutated a little per seed.

M( { id: 'husk', name: 'Husk', type: 'creature', tags: [ 'undead' ], genome: {
	plan: 'biped', size: 1, seed: 4242, tags: [ 'undead' ],
	body: { length: 1.0, girth: 0.9, legLen: 0.95, legThick: 0.8, armLen: 1.25, armThick: 0.85, neckLen: 0.2, headSize: 1.05, tailLen: 0, hunch: 0.6, taper: 0.1, limbs: 1 },
	parts: { torso: { id: 'skeletal', s: 1, v: 0 }, legs: { id: 'bony', s: 1, v: 0 }, arms: { id: 'claws', s: 1, v: 0 }, head: { id: 'skull', s: 1, v: 0 }, eyes: { id: 'pair', s: 1, v: 0 }, extra: [ { id: 'chains', s: 1, v: 0 } ] },
	palette: { id: 'grave', primary: '#5d6660', secondary: '#33392f', accent: '#a9c7a0', skin: '#cfc6ae', metal: '#6c726b', glow: '#88ffb0', dark: '#131612' },
	pattern: 'solid', gait: { style: 'biped', stride: 0.9, cadence: 0.9, bounce: 1.3, posture: 0.3, digi: false, fly: false },
	personality: { fidget: 0.7, aggression: 0.8, twitch: 0.8, idle: 'twitchy' }
} } );

// --- NPCs ------------------------------------------------------------------------------------------
// NPC defs hold a humanoid look; the town places them with model = { type: 'npc', id }.

const NPC = ( id, name, look, extra = {} ) => M( { id, name, type: 'npc', tags: [ 'npc', 'town' ], look, ...extra } );

NPC( 'blacksmith', 'Blacksmith', {
	height: 1.04, girth: 1.3, headSize: 1.05, hair: 'bald', beard: true,
	colors: { shirt: '#7a3a24', pants: '#3a2e26', skin: '#d9a07a', shoes: '#2a211a', hair: '#5a3a24', accent: '#e0b040', metal: '#8a8f99' },
	outfit: [ 'apron', 'belt', 'boots', 'gloves', 'bracers' ], tool: 'hammer'
}, { emote: 'hammer' } );

NPC( 'merchant', 'Merchant', {
	height: 0.98, girth: 1.15, headSize: 1.05, hair: 'short', beard: true,
	colors: { shirt: '#2e6b5e', pants: '#6b2e5e', skin: '#c99a72', shoes: '#3a2a20', hair: '#2a1a12', accent: '#e8c860', glow: '#ffd27a' },
	outfit: [ 'turban', 'robe', 'belt', 'bag' ], tool: 'ledger'
}, { emote: 'count' } );

NPC( 'mystic', 'Mystic', {
	height: 1.0, girth: 0.9, headSize: 1.0, hair: 'long',
	colors: { shirt: '#4a2e6b', pants: '#2f1f40', skin: '#e8c8b0', shoes: '#1a1220', hair: '#d8d0e0', accent: '#c08aff', glow: '#b07aff', cape: '#3a2456' },
	outfit: [ 'robe', 'hood', 'belt' ], tool: 'staff'
}, { emote: 'meditate' } );

NPC( 'guard', 'Guard', {
	height: 1.06, girth: 1.12, headSize: 1.0, hair: 'short',
	colors: { shirt: '#2e4a7a', pants: '#2a2f3a', skin: '#e0b090', shoes: '#22252b', hair: '#3a2a1c', accent: '#ffd23f', metal: '#a8b0b8', cape: '#2e4a7a' },
	outfit: [ 'plate', 'helmet', 'pauldrons', 'belt', 'boots', 'cape' ], tool: 'spear'
}, { emote: 'idle_look' } );

NPC( 'townsfolk', 'Townsfolk', null, { emote: 'talk', random: true } );

// Seeded townsfolk look: hair, outfit pieces, colours and a chore.
export function townsfolkLook( seed ) {

	let s = ( seed >>> 0 ) || 1;
	const rnd = () => ( ( s = Math.imul( s ^ ( s >>> 15 ), 0x2c1b3c6d ) + 0x6d2b79f5 | 0 ), ( ( s >>> 0 ) % 10000 ) / 10000 );
	const pick = ( a ) => a[ Math.floor( rnd() * a.length ) ];
	const shirts = [ '#a83a2a', '#3a6a8a', '#6a8a3a', '#c8a050', '#7a4a8a', '#d8d0c0', '#4a4a52', '#b86a3a' ];
	const pants = [ '#3a2e26', '#2a3a52', '#5a5048', '#6a5a3a', '#2a2a2e' ];
	const skins = [ '#f7d1b3', '#e0b090', '#c99a72', '#a87452', '#7a5238', '#f0c8a0' ];
	const hairs = [ '#2a1a12', '#5a3a24', '#8a6a3a', '#d8c090', '#a83a1a', '#c8c8c8', '#1a1a1a' ];
	const outfit = [ 'belt' ];
	if ( rnd() < 0.3 ) outfit.push( 'apron' );
	if ( rnd() < 0.25 ) outfit.push( 'hat' );
	if ( rnd() < 0.2 ) outfit.push( 'scarf' );
	if ( rnd() < 0.3 ) outfit.push( 'skirt' );
	if ( rnd() < 0.3 ) outfit.push( 'bag' );
	const chore = pick( [ null, null, 'broom', 'lantern', null ] );
	return {
		look: {
			height: 0.9 + rnd() * 0.16, girth: 0.88 + rnd() * 0.3, headSize: 0.95 + rnd() * 0.12,
			hair: pick( [ 'short', 'long', 'bald', 'pony', 'bun', 'short' ] ), beard: rnd() < 0.25,
			colors: { shirt: pick( shirts ), pants: pick( pants ), skin: pick( skins ), hair: pick( hairs ), shoes: '#2a211a', accent: pick( shirts ) },
			outfit, tool: chore
		},
		emote: chore === 'broom' ? 'sweep' : pick( [ 'talk', 'idle_look', 'talk', 'wave', 'count' ] )
	};

}

export { D };
