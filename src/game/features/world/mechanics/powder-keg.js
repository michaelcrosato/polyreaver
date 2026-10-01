// POWDER KEG (depth 1, Ember Quarry) - explosive kegs chain-react.
//
// Casual: kegs are scenery you can ignore (or that blow up a pack you happen to
//   fight next to). Expert: a hit LIGHTS a keg (1.6 s fuse) AND knocks it - bat lit
//   kegs into packs like a bomb, line them up for chain reactions, lure monsters
//   onto clusters. Any blast (or lava, spikes, a conduit beam) lights a keg, and a
//   blast hitting a lit keg cuts its fuse to a split second - that is the chain.
//
// Kegs are MOVABLE props: they slide on Black Ice, get pulled by Gravity Wells and
// fall through Rift Gates, which is where "Powder Ice" and "Gravity Kegs" come from.

import { define } from '../../../core/registry.js';
import { TILE } from '../../../core/layout.js';
import { TEAM } from '../../../core/tuning.js';
import { wallDistance } from '../gen/grid.js';
import { makeProp, blast, fightRooms, freeSpot, addMechProp } from './kit.js';

const FUSE = 1.6, CHAIN = 0.14;

define( 'mechanic', {
	id: 'powder-keg', name: 'Powder Keg', tags: [ 'hazard', 'fire', 'explosive' ], theme: 'ember-quarry', depth: 1,
	desc: 'Explosive kegs litter the quarry. A hit lights the fuse; blasts chain from keg to keg.',
	tip: 'Strike a keg to light it and knock it into a pack - 1.6 s later it explodes. Blasts set off nearby kegs. Mind your own toes.',
	words: { adj: [ 'Powder', 'Blasting', 'Volatile' ], noun: [ 'Kegs', 'Powder', 'Charges' ] },
	combinesWith: [ 'black-ice', 'gravity-wells', 'rift-gates', 'conduits', 'miasma', 'lightless' ],
	conflicts: [],

	decorate( L, rng, ctx ) {

		const wd = wallDistance( L );
		const rooms = fightRooms( L );
		const perRoom = 1.4 + ctx.intensity * 0.8;
		let total = 0;
		for ( const r of rooms ) {

			if ( total >= 72 ) break; // plenty for chains; more is just clutter

			const clusters = Math.max( 1, Math.round( perRoom * rng.range( 0.6, 1.3 ) * Math.min( 1.6, r.tiles / 90 ) ) );
			for ( let c = 0; c < clusters; c ++ ) {

				const s = freeSpot( L, rng, r, wd, { margin: 1, away: 3 } );
				if ( ! s ) continue;
				const n = rng.int( 1, 3 + Math.round( ctx.intensity ) );
				for ( let k = 0; k < n; k ++ ) {

					const x = s.x + rng.int( - 1, 1 ), z = s.z + rng.int( - 1, 1 );
					if ( L.get( x, z ) !== TILE.FLOOR || L.occ[ L.idx( x, z ) ] ) continue;
					addMechProp( L, 'keg', x, z, { mechanic: 'powder-keg' } );
					total ++;

				}

			}

		}

	},

	setup( game, world, ctx ) {

		const st = ctx.state;
		st.kegs = [];
		st.best = 0; st.current = 1;
		for ( const p of world.layout.props ) {

			if ( p.data?.mechanic !== 'powder-keg' ) continue;
			const keg = makeProp( world, { name: 'Powder keg', x: p.x + ctx.rng.range( - 0.3, 0.3 ), z: p.z + ctx.rng.range( - 0.3, 0.3 ), model: 'keg', radius: 0.42, height: 1.1, mass: 1.6, movable: true, data: { fuse: - 1, lit: false } } );
			keg.data.accel = 6; // a struck keg rolls on, it does not stop dead
			keg.data.corpseTime = 0.05;
			keg.data.onStruck = ( w, k, h ) => {

				// a keg blast cuts the fuse short and carries the chain count on
				const fromKeg = h.tags?.includes( 'powder-keg' );
				light( w, k, h.source, fromKeg ? CHAIN : FUSE, fromKeg ? st.current + 1 : 1 );

			};
			world.add( keg );
			st.kegs.push( keg );

		}

	},

	update( world, dt, ctx ) {

		const st = ctx.state;
		for ( const k of st.kegs ) {

			if ( ! k.alive || ! k.data.lit ) continue;
			k.data.fuse -= dt;
			if ( k.data.fuse > 0 ) continue;
			world.kill( k, null );
			const chain = k.data.chain ?? 1;
			st.current = chain;
			blast( world, { x: k.x, z: k.z, radius: 3.6 + ctx.intensity * 0.3, base: 16, pct: 0.32 + ctx.intensity * 0.05, element: 'fire', knockback: 11, instigator: k.data.instigator, id: 'powder-keg', tags: [ 'chain' + chain ] } );
			world.events.emit( 'mechanic', { id: 'powder-keg', event: 'explode', x: k.x, z: k.z, chain } );
			if ( chain >= 3 && chain > st.best ) {

				st.best = chain;
				world.events.emit( 'objective', { id: 'powder-keg', text: `Chain reaction x${chain}!`, flash: true } );
				if ( k.data.instigator?.kind === 'player' ) world.game?.gainXp( 6 * chain * chain * world.level );

			}

		}

		st.kegs = st.kegs.filter( ( k ) => k.alive );

	},

	describe( world, ctx ) {

		const k = ctx.state.kegs || [];
		return { kegs: k.filter( ( e ) => e.alive ).length, lit: k.filter( ( e ) => e.alive && e.data.lit ).length, bestChain: ctx.state.best };

	}
} );

function light( world, keg, source, fuse, chain ) {

	if ( ! keg.alive ) return;
	if ( keg.data.lit ) {

		// already burning: a blast shortens the fuse - that is the chain reaction
		if ( fuse < keg.data.fuse ) {

			keg.data.fuse = fuse;
			keg.data.chain = Math.max( keg.data.chain, chain );

		}

		return;

	}

	keg.data.lit = true;
	keg.data.fuse = fuse;
	keg.data.litAt = world.time;
	keg.data.chain = chain;
	// the player (or their echo) who lit it gets the kills; kegs lit by monsters or
	// the environment blow up "for nobody"
	keg.data.instigator = source && source.team === TEAM.PLAYER ? source : null;
	world.events.emit( 'mechanic', { id: 'powder-keg', event: 'lit', x: keg.x, z: keg.z, entity: keg } );

}
