// Mechanic kit: the small vocabulary every level mechanic is written in, so the
// twelve mechanics (and any an agent adds) behave consistently and COMBINE:
//
//   makeProp( world, {...} )      an entity-backed level object (keg, pylon, brazier...)
//   hazardHit( world, e, {...} )  environment damage that scales the right way for
//                                 each target: area-level damage for the player,
//                                 % of max life for monsters (so luring always pays)
//   blast( world, {...} )         an explosion: damages everything around, credits
//                                 the instigator (XP / loot) and broadcasts
//                                 'mechanic' { event: 'blast' } so OTHER mechanics react
//                                 (miasma burns away, braziers ignite, swarmlings die)
//   fieldAt( world, x, z )        what the active mechanics do to a point in space
//                                 (speed, light, hazard, pull, warp) - the swarm and
//                                 the lighting both ask this instead of knowing every mechanic
//   tiles helpers for decorators ( roomTiles, freeSpot )
//
// Two channels make combinations emergent rather than hand-written: BLASTS (events)
// and FIELDS (queries). Plus every mechanic object is an entity, so ice slides kegs,
// wells pull them, rifts teleport them and spikes light their fuses for free.

import { Entity } from '../../../core/entity.js';
import { TEAM, monsterScaling } from '../../../core/tuning.js';
import { TILE } from '../../../core/layout.js';
import { define } from '../../../core/registry.js';
import { walkable } from '../gen/grid.js';

export const isMonster = ( e ) => e.alive && e.team === TEAM.ENEMY && ( e.kind === 'monster' || e.kind === 'boss' );
export const isBody = ( e ) => e.alive && ( e.kind === 'player' || e.kind === 'monster' || e.kind === 'boss' );
export const affected = ( e ) => e.alive && e.kind !== 'loot' && e.kind !== 'npc' && e.kind !== 'echo' && ! e.flags.untargetable && ! e.flags.inert;

// --- entities ------------------------------------------------------------------------

export function makeProp( world, { name = 'Object', x, z, model, radius = 0.5, height = 1, team = TEAM.NEUTRAL, life = 1e9, solid = true, mass = 1000, movable = false, data = {}, flags = {} } ) {

	const e = new Entity( { kind: 'prop', name, team, x, z, radius, height, mass, solid } );
	e.stats.base.life = life;
	e.life = life;
	e.model = { type: 'mech', id: model };
	e.data = { movable, ...data };
	Object.assign( e.flags, flags );
	e.px = x; e.pz = z; e.py = 0; e.pf = 0;
	return e;

}

// --- damage ---------------------------------------------------------------------------

// Damage of the environment. base: flat damage at area level 1 (scaled by the area
// level, like a monster hit) used against the player; pct: fraction of max life used
// against monsters (bosses take a quarter). Props only get a 1-point "nudge" - their
// onStruck hook decides what being hit means (a keg lights its fuse).
export function hazardAmount( world, e, base, pct ) {

	const sc = monsterScaling( world.level ).damage;
	if ( e.team === TEAM.PLAYER ) return base * sc * world.tuning.enemyDamage;
	if ( e.kind === 'prop' ) return 1;
	return e.maxLife * pct * ( e.kind === 'boss' ? 0.25 : 1 ) + base * 0.5 * sc;

}

export function hazardHit( world, e, { base = 10, pct = 0.1, element = 'physical', tags = [], stun = 0, knockback = 0, x, z, source = null } = {} ) {

	if ( ! affected( e ) && e.kind !== 'prop' ) return null;
	const amount = hazardAmount( world, e, base, pct );
	const src = source && source.team !== e.team ? source : null;
	return world.dealDamage( src, e, {
		damage: { [ element ]: amount }, addFlat: false, canCrit: false, canEvade: false, canBlock: false, noLeech: true, noAilments: true,
		tags: [ 'hazard', element, ...tags ], stun: e.team === TEAM.PLAYER ? 0 : stun, knockback, originX: x ?? e.x, originZ: z ?? e.z, skill: tags[ 0 ] || 'hazard'
	} );

}

// An explosion at x, z. `instigator` (whoever lit the fuse) gets the credit for
// kills of the other team; it is still hurt by its own blast, as the environment.
export function blast( world, { x, z, radius = 3, base = 18, pct = 0.3, element = 'fire', knockback = 9, instigator = null, id = 'blast', tags = [], selfMult = 0.6, stun = 0.4 } ) {

	// only the player's side earns credit; a monster-lit blast hurts everyone "for nobody"
	const credit = instigator?.team === TEAM.PLAYER ? instigator : null;
	let hits = 0;
	for ( const e of world.spatial.query( x, z, radius, ( o ) => affected( o ) || ( o.kind === 'prop' && o.data.onStruck ) ) ) {

		if ( ! e.alive ) continue;
		const d = Math.hypot( e.x - x, e.z - z );
		const fall = 1 - 0.45 * Math.min( 1, d / radius );
		const self = e.team === TEAM.PLAYER ? selfMult : 1;
		hazardHit( world, e, { base: base * fall * self, pct: pct * fall, element, tags: [ id, 'blast', ...tags ], stun, knockback, x, z, source: credit } );
		hits ++;

	}

	world.events.emit( 'mechanic', { id, event: 'blast', x, z, radius, element } );
	world.events.emit( 'shake', { amount: Math.min( 1, radius / 6 ) } );
	return hits;

}

// --- fields ------------------------------------------------------------------------------
// Each active mechanic may implement field( world, ctx, x, z, out ). Callers get the
// combined effect without knowing which mechanics are running.

export function fieldAt( world, x, z, out = {} ) {

	out.speed = 1; out.lit = false; out.hazard = false; out.pullX = 0; out.pullZ = 0; out.warp = null;
	for ( const ctx of world.state.mechanics || [] ) ctx.def.field?.( world, ctx, x, z, out );
	return out;

}

// --- layout helpers for decorators ----------------------------------------------------------

export function roomTiles( L, room, pass = ( t ) => t === TILE.FLOOR ) {

	const out = [];
	for ( let z = room.z; z < room.z + room.h; z ++ ) for ( let x = room.x; x < room.x + room.w; x ++ ) if ( L.inside( x, z ) && pass( L.get( x, z ) ) ) out.push( { x, z } );
	return out;

}

// A random free floor tile in a room at least `margin` tiles from walls and `away`
// tiles from the room anchor (so mechanic objects do not sit on the entrance).
export function freeSpot( L, rng, room, wd, { margin = 2, away = 0, tries = 40, tile = TILE.FLOOR } = {} ) {

	for ( let i = 0; i < tries; i ++ ) {

		const x = rng.int( room.x, room.x + room.w - 1 ), z = rng.int( room.z, room.z + room.h - 1 );
		if ( ! L.inside( x, z ) ) continue;
		const k = L.idx( x, z );
		if ( L.tiles[ k ] !== tile || L.occ[ k ] || wd[ k ] < margin ) continue;
		if ( away && Math.hypot( x - room.ax, z - room.az ) < away ) continue;
		return { x, z };

	}

	return null;

}

export function addMechProp( L, type, tx, tz, data = {} ) {

	const [ x, z ] = L.toWorld( tx, tz );
	L.props.push( { type, x, z, rot: 0, scale: 1, data } );
	L.occ[ L.idx( tx, tz ) ] = 1;
	return L.props[ L.props.length - 1 ];

}

// Rooms that mechanics should decorate (fights happen there), best first.
export function fightRooms( L ) {

	return L.rooms.filter( ( r ) => r.kind === 'combat' || r.kind === 'treasure' );

}

export function walkableAt( L, x, z ) {

	return walkable( L.tileAt( x, z ) );

}

// --- statuses used by several mechanics ---------------------------------------------------
// damage_taken is a multiplier stat whose base is 1; make sure it exists before a
// 'more' modifier scales it (0 * anything stays 0).
const ensureTaken = ( world, e ) => {

	if ( e.stats.base.damage_taken === undefined ) e.stats.setBase( 'damage_taken', 1 );

};

define( 'status', { id: 'exposed', name: 'Exposed', tags: [ 'debuff', 'light' ], duration: 0.5, stack: 'refresh', onApply: ensureTaken,
	mods: () => [ { stat: 'damage', type: 'more', value: - 25 }, { stat: 'damage_taken', type: 'more', value: 25 } ] } );

define( 'status', { id: 'shrouded', name: 'Shrouded', tags: [ 'buff', 'dark' ], duration: 0.5, stack: 'refresh', onApply: ensureTaken,
	mods: () => [ { stat: 'damage', type: 'more', value: 20 }, { stat: 'damage_taken', type: 'more', value: - 20 } ] } );

define( 'status', { id: 'chrono-slow', name: 'Slowed time', tags: [ 'debuff', 'time' ], duration: 0.3, stack: 'refresh',
	mods: () => [ { stat: 'move_speed', type: 'more', value: - 45 }, { stat: 'attack_speed', type: 'more', value: - 40 }, { stat: 'cast_speed', type: 'more', value: - 40 } ] } );

define( 'status', { id: 'chrono-haste', name: 'Hastened time', tags: [ 'buff', 'time' ], duration: 0.3, stack: 'refresh',
	mods: () => [ { stat: 'move_speed', type: 'more', value: 30 }, { stat: 'attack_speed', type: 'more', value: 35 }, { stat: 'cast_speed', type: 'more', value: 35 } ] } );

define( 'status', { id: 'blighted', name: 'Blighted', tags: [ 'buff', 'poison' ], duration: 0.6, stack: 'refresh',
	mods: () => [ { stat: 'damage', type: 'more', value: 25 }, { stat: 'life_regen_pct', type: 'flat', value: 1.5 } ] } );

define( 'status', { id: 'cleansed', name: 'Cleansed', tags: [ 'buff', 'holy' ], duration: 15, stack: 'refresh', flags: [ 'cleansed' ],
	mods: () => [ { stat: 'life_regen_pct', type: 'flat', value: 1.5 } ] } );

// Miasma: stacking chaos damage over time while you breathe the fog (immune while Cleansed).
define( 'status', { id: 'miasma', name: 'Miasma', tags: [ 'debuff', 'poison', 'dot' ], duration: 2.5, stack: 'add', maxStacks: 10, immuneFlag: 'cleansed',
	onTick( world, e, s, dt ) {

		s.data.acc = ( s.data.acc ?? 0 ) + dt;
		if ( s.data.acc < 0.5 ) return;
		s.data.acc -= 0.5;
		const per = 0.5 * monsterScaling( world.level ).damage * world.tuning.enemyDamage;
		world.dealDamage( null, e, { damage: { chaos: per * s.stacks }, addFlat: false, canCrit: false, canEvade: false, canBlock: false, noAilments: true, tags: [ 'dot', 'miasma' ], skill: 'miasma' } );

	} } );
