// Uniform-grid spatial hash for "who is near here" queries (melee arcs, AoE,
// projectiles, monster aggro, separation). Rebuilt once per simulation step;
// with a few hundred to a few thousand entities that is cheaper than updating
// it incrementally and keeps it obviously correct.

export class SpatialHash {

	constructor( cell = 4 ) {

		this.cell = cell;
		this.map = new Map();

	}

	_key( cx, cz ) {

		return ( cx + 32768 ) * 65536 + ( cz + 32768 );

	}

	rebuild( entities ) {

		this.map.clear();
		for ( const e of entities ) {

			if ( ! e.alive && e.kind !== 'loot' ) continue;
			const k = this._key( Math.floor( e.x / this.cell ), Math.floor( e.z / this.cell ) );
			let list = this.map.get( k );
			if ( ! list ) this.map.set( k, list = [] );
			list.push( e );

		}

	}

	// Entities whose circle overlaps the query circle (r + e.radius), optionally filtered.
	query( x, z, r, filter = null, out = [] ) {

		const c = this.cell;
		const pad = r + 2;
		const cx0 = Math.floor( ( x - pad ) / c ), cx1 = Math.floor( ( x + pad ) / c );
		const cz0 = Math.floor( ( z - pad ) / c ), cz1 = Math.floor( ( z + pad ) / c );
		for ( let cz = cz0; cz <= cz1; cz ++ ) for ( let cx = cx0; cx <= cx1; cx ++ ) {

			const list = this.map.get( this._key( cx, cz ) );
			if ( ! list ) continue;
			for ( const e of list ) {

				const rr = r + e.radius;
				const dx = e.x - x, dz = e.z - z;
				if ( dx * dx + dz * dz <= rr * rr && ( ! filter || filter( e ) ) ) out.push( e );

			}

		}

		return out;

	}

	nearest( x, z, r, filter = null ) {

		let best = null, bd = Infinity;
		for ( const e of this.query( x, z, r, filter ) ) {

			const d = Math.hypot( e.x - x, e.z - z );
			if ( d < bd ) {

				bd = d;
				best = e;

			}

		}

		return best;

	}

}
