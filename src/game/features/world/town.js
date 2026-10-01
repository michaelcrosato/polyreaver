// The town hub's people and service objects (sim side).
//
// NPC entities: kind 'npc', team NEUTRAL, model { type: 'npc', id }, data.service
// (the panel interact opens: craft vendor gamble tree skills stash waypoint dummy).
// They are animated through the normal animation contract: the 'npc' controller
// walks them between their spots, turns them toward the player (anim.aimX/Z is
// where the head looks), greets with a wave and plays EMOTES as actions -
// anim.action = 'hammer' | 'sweep' | 'talk' | 'wave' | 'count' | 'meditate' |
// 'idle_look' - which the creatures feature's rigs pose.
//
// Service objects (stash chest, waypoint obelisk, training dummy) are props with
// model { type: 'mech', id } drawn by the world feature. The dummy is hittable
// (team ENEMY, never dies) and keeps a damage log for the DPS meter.

import { define, get } from '../../core/registry.js';
import { Entity } from '../../core/entity.js';
import { TEAM } from '../../core/tuning.js';
import { canAct } from '../../core/actions.js';
import { makeProp } from './mechanics/kit.js';

const EMOTE_TIME = { hammer: 1.5, sweep: 2.2, talk: 2.6, wave: 1.4, count: 2.4, meditate: 4.5, idle_look: 2.8 };
const emotes = {};

// One action def per emote, built once. Emotes are ordinary actions so every
// renderer, inspector and bot sees them through the same contract as attacks.
export function emote( name ) {

	return emotes[ name ] || ( emotes[ name ] = {
		id: 'emote-' + name, anim: name, duration: EMOTE_TIME[ name ] ?? 2, windup: 0.3, active: 0.7, cancelAt: 0, moveMult: 0, faceAim: false, tags: [ 'emote' ],
		events: name === 'hammer' ? [ { at: 0.45, fn: ( world, e ) => world.events.emit( 'sfx', { id: 'anvil', x: e.x, z: e.z, volume: 0.6 } ) } ] : []
	} );

}

export const NPCS = [
	{ id: 'blacksmith', name: 'Brann Ashhand', title: 'Blacksmith', service: 'craft', station: 'blacksmith', emotes: [ 'hammer', 'hammer', 'hammer', 'idle_look' ], roam: 2.5, facing: - Math.PI / 2 },
	{ id: 'merchant', name: 'Odile Varn', title: 'Merchant', service: 'vendor', services: [ 'vendor', 'gamble' ], station: 'merchant', emotes: [ 'count', 'talk', 'idle_look' ], roam: 2, facing: - Math.PI / 2 },
	{ id: 'gambler', name: 'Kesh the Lucky', title: 'Gambler', service: 'gamble', station: 'gambler', emotes: [ 'count', 'talk', 'idle_look', 'wave' ], roam: 2, facing: - Math.PI / 2 },
	{ id: 'mystic', name: 'Seraphine', title: 'Mystic', service: 'tree', services: [ 'tree', 'skills' ], station: 'mystic', emotes: [ 'meditate', 'meditate', 'talk' ], roam: 1.5, facing: Math.PI * 0.8 },
	{ id: 'guard', name: 'Captain Hale', title: 'Guard', station: 'guard', emotes: [ 'idle_look', 'idle_look', 'talk' ], roam: 3, facing: Math.PI,
		lines: [ 'The waypoint is north. It goes deeper every time.', 'Each level has its own trick. Learn it, then break it.', 'Hit the dummy in the yard if you want to see your numbers.' ] },
	{ id: 'villager-sweeper', name: 'Tamsin', title: 'Villager', station: 'plaza', emotes: [ 'sweep', 'sweep', 'idle_look' ], roam: 9, wander: true,
		lines: [ 'Mind the ash, it gets everywhere.', 'They say the Swarm can be heard from the plaza at night.' ] },
	{ id: 'villager-elder', name: 'Old Wick', title: 'Elder', station: 'plaza', emotes: [ 'talk', 'idle_look', 'wave' ], roam: 9, wander: true,
		lines: [ 'Below the twentieth depth, nothing stays the same twice.', 'Light the braziers in the catacombs, child. All of them.' ] },
	{ id: 'villager-child', name: 'Pip', title: 'Child', station: 'plaza', emotes: [ 'wave', 'wave', 'idle_look' ], roam: 10, wander: true,
		lines: [ 'Are you going down again? Bring me a shiny rock!' ] }
];

define( 'worldHook', { id: 'world-town', order: 50, onWorld( game, world ) {

	if ( world.kind !== 'town' ) return;
	const town = world.layout.meta?.town;
	if ( ! town ) return;
	const st = town.stations, rng = world.rng.fork( 'npcs' );
	const ctl = get( 'controller', 'npc' );

	for ( const def of NPCS ) {

		const home = def.station === 'plaza' ? { x: town.plaza.x + rng.range( - 6, 6 ), z: town.plaza.z + rng.range( - 6, 6 ) } : st[ def.station ];
		if ( ! home ) continue;
		const e = new Entity( { kind: 'npc', name: def.name, team: TEAM.NEUTRAL, x: home.x, z: home.z, radius: 0.42, height: def.id === 'villager-child' ? 1.2 : 1.8, mass: 40, facing: def.facing ?? 0 } );
		e.stats.base.life = 100; e.stats.base.move_speed = def.wander ? 1.6 : 1.3;
		e.life = 100;
		e.model = { type: 'npc', id: def.id };
		e.data = { service: def.service ?? null, services: def.services ?? ( def.service ? [ def.service ] : [] ), title: def.title, interact: def.title, accel: 10, turnRate: 6,
			home, homeFacing: def.facing ?? 0, roam: def.roam, emotes: def.emotes, lines: def.lines ?? null, t: rng.range( 0.5, 3 ), seed: rng.int( 1, 1e6 ) };
		if ( def.lines ) e.data.onInteract = ( w, player, target ) => w.events.emit( 'speech', { entity: target, text: target.data.lines[ ( target.data.line = ( ( target.data.line ?? - 1 ) + 1 ) % target.data.lines.length ) ] } );
		e.controller = ctl ? ctl.create( game, e ) : null;
		world.add( e );

	}

	// service objects
	const add = ( key, model, name, service, opts = {} ) => {

		const s = st[ key ];
		if ( ! s ) return null;
		const e = makeProp( world, { name, x: s.x, z: s.z, model, radius: opts.radius ?? 0.7, height: opts.height ?? 1.2, team: opts.team, life: opts.life, data: { service, title: name, interact: name } } );
		world.add( e );
		return e;

	};

	add( 'stash', 'stash', 'Stash', 'stash', { radius: 0.7 } );
	add( 'waypoint', 'waypoint', 'Waypoint', 'waypoint', { radius: 0.9, height: 3.4 } );
	const dummy = add( 'dummy', 'dummy', 'Training dummy', 'dummy', { team: TEAM.ENEMY, life: 1e7, radius: 0.5, height: 1.8 } );
	if ( dummy ) {

		dummy.data.log = [];
		dummy.data.total = 0; dummy.data.max = 0; dummy.data.first = null;
		world.events.on( 'hit', ( h ) => {

			if ( h.target !== dummy ) return;
			dummy.life = dummy.maxLife;
			const d = dummy.data;
			if ( d.first === null || world.time - d.last > 6 ) {

				d.first = world.time; d.total = 0; d.max = 0; d.log.length = 0;

			}

			d.last = world.time;
			d.total += h.total;
			d.max = Math.max( d.max, h.total );
			d.log.push( world.time, h.total );
			while ( d.log.length && d.log[ 0 ] < world.time - 5 ) d.log.splice( 0, 2 );

		} );

	}

} } );

// DPS over the last 5 seconds of the dummy's log (and since the first hit of a session).
export function dummyStats( world, dummy ) {

	const d = dummy.data;
	let recent = 0;
	for ( let i = 0; i < d.log.length; i += 2 ) if ( d.log[ i ] >= world.time - 5 ) recent += d.log[ i + 1 ];
	const span = d.first === null ? 0 : Math.max( 1, world.time - d.first );
	return { dps5: recent / Math.min( 5, Math.max( 1, span ) ), session: d.first === null ? 0 : d.total / span, total: d.total, max: d.max, active: d.first !== null && world.time - d.last < 6 };

}

// --- the NPC brain ---------------------------------------------------------------------

define( 'controller', { id: 'npc', create: () => ( {
	update( world, e, dt ) {

		const d = e.data, p = world.player;
		d.t -= dt;
		e.moveIntent.x = e.moveIntent.z = 0;
		const dist = p?.alive ? Math.hypot( p.x - e.x, p.z - e.z ) : Infinity;

		// the player is close: stop, turn to them, look at them, greet once
		if ( dist < 4.5 ) {

			d.goal = null;
			e.anim.aimX = p.x; e.anim.aimZ = p.z;
			if ( ! e.action || e.action.def.anim === 'meditate' ) turnTo( e, Math.atan2( p.x - e.x, p.z - e.z ), dt );
			if ( ! d.greeted && canAct( e ) ) {

				d.greeted = true;
				world.act( e, emote( 'wave' ), { aimX: p.x, aimZ: p.z } );

			}

			return;

		}

		if ( dist > 9 ) d.greeted = false;

		// walking somewhere
		if ( d.goal ) {

			const gx = d.goal.x - e.x, gz = d.goal.z - e.z, gl = Math.hypot( gx, gz );
			if ( gl < 0.4 || d.t < - 12 ) {

				d.goal = null;
				d.t = 2 + rand( d ) * 4;

			} else if ( ! e.action ) {

				e.moveIntent.x = gx / gl * 0.7; e.moveIntent.z = gz / gl * 0.7;
				e.anim.aimX = d.goal.x; e.anim.aimZ = d.goal.z;

			}

			return;

		}

		// at rest: settle into the home facing, emote now and then, or wander off
		if ( ! e.action ) turnTo( e, d.homeFacing, dt * 0.5 );
		e.anim.aimX = e.x + Math.sin( e.facing ) * 4; e.anim.aimZ = e.z + Math.cos( e.facing ) * 4;
		if ( d.t > 0 || e.action ) return;
		const r = rand( d );
		if ( r < 0.6 && d.emotes?.length ) {

			world.act( e, emote( d.emotes[ Math.floor( rand( d ) * d.emotes.length ) ] ) );
			d.t = 1 + rand( d ) * 3;

		} else {

			const a = rand( d ) * Math.PI * 2, rr = rand( d ) * d.roam;
			const g = { x: d.home.x + Math.cos( a ) * rr, z: d.home.z + Math.sin( a ) * rr };
			if ( world.layout.isWalkable( g.x, g.z ) && world.layout.hasLineOfSight( e.x, e.z, g.x, g.z ) ) d.goal = g;
			d.t = 1;

		}

	}
} ) } );

function turnTo( e, want, dt ) {

	const diff = Math.atan2( Math.sin( want - e.facing ), Math.cos( want - e.facing ) );
	e.facing += diff * Math.min( 1, 6 * dt );

}

// per-NPC deterministic random stream (no shared RNG draws: NPC idling never changes combat rolls)
function rand( d ) {

	d.seed = ( Math.imul( d.seed, 1664525 ) + 1013904223 ) >>> 0;
	return d.seed / 4294967296;

}
