// Sample the actual game and attribute swarm self time by source phase, plus
// inclusive helper costs. No per-agent timer instrumentation distorts the loop.
import { Session } from 'node:inspector';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Game } from '../src/game/sim-entry.js';

const option = ( name, fallback ) => {

	const i = process.argv.indexOf( name );
	return i < 0 ? fallback : process.argv[ i + 1 ];

};
const depth = Number( option( '--depth', 25 ) ), seconds = Number( option( '--seconds', 240 ) );
const output = resolve( option( '--out', 'artifacts/performance/game' ) );
const seed = option( '--seed', `sim:${depth}` );
if ( ! Number.isInteger( depth ) || depth < 1 || ! Number.isFinite( seconds ) || seconds <= 0 ) throw new Error( 'Use positive depth/seconds.' );
const source = readFileSync( 'src/game/features/world/mechanics/swarm.js', 'utf8' ).split( '\n' );
const line = ( text ) => {

	const i = source.findIndex( ( l ) => l.includes( text ) );
	if ( i < 0 ) throw new Error( 'Profile phase marker missing: ' + text );
	return i + 1;

};
const phases = [ [ 'flow refresh', line( '// flow field toward' ) ], [ 'hive brood', line( '// hives brood' ) ],
	[ 'grid rebuild / proximity', line( '// grid for separation' ) ], [ 'mechanic fields', line( '// what the other mechanics' ) ],
	[ 'chase steering', line( 'let wx = 0' ) ], [ 'dormant orbit', line( '// lazy orbit' ) ],
	[ 'neighbor separation', line( '// separation from neighbours' ) ], [ 'velocity steering', line( '// steer' ) ],
	[ 'wall movement', line( '// move with per-axis' ) ], [ 'damage / rewards', line( '// nibbles' ) ] ];
const game = new Game( { seed, headless: true } );
game.save.level = Math.max( 1, depth * 2 - 1 ); game.applyPlayerStats();
const world = game.enterLevel( depth ); game.api( 'player.kit', { level: game.save.level } );
const bot = game.api( 'bot.create', {} );
const session = new Session(); session.connect();
const post = ( name, args = {} ) => new Promise( ( done, fail ) => session.post( name, args, ( error, result ) => error ? fail( error ) : done( result ) ) );
await post( 'Profiler.enable' ); await post( 'Profiler.setSamplingInterval', { interval: 500 } ); await post( 'Profiler.start' );
let frames = 0;
const start = performance.now();
while ( frames < seconds * 60 && world.player.alive && ! world.state.complete ) {

	bot.step( 1 / 60 ); game.update( 1 / 60 ); frames ++;

}
const elapsedMs = performance.now() - start;
const { profile } = await post( 'Profiler.stop' ); session.disconnect();
const samples = profile.samples || [], ids = new Map( profile.nodes.map( ( n ) => [ n.id, n ] ) );
const self = new Map();
for ( const id of samples ) self.set( id, ( self.get( id ) || 0 ) + 1 );
const swarm = profile.nodes.filter( ( n ) => n.callFrame.functionName === 'update' && n.callFrame.url.endsWith( '/swarm.js' ) );
const phaseTicks = Object.fromEntries( phases.map( ( [ name ] ) => [ name, 0 ] ) );
for ( const node of swarm ) for ( const tick of node.positionTicks || [] ) {

	const phase = phases.findLast( ( [ , first ] ) => tick.line >= first );
	if ( phase ) phaseTicks[ phase[ 0 ] ] += tick.ticks;

}
const descendants = new Set();
function collect( id ) {

	if ( descendants.has( id ) ) return;
	descendants.add( id );
	for ( const child of ids.get( id )?.children || [] ) collect( child );

}
swarm.forEach( ( n ) => collect( n.id ) );
const helpers = [ 'fieldAt', 'flowDir', 'buildGrid', 'buildFlow', 'hasLineOfSight', 'tileAt', 'cellIndex', 'passable' ].map( ( name ) => {

	let inclusive = 0;
	for ( const node of profile.nodes ) if ( descendants.has( node.id ) && node.callFrame.functionName === name ) {

		const tree = new Set();
		const visit = ( id ) => { tree.add( id ); for ( const child of ids.get( id )?.children || [] ) visit( child ); };
		visit( node.id );
		inclusive += [ ...tree ].reduce( ( total, id ) => total + ( self.get( id ) || 0 ), 0 );

	}
	return { name, inclusiveSamples: inclusive, totalCpuPercent: +( inclusive / samples.length * 100 ).toFixed( 2 ) };

} );
const swarmSelf = swarm.reduce( ( sum, n ) => sum + ( self.get( n.id ) || 0 ), 0 );
const summary = { seed, depth, requestedSeconds: seconds, simSeconds: frames / 60, elapsedMs, complete: !! world.state.complete,
	samples: samples.length, swarmSelfSamples: swarmSelf, swarmInclusiveSamples: [ ...descendants ].reduce( ( sum, id ) => sum + ( self.get( id ) || 0 ), 0 ),
	phaseSelfSamples: phaseTicks, helpers,
	note: 'Sampled CPU attribution, not browser/GPU timing. Phase ticks are self-time; helper inclusive rows can overlap.' };
mkdirSync( dirname( output ), { recursive: true } );
writeFileSync( output + '.cpuprofile', JSON.stringify( profile ) );
writeFileSync( output + '.json', JSON.stringify( summary, null, 2 ) + '\n' );
console.log( JSON.stringify( summary, null, 2 ) );
