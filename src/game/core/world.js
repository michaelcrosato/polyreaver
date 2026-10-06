// GameWorld: one simulated area (the town, a level, a lab scene). It owns the
// entities, the layout, projectiles/areas, the clock and the seeded RNG, and runs
// SYSTEMS in order every fixed step. Core systems live here; gameplay systems
// (player control, AI, mechanics, encounter director, loot...) are registered as
// 'system' defs and run in the same loop:
//
//   define( 'system', { id: 'ai', order: 20, init?( world ), update( world, dt ) } )
//
//  order  10 input/player  20 ai  30 actions  40 skills/abilities  50 movement
//         60 projectiles+areas  70 statuses  80 regen  85 mechanics  90 director
//         95 loot/pickup  100 cleanup
//
// Nothing in core/ imports three.js or the DOM, so a world runs unchanged in Node
// (scripts/sim.mjs) for bots, balance runs and tests.

import { EventBus } from './events.js';
import { RNG } from './rng.js';
import { SpatialHash } from './spatial.js';
import { all, get } from './registry.js';
import { TEAM, TUNING_DEFAULTS } from './tuning.js';
import { updateActions, cancelAction, startAction } from './actions.js';
import { updateEffects, spawnProjectile, spawnArea, meleeArc } from './effects.js';
import { resolveHit } from './combat.js';
import { makeArena } from './layout.js';

export class GameWorld {

	constructor( { seed = 1, layout = null, tuning = null, events = null, kind = 'level', level = 1, spec = null } = {} ) {

		this.seed = seed;
		this.rng = new RNG( seed );
		this.kind = kind; // 'town' | 'level' | 'lab'
		this.level = level; // area level (monster level)
		this.spec = spec; // the level definition this world was built from
		this.layout = layout || makeArena();
		this.tuning = tuning || { ...TUNING_DEFAULTS };
		this.events = events || new EventBus();
		this.entities = [];
		this.byId = new Map();
		this.projectiles = [];
		this.areas = [];
		this.spatial = new SpatialHash( 4 );
		this.time = 0;
		this.frame = 0;
		this.input = null; // player input state ( game.input ), read by the player controller
		this.player = null;
		this.state = {}; // per-level scratch (mechanics, director, objectives)
		this.stats = { kills: 0, damageDealt: 0, damageTaken: 0, deaths: 0 };
		this.paused = false;
		this.systems = [ ...CORE_SYSTEMS, ...all( 'system' ) ].sort( ( a, b ) => ( a.order ?? 50 ) - ( b.order ?? 50 ) );
		this.events.on( 'hit', ( h ) => {

			if ( h.source?.team === TEAM.PLAYER ) this.stats.damageDealt += h.total;
			if ( h.target.team === TEAM.PLAYER ) this.stats.damageTaken += h.total;

		} );

	}

	init() {

		for ( const s of this.systems ) s.init?.( this );
		return this;

	}

	// --- entities ----------------------------------------------------------------

	add( e ) {

		if ( this.byId.has( e.id ) ) return e;
		this.entities.push( e );
		this.byId.set( e.id, e );
		if ( e.kind === 'player' ) this.player = e;
		if ( e.team === TEAM.ENEMY && this.tuning.enemyLife !== 1 ) {

			const frac = e.life >= e.maxLife || e.life <= 1 ? 1 : e.lifeFrac;
			e.stats.setSource( 'tuning', [ { stat: 'life', type: 'more', value: ( this.tuning.enemyLife - 1 ) * 100 } ] );
			e.life = frac * e.maxLife;

		}

		if ( e.life <= 1 && e.maxLife > 1 ) e.life = e.maxLife;
		if ( e.shield <= 0 ) e.shield = e.stats.get( 'shield' );
		this.events.emit( 'spawn', { entity: e, x: e.x, z: e.z } );
		return e;

	}

	remove( e ) {

		const i = this.entities.indexOf( e );
		if ( i >= 0 ) this.entities.splice( i, 1 );
		this.byId.delete( e.id );
		this.events.emit( 'despawn', { entity: e } );

	}

	query( x, z, r, filter ) {

		return this.spatial.query( x, z, r, filter );

	}

	enemiesOf( e, x, z, r ) {

		return this.spatial.query( x, z, r, ( o ) => o.alive && o.team !== e.team && o.team !== TEAM.NEUTRAL && o.kind !== 'loot' && o.kind !== 'npc' && ! o.flags.untargetable );

	}

	// --- combat helpers (thin wrappers so content only needs `world`) ---------------

	dealDamage( src, tgt, hit ) {

		return resolveHit( this, src, tgt, hit );

	}

	melee( owner, opts ) {

		return meleeArc( this, owner, opts );

	}

	projectile( owner, opts ) {

		return spawnProjectile( this, owner, opts );

	}

	area( owner, opts ) {

		return spawnArea( this, owner, opts );

	}

	act( e, def, opts ) {

		return startAction( this, e, def, opts );

	}

	kill( e, killer = null, hit = null ) {

		if ( ! e.alive ) return;
		e.alive = false;
		e.life = 0;
		cancelAction( this, e, 'death' );
		e.forced = null;
		e.anim.state = 'dead';
		e.anim.t = 0;
		e.anim.seq ++;
		e.data.deathTime = this.time;
		if ( e.team === TEAM.ENEMY ) this.stats.kills ++;
		if ( e.kind === 'player' ) this.stats.deaths ++;
		// statuses are cleared AFTER the event so death hooks can see them
		// ("ignited enemies explode", "frozen enemies shatter")
		this.events.emit( 'death', { entity: e, killer, hit, x: e.x, z: e.z } );
		e.statuses.clear();

	}

	// --- statuses (buffs, debuffs, ailments) --------------------------------------
	// Status defs ( define( 'status', { id, duration, maxStacks, stack: 'refresh' | 'add' |
	// 'max', mods( s ) -> stat mods, onApply, onTick( world, e, s, dt ), onExpire, flags } ) )
	// describe the behaviour; applyStatus() handles stacking and timers.

	applyStatus( e, id, opts = {} ) {

		if ( ! e.alive ) return null;
		const def = get( 'status', id );
		if ( ! def ) return null;
		if ( def.immuneFlag && e.flags[ def.immuneFlag ] ) return null;
		const dur = ( opts.duration ?? def.duration ?? 2 ) * ( e.stats.get( 'status_duration_taken', [ id ] ) || 1 );
		let s = e.statuses.get( id );
		if ( s ) {

			if ( def.stack === 'add' ) s.stacks = Math.min( def.maxStacks ?? 99, s.stacks + ( opts.stacks ?? 1 ) );
			s.time = Math.max( s.time, dur );
			if ( def.stack === 'max' ) s.data = ( def.merge ? def.merge( s.data, opts ) : s.data );

		} else {

			s = { id, def, time: dur, total: dur, stacks: opts.stacks ?? 1, source: opts.source || null, data: def.init ? def.init( this, e, opts ) : { ...opts } };
			e.statuses.set( id, s );
			def.onApply?.( this, e, s );

		}

		this._statusMods( e, s );
		this.events.emit( 'status', { entity: e, id, stacks: s.stacks, x: e.x, z: e.z } );
		return s;

	}

	removeStatus( e, id ) {

		const s = e.statuses.get( id );
		if ( ! s ) return;
		e.statuses.delete( id );
		s.def.onExpire?.( this, e, s );
		e.stats.setSource( 'status:' + id, null );
		if ( s.def.flags ) for ( const f of s.def.flags ) e.flags[ f ] = false;

	}

	_statusMods( e, s ) {

		if ( s.def.mods ) e.stats.setSource( 'status:' + s.id, s.def.mods( s, e ) );
		if ( s.def.flags ) for ( const f of s.def.flags ) e.flags[ f ] = true;

	}

	// --- stepping -------------------------------------------------------------------

	step( dt ) {

		if ( this.paused ) return;
		dt *= this.tuning.gameSpeed;
		this.time += dt;
		this.frame ++;
		// previous pose for render interpolation between fixed steps
		for ( const e of this.entities ) {

			e.px = e.x; e.pz = e.z; e.py = e.y; e.pf = e.facing;

		}

		this.spatial.rebuild( this.entities );
		for ( const s of this.systems ) s.update?.( this, dt );

	}

	// Plain-data summary for the agent API, tests and the inspector.
	describe() {

		const count = {};
		for ( const e of this.entities ) count[ e.kind ] = ( count[ e.kind ] || 0 ) + ( e.alive ? 1 : 0 );
		return {
			kind: this.kind, level: this.level, seed: this.seed, time: +this.time.toFixed( 2 ), frame: this.frame,
			spec: this.spec ? { id: this.spec.id, name: this.spec.name, mechanics: this.spec.mechanics } : null,
			entities: count, projectiles: this.projectiles.length, areas: this.areas.length, stats: { ...this.stats },
			player: this.player ? this.player.describe() : null
		};

	}

}

// --- core systems ---------------------------------------------------------------

function updateMovement( world, dt ) {

	const L = world.layout, tune = world.tuning;
	for ( const e of world.entities ) {

		if ( ! e.alive || e.kind === 'prop' && ! e.data.movable ) continue;
		let tvx, tvz;
		if ( e.forced ) {

			tvx = e.forced.vx; tvz = e.forced.vz;
			e.forced.time -= dt;
			if ( e.forced.time <= 0 ) {

				e.forced.onEnd?.( world, e );
				e.forced = null;

			}

			e.vx = tvx; e.vz = tvz;

		} else {

			const rooted = e.flags.rooted || e.flags.stunned || e.flags.frozen;
			const teamSpeed = e.team === TEAM.PLAYER ? tune.playerSpeed : e.team === TEAM.ENEMY ? tune.enemySpeed : 1;
			const speed = rooted ? 0 : e.stats.get( 'move_speed' ) * teamSpeed * ( e.action ? e.action.def.moveMult ?? 0.2 : 1 );
			tvx = e.moveIntent.x * speed; tvz = e.moveIntent.z * speed;
			// steer toward the target velocity with a capped acceleration: high for the
			// player (snappy starts/stops), lower for heavy monsters (weight)
			const accel = ( e.data.accel ?? 40 ) * dt;
			const ddx = tvx - e.vx, ddz = tvz - e.vz, dd = Math.hypot( ddx, ddz );
			if ( dd <= accel ) {

				e.vx = tvx; e.vz = tvz;

			} else {

				e.vx += ddx / dd * accel; e.vz += ddz / dd * accel;

			}

			if ( ! e.action && Math.hypot( tvx, tvz ) > 0.1 ) {

				// turn toward the movement direction with a fast angular spring
				const want = Math.atan2( tvx, tvz );
				const diff = Math.atan2( Math.sin( want - e.facing ), Math.cos( want - e.facing ) );
				e.facing += diff * Math.min( 1, ( e.data.turnRate ?? 18 ) * dt );

			}

		}

		// knockback impulse decays exponentially
		const ix = e.impulse.x, iz = e.impulse.z;
		const k = Math.exp( - 8 * dt );
		e.impulse.x *= k; e.impulse.z *= k;

		let nx = e.x + ( e.vx + ix ) * dt, nz = e.z + ( e.vz + iz ) * dt;
		if ( e.data.flying ) {

			// fliers ignore pits/water but not walls
			const c = L.collideCircle( nx, nz, e.radius, WALLS_ONLY );
			nx = c.x; nz = c.z;

		} else {

			const c = L.collideCircle( nx, nz, e.radius );
			nx = c.x; nz = c.z;
			if ( c.hit && e.forced ) e.data.forcedHitWall = world.time;

		}

		e.x = nx; e.z = nz;
		world.spatial.update( e );

		// vertical (leaps, knock-ups)
		if ( e.y > 0 || e.vy !== 0 ) {

			e.vy -= 30 * dt;
			e.y += e.vy * dt;
			if ( e.y <= 0 ) {

				e.y = 0; e.vy = 0;

			}

		}

	}

	// soft separation between solid bodies so crowds spread instead of stacking
	for ( const e of world.entities ) {

		if ( ! e.alive || ! e.solid || e.flags.ghost ) continue;
		world.spatial.forEach( e.x, e.z, e.radius, ( o ) => {

			const dx = e.x - o.x, dz = e.z - o.z, d = Math.hypot( dx, dz ) || 0.001;
			const overlap = e.radius + o.radius - d;
			if ( overlap <= 0 ) return;
			const wE = o.mass / ( e.mass + o.mass );
			const push = overlap * 0.5 * wE;
			e.x += dx / d * push; e.z += dz / d * push;

		}, ( o ) => o !== e && o.alive && o.solid && ! o.flags.ghost );
		world.spatial.update( e );

	}

	// animation state (what the rig layer should show)
	for ( const e of world.entities ) {

		const a = e.anim;
		a.speed = Math.hypot( e.vx, e.vz );
		if ( ! e.alive ) {

			a.t = Math.min( 1, ( world.time - ( e.data.deathTime ?? world.time ) ) / 1.2 );
			continue;

		}

		if ( e.action ) continue; // the action timeline owns state / phase / t
		if ( e.data.spawnUntil > world.time ) {

			// rising in: set data.spawnUntil (and spawnTime) when creating the entity
			a.state = 'spawn';
			a.t = 1 - ( e.data.spawnUntil - world.time ) / Math.max( 0.01, e.data.spawnUntil - ( e.data.spawnTime ?? world.time - 0.6 ) );
			continue;

		}

		if ( e.forced && e.data.dodging ) a.state = 'dodge';
		else if ( e.flags.stunned || e.flags.frozen ) a.state = 'stun';
		else if ( world.time - a.hitTime < 0.18 && e.kind !== 'player' ) a.state = 'hit';
		else a.state = a.speed > 0.35 ? 'move' : 'idle';
		if ( a.state !== 'action' ) a.action = null;

	}

}

function updateStatuses( world, dt ) {

	for ( const e of world.entities ) {

		if ( ! e.alive || ! e.statuses.size ) continue;
		for ( const s of [ ...e.statuses.values() ] ) {

			s.def.onTick?.( world, e, s, dt );
			s.time -= dt;
			if ( s.time <= 0 || ! e.alive ) world.removeStatus( e, s.id );

		}

	}

}

function updateRegen( world, dt ) {

	for ( const e of world.entities ) {

		if ( ! e.alive || e.kind === 'prop' ) continue;
		const S = e.stats;
		const maxL = S.get( 'life' ), maxM = S.get( 'mana' );
		if ( e.life < maxL ) e.life = Math.min( maxL, e.life + ( S.get( 'life_regen' ) + maxL * S.get( 'life_regen_pct' ) / 100 ) * dt );
		if ( e.mana < maxM ) e.mana = Math.min( maxM, e.mana + ( S.get( 'mana_regen' ) + maxM * S.get( 'mana_regen_pct' ) / 100 ) * dt );
		const maxS = S.get( 'shield' );
		if ( maxS > 0 && world.time - ( e.data.lastHitTime ?? - 99 ) > 2 ) e.shield = Math.min( maxS, e.shield + maxS * 0.25 * dt );
		if ( e.life > maxL ) e.life = maxL;

	}

}

function updateCleanup( world ) {

	// corpses stay for the death animation, then go; loot stays until picked up
	for ( let i = world.entities.length - 1; i >= 0; i -- ) {

		const e = world.entities[ i ];
		if ( e.alive || e.kind === 'player' || e.kind === 'loot' ) continue;
		if ( world.time - ( e.data.deathTime ?? 0 ) > ( e.data.corpseTime ?? 4 ) ) world.remove( e );

	}

}

const WALLS_ONLY = new Set( [ 0, 2 ] );

export const CORE_SYSTEMS = [
	{ id: 'core:actions', order: 30, update: updateActions },
	{ id: 'core:movement', order: 50, update: updateMovement },
	{ id: 'core:spatial', order: 59, update: ( world ) => world.spatial.refresh( world.entities ) },
	{ id: 'core:effects', order: 60, update: updateEffects },
	{ id: 'core:statuses', order: 70, update: updateStatuses },
	{ id: 'core:regen', order: 80, update: updateRegen },
	{ id: 'core:cleanup', order: 100, update: updateCleanup }
];
