// MAGMA TIDE (depth 7, Cinder Caldera) - lava floods the low ground and recedes.
//
// The layout gets two heights: BASINS (layout.elev = -1) that flood, and high
// ground that never does. A tide cycle runs on world.time: calm -> rumble warning
// (the floor glows, the screen shakes) -> the magma rises -> holds -> recedes.
// While flooded, anything standing in a basin burns hard - monsters by % of life.
//
// Casual: when it rumbles, step onto high ground (there is always some within a
// few strides - the decorator guarantees it). Expert: stand on a ledge as the tide
// rises and let the pack chasing you wade in. Floods light kegs and kill swarmlings.

import { define } from '../../../core/registry.js';
import { TILE } from '../../../core/layout.js';
import { makeNoise, bfs } from '../gen/grid.js';
import { protectedTiles } from '../gen/finish.js';
import { hazardHit } from './kit.js';

// fractions of the cycle: [ calm | warn | rise | full | fall ]
export const TIDE = { WARN: 0.5, RISE: 0.62, FULL: 0.7, FALL: 0.9 };

// 0 (dry) .. 1 (flooded) for a cycle position p in [0, 1)
export function tideLevel( p ) {

	if ( p < TIDE.RISE ) return 0;
	if ( p < TIDE.FULL ) return ( p - TIDE.RISE ) / ( TIDE.FULL - TIDE.RISE );
	if ( p < TIDE.FALL ) return 1;
	return 1 - ( p - TIDE.FALL ) / ( 1 - TIDE.FALL );

}

export function tidePhase( world, st ) {

	const t = world.time - st.grace;
	if ( t < 0 ) return 0;
	return ( t % st.period ) / st.period;

}

define( 'mechanic', {
	id: 'magma-tide', name: 'Magma Tide', tags: [ 'hazard', 'fire', 'terrain', 'timing' ], theme: 'cinder-caldera', depth: 7,
	desc: 'Magma floods the low basins on a rhythm and drains away. High ground stays safe.',
	tip: 'When the ground rumbles, climb to high ground. Lure packs into the basins just before the tide rises.',
	words: { adj: [ 'Molten', 'Magma', 'Searing' ], noun: [ 'Tide', 'Flood', 'Magma' ] },
	combinesWith: [ 'echoes', 'powder-keg', 'gravity-wells', 'swarm', 'rift-gates' ],
	conflicts: [ 'black-ice', 'spike-field', 'miasma' ],

	decorate( L, rng, ctx ) {

		const noise = makeNoise( rng.int( 1, 1e9 ) );
		const protect = protectedTiles( L );
		const basin = ( i ) => L.elev[ i ] === - 1;
		const cut = 0.5 + 0.03 * ctx.intensity;
		for ( let z = 0; z < L.h; z ++ ) for ( let x = 0; x < L.w; x ++ ) {

			const i = L.idx( x, z ), t = L.tiles[ i ];
			if ( ( t !== TILE.FLOOR && t !== TILE.ICE ) || protect[ i ] ) continue;
			if ( noise( x, z, 0.09 ) < cut ) L.elev[ i ] = - 1;

		}

		// guarantee high ground within reach: any basin tile more than 4 tiles (8 m)
		// from dry ground gets an island carved around it, until none is
		for ( let guard = 0; guard < 40; guard ++ ) {

			const seeds = [];
			for ( let i = 0; i < L.tiles.length; i ++ ) if ( ( L.tiles[ i ] === TILE.FLOOR || L.tiles[ i ] === TILE.ICE ) && ! basin( i ) ) seeds.push( { x: i % L.w, z: ( i / L.w ) | 0 } );
			const dist = bfs( L, seeds );
			let far = - 1, fd = 4;
			for ( let i = 0; i < dist.length; i ++ ) if ( basin( i ) && dist[ i ] > fd ) {

				fd = dist[ i ];
				far = i;

			}

			if ( far < 0 ) break;
			const fx = far % L.w, fz = ( far / L.w ) | 0;
			for ( let z = fz - 2; z <= fz + 2; z ++ ) for ( let x = fx - 2; x <= fx + 2; x ++ ) if ( L.inside( x, z ) && Math.hypot( x - fx, z - fz ) <= 1.8 ) L.elev[ L.idx( x, z ) ] = 0;

		}

		const tiles = [];
		for ( let i = 0; i < L.tiles.length; i ++ ) if ( basin( i ) ) tiles.push( i );
		L.regions.push( { id: 'basins', kind: 'basin', tiles, data: {} } );
		L.meta.basins = tiles.length;

	},

	setup( game, world, ctx ) {

		const L = world.layout, st = ctx.state;
		st.period = Math.max( 15, 24 / Math.pow( ctx.intensity, 0.35 ) );
		st.grace = 9; // the first flood comes after you had time to look around
		st.basin = new Uint8Array( L.w * L.h );
		for ( let i = 0; i < L.tiles.length; i ++ ) if ( L.elev[ i ] === - 1 ) st.basin[ i ] = 1;
		st.stage = 'calm';
		st.level = 0;
		st.tick = 0;
		st.floods = 0;

	},

	update( world, dt, ctx ) {

		const st = ctx.state, L = world.layout;
		const p = tidePhase( world, st );
		st.level = tideLevel( p );
		const stage = p < TIDE.WARN ? 'calm' : p < TIDE.RISE ? 'warn' : p < TIDE.FALL ? 'flood' : 'fall';
		if ( stage !== st.stage ) {

			st.stage = stage;
			if ( stage === 'flood' ) st.floods ++;
			world.events.emit( 'mechanic', { id: 'magma-tide', event: 'tide', stage } );
			if ( stage === 'warn' ) world.events.emit( 'objective', { id: 'magma-tide', text: 'The magma rises - get to high ground!', flash: true } );
			if ( stage === 'warn' || stage === 'flood' ) world.events.emit( 'shake', { amount: stage === 'warn' ? 0.3 : 0.5 } );
			if ( stage === 'calm' ) world.events.emit( 'objective', { id: 'magma-tide', text: 'The tide has drained' } );

		}

		st.tick -= dt;
		if ( st.tick > 0 || st.level < 0.55 ) return;
		st.tick = 0.25;
		for ( const e of world.entities ) {

			if ( ! e.alive || e.data.flying || e.y > 0.5 || e.kind === 'loot' || e.kind === 'npc' || e.kind === 'echo' || e.flags.untargetable ) continue;
			if ( e.kind === 'prop' && ! e.data.onStruck ) continue;
			const [ tx, tz ] = L.toTile( e.x, e.z );
			if ( ! L.inside( tx, tz ) || ! st.basin[ L.idx( tx, tz ) ] ) continue;
			hazardHit( world, e, { base: 5, pct: 0.065 * Math.sqrt( ctx.intensity ), element: 'fire', tags: [ 'magma-tide', 'magma' ] } );

		}

	},

	field( world, ctx, x, z, out ) {

		const st = ctx.state, L = world.layout;
		if ( st.level < 0.55 ) return;
		const [ tx, tz ] = L.toTile( x, z );
		if ( L.inside( tx, tz ) && st.basin[ L.idx( tx, tz ) ] ) {

			out.hazard = true;
			out.lit = true;

		}

	},

	describe( world, ctx ) {

		const st = ctx.state;
		return { stage: st.stage, level: +st.level.toFixed( 2 ), period: +st.period.toFixed( 1 ), basinTiles: world.layout.meta.basins ?? 0, floods: st.floods };

	}
} );
