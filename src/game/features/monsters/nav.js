// Navigation for monsters: a FLOW FIELD toward the player plus local STEERING.
//
// Hundreds of monsters chasing one player is the classic case for a flow field:
// instead of one path search per monster, ONE breadth-first search from the
// player's tile labels every reachable tile with its distance to the player.
// A monster anywhere then just steps to its lowest neighbour - around walls,
// through doors, across bridges - for the cost of reading 8 numbers. The field is
// rebuilt only when the player changes tile.
//
// Steering then shapes the raw direction: separation from nearby allies (packs
// spread out instead of forming conga lines), slot offsets (packs surround the
// player), and wall-aware retreat for kiting archetypes.

import { MOVE_BLOCKERS, clearWalk, aiRng, salt } from './util.js';

const MAX_STEPS = 9000; // ~ a 95-tile radius; beyond it monsters fall back to straight lines
const UNREACHED = 0xffff;
const N8 = [ [ 1, 0 ], [ - 1, 0 ], [ 0, 1 ], [ 0, - 1 ], [ 1, 1 ], [ 1, - 1 ], [ - 1, 1 ], [ - 1, - 1 ] ];

function walkTile( L, tx, tz ) {

	return L.inside( tx, tz ) && ! MOVE_BLOCKERS.has( L.tiles[ tz * L.w + tx ] );

}

export function flowField( world ) {

	const p = world.player, L = world.layout;
	if ( ! p ) return null;
	let f = world.state.flow;
	if ( ! f || f.layout !== L ) {

		f = world.state.flow = { layout: L, dist: new Uint16Array( L.w * L.h ), queue: new Int32Array( L.w * L.h ), tx: - 1, tz: - 1, at: - 1 };

	}

	const [ tx, tz ] = L.toTile( p.x, p.z );
	if ( ( tx === f.tx && tz === f.tz ) || world.time - f.at < 0.12 ) return f;
	f.tx = tx; f.tz = tz; f.at = world.time;
	const { dist, queue } = f;
	dist.fill( UNREACHED );
	if ( ! L.inside( tx, tz ) ) return f;
	let head = 0, tail = 0;
	dist[ tz * L.w + tx ] = 0;
	queue[ tail ++ ] = tz * L.w + tx;
	while ( head < tail && tail < MAX_STEPS ) {

		const i = queue[ head ++ ], x = i % L.w, z = ( i - x ) / L.w, d = dist[ i ] + 1;
		for ( const [ dx, dz ] of N8 ) {

			const nx = x + dx, nz = z + dz;
			if ( ! walkTile( L, nx, nz ) ) continue;
			// diagonals only when both orthogonal neighbours are open: no corner cutting
			if ( dx && dz && ( ! walkTile( L, x + dx, z ) || ! walkTile( L, x, z + dz ) ) ) continue;
			const j = nz * L.w + nx;
			if ( dist[ j ] <= d ) continue;
			dist[ j ] = d;
			queue[ tail ++ ] = j;

		}

	}

	return f;

}

// Direction (unit vector) one tile closer to the player, or null if unreachable.
export function flowDir( world, e ) {

	const f = flowField( world );
	if ( ! f ) return null;
	const L = world.layout;
	const [ tx, tz ] = L.toTile( e.x, e.z );
	if ( ! L.inside( tx, tz ) ) return null;
	let best = f.dist[ tz * L.w + tx ], bx = - 1, bz = - 1;
	if ( best === UNREACHED ) best = UNREACHED - 1;
	for ( const [ dx, dz ] of N8 ) {

		const nx = tx + dx, nz = tz + dz;
		if ( ! L.inside( nx, nz ) ) continue;
		const d = f.dist[ nz * L.w + nx ];
		if ( d < best ) {

			best = d; bx = nx; bz = nz;

		}

	}

	if ( bx < 0 ) return null;
	const [ wx, wz ] = L.toWorld( bx, bz );
	const dx = wx - e.x, dz = wz - e.z, l = Math.hypot( dx, dz ) || 1;
	return { x: dx / l, z: dz / l };

}

// --- steering ------------------------------------------------------------------------

// Set the movement intent (unit direction × speed fraction 0..1) with separation.
export function steer( world, e, dx, dz, frac = 1 ) {

	const l = Math.hypot( dx, dz );
	if ( l < 1e-4 || frac <= 0 ) {

		e.moveIntent.x = e.moveIntent.z = 0;
		return;

	}

	let x = dx / l, z = dz / l;
	const sep = separation( world, e );
	x += sep.x * 0.9; z += sep.z * 0.9;
	const m = Math.hypot( x, z ) || 1;
	e.moveIntent.x = x / m * frac;
	e.moveIntent.z = z / m * frac;

}

export function stop( e ) {

	e.moveIntent.x = e.moveIntent.z = 0;

}

// Push away from allies closer than their combined radii + a margin. Recomputed
// every third step (staggered by id) - the result barely changes between steps.
export function separation( world, e ) {

	const s = e.data.sep || ( e.data.sep = { x: 0, z: 0, at: - 1 } );
	if ( ( world.frame + salt( e ) ) % 3 !== 0 && s.at >= 0 ) return s;
	s.at = world.frame;
	s.x = s.z = 0;
	const range = e.radius + 1.1;
	const near = world.spatial.query( e.x, e.z, range, ( o ) => o !== e && o.alive && o.team === e.team && o.solid && ! o.flags.ghost );
	for ( const o of near ) {

		const dx = e.x - o.x, dz = e.z - o.z, d = Math.hypot( dx, dz ) || 0.01;
		const w = 1 - d / ( range + o.radius );
		if ( w <= 0 ) continue;
		s.x += dx / d * w; s.z += dz / d * w;

	}

	return s;

}

// Walk toward a point: straight when the way is clear, else follow the flow field
// (when the point is the player) or slide along walls.
export function moveTo( world, e, x, z, frac = 1, viaFlow = false ) {

	let dx = x - e.x, dz = z - e.z;
	if ( Math.hypot( dx, dz ) < 0.15 ) return stop( e );
	if ( viaFlow && ! clearWalk( world, e.x, e.z, x, z ) ) {

		const f = flowDir( world, e );
		if ( f ) {

			dx = f.x; dz = f.z;

		}

	}

	steer( world, e, dx, dz, frac );

}

// Back away from a threat; if a wall is behind, slide sideways along it instead of
// grinding into it (kiters that back into corners look broken and are no fun).
export function retreatFrom( world, e, t, frac = 1, sideBias = 1 ) {

	let dx = e.x - t.x, dz = e.z - t.z;
	const l = Math.hypot( dx, dz ) || 1;
	dx /= l; dz /= l;
	if ( ! clearWalk( world, e.x, e.z, e.x + dx * 2.5, e.z + dz * 2.5 ) ) {

		// try the two perpendiculars, then give up and stand (the AI will fight)
		const px = - dz * sideBias, pz = dx * sideBias;
		if ( clearWalk( world, e.x, e.z, e.x + px * 2.5, e.z + pz * 2.5 ) ) {

			dx = px; dz = pz;

		} else if ( clearWalk( world, e.x, e.z, e.x - px * 2.5, e.z - pz * 2.5 ) ) {

			dx = - px; dz = - pz;

		} else return stop( e );

	}

	steer( world, e, dx, dz, frac );

}

// Circle around a target at the current distance (dir = +1 / -1).
export function strafe( world, e, t, dir = 1, frac = 0.7, inward = 0 ) {

	const dx = t.x - e.x, dz = t.z - e.z, l = Math.hypot( dx, dz ) || 1;
	steer( world, e, - dz / l * dir + dx / l * inward, dx / l * dir + dz / l * inward, frac );

}

// Random walkable point near `home`, reachable in a straight line (idle wandering).
export function wanderPoint( world, e, home, radius = 5 ) {

	const rng = aiRng( world );
	for ( let i = 0; i < 6; i ++ ) {

		const a = rng.next() * Math.PI * 2, r = 1.5 + rng.next() * radius;
		const x = home.x + Math.sin( a ) * r, z = home.z + Math.cos( a ) * r;
		if ( world.layout.isWalkable( x, z ) && clearWalk( world, e.x, e.z, x, z ) ) return { x, z };

	}

	return null;

}

// Turn toward a point at a limited rate (rad/s). Used with data.turnRate = 0 so
// the movement system stops auto-facing the walk direction: kiters keep their
// eyes on you while backing off, shield bearers turn their shield slowly enough
// that you can roll behind them.
export function turnToward( e, x, z, rate, dt ) {

	const want = Math.atan2( x - e.x, z - e.z );
	const diff = Math.atan2( Math.sin( want - e.facing ), Math.cos( want - e.facing ) );
	const step = rate * dt;
	e.facing += Math.max( - step, Math.min( step, diff ) );
	return Math.abs( diff );

}
