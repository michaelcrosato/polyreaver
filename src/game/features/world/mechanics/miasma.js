// MIASMA (depth 12, Blightmarsh) - poison fog spreads from vents; shrines cleanse.
//
// The fog is a DENSITY FIELD on the tile grid (Float32Array): vents pump it in,
// it diffuses to neighbours and slowly thickens, so the level gets worse the
// longer you dawdle. Breathing it stacks Miasma (chaos damage over time);
// monsters in it are Blighted (+damage, regenerating).
// Cleansing SHRINES (strike or use them) purge the fog around them, scorch the
// blighted monsters there and make you immune for a while; they recharge.
// FIRE burns fog away: every fire area and every blast clears its radius
// (Powder Keg + Miasma, fire skills).
//
// Casual: move on, hop shrine to shrine. Expert: purge at the right moment to
// scorch a blighted pack, burn corridors open, race the spread.

import { define } from '../../../core/registry.js';
import { TILE } from '../../../core/layout.js';
import { TEAM } from '../../../core/tuning.js';
import { wallDistance, walkable } from '../gen/grid.js';
import { makeProp, fightRooms, freeSpot, addMechProp, hazardHit, isMonster } from './kit.js';

const STEP = 0.2, THICK = 0.35, PURGE = 13;

define( 'mechanic', {
	id: 'miasma', name: 'Miasma', tags: [ 'poison', 'zone', 'spreading' ], theme: 'blightmarsh', depth: 12,
	desc: 'Poison fog seeps from vents and spreads. It sickens you and strengthens the blighted.',
	tip: 'Keep moving. Strike a shrine to purge the fog around it and scorch blighted monsters. Fire burns the fog away.',
	words: { adj: [ 'Blighted', 'Toxic', 'Miasmic' ], noun: [ 'Miasma', 'Fog', 'Rot' ] },
	combinesWith: [ 'chrono-fields', 'powder-keg', 'conduits', 'rift-gates', 'gravity-wells' ],
	conflicts: [ 'lightless', 'swarm', 'magma-tide' ],

	decorate( L, rng, ctx ) {

		const wd = wallDistance( L );
		const rooms = fightRooms( L );
		rng.shuffle( rooms );
		const vents = Math.max( 3, Math.round( rooms.length * ( 0.5 + ctx.intensity * 0.15 ) ) );
		for ( const r of rooms.slice( 0, vents ) ) {

			const s = freeSpot( L, rng, r, wd, { margin: 2, away: 3 } );
			if ( s ) addMechProp( L, 'vent', s.x, s.z, { mechanic: 'miasma', role: 'vent' } );

		}

		// shrines: one near the start, then roughly every third room
		const start = L.rooms.find( ( r ) => r.kind === 'start' );
		const spots = [ start, ...L.rooms.filter( ( r ) => r.kind !== 'start' && r.kind !== 'exit' ).filter( ( _, i ) => i % 3 === 1 ) ];
		for ( const r of spots ) {

			if ( ! r ) continue;
			const s = freeSpot( L, rng, r, wd, { margin: 2, away: 2 } );
			if ( s ) addMechProp( L, 'shrine', s.x, s.z, { mechanic: 'miasma', role: 'shrine' } );

		}

	},

	setup( game, world, ctx ) {

		const L = world.layout, st = ctx.state;
		st.density = new Float32Array( L.w * L.h );
		st.next = new Float32Array( L.w * L.h );
		st.open = new Uint8Array( L.w * L.h );
		for ( let i = 0; i < L.tiles.length; i ++ ) st.open[ i ] = walkable( L.tiles[ i ] ) || L.tiles[ i ] === TILE.WATER ? 1 : 0;
		st.vents = []; st.shrines = [];
		st.timer = 0; st.version = 0; st.purges = 0;
		st.growth = 0.02 * ctx.intensity;
		for ( const p of L.props ) {

			if ( p.data?.mechanic !== 'miasma' ) continue;
			if ( p.data.role === 'vent' ) {

				const v = makeProp( world, { name: 'Blight vent', x: p.x, z: p.z, model: 'vent', radius: 0.6, height: 0.6, solid: true, flags: { untargetable: true } } );
				world.add( v );
				st.vents.push( v );
				// seed a pocket of fog
				const [ tx, tz ] = L.toTile( p.x, p.z );
				for ( let z = tz - 3; z <= tz + 3; z ++ ) for ( let x = tx - 3; x <= tx + 3; x ++ ) if ( L.inside( x, z ) && st.open[ L.idx( x, z ) ] ) st.density[ L.idx( x, z ) ] = Math.max( 0, 0.8 - Math.hypot( x - tx, z - tz ) * 0.18 );

			} else {

				const s = makeProp( world, { name: 'Cleansing shrine', x: p.x, z: p.z, model: 'shrine', radius: 0.6, height: 2, data: { readyAt: 0, interact: 'Cleanse' } } );
				s.data.onStruck = ( w, t, h ) => {

					if ( h.source?.team === TEAM.PLAYER ) purge( w, ctx, s, h.source );

				};

				s.data.onInteract = ( w, player ) => purge( w, ctx, s, player );
				world.add( s );
				st.shrines.push( s );

			}

		}

		// fire clears fog
		world.events.on( 'mechanic', ( m ) => {

			if ( m.event === 'blast' ) clear( L, st, m.x, m.z, m.radius * ( m.element === 'fire' ? 1.3 : 0.8 ) );

		} );

		world.events.on( 'area', ( { a } ) => {

			if ( a.element === 'fire' && a.team === TEAM.PLAYER ) clear( L, st, a.x, a.z, a.radius );

		} );

	},

	update( world, dt, ctx ) {

		const L = world.layout, st = ctx.state;
		st.timer -= dt;
		if ( st.timer > 0 ) return;
		st.timer = STEP;
		// vents pump, fog diffuses (average of neighbours) and thickens slowly (logistic)
		const d = st.density, n = st.next, W = L.w;
		// evaporation keeps the fog pooled around its vents; it weakens over time, so
		// the pools creep outward the longer you stay ( length scale ~ sqrt( 0.35 / decay ) tiles )
		const decay = 0.012 / ( 1 + world.time / 90 ) / Math.sqrt( ctx.intensity );
		for ( const v of st.vents ) {

			const [ tx, tz ] = L.toTile( v.x, v.z );
			for ( let z = tz - 1; z <= tz + 1; z ++ ) for ( let x = tx - 1; x <= tx + 1; x ++ ) {

				const i = L.idx( x, z );
				if ( st.open[ i ] ) d[ i ] = Math.min( 1, d[ i ] + 0.4 );

			}

		}

		for ( let z = 1; z < L.h - 1; z ++ ) for ( let x = 1; x < W - 1; x ++ ) {

			const i = z * W + x;
			if ( ! st.open[ i ] ) {

				n[ i ] = 0;
				continue;

			}

			// branch-free 4-neighbour average over open tiles (open is 0 / 1)
			const o1 = st.open[ i - 1 ], o2 = st.open[ i + 1 ], o3 = st.open[ i - W ], o4 = st.open[ i + W ];
			const cnt = o1 + o2 + o3 + o4;
			const sum = d[ i - 1 ] * o1 + d[ i + 1 ] * o2 + d[ i - W ] * o3 + d[ i + W ] * o4;
			const avg = cnt ? sum / cnt : d[ i ];
			let v = d[ i ] + ( avg - d[ i ] ) * 0.35;
			v += v * ( 1 - v ) * st.growth - v * decay;
			n[ i ] = v < 0.004 ? 0 : Math.min( 1, v );

		}

		st.density = n; st.next = d;
		st.version ++;

		// effects on bodies
		// a breath every 0.6 s adds a stack (refreshing the timer in between)
		const p = world.player;
		st.breath = ( st.breath ?? 0 ) + 1;
		if ( p?.alive && fogAt( L, st, p.x, p.z ) > THICK ) {

			const s = p.statuses.get( 'miasma' );
			if ( s && st.breath % 3 ) s.time = Math.max( s.time, 2.5 );
			else world.applyStatus( p, 'miasma', { duration: 2.5 } );

		}

		for ( const e of world.entities ) if ( isMonster( e ) && fogAt( L, st, e.x, e.z ) > THICK ) world.applyStatus( e, 'blighted', { duration: 0.6 } );

	},

	describe( world, ctx ) {

		const st = ctx.state;
		let fog = 0, open = 0;
		for ( let i = 0; i < st.density.length; i ++ ) if ( st.open[ i ] ) {

			open ++;
			if ( st.density[ i ] > THICK ) fog ++;

		}

		return { coverage: +( fog / Math.max( 1, open ) ).toFixed( 3 ), vents: st.vents.length, shrines: st.shrines.length, purges: st.purges };

	}
} );

export function fogAt( L, st, x, z ) {

	const [ tx, tz ] = L.toTile( x, z );
	return L.inside( tx, tz ) ? st.density[ L.idx( tx, tz ) ] : 0;

}

function clear( L, st, x, z, r ) {

	const [ tx, tz ] = L.toTile( x, z ), rt = r / L.cell;
	for ( let k = Math.floor( tz - rt ); k <= Math.ceil( tz + rt ); k ++ ) for ( let j = Math.floor( tx - rt ); j <= Math.ceil( tx + rt ); j ++ ) {

		if ( ! L.inside( j, k ) ) continue;
		const d = Math.hypot( j - tx, k - tz ) / rt;
		if ( d <= 1 ) st.density[ L.idx( j, k ) ] *= Math.min( 1, d * d * 0.6 );

	}

	st.version ++;

}

function purge( world, ctx, shrine, source ) {

	const st = ctx.state, L = world.layout;
	if ( world.time < shrine.data.readyAt ) return;
	shrine.data.readyAt = world.time + 22;
	st.purges ++;
	// scorch the blighted first (while they still stand in fog), then clear it
	for ( const m of world.spatial.query( shrine.x, shrine.z, PURGE, isMonster ) ) {

		if ( fogAt( L, st, m.x, m.z ) > 0.15 ) hazardHit( world, m, { base: 8, pct: 0.3, element: 'lightning', tags: [ 'miasma', 'purge' ], stun: 0.6, source, x: shrine.x, z: shrine.z } );

	}

	clear( L, st, shrine.x, shrine.z, PURGE );
	if ( source?.kind === 'player' ) world.applyStatus( source, 'cleansed', { duration: 15 } );
	world.events.emit( 'mechanic', { id: 'miasma', event: 'purge', x: shrine.x, z: shrine.z, radius: PURGE, entity: shrine } );
	world.events.emit( 'objective', { id: 'miasma', text: 'Cleansed - immune to miasma for 15 s', flash: true } );

}
