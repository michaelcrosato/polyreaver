// GRAVITY WELLS (depth 8, Hollow Moon) - wells pull everything together.
//
// A well idles, then PULLS (everything inside its radius slides toward the core -
// monsters hard, you gently), then COLLAPSES: a crushing pulse at the core that
// damages, stuns and tosses what got caught. Strike the core to trigger it early.
//
// Casual: the pull is slow enough to walk out of. Expert: fight at the rim, let
// the well bunch a pack up and drop your biggest area skill on the pile - or
// trigger it yourself. Wells pull kegs ("Gravity Kegs"), swarmlings and loot-less
// props too, because pulling is just an impulse on any entity.

import { define } from '../../../core/registry.js';
import { TEAM } from '../../../core/tuning.js';
import { wallDistance } from '../gen/grid.js';
import { makeProp, hazardHit, fightRooms, freeSpot, addMechProp, affected } from './kit.js';

const IDLE = 4.5, PULL = 2.4;

define( 'mechanic', {
	id: 'gravity-wells', name: 'Gravity Wells', tags: [ 'force', 'void', 'crowd-control' ], theme: 'hollow-moon', depth: 8,
	desc: 'Singularities pull everything toward their core, then collapse in a crushing pulse.',
	tip: 'Fight at a well\'s rim: it bunches packs together for your area skills. Strike a core to trigger it early.',
	words: { adj: [ 'Gravity', 'Crushing', 'Heavy' ], noun: [ 'Wells', 'Singularities', 'Pull' ] },
	combinesWith: [ 'powder-keg', 'conduits', 'spike-field', 'black-ice', 'magma-tide' ],
	conflicts: [],

	decorate( L, rng, ctx ) {

		const wd = wallDistance( L );
		for ( const r of fightRooms( L ) ) {

			if ( r.tiles < 70 || ! rng.chance( Math.min( 0.95, 0.55 + ctx.intensity * 0.15 ) ) ) continue;
			const s = freeSpot( L, rng, r, wd, { margin: 3, away: 2 } );
			if ( s ) addMechProp( L, 'well', s.x, s.z, { mechanic: 'gravity-wells' } );

		}

		const boss = L.rooms.find( ( r ) => r.kind === 'boss' );
		if ( boss && ctx.intensity >= 1.3 ) {

			const s = freeSpot( L, rng, boss, wd, { margin: 3, away: 3 } );
			if ( s ) addMechProp( L, 'well', s.x, s.z, { mechanic: 'gravity-wells' } );

		}

	},

	setup( game, world, ctx ) {

		const st = ctx.state;
		st.wells = [];
		st.collapses = 0;
		for ( const p of world.layout.props ) {

			if ( p.data?.mechanic !== 'gravity-wells' ) continue;
			const w = makeProp( world, { name: 'Gravity well', x: p.x, z: p.z, model: 'well', radius: 0.5, height: 1.6, solid: false,
				data: { radius: 8.5 + ctx.intensity, timer: ctx.rng.range( 0, IDLE ), stage: 'idle', interact: 'Collapse' } } );
			w.data.onStruck = ( wd, t, h ) => {

				if ( h.source?.team === TEAM.PLAYER ) trigger( t, h.source );

			};

			w.data.onInteract = ( wd, player ) => trigger( w, player );
			world.add( w );
			st.wells.push( w );

		}

	},

	preMove( world, dt, ctx ) {

		for ( const w of ctx.state.wells ) {

			const d = w.data;
			d.timer -= dt;
			if ( d.stage === 'idle' && d.timer <= 0 ) {

				d.stage = 'pull';
				d.timer = PULL;
				world.events.emit( 'mechanic', { id: 'gravity-wells', event: 'pull', x: w.x, z: w.z, entity: w } );

			} else if ( d.stage === 'pull' && d.timer <= 0 ) {

				collapse( world, ctx, w );
				d.stage = 'idle';
				d.timer = IDLE / Math.pow( ctx.intensity, 0.3 );
				d.by = null;

			}

			if ( d.stage !== 'pull' ) continue;
			const strengthK = ( 1 - d.timer / PULL ) * 0.6 + 0.4; // ramps up through the pull
			for ( const e of world.spatial.query( w.x, w.z, d.radius, pullable ) ) {

				const dx = w.x - e.x, dz = w.z - e.z, dist = Math.hypot( dx, dz );
				if ( dist < 0.4 ) continue;
				const fall = Math.sqrt( 1 - Math.min( 1, dist / d.radius ) );
				const base = e.kind === 'player' ? 15 : e.kind === 'boss' ? 10 : e.kind === 'prop' ? 50 : 64;
				const s = base * fall * strengthK * Math.pow( ctx.intensity, 0.3 ) / Math.sqrt( Math.max( 0.5, e.mass ) ) * dt;
				e.impulse.x += dx / dist * s; e.impulse.z += dz / dist * s;

			}

		}

	},

	field( world, ctx, x, z, out ) {

		for ( const w of ctx.state.wells ) {

			if ( w.data.stage !== 'pull' ) continue;
			const dx = w.x - x, dz = w.z - z, d = Math.hypot( dx, dz );
			if ( d > w.data.radius || d < 0.3 ) continue;
			const k = 7 * Math.sqrt( 1 - d / w.data.radius );
			out.pullX += dx / d * k; out.pullZ += dz / d * k;

		}

	},

	describe( world, ctx ) {

		return { wells: ctx.state.wells.length, pulling: ctx.state.wells.filter( ( w ) => w.data.stage === 'pull' ).length, collapses: ctx.state.collapses };

	}
} );

const pullable = ( e ) => e.alive && e.kind !== 'loot' && e.kind !== 'npc' && e.kind !== 'echo' && ! e.flags.untargetable && ( e.kind !== 'prop' || e.data.movable );

function trigger( w, source ) {

	const d = w.data;
	if ( d.stage === 'pull' ) {

		d.timer = Math.min( d.timer, 0.6 );
		return;

	}

	d.stage = 'pull';
	d.timer = 1.1; // a short, violent pull when struck
	d.by = source;

}

function collapse( world, ctx, w ) {

	ctx.state.collapses ++;
	const r = 3.2;
	for ( const e of world.spatial.query( w.x, w.z, r, ( o ) => affected( o ) || ( o.kind === 'prop' && o.data.onStruck && o !== w ) ) ) {

		hazardHit( world, e, { base: 8, pct: 0.24 * Math.sqrt( ctx.intensity ), element: 'physical', tags: [ 'gravity-wells', 'blast' ], stun: 1.0, source: w.data.by, x: w.x, z: w.z } );
		if ( e.alive && e.kind !== 'player' && e.kind !== 'prop' ) e.vy = 7; // tossed into the air

	}

	world.events.emit( 'mechanic', { id: 'gravity-wells', event: 'collapse', x: w.x, z: w.z, radius: r, entity: w } );
	world.events.emit( 'mechanic', { id: 'gravity-wells', event: 'blast', x: w.x, z: w.z, radius: r, element: 'physical' } );
	world.events.emit( 'shake', { amount: 0.4 } );

}
