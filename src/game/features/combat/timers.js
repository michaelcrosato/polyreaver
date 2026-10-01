// Delayed simulation callbacks: aftershocks, spell echoes, staggered bursts, stun
// immunity windows. They live in world.state so they die with the world (no leaks
// into the next level) and run in sim time, so hitstop, pause and game speed affect
// them exactly like everything else. The runner is the 'combat-timers' system.

export function schedule( world, delay, fn ) {

	const list = world.state.combatTimers || ( world.state.combatTimers = [] );
	list.push( { at: world.time + Math.max( 0, delay ), fn } );

}

export function runTimers( world ) {

	const list = world.state.combatTimers;
	if ( ! list || ! list.length ) return;
	const due = [];
	for ( let i = list.length - 1; i >= 0; i -- ) {

		if ( list[ i ].at <= world.time ) {

			due.push( list[ i ] );
			list.splice( i, 1 );

		}

	}

	for ( let i = due.length - 1; i >= 0; i -- ) due[ i ].fn( world );

}
