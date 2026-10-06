import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game/sim-entry.js';

test( 'an ashling exactly on the player remains finite and can bite', () => {

	const game = new Game( { seed: 'coincident-ashling', headless: true } );
	const world = game.enterLevel( 10 ), ctx = world.state.mech.swarm, st = ctx.state;
	const i = st.alive.findIndex( ( v ) => v === 1 );
	assert.ok( i >= 0 );
	world.player.x = st.x[ i ]; world.player.z = st.z[ i ];
	st.awake[ i ] = 1;
	ctx.def.update( world, 1 / 60, ctx );
	assert.ok( st.biting > 0 );
	for ( const key of [ 'x', 'z', 'vx', 'vz' ] ) for ( let j = 0; j < st.used; j ++ ) assert.ok( Number.isFinite( st[ key ][ j ] ), `${key}[${j}]` );

} );
