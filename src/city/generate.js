// Road-first rectangular subdivision. One authoritative layout supplies meshes,
// collision, addresses and pedestrian paths; geometry never invents connectivity.
import { RNG, hashStr } from '../game/core/rng.js';
import { cityConfig, CITY_VERSION } from './config.js';
import { rect, area, projectEdge } from './geometry.js';
import { addNode, addConnection, buildRoutes } from './navigation.js';
import { assignPopulation } from './population.js';
import { validateCity } from './validate.js';
import { buildSurface } from './surface.js';
import { laneGraph } from './lanes.js';

const DISTRICT_NAMES = [ 'Garden Ward', 'Westgate', 'University', 'Northbank', 'Maple Quarter', 'Civic Quarter', 'Market Ward', 'Eastbank', 'Old Town', 'Midtown', 'Financial Ward', 'Foundry', 'South Gardens', 'Station Ward', 'Harbor Quarter', 'Works District' ];
const SERVICES = [ [ 'town-hall', 6, 7 ], [ 'hospital', 11, 6 ], [ 'school', 3, 4 ], [ 'school', 12, 11 ], [ 'fire-station', 5, 10 ], [ 'police-station', 10, 5 ], [ 'market', 6, 8 ], [ 'transit-terminal', 7, 11 ], [ 'utility-yard', 14, 13 ] ];

function axes( rng ) {

	const lines = [ - 1000, 1000 ];
	while ( lines.length < 17 ) {

		let index = 0;
		for ( let i = 1; i < lines.length - 1; i ++ ) if ( lines[ i + 1 ] - lines[ i ] > lines[ index + 1 ] - lines[ index ] ) index = i;
		const split = Math.round( ( lines[ index ] + ( lines[ index + 1 ] - lines[ index ] ) * rng.range( 0.46, 0.54 ) ) / 4 ) * 4;
		lines.splice( index + 1, 0, split );

	}
	return lines;

}

function generateStreets( city ) {

	const { xs, zs, halves, config } = city, graph = city.graph, corners = [];
	const width = config.sidewalk;
	for ( let j = 0; j <= 16; j ++ ) {

		corners[ j ] = [];
		for ( let i = 0; i <= 16; i ++ ) {

			const ox = halves[ i ] + width / 2, oz = halves[ j ] + width / 2;
			const ids = [ [ - 1, - 1 ], [ 1, - 1 ], [ 1, 1 ], [ - 1, 1 ] ].map( ( [ x, z ] ) => addNode( graph, xs[ i ] + x * ox, zs[ j ] + z * oz ) );
			corners[ j ][ i ] = ids;
			for ( let c = 0; c < 4; c ++ ) addConnection( graph, ids[ c ], ids[ ( c + 1 ) % 4 ], width, 'crossing', j * 17 + i );
			city.signals.push( { id: j * 17 + i, x: xs[ i ], z: zs[ j ], offset: ( i * 7 + j * 11 ) % 12 } );

		}

	}
	city.blockEdges = [];
	city.roads = [];
	for ( let j = 0; j <= 16; j ++ ) {

		for ( let i = 0; i < 16; i ++ ) {

			const bridge = i === config.riverColumn;
			if ( bridge && ! city.bridgeRows.includes( j ) ) continue;
			const a = corners[ j ][ i ], b = corners[ j ][ i + 1 ];
			const north = addConnection( graph, a[ 1 ], b[ 0 ], width, bridge ? 'bridge' : 'sidewalk' );
			const south = addConnection( graph, a[ 2 ], b[ 3 ], width, bridge ? 'bridge' : 'sidewalk' );
			city.roads.push( { ...rect( xs[ i ], zs[ j ] - halves[ j ], xs[ i + 1 ], zs[ j ] + halves[ j ] ), axis: 'x', bridge, i, j } );
			city.blockEdges.push( { axis: 'x', i, j, north, south } );

		}

	}
	for ( let i = 0; i <= 16; i ++ ) {

		for ( let j = 0; j < 16; j ++ ) {

			const a = corners[ j ][ i ], b = corners[ j + 1 ][ i ];
			const west = addConnection( graph, a[ 3 ], b[ 0 ], width );
			const east = addConnection( graph, a[ 2 ], b[ 1 ], width );
			city.roads.push( { ...rect( xs[ i ] - halves[ i ], zs[ j ], xs[ i ] + halves[ i ], zs[ j + 1 ] ), axis: 'z', bridge: false, i, j } );
			city.blockEdges.push( { axis: 'z', i, j, west, east } );

		}

	}
	city.corners = corners;

}

function buildLot( city, block, lot, side, edgeId, rng, service = null ) {

	const id = city.buildings.length;
	const inset = rng.range( 1.2, 3 );
	const footprint = rect( lot.x0 + inset, lot.z0 + inset, lot.x1 - inset, lot.z1 - inset );
	const d = Math.hypot( ( footprint.x0 + footprint.x1 ) / 2, ( footprint.z0 + footprint.z1 ) / 2 );
	let type = service || block.zone;
	const residential = type === 'residential' || type === 'apartments' || type === 'mixed';
	const floors = service ? rng.int( 2, 5 ) : type === 'downtown' ? rng.int( 12, 35 ) : type === 'apartments' || type === 'mixed' ? rng.int( 5, 12 ) : type === 'industrial' ? rng.int( 1, 3 ) : rng.int( 2, 4 );
	if ( ! service && d < 520 && type === 'residential' ) type = 'apartments';
	const homeCapacity = residential ? Math.floor( area( footprint ) * floors / 22 ) : 0;
	const jobCapacity = type === 'residential' ? Math.floor( area( footprint ) / 16 ) : Math.floor( area( footprint ) * floors / ( type === 'industrial' ? 18 : 12 ) );
	const edge = city.graph.edges[ edgeId ];
	const cx = ( footprint.x0 + footprint.x1 ) / 2, cz = ( footprint.z0 + footprint.z1 ) / 2;
	const point = projectEdge( edge, cx, cz );
	const t = Math.max( 5, Math.min( edge.length - 5, point.t ) );
	const address = { id, building: id, edge: edgeId, anchor: edge.a, t, lateral: Math.sign( point.lateral ) * ( edge.width / 2 - 0.65 ), x: edge.x + edge.dx * t, z: edge.z + edge.dz * t, dwellSlots: 16, side };
	city.lots.push( { id, block: block.id, side, ...lot } );
	city.buildings.push( { id, block: block.id, district: block.district, type, name: service ? service.replaceAll( '-', ' ' ) : `${city.districts[ block.district ].name} ${id + 1}`, ...footprint, height: floors * 3.2, floors, homeCapacity, jobCapacity, address: id, palette: rng.int( 0, 7 ), side, landmark: !! service } );
	city.addresses.push( address );
	if ( service ) city.serviceSites.push( { type: service, building: id, address: id } );

}

function fillBlocks( city, rng ) {

	const { xs, zs, halves, config } = city, margin = config.sidewalk;
	const edgeAt = ( axis, i, j, side ) => city.blockEdges.find( ( e ) => e.axis === axis && e.i === i && e.j === j )?.[ side ];
	const parks = new Set();
	for ( let dz = 0; dz < 4; dz ++ ) for ( let dx = 0; dx < 4; dx ++ ) {

		const j = dz * 4 + 2;
		let i = dx * 4 + 1;
		while ( i === config.riverColumn || city.serviceReservations.some( ( [ , x, z ] ) => x === i && z === j ) ) i ++;
		parks.add( `${i},${j}` );

	}
	parks.add( `${city.squareCell[ 0 ]},${city.squareCell[ 1 ]}` ); parks.add( '2,12' ); parks.add( '3,12' ); parks.add( '2,13' ); parks.add( '3,13' );
	for ( let j = 0; j < 16; j ++ ) {

		for ( let i = 0; i < 16; i ++ ) {

			const district = Math.floor( i / 4 ) + Math.floor( j / 4 ) * 4;
			const r = rect( xs[ i ] + halves[ i ] + margin, zs[ j ] + halves[ j ] + margin, xs[ i + 1 ] - halves[ i + 1 ] - margin, zs[ j + 1 ] - halves[ j + 1 ] - margin );
			const centerDistance = Math.hypot( ( r.x0 + r.x1 ) / 2, ( r.z0 + r.z1 ) / 2 );
			let zone = centerDistance < 400 ? 'downtown' : centerDistance < 720 ? 'mixed' : 'residential';
			if ( i >= 12 && j >= 9 ) zone = 'industrial';
			if ( centerDistance < 600 && ( i + j ) % 3 === 0 ) zone = 'apartments';
			const block = { id: city.blocks.length, i, j, district, zone, ...r };
			city.blocks.push( block );
			if ( i === config.riverColumn ) { block.zone = 'waterfront'; continue; }
			const service = city.serviceReservations.find( ( [ , x, z ] ) => x === i && z === j );
			if ( parks.has( `${i},${j}` ) && ! service ) {

				block.zone = i === city.squareCell[ 0 ] && j === city.squareCell[ 1 ] ? 'square' : 'park';
				city.parks.push( block );
				const center = addNode( city.graph, ( r.x0 + r.x1 ) / 2, ( r.z0 + r.z1 ) / 2 );
				block.centerNode = center;
				for ( const n of [ city.corners[ j ][ i ][ 2 ], city.corners[ j ][ i + 1 ][ 3 ], city.corners[ j + 1 ][ i ][ 1 ], city.corners[ j + 1 ][ i + 1 ][ 0 ] ] ) addConnection( city.graph, center, n, 8, 'park' );
				continue;

			}
			const depth = Math.min( 25, ( r.x1 - r.x0 ) * 0.28, ( r.z1 - r.z0 ) * 0.28 );
			const bands = [
				[ 'north', rect( r.x0, r.z0, r.x1, r.z0 + depth ), edgeAt( 'x', i, j, 'south' ), true ],
				[ 'south', rect( r.x0, r.z1 - depth, r.x1, r.z1 ), edgeAt( 'x', i, j + 1, 'north' ), true ],
				[ 'west', rect( r.x0, r.z0 + depth, r.x0 + depth, r.z1 - depth ), edgeAt( 'z', i, j, 'east' ), false ],
				[ 'east', rect( r.x1 - depth, r.z0 + depth, r.x1, r.z1 - depth ), edgeAt( 'z', i + 1, j, 'west' ), false ]
			];
			let servicePlaced = false;
			for ( const [ side, band, edge, horizontal ] of bands ) {

				if ( edge === undefined ) continue;
				const length = horizontal ? band.x1 - band.x0 : band.z1 - band.z0;
				const n = Math.max( 1, Math.floor( length / rng.range( 14, 19 ) ) );
				const alley = side === 'north' && ! service && block.zone !== 'residential' && ( i + j ) % 4 === 0 && n >= 2;
				const opening = Math.floor( n / 2 );
				for ( let p = 0; p < n; p ++ ) {

					const lot = horizontal ? rect( band.x0 + p * length / n, band.z0, band.x0 + ( p + 1 ) * length / n, band.z1 ) : rect( band.x0, band.z0 + p * length / n, band.x1, band.z0 + ( p + 1 ) * length / n );
					if ( alley && p === opening - 1 ) lot.x1 -= 3;
					if ( alley && p === opening ) lot.x0 += 3;
					buildLot( city, block, lot, side, edge, rng, service && ! servicePlaced ? service[ 0 ] : null );
					servicePlaced = servicePlaced || !! service;

				}
				if ( alley ) {

					const x = band.x0 + opening * length / n, z = ( block.z0 + block.z1 ) / 2, street = city.graph.edges[ edge ];
					const entrance = addNode( city.graph, x, street.z ), yard = addNode( city.graph, x, z );
					addConnection( city.graph, street.a, entrance, config.sidewalk );
					const path = addConnection( city.graph, entrance, yard, 5.2, 'alley' );
					const road = { ...rect( x - 3, zs[ j ], x + 3, z ), axis: 'z', kind: 'alley', i, j, block: block.id, edge: path, entranceX: x, entranceZ: zs[ j ], endX: x, endZ: z };
					city.roads.push( road ); city.alleys.push( road );

				}

			}

		}

	}

}

function decorate( city, rng ) {

	for ( const e of city.graph.edges ) {

		if ( e.id % 2 || e.kind === 'crossing' ) continue;
		const side = e.kind === 'sidewalk' || e.kind === 'bridge' ? Math.abs( e.dx ) > .5 ? e.id % 4 ? 1 : - 1 : e.id % 4 ? - 1 : 1 : e.id % 4 ? - 1 : 1;
		for ( let t = 12; t < e.length - 12; t += 28 ) {

			const x = e.x + e.dx * t - e.dz * side * ( e.width / 2 + 0.6 ), z = e.z + e.dz * t + e.dx * side * ( e.width / 2 + 0.6 );
			city.props.push( { type: 'lamp', x, z, height: 4, edge: e.id } );
			if ( rng.next() < city.config.decoration * 0.55 ) city.props.push( { type: 'tree', x: x + e.dx * 4, z: z + e.dz * 4, height: rng.range( 3.2, 5 ), edge: e.id } );

		}

	}
	for ( const p of city.parks ) {

		const x = ( p.x0 + p.x1 ) / 2, z = ( p.z0 + p.z1 ) / 2;
		for ( const [ dx, dz ] of [ [ - 18, 0 ], [ 18, 0 ], [ 0, 18 ], [ 0, - 18 ] ] ) {

			city.props.push( { type: 'bench', x: x + dx, z: z + dz, height: 0.5 } );
			city.props.push( { type: 'bin', x: x + dx + 2, z: z + dz, height: 0.9 } );

		}
		city.transitStops.push( { id: city.transitStops.length, district: p.district, x: p.x0 + 16, z: p.z0 + .4 } );
		city.props.push( { type: 'transit-stop', x: p.x0 + 16, z: p.z0 + .4, height: 2.2 } );

	}
	for ( const signal of city.signals ) {

		const i = signal.id % 17, j = Math.floor( signal.id / 17 );
		city.props.push( { type: 'signal-post', x: signal.x + city.halves[ i ] + city.config.sidewalk + .4, z: signal.z - city.halves[ j ] - city.config.sidewalk / 2, height: 3.2 } );
		city.props.push( { type: 'signal-post', x: signal.x - city.halves[ i ] - city.config.sidewalk / 2, z: signal.z + city.halves[ j ] + city.config.sidewalk + .4, height: 3.2 } );

	}
	for ( const block of city.blocks ) if ( block.zone === 'industrial' ) {

		const x = ( block.x0 + block.x1 ) / 2, z = ( block.z0 + block.z1 ) / 2;
		city.props.push( { type: 'parked-car', x: x - 3, z, height: 1.2 }, { type: 'parked-car', x: x + 3, z, height: 1.2 } );

	}

}

function publicAddresses( city ) {

	city.leisureAddresses = city.buildings.filter( ( b ) => [ 'mixed', 'downtown', 'market' ].includes( b.type ) ).map( ( b ) => b.address );
	for ( const park of city.parks ) {

		const edge = city.graph.edges[ city.graph.nodes[ park.centerNode ].out[ 0 ] ], id = city.addresses.length, t = Math.min( 12, edge.length / 3 );
		city.addresses.push( { id, building: - 1, name: `${city.districts[ park.district ].name} ${park.zone}`, edge: edge.id, anchor: edge.a, t, lateral: 3, x: edge.x + edge.dx * t, z: edge.z + edge.dz * t, dwellSlots: 16, side: 'park' } );
		city.leisureAddresses.push( id ); park.address = id;

	}

}

function* citySteps( input = {} ) {

	const config = cityConfig( input ), rng = new RNG( config.seed );
	const city = {
		version: CITY_VERSION, seed: config.seed, config, bounds: rect( - 1024, - 1024, 1024, 1024 ),
		xs: axes( rng.fork( 'roads-x' ) ), zs: axes( rng.fork( 'roads-z' ) ), halves: Array.from( { length: 17 }, ( _, i ) => i % 4 === 0 ? 7 : 4 ),
		bridgeRows: [ 3, 8, 13 ], districts: DISTRICT_NAMES.map( ( name, id ) => ( { id, name } ) ),
		graph: { nodes: [], edges: [], clusters: [] }, roads: [], alleys: [], blocks: [], lots: [], buildings: [], addresses: [], serviceSites: [], parks: [], props: [], signals: [], transitStops: []
	};
	const col = config.riverColumn;
	city.squareCell = [ col - 1, 7 ];
	city.serviceReservations = SERVICES.map( ( [ type, i, j ] ) => [ type, type === 'town-hall' ? col - 2 : i === col ? i + 1 : i, j ] );
	const civicDistrict = Math.floor( ( col - 1 ) / 4 ) + 4;
	if ( civicDistrict !== 5 ) [ city.districts[ civicDistrict ].name, city.districts[ 5 ].name ] = [ city.districts[ 5 ].name, city.districts[ civicDistrict ].name ];
	city.water = rect( city.xs[ col ] + city.halves[ col ] + config.sidewalk + 4, - 1024, city.xs[ col + 1 ] - city.halves[ col + 1 ] - config.sidewalk - 4, 1024 );
	yield [ 'Streets and bridges', 0.1 ]; generateStreets( city );
	yield [ 'Neighborhoods and addresses', 0.25 ]; fillBlocks( city, rng.fork( 'lots' ) ); publicAddresses( city ); city.laneGraph = laneGraph( city );
	city.layoutHash = hashStr( JSON.stringify( [ CITY_VERSION, config.seed, config.sidewalk, config.riverColumn, city.xs, city.zs, city.buildings, city.graph.nodes, city.graph.edges ] ) ).toString( 16 );
	yield [ 'Shared pedestrian routes', 0.45 ]; city.routes = buildRoutes( city.graph );
	yield [ 'Public space', 0.7 ]; decorate( city, rng.fork( 'props' ) ); city.surface = buildSurface( city );
	city.heroSpawn = { x: city.xs[ col - 1 ] + city.halves[ col - 1 ] + config.sidewalk / 2, z: city.zs[ 7 ] + 35 };
	yield [ 'Population assignments', 0.8 ]; city.population = assignPopulation( city, config.population );
	yield [ 'Validation', 0.95 ]; city.validation = validateCity( city );
	if ( ! city.validation.ok ) throw new Error( city.validation.errors.slice( 0, 8 ).join( '; ' ) );
	delete city.corners; delete city.blockEdges;
	yield [ 'Ready', 1 ];
	return city;

}

export function generateCity( input = {}, onProgress = () => {} ) {

	const steps = citySteps( input );
	while ( true ) {

		const result = steps.next();
		if ( result.done ) return result.value;
		onProgress( ...result.value );

	}

}

export async function generateCityAsync( input = {}, onProgress = () => {}, canceled = () => false ) {

	const steps = citySteps( input );
	while ( true ) {

		if ( canceled() ) throw new Error( 'Generation superseded' );
		const result = steps.next();
		if ( result.done ) return result.value;
		onProgress( ...result.value );
		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

	}

}
