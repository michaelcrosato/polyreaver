// Rewards and loot. Replaces the baseline reward hook (worldHook 'baseline-rewards'):
// on every enemy `death` caused by the player it grants XP and rolls DROPS:
//
//   XP     monster data.xp x level-difference penalty x (1 + xp_gain%)   (the XP
//          slider is applied by game.gainXp); skills on the bar share it
//   items  count from the monster's rarity ( data.rarity ) x data.lootMult x the
//          Loot quantity slider x (1 + item_quantity%); rarity from item_rarity +
//          monster rarity bonus x the Loot rarity slider; item level = monster level
//   gold   chance + amount by rarity and level x Gold slider x (1 + gold_find%)
//   currency orbs and support runes (registry 'support') by rarity
//
// Drops become LOOT ENTITIES ( kind 'loot', model { type: 'loot', id: 'coins' | 'gem' |
// 'rune' | 'potion' | 'weapon-<model>' | 'helm' | 'armor' | ... | 'bag', rarity, color } )
// that pop out of the corpse. Gold and
// currency fly to the player inside pickup_radius; items are picked up by walking
// over them (if they pass the auto-pickup filter), by pressing interact next to them
// or by clicking their label. Events: world 'loot { item, loot, entity }' on drop,
// 'pickup { item?, gold?, currency?, rune? }' on pickup.

import { define, all, get } from '../../core/registry.js';
import { Entity } from '../../core/entity.js';
import { RNG } from '../../core/rng.js';
import { TEAM, monsterScaling } from '../../core/tuning.js';
import { rollItem, computeItem, itemName } from './items.js';
import { addToInventory, recordFind } from './inventory.js';
import { addRune, addSkillXp } from './skills.js';
import { ensureSave } from './save.js';
import { killedByPlayer, installMechanics } from './mechanics.js';
import { installFlasks } from './flasks.js';

// per monster rarity: expected item drops, gold chance, currency drops, rune chance, rarity bonus %
export const RARITY_LOOT = {
	normal: { items: 0.12, gold: 0.35, currency: 0.035, rune: 0.004, rarity: 0, goldMult: 1 },
	magic: { items: 0.45, gold: 0.6, currency: 0.1, rune: 0.02, rarity: 60, goldMult: 1.6 },
	rare: { items: 1.6, gold: 1, currency: 0.35, rune: 0.08, rarity: 180, goldMult: 3, minItems: 1 },
	unique: { items: 3.5, gold: 1, currency: 0.8, rune: 0.25, rarity: 350, goldMult: 5, minItems: 2 },
	boss: { items: 6, gold: 1, currency: 2.5, rune: 0.6, rarity: 600, goldMult: 10, minItems: 3, guaranteeRare: true }
};

export const AUTO_PICKUP = [ 'none', 'unique', 'rare', 'magic', 'normal' ];
const RANK = { normal: 0, magic: 1, rare: 2, unique: 3 };

// --- XP ---------------------------------------------------------------------------------------------

// Path of Exile's level-difference rule: no penalty inside a safe band of
// 3 + level/16 levels; beyond it XP falls off steeply (killing far-below-level
// monsters is not worth it, far-above is dangerous anyway).
export function xpPenalty( playerLevel, monsterLevel ) {

	const safe = 3 + Math.floor( playerLevel / 16 );
	const diff = Math.max( 0, Math.abs( playerLevel - monsterLevel ) - safe );
	if ( ! diff ) return 1;
	return Math.max( 0.01, Math.pow( ( playerLevel + 5 ) / ( playerLevel + 5 + Math.pow( diff, 2.5 ) ), 1.5 ) );

}

export function monsterRarity( e ) {

	return e.data.rarity || ( e.kind === 'boss' ? 'boss' : 'normal' );

}

// --- drop rolls -----------------------------------------------------------------------------------------

const count = ( rng, expected ) => Math.floor( expected ) + ( rng.next() < expected % 1 ? 1 : 0 );

export function goldAmount( level, rng, mult = 1 ) {

	return Math.max( 1, Math.round( ( 4 + level * 1.6 ) * Math.pow( 1.03, level ) * rng.range( 0.7, 1.3 ) * mult ) );

}

// Everything one kill drops (pure: same inputs + rng -> same drops).
//   ctx: { level, rarity, lootMult, quantity (%), rarityBonus (%), goldFind (%), tuning }
export function rollDrops( ctx, rng ) {

	const R = RARITY_LOOT[ ctx.rarity ] || RARITY_LOOT.normal;
	const t = ctx.tuning || {};
	const qMul = ( ctx.lootMult ?? 1 ) * ( t.lootQuantity ?? 1 ) * ( 1 + ( ctx.quantity ?? 0 ) / 100 );
	const drops = [];
	let n = count( rng, R.items * qMul );
	if ( R.minItems && ( t.lootQuantity ?? 1 ) > 0 && ( ctx.lootMult ?? 1 ) > 0 ) n = Math.max( n, R.minItems );
	for ( let i = 0; i < n; i ++ ) {

		if ( rng.chance( 0.06 ) ) {

			const f = rollItem( ctx.level, { flask: true, rarity: rng.chance( 0.3 ) ? 'magic' : 'normal' }, rng );
			if ( f ) drops.push( { type: 'item', item: f } );
			continue;

		}

		const opts = { bonus: ( ctx.rarityBonus ?? 0 ) + R.rarity, tuning: t.lootRarity ?? 1 };
		if ( R.guaranteeRare && i === 0 && ( t.lootRarity ?? 1 ) > 0 ) opts.rarity = rng.chance( 0.15 ) ? 'unique' : 'rare';
		const item = rollItem( ctx.level, opts, rng );
		if ( item ) drops.push( { type: 'item', item } );

	}

	const gMul = ( t.goldGain ?? 1 ) * ( 1 + ( ctx.goldFind ?? 0 ) / 100 );
	if ( gMul > 0 && rng.chance( Math.min( 1, R.gold * Math.min( 1.5, ctx.lootMult ?? 1 ) ) ) ) {

		const piles = ctx.rarity === 'boss' ? 4 : ctx.rarity === 'unique' ? 2 : 1;
		for ( let i = 0; i < piles; i ++ ) drops.push( { type: 'gold', gold: goldAmount( ctx.level, rng, R.goldMult * gMul / piles ) } );

	}

	const cur = all( 'currency' ).filter( ( c ) => ( c.level ?? 1 ) <= ctx.level );
	for ( let i = count( rng, R.currency * qMul ); i > 0; i -- ) {

		const c = rng.weighted( cur, ( x ) => x.weight );
		if ( c ) drops.push( { type: 'currency', currency: c.id, count: 1 } );

	}

	const sup = all( 'support' ).filter( ( s ) => ( s.levelReq ?? s.level ?? 1 ) <= ctx.level );
	if ( sup.length && rng.chance( Math.min( 1, R.rune * qMul ) ) ) drops.push( { type: 'rune', rune: rng.weighted( sup, ( s ) => s.weight ?? 1 ).id } );
	return drops;

}

// --- loot entities ---------------------------------------------------------------------------------------

const LOOT_LIMIT = 300;

// model ids from the creatures model library ( type 'loot' ): weapons lie on the
// ground as 'weapon-<model>', armour pieces as their slot model, orbs as 'gem'
const SLOT_MODEL = { helm: 'helm', chest: 'armor', gloves: 'gloves', boots: 'boots', belt: 'belt', ring: 'ring', amulet: 'amulet' };

function lootModel( drop ) {

	if ( drop.type === 'gold' ) return { type: 'loot', id: 'coins', color: '#ffd34d', scale: Math.min( 1.6, 0.7 + Math.log10( drop.gold + 1 ) * 0.3 ) };
	if ( drop.type === 'currency' ) return { type: 'loot', id: 'gem', color: get( 'currency', drop.currency )?.color ?? '#e0cf9f' };
	if ( drop.type === 'rune' ) return { type: 'loot', id: 'rune', color: '#6fe0c8' };
	const base = computeItem( drop.item ).base;
	const id = base.slot === 'flask' ? 'potion' : base.model?.weapon ? 'weapon-' + base.model.weapon : base.tags.includes( 'shield' ) ? 'shield' : SLOT_MODEL[ base.slot ] ?? 'bag';
	return { type: 'loot', id, rarity: drop.item.rarity, color: drop.item.unique ? get( 'unique', drop.item.unique )?.color : base.model?.color, item: base.id };

}

export function dropLabel( drop ) {

	if ( drop.type === 'gold' ) return `${drop.gold} Gold`;
	if ( drop.type === 'currency' ) return get( 'currency', drop.currency )?.name ?? drop.currency;
	if ( drop.type === 'rune' ) return `${get( 'support', drop.rune )?.name ?? drop.rune} Rune`;
	return itemName( drop.item );

}

export function spawnLoot( world, drop, x, z, rng = world.rng ) {

	const ang = rng.range( 0, Math.PI * 2 ), sp = rng.range( 1.5, 4.5 );
	const e = new Entity( { kind: 'loot', name: dropLabel( drop ), team: TEAM.NEUTRAL, x, z, radius: 0.28, height: 0.35, mass: 0.2, solid: false } );
	e.data.loot = drop;
	e.data.accel = 7;
	e.data.dropTime = world.time;
	e.flags.untargetable = true;
	e.model = lootModel( drop );
	e.vx = Math.sin( ang ) * sp; e.vz = Math.cos( ang ) * sp;
	e.y = 0.05; e.vy = rng.range( 5, 8 );
	e.life = 1;
	world.add( e );
	world.events.emit( 'loot', { item: drop.item ?? null, loot: drop, entity: e, x, z } );
	// keep the world light: the oldest plain drops go first
	const loot = world.entities.filter( ( o ) => o.kind === 'loot' );
	if ( loot.length > LOOT_LIMIT ) {

		const victim = loot.find( ( o ) => o.data.loot.type === 'item' && o.data.loot.item.rarity === 'normal' ) || loot[ 0 ];
		world.remove( victim );

	}

	return e;

}

export function lootEntities( world ) {

	return world.entities.filter( ( e ) => e.kind === 'loot' && e.alive && e.data.loot );

}

// Pick up one loot entity. Returns { ok, reason }.
export function pickupLoot( game, e ) {

	const world = game.world, save = ensureSave( game.save );
	const d = e?.data?.loot;
	if ( ! d || ! e.alive ) return { ok: false, reason: 'Gone' };
	const ev = {};
	if ( d.type === 'item' ) {

		if ( addToInventory( save, d.item ) < 0 ) {

			if ( world.time - ( world.state.progFullWarn ?? - 9 ) > 3 ) {

				world.state.progFullWarn = world.time;
				game.events.emit( 'inventoryFull', {} );

			}

			return { ok: false, reason: 'Inventory is full' };

		}

		recordFind( save, d.item );
		ev.item = d.item;
		game.events.emit( 'inventory', { save } );

	} else if ( d.type === 'gold' ) {

		game.gainGold( d.gold );
		save.lifetime.gold = ( save.lifetime.gold ?? 0 ) + d.gold;
		ev.gold = d.gold;

	} else if ( d.type === 'currency' ) {

		save.currencies[ d.currency ] = ( save.currencies[ d.currency ] ?? 0 ) + ( d.count ?? 1 );
		ev.currency = d.currency;
		game.events.emit( 'inventory', { save } );

	} else if ( d.type === 'rune' ) {

		addRune( save, d.rune );
		ev.rune = d.rune;

	}

	e.alive = false;
	world.remove( e );
	world.events.emit( 'pickup', { ...ev, x: e.x, z: e.z, entity: e } );
	return { ok: true };

}

export function passesFilter( save, drop ) {

	if ( drop.type !== 'item' ) return true;
	const min = save.unlocks?.autoPickup ?? 'magic';
	if ( min === 'none' ) return false;
	return RANK[ drop.item.rarity ] >= RANK[ min ];

}

function updatePickup( world, dt ) {

	const game = world.game, p = world.player;
	if ( ! game || ! p || ! p.alive ) return;
	const save = game.save;
	const radius = p.stats.get( 'pickup_radius' ) || 2.5;
	const interact = world.input?.pressed.has( 'interact' );
	let nearest = null, nd = 2.2;
	for ( const e of lootEntities( world ) ) {

		const d = e.data.loot;
		const dist = Math.hypot( e.x - p.x, e.z - p.z );
		if ( world.time - e.data.dropTime < 0.45 ) continue; // let it land first
		if ( d.type !== 'item' ) {

			if ( dist < radius || e.data.magnet ) {

				// gold and currency fly to you
				e.data.magnet = true;
				const k = Math.min( 1, 16 * dt / Math.max( 0.01, dist ) );
				e.x += ( p.x - e.x ) * k; e.z += ( p.z - e.z ) * k;
				if ( dist < 0.6 ) pickupLoot( game, e );

			}

			continue;

		}

		if ( dist < 0.9 && passesFilter( save, d ) && ! e.data.refused ) {

			if ( ! pickupLoot( game, e ).ok ) e.data.refused = true;
			continue;

		}

		if ( dist > 1.2 ) e.data.refused = false;
		if ( interact && dist < nd ) {

			nd = dist;
			nearest = e;

		}

	}

	if ( nearest ) pickupLoot( game, nearest );

}

define( 'system', { id: 'prog-pickup', order: 95, update: updatePickup } );

// --- the reward hook ---------------------------------------------------------------------------------------

export function onKill( game, world, ev ) {

	const m = ev.entity, p = world.player;
	if ( ! p || m.team !== TEAM.ENEMY || m.data.noRewards || ! killedByPlayer( ev, p ) ) return null;
	const save = ensureSave( game.save );
	const rarity = monsterRarity( m );
	const level = Math.max( 1, Math.round( m.level ?? world.level ) );
	const S = p.stats;

	// XP
	const xp = ( m.data.xp ?? 10 * monsterScaling( level ).xp ) * xpPenalty( save.level, level ) * ( 1 + S.get( 'xp_gain' ) / 100 );
	if ( xp > 0 ) {

		game.gainXp( xp );
		const ups = addSkillXp( save, xp * game.tuning.xpGain );
		for ( const id of ups ) game.events.emit( 'skillLevel', { skill: id, level: save.skills.levels[ id ] } );

	}

	// lifetime
	const L = save.lifetime;
	L.kills[ rarity ] = ( L.kills[ rarity ] ?? 0 ) + 1;

	// drops
	const rng = world.state.progRng ||= world.rng.fork( 'loot' );
	const drops = rollDrops( {
		level, rarity, lootMult: m.data.lootMult ?? 1, quantity: S.get( 'item_quantity' ), rarityBonus: S.get( 'item_rarity' ),
		goldFind: S.get( 'gold_find' ), tuning: game.tuning
	}, rng );
	for ( const d of drops ) spawnLoot( world, d, ev.x ?? m.x, ev.z ?? m.z, rng );
	return { xp, drops };

}

define( 'worldHook', { id: 'baseline-rewards', order: 95, onWorld( game, world ) {

	ensureSave( game.save );
	installMechanics( game, world );
	installFlasks( game, world );
	// entities start with 0 energy shield; a new area starts with it full (vital for Chaos Inoculation)
	if ( world.player ) world.player.shield = world.player.stats.get( 'shield' );
	world.events.on( 'death', ( ev ) => {

		if ( ev.entity === world.player ) {

			game.save.lifetime.deaths = ( game.save.lifetime.deaths ?? 0 ) + 1;
			return;

		}

		onKill( game, world, ev );

	} );
	world.events.on( 'exitOpen', () => {

		game.save.lifetime.levelsCompleted = ( game.save.lifetime.levelsCompleted ?? 0 ) + 1;

	} );
	if ( world.kind === 'town' ) game.save.vendor.visit = ( game.save.vendor.visit ?? 0 ) + 1;

} } );

// --- simulation for balance / agents ---------------------------------------------------------------------------

// Roll `n` kills at area level `level` without a world and count what drops.
//   opts: { mix: { normal: .85, magic: .12, rare: .03 }, rarityBonus, quantity, tuning, seed }
export function lootSimulation( n = 1000, level = 10, opts = {} ) {

	const rng = new RNG( opts.seed ?? `lootsim:${level}` );
	const mix = opts.mix || { normal: 0.85, magic: 0.12, rare: 0.03 };
	const out = { kills: n, level, items: { normal: 0, magic: 0, rare: 0, unique: 0 }, flasks: 0, gold: 0, currency: {}, runes: 0, uniques: {}, bySlot: {} };
	for ( let i = 0; i < n; i ++ ) {

		const rarity = rng.weighted( Object.keys( mix ), ( k ) => mix[ k ] );
		const drops = rollDrops( { level, rarity, lootMult: 1, quantity: opts.quantity ?? 0, rarityBonus: opts.rarityBonus ?? 0, goldFind: 0, tuning: opts.tuning || {} }, rng );
		for ( const d of drops ) {

			if ( d.type === 'gold' ) out.gold += d.gold;
			else if ( d.type === 'currency' ) out.currency[ d.currency ] = ( out.currency[ d.currency ] ?? 0 ) + 1;
			else if ( d.type === 'rune' ) out.runes ++;
			else {

				const base = get( 'itemBase', d.item.base );
				if ( base.slot === 'flask' ) out.flasks ++;
				else {

					out.items[ d.item.rarity ] ++;
					out.bySlot[ base.slot ] = ( out.bySlot[ base.slot ] ?? 0 ) + 1;

				}

				if ( d.item.unique ) out.uniques[ d.item.unique ] = ( out.uniques[ d.item.unique ] ?? 0 ) + 1;

			}

		}

	}

	const per100 = ( v ) => Math.round( v / n * 100 * 100 ) / 100;
	out.per100 = { items: Object.fromEntries( Object.entries( out.items ).map( ( [ k, v ] ) => [ k, per100( v ) ] ) ), gold: Math.round( out.gold / n * 100 ), currency: per100( Object.values( out.currency ).reduce( ( a, b ) => a + b, 0 ) ), runes: per100( out.runes ), flasks: per100( out.flasks ) };
	return out;

}
