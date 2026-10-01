// Item bases: the "white" item every drop starts from. A base fixes the slot, the
// weapon class or defence type, the implicit modifier, the requirements and the
// look ( `model` hints for the hero renderer, `icon` for the procedural UI icon).
// Affixes ( affixes.js ) then roll ON TOP of a base by matching its tags.
//
//   define( 'itemBase', { id, name, slot, level, tags, implicit: [ mods ], req: { level, str, dex, int },
//     weaponClass?, hands?, damage?: [ min, max ], attackSpeed?, crit?,      weapons
//     defence?: { armor?: [lo, hi], evasion?: [lo, hi], shield?: [lo, hi] }, block?,   armour pieces
//     flask?: { kind, amount, duration, max, use, buff? },                    flasks
//     model: { weapon | gear, color }, icon } )
//
// Bases are generated from compact tables so a new tier is one row. Numbers grow
// with the base level on the same curves monsters use ( core/tuning.js ), so a
// level-60 base is worth picking up in level-60 areas.

import { define } from '../../../core/registry.js';

export const EQUIP_SLOTS = [ 'weapon', 'offhand', 'helm', 'chest', 'gloves', 'boots', 'belt', 'amulet', 'ring1', 'ring2' ];
export const FLASK_SLOTS = [ 'flask1', 'flask2', 'flask3', 'flask4' ];
export const ALL_SLOTS = [ ...EQUIP_SLOTS, ...FLASK_SLOTS ];

// equipment slot -> base.slot values it accepts
export const SLOT_ACCEPTS = {
	weapon: [ 'weapon' ], offhand: [ 'offhand', 'weapon' ], helm: [ 'helm' ], chest: [ 'chest' ], gloves: [ 'gloves' ],
	boots: [ 'boots' ], belt: [ 'belt' ], amulet: [ 'amulet' ], ring1: [ 'ring' ], ring2: [ 'ring' ],
	flask1: [ 'flask' ], flask2: [ 'flask' ], flask3: [ 'flask' ], flask4: [ 'flask' ]
};

export const SLOT_NAMES = {
	weapon: 'Main Hand', offhand: 'Off Hand', helm: 'Helmet', chest: 'Body Armour', gloves: 'Gloves', boots: 'Boots',
	belt: 'Belt', amulet: 'Amulet', ring1: 'Ring', ring2: 'Ring', flask1: 'Flask', flask2: 'Flask', flask3: 'Flask', flask4: 'Flask'
};

const r = ( v ) => Math.max( 1, Math.round( v ) );

// Average weapon damage of a one-handed base of `level` (before the class multiplier).
export function weaponBaseAvg( level ) {

	return 8 * Math.pow( 1 + level / 8, 1.15 );

}

// requirement split: total attribute points spread by weight
function req( level, split ) {

	const total = level * 1.7 + 6;
	const out = { level };
	for ( const k in split ) {

		const v = Math.round( total * split[ k ] );
		if ( v > 0 ) out[ k ] = v;

	}

	return out;

}

const tint = ( level ) => level < 15 ? '#9a8f80' : level < 35 ? '#c0c4cc' : level < 55 ? '#dfe3ea' : '#e8d39a';

// --- weapons -------------------------------------------------------------------

// class: hands, damage multiplier, spread, attack speed, crit, attribute split, tags, implicit( level ), names [ level, name ]
const WEAPONS = {
	sword: { hands: 1, mult: 1.0, spread: 0.3, aps: 1.15, crit: 5.5, split: { str: 0.5, dex: 0.5 }, tags: [ 'melee' ],
		implicit: ( l ) => [ { stat: 'damage', type: 'inc', range: [ r( 8 + l * 0.2 ), r( 14 + l * 0.3 ) ], tags: [ 'melee' ] } ],
		names: [ [ 1, 'Rusted Blade' ], [ 12, 'Arming Sword' ], [ 28, 'Sabre' ], [ 46, 'Runic Longsword' ], [ 66, 'Eternal Sword' ] ] },
	axe: { hands: 1, mult: 1.15, spread: 0.4, aps: 1.0, crit: 5, split: { str: 0.6, dex: 0.4 }, tags: [ 'melee' ],
		implicit: ( l ) => [ { stat: 'bleed_chance', type: 'flat', range: [ 10, 15 ] } ],
		names: [ [ 2, 'Hatchet' ], [ 16, 'Bearded Axe' ], [ 34, 'War Axe' ], [ 58, 'Runic Hatchet' ] ] },
	mace: { hands: 1, mult: 1.2, spread: 0.35, aps: 0.95, crit: 5, split: { str: 1 }, tags: [ 'melee' ],
		implicit: ( l ) => [ { stat: 'knockback', type: 'inc', range: [ 20, 30 ] } ],
		names: [ [ 1, 'Driftwood Club' ], [ 14, 'Spiked Mace' ], [ 32, 'Flanged Mace' ], [ 56, 'Behemoth Mace' ] ] },
	dagger: { hands: 1, mult: 0.75, spread: 0.35, aps: 1.35, crit: 7, split: { dex: 0.6, int: 0.4 }, tags: [ 'melee' ],
		implicit: ( l ) => [ { stat: 'crit_chance', type: 'inc', range: [ 25, 35 ] } ],
		names: [ [ 1, 'Glass Shank' ], [ 15, 'Kris' ], [ 33, 'Stiletto' ], [ 57, 'Ambusher' ] ] },
	spear: { hands: 1, mult: 1.05, spread: 0.3, aps: 1.1, crit: 6, split: { dex: 0.6, str: 0.4 }, tags: [ 'melee' ],
		implicit: ( l ) => [ { stat: 'area', type: 'inc', range: [ 8, 12 ], tags: [ 'melee' ] } ],
		names: [ [ 3, 'Hunting Spear' ], [ 20, 'Barbed Spear' ], [ 40, 'War Spear' ], [ 62, 'Dragonbone Spear' ] ] },
	wand: { hands: 1, mult: 0.65, spread: 0.3, aps: 1.2, crit: 7, split: { int: 1 }, tags: [ 'ranged', 'caster' ],
		implicit: ( l ) => [ { stat: 'damage', type: 'inc', range: [ r( 10 + l * 0.25 ), r( 16 + l * 0.35 ) ], tags: [ 'spell' ] } ],
		names: [ [ 1, 'Driftwood Wand' ], [ 18, 'Bone Wand' ], [ 38, 'Crystal Wand' ], [ 60, 'Prophecy Wand' ] ] },
	greatsword: { hands: 2, mult: 1.9, spread: 0.3, aps: 0.95, crit: 5.5, split: { str: 0.6, dex: 0.4 }, tags: [ 'melee' ],
		implicit: ( l ) => [ { stat: 'crit_multi', type: 'flat', range: [ 15, 25 ] } ],
		names: [ [ 4, 'Bastard Sword' ], [ 26, 'Executioner Blade' ], [ 54, 'Reaver Greatsword' ] ] },
	greataxe: { hands: 2, mult: 2.1, spread: 0.4, aps: 0.9, crit: 5, split: { str: 0.7, dex: 0.3 }, tags: [ 'melee' ],
		implicit: ( l ) => [ { stat: 'life_on_kill', type: 'flat', range: [ r( 4 + l * 0.3 ), r( 8 + l * 0.5 ) ] } ],
		names: [ [ 6, 'Woodsplitter' ], [ 30, 'Poleaxe' ], [ 60, 'Despot Axe' ] ] },
	maul: { hands: 2, mult: 2.25, spread: 0.35, aps: 0.85, crit: 5, split: { str: 1 }, tags: [ 'melee' ],
		implicit: ( l ) => [ { stat: 'area', type: 'inc', range: [ 15, 25 ] } ],
		names: [ [ 5, 'Driftwood Maul' ], [ 28, 'Great Mallet' ], [ 58, 'Coronal Maul' ] ] },
	staff: { hands: 2, mult: 1.7, spread: 0.3, aps: 0.95, crit: 6, split: { str: 0.4, int: 0.6 }, tags: [ 'melee', 'caster' ],
		implicit: ( l ) => [ { stat: 'block_chance', type: 'flat', range: [ 8, 12 ] }, { stat: 'damage', type: 'inc', range: [ r( 12 + l * 0.3 ), r( 20 + l * 0.4 ) ], tags: [ 'spell' ] } ],
		names: [ [ 1, 'Gnarled Branch' ], [ 22, 'Quarterstaff' ], [ 44, 'Ezomyte Staff' ], [ 66, 'Judgement Staff' ] ] },
	bow: { hands: 2, mult: 1.6, spread: 0.45, aps: 1.0, crit: 6, split: { dex: 1 }, tags: [ 'ranged' ],
		implicit: ( l ) => [ { stat: 'projectile_speed', type: 'inc', range: [ 10, 20 ] } ],
		names: [ [ 1, 'Crude Bow' ], [ 17, 'Recurve Bow' ], [ 36, 'Imperial Bow' ], [ 62, 'Thicket Bow' ] ] }
};

export const WEAPON_CLASSES = Object.keys( WEAPONS );
// weapon class -> model id in the creatures library ( 'weapon-<id>' ) where they differ
const WEAPON_MODEL = { maul: 'hammer', greataxe: 'axe' };

for ( const [ cls, w ] of Object.entries( WEAPONS ) ) {

	for ( const [ level, name ] of w.names ) {

		const avg = weaponBaseAvg( level ) * w.mult;
		const id = name.toLowerCase().replace( /[^a-z]+/g, '-' );
		define( 'itemBase', {
			id, name, slot: 'weapon', level, weaponClass: cls, hands: w.hands,
			tags: [ 'weapon', cls, w.hands === 2 ? 'two-hand' : 'one-hand', 'attack', ...w.tags ],
			damage: [ r( avg * ( 1 - w.spread ) ), r( avg * ( 1 + w.spread ) ) ], attackSpeed: w.aps, crit: w.crit,
			implicit: w.implicit( level ), req: req( level, w.split ),
			model: { weapon: WEAPON_MODEL[ cls ] ?? cls, color: tint( level ) }, icon: cls
		} );

	}

}

// --- armour ----------------------------------------------------------------------

// Per-slot scale of the three defences. Evasion is a direct % chance to evade in
// this engine ( core/combat.js rolls evade_chance as is ), so its numbers are small.
const SLOT_DEF = {
	helm: { ar: 1.2, ev: 1.0, es: 1.1 }, chest: { ar: 2.2, ev: 2.0, es: 2.0 }, gloves: { ar: 0.9, ev: 0.8, es: 0.7 },
	boots: { ar: 0.9, ev: 0.8, es: 0.7 }, shield: { ar: 1.8, ev: 1.5, es: 1.6 }
};
const armourAt = ( l, m ) => [ r( ( 12 + l * 2.6 ) * m * 0.85 ), r( ( 12 + l * 2.6 ) * m * 1.15 ) ];
const evasionAt = ( l, m ) => [ Math.round( ( 2 + l * 0.04 ) * m * 0.9 * 10 ) / 10, Math.round( ( 2 + l * 0.04 ) * m * 1.1 * 10 ) / 10 ];
const shieldAt = ( l, m ) => [ r( ( 8 + l * 1.0 ) * m * 0.85 ), r( ( 8 + l * 1.0 ) * m * 1.15 ) ];

const DEF_TYPES = {
	ar: { tags: [ 'str_armour' ], split: { str: 1 }, color: '#8f8a80' },
	ev: { tags: [ 'dex_armour' ], split: { dex: 1 }, color: '#6f8f5a' },
	es: { tags: [ 'int_armour' ], split: { int: 1 }, color: '#6a7fb0' },
	'ar/ev': { tags: [ 'str_armour', 'dex_armour' ], split: { str: 0.55, dex: 0.55 }, color: '#857a5c' },
	'ar/es': { tags: [ 'str_armour', 'int_armour' ], split: { str: 0.55, int: 0.55 }, color: '#7d7f98' },
	'ev/es': { tags: [ 'dex_armour', 'int_armour' ], split: { dex: 0.55, int: 0.55 }, color: '#5f8a8a' }
};

const ARMOUR = {
	helm: [
		[ 'ar', 1, 'Iron Hat' ], [ 'ar', 30, 'Barbute Helmet' ], [ 'ar', 60, 'Royal Burgonet' ],
		[ 'ev', 1, 'Leather Cap' ], [ 'ev', 30, 'Hunter Hood' ], [ 'ev', 60, 'Lion Pelt' ],
		[ 'es', 1, 'Silk Hood' ], [ 'es', 30, 'Mage Circlet' ], [ 'es', 60, 'Hubris Circlet' ],
		[ 'ar/ev', 14, 'Battered Helm' ], [ 'ar/ev', 46, 'Sallet' ], [ 'ar/es', 14, 'Bone Helmet' ],
		[ 'ar/es', 46, 'Crusader Helmet' ], [ 'ev/es', 14, 'Scare Mask' ], [ 'ev/es', 46, 'Deicide Mask' ]
	],
	chest: [
		[ 'ar', 1, 'Plate Vest' ], [ 'ar', 30, 'Full Plate' ], [ 'ar', 60, 'Glorious Plate' ],
		[ 'ev', 1, 'Shabby Jerkin' ], [ 'ev', 30, "Thief's Garb" ], [ 'ev', 60, "Assassin's Garb" ],
		[ 'es', 1, 'Simple Robe' ], [ 'es', 30, 'Silk Robe' ], [ 'es', 60, 'Vaal Regalia' ],
		[ 'ar/ev', 14, 'Brigandine' ], [ 'ar/ev', 46, "General's Brigandine" ], [ 'ar/es', 14, 'Chainmail Vest' ],
		[ 'ar/es', 46, "Saint's Hauberk" ], [ 'ev/es', 14, 'Padded Vest' ], [ 'ev/es', 46, 'Carnal Armour' ]
	],
	gloves: [
		[ 'ar', 1, 'Iron Gauntlets' ], [ 'ar', 30, 'Steel Gauntlets' ], [ 'ar', 60, 'Titan Gauntlets' ],
		[ 'ev', 1, 'Rawhide Gloves' ], [ 'ev', 30, 'Eelskin Gloves' ], [ 'ev', 60, 'Slink Gloves' ],
		[ 'es', 1, 'Wool Gloves' ], [ 'es', 30, 'Satin Gloves' ], [ 'es', 60, 'Sorcerer Gloves' ],
		[ 'ar/ev', 22, 'Ringmail Gloves' ], [ 'ev/es', 22, 'Fishscale Gauntlets' ]
	],
	boots: [
		[ 'ar', 1, 'Iron Greaves' ], [ 'ar', 30, 'Steel Greaves' ], [ 'ar', 60, 'Titan Greaves' ],
		[ 'ev', 1, 'Rawhide Boots' ], [ 'ev', 30, 'Eelskin Boots' ], [ 'ev', 60, 'Slink Boots' ],
		[ 'es', 1, 'Wool Shoes' ], [ 'es', 30, 'Velvet Slippers' ], [ 'es', 60, 'Sorcerer Boots' ],
		[ 'ar/ev', 22, 'Leatherscale Boots' ], [ 'ar/es', 22, 'Chain Boots' ]
	],
	shield: [
		[ 'ar', 1, 'Plank Shield' ], [ 'ar', 30, 'Tower Shield' ], [ 'ar', 60, 'Pinnacle Tower Shield' ],
		[ 'ev', 1, 'Goathide Buckler' ], [ 'ev', 30, 'Spiked Buckler' ], [ 'ev', 60, 'Imperial Buckler' ],
		[ 'es', 1, 'Twig Spirit Shield' ], [ 'es', 30, 'Ivory Spirit Shield' ], [ 'es', 60, 'Titanium Spirit Shield' ]
	]
};

const SHIELD_BLOCK = { ar: 24, ev: 20, es: 18 };

for ( const [ slot, rows ] of Object.entries( ARMOUR ) ) {

	for ( const [ type, level, name ] of rows ) {

		const T = DEF_TYPES[ type ], m = SLOT_DEF[ slot ];
		const hybrid = type.includes( '/' ) ? 0.6 : 1;
		const defence = {};
		if ( type.includes( 'ar' ) ) defence.armor = armourAt( level, m.ar * hybrid );
		if ( type.includes( 'ev' ) ) defence.evasion = evasionAt( level, m.ev * hybrid );
		if ( type.includes( 'es' ) ) defence.shield = shieldAt( level, m.es * hybrid );
		const isShield = slot === 'shield';
		define( 'itemBase', {
			id: name.toLowerCase().replace( /[^a-z]+/g, '-' ), name, slot: isShield ? 'offhand' : slot, level,
			tags: [ 'armour', slot, ...T.tags ], defence, block: isShield ? SHIELD_BLOCK[ type ] : 0,
			implicit: isShield && type === 'es' ? [ { stat: 'damage', type: 'inc', range: [ 10, 20 ], tags: [ 'spell' ] } ] : [],
			req: req( level, T.split ),
			model: isShield ? { gear: 'shield', color: T.color } : { gear: slot, color: T.color }, icon: isShield ? 'shield' : slot
		} );

	}

}

// --- off-hand quivers and foci -------------------------------------------------------

const OFFHANDS = [
	[ 'quiver', 1, 'Feathered Quiver', [ { stat: 'projectile_speed', type: 'inc', range: [ 15, 25 ] } ], { dex: 1 } ],
	[ 'quiver', 24, 'Serrated Arrow Quiver', [ { stat: 'added_physical_min', type: 'flat', range: [ 2, 4 ], tags: [ 'attack' ] }, { stat: 'added_physical_max', type: 'flat', range: [ 7, 10 ], tags: [ 'attack' ] } ], { dex: 1 } ],
	[ 'quiver', 48, 'Broadhead Quiver', [ { stat: 'damage', type: 'inc', range: [ 20, 30 ], tags: [ 'projectile' ] } ], { dex: 1 } ],
	[ 'focus', 1, 'Twig Focus', [ { stat: 'damage', type: 'inc', range: [ 10, 16 ], tags: [ 'spell' ] } ], { int: 1 } ],
	[ 'focus', 30, 'Crystal Focus', [ { stat: 'cast_speed', type: 'inc', range: [ 8, 12 ] } ], { int: 1 } ],
	[ 'focus', 58, 'Sigil Focus', [ { stat: 'crit_chance', type: 'inc', range: [ 30, 40 ], tags: [ 'spell' ] } ], { int: 1 } ]
];

for ( const [ kind, level, name, implicit, split ] of OFFHANDS ) {

	define( 'itemBase', {
		id: name.toLowerCase().replace( /[^a-z]+/g, '-' ), name, slot: 'offhand', level, tags: [ kind, kind === 'focus' ? 'caster' : 'ranged' ],
		defence: kind === 'focus' ? { shield: shieldAt( level, 0.8 ) } : {}, implicit, req: req( level, split ),
		model: { gear: kind, color: kind === 'focus' ? '#7a8fd0' : '#8a6a48' }, icon: kind
	} );

}

// --- jewellery -----------------------------------------------------------------------

const JEWELLERY = [
	[ 'belt', 1, 'Rustic Sash', [ { stat: 'damage', type: 'inc', range: [ 12, 24 ], tags: [ 'physical' ] } ] ],
	[ 'belt', 8, 'Leather Belt', [ { stat: 'life', type: 'flat', range: [ 25, 40 ] } ] ],
	[ 'belt', 14, 'Heavy Belt', [ { stat: 'strength', type: 'flat', range: [ 25, 35 ] } ] ],
	[ 'belt', 20, 'Chain Belt', [ { stat: 'shield', type: 'flat', range: [ 9, 20 ] } ] ],
	[ 'belt', 44, 'Crystal Belt', [ { stat: 'shield', type: 'flat', range: [ 60, 80 ] } ] ],
	[ 'belt', 58, 'Vanguard Belt', [ { stat: 'armor', type: 'flat', range: [ 260, 320 ] } ] ],
	[ 'amulet', 1, 'Coral Amulet', [ { stat: 'life_regen', type: 'flat', range: [ 2, 4 ] } ] ],
	[ 'amulet', 4, 'Amber Amulet', [ { stat: 'strength', type: 'flat', range: [ 20, 30 ] } ] ],
	[ 'amulet', 4, 'Jade Amulet', [ { stat: 'dexterity', type: 'flat', range: [ 20, 30 ] } ] ],
	[ 'amulet', 4, 'Lapis Amulet', [ { stat: 'intelligence', type: 'flat', range: [ 20, 30 ] } ] ],
	[ 'amulet', 18, 'Gold Amulet', [ { stat: 'item_rarity', type: 'flat', range: [ 12, 20 ] } ] ],
	[ 'amulet', 22, 'Citrine Amulet', [ { stat: 'strength', type: 'flat', range: [ 16, 24 ] }, { stat: 'dexterity', type: 'flat', range: [ 16, 24 ] } ] ],
	[ 'amulet', 22, 'Turquoise Amulet', [ { stat: 'dexterity', type: 'flat', range: [ 16, 24 ] }, { stat: 'intelligence', type: 'flat', range: [ 16, 24 ] } ] ],
	[ 'amulet', 22, 'Agate Amulet', [ { stat: 'strength', type: 'flat', range: [ 16, 24 ] }, { stat: 'intelligence', type: 'flat', range: [ 16, 24 ] } ] ],
	[ 'amulet', 40, 'Onyx Amulet', [ { stat: 'strength', type: 'flat', range: [ 10, 16 ] }, { stat: 'dexterity', type: 'flat', range: [ 10, 16 ] }, { stat: 'intelligence', type: 'flat', range: [ 10, 16 ] } ] ],
	[ 'ring', 1, 'Iron Ring', [ { stat: 'added_physical_min', type: 'flat', range: [ 1, 1 ], tags: [ 'attack' ] }, { stat: 'added_physical_max', type: 'flat', range: [ 3, 4 ], tags: [ 'attack' ] } ] ],
	[ 'ring', 2, 'Coral Ring', [ { stat: 'life', type: 'flat', range: [ 20, 30 ] } ] ],
	[ 'ring', 8, 'Ruby Ring', [ { stat: 'res_fire', type: 'flat', range: [ 20, 30 ] } ] ],
	[ 'ring', 12, 'Sapphire Ring', [ { stat: 'res_cold', type: 'flat', range: [ 20, 30 ] } ] ],
	[ 'ring', 16, 'Topaz Ring', [ { stat: 'res_lightning', type: 'flat', range: [ 20, 30 ] } ] ],
	[ 'ring', 20, 'Moonstone Ring', [ { stat: 'shield', type: 'flat', range: [ 15, 25 ] } ] ],
	[ 'ring', 24, 'Gold Ring', [ { stat: 'item_rarity', type: 'flat', range: [ 6, 15 ] } ] ],
	[ 'ring', 30, 'Amethyst Ring', [ { stat: 'res_chaos', type: 'flat', range: [ 17, 23 ] } ] ],
	[ 'ring', 34, 'Two-Stone Ring', [ { stat: 'res_fire', type: 'flat', range: [ 12, 16 ] }, { stat: 'res_cold', type: 'flat', range: [ 12, 16 ] } ] ],
	[ 'ring', 40, 'Diamond Ring', [ { stat: 'crit_chance', type: 'inc', range: [ 20, 30 ] } ] ],
	[ 'ring', 52, 'Prismatic Ring', [ { stat: 'res_fire', type: 'flat', range: [ 8, 10 ] }, { stat: 'res_cold', type: 'flat', range: [ 8, 10 ] }, { stat: 'res_lightning', type: 'flat', range: [ 8, 10 ] } ] ]
];

const GEM_COLORS = { Coral: '#ff7f6e', Amber: '#ffb347', Jade: '#5fd38a', Lapis: '#4d7cff', Gold: '#ffd34d', Citrine: '#ffd84d', Turquoise: '#4dd6d0', Agate: '#c08a6a', Onyx: '#30343c', Ruby: '#e0304a', Sapphire: '#3a6cf0', Topaz: '#f0d040', Moonstone: '#c8d8ff', Amethyst: '#9a5cd0', Diamond: '#eef6ff', Prismatic: '#ff8af0', Iron: '#9a9aa0', 'Two-Stone': '#e07050' };

for ( const [ slot, level, name, implicit ] of JEWELLERY ) {

	const gem = name.split( ' ' )[ 0 ];
	define( 'itemBase', {
		id: name.toLowerCase().replace( /[^a-z]+/g, '-' ), name, slot, level, tags: [ 'jewellery', slot ], implicit, req: { level },
		model: { gear: slot, color: GEM_COLORS[ gem ] || '#c9a227' }, icon: slot
	} );

}

// --- flasks --------------------------------------------------------------------------
// kind: life | mana | hybrid recover over `duration`; utility flasks grant a buff
// (stat mods while active). Charges: `max` held, `use` spent per drink; kills refill.

const LIFE_TIERS = [ [ 1, 'Small', 70 ], [ 8, 'Medium', 150 ], [ 18, 'Large', 250 ], [ 30, 'Greater', 360 ], [ 42, 'Grand', 480 ], [ 54, 'Giant', 620 ], [ 66, 'Colossal', 780 ], [ 78, 'Divine', 960 ] ];
for ( const [ level, size, amount ] of LIFE_TIERS ) {

	define( 'itemBase', { id: `${size.toLowerCase()}-life-flask`, name: `${size} Life Flask`, slot: 'flask', level, tags: [ 'flask', 'life_flask' ], implicit: [], req: { level },
		flask: { kind: 'life', amount, duration: 2.5, max: 30, use: 10 }, model: { color: '#e04848' }, icon: 'flask-life' } );
	define( 'itemBase', { id: `${size.toLowerCase()}-mana-flask`, name: `${size} Mana Flask`, slot: 'flask', level: level + 1, tags: [ 'flask', 'mana_flask' ], implicit: [], req: { level: level + 1 },
		flask: { kind: 'mana', amount: Math.round( amount * 0.55 ), duration: 3, max: 30, use: 7 }, model: { color: '#4878e0' }, icon: 'flask-mana' } );

}

for ( const [ level, size, amount ] of [ [ 10, 'Small', 110 ], [ 34, 'Large', 320 ], [ 65, 'Divine', 720 ] ] ) {

	define( 'itemBase', { id: `${size.toLowerCase()}-hybrid-flask`, name: `${size} Hybrid Flask`, slot: 'flask', level, tags: [ 'flask', 'life_flask', 'mana_flask' ], implicit: [], req: { level },
		flask: { kind: 'hybrid', amount, duration: 3, max: 30, use: 12 }, model: { color: '#a050c0' }, icon: 'flask-hybrid' } );

}

const UTILITY = [
	[ 4, 'Quicksilver Flask', [ { stat: 'move_speed', type: 'inc', value: 40 } ], '#d8e0e8' ],
	[ 12, 'Granite Flask', [ { stat: 'armor', type: 'flat', value: 1500 } ], '#9a9080' ],
	[ 14, 'Jade Flask', [ { stat: 'evade_chance', type: 'flat', value: 15 } ], '#5fd38a' ],
	[ 18, 'Ruby Flask', [ { stat: 'res_fire', type: 'flat', value: 40 }, { stat: 'max_res_fire', type: 'flat', value: 5 } ], '#e0304a' ],
	[ 18, 'Sapphire Flask', [ { stat: 'res_cold', type: 'flat', value: 40 }, { stat: 'max_res_cold', type: 'flat', value: 5 } ], '#3a6cf0' ],
	[ 18, 'Topaz Flask', [ { stat: 'res_lightning', type: 'flat', value: 40 }, { stat: 'max_res_lightning', type: 'flat', value: 5 } ], '#f0d040' ],
	[ 27, 'Amethyst Flask', [ { stat: 'res_chaos', type: 'flat', value: 35 } ], '#9a5cd0' ],
	[ 27, 'Diamond Flask', [ { stat: 'crit_chance', type: 'more', value: 50 } ], '#eef6ff' ],
	[ 35, 'Silver Flask', [ { stat: 'attack_speed', type: 'inc', value: 20 }, { stat: 'cast_speed', type: 'inc', value: 20 }, { stat: 'move_speed', type: 'inc', value: 20 } ], '#c8ccd4' ],
	[ 40, 'Basalt Flask', [ { stat: 'damage_taken', type: 'more', value: - 15, tags: [ 'physical' ] } ], '#606870' ],
	[ 48, 'Bismuth Flask', [ { stat: 'res_fire', type: 'flat', value: 30 }, { stat: 'res_cold', type: 'flat', value: 30 }, { stat: 'res_lightning', type: 'flat', value: 30 } ], '#ff8af0' ]
];

for ( const [ level, name, buff, color ] of UTILITY ) {

	define( 'itemBase', { id: name.toLowerCase().replace( /[^a-z]+/g, '-' ), name, slot: 'flask', level, tags: [ 'flask', 'utility_flask' ], implicit: [], req: { level },
		flask: { kind: 'utility', duration: 5, max: 60, use: 30, buff }, model: { color }, icon: 'flask-utility' } );

}
