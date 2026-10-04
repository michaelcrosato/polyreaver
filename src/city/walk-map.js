// A nearest-walkable-cell atlas for the original stress-test simulation. RG and
// BA encode 16-bit cell coordinates, so compute needs a texture, no extra storage
// binding. Eroding the source leaves clearance around buildings and canal banks.
export function buildWalkMap( surface ) {

	const { size, data } = surface, length = size * size;
	const nearest = new Int32Array( length ).fill( - 1 ), queue = new Int32Array( length );
	let head = 0, tail = 0;
	for ( let z = 1; z < size - 1; z ++ ) for ( let x = 1; x < size - 1; x ++ ) {

		let safe = true;
		for ( let dz = - 1; dz <= 1 && safe; dz ++ ) for ( let dx = - 1; dx <= 1; dx ++ ) {

			if ( data[ ( ( z + dz ) * size + x + dx ) * 4 + 1 ] !== 1 ) { safe = false; break; }

		}
		if ( safe ) { const i = z * size + x; nearest[ i ] = i; queue[ tail ++ ] = i; }

	}
	if ( tail === 0 ) throw new Error( 'The city has no safe walking surface.' );
	const safeCells = tail;
	while ( head < tail ) {

		const i = queue[ head ++ ], x = i % size, z = Math.floor( i / size );
		for ( const n of [ x > 0 ? i - 1 : - 1, x < size - 1 ? i + 1 : - 1, z > 0 ? i - size : - 1, z < size - 1 ? i + size : - 1 ] ) {

			if ( n < 0 || nearest[ n ] !== - 1 ) continue;
			nearest[ n ] = nearest[ i ]; queue[ tail ++ ] = n;

		}

	}
	const atlas = new Uint8Array( length * 4 );
	for ( let i = 0; i < length; i ++ ) {

		const x = nearest[ i ] % size, z = Math.floor( nearest[ i ] / size );
		atlas.set( [ x & 255, x >> 8, z & 255, z >> 8 ], i * 4 );

	}
	return { data: atlas, size, safeCells };

}
