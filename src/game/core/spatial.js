// Uniform-grid spatial hash for "who is near here" queries (melee arcs, AoE,
// projectiles, monster aggro, separation). Rebuilt once per simulation step;
// with a few hundred to a few thousand entities that is cheaper than updating
// it incrementally and keeps it obviously correct.

export class SpatialHash {

	constructor( cell = 4 ) {

		this.cell = cell;
		this.map = new Map();
		this._keys = new Map();
		this._buckets = [];
		this.maxRadius = 0;

	}

	_key( cx, cz ) {

		return ( cx + 32768 ) * 65536 + ( cz + 32768 );

	}

	rebuild( entities ) {

		// Recycle bucket arrays: rebuilding the hash must not create hundreds of
		// short-lived arrays every simulation step.
		for ( const list of this.map.values() ) {

			list.length = 0;
			this._buckets.push( list );

		}
		this.map.clear();
		this._keys.clear();
		this.maxRadius = 0;
		for ( const e of entities ) {

			if ( ! e.alive && e.kind !== 'loot' ) continue;
			const k = this._key( Math.floor( e.x / this.cell ), Math.floor( e.z / this.cell ) );
			let list = this.map.get( k );
			if ( ! list ) this.map.set( k, list = this._buckets.pop() || [] );
			list.push( e );
			this._keys.set( e, k );
			this.maxRadius = Math.max( this.maxRadius, e.radius || 0 );

		}

	}

	// Movers and teleports may cross cells after the step's rebuild. Update just
	// their membership instead of relying on a guessed maximum movement distance.
	update( e ) {

		if ( ! e.alive && e.kind !== 'loot' ) return;
		this.maxRadius = Math.max( this.maxRadius, e.radius || 0 );
		const k = this._key( Math.floor( e.x / this.cell ), Math.floor( e.z / this.cell ) );
		const previous = this._keys.get( e );
		if ( previous === k ) return;
		if ( previous !== undefined ) {

			const old = this.map.get( previous ), i = old?.indexOf( e ) ?? - 1;
			if ( i >= 0 ) old.splice( i, 1 );
			if ( old && ! old.length ) {

				this.map.delete( previous );
				this._buckets.push( old );

			}

		}
		let list = this.map.get( k );
		if ( ! list ) this.map.set( k, list = this._buckets.pop() || [] );
		list.push( e );
		this._keys.set( e, k );

	}

	refresh( entities ) {

		for ( const e of entities ) this.update( e );

	}

	// Entities whose circle overlaps the query circle (r + e.radius), optionally filtered.
	query( x, z, r, filter = null, out = [] ) {

		this.forEach( x, z, r, ( e ) => out.push( e ), filter );
		return out;

	}

	// Allocation-free iteration for hot paths that do not need to sort results.
	// Returning false from the visitor stops the search. Callbacks may query the
	// hash again: no shared result buffer is used.
	forEach( x, z, r, visit, filter = null ) {

		const c = this.cell;
		const pad = r + this.maxRadius;
		const cx0 = Math.floor( ( x - pad ) / c ), cx1 = Math.floor( ( x + pad ) / c );
		const cz0 = Math.floor( ( z - pad ) / c ), cz1 = Math.floor( ( z + pad ) / c );
		for ( let cz = cz0; cz <= cz1; cz ++ ) for ( let cx = cx0; cx <= cx1; cx ++ ) {

			const list = this.map.get( this._key( cx, cz ) );
			if ( ! list ) continue;
			for ( const e of list ) {

				const rr = r + e.radius;
				const dx = e.x - x, dz = e.z - z;
				if ( dx * dx + dz * dz <= rr * rr && ( ! filter || filter( e ) ) && visit( e ) === false ) return;

			}

		}

	}

	nearest( x, z, r, filter = null ) {

		let best = null, bd = Infinity;
		this.forEach( x, z, r, ( e ) => {

			const dx = e.x - x, dz = e.z - z, d = dx * dx + dz * dz;
			if ( d < bd ) {

				bd = d;
				best = e;

			}

		}, filter );

		return best;

	}

}
