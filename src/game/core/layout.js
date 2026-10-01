// Level layout: a tile grid on the ground plane. It is pure data (generators in
// src/game/sim/levels build it, the render layer turns it into meshes, the sim
// uses it for collision and line of sight), so the same layout object works in
// the browser, in Node and in the agent tools (toAscii()).
//
// Tile codes (TILE) - extend by adding codes; generators and renderers switch on them.

export const TILE = { VOID: 0, FLOOR: 1, WALL: 2, PIT: 3, WATER: 4, LAVA: 5, ICE: 6, BRIDGE: 7, DOOR: 8 };
const BLOCKS_MOVE = new Set( [ TILE.VOID, TILE.WALL, TILE.PIT, TILE.WATER ] );
const BLOCKS_SIGHT = new Set( [ TILE.VOID, TILE.WALL ] );

export class Layout {

	// w, h in tiles; cell = metres per tile. World origin (0,0) is the grid centre.
	constructor( w, h, cell = 2 ) {

		this.w = w; this.h = h; this.cell = cell;
		this.tiles = new Uint8Array( w * h );
		this.ox = - w * cell / 2; this.oz = - h * cell / 2;
		this.rooms = []; // { id, x, z, w, h (tiles), tags, kind: 'start'|'combat'|'boss'|'treasure'|'exit'... }
		this.start = { x: 0, z: 0 };
		this.exit = null; // { x, z }
		this.spawns = []; // { x, z, room, budget, tags }
		this.props = []; // { type, x, z, rot, scale, data }  -> prop entities / static meshes
		this.lights = []; // { x, y, z, color, intensity, range, flicker }
		this.regions = []; // { id, tiles: [indices], data } mechanic zones (ice patch, dark area, ...)
		this.theme = null; // theme id ( registry 'theme' )
		this.meta = {};

	}

	idx( tx, tz ) {

		return tz * this.w + tx;

	}

	inside( tx, tz ) {

		return tx >= 0 && tz >= 0 && tx < this.w && tz < this.h;

	}

	get( tx, tz ) {

		return this.inside( tx, tz ) ? this.tiles[ this.idx( tx, tz ) ] : TILE.VOID;

	}

	set( tx, tz, v ) {

		if ( this.inside( tx, tz ) ) this.tiles[ this.idx( tx, tz ) ] = v;

	}

	fill( tx, tz, w, h, v ) {

		for ( let z = tz; z < tz + h; z ++ ) for ( let x = tx; x < tx + w; x ++ ) this.set( x, z, v );

	}

	toTile( x, z ) {

		return [ Math.floor( ( x - this.ox ) / this.cell ), Math.floor( ( z - this.oz ) / this.cell ) ];

	}

	toWorld( tx, tz ) {

		return [ this.ox + ( tx + 0.5 ) * this.cell, this.oz + ( tz + 0.5 ) * this.cell ];

	}

	tileAt( x, z ) {

		const [ tx, tz ] = this.toTile( x, z );
		return this.get( tx, tz );

	}

	isWalkable( x, z ) {

		return ! BLOCKS_MOVE.has( this.tileAt( x, z ) );

	}

	blocksSight( x, z ) {

		return BLOCKS_SIGHT.has( this.tileAt( x, z ) );

	}

	// Push a circle out of blocking tiles. Returns the corrected position and whether
	// it touched anything (for "hit a wall" reactions and projectile deaths).
	collideCircle( x, z, r, blocks = BLOCKS_MOVE ) {

		let hit = false;
		const c = this.cell;
		for ( let iter = 0; iter < 2; iter ++ ) {

			const [ tx0, tz0 ] = this.toTile( x - r, z - r );
			const [ tx1, tz1 ] = this.toTile( x + r, z + r );
			for ( let tz = tz0; tz <= tz1; tz ++ ) for ( let tx = tx0; tx <= tx1; tx ++ ) {

				if ( ! blocks.has( this.get( tx, tz ) ) ) continue;
				const minX = this.ox + tx * c, minZ = this.oz + tz * c;
				const px = Math.max( minX, Math.min( x, minX + c ) );
				const pz = Math.max( minZ, Math.min( z, minZ + c ) );
				let dx = x - px, dz = z - pz;
				const d2 = dx * dx + dz * dz;
				if ( d2 >= r * r ) continue;
				hit = true;
				if ( d2 > 1e-9 ) {

					const d = Math.sqrt( d2 );
					x += dx / d * ( r - d );
					z += dz / d * ( r - d );

				} else {

					// centre inside the tile: push out along the shortest axis
					const cx = minX + c / 2, cz = minZ + c / 2;
					dx = x - cx; dz = z - cz;
					if ( Math.abs( dx ) > Math.abs( dz ) ) x = cx + Math.sign( dx || 1 ) * ( c / 2 + r );
					else z = cz + Math.sign( dz || 1 ) * ( c / 2 + r );

				}

			}

		}

		return { x, z, hit };

	}

	// First blocking point along a segment, as a fraction t of its length (1 = clear).
	raycast( x0, z0, x1, z1, blocks = BLOCKS_SIGHT ) {

		const len = Math.hypot( x1 - x0, z1 - z0 );
		const steps = Math.max( 1, Math.ceil( len / ( this.cell * 0.25 ) ) );
		for ( let i = 1; i <= steps; i ++ ) {

			const t = i / steps;
			if ( blocks.has( this.tileAt( x0 + ( x1 - x0 ) * t, z0 + ( z1 - z0 ) * t ) ) ) return ( i - 1 ) / steps;

		}

		return 1;

	}

	hasLineOfSight( x0, z0, x1, z1 ) {

		return this.raycast( x0, z0, x1, z1 ) >= 1;

	}

	// A random walkable point (optionally inside a room / away from a point).
	randomFloor( rng, { room = null, awayFrom = null, minDist = 0, tries = 200 } = {} ) {

		for ( let i = 0; i < tries; i ++ ) {

			const tx = room ? rng.int( room.x, room.x + room.w - 1 ) : rng.int( 0, this.w - 1 );
			const tz = room ? rng.int( room.z, room.z + room.h - 1 ) : rng.int( 0, this.h - 1 );
			if ( this.get( tx, tz ) !== TILE.FLOOR ) continue;
			const [ x, z ] = this.toWorld( tx, tz );
			if ( awayFrom && Math.hypot( x - awayFrom.x, z - awayFrom.z ) < minDist ) continue;
			return { x, z };

		}

		return { ...this.start };

	}

	// Text picture of the layout: the cheapest way for an AI agent (or a test) to
	// "see" a level. Legend: # wall, . floor, ~ water, ^ lava, * ice, = bridge,
	// space void/pit, S start, E exit, R room centre.
	toAscii( { marks = [] } = {} ) {

		const ch = { [ TILE.VOID ]: ' ', [ TILE.FLOOR ]: '.', [ TILE.WALL ]: '#', [ TILE.PIT ]: ' ', [ TILE.WATER ]: '~', [ TILE.LAVA ]: '^', [ TILE.ICE ]: '*', [ TILE.BRIDGE ]: '=', [ TILE.DOOR ]: '+' };
		const rows = [];
		for ( let z = 0; z < this.h; z ++ ) {

			let row = '';
			for ( let x = 0; x < this.w; x ++ ) row += ch[ this.tiles[ this.idx( x, z ) ] ] ?? '?';
			rows.push( row.split( '' ) );

		}

		const mark = ( p, c ) => {

			if ( ! p ) return;
			const [ tx, tz ] = this.toTile( p.x, p.z );
			if ( this.inside( tx, tz ) ) rows[ tz ][ tx ] = c;

		};

		mark( this.start, 'S' );
		mark( this.exit, 'E' );
		for ( const m of marks ) mark( m, m.char || '@' );
		return rows.map( ( r ) => r.join( '' ) ).join( '\n' );

	}

}

// The simplest generator: one walled rectangle. Real generators live in
// src/game/sim/levels and register as 'levelGenerator' defs.
export function makeArena( w = 24, h = 24, cell = 2 ) {

	const L = new Layout( w, h, cell );
	L.fill( 0, 0, w, h, TILE.WALL );
	L.fill( 1, 1, w - 2, h - 2, TILE.FLOOR );
	L.rooms.push( { id: 0, x: 1, z: 1, w: w - 2, h: h - 2, tags: [ 'arena' ], kind: 'combat' } );
	L.start = { x: 0, z: ( h / 2 - 3 ) * cell };
	L.exit = { x: 0, z: - ( h / 2 - 3 ) * cell };
	return L;

}
