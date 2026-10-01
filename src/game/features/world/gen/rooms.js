// Room templates - composable room shapes, registered as 'roomTemplate' defs so a
// theme, a mechanic or another feature can add shapes without touching the
// generators:
//
//   define( 'roomTemplate', {
//     id: 'pillared', tags: [ 'dungeon', 'combat' ], weight: 2,
//     size: [ minW, maxW, minH, maxH ],          bounding box in tiles
//     carve( L, room, rng )                       write FLOOR (and pillar WALLs) inside room.x/z/w/h
//   } )
//
// Generators pick templates by tags ( query( 'roomTemplate', { tags: [ 'dungeon' ] } ) ).
// Pillars are WALL tiles recorded in room.pillars; the finisher turns them into
// pillar props so the renderer draws columns instead of wall blocks.

import { define, query } from '../../../core/registry.js';
import { TILE } from '../../../core/layout.js';
import { carveRect, carveDisc } from './grid.js';

function pillar( L, room, x, z ) {

	L.set( x, z, TILE.WALL );
	room.pillars.push( { x, z } );

}

define( 'roomTemplate', { id: 'rect', name: 'Chamber', tags: [ 'dungeon', 'combat', 'side' ], weight: 3, size: [ 7, 13, 6, 12 ],
	carve( L, r ) {

		carveRect( L, r.x, r.z, r.w, r.h );

	} } );

define( 'roomTemplate', { id: 'octagon', name: 'Octagon', tags: [ 'dungeon', 'combat', 'side', 'treasure' ], weight: 2, size: [ 9, 15, 9, 15 ],
	carve( L, r ) {

		const cut = Math.max( 2, Math.floor( Math.min( r.w, r.h ) / 4 ) );
		for ( let z = 0; z < r.h; z ++ ) for ( let x = 0; x < r.w; x ++ ) {

			const dx = Math.min( x, r.w - 1 - x ), dz = Math.min( z, r.h - 1 - z );
			if ( dx + dz >= cut ) L.set( r.x + x, r.z + z, TILE.FLOOR );

		}

	} } );

define( 'roomTemplate', { id: 'hall', name: 'Pillared hall', tags: [ 'dungeon', 'combat' ], weight: 2, size: [ 14, 20, 8, 11 ],
	carve( L, r, rng ) {

		carveRect( L, r.x, r.z, r.w, r.h );
		const step = rng.pick( [ 3, 4 ] );
		for ( let x = r.x + 2; x < r.x + r.w - 2; x += step ) {

			pillar( L, r, x, r.z + 2 );
			pillar( L, r, x, r.z + r.h - 3 );

		}

	} } );

define( 'roomTemplate', { id: 'round', name: 'Rotunda', tags: [ 'dungeon', 'caves', 'combat', 'side', 'treasure' ], weight: 2, size: [ 9, 15, 9, 15 ],
	carve( L, r ) {

		const rr = Math.min( r.w, r.h ) / 2;
		carveDisc( L, r.x + r.w / 2, r.z + r.h / 2, rr );

	} } );

define( 'roomTemplate', { id: 'cross', name: 'Crossing', tags: [ 'dungeon', 'combat' ], weight: 1.5, size: [ 11, 15, 11, 15 ],
	carve( L, r ) {

		const tw = Math.floor( r.w / 3 ), th = Math.floor( r.h / 3 );
		carveRect( L, r.x + tw, r.z, r.w - 2 * tw, r.h );
		carveRect( L, r.x, r.z + th, r.w, r.h - 2 * th );

	} } );

define( 'roomTemplate', { id: 'ring', name: 'Ring hall', tags: [ 'dungeon', 'combat' ], weight: 1.5, size: [ 12, 16, 12, 16 ],
	// a loop around a solid core: kiting room (and a natural "lure them around" track)
	carve( L, r ) {

		carveRect( L, r.x, r.z, r.w, r.h );
		const ix = r.x + 4, iz = r.z + 4, iw = r.w - 8, ih = r.h - 8;
		for ( let z = iz; z < iz + ih; z ++ ) for ( let x = ix; x < ix + iw; x ++ ) L.set( x, z, TILE.WALL );

	} } );

define( 'roomTemplate', { id: 'pillared', name: 'Colonnade', tags: [ 'dungeon', 'combat', 'side' ], weight: 1.5, size: [ 11, 15, 11, 15 ],
	carve( L, r ) {

		carveRect( L, r.x, r.z, r.w, r.h );
		for ( let z = r.z + 3; z < r.z + r.h - 3; z += 4 ) for ( let x = r.x + 3; x < r.x + r.w - 3; x += 4 ) pillar( L, r, x, z );

	} } );

define( 'roomTemplate', { id: 'ell', name: 'Bent chamber', tags: [ 'dungeon', 'combat', 'side' ], weight: 1, size: [ 10, 14, 10, 14 ],
	carve( L, r, rng ) {

		const fx = rng.chance( 0.5 ), fz = rng.chance( 0.5 );
		const aw = Math.ceil( r.w / 2 ), ah = Math.ceil( r.h / 2 );
		carveRect( L, fx ? r.x : r.x + r.w - aw, r.z, aw, r.h );
		carveRect( L, r.x, fz ? r.z : r.z + r.h - ah, r.w, ah );

	} } );

define( 'roomTemplate', { id: 'cavern', name: 'Cavern', tags: [ 'caves', 'combat', 'side', 'dungeon' ], weight: 2, size: [ 10, 16, 10, 16 ],
	// union of overlapping discs: organic outline even inside a built dungeon
	carve( L, r, rng ) {

		const n = rng.int( 3, 6 );
		for ( let i = 0; i < n; i ++ ) {

			const rr = rng.range( 2.2, Math.min( r.w, r.h ) / 2.4 );
			const cx = rng.range( r.x + rr, r.x + r.w - rr ), cz = rng.range( r.z + rr, r.z + r.h - rr );
			carveDisc( L, cx, cz, rr );

		}

		carveDisc( L, r.x + r.w / 2, r.z + r.h / 2, Math.min( r.w, r.h ) / 3 );

	} } );

define( 'roomTemplate', { id: 'camp', name: 'Landing', tags: [ 'start' ], size: [ 8, 9, 8, 9 ],
	carve( L, r ) {

		const cut = 2;
		for ( let z = 0; z < r.h; z ++ ) for ( let x = 0; x < r.w; x ++ ) {

			const dx = Math.min( x, r.w - 1 - x ), dz = Math.min( z, r.h - 1 - z );
			if ( dx + dz >= cut ) L.set( r.x + x, r.z + z, TILE.FLOOR );

		}

	} } );

define( 'roomTemplate', { id: 'vault', name: 'Exit vault', tags: [ 'exit' ], size: [ 6, 7, 6, 7 ],
	carve( L, r ) {

		carveDisc( L, r.x + r.w / 2, r.z + r.h / 2, Math.min( r.w, r.h ) / 2 );

	} } );

// The boss arena: a big round floor with a ring of columns (cover, pull-around
// spots for gravity wells and conduits) and a raised dais in the middle.
define( 'roomTemplate', { id: 'arena', name: 'Arena', tags: [ 'boss' ], size: [ 19, 23, 19, 23 ],
	carve( L, r, rng ) {

		const cx = r.x + r.w / 2, cz = r.z + r.h / 2, rr = Math.min( r.w, r.h ) / 2;
		carveDisc( L, cx, cz, rr );
		const n = rng.pick( [ 6, 8 ] ), pr = rr * 0.62, a0 = rng.range( 0, Math.PI );
		for ( let i = 0; i < n; i ++ ) {

			const a = a0 + i / n * Math.PI * 2;
			pillar( L, r, Math.floor( cx + Math.cos( a ) * pr ), Math.floor( cz + Math.sin( a ) * pr ) );

		}

		r.dais = { x: Math.floor( cx ), z: Math.floor( cz ), r: Math.max( 2, Math.floor( rr * 0.25 ) ) };

	} } );

// Choose a template for a role: query by tag, weighted random.
export function pickTemplate( rng, tag, extra = [] ) {

	const list = query( 'roomTemplate', { tags: [ tag ], none: extra.includes( 'nolarge' ) ? [ 'large' ] : [] } );
	return rng.weighted( list );

}

// A room record (tiles). kind: start | combat | treasure | boss | exit
export function makeRoom( id, tpl, x, z, w, h, kind = 'combat' ) {

	return { id, x, z, w, h, kind, template: tpl.id, tags: [], pillars: [], links: [], depth: 0 };

}

export function roomSize( rng, tpl, scale = 1 ) {

	const [ a, b, c, d ] = tpl.size;
	return { w: Math.round( rng.int( a, b ) * scale ), h: Math.round( rng.int( c, d ) * scale ) };

}

// Graph depth from the start, critical path to the boss, dead ends become treasure.
export function labelRooms( rooms, start, boss, exit, rng ) {

	const byId = new Map( rooms.map( ( r ) => [ r.id, r ] ) );
	const prev = new Map();
	const queue = [ start ];
	start.depth = 0;
	const seen = new Set( [ start.id ] );
	while ( queue.length ) {

		const r = queue.shift();
		for ( const id of r.links ) {

			if ( seen.has( id ) ) continue;
			seen.add( id );
			const n = byId.get( id );
			n.depth = r.depth + 1;
			prev.set( id, r.id );
			queue.push( n );

		}

	}

	for ( let id = boss.id; id !== undefined; id = prev.get( id ) ) byId.get( id ).tags.push( 'critical' );
	const leaves = rooms.filter( ( r ) => r.kind === 'combat' && r.links.length === 1 && ! r.tags.includes( 'critical' ) ).sort( ( a, b ) => b.depth - a.depth );
	for ( const r of leaves.slice( 0, rng.int( 1, 2 ) ) ) r.kind = 'treasure';
	for ( const r of rooms ) if ( r.kind === 'combat' && ! r.tags.includes( 'critical' ) ) r.tags.push( 'side' );

}
