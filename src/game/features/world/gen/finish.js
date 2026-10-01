// The finisher: every generator produces rooms + corridors, then hands the raw
// grid to finishLayout(), which turns it into a playable, readable level:
//
//   1. room anchors (a walkable tile per room) + world-space centres
//   2. theme terrain features: water pools, lava rivers, chasms, ice
//   3. bridges wherever a feature cut the start from a room (always reachable);
//      leftover floor pockets a pool or chasm cut off are sealed (no stranding)
//   4. mechanic decorators ( mechanic.decorate( L, rng, ctx ) ): ice patches, spike
//      grids, magma basins, pylons, rift pairs, wells, hives, vents ...
//   5. walls hug the floor (outlineWalls), floor styles + ambient occlusion
//   6. decor props from the theme (wall / corner / open placements), pillars
//   7. lights: torches along room walls, glow sources (lava, crystals)
//   8. spawns with budgets and tags for the encounter director
//
// Generation is deterministic: every random choice comes from the rng it is given
// (forked per step so adding a prop type never reshuffles the spawns).

import { TILE } from '../../../core/layout.js';
import { get } from '../../../core/registry.js';
import {
	walkable, bfs, path, wallDistance, outlineWalls, N4, N8, carveDisc, makeNoise, roomCenter
} from './grid.js';
import { themeFor, STYLE } from '../themes.js';

const SAFE = ( t ) => t === TILE.FLOOR || t === TILE.ICE || t === TILE.BRIDGE || t === TILE.DOOR;
const GAP = ( t ) => t === TILE.PIT || t === TILE.WATER || t === TILE.LAVA;

export function finishLayout( L, spec, rng ) {

	const theme = themeFor( spec );
	L.theme = theme.id;
	L.style = L.style || new Uint8Array( L.w * L.h );
	L.elev = L.elev || new Int8Array( L.w * L.h );
	L.occ = new Uint8Array( L.w * L.h ); // tiles already holding a prop / mechanic object
	L.meta = { ...L.meta, theme: theme.id, depth: spec.depth ?? 0, mechanics: [ ...( spec.mechanics || [] ) ] };

	anchorRooms( L );
	const anchors = L.rooms.map( ( r ) => ( { x: r.ax, z: r.az } ) );
	// room anchors stay free: nothing solid and no mechanic object may sit on a room's heart
	for ( const a of anchors ) for ( let z = a.z - 1; z <= a.z + 1; z ++ ) for ( let x = a.x - 1; x <= a.x + 1; x ++ ) if ( L.inside( x, z ) ) L.occ[ L.idx( x, z ) ] = 1;

	// terrain features from the theme
	const f = theme.features || {};
	const frng = rng.fork( 'features' );
	if ( f.pools ) addPools( L, frng, f.pools );
	if ( f.lava ) addRivers( L, frng, f.lava, TILE.LAVA );
	if ( f.chasm ) addRivers( L, frng, f.chasm, TILE.PIT );
	if ( f.ice ) addIce( L, frng, f.ice );
	bridgeGaps( L, anchors );
	L.meta.critical = criticalPath( L );

	// mechanic decorators
	for ( const id of spec.mechanics || [] ) {

		const m = get( 'mechanic', id );
		if ( m?.decorate ) m.decorate( L, rng.fork( 'mech:' + id ), { intensity: spec.intensity?.[ id ] ?? 1, spec, theme } );

	}

	bridgeGaps( L, anchors );
	sealPockets( L, anchors );
	outlineWalls( L );
	styleFloors( L, rng.fork( 'style' ), theme );
	const wd = wallDistance( L );
	placePillars( L, theme );
	placeDecor( L, rng.fork( 'decor' ), theme, wd );
	if ( ! L.meta.noTorches ) placeLights( L, rng.fork( 'lights' ), theme, wd );
	placeGlow( L, rng.fork( 'glow' ), theme );
	placeTreasure( L, rng.fork( 'treasure' ), wd );
	placeSpawns( L, rng.fork( 'spawns' ), spec, wd );

	const start = L.rooms.find( ( r ) => r.kind === 'start' ) || L.rooms[ 0 ];
	const exit = L.rooms.find( ( r ) => r.kind === 'exit' ) || L.rooms[ L.rooms.length - 1 ];
	L.start = { x: start.cx, z: start.cz };
	L.exit = { x: exit.cx, z: exit.cz };
	return L;

}

// --- rooms ---------------------------------------------------------------------------

export function anchorRooms( L ) {

	for ( const r of L.rooms ) {

		const c = roomCenter( r );
		let best = null, bd = Infinity, tiles = 0;
		for ( let z = r.z; z < r.z + r.h; z ++ ) for ( let x = r.x; x < r.x + r.w; x ++ ) {

			if ( ! walkable( L.get( x, z ) ) ) continue;
			tiles ++;
			const d = ( x - c.x ) ** 2 + ( z - c.z ) ** 2;
			if ( d < bd ) {

				bd = d;
				best = { x, z };

			}

		}

		best = best || c;
		r.ax = best.x; r.az = best.z; r.tiles = tiles;
		[ r.cx, r.cz ] = L.toWorld( best.x, best.z );

	}

}

export function roomAt( L, tx, tz ) {

	for ( const r of L.rooms ) if ( tx >= r.x && tz >= r.z && tx < r.x + r.w && tz < r.z + r.h ) return r;
	return null;

}

// Tile path start -> boss -> exit (subsampled), for decorators that care about the
// "main road" (shortcut portals, safe high ground, bridges).
function criticalPath( L ) {

	const s = L.rooms.find( ( r ) => r.kind === 'start' ), b = L.rooms.find( ( r ) => r.kind === 'boss' );
	if ( ! s || ! b ) return [];
	const p = path( L, { x: s.ax, z: s.az }, { x: b.ax, z: b.az } ) || [];
	return p.filter( ( _, i ) => i % 2 === 0 );

}

// --- terrain features --------------------------------------------------------------------

function addPools( L, rng, amount ) {

	const wd = wallDistance( L );
	for ( const r of L.rooms ) {

		if ( r.kind !== 'combat' || ! rng.chance( amount ) ) continue;
		const n = rng.int( 1, 3 );
		for ( let i = 0; i < n; i ++ ) {

			const tx = rng.int( r.x + 2, r.x + r.w - 3 ), tz = rng.int( r.z + 2, r.z + r.h - 3 );
			if ( wd[ L.idx( tx, tz ) ] < 3 ) continue;
			const rad = rng.range( 1.2, 2.6 );
			carveDisc( L, tx + 0.5, tz + 0.5, rad, TILE.WATER, ( t, x, z ) => t === TILE.FLOOR && wd[ L.idx( x, z ) ] >= 2 );

		}

	}

}

// Meandering bands across the map (lava rivers, chasms). Bridges come later.
function addRivers( L, rng, amount, tile ) {

	const count = Math.max( 1, Math.round( amount * 5 ) );
	const protect = protectedTiles( L );
	for ( let k = 0; k < count; k ++ ) {

		const vertical = rng.chance( 0.5 );
		let x = vertical ? rng.int( 8, L.w - 8 ) : 1, z = vertical ? 1 : rng.int( 8, L.h - 8 );
		let ang = vertical ? Math.PI / 2 : 0;
		const width = tile === TILE.PIT ? rng.range( 1.3, 2.4 ) : rng.range( 0.8, 1.5 );
		for ( let i = 0; i < L.w * 2; i ++ ) {

			ang += rng.range( - 0.35, 0.35 );
			ang += ( ( vertical ? Math.PI / 2 : 0 ) - ang ) * 0.08;
			x += Math.cos( ang ) * 0.7; z += Math.sin( ang ) * 0.7;
			if ( x < 1 || z < 1 || x >= L.w - 1 || z >= L.h - 1 ) break;
			carveDisc( L, x, z, width, tile, ( t, tx, tz ) => t === TILE.FLOOR && ! protect[ L.idx( tx, tz ) ] );

		}

	}

}

function addIce( L, rng, amount ) {

	const noise = makeNoise( rng.int( 1, 1e9 ) );
	const protect = protectedTiles( L );
	for ( let z = 0; z < L.h; z ++ ) for ( let x = 0; x < L.w; x ++ ) {

		const i = L.idx( x, z );
		if ( L.tiles[ i ] === TILE.FLOOR && ! protect[ i ] && noise( x, z, 0.14 ) > 1 - amount ) L.tiles[ i ] = TILE.ICE;

	}

}

// Start, exit and the boss dais stay plain floor whatever the features do.
export function protectedTiles( L ) {

	const p = new Uint8Array( L.w * L.h );
	for ( const r of L.rooms ) {

		if ( r.kind !== 'start' && r.kind !== 'exit' && r.kind !== 'boss' ) continue;
		const rad = r.kind === 'boss' ? 3.5 : 4.5;
		for ( let z = r.az - 5; z <= r.az + 5; z ++ ) for ( let x = r.ax - 5; x <= r.ax + 5; x ++ ) {

			if ( L.inside( x, z ) && Math.hypot( x - r.ax, z - r.az ) <= rad ) p[ L.idx( x, z ) ] = 1;

		}

	}

	return p;

}

// Every room must be reachable from the first WITHOUT crossing a hazard; where a
// pit, pool or lava band cuts the way, the shortest crossing becomes a bridge.
export function bridgeGaps( L, anchors ) {

	for ( let guard = 0; guard < 24; guard ++ ) {

		const dist = bfs( L, [ anchors[ 0 ] ], SAFE );
		const cut = anchors.find( ( a ) => dist[ L.idx( a.x, a.z ) ] < 0 );
		if ( ! cut ) return;
		const p = path( L, anchors[ 0 ], cut, ( t ) => SAFE( t ) || GAP( t ) );
		if ( ! p ) {

			// the anchor itself is enclosed by walls: give up quietly (ensureConnected ran earlier)
			L.set( cut.x, cut.z, TILE.FLOOR );
			continue;

		}

		for ( const t of p ) if ( GAP( L.get( t.x, t.z ) ) ) L.set( t.x, t.z, TILE.BRIDGE );

	}

}

// Floor the start cannot reach on foot (a pool clipped a room's corner) joins the
// hazard next to it, else becomes wall: nothing spawns out of reach, and a leap
// or blink can never strand the player somewhere with no way back.
export function sealPockets( L, anchors ) {

	const dist = bfs( L, [ anchors[ 0 ] ], walkable );
	const pocket = ( x, z ) => L.inside( x, z ) && walkable( L.get( x, z ) ) && dist[ L.idx( x, z ) ] < 0;
	// grow the neighbouring hazard into the pocket, then wall up whatever is left
	for ( let pass = 0, changed = true; changed && pass < 64; pass ++ ) {

		changed = false;
		for ( let z = 0; z < L.h; z ++ ) for ( let x = 0; x < L.w; x ++ ) {

			if ( ! pocket( x, z ) ) continue;
			const n = [ L.get( x + 1, z ), L.get( x - 1, z ), L.get( x, z + 1 ), L.get( x, z - 1 ) ].find( GAP );
			if ( n === undefined ) continue;
			L.set( x, z, n );
			changed = true;

		}

	}

	for ( let z = 0; z < L.h; z ++ ) for ( let x = 0; x < L.w; x ++ ) if ( pocket( x, z ) ) L.set( x, z, TILE.WALL );

}

// --- styling ------------------------------------------------------------------------------

function styleFloors( L, rng, theme ) {

	for ( const r of L.rooms ) {

		const s = r.kind === 'boss' || r.kind === 'exit' ? STYLE.ORNATE : r.kind === 'start' || rng.chance( 0.6 ) ? STYLE.ROOM : STYLE.BASE;
		for ( let z = r.z; z < r.z + r.h; z ++ ) for ( let x = r.x; x < r.x + r.w; x ++ ) if ( L.inside( x, z ) && L.style[ L.idx( x, z ) ] === 0 ) L.style[ L.idx( x, z ) ] = s;

	}

	if ( theme.checker ) for ( let z = 0; z < L.h; z ++ ) for ( let x = 0; x < L.w; x ++ ) if ( ( x + z ) % 2 ) L.style[ L.idx( x, z ) ] = L.style[ L.idx( x, z ) ] === STYLE.ROOM ? STYLE.BASE : STYLE.ROOM;
	// ambient occlusion: floor tiles hugging walls are darker, which reads as depth
	L.ao = new Uint8Array( L.w * L.h );
	for ( let z = 0; z < L.h; z ++ ) for ( let x = 0; x < L.w; x ++ ) {

		if ( ! walkable( L.get( x, z ) ) ) continue;
		let n = 0;
		for ( const [ dx, dz ] of N8 ) if ( L.get( x + dx, z + dz ) === TILE.WALL || L.get( x + dx, z + dz ) === TILE.VOID ) n += Math.abs( dx ) + Math.abs( dz ) === 1 ? 2 : 1;
		L.ao[ L.idx( x, z ) ] = Math.min( 255, n * 22 );

	}

}

function placePillars( L, theme ) {

	for ( const r of L.rooms ) for ( const p of r.pillars || [] ) {

		if ( L.get( p.x, p.z ) !== TILE.WALL ) continue;
		const [ x, z ] = L.toWorld( p.x, p.z );
		L.props.push( { type: theme.pillar || 'prop-pillar', x, z, rot: 0, scale: 1, data: { solid: true, pillar: true } } );
		L.occ[ L.idx( p.x, p.z ) ] = 1;

	}

}

// Direction from a floor tile to its first adjacent wall (for wall-hugging props).
function wallDir( L, x, z ) {

	for ( const [ dx, dz ] of N4 ) if ( ! walkable( L.get( x + dx, z + dz ) ) && L.get( x + dx, z + dz ) !== TILE.PIT ) return [ dx, dz ];
	return null;

}

function placeDecor( L, rng, theme, wd ) {

	const start = L.rooms.find( ( r ) => r.kind === 'start' );
	const floor = [];
	for ( let z = 1; z < L.h - 1; z ++ ) for ( let x = 1; x < L.w - 1; x ++ ) {

		const i = L.idx( x, z );
		if ( L.tiles[ i ] !== TILE.FLOOR || L.occ[ i ] ) continue;
		if ( start && Math.hypot( x - start.ax, z - start.az ) < 3.5 ) continue;
		floor.push( i );

	}

	const per100 = floor.length / 100;
	for ( const p of theme.props || [] ) {

		const want = Math.round( p.density * per100 * rng.range( 0.7, 1.2 ) );
		let placed = 0;
		for ( let tries = 0; tries < want * 6 && placed < want; tries ++ ) {

			const i = floor[ rng.int( 0, floor.length - 1 ) ];
			if ( L.occ[ i ] || L.tiles[ i ] !== TILE.FLOOR ) continue;
			const x = i % L.w, z = ( i / L.w ) | 0;
			const d = wd[ i ], room = roomAt( L, x, z );
			let rot = rng.range( 0, Math.PI * 2 ), ox = 0, oz = 0;
			if ( p.where === 'wall' || p.where === 'corner' ) {

				if ( d !== 1 ) continue;
				const dir = wallDir( L, x, z );
				if ( ! dir ) continue;
				if ( p.where === 'corner' ) {

					let walls = 0;
					for ( const [ dx, dz ] of N4 ) if ( ! walkable( L.get( x + dx, z + dz ) ) ) walls ++;
					if ( walls < 2 ) continue;

				}

				rot = Math.atan2( - dir[ 0 ], - dir[ 1 ] ) + rng.range( - 0.25, 0.25 );
				ox = dir[ 0 ] * L.cell * 0.3; oz = dir[ 1 ] * L.cell * 0.3;

			} else if ( p.where === 'open' ) {

				if ( d < 3 || ! room || room.kind === 'boss' || room.kind === 'exit' ) continue;

			} else if ( p.where === 'corridor' ) {

				if ( room ) continue;

			}

			const [ wx, wz ] = L.toWorld( x, z );
			const s = p.scale ? rng.range( p.scale[ 0 ], p.scale[ 1 ] ) : rng.range( 0.8, 1.2 );
			L.props.push( { type: p.model, x: wx + ox, z: wz + oz, rot, scale: s, data: p.solid ? { solid: true } : {} } );
			L.occ[ i ] = 1;
			if ( p.solid ) L.tiles[ i ] = TILE.WALL;
			placed ++;

		}

	}

}

function placeLights( L, rng, theme, wd ) {

	const lt = theme.lights;
	if ( ! lt ) return;
	const spacing = lt.spacing || 8;
	const taken = [];
	const far = ( x, z, s ) => taken.every( ( t ) => Math.hypot( t.x - x, t.z - z ) >= s );
	const add = ( x, z, dir, standing ) => {

		const [ wx, wz ] = L.toWorld( x, z );
		const off = standing ? 0.15 : 0.42;
		const px = wx + ( dir ? dir[ 0 ] * L.cell * off : 0 ), pz = wz + ( dir ? dir[ 1 ] * L.cell * off : 0 );
		const rot = dir ? Math.atan2( - dir[ 0 ], - dir[ 1 ] ) : 0;
		L.lights.push( { x: px, y: lt.height ?? 2, z: pz, color: lt.color, intensity: lt.intensity, range: lt.range, flicker: lt.flicker ?? 0.2, kind: lt.kind, model: lt.model, rot } );
		L.props.push( { type: lt.model, x: px, z: pz, rot, scale: 1, data: { light: L.lights.length - 1 } } );
		L.occ[ L.idx( x, z ) ] = 1;
		taken.push( { x, z } );

	};

	const standing = lt.kind !== 'torch' && lt.kind !== 'lamp';
	for ( const r of L.rooms ) {

		const cands = [];
		for ( let z = r.z; z < r.z + r.h; z ++ ) for ( let x = r.x; x < r.x + r.w; x ++ ) {

			const i = L.idx( x, z );
			if ( L.inside( x, z ) && wd[ i ] === 1 && L.tiles[ i ] === TILE.FLOOR && ! L.occ[ i ] ) cands.push( { x, z } );

		}

		rng.shuffle( cands );
		const want = Math.max( 2, Math.round( r.tiles / ( spacing * spacing * 0.9 ) ) );
		let n = 0;
		for ( const c of cands ) {

			if ( n >= want ) break;
			if ( ! far( c.x, c.z, spacing ) ) continue;
			add( c.x, c.z, wallDir( L, c.x, c.z ), standing );
			n ++;

		}

	}

	// sparse corridor lights so the way between rooms is never pitch black
	for ( let z = 1; z < L.h - 1; z ++ ) for ( let x = 1; x < L.w - 1; x ++ ) {

		const i = L.idx( x, z );
		if ( wd[ i ] !== 1 || L.tiles[ i ] !== TILE.FLOOR || L.occ[ i ] || roomAt( L, x, z ) ) continue;
		if ( ! far( x, z, spacing * 1.7 ) || ! rng.chance( 0.35 ) ) continue;
		add( x, z, wallDir( L, x, z ), standing );

	}

}

// Extra coloured light where the theme says things glow: lava pools, crystals...
function placeGlow( L, rng, theme ) {

	for ( const g of theme.glow || [] ) {

		if ( g.on === 'lava' ) {

			const cell = 7;
			for ( let cz = 0; cz < L.h; cz += cell ) for ( let cx = 0; cx < L.w; cx += cell ) {

				let sx = 0, sz = 0, n = 0;
				for ( let z = cz; z < Math.min( L.h, cz + cell ); z ++ ) for ( let x = cx; x < Math.min( L.w, cx + cell ); x ++ ) {

					if ( L.get( x, z ) === TILE.LAVA ) {

						sx += x; sz += z; n ++;

					}

				}

				if ( n < 4 ) continue;
				const [ wx, wz ] = L.toWorld( sx / n, sz / n );
				L.lights.push( { x: wx, y: 0.8, z: wz, color: g.color, intensity: g.intensity, range: g.range, flicker: 0.25, kind: 'glow' } );

			}

		} else {

			const props = L.props.filter( ( p ) => p.type === g.on );
			rng.shuffle( props );
			for ( const p of props.slice( 0, 24 ) ) L.lights.push( { x: p.x, y: 1, z: p.z, color: g.color, intensity: g.intensity, range: g.range, flicker: 0.1, kind: 'glow' } );

		}

	}

}

// Treasure rooms hold a chest (an entity: see flow.js) - the reward for the detour.
function placeTreasure( L, rng, wd ) {

	for ( const r of L.rooms ) {

		if ( r.kind !== 'treasure' ) continue;
		for ( let i = 0; i < 40; i ++ ) {

			const x = rng.int( r.x, r.x + r.w - 1 ), z = rng.int( r.z, r.z + r.h - 1 );
			if ( ! L.inside( x, z ) || L.get( x, z ) !== TILE.FLOOR || L.occ[ L.idx( x, z ) ] || wd[ L.idx( x, z ) ] < 2 ) continue;
			const [ wx, wz ] = L.toWorld( x, z );
			L.props.push( { type: 'chest', x: wx, z: wz, rot: rng.range( - 0.5, 0.5 ), scale: 1, data: { mechanic: 'treasure', room: r.id } } );
			L.occ[ L.idx( x, z ) ] = 1;
			break;

		}

	}

}

// --- spawns -------------------------------------------------------------------------------
// layout.spawns: { x, z, room, budget, tags } - budget is "normal monsters worth of
// threat"; the director turns it into packs (elites cost more, swarms less).

function placeSpawns( L, rng, spec, wd ) {

	const depth = spec.depth ?? 1;
	const density = ( spec.density ?? 1 ) * 0.075;
	const start = L.rooms.find( ( r ) => r.kind === 'start' );
	const sx = start ? start.cx : 0, sz = start ? start.cz : 0;
	const ok = ( x, z ) => {

		const t = L.get( x, z );
		if ( t !== TILE.FLOOR && t !== TILE.ICE ) return false;
		if ( wd[ L.idx( x, z ) ] < 1 ) return false;
		const [ wx, wz ] = L.toWorld( x, z );
		return Math.hypot( wx - sx, wz - sz ) > 16;

	};

	for ( const r of L.rooms ) {

		if ( r.kind === 'boss' ) {

			L.spawns.push( { x: r.cx, z: r.cz, room: r.id, budget: 0, tags: [ 'boss' ] } );
			continue;

		}

		if ( r.kind !== 'combat' && r.kind !== 'treasure' ) continue;
		let budget = Math.max( 3, Math.round( r.tiles * density * rng.range( 0.8, 1.25 ) ) );
		if ( r.kind === 'treasure' ) budget = Math.round( budget * 0.6 );
		for ( let guard = 0; budget > 0 && guard < 30; guard ++ ) {

			const tx = rng.int( r.x, r.x + r.w - 1 ), tz = rng.int( r.z, r.z + r.h - 1 );
			if ( ! ok( tx, tz ) ) continue;
			const n = Math.min( budget, rng.int( 3, 6 ) );
			const [ x, z ] = L.toWorld( tx, tz );
			const tags = [ 'pack' ];
			if ( rng.chance( 0.1 + depth * 0.012 ) ) tags.push( 'elite' );
			if ( r.kind === 'treasure' ) tags.push( 'guard' );
			L.spawns.push( { x, z, room: r.id, budget: n, tags } );
			budget -= n;

		}

	}

	// corridor ambushes
	const corridor = [];
	for ( let z = 1; z < L.h - 1; z ++ ) for ( let x = 1; x < L.w - 1; x ++ ) if ( ok( x, z ) && ! roomAt( L, x, z ) ) corridor.push( { x, z } );
	rng.shuffle( corridor );
	const taken = [];
	const want = Math.round( corridor.length / 90 );
	for ( const c of corridor ) {

		if ( taken.length >= want ) break;
		if ( taken.some( ( t ) => Math.hypot( t.x - c.x, t.z - c.z ) < 14 ) ) continue;
		const [ x, z ] = L.toWorld( c.x, c.z );
		L.spawns.push( { x, z, room: - 1, budget: rng.int( 2, 3 ), tags: [ 'ambush' ] } );
		taken.push( c );

	}

}
