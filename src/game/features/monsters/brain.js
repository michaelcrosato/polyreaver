// The monster brain: controller 'monster', one instance per monster.
//
//   SENSE  (5 Hz, staggered)  find / keep a target: aggro radius + line of sight
//                             (or close enough to hear), leash back home, pack alerts
//   DECIDE (when allowed)     utility scoring over the ability loadout: in range?
//                             line of sight? off cooldown? attack token free?
//                             × weight × the ability's own score() × a little noise
//   ACT    (every step)       start the chosen action, or let the archetype's tactic
//                             position the body ( tactics.js )
//
// FAIRNESS lives here as three rules every monster obeys:
//   1. reaction time - a monster that just spotted you waits 0.3-0.8 s before attacking
//   2. breathing room - after each attack a pause ( archetype.pause ), shorter at depth
//   3. attack tokens - only so many monsters may be winding up melee / ranged / heavy
//      attacks at once ( world.state.tokens ); the rest circle and wait. Big packs
//      stay readable, and a skilled player is never hit by eight things at once.

import { define, get } from '../../core/registry.js';
import { actionFor, abilityRange, crashCharge, emerge } from './abilities.js';
import { stop, moveTo, turnToward, steer } from './nav.js';
import { fidget, patrol } from './tactics.js';
import { aiRng, edgeDist, isHostile, clearWalk, salt } from './util.js';
import { hooks } from './factory.js';

export class MonsterBrain {

	constructor( e ) {

		this.e = e;
		e.data.brain = this;
		this.arch = get( 'archetype', e.data.archetype ) || get( 'archetype', 'brawler' );
		this.state = 'idle'; // idle | combat | return | dormant
		this.target = null;
		this.home = e.data.home ? { ...e.data.home } : { x: e.x, z: e.z };
		this.aggro = ( this.arch.aggro ?? 13 ) + ( e.data.rarity === 'rare' || e.data.rarity === 'unique' ? 2 : 0 );
		this.leash = this.arch.leash ?? 42;
		this.nextSense = 0; this.nextAttack = 0; this.lastSeen = - 99;
		this.los = false; this.clear = false; this.waiting = false;
		this.strafeDir = salt( e ) % 2 ? 1 : - 1; this.nextStrafe = 0;
		this.idleUntil = 0; this.wanderTo = null; this.returnSince = 0;
		this.abilities = null;
		if ( this.arch.faceTarget ) e.data.turnRate = 0; // we turn the body ourselves ( turnToward )

	}

	update( world, e, dt ) {

		think( world, e, this, dt );

	}

}

define( 'controller', { id: 'monster', create: ( game, e ) => new MonsterBrain( e ) } );

// --- the per-step loop ----------------------------------------------------------------

function think( world, e, b, dt ) {

	runAffixes( world, e, dt );
	if ( ! e.alive ) return;
	if ( e.data.burrow ) return burrowTravel( world, e, b );
	if ( e.data.charging && world.time - e.data.charging.start > 0.15 && world.time - ( e.data.forcedHitWall ?? - 9 ) < dt * 1.5 + 1e-6 ) crashCharge( world, e );
	if ( e.flags.stunned || e.flags.frozen || world.time < ( e.data.spawnUntil ?? 0 ) ) return stop( e );
	if ( b.state === 'dormant' ) return stop( e );
	if ( world.time >= b.nextSense ) sense( world, e, b );
	b.arch.think?.( world, e, b, dt );
	if ( b.state === 'combat' ) combat( world, e, b, dt );
	else if ( b.state === 'return' ) goHome( world, e, b, dt );
	else if ( e.data.pack?.kind === 'wander' ) patrol( world, e, b );
	else fidget( world, e, b );
	if ( b.arch.faceTarget && ! e.action ) {

		const t = b.state === 'combat' ? b.target : null;
		if ( t ) turnToward( e, t.x, t.z, b.arch.turnSpeed ?? 6, dt );
		else if ( Math.hypot( e.moveIntent.x, e.moveIntent.z ) > 0.1 ) turnToward( e, e.x + e.moveIntent.x, e.z + e.moveIntent.z, 6, dt );

	}

}

export function runAffixes( world, e, dt ) {

	const list = e.data.affixes;
	if ( ! list?.length ) return;
	for ( const id of list ) {

		const a = get( 'monsterAffix', id );
		if ( a?.update ) a.update( world, e, e.data.affixState[ id ], dt );

	}

}

// --- SENSE ------------------------------------------------------------------------------

function sense( world, e, b ) {

	b.nextSense = world.time + 0.18 + ( salt( e ) % 7 ) * 0.01;
	if ( b.state === 'combat' ) {

		const t = b.target;
		if ( ! t || ! t.alive ) return retarget( world, e, b );
		b.los = world.layout.hasLineOfSight( e.x, e.z, t.x, t.z );
		b.clear = b.los && clearWalk( world, e.x, e.z, t.x, t.z );
		if ( b.los && ! t.flags.untargetable ) b.lastSeen = world.time;
		const fromHome = Math.hypot( e.x - b.home.x, e.z - b.home.z );
		const far = Math.hypot( e.x - t.x, e.z - t.z ) > b.aggro * 1.3;
		if ( ( fromHome > b.leash && far ) || world.time - b.lastSeen > 7 ) disengage( world, e, b );
		return;

	}

	if ( b.state === 'return' ) return;
	const t = findTarget( world, e, b.aggro );
	if ( t ) engage( world, e, b, t, true );

}

function findTarget( world, e, r ) {

	let best = null, bd = Infinity;
	for ( const o of world.query( e.x, e.z, r, ( o ) => isHostile( e, o ) ) ) {

		const d = Math.hypot( o.x - e.x, o.z - e.z );
		if ( d >= bd ) continue;
		// hearing: very close targets are noticed even around a corner
		if ( d > 4.5 && ! world.layout.hasLineOfSight( e.x, e.z, o.x, o.z ) ) continue;
		best = o; bd = d;

	}

	return best;

}

function retarget( world, e, b ) {

	const t = findTarget( world, e, b.aggro * 1.2 );
	if ( t ) {

		b.target = t;
		b.lastSeen = world.time;

	} else disengage( world, e, b, 'idle' );

}

// Start fighting `t`. alert: also wake the pack and idle neighbours (social aggro).
export function engage( world, e, b, t, alert = false ) {

	if ( ! e.alive || b.state === 'dormant' ) return;
	const fresh = b.state !== 'combat';
	b.state = 'combat';
	b.target = t;
	b.lastSeen = world.time;
	b.los = true;
	if ( fresh ) {

		// reaction time: a monster never attacks on the step it notices you
		b.nextAttack = Math.max( b.nextAttack, world.time + 0.3 + aiRng( world ).next() * 0.5 );
		world.events.emit( 'aggro', { entity: e, target: t, x: e.x, z: e.z } );

	}

	if ( ! alert ) return;
	const pack = e.data.pack;
	if ( pack ) {

		pack.alerted = true;
		for ( const m of pack.members ) {

			const mb = m.data.brain;
			if ( m !== e && m.alive && mb && mb.state !== 'combat' && mb.state !== 'dormant' ) engage( world, m, mb, t, false );

		}

	}

	for ( const o of world.query( e.x, e.z, 6, ( o ) => o !== e && o.alive && o.team === e.team && o.data.brain?.state === 'idle' ) ) engage( world, o, o.data.brain, t, false );

}

function disengage( world, e, b, to = 'return' ) {

	b.target = null;
	b.state = to;
	b.returnSince = world.time;
	b.waiting = false;

}

// Being hit always aggroes (and alerts the pack), even out of sight range.
hooks.hit.push( ( world, h ) => {

	const t = h.target, b = t.data?.brain;
	if ( ! b || ! h.source || ! t.alive || b.state === 'combat' || b.state === 'dormant' || ! isHostile( t, h.source ) ) return;
	engage( world, t, b, h.source, true );

} );

// --- DECIDE + ACT --------------------------------------------------------------------------

function combat( world, e, b, dt ) {

	const t = b.target;
	if ( ! t || ! t.alive ) return retarget( world, e, b );
	e.anim.aimX = t.x; e.anim.aimZ = t.z;
	if ( e.action ) {

		if ( e.action.def.chase ) moveTo( world, e, t.x, t.z, 1, t === world.player );
		else stop( e );
		return;

	}

	if ( e.forced ) return;
	const d = edgeDist( e, t );
	b.waiting = false;
	if ( world.time >= b.nextAttack ) {

		const ab = chooseAbility( world, e, b, t, d );
		if ( ab && useAbility( world, e, b, ab, t ) ) return;

	}

	b.arch.move( world, e, b, t, d, dt );

}

function abilitiesOf( e, b ) {

	const ids = e.data.abilities || [];
	if ( ! b.abilities || b.abilityCount !== ids.length ) {

		b.abilities = ids.map( ( id ) => get( 'monsterAbility', id ) ).filter( Boolean );
		b.abilityCount = ids.length;

	}

	return b.abilities;

}

// Utility scoring. Hard filters first (cooldown, range, sight, tokens), then
// weight × situational score × noise; the highest wins. Abilities that are only
// blocked by a busy token mark the monster as `waiting` so its tactic can circle.
export function chooseAbility( world, e, b, t, d ) {

	const rng = aiRng( world );
	let best = null, bestScore = 0;
	for ( const ab of abilitiesOf( e, b ) ) {

		if ( ( e.cooldowns.get( ab.id ) ?? 0 ) > world.time ) continue;
		const [ lo, hi ] = abilityRange( ab, e );
		if ( d < lo || d > hi ) continue;
		if ( ab.los && ! b.los ) continue;
		let s = ab.weight * ( ab.score ? ab.score( world, e, t, d, b ) : 1 );
		if ( s <= 0 ) continue;
		if ( ! tokenFree( world, ab.token, e ) ) {

			b.waiting = true;
			continue;

		}

		s *= 0.75 + rng.next() * 0.5;
		if ( s > bestScore ) {

			bestScore = s;
			best = ab;

		}

	}

	return best;

}

export function useAbility( world, e, b, ab, t ) {

	const act = ab.use ? ab.use( world, e, t, b ) : world.act( e, actionFor( ab, e ), { target: t, aimX: t.x, aimZ: t.z } );
	if ( ! act ) return false;
	const cdr = Math.max( 0.25, e.stats.get( 'cooldown_recovery' ) || 1 );
	e.cooldowns.set( ab.id, world.time + ab.cooldown / cdr );
	takeToken( world, ab.token, e, ( act.duration ?? 1 ) + 0.15 );
	const [ p0, p1 ] = b.arch.pause || [ 0.35, 0.8 ];
	const aggression = Math.max( 0.75, 1 - ( e.level - 1 ) * 0.003 ); // deeper monsters pause a little less
	b.nextAttack = world.time + ( act.duration ?? 0.8 ) + ( p0 + aiRng( world ).next() * ( p1 - p0 ) ) * aggression;
	b.arch.onUse?.( world, e, b, ab );
	return true;

}

// --- attack tokens -----------------------------------------------------------------------

export function tokenLimits( world ) {

	// Tokens set the incoming damage rate more than any stat does (each one is a
	// monster allowed to swing right now), so they grow slowly: 2 melee / 1 ranged /
	// 1 heavy while a fresh character learns the game (depth 1-2), 3 / 2 / 2 from
	// depth 3, one more of each at a few milestones, ending at 6 / 5 / 3.
	const depth = world.spec?.depth ?? world.level ?? 1;
	if ( depth <= 2 ) return { melee: 2, ranged: 1, heavy: 1 };
	return {
		melee: 3 + ( depth >= 30 ) + ( depth >= 100 ) + ( depth >= 200 ),
		ranged: 2 + ( depth >= 40 ) + ( depth >= 150 ) + ( depth >= 300 ),
		heavy: 2 + ( depth >= 200 )
	};

}

function tokenPool( world ) {

	const s = world.state;
	return s.tokens || ( s.tokens = { melee: new Map(), ranged: new Map(), heavy: new Map(), max: tokenLimits( world ) } );

}

export function tokenFree( world, kind, e ) {

	if ( ! kind || e.kind === 'boss' ) return true;
	const T = tokenPool( world ), map = T[ kind ];
	let n = 0;
	for ( const [ id, until ] of map ) {

		if ( until <= world.time ) map.delete( id );
		else if ( id !== e.id ) n ++;

	}

	// while a boss is fighting, its adds may not stack heavy telegraphs on top
	const max = kind === 'heavy' && world.state.bossActive ? 1 : T.max[ kind ];
	return n < max;

}

function takeToken( world, kind, e, seconds ) {

	if ( ! kind || e.kind === 'boss' ) return;
	tokenPool( world )[ kind ].set( e.id, world.time + seconds );

}

// --- idle, return, burrow -------------------------------------------------------------------

function goHome( world, e, b, dt ) {

	const d = Math.hypot( b.home.x - e.x, b.home.z - e.z );
	e.life = Math.min( e.maxLife, e.life + e.maxLife * 0.1 * dt ); // out-of-combat recovery
	if ( d < 1 || world.time - b.returnSince > 6 ) {

		if ( d >= 1 ) b.home = { x: e.x, z: e.z }; // could not get back: this is home now
		b.state = 'idle';
		b.idleUntil = world.time + 1;
		return stop( e );

	}

	moveTo( world, e, b.home.x, b.home.z, 0.8, false );

}

// Underground travel ( after the 'burrow' ability ): move toward the target unseen,
// then erupt beneath it - the eruption is a 0.7 s telegraph ( abilities.js emerge ).
function burrowTravel( world, e, b ) {

	const t = b.target && b.target.alive ? b.target : null;
	const bur = e.data.burrow;
	if ( ! bur.boost ) {

		bur.boost = true;
		e.stats.setSource( 'burrow', [ { stat: 'move_speed', type: 'more', value: 60 } ] );

	}

	const close = t && Math.hypot( t.x - e.x, t.z - e.z ) < 1.6;
	if ( ! t || world.time > bur.until || ( close && tokenFree( world, 'heavy', e ) ) ) {

		e.stats.setSource( 'burrow', null );
		const p = t && world.layout.isWalkable( t.x, t.z ) && clearWalk( world, e.x, e.z, t.x, t.z ) ? t : e;
		takeToken( world, 'heavy', e, 1 );
		emerge( world, e, p.x, p.z );
		b.nextAttack = world.time + 1.2;
		return stop( e );

	}

	if ( close ) return steer( world, e, t.z - e.z, e.x - t.x, 0.4 ); // circle under you, waiting for a token
	moveTo( world, e, t.x, t.z, 1, t === world.player );

}

// Ambushers: hidden until the director wakes them.
export function makeDormant( e ) {

	const b = e.data.brain;
	if ( ! b ) return;
	b.state = 'dormant';
	e.flags.untargetable = true;
	e.flags.ghost = true;
	e.data.hidden = true;
	if ( e.model ) e.model.hidden = true;

}

export function wake( world, e, x, z, target ) {

	const b = e.data.brain;
	if ( ! b || ! e.alive ) return;
	e.flags.untargetable = false;
	e.flags.ghost = false;
	e.data.hidden = false;
	if ( e.model ) e.model.hidden = false;
	if ( x !== undefined ) {

		e.x = e.px = x; e.z = e.pz = z;

	}

	b.home = { x: e.x, z: e.z };
	b.state = 'idle';
	e.data.spawnUntil = world.time + 0.6;
	if ( target ) engage( world, e, b, target, false );
	b.nextAttack = world.time + 1.1;

}

// The 'spawn' animation state (rising from the ground) for fresh summons and
// ambushers. Runs after movement, which otherwise writes idle/move every step.
define( 'system', { id: 'monster-anim', order: 55, update( world ) {

	for ( const e of world.entities ) {

		const until = e.data.spawnUntil;
		if ( ! until || ! e.alive || e.action ) continue;
		if ( world.time < until ) {

			e.anim.state = 'spawn';
			e.anim.t = 1 - ( until - world.time ) / 0.6;

		} else e.data.spawnUntil = 0;

	}

} } );
