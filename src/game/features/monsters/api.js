// The monsters feature's public surface - for the tools feature (agent API,
// Workshop labs, contact sheets), for other features and for people at the
// browser console. Everything returns plain JSON.
//
//   spawnMonster( world, { family, level, rarity, affixes, archetype, x, z, genome } )  factory.js
//   spawnBoss( world, bossIdOrDef, { x, z, level, arena, dormant } )                       bosses.js
//   composeFamily( seed, depth, opts ) / composeBoss( seed, depth, opts )                   compose.js
//   describeFamily( id|def ) / describeBoss( id|def ) / describeMonster( entity )
//   listFamilies( { depth, tags } ) / catalog()
//
// It also registers 'apiCommand' defs ( monsters.* ) that game.api( id, args ) runs.

import { define, get, all, query } from '../../core/registry.js';
import { spawnMonster, familyArchetypes, loadoutFor, RARITY } from './factory.js';
import { spawnBoss, describeBoss } from './bosses.js';
import { composeFamily, composeBoss } from './compose.js';
import { familiesFor, bossFor } from './director.js';
import { describeArchetype } from './archetypes.js';
import { ringPoint, aiRng } from './util.js';

export { spawnMonster, spawnBoss, composeFamily, composeBoss, describeBoss, familiesFor, bossFor };

export function describeFamily( f ) {

	const fam = typeof f === 'object' ? f : get( 'monsterFamily', f );
	if ( ! fam ) return null;
	return {
		id: fam.id, name: fam.name, desc: fam.desc, element: fam.element, procedural: !! fam.procedural, tags: fam.tags,
		depths: fam.depths, themes: fam.themes, mechanics: fam.mechanics, genome: fam.genome, palette: fam.palette,
		archetypes: familyArchetypes( fam ).map( ( a ) => ( { id: a.id, weight: a.weight, abilities: loadoutFor( fam, get( 'archetype', a.id ) ) } ) ),
		abilities: fam.abilities, pack: fam.pack, minion: fam.minion || null, affixPool: fam.affixPool || []
	};

}

export function describeMonster( e, world = null ) {

	if ( ! e ) return null;
	const now = world?.time ?? 0;
	const b = e.data.brain;
	return {
		...e.describe(), family: e.data.family, archetype: e.data.archetype, rarity: e.data.rarity, element: e.data.element,
		affixes: e.data.affixes || [], abilities: e.data.abilities || [], damage: e.data.damage?.map( ( v ) => +v.toFixed( 1 ) ),
		xp: +( e.data.xp ?? 0 ).toFixed( 1 ), lootMult: e.data.lootMult, shield: Math.round( e.shield ),
		genome: e.model?.genome ? { plan: e.model.genome.plan, size: +( e.model.genome.size ?? 1 ).toFixed( 2 ), seed: e.model.genome.seed } : null,
		brain: b ? { state: b.state, target: b.target?.id ?? null, waiting: !! b.waiting, phase: e.data.phase ?? null, phaseName: e.data.phaseName ?? null, enraged: !! e.data.enraged } : null,
		cooldowns: Object.fromEntries( [ ...e.cooldowns ].map( ( [ k, t ] ) => [ k, +Math.max( 0, t - now ).toFixed( 2 ) ] ) )
	};

}

export function listFamilies( { depth = null, tags = [], procedural = false } = {} ) {

	return query( 'monsterFamily', { tags, filter: ( f ) => ( procedural || ! f.procedural ) && ( depth === null || f.depths?.includes( depth ) ) } )
		.map( ( f ) => ( { id: f.id, name: f.name, element: f.element, depths: f.depths, archetypes: Object.keys( f.archetypes || {} ) } ) );

}

export function catalog() {

	const ids = ( kind ) => all( kind ).map( ( d ) => d.id );
	return {
		families: listFamilies().length, archetypes: all( 'archetype' ).map( describeArchetype ), abilities: ids( 'monsterAbility' ),
		affixes: all( 'monsterAffix' ).map( ( a ) => ( { id: a.id, name: a.name, tags: a.tags, level: a.level } ) ),
		bosses: all( 'boss' ).filter( ( b ) => ! b.procedural && ! b.remix ).map( ( b ) => ( { id: b.id, name: b.name, title: b.title, depth: b.depth, mechanic: b.mechanic } ) ),
		patterns: all( 'bossPattern' ).map( ( p ) => ( { id: p.id, name: p.name, tags: p.tags } ) ), rarities: Object.keys( RARITY )
	};

}

// --- agent commands ------------------------------------------------------------------------------

const cmd = ( def ) => define( 'apiCommand', def );
const near = ( world, x, z ) => {

	const p = world.player || { x: 0, z: 0 };
	if ( x !== undefined && z !== undefined ) return { x, z };
	return ringPoint( world, aiRng( world ), p.x, p.z, 4, 8 ) || { x: p.x + 5, z: p.z };

};

cmd( { id: 'monsters.catalog', desc: 'Every archetype, ability, affix, designed boss and boss pattern.', args: {}, run: () => catalog() } );

cmd( { id: 'monsters.families', desc: 'Designed monster families (filter by depth / tags; procedural: true includes composed ones).', args: { depth: 'number?', tags: 'string[]?', procedural: 'boolean?' },
	run: ( game, a = {} ) => listFamilies( a ) } );

cmd( { id: 'monsters.family', desc: 'Full description of one family: genome constraints, archetypes with loadouts, palette.', args: { id: 'string' },
	run: ( game, a ) => describeFamily( a.id ) } );

cmd( { id: 'monsters.compose', desc: 'Compose (and register) a procedural family from a seed and depth.', args: { seed: 'string', depth: 'number', element: 'string?', plan: 'string?' },
	run: ( game, a ) => describeFamily( composeFamily( a.seed ?? 'agent', a.depth ?? 25, a ) ) } );

cmd( { id: 'monsters.composeBoss', desc: 'Compose (and register) a procedural boss from a seed and depth.', args: { seed: 'string', depth: 'number', mechanics: 'string[]?' },
	run: ( game, a ) => describeBoss( composeBoss( a.seed ?? 'agent', a.depth ?? 25, { mechanics: a.mechanics || [] } ) ) } );

cmd( { id: 'monsters.boss', desc: 'Describe a boss def (designed id, or a level\'s boss with depth).', args: { id: 'string?', depth: 'number?' },
	run: ( game, a ) => describeBoss( a.id || bossFor( game.levelSpec?.( a.depth ?? 1 ) || {}, a.depth ?? 1 ) ) } );

cmd( { id: 'monsters.spawn', desc: 'Spawn monsters near the player: { family, rarity, level, affixes, archetype, count, x, z }.', args: { family: 'string?', rarity: 'string?', level: 'number?', count: 'number?' },
	run( game, a = {} ) {

		const w = game.world;
		const out = [];
		for ( let i = 0; i < Math.min( 50, a.count ?? 1 ); i ++ ) {

			const p = near( w, a.x, a.z );
			const m = spawnMonster( w, { ...a, x: p.x, z: p.z, level: a.level ?? w.level } );
			if ( m ) out.push( describeMonster( m, w ) );

		}

		return out;

	} } );

cmd( { id: 'monsters.spawnBoss', desc: 'Spawn a boss near the player: { id } or a composed one with { seed, depth }; dormant: false starts the fight.', args: { id: 'string?', seed: 'string?', depth: 'number?' },
	run( game, a = {} ) {

		const w = game.world;
		const def = a.id ? get( 'boss', a.id ) : composeBoss( a.seed ?? 'agent', a.depth ?? w.level );
		const p = near( w, a.x, a.z );
		const b = spawnBoss( w, def, { x: p.x, z: p.z, level: a.level ?? w.level, dormant: a.dormant ?? false, arena: { x: p.x, z: p.z, r: 12 } } );
		return b ? describeMonster( b, w ) : null;

	} } );

cmd( { id: 'monsters.inspect', desc: 'Monster detail: brain state, abilities, affixes, cooldowns.', args: { id: 'number' },
	run( game, a ) {

		return describeMonster( game.world?.byId.get( a.id ), game.world );

	} } );

cmd( { id: 'monsters.encounter', desc: 'The encounter director\'s view of this level: families, boss, packs, exit.', args: {},
	run( game ) {

		const w = game.world, D = w?.state.director;
		if ( ! D ) return null;
		const alive = w.entities.filter( ( e ) => e.alive && ( e.kind === 'monster' || e.kind === 'boss' ) );
		const rarities = {};
		for ( const e of alive ) rarities[ e.data.rarity ] = ( rarities[ e.data.rarity ] || 0 ) + 1;
		return {
			depth: D.depth, level: D.level, families: D.families.map( ( f ) => f.id ), boss: D.boss ? { id: D.boss.id, def: D.bossDef?.id, name: D.boss.name, alive: D.boss.alive, phase: D.boss.data.phase ?? - 1 } : null,
			packs: D.packs, spawned: D.spawned, alive: alive.length, rarities, ambushesLeft: D.ambushes.length, exitOpen: w.state.exitOpen || null
		};

	} } );
