import { buildWalkMap } from '../src/city/walk-map.js';
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
import { TrafficSimulation, junctionPath, junctionPose, CAR_WIDTH, CAR_LENGTH, MAX_CARS, carCount, packTrafficRoads } from '../src/city/traffic-sim.js';

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


test( 'stress-test walk atlas projects every cell to safe ground without agent buffers', () => {

	const city = generateCity( { seed: 'stress-walk-map', population: 1 } );
	const map = buildWalkMap( city.surface ), { size, data } = map;
	assert.equal( data.byteLength, size * size * 4 ); assert.ok( map.safeCells > 10000 );
	for ( let i = 0; i < size * size; i ++ ) {

		const x = data[ i * 4 ] + data[ i * 4 + 1 ] * 256, z = data[ i * 4 + 2 ] + data[ i * 4 + 3 ] * 256;
		assert.ok( x > 0 && z > 0 && x < size - 1 && z < size - 1 );
		assert.equal( city.surface.data[ ( z * size + x ) * 4 + 1 ], 1 );
		const n = ( z * size + x ) * 4;
		assert.deepEqual( data.subarray( n, n + 4 ), data.subarray( i * 4, i * 4 + 4 ) );

	}
	assert.throws( () => buildWalkMap( { size: 4, data: new Uint8Array( 64 ) } ), /no safe walking surface/ );

} );

function roadFootprint( city ) {

	const roads = city.roads.filter( ( r ) => r.kind !== 'alley' ), index = makeSpatialIndex( roads, 32 );
	return ( pose ) => {

		const sin = Math.sin( pose.heading ), cos = Math.cos( pose.heading );
		// Corners, edge midpoints and the center check the body, not just its root.
		for ( const x of [ - CAR_WIDTH / 2, 0, CAR_WIDTH / 2 ] ) for ( const z of [ - CAR_LENGTH / 2, 0, CAR_LENGTH / 2 ] ) {

			const px = pose.x + x * cos + z * sin, pz = pose.z - x * sin + z * cos;
			const candidates = index.cells.get( `${Math.floor( px / 32 )},${Math.floor( pz / 32 )}` ) || [];
			assert.ok( candidates.some( ( id ) => contains( roads[ id ], px, pz ) ), `Car footprint off road at ${px},${pz}` );

		}

	};

}

test( 'every car turn stays on road including canal junctions across city seeds', () => {

	for ( let seed = 0; seed < 3; seed ++ ) {

		const city = generateCity( { seed: `car-roads-${seed}`, riverColumn: [ 5, 8, 10 ][ seed ], population: 1 } );
		const sim = new TrafficSimulation( city, 512 ), onRoad = roadFootprint( city );
		for ( const edge of sim.spawnEdges ) {

			const options = sim.out.get( edge.b ).filter( ( id ) => id !== edge.reverse );
			assert.ok( options.length > 0, 'No dead ends or forced U-turns' );
			for ( const id of options ) {

				const path = junctionPath( sim.graph, edge.id, id );
				for ( let i = 0; i <= 32; i ++ ) onRoad( junctionPose( path, i / 32 ) );

			}

		}
		for ( const state of sim.states ) onRoad( state );
		for ( let step = 0; step < 300; step ++ ) {

			sim.update( step % 23 === 0 ? .7 : .1 );
			for ( const state of sim.states ) onRoad( state );

		}

	}

} );

test( 'cars stop on red, maintain following gaps, and proceed through a green junction', () => {

	const city = generateCity( { seed: 'traffic-lights', population: 1 } ), sim = new TrafficSimulation( city, 2 );
	const edge = sim.spawnEdges.find( ( e ) => e.dx === 1 && sim.graph.nodes[ e.b ].signal >= 0 );
	const node = sim.graph.nodes[ edge.b ], signal = city.signals[ node.signal ];
	for ( const [ i, state ] of sim.states.entries() ) {

		state.edge = edge.id; state.t = edge.length - 4 - i * 10; state.next = sim.nextEdge( state ); state.speed = 10;

	}
	sim.time = 16 - signal.offset; sim.update( 2 );
	assert.equal( sim.states[ 0 ].t, edge.length - 4 );
	assert.equal( sim.states[ 0 ].turn, null );
	assert.ok( sim.states[ 0 ].t - sim.states[ 1 ].t >= CAR_LENGTH + 1.99 );
	sim.time = 28 - signal.offset; sim.update( .1 );
	assert.ok( sim.states[ 0 ].turn );
	assert.equal( sim.states[ 1 ].turn, null );
	assert.equal( sim.junctions.get( edge.b ), 0 );
	const destination = sim.states[ 0 ].next;
	sim.update( 2 );
	assert.equal( sim.states[ 0 ].edge, destination );
	assert.ok( sim.states[ 0 ].t > 4 );

} );

test( 'car count is bounded, spawns deterministically, and zero time leaves traffic still', () => {

	const city = generateCity( { population: 1 } ), a = new TrafficSimulation( city ), b = new TrafficSimulation( city );
	assert.deepEqual( a.states, b.states );
	const poses = a.states.map( ( s ) => [ s.x, s.z, s.heading ] );
	a.update( 0 ); a.update( - 1 ); a.update( NaN );
	assert.deepEqual( a.states.map( ( s ) => [ s.x, s.z, s.heading ] ), poses );
	a.setCount( 0 ); assert.equal( a.states.length, 0 ); a.update( 1 );
	a.setCount( 128 ); assert.deepEqual( a.states.map( ( s ) => [ s.x, s.z, s.heading ] ), poses );
	a.setCount( 1000000 ); assert.equal( a.states.length, 512 );
	assert.equal( new Set( a.states.map( ( s ) => s.edge ) ).size, a.states.length );
	assert.equal( carCount( 524288 ), MAX_CARS ); assert.equal( carCount( 1000000 ), MAX_CARS );
	assert.equal( carCount( - 1 ), 0 ); assert.equal( carCount( NaN ), 128 );

} );

test( 'GPU road table preserves every legal lane and junction without per-car route allocations', () => {

	const city = generateCity( { population: 1 } ), { data, edges, graph } = packTrafficRoads( city );
	assert.ok( data.byteLength < 65536 );
	for ( const [ i, edge ] of edges.entries() ) {

		const row = i * 12, start = graph.nodes[ edge.a ], end = graph.nodes[ edge.b ];
		assert.deepEqual( [ ...data.slice( row, row + 4 ) ], [ start.x, start.z, edge.dx, edge.dz ].map( Math.fround ) );
		assert.equal( data[ row + 4 ], Math.fround( edge.length ) );
		assert.ok( data[ row + 5 ] > 0 && data[ row + 5 ] <= 3 );
		assert.equal( data[ row + 7 ], end.signal < 0 ? 0 : 1 );
		for ( let exit = 0; exit < data[ row + 5 ]; exit ++ ) {

			const next = edges[ data[ row + 8 + exit ] ];
			assert.equal( next.a, edge.b ); assert.notEqual( next.id, edge.reverse ); assert.notEqual( next.kind, 'alley' );

		}

	}

} );
