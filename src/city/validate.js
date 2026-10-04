// Source geometry and graph invariants. Tests additionally use independent route
// solvers and all-agent checks, rather than trusting this validator alone.
import { inside, overlaps, contains, edgeContains, makeSpatialIndex } from './geometry.js';
import { NO_EDGE } from './config.js';

export function validateCity( city, { allCitizens = false } = {} ) {

	const errors = [], graph = city.graph;
	const check = ( condition, message ) => { if ( ! condition ) errors.push( message ); };
	const seen = new Set( [ 0 ] ), queue = [ 0 ];
	for ( let i = 0; i < queue.length; i ++ ) for ( const id of graph.nodes[ queue[ i ] ].out ) {

		const b = graph.edges[ id ].b;
		if ( ! seen.has( b ) ) { seen.add( b ); queue.push( b ); }

	}
	check( seen.size === graph.nodes.length, 'Disconnected pedestrian network' );
	check( graph.clusters.length <= 32 && graph.clusters.every( ( c ) => c.length <= 256 ), 'Routing cluster limit exceeded' );
	check( city.roads.filter( ( r ) => r.bridge ).length >= 2, 'Two bridge links required' );
	check( city.parks.some( ( p ) => p.zone === 'square' ), 'Missing central square' );
	check( city.alleys.length > 0, 'Missing service alleys' );
	check( city.serviceSites.filter( ( s ) => s.type === 'school' ).length >= 2, 'Two schools required' );
	for ( const type of [ 'town-hall', 'hospital', 'school', 'fire-station', 'police-station', 'market', 'transit-terminal', 'utility-yard' ] ) check( city.serviceSites.some( ( s ) => s.type === type ), `Missing service ${type}` );
	for ( const district of city.districts ) {

		check( city.parks.some( ( p ) => p.district === district.id ), `Missing park in district ${district.id}` );
		check( city.transitStops.some( ( s ) => s.district === district.id ), `Missing transit stop in district ${district.id}` );

	}
	const index = makeSpatialIndex( city.buildings );
	for ( const b of city.buildings ) {

		check( inside( b, city.lots[ b.id ] ), `Building ${b.id} outside lot` );
		check( ! overlaps( b, city.water ), `Building ${b.id} in water` );
		const candidates = new Set();
		for ( let z = Math.floor( b.z0 / 64 ); z <= Math.floor( b.z1 / 64 ); z ++ ) for ( let x = Math.floor( b.x0 / 64 ); x <= Math.floor( b.x1 / 64 ); x ++ ) for ( const id of index.cells.get( `${x},${z}` ) || [] ) candidates.add( id );
		for ( const id of candidates ) if ( id > b.id ) check( ! overlaps( b, city.buildings[ id ] ), `Overlapping buildings ${b.id}/${id}` );
		for ( const r of city.roads ) check( ! overlaps( b, r ), `Building ${b.id} intersects road` );
		const a = city.addresses[ b.address ], e = graph.edges[ a.edge ];
		check( seen.has( a.anchor ) && e.a === a.anchor && a.t > 0 && a.t < e.length, `Unreachable address ${a.id}` );
		check( edgeContains( e, a.x - e.dz * a.lateral, a.z + e.dx * a.lateral ), `Address ${a.id} outside sidewalk` );

	}
	for ( const n of graph.nodes ) {

		check( seen.has( n.id ), `Unreachable junction ${n.id}` );
		for ( let c = 0; c < graph.clusters.length; c ++ ) {

			const id = city.routes.global[ n.id * graph.clusters.length + c ];
			check( n.cluster === c ? id === NO_EDGE : graph.edges[ id ]?.a === n.id, `Invalid global route ${n.id}/${c}` );

		}

	}
	for ( const a of city.addresses ) {

		const e = graph.edges[ a.edge ];
		check( seen.has( a.anchor ) && e.a === a.anchor && a.t > 2 && a.t < e.length - 2, `Invalid public or building address ${a.id}` );
		check( edgeContains( e, a.x - e.dz * a.lateral, a.z + e.dx * a.lateral ), `Address clearance ${a.id}` );

	}
	const laneSeen = new Set( [ 0 ] ), laneQueue = [ 0 ];
	for ( let i = 0; i < laneQueue.length; i ++ ) for ( const id of city.laneGraph.nodes[ laneQueue[ i ] ].out ) {

		const b = city.laneGraph.edges[ id ].b;
		if ( ! laneSeen.has( b ) ) { laneSeen.add( b ); laneQueue.push( b ); }

	}
	check( laneSeen.size === city.laneGraph.nodes.length, 'Disconnected vehicle lane network' );
	const p = city.population;
	check( p.homes >= p.count && p.jobs >= p.count, 'Population capacity insufficient' );
	check( p.capacity >= p.count + 1, 'Population buffers too small' );
	check( city.surface.walkableArea >= p.count / 0.35, 'Insufficient legal pedestrian area' );
	const stride = allCitizens ? 1 : Math.max( 1, Math.floor( p.count / 1000 ) );
	for ( let i = 1; i <= p.count; i += stride ) {

		const x = p.render[ i * 4 ], z = p.render[ i * 4 + 2 ], e = graph.edges[ p.nav[ i * 4 ] ];
		check( Number.isFinite( x ) && Number.isFinite( z ) && contains( city.bounds, x, z ), `Invalid citizen ${i}` );
		check( edgeContains( e, x, z ), `Citizen ${i} outside its corridor` );
		check( ! contains( city.water, x, z ) || e.kind === 'bridge', `Citizen ${i} in water` );
		check( p.identity[ i * 4 ] < city.addresses.length && p.identity[ i * 4 + 1 ] < city.addresses.length, `Invalid identity ${i}` );

	}
	return { ok: errors.length === 0, errors, buildings: city.buildings.length, citizens: p.count, activeAgents: p.count + 1, nodes: graph.nodes.length, edges: graph.edges.length, clusters: graph.clusters.length, walkableArea: city.surface.walkableArea, populationDensity: p.count / city.surface.walkableArea, homes: p.homes, jobs: p.jobs, routeBytes: city.routes.bytes };

}
