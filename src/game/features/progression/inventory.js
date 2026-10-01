// Inventory, equipment, flask belt, stash, vendor, gambling and crafting - all as
// operations on the save, addressed by LOCATIONS so the UI, the agent API and tests
// use the same calls:
//
//   { where: 'inv', index }        { where: 'equip', slot }      { where: 'flask', index }
//   { where: 'stash', tab, index } { where: 'vendor', index }    { where: 'buyback', index }
//
// moveItem( game, from, to ) swaps when the target is occupied and both items fit;
// equipping checks requirements and the one-hand / two-hand / off-hand rules.
// Every change that touches gear calls game.applyPlayerStats() (which also updates
// player.model.weapon / gear for the hero renderer) and emits game event 'inventory'.

import { get, need } from '../../core/registry.js';
import { RNG } from '../../core/rng.js';
import { computeItem, meetsReq, itemValue, rollItem, touch, itemName } from './items.js';
import { SLOT_ACCEPTS, EQUIP_SLOTS } from './data/bases.js';
import { ensureSave, STASH_TAB_SIZE, MAX_STASH_TABS } from './save.js';
import { flaskSlots } from './flasks.js';

// --- access ----------------------------------------------------------------------------------------

export function getAt( save, loc ) {

	switch ( loc.where ) {

		case 'inv': return save.inventory.items[ loc.index ] ?? null;
		case 'equip': return save.equipment[ loc.slot ] ?? null;
		case 'flask': return flaskSlots( save )[ loc.index ] ?? null;
		case 'stash': return save.stash.tabs[ loc.tab ]?.items[ loc.index ] ?? null;
		case 'vendor': return save.vendor.stock[ loc.index ]?.item ?? null;
		case 'buyback': return save.vendor.buyback[ loc.index ]?.item ?? null;
		default: return null;

	}

}

function setAt( save, loc, item ) {

	switch ( loc.where ) {

		case 'inv': save.inventory.items[ loc.index ] = item; break;
		case 'equip': save.equipment[ loc.slot ] = item; break;
		case 'flask': flaskSlots( save )[ loc.index ] = item; break;
		case 'stash': save.stash.tabs[ loc.tab ].items[ loc.index ] = item; break;

	}

}

// Take an item out of a location (dropping it on the ground, destroying it).
export function removeAt( game, loc ) {

	const item = getAt( game.save, loc );
	if ( ! item || loc.where === 'vendor' || loc.where === 'buyback' ) return null;
	setAt( game.save, loc, null );
	if ( loc.where === 'equip' ) afterGear( game ); else changed( game );
	return item;

}

export function freeIndex( save ) {

	return save.inventory.items.findIndex( ( x ) => ! x );

}

export function addToInventory( save, item ) {

	const i = freeIndex( save );
	if ( i < 0 ) return - 1;
	save.inventory.items[ i ] = item;
	return i;

}

// --- equipping rules ----------------------------------------------------------------------------------

export function playerAttributes( game ) {

	const p = game.world?.player;
	const b = p?.data.progBuild;
	if ( b ) return b.attrs;
	return { strength: 10, dexterity: 10, intelligence: 10 };

}

// Why `item` cannot go into equipment slot `slot` (null = it can).
export function canEquip( game, item, slot ) {

	if ( ! item ) return null;
	const base = get( 'itemBase', item.base );
	if ( ! base ) return 'Unknown item';
	const accepts = SLOT_ACCEPTS[ slot ];
	if ( ! accepts?.includes( base.slot ) ) return `Cannot be equipped as ${slot}`;
	if ( slot === 'offhand' && base.slot === 'weapon' ) {

		if ( base.hands === 2 ) return 'Two-handed weapons go in the main hand';
		if ( base.weaponClass === 'bow' ) return 'Bows go in the main hand';

	}

	if ( slot === 'offhand' && base.tags.includes( 'quiver' ) ) {

		const w = game.save.equipment.weapon;
		if ( w && get( 'itemBase', w.base )?.weaponClass !== 'bow' ) return 'Quivers need a bow';

	}

	const fail = meetsReq( item, playerAttributes( game ), game.save.level );
	if ( fail.length ) {

		const r = computeItem( item ).req;
		const parts = { level: `level ${r.level}`, str: `${r.str} Strength`, dex: `${r.dex} Dexterity`, int: `${r.int} Intelligence` };
		return 'Requires ' + fail.map( ( f ) => parts[ f ] ).join( ', ' );

	}

	return null;

}

// The best equipment slot for an item (empty ring slot first, etc.).
export function slotFor( game, item ) {

	const base = get( 'itemBase', item.base );
	if ( ! base ) return null;
	if ( base.slot === 'flask' ) return 'flask';
	if ( base.slot === 'ring' ) return ! game.save.equipment.ring1 ? 'ring1' : ! game.save.equipment.ring2 ? 'ring2' : 'ring1';
	return base.slot;

}

function afterGear( game ) {

	game.applyPlayerStats();
	game.events.emit( 'inventory', { save: game.save } );

}

function changed( game ) {

	game.events.emit( 'inventory', { save: game.save } );

}

// Move / swap an item between two locations. Equipping applies all rules.
export function moveItem( game, from, to ) {

	const save = ensureSave( game.save );
	if ( from.where === to.where && from.index === to.index && from.slot === to.slot && from.tab === to.tab ) return { ok: true };
	const a = getAt( save, from ), b = getAt( save, to );
	if ( ! a ) return { ok: false, reason: 'Nothing there' };
	if ( from.where === 'vendor' || from.where === 'buyback' || to.where === 'vendor' || to.where === 'buyback' ) return { ok: false, reason: 'Use buy / sell' };
	const check = ( item, loc ) => {

		if ( ! item ) return null;
		if ( loc.where === 'equip' ) return canEquip( game, item, loc.slot );
		if ( loc.where === 'flask' ) return get( 'itemBase', item.base )?.slot === 'flask' ? null : 'Only flasks go on the belt';
		return null;

	};

	const why = check( a, to ) || check( b, from );
	if ( why ) return { ok: false, reason: why };

	// two-hand / off-hand conflicts: push the blocking item to the inventory
	const extra = [];
	if ( to.where === 'equip' && to.slot === 'weapon' ) {

		const base = get( 'itemBase', a.base );
		const off = save.equipment.offhand;
		const offBase = off ? get( 'itemBase', off.base ) : null;
		if ( off && ( ( base.hands === 2 && ! ( base.weaponClass === 'bow' && offBase.tags.includes( 'quiver' ) ) ) || ( offBase.tags.includes( 'quiver' ) && base.weaponClass !== 'bow' ) ) ) extra.push( 'offhand' );

	}

	if ( to.where === 'equip' && to.slot === 'offhand' ) {

		const w = save.equipment.weapon;
		const wb = w ? get( 'itemBase', w.base ) : null;
		const ab = get( 'itemBase', a.base );
		if ( wb && wb.hands === 2 && ! ( wb.weaponClass === 'bow' && ab.tags.includes( 'quiver' ) ) ) extra.push( 'weapon' );

	}

	const free = save.inventory.items.filter( ( x ) => ! x ).length + ( from.where === 'inv' && ! b ? 1 : 0 );
	if ( extra.length > free ) return { ok: false, reason: 'Inventory is full' };
	setAt( save, from, b );
	setAt( save, to, a );
	for ( const slot of extra ) {

		const it = save.equipment[ slot ];
		save.equipment[ slot ] = null;
		addToInventory( save, it );

	}

	if ( from.where === 'equip' || to.where === 'equip' ) afterGear( game ); else changed( game );
	return { ok: true };

}

export function equipFrom( game, from ) {

	const item = getAt( game.save, from );
	if ( ! item ) return { ok: false, reason: 'Nothing there' };
	const slot = slotFor( game, item );
	if ( slot === 'flask' ) {

		const slots = flaskSlots( game.save );
		const i = slots.findIndex( ( x ) => ! x );
		return moveItem( game, from, { where: 'flask', index: i >= 0 ? i : 0 } );

	}

	return moveItem( game, from, { where: 'equip', slot } );

}

export function unequip( game, loc ) {

	const save = game.save;
	const i = freeIndex( save );
	if ( i < 0 ) return { ok: false, reason: 'Inventory is full' };
	return moveItem( game, loc, { where: 'inv', index: i } );

}

// --- stash -------------------------------------------------------------------------------------------

export function stashTabCost( save ) {

	return Math.round( 500 * Math.pow( 2.2, save.stash.tabs.length - 2 ) );

}

export function buyStashTab( game ) {

	const save = game.save;
	if ( save.stash.tabs.length >= MAX_STASH_TABS ) return { ok: false, reason: 'All stash tabs unlocked' };
	const cost = stashTabCost( save );
	if ( save.gold < cost ) return { ok: false, reason: `Needs ${cost} gold` };
	game.gainGold( - cost );
	save.stash.tabs.push( { name: `Stash ${save.stash.tabs.length + 1}`, items: new Array( STASH_TAB_SIZE ).fill( null ) } );
	changed( game );
	return { ok: true };

}

export function stashItem( game, from, tab ) {

	const items = game.save.stash.tabs[ tab ]?.items;
	if ( ! items ) return { ok: false, reason: 'No such tab' };
	const i = items.findIndex( ( x ) => ! x );
	if ( i < 0 ) return { ok: false, reason: 'Stash tab is full' };
	return moveItem( game, from, { where: 'stash', tab, index: i } );

}

// Compact the inventory and order it: equipment by slot, then flasks; rarity high first.
export function sortInventory( game ) {

	const items = game.save.inventory.items;
	const order = [ 'weapon', 'offhand', 'helm', 'chest', 'gloves', 'boots', 'belt', 'amulet', 'ring', 'flask' ];
	const rank = { unique: 0, rare: 1, magic: 2, normal: 3 };
	const list = items.filter( Boolean ).sort( ( a, b ) => {

		const ba = get( 'itemBase', a.base ), bb = get( 'itemBase', b.base );
		return order.indexOf( ba?.slot ) - order.indexOf( bb?.slot ) || rank[ a.rarity ] - rank[ b.rarity ] || b.ilvl - a.ilvl;

	} );
	for ( let i = 0; i < items.length; i ++ ) items[ i ] = list[ i ] ?? null;
	changed( game );

}

// --- vendor ------------------------------------------------------------------------------------------

export const PRICE_MULT = 5;
export const CURRENCY_SHOP = { transmute: 25, alteration: 30, augment: 40, scour: 120, chance: 90, alchemy: 300 };

const priceScale = ( level ) => 1 + level * 0.12 + Math.pow( level, 1.5 ) * 0.01;

export function buyPrice( item ) {

	return Math.round( itemValue( item ) * PRICE_MULT * ( item.rarity === 'rare' ? 1.4 : 1 ) );

}

export function currencyPrice( id, level ) {

	return Math.round( ( CURRENCY_SHOP[ id ] ?? 100 ) * priceScale( level ) );

}

export function gamblePrice( level ) {

	return Math.round( 60 * priceScale( level ) * Math.pow( 1.02, level ) );

}

export const GAMBLE_SLOTS = [ [ 'weapon', 'Weapon' ], [ 'offhand', 'Off Hand' ], [ 'helm', 'Helmet' ], [ 'chest', 'Body Armour' ], [ 'gloves', 'Gloves' ], [ 'boots', 'Boots' ], [ 'belt', 'Belt' ], [ 'amulet', 'Amulet' ], [ 'ring', 'Ring' ] ];

// The stock refreshes once per town visit (worldHook counts visits).
export function vendorStock( game ) {

	const save = ensureSave( game.save );
	const v = save.vendor;
	if ( v.stockVisit === v.visit && v.stock.length ) return v.stock;
	const rng = new RNG( `vendor:${save.created}:${v.visit}:${save.level}` );
	const level = Math.max( 1, save.level );
	v.stock = [];
	for ( let i = 0; i < 16; i ++ ) {

		const rarity = rng.weighted( [ 'normal', 'magic', 'rare' ], ( r ) => ( { normal: 15, magic: 60, rare: 25 } )[ r ] );
		const item = rollItem( Math.max( 1, level + rng.int( - 3, 1 ) ), { rarity }, rng );
		if ( item ) v.stock.push( { item, price: buyPrice( item ) } );

	}

	for ( let i = 0; i < 3; i ++ ) {

		const item = rollItem( level, { flask: true, rarity: rng.chance( 0.5 ) ? 'magic' : 'normal' }, rng );
		if ( item ) v.stock.push( { item, price: buyPrice( item ) } );

	}

	v.stockVisit = v.visit;
	return v.stock;

}

export function buyItem( game, index, buyback = false ) {

	const save = game.save;
	const list = buyback ? save.vendor.buyback : vendorStock( game );
	const entry = list[ index ];
	if ( ! entry ) return { ok: false, reason: 'Sold out' };
	if ( save.gold < entry.price ) return { ok: false, reason: `Needs ${entry.price} gold` };
	if ( freeIndex( save ) < 0 ) return { ok: false, reason: 'Inventory is full' };
	game.gainGold( - entry.price );
	addToInventory( save, entry.item );
	list.splice( index, 1 );
	changed( game );
	return { ok: true, item: entry.item };

}

export function sellItem( game, from ) {

	const save = game.save;
	const item = getAt( save, from );
	if ( ! item ) return { ok: false, reason: 'Nothing there' };
	if ( from.where === 'vendor' || from.where === 'buyback' ) return { ok: false, reason: 'Not yours' };
	const price = itemValue( item );
	setAt( save, from, null );
	save.vendor.buyback.unshift( { item, price } );
	save.vendor.buyback.length = Math.min( save.vendor.buyback.length, 12 );
	game.gainGold( price );
	if ( from.where === 'equip' ) afterGear( game ); else changed( game );
	return { ok: true, gold: price };

}

export function buyCurrency( game, id, n = 1 ) {

	const save = game.save;
	if ( ! CURRENCY_SHOP[ id ] ) return { ok: false, reason: 'Not sold here' };
	const cost = currencyPrice( id, save.level ) * n;
	if ( save.gold < cost ) return { ok: false, reason: `Needs ${cost} gold` };
	game.gainGold( - cost );
	save.currencies[ id ] = ( save.currencies[ id ] ?? 0 ) + n;
	changed( game );
	return { ok: true };

}

// Gambling: pay gold for an unidentified item of a chosen slot; rarity is a lottery
// (magic 70%, rare 26%, unique 4%).
export function gamble( game, slot, rng = new RNG( Math.random() * 1e9 ) ) {

	const save = game.save;
	const cost = gamblePrice( save.level );
	if ( save.gold < cost ) return { ok: false, reason: `Needs ${cost} gold` };
	if ( freeIndex( save ) < 0 ) return { ok: false, reason: 'Inventory is full' };
	const rarity = rng.weighted( [ 'magic', 'rare', 'unique' ], ( r ) => ( { magic: 70, rare: 26, unique: 4 } )[ r ] );
	const item = rollItem( Math.max( 1, save.level ), { slot, rarity }, rng );
	if ( ! item ) return { ok: false, reason: 'Nothing to gamble for that slot yet' };
	game.gainGold( - cost );
	addToInventory( save, item );
	recordFind( save, item );
	changed( game );
	return { ok: true, item };

}

// --- crafting ----------------------------------------------------------------------------------------

export function canApplyCurrency( game, id, loc ) {

	const save = game.save;
	const def = get( 'currency', id );
	if ( ! def ) return 'Unknown currency';
	if ( ( save.currencies[ id ] ?? 0 ) <= 0 ) return `You have no ${def.name}`;
	const item = getAt( save, loc );
	if ( ! item ) return 'Choose an item first';
	return def.can( item, need( 'itemBase', item.base ) ) || null;

}

export function applyCurrency( game, id, loc, rng = new RNG( Math.random() * 1e9 ) ) {

	const why = canApplyCurrency( game, id, loc );
	if ( why ) return { ok: false, reason: why };
	const save = game.save;
	const item = getAt( save, loc );
	const def = get( 'currency', id );
	const before = JSON.parse( JSON.stringify( item ) );
	const rev = item.rev ?? 0;
	def.apply( item, rng, need( 'itemBase', item.base ) );
	item.rev = Math.max( item.rev ?? 0, rev ) + 1;
	save.currencies[ id ] --;
	if ( save.lifetime ) save.lifetime.currencyUsed = ( save.lifetime.currencyUsed ?? 0 ) + 1;
	if ( item.rarity === 'unique' ) recordFind( save, item );
	if ( loc.where === 'equip' ) afterGear( game ); else changed( game );
	return { ok: true, before, item };

}

export function qualityCost( item ) {

	return Math.round( 25 * ( 1 + item.ilvl * 0.1 ) * ( 1 + ( item.quality || 0 ) / 5 ) );

}

export function canImproveQuality( game, loc ) {

	const item = getAt( game.save, loc );
	if ( ! item ) return 'Choose an item first';
	const base = get( 'itemBase', item.base );
	if ( ! base.damage && ! base.defence && ! base.flask ) return 'Only weapons, armour and flasks take quality';
	if ( item.corrupted ) return 'Corrupted items cannot be modified';
	if ( ( item.quality || 0 ) >= 20 ) return 'Already at 20% quality';
	if ( game.save.gold < qualityCost( item ) ) return `Needs ${qualityCost( item )} gold`;
	return null;

}

// Blacksmith service: +5% quality (max 20%) for gold.
export function improveQuality( game, loc ) {

	const why = canImproveQuality( game, loc );
	if ( why ) return { ok: false, reason: why };
	const item = getAt( game.save, loc );
	game.gainGold( - qualityCost( item ) );
	item.quality = Math.min( 20, ( item.quality || 0 ) + 5 );
	touch( item );
	if ( loc.where === 'equip' ) afterGear( game ); else changed( game );
	return { ok: true };

}

// --- bookkeeping -------------------------------------------------------------------------------------

export function recordFind( save, item ) {

	const L = save.lifetime;
	if ( ! L ) return;
	L.items[ item.rarity ] = ( L.items[ item.rarity ] ?? 0 ) + 1;
	if ( item.unique && ! L.uniques.includes( item.unique ) ) L.uniques.push( item.unique );

}

// All items the character owns, with locations (agent tools, tests).
export function listItems( save ) {

	const out = [];
	save.inventory.items.forEach( ( it, index ) => it && out.push( { loc: { where: 'inv', index }, item: it, name: itemName( it ) } ) );
	for ( const slot of EQUIP_SLOTS ) if ( save.equipment[ slot ] ) out.push( { loc: { where: 'equip', slot }, item: save.equipment[ slot ], name: itemName( save.equipment[ slot ] ) } );
	flaskSlots( save ).forEach( ( it, index ) => it && out.push( { loc: { where: 'flask', index }, item: it, name: itemName( it ) } ) );
	save.stash.tabs.forEach( ( t, tab ) => t.items.forEach( ( it, index ) => it && out.push( { loc: { where: 'stash', tab, index }, item: it, name: itemName( it ) } ) ) );
	return out;

}

