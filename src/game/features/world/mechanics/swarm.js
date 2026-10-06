// THE SWARM (depth 10, Ashen Hive) - a horde of THOUSANDS of tiny ashlings.
//
// They are not entities (thousands of full entities with stats, statuses and AI
// would melt the simulation). The swarm is a DATA-ORIENTED system: typed arrays
// for position / velocity / life, a uniform grid for neighbour queries, and a
// flow field (one BFS over the tile grid from the player, refreshed a few times a
// second) that lets every ashling navigate corridors for the price of one lookup.
//
//   - hives (entities you can destroy) brood ashlings and keep respawning them
//   - awake ashlings flow toward you; touching you nibbles (damage scales with
//     how many touch at once); one hit of ANYTHING kills an ashling
//   - your melee arcs, areas, projectiles, blasts - and your echo - mow them down;
//     every kill is a little XP (a power-leveler's buffet)
//   - destroy every hive and the swarm collapses
//
// The swarm reads the shared FIELDS: spikes, beams and floods kill ashlings,
// wells pull them, chrono fields slow them, rifts teleport them ("Rift Swarm").
// The client draws it with one instanced mesh fed straight from these arrays.

import { define } from '../../../core/registry.js';
import { TILE } from '../../../core/layout.js';
import { TEAM, monsterScaling } from '../../../core/tuning.js';
import { wallDistance, walkable } from '../gen/grid.js';
import { makeProp, fightRooms, freeSpot, addMechProp, fieldAt } from './kit.js';

const CELL = 1.5; // grid cell (m) for neighbour queries and kill sweeps

define( 'mechanic', {
	id: 'swarm', name: 'The Swarm', tags: [ 'horde', 'insect', 'showcase' ], theme: 'ashen-hive', depth: 10,
	desc: 'Hives pour out thousands of ashlings that flood toward you. Each dies to a single hit.',
	tip: 'Sweep the swarm with wide attacks for a flood of XP. Destroy every hive and the swarm collapses.',
	words: { adj: [ 'Swarming', 'Teeming', 'Hive' ], noun: [ 'Swarm', 'Horde', 'Brood' ] },
	combinesWith: [ 'rift-gates', 'spike-field', 'conduits', 'gravity-wells', 'powder-keg' ],
	conflicts: [ 'miasma' ],

	decorate( L, rng, ctx ) {

		const wd = wallDistance( L );
		const rooms = fightRooms( L ).sort( ( a, b ) => b.tiles - a.tiles );
		const want = Math.min( rooms.length, 3 + Math.round( ctx.intensity * 1.5 ) );
		for ( const r of rooms.slice( 0, want ) ) {

			const s = freeSpot( L, rng, r, wd, { margin: 2, away: 2 } );
			if ( s ) addMechProp( L, 'hive', s.x, s.z, { mechanic: 'swarm' } );

		}

	},

	setup( game, world, ctx ) {

		const L = world.layout, st = ctx.state;
		const N = st.cap = Math.round( Math.min( 4000, 1100 + 700 * ctx.intensity ) );
		st.x = new Float32Array( N ); st.z = new Float32Array( N );
		st.vx = new Float32Array( N ); st.vz = new Float32Array( N );
		st.alive = new Uint8Array( N ); st.awake = new Uint8Array( N );
		st.hive = new Int16Array( N ); st.die = new Float32Array( N ); st.warp = new Float32Array( N );
		st.seed = new Float32Array( N );
		for ( let i = 0; i < N; i ++ ) st.seed[ i ] = ctx.rng.next();
		st.used = 0; // highest slot ever used + 1 (renderer draws 0..used)
		st.living = 0; st.kills = 0; st.free = [];
		st.flow = new Int16Array( L.w * L.h );
		st.flowTimer = 0;
		st.biteTimer = 0;
		st.gridHead = null; st.gridNext = new Int32Array( N );
		st.collapsed = false;
		st.xpPer = 0.7 * monsterScaling( world.level ).xp;
		st.hives = [];
		const sc = monsterScaling( world.level );
		for ( const p of L.props ) {

			if ( p.data?.mechanic !== 'swarm' ) continue;
			const h = makeProp( world, { name: 'Ash hive', x: p.x, z: p.z, model: 'hive', team: TEAM.ENEMY, radius: 0.9, height: 2.2, life: 70 * sc.life * Math.sqrt( ctx.intensity ), mass: 1000,
				data: { xp: 20 * sc.xp, rarity: 'magic', lootMult: 1.5, brood: 0 } } );
			world.add( h );
			h.data.index = st.hives.length;
			st.hives.push( h );

		}

		// initial brood: sleeping around their hives
		const per = Math.floor( N * 0.55 / Math.max( 1, st.hives.length ) );
		for ( const h of st.hives ) for ( let k = 0; k < per; k ++ ) spawn( st, L, h, ctx.rng );
		st.total = st.hives.length;
		objective( world, st );

		world.events.on( 'death', ( d ) => {

			if ( ! st.hives.includes( d.entity ) ) return;
			objective( world, st );
			world.events.emit( 'mechanic', { id: 'swarm', event: 'hive', x: d.entity.x, z: d.entity.z } );
			// its brood goes berserk
			for ( let i = 0; i < st.used; i ++ ) if ( st.alive[ i ] && st.hive[ i ] === d.entity.data.index ) st.awake[ i ] = 1;
			if ( st.hives.every( ( h ) => ! h.alive ) && ! st.collapsed ) {

				st.collapsed = true;
				for ( let i = 0; i < st.used; i ++ ) if ( st.alive[ i ] ) st.die[ i ] = world.time + ctx.rng.range( 0.4, 3.5 );
				world.events.emit( 'objective', { id: 'swarm', text: 'The hives are dead - the swarm collapses!', flash: true, done: true } );
				world.game?.gainXp( 30 * world.level );

			}

		} );

		// kill sweeps from everything the player's side does
		world.events.on( 'melee', ( m ) => {

			if ( m.owner?.team !== TEAM.PLAYER ) return;
			const half = ( m.angle ?? 120 ) * Math.PI / 360, fx = Math.sin( m.dir ), fz = Math.cos( m.dir );
			sweep( world, st, m.x, m.z, ( m.range ?? 2.2 ) + 0.4, ( dx, dz, d ) => d < 0.5 || ( dx * fx + dz * fz ) / d >= Math.cos( half ) );

		} );

		world.events.on( 'area:tick', ( { a } ) => {

			if ( ! a.hit || a.friendly || ( a.owner && a.owner.team !== TEAM.PLAYER ) ) return;
			if ( a.shape === 'line' ) {

				const fx = Math.sin( a.dir ), fz = Math.cos( a.dir );
				sweep( world, st, a.x + fx * a.length / 2, a.z + fz * a.length / 2, a.length / 2 + a.width, ( dx, dz ) => {

					const along = dx * fx + dz * fz, across = Math.abs( - dx * fz + dz * fx );
					return Math.abs( along ) <= a.length / 2 && across <= a.width / 2 + 0.3;

				} );

			} else sweep( world, st, a.x, a.z, a.radius + 0.3, a.shape === 'ring' ? ( dx, dz, d ) => d >= a.inner - 0.3 : null );

		} );

		world.events.on( 'mechanic', ( m ) => {

			if ( m.event === 'blast' ) sweep( world, st, m.x, m.z, m.radius, null );

		} );

	},

	postEffects( world, dt, ctx ) {

		// projectiles of the player's side cut through the swarm (up to 3 per step)
		const st = ctx.state;
		if ( ! st.gridHead ) return;
		for ( const p of world.projectiles ) {

			if ( ! p.alive || p.team !== TEAM.PLAYER ) continue;
			sweep( world, st, p.x, p.z, p.radius + 0.35, null, 3 );

		}

	},

	update( world, dt, ctx ) {

		const L = world.layout, st = ctx.state, p = world.player;
		if ( ! p ) return;
		const t = world.time;

		// flow field toward the player
		st.flowTimer -= dt;
		if ( st.flowTimer <= 0 ) {

			st.flowTimer = 0.3;
			buildFlow( L, st, p );

		}

		// hives brood while the player is near
		for ( const h of st.hives ) {

			if ( ! h.alive ) continue;
			const hx = h.x - p.x, hz = h.z - p.z;
			const near = hx * hx + hz * hz < 900;
			h.data.brood += dt * ( near ? 3 + ctx.intensity * 2 : 0.3 );
			while ( h.data.brood >= 1 ) {

				h.data.brood -= 1;
				const i = spawn( st, L, h, ctx.rng );
				if ( i >= 0 && near ) st.awake[ i ] = 1;

			}

		}

		// grid for separation and sweeps
		buildGrid( L, st );

		const field = {};
		const speedBase = 4.6 + Math.min( 1.4, ctx.intensity * 0.4 );
		const steer = Math.min( 1, dt * 7 );
		const biteRange2 = ( p.radius + 0.55 ) ** 2;
		const orbitTime = t * 0.6;
		let bites = 0;
		for ( let i = 0; i < st.used; i ++ ) {

			if ( ! st.alive[ i ] ) continue;
			if ( st.die[ i ] > 0 && t >= st.die[ i ] ) {

				kill( st, i );
				st.pendingXp = ( st.pendingXp ?? 0 ) + 1;
				continue;

			}

			const x = st.x[ i ], z = st.z[ i ];
			const dxp = p.x - x, dzp = p.z - z, dp2 = dxp * dxp + dzp * dzp;
			if ( ! st.awake[ i ] && dp2 < 400 ) st.awake[ i ] = 1;

			// what the other mechanics do here (staggered: every 4th step per ashling)
			let speedMul = 1;
			if ( ( i + world.frame ) % 4 === 0 ) {

				fieldAt( world, x, z, field );
				if ( field.hazard ) {

					kill( st, i );
					st.pendingXp = ( st.pendingXp ?? 0 ) + 1;
					continue;

				}

				if ( field.warp && t >= st.warp[ i ] ) {

					st.x[ i ] = field.warp.x + ctx.rng.range( - 1.2, 1.2 );
					st.z[ i ] = field.warp.z + ctx.rng.range( - 1.2, 1.2 );
					st.warp[ i ] = t + 1.5;
					continue;

				}

				speedMul = field.speed;
				st.vx[ i ] += field.pullX * dt * 4; st.vz[ i ] += field.pullZ * dt * 4;

			}

			let wx = 0, wz = 0, sp;
			if ( st.awake[ i ] && p.alive ) {

				sp = speedBase * ( 0.85 + st.seed[ i ] * 0.3 ) * speedMul;
				if ( dp2 < 36 && L.hasLineOfSight( x, z, p.x, p.z ) ) {

					const dp = Math.hypot( dxp, dzp ) || 1;
					wx = dxp / dp; wz = dzp / dp;

				} else {

					const d = flowDir( L, st, x, z );
					wx = d[ 0 ]; wz = d[ 1 ];

				}

				if ( dp2 < biteRange2 ) {

					bites ++;
					wx *= 0.2; wz *= 0.2; // latch on

				}

			} else {

				// lazy orbit around the home hive
				const h = st.hives[ st.hive[ i ] ];
				sp = 1.6;
				if ( h ) {

					const a = orbitTime + st.seed[ i ] * 6.28, orbitRadius = 2 + st.seed[ i ] * 4;
					const tx = h.x + Math.cos( a ) * orbitRadius, tz = h.z + Math.sin( a ) * orbitRadius;
					const dl = Math.hypot( tx - x, tz - z ) || 1;
					wx = ( tx - x ) / dl; wz = ( tz - z ) / dl;

				}

			}

			// separation from neighbours (a few, from the grid)
			let sx = 0, sz = 0;
			const cx = Math.floor( ( x - L.ox ) / CELL ), cz = Math.floor( ( z - L.oz ) / CELL );
			let checked = 0;
			for ( let oz = - 1; oz <= 1 && checked < 10; oz ++ ) for ( let ox = - 1; ox <= 1 && checked < 10; ox ++ ) {

				const c = cellIndex( st, cx + ox, cz + oz );
				for ( let j = c < 0 ? - 1 : st.gridHead[ c ]; j >= 0 && checked < 10; j = st.gridNext[ j ] ) {

					if ( j === i ) continue;
					checked ++;
					const ddx = x - st.x[ j ], ddz = z - st.z[ j ], d2 = ddx * ddx + ddz * ddz;
					if ( d2 > 0.25 || d2 < 1e-6 ) continue;
					const d = Math.sqrt( d2 );
					sx += ddx / d * ( 0.5 - d ); sz += ddz / d * ( 0.5 - d );

				}

			}

			// steer
			const tvx = wx * sp + sx * 8, tvz = wz * sp + sz * 8;
			st.vx[ i ] += ( tvx - st.vx[ i ] ) * steer; st.vz[ i ] += ( tvz - st.vz[ i ] ) * steer;

			// move with per-axis wall sliding
			let nx = x + st.vx[ i ] * dt, nz = z + st.vz[ i ] * dt;
			let tx = Math.floor( ( nx - L.ox ) / L.cell );
			const tz = Math.floor( ( z - L.oz ) / L.cell );
			if ( ! passable( L.get( tx, tz ) ) ) {

				nx = x; st.vx[ i ] *= - 0.3;
				tx = Math.floor( ( x - L.ox ) / L.cell );

			}

			if ( ! passable( L.get( tx, Math.floor( ( nz - L.oz ) / L.cell ) ) ) ) {

				nz = z; st.vz[ i ] *= - 0.3;

			}

			st.x[ i ] = nx; st.z[ i ] = nz;

		}

		// nibbles: damage grows with how many ashlings are on you, applied in ticks
		st.biteTimer -= dt;
		st.biting = bites;
		if ( st.biteTimer <= 0 && bites > 0 && p.alive ) {

			st.biteTimer = 0.3;
			const n = Math.min( 14, bites );
			const dmg = n * 0.6 * monsterScaling( world.level ).damage * world.tuning.enemyDamage;
			world.dealDamage( null, p, { damage: { fire: dmg }, addFlat: false, canCrit: false, canEvade: false, canBlock: false, noAilments: true, tags: [ 'swarm', 'hazard' ], skill: 'swarm' } );

		}

		flushKills( world, st );

	},

	describe( world, ctx ) {

		const st = ctx.state;
		return { living: st.living, capacity: st.cap, kills: st.kills, hives: st.hives.filter( ( h ) => h.alive ).length, hivesTotal: st.hives.length, biting: st.biting ?? 0 };

	}
} );

const passable = ( t ) => walkable( t ) && t !== TILE.LAVA;

function spawn( st, L, hive, rng ) {

	if ( st.living >= st.cap ) return - 1;
	const i = st.free.length ? st.free.pop() : st.used < st.cap ? st.used ++ : - 1;
	if ( i < 0 ) return - 1;
	const a = rng.range( 0, Math.PI * 2 ), r = rng.range( 1, 3.5 );
	let x = hive.x + Math.cos( a ) * r, z = hive.z + Math.sin( a ) * r;
	if ( ! passable( L.tileAt( x, z ) ) ) {

		x = hive.x + Math.cos( a ) * 1.1; z = hive.z + Math.sin( a ) * 1.1;

	}

	st.x[ i ] = x; st.z[ i ] = z; st.vx[ i ] = st.vz[ i ] = 0;
	st.alive[ i ] = 1; st.awake[ i ] = 0; st.die[ i ] = 0; st.warp[ i ] = 0;
	st.hive[ i ] = hive.data.index;
	st.living ++;
	return i;

}

function kill( st, i ) {

	st.alive[ i ] = 0;
	st.living --;
	st.kills ++;
	st.free.push( i );
	st.killed = st.killed || [];
	st.killed.push( st.x[ i ], st.z[ i ] );

}

// Kill every living ashling within r of (x, z) that passes `test` ( dx, dz, d ).
function sweep( world, st, x, z, r, test, max = Infinity ) {

	if ( ! st.gridHead ) return 0;
	const L = world.layout;
	let n = 0;
	const c0x = Math.floor( ( x - r - L.ox ) / CELL ), c1x = Math.floor( ( x + r - L.ox ) / CELL );
	const c0z = Math.floor( ( z - r - L.oz ) / CELL ), c1z = Math.floor( ( z + r - L.oz ) / CELL );
	for ( let cz = c0z; cz <= c1z; cz ++ ) for ( let cx = c0x; cx <= c1x; cx ++ ) {

		const c = cellIndex( st, cx, cz );
		if ( c < 0 ) continue;
		for ( let j = st.gridHead[ c ]; j >= 0; j = st.gridNext[ j ] ) {

			if ( ! st.alive[ j ] ) continue;
			const dx = st.x[ j ] - x, dz = st.z[ j ] - z;
			if ( dx * dx + dz * dz > r * r || ( test && ! test( dx, dz, Math.hypot( dx, dz ) ) ) ) continue;
			kill( st, j );
			st.pendingXp = ( st.pendingXp ?? 0 ) + 1;
			if ( ++ n >= max ) return n;

		}

	}

	return n;

}

function flushKills( world, st ) {

	if ( st.pendingXp ) {

		world.game?.gainXp( st.pendingXp * st.xpPer );
		world.stats.kills += st.pendingXp;
		st.pendingXp = 0;

	}

	if ( st.killed?.length ) {

		world.events.emit( 'mechanic', { id: 'swarm', event: 'kills', positions: st.killed, n: st.killed.length / 2 } );
		st.killed = [];

	}

}

function cellIndex( st, cx, cz ) {

	if ( cx < 0 || cz < 0 || cx >= st.gw || cz >= st.gh ) return - 1;
	return cz * st.gw + cx;

}

function buildGrid( L, st ) {

	if ( ! st.gridHead ) {

		st.gw = Math.ceil( L.w * L.cell / CELL ); st.gh = Math.ceil( L.h * L.cell / CELL );
		st.gridHead = new Int32Array( st.gw * st.gh );

	}

	st.gridHead.fill( - 1 );
	for ( let i = 0; i < st.used; i ++ ) {

		if ( ! st.alive[ i ] ) continue;
		const c = cellIndex( st, Math.floor( ( st.x[ i ] - L.ox ) / CELL ), Math.floor( ( st.z[ i ] - L.oz ) / CELL ) );
		if ( c < 0 ) continue;
		st.gridNext[ i ] = st.gridHead[ c ];
		st.gridHead[ c ] = i;

	}

}

// BFS distances (in tiles) from the player's tile; ashlings walk downhill.
function buildFlow( L, st, p ) {

	const flow = st.flow;
	flow.fill( 32767 );
	const [ px, pz ] = L.toTile( p.x, p.z );
	if ( ! L.inside( px, pz ) ) return;
	const q = st.queue || ( st.queue = new Int32Array( L.w * L.h ) );
	let head = 0, tail = 0;
	flow[ L.idx( px, pz ) ] = 0;
	q[ tail ++ ] = L.idx( px, pz );
	const visit = ( j, d ) => {

		if ( flow[ j ] > d && passable( L.tiles[ j ] ) ) {

			flow[ j ] = d;
			q[ tail ++ ] = j;

		}

	};

	while ( head < tail ) {

		const i = q[ head ++ ], x = i % L.w, z = ( i / L.w ) | 0, d = flow[ i ] + 1;
		if ( d > 60 ) continue; // beyond ~120 m nobody cares
		if ( x > 0 ) visit( i - 1, d );
		if ( x < L.w - 1 ) visit( i + 1, d );
		if ( z > 0 ) visit( i - L.w, d );
		if ( z < L.h - 1 ) visit( i + L.w, d );

	}

}

const DIRS = [ [ 1, 0 ], [ - 1, 0 ], [ 0, 1 ], [ 0, - 1 ], [ 1, 1 ], [ - 1, 1 ], [ 1, - 1 ], [ - 1, - 1 ] ];
const out2 = [ 0, 0 ];

function flowDir( L, st, x, z ) {

	const tx = Math.floor( ( x - L.ox ) / L.cell ), tz = Math.floor( ( z - L.oz ) / L.cell );
	let best = L.inside( tx, tz ) ? st.flow[ L.idx( tx, tz ) ] : 32767, bx = 0, bz = 0;
	for ( const [ dx, dz ] of DIRS ) {

		const nx = tx + dx, nz = tz + dz;
		if ( ! L.inside( nx, nz ) ) continue;
		// diagonal steps only when both side tiles are open (no corner cutting)
		if ( dx && dz && ( ! passable( L.get( tx + dx, tz ) ) || ! passable( L.get( tx, tz + dz ) ) ) ) continue;
		const v = st.flow[ L.idx( nx, nz ) ];
		if ( v < best ) {

			best = v; bx = dx; bz = dz;

		}

	}

	if ( ! bx && ! bz ) {

		out2[ 0 ] = out2[ 1 ] = 0;
		return out2;

	}

	// aim at the centre of the downhill tile
	const cx = L.ox + ( tx + bx + 0.5 ) * L.cell, cz = L.oz + ( tz + bz + 0.5 ) * L.cell;
	const dx = cx - x, dz = cz - z, l = Math.hypot( dx, dz ) || 1;
	out2[ 0 ] = dx / l; out2[ 1 ] = dz / l;
	return out2;

}

function objective( world, st ) {

	const dead = st.hives.filter( ( h ) => ! h.alive ).length;
	world.events.emit( 'objective', { id: 'swarm', text: `Hives destroyed ${dead} / ${st.hives.length}` } );

}
