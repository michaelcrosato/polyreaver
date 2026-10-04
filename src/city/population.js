// Persistent integer identities and capacity-weighted assignment. Sampling a
// population never depends on the current camera or on a runtime GPU readback.
import { RNG } from '../game/core/rng.js';
import { NO_EDGE } from './config.js';

function prefix( items, weight ) {

	let total = 0;
	const ends = items.map( ( item ) => ( total += weight( item ) ) );
	return { ends, total };

}

function ticket( p, t ) {

	let lo = 0, hi = p.ends.length - 1;
	while ( lo < hi ) {

		const mid = ( lo + hi ) >> 1;
		if ( t < p.ends[ mid ] ) hi = mid; else lo = mid + 1;

	}
	return lo;

}

function gcd( a, b ) {

	while ( b ) [ a, b ] = [ b, a % b ];
	return a;

}

export function assignPopulation( city, count ) {

	const capacity = 2 ** Math.ceil( Math.log2( Math.max( 64, count + 1 ) ) );
	const homes = prefix( city.buildings, ( b ) => b.homeCapacity );
	const jobs = prefix( city.buildings, ( b ) => b.jobCapacity );
	if ( homes.total < count || jobs.total < count ) throw new Error( `Insufficient capacity: homes ${homes.total}, activities ${jobs.total}, citizens ${count}` );
	const streets = city.graph.edges.filter( ( e ) => e.id % 2 === 0 && e.kind !== 'crossing' );
	const streetWeights = prefix( streets, ( e ) => e.length * ( e.width - 2 ) );
	const rng = new RNG( city.seed ).fork( 'population' );
	const render = new Float32Array( capacity * 4 ), sim = new Float32Array( capacity * 4 ), anim = new Float32Array( capacity * 4 );
	const nav = new Uint32Array( capacity * 4 ).fill( NO_EDGE ), identity = new Uint32Array( capacity * 4 );
	let multiplier = 7919;
	while ( gcd( multiplier, count ) !== 1 ) multiplier += 2;
	const offset = rng.int( 0, count - 1 );
	for ( let i = 1; i <= count; i ++ ) {

		const home = ticket( homes, Math.floor( ( i - 1 ) * homes.total / count ) );
		const permutation = ( ( i - 1 ) * multiplier + offset ) % count;
		const work = ticket( jobs, Math.floor( permutation * jobs.total / count ) );
		const leisure = city.leisureAddresses[ ( i * 683 + offset ) % city.leisureAddresses.length ];
		const phase = i % 3, target = [ home, work, leisure ][ phase ];
		let e = streets[ ticket( streetWeights, rng.next() * streetWeights.total ) ];
		if ( rng.next() < 0.5 ) e = city.graph.edges[ e.reverse ];
		const t = rng.range( 1, e.length - 1 ), lateral = rng.range( - Math.min( 2.8, e.width / 2 - 1 ), Math.min( 2.8, e.width / 2 - 1 ) );
		const heading = ( Math.atan2( e.dx, e.dz ) + Math.PI * 2 ) % ( Math.PI * 2 );
		const seed = i % 4095 + 1;
		const bend = Math.min( 1, t / 8, ( e.length - t ) / 8 );
		render.set( [ e.x + e.dx * t - e.dz * lateral * bend, rng.next() * Math.PI * 2, e.z + e.dz * t + e.dx * lateral * bend, 1 + Math.floor( heading / ( Math.PI * 2 ) * 256 ) * 8 + seed * 2048 ], i * 4 );
		sim.set( [ t, lateral, 0, heading ], i * 4 );
		anim.set( [ 1, 1, render[ i * 4 + 1 ], i ], i * 4 );
		nav.set( [ e.id, target, phase, 0 ], i * 4 );
		identity.set( [ home, work, leisure, i ], i * 4 );

	}
	render[ 0 ] = city.heroSpawn.x; render[ 2 ] = city.heroSpawn.z;
	anim.set( [ 0, 1, 0, 0 ], 0 ); nav.set( [ 0, 0, 0, 0 ], 0 );
	return { count, capacity, homes: homes.total, jobs: jobs.total, render, sim, anim, nav, identity };

}
