// RIFT GATES (depth 6, Shattered Observatory) - paired portals move players,
// monsters AND projectiles.
//
// Each pair joins two distant rooms; one pair is always a SHORTCUT from near the
// start to the room before the boss (speedrunners). Step into a gate and you come
// out of its twin moving the same way; so do monsters chasing you, kegs you knock
// in and every projectile - shoot into one gate to hit the pack around the other.
// Casual: they are doors; ignore or enjoy them.

import { define } from '../../../core/registry.js';
import { TEAM } from '../../../core/tuning.js';
import { wallDistance } from '../gen/grid.js';
import { makeProp, freeSpot, addMechProp } from './kit.js';

const RADIUS = 1.0, COOLDOWN = 1.1;
const COLORS = [ '#5ad1ff', '#ff7ae0', '#9cff3a', '#ffcf5a', '#b090ff', '#ff8a4a' ];

define( 'mechanic', {
	id: 'rift-gates', name: 'Rift Gates', tags: [ 'portal', 'movement', 'projectile' ], theme: 'shattered-observatory', depth: 6,
	desc: 'Paired rifts fold space: anything entering one - you, monsters, projectiles - leaves the other.',
	tip: 'One pair is a shortcut toward the boss. Fire projectiles into a rift to strike whatever waits at its twin.',
	words: { adj: [ 'Rift', 'Warped', 'Folded' ], noun: [ 'Rifts', 'Gates', 'Folds' ] },
	combinesWith: [ 'swarm', 'powder-keg', 'echoes', 'black-ice', 'gravity-wells' ],
	conflicts: [],

	decorate( L, rng, ctx ) {

		const wd = wallDistance( L );
		const rooms = L.rooms.filter( ( r ) => r.kind !== 'exit' && r.kind !== 'boss' );
		const start = L.rooms.find( ( r ) => r.kind === 'start' );
		const boss = L.rooms.find( ( r ) => r.kind === 'boss' );
		const spot = ( r ) => freeSpot( L, rng, r, wd, { margin: 2, away: r.kind === 'start' ? 2 : 3 } );
		const pairs = [];
		// the shortcut: start -> the critical room just before the boss
		const pre = L.rooms.filter( ( r ) => r.tags.includes( 'critical' ) && r.kind === 'combat' && boss?.links.includes( r.id ) )[ 0 ];
		if ( start && pre ) pairs.push( [ start, pre ] );
		const want = 2 + Math.round( ctx.intensity * 1.5 );
		for ( let tries = 0; tries < 60 && pairs.length < want; tries ++ ) {

			const a = rng.pick( rooms ), b = rng.pick( rooms );
			if ( a === b || a.kind === 'start' || b.kind === 'start' ) continue;
			if ( Math.abs( a.depth - b.depth ) < 2 && Math.hypot( a.cx - b.cx, a.cz - b.cz ) < 40 ) continue;
			if ( pairs.some( ( p ) => p.includes( a ) || p.includes( b ) ) ) continue;
			pairs.push( [ a, b ] );

		}

		let pair = 0;
		for ( const [ a, b ] of pairs ) {

			const sa = spot( a ), sb = spot( b );
			if ( ! sa || ! sb ) continue;
			addMechProp( L, 'rift', sa.x, sa.z, { mechanic: 'rift-gates', pair, end: 0, shortcut: a.kind === 'start' } );
			addMechProp( L, 'rift', sb.x, sb.z, { mechanic: 'rift-gates', pair, end: 1, shortcut: a.kind === 'start' } );
			pair ++;

		}

	},

	setup( game, world, ctx ) {

		const st = ctx.state;
		st.gates = [];
		st.warps = 0;
		for ( const p of world.layout.props ) {

			if ( p.data?.mechanic !== 'rift-gates' ) continue;
			const g = makeProp( world, { name: p.data.shortcut ? 'Rift (shortcut)' : 'Rift', x: p.x, z: p.z, model: 'rift', radius: RADIUS, height: 2.4, solid: false, flags: { untargetable: true, inert: true, ghost: true },
				data: { pair: p.data.pair, end: p.data.end, color: COLORS[ p.data.pair % COLORS.length ], shortcut: p.data.shortcut } } );
			world.add( g );
			st.gates.push( g );

		}

		for ( const g of st.gates ) g.data.twin = st.gates.find( ( o ) => o !== g && o.data.pair === g.data.pair ) || null;
		st.gates = st.gates.filter( ( g ) => g.data.twin );

	},

	postMove( world, dt, ctx ) {

		const st = ctx.state;
		for ( const g of st.gates ) {

			for ( const e of world.spatial.query( g.x, g.z, RADIUS * 0.6, canWarp ) ) {

				if ( world.time < ( e.data.riftReady ?? 0 ) ) continue;
				warpEntity( world, ctx, e, g );

			}

		}

	},

	postEffects( world, dt, ctx ) {

		const st = ctx.state;
		for ( const p of world.projectiles ) {

			if ( ! p.alive || world.time < ( p.data.riftReady ?? 0 ) ) continue;
			for ( const g of st.gates ) {

				if ( Math.hypot( p.x - g.x, p.z - g.z ) > RADIUS + p.radius ) continue;
				const t = g.data.twin;
				p.x = t.x + Math.sin( p.dir ) * ( RADIUS + 0.3 );
				p.z = t.z + Math.cos( p.dir ) * ( RADIUS + 0.3 );
				p.data.riftReady = world.time + 0.35;
				p.hitIds.clear(); // a warped projectile may hit the same monster again on the other side
				world.events.emit( 'mechanic', { id: 'rift-gates', event: 'warp', x: g.x, z: g.z, tx: p.x, tz: p.z, projectile: p } );
				st.warps ++;
				break;

			}

		}

	},

	field( world, ctx, x, z, out ) {

		for ( const g of ctx.state.gates ) if ( Math.hypot( x - g.x, z - g.z ) < RADIUS * 0.7 ) out.warp = g.data.twin;

	},

	describe( world, ctx ) {

		return { pairs: ctx.state.gates.length / 2, warps: ctx.state.warps, shortcut: ctx.state.gates.some( ( g ) => g.data.shortcut ) };

	}
} );

const canWarp = ( e ) => e.alive && e.kind !== 'boss' && e.kind !== 'loot' && e.kind !== 'npc' && ( e.kind !== 'prop' || e.data.movable );

function warpEntity( world, ctx, e, g ) {

	const t = g.data.twin;
	// exit moving the same way we entered (or facing, when standing still)
	let dx = e.vx + e.impulse.x, dz = e.vz + e.impulse.z;
	const l = Math.hypot( dx, dz );
	if ( l < 0.2 ) {

		dx = Math.sin( e.facing ); dz = Math.cos( e.facing );

	} else {

		dx /= l; dz /= l;

	}

	let nx = t.x + dx * ( RADIUS + e.radius + 0.25 ), nz = t.z + dz * ( RADIUS + e.radius + 0.25 );
	if ( ! world.layout.isWalkable( nx, nz ) ) {

		nx = t.x; nz = t.z;

	}

	world.events.emit( 'mechanic', { id: 'rift-gates', event: 'warp', x: e.x, z: e.z, tx: nx, tz: nz, entity: e } );
	e.x = e.px = nx; e.z = e.pz = nz;
	e.data.riftReady = world.time + COOLDOWN;
	ctx.state.warps ++;
	if ( e.team === TEAM.PLAYER && e.kind === 'player' ) world.events.emit( 'teleport', { entity: e, x: nx, z: nz } );

}
