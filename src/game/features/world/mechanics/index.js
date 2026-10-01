// Mechanics runtime. A LEVEL MECHANIC is a registry def:
//
//   define( 'mechanic', {
//     id, name, desc, tip,              one-line description + the objective/tip shown on entry
//     tags, theme, depth,               home theme and campaign depth (where it debuts)
//     words: { adj: [], noun: [] },     for generated level names ( "Molten" + "Kegs" )
//     combinesWith: [ ids ],            pairs that make good combinations (endless picker weights)
//     conflicts: [ ids ],               pairs that must never share a level
//     decorate( L, rng, ctx )           layout time: mark tiles, add props / regions ( gen/finish.js )
//     setup( game, world, ctx )         world start: create entities, listen to events
//     preMove( world, dt, ctx )         order 45 - before movement (traction, steering hints)
//     postMove( world, dt, ctx )        order 55 - after movement (teleports, slides, recording)
//     postEffects( world, dt, ctx )     order 62 - after projectiles/areas moved (warp projectiles)
//     update( world, dt, ctx )          order 85 - the mechanic's main tick
//     field( world, ctx, x, z, out )    what it does to a point (see kit.fieldAt)
//     describe( world, ctx ) -> JSON    state for the agent API / inspectors
//   } )
//
// ctx = { id, def, intensity, rng, state, game, world } - one per active mechanic in a
// world, at world.state.mech[ id ]; presentation code (client) reads ctx.state.
// INTENSITY is 1 where a mechanic debuts and grows with depth: more objects,
// shorter cycles, stronger effects - so a mechanic stays relevant 200 levels later.

import { define, get } from '../../../core/registry.js';

export function mechanicCtx( world, id ) {

	return world.state.mech?.[ id ] || null;

}

define( 'worldHook', { id: 'world-mechanics', order: 30, onWorld( game, world ) {

	world.state.mechanics = [];
	world.state.mech = {};
	// Trigger props (kegs, braziers, pylons, wells, shrines) never die from hits:
	// being struck is an input. Restore their life and call their hook.
	world.events.on( 'hit', ( h ) => {

		const t = h.target;
		if ( ! t?.data?.onStruck ) return;
		if ( t.kind === 'prop' ) t.life = t.maxLife;
		t.data.onStruck( world, t, h );

	} );
	if ( world.kind !== 'level' ) return;
	for ( const id of world.spec?.mechanics || [] ) {

		const def = get( 'mechanic', id );
		if ( ! def ) continue;
		const ctx = { id, def, intensity: world.spec.intensity?.[ id ] ?? 1, rng: world.rng.fork( 'mech:' + id ), state: {}, game, world };
		world.state.mechanics.push( ctx );
		world.state.mech[ id ] = ctx;

	}

	for ( const ctx of world.state.mechanics ) ctx.def.setup?.( game, world, ctx );

} } );

const phase = ( name ) => ( world, dt ) => {

	const list = world.state.mechanics;
	if ( list ) for ( let i = 0; i < list.length; i ++ ) list[ i ].def[ name ]?.( world, dt, list[ i ] );

};

define( 'system', { id: 'world:mech-pre', order: 45, update: phase( 'preMove' ) } );
define( 'system', { id: 'world:mech-post', order: 55, update: phase( 'postMove' ) } );
define( 'system', { id: 'world:mech-fx', order: 62, update: phase( 'postEffects' ) } );
define( 'system', { id: 'world:mech', order: 85, update: phase( 'update' ) } );

// Plain-data summary of every active mechanic (agent API, tests, the HUD).
export function describeMechanics( world ) {

	return ( world.state.mechanics || [] ).map( ( ctx ) => ( {
		id: ctx.id, name: ctx.def.name, intensity: +ctx.intensity.toFixed( 2 ), ...( ctx.def.describe?.( world, ctx ) || {} )
	} ) );

}

// Intensity of mechanic `id` at `depth`: 1 where it debuts, growing slowly (campaign)
// and on and on (endless), so late depths turn every knob a little further.
export function intensityAt( id, depth ) {

	const home = get( 'mechanic', id )?.depth ?? 1;
	const over = Math.max( 0, depth - home );
	return depth <= 20 ? Math.min( 1.6, 1 + over * 0.05 ) : Math.min( 3, 1.4 + ( depth - 20 ) * 0.02 );

}
