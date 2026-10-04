// Deterministic seed corpus, independent routing reference, capacity and geometry
// invariants. No browser or GPU is required for these generation tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateCity, generateCityAsync } from '../src/city/generate.js';
import { cityConfig, NO_EDGE } from '../src/city/config.js';
import { validateCity } from '../src/city/validate.js';
import { addNode, addConnection, buildRoutes, nextEdge, referenceRoute } from '../src/city/navigation.js';
import { contains, overlaps, edgeContains, makeSpatialIndex } from '../src/city/geometry.js';
import { packCity } from '../src/city/packing.js';
import { CityCollision } from '../src/city/player.js';

function independentDistance( graph, source, destination, cluster = - 1 ) {

	// Deliberately different O(V²) forward Dijkstra, used only on small fixtures.
	const distances = new Array( graph.nodes.length ).fill( Infinity ), done = new Set();
	distances[ source ] = 0;
	while ( done.size < graph.nodes.length ) {

		let a = - 1;
		for ( let i = 0; i < distances.length; i ++ ) if ( ! done.has( i ) && ( a < 0 || distances[ i ] < distances[ a ] ) ) a = i;
		if ( a < 0 || ! Number.isFinite( distances[ a ] ) ) break;
		if ( a === destination ) return distances[ a ];
		done.add( a );
		for ( const id of graph.nodes[ a ].out ) {

			const e = graph.edges[ id ];
			if ( cluster >= 0 && graph.nodes[ e.b ].cluster !== cluster ) continue;
			distances[ e.b ] = Math.min( distances[ e.b ], distances[ a ] + e.length );

		}

	}
	return distances[ destination ];

}

test( 'city parameters fail before allocations', () => {

	for ( const config of [ { population: NaN }, { population: 100001 }, { population: 0 }, { size: 500 }, { sidewalk: 2 }, { riverColumn: 20 }, { decoration: Infinity } ] ) assert.throws( () => cityConfig( config ) );
	assert.equal( cityConfig( { population: 1 } ).population, 1 );

} );

test( 'routing agrees with independent shortest paths and crosses separated clusters', () => {

	const graph = { nodes: [], edges: [], clusters: [] };
	for ( let z = 0; z < 6; z ++ ) for ( let x = 0; x < 6; x ++ ) addNode( graph, x * 180 - 450, z * 180 - 450 );
	for ( let z = 0; z < 6; z ++ ) for ( let x = 0; x < 6; x ++ ) {

		const a = z * 6 + x;
		if ( x < 5 && ( x !== 2 || z === 1 || z === 4 ) ) addConnection( graph, a, a + 1, 8 );
		if ( z < 5 ) addConnection( graph, a, a + 6, 8 );

	}
	const routes = buildRoutes( graph );
	for ( let a = 0; a < 36; a ++ ) for ( let b = 0; b < 36; b ++ ) {

		const path = referenceRoute( graph, routes, a, b );
		assert.equal( a === b ? NO_EDGE : path[ 0 ], nextEdge( graph, routes, a, b ) );
		if ( graph.nodes[ a ].cluster === graph.nodes[ b ].cluster ) {

			const distance = path.reduce( ( total, id ) => total + graph.edges[ id ].length, 0 );
			assert.ok( Math.abs( distance - independentDistance( graph, a, b, graph.nodes[ a ].cluster ) ) < 1e-6 );

		}

	}

} );

test( 'seed corpus generates reachable cities with full 100K capacity', () => {

	let minimumBuildings = Infinity, maximumTime = 0;
	for ( let i = 0; i < 50; i ++ ) {

		const started = performance.now();
		const city = generateCity( { seed: `city-corpus-${i}`, riverColumn: 5 + i % 6, sidewalk: i % 5 === 0 ? 8 : 10 } );
		const result = validateCity( city, { allCitizens: true } );
		assert.ok( result.ok, result.errors.slice( 0, 5 ).join( '; ' ) );
		assert.equal( city.population.count + 1, 100001 );
		assert.equal( city.population.capacity, 131072 );
		assert.ok( city.buildings.length >= 3000 && city.buildings.length <= 6000, `Building count ${city.buildings.length}` );
		minimumBuildings = Math.min( minimumBuildings, city.buildings.length );
		for ( let p = 0; p < 40; p ++ ) {

			const a = ( p * 31 + i ) % city.graph.nodes.length, b = ( p * 53 + 87 ) % city.graph.nodes.length;
			assert.ok( referenceRoute( city.graph, city.routes, a, b ).length <= city.graph.nodes.length );

		}
		maximumTime = Math.max( maximumTime, performance.now() - started );

	}
	console.log( `50 seeds: minimum ${minimumBuildings} buildings, slowest generation + full population validation ${maximumTime.toFixed( 0 )} ms` );

} );

test( 'same seed reproduces layout, addresses and population; decoration preserves them', () => {

	const a = generateCity( { population: 10000 } ), b = generateCity( { population: 10000 } ), c = generateCity( { population: 10000, decoration: 0 } );
	assert.equal( a.layoutHash, b.layoutHash ); assert.equal( a.layoutHash, c.layoutHash );
	assert.deepEqual( a.addresses, c.addresses ); assert.deepEqual( a.routes.global, b.routes.global );
	assert.deepEqual( a.population.identity, c.population.identity ); assert.deepEqual( a.population.render, c.population.render );
	assert.notEqual( a.props.length, c.props.length );
	assert.notEqual( a.layoutHash, generateCity( { seed: 'another-city', population: 1 } ).layoutHash );

} );

test( 'all assignments respect capacities; all citizen positions avoid buildings', () => {

	const city = generateCity(), p = city.population;
	const home = new Uint32Array( city.buildings.length ), work = new Uint32Array( city.buildings.length );
	const index = makeSpatialIndex( city.buildings );
	for ( let i = 1; i <= p.count; i ++ ) {

		home[ p.identity[ i * 4 ] ] ++; work[ p.identity[ i * 4 + 1 ] ] ++;
		const x = p.render[ i * 4 ], z = p.render[ i * 4 + 2 ];
		for ( const id of index.cells.get( `${Math.floor( x / 64 )},${Math.floor( z / 64 )}` ) || [] ) assert.ok( ! contains( city.buildings[ id ], x, z, - 0.28 ), `Citizen ${i} inside building ${id}` );

	}
	for ( const b of city.buildings ) { assert.ok( home[ b.id ] <= b.homeCapacity ); assert.ok( work[ b.id ] <= b.jobCapacity ); }
	for ( let i = p.count + 1; i < p.capacity; i ++ ) assert.equal( p.nav[ i * 4 ], NO_EDGE );

} );

test( 'walk corridors, crossings and decorations leave building and water clearance', () => {

	const city = generateCity( { population: 1000 } ), index = makeSpatialIndex( city.buildings );
	for ( const e of city.graph.edges ) {

		if ( e.id % 2 ) continue;
		for ( let step = 0; step <= Math.ceil( e.length / 3 ); step ++ ) {

			const t = e.length * step / Math.ceil( e.length / 3 );
			for ( const lateral of [ - e.width / 2 + 0.3, 0, e.width / 2 - 0.3 ] ) {

				const x = e.x + e.dx * t - e.dz * lateral, z = e.z + e.dz * t + e.dx * lateral;
				assert.ok( edgeContains( e, x, z ) );
				assert.ok( ! contains( city.water, x, z ) || e.kind === 'bridge' );
				for ( const id of index.cells.get( `${Math.floor( x / 64 )},${Math.floor( z / 64 )}` ) || [] ) assert.ok( ! contains( city.buildings[ id ], x, z, - 0.28 ), `Corridor ${e.id} intersects building ${id}` );

			}

		}

	}
	for ( const b of city.buildings ) assert.ok( ! overlaps( b, city.water ) );

} );

test( 'GPU map packing preserves integer IDs, float geometry and spatial records', () => {

	const city = generateCity( { population: 100 } ), packed = packCity( city ), floats = new Float32Array( packed.map.buffer );
	for ( const e of city.graph.edges ) {

		assert.equal( packed.map[ e.id * 12 + 6 ], e.b ); assert.equal( packed.map[ e.id * 12 + 7 ], e.reverse );
		assert.ok( Math.abs( floats[ e.id * 12 ] - e.x ) < 1e-4 ); assert.ok( Math.abs( floats[ e.id * 12 + 4 ] - e.length ) < 1e-4 );

	}
	for ( const a of city.addresses ) assert.equal( packed.map[ ( packed.addressBase + a.id * 2 ) * 4 ], a.edge );
	assert.deepEqual( packed.routes.slice( 0, city.routes.global.length ), city.routes.global );
	for ( const b of city.buildings ) {

		const x = Math.floor( ( ( b.x0 + b.x1 ) / 2 + 1024 ) / 64 ), z = Math.floor( ( ( b.z0 + b.z1 ) / 2 + 1024 ) / 64 );
		const row = ( packed.spatialBase + z * 32 + x ) * 4, offset = packed.map[ row ], count = packed.map[ row + 1 ];
		assert.ok( packed.map.slice( packed.spatialIndexBase * 4 + offset, packed.spatialIndexBase * 4 + offset + count ).includes( b.id ) );

	}

} );

test( 'cooperative fallback matches worker generation and honors cancellation', async () => {

	const settings = { seed: 'cooperative', population: 100 }, progress = [];
	const async = await generateCityAsync( settings, ( step ) => progress.push( step ) );
	assert.equal( async.layoutHash, generateCity( settings ).layoutHash ); assert.ok( progress.length >= 6 );
	let canceled = false;
	await assert.rejects( generateCityAsync( settings, () => { canceled = true; }, () => canceled ), /superseded/ );

} );

test( 'swept player collision prevents wall and bank tunneling while bridges remain open', () => {

	const city = generateCity( { population: 100 } ), collision = new CityCollision( city );
	const building = city.buildings[ 0 ], x = ( building.x0 + building.x1 ) / 2, z = ( building.z0 + building.z1 ) / 2;
	const p = { x: building.x0 - 2, z };
	collision.move( p, building.x1 - building.x0 + 5, 0 ); assert.ok( p.x < building.x0 - .3 );
	const q = { x, z: building.z0 - 2 };
	collision.move( q, 0, building.z1 - building.z0 + 5 ); assert.ok( q.z < building.z0 - .3 );
	const bank = { x: city.water.x0 - 2, z: city.zs[ 7 ] };
	collision.move( bank, city.water.x1 - city.water.x0 + 5, 0 ); assert.ok( bank.x < city.water.x0 - .3 );
	const bridge = { x: city.water.x0 - 1, z: city.zs[ city.bridgeRows[ 0 ] ] };
	collision.move( bridge, city.water.x1 - city.water.x0 + 2, 0 ); assert.ok( bridge.x > city.water.x1 );

} );
