// The encounter director: who lives in a level, where, in what groups - and when
// the level is done. It replaces the baseline population hook (same worldHook id)
// and runs a system at order 90.
//
// POPULATE (once per level world)
//   1. families   spec.families (ids the world feature chose), else the campaign
//                 families of this depth / theme / mechanics, else composed ones
//   2. boss       spec.boss, else the designed boss of the depth, a remix (13-20)
//                 or a composed boss (21+); placed in the 'boss' room, dormant
//   3. budget     each layout spawn point carries a budget (default 6) × depth
//                 density × tuning.enemyDensity; nothing spawns near the start
//   4. packs      squads, mixed squads, magic-led elites, rares with minions, hordes,
//                 dormant AMBUSH packs and patrolling WANDER packs. PACING: spawns
//                 further along the level (start → boss) get bigger budgets and more
//                 elites, so a level ramps up toward its boss
// RUN (every step)
//   ambush triggers, the exit: boss death (or, without a boss, the last kill) emits
//   'exitOpen { x, z }' - the world feature opens the portal there.

import { define, get, all } from '../../core/registry.js';
import { TEAM } from '../../core/tuning.js';
import { RNG } from '../../core/rng.js';
import { spawnMonster, hooks } from './factory.js';
import { spawnBoss, resolveBoss } from './bosses.js';
import { composeFamily, composeBoss, remixBoss } from './compose.js';
import { makePack } from './packs.js';
import { makeDormant, wake } from './brain.js';
import { ringPoint, telegraph, aiRng } from './util.js';

const MAX_MONSTERS = 200; // initial population cap (phones: ~150 active is the budget)
const norm = ( s ) => String( s ?? '' ).toLowerCase().replace( /[^a-z]/g, '' );
const matches = ( a, b ) => {

	const x = norm( a ), y = norm( b );
	return !! x && !! y && ( x.includes( y ) || y.includes( x ) );

};

// --- what lives here ------------------------------------------------------------------

export function familiesFor( spec = {}, depth = 1, seed = depth ) {

	const known = ( spec.families || [] ).map( ( f ) => typeof f === 'object' ? f : get( 'monsterFamily', f ) ).filter( Boolean );
	if ( known.length ) return known;
	const mech = spec.mechanics || [];
	const designed = all( 'monsterFamily' ).filter( ( f ) => ! f.procedural );
	if ( depth <= 12 ) {

		const byTheme = spec.theme ? designed.filter( ( f ) => f.themes?.some( ( t ) => matches( t, spec.theme ) ) ) : [];
		if ( byTheme.length ) return byTheme;
		const byDepth = designed.filter( ( f ) => f.depths?.includes( depth ) );
		if ( byDepth.length ) return byDepth;

	}

	const byMech = designed.filter( ( f ) => f.mechanics?.some( ( m ) => mech.some( ( x ) => matches( x, m ) ) ) );
	if ( depth <= 20 && byMech.length ) return byMech;
	if ( depth <= 20 ) {

		// a combination level the world did not describe: two neighbouring campaign themes
		const a = designed.filter( ( f ) => f.depths?.includes( ( ( depth - 13 ) % 12 ) + 1 ) ), b = designed.filter( ( f ) => f.depths?.includes( ( ( depth - 7 ) % 12 ) + 1 ) );
		if ( a.length + b.length ) return [ ...a, ...b ];

	}

	// endless: composed families, plus a campaign family echoing one of the mechanics
	const out = [ composeFamily( `${seed}:a`, depth, { mechanics: mech } ), composeFamily( `${seed}:b`, depth, { mechanics: mech } ) ];
	if ( depth > 40 ) out.push( composeFamily( `${seed}:c`, depth, { mechanics: mech } ) );
	if ( byMech.length ) out.push( byMech[ Math.abs( depth ) % byMech.length ] );
	return out;

}

export function bossFor( spec = {}, depth = 1, seed = depth ) {

	if ( spec.boss === null || spec.boss === false ) return null;
	const named = spec.boss ? resolveBoss( spec.boss ) : null;
	if ( named ) return named;
	const mech = spec.mechanics || [];
	const designed = all( 'boss' ).filter( ( b ) => ! b.procedural && ! b.remix );
	const byMech = designed.filter( ( b ) => mech.some( ( m ) => matches( m, b.mechanic ) ) );
	if ( depth <= 12 ) return designed.find( ( b ) => b.depth === depth ) || byMech[ 0 ] || composeBoss( seed, depth, { mechanics: mech } );
	if ( depth <= 20 ) {

		const base = byMech[ depth % Math.max( 1, byMech.length ) ] || designed.find( ( b ) => b.depth === ( ( depth - 1 ) % 12 ) + 1 );
		if ( base ) return remixBoss( base, seed, depth );

	}

	return composeBoss( seed, depth, { mechanics: mech } );

}

// Density grows with depth (capped), so deeper levels are busier, not just tankier.
// Gently: monster stats already scale with level ( monsterScaling ); density, elite
// odds and attack tokens multiply together, so each of them only nudges.
// The first two levels are onboarding: thinner packs while the player learns to dodge.
export const depthDensity = ( depth ) => depth <= 2 ? 0.7 + depth * 0.1 : Math.min( 1.5, 1 + ( depth - 1 ) * 0.01 );

// Elite odds by depth and by how far along the level the pack is (pacing, 0..1).
export function eliteOdds( depth, along = 0.5 ) {

	const k = 0.6 + along * 0.8;
	return {
		magic: Math.min( 0.3, ( 0.12 + depth * 0.005 ) * k ),
		rare: depth <= 1 ? 0 : Math.min( 0.15, ( 0.03 + depth * 0.0025 ) * k ),
		unique: depth >= 3 ? 0.3 : 0
	};

}

// --- populate ---------------------------------------------------------------------------------

export function populate( game, world ) {

	if ( world.kind !== 'level' || world.state.populated ) return;
	world.state.populated = true;
	const spec = world.spec || {};
	const L = world.layout;
	const depth = Math.max( 1, spec.depth ?? game?.save?.depth ?? world.level ?? 1 );
	const level = Math.max( 1, spec.level ?? world.level ?? depth );
	const seed = spec.seed ?? `${game?.runSeed ?? 'run'}:${spec.id ?? depth}`;
	const rng = new RNG( `director:${world.seed}` );
	const D = world.state.director = { depth, level, seed, families: [], boss: null, bossDef: null, ambushes: [], exitOpened: false, packs: 0, spawned: 0 };
	D.families = familiesFor( spec, depth, seed );
	const swarmLevel = ( spec.mechanics || [] ).some( ( m ) => matches( m, 'swarm' ) );

	// the boss, in its room
	const room = L.rooms.find( ( r ) => r.kind === 'boss' );
	D.bossDef = bossFor( spec, depth, seed );
	if ( D.bossDef ) {

		const at = bossSpot( world, room, rng );
		D.boss = spawnBoss( world, D.bossDef, { x: at.x, z: at.z, level, arena: at.arena } );
		D.bossRoom = room || null;

	}

	// the packs
	let spawns = L.spawns.filter( ( s ) => ! inRoom( L, s, room ) && Math.hypot( s.x - L.start.x, s.z - L.start.z ) > 9 );
	if ( ! spawns.length ) spawns = fallbackSpawns( world, rng, room );
	const far = Math.max( 1, ...spawns.map( ( s ) => Math.hypot( s.x - L.start.x, s.z - L.start.z ) ) );
	const density = world.tuning.enemyDensity * depthDensity( depth );
	let uniqueLeft = rng.chance( eliteOdds( depth ).unique ) ? 1 : 0;
	for ( const s of rng.shuffle( spawns.slice() ) ) {

		if ( D.spawned >= MAX_MONSTERS ) break;
		const along = Math.hypot( s.x - L.start.x, s.z - L.start.z ) / far;
		const budget = ( s.budget ?? 6 ) * density * ( 0.8 + along * 0.45 );
		const unique = uniqueLeft && along > 0.5 ? uniqueLeft -- : 0;
		spawnPack( world, D, s, budget, along, rng, { unique, swarmLevel } );

	}

	world.events.emit( 'objective', { text: D.boss ? `Find and defeat ${D.boss.name}` : 'Clear the level' } );

}

function bossSpot( world, room, rng ) {

	const L = world.layout;
	if ( room ) {

		let [ x, z ] = L.toWorld( room.x + ( room.w - 1 ) / 2, room.z + ( room.h - 1 ) / 2 );
		if ( ! L.isWalkable( x, z ) ) ( { x, z } = L.randomFloor( rng, { room } ) );
		return { x, z, arena: { x, z, r: Math.max( 6, Math.min( room.w, room.h ) * L.cell / 2 - 1 ), room: room.id } };

	}

	// no boss room: the exit (if it is far from the start), else the farthest floor we can find
	let best = L.exit && Math.hypot( L.exit.x - L.start.x, L.exit.z - L.start.z ) > 16 && L.isWalkable( L.exit.x, L.exit.z ) ? { ...L.exit } : null;
	if ( ! best ) {

		let bd = - 1;
		for ( let i = 0; i < 40; i ++ ) {

			const p = L.randomFloor( rng );
			const d = Math.hypot( p.x - L.start.x, p.z - L.start.z );
			if ( d > bd ) {

				bd = d; best = p;

			}

		}

	}

	return { x: best.x, z: best.z, arena: { x: best.x, z: best.z, r: 10 } };

}

function inRoom( L, p, room ) {

	if ( ! room ) return false;
	const [ tx, tz ] = L.toTile( p.x, p.z );
	return tx >= room.x && tx < room.x + room.w && tz >= room.z && tz < room.z + room.h;

}

function fallbackSpawns( world, rng, room ) {

	const L = world.layout;
	let floor = 0;
	for ( let i = 0; i < L.tiles.length; i ++ ) if ( L.tiles[ i ] === 1 ) floor ++;
	const n = Math.max( 3, Math.min( 16, Math.floor( floor / 90 ) ) );
	const out = [];
	for ( let i = 0; i < n * 6 && out.length < n; i ++ ) {

		const p = L.randomFloor( rng, { awayFrom: L.start, minDist: 12 } );
		if ( inRoom( L, p, room ) || out.some( ( o ) => Math.hypot( o.x - p.x, o.z - p.z ) < 7 ) ) continue;
		out.push( { x: p.x, z: p.z, budget: 4 } );

	}

	return out;

}

// What a monster "costs" from a spawn budget.
function costOf( m ) {

	const arch = m.data.archetype;
	const base = arch === 'swarmer' ? 0.4 : arch === 'brute' ? 2.2 : arch === 'exploder' ? 0.6 : 1;
	return base * ( m.data.rarity === 'magic' ? 3 : m.data.rarity === 'rare' ? 6 : m.data.rarity === 'unique' ? 10 : 1 );

}

const TEMPLATES = [
	{ id: 'squad', weight: 4 }, { id: 'mixed', weight: 2.5 }, { id: 'horde', weight: 1 }, { id: 'ambush', weight: 1.2 }, { id: 'wander', weight: 1.2 }
];

function spawnPack( world, D, s, budget, along, rng, { unique = 0, swarmLevel = false } ) {

	const fams = D.families;
	if ( ! fams.length ) return;
	const pickFam = ( exclude ) => rng.weighted( fams.filter( ( f ) => f !== exclude ), ( f ) => ( f.weight ?? 1 ) * ( swarmLevel && f.archetypes?.swarmer ? 3 : 1 ) ) || fams[ 0 ];
	const fam = pickFam();
	const tpl = rng.weighted( TEMPLATES, ( t ) => t.weight * ( t.id === 'horde' ? ( fam.archetypes?.swarmer || swarmLevel ? 3 : 0.4 ) : 1 ) ).id;
	const odds = eliteOdds( D.depth, along );
	const members = [];
	let cost = 0;
	const place = () => ringPoint( world, rng, s.x, s.z, 0.5, 3.2 ) || { x: s.x, z: s.z };
	const add = ( opts ) => {

		if ( D.spawned >= MAX_MONSTERS ) return null;
		const p = place();
		const m = spawnMonster( world, { level: D.level, x: p.x, z: p.z, rng, pack: true, ...opts } );
		if ( ! m ) return null;
		members.push( m, ...( m.data.minions || [] ) );
		cost += costOf( m ) + ( m.data.minions || [] ).reduce( ( a, x ) => a + costOf( x ) * 0.6, 0 );
		D.spawned += 1 + ( m.data.minions?.length ?? 0 );
		return m;

	};

	// the leader
	let leader = null;
	if ( unique ) leader = add( { family: fam, rarity: 'unique' } );
	else if ( rng.chance( odds.rare ) && budget >= 5 ) leader = add( { family: fam, rarity: 'rare' } );
	else if ( rng.chance( odds.magic ) ) leader = add( { family: fam, rarity: 'magic' } );

	// the body of the pack
	const [ p0, p1 ] = fam.pack || [ 3, 5 ];
	const size = tpl === 'horde' ? Math.round( rng.int( p0, p1 ) * 1.8 ) : rng.int( p0, p1 );
	const second = tpl === 'mixed' && fams.length > 1 ? pickFam( fam ) : null;
	for ( let i = 0; members.length < size + ( leader ? 1 : 0 ) && cost < budget && i < 40; i ++ ) {

		const f = second && i % 3 === 2 ? second : fam;
		const magic = ! leader && i > 0 && rng.chance( odds.magic * 0.25 );
		add( { family: f, rarity: magic ? 'magic' : 'normal', archetype: tpl === 'horde' && f.archetypes?.swarmer ? 'swarmer' : undefined, minions: 0 } );

	}

	if ( ! members.length ) return;
	const kind = tpl === 'wander' ? 'wander' : tpl === 'ambush' ? 'ambush' : leader ? 'elite' : 'squad';
	const pack = makePack( world, members, { kind, leader: leader || members[ 0 ], x: s.x, z: s.z } );
	D.packs ++;
	if ( kind === 'ambush' ) {

		for ( const m of members ) makeDormant( m );
		D.ambushes.push( { pack, x: s.x, z: s.z, radius: 7.5 } );

	}

}

// Wake an ambush pack around the player: emerge points are telegraphed for 0.6 s.
function springAmbush( world, D, amb ) {

	const p = world.player;
	const rng = aiRng( world );
	for ( const m of amb.pack.members ) {

		if ( ! m.alive ) continue;
		const at = ringPoint( world, rng, p.x, p.z, 4, 7 ) || { x: amb.x, z: amb.z };
		telegraph( world, m, null, { x: at.x, z: at.z, radius: m.radius + 0.5, delay: 0.6, fx: 'emerge' } );
		wake( world, m, at.x, at.z, p );

	}

	amb.pack.alerted = true;
	world.events.emit( 'ambush', { x: p.x, z: p.z, count: amb.pack.members.length } );
	world.events.emit( 'sfx', { id: 'ambush', x: p.x, z: p.z, volume: 1 } );

}

// --- run -----------------------------------------------------------------------------------------

function update( world ) {

	const D = world.state.director;
	if ( ! D || D.exitOpened ) return;
	const p = world.player;
	if ( world.frame % 12 === 0 && p?.alive ) {

		for ( let i = D.ambushes.length - 1; i >= 0; i -- ) {

			const a = D.ambushes[ i ];
			if ( Math.hypot( p.x - a.x, p.z - a.z ) > a.radius || ! world.layout.hasLineOfSight( p.x, p.z, a.x, a.z ) ) continue;
			D.ambushes.splice( i, 1 );
			springAmbush( world, D, a );

		}

	}

	// a level without a boss is done when its last monster dies
	if ( ! D.bossDef && world.frame % 30 === 0 ) {

		const left = world.entities.some( ( e ) => e.alive && e.team === TEAM.ENEMY && ( e.kind === 'monster' || e.kind === 'boss' ) );
		if ( ! left ) openExit( world, D, world.layout.exit || p || world.layout.start, 'cleared' );

	}

}

export function openExit( world, D, at, reason ) {

	if ( D.exitOpened ) return;
	D.exitOpened = true;
	let { x, z } = at;
	if ( ! world.layout.isWalkable( x, z ) ) ( { x, z } = world.layout.randomFloor( world.rng, { room: D.bossRoom } ) );
	world.state.exitOpen = { x, z };
	world.events.emit( 'exitOpen', { x, z, reason } );
	world.events.emit( 'objective', { text: reason === 'boss' ? 'The way onward is open' : 'Level cleared - the way onward is open' } );

}

hooks.death.push( ( world, d ) => {

	const D = world.state.director;
	if ( D && d.entity === D.boss ) openExit( world, D, d.entity, 'boss' );

} );

define( 'worldHook', { id: 'baseline-population', order: 90, onWorld: populate } );
define( 'system', { id: 'encounter-director', order: 90, update } );
