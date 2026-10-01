// Player stats from progression: one BUILD computation feeds six 'statSource' defs
// (level, attributes, gear, tree, derived, flasks), so the character sheet can say
// exactly where every number comes from ( StatBlock.breakdown lists each mod with
// its `from` - "Gale Grip", "Thick Skin", "Strength" ).
//
// Order of the build (each step can depend on the previous ones):
//   1. level      +12 life and +6 mana per level, 10 of each attribute
//   2. tree       allocated passives + ascendancy
//   3. gear       weapon damage / speed / crit, armour-piece defences, item modifiers;
//                 keystones granted by uniques
//   4. transform  keystones that rewrite mods (Avatar of Fire converts added damage)
//   5. attributes read from 1-4; items whose requirements are no longer met are
//                 DISABLED (their mods ignored) and the build is recomputed once
//   6. attribute bonuses   STR: +0.5 life, +0.2% melee physical damage
//                          DEX: +0.2% evasion, +0.08% attack speed
//                          INT: +0.5 mana, +0.2% spell damage, +0.2% energy shield
//   7. derive     keystones computed from the totals (Eldritch Battery, Iron Reflexes)
//   8. caps       evade and block are capped at 75%

import { define, get } from '../../core/registry.js';
import { StatBlock } from '../../core/stats.js';
import { PLAYER_BASE } from '../../game.js';
import { computeItem, meetsReq } from './items.js';
import { treeMods, treeProviders } from './tree.js';
import { ensureSave } from './save.js';
import { EQUIP_SLOTS, WEAPON_CLASSES } from './data/bases.js';

export const EVADE_CAP = 75;
export const BLOCK_CAP = 75;
export const STATIC_FLAGS = [ 'two_handed', 'dual_wield', 'holding_shield', 'unarmed', ...WEAPON_CLASSES.map( ( c ) => 'wielding_' + c ) ];

export function levelMods( level ) {

	const from = 'Level';
	return [
		{ stat: 'life', type: 'flat', value: 12 * ( level - 1 ), from }, { stat: 'mana', type: 'flat', value: 6 * ( level - 1 ), from },
		{ stat: 'strength', type: 'flat', value: 10, from }, { stat: 'dexterity', type: 'flat', value: 10, from }, { stat: 'intelligence', type: 'flat', value: 10, from }
	];

}

// Rule-changing providers (uniques with mechanics, keystones, ascendancy notables).
// `granted` marks keystones that come from an item or ascendancy node rather than
// the tree itself (their mods are added by the build, not by the node).
export function activeProviders( save, equipment = save.equipment, disabled = new Set() ) {

	const out = [], seen = new Set();
	const add = ( def, key, source, granted = false ) => {

		if ( ! def || seen.has( key ) ) return;
		seen.add( key );
		out.push( { key, def, source, granted } );

	};

	for ( const n of treeProviders( save ) ) {

		if ( n.kind === 'keystone' ) add( n, 'k:' + n.id, 'tree' );
		else {

			add( n, 'a:' + n.id, 'tree' );
			for ( const g of n.grants || [] ) add( get( 'keystone', g ), 'k:' + g, n.name, true );

		}

	}

	for ( const slot of EQUIP_SLOTS ) {

		const item = equipment[ slot ];
		if ( ! item?.unique || disabled.has( slot ) ) continue;
		const u = get( 'unique', item.unique );
		if ( ! u ) continue;
		if ( u.hooks ) add( u, 'u:' + item.uid, item );
		for ( const g of u.grants || [] ) add( get( 'keystone', g ), 'k:' + g, u.name, true );

	}

	return out;

}

// Weapon, defences and item modifiers of the equipped gear.
export function gearMods( equipment, disabled = new Set() ) {

	const mods = [], flags = [];
	const model = { weapon: null, gear: {} };
	const on = ( slot ) => equipment[ slot ] && ! disabled.has( slot ) ? equipment[ slot ] : null;
	for ( const slot of EQUIP_SLOTS ) {

		const item = on( slot );
		if ( ! item ) continue;
		const c = computeItem( item );
		mods.push( ...c.mods );
		const from = c.name;
		if ( c.defence ) {

			if ( c.defence.armor ) mods.push( { stat: 'armor', type: 'flat', value: c.defence.armor, from } );
			if ( c.defence.evasion ) mods.push( { stat: 'evade_chance', type: 'flat', value: c.defence.evasion, from } );
			if ( c.defence.shield ) mods.push( { stat: 'shield', type: 'flat', value: c.defence.shield, from } );
			if ( c.defence.block ) mods.push( { stat: 'block_chance', type: 'flat', value: c.defence.block, from } );

		}

		if ( slot !== 'weapon' && slot !== 'offhand' && c.base.model ) model.gear[ slot ] = c.base.model.color;

	}

	const w = on( 'weapon' ) ? computeItem( on( 'weapon' ) ) : null;
	const o = on( 'offhand' ) ? computeItem( on( 'offhand' ) ) : null;
	if ( w?.weapon ) {

		const W = w.weapon, from = w.name;
		mods.push( { stat: 'added_physical_min', type: 'flat', value: W.min, tags: [ 'attack' ], from }, { stat: 'added_physical_max', type: 'flat', value: W.max, tags: [ 'attack' ], from } );
		if ( W.aps !== 1 ) mods.push( { stat: 'attack_speed', type: 'more', value: Math.round( ( W.aps - 1 ) * 1000 ) / 10, tags: [ 'attack' ], from: from + ' (base speed)' } );
		mods.push( { stat: 'crit_chance', type: 'flat', value: Math.round( ( W.crit - PLAYER_BASE.crit_chance ) * 10 ) / 10, tags: [ 'attack' ], from: from + ' (base crit)' } );
		flags.push( 'wielding_' + W.cls );
		if ( W.hands === 2 ) flags.push( 'two_handed' );
		model.weapon = { base: w.base.model?.weapon ?? W.cls, item: w.base.id, cls: W.cls, hands: W.hands, rarity: on( 'weapon' ).rarity, color: uniqueColor( on( 'weapon' ) ) ?? w.base.model?.color };

	} else flags.push( 'unarmed' );

	if ( o?.weapon ) {

		// dual wielding: the off-hand adds 40% of its physical damage and the pair attacks 10% faster
		const W = o.weapon, from = o.name + ' (off hand)';
		mods.push( { stat: 'added_physical_min', type: 'flat', value: Math.round( W.min * 0.4 ), tags: [ 'attack' ], from }, { stat: 'added_physical_max', type: 'flat', value: Math.round( W.max * 0.4 ), tags: [ 'attack' ], from } );
		mods.push( { stat: 'attack_speed', type: 'more', value: 10, tags: [ 'attack' ], from: 'Dual Wielding' } );
		flags.push( 'dual_wield', 'wielding_' + W.cls );
		model.gear.offhand = { kind: 'weapon', base: o.base.model?.weapon ?? W.cls, color: uniqueColor( on( 'offhand' ) ) ?? o.base.model?.color };

	} else if ( o ) {

		if ( o.base.tags.includes( 'shield' ) ) flags.push( 'holding_shield' );
		model.gear.offhand = { kind: o.base.model?.gear ?? 'shield', color: uniqueColor( on( 'offhand' ) ) ?? o.base.model?.color };

	}

	return { mods, flags, model };

}

function uniqueColor( item ) {

	return item?.unique ? get( 'unique', item.unique )?.color ?? null : null;

}

export function attributeMods( a ) {

	const r = ( v ) => Math.round( v * 10 ) / 10;
	const S = 'Strength', D = 'Dexterity', I = 'Intelligence';
	return [
		{ stat: 'life', type: 'flat', value: r( a.strength * 0.5 ), from: S },
		{ stat: 'damage', type: 'inc', value: r( a.strength * 0.2 ), tags: [ 'melee', 'physical' ], from: S },
		{ stat: 'evade_chance', type: 'inc', value: r( a.dexterity * 0.2 ), from: D },
		{ stat: 'attack_speed', type: 'inc', value: r( a.dexterity * 0.08 ), from: D },
		{ stat: 'mana', type: 'flat', value: r( a.intelligence * 0.5 ), from: I },
		{ stat: 'damage', type: 'inc', value: r( a.intelligence * 0.2 ), tags: [ 'spell' ], from: I },
		{ stat: 'shield', type: 'inc', value: r( a.intelligence * 0.2 ), from: I }
	];

}

// A stat's value ignoring overrides ("what would the build have without the keystone").
export function rawValue( S, stat, tags = [] ) {

	const b = S.breakdown( stat, tags, false );
	return ( b.base + b.flat ) * Math.max( 0, 1 + b.inc / 100 ) * b.more;

}

function tempBlock( mods ) {

	const T = new StatBlock( PLAYER_BASE );
	T.setSource( 'build', mods );
	return T;

}

const attrsOf = ( T ) => ( { strength: Math.round( T.get( 'strength' ) ), dexterity: Math.round( T.get( 'dexterity' ) ), intelligence: Math.round( T.get( 'intelligence' ) ) } );

// The whole build. `equipment` overrides the saved gear (tooltip comparisons);
// `ignoreReq` names a slot whose requirements are ignored ("what if I could wear it").
export function buildMods( game, { equipment = null, ignoreReq = null } = {} ) {

	const save = ensureSave( game.save );
	const level = save.level;
	const eq = equipment || save.equipment;
	const lvl = levelMods( level );
	const tm = treeMods( save );
	let disabled = new Set();
	let gear, providers, mods, T, attrs;
	const run = () => {

		gear = gearMods( eq, disabled );
		providers = activeProviders( save, eq, disabled );
		const granted = providers.filter( ( p ) => p.granted ).flatMap( ( p ) => ( p.def.mods || [] ).map( ( m ) => ( { ...m, from: p.def.name } ) ) );
		mods = { level: lvl, tree: tm, gear: gear.mods, granted };
		for ( const p of providers ) if ( p.def.transform ) for ( const k in mods ) mods[ k ] = p.def.transform( mods[ k ] );
		T = tempBlock( [ ...mods.level, ...mods.tree, ...mods.gear, ...mods.granted ] );
		attrs = attrsOf( T );

	};

	run();
	for ( const slot of EQUIP_SLOTS ) if ( eq[ slot ] && slot !== ignoreReq && meetsReq( eq[ slot ], attrs, level ).length ) disabled.add( slot );
	if ( disabled.size ) run();

	const attr = attributeMods( attrs );
	T.setSource( 'attr', attr );
	const derived = [];
	for ( const p of providers ) if ( p.def.derive ) for ( const m of p.def.derive( T, level, ( s, t ) => rawValue( T, s, t ) ) ) derived.push( { ...m, from: p.def.name } );
	T.setSource( 'derived', derived );
	if ( T.get( 'evade_chance' ) > EVADE_CAP ) derived.push( { stat: 'evade_chance', type: 'override', value: EVADE_CAP, from: `Evasion cap (${EVADE_CAP}%)` } );
	if ( T.get( 'block_chance' ) > BLOCK_CAP ) derived.push( { stat: 'block_chance', type: 'override', value: BLOCK_CAP, from: `Block cap (${BLOCK_CAP}%)` } );
	let lowLife = 0.35;
	for ( const p of providers ) if ( p.def.lowLife ) lowLife = Math.max( lowLife, p.def.lowLife );
	return { ...mods, attributes: attr, derived, flags: gear.flags, model: gear.model, disabled, attrs, providers, lowLife };

}

// --- stat sources ---------------------------------------------------------------------------------
// 'prog-level' runs first in Game.applyPlayerStats() (registration order) and caches
// the build on the player for the sources after it.

function buildFor( game, p, fresh ) {

	if ( fresh || ! p.data.progBuild ) {

		const b = buildMods( game );
		p.data.progBuild = b;
		// stats with no engine base: give damage_taken a base of 1 so "less damage taken" works
		if ( p.stats.base.damage_taken === undefined ) p.stats.base.damage_taken = 1;
		for ( const f of STATIC_FLAGS ) p.stats.setFlag( f, b.flags.includes( f ) );
		p.data.lowLifeAt = b.lowLife;
		if ( p.model ) {

			p.model.weapon = b.model.weapon;
			p.model.gear = b.model.gear;

		}

	}

	return p.data.progBuild;

}

define( 'statSource', { id: 'prog-level', mods: ( game, p ) => buildFor( game, p, true ).level } );
define( 'statSource', { id: 'prog-attributes', mods: ( game, p ) => buildFor( game, p ).attributes } );
define( 'statSource', { id: 'prog-gear', mods: ( game, p ) => buildFor( game, p ).gear } );
define( 'statSource', { id: 'prog-tree', mods: ( game, p ) => [ ...buildFor( game, p ).tree, ...buildFor( game, p ).granted ] } );
define( 'statSource', { id: 'prog-derived', mods: ( game, p ) => buildFor( game, p ).derived } );
define( 'statSource', { id: 'prog-flasks', mods: ( game, p ) => p.data.progFlaskMods || [] } );

export const SOURCE_NAMES = {
	'src:prog-level': 'Level', 'src:prog-attributes': 'Attributes', 'src:prog-gear': 'Gear', 'src:prog-tree': 'Passive Tree',
	'src:prog-derived': 'Keystones & caps', 'src:prog-flasks': 'Flasks', tuning: 'Difficulty sliders'
};

// A stand-alone StatBlock for "what if" questions: the player's current stats with
// progression's sources rebuilt from `opts` (e.g. a different item in a slot).
export function simulateStats( game, opts = {} ) {

	const p = game.world?.player;
	const S = new StatBlock( PLAYER_BASE );
	S.base.damage_taken = 1;
	if ( p ) {

		for ( const [ k, mods ] of p.stats.sources ) if ( ! k.startsWith( 'src:prog-' ) ) S.setSource( k, mods );
		for ( const f of p.stats.flags ) if ( ! STATIC_FLAGS.includes( f ) ) S.setFlag( f );
		S.setSource( 'src:prog-flasks', p.data.progFlaskMods || [] );

	}

	const b = buildMods( game, opts );
	S.setSource( 'src:prog-level', b.level );
	S.setSource( 'src:prog-attributes', b.attributes );
	S.setSource( 'src:prog-gear', b.gear );
	S.setSource( 'src:prog-tree', [ ...b.tree, ...b.granted ] );
	S.setSource( 'src:prog-derived', b.derived );
	for ( const f of b.flags ) S.setFlag( f );
	return S;

}

// Average damage of one attack hit (before enemy mitigation) and an attack-rate
// based DPS estimate (1 attack per second at 100% attack speed) - the number the
// item comparison and character sheet show. Skills multiply it further.
export function estimateAttack( S, tags = [ 'attack', 'melee' ] ) {

	let hit = 0;
	const byType = {};
	for ( const type of [ 'physical', 'fire', 'cold', 'lightning', 'chaos' ] ) {

		const lo = S.get( `added_${type}_min`, tags ), hi = S.get( `added_${type}_max`, tags );
		if ( hi <= 0 ) continue;
		const v = ( lo + hi ) / 2 * S.get( 'damage', tags.concat( type ) );
		byType[ type ] = v;
		hit += v;

	}

	const c = S.breakdown( 'crit_chance', tags, false );
	const chance = Math.min( 100, c.override ?? ( c.base + c.flat ) * Math.max( 0, 1 + c.inc / 100 ) * c.more );
	const multi = S.get( 'crit_multi', tags ) / 100;
	const critFactor = 1 + chance / 100 * Math.max( 0, multi - 1 );
	const aps = Math.max( 0.1, S.get( 'attack_speed', tags ) );
	return { hit, byType, crit: chance, multi: multi * 100, aps, dps: hit * critFactor * aps };

}

// Key numbers for item comparisons: [ label, stat getter, format ]
export const COMPARE_STATS = [
	[ 'Attack DPS', ( S ) => estimateAttack( S ).dps, 0 ],
	[ 'Maximum Life', ( S ) => S.get( 'life' ), 0 ],
	[ 'Maximum Mana', ( S ) => S.get( 'mana' ), 0 ],
	[ 'Energy Shield', ( S ) => S.get( 'shield' ), 0 ],
	[ 'Armour', ( S ) => S.get( 'armor' ), 0 ],
	[ 'Evade Chance', ( S ) => S.get( 'evade_chance' ), 1, '%' ],
	[ 'Block Chance', ( S ) => S.get( 'block_chance' ), 1, '%' ],
	[ 'Fire Resistance', ( S ) => Math.min( S.get( 'res_fire' ), S.get( 'max_res_fire' ) ), 0, '%' ],
	[ 'Cold Resistance', ( S ) => Math.min( S.get( 'res_cold' ), S.get( 'max_res_cold' ) ), 0, '%' ],
	[ 'Lightning Resistance', ( S ) => Math.min( S.get( 'res_lightning' ), S.get( 'max_res_lightning' ) ), 0, '%' ],
	[ 'Chaos Resistance', ( S ) => Math.min( S.get( 'res_chaos' ), S.get( 'max_res_chaos' ) ), 0, '%' ],
	[ 'Movement Speed', ( S ) => S.get( 'move_speed' ), 2 ],
	[ 'Attack Speed', ( S ) => S.get( 'attack_speed', [ 'attack' ] ) * 100, 0, '%' ],
	[ 'Cast Speed', ( S ) => S.get( 'cast_speed', [ 'spell' ] ) * 100, 0, '%' ],
	[ 'Spell Damage', ( S ) => ( S.get( 'damage', [ 'spell', 'fire' ] ) + S.get( 'damage', [ 'spell', 'cold' ] ) + S.get( 'damage', [ 'spell', 'lightning' ] ) ) / 3 * 100, 0, '%' ],
	[ 'Life Regeneration', ( S ) => S.get( 'life_regen' ) + S.get( 'life' ) * S.get( 'life_regen_pct' ) / 100, 1, '/s' ],
	[ 'Strength', ( S ) => S.get( 'strength' ), 0 ],
	[ 'Dexterity', ( S ) => S.get( 'dexterity' ), 0 ],
	[ 'Intelligence', ( S ) => S.get( 'intelligence' ), 0 ],
	[ 'Item Rarity', ( S ) => S.get( 'item_rarity' ), 0, '%' ]
];

// Differences between two StatBlocks over COMPARE_STATS (only the ones that change).
export function compareStats( before, after ) {

	const out = [];
	for ( const [ label, fn, dec, unit = '' ] of COMPARE_STATS ) {

		const a = fn( before ), b = fn( after );
		const p = Math.pow( 10, dec );
		const d = Math.round( ( b - a ) * p ) / p;
		if ( Math.abs( d ) > 0.5 / p ) out.push( { label, before: a, after: b, delta: d, unit } );

	}

	return out;

}
