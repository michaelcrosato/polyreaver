// Packs: monsters that spawned together think together. A pack shares aggro (hit
// one, the whole pack turns), hands out SURROUND SLOTS (each member approaches the
// target from its own angle, so packs encircle instead of queueing) and can patrol
// as a group behind a leader. Pure data on world.state.packs.

let nextPack = 1;

export function makePack( world, members, { kind = 'squad', leader = members[ 0 ], x, z } = {} ) {

	const pack = { id: nextPack ++, kind, members: [], leader, alerted: false, x: x ?? leader?.x ?? 0, z: z ?? leader?.z ?? 0 };
	( world.state.packs || ( world.state.packs = [] ) ).push( pack );
	for ( const m of members ) joinPack( pack, m );
	return pack;

}

export function joinPack( pack, e ) {

	if ( ! e || pack.members.includes( e ) ) return;
	pack.members.push( e );
	e.data.pack = pack;
	spreadSlots( pack );

}

// Surround slots: members get evenly spread angles (radians, relative to the
// line from the target to the pack) - ±0.6 rad per member, so 5 wolves cover a
// half circle and a big pack closes the ring.
export function spreadSlots( pack ) {

	const n = pack.members.length;
	pack.members.forEach( ( m, i ) => {

		m.data.slot = n > 1 ? ( i - ( n - 1 ) / 2 ) * Math.min( 0.6, Math.PI * 1.6 / n ) : 0;

	} );

}

export function liveMembers( pack ) {

	return pack ? pack.members.filter( ( m ) => m.alive ) : [];

}
