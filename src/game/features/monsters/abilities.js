// Monster abilities: the verbs of every monster and the fillers between boss
// patterns. Each is a registry def ( define( 'monsterAbility', ... ) ) that pairs
// an ACTION (core/actions.js timeline, delivered with world.melee / projectile /
// area) with the facts the AI needs to use it well:
//
//   roles     which archetypes may slot it ( melee heavy ranged caster support summon mobility )
//   token     attack-token pool it draws from ( 'melee' | 'ranged' | 'heavy' | null ) - see brain.js
//   range     [ min, max ] metres between the two bodies' edges where it may start,
//             or a function ( e ) => [ min, max ] for body-size dependent reach
//   cooldown  seconds;  weight: base utility;  los: needs line of sight (default true)
//   score( world, e, target, dist, brain ) optional utility multiplier (0 = not now)
//   anim      §4 vocabulary name, or { plan: anim, default } per body plan
//   action    the action def, or use( world, e, target, brain ) to start it by hand
//
// FAIRNESS: every 'heavy' ability telegraphs - a ground area with `delay` ≥ 0.45 s,
// cancelled if the monster is stunned or killed during its windup.

import { define, get } from '../../core/registry.js';
import { hitOf, telegraph, cancelTelegraphs, cancelArea, windupSeconds, elementOf, fxOf, colorOf, ahead, clampWalk, ringPoint,
	teleport, alliesNear, foesNear, healFrac, pull, tickHit, aiRng, isHostile, clearWalk, MOVE_BLOCKERS, laneKnock } from './util.js';
import { spawnMonster } from './factory.js';

const ability = ( def ) => define( 'monsterAbility', { weight: 1, cooldown: 2, los: true, roles: [], token: 'melee', ...def } );
const reachOf = ( e ) => e.data.reach ?? 1.2;
const meleeRange = ( extra = 0 ) => ( e ) => [ 0, reachOf( e ) * 0.85 + extra ];
const MELEE_ANIM = { biped: 'slash', quadruped: 'bite', hexapod: 'claw', serpent: 'bite', floater: 'cast', blob: 'slam', arachnid: 'bite', avian: 'claw', default: 'claw' };

// A plain melee swing: one or more arcs at fixed points of the timeline.
function melee( { id, name, anim = MELEE_ANIM, mult = 1, duration = 0.9, windup = 0.5, active = 0.66, extraReach = 0, angle = 110,
	knockback = 3, stun, ailments, split = 0.5, hits = [ windup ], lunge = 2.5, fx = 'slash', roles = [ 'melee' ], cooldown = 1, weight = 1, tags = [] } ) {

	const each = mult / hits.length;
	return ability( {
		id, name, anim, roles, cooldown, weight, tags: [ 'melee', ...tags ], token: 'melee', range: meleeRange( extraReach ),
		action: {
			id, duration, speedStat: 'attack_speed', windup, active, moveMult: 0.15, turn: true, tags: [ 'attack', 'melee' ],
			lunge: lunge ? { from: windup - 0.12, to: windup, speed: lunge } : null,
			events: hits.map( ( at ) => ( { at, fn: ( world, e ) => world.melee( e, {
				range: e.radius + reachOf( e ) + extraReach, angle, fx, element: elementOf( e ),
				hit: hitOf( e, each, { split, tags: [ 'attack', 'melee' ], knockback, stun, ailments, skill: id } )
			} ) } ) )
		}
	} );

}

// A telegraphed heavy hit: the ground area is placed when the windup STARTS and
// lands when it ends, so what you see is exactly what gets hit.
function heavy( { id, name, anim, mult, duration = 1.35, windup = 0.52, active = 0.68, shape, knockback = 8, stun, ailments, split = 0.5,
	range, cooldown = 4.5, weight = 1.4, roles = [ 'heavy' ], unstoppable = false, tags = [], score, element } ) {

	return ability( {
		id, name, anim, roles, cooldown, weight, token: 'heavy', range, score, tags: [ 'heavy', ...tags ],
		action: {
			id, duration, speedStat: 'attack_speed', windup, active, moveMult: 0, turn: false, unstoppable, tags: [ 'attack', 'area' ],
			onStart( world, e, act ) {

				const hit = hitOf( e, mult, { element, split, tags: [ 'attack', 'area' ], knockback, stun, ailments, skill: id } );
				telegraph( world, e, act, { element, ...shape( world, e, act ), delay: Math.max( 0.45, windupSeconds( act ) ), hit } );

			},
			onCancel: cancelTelegraphs
		}
	} );

}

// A projectile attack/spell: `count` projectiles spread over `spread` degrees.
function shot( { id, name, anim = 'spit', mult = 1, duration = 1.0, windup = 0.55, speed = 14, count = 1, spread = 0, range = [ 2, 13 ], radius = 0.35,
	fx, split = 1, ailments, pierce = 0, chain = 0, cooldown = 2.2, weight = 1, token = 'ranged', roles = [ 'ranged' ], tags = [], onHit, onEnd, element, ring = false, kind = 'spell' } ) {

	return ability( {
		id, name, anim, roles, cooldown, weight, token, range, tags: [ 'ranged', ...tags ],
		action: {
			id, duration, speedStat: kind === 'attack' ? 'attack_speed' : 'cast_speed', windup, active: windup + 0.1, moveMult: 0.1, turn: true, tags: [ kind, 'projectile' ],
			events: [ { at: windup, fn( world, e, act ) {

				const el = elementOf( e, element );
				const t = act.target;
				const base = t ? Math.atan2( t.x - e.x, t.z - e.z ) : e.facing;
				const hit = hitOf( e, mult / Math.sqrt( count ), { element, split, tags: [ kind, 'projectile' ], ailments, skill: id } );
				for ( let i = 0; i < count; i ++ ) {

					const dir = ring ? base + i / count * Math.PI * 2 : base + ( count > 1 ? ( i / ( count - 1 ) - 0.5 ) * spread * Math.PI / 180 : 0 );
					world.projectile( e, { dir, speed, range: range[ 1 ] + 4, radius, pierce, chain, hit, fx: fx || fxOf( el, 'bolt' ), color: colorOf( el ), element: el, y: Math.max( 0.6, e.height * 0.6 ), onHit, onEnd } );

				}

			} } ]
		}
	} );

}

// A caster AoE: the cast animation is the first warning, then the ground
// telegraph appears at the target and lands `delay` seconds later.
function cast( { id, name, anim = 'cast', duration = 1.1, windup = 0.5, range = [ 3, 13 ], cooldown = 5, weight = 1.2, token = 'heavy', roles = [ 'caster' ], tags = [], place, score } ) {

	return ability( {
		id, name, anim, roles, cooldown, weight, token, range, score, tags: [ 'caster', ...tags ],
		action: {
			id, duration, speedStat: 'cast_speed', windup, active: windup + 0.15, moveMult: 0.1, turn: true, tags: [ 'spell', 'area' ],
			events: [ { at: windup, fn: ( world, e, act ) => place( world, e, act.target || world.player, act ) } ]
		}
	} );

}

// =====================================================================================
// MELEE
// =====================================================================================

melee( { id: 'strike', name: 'Strike' } );
melee( { id: 'bite', name: 'Bite', anim: 'bite', duration: 0.8, mult: 1, ailments: { bleed: 15 }, fx: 'bite', angle: 80 } );
melee( { id: 'claw', name: 'Raking Claws', anim: { biped: 'slash', default: 'claw' }, duration: 1.05, hits: [ 0.42, 0.62 ], mult: 1.15, fx: 'claw' } );
melee( { id: 'slash', name: 'Slash', anim: { biped: 'slash', default: 'claw' }, duration: 0.95, mult: 1.1, angle: 125 } );
melee( { id: 'thrust', name: 'Spear Thrust', anim: { biped: 'thrust', default: 'bite' }, duration: 1.0, windup: 0.55, mult: 1.2, extraReach: 1.2, angle: 40, fx: 'thrust' } );
melee( { id: 'sting', name: 'Venom Sting', anim: { biped: 'thrust', default: 'tail' }, duration: 0.95, mult: 0.9, split: 0.7, ailments: { poison: 60 }, fx: 'poison', angle: 70 } );
// (no stun: several bearers would stun-lock you - knockback shoves you out of the fight instead)
melee( { id: 'shield-bash', name: 'Shield Bash', anim: { biped: 'block', default: 'charge' }, duration: 0.8, windup: 0.5, mult: 0.8, knockback: 10, angle: 90, fx: 'slam', cooldown: 3, weight: 1.4 } );
melee( { id: 'peck', name: 'Peck', anim: { avian: 'bite', default: 'bite' }, duration: 0.6, windup: 0.45, mult: 0.55, knockback: 1, lunge: 4, fx: 'bite', angle: 70 } );

// =====================================================================================
// HEAVY (telegraphed)
// =====================================================================================

heavy( { id: 'slam', name: 'Ground Slam', anim: { biped: 'overhead', default: 'slam' }, mult: 2.2, range: meleeRange( 0.6 ), unstoppable: true,
	shape: ( world, e ) => ( { ...ahead( e, e.radius + reachOf( e ) * 0.9 ), radius: 1.6 + e.radius * 0.5, fx: 'slam' } ) } );

heavy( { id: 'stomp', name: 'Stomp', anim: 'stomp', mult: 1.5, knockback: 10, range: ( e ) => [ 0, e.radius + 1.6 ], duration: 1.25,
	shape: ( world, e ) => ( { x: e.x, z: e.z, radius: e.radius + 2.3, fx: 'slam' } ) } );

heavy( { id: 'cleave', name: 'Cleave', anim: { biped: 'overhead', default: 'claw' }, mult: 1.8, range: meleeRange( 0.8 ),
	shape: ( world, e, act ) => ( { x: e.x, z: e.z, shape: 'cone', angle: 130, dir: act.target ? Math.atan2( act.target.x - e.x, act.target.z - e.z ) : e.facing, radius: e.radius + reachOf( e ) + 1.6, fx: 'slash' } ) } );

heavy( { id: 'tail-sweep', name: 'Tail Sweep', anim: 'tail', mult: 1.3, knockback: 9, duration: 1.2, range: ( e ) => [ 0, e.radius + 1.8 ], cooldown: 5,
	shape: ( world, e ) => ( { x: e.x, z: e.z, shape: 'ring', inner: 0, radius: e.radius + 2.6, fx: 'slam' } ) } );

heavy( { id: 'frost-nova', name: 'Frost Nova', anim: { biped: 'cast_aoe', default: 'roar' }, mult: 1.2, knockback: 2, ailments: { chill: 100 }, split: 1,
	duration: 1.3, windup: 0.5, range: ( e ) => [ 0, e.radius + 3 ], cooldown: 7, roles: [ 'caster', 'heavy' ], tags: [ 'cold' ], element: 'cold',
	shape: ( world, e ) => ( { x: e.x, z: e.z, radius: e.radius + 3.8, fx: 'ice' } ) } );

// Charge: a locked-in lane is shown for 0.7 s, then the monster rushes down it.
// Crashing into a wall stuns it and leaves it exposed - bait charges into walls.
ability( {
	id: 'charge', name: 'Charge', anim: 'charge', roles: [ 'heavy' ], token: 'heavy', range: [ 3.5, 13 ], cooldown: 6, weight: 2.2, tags: [ 'heavy', 'movement' ],
	action: {
		id: 'charge', duration: 1.9, speedStat: null, windup: 0.37, active: 0.8, cancelAt: 1, moveMult: 0, turn: false, tags: [ 'attack', 'melee' ],
		onStart( world, e, act ) {

			const t = act.target;
			const dir = t ? Math.atan2( t.x - e.x, t.z - e.z ) : e.facing;
			e.facing = dir;
			const want = t ? Math.min( 15, Math.hypot( t.x - e.x, t.z - e.z ) + 4 ) : 10;
			const x1 = e.x + Math.sin( dir ) * want, z1 = e.z + Math.cos( dir ) * want;
			const end = clampWalk( world, e.x, e.z, x1, z1, e.radius );
			const len = Math.max( 2, Math.hypot( end.x - e.x, end.z - e.z ) );
			// does the lane end in a wall? then the charge ends in a crash
			const wall = world.layout.raycast( e.x, e.z, x1, z1, MOVE_BLOCKERS ) < 1;
			Object.assign( act.ctx, { dir, len, wall } );
			telegraph( world, e, act, { x: e.x, z: e.z, shape: 'line', dir, length: len + e.radius, width: e.radius * 2 + 0.8, delay: 0.7 } );

		},
		events: [ { at: 0.37, fn( world, e, act ) {

			const speed = 17, time = act.ctx.len / speed;
			e.forced = { vx: Math.sin( act.ctx.dir ) * speed, vz: Math.cos( act.ctx.dir ) * speed, time, onEnd: ( w, en ) => {

				if ( act.ctx.wall && en.data.charging ) crashCharge( w, en );

			} };
			e.data.charging = { act, start: world.time };
			e.flags.ghost = true; // passes through bodies; hits fling them out of the lane ( util.laneKnock )
			act.ctx.contact = world.area( e, { follow: e, radius: e.radius + 0.6, duration: time, interval: 0.05, hitOnce: true, fx: 'charge',
				hit: hitOf( e, 1.8, { split: 0.5, tags: [ 'attack', 'melee' ], skill: 'charge' } ), onHit: ( w, a, t ) => laneKnock( t, act.ctx.dir, e.x, e.z, 12 ) } );

		} } ],
		onEnd: endCharge,
		onCancel( world, e, act ) {

			cancelTelegraphs( world, e, act );
			endCharge( world, e, act );

		}
	}
} );

function endCharge( world, e, act ) {

	if ( act.ctx.contact ) cancelArea( world, act.ctx.contact );
	if ( e.data.charging ) {

		e.forced = null;
		e.flags.ghost = !! e.data.affixes?.includes( 'ghostly' );

	}

	e.data.charging = null;

}

// Called by the brain when a charging monster hit a wall this step.
export function crashCharge( world, e ) {

	const c = e.data.charging;
	if ( ! c ) return;
	endCharge( world, e, c.act );
	world.events.emit( 'shake', { amount: 0.25, x: e.x, z: e.z } );
	world.events.emit( 'sfx', { id: 'crash', x: e.x, z: e.z, volume: 1 } );
	world.applyStatus( e, 'stun', { duration: 1.4 } );
	world.applyStatus( e, 'm-exposed', { duration: 2.2 } );

}

// Leap: the landing circle appears at the start; flight takes 0.5 s.
ability( {
	id: 'leap', name: 'Pounce', anim: 'leap', roles: [ 'heavy', 'mobility' ], token: 'heavy', range: [ 3, 11 ], cooldown: 7, weight: 1.8, tags: [ 'heavy', 'movement' ],
	action: {
		id: 'leap', duration: 1.5, speedStat: null, windup: 0.4, active: 0.75, moveMult: 0, turn: false, tags: [ 'attack', 'area' ],
		onStart( world, e, act ) {

			const t = act.target || world.player;
			const land = clampWalk( world, e.x, e.z, t.x, t.z, e.radius );
			act.ctx.land = land;
			telegraph( world, e, act, { x: land.x, z: land.z, radius: 1.9 + e.radius * 0.5, delay: 1.1, fx: 'slam',
				hit: hitOf( e, 1.8, { split: 0.5, tags: [ 'attack', 'area' ], knockback: 8, skill: 'leap' } ) } );

		},
		events: [ { at: 0.4, fn( world, e, act ) {

			const T = 0.5, { land } = act.ctx;
			e.forced = { vx: ( land.x - e.x ) / T, vz: ( land.z - e.z ) / T, time: T };
			e.vy = 15 * T;
			e.y = 0.01;
			act.ctx.areas = []; // airborne: committed, interrupts no longer cancel the landing

		} } ],
		onCancel: cancelTelegraphs
	}
} );

// Blink strike: a red circle appears under you, the assassin vanishes, reappears
// behind that spot and the circle lands. Roll out of the circle, not away from it.
ability( {
	id: 'blink-strike', name: 'Shadow Step', anim: { biped: 'dash', default: 'leap' }, roles: [ 'heavy', 'mobility' ], token: 'heavy', range: [ 1.5, 12 ], cooldown: 6.5, weight: 2, tags: [ 'heavy', 'movement' ],
	action: {
		id: 'blink-strike', duration: 1.35, speedStat: null, windup: 0.58, active: 0.72, moveMult: 0, turn: false, tags: [ 'attack', 'area' ],
		onStart( world, e, act ) {

			const t = act.target || world.player;
			act.ctx.spot = { x: t.x, z: t.z };
			telegraph( world, e, act, { x: t.x, z: t.z, radius: 1.8, delay: 0.85, fx: 'slash', hit: hitOf( e, 1.5, { split: 0.4, tags: [ 'attack', 'area' ], knockback: 4, skill: 'blink-strike' } ) } );

		},
		events: [ { at: 0.33, fn( world, e, act ) {

			const s = act.ctx.spot, a = Math.atan2( s.x - e.x, s.z - e.z );
			let dx = s.x + Math.sin( a ) * 1.7, dz = s.z + Math.cos( a ) * 1.7;
			if ( ! world.layout.isWalkable( dx, dz ) ) ( { x: dx, z: dz } = ringPoint( world, aiRng( world ), s.x, s.z, 1.4, 2.2 ) || s );
			world.events.emit( 'blink', { entity: e, x: e.x, z: e.z, tx: dx, tz: dz } );
			teleport( e, dx, dz );
			e.facing = Math.atan2( s.x - dx, s.z - dz );

		} } ],
		onCancel: cancelTelegraphs
	}
} );

// Whirl: a spinning advance. The ring warns 0.6 s ahead; it then follows the body.
ability( {
	id: 'whirl', name: 'Whirling Blades', anim: { biped: 'spin', default: 'tail' }, roles: [ 'heavy' ], token: 'heavy', range: ( e ) => [ 0, e.radius + 2 ], cooldown: 8, weight: 1.3, tags: [ 'heavy' ],
	action: {
		id: 'whirl', duration: 2.4, speedStat: null, windup: 0.25, active: 0.85, moveMult: 0.45, chase: true, unstoppable: true, tags: [ 'attack', 'area' ],
		onStart( world, e, act ) {

			telegraph( world, e, act, { follow: e, radius: e.radius + 1.6, delay: 0.6 } );

		},
		events: [ { at: 0.25, fn( world, e, act ) {

			act.ctx.spin = world.area( e, { follow: e, radius: e.radius + 1.6, duration: 1.4, interval: 0.35, hitOnce: false, fx: 'slash',
				hit: hitOf( e, 0.5, { split: 0.5, tags: [ 'attack', 'area' ], knockback: 3, skill: 'whirl' } ) } );

		} } ],
		onCancel( world, e, act ) {

			cancelTelegraphs( world, e, act );
			if ( act.ctx.spin ) cancelArea( world, act.ctx.spin );

		}
	}
} );

// Exploder fuse: stops, swells for 0.9 s inside its blast circle, detonates.
// Kill it during the fuse and nothing happens - that is the counterplay.
ability( {
	id: 'fuse', name: 'Detonate', anim: { blob: 'slam', default: 'roar' }, roles: [], token: 'heavy', range: ( e ) => [ 0, 1.4 ], cooldown: 99, weight: 10, tags: [ 'heavy', 'suicide' ],
	action: {
		id: 'fuse', duration: 1.0, speedStat: null, windup: 0.9, active: 0.95, moveMult: 0, turn: false, unstoppable: true, tags: [ 'attack', 'area' ],
		onStart( world, e, act ) {

			if ( e.model ) e.model.glow = '#ffef7a';
			telegraph( world, e, act, { x: e.x, z: e.z, radius: 2.4 + e.radius, delay: 0.9, fx: 'explosion',
				hit: hitOf( e, 3.2, { split: 0.7, tags: [ 'attack', 'area' ], knockback: 13, skill: 'fuse' } ) } );

		},
		events: [ { at: 0.9, fn( world, e, act ) {

			act.ctx.areas = []; // the blast is committed: our own death must not cancel it
			world.events.emit( 'shake', { amount: 0.35, x: e.x, z: e.z } );
			world.events.emit( 'explode', { entity: e, x: e.x, z: e.z, radius: 2.4 + e.radius } );
			e.data.corpseTime = 0.2;
			world.kill( e, null );

		} } ],
		onCancel: cancelTelegraphs
	}
} );

// Gravity pull: a wide ring warns, then everything inside is yanked toward the
// monster - usually right into its friends' next swing.
heavy( { id: 'gravity-pull', name: 'Gravity Pull', anim: { biped: 'cast_aoe', default: 'roar' }, mult: 0.4, knockback: 0, split: 1, duration: 1.3, windup: 0.55, element: 'chaos',
	range: [ 2.5, 8 ], cooldown: 9, weight: 1.5, roles: [ 'caster', 'heavy' ], tags: [ 'chaos' ],
	shape: ( world, e ) => ( { x: e.x, z: e.z, shape: 'ring', inner: 2, radius: 9, fx: 'void',
		onHit: ( w, a, t ) => pull( t, e.x, e.z, 26 ) } ) } );

// =====================================================================================
// RANGED
// =====================================================================================

// Spit leaves a short-lived puddle where it lands - spitters zone you out.
shot( { id: 'spit', name: 'Spit', anim: { biped: 'throw', default: 'spit' }, speed: 12, mult: 0.9, ailments: { poison: 35 }, fx: 'spit', cooldown: 2.4,
	onEnd: ( world, p ) => world.area( p.owner, { x: p.x, z: p.z, radius: 1.3, duration: 2.5, interval: 0.5, hitOnce: false, fx: fxOf( p.element, 'cloud' ), color: colorOf( p.element ), element: p.element,
		hit: { damage: scaleDamage( p.hit.damage, 0.15 ), tags: [ 'spell', 'area', 'dot' ], noAilments: true, skill: 'spit-pool' } } ) } );
shot( { id: 'bolt', name: 'Bolt', anim: 'cast', speed: 15, mult: 1, cooldown: 2 } );
shot( { id: 'arrow', name: 'Arrow', anim: { biped: 'shoot', default: 'spit' }, speed: 23, mult: 0.85, split: 0.3, windup: 0.6, fx: 'arrow', kind: 'attack', range: [ 3, 16 ], cooldown: 1.6 } );
shot( { id: 'fan', name: 'Fan of Shards', anim: { biped: 'throw', default: 'spit' }, speed: 12.5, count: 5, spread: 55, mult: 1.0, windup: 0.6, fx: 'shard', cooldown: 4.5, weight: 1.2, range: [ 2, 11 ] } );
shot( { id: 'shard-nova', name: 'Shard Nova', anim: { biped: 'cast_aoe', default: 'roar' }, speed: 10, count: 10, ring: true, mult: 1.6, windup: 0.6, fx: 'shard', cooldown: 6, range: [ 0, 9 ], roles: [ 'ranged', 'caster' ], tags: [ 'cold' ] } );
shot( { id: 'chain-bolt', name: 'Chain Lightning', anim: 'cast', speed: 19, mult: 0.85, chain: 2, element: 'lightning', cooldown: 3.2, roles: [ 'ranged', 'caster' ], tags: [ 'lightning' ] } );
shot( { id: 'web', name: 'Web', anim: { arachnid: 'spit', default: 'throw' }, speed: 10, mult: 0.3, element: 'physical', fx: 'web', cooldown: 7, weight: 0.8, range: [ 2, 10 ],
	onHit: ( world, p, t ) => world.applyStatus( t, 'm-root', { duration: 0.7 } ) } );
shot( { id: 'volley', name: 'Volley', anim: { biped: 'shoot', default: 'cast' }, speed: 17, count: 3, spread: 22, mult: 1.0, windup: 0.65, fx: 'bolt', cooldown: 3, range: [ 3, 15 ], kind: 'attack' } );

function scaleDamage( dmg, k ) {

	const out = {};
	for ( const t in dmg || {} ) out[ t ] = Array.isArray( dmg[ t ] ) ? [ dmg[ t ][ 0 ] * k, dmg[ t ][ 1 ] * k ] : dmg[ t ] * k;
	return out;

}

// =====================================================================================
// CASTER (ground AoE)
// =====================================================================================

cast( { id: 'meteor', name: 'Meteor', tags: [ 'fire' ], place( world, e, t ) {

	const el = elementOf( e ) === 'physical' ? 'fire' : elementOf( e );
	telegraph( world, e, null, { x: t.x, z: t.z, radius: 2.3, delay: 1.0, fx: el === 'fire' ? 'meteor' : fxOf( el ), element: el,
		hit: hitOf( e, 2, { element: el, tags: [ 'spell', 'area' ], knockback: 5, skill: 'meteor' } ),
		onEnd: ( w, a ) => w.area( e, { x: a.x, z: a.z, radius: 2, duration: 2.5, interval: 0.5, hitOnce: false, fx: fxOf( el, 'cloud' ), element: el, color: colorOf( el ),
			hit: hitOf( e, 0.18, { element: el, tags: [ 'spell', 'area', 'dot' ], skill: 'burning-ground' } ) } ) } );

} } );

cast( { id: 'lightning-strike', name: 'Lightning Strikes', tags: [ 'lightning' ], cooldown: 6, place( world, e, t ) {

	// three strikes: where you are, then where you are heading
	for ( let i = 0; i < 3; i ++ ) {

		const lead = 0.35 * i;
		telegraph( world, e, null, { x: t.x + t.vx * lead, z: t.z + t.vz * lead, radius: 1.6, delay: 0.75 + i * 0.3, fx: 'lightning', element: 'lightning',
			hit: hitOf( e, 1.0, { element: 'lightning', tags: [ 'spell', 'area' ], skill: 'lightning-strike' } ) } );

	}

} } );

cast( { id: 'poison-cloud', name: 'Poison Cloud', tags: [ 'chaos' ], cooldown: 8, place( world, e, t ) {

	world.area( e, { x: t.x, z: t.z, radius: 3, delay: 0.8, duration: 4, interval: 0.5, hitOnce: false, fx: 'poison', element: 'chaos', color: colorOf( 'chaos' ),
		hit: hitOf( e, 0.22, { element: 'chaos', tags: [ 'spell', 'area', 'dot' ], ailments: { poison: 25 }, skill: 'poison-cloud' } ) } );

} } );

// Quake: three expanding rings from the caster; the gaps between them are safe.
heavy( { id: 'quake', name: 'Quake', anim: { biped: 'slam', default: 'stomp' }, mult: 1.1, knockback: 5, duration: 1.6, windup: 0.45,
	range: ( e ) => [ 0, e.radius + 5 ], cooldown: 7, weight: 1.3, roles: [ 'caster', 'heavy' ], unstoppable: true,
	shape: ( world, e, act ) => {

		const hit = hitOf( e, 1.1, { split: 0.5, tags: [ 'attack', 'area' ], knockback: 5, skill: 'quake' } );
		for ( let i = 1; i < 3; i ++ ) telegraph( world, e, act, { x: e.x, z: e.z, shape: 'ring', inner: e.radius + 2.2 * i, radius: e.radius + 2.2 * ( i + 1 ), delay: 0.75 + 0.3 * i, fx: 'quake', hit } );
		return { x: e.x, z: e.z, radius: e.radius + 2.2, fx: 'quake' };

	} } );

// Beam: a locked lane (0.8 s), then a 1 s searing beam down it.
ability( {
	id: 'beam', name: 'Searing Beam', anim: { biped: 'channel', default: 'breath' }, roles: [ 'caster', 'ranged' ], token: 'heavy', range: [ 2, 12 ], cooldown: 7, weight: 1.3, tags: [ 'caster' ],
	action: {
		id: 'beam', duration: 2.1, speedStat: null, windup: 0.38, active: 0.86, moveMult: 0, turn: false, tags: [ 'spell', 'area' ],
		onStart( world, e, act ) {

			const t = act.target || world.player;
			const dir = Math.atan2( t.x - e.x, t.z - e.z );
			e.facing = dir;
			act.ctx.dir = dir;
			telegraph( world, e, act, { x: e.x, z: e.z, shape: 'line', dir, length: 13, width: 1.4, delay: 0.8 } );

		},
		events: [ { at: 0.38, fn( world, e, act ) {

			act.ctx.beam = world.area( e, { x: e.x, z: e.z, shape: 'line', dir: act.ctx.dir, length: 13, width: 1.4, duration: 1.0, interval: 0.2, hitOnce: false, fx: 'beam',
				color: colorOf( elementOf( e ) ), element: elementOf( e ), hit: hitOf( e, 0.35, { tags: [ 'spell', 'area' ], skill: 'beam' } ) } );

		} } ],
		onCancel( world, e, act ) {

			cancelTelegraphs( world, e, act );
			if ( act.ctx.beam ) cancelArea( world, act.ctx.beam );

		}
	}
} );

// Breath: a cone telegraph, then a 1.2 s gout following the head.
ability( {
	id: 'breath', name: 'Breath', anim: 'breath', roles: [ 'caster', 'heavy' ], token: 'heavy', range: ( e ) => [ 0, e.radius + 4.5 ], cooldown: 7, weight: 1.4, tags: [ 'caster' ],
	action: {
		id: 'breath', duration: 2.0, speedStat: null, windup: 0.3, active: 0.9, moveMult: 0, turn: false, tags: [ 'spell', 'area' ],
		onStart( world, e, act ) {

			const t = act.target || world.player;
			act.ctx.dir = e.facing = Math.atan2( t.x - e.x, t.z - e.z );
			telegraph( world, e, act, { follow: e, shape: 'cone', dir: act.ctx.dir, angle: 70, radius: e.radius + 5.5, delay: 0.6 } );

		},
		events: [ { at: 0.3, fn( world, e, act ) {

			act.ctx.gout = world.area( e, { follow: e, shape: 'cone', dir: act.ctx.dir, angle: 70, radius: e.radius + 5.5, duration: 1.2, interval: 0.25, hitOnce: false,
				fx: fxOf( elementOf( e ) ), element: elementOf( e ), color: colorOf( elementOf( e ) ), hit: hitOf( e, 0.4, { tags: [ 'spell', 'area' ], skill: 'breath' } ) } );

		} } ],
		onCancel( world, e, act ) {

			cancelTelegraphs( world, e, act );
			if ( act.ctx.gout ) cancelArea( world, act.ctx.gout );

		}
	}
} );

// Mortar: a lobbed shell; the landing circle shows for 1.1 s.
cast( { id: 'mortar', name: 'Mortar', anim: { biped: 'throw', default: 'spit' }, range: [ 4, 15 ], cooldown: 4.5, roles: [ 'caster', 'ranged' ], place( world, e, t ) {

	const x = t.x + t.vx * 0.5, z = t.z + t.vz * 0.5, el = elementOf( e );
	telegraph( world, e, null, { x, z, radius: 2, delay: 1.1, fx: fxOf( el ), hit: hitOf( e, 1.7, { tags: [ 'spell', 'area' ], knockback: 5, skill: 'mortar' } ) } );
	const d = Math.hypot( x - e.x, z - e.z );
	world.projectile( e, { tx: x, tz: z, speed: Math.max( 4, d / 1.1 ), range: d, radius: 0.05, pierce: 999, fx: 'lob', color: colorOf( el ), element: el, data: { arc: 4 } } );

} } );

// =====================================================================================
// SUPPORT, SUMMON, MOBILITY
// =====================================================================================

const injuredAllies = ( world, e, r ) => alliesNear( world, e, r, true ).filter( ( o ) => o.lifeFrac < 0.75 );

ability( {
	id: 'heal', name: 'Mend', anim: { biped: 'cast_aoe', default: 'cast' }, roles: [ 'support' ], token: null, range: [ 0, 40 ], cooldown: 6, weight: 3, los: false, tags: [ 'support' ],
	score: ( world, e ) => Math.min( 3, injuredAllies( world, e, 8 ).length ),
	action: {
		id: 'heal', duration: 1.2, speedStat: 'cast_speed', windup: 0.55, active: 0.7, moveMult: 0, tags: [ 'spell' ],
		events: [ { at: 0.55, fn( world, e ) {

			world.area( e, { x: e.x, z: e.z, radius: 8, fx: 'heal', color: '#7dff9a', onTick: ( w ) => {

				for ( const o of alliesNear( w, e, 8, true ) ) healFrac( w, o, 0.2 );

			} } );

		} } ]
	}
} );

ability( {
	id: 'ward', name: 'Ward', anim: { biped: 'cast', default: 'cast' }, roles: [ 'support' ], token: null, range: [ 0, 40 ], cooldown: 9, weight: 2, los: false, tags: [ 'support' ],
	score: ( world, e ) => alliesNear( world, e, 8, true ).filter( ( o ) => ! o.statuses.has( 'm-ward' ) && o.data.brain?.state === 'combat' ).length >= 2 ? 2 : 0,
	action: {
		id: 'ward', duration: 1.1, speedStat: 'cast_speed', windup: 0.5, active: 0.65, moveMult: 0, tags: [ 'spell' ],
		events: [ { at: 0.5, fn( world, e ) {

			world.area( e, { x: e.x, z: e.z, radius: 8, fx: 'ward', color: '#9fd8ff' } );
			for ( const o of alliesNear( world, e, 8, true ) ) {

				o.shield = Math.max( o.shield, o.maxLife * 0.3 );
				world.applyStatus( o, 'm-ward', { duration: 6, source: e } );

			}

		} } ]
	}
} );

ability( {
	id: 'war-cry', name: 'War Cry', anim: { biped: 'shout', default: 'roar' }, roles: [ 'support', 'melee' ], token: null, range: [ 0, 12 ], cooldown: 12, weight: 1.6, los: false, tags: [ 'support' ],
	score: ( world, e ) => alliesNear( world, e, 9, true ).filter( ( o ) => ! o.statuses.has( 'm-frenzy' ) ).length >= 3 ? 2 : 0,
	action: {
		id: 'war-cry', duration: 1.0, speedStat: null, windup: 0.45, active: 0.6, moveMult: 0, tags: [ 'spell' ],
		events: [ { at: 0.45, fn( world, e ) {

			world.area( e, { x: e.x, z: e.z, radius: 9, fx: 'shout', color: '#ff7a5a' } );
			for ( const o of alliesNear( world, e, 9, true ) ) world.applyStatus( o, 'm-frenzy', { duration: 6, source: e } );

		} } ]
	}
} );

// Summon: raises minions of the family's minion kind (or its own kind) next to
// the caster. Caps keep summoners from flooding the level.
ability( {
	id: 'summon', name: 'Summon', anim: 'summon', roles: [ 'summon' ], token: null, range: [ 0, 30 ], cooldown: 9, weight: 2.5, los: false, tags: [ 'summon' ],
	score: ( world, e ) => liveMinions( e ) < ( e.data.minionCap ?? 5 ) && ( world.state.summoned ?? 0 ) < SUMMON_CAP ? 1.5 : 0,
	action: {
		id: 'summon', duration: 1.3, speedStat: 'cast_speed', windup: 0.55, active: 0.7, moveMult: 0, tags: [ 'spell', 'minion' ],
		events: [ { at: 0.55, fn: ( world, e ) => summonMinions( world, e, aiRng( world ).int( 2, 3 ) ) } ]
	}
} );

// Live summoned monsters in a world are counted ( factory.js keeps world.state.summoned );
// past this cap summoners stop summoning, so a level never drowns in minions.
export const SUMMON_CAP = 60;

export function liveMinions( e ) {

	const list = e.data.summons || [];
	let n = 0;
	for ( const m of list ) if ( m.alive ) n ++;
	return n;

}

// Shared by the summon ability, the Summoner affix and boss add waves.
export function summonMinions( world, e, n, { family, archetype, rarity = 'normal', radius = [ 1.5, 3.5 ], level } = {} ) {

	const fam = family || e.data.minionFamily || e.data.family;
	const rng = aiRng( world );
	const out = [];
	e.data.summons = ( e.data.summons || [] ).filter( ( m ) => m.alive );
	for ( let i = 0; i < n; i ++ ) {

		const p = ringPoint( world, rng, e.x, e.z, radius[ 0 ], radius[ 1 ] );
		if ( ! p ) continue;
		const m = spawnMonster( world, { family: fam, archetype: archetype || e.data.minionArchetype, level: level ?? e.level, rarity, x: p.x, z: p.z, summoned: true, size: 0.85 } );
		if ( ! m ) continue;
		m.data.summoner = e;
		e.data.summons.push( m );
		out.push( m );

	}

	if ( out.length ) world.events.emit( 'summon', { entity: e, minions: out, x: e.x, z: e.z } );
	return out;

}

// Raise dead: corpses of the last few seconds rise again as weaker copies.
ability( {
	id: 'raise-dead', name: 'Raise Dead', anim: 'summon', roles: [ 'summon' ], token: null, range: [ 0, 30 ], cooldown: 10, weight: 3, los: false, tags: [ 'summon' ],
	score: ( world, e ) => corpsesNear( world, e ).length >= 2 ? 2 : 0,
	action: {
		id: 'raise-dead', duration: 1.4, speedStat: 'cast_speed', windup: 0.6, active: 0.75, moveMult: 0, tags: [ 'spell', 'minion' ],
		events: [ { at: 0.6, fn( world, e ) {

			for ( const c of corpsesNear( world, e ).slice( 0, 3 ) ) {

				c.data.raised = true;
				const m = spawnMonster( world, { family: c.data.family, archetype: c.data.archetype, level: c.level, rarity: 'normal', x: c.x, z: c.z, summoned: true, lifeMult: 0.6 } );
				if ( m ) {

					m.tags.add( 'risen' );
					world.remove( c );

				}

			}

		} } ]
	}
} );

function corpsesNear( world, e ) {

	return world.entities.filter( ( c ) => ! c.alive && c.kind === 'monster' && c.team === e.team && ! c.data.raised && c.data.family && world.time - ( c.data.deathTime ?? 0 ) < 3.5 && Math.hypot( c.x - e.x, c.z - e.z ) < 10 );

}

// Blink away: casters and kiters escape when you corner them (once in a while).
ability( {
	id: 'blink', name: 'Blink', anim: 'cast', roles: [ 'mobility', 'caster', 'ranged', 'support', 'summon' ], token: null, range: [ 0, 2.5 ], cooldown: 8, weight: 2.5, los: false, tags: [ 'movement' ],
	action: {
		id: 'blink', duration: 0.75, speedStat: null, windup: 0.55, active: 0.65, moveMult: 0, tags: [ 'spell', 'movement' ],
		onStart( world, e, act ) {

			const t = act.target || world.player;
			const away = Math.atan2( e.x - t.x, e.z - t.z );
			let p = null;
			for ( let i = 0; i < 6 && ! p; i ++ ) {

				const a = away + ( aiRng( world ).next() - 0.5 ) * 1.6, r = 6 + aiRng( world ).next() * 3;
				const x = e.x + Math.sin( a ) * r, z = e.z + Math.cos( a ) * r;
				if ( world.layout.isWalkable( x, z ) && clearWalk( world, e.x, e.z, x, z ) ) p = { x, z };

			}

			act.ctx.to = p;
			if ( p ) telegraph( world, e, act, { x: p.x, z: p.z, radius: 0.9, delay: 0.4 } );

		},
		events: [ { at: 0.55, fn( world, e, act ) {

			const p = act.ctx.to;
			if ( ! p ) return;
			world.events.emit( 'blink', { entity: e, x: e.x, z: e.z, tx: p.x, tz: p.z } );
			teleport( e, p.x, p.z );

		} } ],
		onCancel: cancelTelegraphs
	}
} );

// Burrow: dig in (0.6 s); the brain then travels underground and emerges under
// the target with a telegraphed eruption ( see brain.js burrowTravel ).
ability( {
	id: 'burrow', name: 'Burrow', anim: 'burrow', roles: [ 'mobility' ], token: null, range: [ 4.5, 30 ], cooldown: 9, weight: 2.2, los: false, tags: [ 'movement' ],
	action: {
		id: 'burrow', duration: 0.7, speedStat: null, windup: 0.6, active: 0.8, moveMult: 0, tags: [ 'movement' ],
		events: [ { at: 0.8, fn( world, e ) {

			world.applyStatus( e, 'm-burrowed', { duration: 5 } );
			e.data.burrow = { until: world.time + 3.2 };

		} } ]
	}
} );

// Emerging from the ground: called by the brain when a burrower arrives.
export function emerge( world, e, x, z ) {

	e.data.burrow = null;
	teleport( e, x, z );
	world.area( e, { x, z, radius: 1.8 + e.radius * 0.4, delay: 0.7, fx: 'erupt', color: colorOf( elementOf( e ) ), element: elementOf( e ), data: { telegraph: true },
		hit: hitOf( e, 1.6, { split: 0.5, tags: [ 'attack', 'area' ], knockback: 9, skill: 'emerge' } ),
		onEnd: ( w ) => {

			w.removeStatus( e, 'm-burrowed' );
			e.data.spawnUntil = w.time + 0.4;

		} } );

}

// Life drain: a tether that heals the caster - break line of sight or range to stop it.
ability( {
	id: 'drain', name: 'Life Drain', anim: 'channel', roles: [ 'caster', 'support' ], token: 'ranged', range: [ 2, 8 ], cooldown: 7, weight: 1.2, tags: [ 'chaos' ],
	action: {
		id: 'drain', duration: 2.0, speedStat: null, windup: 0.25, active: 0.95, moveMult: 0, turn: true, tags: [ 'spell' ],
		events: [ { at: 0.25, fn( world, e, act ) {

			const t = act.target;
			if ( ! t ) return;
			act.ctx.tether = world.area( e, { follow: e, shape: 'line', dir: e.facing, length: 9, width: 0.6, duration: 1.4, interval: 0.05, hitOnce: false, fx: 'drain', color: '#c45aff',
				onTick: ( w, a ) => {

					const d = Math.hypot( t.x - e.x, t.z - e.z );
					a.dir = Math.atan2( t.x - e.x, t.z - e.z );
					a.length = d;
					if ( ! t.alive || d > 9.5 || ! w.layout.hasLineOfSight( e.x, e.z, t.x, t.z ) ) return cancelArea( w, a );
					const r = tickHit( w, e, t, hitOf( e, 0.22, { element: 'chaos', tags: [ 'spell' ], skill: 'drain' } ), 'drain' + e.id, 0.3 );
					if ( r?.total ) e.life = Math.min( e.maxLife, e.life + r.total * 1.5 );

				} } );

		} } ],
		onCancel( world, e, act ) {

			if ( act.ctx.tether ) cancelArea( world, act.ctx.tether );

		}
	}
} );

// --- lookups used by the AI -----------------------------------------------------------

// The action def for an ability on this body (anim chosen per body plan, cached).
export function actionFor( ab, e ) {

	if ( ! ab.action ) return null;
	if ( typeof ab.anim !== 'object' || ! ab.anim ) return ab.anim && ab.action.anim !== ab.anim ? ( ab._a || ( ab._a = { ...ab.action, anim: ab.anim } ) ) : ab.action;
	const anim = ab.anim[ e.data.plan ] ?? ab.anim.default ?? ab.action.id;
	const cache = ab._v || ( ab._v = {} );
	return cache[ anim ] || ( cache[ anim ] = { ...ab.action, anim } );

}

export const abilityRange = ( ab, e ) => typeof ab.range === 'function' ? ab.range( e ) : ab.range;

export function abilityDefs( ids ) {

	return ids.map( ( id ) => get( 'monsterAbility', id ) ).filter( Boolean );

}

// Foes a monster could hit with a shot from here (for agent inspectors).
export function threats( world, e ) {

	return foesNear( world, e, e.x, e.z, 14 ).filter( ( o ) => isHostile( e, o ) );

}
