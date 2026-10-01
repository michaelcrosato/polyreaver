// Playtest bot: plays the game through the same INPUT STATE a person uses (it never
// touches the simulation directly), so whatever it finds - unwinnable rooms, stuck
// paths, damage spikes, dead loops - a player would find too. It runs headless in
// Node (scripts/sim.mjs) at hundreds of times real speed, or live in the browser.
//
//   const bot = createBot( game, { skills: true, loot: true } );
//   each step: bot.step( dt ); game.update( dt );      bot.report() -> plain JSON
//
// Behaviour, in priority order:
//   1. dodge out of enemy telegraphs (areas still in their delay) that cover us
//   2. drink a potion at low life
//   3. fight: nearest threat (bosses and rares first when close), keep melee range,
//      hold attack, fire bar skills when ready and affordable
//   4. collect loot when the coast is clear
//   5. head for the exit once it is open (or explore unvisited floor)
// Navigation is A* over the tile grid with corner cutting disabled.

import { TEAM } from '../../core/tuning.js';

export function createBot( game, { skills = true, loot = true, explore = true } = {} ) {

	const w = () => game.world;
	const inp = game.input;
	const st = { path: null, pathTo: null, pathAt: - 9, visited: new Set(), dodges: 0, potions: 0, picked: 0, skillUses: 0, stuck: 0, lastPos: null, startTime: w().time, startXp: game.save.xp, startLevel: game.save.level, startGold: game.save.gold, exit: null, decisions: {} };
	const offExit = w().events.on( 'exitOpen', ( e ) => ( st.exit = { x: e.x, z: e.z } ) );
	const count = ( k ) => ( st.decisions[ k ] = ( st.decisions[ k ] || 0 ) + 1 );

	function moveToward( x, z, stopAt = 0.5 ) {

		const p = w().player;
		const d = Math.hypot( x - p.x, z - p.z );
		if ( d <= stopAt ) {

			inp.move.x = inp.move.z = 0;
			return true;

		}

		// straight line if clear, else follow an A* path (refreshed twice a second)
		const L = w().layout;
		let tx = x, tz = z;
		if ( L.raycast( p.x, p.z, x, z, BLOCK ) < 1 ) {

			if ( ! st.path || w().time - st.pathAt > 0.5 || ! st.pathTo || Math.hypot( st.pathTo.x - x, st.pathTo.z - z ) > 2 ) {

				st.path = astar( L, p.x, p.z, x, z );
				st.pathTo = { x, z };
				st.pathAt = w().time;

			}

			while ( st.path && st.path.length > 1 && Math.hypot( st.path[ 0 ].x - p.x, st.path[ 0 ].z - p.z ) < 0.9 ) st.path.shift();
			if ( st.path && st.path.length ) {

				tx = st.path[ 0 ].x; tz = st.path[ 0 ].z;

			}

		} else st.path = null;

		const dx = tx - p.x, dz = tz - p.z, l = Math.hypot( dx, dz ) || 1;
		inp.move.x = dx / l; inp.move.z = dz / l;
		return false;

	}

	function threatAt( x, z ) {

		for ( const a of w().areas ) {

			if ( a.team !== TEAM.ENEMY || a.age >= a.delay + 0.05 ) continue;
			const r = a.shape === 'line' ? a.length : a.radius;
			if ( Math.hypot( x - a.x, z - a.z ) < r + 0.8 ) return a;

		}

		return null;

	}

	function step() {

		const world = w(), p = world.player;
		inp.held.clear();
		if ( ! p || ! p.alive ) return;
		const tile = world.layout.toTile( p.x, p.z ).join( ',' );
		st.visited.add( tile );

		// 1. telegraphed danger: dodge away from its centre
		const danger = threatAt( p.x, p.z );
		if ( danger && ( p.cooldowns.get( 'dodge' ) ?? 0 ) <= world.time ) {

			const dx = p.x - danger.x, dz = p.z - danger.z, l = Math.hypot( dx, dz ) || 1;
			inp.move.x = dx / l; inp.move.z = dz / l;
			inp.pressed.add( 'dodge' );
			st.dodges ++;
			count( 'dodge' );
			return;

		}

		// 2. potion
		if ( p.lifeFrac < 0.35 && ( p.cooldowns.get( 'potion' ) ?? 0 ) <= world.time ) {

			inp.pressed.add( 'potion' );
			p.cooldowns.set( 'bot-potion', world.time + 2 );
			st.potions ++;

		}

		// 3. fight
		const foes = world.entities.filter( ( e ) => e.alive && e.team === TEAM.ENEMY && e.kind !== 'prop' && ! e.flags.untargetable );
		let target = null, best = Infinity;
		for ( const f of foes ) {

			const d = p.distTo( f );
			if ( d > 28 ) continue;
			const score = d - ( f.kind === 'boss' ? 4 : 0 ) - ( f.data.rarity === 'rare' ? 2 : 0 ) + f.lifeFrac;
			if ( score < best ) {

				best = score;
				target = f;

			}

		}

		if ( target && world.layout.hasLineOfSight( p.x, p.z, target.x, target.z ) ) {

			count( 'fight' );
			const d = p.distTo( target );
			inp.aim.x = target.x; inp.aim.z = target.z;
			const reach = p.radius + target.radius + 1.6;
			if ( d > reach ) moveToward( target.x, target.z, reach );
			else {

				inp.move.x = inp.move.z = 0;
				inp.held.add( 'attack' );

			}

			if ( skills && p.mana > p.maxMana * 0.3 && world.frame % 20 === 0 ) {

				const slot = 'skill' + ( 1 + ( Math.floor( world.time * 0.7 ) % 6 ) );
				inp.held.add( slot );
				inp.pressed.add( slot );
				st.skillUses ++;

			}

			return;

		}

		if ( target ) {

			count( 'chase' );
			moveToward( target.x, target.z, 1.5 );
			return;

		}

		// 4. loot
		if ( loot ) {

			const item = world.spatial.nearest( p.x, p.z, 14, ( e ) => e.kind === 'loot' && ! e.data.picked );
			if ( item ) {

				count( 'loot' );
				if ( moveToward( item.x, item.z, 0.6 ) ) {

					inp.pressed.add( 'interact' );
					st.picked ++;
					item.data.botTried = ( item.data.botTried || 0 ) + 1;
					if ( item.data.botTried > 30 ) item.data.picked = true; // give up on unreachable / filtered loot

				}

				return;

			}

		}

		// 5. exit, else explore
		if ( st.exit ) {

			count( 'exit' );
			if ( moveToward( st.exit.x, st.exit.z, 0.3 ) ) inp.pressed.add( 'interact' );
			return;

		}

		if ( explore ) {

			count( 'explore' );
			if ( ! st.goal || st.visited.has( st.goal.key ) || world.time - st.goalAt > 12 ) {

				st.goal = farthestUnvisited( world.layout, p, st.visited, world.rng );
				st.goalAt = world.time;

			}

			if ( st.goal ) moveToward( st.goal.x, st.goal.z, 1 );

		}

	}

	return {
		step( dt ) {

			step( dt );

		},
		report() {

			offExit();
			const world = w(), s = world.stats, t = world.time - st.startTime;
			return {
				depth: game.save.depth, area: world.spec?.name, areaLevel: world.level, seconds: +t.toFixed( 1 ),
				alive: !! world.player?.alive, complete: !! world.state.complete, exitOpened: !! st.exit,
				kills: s.kills, deaths: s.deaths, dps: Math.round( s.damageDealt / Math.max( 1, t ) ), damageTaken: Math.round( s.damageTaken ),
				levelsGained: game.save.level - st.startLevel, gold: game.save.gold - st.startGold,
				dodges: st.dodges, potions: st.potions, pickups: st.picked, skillUses: st.skillUses,
				enemiesLeft: world.entities.filter( ( e ) => e.alive && e.team === TEAM.ENEMY ).length,
				explored: st.visited.size, decisions: st.decisions
			};

		}
	};

}

const BLOCK = new Set( [ 0, 2, 3, 4 ] );

// A* on the tile grid (8-way, no corner cutting). Returns world-space waypoints.
export function astar( L, x0, z0, x1, z1, maxNodes = 20000 ) {

	const [ sx, sz ] = L.toTile( x0, z0 ), [ gx, gz ] = L.toTile( x1, z1 );
	if ( ! L.inside( gx, gz ) ) return null;
	const W = L.w, N = W * L.h;
	const g = new Float32Array( N ).fill( Infinity ), came = new Int32Array( N ).fill( - 1 ), closed = new Uint8Array( N );
	const open = [ sz * W + sx ];
	g[ sz * W + sx ] = 0;
	const hcost = ( i ) => Math.hypot( ( i % W ) - gx, Math.floor( i / W ) - gz );
	const f = new Float32Array( N ).fill( Infinity );
	f[ sz * W + sx ] = hcost( sz * W + sx );
	const walk = ( tx, tz ) => L.inside( tx, tz ) && ! BLOCK.has( L.get( tx, tz ) );
	let expanded = 0;
	while ( open.length && expanded ++ < maxNodes ) {

		let bi = 0;
		for ( let i = 1; i < open.length; i ++ ) if ( f[ open[ i ] ] < f[ open[ bi ] ] ) bi = i;
		const cur = open[ bi ];
		open[ bi ] = open[ open.length - 1 ];
		open.pop();
		if ( closed[ cur ] ) continue;
		closed[ cur ] = 1;
		const cx = cur % W, cz = Math.floor( cur / W );
		if ( cx === gx && cz === gz ) {

			const path = [];
			for ( let i = cur; i !== - 1 && i !== sz * W + sx; i = came[ i ] ) {

				const [ wx, wz ] = L.toWorld( i % W, Math.floor( i / W ) );
				path.push( { x: wx, z: wz } );

			}

			return path.reverse();

		}

		for ( let dz = - 1; dz <= 1; dz ++ ) for ( let dx = - 1; dx <= 1; dx ++ ) {

			if ( ! dx && ! dz ) continue;
			const nx = cx + dx, nz = cz + dz;
			if ( ! walk( nx, nz ) ) continue;
			if ( dx && dz && ( ! walk( cx + dx, cz ) || ! walk( cx, cz + dz ) ) ) continue;
			const ni = nz * W + nx;
			if ( closed[ ni ] ) continue;
			const ng = g[ cur ] + ( dx && dz ? 1.4142 : 1 );
			if ( ng < g[ ni ] ) {

				g[ ni ] = ng;
				f[ ni ] = ng + hcost( ni );
				came[ ni ] = cur;
				open.push( ni );

			}

		}

	}

	return null;

}

function farthestUnvisited( L, p, visited, rng ) {

	let best = null, bd = - 1;
	for ( let i = 0; i < 40; i ++ ) {

		const q = L.randomFloor( rng );
		const key = L.toTile( q.x, q.z ).join( ',' );
		if ( visited.has( key ) ) continue;
		const d = Math.hypot( q.x - p.x, q.z - p.z );
		if ( d > bd ) {

			bd = d;
			best = { ...q, key };

		}

	}

	return best;

}
