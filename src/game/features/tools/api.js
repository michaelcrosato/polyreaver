// Agent API: every capability an AI agent (or a test, or a person at the console)
// needs, as named commands that take and return PLAIN JSON:
//
//   game.api( 'help' )                                  list every command with its args
//   game.api( 'describe' )                              mode, save, tuning, world summary
//   game.api( 'level.ascii', { entities: true } )       the level as text (cheapest "vision")
//   game.api( 'inspect', { id: 42 } )                   one entity: stats, statuses, action, model
//   game.api( 'spawn', { family: 'ashwalker', x: 3, z: 0 } )
//   game.api( 'step', { seconds: 5 } )                  advance the simulation (headless)
//   game.api( 'bot.run', { seconds: 60 } )              let the playtest bot play, get a report
//
// Commands are registry defs, so any feature adds its own:
//
//   define( 'apiCommand', { id: 'loot.roll', desc: 'Roll items', args: { n: 'count', level: 'item level' },
//     run( game, { n = 10, level = 1 } ) { return [ ...plain objects ] } } )
//
// The same commands run in Node (scripts/sim.mjs), in the browser (window.game.api)
// and remotely through the Claude link (command { cmd: 'api', args: { id, args } }).
// Results must be JSON-serialisable: no entities, no functions, no cycles.

import { define, get, all, kindsList, query } from '../../core/registry.js';
import { Game } from '../../game.js';
import { TUNING_SLIDERS, TUNING_DEFAULTS, TEAM } from '../../core/tuning.js';
import { modText } from '../../core/stats.js';
import { createBot } from './bot.js';
import { makeBasicMonster } from '../../content/baseline.js';

Game.prototype.api = function ( id, args = {} ) {

	const cmd = get( 'apiCommand', id );
	if ( ! cmd ) throw new Error( `unknown api command '${id}' - try game.api( 'help' )` );
	return cmd.run( this, args || {} );

};

const round = ( v, d = 2 ) => typeof v === 'number' ? +v.toFixed( d ) : v;

function needWorld( game ) {

	if ( ! game.world ) throw new Error( 'no world: call api( "town" ) or api( "level.enter", { depth } ) first' );
	return game.world;

}

function entityOrThrow( game, id ) {

	const e = needWorld( game ).byId.get( + id );
	if ( ! e ) throw new Error( `no entity ${id}` );
	return e;

}

const COMMANDS = [

	{ id: 'help', desc: 'List every API command with its arguments.', run: () => all( 'apiCommand' ).map( ( c ) => ( { id: c.id, desc: c.desc, args: c.args || {} } ) ) },

	{ id: 'describe', desc: 'Mode, character save summary, tuning and a world summary.', run: ( game ) => game.describe() },

	{ id: 'registry', desc: 'Registered defs of a kind (the design language). Without kind: every kind with counts.', args: { kind: 'kind name', tags: 'array of required tags' },
		run: ( game, { kind, tags = [] } ) => kind
			? query( kind, { tags } ).map( ( d ) => ( { id: d.id, name: d.name, tags: d.tags, level: d.level, desc: d.desc } ) )
			: kindsList() },

	{ id: 'entities', desc: 'Entities in the world (optionally filtered).', args: { kind: 'player|monster|boss|npc|prop|loot', team: '0 player, 1 enemy, 2 neutral', near: '{ x, z, r }', alive: 'bool (default true)', limit: 'max rows (200)' },
		run: ( game, { kind, team, near, alive = true, limit = 200 } ) => {

			const w = needWorld( game );
			let list = w.entities.filter( ( e ) => ( ! alive || e.alive ) && ( kind === undefined || e.kind === kind ) && ( team === undefined || e.team === + team ) );
			if ( near ) list = list.filter( ( e ) => Math.hypot( e.x - near.x, e.z - near.z ) <= ( near.r ?? 10 ) );
			return list.slice( 0, limit ).map( ( e ) => e.describe() );

		} },

	{ id: 'inspect', desc: 'Everything about one entity: describe() + key stats with breakdowns + modifiers + running action.', args: { id: 'entity id', stats: 'stat names to break down' },
		run: ( game, { id, stats = [ 'life', 'move_speed', 'attack_speed', 'damage', 'armor', 'res_fire', 'res_cold', 'res_lightning', 'crit_chance' ] } ) => {

			const e = entityOrThrow( game, id );
			const breakdown = {};
			for ( const s of stats ) {

				const b = e.stats.breakdown( s, [] );
				breakdown[ s ] = { total: round( b.total ), base: round( b.base ), flat: round( b.flat ), inc: round( b.inc ), more: round( b.more, 3 ), mods: b.mods.map( ( m ) => `${m.source}: ${modText( m )}` ) };

			}

			return {
				...e.describe(),
				data: Object.fromEntries( Object.entries( e.data ).filter( ( [ , v ] ) => [ 'number', 'string', 'boolean' ].includes( typeof v ) ) ),
				action: e.action ? { id: e.action.def.id, anim: e.anim.action, phase: e.anim.phase, t: round( e.anim.t ), duration: round( e.anim.duration ) } : null,
				flags: Object.fromEntries( Object.entries( e.flags ).filter( ( [ , v ] ) => v ) ),
				genome: e.model?.genome ? { plan: e.model.genome.plan, size: e.model.genome.size, seed: e.model.genome.seed } : undefined,
				stats: breakdown,
				sources: [ ...e.stats.sources.keys() ]
			};

		} },

	{ id: 'stat', desc: 'Break down one stat for an entity with query tags (e.g. damage with ["attack","melee","fire"]).', args: { id: 'entity id (default player)', stat: 'stat name', tags: 'array' },
		run: ( game, { id, stat = 'damage', tags = [] } ) => {

			const e = id ? entityOrThrow( game, id ) : needWorld( game ).player;
			const b = e.stats.breakdown( stat, tags );
			return { stat, tags, total: round( b.total, 4 ), base: b.base, flat: round( b.flat ), inc: round( b.inc ), more: round( b.more, 4 ), override: b.override, mods: b.mods.map( ( m ) => ( { source: m.source, text: modText( m ) } ) ) };

		} },

	{ id: 'tuning.get', desc: 'Current difficulty sliders and their ranges.', run: ( game ) => ( { values: { ...game.tuning }, sliders: TUNING_SLIDERS, defaults: TUNING_DEFAULTS } ) },
	{ id: 'tuning.set', desc: 'Change difficulty sliders (applies to everything alive).', args: { '...': 'any keys of tuning.get().values' }, run: ( game, args ) => {

		game.setTuning( args );
		return { ...game.tuning };

	} },
	{ id: 'tuning.reset', desc: 'All sliders back to default.', run: ( game ) => {

		game.resetTuning();
		return { ...game.tuning };

	} },

	{ id: 'town', desc: 'Go to the town hub.', run: ( game ) => game.enterTown().describe() },
	{ id: 'level.enter', desc: 'Start a level at a depth (campaign 1-20, endless beyond).', args: { depth: 'number' }, run: ( game, { depth = game.save.depth } ) => game.enterLevel( Math.max( 1, + depth ) ).describe() },
	{ id: 'level.spec', desc: 'The level definition for a depth, without entering it.', args: { depth: 'number' }, run: ( game, { depth = 1 } ) => {

		const s = game.levelSpec( + depth );
		return JSON.parse( JSON.stringify( s, ( k, v ) => typeof v === 'function' ? undefined : v ) );

	} },
	{ id: 'level.ascii', desc: 'The current level as text. # wall . floor ~ water ^ lava * ice = bridge S start E exit; entities: @ player, m monster, B boss, n npc, $ loot, o prop.', args: { entities: 'bool', crop: '{ x, z, r } tiles around a point' },
		run: ( game, { entities = true } ) => {

			const w = needWorld( game );
			const marks = entities ? w.entities.filter( ( e ) => e.alive || e.kind === 'loot' ).map( ( e ) => ( { x: e.x, z: e.z, char: e.kind === 'player' ? '@' : e.kind === 'boss' ? 'B' : e.kind === 'monster' ? 'm' : e.kind === 'npc' ? 'n' : e.kind === 'loot' ? '$' : 'o' } ) ) : [];
			marks.sort( ( a, b ) => ( a.char === '@' ) - ( b.char === '@' ) ); // player drawn last
			return { w: w.layout.w, h: w.layout.h, cell: w.layout.cell, theme: w.layout.theme, ascii: w.layout.toAscii( { marks } ) };

		} },

	{ id: 'teleport', desc: 'Move the player.', args: { x: 'metres', z: 'metres' }, run: ( game, { x = 0, z = 0 } ) => {

		const p = needWorld( game ).player;
		p.x = p.px = x; p.z = p.pz = z;
		return { x, z };

	} },

	{ id: 'player.set', desc: 'Set character level / gold / depth (testing).', args: { level: 'n', gold: 'n', maxDepth: 'n' }, run: ( game, args ) => {

		for ( const k of [ 'level', 'gold', 'maxDepth', 'depth' ] ) if ( args[ k ] !== undefined ) game.save[ k ] = + args[ k ];
		game.applyPlayerStats();
		return game.describe().save;

	} },

	{ id: 'kill.all', desc: 'Kill every enemy (credited to the player).', run: ( game ) => {

		const w = needWorld( game );
		let n = 0;
		for ( const e of [ ...w.entities ] ) if ( e.alive && e.team === TEAM.ENEMY ) {

			w.kill( e, w.player );
			n ++;

		}

		return { killed: n };

	} },

	{ id: 'spawn', desc: 'Spawn a monster near the player (uses the monster feature\'s factory when present).', args: { family: 'monsterFamily id', rarity: 'normal|magic|rare|unique|boss', level: 'monster level', x: 'm', z: 'm', count: 'n' },
		run: ( game, args ) => {

			const w = needWorld( game );
			const spawner = get( 'spawner', 'monster' );
			const out = [];
			for ( let i = 0; i < ( args.count ?? 1 ); i ++ ) {

				const x = ( args.x ?? w.player.x + 6 ) + i * 1.2, z = args.z ?? w.player.z;
				const e = spawner ? spawner.spawn( w, { ...args, x, z } ) : makeBasicMonster( w, x, z, args.level ?? w.level );
				if ( e ) out.push( w.add( e ).describe() );

			}

			return out;

		} },

	{ id: 'step', desc: 'Advance the simulation by N seconds with the current input (headless testing).', args: { seconds: 'number' }, run: ( game, { seconds = 1 } ) => {

		const dt = 1 / 60;
		for ( let t = 0; t < seconds; t += dt ) game.update( dt );
		return game.world.describe();

	} },

	{ id: 'events', desc: 'The most recent simulation events (compact).', args: { n: 'how many (default 50)', type: 'filter by type' }, run: ( game, { n = 50, type } ) => {

		const log = game.world?.state.eventLog || [];
		return ( type ? log.filter( ( e ) => e.type === type ) : log ).slice( - n );

	} },

	{ id: 'bot.create', desc: 'Create the playtest bot for the current world (returns a handle in JS; JSON callers use bot.run).', run: ( game, opts ) => createBot( game, opts ) },
	{ id: 'bot.run', desc: 'Let the playtest bot play the current level for N simulated seconds (headless: instant).', args: { seconds: 'number', skills: 'use skills (default true)', loot: 'pick up loot (default true)' },
		run: ( game, { seconds = 60, ...opts } ) => {

			const bot = createBot( game, opts );
			const dt = 1 / 60;
			for ( let t = 0; t < seconds; t += dt ) {

				bot.step( dt );
				game.update( dt );
				if ( ! game.world.player.alive || game.world.state.complete ) break;

			}

			return bot.report();

		} }

];

for ( const c of COMMANDS ) define( 'apiCommand', c );

// Compact event log per world for the 'events' command and post-mortems.
const KEEP = 300;
define( 'worldHook', { id: 'tools-event-log', order: 1, onWorld( game, world ) {

	const log = world.state.eventLog = [];
	world.events.on( '*', ( e ) => {

		const row = { type: e.type, t: +world.time.toFixed( 2 ) };
		for ( const k of [ 'x', 'z', 'total', 'crit', 'killed', 'skill', 'id', 'action', 'reason', 'amount', 'stacks' ] ) if ( e[ k ] !== undefined ) row[ k ] = round( e[ k ] );
		for ( const k of [ 'entity', 'source', 'target', 'killer', 'owner' ] ) if ( e[ k ]?.id ) row[ k ] = e[ k ].id;
		log.push( row );
		if ( log.length > KEEP ) log.splice( 0, log.length - KEEP );

	} );

} } );
