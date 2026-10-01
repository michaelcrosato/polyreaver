// Terrain rules that hold in EVERY level, mechanic or not - the tile codes mean
// something physical:
//
//   ICE    low traction: bodies keep their momentum (acceleration drops to ~12%)
//          and knockback slides much further (impulse decays ~4x slower)
//   LAVA   walkable but burns: fire damage twice a second (monsters by % of life,
//          so kiting them through a lava channel is a real tactic)
//   WATER  / PIT block movement (core/layout.js); fliers cross them
//
// Black Ice builds on the ICE rule (wall slams, shattering); Magma Tide floods
// basins with the same burn. Kegs are movable props, so they slide on ice too.

import { define } from '../../../core/registry.js';
import { TILE } from '../../../core/layout.js';
import { hazardHit } from './kit.js';

const slides = ( e ) => e.alive && ! e.data.flying && ( e.kind !== 'prop' || e.data.movable ) && e.kind !== 'loot' && e.kind !== 'npc' && e.kind !== 'echo';

define( 'system', { id: 'world:terrain-pre', order: 44, update( world ) {

	const L = world.layout;
	for ( const e of world.entities ) {

		if ( ! slides( e ) ) continue;
		const onIce = L.tileAt( e.x, e.z ) === TILE.ICE;
		if ( onIce ) {

			if ( e.data.iceBaseAccel === undefined ) e.data.iceBaseAccel = e.data.accel ?? null;
			e.data.accel = ( e.data.iceBaseAccel ?? 40 ) * 0.12;
			e.data.onIce = world.time;

		} else if ( e.data.iceBaseAccel !== undefined ) {

			// off the ice: give back exactly what was there before (null = the core default)
			if ( e.data.iceBaseAccel === null ) delete e.data.accel; else e.data.accel = e.data.iceBaseAccel;
			delete e.data.iceBaseAccel;

		}

	}

} } );

define( 'system', { id: 'world:terrain-post', order: 56, update( world, dt ) {

	const L = world.layout;
	const keep = Math.exp( 6.2 * dt ); // core decays impulse by exp( -8 dt ); net exp( -1.8 dt ) on ice
	for ( const e of world.entities ) {

		if ( ! slides( e ) ) continue;
		const t = L.tileAt( e.x, e.z );
		if ( t === TILE.ICE ) {

			const sp = Math.hypot( e.impulse.x, e.impulse.z );
			if ( sp > 0.3 && sp < 26 ) {

				e.impulse.x *= keep; e.impulse.z *= keep;

			}

		} else if ( t === TILE.LAVA && world.time >= ( e.data.lavaNext ?? 0 ) ) {

			e.data.lavaNext = world.time + 0.5;
			hazardHit( world, e, { base: 6, pct: 0.06, element: 'fire', tags: [ 'lava' ] } );

		}

	}

} } );
