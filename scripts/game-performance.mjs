// Compare the optimized CPU paths against a git revision with the same current
// combat/collision rules. Wall time is diagnostic, never a CI pass/fail threshold.
// node scripts/game-performance.mjs --base-ref 0fd607c --seconds 45 --runs 3
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { Game } from '../src/game/sim-entry.js';
import { SpatialHash } from '../src/game/core/spatial.js';
import { get, define } from '../src/game/core/registry.js';
import { RNG } from '../src/game/core/rng.js';

const option = ( name, fallback ) => {

	const i = process.argv.indexOf( name );
	return i < 0 ? fallback : process.argv[ i + 1 ];

};
const base = option( '--base-ref', '0fd607c' );
const seconds = Number( option( '--seconds', 45 ) ), runs = Number( option( '--runs', 3 ) );
if ( ! Number.isFinite( seconds ) || seconds <= 0 || ! Number.isInteger( runs ) || runs < 1 ) throw new Error( 'Positive seconds and integer runs required.' );

async function originalModule( file ) {

	const source = execFileSync( 'git', [ 'show', `${base}:${file}` ], { encoding: 'utf8' } ).replace( /from '([^']+)'/g, ( text, specifier ) => specifier.startsWith( '.' ) ? `from '${pathToFileURL( resolve( dirname( file ), specifier ) ).href}'` : text );
	return import( 'data:text/javascript;base64,' + Buffer.from( source ).toString( 'base64' ) );

}

const oldSpatial = ( await originalModule( 'src/game/core/spatial.js' ) ).SpatialHash;
const optimizedSwarm = get( 'mechanic', 'swarm' );
await originalModule( 'src/game/features/world/mechanics/swarm.js' );
const originalSwarm = get( 'mechanic', 'swarm' );
define( 'mechanic', optimizedSwarm );

function spatialRun( Type ) {

	const rng = new RNG( 'spatial-perf' );
	const entities = Array.from( { length: 1000 }, ( _, id ) => ( { id, alive: true, x: rng.range( - 50, 50 ), z: rng.range( - 50, 50 ), radius: rng.range( 0.2, 0.6 ) } ) );
	const points = Array.from( { length: 10000 }, () => [ rng.range( - 50, 50 ), rng.range( - 50, 50 ) ] );
	const hash = new Type();
	let sum = 0;
	const t0 = performance.now();
	for ( let frame = 0; frame < 10; frame ++ ) {

		hash.rebuild( entities );
		for ( const [ x, z ] of points ) sum += hash.nearest( x, z, 5 )?.id || 0;

	}
	return { ms: performance.now() - t0, sum };

}

function swarmRun( def ) {

	define( 'mechanic', def );
	const game = new Game( { seed: 'cpu-comparison:10', headless: true } );
	game.save.level = 19;
	game.applyPlayerStats();
	const world = game.enterLevel( 10 );
	game.api( 'player.kit', { level: 19 } );
	const bot = game.api( 'bot.create', {} );
	let swarmMs = 0;
	const ctx = world.state.mech.swarm;
	ctx.def = { ...ctx.def, update( w, dt, c ) {

		const start = performance.now();
		def.update( w, dt, c );
		swarmMs += performance.now() - start;

	} };
	const start = performance.now();
	for ( let frame = 0; frame < Math.ceil( seconds * 60 ); frame ++ ) {

		bot.step( 1 / 60 );
		game.update( 1 / 60 );

	}
	const ms = performance.now() - start;
	const state = ctx.state, hash = createHash( 'sha256' );
	for ( const key of [ 'x', 'z', 'vx', 'vz', 'alive', 'awake', 'flow' ] ) hash.update( Buffer.from( state[ key ].buffer ) );
	hash.update( JSON.stringify( { stats: world.stats, life: world.player.life, mana: world.player.mana, shield: world.player.shield, living: state.living, kills: state.kills, biting: state.biting, level: game.save.level, xp: game.save.xp } ) );
	return { ms, swarmMs, hash: hash.digest( 'hex' ) };

}

// Warm both implementations before measuring, and alternate order across runs.
spatialRun( oldSpatial ); spatialRun( SpatialHash );
swarmRun( originalSwarm ); swarmRun( optimizedSwarm );
const measurements = [];
for ( let i = 0; i < runs; i ++ ) {

	const order = i % 2 ? [ true, false ] : [ false, true ];
	const pair = {};
	for ( const optimized of order ) pair[ optimized ? 'optimized' : 'baseline' ] = {
		spatial: spatialRun( optimized ? SpatialHash : oldSpatial ), swarm: swarmRun( optimized ? optimizedSwarm : originalSwarm )
	};
	assert.equal( pair.optimized.spatial.sum, pair.baseline.spatial.sum, 'spatial nearest results must agree' );
	assert.equal( pair.optimized.swarm.hash, pair.baseline.swarm.hash, 'seeded swarm state and combat outcomes must agree' );
	measurements.push( pair );

}
define( 'mechanic', optimizedSwarm );
const median = ( values ) => values.sort( ( a, b ) => a - b )[ Math.floor( values.length / 2 ) ];
const summary = {};
for ( const [ name, read ] of [ [ 'spatialNearest', ( r ) => r.spatial.ms ], [ 'swarmUpdate', ( r ) => r.swarm.swarmMs ], [ 'gameSimulation', ( r ) => r.swarm.ms ] ] ) {

	const before = median( measurements.map( ( r ) => read( r.baseline ) ) ), after = median( measurements.map( ( r ) => read( r.optimized ) ) );
	summary[ name ] = { baselineMs: +before.toFixed( 2 ), optimizedMs: +after.toFixed( 2 ), reductionPercent: +( ( 1 - after / before ) * 100 ).toFixed( 1 ) };

}
console.log( JSON.stringify( { base, seconds, runs, identicalResults: true, summary, measurements }, null, 2 ) );
