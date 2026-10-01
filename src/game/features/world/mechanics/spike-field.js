// SPIKE FIELD (depth 2, Sunken Crypt) - timed floor spikes hurt everything.
//
// Spike plates cover parts of rooms in patterns (stripes, checkers, rings, lanes).
// Each plate cycles: down -> RATTLE (warning) -> UP (impales anything on it) -> down,
// and the timing runs as a WAVE across each field so you can read and ride it.
// Monsters take a big % of their life per impale (stunned too); you take a normal
// hit. Casual: walk around the plates or cross between waves. Expert: stand just
// past a field and let packs chase you through the next wave.
//
// The cycle is a pure function of world.time and the tile, so the renderer animates
// every spike on the GPU from the same formula ( spikePhase ) with no per-frame CPU.

import { define } from '../../../core/registry.js';
import { TILE } from '../../../core/layout.js';
import { wallDistance } from '../gen/grid.js';
import { hazardHit, fightRooms, roomTiles } from './kit.js';

// fractions of the cycle
export const SPIKE = { RATTLE: 0.6, UP: 0.78, DOWN: 0.93 };

// Phase 0..1 of the plate at tile index i ( offsets from the region wave ).
export function spikePhase( t, offset, period ) {

	const p = ( t + offset ) / period;
	return p - Math.floor( p );

}

const PATTERNS = {
	stripes: ( x, z, r ) => ( ( r.vertical ? x : z ) % 3 ) !== 0,
	checker: ( x, z ) => ( ( ( x >> 1 ) + ( z >> 1 ) ) & 1 ) === 0,
	rings: ( x, z, r ) => Math.floor( Math.hypot( x - r.ax, z - r.az ) ) % 3 !== 0,
	lanes: ( x, z, r ) => ( ( r.vertical ? z : x ) % 4 ) < 2,
	border: ( x, z, r ) => x < r.x + 3 || z < r.z + 3 || x >= r.x + r.w - 3 || z >= r.z + r.h - 3,
	field: () => true
};

define( 'mechanic', {
	id: 'spike-field', name: 'Spike Field', tags: [ 'hazard', 'trap', 'timing' ], theme: 'sunken-crypt', depth: 2,
	desc: 'Floor plates thrust spikes up in rolling waves. They impale monsters as happily as you.',
	tip: 'Plates rattle before they strike. Cross between waves - or lead packs over them: monsters lose a third of their life per impale.',
	words: { adj: [ 'Spiked', 'Impaling', 'Piercing' ], noun: [ 'Spikes', 'Thorns', 'Spike Field' ] },
	combinesWith: [ 'lightless', 'chrono-fields', 'gravity-wells', 'black-ice', 'conduits' ],
	conflicts: [ 'magma-tide' ],

	decorate( L, rng, ctx ) {

		const wd = wallDistance( L );
		const rooms = fightRooms( L );
		const share = Math.min( 0.95, 0.55 + ctx.intensity * 0.15 );
		const names = Object.keys( PATTERNS );
		for ( const r of rooms ) {

			if ( ! rng.chance( share ) ) continue;
			const name = rng.pick( r.tiles > 140 ? names : [ 'stripes', 'checker', 'lanes', 'field' ] );
			const pr = { ...r, vertical: rng.chance( 0.5 ) };
			const tiles = [];
			for ( const t of roomTiles( L, r ) ) {

				const k = L.idx( t.x, t.z );
				if ( L.occ[ k ] || ! PATTERNS[ name ]( t.x, t.z, pr ) ) continue;
				// keep the room's entrance ring and anchor clear so nobody spawns impaled
				if ( Math.hypot( t.x - r.ax, t.z - r.az ) < 1.5 || wd[ k ] < 1 ) continue;
				tiles.push( k );

			}

			if ( tiles.length < 6 ) continue;
			const ang = rng.range( 0, Math.PI * 2 );
			L.regions.push( { id: 'spikes-' + r.id, kind: 'spikes', tiles, data: { pattern: name, room: r.id, wave: [ Math.cos( ang ), Math.sin( ang ) ], waveSpeed: rng.range( 0.08, 0.16 ), offset: rng.range( 0, 4 ) } } );
			for ( const k of tiles ) L.occ[ k ] = 1;

		}

		// a few corridor gauntlets on the main road
		const crit = L.meta.critical || [];
		for ( let i = 6; i < crit.length - 6; i += rng.int( 14, 22 ) ) {

			const c = crit[ i ], tiles = [];
			for ( let z = c.z - 2; z <= c.z + 2; z ++ ) for ( let x = c.x - 2; x <= c.x + 2; x ++ ) {

				if ( L.get( x, z ) === TILE.FLOOR && ! L.occ[ L.idx( x, z ) ] ) tiles.push( L.idx( x, z ) );

			}

			if ( tiles.length < 4 ) continue;
			L.regions.push( { id: 'spikes-c' + i, kind: 'spikes', tiles, data: { pattern: 'gate', wave: [ 1, 0 ], waveSpeed: 0, offset: rng.range( 0, 4 ) } } );
			for ( const k of tiles ) L.occ[ k ] = 1;

		}

	},

	setup( game, world, ctx ) {

		const L = world.layout, st = ctx.state;
		st.period = Math.max( 2.1, 3.3 / Math.sqrt( ctx.intensity ) );
		st.offset = new Float32Array( L.w * L.h );
		st.isSpike = new Uint8Array( L.w * L.h );
		st.tiles = [];
		for ( const reg of L.regions ) {

			if ( reg.kind !== 'spikes' ) continue;
			const { wave, waveSpeed, offset } = reg.data;
			for ( const k of reg.tiles ) {

				const x = k % L.w, z = ( k / L.w ) | 0;
				st.isSpike[ k ] = 1;
				// the wave: plates further along `wave` fire a little later
				st.offset[ k ] = offset - ( x * wave[ 0 ] + z * wave[ 1 ] ) * waveSpeed;
				st.tiles.push( k );

			}

		}

		st.impales = 0;

	},

	update( world, dt, ctx ) {

		const L = world.layout, st = ctx.state, t = world.time;
		for ( const e of world.entities ) {

			if ( ! e.alive || e.data.flying || e.y > 0.4 || e.kind === 'loot' || e.kind === 'npc' || e.kind === 'echo' || e.flags.untargetable ) continue;
			if ( e.kind === 'prop' && ! e.data.onStruck ) continue;
			const [ tx, tz ] = L.toTile( e.x, e.z );
			if ( ! L.inside( tx, tz ) ) continue;
			const k = L.idx( tx, tz );
			if ( ! st.isSpike[ k ] ) continue;
			const p = spikePhase( t, st.offset[ k ], st.period );
			if ( p < SPIKE.UP || p > SPIKE.DOWN ) continue;
			const cycle = Math.floor( ( t + st.offset[ k ] ) / st.period );
			if ( e.data.spikeCycle === cycle + k * 1e4 ) continue;
			e.data.spikeCycle = cycle + k * 1e4;
			hazardHit( world, e, { base: 13, pct: 0.3 + ctx.intensity * 0.04, element: 'physical', tags: [ 'spike-field', 'spikes' ], stun: 0.45 } );
			world.events.emit( 'mechanic', { id: 'spike-field', event: 'impale', x: e.x, z: e.z, entity: e } );
			st.impales ++;

		}

	},

	field( world, ctx, x, z, out ) {

		const L = world.layout, st = ctx.state;
		const [ tx, tz ] = L.toTile( x, z );
		if ( ! L.inside( tx, tz ) ) return;
		const k = L.idx( tx, tz );
		if ( ! st.isSpike[ k ] ) return;
		const p = spikePhase( world.time, st.offset[ k ], st.period );
		if ( p >= SPIKE.UP && p <= SPIKE.DOWN ) out.hazard = true;

	},

	describe( world, ctx ) {

		return { plates: ctx.state.tiles.length, period: +ctx.state.period.toFixed( 2 ), impales: ctx.state.impales };

	}
} );
