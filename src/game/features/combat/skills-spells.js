// Spells: projectiles, ground areas, movement, warcries / buffs and minions.
//
// Casts are short (0.35-0.6 s at 100% cast speed) with the release at ~75% of the
// windup so the hand visibly pushes the spell out. Every delivery goes through the
// core shapes (world.projectile / world.area / world.dealDamage) with an `fx` hint
// and an `element`; the combat client draws them from those hints, so monster
// abilities using the same hints get the same visuals for free:
//
//   projectile fx: orb  shard  spark  blade  frost  ball  bolt  arrow  spit
//   area fx:       nova  slam  quake  aftershock  fire  meteor  storm  poison  icespike  explosion  dash
//   'fx' events:   beam (lightning arcs), blink, burst, impact, shatter, ring (warcries, buffs)

import { define } from '../../core/registry.js';
import { skillAction, volley, repeat, groundTarget, feel, spellScale, isFoe } from './skill-core.js';
import { summonMinions } from './minions.js';

const S = spellScale;
const dirTo = ( e, x, z ) => Math.atan2( x - e.x, z - e.z );

// A standard cast timeline: fn( world, e ) runs at the release point (and again for
// Spell Echo). The aim is read from the action at release - the controller keeps it
// following the cursor / stick during the windup.
function cast( ctx, fn, { anim = 'cast', release = 0.42, moveMult = 0.4, turn = true, ...rest } = {} ) {

	return skillAction( ctx, {
		anim, windup: release, active: Math.min( 0.9, release + 0.18 ), cancelAt: Math.min( 0.9, release + 0.16 ), moveMult, turn,
		events: [ { at: release, fn: ( world, e, act ) => {

			ctx.aimX = act.aimX; ctx.aimZ = act.aimZ;
			repeat( world, e, ctx, fn );

		} } ], ...rest
	} );

}

// --- projectiles -------------------------------------------------------------------------------

define( 'skill', {
	id: 'fireball', name: 'Fireball', tags: [ 'spell', 'projectile', 'area', 'fire' ], element: 'fire', icon: 'fireball',
	manaCost: 7, levelReq: 1, time: 0.52,
	desc: 'Hurl a ball of fire that explodes on impact, igniting enemies.',
	hits: {
		main: ( lv ) => ( { fire: [ 9 * S( lv ), 14 * S( lv ) ], crit: 6, ailments: { ignite: 25 }, knockback: 3 } ),
		explosion: ( lv ) => ( { fire: [ 5 * S( lv ), 8 * S( lv ) ], crit: 6, ailments: { ignite: 15 }, knockback: 5, label: 'Explosion' } )
	},
	action( level, ctx ) {

		const hit = ctx.hit(), boom = ctx.hit( 'explosion' );
		return cast( ctx, ( world, e ) => volley( world, e, ctx, {
			speed: 21, range: 22, radius: 0.35, hit, fx: 'orb', size: 1.25, spread: 9,
			onEnd: ( w, p, reason ) => {

				if ( reason === 'returned' ) return;
				const a = w.area( e, { x: p.x, z: p.z, radius: 1.9 * ctx.radius, hit: boom, fx: 'explosion', element: ctx.element } );
				for ( const id of p.hitIds ) a.hitIds.add( id );
				feel( w, e, { shake: 0.07 } );

			}
		} ) );

	}
} );

define( 'skill', {
	id: 'ice-spear', name: 'Ice Spear', tags: [ 'spell', 'projectile', 'cold' ], element: 'cold', icon: 'spear',
	manaCost: 6, levelReq: 1, time: 0.48,
	desc: 'A fast shard of ice that pierces, then shatters into four splinters. High critical strike chance.',
	hits: {
		main: ( lv ) => ( { cold: [ 8 * S( lv ), 12 * S( lv ) ], crit: 9, ailments: { chill: 100, freeze: 15 } } ),
		shard: ( lv ) => ( { cold: [ 4 * S( lv ), 6 * S( lv ) ], crit: 12, ailments: { chill: 100, freeze: 8 }, label: 'Splinter' } )
	},
	action( level, ctx ) {

		const hit = ctx.hit(), shard = ctx.hit( 'shard' );
		return cast( ctx, ( world, e ) => volley( world, e, ctx, {
			speed: 34, range: 18, radius: 0.3, pierce: 1, hit, fx: 'shard', size: 1.5, spread: 7,
			onEnd: ( w, p, reason ) => {

				if ( reason === 'wall' || p.data.shard ) return;
				for ( let i = 0; i < 4; i ++ ) {

					const s = w.projectile( e, { x: p.x, z: p.z, dir: p.dir + ( i - 1.5 ) * 0.32, speed: 26, range: 7, radius: 0.25, hit: shard, fx: 'shard', size: 0.55, element: 'cold', data: { shard: true } } );
					for ( const id of p.hitIds ) s.hitIds.add( id );

				}

				w.events.emit( 'fx', { kind: 'shatter', x: p.x, z: p.z, element: 'cold', small: true } );

			}
		} ), { release: 0.4 } );

	}
} );

define( 'skill', {
	id: 'spark', name: 'Spark', tags: [ 'spell', 'projectile', 'lightning' ], element: 'lightning', icon: 'spark',
	manaCost: 6, levelReq: 1, time: 0.48, projectiles: 4,
	desc: 'Release a cluster of erratic sparks that wander and pass through enemies, shocking them.',
	hits: { main: ( lv ) => ( { lightning: [ 1 * S( lv ), 15 * S( lv ) ], crit: 6, ailments: { shock: 20 } } ) },
	info: ( lv, ctx ) => [ `${ctx.projectiles} sparks` ],
	action( level, ctx ) {

		const hit = ctx.hit();
		return cast( ctx, ( world, e ) => volley( world, e, ctx, {
			speed: 13, range: 26, radius: 0.45, pierce: 99, hit, fx: 'spark', size: 0.9, spread: 16, data: { wander: 6 }
		} ) );

	}
} );

// Arc: instant chain lightning - not a projectile but a sequence of beams, so chain
// count comes from the skill (4) plus Chain supports / chain stats.
define( 'skill', {
	id: 'arc', name: 'Arc', tags: [ 'spell', 'lightning', 'chain' ], element: 'lightning', icon: 'arc',
	manaCost: 7, levelReq: 2, time: 0.42, range: 11,
	desc: 'A beam of lightning that jumps from enemy to enemy (4 chains).',
	hits: { main: ( lv ) => ( { lightning: [ 3 * S( lv ), 17 * S( lv ) ], crit: 6, ailments: { shock: 25 } } ) },
	info: ( lv, ctx ) => [ `Chains ${4 + ctx.chain} times` ],
	action( level, ctx ) {

		const hit = ctx.hit();
		return cast( ctx, ( world, e ) => {

			const dir = dirTo( e, ctx.aimX, ctx.aimZ );
			const fx = Math.sin( dir ), fz = Math.cos( dir );
			// first target: closest to the aim ray within range, inside a 35° cone
			let first = null, best = Infinity;
			for ( const o of world.enemiesOf( e, e.x, e.z, 11 ) ) {

				const dx = o.x - e.x, dz = o.z - e.z, d = Math.hypot( dx, dz ) || 1;
				const cos = ( dx * fx + dz * fz ) / d;
				if ( cos < 0.82 || ! world.layout.hasLineOfSight( e.x, e.z, o.x, o.z ) ) continue;
				const score = d * ( 2 - cos );
				if ( score < best ) {

					best = score;
					first = o;

				}

			}

			let from = { x: e.x + fx * 0.6, z: e.z + fz * 0.6, y: 1.35 };
			if ( ! first ) {

				const end = groundTarget( world, e, e.x + fx * 9, e.z + fz * 9, 9 );
				world.events.emit( 'fx', { kind: 'beam', x1: from.x, y1: from.y, z1: from.z, x2: end.x, y2: 0.6, z2: end.z, element: 'lightning', time: 0.18 } );
				return;

			}

			const done = new Set();
			let cur = first, n = 5 + ctx.chain;
			while ( cur && n -- > 0 ) {

				done.add( cur.id );
				world.events.emit( 'fx', { kind: 'beam', x1: from.x, y1: from.y, z1: from.z, x2: cur.x, y2: 1.0, z2: cur.z, element: 'lightning', time: 0.22 } );
				world.dealDamage( e, cur, hit );
				from = { x: cur.x, z: cur.z, y: 1.0 };
				const c = cur;
				cur = world.spatial.nearest( c.x, c.z, 7, ( o ) => isFoe( e, o ) && ! done.has( o.id ) && world.layout.hasLineOfSight( c.x, c.z, o.x, o.z ) );

			}

		}, { release: 0.36 } );

	}
} );

define( 'skill', {
	id: 'ethereal-knives', name: 'Ethereal Knives', tags: [ 'spell', 'projectile', 'physical' ], element: 'physical', icon: 'knives',
	manaCost: 6, levelReq: 2, time: 0.42, projectiles: 7,
	desc: 'Fire a fan of spectral knives.',
	hits: { main: ( lv ) => ( { physical: [ 5 * S( lv ), 8 * S( lv ) ], crit: 6, ailments: { bleed: 10 }, knockback: 1.5 } ) },
	info: ( lv, ctx ) => [ `${ctx.projectiles} knives` ],
	action( level, ctx ) {

		const hit = ctx.hit();
		return cast( ctx, ( world, e ) => volley( world, e, ctx, { speed: 27, range: 13, radius: 0.28, hit, fx: 'blade', size: 0.85, spread: 9, maxFan: 110 } ), { anim: 'throw', release: 0.36 } );

	}
} );

define( 'skill', {
	id: 'blade-vortex', name: 'Blade Vortex', tags: [ 'spell', 'area', 'physical', 'duration' ], element: 'physical', icon: 'vortex',
	manaCost: 5, levelReq: 4, time: 0.38,
	desc: 'Conjure an orbiting blade (up to 6). Each blade cuts enemies inside the orbit three times a second.',
	hits: { main: ( lv ) => ( { physical: [ 2 * S( lv ), 4 * S( lv ) ], crit: 6, label: 'Per blade, per hit' } ) },
	action( level, ctx ) {

		const hit = ctx.hit();
		return cast( ctx, ( world, e ) => {

			const s = world.applyStatus( e, 'blade-vortex', { hit, radius: 2.5 * ctx.radius, duration: 5 * ctx.duration } );
			if ( s ) {

				s.data.hit = hit;
				s.data.radius = 2.5 * ctx.radius;

			}

		}, { release: 0.34, moveMult: 0.7, turn: false } );

	}
} );

define( 'skill', {
	id: 'frost-bolt', name: 'Frost Bolt', tags: [ 'spell', 'projectile', 'cold' ], element: 'cold', icon: 'frostbolt',
	manaCost: 6, levelReq: 3, time: 0.5,
	desc: 'A slow, heavy orb of frost that pierces everything in its path, chilling and freezing.',
	hits: { main: ( lv ) => ( { cold: [ 7 * S( lv ), 11 * S( lv ) ], crit: 6, ailments: { chill: 100, freeze: 12 }, knockback: 2 } ) },
	action( level, ctx ) {

		const hit = ctx.hit();
		return cast( ctx, ( world, e ) => volley( world, e, ctx, { speed: 10, range: 17, radius: 0.6, pierce: 99, hit, fx: 'frost', size: 1.35, spread: 12 } ) );

	}
} );

// Ball Lightning: the orb itself deals no contact damage; the projectile behaviour
// system (sim.js) zaps nearby enemies from it every 0.16 s.
define( 'skill', {
	id: 'ball-lightning', name: 'Ball Lightning', tags: [ 'spell', 'projectile', 'area', 'lightning' ], element: 'lightning', icon: 'ball',
	manaCost: 9, levelReq: 6, time: 0.55,
	desc: 'A slow orb of lightning that strikes every enemy near its path several times.',
	hits: { main: ( lv ) => ( { lightning: [ 1 * S( lv ), 8 * S( lv ) ], crit: 6, ailments: { shock: 12 }, label: 'Per zap' } ) },
	action( level, ctx ) {

		const hit = ctx.hit();
		return cast( ctx, ( world, e ) => volley( world, e, ctx, {
			speed: 7.5, range: 17, radius: 0.6, pierce: 999, fx: 'ball', size: 1.4, spread: 14,
			data: { zap: { hit, radius: 3.4 * ctx.radius, interval: 0.16, next: 0, targets: 2 } }
		} ) );

	}
} );

// --- ground areas -------------------------------------------------------------------------------

define( 'skill', {
	id: 'frost-nova', name: 'Frost Nova', tags: [ 'spell', 'area', 'cold' ], element: 'cold', icon: 'nova',
	manaCost: 9, cooldown: 2.5, levelReq: 1, time: 0.4,
	desc: 'A ring of frost bursts from you, chilling everything around and freezing many.',
	hits: { main: ( lv ) => ( { cold: [ 8 * S( lv ), 12 * S( lv ) ], crit: 6, ailments: { chill: 100, freeze: 35 }, knockback: 5 } ) },
	action( level, ctx ) {

		const hit = ctx.hit();
		return cast( ctx, ( world, e ) => {

			world.area( e, { radius: 4.4 * ctx.radius, hit, fx: 'nova', element: ctx.element } );
			feel( world, e, { shake: 0.14 } );

		}, { anim: 'cast_aoe', release: 0.36, moveMult: 0.2, turn: false } );

	}
} );

define( 'skill', {
	id: 'flame-wall', name: 'Flame Wall', tags: [ 'spell', 'area', 'fire', 'duration' ], element: 'fire', icon: 'wall',
	manaCost: 10, levelReq: 4, time: 0.46, range: 11,
	desc: 'Raise a wall of fire across the target location that burns enemies inside it.',
	hits: { main: ( lv ) => ( { fire: [ 3 * S( lv ), 5 * S( lv ) ], crit: 0, ailments: { ignite: 25 }, label: 'Burn (4 per second)' } ) },
	action( level, ctx ) {

		const hit = ctx.hit();
		return cast( ctx, ( world, e ) => {

			const t = groundTarget( world, e, ctx.aimX, ctx.aimZ, 11, 2 );
			const len = 7.5 * ctx.radius, dir = t.dir + Math.PI / 2;
			world.area( e, { x: t.x - Math.sin( dir ) * len / 2, z: t.z - Math.cos( dir ) * len / 2, shape: 'line', dir, length: len, width: 1.4, radius: len,
				duration: 4 * ctx.duration, interval: 0.25, hitOnce: false, hit, fx: 'fire', element: ctx.element } );

		} );

	}
} );

define( 'skill', {
	id: 'meteor', name: 'Meteor', tags: [ 'spell', 'area', 'fire' ], element: 'fire', icon: 'meteor',
	manaCost: 16, cooldown: 3, levelReq: 5, time: 0.6, range: 15,
	desc: 'Call a meteor down on the target location; it leaves the ground burning.',
	hits: {
		main: ( lv ) => ( { fire: [ 22 * S( lv ), 34 * S( lv ) ], crit: 6, ailments: { ignite: 40 }, knockback: 9, stun: 0.4, label: 'Impact' } ),
		burn: ( lv ) => ( { fire: [ 2 * S( lv ), 4 * S( lv ) ], crit: 0, label: 'Burning ground (3 per second)' } )
	},
	action( level, ctx ) {

		const hit = ctx.hit(), burn = ctx.hit( 'burn' );
		return cast( ctx, ( world, e ) => {

			const t = groundTarget( world, e, ctx.aimX, ctx.aimZ, 15, 1 );
			world.area( e, { x: t.x, z: t.z, radius: 3.3 * ctx.radius, delay: 0.85, hit, fx: 'meteor', element: ctx.element,
				onTick( w, a ) {

					if ( a.ticks !== 1 ) return;
					feel( w, e, { shake: 0.55, hitstop: 0.05 } );
					w.area( e, { x: a.x, z: a.z, radius: 2.6 * ctx.radius, duration: 3 * ctx.duration, interval: 0.33, hitOnce: false, hit: burn, fx: 'fire', element: ctx.element } );

				} } );

		}, { release: 0.48 } );

	}
} );

define( 'skill', {
	id: 'storm-call', name: 'Storm Call', tags: [ 'spell', 'area', 'lightning' ], element: 'lightning', icon: 'storm',
	manaCost: 8, levelReq: 3, time: 0.42, range: 14,
	desc: 'Mark the ground; a lightning bolt strikes it a second later.',
	hits: { main: ( lv ) => ( { lightning: [ 8 * S( lv ), 30 * S( lv ) ], crit: 7, ailments: { shock: 40 }, knockback: 3 } ) },
	action( level, ctx ) {

		const hit = ctx.hit();
		return cast( ctx, ( world, e ) => {

			const t = groundTarget( world, e, ctx.aimX, ctx.aimZ, 14 );
			world.area( e, { x: t.x, z: t.z, radius: 2.8 * ctx.radius, delay: 1.0, hit, fx: 'storm', element: ctx.element,
				onTick( w, a ) {

					if ( a.ticks !== 1 ) return;
					w.events.emit( 'fx', { kind: 'beam', x1: a.x + 1.5, y1: 22, z1: a.z - 3, x2: a.x, y2: 0, z2: a.z, element: 'lightning', width: 0.8, time: 0.3 } );
					feel( w, e, { shake: 0.2 } );

				} } );

		}, { release: 0.36 } );

	}
} );

define( 'skill', {
	id: 'poison-cloud', name: 'Caustic Cloud', tags: [ 'spell', 'area', 'chaos', 'duration' ], element: 'chaos', icon: 'cloud',
	manaCost: 9, levelReq: 4, time: 0.46, range: 12,
	desc: 'A lingering cloud of caustic gas that poisons everything inside.',
	hits: { main: ( lv ) => ( { chaos: [ 3 * S( lv ), 5 * S( lv ) ], crit: 0, ailments: { poison: 100 }, label: 'Per pulse (2 per second)' } ) },
	action( level, ctx ) {

		const hit = ctx.hit();
		return cast( ctx, ( world, e ) => {

			const t = groundTarget( world, e, ctx.aimX, ctx.aimZ, 12 );
			world.area( e, { x: t.x, z: t.z, radius: 3.2 * ctx.radius, duration: 4.5 * ctx.duration, interval: 0.5, hitOnce: false, hit, fx: 'poison', element: ctx.element } );

		} );

	}
} );

define( 'skill', {
	id: 'glacial-cascade', name: 'Glacial Cascade', tags: [ 'spell', 'area', 'cold' ], element: 'cold', icon: 'cascade',
	manaCost: 9, levelReq: 6, time: 0.5,
	desc: 'A line of ice spikes erupts toward the target, the last one larger.',
	hits: { main: ( lv ) => ( { cold: [ 5 * S( lv ), 8 * S( lv ) ], crit: 6, ailments: { chill: 100, freeze: 10 }, knockback: 4 } ) },
	action( level, ctx ) {

		const hit = ctx.hit();
		return cast( ctx, ( world, e ) => {

			const dir = dirTo( e, ctx.aimX, ctx.aimZ ), fx = Math.sin( dir ), fz = Math.cos( dir );
			const n = 6, gap = 1.45 * ctx.radius;
			for ( let i = 0; i < n; i ++ ) {

				const d = 1.6 + i * gap;
				if ( world.layout.raycast( e.x, e.z, e.x + fx * d, e.z + fz * d ) < 1 ) break;
				const last = i === n - 1;
				world.area( e, { x: e.x + fx * d, z: e.z + fz * d, radius: ( last ? 1.9 : 1.25 ) * ctx.radius, delay: 0.06 * i, hit, fx: 'icespike', element: ctx.element } );

			}

		} );

	}
} );

// --- movement --------------------------------------------------------------------------------

define( 'skill', {
	id: 'blink', name: 'Blink', tags: [ 'spell', 'movement' ], element: 'cold', icon: 'blink',
	manaCost: 5, cooldown: 2.2, levelReq: 1, time: 0.22, range: 9,
	desc: 'Teleport to the target location. Briefly invulnerable.',
	action( level, ctx ) {

		return skillAction( ctx, {
			anim: 'cast', windup: 0.3, active: 0.5, cancelAt: 0.5, moveMult: 0.6, turn: false,
			events: [ { at: 0.3, fn: ( world, e ) => {

				const t = groundTarget( world, e, ctx.aimX, ctx.aimZ, 9, 0, true );
				world.events.emit( 'fx', { kind: 'blink', x: e.x, z: e.z, x2: t.x, z2: t.z, element: ctx.element } );
				e.x = e.px = t.x; e.z = e.pz = t.z;
				e.facing = e.pf = t.dir;
				world.applyStatus( e, 'phased', { duration: 0.25 } );

			} } ]
		} );

	}
} );

// --- warcries and buffs ------------------------------------------------------------------------

define( 'skill', {
	id: 'war-cry', name: 'War Cry', tags: [ 'warcry', 'buff', 'area', 'physical' ], element: 'physical', icon: 'shout',
	manaCost: 8, cooldown: 8, levelReq: 1, time: 0.55,
	desc: 'A deafening roar: nearby enemies are knocked back and stunned; you gain increased damage and are fortified.',
	hits: { main: () => ( { added: false, allowZero: true, knockback: 12, stun: 0.7, label: 'Shockwave' } ) },
	info: ( lv, ctx ) => [ `${20 + lv}% increased damage for ${( 6 * ctx.duration ).toFixed( 1 )} s` ],
	action( level, ctx ) {

		const hit = ctx.hit();
		return skillAction( ctx, {
			anim: 'shout', windup: 0.32, active: 0.6, cancelAt: 0.62, moveMult: 0.2, speedStat: null,
			events: [ { at: 0.32, fn: ( world, e ) => {

				const dur = 6 * ctx.duration;
				for ( const m of [ e, ...minionsOf( world, e ) ] ) {

					world.applyStatus( m, 'warcry', { pct: 20 + level, duration: dur } );
					world.applyStatus( m, 'fortify', { pct: 20, duration: dur } );

				}

				world.area( e, { radius: 5 * ctx.radius, hit, fx: 'warcry', element: 'physical' } );
				world.events.emit( 'fx', { kind: 'ring', x: e.x, z: e.z, radius: 5 * ctx.radius, element: 'warcry' } );
				feel( world, e, { shake: 0.3 } );

			} } ]
		} );

	}
} );

const buffSkill = ( def, status, opts ) => define( 'skill', {
	...def,
	action( level, ctx ) {

		return skillAction( ctx, {
			anim: def.anim ?? 'cast', windup: 0.32, active: 0.55, cancelAt: 0.55, moveMult: 0.5, speedStat: null, turn: false,
			events: [ { at: 0.32, fn: ( world, e ) => {

				world.applyStatus( e, status, { ...opts( level ), duration: def.buffTime * ctx.duration } );
				world.events.emit( 'fx', { kind: 'ring', x: e.x, z: e.z, radius: 2.2, element: status } );

			} } ]
		} );

	}
} );

buffSkill( { id: 'battle-rage', name: 'Battle Rage', tags: [ 'buff', 'warcry', 'physical' ], element: 'physical', icon: 'rage', anim: 'shout',
	manaCost: 10, cooldown: 12, levelReq: 3, time: 0.45, buffTime: 8,
	desc: 'Enter a rage: faster attacks and movement, and your attacks leech life.',
	info: ( lv ) => [ `${Math.round( 25 + lv * 0.8 )}% increased attack speed for 8 s` ] }, 'rage', ( lv ) => ( { pct: 25 + lv * 0.8 } ) );

buffSkill( { id: 'haste', name: 'Haste', tags: [ 'spell', 'buff' ], element: 'lightning', icon: 'haste',
	manaCost: 10, cooldown: 14, levelReq: 5, time: 0.4, buffTime: 6,
	desc: 'Quicken your body: increased attack, cast and movement speed.',
	info: ( lv ) => [ `${Math.round( 15 + lv * 0.6 )}% increased action and movement speed for 6 s` ] }, 'haste', ( lv ) => ( { pct: 15 + lv * 0.6 } ) );

buffSkill( { id: 'ice-armour', name: 'Ice Armour', tags: [ 'spell', 'buff', 'cold' ], element: 'cold', icon: 'armour',
	manaCost: 12, cooldown: 10, levelReq: 4, time: 0.45, buffTime: 8,
	desc: 'Encase yourself in ice: more armour, cold resistance and a recharging frozen barrier.',
	info: ( lv ) => [ `+${Math.round( 30 * S( lv ) )} armour, +${Math.round( 18 * S( lv ) )} barrier for 8 s` ] }, 'ice-armour', ( lv ) => ( { armor: 30 * S( lv ), barrier: 18 * S( lv ) } ) );

// --- minions ---------------------------------------------------------------------------------------

function minionsOf( world, e ) {

	return world.entities.filter( ( m ) => m.kind === 'minion' && m.alive && m.data.owner === e.id );

}

define( 'skill', {
	id: 'phantom-blades', name: 'Phantom Blades', tags: [ 'spell', 'minion', 'physical', 'duration' ], element: 'physical', icon: 'blades',
	manaCost: 12, cooldown: 4, levelReq: 3, time: 0.45,
	desc: 'Summon three flying spectral blades (up to 6) that hunt nearby enemies for 10 s.',
	hits: { main: ( lv ) => ( { physical: [ 3 * S( lv ), 6 * S( lv ) ], crit: 5, label: 'Blade hit' } ) },
	action( level, ctx ) {

		return cast( ctx, ( world, e ) => summonMinions( world, e, ctx, { kind: 'blade', count: 3, max: 6, life: 10 } ), { release: 0.4, moveMult: 0.6, turn: false } );

	}
} );

define( 'skill', {
	id: 'spectral-warriors', name: 'Spectral Warriors', tags: [ 'spell', 'minion', 'physical', 'duration' ], element: 'physical', icon: 'warriors',
	manaCost: 16, cooldown: 6, levelReq: 4, time: 0.6,
	desc: 'Raise two spectral warriors (up to 4) that fight beside you for 18 s.',
	hits: { main: ( lv ) => ( { physical: [ 6 * S( lv ), 10 * S( lv ) ], crit: 5, label: 'Warrior hit' } ) },
	action( level, ctx ) {

		return cast( ctx, ( world, e ) => summonMinions( world, e, ctx, { kind: 'warrior', count: 2, max: 4, life: 18 } ), { anim: 'cast_aoe', release: 0.45, moveMult: 0.3, turn: false } );

	}
} );
