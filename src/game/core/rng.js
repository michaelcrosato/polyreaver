// Seeded randomness. Everything procedural in the game (monsters, loot, levels,
// skill-tree layout, encounters) draws from an RNG forked from one seed, so a seed
// reproduces the exact same content - in the browser and in Node.
//
//   const rng = new RNG( 'level-7' );        // strings or numbers
//   rng.next()            float in [0, 1)
//   rng.int( 1, 6 )       integer, both ends inclusive
//   rng.range( 2, 5 )     float in [2, 5)
//   rng.pick( array )     one element
//   rng.weighted( defs, ( d ) => d.weight )
//   rng.fork( 'loot' )    independent stream: adding draws to one system never
//                         changes what another system rolls

export function hashStr( str ) {

	// FNV-1a, then a final avalanche so similar strings land far apart
	let h = 2166136261 >>> 0;
	const s = String( str );
	for ( let i = 0; i < s.length; i ++ ) {

		h ^= s.charCodeAt( i );
		h = Math.imul( h, 16777619 ) >>> 0;

	}

	h ^= h >>> 16;
	h = Math.imul( h, 0x85ebca6b ) >>> 0;
	h ^= h >>> 13;
	return h >>> 0;

}

export function hash2( a, b ) {

	return hashStr( a + ':' + b );

}

export class RNG {

	constructor( seed = 1 ) {

		this.seed = typeof seed === 'number' ? seed >>> 0 : hashStr( seed );
		// sfc32 state from the seed
		this.a = this.seed ^ 0x9e3779b9;
		this.b = Math.imul( this.seed, 0x85ebca6b ) >>> 0;
		this.c = Math.imul( this.seed ^ 0xc2b2ae35, 0x27d4eb2f ) >>> 0;
		this.d = 1;
		for ( let i = 0; i < 12; i ++ ) this.next();

	}

	next() {

		let { a, b, c, d } = this;
		const t = ( ( ( a + b ) >>> 0 ) + d ) >>> 0;
		d = ( d + 1 ) >>> 0;
		a = b ^ ( b >>> 9 );
		b = ( c + ( c << 3 ) ) >>> 0;
		c = ( ( c << 21 ) | ( c >>> 11 ) ) >>> 0;
		c = ( c + t ) >>> 0;
		this.a = a; this.b = b; this.c = c; this.d = d;
		return t / 4294967296;

	}

	int( min, max ) {

		return min + Math.floor( this.next() * ( max - min + 1 ) );

	}

	range( min, max ) {

		return min + this.next() * ( max - min );

	}

	chance( p ) {

		return this.next() < p;

	}

	sign() {

		return this.next() < 0.5 ? - 1 : 1;

	}

	pick( arr ) {

		return arr.length ? arr[ Math.floor( this.next() * arr.length ) ] : undefined;

	}

	// Pick one item with probability proportional to weight( item ).
	weighted( items, weight = ( d ) => d.weight ?? 1 ) {

		let total = 0;
		for ( const it of items ) total += Math.max( 0, weight( it ) );
		if ( total <= 0 ) return undefined;
		let r = this.next() * total;
		for ( const it of items ) {

			r -= Math.max( 0, weight( it ) );
			if ( r < 0 ) return it;

		}

		return items[ items.length - 1 ];

	}

	shuffle( arr ) {

		for ( let i = arr.length - 1; i > 0; i -- ) {

			const j = Math.floor( this.next() * ( i + 1 ) );
			[ arr[ i ], arr[ j ] ] = [ arr[ j ], arr[ i ] ];

		}

		return arr;

	}

	// Standard normal (Box-Muller).
	normal() {

		const u = Math.max( 1e-9, this.next() ), v = this.next();
		return Math.sqrt( - 2 * Math.log( u ) ) * Math.cos( 2 * Math.PI * v );

	}

	fork( label ) {

		return new RNG( hash2( this.seed, label ) );

	}

}
