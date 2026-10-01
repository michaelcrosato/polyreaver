// Entity: anything that lives in the simulation - the player, monsters, NPCs,
// props (barrels, shrines, chests), dropped loot. Plain data plus a StatBlock;
// behaviour lives in systems and controllers, looks live in the render layer.
//
// THE ANIMATION CONTRACT (sim -> render). The sim describes WHAT a body is doing;
// the rig layer decides HOW it looks. Renderers read `anim`, never write it:
//
//   anim.state     'idle' | 'move' | 'action' | 'dodge' | 'hit' | 'stun' | 'dead' | 'spawn'
//   anim.action    action id while state === 'action' ( 'slash', 'slam', 'cast', 'bite', ... )
//   anim.phase     'windup' | 'active' | 'recovery'   ( from the action timeline )
//   anim.t         0..1 progress through the current action / dodge / death
//   anim.duration  seconds the current action lasts (after attack/cast speed)
//   anim.seq       increments on every new action, so a renderer can restart blends
//   anim.speed     current ground speed in m/s (gait cycle rate)
//   anim.aimX/aimZ world point the entity is looking / aiming at
//   anim.hitDirX/Z, anim.hitTime   last hit direction and world.time (flinch)
//   anim.variant   0..n alternate (combo step, left/right swing, idle fidget)
//
// Positions are on the ground plane: x (east), z (south); y is up and only used
// by jumps/leaps ( `y`, `vy` ) and by the renderer.

import { StatBlock } from './stats.js';
import { TEAM } from './tuning.js';

let nextId = 1;

export class Entity {

	constructor( props = {} ) {

		this.id = nextId ++;
		this.kind = 'monster'; // 'player' | 'monster' | 'boss' | 'npc' | 'prop' | 'loot'
		this.name = '';
		this.team = TEAM.ENEMY;
		this.level = 1;

		// physical state
		this.x = 0; this.z = 0; this.y = 0;
		this.vx = 0; this.vz = 0; this.vy = 0;
		this.facing = 0; // radians, 0 = +z, PI/2 = +x (atan2( dx, dz ))
		this.radius = 0.45; this.height = 1.8; this.mass = 1;
		this.solid = true; // takes part in entity-entity separation
		this.moveIntent = { x: 0, z: 0 }; // desired direction * speed fraction (0..1)
		this.impulse = { x: 0, z: 0 }; // knockback velocity, decays
		this.forced = null; // { vx, vz, time } dashes / leaps / dodge: overrides steering

		// gameplay state
		this.stats = new StatBlock();
		this.life = 1; this.mana = 0; this.shield = 0;
		this.alive = true;
		this.statuses = new Map(); // id -> { id, time, stacks, data, source }
		this.flags = {}; // invulnerable, untargetable, stunned, rooted, silenced, ...
		this.tags = new Set();
		this.action = null; // running action instance ( core/actions.js )
		this.cooldowns = new Map(); // id -> world.time when ready
		this.controller = null; // { update( world, entity, dt ) }
		this.data = {}; // free-form per-system data

		// presentation
		this.model = null; // { type: 'hero'|'creature'|'npc'|'prop'|'loot', genome?, id?, palette?, scale? }
		this.anim = {
			state: 'idle', action: null, phase: null, t: 0, duration: 0, seq: 0, speed: 0,
			aimX: 0, aimZ: 0, hitDirX: 0, hitDirZ: 0, hitTime: - 1, variant: 0
		};

		Object.assign( this, props );

	}

	get maxLife() {

		return this.stats.get( 'life' );

	}

	get maxMana() {

		return this.stats.get( 'mana' );

	}

	get lifeFrac() {

		const m = this.maxLife;
		return m > 0 ? this.life / m : 0;

	}

	hasTag( t ) {

		return this.tags.has( t );

	}

	distTo( o ) {

		return Math.hypot( o.x - this.x, o.z - this.z );

	}

	// Snapshot for inspectors / the agent API (no functions, no cycles).
	describe() {

		return {
			id: this.id, kind: this.kind, name: this.name, team: this.team, level: this.level,
			x: +this.x.toFixed( 2 ), z: +this.z.toFixed( 2 ), facing: +this.facing.toFixed( 2 ),
			life: Math.round( this.life ), maxLife: Math.round( this.maxLife ), mana: Math.round( this.mana ),
			alive: this.alive, state: this.anim.state, action: this.anim.action,
			statuses: [ ...this.statuses.values() ].map( ( s ) => ( { id: s.id, stacks: s.stacks, time: +s.time.toFixed( 2 ) } ) ),
			tags: [ ...this.tags ], model: this.model ? { type: this.model.type, id: this.model.id } : null
		};

	}

}
