// BLACK ICE (depth 4, Frostfang Pass) - slippery momentum floors.
//
// Large patches of ice (the terrain rule: low traction, knockback slides far).
// On top of that this mechanic adds:
//   WALL SLAMS  a body sliding into a wall fast takes damage and is stunned
//   SHATTER     a monster that dies on ice while chilled, frozen or freshly slammed
//               bursts into ice shards that fly out and hurt its friends
// Casual: you slide a little; fight on rock if you prefer. Expert: knock packs
// across the ice into walls and each other, then shatter them in a chain.

import { define } from '../../../core/registry.js';
import { TILE } from '../../../core/layout.js';
import { TEAM } from '../../../core/tuning.js';
import { makeNoise, wallDistance } from '../gen/grid.js';
import { protectedTiles } from '../gen/finish.js';
import { hazardHit, isMonster, fightRooms, freeSpot } from './kit.js';

define( 'mechanic', {
	id: 'black-ice', name: 'Black Ice', tags: [ 'terrain', 'cold', 'movement' ], theme: 'frostfang-pass', depth: 4,
	desc: 'Treacherous ice: momentum carries you and everything you hit. Slammed and frozen foes shatter.',
	tip: 'Knock monsters across the ice into walls - slams stun and hurt, and a monster that dies on ice shatters into shards.',
	words: { adj: [ 'Frozen', 'Icebound', 'Slick' ], noun: [ 'Ice', 'Glacier', 'Rime' ] },
	combinesWith: [ 'powder-keg', 'gravity-wells', 'conduits', 'spike-field', 'rift-gates' ],
	conflicts: [ 'magma-tide' ],

	decorate( L, rng, ctx ) {

		const noise = makeNoise( rng.int( 1, 1e9 ) );
		const protect = protectedTiles( L );
		const cut = 0.62 - ctx.intensity * 0.06;
		for ( let z = 0; z < L.h; z ++ ) for ( let x = 0; x < L.w; x ++ ) {

			const i = L.idx( x, z );
			if ( L.tiles[ i ] !== TILE.FLOOR || protect[ i ] || L.occ[ i ] ) continue;
			if ( noise( x, z, 0.11 ) > cut ) L.tiles[ i ] = TILE.ICE;

		}

		// a frozen lake: one big room turned to solid ice with a few ice pillars to slam into
		const wd = wallDistance( L );
		const lakes = fightRooms( L ).filter( ( r ) => r.tiles > 110 ).sort( () => rng.next() - 0.5 ).slice( 0, Math.round( ctx.intensity ) );
		for ( const r of lakes ) {

			for ( let z = r.z; z < r.z + r.h; z ++ ) for ( let x = r.x; x < r.x + r.w; x ++ ) if ( L.get( x, z ) === TILE.FLOOR && ! protect[ L.idx( x, z ) ] ) L.set( x, z, TILE.ICE );
			for ( let k = 0; k < 3; k ++ ) {

				const s = freeSpot( L, rng, r, wd, { margin: 3, away: 3, tile: TILE.ICE } );
				if ( ! s ) continue;
				L.set( s.x, s.z, TILE.WALL );
				const [ wx, wz ] = L.toWorld( s.x, s.z );
				L.props.push( { type: 'prop-ice-pillar', x: wx, z: wz, rot: rng.range( 0, 6 ), scale: 1, data: { solid: true } } );
				L.occ[ L.idx( s.x, s.z ) ] = 1;

			}

		}

	},

	setup( game, world, ctx ) {

		const st = ctx.state;
		st.slams = 0; st.shatters = 0;
		world.events.on( 'death', ( d ) => {

			const e = d.entity;
			if ( ! isMonsterKind( e ) || world.layout.tileAt( e.x, e.z ) !== TILE.ICE ) return;
			const frozen = e.statuses.has( 'chill' ) || e.statuses.has( 'freeze' ) || world.time - ( e.data.slamTime ?? - 9 ) < 1.5;
			if ( ! frozen ) return;
			shatter( world, ctx, e, d.killer );

		} );

	},

	postMove( world, dt, ctx ) {

		const L = world.layout, st = ctx.state;
		for ( const e of world.entities ) {

			if ( ! e.alive || e.data.flying || ( e.kind !== 'monster' && e.kind !== 'boss' && e.kind !== 'player' && ! e.data.movable ) ) continue;
			const sp = Math.hypot( e.impulse.x, e.impulse.z );
			const fast = e.kind === 'player' ? 10 : 6;
			if ( sp < fast || L.tileAt( e.x, e.z ) !== TILE.ICE ) continue;
			const ux = e.impulse.x / sp, uz = e.impulse.z / sp;
			const ahead = e.radius + 0.25;
			if ( L.isWalkable( e.x + ux * ahead, e.z + uz * ahead ) ) continue;
			// SLAM: bounce back a little and pay for it
			e.impulse.x = - ux * sp * 0.25; e.impulse.z = - uz * sp * 0.25;
			e.data.slamTime = world.time;
			st.slams ++;
			if ( e.data.onStruck ) hazardHit( world, e, { base: 1, pct: 0, tags: [ 'black-ice' ] } );
			else hazardHit( world, e, { base: e.kind === 'player' ? 5 : 8, pct: Math.min( 0.35, 0.1 + sp * 0.012 ) * ctx.intensity, element: 'physical', tags: [ 'black-ice', 'slam' ], stun: 0.9 } );
			world.events.emit( 'mechanic', { id: 'black-ice', event: 'slam', x: e.x + ux * e.radius, z: e.z + uz * e.radius, entity: e } );
			world.events.emit( 'shake', { amount: 0.25 } );

		}

	},

	describe( world, ctx ) {

		let ice = 0;
		for ( const t of world.layout.tiles ) if ( t === TILE.ICE ) ice ++;
		return { iceTiles: ice, slams: ctx.state.slams, shatters: ctx.state.shatters };

	}
} );

const isMonsterKind = ( e ) => e.team === TEAM.ENEMY && ( e.kind === 'monster' || e.kind === 'boss' );

function shatter( world, ctx, e, killer ) {

	ctx.state.shatters ++;
	world.events.emit( 'mechanic', { id: 'black-ice', event: 'shatter', x: e.x, z: e.z, entity: e } );
	// shards are the killer's projectiles (so kills credit them); without a player
	// killer the shards are a plain cold burst that only hurts monsters
	const owner = killer && killer.team === TEAM.PLAYER ? killer : null;
	const n = 8;
	for ( let i = 0; i < n; i ++ ) {

		const dir = i / n * Math.PI * 2 + ctx.rng.range( - 0.2, 0.2 );
		if ( owner ) {

			world.projectile( owner, {
				x: e.x, z: e.z, dir, speed: 15, range: 6.5, radius: 0.35, fx: 'shard', element: 'cold', color: '#bfefff', pierce: 1,
				hit: { damage: { cold: e.maxLife * 0.28 * ctx.intensity }, addFlat: false, canCrit: false, tags: [ 'projectile', 'cold', 'black-ice' ], knockback: 6, skill: 'shatter' }
			} );

		}

	}

	if ( ! owner ) {

		for ( const o of world.spatial.query( e.x, e.z, 3.5, isMonster ) ) hazardHit( world, o, { base: 6, pct: 0.15, element: 'cold', tags: [ 'black-ice', 'shatter' ], x: e.x, z: e.z, knockback: 5 } );

	}

}
