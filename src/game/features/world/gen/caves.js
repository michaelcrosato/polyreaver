// 'caves' generator: organic tunnels and chambers.
//
// Pure cellular automata gives beautiful caves but no structure (no guaranteed
// path, no boss at the end). So we combine the two ideas:
//
//   1. a CHAIN of chamber centres meanders from the start to the boss chamber,
//      with side branches (dead ends become treasure) and an occasional loop
//   2. chambers are blobs (unions of discs), joined by random-walk tunnels
//   3. the walls around them are eroded with noise, then smoothed by a few
//      cellular-automata steps ("a tile with 5+ wall neighbours becomes wall") -
//      the classic 4-5 rule - which turns the hard carve into natural rock
//   4. unreachable pockets are filled in; every chamber is re-linked if smoothing
//      pinched a tunnel shut
//
// Chambers become layout.rooms (start / combat / treasure / boss / exit) so the
// director and the mechanics treat caves and dungeons the same way.

import { define } from '../../../core/registry.js';
import { Layout, TILE } from '../../../core/layout.js';
import { carveDisc, carveTunnel, bfs, ensureConnected, walkable, N8 } from './grid.js';
import { finishLayout } from './finish.js';
import { labelRooms } from './rooms.js';

export function generateCaves( game, spec, rng ) {

	const scale = spec.size ?? 1;
	const W = Math.round( 78 * scale ), H = W;
	const L = new Layout( W, H, 2 );
	L.fill( 0, 0, W, H, TILE.WALL );
	L.meta = { generator: 'caves' };

	const ang = rng.range( 0, Math.PI * 2 ), dx = Math.cos( ang ), dz = Math.sin( ang );
	const px = - dz, pz = dx; // perpendicular, for the meander
	const startP = { x: W / 2 - dx * W * 0.37, z: H / 2 - dz * H * 0.37 };
	const bossP = { x: W / 2 + dx * ( W / 2 - 19 ), z: H / 2 + dz * ( H / 2 - 19 ) };
	const clampP = ( p, m = 6 ) => ( { x: Math.max( m, Math.min( W - m, p.x ) ), z: Math.max( m, Math.min( H - m, p.z ) ) } );

	const chambers = [];
	const add = ( p, r, kind, parent = null ) => {

		const c = { ...clampP( p, r + 3 ), r, kind, parent, id: chambers.length };
		chambers.push( c );
		return c;

	};

	const start = add( startP, 4.2, 'start' );
	const main = rng.int( 4, 6 ) + Math.round( ( scale - 1 ) * 4 );
	let prev = start;
	for ( let i = 1; i <= main; i ++ ) {

		const t = i / ( main + 1 );
		const wob = rng.range( - 0.26, 0.26 ) * W;
		const p = { x: startP.x + ( bossP.x - startP.x ) * t + px * wob, z: startP.z + ( bossP.z - startP.z ) * t + pz * wob };
		prev = add( p, rng.range( 5, 7.5 ), 'combat', prev );

	}

	const boss = add( bossP, 10, 'boss', prev );
	const exit = add( { x: bossP.x + dx * 14, z: bossP.z + dz * 14 }, 3.4, 'exit', boss );

	// side branches off the main chain
	const branches = rng.int( 3, 5 ) + Math.round( ( scale - 1 ) * 3 );
	for ( let i = 0; i < branches; i ++ ) {

		const from = chambers[ rng.int( 1, main ) ];
		for ( let tries = 0; tries < 20; tries ++ ) {

			const a = rng.range( 0, Math.PI * 2 ), d = rng.range( 13, 19 );
			const p = clampP( { x: from.x + Math.cos( a ) * d, z: from.z + Math.sin( a ) * d }, 8 );
			if ( chambers.some( ( c ) => Math.hypot( c.x - p.x, c.z - p.z ) < c.r + 9 ) ) continue;
			add( p, rng.range( 4, 6 ), 'combat', from );
			break;

		}

	}

	// carve: chambers as blobs, tunnels to their parents (+ one loop)
	for ( const c of chambers ) {

		carveDisc( L, c.x, c.z, c.r );
		const lobes = c.kind === 'boss' ? 6 : rng.int( 2, 4 );
		for ( let i = 0; i < lobes; i ++ ) {

			const a = rng.range( 0, Math.PI * 2 ), d = c.r * rng.range( 0.4, 0.8 );
			carveDisc( L, c.x + Math.cos( a ) * d, c.z + Math.sin( a ) * d, c.r * rng.range( 0.45, 0.7 ) );

		}

		if ( c.parent ) carveTunnel( L, c.parent, c, rng, { brush: c.kind === 'boss' ? 1.9 : rng.range( 1.2, 1.7 ) } );

	}

	const loopA = chambers.filter( ( c ) => c.kind === 'combat' );
	if ( loopA.length > 3 ) {

		const a = rng.pick( loopA ), b = loopA.filter( ( c ) => c !== a && c !== a.parent && c.parent !== a ).sort( ( p, q ) => Math.hypot( a.x - p.x, a.z - p.z ) - Math.hypot( a.x - q.x, a.z - q.z ) )[ 0 ];
		if ( b && Math.hypot( a.x - b.x, a.z - b.z ) < W * 0.4 ) {

			carveTunnel( L, a, b, rng, { brush: 1.2 } );
			a.loop = b.id;

		}

	}

	// erode + smooth: noise first so the automaton has something to round off
	// chamber cores are protected so smoothing can never close a chamber
	const protect = new Uint8Array( W * H );
	for ( const c of chambers ) {

		const r = c.r * 0.6;
		for ( let z = Math.floor( c.z - r ); z <= Math.ceil( c.z + r ); z ++ ) for ( let x = Math.floor( c.x - r ); x <= Math.ceil( c.x + r ); x ++ ) {

			if ( L.inside( x, z ) && Math.hypot( x + 0.5 - c.x, z + 0.5 - c.z ) <= r ) protect[ z * W + x ] = 1;

		}

	}

	for ( let z = 2; z < H - 2; z ++ ) for ( let x = 2; x < W - 2; x ++ ) {

		if ( L.get( x, z ) !== TILE.WALL ) continue;
		let near = 0;
		for ( const [ ox, oz ] of N8 ) if ( L.get( x + ox, z + oz ) === TILE.FLOOR ) near ++;
		if ( near && rng.chance( 0.38 ) ) L.set( x, z, TILE.FLOOR );

	}

	for ( let step = 0; step < 3; step ++ ) {

		const next = new Uint8Array( L.tiles );
		for ( let z = 1; z < H - 1; z ++ ) for ( let x = 1; x < W - 1; x ++ ) {

			let walls = 0;
			for ( const [ ox, oz ] of N8 ) if ( L.get( x + ox, z + oz ) === TILE.WALL ) walls ++;
			const i = z * W + x;
			if ( protect[ i ] ) next[ i ] = TILE.FLOOR;
			else if ( walls >= 5 ) next[ i ] = TILE.WALL;
			else if ( walls <= 2 ) next[ i ] = TILE.FLOOR;

		}

		// keep a solid frame
		for ( let x = 0; x < W; x ++ ) next[ x ] = next[ ( H - 1 ) * W + x ] = TILE.WALL;
		for ( let z = 0; z < H; z ++ ) next[ z * W ] = next[ z * W + W - 1 ] = TILE.WALL;
		L.tiles.set( next );

	}

	// rooms from chambers
	L.rooms = chambers.map( ( c ) => {

		const r = Math.ceil( c.r + 1 );
		const x = Math.max( 1, Math.floor( c.x - r ) ), z = Math.max( 1, Math.floor( c.z - r ) );
		return {
			id: c.id, x, z, w: Math.min( W - 1 - x, r * 2 ), h: Math.min( H - 1 - z, r * 2 ), kind: c.kind, template: 'chamber',
			tags: [ 'caves' ], pillars: [], links: [], depth: 0
		};

	} );

	for ( const c of chambers ) {

		if ( c.parent ) link( L.rooms[ c.id ], L.rooms[ c.parent.id ] );
		if ( c.loop !== undefined ) link( L.rooms[ c.id ], L.rooms[ c.loop ] );

	}

	// connectivity: re-carve pinched tunnels, then drop pockets nobody can reach
	const seeds = chambers.map( ( c ) => ( { x: Math.floor( c.x ), z: Math.floor( c.z ) } ) );
	for ( const s of seeds ) carveDisc( L, s.x + 0.5, s.z + 0.5, 1.5 );
	ensureConnected( L, seeds );
	const dist = bfs( L, [ seeds[ 0 ] ] );
	for ( let i = 0; i < L.tiles.length; i ++ ) if ( walkable( L.tiles[ i ] ) && dist[ i ] < 0 ) L.tiles[ i ] = TILE.WALL;

	// boss arena: a few columns of rock to fight around
	const br = L.rooms[ boss.id ];
	const n = rng.pick( [ 5, 6, 7 ] ), a0 = rng.range( 0, Math.PI );
	for ( let i = 0; i < n; i ++ ) {

		const a = a0 + i / n * Math.PI * 2;
		const tx = Math.floor( boss.x + Math.cos( a ) * boss.r * 0.62 ), tz = Math.floor( boss.z + Math.sin( a ) * boss.r * 0.62 );
		if ( L.get( tx, tz ) !== TILE.FLOOR ) continue;
		L.set( tx, tz, TILE.WALL );
		br.pillars.push( { x: tx, z: tz } );

	}

	labelRooms( L.rooms, L.rooms[ start.id ], br, L.rooms[ exit.id ], rng );
	return finishLayout( L, spec, rng );

}

function link( a, b ) {

	if ( ! a.links.includes( b.id ) ) a.links.push( b.id );
	if ( ! b.links.includes( a.id ) ) b.links.push( a.id );

}

define( 'levelGenerator', { id: 'caves', name: 'Caves', tags: [ 'organic' ], generate: generateCaves } );
