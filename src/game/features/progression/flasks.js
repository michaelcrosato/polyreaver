// Flasks: four belt slots ( save.flasks.slots ) holding flask ITEMS with charges.
// Kills refill charges (more for tougher monsters), the town refills them fully, and
// drinking spends `use` charges:
//   life / mana / hybrid   recover `amount` over `duration` (part instantly with the
//                          "Bubbling" affix); scaled by the belt's flask_effect
//   utility                a timed buff (Quicksilver: +40% movement speed ...)
//   any flask              its "during effect" suffixes (armour, leech, speed ...)
//
// The combat feature's controller emits `potion { entity, slot? }` on the potion
// input; without a slot the smartest flask is picked (life when hurt, else mana,
// else the first ready utility flask). Every drink emits `flask { entity, item, slot }`.

import { TEAM } from '../../core/tuning.js';
import { computeItem } from './items.js';
import { runtime } from './mechanics.js';

export const FLASK_SLOT_COUNT = 4;

// charges gained per kill by monster rarity
const KILL_CHARGES = { normal: 1, magic: 2, rare: 5, unique: 8, boss: 12 };

function incOf( S, stat ) {

	return 1 + S.breakdown( stat, [], false ).inc / 100;

}

export function flaskSlots( save ) {

	save.flasks ||= { slots: [ null, null, null, null ] };
	return save.flasks.slots;

}

export function canDrink( game, index ) {

	const item = flaskSlots( game.save )[ index ];
	if ( ! item ) return 'Empty flask slot';
	const p = game.world?.player;
	if ( ! p || ! p.alive ) return 'You are dead';
	const f = computeItem( item ).flask;
	if ( ( item.charges ?? 0 ) < f.use ) return 'Not enough charges';
	return null;

}

export function drinkFlask( game, index ) {

	const why = canDrink( game, index );
	if ( why ) return { ok: false, reason: why };
	const w = game.world, p = w.player, rt = runtime( w );
	const item = flaskSlots( game.save )[ index ];
	const f = computeItem( item ).flask;
	item.charges -= f.use;
	// the belt's "increased effect of flasks" (the flask's own Potent affix is already in f.amount)
	const eff = incOf( p.stats, 'flask_effect' );
	const dur = f.duration * incOf( p.stats, 'flask_duration' );
	const fx = { slot: index, kind: f.kind, until: w.time + dur, total: dur, life: 0, mana: 0, mods: [] };
	if ( f.kind === 'life' || f.kind === 'mana' || f.kind === 'hybrid' ) {

		const amount = f.amount * eff;
		const instant = amount * f.instant;
		const rest = amount - instant;
		if ( f.kind !== 'mana' ) {

			p.life = Math.min( p.maxLife, p.life + instant );
			fx.life = rest / dur;

		}

		if ( f.kind !== 'life' ) {

			p.mana = Math.min( p.maxMana, p.mana + instant );
			fx.mana = rest / dur;

		}

	}

	fx.mods = f.buff.map( ( m ) => ( { ...m, value: m.value * eff, from: computeItem( item ).name } ) );
	if ( rt ) {

		// one effect per slot: drinking again refreshes it
		rt.flasks = rt.flasks.filter( ( x ) => x.slot !== index );
		rt.flasks.push( fx );
		syncFlaskMods( p, rt );

	}

	const life = game.save.lifetime;
	if ( life ) life.flasksDrunk = ( life.flasksDrunk ?? 0 ) + 1;
	w.events.emit( 'flask', { entity: p, item, slot: index, kind: f.kind, x: p.x, z: p.z } );
	w.events.emit( 'sfx', { id: 'flask', x: p.x, z: p.z, volume: 0.6 } );
	return { ok: true };

}

// The flask the potion button should drink.
export function bestFlask( game ) {

	const p = game.world?.player;
	if ( ! p ) return - 1;
	const slots = flaskSlots( game.save );
	const ready = ( i ) => ! canDrink( game, i );
	const kind = ( i ) => slots[ i ] ? computeItem( slots[ i ] ).flask.kind : null;
	const lifeLow = p.life < p.maxLife * 0.95, manaLow = p.mana < p.maxMana * 0.6;
	const order = [];
	if ( lifeLow ) order.push( 'life', 'hybrid' );
	if ( manaLow ) order.push( 'mana', 'hybrid' );
	order.push( 'utility' );
	for ( const k of order ) for ( let i = 0; i < slots.length; i ++ ) if ( kind( i ) === k && ready( i ) ) return i;
	return - 1;

}

function syncFlaskMods( p, rt ) {

	p.data.progFlaskMods = rt.flasks.flatMap( ( x ) => x.mods );
	p.stats.setSource( 'src:prog-flasks', p.data.progFlaskMods.length ? p.data.progFlaskMods : null );

}

export function updateFlasks( world, dt ) {

	const rt = runtime( world ), p = world.player;
	if ( ! rt || ! p || ! rt.flasks.length ) return;
	const t = world.time;
	if ( ! p.alive ) {

		rt.flasks = [];
		syncFlaskMods( p, rt );
		return;

	}

	for ( const fx of rt.flasks ) {

		if ( fx.life ) p.life = Math.min( p.maxLife, p.life + fx.life * dt );
		if ( fx.mana ) p.mana = Math.min( p.maxMana, p.mana + fx.mana * dt );

	}

	const before = rt.flasks.length;
	rt.flasks = rt.flasks.filter( ( fx ) => t < fx.until );
	if ( rt.flasks.length !== before ) syncFlaskMods( p, rt );

}

export function gainFlaskCharges( game, rarity = 'normal' ) {

	const p = game.world?.player;
	const mult = p ? incOf( p.stats, 'flask_charges_gained' ) : 1;
	for ( const item of flaskSlots( game.save ) ) {

		if ( ! item ) continue;
		const f = computeItem( item ).flask;
		item.charges = Math.min( f.max, ( item.charges ?? 0 ) + ( KILL_CHARGES[ rarity ] ?? 1 ) * mult * f.gain );

	}

}

export function refillFlasks( save ) {

	for ( const item of flaskSlots( save ) ) if ( item ) item.charges = computeItem( item ).flask.max;

}

// Wire flasks into a world: potion input/event, kill charges.
export function installFlasks( game, world ) {

	const rt = runtime( world );
	world.events.on( 'potion', ( ev ) => {

		if ( ev.entity && ev.entity !== world.player ) return;
		if ( rt ) rt.potionFrame = world.frame;
		const i = ev.slot ?? bestFlask( game );
		if ( i >= 0 ) drinkFlask( game, i );

	} );
	world.events.on( 'death', ( ev ) => {

		if ( ev.entity.team === TEAM.ENEMY && world.player?.alive ) gainFlaskCharges( game, ev.entity.data.rarity || ( ev.entity.kind === 'boss' ? 'boss' : 'normal' ) );

	} );
	if ( world.kind === 'town' ) refillFlasks( game.save );

}

// Fallback for builds without the combat controller: read the potion button directly
// (the frame stamp prevents a double drink when the controller also emits 'potion').
export function pollPotionInput( world ) {

	const rt = runtime( world ), game = rt?.game;
	if ( ! game || ! world.input?.pressed.has( 'potion' ) || rt.potionFrame === world.frame ) return;
	rt.potionFrame = world.frame;
	world.events.emit( 'potion', { entity: world.player, fallback: true } );

}
