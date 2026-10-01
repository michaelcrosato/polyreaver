// Shared helpers for monster content: elements, hit templates, telegraphs, action
// timelines and a little ground geometry. Everything here is sim-safe (no three.js,
// no DOM) and takes `world` / entities explicitly, so abilities, affixes and boss
// patterns stay short declarative definitions instead of copies of the same maths.

import { TEAM } from '../../core/tuning.js';
import { TILE } from '../../core/layout.js';

// --- elements -------------------------------------------------------------------
// One table drives colours (placeholder renderer + nameplates), the VFX hint each
// delivery shape carries (`fx`, rendered by the combat feature's VFX), and the
// ailment an element prefers. Monster content only ever says `element: 'cold'`.

export const ELEMENTS = {
	physical: { color: '#d9c9a8', area: 'slam', bolt: 'shard', cloud: 'dust', ailment: 'bleed' },
	fire: { color: '#ff6a2b', area: 'fire', bolt: 'fire', cloud: 'fire', ailment: 'ignite' },
	cold: { color: '#8fdcff', area: 'ice', bolt: 'ice', cloud: 'ice', ailment: 'chill' },
	lightning: { color: '#c8b0ff', area: 'lightning', bolt: 'lightning', cloud: 'lightning', ailment: 'shock' },
	chaos: { color: '#8cff5a', area: 'poison', bolt: 'poison', cloud: 'poison', ailment: 'poison' }
};

export const elementOf = ( e, override ) => ( override && override !== 'family' ? override : e.data.element ) || 'physical';
export const colorOf = ( element ) => ( ELEMENTS[ element ] || ELEMENTS.physical ).color;
export const fxOf = ( element, shape = 'area' ) => ( ELEMENTS[ element ] || ELEMENTS.physical )[ shape ];

// Rarity colours, matching the item rarity CSS variables in game.html.
export const RARITY_COLOR = { normal: '#e8e8e8', magic: '#7aa7ff', rare: '#ffe066', unique: '#ff9a3c', boss: '#ff5a7a' };

// --- hit templates -----------------------------------------------------------------
// A monster's damage is ONE number pair, e.data.damage = [ min, max ] (already scaled
// by level, family and archetype). Every ability is "mult × that hit", split between
// physical and the monster's element, so a new ability never needs its own balance
// table and a cold family's slam is automatically a cold slam.
//   split: fraction converted to the element (default: all of it for elemental
//          monsters, none for physical ones; melee abilities usually pass 0.5)

export function hitOf( e, mult, { element, split, tags = [ 'attack' ], skill, knockback, stun, ailments, onHit, canBlock, canEvade } = {} ) {

	const el = elementOf( e, element );
	const [ lo, hi ] = e.data.damage || [ 4, 7 ];
	const conv = el === 'physical' ? 0 : ( split ?? 1 );
	const damage = {};
	if ( conv < 1 ) damage.physical = [ lo * mult * ( 1 - conv ), hi * mult * ( 1 - conv ) ];
	if ( conv > 0 ) damage[ el ] = [ lo * mult * conv, hi * mult * conv ];
	return { damage, tags: tags.concat( el ), skill, knockback, stun, ailments, onHit, canBlock, canEvade, addFlat: true };

}

// --- telegraphs ------------------------------------------------------------------------
// The fairness rule of the whole feature: every heavy hit is announced. A
// telegraph is a ground AREA with `delay` - the danger zone is visible for the
// whole delay and only then deals damage. Telegraphs started by an action are
// remembered on the action, so stunning or killing the monster during its windup
// cancels the hit (interrupting a slam is the reward for fast, skilled play).
// `fx` names the IMPACT ( 'slam', 'fire', 'ice'... ); the VFX layer draws the
// warning while `age < delay` and the impact after. Areas with no `hit` are pure
// warnings ( fx 'telegraph' ): landing spots, charge lanes, emerge points.
export function telegraph( world, e, act, opts ) {

	const el = elementOf( e, opts.element );
	const a = world.area( e, { fx: opts.hit ? fxOf( el ) : 'telegraph', color: colorOf( el ), element: el, ...opts } );
	a.data.telegraph = true;
	if ( act ) ( act.ctx.areas || ( act.ctx.areas = [] ) ).push( a );
	return a;

}

export function cancelArea( world, a ) {

	if ( ! a.alive ) return;
	a.alive = false;
	world.events.emit( 'area:end', { a, cancelled: true } );

}

export function cancelTelegraphs( world, e, act ) {

	for ( const a of act?.ctx?.areas || [] ) if ( a.age < a.delay ) cancelArea( world, a );

}

// Seconds from the start of an action until its active phase (= the telegraph time).
export const windupSeconds = ( act ) => act.duration * ( act.def.windup ?? 0.35 );

// --- action timelines -------------------------------------------------------------------
// Monster abilities and boss patterns are ordinary action defs (core/actions.js).
// timeline() lets content be written in SECONDS, which is how designers think about
// telegraphs ("slam lands 0.7 s after the windup starts"):
//
//   timeline( { id: 'slam-ring', anim: 'slam', seconds: 2.4, steps: [ [ 0, start ], [ 0.8, impact ] ] } )

export function timeline( { id, anim, seconds, windup = 0.3, active = 0.75, steps = [], unstoppable = true, moveMult = 0, turn = false, onStart, onEnd, onCancel, tags = [ 'spell', 'area' ] } ) {

	return {
		id, anim: anim || id, duration: seconds, speedStat: null, windup, active, cancelAt: 1, moveMult, turn, unstoppable, tags,
		events: steps.map( ( [ t, fn ] ) => ( { at: Math.min( 0.999, t / seconds ), fn } ) ),
		onStart, onEnd,
		onCancel( world, e, act, reason ) {

			cancelTelegraphs( world, e, act );
			onCancel?.( world, e, act, reason );

		}
	};

}

// --- targets, allies, geometry -------------------------------------------------------------

export const isHostile = ( a, b ) => b.alive && a.team !== b.team && b.team !== TEAM.NEUTRAL && b.kind !== 'loot' && b.kind !== 'npc' && ! b.flags.untargetable;

export function alliesNear( world, e, r, includeSelf = false ) {

	return world.query( e.x, e.z, r, ( o ) => o.alive && o.team === e.team && ( includeSelf || o !== e ) && ( o.kind === 'monster' || o.kind === 'boss' ) );

}

export function foesNear( world, e, x, z, r ) {

	return world.query( x, z, r, ( o ) => isHostile( e, o ) );

}

export const dist = ( a, b ) => Math.hypot( b.x - a.x, b.z - a.z );
export const edgeDist = ( a, b ) => Math.max( 0, Math.hypot( b.x - a.x, b.z - a.z ) - a.radius - b.radius );

// Point `d` metres from `e` along `dir` (radians, 0 = +z).
export const ahead = ( e, d, dir = e.facing ) => ( { x: e.x + Math.sin( dir ) * d, z: e.z + Math.cos( dir ) * d } );

const MOVE_BLOCK = new Set( [ TILE.VOID, TILE.WALL, TILE.PIT, TILE.WATER ] );
export const MOVE_BLOCKERS = MOVE_BLOCK;

// Can a walker go in a straight line from a to b (no walls, pits or water)?
export function clearWalk( world, x0, z0, x1, z1 ) {

	return world.layout.raycast( x0, z0, x1, z1, MOVE_BLOCK ) >= 1;

}

// Clamp a destination to the last walkable point on the straight line from (x0,z0).
export function clampWalk( world, x0, z0, x1, z1, margin = 0.6 ) {

	const len = Math.hypot( x1 - x0, z1 - z0 );
	if ( len < 1e-3 ) return { x: x0, z: z0 };
	const t = world.layout.raycast( x0, z0, x1, z1, MOVE_BLOCK );
	const k = Math.max( 0, t - ( t < 1 ? margin / len : 0 ) );
	return { x: x0 + ( x1 - x0 ) * k, z: z0 + ( z1 - z0 ) * k };

}

export function walkable( world, x, z ) {

	return world.layout.isWalkable( x, z );

}

// A walkable point at distance [rMin, rMax] around (x, z), in sight of the centre.
export function ringPoint( world, rng, x, z, rMin, rMax, tries = 16 ) {

	for ( let i = 0; i < tries; i ++ ) {

		const a = rng.next() * Math.PI * 2, r = rMin + rng.next() * ( rMax - rMin );
		const px = x + Math.sin( a ) * r, pz = z + Math.cos( a ) * r;
		if ( walkable( world, px, pz ) && clearWalk( world, x, z, px, pz ) ) return { x: px, z: pz };

	}

	return null;

}

// Is (px, pz) inside a line segment area (start x,z, direction dir, length, width)?
export function inLine( px, pz, x, z, dir, length, width, pad = 0 ) {

	const fx = Math.sin( dir ), fz = Math.cos( dir );
	const dx = px - x, dz = pz - z;
	const along = dx * fx + dz * fz, across = Math.abs( - dx * fz + dz * fx );
	return along >= - pad && along <= length + pad && across <= width / 2 + pad;

}

// Damage targets with a per-target cooldown - for continuous effects (sweeping
// beams, auras, pulling wells) that tick every frame but should hit at a fair rate.
export function tickHit( world, owner, target, hit, key, every = 0.4 ) {

	const cd = target.data.tickHits || ( target.data.tickHits = new Map() );
	if ( ( cd.get( key ) ?? - 1 ) > world.time ) return null;
	cd.set( key, world.time + every );
	return world.dealDamage( owner, target, hit );

}

// Heal an entity by a fraction of its life (support abilities, affixes, bosses).
export function healFrac( world, e, frac ) {

	if ( ! e.alive ) return 0;
	const before = e.life;
	e.life = Math.min( e.maxLife, e.life + e.maxLife * frac );
	const amount = e.life - before;
	if ( amount > 0 ) world.events.emit( 'heal', { entity: e, amount, x: e.x, z: e.z } );
	return amount;

}

// Teleport without the render layer interpolating a streak across the map.
export function teleport( e, x, z ) {

	e.x = e.px = x;
	e.z = e.pz = z;
	e.vx = e.vz = 0;

}

// Pull / push a target toward a point (gravity wells, hooks); heavy bodies resist.
export function pull( target, x, z, strength ) {

	if ( target.flags.unstoppable ) return;
	const dx = x - target.x, dz = z - target.z, d = Math.hypot( dx, dz ) || 1;
	target.impulse.x += dx / d * strength / Math.max( 0.5, target.mass );
	target.impulse.z += dz / d * strength / Math.max( 0.5, target.mass );

}

// Charges: the charger is a ghost for the length of the rush (it passes through
// bodies instead of bulldozing them along - core separation would otherwise push
// the light player ahead of the heavy monster all the way to a wall), and what it
// hits is flung SIDEWAYS out of the lane.
export function laneKnock( target, dir, x, z, strength ) {

	if ( target.flags.unstoppable ) return;
	const rx = Math.cos( dir ), rz = - Math.sin( dir );
	const side = Math.sign( ( target.x - x ) * rx + ( target.z - z ) * rz ) || 1;
	target.impulse.x += rx * side * strength / Math.max( 0.5, target.mass );
	target.impulse.z += rz * side * strength / Math.max( 0.5, target.mass );

}

// The AI rng: forked per world so AI decisions never shift loot or level rolls.
export function aiRng( world ) {

	return world.state.aiRng || ( world.state.aiRng = world.rng.fork( 'monster-ai' ) );

}

// Per-monster stagger value for "every Nth step" work and idle variety. Entity ids
// come from a process-wide counter, so they differ between two worlds built in the
// same process; the salt is drawn from the world's spawn rng and keeps a seeded run
// identical however many runs came before it.
export const salt = ( e ) => e.data.salt ?? e.id;

export const clamp = ( v, a, b ) => Math.max( a, Math.min( b, v ) );
export const lerp = ( a, b, t ) => a + ( b - a ) * t;
export const angleTo = ( a, b ) => Math.atan2( b.x - a.x, b.z - a.z );
export const wrapAngle = ( a ) => Math.atan2( Math.sin( a ), Math.cos( a ) );
