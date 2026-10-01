// Summoned minions rise out of the ground (anim state 'spawn' for 0.6 s) instead of
// popping in: the core anim-state pass shows 'spawn' while data.spawnUntil is ahead.

import { define } from '../../core/registry.js';

define( 'worldHook', { id: 'monsters-rise', order: 60, onWorld( game, world ) {

	world.events.on( 'summon', ( { minions } ) => {

		for ( const m of minions || [] ) {

			if ( ! m?.data ) continue;
			m.data.spawnTime = world.time;
			m.data.spawnUntil = world.time + 0.6;

		}

	} );

} } );
