// 'dungeon' generator: built architecture - rooms from roomTemplates joined by
// corridors along a graph with a CRITICAL PATH from the start to the boss.
//
//   1. the boss room is placed near one edge, the start near the opposite edge,
//      and a small exit vault right behind the boss (reachable only through it)
//   2. other rooms are scattered with rejection sampling (no overlaps)
//   3. a minimum spanning tree links every room (Prim), then ~25% extra edges make
//      loops - so there is always more than one way around a fight
//   4. corridors are carved first, rooms on top (so pillars and inner walls win)
//   5. graph depth from the start labels rooms: start, combat, treasure (dead-end
//      side rooms), boss, exit; rooms on the start -> boss path are tagged 'critical'
//
// Then finishLayout() adds terrain features, mechanic decorations, props, lights
// and spawns (gen/finish.js).

import { define, get } from '../../../core/registry.js';
import { Layout, TILE } from '../../../core/layout.js';
import { carveCorridor, ensureConnected, roomCenter } from './grid.js';
import { pickTemplate, makeRoom, roomSize, labelRooms } from './rooms.js';
import { finishLayout } from './finish.js';

export function generateDungeon( game, spec, rng ) {

	const scale = spec.size ?? 1;
	const W = Math.round( 66 * scale ), H = W;
	const L = new Layout( W, H, 2 );
	L.fill( 0, 0, W, H, TILE.WALL );
	L.meta = { generator: 'dungeon' };

	const rooms = [];
	const overlaps = ( x, z, w, h, pad = 3 ) => x < 2 || z < 2 || x + w > W - 2 || z + h > H - 2 ||
		rooms.some( ( r ) => x < r.x + r.w + pad && x + w + pad > r.x && z < r.z + r.h + pad && z + h + pad > r.z );
	const placeAt = ( tag, cx, cz, kind ) => {

		const tpl = pickTemplate( rng, tag );
		const { w, h } = roomSize( rng, tpl );
		const x = Math.max( 2, Math.min( W - w - 2, Math.round( cx - w / 2 ) ) );
		const z = Math.max( 2, Math.min( H - h - 2, Math.round( cz - h / 2 ) ) );
		const r = makeRoom( rooms.length, tpl, x, z, w, h, kind );
		rooms.push( r );
		return r;

	};

	// boss far from the start, exit vault behind the boss
	const ang = rng.range( 0, Math.PI * 2 ), dx = Math.cos( ang ), dz = Math.sin( ang );
	const bossD = W / 2 - 22;
	const boss = placeAt( 'boss', W / 2 + dx * bossD, H / 2 + dz * bossD, 'boss' );
	const bc = roomCenter( boss );
	const exit = placeAt( 'exit', bc.x + dx * ( boss.w / 2 + 6 ), bc.z + dz * ( boss.h / 2 + 6 ), 'exit' );
	const start = placeAt( 'start', W / 2 - dx * W * 0.36, H / 2 - dz * H * 0.36, 'start' );

	// the rest of the rooms
	const want = rng.int( 11, 14 ) + Math.round( ( scale - 1 ) * 8 );
	for ( let tries = 0; tries < 600 && rooms.length < want + 3; tries ++ ) {

		const tpl = pickTemplate( rng, 'dungeon' );
		const { w, h } = roomSize( rng, tpl );
		const x = rng.int( 2, W - w - 2 ), z = rng.int( 2, H - h - 2 );
		if ( overlaps( x, z, w, h ) ) continue;
		rooms.push( makeRoom( rooms.length, tpl, x, z, w, h, 'combat' ) );

	}

	// graph: MST over everything except the exit vault, then loops
	const nodes = rooms.filter( ( r ) => r !== exit );
	const c = nodes.map( roomCenter );
	const dist = ( a, b ) => Math.hypot( c[ a ].x - c[ b ].x, c[ a ].z - c[ b ].z );
	const forbidden = ( a, b ) => ( nodes[ a ] === start && nodes[ b ] === boss ) || ( nodes[ a ] === boss && nodes[ b ] === start );
	const edges = [];
	const inTree = new Set( [ nodes.indexOf( start ) ] );
	while ( inTree.size < nodes.length ) {

		let best = null, bd = Infinity;
		for ( const a of inTree ) for ( let b = 0; b < nodes.length; b ++ ) {

			if ( inTree.has( b ) || forbidden( a, b ) ) continue;
			// the boss room is a dead end of the tree: nothing branches out of it
			if ( nodes[ a ] === boss ) continue;
			const d = dist( a, b );
			if ( d < bd ) {

				bd = d;
				best = [ a, b ];

			}

		}

		if ( ! best ) break;
		edges.push( best );
		inTree.add( best[ 1 ] );

	}

	for ( let a = 0; a < nodes.length; a ++ ) {

		if ( nodes[ a ] === boss || nodes[ a ] === start || ! rng.chance( 0.28 ) ) continue;
		const near = nodes.map( ( _, b ) => b ).filter( ( b ) => b !== a && nodes[ b ] !== boss && ! edges.some( ( e ) => ( e[ 0 ] === a && e[ 1 ] === b ) || ( e[ 0 ] === b && e[ 1 ] === a ) ) )
			.sort( ( p, q ) => dist( a, p ) - dist( a, q ) );
		if ( near.length && dist( a, near[ 0 ] ) < W * 0.45 ) edges.push( [ a, near[ 0 ] ] );

	}

	for ( const [ a, b ] of edges ) {

		nodes[ a ].links.push( nodes[ b ].id );
		nodes[ b ].links.push( nodes[ a ].id );
		const width = nodes[ a ] === boss || nodes[ b ] === boss ? 3 : rng.pick( [ 2, 2, 3 ] );
		carveCorridor( L, c[ a ], c[ b ], width, rng );

	}

	carveCorridor( L, roomCenter( boss ), roomCenter( exit ), 2, rng );
	boss.links.push( exit.id );
	exit.links.push( boss.id );
	for ( const r of rooms ) get( 'roomTemplate', r.template ).carve( L, r, rng );
	ensureConnected( L, rooms.map( ( r ) => firstFloor( L, r ) ) );

	labelRooms( rooms, start, boss, exit, rng );
	L.rooms = rooms;
	return finishLayout( L, spec, rng );

}

function firstFloor( L, r ) {

	const c = roomCenter( r );
	for ( let rad = 0; rad < Math.max( r.w, r.h ); rad ++ ) {

		for ( let z = c.z - rad; z <= c.z + rad; z ++ ) for ( let x = c.x - rad; x <= c.x + rad; x ++ ) {

			if ( L.get( x, z ) === TILE.FLOOR ) return { x, z };

		}

	}

	return c;

}

define( 'levelGenerator', { id: 'dungeon', name: 'Dungeon', tags: [ 'built' ], generate: generateDungeon } );
