// Themes - the look of a level as DATA. The level renderer, the prop placer and
// the lighting rig read these; nothing about a theme is code, so an agent can
// invent a new biome with one define() call:
//
//   define( 'theme', {
//     id, name, tags, generator,        default layout generator ( 'dungeon' | 'caves' )
//     families: [ tags ],               monster family tags the director should prefer
//     palette: { primary secondary accent skin metal glow dark },   part-list colour keys for props
//     floor: [ styles ],                one per layout.style code (see STYLE below):
//                                       { color, tiles (stones per tile edge), grout, noise, gloss }
//     wall: { color, top, mass, height, pattern: rock|brick|panel|hedge|hex|crystal, jag },
//     liquid: { water, lava, ice, pit },
//     features: { pools, lava, chasm, ice },   0..1 amounts of terrain features the finisher adds
//     props: [ { model, where: wall|corner|open|corridor, density (per 100 floor tiles), scale:[a,b], solid } ],
//     pillar: model id for room columns,
//     lights: { model, kind, color, intensity, range, spacing (tiles), flicker, height },
//     glow: { on: 'lava' | model id, color, intensity, range } [],   extra light sources
//     lighting: { sky, ground, hemi, sun, sunColor, sunDir: [x,y,z], exposure, player: { color, intensity, range } },
//     fog: { color, near, far },  sky: { top, bottom, stars },  post: { bloom, saturation, contrast, vignette, tint }
//   } )
//
// paletteShift() recolours a theme deterministically (hue / saturation / lightness),
// which is how endless depths get "the same caves, a different mood".

import { define, get, all } from '../../core/registry.js';

// layout.style codes (Uint8Array per tile) -> theme.floor[ code ]
export const STYLE = { BASE: 0, ROOM: 1, ORNATE: 2, ROAD: 3, GRASS: 4, DIRT: 5, PLAZA: 6, EDGE: 7 };

const F = ( color, tiles = 1, grout = 0.5, noise = 0.35, gloss = 0.1 ) => ( { color, tiles, grout, noise, gloss } );

define( 'theme', {
	id: 'ember-quarry', name: 'Ember Quarry', tags: [ 'fire', 'rock', 'warm' ], generator: 'caves',
	families: [ 'fire', 'beast', 'miner' ],
	palette: { primary: '#8a5a3a', secondary: '#4a3424', accent: '#ff8a2a', skin: '#b08060', metal: '#6a6460', glow: '#ff7a1a', dark: '#1e1410' },
	floor: [ F( '#5c4a3a', 0, 0, 0.55 ), F( '#66503c', 2, 0.35, 0.45 ), F( '#6e5640', 3, 0.6, 0.3 ), F( '#6a5a48', 3, 0.5, 0.3 ) ],
	wall: { color: '#6e4c34', top: '#8a6448', mass: '#2a1c14', height: 2.4, pattern: 'rock', jag: 0.5 },
	liquid: { water: '#2a3a40', lava: '#ff5a10', ice: '#a8c8e0', pit: '#120a06' },
	features: { lava: 0.15 },
	props: [
		{ model: 'prop-rubble', where: 'wall', density: 3 }, { model: 'prop-support', where: 'wall', density: 1.2 },
		{ model: 'prop-crate', where: 'corner', density: 1.2 }, { model: 'prop-ore', where: 'wall', density: 1, glow: true },
		{ model: 'prop-cart', where: 'open', density: 0.25, solid: true }, { model: 'prop-rock', where: 'open', density: 0.5, solid: true }
	],
	pillar: 'prop-rock-pillar',
	lights: { model: 'prop-torch', kind: 'torch', color: '#ffa04a', intensity: 34, range: 13, spacing: 7, flicker: 0.35, height: 2.1 },
	glow: [ { on: 'lava', color: '#ff6a1a', intensity: 20, range: 9 }, { on: 'prop-ore', color: '#ff8a30', intensity: 6, range: 5 } ],
	lighting: { sky: '#8a6a58', ground: '#2a1a12', hemi: 0.9, sun: 1.4, sunColor: '#ffbf8a', sunDir: [ 0.45, 1, 0.3 ], exposure: 1.05, player: { color: '#ffb070', intensity: 10, range: 9 } },
	fog: { color: '#22140c', near: 20, far: 52 }, sky: { top: '#1a0e08', bottom: '#3a2214', stars: 0 },
	post: { bloom: 0.7, saturation: 1.05, contrast: 1.05, vignette: 0.35, tint: '#fff0e0' }
} );

define( 'theme', {
	id: 'sunken-crypt', name: 'Sunken Crypt', tags: [ 'undead', 'water', 'stone' ], generator: 'dungeon',
	families: [ 'undead', 'skeleton', 'drowned' ],
	palette: { primary: '#5a6a68', secondary: '#3a4644', accent: '#7fe0c0', skin: '#a8b0a0', metal: '#5a6a70', glow: '#6affd0', dark: '#101816' },
	floor: [ F( '#3e4a48', 2, 0.6, 0.3 ), F( '#46524f', 2, 0.55, 0.25, 0.25 ), F( '#4e5c5a', 3, 0.7, 0.2, 0.3 ), F( '#46524f', 2, 0.5, 0.3 ) ],
	wall: { color: '#4c5a58', top: '#66746f', mass: '#121a19', height: 2.8, pattern: 'brick', jag: 0 },
	liquid: { water: '#1c4440', lava: '#ff6a20', ice: '#a8d0e0', pit: '#050a0a' },
	features: { pools: 0.35 },
	props: [
		{ model: 'prop-sarcophagus', where: 'wall', density: 1.2, solid: false }, { model: 'prop-urn', where: 'corner', density: 1.6 },
		{ model: 'prop-bones', where: 'wall', density: 2 }, { model: 'prop-tombstone', where: 'open', density: 0.5 },
		{ model: 'prop-broken-pillar', where: 'open', density: 0.35, solid: true }
	],
	pillar: 'prop-pillar',
	lights: { model: 'prop-torch', kind: 'torch', color: '#b8f4e4', intensity: 24, range: 12, spacing: 8, flicker: 0.2, height: 2.3 },
	glow: [],
	lighting: { sky: '#6a8a90', ground: '#141c1c', hemi: 0.75, sun: 0.9, sunColor: '#a8d8e0', sunDir: [ - 0.3, 1, 0.4 ], exposure: 1.1, player: { color: '#d0fff0', intensity: 8, range: 9 } },
	fog: { color: '#081412', near: 18, far: 46 }, sky: { top: '#020606', bottom: '#0c1c1a', stars: 0 },
	post: { bloom: 0.6, saturation: 0.9, contrast: 1.08, vignette: 0.45, tint: '#e0fff8' }
} );

define( 'theme', {
	id: 'gloom-catacombs', name: 'Gloom Catacombs', tags: [ 'undead', 'dark', 'bone' ], generator: 'dungeon',
	families: [ 'undead', 'shadow', 'ghoul' ],
	palette: { primary: '#6a6050', secondary: '#3a342e', accent: '#ffcf70', skin: '#d8ccb0', metal: '#6a6460', glow: '#ffb84a', dark: '#120f0c' },
	floor: [ F( '#38322c', 2, 0.6, 0.3 ), F( '#403830', 3, 0.6, 0.25 ), F( '#4a4034', 2, 0.7, 0.2, 0.2 ), F( '#403830', 2, 0.5, 0.3 ) ],
	wall: { color: '#4a4238', top: '#5e5446', mass: '#100c0a', height: 2.6, pattern: 'brick', jag: 0.1 },
	liquid: { water: '#1a2220', lava: '#ff6a20', ice: '#a8c8e0', pit: '#040302' },
	features: {},
	props: [
		{ model: 'prop-bones', where: 'wall', density: 4 }, { model: 'prop-skull-pile', where: 'corner', density: 1.4 },
		{ model: 'prop-candles', where: 'wall', density: 1.2, glow: true }, { model: 'prop-coffin', where: 'wall', density: 0.8 },
		{ model: 'prop-urn', where: 'corner', density: 0.8 }
	],
	pillar: 'prop-pillar',
	lights: { model: 'prop-torch', kind: 'torch', color: '#ffb050', intensity: 26, range: 11, spacing: 9, flicker: 0.45, height: 2.1 },
	glow: [ { on: 'prop-candles', color: '#ffc060', intensity: 4, range: 4 } ],
	lighting: { sky: '#5a5048', ground: '#100c0a', hemi: 0.45, sun: 0.35, sunColor: '#c0a888', sunDir: [ 0.2, 1, 0.5 ], exposure: 1.1, player: { color: '#ffc890', intensity: 12, range: 10 } },
	fog: { color: '#060403', near: 14, far: 38 }, sky: { top: '#000000', bottom: '#080604', stars: 0 },
	post: { bloom: 0.6, saturation: 0.85, contrast: 1.12, vignette: 0.55, tint: '#fff0dc' }
} );

define( 'theme', {
	id: 'frostfang-pass', name: 'Frostfang Pass', tags: [ 'cold', 'snow', 'mountain' ], generator: 'caves',
	families: [ 'cold', 'beast', 'yeti' ],
	palette: { primary: '#8aa8c0', secondary: '#506478', accent: '#bfefff', skin: '#e0eef8', metal: '#8a9aa8', glow: '#9fe8ff', dark: '#1a2430' },
	floor: [ F( '#c4d2dc', 0, 0, 0.35, 0.15 ), F( '#b8c8d4', 0, 0, 0.45, 0.2 ), F( '#9aaab8', 2, 0.5, 0.3, 0.2 ), F( '#a8b8c4', 2, 0.4, 0.3 ) ],
	wall: { color: '#7890a8', top: '#e8f2fa', mass: '#2a3644', height: 2.6, pattern: 'rock', jag: 0.6 },
	liquid: { water: '#2a4a68', lava: '#ff6a20', ice: '#9fd4f0', pit: '#0a1018' },
	features: { ice: 0.12 },
	props: [
		{ model: 'prop-ice-crystal', where: 'wall', density: 1.6, glow: true }, { model: 'prop-pine', where: 'wall', density: 1.4 },
		{ model: 'prop-rock', where: 'open', density: 0.6, solid: true }, { model: 'prop-snow-rock', where: 'wall', density: 2 },
		{ model: 'prop-banner', where: 'corner', density: 0.4 }
	],
	pillar: 'prop-ice-pillar',
	lights: { model: 'prop-brazier-decor', kind: 'brazier', color: '#ffa860', intensity: 30, range: 12, spacing: 10, flicker: 0.3, height: 1.4 },
	glow: [ { on: 'prop-ice-crystal', color: '#8fdcff', intensity: 5, range: 5 } ],
	lighting: { sky: '#cfe4ff', ground: '#4a5a70', hemi: 1.15, sun: 2.4, sunColor: '#eaf4ff', sunDir: [ 0.5, 0.9, 0.25 ], exposure: 0.95, player: { color: '#ffe0c0', intensity: 4, range: 8 } },
	fog: { color: '#8aa0b8', near: 26, far: 66 }, sky: { top: '#7890b0', bottom: '#c8d8e8', stars: 0 },
	post: { bloom: 0.45, saturation: 0.95, contrast: 1.02, vignette: 0.25, tint: '#f0f8ff' }
} );

define( 'theme', {
	id: 'storm-foundry', name: 'Storm Foundry', tags: [ 'lightning', 'metal', 'industrial' ], generator: 'dungeon',
	families: [ 'lightning', 'construct', 'golem' ],
	palette: { primary: '#5a6070', secondary: '#33363e', accent: '#ffcf30', skin: '#9aa0aa', metal: '#8a92a0', glow: '#7ad0ff', dark: '#14161c' },
	floor: [ F( '#4a4e56', 2, 0.35, 0.2, 0.35 ), F( '#52565e', 1, 0.6, 0.15, 0.4 ), F( '#5a5e66', 2, 0.7, 0.1, 0.5 ), F( '#4a4e56', 2, 0.35, 0.2, 0.35 ) ],
	wall: { color: '#5a5f6a', top: '#8a8f9a', mass: '#14161c', height: 2.8, pattern: 'panel', jag: 0 },
	liquid: { water: '#203040', lava: '#ff7a20', ice: '#a8c8e0', pit: '#05060a' },
	features: { chasm: 0.15 },
	props: [
		{ model: 'prop-crate', where: 'corner', density: 1.6 }, { model: 'prop-pipe', where: 'wall', density: 1.6 },
		{ model: 'prop-gear', where: 'wall', density: 1 }, { model: 'prop-coil', where: 'open', density: 0.4, solid: true, glow: true },
		{ model: 'prop-anvil', where: 'wall', density: 0.5 }
	],
	pillar: 'prop-metal-pillar',
	lights: { model: 'prop-lamp-wall', kind: 'lamp', color: '#a8d8ff', intensity: 30, range: 12, spacing: 8, flicker: 0.12, height: 2.4 },
	glow: [ { on: 'prop-coil', color: '#7ad0ff', intensity: 12, range: 7 } ],
	lighting: { sky: '#8090b0', ground: '#1a1c24', hemi: 0.8, sun: 1.1, sunColor: '#c8d8ff', sunDir: [ - 0.4, 1, 0.35 ], exposure: 1.05, player: { color: '#d0e8ff', intensity: 8, range: 9 } },
	fog: { color: '#0c0e14', near: 22, far: 54 }, sky: { top: '#04050a', bottom: '#141826', stars: 0 },
	post: { bloom: 0.8, saturation: 1.0, contrast: 1.08, vignette: 0.4, tint: '#e8f0ff' }
} );

define( 'theme', {
	id: 'shattered-observatory', name: 'Shattered Observatory', tags: [ 'arcane', 'void', 'stars' ], generator: 'dungeon',
	families: [ 'arcane', 'void', 'construct' ],
	palette: { primary: '#6a6890', secondary: '#3a3858', accent: '#e0c070', skin: '#c8c0e8', metal: '#b0a070', glow: '#a890ff', dark: '#0e0c1c' },
	floor: [ F( '#56547a', 2, 0.4, 0.2, 0.45 ), F( '#605e86', 2, 0.5, 0.15, 0.55 ), F( '#6e6a96', 3, 0.7, 0.1, 0.6 ), F( '#56547a', 2, 0.4, 0.2, 0.45 ) ],
	wall: { color: '#625e8a', top: '#9a94c8', mass: '#0c0a18', height: 2.6, pattern: 'brick', jag: 0.2 },
	liquid: { water: '#20204a', lava: '#ff6a20', ice: '#b0c8f0', pit: '#000000' },
	features: { chasm: 0.4 },
	props: [
		{ model: 'prop-orrery', where: 'open', density: 0.3, solid: true, glow: true }, { model: 'prop-bookshelf', where: 'wall', density: 1.4 },
		{ model: 'prop-star-crystal', where: 'wall', density: 1.2, glow: true }, { model: 'prop-telescope', where: 'corner', density: 0.5 },
		{ model: 'prop-rubble', where: 'wall', density: 2 }
	],
	pillar: 'prop-pillar',
	lights: { model: 'prop-brazier-decor', kind: 'brazier', color: '#b8a0ff', intensity: 28, range: 12, spacing: 9, flicker: 0.2, height: 1.4 },
	glow: [ { on: 'prop-star-crystal', color: '#a890ff', intensity: 6, range: 5 } ],
	lighting: { sky: '#8a88d0', ground: '#14122a', hemi: 0.8, sun: 1.3, sunColor: '#b8c0ff', sunDir: [ 0.3, 1, - 0.2 ], exposure: 1.05, player: { color: '#d8d0ff', intensity: 8, range: 9 } },
	fog: { color: '#0a0818', near: 22, far: 60 }, sky: { top: '#020108', bottom: '#120c2a', stars: 1 },
	post: { bloom: 0.8, saturation: 1.1, contrast: 1.05, vignette: 0.4, tint: '#f0ecff' }
} );

define( 'theme', {
	id: 'cinder-caldera', name: 'Cinder Caldera', tags: [ 'fire', 'lava', 'volcanic' ], generator: 'caves',
	families: [ 'fire', 'elemental', 'salamander' ],
	palette: { primary: '#3a2e2a', secondary: '#221a18', accent: '#ff5a1a', skin: '#5a4440', metal: '#4a4040', glow: '#ff6a10', dark: '#0c0806' },
	floor: [ F( '#302624', 0, 0, 0.5, 0.1 ), F( '#382c28', 2, 0.4, 0.4, 0.15 ), F( '#40322c', 3, 0.6, 0.3, 0.2 ), F( '#382c28', 2, 0.4, 0.4 ) ],
	wall: { color: '#3a2e2a', top: '#54443e', mass: '#0a0605', height: 2.6, pattern: 'rock', jag: 0.7 },
	liquid: { water: '#2a2020', lava: '#ff4a08', ice: '#a8c8e0', pit: '#100402' },
	features: { lava: 0.35 },
	props: [
		{ model: 'prop-basalt', where: 'wall', density: 2.4 }, { model: 'prop-obsidian', where: 'wall', density: 1.4 },
		{ model: 'prop-vent-decor', where: 'open', density: 0.4, glow: true }, { model: 'prop-skull-pile', where: 'corner', density: 0.6 }
	],
	pillar: 'prop-basalt-pillar',
	lights: { model: 'prop-brazier-decor', kind: 'brazier', color: '#ff7a3a', intensity: 22, range: 11, spacing: 12, flicker: 0.4, height: 1.4 },
	glow: [ { on: 'lava', color: '#ff5a10', intensity: 26, range: 10 }, { on: 'prop-vent-decor', color: '#ff6a20', intensity: 8, range: 6 } ],
	lighting: { sky: '#7a3020', ground: '#1a0806', hemi: 0.6, sun: 0.7, sunColor: '#ff9070', sunDir: [ 0.2, 1, 0.45 ], exposure: 1.05, player: { color: '#ffb080', intensity: 6, range: 8 } },
	fog: { color: '#1c0804', near: 20, far: 50 }, sky: { top: '#0a0202', bottom: '#2a0a04', stars: 0 },
	post: { bloom: 1, saturation: 1.1, contrast: 1.1, vignette: 0.45, tint: '#ffe8dc' }
} );

define( 'theme', {
	id: 'hollow-moon', name: 'Hollow Moon', tags: [ 'void', 'moon', 'alien' ], generator: 'caves',
	families: [ 'void', 'insect', 'alien' ],
	palette: { primary: '#8a8a96', secondary: '#4a4a5a', accent: '#c090ff', skin: '#b0b0c0', metal: '#9a9ab0', glow: '#a070ff', dark: '#14141c' },
	floor: [ F( '#8a8a94', 0, 0, 0.4, 0.05 ), F( '#94949e', 0, 0, 0.5, 0.05 ), F( '#7a7a88', 2, 0.5, 0.3, 0.2 ), F( '#8a8a94', 0, 0, 0.4 ) ],
	wall: { color: '#6e6e7e', top: '#a8a8b8', mass: '#14141c', height: 2.2, pattern: 'rock', jag: 0.5 },
	liquid: { water: '#2a2050', lava: '#ff6a20', ice: '#c0c8f0', pit: '#000000' },
	features: { chasm: 0.12 },
	props: [
		{ model: 'prop-moon-rock', where: 'wall', density: 2.4 }, { model: 'prop-void-crystal', where: 'wall', density: 1.2, glow: true },
		{ model: 'prop-obelisk', where: 'open', density: 0.3, solid: true }, { model: 'prop-rock', where: 'open', density: 0.5, solid: true }
	],
	pillar: 'prop-rock-pillar',
	lights: { model: 'prop-void-lamp', kind: 'crystal', color: '#b088ff', intensity: 22, range: 11, spacing: 10, flicker: 0.1, height: 1.2 },
	glow: [ { on: 'prop-void-crystal', color: '#a070ff', intensity: 7, range: 6 } ],
	lighting: { sky: '#7070a0', ground: '#14141c', hemi: 0.6, sun: 2.6, sunColor: '#f0f0ff', sunDir: [ 0.8, 0.55, 0.35 ], exposure: 1.0, player: { color: '#e0d8ff', intensity: 4, range: 8 } },
	fog: { color: '#06060c', near: 26, far: 70 }, sky: { top: '#000000', bottom: '#0a0818', stars: 1 },
	post: { bloom: 0.7, saturation: 1.0, contrast: 1.12, vignette: 0.35, tint: '#f4f0ff' }
} );

define( 'theme', {
	id: 'mirror-halls', name: 'Mirror Halls', tags: [ 'arcane', 'crystal', 'palace' ], generator: 'dungeon',
	families: [ 'arcane', 'spirit', 'construct' ],
	palette: { primary: '#c8ccd8', secondary: '#5a5e70', accent: '#a0f0ff', skin: '#e8ecf4', metal: '#c0c8d8', glow: '#9ff0ff', dark: '#14161e' },
	floor: [ F( '#2c2e38', 1, 0.15, 0.08, 0.85 ), F( '#d0d2dc', 1, 0.15, 0.08, 0.85 ), F( '#8a8ea0', 2, 0.3, 0.05, 0.9 ), F( '#2c2e38', 1, 0.15, 0.08, 0.85 ) ],
	wall: { color: '#9aa0b4', top: '#d8dce8', mass: '#101218', height: 2.8, pattern: 'panel', jag: 0 },
	liquid: { water: '#203048', lava: '#ff6a20', ice: '#c0e0f8', pit: '#000004' },
	features: {},
	checker: true,
	props: [
		{ model: 'prop-mirror', where: 'wall', density: 2, glow: true }, { model: 'prop-candelabra', where: 'corner', density: 0.8, glow: true },
		{ model: 'prop-statue', where: 'open', density: 0.35, solid: true }, { model: 'prop-urn', where: 'corner', density: 0.6 }
	],
	pillar: 'prop-crystal-pillar',
	lights: { model: 'prop-candelabra', kind: 'candle', color: '#d8f4ff', intensity: 26, range: 12, spacing: 9, flicker: 0.12, height: 1.6 },
	glow: [ { on: 'prop-mirror', color: '#a0e8ff', intensity: 3, range: 4 } ],
	lighting: { sky: '#c8d8ff', ground: '#2a2c38', hemi: 1.0, sun: 1.4, sunColor: '#f0f4ff', sunDir: [ - 0.35, 1, 0.3 ], exposure: 1.0, player: { color: '#e0f8ff', intensity: 6, range: 8 } },
	fog: { color: '#10121a', near: 24, far: 60 }, sky: { top: '#04050a', bottom: '#181c2a', stars: 0.3 },
	post: { bloom: 0.75, saturation: 0.9, contrast: 1.1, vignette: 0.35, tint: '#f0f8ff' }
} );

define( 'theme', {
	id: 'ashen-hive', name: 'Ashen Hive', tags: [ 'insect', 'fire', 'organic' ], generator: 'caves',
	families: [ 'insect', 'fire', 'brood' ],
	palette: { primary: '#6a5030', secondary: '#3a2a1a', accent: '#ffa030', skin: '#8a7050', metal: '#5a5048', glow: '#ff8a20', dark: '#16100a' },
	floor: [ F( '#4a4440', 0, 0, 0.55 ), F( '#524a42', 3, 0.35, 0.35, 0.15 ), F( '#5a5044', 3, 0.5, 0.3, 0.2 ), F( '#4a4440', 0, 0, 0.5 ) ],
	wall: { color: '#6a5030', top: '#9a7848', mass: '#16100a', height: 2.4, pattern: 'hex', jag: 0.35 },
	liquid: { water: '#3a3020', lava: '#ff6a10', ice: '#a8c8e0', pit: '#0a0604' },
	features: { lava: 0.08 },
	props: [
		{ model: 'prop-hive-pod', where: 'wall', density: 2, glow: true }, { model: 'prop-ash-pile', where: 'open', density: 1.2 },
		{ model: 'prop-resin', where: 'wall', density: 1.6 }, { model: 'prop-bones', where: 'corner', density: 1 }
	],
	pillar: 'prop-resin-pillar',
	lights: { model: 'prop-hive-lamp', kind: 'glow', color: '#ff9a3a', intensity: 22, range: 11, spacing: 9, flicker: 0.25, height: 1.2 },
	glow: [ { on: 'prop-hive-pod', color: '#ff8a20', intensity: 5, range: 5 } ],
	lighting: { sky: '#9a7050', ground: '#1e140c', hemi: 0.8, sun: 1.2, sunColor: '#ffc080', sunDir: [ 0.3, 1, 0.4 ], exposure: 1.05, player: { color: '#ffd0a0', intensity: 6, range: 8 } },
	fog: { color: '#2a1e14', near: 20, far: 52 }, sky: { top: '#140c06', bottom: '#3a2818', stars: 0 },
	post: { bloom: 0.75, saturation: 1.0, contrast: 1.06, vignette: 0.4, tint: '#fff0e0' }
} );

define( 'theme', {
	id: 'clockwork-ruins', name: 'Clockwork Ruins', tags: [ 'construct', 'metal', 'ruins' ], generator: 'dungeon',
	families: [ 'construct', 'metal', 'automaton' ],
	palette: { primary: '#8a6a3a', secondary: '#4a3a24', accent: '#e8c060', skin: '#c0a070', metal: '#b08a40', glow: '#60e8c8', dark: '#18140c' },
	floor: [ F( '#5a5040', 2, 0.5, 0.3, 0.2 ), F( '#625846', 2, 0.6, 0.25, 0.3 ), F( '#6e6048', 3, 0.7, 0.2, 0.45 ), F( '#5a5040', 2, 0.5, 0.3 ) ],
	wall: { color: '#6a5a40', top: '#a08a5a', mass: '#16120a', height: 2.6, pattern: 'brick', jag: 0.25 },
	liquid: { water: '#2a4038', lava: '#ff6a20', ice: '#a8c8e0', pit: '#060402' },
	features: { chasm: 0.1 },
	props: [
		{ model: 'prop-gear', where: 'wall', density: 2 }, { model: 'prop-piston', where: 'wall', density: 1 },
		{ model: 'prop-clock', where: 'open', density: 0.3, solid: true, glow: true }, { model: 'prop-rubble', where: 'wall', density: 2 },
		{ model: 'prop-broken-pillar', where: 'open', density: 0.3, solid: true }
	],
	pillar: 'prop-metal-pillar',
	lights: { model: 'prop-lamp-wall', kind: 'lamp', color: '#ffd080', intensity: 28, range: 12, spacing: 8, flicker: 0.15, height: 2.3 },
	glow: [ { on: 'prop-clock', color: '#60e8c8', intensity: 8, range: 6 } ],
	lighting: { sky: '#c8b080', ground: '#2a2010', hemi: 0.95, sun: 1.6, sunColor: '#ffe0a8', sunDir: [ 0.4, 1, 0.2 ], exposure: 1.0, player: { color: '#ffe8c0', intensity: 5, range: 8 } },
	fog: { color: '#1c160c', near: 24, far: 60 }, sky: { top: '#0c0a06', bottom: '#2a2214', stars: 0 },
	post: { bloom: 0.6, saturation: 1.05, contrast: 1.05, vignette: 0.35, tint: '#fff4e0' }
} );

define( 'theme', {
	id: 'blightmarsh', name: 'Blightmarsh', tags: [ 'poison', 'swamp', 'organic' ], generator: 'caves',
	families: [ 'poison', 'swamp', 'plant' ],
	palette: { primary: '#4a5a34', secondary: '#2a3420', accent: '#b0ff40', skin: '#7a8a5a', metal: '#5a6050', glow: '#9cff3a', dark: '#10140a' },
	floor: [ F( '#3a4430', 0, 0, 0.6, 0.15 ), F( '#424c34', 0, 0, 0.55, 0.2 ), F( '#4a5038', 2, 0.5, 0.3, 0.2 ), F( '#3a4430', 0, 0, 0.6 ) ],
	wall: { color: '#3a4a30', top: '#5a6a3a', mass: '#0c100a', height: 2.2, pattern: 'hedge', jag: 0.5 },
	liquid: { water: '#2a4030', lava: '#ff6a20', ice: '#a8c8c0', pit: '#060804' },
	features: { pools: 0.5 },
	props: [
		{ model: 'prop-dead-tree', where: 'wall', density: 1.4 }, { model: 'prop-mushroom', where: 'wall', density: 2, glow: true },
		{ model: 'prop-reeds', where: 'wall', density: 2.4 }, { model: 'prop-skull-pile', where: 'corner', density: 0.5 },
		{ model: 'prop-dead-tree', where: 'open', density: 0.3, solid: true }
	],
	pillar: 'prop-root-pillar',
	lights: { model: 'prop-swamp-lantern', kind: 'lamp', color: '#c0ff70', intensity: 22, range: 11, spacing: 10, flicker: 0.3, height: 1.6 },
	glow: [ { on: 'prop-mushroom', color: '#9cff3a', intensity: 4, range: 4 } ],
	lighting: { sky: '#7a9060', ground: '#141a0c', hemi: 0.85, sun: 1.0, sunColor: '#d8ffb0', sunDir: [ - 0.3, 1, 0.35 ], exposure: 1.05, player: { color: '#e8ffd0', intensity: 6, range: 8 } },
	fog: { color: '#1c2814', near: 18, far: 46 }, sky: { top: '#080c04', bottom: '#1e2a14', stars: 0 },
	post: { bloom: 0.6, saturation: 0.95, contrast: 1.05, vignette: 0.45, tint: '#f0ffe0' }
} );

// The hub: warm dusk, cobbles and grass, lamps everywhere (the clustered-lighting
// showcase), a forge glow and a blue waypoint beacon.
define( 'theme', {
	id: 'town', name: 'Hearthmoor', tags: [ 'town', 'safe' ], generator: 'town',
	families: [],
	palette: { primary: '#8a5a3a', secondary: '#5a3a24', accent: '#ffcf5a', skin: '#e0b090', metal: '#7a7a80', glow: '#ffb04a', dark: '#1a120c' },
	floor: [ F( '#4e6a34', 0, 0, 0.6 ), F( '#7a7468', 3, 0.55, 0.25, 0.15 ), F( '#8a8274', 3, 0.6, 0.2, 0.2 ), F( '#7a7468', 3, 0.55, 0.25, 0.15 ),
		F( '#4e6a34', 0, 0, 0.6 ), F( '#7a5e40', 0, 0, 0.5 ), F( '#8a8070', 2, 0.6, 0.2, 0.2 ), F( '#5a6a3c', 0, 0, 0.5 ) ],
	wall: { color: '#4a6a30', top: '#5e8a3a', mass: '#141c0c', height: 1.6, pattern: 'hedge', jag: 0.4 },
	liquid: { water: '#2a5068', lava: '#ff6a20', ice: '#a8c8e0', pit: '#0a0a0a' },
	features: {},
	props: [],
	pillar: 'prop-pillar',
	lights: { model: 'prop-lamp-post', kind: 'lamp', color: '#ffc070', intensity: 50, range: 15, spacing: 9, flicker: 0.12, height: 3 },
	glow: [],
	lighting: { sky: '#a8b8e8', ground: '#4a3a28', hemi: 1.25, sun: 2.4, sunColor: '#ffc890', sunDir: [ - 0.6, 0.75, 0.4 ], exposure: 1.1, player: { color: '#ffe0b0', intensity: 3, range: 7 } },
	fog: { color: '#4a4058', near: 34, far: 80 }, sky: { top: '#2a2c50', bottom: '#d08a60', stars: 0.4 },
	post: { bloom: 0.7, saturation: 1.05, contrast: 1.04, vignette: 0.3, tint: '#fff0e0' }
} );

// --- colour helpers (sim-safe; no three.js) ---------------------------------------------

export function hexToHsl( hex ) {

	const n = parseInt( hex.slice( 1 ), 16 );
	const r = ( n >> 16 & 255 ) / 255, g = ( n >> 8 & 255 ) / 255, b = ( n & 255 ) / 255;
	const max = Math.max( r, g, b ), min = Math.min( r, g, b ), l = ( max + min ) / 2;
	if ( max === min ) return [ 0, 0, l ];
	const d = max - min, s = l > 0.5 ? d / ( 2 - max - min ) : d / ( max + min );
	const h = max === r ? ( g - b ) / d + ( g < b ? 6 : 0 ) : max === g ? ( b - r ) / d + 2 : ( r - g ) / d + 4;
	return [ h / 6, s, l ];

}

export function hslToHex( h, s, l ) {

	h = ( ( h % 1 ) + 1 ) % 1; s = Math.max( 0, Math.min( 1, s ) ); l = Math.max( 0, Math.min( 1, l ) );
	const f = ( n ) => {

		const k = ( n + h * 12 ) % 12, a = s * Math.min( l, 1 - l );
		return Math.round( 255 * ( l - a * Math.max( - 1, Math.min( k - 3, 9 - k, 1 ) ) ) );

	};

	return '#' + [ f( 0 ), f( 8 ), f( 4 ) ].map( ( v ) => v.toString( 16 ).padStart( 2, '0' ) ).join( '' );

}

function mapColors( obj, fn ) {

	if ( typeof obj === 'string' ) return /^#[0-9a-f]{6}$/i.test( obj ) ? fn( obj ) : obj;
	if ( Array.isArray( obj ) ) return obj.map( ( v ) => mapColors( v, fn ) );
	if ( obj && typeof obj === 'object' ) {

		const out = {};
		for ( const k in obj ) out[ k ] = mapColors( obj[ k ], fn );
		return out;

	}

	return obj;

}

// A recoloured COPY of a theme: hue rotates by `hue` (turns), saturation and
// lightness scale. Lights get a gentler shift so torches stay warm-ish.
export function paletteShift( theme, { hue = 0, sat = 1, light = 1 } = {} ) {

	if ( ! hue && sat === 1 && light === 1 ) return theme;
	const shift = ( k ) => ( hex ) => {

		const [ h, s, l ] = hexToHsl( hex );
		return hslToHex( h + hue * k, s * ( 1 + ( sat - 1 ) * k ), l * ( 1 + ( light - 1 ) * k ) );

	};

	const out = mapColors( theme, shift( 1 ) );
	out.lights = mapColors( theme.lights, shift( 0.5 ) );
	out.glow = mapColors( theme.glow, shift( 0.6 ) );
	out.id = theme.id;
	out.name = theme.name;
	out.shift = { hue, sat, light };
	return out;

}

// The theme a spec asks for, palette-shifted when the spec says so.
export function themeFor( spec ) {

	const base = get( 'theme', spec?.theme ) || get( 'theme', 'sunken-crypt' );
	return spec?.palette ? paletteShift( base, spec.palette ) : base;

}

export function campaignThemes() {

	return all( 'theme' ).filter( ( t ) => ! t.tags.includes( 'town' ) );

}
