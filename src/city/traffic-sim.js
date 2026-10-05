// Road-only traffic, shared by the renderer and headless geometry tests. Cars
// follow offset lanes and quadratic junction paths, never free-steering in XZ.
import { RNG } from '../game/core/rng.js';
import { laneGraph } from './lanes.js';

export const MAX_CARS = 524288;
export const CPU_CARS = 512;
export const CAR_WIDTH = 1.9, CAR_LENGTH = 3.8;
export const LANE = 1.4, JUNCTION = 4;
const GAP = CAR_LENGTH + 2;

export function carCount( count ) {

	return Number.isFinite( count ) ? Math.max( 0, Math.min( MAX_CARS, Math.floor( count ) ) ) : 128;

}

export function signalPhase( signal, time ) {

	return ( time + signal.offset ) % 28;

}

export function junctionPath( graph, incoming, outgoing ) {

	const a = graph.edges[ incoming ], b = graph.edges[ outgoing ], n = graph.nodes[ a.b ];
	const start = { x: n.x - a.dx * JUNCTION - a.dz * LANE, z: n.z - a.dz * JUNCTION + a.dx * LANE };
	const end = { x: n.x + b.dx * JUNCTION - b.dz * LANE, z: n.z + b.dz * JUNCTION + b.dx * LANE };
	const straight = a.dx === b.dx && a.dz === b.dz;
	const control = { x: n.x - ( a.dz + ( straight ? 0 : b.dz ) ) * LANE, z: n.z + ( a.dx + ( straight ? 0 : b.dx ) ) * LANE };
	const path = { start, control, end, outgoing, length: 0 };
	let previous = start;
	for ( let i = 1; i <= 16; i ++ ) {

		const point = junctionPose( path, i / 16 );
		path.length += Math.hypot( point.x - previous.x, point.z - previous.z ); previous = point;

	}
	return path;

}

export function junctionPose( path, t, target = {} ) {

	const { start: a, control: b, end: c } = path, u = 1 - t;
	target.x = u * u * a.x + 2 * u * t * b.x + t * t * c.x;
	target.z = u * u * a.z + 2 * u * t * b.z + t * t * c.z;
	target.heading = Math.atan2( u * ( b.x - a.x ) + t * ( c.x - b.x ), u * ( b.z - a.z ) + t * ( c.z - b.z ) );
	return target;

}

export class TrafficSimulation {

	constructor( city, count = 128 ) {

		this.city = city; this.graph = city.laneGraph || laneGraph( city ); this.time = 0;
		// Perimeter nodes have no asphalt beyond the map's outer street ends.
		// Prune dangling alley-entry fragments too, so no car needs a U-turn.
		const interior = ( n ) => n.x > city.xs[ 0 ] && n.x < city.xs[ 16 ] && n.z > city.zs[ 0 ] && n.z < city.zs[ 16 ];
		let edges = this.graph.edges.filter( ( e ) => e.kind !== 'alley' && interior( this.graph.nodes[ e.a ] ) && interior( this.graph.nodes[ e.b ] ) );
		for ( let previous = - 1; previous !== edges.length; ) {

			previous = edges.length;
			const degree = new Map();
			for ( const e of edges ) degree.set( e.a, ( degree.get( e.a ) || 0 ) + 1 );
			edges = edges.filter( ( e ) => degree.get( e.a ) > 1 && degree.get( e.b ) > 1 );

		}
		this.out = new Map(); this.junctions = new Map();
		for ( const e of edges ) {

			if ( ! this.out.has( e.a ) ) this.out.set( e.a, [] );
			this.out.get( e.a ).push( e.id );

		}
		this.spawnEdges = new RNG( city.seed ).fork( 'cars' ).shuffle( edges.slice() );
		this.setCount( count );

	}

	setCount( count ) {

		count = Math.min( CPU_CARS, carCount( count ) );
		if ( count === this.states?.length ) return;
		this.junctions.clear();
		this.states = Array.from( { length: Math.min( count, this.spawnEdges.length ) }, ( _, id ) => {

			const rng = new RNG( this.city.seed ).fork( `car-${id}` ), edge = this.spawnEdges[ id ];
			const state = { id, edge: edge.id, t: rng.range( JUNCTION + GAP, edge.length - JUNCTION - GAP ), speed: rng.range( 7, 11 ), rng, turn: null };
			state.next = this.nextEdge( state ); this.pose( state );
			return state;

		} );

	}

	nextEdge( state ) {

		const edge = this.graph.edges[ state.edge ];
		const options = this.out.get( edge.b ).filter( ( id ) => id !== edge.reverse );
		return state.rng.pick( options );

	}

	pose( state ) {

		if ( state.turn ) return junctionPose( state.turn, state.turn.distance / state.turn.length, state );
		const edge = this.graph.edges[ state.edge ], node = this.graph.nodes[ edge.a ];
		state.x = node.x + edge.dx * state.t - edge.dz * LANE;
		state.z = node.z + edge.dz * state.t + edge.dx * LANE;
		state.heading = Math.atan2( edge.dx, edge.dz );
		return state;

	}

	update( dt ) {

		if ( ! Number.isFinite( dt ) || dt <= 0 ) return;
		// Substeps preserve stop lines and following gaps even after a long frame.
		while ( dt > 1e-8 ) {

			const step = Math.min( dt, .05 ); this.time += step; dt -= step;
			this.step( step );

		}

	}

	step( dt ) {

		const lanes = new Map(), finished = new Set();
		for ( const state of this.states ) if ( ! state.turn ) {

			if ( ! lanes.has( state.edge ) ) lanes.set( state.edge, [] );
			lanes.get( state.edge ).push( state );

		}
		for ( const cars of lanes.values() ) cars.sort( ( a, b ) => b.t - a.t );
		for ( const state of this.states ) if ( state.turn ) {

			state.turn.distance = Math.min( state.turn.length, state.turn.distance + state.speed * dt );
			if ( state.turn.distance >= state.turn.length ) {

				this.junctions.delete( this.graph.edges[ state.edge ].b );
				state.edge = state.turn.outgoing; state.t = JUNCTION; state.turn = null; state.next = this.nextEdge( state );
				finished.add( state.id );
				if ( ! lanes.has( state.edge ) ) lanes.set( state.edge, [] );
				lanes.get( state.edge ).push( state );

			}

		}
		for ( const cars of lanes.values() ) {

			for ( let i = 0; i < cars.length; i ++ ) {

				const state = cars[ i ], edge = this.graph.edges[ state.edge ], node = this.graph.nodes[ edge.b ];
				// A car that just left a turn has already used this substep.
				if ( finished.has( state.id ) ) continue;
				let distance = state.speed * dt;
				if ( i ) distance = Math.min( distance, Math.max( 0, cars[ i - 1 ].t - state.t - GAP ) );
				state.t = Math.min( edge.length - JUNCTION, state.t + distance );
				if ( state.t < edge.length - JUNCTION || this.junctions.has( edge.b ) ) continue;
				const phase = node.signal < 0 ? 0 : signalPhase( this.city.signals[ node.signal ], this.time );
				const green = node.signal < 0 || ( edge.dx ? phase < 12 : phase >= 14 && phase < 26 );
				if ( ! green || lanes.get( state.next )?.some( ( other ) => other.t < JUNCTION + GAP ) ) continue;
				state.turn = { ...junctionPath( this.graph, state.edge, state.next ), distance: 0 };
				this.junctions.set( edge.b, state.id );

			}

		}
		for ( const state of this.states ) this.pose( state );

	}

}

// Dense GPU road table: origin/direction, length/exit-count/signal, then up to
// three legal successors. No per-car objects or route arrays are needed.
export function packTrafficRoads( city ) {

	const reference = new TrafficSimulation( city, 0 ), edges = reference.spawnEdges;
	const ids = new Map( edges.map( ( e, i ) => [ e.id, i ] ) ), data = new Float32Array( edges.length * 12 );
	for ( const [ i, e ] of edges.entries() ) {

		const a = reference.graph.nodes[ e.a ], b = reference.graph.nodes[ e.b ];
		const exits = reference.out.get( e.b ).filter( ( id ) => id !== e.reverse ).map( ( id ) => ids.get( id ) );
		data.set( [ a.x, a.z, e.dx, e.dz, e.length, exits.length, b.signal < 0 ? 0 : city.signals[ b.signal ].offset, b.signal < 0 ? 0 : 1, ...exits ], i * 12 );

	}
	return { data, edges, graph: reference.graph };

}
