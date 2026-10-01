// 'town' generator: the hub, Hearthmoor. Hand-shaped rather than random - a hub
// should feel the same every visit so players learn where everything is - but
// built with the same tools as the dungeons (tiles, styles, props, lights), with
// a seeded scatter for trees and clutter.
//
//   north   waypoint obelisk + portal (level select)
//   west    the forge: Blacksmith (craft)
//   east    the market: Merchant (vendor), Gambler (gamble)
//   NE      the Mystic's tent (passive tree / skills)
//   south   the gate where you arrive, the stash chest, the training yard (dummy)
//   centre  an open cobbled plaza for the ambient townsfolk crowd
//
// NPC placement and behaviour data goes to layout.meta.town; the town world hook
// (features/world/town.js) turns it into entities.

import { define } from '../../../core/registry.js';
import { Layout, TILE } from '../../../core/layout.js';
import { carveDisc, carveRect, outlineWalls, walkable, makeNoise, N8 } from './grid.js';
import { STYLE } from '../themes.js';

export function generateTown( game, spec, rng ) {

	const W = 64, H = 64, C = 32;
	const L = new Layout( W, H, 2 );
	L.style = new Uint8Array( W * H );
	L.elev = new Int8Array( W * H );
	L.occ = new Uint8Array( W * H );
	L.theme = 'town';
	const noise = makeNoise( 77 );
	const w2t = ( tx, tz ) => L.toWorld( tx, tz );
	const setStyle = ( tx, tz, s ) => L.inside( tx, tz ) && walkable( L.get( tx, tz ) ) && ( L.style[ L.idx( tx, tz ) ] = s );

	// ground: a lumpy disc of grass inside a hedge
	for ( let z = 1; z < H - 1; z ++ ) for ( let x = 1; x < W - 1; x ++ ) {

		const a = Math.atan2( z - C, x - C ), r = 26 + noise( Math.cos( a ) * 20 + 50, Math.sin( a ) * 20 + 50, 0.15 ) * 4;
		if ( Math.hypot( x + 0.5 - C, z + 0.5 - C ) < r ) {

			L.set( x, z, TILE.FLOOR );
			L.style[ L.idx( x, z ) ] = noise( x, z, 0.2 ) > 0.62 ? STYLE.EDGE : STYLE.GRASS;

		}

	}

	// roads (cobbles) and the plaza
	carveRect( L, C - 1, 6, 3, 52 );
	carveRect( L, 6, C - 1, 52, 3 );
	for ( let i = 6; i < 58; i ++ ) for ( let k = - 1; k <= 1; k ++ ) {

		setStyle( C + k, i, STYLE.ROAD );
		setStyle( i, C + k, STYLE.ROAD );

	}

	carveDisc( L, C, C, 9.5 );
	for ( let z = C - 10; z <= C + 10; z ++ ) for ( let x = C - 10; x <= C + 10; x ++ ) {

		const d = Math.hypot( x + 0.5 - C, z + 0.5 - C );
		if ( d < 9.5 ) setStyle( x, z, d < 2.5 ? STYLE.ORNATE : STYLE.PLAZA );

	}

	const props = L.props, lights = L.lights;
	const prop = ( type, tx, tz, rot = 0, scale = 1, data = {} ) => {

		const [ x, z ] = w2t( tx, tz );
		props.push( { type, x, z, rot, scale, data } );
		if ( L.inside( Math.floor( tx ), Math.floor( tz ) ) ) L.occ[ L.idx( Math.floor( tx ), Math.floor( tz ) ) ] = 1;
		return props[ props.length - 1 ];

	};

	// a solid structure covering w x h tiles, drawn by one model at its centre
	const block = ( type, tx, tz, w, h, rot = 0, extra = {} ) => {

		for ( let z = tz; z < tz + h; z ++ ) for ( let x = tx; x < tx + w; x ++ ) {

			L.set( x, z, TILE.WALL );
			L.occ[ L.idx( x, z ) ] = 1;

		}

		const [ x, z ] = L.toWorld( tx + ( w - 1 ) / 2, tz + ( h - 1 ) / 2 );
		props.push( { type, x, z, rot, scale: 1, data: { solid: true, footprint: [ tx, tz, w, h ], ...extra } } );

	};

	const light = ( tx, tz, color, intensity, range, flicker, kind, y = 2.8 ) => {

		const [ x, z ] = w2t( tx, tz );
		lights.push( { x, y, z, color, intensity, range, flicker, kind } );

	};

	const lamp = ( tx, tz ) => {

		prop( 'prop-lamp-post', tx, tz, rng.range( 0, 6.28 ) );
		light( tx, tz, '#ffc070', 30, 14, 0.1, 'lamp', 3.1 );

	};

	// --- stations -------------------------------------------------------------------
	const stations = {};
	const station = ( id, tx, tz ) => ( stations[ id ] = { x: w2t( tx, tz )[ 0 ], z: w2t( tx, tz )[ 1 ] } );

	// waypoint (north)
	carveDisc( L, C + 0.5, 12.5, 4.2 );
	for ( let z = 8; z <= 17; z ++ ) for ( let x = C - 5; x <= C + 5; x ++ ) if ( Math.hypot( x - C, z - 12 ) < 4.2 ) setStyle( x, z, STYLE.ORNATE );
	station( 'waypoint', C, 12 );
	light( C, 12, '#7ab8ff', 60, 18, 0.05, 'beacon', 3.5 );

	// forge (west)
	block( 'prop-forge', 13, C - 3, 3, 3, Math.PI / 2 );
	prop( 'prop-anvil', 17.5, C - 0.5, Math.PI / 2 );
	prop( 'prop-crate', 14, C + 2 ); prop( 'prop-barrel-decor', 15, C + 2.6 ); prop( 'prop-weapon-rack', 13.6, C - 4.3, 0 );
	station( 'blacksmith', 18.5, C + 1 );
	light( 15.5, C - 1.5, '#ff7a2a', 70, 16, 0.45, 'forge', 1.6 );

	// market (east)
	block( 'prop-stall', 48, C - 5, 2, 3, - Math.PI / 2, { canopy: '#b83a3a' } );
	block( 'prop-stall', 48, C + 3, 2, 3, - Math.PI / 2, { canopy: '#3a6ab8' } );
	prop( 'prop-crate', 50.5, C - 1 ); prop( 'prop-crate', 50.5, C + 0.4, 0.4 ); prop( 'prop-barrel-decor', 49.5, C + 6.8 );
	station( 'merchant', 46.5, C - 3 );
	station( 'gambler', 46.5, C + 4.5 );
	lamp( 46, C - 6 ); lamp( 46, C + 7 );

	// mystic tent (north-east)
	block( 'prop-tent', 42, 17, 3, 3, 0.4 );
	prop( 'prop-crystal', 40.5, 16, 0, 0.8 ); prop( 'prop-crystal', 45.5, 21, 1, 0.7 );
	station( 'mystic', 41, 21.5 );
	light( 43, 18.5, '#c08aff', 36, 12, 0.2, 'crystal', 2.2 );

	// arrival gate, stash, training yard (south)
	station( 'start', C, C + 14 );
	station( 'stash', C + 4, C + 11 );
	station( 'dummy', 19, C + 13 );
	station( 'guard', C - 3, C + 21 );
	for ( let a = 0; a < Math.PI * 2; a += Math.PI / 11 ) {

		if ( Math.abs( a - Math.PI * 1.75 ) < 0.35 ) continue; // the yard's opening faces the plaza
		prop( 'prop-fence', 19 + Math.cos( a ) * 4.2, C + 13 + Math.sin( a ) * 4.2, - a );

	}

	prop( 'prop-weapon-rack', 15.5, C + 11, Math.PI / 2 );
	prop( 'prop-hay', 21.5, C + 16.5, 0.3 );
	lamp( 23, C + 9 );

	// houses around the ring, avoiding roads and stations
	const houseSpots = [ [ 21, 20, 0 ], [ 24, 14, 0.1 ], [ 37, 41, Math.PI ], [ 41, 46, Math.PI ], [ 23, 45, Math.PI ], [ 15, 22, 0 ], [ 47, 22, - Math.PI / 2 ],
		[ 49, 40, - Math.PI / 2 ], [ 36, 51, Math.PI ], [ 25, 52, Math.PI ], [ 10, 38, Math.PI / 2 ], [ 52, 26, - Math.PI / 2 ] ];
	for ( const [ hx, hz, rot ] of houseSpots ) {

		const w = 3 + ( rng.chance( 0.4 ) ? 1 : 0 ), h = 3;
		let free = true;
		for ( let z = hz - 1; z < hz + h + 1; z ++ ) for ( let x = hx - 1; x < hx + w + 1; x ++ ) if ( ! walkable( L.get( x, z ) ) || L.occ[ L.idx( x, z ) ] || L.style[ L.idx( x, z ) ] === STYLE.ROAD || L.style[ L.idx( x, z ) ] === STYLE.PLAZA ) free = false;
		if ( ! free ) continue;
		block( 'prop-house', hx, hz, w, h, rot, { roof: rng.pick( [ '#8a3a2a', '#5a4a6a', '#3a5a4a', '#7a5a2a' ] ) } );
		// warm window light
		const [ lx, lz ] = L.toWorld( hx + w / 2, hz + h + 0.2 );
		lights.push( { x: lx, y: 1.6, z: lz, color: '#ffb060', intensity: 10, range: 7, flicker: 0.15, kind: 'window' } );

	}

	// pond (south-west) with a little bridge
	carveDisc( L, 12.5, C + 9.5, 3.1, TILE.WATER, ( t ) => t === TILE.FLOOR );
	for ( let x = 9; x <= 16; x ++ ) if ( L.get( x, C + 9 ) === TILE.WATER ) L.set( x, C + 9, TILE.BRIDGE );
	prop( 'prop-reeds', 9.5, C + 7.5 ); prop( 'prop-reeds', 15.8, C + 12 ); prop( 'prop-reeds', 10, C + 12.4 );

	// plaza ring of lamps, benches and banners
	for ( let i = 0; i < 8; i ++ ) {

		const a = ( i + 0.5 ) / 8 * Math.PI * 2;
		lamp( C + Math.cos( a ) * 10.2, C + Math.sin( a ) * 10.2 );
		if ( i % 2 ) prop( 'prop-bench', C + Math.cos( a + 0.2 ) * 10.6, C + Math.sin( a + 0.2 ) * 10.6, - a + Math.PI / 2 );

	}

	prop( 'prop-mosaic', C, C, 0, 1 );
	for ( let i = 8; i < 56; i += 7 ) {

		if ( Math.abs( i - C ) < 12 ) continue;
		lamp( C + 2.4, i ); lamp( i, C - 2.4 );

	}

	prop( 'prop-banner', C - 2.5, 16, 0 ); prop( 'prop-banner', C + 3.5, 16, 0 );
	prop( 'prop-signpost', C + 2.5, C + 18, 0.3 );
	prop( 'prop-well', 24, 27, 0.2 );

	// trees and clutter on the grass (seeded scatter)
	for ( let tries = 0, n = 0; tries < 800 && n < 46; tries ++ ) {

		const x = rng.int( 3, W - 4 ), z = rng.int( 3, H - 4 ), i = L.idx( x, z );
		if ( L.get( x, z ) !== TILE.FLOOR || L.occ[ i ] ) continue;
		const s = L.style[ i ];
		if ( s !== STYLE.GRASS && s !== STYLE.EDGE ) continue;
		let nearWall = false;
		for ( const [ dx, dz ] of N8 ) if ( L.get( x + dx, z + dz ) !== TILE.FLOOR || L.occ[ L.idx( x + dx, z + dz ) ] ) nearWall = true;
		const r = Math.hypot( x - C, z - C );
		if ( r < 18 && ! nearWall ) continue; // inner ring stays open
		if ( nearWall && r < 18 ) continue;
		prop( rng.chance( 0.7 ) ? 'prop-tree' : 'prop-pine', x + rng.range( 0.3, 0.7 ), z + rng.range( 0.3, 0.7 ), rng.range( 0, 6.28 ), rng.range( 0.85, 1.25 ) );
		n ++;

	}

	for ( let n = 0, tries = 0; tries < 300 && n < 18; tries ++ ) {

		const x = rng.int( 4, W - 5 ), z = rng.int( 4, H - 5 ), i = L.idx( x, z );
		if ( L.get( x, z ) !== TILE.FLOOR || L.occ[ i ] || Math.hypot( x - C, z - C ) < 11 ) continue;
		prop( rng.pick( [ 'prop-crate', 'prop-barrel-decor', 'prop-hay', 'prop-flowers', 'prop-flowers' ] ), x + 0.5, z + 0.5, rng.range( 0, 6.28 ) );
		n ++;

	}

	outlineWalls( L );
	// the hedge ring gets trees on top so the edge of town reads as a treeline
	for ( let z = 0; z < H; z ++ ) for ( let x = 0; x < W; x ++ ) {

		if ( L.get( x, z ) === TILE.WALL && ! L.occ[ L.idx( x, z ) ] && ( x * 7 + z * 13 ) % 5 === 0 ) prop( 'prop-pine', x + 0.5, z + 0.5, x, 1.3, { onWall: true } );

	}

	L.ao = new Uint8Array( W * H );
	L.start = { ...stations.start };
	L.exit = null;
	const plaza = w2t( C, C );
	L.rooms = [ { id: 0, x: C - 9, z: C - 9, w: 18, h: 18, kind: 'start', tags: [ 'plaza' ], pillars: [], links: [], ax: C, az: C, cx: plaza[ 0 ], cz: plaza[ 1 ], tiles: 250 } ];
	L.meta = {
		generator: 'town', theme: 'town',
		town: {
			stations,
			plaza: { x: plaza[ 0 ], z: plaza[ 1 ], radius: 15 },
			crowd: { x: plaza[ 0 ], z: plaza[ 1 ], count: 90, radius: 13 }
		}
	};
	return L;

}

define( 'levelGenerator', { id: 'town', name: 'Town', tags: [ 'hub' ], generate: generateTown } );
