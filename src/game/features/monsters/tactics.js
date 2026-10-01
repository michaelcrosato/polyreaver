// Tactics: the positioning half of monster AI (the other half - picking an
// ability - is utility scoring in brain.js). Each tactic writes e.moveIntent for
// one step given the target `t` and the edge-to-edge distance `d`. Archetypes are
// mostly a choice of tactic plus numbers, which keeps every behaviour readable:
//
//   approach   close in for melee, taking a SURROUND SLOT when near (packs encircle)
//   kite       hold a distance band with line of sight; back off when pressed
//   skirmish   dart in, hit, fall back (hit-and-run)
//   flock      swarm with neighbours of the same family (boids)
//   escort     support monsters stay behind their allies, away from you
//   patrol / follow   idle packs walking routes behind a leader

import { moveTo, steer, stop, retreatFrom, strafe, wanderPoint } from './nav.js';
import { aiRng, alliesNear, salt } from './util.js';
import { liveMembers } from './packs.js';

const viaFlow = ( world, t ) => t === world.player;

// Melee approach. Far away: run at the target (flow field around walls). Within
// 7 m: run for this monster's slot on a circle around the target, so a pack of
// five arrives from five directions. In reach: stand, or circle slowly while
// waiting for an attack token (brain.js) - visible "jostling" instead of a blob.
export function approach( world, e, b, t, d, frac = 1 ) {

	const reach = e.data.reach ?? 1.2;
	if ( d <= reach * 0.7 ) {

		if ( b.waiting ) return strafe( world, e, t, b.strafeDir, 0.3, - 0.1 );
		return stop( e );

	}

	const slot = e.data.slot ?? 0;
	const pack = e.data.pack;
	if ( d < 7 && slot !== 0 && pack && b.los ) {

		const ref = packAngle( world, pack, t );
		const ring = t.radius + e.radius + reach * 0.6;
		const sx = t.x + Math.sin( ref + slot ) * ring, sz = t.z + Math.cos( ref + slot ) * ring;
		if ( world.layout.isWalkable( sx, sz ) ) return moveTo( world, e, sx, sz, frac, false );

	}

	moveTo( world, e, t.x, t.z, frac, viaFlow( world, t ) );

}

// The bearing from the target to the pack's centre, refreshed every 2 s - the
// reference the surround slots are measured from.
function packAngle( world, pack, t ) {

	if ( world.time - ( pack.refAt ?? - 9 ) > 2 ) {

		let x = 0, z = 0, n = 0;
		for ( const m of pack.members ) if ( m.alive ) {

			x += m.x; z += m.z; n ++;

		}

		pack.ref = n ? Math.atan2( x / n - t.x, z / n - t.z ) : 0;
		pack.refAt = world.time;

	}

	return pack.ref;

}

// Hold [ near, far ] metres with line of sight; strafe inside the band.
export function kite( world, e, b, t, d, near, far ) {

	if ( ! b.los ) return moveTo( world, e, t.x, t.z, 1, viaFlow( world, t ) );
	if ( d < near ) return retreatFrom( world, e, t, 1, b.strafeDir );
	if ( d > far ) return moveTo( world, e, t.x, t.z, 0.85, viaFlow( world, t ) );
	if ( world.time > b.nextStrafe ) {

		const rng = aiRng( world );
		b.strafeDir = rng.sign();
		b.nextStrafe = world.time + 1.2 + rng.next() * 2;

	}

	strafe( world, e, t, b.strafeDir, 0.5 );

}

// Hit-and-run: after an attack, fall back for a moment, then come again.
export function skirmish( world, e, b, t, d, backOff = 5.5 ) {

	if ( world.time < ( b.fadeUntil ?? 0 ) && d < backOff ) return retreatFrom( world, e, t, 1, b.strafeDir );
	approach( world, e, b, t, d, 1 );

}

// Boids: separation is in steer(); add cohesion and alignment with same-family
// neighbours and a strong pull toward the target. Cheap enough for big swarms
// because neighbour sums are refreshed every 4th step.
export function flock( world, e, b, t, d ) {

	const reach = e.data.reach ?? 1;
	if ( d <= reach * 0.6 ) return stop( e );
	const f = b.flock || ( b.flock = { cx: 0, cz: 0, ax: 0, az: 0 } );
	if ( ( world.frame + salt( e ) ) % 4 === 0 ) {

		f.cx = f.cz = f.ax = f.az = 0;
		let n = 0;
		for ( const o of world.spatial.query( e.x, e.z, 4, ( o ) => o !== e && o.alive && o.data.family === e.data.family ) ) {

			f.cx += o.x - e.x; f.cz += o.z - e.z; f.ax += o.vx; f.az += o.vz; n ++;

		}

		if ( n ) {

			f.cx /= n; f.cz /= n; f.ax /= n; f.az /= n;

		}

	}

	if ( ! b.clear && viaFlow( world, t ) ) return moveTo( world, e, t.x, t.z, 1, true );
	const dx = t.x - e.x, dz = t.z - e.z, l = Math.hypot( dx, dz ) || 1;
	const al = Math.hypot( f.ax, f.az ) || 1;
	// a little per-monster weave so the swarm shimmers instead of marching
	const wv = Math.sin( world.time * 3 + salt( e ) ) * 0.35;
	steer( world, e, dx / l + f.cx * 0.08 + f.ax / al * 0.25 - dz / l * wv, dz / l + f.cz * 0.08 + f.az / al * 0.25 + dx / l * wv, 1 );

}

// Supports keep their allies between themselves and you.
export function escort( world, e, b, t, d ) {

	const allies = alliesNear( world, e, 12 ).filter( ( o ) => o.data.archetype !== e.data.archetype );
	if ( ! allies.length ) return kite( world, e, b, t, d, 6, 11 );
	if ( d < 4 ) return retreatFrom( world, e, t, 1, b.strafeDir );
	let x = 0, z = 0;
	for ( const o of allies ) {

		x += o.x; z += o.z;

	}

	x /= allies.length; z /= allies.length;
	const ax = x - t.x, az = z - t.z, l = Math.hypot( ax, az ) || 1;
	const gx = x + ax / l * 3.5, gz = z + az / l * 3.5;
	if ( Math.hypot( gx - e.x, gz - e.z ) < 1 ) return stop( e );
	moveTo( world, e, gx, gz, 0.8, false );

}

// Idle behaviours ---------------------------------------------------------------------

export function fidget( world, e, b ) {

	if ( b.wanderTo ) {

		if ( Math.hypot( b.wanderTo.x - e.x, b.wanderTo.z - e.z ) < 0.6 ) {

			b.wanderTo = null;
			b.idleUntil = world.time + 2 + aiRng( world ).next() * 5;
			return stop( e );

		}

		return moveTo( world, e, b.wanderTo.x, b.wanderTo.z, 0.3, false );

	}

	if ( world.time > b.idleUntil ) b.wanderTo = wanderPoint( world, e, b.home, 3 );
	stop( e );

}

// Wander packs: the leader walks a route of points, the others follow in a loose
// formation (their surround slot doubles as a formation offset).
export function patrol( world, e, b ) {

	const pack = e.data.pack;
	const leader = pack?.leader?.alive ? pack.leader : liveMembers( pack )[ 0 ];
	if ( leader && leader !== e ) {

		const back = leader.facing + Math.PI + ( e.data.slot ?? 0 );
		const fx = leader.x + Math.sin( back ) * 2.2, fz = leader.z + Math.cos( back ) * 2.2;
		if ( Math.hypot( fx - e.x, fz - e.z ) < 0.8 ) return stop( e );
		return moveTo( world, e, fx, fz, 0.55, false );

	}

	const route = pack?.route;
	if ( ! b.wanderTo || Math.hypot( b.wanderTo.x - e.x, b.wanderTo.z - e.z ) < 1 ) {

		if ( route?.length ) {

			pack.leg = ( ( pack.leg ?? - 1 ) + 1 ) % route.length;
			b.wanderTo = route[ pack.leg ];

		} else b.wanderTo = wanderPoint( world, e, b.home, 10 );

	}

	if ( b.wanderTo ) moveTo( world, e, b.wanderTo.x, b.wanderTo.z, 0.42, false );
	else stop( e );

}
