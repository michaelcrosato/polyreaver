// Progression & loot - simulation side: XP and levels, items (bases, affixes,
// rarities, uniques), currency crafting, loot drops and pickup, inventory /
// equipment / stash / vendor, the passive tree (+ ascendancy), skill loadout,
// flasks, save fields with migration, and the rule-changing mechanics runtime.
//
// Rules for files imported from here: no three.js, no DOM, no window. This entry is
// loaded by the browser AND by Node (scripts/sim.mjs), so everything it registers
// (defs, systems, hooks) must run headless. Rendering / UI code goes in client.js.
//
// Module map:
//   data/bases.js affixes.js uniques.js currency.js clusters.js keystones.js ascendancy.js   content
//   items.js       rolling / computing / describing items          text.js  mod -> text lines
//   tree.js        passive tree generation, allocation, pathing    skills.js  loadout + skill XP
//   stats.js       statSources (level, attributes, gear, tree...)  mechanics.js  hooks, flags, buffs
//   loot.js        rewards hook, drops, loot entities, pickup      flasks.js  flask belt
//   inventory.js   inventory / equipment / stash / vendor / craft  save.js  save fields + migration

import { define, get, all } from '../../core/registry.js';
import { Entity } from '../../core/entity.js';
import { TEAM } from '../../core/tuning.js';
import './data/bases.js';
import './data/affixes.js';
import './data/uniques.js';
import './data/currency.js';
import './data/clusters.js';
import './data/keystones.js';
import './data/ascendancy.js';
import { ensureSave } from './save.js';
import './stats.js';
import { updateFlasks, pollPotionInput, drinkFlask } from './flasks.js';
import { lootSimulation, pickupLoot, lootEntities } from './loot.js';
import { rollItem, describeItem, itemSummary, makeItem, makeUnique } from './items.js';
import { treeSummary, allocatePath, getTree, treeStats, respec, pointsLeft } from './tree.js';
import { skillLevel, maxSkillLevel } from './skills.js';
import { EQUIP_SLOTS } from './data/bases.js';
import { addToInventory, listItems, applyCurrency, equipFrom } from './inventory.js';
import { simulateStats, estimateAttack } from './stats.js';
import { RNG } from '../../core/rng.js';
import * as Items from './items.js';
import * as Loot from './loot.js';
import * as Tree from './tree.js';
import * as Inventory from './inventory.js';
import * as Stats from './stats.js';
import * as Skills from './skills.js';
import * as Flasks from './flasks.js';
import * as Save from './save.js';
import * as Mechanics from './mechanics.js';
import * as Text from './text.js';

define( 'system', { id: 'prog-flasks', order: 75, update: updateFlasks } );
define( 'system', { id: 'prog-potion-input', order: 16, update: pollPotionInput } );

// --- town fallback ------------------------------------------------------------------------------------
// The world feature places the real town NPCs ( data.service ). Until it is merged
// (or in a stripped-down build) this hook adds simple service totems so every
// panel stays reachable, and a minimal interact check for them only.

const FALLBACK_NPCS = [ [ 'vendor', 'Merchant', - 6, - 4 ], [ 'craft', 'Blacksmith', 6, - 4 ], [ 'stash', 'Stash', - 6, 3 ], [ 'tree', 'Mystic', 6, 3 ] ];

define( 'worldHook', { id: 'prog-town-fallback', order: 99, onWorld( game, world ) {

	if ( world.kind !== 'town' || world.entities.some( ( e ) => e.data?.service ) ) return;
	const s = world.layout.start;
	for ( const [ service, name, dx, dz ] of FALLBACK_NPCS ) {

		const n = new Entity( { kind: 'npc', name, team: TEAM.NEUTRAL, x: s.x + dx, z: s.z + dz - 4, radius: 0.5, height: 1.9, mass: 100 } );
		n.data.service = service;
		n.data.progFallback = true;
		n.flags.untargetable = true;
		n.model = { type: 'npc', id: service };
		world.add( n );

	}

	world.state.progFallbackNpcs = true;

} } );

define( 'system', { id: 'prog-fallback-interact', order: 12, update( world ) {

	if ( ! world.state.progFallbackNpcs || ! world.input?.pressed.has( 'interact' ) || ! world.player ) return;
	const p = world.player;
	const npc = world.spatial.nearest( p.x, p.z, 3, ( e ) => e.data.progFallback );
	if ( npc ) world.events.emit( 'interact', { entity: p, target: npc } );

} } );

// --- agent API commands ( game.api( id, args ) via the tools feature ) ------------------------------------

define( 'apiCommand', { id: 'loot.roll', desc: 'Roll n items at an item level', args: { n: 'count (default 5)', level: 'item level', rarity: 'optional rarity', slot: 'optional slot', seed: 'optional' },
	run: ( game, { n = 5, level = game.save.level, rarity, slot, seed } = {} ) => {

		const rng = new RNG( seed ?? Math.random() * 1e9 );
		return Array.from( { length: n }, () => rollItem( level, { rarity, slot }, rng ) ).filter( Boolean ).map( describeItem );

	} } );
define( 'apiCommand', { id: 'loot.sim', desc: 'Loot distribution over n kills at an area level', args: { n: 'kills', level: 'area level' },
	run: ( game, { n = 1000, level = 10, mix } = {} ) => lootSimulation( n, level, { mix, tuning: game.tuning } ) } );
define( 'apiCommand', { id: 'tree.summary', desc: 'Passive tree allocation summary', args: {}, run: ( game ) => treeSummary( ensureSave( game.save ) ) } );
define( 'apiCommand', { id: 'tree.stats', desc: 'Passive tree size by node type', args: {}, run: () => treeStats() } );
define( 'apiCommand', { id: 'tree.allocate', desc: 'Allocate the shortest path to a node (id or name)', args: { node: 'node id or exact name' },
	run: ( game, { node } ) => {

		const T = getTree();
		const id = T.nodes.has( node ) ? node : [ ...T.nodes.values() ].find( ( n ) => n.name === node )?.id;
		const r = allocatePath( ensureSave( game.save ), id );
		if ( r.ok ) game.applyPlayerStats();
		return { ...r, pointsLeft: pointsLeft( game.save ) };

	} } );
define( 'apiCommand', { id: 'tree.respec', desc: 'Reset the passive tree (no gold cost from the API)', args: { start: 'might | finesse | sorcery' },
	run: ( game, { start } = {} ) => {

		respec( ensureSave( game.save ), start );
		game.applyPlayerStats();
		return treeSummary( game.save );

	} } );
define( 'apiCommand', { id: 'items.list', desc: 'Every item the character owns', args: {}, run: ( game ) => listItems( ensureSave( game.save ) ).map( ( x ) => ( { loc: x.loc, summary: itemSummary( x.item ) } ) ) } );
define( 'apiCommand', { id: 'items.give', desc: 'Give an item (base, unique, or a random roll)', args: { base: 'base id', unique: 'unique id', rarity: 'rarity', level: 'item level', equip: 'equip it' },
	run: ( game, { base, unique, rarity = 'rare', level = game.save.level, equip = false } = {} ) => {

		const rng = new RNG( Math.random() * 1e9 );
		const item = unique ? makeUnique( unique, level, rng ) : base ? makeItem( base, level, rarity, rng ) : rollItem( level, { rarity }, rng );
		const i = addToInventory( ensureSave( game.save ), item );
		if ( i < 0 ) return { ok: false, reason: 'Inventory is full' };
		if ( equip ) equipFrom( game, { where: 'inv', index: i } );
		return { ok: true, item: describeItem( item ) };

	} } );
// A stand-in for a character that has PLAYED to `level`: rare gear in every slot,
// passive points spent greedily on life / attack damage / defences, bar skills at
// the level cap. Balance sims use it so depth N is fought with a depth-N character
// instead of a naked one ( npm run sim -- --kit ).
const KIT_WEIGHTS = { life: 1.6, attack_speed: 1.3, life_leech: 1.2, armor: 0.7, block_chance: 0.6, evade_chance: 0.6, area: 0.6, life_regen_pct: 0.8,
	life_on_kill: 0.5, res_fire: 0.5, res_cold: 0.5, res_lightning: 0.5, crit_chance: 0.4, crit_multi: 0.3, move_speed: 0.4, shield: 0.4, stun_threshold: 0.3, strength: 0.08, dexterity: 0.04, intelligence: 0.03 };
const KIT_TAGS = new Set( [ 'attack', 'melee', 'physical', 'area', 'fire', 'cold', 'spell' ] );

function kitScore( node ) {

	if ( node.type === 'keystone' ) return - 99;
	let v = 0;
	for ( const m of node.mods || [] ) {

		const w = m.stat === 'damage' ? ( ! m.tags || m.tags.every( ( t ) => KIT_TAGS.has( t ) ) ? 1 : 0.15 ) : KIT_WEIGHTS[ m.stat ] ?? 0.05;
		v += w * m.value / ( m.type === 'flat' && w < 0.1 ? 1 : 10 );

	}

	return v;

}

export function spendPassives( save ) {

	const T = getTree(), t = Tree.treeState( save );
	let guard = 400;
	while ( pointsLeft( save ) > 0 && guard -- > 0 ) {

		// one breadth-first pass from the tree: best value per point among reachable nodes
		const alloc = new Set( t.allocated ), prev = new Map(), cum = new Map(), dist = new Map(), queue = [];
		for ( const a of alloc ) for ( const nb of T.nodes.get( a )?.links || [] ) if ( ! alloc.has( nb ) && ! prev.has( nb ) ) {

			prev.set( nb, null ); dist.set( nb, 1 ); cum.set( nb, kitScore( T.nodes.get( nb ) ) ); queue.push( nb );

		}

		const budget = pointsLeft( save );
		let best = null, bestV = - Infinity;
		for ( let qi = 0; qi < queue.length; qi ++ ) {

			const c = queue[ qi ], d = dist.get( c );
			const v = cum.get( c ) / d;
			if ( v > bestV ) {

				bestV = v; best = c;

			}

			if ( d >= budget ) continue;
			for ( const nb of T.nodes.get( c ).links ) if ( ! alloc.has( nb ) && ! prev.has( nb ) ) {

				prev.set( nb, c ); dist.set( nb, d + 1 ); cum.set( nb, cum.get( c ) + kitScore( T.nodes.get( nb ) ) ); queue.push( nb );

			}

		}

		if ( ! best ) break;
		const path = [];
		for ( let c = best; c !== null; c = prev.get( c ) ) path.unshift( c );
		t.allocated.push( ...path );

	}

	return t.allocated.length - 1;

}

define( 'apiCommand', { id: 'player.kit', desc: 'Make the character a played-to-level stand-in: rare gear in every slot, passives spent, bar skills levelled (balance sims)', args: { level: 'character level', rarity: 'gear rarity (rare)', seed: 'seed', tree: 'spend passives (true)' },
	run: ( game, { level = game.save.level, rarity = 'rare', seed = 'kit', tree = true } = {} ) => {

		const s = ensureSave( game.save ), rng = new RNG( `kit:${seed}:${level}` );
		s.level = Math.max( 1, Math.round( level ) );
		s.xp = 0;
		if ( tree ) {

			respec( s, Tree.treeState( s ).start );
			spendPassives( s );

		}

		// a few candidates per slot; keep the one this character can use best
		// (unmet attribute requirements make an item useless, as in play)
		const roll = ( slot, tags ) => rollItem( s.level, { rarity, slot, tags }, rng ) || rollItem( s.level, { rarity, slot }, rng );
		const value = () => {

			const S = simulateStats( game );
			return estimateAttack( S ).dps * Math.sqrt( Math.max( 1, S.get( 'life' ) ) );

		};

		for ( const slot of EQUIP_SLOTS ) {

			let best = null, bestV = - Infinity;
			for ( let i = 0; i < ( slot === 'weapon' ? 6 : 3 ); i ++ ) {

				const item = slot === 'weapon' ? roll( 'weapon', [ 'one-hand', 'melee' ] ) : slot === 'offhand' ? roll( 'offhand', [ 'shield' ] ) : roll( slot.replace( /\d$/, '' ) );
				s.equipment[ slot ] = item;
				const v = value();
				if ( v > bestV ) {

					bestV = v; best = item;

				}

			}

			s.equipment[ slot ] = best;

		}

		const flaskTags = [ 'life_flask', 'life_flask', 'mana_flask', 'utility_flask' ];
		s.flasks.slots = flaskTags.map( ( tag, i ) => rollItem( s.level, { rarity: 'magic', flask: true, tags: [ tag ] }, rng ) ?? s.flasks.slots[ i ] ?? null );

		const cap = maxSkillLevel( s.level );
		for ( const id of s.skills.bar ) if ( id ) s.skills.levels[ id ] = cap;
		game.applyPlayerStats();
		const p = game.world?.player;
		if ( p ) {

			p.life = p.maxLife; p.mana = p.maxMana;

		}

		return { level: s.level, passives: Tree.treeState( s ).allocated.length - 1, skillLevel: cap, gear: EQUIP_SLOTS.map( ( k ) => s.equipment[ k ] && itemSummary( s.equipment[ k ] ) ) };

	} } );
define( 'apiCommand', { id: 'items.craft', desc: 'Apply a currency orb to an item location', args: { currency: 'currency id', loc: '{ where, index | slot | tab }' },
	run: ( game, { currency, loc } ) => {

		const r = applyCurrency( game, currency, loc );
		return r.ok ? { ok: true, item: describeItem( r.item ) } : r;

	} } );
define( 'apiCommand', { id: 'stats.player', desc: 'Key player stats and an attack estimate', args: {},
	run: ( game ) => {

		const S = simulateStats( game );
		const keys = [ 'life', 'mana', 'shield', 'armor', 'evade_chance', 'block_chance', 'res_fire', 'res_cold', 'res_lightning', 'res_chaos', 'move_speed', 'strength', 'dexterity', 'intelligence', 'item_rarity', 'item_quantity' ];
		return { stats: Object.fromEntries( keys.map( ( k ) => [ k, Math.round( S.get( k ) * 10 ) / 10 ] ) ), attack: estimateAttack( S ) };

	} } );
define( 'apiCommand', { id: 'loot.pickupAll', desc: 'Pick up every loot entity in the world', args: {},
	run: ( game ) => {

		let n = 0;
		for ( const e of lootEntities( game.world ) ) if ( pickupLoot( game, e ).ok ) n ++;
		return { picked: n };

	} } );
define( 'apiCommand', { id: 'flask.drink', desc: 'Drink flask slot 0-3', args: { slot: 'index' }, run: ( game, { slot = 0 } = {} ) => drinkFlask( game, slot ) } );

// Every module, for agents, the tools feature, the browser console and tests:
//   game.progression.items.rollItem( 40, { rarity: 'rare' } ), game.progression.tree.treeSummary( game.save ) ...
export const MODULES = { items: Items, loot: Loot, tree: Tree, inventory: Inventory, stats: Stats, skills: Skills, flasks: Flasks, save: Save, mechanics: Mechanics, text: Text };

// Combat can ask for a skill's total level (save level + gear / tree bonuses).
define( 'worldHook', { id: 'prog-game-api', order: 1, onWorld( game ) {

	game.skillLevel = ( id ) => skillLevel( game, id );
	game.progression = MODULES;

} } );

// --- public API (tools feature, scripts, tests) --------------------------------------------------------------
export { rollItem, makeItem, makeUnique, describeItem, itemSummary, computeItem, itemValue, itemName } from './items.js';
export { lootSimulation, rollDrops, xpPenalty, spawnLoot, pickupLoot, onKill, RARITY_LOOT } from './loot.js';
export { treeSummary, allocatePath, pathTo, getTree, treeStats, pointsLeft, allocate, refund, respec, chooseAscendancy, ascAllocate, validateTree } from './tree.js';
export { buildMods, simulateStats, estimateAttack, compareStats } from './stats.js';
export { ensureSave, SAVE_VERSION, MIGRATIONS } from './save.js';
export { moveItem, equipFrom, unequip, sellItem, buyItem, gamble, applyCurrency, improveQuality, vendorStock, listItems, addToInventory } from './inventory.js';
export { drinkFlask, bestFlask, refillFlasks } from './flasks.js';
export { skillLevel, assignSkill, learnSkill, socketSupport, unsocketSupport } from './skills.js';
export { modLine, modsToLines } from './text.js';

// Counts of every content kind this feature registers (docs, tests, agents).
export function contentCounts() {

	const T = treeStats();
	return {
		itemBases: all( 'itemBase' ).length, affixes: all( 'affix' ).length, uniques: all( 'unique' ).length, currencies: all( 'currency' ).length,
		keystones: all( 'keystone' ).length, clusters: all( 'treeCluster' ).length, ascendancies: all( 'ascendancy' ).length,
		treeNodes: T.nodes, notables: T.byType.notable, treeKeystones: T.byType.keystone, uniquesWithMechanics: all( 'unique' ).filter( ( u ) => u.hooks || u.grants ).length,
		unknownUniqueBases: all( 'unique' ).filter( ( u ) => ! get( 'itemBase', u.base ) ).map( ( u ) => u.id )
	};

}
