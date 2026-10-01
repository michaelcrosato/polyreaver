// Grid helpers shared by every layout generator: carving shapes, flood fills,
// distance fields and connectivity repair. They work on core/layout.js Layout
// objects (a Uint8Array of TILE codes) and are pure data - Node-safe.
//
// Coordinates: (tx, tz) are TILE coordinates (integers, 0..w-1 / 0..h-1);
// world metres come from layout.toWorld( tx, tz ). Generators think in tiles and
// convert once at the end, so a level can change its cell size without changes.

import { TILE } from '../../../core/layout.js';

// Tiles a body can stand on (lava and ice are walkable hazards; water and pits are not).
export function walkable( t ) {

	return t === TILE.FLOOR || t === TILE.ICE || t === TILE.LAVA || t === TILE.BRIDGE || t === TILE.DOOR;

}

export const N4 = [ [ 1, 0 ], [ - 1, 0 ], [ 0, 1 ], [ 0, - 1 ] ];
export const N8 = [ [ 1, 0 ], [ - 1, 0 ], [ 0, 1 ], [ 0, - 1 ], [ 1, 1 ], [ - 1, 1 ], [ 1, - 1 ], [ - 1, - 1 ] ];

// --- carving ----------------------------------------------------------------------

export function carveRect( L, x, z, w, h, tile = TILE.FLOOR ) {

	for ( let tz = z; tz < z + h; tz ++ ) for ( let tx = x; tx < x + w; tx ++ ) if ( inner( L, tx, tz ) ) L.set( tx, tz, tile );

}

export function carveDisc( L, cx, cz, r, tile = TILE.FLOOR, only = null ) {

	const r2 = r * r;
	for ( let tz = Math.floor( cz - r ); tz <= Math.ceil( cz + r ); tz ++ ) {

		for ( let tx = Math.floor( cx - r ); tx <= Math.ceil( cx + r ); tx ++ ) {

			const dx = tx + 0.5 - cx, dz = tz + 0.5 - cz;
			if ( dx * dx + dz * dz > r2 || ! inner( L, tx, tz ) ) continue;
			if ( only && ! only( L.get( tx, tz ), tx, tz ) ) continue;
			L.set( tx, tz, tile );

		}

	}

}

// A straight thick line ( brush = half width in tiles ).
export function carveLine( L, x0, z0, x1, z1, brush = 1, tile = TILE.FLOOR, only = null ) {

	const steps = Math.max( 1, Math.ceil( Math.hypot( x1 - x0, z1 - z0 ) * 2 ) );
	for ( let i = 0; i <= steps; i ++ ) {

		const t = i / steps;
		carveDisc( L, x0 + ( x1 - x0 ) * t, z0 + ( z1 - z0 ) * t, brush, tile, only );

	}

}

// Corridor between two tile points: an L (or Z with a jittered elbow) of `width`
// tiles. Returns the list of elbow points (handy for placing ambush spawns).
export function carveCorridor( L, a, b, width, rng, tile = TILE.FLOOR ) {

	const w0 = Math.floor( ( width - 1 ) / 2 ), w1 = width - 1 - w0;
	const seg = ( x0, z0, x1, z1 ) => {

		const minX = Math.min( x0, x1 ) - w0, maxX = Math.max( x0, x1 ) + w1;
		const minZ = Math.min( z0, z1 ) - w0, maxZ = Math.max( z0, z1 ) + w1;
		carveRect( L, minX, minZ, maxX - minX + 1, maxZ - minZ + 1, tile );

	};

	const ax = Math.round( a.x ), az = Math.round( a.z ), bx = Math.round( b.x ), bz = Math.round( b.z );
	const pts = [];
	if ( rng.chance( 0.35 ) && Math.abs( ax - bx ) > 6 ) {

		// Z shape: horizontal - vertical - horizontal with the bend somewhere in the middle
		const mx = Math.round( ax + ( bx - ax ) * rng.range( 0.3, 0.7 ) );
		seg( ax, az, mx, az ); seg( mx, az, mx, bz ); seg( mx, bz, bx, bz );
		pts.push( { x: mx, z: az }, { x: mx, z: bz } );

	} else if ( rng.chance( 0.5 ) ) {

		seg( ax, az, bx, az ); seg( bx, az, bx, bz );
		pts.push( { x: bx, z: az } );

	} else {

		seg( ax, az, ax, bz ); seg( ax, bz, bx, bz );
		pts.push( { x: ax, z: bz } );

	}

	return pts;

}

// Organic tunnel: a biased random walk from a to b with a round brush (caves).
export function carveTunnel( L, a, b, rng, { brush = 1.4, wobble = 0.55, tile = TILE.FLOOR } = {} ) {

	let x = a.x, z = a.z;
	let ang = Math.atan2( b.z - z, b.x - x );
	const path = [];
	for ( let i = 0; i < 2000; i ++ ) {

		const want = Math.atan2( b.z - z, b.x - x );
		let d = want - ang;
		d = Math.atan2( Math.sin( d ), Math.cos( d ) );
		ang += d * 0.35 + rng.range( - wobble, wobble );
		x += Math.cos( ang ) * 0.8; z += Math.sin( ang ) * 0.8;
		const r = brush + rng.range( - 0.35, 0.6 );
		carveDisc( L, x, z, r, tile );
		if ( i % 4 === 0 ) path.push( { x: Math.floor( x ), z: Math.floor( z ) } );
		if ( Math.hypot( b.x - x, b.z - z ) < 1.2 ) break;

	}

	return path;

}

// --- queries -------------------------------------------------------------------------

// True when (tx, tz) is not on the outer border ring (generators keep a solid frame).
export function inner( L, tx, tz ) {

	return tx >= 1 && tz >= 1 && tx < L.w - 1 && tz < L.h - 1;

}

// Breadth-first distances in tiles from one or more seeds, through tiles that pass
// `pass` (default: walkable). -1 = unreachable. 4-neighbour so corridors that only
// touch diagonally do NOT count as connected (bodies cannot squeeze through corners).
export function bfs( L, seeds, pass = walkable ) {

	const dist = new Int32Array( L.w * L.h ).fill( - 1 );
	const queue = new Int32Array( L.w * L.h );
	let head = 0, tail = 0;
	for ( const s of seeds ) {

		const i = L.idx( s.x, s.z );
		if ( ! L.inside( s.x, s.z ) || dist[ i ] >= 0 ) continue;
		dist[ i ] = 0;
		queue[ tail ++ ] = i;

	}

	while ( head < tail ) {

		const i = queue[ head ++ ];
		const x = i % L.w, z = ( i / L.w ) | 0;
		for ( const [ dx, dz ] of N4 ) {

			const nx = x + dx, nz = z + dz;
			if ( ! L.inside( nx, nz ) ) continue;
			const j = nz * L.w + nx;
			if ( dist[ j ] >= 0 || ! pass( L.tiles[ j ], nx, nz ) ) continue;
			dist[ j ] = dist[ i ] + 1;
			queue[ tail ++ ] = j;

		}

	}

	return dist;

}

// Distance (in tiles, 8-neighbour approximation) from every tile to the nearest
// NON-walkable tile. Used to keep props out of corridors and to find open ground.
export function wallDistance( L ) {

	const d = new Uint8Array( L.w * L.h );
	const seeds = [];
	for ( let z = 0; z < L.h; z ++ ) for ( let x = 0; x < L.w; x ++ ) if ( ! walkable( L.get( x, z ) ) ) seeds.push( { x, z } );
	const dist = bfs( L, seeds, ( t ) => walkable( t ) );
	for ( let i = 0; i < d.length; i ++ ) d[ i ] = Math.min( 255, Math.max( 0, dist[ i ] ) );
	return d;

}

// Shortest walkable path between two tile points (BFS backtrack). Returns tile list.
export function path( L, a, b, pass = walkable ) {

	const dist = bfs( L, [ a ], pass );
	if ( dist[ L.idx( b.x, b.z ) ] < 0 ) return null;
	const out = [ { x: b.x, z: b.z } ];
	let x = b.x, z = b.z;
	while ( dist[ L.idx( x, z ) ] > 0 ) {

		for ( const [ dx, dz ] of N4 ) {

			const nx = x + dx, nz = z + dz;
			if ( L.inside( nx, nz ) && dist[ L.idx( nx, nz ) ] === dist[ L.idx( x, z ) ] - 1 ) {

				x = nx; z = nz;
				out.push( { x, z } );
				break;

			}

		}

	}

	return out.reverse();

}

// --- finishing ------------------------------------------------------------------------

// Walls hug the walkable area: every non-walkable tile next to a walkable one
// becomes WALL (pits and water keep their code), everything further away is VOID.
// That keeps toAscii() readable and tells the renderer where the "rock mass" is.
export function outlineWalls( L ) {

	const t = L.tiles;
	const out = new Uint8Array( t );
	for ( let z = 0; z < L.h; z ++ ) for ( let x = 0; x < L.w; x ++ ) {

		const i = L.idx( x, z );
		if ( t[ i ] !== TILE.WALL && t[ i ] !== TILE.VOID ) continue;
		let near = false;
		for ( const [ dx, dz ] of N8 ) {

			const v = L.get( x + dx, z + dz );
			if ( v !== TILE.WALL && v !== TILE.VOID ) {

				near = true;
				break;

			}

		}

		out[ i ] = near ? TILE.WALL : TILE.VOID;

	}

	t.set( out );

}

// Make sure every seed (room centres) is reachable from the first one; carve a
// straight 2-wide corridor to any that is not. Returns how many repairs it made.
export function ensureConnected( L, seeds ) {

	let repairs = 0;
	for ( let k = 0; k < seeds.length; k ++ ) {

		const dist = bfs( L, [ seeds[ 0 ] ] );
		const s = seeds[ k ];
		if ( dist[ L.idx( s.x, s.z ) ] >= 0 ) continue;
		// connect to the nearest reachable tile
		let best = null, bd = Infinity;
		for ( let z = 1; z < L.h - 1; z ++ ) for ( let x = 1; x < L.w - 1; x ++ ) {

			if ( dist[ L.idx( x, z ) ] < 0 ) continue;
			const d = Math.abs( x - s.x ) + Math.abs( z - s.z );
			if ( d < bd ) {

				bd = d;
				best = { x, z };

			}

		}

		if ( ! best ) continue;
		carveLine( L, s.x + 0.5, s.z + 0.5, best.x + 0.5, best.z + 0.5, 1.1, TILE.FLOOR, ( t ) => t !== TILE.BRIDGE );
		repairs ++;

	}

	return repairs;

}

// Count walkable tiles.
export function floorCount( L ) {

	let n = 0;
	for ( let i = 0; i < L.tiles.length; i ++ ) if ( walkable( L.tiles[ i ] ) ) n ++;
	return n;

}

// Tile centre of a room ( integer tiles ).
export function roomCenter( room ) {

	return { x: Math.floor( room.x + room.w / 2 ), z: Math.floor( room.z + room.h / 2 ) };

}

// Smoothed value noise in [0, 1] on tile coordinates (deterministic per seed) -
// for ice patches, magma basins, fog, colour variation. Sim-safe (no three.js).
export function makeNoise( seed ) {

	const h = ( x, z ) => {

		let n = ( x * 374761393 + z * 668265263 + seed * 2246822519 ) | 0;
		n = Math.imul( n ^ ( n >>> 13 ), 1274126177 );
		return ( ( n ^ ( n >>> 16 ) ) >>> 0 ) / 4294967296;

	};

	const smooth = ( t ) => t * t * ( 3 - 2 * t );
	const value = ( x, z ) => {

		const x0 = Math.floor( x ), z0 = Math.floor( z ), fx = smooth( x - x0 ), fz = smooth( z - z0 );
		const a = h( x0, z0 ), b = h( x0 + 1, z0 ), c = h( x0, z0 + 1 ), d = h( x0 + 1, z0 + 1 );
		return a + ( b - a ) * fx + ( c - a ) * fz + ( a - b - c + d ) * fx * fz;

	};

	// two octaves are plenty for gameplay-scale patches
	return ( x, z, scale = 0.12 ) => value( x * scale, z * scale ) * 0.65 + value( x * scale * 2.3 + 17, z * scale * 2.3 + 9 ) * 0.35;

}
