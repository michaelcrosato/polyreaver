// Persistent character data owned by progression. Every field is a 'saveField' def,
// so Game.newSave() fills it for new characters and Game.upgradeSave() adds it to
// old save files. Everything is plain JSON (main.js writes game.save to localStorage).
//
//   inventory   { size, items: [ item | null ] }          60 cells, one item each
//   equipment   { weapon, offhand, helm, chest, gloves, boots, belt, amulet, ring1, ring2 }
//   flasks      { slots: [ item | null ] x4 }              flask items with `charges`
//   stash       { tabs: [ { name, items } ] }
//   currencies  { transmute: n, ... }                        the currency pouch
//   skills      { known, bar[6], supports: { skill: [ids] }, levels, xp, runes }
//   tree        { start, allocated, respecs, version, asc: { id, allocated }, bonus }
//   vendor      { visit, stockVisit, stock, buyback }
//   unlocks     { stashTabs, autoPickup, ... }
//   lifetime    { kills, items, uniques, gold, deaths, playTime, ... }
//   progression { version }                                  migration marker
//
// MIGRATION: bump SAVE_VERSION and add a step to MIGRATIONS; ensureSave() runs the
// missing steps once per save object (every entry point calls it, so the order in
// which systems touch the save never matters).

import { define, all, get } from '../../core/registry.js';
import { RNG } from '../../core/rng.js';
import { makeItem, newUid, RARITIES } from './items.js';
import { newTreeSave, validateTree, validateTreeSave } from './tree.js';
import { newSkillsSave, ensureLoadout, validateSkillsSave } from './skills.js';
import { EQUIP_SLOTS } from './data/bases.js';
import { inRollRange, validAffixRoll, validImplicitRoll, validUniqueRoll } from './item-validation.js';
import { xpToNext } from '../../core/tuning.js';

export const SAVE_VERSION = 1;
export const INVENTORY_SIZE = 60;
export const STASH_TAB_SIZE = 60;
export const MAX_STASH_TABS = 8;
export const MAX_CHARACTER_LEVEL = 10000;
export const MAX_CHARACTER_DEPTH = 10000;

const empty = ( n ) => new Array( n ).fill( null );

export function starterEquipment() {

	const rng = new RNG( 'starter-kit' );
	const eq = {};
	for ( const s of EQUIP_SLOTS ) eq[ s ] = null;
	eq.weapon = makeItem( 'rusted-blade', 1, 'normal', rng );
	return eq;

}

export function starterFlasks() {

	const rng = new RNG( 'starter-flasks' );
	return { slots: [ makeItem( 'small-life-flask', 1, 'normal', rng ), makeItem( 'small-mana-flask', 2, 'normal', rng ), null, null ] };

}

define( 'saveField', { id: 'inventory', init: () => ( { size: INVENTORY_SIZE, items: empty( INVENTORY_SIZE ) } ) } );
define( 'saveField', { id: 'equipment', init: starterEquipment } );
define( 'saveField', { id: 'flasks', init: starterFlasks } );
define( 'saveField', { id: 'stash', init: () => ( { tabs: [ { name: 'Stash 1', items: empty( STASH_TAB_SIZE ) }, { name: 'Stash 2', items: empty( STASH_TAB_SIZE ) } ] } ) } );
define( 'saveField', { id: 'currencies', init: () => ( { transmute: 2, augment: 1 } ) } );
define( 'saveField', { id: 'skills', init: newSkillsSave } );
define( 'saveField', { id: 'tree', init: newTreeSave } );
define( 'saveField', { id: 'vendor', init: () => ( { visit: 0, stockVisit: - 1, stock: [], buyback: [] } ) } );
define( 'saveField', { id: 'unlocks', init: () => ( { stashTabs: 2, autoPickup: 'magic', lootLabels: 'all' } ) } );
define( 'saveField', { id: 'lifetime', init: () => ( { kills: {}, items: {}, uniques: [], gold: 0, deaths: 0, playTime: 0, currencyUsed: 0, flasksDrunk: 0, highestHit: 0, levelsCompleted: 0 } ) } );
define( 'saveField', { id: 'progression', init: () => ( { version: SAVE_VERSION } ) } );

// version -> step that upgrades a save FROM the previous version. Step 1 also
// repairs hand-edited or partially written saves (wrong array sizes, missing slots).
export const MIGRATIONS = {
	1( s ) {

		if ( Array.isArray( s.inventory ) ) s.inventory = { size: INVENTORY_SIZE, items: s.inventory };
		s.inventory = object( s.inventory ) ? s.inventory : { size: INVENTORY_SIZE, items: [] };
		s.inventory.items = cells( s.inventory.items, INVENTORY_SIZE );
		s.inventory.size = s.inventory.items.length;
		s.equipment = object( s.equipment ) ? s.equipment : starterEquipment();
		for ( const k of EQUIP_SLOTS ) s.equipment[ k ] = repairItem( s.equipment[ k ] );
		s.flasks = object( s.flasks ) ? s.flasks : starterFlasks();
		s.flasks.slots = cells( s.flasks.slots, 4 );
		s.stash = object( s.stash ) ? s.stash : { tabs: [] };
		s.stash.tabs = Array.isArray( s.stash.tabs ) ? s.stash.tabs.filter( object ) : [];
		if ( ! s.stash.tabs.length ) s.stash.tabs.push( { name: 'Stash 1', items: [] } );
		for ( const [ i, t ] of s.stash.tabs.entries() ) {

			t.name = typeof t.name === 'string' ? t.name.slice( 0, 80 ) : `Stash ${i + 1}`;
			t.items = cells( t.items, STASH_TAB_SIZE );

		}
		s.currencies = numbers( s.currencies );
		s.skills = object( s.skills ) ? s.skills : newSkillsSave();
		s.skills.known = strings( s.skills.known );
		s.skills.bar = Array.isArray( s.skills.bar ) ? s.skills.bar.slice( 0, 6 ).map( ( x ) => typeof x === 'string' ? x : null ) : empty( 6 );
		while ( s.skills.bar.length < 6 ) s.skills.bar.push( null );
		for ( const k of [ 'levels', 'xp', 'runes' ] ) s.skills[ k ] = numbers( s.skills[ k ] );
		s.skills.supports = object( s.skills.supports ) ? s.skills.supports : {};
		for ( const k of Object.keys( s.skills.supports ) ) s.skills.supports[ k ] = Array.isArray( s.skills.supports[ k ] ) ? s.skills.supports[ k ].filter( ( id ) => typeof id === 'string' ) : [];
		s.tree = object( s.tree ) ? s.tree : newTreeSave();
		if ( ! [ 'might', 'finesse', 'sorcery' ].includes( s.tree.start ) ) { s.tree.start = 'might'; s.tree.version = null; }
		s.tree.allocated = strings( s.tree.allocated );
		s.tree.asc = object( s.tree.asc ) ? s.tree.asc : { id: null, allocated: [] };
		s.tree.asc.allocated = strings( s.tree.asc.allocated );
		if ( typeof s.tree.asc.id !== 'string' ) s.tree.asc.id = null;
		s.tree.bonus = Math.min( 10000, Math.round( number( s.tree.bonus ) ) );
		s.tree.respecs = number( s.tree.respecs );
		s.vendor = object( s.vendor ) ? s.vendor : { visit: 0, stockVisit: - 1, stock: [], buyback: [] };
		for ( const key of [ 'stock', 'buyback' ] ) {

			s.vendor[ key ] = Array.isArray( s.vendor[ key ] ) ? s.vendor[ key ].filter( object ).filter( ( entry ) => ( entry.item = repairItem( entry.item ) ) ).map( ( entry ) => ( { ...entry, price: number( entry.price ) } ) ) : [];

		}
		s.vendor.visit = number( s.vendor.visit );
		s.vendor.stockVisit = Number.isFinite( s.vendor.stockVisit ) ? s.vendor.stockVisit : - 1;
		s.unlocks = object( s.unlocks ) ? s.unlocks : {};
		s.unlocks.stashTabs = s.stash.tabs.length;
		if ( ! [ 'none', 'unique', 'rare', 'magic', 'normal' ].includes( s.unlocks.autoPickup ) ) s.unlocks.autoPickup = 'magic';
		s.lifetime = object( s.lifetime ) ? s.lifetime : {};
		s.lifetime.kills = numbers( s.lifetime.kills );
		s.lifetime.items = numbers( s.lifetime.items );
		s.lifetime.uniques = strings( s.lifetime.uniques );
		for ( const key of [ 'gold', 'deaths', 'playTime', 'currencyUsed', 'flasksDrunk', 'highestHit', 'levelsCompleted' ] ) s.lifetime[ key ] = number( s.lifetime[ key ] );
		s.world = object( s.world ) ? s.world : {};
		s.world.best = numbers( s.world.best );
		s.world.clears = numbers( s.world.clears );
		// Excess cells from edited saves are moved into visible slots, not dropped
		// or left outside the UI's fixed grids. Unrepresentable saves need recovery.
		const overflow = [ ...s.inventory.items.splice( INVENTORY_SIZE ), ...s.flasks.slots.splice( 4 ), ...s.stash.tabs.flatMap( ( tab ) => tab.items.splice( STASH_TAB_SIZE ) ) ].filter( Boolean );
		if ( s.stash.tabs.length > MAX_STASH_TABS ) throw new Error( 'Too many stash tabs; export the original character for recovery.' );
		for ( const item of overflow ) {

			let target = [ s.inventory.items, ...s.stash.tabs.map( ( t ) => t.items ) ].find( ( a ) => a.includes( null ) );
			if ( ! target && s.stash.tabs.length < MAX_STASH_TABS ) { const tab = { name: 'Recovered items', items: empty( STASH_TAB_SIZE ) }; s.stash.tabs.push( tab ); target = tab.items; }
			if ( ! target ) throw new Error( 'Excess items cannot fit in the character. The original save must be recovered.' );
			target[ target.indexOf( null ) ] = item;

		}
		s.inventory.size = INVENTORY_SIZE;
		s.unlocks.stashTabs = s.stash.tabs.length;
		repairIdentities( s );

	}
};

const checked = new WeakSet();

const object = ( value ) => value !== null && typeof value === 'object' && ! Array.isArray( value );
const number = ( value, fallback = 0 ) => Number.isFinite( value ) && value >= 0 && value <= Number.MAX_SAFE_INTEGER ? value : fallback;
const strings = ( value ) => Array.isArray( value ) ? [ ...new Set( value.filter( ( x ) => typeof x === 'string' ) ) ] : [];
const numbers = ( value ) => Object.fromEntries( Object.entries( object( value ) ? value : {} ).filter( ( [ key ] ) => ! [ '__proto__', 'constructor', 'prototype' ].includes( key ) ).map( ( [ key, v ] ) => [ key, number( v ) ] ) );
const validMod = ( mod ) => object( mod ) && typeof mod.stat === 'string' && /^[a-z][a-z0-9_]*$/.test( mod.stat ) && [ 'flat', 'inc', 'more', 'override' ].includes( mod.type ) && Number.isFinite( mod.value ) && ( mod.tags === undefined || Array.isArray( mod.tags ) && mod.tags.every( ( tag ) => typeof tag === 'string' ) ) && ( mod.when === undefined || typeof mod.when === 'string' );
const validAffix = ( affix ) => {

	const def = object( affix ) && get( 'affix', affix.id );
	return !! def && Number.isInteger( affix.tier ) && affix.tier >= 0 && affix.tier < def.tiers.length && Array.isArray( affix.values ) && affix.values.length === def.stats.length && affix.values.every( Number.isFinite );

};
const cells = ( value, length ) => {

	const out = Array.isArray( value ) ? value.map( repairItem ) : [];
	while ( out.length < length ) out.push( null );
	return out; // Keep excess cells: repairing a save must not discard owned items.

};

function repairItem( item ) {

	if ( ! object( item ) ) return null;
	const base = get( 'itemBase', item.base );
	if ( ! base || item.unique && get( 'unique', item.unique )?.base !== item.base ) return null;
	item.rarity = RARITIES.includes( item.rarity ) ? item.rarity : 'normal';
	item.ilvl = Math.min( MAX_CHARACTER_LEVEL, Math.max( 1, Math.round( number( item.ilvl, 1 ) ) ) );
	item.quality = Math.min( 20, Math.round( number( item.quality ) ) ); item.rev = Math.min( 1e9, Math.round( number( item.rev ) ) );
	item.roll = numbers( item.roll );
	for ( const [ key, range ] of Object.entries( base.defence || {} ) ) if ( ! inRollRange( item.roll[ key ], range ) ) item.roll[ key ] = range[ 0 ];
	item.implicits = Array.isArray( item.implicits ) ? item.implicits.filter( ( mod ) => validMod( mod ) && validImplicitRoll( item, mod ) ) : [];
	item.affixes = Array.isArray( item.affixes ) ? item.affixes.filter( ( affix ) => validAffix( affix ) && validAffixRoll( item, affix ) ).slice( 0, 6 ) : [];
	if ( item.unique ) item.uvals = get( 'unique', item.unique ).mods.map( ( mod, index ) => validUniqueRoll( item, item.uvals?.[ index ], index ) ? item.uvals[ index ] : ( mod.value ?? mod.range?.[ 0 ] ?? 0 ) * ( item.corrupted && item.corruptOutcome === 'bricked' ? 0.8 : 1 ) );
	if ( base.flask ) item.charges = number( item.charges, base.flask.max );
	return item;

}

export function repairIdentities( save ) {

	const items = [ ...save.inventory.items, ...Object.values( save.equipment ), ...save.flasks.slots, ...save.stash.tabs.flatMap( ( t ) => t.items ), ...save.vendor.stock.map( ( e ) => e.item ), ...save.vendor.buyback.map( ( e ) => e.item ) ];
	const seen = new Set();
	for ( const item of items ) if ( item ) {

		if ( typeof item.uid !== 'string' || ! item.uid || seen.has( item.uid ) ) item.uid = newUid();
		seen.add( item.uid );

	}

}

// Imports fail before replacing anything when their structure is invalid. Old
// local saves take the repair path instead; persistence retains their raw bytes.
export function validateSave( save ) {

	if ( ! object( save ) || save.version !== 1 ) throw new Error( 'Unsupported character save version.' );
	if ( save.progression !== undefined && ( ! object( save.progression ) || ! Number.isSafeInteger( save.progression.version ) || save.progression.version < 0 ) ) throw new Error( 'Invalid character migration version.' );
	if ( save.progression?.version > SAVE_VERSION ) throw new Error( 'This character was saved by a newer game version.' );
	for ( const key of [ 'level', 'xp', 'gold', 'depth', 'maxDepth' ] ) if ( ! Number.isFinite( save[ key ] ) || save[ key ] < ( [ 'level', 'depth', 'maxDepth' ].includes( key ) ? 1 : 0 ) ) throw new Error( `Invalid character ${key}.` );
	for ( const [ key, max ] of [ [ 'level', MAX_CHARACTER_LEVEL ], [ 'depth', MAX_CHARACTER_DEPTH ], [ 'maxDepth', MAX_CHARACTER_DEPTH ] ] ) if ( ! Number.isInteger( save[ key ] ) || save[ key ] > max ) throw new Error( `Character ${key} exceeds the supported range 1–${max}.` );
	if ( save.gold > Number.MAX_SAFE_INTEGER || save.xp >= xpToNext( save.level ) ) throw new Error( 'Invalid character gold or experience.' );
	if ( typeof save.name !== 'string' || ! save.name.trim() ) throw new Error( 'The character needs a name.' );
	for ( const [ name, value ] of [ [ 'inventory', save.inventory?.items ], [ 'flasks', save.flasks?.slots ], [ 'stash tabs', save.stash?.tabs ], [ 'skill bar', save.skills?.bar ], [ 'known skills', save.skills?.known ], [ 'passive tree', save.tree?.allocated ] ] ) if ( ! Array.isArray( value ) ) throw new Error( `Invalid ${name} array.` );
	if ( save.inventory.items.length > INVENTORY_SIZE || save.flasks.slots.length > 4 || save.stash.tabs.length > MAX_STASH_TABS || save.skills.bar.length > 6 ) throw new Error( 'The character has more slots than the game supports.' );
	validateTreeSave( save );
	validateSkillsSave( save );
	const items = [ ...save.inventory.items, ...Object.values( object( save.equipment ) ? save.equipment : {} ), ...save.flasks.slots ];
	for ( const tab of save.stash.tabs ) {

		if ( ! object( tab ) || ! Array.isArray( tab.items ) || tab.items.length > STASH_TAB_SIZE ) throw new Error( 'Invalid stash tab.' );
		items.push( ...tab.items );

	}
	for ( const key of [ 'stock', 'buyback' ] ) {

		if ( save.vendor?.[ key ] !== undefined && ! Array.isArray( save.vendor[ key ] ) ) throw new Error( 'Invalid vendor array.' );
		for ( const entry of save.vendor?.[ key ] || [] ) {

			if ( ! object( entry ) ) throw new Error( 'Invalid vendor item.' );
			items.push( entry.item );

		}

	}
	for ( const item of items ) if ( item ) {

		if ( ! object( item ) || ! get( 'itemBase', item.base ) || ! RARITIES.includes( item.rarity ) || item.unique && get( 'unique', item.unique )?.base !== item.base ) throw new Error( 'The character contains an unknown or invalid item.' );
		if ( ! Number.isInteger( item.ilvl ) || item.ilvl < 1 || item.ilvl > MAX_CHARACTER_LEVEL || ! Number.isInteger( item.quality ) || item.quality < 0 || item.quality > 20 || ! Number.isInteger( item.rev ) || item.rev < 0 || item.rev > 1e9 || ! object( item.roll ) || ! Object.values( item.roll ).every( ( value ) => Number.isFinite( value ) && value >= 0 ) ) throw new Error( 'Invalid item level, quality or rolled defence.' );
		for ( const [ key, range ] of Object.entries( get( 'itemBase', item.base ).defence || {} ) ) if ( ! inRollRange( item.roll[ key ], range ) ) throw new Error( 'Item defence is outside its base range.' );
		if ( ! Array.isArray( item.affixes ) || ! Array.isArray( item.implicits ) ) throw new Error( 'Invalid item modifier arrays.' );
		if ( item.affixes.length > 6 || item.implicits.length > 10 ) throw new Error( 'Too many item modifiers.' );
		for ( const affix of item.affixes ) if ( ! validAffix( affix ) || ! validAffixRoll( item, affix ) ) throw new Error( 'Invalid item affix values or tier range.' );
		for ( const mod of item.implicits ) if ( ! validMod( mod ) || ! validImplicitRoll( item, mod ) ) throw new Error( 'Invalid item implicit modifier or range.' );
		if ( item.unique && ( ! Array.isArray( item.uvals ) || item.uvals.length !== get( 'unique', item.unique ).mods.length || ! item.uvals.every( ( value, index ) => validUniqueRoll( item, value, index ) ) ) ) throw new Error( 'Invalid unique item values or range.' );

	}
	return save;

}

// Bring a save up to date (idempotent, cheap after the first call per save object).
export function ensureSave( save ) {

	if ( ! save ) return save;
	if ( ! object( save ) || save.version !== 1 || save.progression?.version > SAVE_VERSION ) throw new Error( 'Unsupported character save version.' );
	if ( checked.has( save ) ) {

		ensureLoadout( save );
		return save;

	}

	for ( const f of all( 'saveField' ) ) if ( save[ f.id ] === undefined || save[ f.id ] === null ) save[ f.id ] = f.init();
	save.name = typeof save.name === 'string' && save.name.trim() ? save.name.slice( 0, 100 ) : 'Reaver';
	for ( const key of [ 'level', 'depth', 'maxDepth' ] ) save[ key ] = Math.min( key === 'level' ? MAX_CHARACTER_LEVEL : MAX_CHARACTER_DEPTH, Math.max( 1, Math.round( number( save[ key ], 1 ) ) ) );
	for ( const key of [ 'xp', 'gold' ] ) save[ key ] = number( save[ key ] );
	if ( save.xp >= xpToNext( save.level ) ) save.xp = 0;
	save.created = number( save.created, Date.now() );
	save.progression = object( save.progression ) ? save.progression : { version: 0 };
	if ( ! Number.isSafeInteger( save.progression.version ) || save.progression.version < 0 ) save.progression.version = 0;
	for ( let v = ( save.progression.version ?? 0 ) + 1; v <= SAVE_VERSION; v ++ ) MIGRATIONS[ v ]?.( save );
	// always run the newest repair step for fields added by other features / old builds
	if ( ( save.progression.version ?? 0 ) >= SAVE_VERSION ) MIGRATIONS[ SAVE_VERSION ]( save );
	save.progression.version = SAVE_VERSION;
	validateTree( save );
	ensureLoadout( save, { repair: true } );
	checked.add( save );
	return save;

}
