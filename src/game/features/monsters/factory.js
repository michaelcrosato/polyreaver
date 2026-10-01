// The monster factory: ONE function turns data (family + archetype + rarity +
// affixes + level, or a ready genome) into a living Entity. Every spawner - the
// encounter director, summons, splitters, boss adds, agent tools, the Workshop -
// goes through spawnMonster(), so a monster always has the same parts:
//
//   genome      Spore-style body DNA from the family's constraints ( generateGenome )
//   body        radius / height / mass / reach / speed from genomeMetrics( genome )
//   stats       MONSTER_BASE × monsterScaling( level ) × archetype × family × rarity
//   brain       controller 'monster' running the archetype ( brain.js )
//   abilities   archetype core + family abilities that fit the archetype's roles
//   affixes     elite modifiers (magic 1-2, rare 3-4, unique 3) with visible tells
//   rewards     data.xp, data.rarity, data.lootMult (progression turns them into loot)
//   model       { type: 'creature', genome, tint, glow, rarity, affixes } for the rig renderer

import { get, all, query } from '../../core/registry.js';
import { Entity } from '../../core/entity.js';
import { TEAM, monsterScaling } from '../../core/tuning.js';
import { RNG } from '../../core/rng.js';
import { MONSTER_BASE } from '../../game.js';
import { generateGenome, mutateGenome, genomeMetrics } from '../creatures/genome.js';
import { memberName, rareName, uniqueName } from './names.js';
import { makePack } from './packs.js';
import { RARITY_COLOR, ringPoint } from './util.js';

// Average monster hit at level 1 before archetype / family multipliers.
export const BASE_HIT = [ 4.4, 6.6 ];

// Rarity: how much tougher, how many affixes, how rewarding. Bosses get their
// multipliers from their boss def instead ( bosses.js ).
export const RARITY = {
	normal: { life: 1, damage: 0, size: 1, xp: 1, loot: 1, affixes: [ 0, 0 ], stun: 1 },
	magic: { life: 2.3, damage: 20, size: 1.1, xp: 3, loot: 2.5, affixes: [ 1, 2 ], stun: 1.6 },
	rare: { life: 4.8, damage: 40, size: 1.22, xp: 7, loot: 6, affixes: [ 3, 4 ], stun: 2.4 },
	unique: { life: 7, damage: 55, size: 1.35, xp: 12, loot: 12, affixes: [ 3, 3 ], stun: 3 },
	boss: { life: 1, damage: 0, size: 1, xp: 40, loot: 30, affixes: [ 0, 0 ], stun: 99 }
};

// genomeMetrics() with every field guaranteed: the creatures feature owns the
// genome internals, so the factory never trusts a field to be present.
export function metricsOf( genome ) {

	const m = genomeMetrics( genome ) || {};
	const s = genome.size ?? 1;
	const num = ( v, d ) => Number.isFinite( v ) && v > 0 ? v : d;
	return {
		radius: num( m.radius, 0.45 * s ), height: num( m.height, 1.7 * s ), mass: num( m.mass, Math.pow( s, 2.2 ) ),
		reach: num( m.reach, 1.1 * s ), speedMul: num( m.speedMul, 1 / Math.sqrt( s ) ), flying: !! m.flying,
		attackStyles: Array.isArray( m.attackStyles ) ? m.attackStyles : [ 'claw' ]
	};

}

export function spawnRng( world ) {

	return world.state.spawnRng || ( world.state.spawnRng = world.rng.fork( 'monsters' ) );

}

// A family def from an id, a def, or (missing) the best fallback for this level.
export function resolveFamily( family, level = 1 ) {

	if ( family && typeof family === 'object' ) return family;
	const f = family ? get( 'monsterFamily', family ) : null;
	if ( f ) return f;
	const pool = query( 'monsterFamily', { level, none: [ 'procedural' ] } );
	return pool.sort( ( a, b ) => ( b.level ?? 1 ) - ( a.level ?? 1 ) )[ 0 ] || all( 'monsterFamily' )[ 0 ];

}

export function familyArchetypes( fam ) {

	return Object.entries( fam.archetypes || { brawler: 1 } ).map( ( [ id, weight ] ) => ( { id, weight } ) ).filter( ( a ) => get( 'archetype', a.id ) );

}

// Ability loadout: an explicit per-archetype list, or the archetype's core abilities
// plus the family abilities whose roles match the archetype (Spore-style: the
// family brings the verbs, the archetype decides which ones this body uses).
export function loadoutFor( fam, arch ) {

	if ( fam.loadouts?.[ arch.id ] ) return fam.loadouts[ arch.id ].slice();
	const out = [ ...( arch.core || [] ) ];
	for ( const id of fam.abilities || [] ) {

		const ab = get( 'monsterAbility', id );
		if ( ! ab || out.includes( id ) ) continue;
		if ( ab.roles.some( ( r ) => arch.roles.includes( r ) ) ) out.push( id );

	}

	if ( out.length === 0 && arch.fallback ) out.push( arch.fallback( fam ) );
	return out.slice( 0, arch.maxAbilities ?? 4 );

}

export function spawnMonster( world, opts = {} ) {

	const level = Math.max( 1, Math.round( opts.level ?? world.level ?? 1 ) );
	const fam = resolveFamily( opts.family, level );
	if ( ! fam ) return null;
	const rng = opts.rng || spawnRng( world );
	const rarity = RARITY[ opts.rarity ] ? opts.rarity : 'normal';
	const R = RARITY[ rarity ];
	const archId = opts.archetype && get( 'archetype', opts.archetype ) ? opts.archetype : rng.weighted( familyArchetypes( fam ) )?.id || 'brawler';
	const arch = get( 'archetype', archId );

	// --- body ---
	let genome = opts.genome;
	if ( ! genome ) {

		const g = fam.genome || {};
		const [ s0, s1 ] = g.size || [ 0.9, 1.1 ];
		const size = rng.range( s0, s1 ) * ( arch.size ?? 1 ) * R.size * ( opts.size ?? 1 );
		const plans = arch.plans ? ( g.plans || [ 'biped' ] ).filter( ( p ) => arch.plans.includes( p ) ) : null;
		genome = generateGenome( new RNG( rng.int( 1, 2 ** 31 - 1 ) ), {
			plan: rng.pick( plans?.length ? plans : g.plans || [ 'biped' ] ), size, palette: fam.palette, level,
			tags: [ ...( g.tags || [] ), ...( arch.genomeTags || [] ), fam.element ].filter( Boolean )
		} );
		if ( rarity === 'rare' || rarity === 'unique' ) genome = mutateGenome( genome, new RNG( rng.int( 1, 2 ** 31 - 1 ) ), rarity === 'unique' ? 0.3 : 0.15 );

	}

	const M = metricsOf( genome );
	const e = new Entity( { kind: 'monster', team: TEAM.ENEMY, level, x: opts.x ?? 0, z: opts.z ?? 0, radius: M.radius, height: M.height, mass: M.mass } );
	e.facing = rng.range( - Math.PI, Math.PI );

	// --- stats ---
	const sc = monsterScaling( level );
	const A = arch.stats || {}, F = fam.stats || {};
	const S = e.stats;
	for ( const k in MONSTER_BASE ) S.base[ k ] = MONSTER_BASE[ k ];
	S.base.life = MONSTER_BASE.life * sc.life * ( A.life ?? 1 ) * ( F.life ?? 1 ) * R.life * ( opts.lifeMult ?? 1 );
	S.base.armor = sc.armor * ( A.armor ?? 1 ) * ( F.armor ?? 1 );
	S.base.move_speed = MONSTER_BASE.move_speed * M.speedMul * ( A.speed ?? 1 ) * ( F.speed ?? 1 );
	S.base.damage_taken = 1;
	S.base.stun_threshold = MONSTER_BASE.stun_threshold * R.stun * ( A.poise ?? 1 );
	for ( const t of [ 'fire', 'cold', 'lightning', 'chaos' ] ) S.base[ 'res_' + t ] = sc.res + ( t === fam.element ? 30 : 0 ) + ( F.res?.[ t ] ?? 0 );
	if ( R.damage ) S.setSource( 'rarity', [ { stat: 'damage', type: 'more', value: R.damage } ] );
	if ( arch.mods ) S.setSource( 'archetype', arch.mods );
	const hit = ( A.damage ?? 1 ) * ( F.damage ?? 1 ) * sc.damage;
	e.data.damage = [ BASE_HIT[ 0 ] * hit, BASE_HIT[ 1 ] * hit ];

	// --- identity & rewards ---
	Object.assign( e.data, {
		family: fam.id, archetype: arch.id, rarity, element: fam.element || 'physical', plan: genome.plan,
		reach: M.reach, flying: M.flying, attackStyles: M.attackStyles,
		xp: 12 * sc.xp * ( A.xp ?? 1 ) * ( F.xp ?? 1 ) * R.xp * ( opts.summoned ? 0.3 : 1 ),
		lootMult: R.loot * ( A.loot ?? 1 ) * ( opts.summoned ? 0.3 : 1 ),
		minionFamily: fam.minion || fam.id, minionArchetype: fam.minionArchetype,
		accel: Math.max( 10, Math.min( 45, 34 / Math.sqrt( Math.max( 0.3, M.mass ) ) ) ),
		turnRate: Math.max( 4, 16 / Math.max( 1, Math.sqrt( M.mass ) ) ),
		home: { x: e.x, z: e.z }, summoned: !! opts.summoned, salt: rng.int( 0, 65535 )
	} );
	e.tags.add( 'monster' );
	for ( const t of fam.tags ) e.tags.add( t );
	for ( const t of arch.tags ) e.tags.add( t );
	if ( opts.summoned ) e.tags.add( 'summoned' );

	e.name = opts.name || ( rarity === 'rare' ? rareName( rng, e.data.element ) : rarity === 'unique' ? uniqueName( rng, e.data.element, genome.plan ) : memberName( fam, arch.id ) );
	e.model = { type: 'creature', genome, rarity, glow: rarity === 'normal' ? null : RARITY_COLOR[ rarity ], tint: null, affixes: [] };
	if ( opts.tint ) e.model.tint = opts.tint;

	// --- abilities and affixes ---
	e.data.abilities = opts.abilities || loadoutFor( fam, arch );
	const [ a0, a1 ] = R.affixes;
	const count = opts.affixCount ?? ( a1 ? rng.int( a0, a1 ) + ( rarity === 'rare' && level >= 40 ? 1 : 0 ) : 0 );
	const affixes = opts.affixes || ( count ? rollAffixes( rng, count, { level, family: fam, archetype: arch } ) : [] );
	applyAffixes( world, e, affixes );

	// --- brain ---
	const ctl = get( 'controller', opts.controller || 'monster' );
	e.controller = ctl ? ctl.create( world.game, e ) : null;
	e.data.spawnUntil = opts.summoned || opts.rise ? world.time + 0.6 : 0;

	installHooks( world );
	if ( opts.summoned ) world.state.summoned = ( world.state.summoned ?? 0 ) + 1;
	if ( opts.add !== false ) world.add( e );
	e.life = e.maxLife;

	// rares and uniques lead a pack of minions of their family
	const minions = opts.minions ?? ( rarity === 'rare' ? rng.int( 2, 4 ) : rarity === 'unique' ? rng.int( 3, 5 ) : 0 );
	if ( minions && opts.add !== false && ! opts.summoned ) {

		e.data.minions = [];
		for ( let i = 0; i < minions; i ++ ) {

			const p = ringPoint( world, rng, e.x, e.z, 1.5, 3.5 ) || { x: e.x, z: e.z };
			const m = spawnMonster( world, { family: fam, level, rarity: 'normal', x: p.x, z: p.z, rng, minions: 0 } );
			if ( m ) e.data.minions.push( m );

		}

		if ( ! opts.pack ) makePack( world, [ e, ...e.data.minions ], { kind: 'elite', leader: e } );

	}

	return e;

}

// --- affixes -------------------------------------------------------------------------
// Rolled by weight from every monsterAffix allowed at this level, respecting
// exclusions ( Hasted excludes Juggernaut... ) and family affinities.

export function rollAffixes( rng, n, { level = 1, family = null, archetype = null, boss = false } = {} ) {

	const out = [];
	const pool = query( 'monsterAffix', { level, filter: ( a ) => ( ! boss || a.boss !== false ) && ( ! a.archetypes || ! archetype || a.archetypes.includes( archetype.id ) ) && ( ! a.notArchetypes || ! archetype || ! a.notArchetypes.includes( archetype.id ) ) } );
	for ( let i = 0; i < n; i ++ ) {

		const options = pool.filter( ( a ) => ! out.includes( a.id ) && ! out.some( ( id ) => get( 'monsterAffix', id ).excludes?.includes( a.id ) || a.excludes?.includes( id ) ) );
		const pick = rng.weighted( options, ( a ) => ( a.weight ?? 1 ) * ( family?.affixPool?.includes( a.id ) ? 4 : 1 ) * ( a.elements && family && ! a.elements.includes( family.element ) ? 0.3 : 1 ) );
		if ( ! pick ) break;
		out.push( pick.id );

	}

	return out;

}

export function applyAffixes( world, e, ids ) {

	e.data.affixes = e.data.affixes || [];
	e.data.affixState = e.data.affixState || {};
	for ( const id of ids ) {

		const a = get( 'monsterAffix', id );
		if ( ! a || e.data.affixes.includes( id ) ) continue;
		e.data.affixes.push( id );
		const st = e.data.affixState[ id ] = {};
		const mods = typeof a.mods === 'function' ? a.mods( e ) : a.mods;
		if ( mods?.length ) e.stats.setSource( 'affix:' + id, mods );
		if ( a.abilities ) for ( const ab of a.abilities ) if ( ! e.data.abilities.includes( ab ) ) e.data.abilities.push( ab );
		if ( a.flags ) for ( const f of a.flags ) e.flags[ f ] = true;
		e.model.affixes.push( { id, color: a.color } );
		if ( a.tint && ! e.model.tint ) e.model.tint = a.tint;
		a.apply?.( world, e, st );

	}

	if ( ids.length && e.model.affixes.length ) e.model.glow = e.model.glow || e.model.affixes[ 0 ].color;

}

// --- per-world hooks ---------------------------------------------------------------------
// Affixes and bosses react to deaths and hits. The listeners are installed once
// per world, the first time a monster is spawned into it.

export const hooks = { death: [], hit: [], block: [] };

export function installHooks( world ) {

	if ( world.state.monsterHooks ) return;
	world.state.monsterHooks = true;
	world.events.on( 'death', ( d ) => {

		const e = d.entity;
		if ( e.data.summoned ) world.state.summoned = Math.max( 0, ( world.state.summoned ?? 1 ) - 1 );
		for ( const id of e.data.affixes || [] ) {

			const a = get( 'monsterAffix', id );
			a?.onDeath?.( world, e, e.data.affixState?.[ id ] || {}, d.killer );

		}

		for ( const fn of hooks.death ) fn( world, d );

	} );
	world.events.on( 'hit', ( h ) => {

		const t = h.target, s = h.source;
		if ( t.data.affixes ) for ( const id of t.data.affixes ) get( 'monsterAffix', id )?.onHurt?.( world, t, t.data.affixState[ id ], h );
		if ( s?.data?.affixes ) for ( const id of s.data.affixes ) get( 'monsterAffix', id )?.onHitDealt?.( world, s, s.data.affixState[ id ], h );
		for ( const fn of hooks.hit ) fn( world, h );

	} );
	world.events.on( 'block', ( ev ) => {

		for ( const fn of hooks.block ) fn( world, ev );

	} );

}

// Deterministic RNG for content that must not depend on spawn order (agent tools).
// ( RNG.fork( label ) derives from the rng's SEED, not its state - forking the same
// rng twice with one label gives the same stream - so per-spawn streams are seeded
// from a draw instead: new RNG( rng.int( ... ) ). )
export const seededRng = ( ...parts ) => new RNG( parts.join( ':' ) );
