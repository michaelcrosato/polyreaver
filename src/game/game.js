// Game: the run-based loop around worlds. Town -> level -> level -> ... -> town.
// Owns the persistent character (the SAVE), the difficulty TUNING, the INPUT state
// and the current WORLD; steps the simulation at a fixed rate. Like core/, it is
// DOM- and three.js-free: main.js (browser) and scripts/sim.mjs (Node) both drive it.
//
// Extension points (all registry kinds, see docs/GAME.md):
//   'saveField'      { id, init() }                    new persistent character data
//   'statSource'     { id, mods( game, player ) }      stat modifiers from gear, tree, level...
//   'levelProvider'  { id, spec( game, depth ) }        which level is depth N (campaign / endless)
//   'levelGenerator' { id, generate( game, spec, rng ) -> Layout }
//   'worldHook'      { id, order, onWorld( game, world ) }  populate a new world (monsters, NPCs, mechanics)
//   'controller'     { id, create( game, entity ) -> { update( world, e, dt ) } }

import { GameWorld } from './core/world.js';
import { Entity } from './core/entity.js';
import { EventBus } from './core/events.js';
import { RNG, hashStr } from './core/rng.js';
import { all, get } from './core/registry.js';
import { TEAM, TUNING_DEFAULTS, SIM_HZ, xpToNext } from './core/tuning.js';
import { makeArena } from './core/layout.js';

// The hero's base stats before gear, tree and level. Fast on purpose: the game is
// about moving and hitting, not walking.
export const PLAYER_BASE = {
	life: 90, mana: 40, life_regen: 1.5, mana_regen: 3.5,
	move_speed: 7.2, attack_speed: 1, cast_speed: 1, damage: 1,
	crit_chance: 5, crit_multi: 150, area: 1, projectile_speed: 1, duration: 1, cooldown_recovery: 1, knockback: 1,
	added_physical_min: 3, added_physical_max: 7,
	armor: 0, evade_chance: 0, block_chance: 0,
	max_res_fire: 75, max_res_cold: 75, max_res_lightning: 75, max_res_chaos: 75,
	pickup_radius: 2.5, item_rarity: 0, item_quantity: 0, gold_find: 0, xp_gain: 0,
	dodge_cooldown: 0.45, dodge_distance: 5.2, stun_threshold: 0.2
};

export const MONSTER_BASE = {
	life: 30, mana: 100, move_speed: 4, attack_speed: 1, cast_speed: 1, damage: 1, crit_chance: 5, crit_multi: 150,
	area: 1, projectile_speed: 1, duration: 1, cooldown_recovery: 1, knockback: 1, max_res_fire: 75, max_res_cold: 75,
	max_res_lightning: 75, max_res_chaos: 75, stun_threshold: 0.12
};

export class Game {

	constructor( { seed = 'polyreaver', save = null, headless = false } = {} ) {

		this.seed = seed;
		this.headless = headless;
		this.events = new EventBus(); // game-level events (mode changes, level ups, loot)
		this.tuning = { ...TUNING_DEFAULTS };
		this.save = save || this.newSave();
		this.input = makeInput();
		this.world = null;
		this.mode = 'boot';
		this.acc = 0;
		this.runSeed = hashStr( seed );

	}

	newSave() {

		const s = { version: 1, name: 'Reaver', level: 1, xp: 0, gold: 0, depth: 1, maxDepth: 1, created: Date.now() };
		for ( const f of all( 'saveField' ) ) if ( s[ f.id ] === undefined ) s[ f.id ] = f.init();
		return s;

	}

	// Fill in fields added by newer content (old save files keep working).
	upgradeSave( s ) {

		for ( const f of all( 'saveField' ) ) if ( s[ f.id ] === undefined ) s[ f.id ] = f.init();
		return s;

	}

	// --- worlds -------------------------------------------------------------------

	enterTown() {

		const gen = get( 'levelGenerator', 'town' );
		const spec = { id: 'town', name: 'Town', kind: 'town', level: 1, generator: 'town' };
		const layout = gen ? gen.generate( this, spec, new RNG( 'town' ) ) : makeArena( 20, 20 );
		return this._startWorld( layout, spec, 'town' );

	}

	levelSpec( depth ) {

		const providers = all( 'levelProvider' ).sort( ( a, b ) => ( a.order ?? 50 ) - ( b.order ?? 50 ) );
		for ( const p of providers ) {

			const s = p.spec( this, depth );
			if ( s ) return s;

		}

		return { id: 'arena-' + depth, name: 'Arena', depth, level: depth, generator: 'arena', mechanics: [] };

	}

	enterLevel( depth = this.save.depth ) {

		const spec = typeof depth === 'object' ? depth : this.levelSpec( depth );
		const rng = new RNG( `${this.runSeed}:${spec.id}:${spec.depth ?? ''}:${this.save.runs?.[ spec.id ] ?? 0}` );
		const gen = get( 'levelGenerator', spec.generator );
		const layout = gen ? gen.generate( this, spec, rng ) : makeArena();
		this.save.depth = spec.depth ?? this.save.depth;
		return this._startWorld( layout, spec, 'level' );

	}

	_startWorld( layout, spec, kind ) {

		const prev = this.world;
		this.worldCount = ( this.worldCount ?? 0 ) + 1;
		const world = new GameWorld( { seed: `${this.runSeed}:${spec.id}:${this.worldCount}`, layout, tuning: this.tuning, kind, level: spec.level ?? 1, spec } );
		world.input = this.input;
		world.game = this;
		const player = this.createPlayer( world );
		player.x = layout.start.x; player.z = layout.start.z;
		if ( prev?.player ) {

			player.life = Math.min( player.maxLife, prev.player.alive ? player.maxLife : player.maxLife );
			player.mana = player.maxMana;

		}

		world.add( player );
		for ( const h of all( 'worldHook' ).sort( ( a, b ) => ( a.order ?? 50 ) - ( b.order ?? 50 ) ) ) h.onWorld?.( this, world );
		world.init();
		world.events.on( 'death', ( d ) => {

			if ( d.entity === world.player ) this.events.emit( 'playerDeath', { world } );

		} );
		this.world = world;
		this.mode = kind;
		this.acc = 0;
		this.events.emit( 'world', { world, kind, spec } );
		return world;

	}

	createPlayer( world ) {

		const p = new Entity( { kind: 'player', name: this.save.name, team: TEAM.PLAYER, level: this.save.level, radius: 0.42, height: 1.85, mass: 1.4 } );
		p.model = { type: 'hero', id: 'reaver' };
		p.data.accel = 90; // near-instant starts and stops
		p.data.turnRate = 30;
		this.applyPlayerStats( p );
		p.life = p.maxLife; p.mana = p.maxMana;
		const ctl = get( 'controller', 'player' );
		p.controller = ctl ? ctl.create( this, p ) : null;
		return p;

	}

	// Rebuild every stat source on the player (call after gear / tree / level changes).
	applyPlayerStats( p = this.world?.player ) {

		if ( ! p ) return;
		const S = p.stats;
		for ( const k in PLAYER_BASE ) S.base[ k ] = PLAYER_BASE[ k ];
		S.setSource( 'tuning', this.tuning.playerLife !== 1 ? [ { stat: 'life', type: 'more', value: ( this.tuning.playerLife - 1 ) * 100 } ] : null );
		for ( const src of all( 'statSource' ) ) S.setSource( 'src:' + src.id, src.mods( this, p ) || null );
		p.level = this.save.level;
		if ( p.life > p.maxLife ) p.life = p.maxLife;

	}

	// --- difficulty sliders ----------------------------------------------------------
	// Life sliders are stat sources ('tuning'), so they apply to everything already
	// alive, keep current life fractions, and show up in stat breakdowns.

	setTuning( partial ) {

		Object.assign( this.tuning, partial );
		const w = this.world;
		if ( ! w ) return;
		for ( const e of w.entities ) {

			if ( e.team !== TEAM.ENEMY && e.kind !== 'player' ) continue;
			const frac = e.lifeFrac;
			if ( e.kind === 'player' ) this.applyPlayerStats( e );
			else applyEnemyTuning( e, this.tuning );
			e.life = frac * e.maxLife;

		}

		this.events.emit( 'tuning', { tuning: { ...this.tuning } } );

	}

	resetTuning() {

		this.setTuning( { ...TUNING_DEFAULTS } );

	}

	// --- progression hooks used by every system --------------------------------------

	gainXp( amount ) {

		const s = this.save;
		s.xp += amount * this.tuning.xpGain;
		let ups = 0;
		while ( s.xp >= xpToNext( s.level ) ) {

			s.xp -= xpToNext( s.level );
			s.level ++;
			ups ++;

		}

		if ( ups ) {

			this.applyPlayerStats();
			const p = this.world?.player;
			if ( p ) {

				p.life = p.maxLife; p.mana = p.maxMana;

			}

			this.events.emit( 'levelup', { level: s.level, gained: ups } );

		}

	}

	gainGold( amount ) {

		this.save.gold += Math.round( amount );
		this.events.emit( 'gold', { amount, total: this.save.gold } );

	}

	completeLevel() {

		const s = this.save;
		s.maxDepth = Math.max( s.maxDepth, ( s.depth ?? 1 ) + 1 );
		this.events.emit( 'levelComplete', { depth: s.depth, world: this.world } );

	}

	// --- clock -------------------------------------------------------------------------

	// Advance real time; steps the world at SIM_HZ and returns the interpolation
	// fraction (0..1) between the last two steps for smooth rendering.
	update( realDt ) {

		if ( ! this.world || this.paused ) return 0;
		const h = 1 / SIM_HZ;
		this.acc = Math.min( this.acc + realDt, 0.25 );
		while ( this.acc >= h ) {

			this.world.step( h );
			this.acc -= h;
			this.input.pressed.clear(); // edge-triggered buttons last one step

		}

		return this.acc / h;

	}

	describe() {

		return { mode: this.mode, save: { level: this.save.level, xp: Math.round( this.save.xp ), gold: this.save.gold, depth: this.save.depth, maxDepth: this.save.maxDepth }, tuning: { ...this.tuning }, world: this.world?.describe() };

	}

}

// INPUT STATE - written by the browser input layer, by bots and by the agent API;
// read by the player controller. Directions are on the ground plane.
//   move     { x, z } stick / WASD, length 0..1
//   aim      { x, z } world point under the cursor (or stick direction * 6 from the player)
//   held     Set of action names currently held ( 'attack', 'skill1'...'skill6', 'dodge' )
//   pressed  Set of action names pressed since the last sim step (edge, cleared each step)
export function makeInput() {

	return { move: { x: 0, z: 0 }, aim: { x: 0, z: 1 }, aimValid: false, held: new Set(), pressed: new Set(), device: 'keyboard' };

}

export function applyEnemyTuning( e, tuning ) {

	e.stats.setSource( 'tuning', tuning.enemyLife !== 1 ? [ { stat: 'life', type: 'more', value: ( tuning.enemyLife - 1 ) * 100 } ] : null );

}

export { SIM_HZ, TEAM };
