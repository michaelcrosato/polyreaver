// Pure road-derived vehicle graph, separate from sidewalk and crossing nodes.
export function laneGraph( city ) {

	const nodes = [];
	for ( let j = 0; j <= 16; j ++ ) for ( let i = 0; i <= 16; i ++ ) nodes.push( { id: j * 17 + i, x: city.xs[ i ], z: city.zs[ j ], out: [], signal: j * 17 + i } );
	const edges = [];
	const entryNodes = new Map();
	for ( const alley of city.alleys ) {

		const id = nodes.length; nodes.push( { id, x: alley.entranceX, z: alley.entranceZ, out: [], signal: - 1 } ); entryNodes.set( alley, id );

	}
	const connect = ( a, b, kind = 'street' ) => {

		const p = nodes[ a ], q = nodes[ b ], id = edges.length, length = Math.hypot( q.x - p.x, q.z - p.z );
		edges.push( { id, a, b, dx: ( q.x - p.x ) / length, dz: ( q.z - p.z ) / length, length, reverse: id + 1, kind } );
		edges.push( { id: id + 1, a: b, b: a, dx: ( p.x - q.x ) / length, dz: ( p.z - q.z ) / length, length, reverse: id, kind } );
		p.out.push( id ); q.out.push( id + 1 );

	};
	for ( const r of city.roads ) {

		if ( r.kind === 'alley' ) continue;
		const a = r.j * 17 + r.i, b = a + ( r.axis === 'x' ? 1 : 17 );
		const entries = r.axis === 'x' ? city.alleys.filter( ( alley ) => alley.i === r.i && alley.j === r.j ).sort( ( x, y ) => x.entranceX - y.entranceX ).map( ( alley ) => entryNodes.get( alley ) ) : [];
		const chain = [ a, ...entries, b ];
		for ( let i = 0; i < chain.length - 1; i ++ ) connect( chain[ i ], chain[ i + 1 ] );

	}
	for ( const alley of city.alleys ) {

		const yard = nodes.length; nodes.push( { id: yard, x: alley.endX, z: alley.endZ, out: [], signal: - 1 } ); connect( entryNodes.get( alley ), yard, 'alley' );

	}
	return { nodes, edges };

}
