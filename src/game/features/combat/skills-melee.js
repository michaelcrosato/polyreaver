// Melee attack skills. Timings are tuned for feel at 60 Hz and at high attack speed:
//   * windups are short (0.1-0.2 s at 100% speed) so a press turns into a swing NOW;
//   * the hit frame sits right after the windup and the arc VFX plays on it;
//   * cancelAt opens right after the active frames, so the next combo step, a skill
//     or a dodge can cut the recovery (moving cancels it too - see controller.js);
//   * lunges are root motion in metres (skill-core lunge()), so a 3x attack speed
//     build still steps the same distance, just faster; aim assist adds the gap to
//     the target so swings connect instead of whiffing at max range.
// Damage of attacks is the weapon's (flat added damage) x effectiveness.

import { define } from '../../core/registry.js';
import { skillAction, lunge, strike, feel, groundTarget, spellScale, isFoe } from './skill-core.js';

const fwd = ( e, d ) => ( { x: e.x + Math.sin( e.facing ) * d, z: e.z + Math.cos( e.facing ) * d } );

// Basic attacks give mana back on hit (capped per swing): the core resource loop -
// slash to fuel the big skills.
function manaOnHit( amount, cap ) {

	let got = 0;
	return ( world, src, tgt, r ) => {

		if ( ! r || r.total <= 0 || got >= cap ) return;
		got += amount;
		src.mana = Math.min( src.maxMana, src.mana + amount );

	};

}

// --- Reaver's Combo (the LMB basic attack) --------------------------------------------------

define( 'skill', {
	id: 'slash', name: 'Reaver\'s Combo', tags: [ 'attack', 'melee', 'physical' ], element: 'physical', icon: 'slash',
	manaCost: 0, levelReq: 1, time: 0.44, reach: 2.6, combo: 3,
	desc: 'A three-step chain: two fast slashes and an overhead finisher that knocks back and stuns. Hits restore mana.',
	hits: {
		main: () => ( { eff: 1.4, knockback: 3, label: 'Slash' } ),
		finisher: () => ( { eff: 2.4, knockback: 9, stun: 0.35, label: 'Finisher' } )
	},
	info: () => [ 'Restores 1.5 mana per enemy hit (max 4.5 per swing)' ],
	action( level, ctx ) {

		const fin = ctx.variant === 2;
		const hit = ctx.hit( fin ? 'finisher' : 'main', { onHit: [ manaOnHit( 1.5, 4.5 ) ] } );
		const def = skillAction( ctx, {
			anim: 'slash', duration: fin ? 0.58 : 0.44,
			windup: fin ? 0.42 : 0.3, active: fin ? 0.62 : 0.5, cancelAt: fin ? 0.66 : 0.5, chainAt: fin ? 0.86 : 0.8,
			moveMult: fin ? 0.15 : 0.35, turn: true,
			events: [ { at: fin ? 0.44 : 0.32, fn: ( world, e ) => {

				strike( world, e, ctx, { range: fin ? 2.9 : 2.6, angle: fin ? 110 : 150, hit, fx: fin ? 'overhead' : 'slash', hitstop: fin ? 0.06 : 0.0, shake: fin ? 0.2 : 0.03 } );
				if ( fin ) world.events.emit( 'fx', { kind: 'impact', ...fwd( e, 1.8 ), radius: 1.4, element: ctx.element } );

			} } ]
		} );
		return lunge( def, fin ? 0.16 : 0.06, fin ? 0.46 : 0.34, ctx.lungeDist( fin ? 1.3 : 0.7 ) );

	}
} );

// --- Cleave ----------------------------------------------------------------------------------

define( 'skill', {
	id: 'cleave', name: 'Cleave', tags: [ 'attack', 'melee', 'area', 'physical' ], element: 'physical', icon: 'cleave',
	manaCost: 4, levelReq: 1, time: 0.5, reach: 3.2, alternate: 2,
	desc: 'A huge sweeping arc that hits everything in front of you.',
	hits: { main: () => ( { eff: 1.5, knockback: 5 } ) },
	action( level, ctx ) {

		const hit = ctx.hit();
		const def = skillAction( ctx, {
			anim: 'slash', windup: 0.36, active: 0.58, cancelAt: 0.6, moveMult: 0.3, turn: true,
			events: [ { at: 0.38, fn: ( world, e ) => strike( world, e, ctx, { range: 3.2 * ctx.radius, angle: 210, hit, fx: 'cleave', hitstop: 0.02, shake: 0.08 } ) } ]
		} );
		return lunge( def, 0.1, 0.4, ctx.lungeDist( 0.6 ) );

	}
} );

// --- Heavy Strike ----------------------------------------------------------------------------

define( 'skill', {
	id: 'heavy-strike', name: 'Heavy Strike', tags: [ 'attack', 'melee', 'physical' ], element: 'physical', icon: 'hammer',
	manaCost: 6, levelReq: 2, time: 0.72, reach: 2.8,
	desc: 'A two-handed overhead blow: massive damage, knockback and stun. Fortifies you on hit.',
	hits: { main: () => ( { eff: 3.4, knockback: 13, stun: 0.8 } ) },
	action( level, ctx ) {

		const hit = ctx.hit( 'main', { onHit: [ ( world, src ) => world.applyStatus( src, 'fortify', { pct: 20, duration: 5 } ) ] } );
		const def = skillAction( ctx, {
			anim: 'overhead', windup: 0.5, active: 0.66, cancelAt: 0.7, moveMult: 0.1, turn: true,
			events: [ { at: 0.52, fn: ( world, e ) => {

				strike( world, e, ctx, { range: 2.9, angle: 90, hit, maxTargets: 3, fx: 'overhead', hitstop: 0.085, shake: 0.32 } );
				world.events.emit( 'fx', { kind: 'impact', ...fwd( e, 1.9 ), radius: 1.6, element: ctx.element } );

			} } ]
		} );
		return lunge( def, 0.22, 0.5, ctx.lungeDist( 1.2 ) );

	}
} );

// --- Double Strike ---------------------------------------------------------------------------

define( 'skill', {
	id: 'double-strike', name: 'Double Strike', tags: [ 'attack', 'melee', 'physical' ], element: 'physical', icon: 'double',
	manaCost: 5, levelReq: 3, time: 0.48, reach: 2.7, hitsPerCast: 2,
	desc: 'Two lightning-fast thrusts at a single target. High critical strike chance.',
	hits: { main: () => ( { eff: 1.2, knockback: 2, ailments: { bleed: 15 } } ) },
	action( level, ctx ) {

		const hit = ctx.hit();
		const thrust = ( world, e ) => strike( world, e, ctx, { range: 2.8, angle: 60, hit, maxTargets: 2, fx: 'thrust', hitstop: 0.015, shake: 0.03 } );
		const def = skillAction( ctx, {
			anim: 'thrust', windup: 0.24, active: 0.6, cancelAt: 0.62, moveMult: 0.3, turn: true,
			events: [ { at: 0.26, fn: thrust }, { at: 0.54, fn: thrust } ]
		} );
		return lunge( def, 0.05, 0.3, ctx.lungeDist( 0.6 ) );

	}
} );

// --- Whirlwind (channelled) --------------------------------------------------------------------
// One loop = one revolution; while the button is held the controller chains the next
// loop from onEnd in the same step, so the spin never stutters. Mana is paid per loop.

define( 'skill', {
	id: 'whirlwind', name: 'Whirlwind', tags: [ 'attack', 'melee', 'area', 'channel', 'physical' ], element: 'physical', icon: 'whirl',
	manaCost: 2, levelReq: 4, time: 0.32, reach: 2.6, noAssist: true,
	desc: 'Hold to spin through enemies, hitting everything around you while you move.',
	hits: { main: () => ( { eff: 0.72, knockback: 1.5 } ) },
	action( level, ctx ) {

		const hit = ctx.hit();
		return skillAction( ctx, {
			anim: 'spin', windup: 0, active: 1, cancelAt: 1, moveMult: 0.8, faceAim: false, channel: true,
			events: [ { at: 0.5, fn: ( world, e ) => strike( world, e, ctx, { range: 2.7 * ctx.radius, angle: 360, hit, fx: 'spin', shake: 0.02 } ) } ],
			onEnd: ( world, e ) => e.controller?.continueChannel?.( world, e, ctx.id )
		} );

	}
} );

// --- Leap Slam -------------------------------------------------------------------------------
// The flight is physical: forced horizontal velocity + an upward vy that gravity
// (core movement) brings back exactly when the forced motion ends.

define( 'skill', {
	id: 'leap-slam', name: 'Leap Slam', tags: [ 'attack', 'melee', 'area', 'movement', 'physical' ], element: 'physical', icon: 'leap',
	manaCost: 9, cooldown: 1.2, levelReq: 1, time: 0.78, range: 9, noAssist: true,
	desc: 'Leap to the target location and slam down, damaging, knocking back and stunning enemies. Invulnerable in the air.',
	hits: { main: () => ( { eff: 2.0, knockback: 11, stun: 0.5 } ) },
	action( level, ctx ) {

		const T0 = 0.2, T1 = 0.72;
		const land = groundTarget( ctx.world, ctx.e, ctx.aimX, ctx.aimZ, 9, 1.5, true );
		const hit = ctx.hit();
		const cleanup = ( world, e ) => {

			e.flags.ghost = false;
			e.flags.invulnerable = false;
			e.data.flying = e.data.leapWasFlying ?? false;
			if ( e.forced?.leap ) e.forced = null;

		};

		return skillAction( ctx, {
			anim: 'leap', windup: T0, active: T1, cancelAt: 0.82, moveMult: 0, unstoppable: true, noDodgeCancel: T1,
			events: [
				{ at: T0, fn: ( world, e, act ) => {

					const flight = ( T1 - T0 ) * act.duration;
					e.forced = { vx: ( land.x - e.x ) / flight, vz: ( land.z - e.z ) / flight, time: flight, keepAction: true, leap: true };
					e.vy = 30 * flight / 2;
					e.y = 0.001;
					e.flags.ghost = true;
					e.flags.invulnerable = true;
					e.data.leapWasFlying = e.data.flying;
					e.data.flying = true; // fly over pits and water, never through walls

				} },
				{ at: T1, fn: ( world, e ) => {

					cleanup( world, e );
					e.y = 0; e.vy = 0;
					world.area( e, { radius: 2.8 * ctx.radius, hit, fx: 'slam', element: ctx.element } );
					feel( world, e, { hitstop: 0.05, shake: 0.4 } );

				} }
			],
			onCancel: cleanup
		} );

	}
} );

// --- Ground Slam ------------------------------------------------------------------------------

define( 'skill', {
	id: 'ground-slam', name: 'Ground Slam', tags: [ 'attack', 'melee', 'area', 'physical' ], element: 'physical', icon: 'slam',
	manaCost: 6, levelReq: 1, time: 0.62, reach: 3, noAssist: true,
	desc: 'Smash the ground, sending a shockwave forward in a cone that stuns.',
	hits: { main: () => ( { eff: 1.8, knockback: 8, stun: 0.55 } ) },
	action( level, ctx ) {

		const hit = ctx.hit();
		return skillAction( ctx, {
			anim: 'slam', windup: 0.48, active: 0.68, cancelAt: 0.7, moveMult: 0.05, turn: true,
			events: [ { at: 0.5, fn: ( world, e ) => {

				world.area( e, { x: e.x, z: e.z, shape: 'cone', radius: 7 * ctx.radius, angle: 70, dir: e.facing, hit, fx: 'slam', element: ctx.element } );
				feel( world, e, { hitstop: 0.04, shake: 0.32 } );

			} } ]
		} );

	}
} );

// --- Earthquake -------------------------------------------------------------------------------

define( 'skill', {
	id: 'earthquake', name: 'Earthquake', tags: [ 'attack', 'melee', 'area', 'physical' ], element: 'physical', icon: 'quake',
	manaCost: 9, levelReq: 6, time: 0.72, reach: 3, noAssist: true,
	desc: 'Crack the earth in front of you; a much stronger aftershock erupts one second later.',
	hits: {
		main: () => ( { eff: 1.3, knockback: 4, label: 'Quake' } ),
		aftershock: () => ( { eff: 2.8, knockback: 9, stun: 0.6, label: 'Aftershock' } )
	},
	action( level, ctx ) {

		const quake = ctx.hit(), after = ctx.hit( 'aftershock' );
		return skillAction( ctx, {
			anim: 'slam', windup: 0.5, active: 0.68, cancelAt: 0.72, moveMult: 0.05, turn: true,
			events: [ { at: 0.52, fn: ( world, e ) => {

				const p = fwd( e, 1.6 );
				world.area( e, { ...p, radius: 3.2 * ctx.radius, hit: quake, fx: 'quake', element: ctx.element } );
				world.area( e, { ...p, radius: 4.4 * ctx.radius, hit: after, delay: 1.0 / ctx.duration, fx: 'aftershock', element: ctx.element,
					onTick: ( w, a ) => a.ticks === 1 && feel( w, e, { shake: 0.45, hitstop: 0.03 } ) } );
				feel( world, e, { shake: 0.22 } );

			} } ]
		} );

	}
} );

// --- Dash Strike --------------------------------------------------------------------------------

define( 'skill', {
	id: 'dash-strike', name: 'Dash Strike', tags: [ 'attack', 'melee', 'movement', 'physical' ], element: 'physical', icon: 'dash',
	manaCost: 6, cooldown: 2.5, levelReq: 2, time: 0.42, noAssist: true,
	desc: 'Dash forward, slicing through every enemy in your path. Invulnerable while dashing.',
	hits: { main: () => ( { eff: 1.8, knockback: 6 } ) },
	action( level, ctx ) {

		const T0 = 0.12, T1 = 0.7, dist = 7.5;
		const hit = ctx.hit();
		const cleanup = ( world, e ) => {

			e.flags.invulnerable = false;
			e.flags.ghost = false;
			if ( e.forced?.dash ) e.forced = null;

		};

		return skillAction( ctx, {
			anim: 'dash', windup: T0, active: T1, cancelAt: 0.74, moveMult: 0, turn: true, unstoppable: true,
			events: [
				{ at: T0, fn: ( world, e, act ) => {

					const t = ( T1 - T0 ) * act.duration;
					e.forced = { vx: Math.sin( e.facing ) * dist / t, vz: Math.cos( e.facing ) * dist / t, time: t, keepAction: true, dash: true };
					e.flags.invulnerable = true;
					e.flags.ghost = true;
					world.area( e, { follow: e, radius: 1.4, duration: t, interval: 1 / 30, hitOnce: true, hit, fx: 'dash', element: ctx.element,
						onHit: ( w, a, tgt, r ) => r && r.total > 0 && feel( w, e, { hitstop: 0.02 } ) } );

				} },
				{ at: T1, fn: cleanup }
			],
			onCancel: cleanup
		} );

	}
} );

// --- Lacerate -----------------------------------------------------------------------------------

define( 'skill', {
	id: 'lacerate', name: 'Lacerate', tags: [ 'attack', 'melee', 'area', 'physical' ], element: 'physical', icon: 'lacerate',
	manaCost: 6, levelReq: 5, time: 0.58, reach: 3.2, hitsPerCast: 2,
	desc: 'Two crossing slashes that make enemies bleed.',
	hits: { main: () => ( { eff: 1.1, knockback: 2, ailments: { bleed: 60 } } ) },
	action( level, ctx ) {

		const hit = ctx.hit();
		const def = skillAction( ctx, {
			anim: 'slash', windup: 0.28, active: 0.62, cancelAt: 0.66, moveMult: 0.25, turn: true,
			events: [
				{ at: 0.3, fn: ( world, e ) => strike( world, e, ctx, { range: 3.3 * ctx.radius, angle: 110, hit, fx: 'slash', shake: 0.04 } ) },
				{ at: 0.42, fn: ( world, e ) => ( e.anim.variant = 1 ) },
				{ at: 0.56, fn: ( world, e ) => strike( world, e, ctx, { range: 3.3 * ctx.radius, angle: 110, hit, fx: 'slash', hitstop: 0.02, shake: 0.06 } ) }
			]
		} );
		return lunge( def, 0.08, 0.3, ctx.lungeDist( 0.5 ) );

	}
} );

// --- Reave ---------------------------------------------------------------------------------------

define( 'skill', {
	id: 'reave', name: 'Reave', tags: [ 'attack', 'melee', 'area', 'physical' ], element: 'physical', icon: 'reave',
	manaCost: 4, levelReq: 7, time: 0.34, reach: 2.6,
	desc: 'Rapid stabs in a cone. Each hit grows the area of the next ones (up to 8 stacks).',
	hits: { main: () => ( { eff: 1.15, knockback: 2 } ) },
	action( level, ctx ) {

		// one stack per swing, however many enemies it hits
		let stacked = false;
		const grow = ( world, src ) => {

			if ( stacked ) return;
			stacked = true;
			world.applyStatus( src, 'reave', { duration: 3 } );

		};

		const hit = ctx.hit( 'main', { onHit: [ grow ] } );
		const def = skillAction( ctx, {
			anim: 'thrust', windup: 0.3, active: 0.55, cancelAt: 0.55, moveMult: 0.35, turn: true,
			events: [ { at: 0.32, fn: ( world, e ) => strike( world, e, ctx, { range: 2.6 * ctx.radius, angle: 100, hit, fx: 'thrust', shake: 0.03 } ) } ]
		} );
		return lunge( def, 0.05, 0.32, ctx.lungeDist( 0.4 ) );

	}
} );

// --- Flicker Strike --------------------------------------------------------------------------------

define( 'skill', {
	id: 'flicker-strike', name: 'Flicker Strike', tags: [ 'attack', 'melee', 'movement', 'physical' ], element: 'physical', icon: 'flicker',
	manaCost: 7, cooldown: 1.0, levelReq: 8, time: 0.4, range: 12, noAssist: true,
	desc: 'Teleport behind the enemy nearest your aim and strike it.',
	hits: { main: () => ( { eff: 2.2, knockback: 5, stun: 0.2 } ) },
	canCast( world, e, ctx ) {

		const t = world.spatial.nearest( ctx.aimX, ctx.aimZ, 5, ( o ) => isFoe( e, o ) && e.distTo( o ) <= 12 ) ||
			world.spatial.nearest( e.x, e.z, 12, ( o ) => isFoe( e, o ) );
		if ( ! t || ! world.layout.hasLineOfSight( e.x, e.z, t.x, t.z ) ) return false;
		ctx.target = t;
		return true;

	},
	action( level, ctx ) {

		const hit = ctx.hit();
		return skillAction( ctx, {
			anim: 'slash', windup: 0.36, active: 0.6, cancelAt: 0.62, moveMult: 0.2, turn: true,
			onStart( world, e ) {

				const t = ctx.target;
				const dx = t.x - e.x, dz = t.z - e.z, d = Math.hypot( dx, dz ) || 1;
				let nx = t.x + dx / d * ( t.radius + e.radius + 0.3 ), nz = t.z + dz / d * ( t.radius + e.radius + 0.3 );
				if ( ! world.layout.isWalkable( nx, nz ) ) {

					nx = t.x - dx / d * ( t.radius + e.radius + 0.3 );
					nz = t.z - dz / d * ( t.radius + e.radius + 0.3 );

				}

				world.events.emit( 'fx', { kind: 'blink', x: e.x, z: e.z, x2: nx, z2: nz, element: ctx.element } );
				e.x = e.px = nx; e.z = e.pz = nz;
				e.facing = e.pf = Math.atan2( t.x - nx, t.z - nz );
				world.applyStatus( e, 'phased', { duration: 0.2 } );

			},
			events: [ { at: 0.38, fn: ( world, e ) => strike( world, e, ctx, { range: 2.6, angle: 140, hit, fx: 'slash', hitstop: 0.05, shake: 0.12 } ) } ]
		} );

	}
} );

// --- Infernal Blow ----------------------------------------------------------------------------------
// Enemies it hits are marked for 2 s; a marked enemy that dies explodes for a share
// of its maximum life as fire damage (sim.js 'combat-world' hook) - packs chain-react.

define( 'skill', {
	id: 'infernal-blow', name: 'Infernal Blow', tags: [ 'attack', 'melee', 'fire', 'area' ], element: 'fire', icon: 'infernal',
	manaCost: 6, levelReq: 5, time: 0.5, reach: 2.7, convert: { from: 'physical', to: 'fire', pct: 0.5 },
	desc: 'A searing blow; half its physical damage becomes fire. Enemies killed within 2 s of being hit explode.',
	hits: {
		main: () => ( { eff: 1.6, knockback: 5, ailments: { ignite: 20 } } ),
		explosion: ( lv ) => ( { fire: [ 4 * spellScale( lv ), 7 * spellScale( lv ) ], added: false, eff: 1, label: 'Explosion (+12% of the corpse\'s life)' } )
	},
	action( level, ctx ) {

		const boom = ctx.hit( 'explosion' );
		const mark = ( world, src, tgt ) => {

			tgt.data.infernal = { until: world.time + 2, source: src, hit: boom, radius: 2.6 * ctx.radius };

		};

		const hit = ctx.hit( 'main', { onHit: [ mark ] } );
		const def = skillAction( ctx, {
			anim: 'slash', windup: 0.34, active: 0.58, cancelAt: 0.6, moveMult: 0.25, turn: true,
			events: [ { at: 0.36, fn: ( world, e ) => strike( world, e, ctx, { range: 2.8, angle: 130, hit, fx: 'slash', hitstop: 0.03, shake: 0.08 } ) } ]
		} );
		return lunge( def, 0.08, 0.36, ctx.lungeDist( 0.8 ) );

	}
} );
