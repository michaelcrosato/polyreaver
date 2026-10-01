// LIGHTLESS (depth 3, Gloom Catacombs) - darkness, a small light radius and
// braziers you can ignite. Monsters in the dark are SHROUDED (+20% damage, take
// 20% less); in light they are EXPOSED (25% less damage, take 25% more).
//
// Casual: your own light radius exposes whatever is in your face, so plain
// fighting works. Expert: light braziers (hit them, or press interact) - each one
// bursts into flame (igniting nearby monsters) and lights a whole room for good;
// light every brazier for a bonus. Ranged builds pull packs into lit rooms.
//
// Light is a FIELD: conduit beams, magma floods and other mechanics can light the
// dark too (fieldAt().lit) - that is "Dark Conduits".

import { define } from '../../../core/registry.js';
import { TEAM } from '../../../core/tuning.js';
import { wallDistance } from '../gen/grid.js';
import { makeProp, freeSpot, addMechProp, fieldAt, isMonster, blast } from './kit.js';

export const BRAZIER_RADIUS = 10;

define( 'mechanic', {
	id: 'lightless', name: 'Lightless', tags: [ 'darkness', 'light' ], theme: 'gloom-catacombs', depth: 3,
	desc: 'Near-total darkness. Monsters in the dark are shrouded and deadly; in light they are exposed.',
	tip: 'Strike or use braziers to light rooms for good. Fight in the light - light them all for a bonus.',
	words: { adj: [ 'Lightless', 'Dark', 'Unlit' ], noun: [ 'Dark', 'Gloom', 'Shadows' ] },
	combinesWith: [ 'conduits', 'spike-field', 'powder-keg', 'echoes', 'swarm' ],
	conflicts: [ 'miasma' ],

	decorate( L, rng, ctx ) {

		L.meta.noTorches = true;
		L.meta.dark = true;
		const wd = wallDistance( L );
		for ( const r of L.rooms ) {

			if ( r.kind === 'exit' ) continue;
			const n = r.kind === 'boss' ? 4 : Math.max( 1, Math.round( r.tiles / 90 ) );
			for ( let i = 0; i < n; i ++ ) {

				const s = freeSpot( L, rng, r, wd, { margin: 2, away: r.kind === 'start' ? 0 : 2 } );
				if ( s ) addMechProp( L, 'brazier', s.x, s.z, { mechanic: 'lightless', lit: r.kind === 'start' } );

			}

		}

	},

	setup( game, world, ctx ) {

		const st = ctx.state;
		st.braziers = [];
		st.playerRadius = Math.max( 5, 7.5 / Math.pow( ctx.intensity, 0.3 ) );
		st.timer = 0;
		st.bonus = false;
		for ( const p of world.layout.props ) {

			if ( p.data?.mechanic !== 'lightless' ) continue;
			const b = makeProp( world, { name: 'Brazier', x: p.x, z: p.z, model: 'brazier', radius: 0.55, height: 1.2, data: { lit: !! p.data.lit, radius: BRAZIER_RADIUS, interact: p.data.lit ? null : 'Light brazier' } } );
			const ignite = ( w, src ) => igniteBrazier( w, ctx, b, src );
			b.data.onStruck = ( w, t, h ) => {

				if ( h.source?.team === TEAM.PLAYER || h.byType?.fire > 0 || h.tags?.includes( 'blast' ) ) ignite( w, h.source );

			};

			b.data.onInteract = ( w, player ) => ignite( w, player );
			world.add( b );
			st.braziers.push( b );

		}

		objective( world, ctx );
		// any blast lights braziers it touches (Powder Keg, gravity collapses, ...)
		world.events.on( 'mechanic', ( m ) => {

			if ( m.event !== 'blast' ) return;
			for ( const b of st.braziers ) if ( ! b.data.lit && Math.hypot( b.x - m.x, b.z - m.z ) < m.radius + 0.6 ) igniteBrazier( world, ctx, b, null );

		} );

	},

	update( world, dt, ctx ) {

		const st = ctx.state;
		st.timer -= dt;
		if ( st.timer > 0 ) return;
		st.timer = 0.2;
		const f = {};
		for ( const e of world.entities ) {

			if ( ! isMonster( e ) ) continue;
			fieldAt( world, e.x, e.z, f );
			world.applyStatus( e, f.lit ? 'exposed' : 'shrouded', { duration: 0.45 } );

		}

	},

	field( world, ctx, x, z, out ) {

		if ( out.lit ) return;
		const st = ctx.state, p = world.player;
		if ( p && p.alive && Math.hypot( p.x - x, p.z - z ) < st.playerRadius ) {

			out.lit = true;
			return;

		}

		for ( const b of st.braziers ) if ( b.data.lit && Math.hypot( b.x - x, b.z - z ) < b.data.radius ) {

			out.lit = true;
			return;

		}

	},

	describe( world, ctx ) {

		const st = ctx.state;
		return { braziers: st.braziers.length, lit: st.braziers.filter( ( b ) => b.data.lit ).length, lightRadius: +st.playerRadius.toFixed( 1 ) };

	}
} );

function igniteBrazier( world, ctx, b, source ) {

	if ( b.data.lit ) return;
	b.data.lit = true;
	b.data.litAt = world.time;
	b.data.interact = null;
	// the flare: a short fire burst that exposes and burns what lurked next to it
	blast( world, { x: b.x, z: b.z, radius: 4, base: 0, pct: 0.12, element: 'fire', knockback: 4, instigator: source, id: 'lightless', selfMult: 0, stun: 0.3 } );
	world.events.emit( 'mechanic', { id: 'lightless', event: 'ignite', x: b.x, z: b.z, entity: b } );
	objective( world, ctx );
	const st = ctx.state;
	if ( ! st.bonus && st.braziers.every( ( o ) => o.data.lit ) ) {

		st.bonus = true;
		st.playerRadius *= 1.6;
		world.events.emit( 'objective', { id: 'lightless', text: 'Every brazier burns - the dark retreats!', flash: true, done: true } );
		world.game?.gainXp( 40 * world.level );

	}

}

function objective( world, ctx ) {

	const st = ctx.state;
	const lit = st.braziers.filter( ( b ) => b.data.lit ).length;
	world.events.emit( 'objective', { id: 'lightless', text: `Braziers lit ${lit} / ${st.braziers.length}` } );

}
