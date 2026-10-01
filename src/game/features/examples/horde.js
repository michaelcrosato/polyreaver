// HORDE - an example of a DIFFERENT GAME MODE built only from the registry, in one
// small file. It is here for people and AI agents who want to make something else
// with the engine: wave survival instead of exploration, same monsters, loot, skills
// and renderer, nothing in the other features changed.
//
// How it plugs in:
//   1. a level SPEC with `mode: 'horde'` (arena generator, no mechanics)    -> game.enterLevel( spec )
//   2. a worldHook (order 80) that runs before the monsters' director (90): it marks
//      the world as populated, so the director stands down, and moves the player
//      into the arena
//   3. a system (order 91) - the wave director: when a wave is dead, the next one
//      rises around the arena edge; every third wave brings a rare; after the last
//      wave a composed boss; its death opens the exit (the world feature's flow
//      does that for any boss)
//   4. an apiCommand 'mode.horde' so agents and the UI start it the same way
//
//   game.api( 'mode.horde', { waves: 8, level: 12 } )
//
// Everything else - drops, XP, the HUD, the bot - already works, because a horde
// world is an ordinary level world.

import { define, all } from '../../core/registry.js';
import { RNG } from '../../core/rng.js';
import { spawnMonster, spawnBoss, composeBoss, familiesFor } from '../monsters/sim.js';
import { engage } from '../monsters/brain.js';

const WAVE_GAP = 4; // seconds between a cleared wave and the next

export function hordeSpec( game, { waves = 10, level = null, theme = null, seed = null } = {} ) {

	// no `depth`: the run keeps your campaign depth; record / progress keep the
	// clear out of the campaign's best times and depth unlocks (world flow)
	const depth = Math.max( 1, game.save.maxDepth ?? game.save.depth ?? 1 );
	const themes = all( 'theme' ).filter( ( t ) => t.id !== 'town' );
	const rng = new RNG( `horde:${seed ?? game.save.level}:${depth}` );
	return {
		id: 'horde', name: 'Horde', mode: 'horde', familyDepth: depth, level: level ?? Math.max( 1, game.save.level ),
		generator: 'arena', theme: theme ?? rng.pick( themes ).id, mechanics: [], families: [], boss: null, waves,
		record: 'horde', progress: false, seed: seed ?? `horde:${game.runSeed}:${game.save.level}`
	};

}

define( 'worldHook', { id: 'example-horde', order: 80, onWorld( game, world ) {

	const spec = world.spec;
	if ( world.kind !== 'level' || spec?.mode !== 'horde' ) return;
	world.state.populated = true; // the monsters' director skips populated worlds
	if ( world.state.flow ) world.state.flow.hold = true; // no "level cleared" exit between waves
	const L = world.layout;
	const arena = L.rooms.find( ( r ) => r.kind === 'boss' ) || L.rooms[ 0 ];
	const [ cx, cz ] = L.toWorld( arena.x + ( arena.w - 1 ) / 2, arena.z + ( arena.h - 1 ) / 2 );
	world.player.x = world.player.px = cx;
	world.player.z = world.player.pz = cz + 3;
	world.state.horde = {
		wave: 0, waves: spec.waves ?? 10, next: world.time + WAVE_GAP, alive: [], boss: null, arena, cx, cz,
		radius: Math.max( 6, Math.min( arena.w, arena.h ) * L.cell / 2 - 2 ),
		families: familiesFor( spec, spec.familyDepth, spec.seed ).map( ( f ) => f.id ),
		rng: new RNG( `horde:${world.seed}` )
	};
	world.events.emit( 'objective', { id: 'horde', text: `Survive ${world.state.horde.waves} waves` } );

} } );

define( 'system', { id: 'example-horde', order: 91, update( world ) {

	const H = world.state.horde;
	if ( ! H || H.boss || ! world.player?.alive ) return;
	H.alive = H.alive.filter( ( e ) => e.alive );
	if ( H.alive.length ) {

		if ( world.frame % 30 === 0 ) world.events.emit( 'objective', { id: 'horde', text: `Wave ${H.wave} / ${H.waves} - ${H.alive.length} left` } );
		return;

	}

	if ( H.wave && H.next < world.time - 0.1 ) H.next = world.time + WAVE_GAP; // wave just cleared: breathe
	if ( world.time < H.next ) return;
	H.wave ++;
	const level = world.level + Math.floor( H.wave / 3 );
	if ( H.wave > H.waves ) {

		const def = composeBoss( `${world.seed}:horde-boss`, world.spec.familyDepth + 5 );
		H.boss = spawnBoss( world, def, { x: H.cx, z: H.cz - H.radius * 0.5, level: level + 2, arena: { x: H.cx, z: H.cz, r: H.radius + 2, room: H.arena.id } } );
		world.events.emit( 'objective', { id: 'horde', text: `Final wave: ${H.boss?.name ?? 'the champion'}` } );
		return;

	}

	// a ring of spawns around the arena edge, away from the player
	const count = 5 + H.wave * 2, p = world.player;
	for ( let i = 0; i < count; i ++ ) {

		const a = H.rng.range( 0, Math.PI * 2 );
		let x = H.cx + Math.sin( a ) * H.radius, z = H.cz + Math.cos( a ) * H.radius;
		if ( ! world.layout.isWalkable( x, z ) || Math.hypot( x - p.x, z - p.z ) < 6 ) {

			( { x, z } = world.layout.randomFloor( H.rng, { room: H.arena } ) );

		}

		const rarity = i === 0 && H.wave % 3 === 0 ? 'rare' : H.rng.chance( 0.08 + H.wave * 0.02 ) ? 'magic' : 'normal';
		const m = spawnMonster( world, { family: H.rng.pick( H.families ), level, rarity, x, z, rng: H.rng } );
		if ( ! m ) continue;
		m.data.spawnUntil = world.time + 0.8; // rise out of the ground
		if ( m.data.brain ) engage( world, m, m.data.brain, p ); // waves come straight for you
		H.alive.push( m );

	}

	world.events.emit( 'objective', { id: 'horde', text: `Wave ${H.wave} / ${H.waves} - ${H.alive.length} left` } );
	world.events.emit( 'ambush', { x: H.cx, z: H.cz, count: H.alive.length } );

} } );

define( 'apiCommand', { id: 'mode.horde', desc: 'Start a Horde run: wave survival in an arena, then a boss (example game mode)', args: { waves: 'number of waves (10)', level: 'monster level (character level)', theme: 'theme id?', seed: 'seed?' },
	run( game, args = {} ) {

		const world = game.enterLevel( hordeSpec( game, args ) );
		return { name: world.spec.name, theme: world.spec.theme, level: world.level, waves: world.state.horde?.waves, families: world.state.horde?.families };

	} } );
