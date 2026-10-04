// Static GPU map is uvec4 rows. Floating-point components are IEEE bit patterns;
// all IDs remain u32. This avoids binding separate buffers for every record type.
export function packCity( city ) {

	const edgeBase = 0, nodeBase = city.graph.edges.length * 3;
	const addressBase = nodeBase + city.graph.nodes.length;
	const signalBase = addressBase + city.addresses.length * 2;
	const buildingBase = signalBase + city.signals.length, spatialBase = buildingBase + city.buildings.length;
	const cells = Array.from( { length: 1024 }, () => [] );
	for ( const b of city.buildings ) {

		for ( let z = Math.max( 0, Math.floor( ( b.z0 + 1024 - .28 ) / 64 ) ); z <= Math.min( 31, Math.floor( ( b.z1 + 1024 + .28 ) / 64 ) ); z ++ ) {

			for ( let x = Math.max( 0, Math.floor( ( b.x0 + 1024 - .28 ) / 64 ) ); x <= Math.min( 31, Math.floor( ( b.x1 + 1024 + .28 ) / 64 ) ); x ++ ) cells[ z * 32 + x ].push( b.id );

		}

	}
	const spatialIndexBase = spatialBase + 1024, indices = cells.flat();
	const map = new Uint32Array( ( spatialIndexBase + Math.ceil( indices.length / 4 ) ) * 4 );
	const floats = new Float32Array( map.buffer );
	for ( const e of city.graph.edges ) {

		const r = e.id * 12;
		floats.set( [ e.x, e.z, e.dx, e.dz ], r );
		floats.set( [ e.length, e.width ], r + 4 ); map.set( [ e.b, e.reverse, e.a, e.signal + 1, e.kind === 'crossing' ? 1 : e.kind === 'bridge' ? 2 : 0, 0 ], r + 6 );

	}
	for ( const n of city.graph.nodes ) map.set( [ n.cluster, n.local, city.graph.clusters[ n.cluster ].length, city.routes.offsets[ n.cluster ] ], ( nodeBase + n.id ) * 4 );
	for ( const a of city.addresses ) {

		map.set( [ a.edge, a.anchor, city.graph.nodes[ a.anchor ].cluster, a.dwellSlots ], ( addressBase + a.id * 2 ) * 4 );
		floats.set( [ a.t, a.lateral, a.x, a.z ], ( addressBase + a.id * 2 + 1 ) * 4 );

	}
	for ( const s of city.signals ) map.set( [ s.offset, 0, 0, 0 ], ( signalBase + s.id ) * 4 );
	for ( const b of city.buildings ) floats.set( [ b.x0, b.z0, b.x1, b.z1 ], ( buildingBase + b.id ) * 4 );
	let index = 0;
	for ( let i = 0; i < cells.length; i ++ ) { map.set( [ index, cells[ i ].length, 0, 0 ], ( spatialBase + i ) * 4 ); index += cells[ i ].length; }
	map.set( indices, spatialIndexBase * 4 );
	const routes = new Uint32Array( city.routes.global.length + city.routes.local.length );
	routes.set( city.routes.global ); routes.set( city.routes.local, city.routes.global.length );
	return { map, routes, edgeBase, nodeBase, addressBase, signalBase, buildingBase, spatialBase, spatialIndexBase, localBase: city.routes.global.length, clusters: city.routes.clusters };

}
