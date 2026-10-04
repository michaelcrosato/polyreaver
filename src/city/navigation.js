// Shared next-edge tables: global multi-source routes toward connected clusters,
// then exact shortest paths within the destination cluster. No per-citizen A*.
import { NO_EDGE } from './config.js';

class MinHeap {

	constructor() { this.items = []; }
	push( node, cost ) {

		const a = this.items;
		let i = a.length;
		a.push( [ node, cost ] );
		while ( i > 0 ) {

			const p = ( i - 1 ) >> 1;
			if ( a[ p ][ 1 ] <= cost ) break;
			a[ i ] = a[ p ]; i = p;

		}
		a[ i ] = [ node, cost ];

	}
	pop() {

		const a = this.items, first = a[ 0 ], last = a.pop();
		if ( a.length ) {

			let i = 0;
			while ( i * 2 + 1 < a.length ) {

				let child = i * 2 + 1;
				if ( child + 1 < a.length && a[ child + 1 ][ 1 ] < a[ child ][ 1 ] ) child ++;
				if ( a[ child ][ 1 ] >= last[ 1 ] ) break;
				a[ i ] = a[ child ]; i = child;

			}
			a[ i ] = last;

		}
		return first;

	}

}

export function addNode( graph, x, z ) {

	const id = graph.nodes.length;
	graph.nodes.push( { id, x, z, out: [], cluster: - 1, local: - 1 } );
	return id;

}

export function addConnection( graph, a, b, width, kind = 'sidewalk', signal = - 1 ) {

	const p = graph.nodes[ a ], q = graph.nodes[ b ];
	const length = Math.hypot( q.x - p.x, q.z - p.z );
	if ( length < 0.1 ) throw new Error( 'Zero length navigation edge' );
	const id = graph.edges.length;
	graph.edges.push( { id, a, b, x: p.x, z: p.z, dx: ( q.x - p.x ) / length, dz: ( q.z - p.z ) / length, length, width, kind, signal, reverse: id + 1 } );
	graph.edges.push( { id: id + 1, a: b, b: a, x: q.x, z: q.z, dx: ( p.x - q.x ) / length, dz: ( p.z - q.z ) / length, length, width, kind, signal, reverse: id } );
	p.out.push( id ); q.out.push( id + 1 );
	return id;

}

// Connected flood fills restricted to a spatial tile, with a hard node bound.
export function partitionGraph( graph ) {

	const clusters = [];
	const tile = ( n ) => `${Math.floor( ( n.x + 1024 ) / 512 )},${Math.floor( ( n.z + 1024 ) / 512 )}`;
	for ( const n of graph.nodes ) {

		if ( n.cluster !== - 1 ) continue;
		const id = clusters.length, members = [ n.id ];
		n.cluster = id;
		for ( let head = 0; head < members.length; head ++ ) {

			for ( const edgeId of graph.nodes[ members[ head ] ].out ) {

				const q = graph.nodes[ graph.edges[ edgeId ].b ];
				if ( q.cluster !== - 1 || tile( q ) !== tile( n ) || members.length >= 256 ) continue;
				q.cluster = id; members.push( q.id );

			}

		}
		members.forEach( ( node, local ) => { graph.nodes[ node ].local = local; } );
		clusters.push( members );

	}
	if ( clusters.length > 32 || graph.nodes.length > 8192 ) throw new Error( `Navigation resource limit: ${clusters.length} clusters, ${graph.nodes.length} nodes` );
	graph.clusters = clusters;
	return clusters;

}

export function distancesTo( graph, sources, cluster = - 1 ) {

	const distance = new Float64Array( graph.nodes.length ).fill( Infinity );
	const next = new Uint32Array( graph.nodes.length ).fill( NO_EDGE );
	const heap = new MinHeap();
	for ( const s of sources ) { distance[ s ] = 0; heap.push( s, 0 ); }
	while ( heap.items.length ) {

		const [ node, cost ] = heap.pop();
		if ( cost !== distance[ node ] ) continue;
		for ( const edgeId of graph.nodes[ node ].out ) {

			const incoming = graph.edges[ graph.edges[ edgeId ].reverse ];
			if ( cluster >= 0 && graph.nodes[ incoming.a ].cluster !== cluster ) continue;
			const d = cost + incoming.length;
			if ( d < distance[ incoming.a ] ) {

				distance[ incoming.a ] = d;
				next[ incoming.a ] = incoming.id;
				heap.push( incoming.a, d );

			}

		}

	}
	return { distance, next };

}

export function buildRoutes( graph ) {

	const clusters = partitionGraph( graph ), n = graph.nodes.length, k = clusters.length;
	const global = new Uint32Array( n * k );
	const offsets = new Uint32Array( k );
	let count = 0;
	for ( let c = 0; c < k; c ++ ) { offsets[ c ] = count; count += clusters[ c ].length ** 2; }
	const local = new Uint32Array( count ).fill( NO_EDGE );
	for ( let c = 0; c < k; c ++ ) {

		const routed = distancesTo( graph, clusters[ c ] );
		for ( let v = 0; v < n; v ++ ) global[ v * k + c ] = routed.next[ v ];
		const nodes = clusters[ c ], size = nodes.length;
		for ( let target = 0; target < size; target ++ ) {

			const r = distancesTo( graph, [ nodes[ target ] ], c );
			for ( let source = 0; source < size; source ++ ) local[ offsets[ c ] + source * size + target ] = r.next[ nodes[ source ] ];

		}

	}
	return { global, local, offsets, clusters: k, bytes: global.byteLength + local.byteLength + offsets.byteLength };

}

export function nextEdge( graph, routes, source, destination ) {

	if ( source === destination ) return NO_EDGE;
	const a = graph.nodes[ source ], b = graph.nodes[ destination ];
	if ( a.cluster !== b.cluster ) return routes.global[ source * routes.clusters + b.cluster ];
	return routes.local[ routes.offsets[ a.cluster ] + a.local * graph.clusters[ a.cluster ].length + b.local ];

}

export function referenceRoute( graph, routes, source, destination ) {

	const edges = [];
	for ( let i = 0; i <= graph.nodes.length; i ++ ) {

		if ( source === destination ) return edges;
		const id = nextEdge( graph, routes, source, destination );
		if ( id === NO_EDGE || graph.edges[ id ]?.a !== source ) throw new Error( `Unreachable route ${source} to ${destination}` );
		edges.push( id ); source = graph.edges[ id ].b;

	}
	throw new Error( 'Navigation route cycle' );

}
