// Baseline content: the smallest set of defs that makes the game playable end to
// end (move, attack, dodge, fight a chaser, finish an arena). Every subsystem
// replaces or extends these by defining the same ids later - define() keeps the
// LAST definition - so this file is also the minimal reference for each kind.

import { define, get } from '../core/registry.js';
import { Entity } from '../core/entity.js';
import { TEAM, monsterScaling } from '../core/tuning.js';
import { canAct, faceToward } from '../core/actions.js';
import { makeArena } from '../core/layout.js';
import { MONSTER_BASE } from '../game.js';

// --- statuses ------------------------------------------------------------------

define( 'status', { id: 'stun', name: 'Stunned', tags: [ 'debuff', 'cc' ], duration: 0.3, stack: 'refresh', flags: [ 'stunned' ],
	onApply( world, e ) {

		if ( e.action && ! e.action.def.unstoppable ) {

			e.action.def.onCancel?.( world, e, e.action, 'stun' );
			e.action = null;

		}

	} } );

// --- player ---------------------------------------------------------------------

const SLASH = {
	id: 'basic-slash', anim: 'slash', duration: 0.42, speedStat: 'attack_speed', tags: [ 'attack', 'melee' ],
	windup: 0.3, active: 0.55, cancelAt: 0.55, moveMult: 0.35, lunge: { from: 0.2, to: 0.4, speed: 5 },
	events: [ { at: 0.32, fn: ( world, e, act ) => world.melee( e, { range: 2.6, angle: 150, fx: 'slash', hit: { tags: [ 'attack', 'melee' ], knockback: 5, skill: 'basic-slash' } } ) } ]
};

define( 'controller', { id: 'player', create: () => ( {
	update( world, e, dt ) {

		const inp = world.input;
		if ( ! inp || ! e.alive ) return;
		e.moveIntent.x = inp.move.x; e.moveIntent.z = inp.move.z;
		e.anim.aimX = inp.aim.x; e.anim.aimZ = inp.aim.z;
		const ready = ( k ) => ( e.cooldowns.get( k ) ?? 0 ) <= world.time;
		if ( inp.pressed.has( 'dodge' ) && ready( 'dodge' ) && ! e.forced ) {

			let dx = inp.move.x, dz = inp.move.z;
			if ( Math.hypot( dx, dz ) < 0.2 ) {

				dx = Math.sin( e.facing ); dz = Math.cos( e.facing );

			}

			const l = Math.hypot( dx, dz ), dur = 0.28, dist = e.stats.get( 'dodge_distance' );
			e.action = null;
			e.facing = Math.atan2( dx, dz );
			e.flags.invulnerable = true;
			e.data.dodging = true;
			e.anim.seq ++;
			e.forced = { vx: dx / l * dist / dur, vz: dz / l * dist / dur, time: dur, onEnd: ( w, en ) => {

				en.flags.invulnerable = false;
				en.data.dodging = false;

			} };
			e.cooldowns.set( 'dodge', world.time + e.stats.get( 'dodge_cooldown' ) );
			world.events.emit( 'dodge', { entity: e, x: e.x, z: e.z } );
			return;

		}

		if ( inp.held.has( 'attack' ) && canAct( e ) && ! e.forced ) {

			e.data.combo = ( world.time - ( e.data.lastSwing ?? - 9 ) < 0.6 ) ? ( ( e.data.combo ?? 0 ) + 1 ) % 3 : 0;
			e.data.lastSwing = world.time;
			world.act( e, SLASH, { aimX: inp.aim.x, aimZ: inp.aim.z, ctx: { variant: e.data.combo }, force: e.action !== null } );

		}

	}
} ) } );

define( 'system', { id: 'controllers', order: 15, update( world, dt ) {

	for ( const e of world.entities ) if ( e.alive && e.controller ) e.controller.update( world, e, dt );

} } );

// --- a monster, an AI and a level -------------------------------------------------

const BITE = {
	id: 'bite', anim: 'bite', duration: 0.9, speedStat: 'attack_speed', windup: 0.55, active: 0.7, moveMult: 0.1, turn: true, tags: [ 'attack', 'melee' ],
	events: [ { at: 0.55, fn: ( world, e ) => world.melee( e, { range: e.radius + 1.3, angle: 90, hit: { tags: [ 'attack', 'melee' ], damage: { physical: e.data.damage }, knockback: 3, skill: 'bite' } } ) } ]
};

define( 'controller', { id: 'chaser', create: () => ( {
	update( world, e ) {

		const p = world.player;
		if ( ! p || ! p.alive ) {

			e.moveIntent.x = e.moveIntent.z = 0;
			return;

		}

		const d = e.distTo( p );
		e.anim.aimX = p.x; e.anim.aimZ = p.z;
		if ( d < e.radius + p.radius + 1.0 ) {

			e.moveIntent.x = e.moveIntent.z = 0;
			if ( canAct( e ) ) world.act( e, BITE, { target: p, aimX: p.x, aimZ: p.z } );

		} else if ( d < 30 && ! e.action ) {

			e.moveIntent.x = ( p.x - e.x ) / d; e.moveIntent.z = ( p.z - e.z ) / d;
			faceToward( e, p.x, p.z );

		}

	}
} ) } );

// Build a basic monster entity (the monster subsystem replaces this with genomes,
// archetypes and affixes; the shape of the call stays the same).
export function makeBasicMonster( world, x, z, level = world.level ) {

	const sc = monsterScaling( level );
	const m = new Entity( { kind: 'monster', name: 'Husk', team: TEAM.ENEMY, level, x, z, radius: 0.45, mass: 1 } );
	for ( const k in MONSTER_BASE ) m.stats.base[ k ] = MONSTER_BASE[ k ];
	m.stats.base.life = 40 * sc.life;
	m.stats.base.armor = sc.armor;
	m.data.damage = [ 4 * sc.damage, 7 * sc.damage ];
	m.data.xp = 12 * sc.xp;
	m.model = { type: 'creature', id: 'husk', seed: Math.floor( world.rng.next() * 1e9 ) };
	m.controller = get( 'controller', 'chaser' ).create( world.game, m );
	m.life = m.maxLife;
	return m;

}

define( 'levelGenerator', { id: 'arena', generate: () => makeArena( 26, 26 ) } );

define( 'worldHook', { id: 'baseline-population', order: 90, onWorld( game, world ) {

	// only when no encounter director has been registered by the monster subsystem
	if ( world.kind !== 'level' || world.state.populated ) return;
	for ( let i = 0; i < 10; i ++ ) {

		const p = world.layout.randomFloor( world.rng, { awayFrom: world.layout.start, minDist: 10 } );
		world.add( makeBasicMonster( world, p.x, p.z ) );

	}

	world.state.populated = true;

} } );

// XP + gold on kill (the progression subsystem replaces this with loot drops).
define( 'worldHook', { id: 'baseline-rewards', order: 95, onWorld( game, world ) {

	world.events.on( 'death', ( d ) => {

		if ( d.entity.team !== TEAM.ENEMY || ! d.killer || d.killer.team !== TEAM.PLAYER ) return;
		game.gainXp( d.entity.data.xp ?? 10 );

	} );

} } );
