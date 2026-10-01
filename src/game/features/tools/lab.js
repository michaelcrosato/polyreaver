// Lab worlds: asset galleries for AI agents and artists. A lab world is a quiet
// arena (no director, no mechanics) with a labelled grid of things to look at -
// every prop model, every loot model, N random genomes, every monster family,
// every boss, one creature frozen in each action. Combined with the 'screenshot'
// command (Claude link) or the Workshop panel, it is how an agent INSPECTS what the
// procedural systems produce: generate -> lay out -> look -> adjust -> repeat.
//
//   game.api( 'lab.genomes', { n: 24, plan: 'arachnid', seed: 7 } )
//   game.api( 'lab.monsters', { depth: 40, n: 12 } )     composed families for depth 40
//   game.api( 'lab.actions', { plan: 'quadruped' } )      one body, every action pose
//
// Entities in a lab are frozen: no controller, `flags.inert` (untargetable by
// effects), optionally a pinned pose ( data.labPose = { state, action, phase, t } ).

import { define, get, all, query } from '../../core/registry.js';
import { Entity } from '../../core/entity.js';
import { RNG } from '../../core/rng.js';
import { TEAM } from '../../core/tuning.js';
import { makeArena } from '../../core/layout.js';
import { generateGenome, genomeMetrics } from '../creatures/genome.js';
import { spawnMonster } from '../monsters/factory.js';
import { spawnBoss } from '../monsters/bosses.js';
import { composeFamily, composeBoss } from '../monsters/compose.js';

const HUMANOID_ACTIONS = [ 'slash', 'thrust', 'overhead', 'spin', 'slam', 'leap', 'dash', 'cast', 'cast_aoe', 'channel', 'shoot', 'throw', 'shout', 'block', 'kick', 'drink' ];
const CREATURE_ACTIONS = [ 'bite', 'claw', 'slam', 'charge', 'spit', 'roar', 'stomp', 'tail', 'leap', 'cast', 'summon', 'burrow', 'breath' ];

// Build a lab world sized for `n` cells and return a placer for grid cells.
export function enterLab( game, { title = 'Workshop', n = 12, spacing = 4 } = {} ) {

	const cols = Math.max( 1, Math.ceil( Math.sqrt( n * 1.6 ) ) ), rows = Math.max( 1, Math.ceil( n / cols ) );
	const cell = 2;
	const w = Math.max( 16, Math.ceil( cols * spacing / cell ) + 6 ), h = Math.max( 16, Math.ceil( rows * spacing / cell ) + 8 );
	const layout = makeArena( w, h, cell );
	layout.start = { x: 0, z: ( rows * spacing ) / 2 + 3 };
	layout.exit = null;
	layout.theme = 'lab';
	const world = game._startWorld( layout, { id: 'lab', name: title, level: 1, generator: 'arena' }, 'lab' );
	world.player.flags.invulnerable = true;
	world.player.controller = null;
	world.state.labels = [];
	world.state.labCamera = { x: 0, z: 0, height: Math.max( cols, rows * 1.4 ) * spacing * 0.9 + 6 };
	const at = ( i ) => ( {
		x: ( ( i % cols ) - ( cols - 1 ) / 2 ) * spacing,
		z: ( Math.floor( i / cols ) - ( rows - 1 ) / 2 ) * spacing
	} );
	return { world, at, cols, rows };

}

function freeze( world, e, label, pose = null ) {

	e.controller = null;
	e.flags.inert = true;
	e.team = TEAM.NEUTRAL;
	e.facing = Math.PI * 0.15;
	if ( pose ) e.data.labPose = pose;
	world.add( e );
	world.state.labels.push( { id: e.id, x: e.x, z: e.z, text: label } );
	return e;

}

const row = ( e, label ) => ( { id: e.id, label, x: +e.x.toFixed( 1 ), z: +e.z.toFixed( 1 ) } );

// pin lab poses after every other system (anim state is recomputed each step)
define( 'system', { id: 'lab-poses', order: 99, update( world ) {

	if ( world.kind !== 'lab' ) return;
	for ( const e of world.entities ) {

		const p = e.data.labPose;
		if ( ! p ) continue;
		Object.assign( e.anim, { state: p.state ?? 'action', action: p.action ?? null, phase: p.phase ?? 'active', t: p.t ?? 0.5, duration: 1, speed: p.speed ?? 0 } );

	}

} } );

const LAB_COMMANDS = [

	{ id: 'lab.models', desc: 'Gallery of part-list models (props, loot, weapons). Filter by ids or tags.', args: { ids: 'array?', tags: 'array?', type: 'prop|loot (default prop)' },
		run( game, { ids, tags = [], type = 'prop' } ) {

			let defs = ids ? ids.map( ( id ) => get( 'model', id ) ).filter( Boolean ) : query( 'model', { tags } );
			defs = defs.slice( 0, 120 );
			const { world, at } = enterLab( game, { title: 'Model gallery', n: defs.length, spacing: 3.5 } );
			return defs.map( ( d, i ) => {

				const p = at( i );
				const e = new Entity( { kind: type, x: p.x, z: p.z, radius: 0.6, solid: false } );
				e.model = { type, id: d.id };
				return row( freeze( world, e, d.id ), d.id );

			} );

		} },

	{ id: 'lab.genomes', desc: 'Contact sheet of N random genomes (Spore-style variety check).', args: { n: 'count (24)', plan: 'body plan?', tags: 'array?', seed: 'seed', size: 'body size' },
		run( game, { n = 24, plan = null, tags = [], seed = 1, size = 1 } ) {

			const rng = new RNG( 'genomes:' + seed );
			const { world, at } = enterLab( game, { title: 'Genome sheet', n, spacing: 4.5 * Math.max( 1, size ) } );
			const out = [];
			for ( let i = 0; i < n; i ++ ) {

				const g = generateGenome( rng, { plan, tags, size } );
				const m = genomeMetrics( g );
				const p = at( i );
				const e = new Entity( { kind: 'monster', x: p.x, z: p.z, radius: m.radius, height: m.height } );
				e.model = { type: 'creature', genome: g };
				out.push( { ...row( freeze( world, e, `${g.plan} #${g.seed % 10000}` ), g.plan ), seed: g.seed, parts: Object.fromEntries( Object.entries( g.parts || {} ).map( ( [ k, v ] ) => [ k, Array.isArray( v ) ? v.map( ( q ) => q?.id ) : v?.id ?? null ] ) ) } );

			}

			return out;

		} },

	{ id: 'lab.monsters', desc: 'Gallery of monster families (designed, or composed for an endless depth), frozen.', args: { families: 'array of ids?', depth: 'compose families for this depth (endless)', n: 'how many', rarity: 'normal|magic|rare' },
		run( game, { families = null, depth = null, n = 12, rarity = 'normal' } ) {

			let list;
			if ( families ) list = families;
			else if ( depth ) list = Array.from( { length: n }, ( _, i ) => composeFamily( `lab:${depth}:${i}`, depth )?.id ).filter( Boolean );
			else list = all( 'monsterFamily' ).slice( 0, n ).map( ( f ) => f.id );
			const { world, at } = enterLab( game, { title: 'Monster gallery', n: list.length, spacing: 5 } );
			return list.map( ( fam, i ) => {

				const p = at( i );
				const e = spawnMonster( world, { family: fam, rarity, level: depth ? depth * 2 : 10, x: p.x, z: p.z, add: false } );
				if ( ! e ) return { family: fam, error: 'spawn failed' };
				const def = get( 'monsterFamily', fam );
				return { ...row( freeze( world, e, def?.name || fam ), fam ), plan: e.model?.genome?.plan };

			} );

		} },

	{ id: 'lab.bosses', desc: 'Gallery of the designed bosses (or composed bosses for endless depths), frozen.', args: { depth: 'compose for this depth instead', n: 'count when composing' },
		run( game, { depth = null, n = 6 } ) {

			const ids = depth ? Array.from( { length: n }, ( _, i ) => composeBoss( `labboss:${depth}:${i}`, depth )?.id ).filter( Boolean ) : all( 'boss' ).map( ( b ) => b.id );
			const { world, at } = enterLab( game, { title: 'Boss gallery', n: ids.length, spacing: 11 } );
			return ids.map( ( id, i ) => {

				const p = at( i );
				const e = spawnBoss( world, id, { x: p.x, z: p.z, level: depth ? depth * 2 : 20, dormant: true } );
				if ( ! e ) return { boss: id, error: 'spawn failed' };
				if ( world.byId.has( e.id ) ) world.remove( e );
				e.data.boss = null;
				return row( freeze( world, e, get( 'boss', id )?.name || id ), id );

			} );

		} },

	{ id: 'lab.actions', desc: 'One body frozen mid-way through every action (animation review). Hero by default.', args: { plan: 'body plan for a creature (omit for the hero)', seed: 'genome seed', t: 'pose time 0..1 (0.5)' },
		run( game, { plan = null, seed = 3, t = 0.5 } ) {

			const actions = plan ? CREATURE_ACTIONS : HUMANOID_ACTIONS;
			const states = [ 'idle', 'move', 'dodge', 'hit', 'stun', 'dead' ];
			const n = actions.length + states.length;
			const { world, at } = enterLab( game, { title: plan ? `${plan} actions` : 'Hero actions', n, spacing: 3.5 } );
			const genome = plan ? generateGenome( new RNG( 'actions:' + seed ), { plan } ) : null;
			const make = ( i, label, pose ) => {

				const p = at( i );
				const e = new Entity( { kind: plan ? 'monster' : 'npc', x: p.x, z: p.z } );
				e.model = plan ? { type: 'creature', genome } : { type: 'hero', id: 'reaver', weapon: { base: 'sword', rarity: 'rare' } };
				return row( freeze( world, e, label, pose ), label );

			};

			return [
				...actions.map( ( a, i ) => make( i, a, { state: 'action', action: a, phase: t < 0.35 ? 'windup' : t < 0.6 ? 'active' : 'recovery', t } ) ),
				...states.map( ( s, i ) => make( actions.length + i, s, { state: s, action: null, phase: null, t, speed: s === 'move' ? 6 : 0 } ) )
			];

		} },

	{ id: 'lab.clear', desc: 'Leave the lab (back to town).', run: ( game ) => game.enterTown().describe() }

];

for ( const c of LAB_COMMANDS ) define( 'apiCommand', c );
