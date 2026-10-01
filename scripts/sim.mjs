// Headless Polyreaver: runs the real game simulation in Node (no browser, no GPU).
// The quickest way for a person or an AI agent to check balance, find crashes and
// measure a build: seeds make every run reproducible.
//
//   node scripts/sim.mjs                      depth 1, 60 s, default bot
//   node scripts/sim.mjs --depth 1-12         each depth in turn
//   node scripts/sim.mjs --depth 5 --seconds 120 --seed abc --json
//
// The tools feature registers a smarter bot (api 'bot.run'); without it this
// script uses a simple chase-swing-dodge loop.

import { Game } from '../src/game/sim-entry.js';

const argv = process.argv.slice( 2 );
const opt = ( n, d ) => {

	const i = argv.indexOf( n );
	return i < 0 ? d : argv[ i + 1 ];

};

const [ d0, d1 ] = String( opt( '--depth', '1' ) ).split( '-' ).map( Number );
const seconds = + opt( '--seconds', 60 );
const seed = opt( '--seed', 'sim' );
const asJson = argv.includes( '--json' );

function simpleBot( game, dt ) {

	const w = game.world, p = w.player, inp = game.input;
	const foes = w.entities.filter( ( e ) => e.alive && e.team === 1 && e.kind !== 'prop' );
	inp.held.clear();
	if ( ! foes.length || ! p.alive ) {

		inp.move.x = inp.move.z = 0;
		return;

	}

	const f = foes.reduce( ( a, b ) => ( p.distTo( a ) < p.distTo( b ) ? a : b ) );
	const d = p.distTo( f );
	inp.move.x = d > 2.2 ? ( f.x - p.x ) / d : 0; inp.move.z = d > 2.2 ? ( f.z - p.z ) / d : 0;
	inp.aim.x = f.x; inp.aim.z = f.z;
	if ( d < 3 ) inp.held.add( 'attack' );
	if ( p.lifeFrac < 0.4 && w.frame % 45 === 0 ) inp.pressed.add( 'dodge' );

}

const results = [];
for ( let depth = d0; depth <= ( d1 || d0 ); depth ++ ) {

	const game = new Game( { seed: `${seed}:${depth}`, headless: true } );
	game.save.level = Math.max( 1, depth * 2 - 1 );
	game.applyPlayerStats();
	const world = game.enterLevel( depth );
	const t0 = performance.now();
	const bot = game.api?.( 'bot.create', {} );
	let t = 0;
	const dt = 1 / 60;
	while ( t < seconds ) {

		if ( bot?.step ) bot.step( dt ); else simpleBot( game, dt );
		game.update( dt );
		t += dt;
		if ( ! world.player.alive ) break;
		if ( world.state.complete ) break;

	}

	const s = world.describe();
	results.push( {
		depth, name: s.spec?.name, areaLevel: s.level, playerLevel: game.save.level, simSeconds: +t.toFixed( 1 ),
		realMs: Math.round( performance.now() - t0 ), kills: s.stats.kills, deaths: s.stats.deaths,
		dps: Math.round( s.stats.damageDealt / Math.max( 1, t ) ), damageTaken: Math.round( s.stats.damageTaken ),
		alive: s.entities, complete: !! world.state.complete
	} );

}

if ( asJson ) console.log( JSON.stringify( results, null, 2 ) );
else console.table( results );
