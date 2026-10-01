// CHRONO FIELDS (depth 11, Clockwork Ruins) - zones that slow or haste
// everything inside: movement, attack and cast speed - and projectiles.
//
// Fields are clock faces on the floor. Each is SLOW (blue) or HASTE (gold) and
// the clockwork flips its polarity every few seconds (it ticks loudly first).
// Casual: step out of blue, enjoy gold. Expert: kite packs into a slow field and
// fight from the haste one next to it; fire projectiles through slow fields so
// they linger in the pack (more hits), or through haste fields to snipe.

import { define } from '../../../core/registry.js';
import { wallDistance } from '../gen/grid.js';
import { fightRooms, freeSpot } from './kit.js';

const FLIP = 9, WARN = 1.2;

define( 'mechanic', {
	id: 'chrono-fields', name: 'Chrono Fields', tags: [ 'time', 'zone', 'projectile' ], theme: 'clockwork-ruins', depth: 11,
	desc: 'Clockwork zones slow or haste everything inside - you, monsters and projectiles - and flip on the hour.',
	tip: 'Blue slows, gold hastes. Pull packs into blue and fight from gold. Projectiles crawl through blue fields and hit more.',
	words: { adj: [ 'Chrono', 'Timeworn', 'Clockwork' ], noun: [ 'Fields', 'Hours', 'Clocks' ] },
	combinesWith: [ 'miasma', 'spike-field', 'conduits', 'swarm', 'powder-keg' ],
	conflicts: [ 'echoes' ],

	decorate( L, rng, ctx ) {

		const wd = wallDistance( L );
		let n = 0;
		for ( const r of fightRooms( L ) ) {

			const k = r.tiles > 120 ? 2 : 1;
			for ( let i = 0; i < k; i ++ ) {

				if ( ! rng.chance( Math.min( 0.95, 0.5 + ctx.intensity * 0.2 ) ) ) continue;
				const s = freeSpot( L, rng, r, wd, { margin: 2, away: 2 } );
				if ( ! s ) continue;
				const [ x, z ] = L.toWorld( s.x, s.z );
				L.regions.push( { id: 'chrono-' + n, kind: 'chrono', tiles: [], data: { x, z, r: rng.range( 3.6, 5.2 ), slow: ( n + rng.int( 0, 1 ) ) % 2 === 0, offset: rng.range( 0, FLIP ) } } );
				n ++;

			}

		}

	},

	setup( game, world, ctx ) {

		const st = ctx.state;
		st.fields = world.layout.regions.filter( ( r ) => r.kind === 'chrono' ).map( ( r ) => ( { ...r.data, phase: 0, warn: false } ) );
		st.flip = FLIP / Math.pow( ctx.intensity, 0.25 );
		st.tick = 0;
		st.flips = 0;

	},

	update( world, dt, ctx ) {

		const st = ctx.state, t = world.time;
		for ( const f of st.fields ) {

			const cycles = Math.floor( ( t + f.offset ) / st.flip );
			const slow = ( f.slow ? 0 : 1 ) + cycles;
			const was = f.isSlow;
			f.isSlow = slow % 2 === 0;
			f.warn = ( t + f.offset ) % st.flip > st.flip - WARN;
			f.hand = ( ( t + f.offset ) % st.flip ) / st.flip; // 0..1 around the dial (for the renderer)
			if ( was !== undefined && was !== f.isSlow ) {

				st.flips ++;
				world.events.emit( 'mechanic', { id: 'chrono-fields', event: 'flip', x: f.x, z: f.z, slow: f.isSlow } );

			}

		}

		// statuses on bodies, a few times a second
		st.tick -= dt;
		if ( st.tick <= 0 ) {

			st.tick = 0.1;
			for ( const f of st.fields ) {

				for ( const e of world.spatial.query( f.x, f.z, f.r, ( o ) => o.alive && ( o.kind === 'player' || o.kind === 'monster' || o.kind === 'boss' ) ) ) {

					if ( Math.hypot( e.x - f.x, e.z - f.z ) > f.r ) continue;
					world.applyStatus( e, f.isSlow ? 'chrono-slow' : 'chrono-haste', { duration: 0.25 } );

				}

			}

		}

		// projectiles change speed inside fields and recover outside
		for ( const p of world.projectiles ) {

			if ( ! p.alive ) continue;
			if ( p.data.chronoBase === undefined ) p.data.chronoBase = p.speed;
			let mul = 1;
			for ( const f of st.fields ) if ( Math.hypot( p.x - f.x, p.z - f.z ) < f.r ) mul = f.isSlow ? 0.35 : 1.6;
			p.speed = p.data.chronoBase * mul;

		}

	},

	field( world, ctx, x, z, out ) {

		for ( const f of ctx.state.fields ) if ( Math.hypot( x - f.x, z - f.z ) < f.r ) out.speed *= f.isSlow ? 0.4 : 1.4;

	},

	describe( world, ctx ) {

		const st = ctx.state;
		return { fields: st.fields.length, slow: st.fields.filter( ( f ) => f.isSlow ).length, flipSeconds: +st.flip.toFixed( 1 ), flips: st.flips };

	}
} );
