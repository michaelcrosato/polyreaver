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

import { define } from '../../core/registry.js';
import { RNG } from '../../core/rng.js';
import { makeItem } from './items.js';
import { newTreeSave, validateTree } from './tree.js';
import { newSkillsSave, ensureLoadout } from './skills.js';
import { EQUIP_SLOTS } from './data/bases.js';

export const SAVE_VERSION = 1;
export const INVENTORY_SIZE = 60;
export const STASH_TAB_SIZE = 60;
export const MAX_STASH_TABS = 8;

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
		s.inventory ||= { size: INVENTORY_SIZE, items: [] };
		const inv = s.inventory.items;
		while ( inv.length < INVENTORY_SIZE ) inv.push( null );
		s.equipment ||= starterEquipment();
		for ( const k of EQUIP_SLOTS ) if ( s.equipment[ k ] === undefined ) s.equipment[ k ] = null;
		s.flasks ||= starterFlasks();
		while ( s.flasks.slots.length < 4 ) s.flasks.slots.push( null );
		for ( const t of s.stash?.tabs || [] ) while ( t.items.length < STASH_TAB_SIZE ) t.items.push( null );
		s.currencies ||= {};
		s.skills ||= newSkillsSave();
		for ( const k of [ 'known', 'bar' ] ) s.skills[ k ] ||= k === 'bar' ? empty( 6 ) : [];
		for ( const k of [ 'supports', 'levels', 'xp', 'runes' ] ) s.skills[ k ] ||= {};
		while ( s.skills.bar.length < 6 ) s.skills.bar.push( null );
		s.tree ||= newTreeSave();

	}
};

const checked = new WeakSet();

// Bring a save up to date (idempotent, cheap after the first call per save object).
export function ensureSave( save ) {

	if ( ! save ) return save;
	if ( checked.has( save ) ) {

		ensureLoadout( save );
		return save;

	}

	save.progression ||= { version: 0 };
	for ( let v = ( save.progression.version ?? 0 ) + 1; v <= SAVE_VERSION; v ++ ) MIGRATIONS[ v ]?.( save );
	// always run the newest repair step for fields added by other features / old builds
	if ( ( save.progression.version ?? 0 ) >= SAVE_VERSION ) MIGRATIONS[ SAVE_VERSION ]( save );
	save.progression.version = SAVE_VERSION;
	validateTree( save );
	ensureLoadout( save );
	checked.add( save );
	return save;

}
