// CONDUITS (depth 5, Storm Foundry) - pylons linked by lightning beams.
//
// Pylons stand in rooms and across corridors; beams arc between linked pylons on
// a rhythm (ON for a few seconds, a flicker warning, OFF for a moment). Anything
// crossing a live beam is shocked - monsters lose a big chunk of life and stagger.
// Strike a pylon to OVERCHARGE its network: every beam surges and arcs to nearby
// monsters (cooldown).
//
// Casual: cross while beams are off. Expert: knock monsters THROUGH beams, kite
// packs across them, overcharge when a pack is near the pylons. Beams light the
// dark (Dark Conduits), light kegs and fry swarmlings (fields + onStruck).

import { define } from '../../../core/registry.js';
import { TILE } from '../../../core/layout.js';
import { TEAM } from '../../../core/tuning.js';
import { wallDistance } from '../gen/grid.js';
import { makeProp, hazardHit, fightRooms, freeSpot, addMechProp, affected, isMonster } from './kit.js';

const ON = 3.4, OFF = 1.7, WARN = 0.5;

define( 'mechanic', {
	id: 'conduits', name: 'Conduits', tags: [ 'hazard', 'lightning', 'timing' ], theme: 'storm-foundry', depth: 5,
	desc: 'Pylons arc lightning beams between them on a rhythm. Strike a pylon to overcharge its network.',
	tip: 'Cross when the beams flicker off. Knock or lure monsters through live beams; strike a pylon to overcharge the whole network.',
	words: { adj: [ 'Charged', 'Conductive', 'Voltaic' ], noun: [ 'Conduits', 'Coils', 'Arcs' ] },
	combinesWith: [ 'lightless', 'black-ice', 'powder-keg', 'gravity-wells', 'chrono-fields' ],
	conflicts: [],

	decorate( L, rng, ctx ) {

		const wd = wallDistance( L );
		let net = 0;
		for ( const r of fightRooms( L ) ) {

			if ( ! rng.chance( Math.min( 0.95, 0.5 + ctx.intensity * 0.2 ) ) ) continue;
			const n = r.tiles > 120 ? rng.int( 3, 4 ) : 2;
			const pts = [];
			for ( let i = 0; i < n * 3 && pts.length < n; i ++ ) {

				const s = freeSpot( L, rng, r, wd, { margin: 2, away: 2 } );
				if ( ! s || pts.some( ( p ) => Math.hypot( p.x - s.x, p.z - s.z ) < 4 ) ) continue;
				if ( pts.length && ! pts.some( ( p ) => Math.hypot( p.x - s.x, p.z - s.z ) < 9 && L.hasLineOfSight( ...L.toWorld( p.x, p.z ), ...L.toWorld( s.x, s.z ) ) ) ) continue;
				pts.push( s );

			}

			if ( pts.length < 2 ) continue;
			for ( const p of pts ) addMechProp( L, 'pylon', p.x, p.z, { mechanic: 'conduits', net } );
			net ++;

		}

		// corridor gates: a pylon on each side of the main road
		const crit = L.meta.critical || [];
		for ( let i = 10; i < crit.length - 8; i += rng.int( 18, 28 ) ) {

			const c = crit[ i ];
			const dirs = [ [ 1, 0 ], [ 0, 1 ] ];
			for ( const [ dx, dz ] of dirs ) {

				let a = null, b = null;
				for ( let k = 1; k < 5 && ! a; k ++ ) if ( ! isOpen( L, c.x + dx * k, c.z + dz * k ) ) a = { x: c.x + dx * ( k - 1 ), z: c.z + dz * ( k - 1 ) };
				for ( let k = 1; k < 5 && ! b; k ++ ) if ( ! isOpen( L, c.x - dx * k, c.z - dz * k ) ) b = { x: c.x - dx * ( k - 1 ), z: c.z - dz * ( k - 1 ) };
				if ( ! a || ! b || Math.abs( a.x - b.x ) + Math.abs( a.z - b.z ) < 2 ) continue;
				if ( L.occ[ L.idx( a.x, a.z ) ] || L.occ[ L.idx( b.x, b.z ) ] ) continue;
				addMechProp( L, 'pylon', a.x, a.z, { mechanic: 'conduits', net } );
				addMechProp( L, 'pylon', b.x, b.z, { mechanic: 'conduits', net } );
				net ++;
				break;

			}

		}

	},

	setup( game, world, ctx ) {

		const st = ctx.state;
		st.pylons = [];
		st.beams = [];
		st.nets = [];
		st.surges = 0;
		const byNet = new Map();
		for ( const p of world.layout.props ) {

			if ( p.data?.mechanic !== 'conduits' ) continue;
			const py = makeProp( world, { name: 'Pylon', x: p.x, z: p.z, model: 'pylon', radius: 0.45, height: 2.6, data: { net: p.data.net, interact: 'Overcharge' } } );
			py.data.onStruck = ( w, t, h ) => {

				if ( h.source?.team === TEAM.PLAYER ) overcharge( w, ctx, t.data.net, h.source );

			};

			py.data.onInteract = ( w, player ) => overcharge( w, ctx, py.data.net, player );
			world.add( py );
			st.pylons.push( py );
			if ( ! byNet.has( p.data.net ) ) byNet.set( p.data.net, [] );
			byNet.get( p.data.net ).push( py );

		}

		for ( const [ id, list ] of byNet ) {

			st.nets[ id ] = { id, offset: ctx.rng.range( 0, ON + OFF ), surgeUntil: - 1, readyAt: 0 };
			// chain the pylons: each links to the next (and the last back to the first for 3+)
			for ( let i = 0; i < list.length; i ++ ) {

				const a = list[ i ], b = list[ ( i + 1 ) % list.length ];
				if ( a === b || ( list.length === 2 && i === 1 ) ) continue;
				if ( ! world.layout.hasLineOfSight( a.x, a.z, b.x, b.z ) ) continue;
				st.beams.push( { a, b, net: id, on: false } );

			}

		}

		st.period = ( ON + OFF ) / Math.pow( ctx.intensity, 0.15 );

	},

	update( world, dt, ctx ) {

		const st = ctx.state, t = world.time;
		for ( const beam of st.beams ) {

			const n = st.nets[ beam.net ];
			const surging = t < n.surgeUntil;
			beam.on = surging || beamState( t, n.offset, st.period ) === 'on';
			beam.surging = surging;
			if ( ! beam.on ) continue;
			const { a, b } = beam;
			const mx = ( a.x + b.x ) / 2, mz = ( a.z + b.z ) / 2, len = Math.hypot( b.x - a.x, b.z - a.z );
			for ( const e of world.spatial.query( mx, mz, len / 2 + 1, ( o ) => affected( o ) || ( o.kind === 'prop' && o.data.onStruck && o.data.net === undefined ) ) ) {

				if ( segDist( e.x, e.z, a.x, a.z, b.x, b.z ) > e.radius + 0.3 ) continue;
				if ( t < ( e.data.beamReady ?? 0 ) ) continue;
				e.data.beamReady = t + 0.55;
				hazardHit( world, e, { base: 11, pct: ( surging ? 0.3 : 0.16 ) * Math.sqrt( ctx.intensity ), element: 'lightning', tags: [ 'conduits', 'beam' ], stun: 0.5 } );
				if ( e.alive && e.kind !== 'prop' ) world.applyStatus( e, 'shock', { duration: 2 } );
				world.events.emit( 'mechanic', { id: 'conduits', event: 'zap', x: e.x, z: e.z, entity: e } );

			}

		}

	},

	field( world, ctx, x, z, out ) {

		for ( const beam of ctx.state.beams ) {

			if ( ! beam.on ) continue;
			const d = segDist( x, z, beam.a.x, beam.a.z, beam.b.x, beam.b.z );
			if ( d < 0.6 ) out.hazard = true;
			if ( d < 3.5 ) out.lit = true;

		}

	},

	describe( world, ctx ) {

		const st = ctx.state;
		return { pylons: st.pylons.length, beams: st.beams.length, live: st.beams.filter( ( b ) => b.on ).length, surges: st.surges };

	}
} );

// 'on' | 'warn' (flickering, still safe) | 'off'
export function beamState( t, offset, period ) {

	const p = ( ( t + offset ) % period + period ) % period;
	const on = period * ON / ( ON + OFF );
	if ( p < on ) return 'on';
	if ( p > period - WARN ) return 'warn';
	return 'off';

}

function isOpen( L, x, z ) {

	return L.get( x, z ) === TILE.FLOOR;

}

export function segDist( px, pz, ax, az, bx, bz ) {

	const vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz || 1;
	const t = Math.max( 0, Math.min( 1, ( ( px - ax ) * vx + ( pz - az ) * vz ) / l2 ) );
	return Math.hypot( px - ( ax + vx * t ), pz - ( az + vz * t ) );

}

function overcharge( world, ctx, netId, source ) {

	const st = ctx.state, n = st.nets[ netId ];
	if ( ! n || world.time < n.readyAt ) return;
	n.surgeUntil = world.time + 1.6;
	n.readyAt = world.time + 7;
	st.surges ++;
	world.events.emit( 'mechanic', { id: 'conduits', event: 'surge', net: netId, x: source?.x ?? 0, z: source?.z ?? 0 } );
	world.events.emit( 'shake', { amount: 0.35 } );
	// every pylon of the network arcs to the monsters around it
	for ( const py of st.pylons ) {

		if ( py.data.net !== netId ) continue;
		for ( const m of world.spatial.query( py.x, py.z, 7, isMonster ) ) {

			hazardHit( world, m, { base: 10, pct: 0.22 * Math.sqrt( ctx.intensity ), element: 'lightning', tags: [ 'conduits', 'arc' ], stun: 0.6, source, x: py.x, z: py.z } );
			world.events.emit( 'mechanic', { id: 'conduits', event: 'arc', x: py.x, z: py.z, tx: m.x, tz: m.z } );

		}

	}

}
