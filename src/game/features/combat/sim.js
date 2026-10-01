// Combat feel - simulation side: the player controller, skills + supports,
// statuses / ailments, minions, and the small systems they need.
//
// Rules for files imported from here: no three.js, no DOM, no window. This entry is
// loaded by the browser AND by Node (scripts/sim.mjs), so everything it registers
// (defs, systems, hooks) must run headless. Rendering / UI code goes in client.js.
//
// API for other features (import from 'features/combat/sim.js'):
//   skillTooltip( game, id, { level?, supports? } )  numbers for the progression skill UI
//   supportsFor( skillId )        support defs that fit a skill
//   readLoadout( save )           the bar / supports / levels with defaults filled in
//   castSkill( world, e, id, { aimX, aimZ, free?, level?, supports? } )  agents, bots, uniques
//   DEFAULT_LOADOUT, SLOT_ACTIONS, spellScale, attackScale
// Content shapes: skill / support defs - skill-core.js and supports.js headers (a skill's
// action( level, ctx ) receives the SKILL CONTEXT; ctx.stats is the caster's StatBlock);
// status defs and their opts - statuses.js; fx hints for projectiles / areas - skills-spells.js.
// Events added by this feature (world.events):
//   'skill' { entity, skill, slot, element }   a skill was used (HUD flash, audio)
//   'skillFail' { entity, skill, slot, reason: 'mana'|'cooldown'|'invalid' }
//   'dot' { entity, amount, element, status }   damage over time, summed every 0.4 s
//   'fx' { kind: 'beam' (x1 y1 z1 x2 y2 z2 width time) | 'blink' (x z x2 z2) | 'burst' | 'impact' |
//          'shatter' | 'ring' (radius) | 'summon', x, z, element }   one-shot visuals any feature may emit
//   'potion' { entity }   (docs/GAME.md hand-off to progression)

import { define } from '../../core/registry.js';
import { TEAM } from '../../core/tuning.js';
import './statuses.js';
import './supports.js';
import './skills-melee.js';
import './skills-spells.js';
import './minions.js';
import './controller.js';
import { runTimers } from './timers.js';
import { readLoadout, supportMods, skillTooltip, castSkill, isFoe } from './skill-core.js';

export { skillTooltip, supportsFor, readLoadout, castSkill, makeContext, DEFAULT_LOADOUT, SLOT_ACTIONS, spellScale, attackScale, compatible } from './skill-core.js';
export { schedule } from './timers.js';
export { DODGE, BUFFER } from './controller.js';

// --- stat source: support gems as skill-scoped modifiers --------------------------------

define( 'statSource', { id: 'combat-supports', mods: ( game ) => supportMods( readLoadout( game.save ) ) } );

// --- systems ---------------------------------------------------------------------------

define( 'system', { id: 'combat-timers', order: 41, update: runTimers } );

// Projectile behaviours the core does not know: wandering sparks, zapping orbs.
define( 'system', { id: 'combat-projectiles', order: 58, update( world, dt ) {

	for ( const p of world.projectiles ) {

		if ( ! p.alive ) continue;
		const d = p.data;
		if ( d.wander ) {

			// a random walk on the heading: smooth because the turn rate is capped
			d.turn = ( d.turn ?? 0 ) * 0.92 + ( world.rng.next() - 0.5 ) * d.wander * 0.5;
			p.dir += d.turn * dt * 1.6;

		}

		if ( d.zap ) {

			const z = d.zap;
			z.next -= dt;
			if ( z.next > 0 ) continue;
			z.next = z.interval;
			const owner = p.owner;
			if ( ! owner ) continue;
			const near = world.spatial.query( p.x, p.z, z.radius, ( o ) => isFoe( owner, o ) );
			near.sort( ( a, b ) => Math.hypot( a.x - p.x, a.z - p.z ) - Math.hypot( b.x - p.x, b.z - p.z ) );
			for ( let i = 0; i < Math.min( z.targets, near.length ); i ++ ) {

				const o = near[ i ];
				world.events.emit( 'fx', { kind: 'beam', x1: p.x, y1: p.y, z1: p.z, x2: o.x, y2: 1.0, z2: o.z, element: 'lightning', time: 0.12, width: 0.18 } );
				world.dealDamage( owner, o, z.hit );

			}

		}

	}

} } );

// Buff barriers (Ice Armour) add to the shield maximum; trim the surplus when they end.
define( 'system', { id: 'combat-upkeep', order: 81, update( world ) {

	for ( const e of world.entities ) {

		if ( e.shield > 0 && e.alive ) {

			const max = e.stats.get( 'shield' );
			if ( e.shield > max ) e.shield = max;

		}

	}

} } );

// --- per-world listeners: on-death effects --------------------------------------------------

define( 'worldHook', { id: 'combat-world', order: 40, onWorld( game, world ) {

	world.events.on( 'death', ( d ) => {

		const e = d.entity;
		// frozen enemies shatter: no corpse, a burst of ice (the client draws it)
		if ( e.flags.frozen && e.team !== TEAM.PLAYER ) {

			e.data.shattered = true;
			e.data.corpseTime = 0.05;
			world.events.emit( 'fx', { kind: 'shatter', x: e.x, z: e.z, element: 'cold', size: e.radius } );

		}

		// Infernal Blow marks: the corpse explodes for 12% of its life + the skill's base
		const mark = e.data.infernal;
		if ( mark && world.time <= mark.until && mark.source?.alive ) {

			e.data.infernal = null;
			const extra = e.maxLife * 0.12;
			const hit = { ...mark.hit, damage: { ...mark.hit.damage, fire: [ ( mark.hit.damage.fire?.[ 0 ] ?? 0 ) + extra, ( mark.hit.damage.fire?.[ 1 ] ?? 0 ) + extra ] }, onHit: undefined };
			world.area( mark.source, { x: e.x, z: e.z, radius: mark.radius, hit, fx: 'explosion', element: 'fire' } );
			world.events.emit( 'shake', { amount: 0.12, x: e.x, z: e.z } );

		}

	} );

} } );

// --- agent API (tools feature's game.api runs any registered apiCommand) ----------------------

define( 'apiCommand', { id: 'combat.tooltip', desc: 'Skill tooltip numbers from the player\'s current stats', args: { id: 'skill id', level: 'optional level' },
	run: ( game, { id, level } = {} ) => skillTooltip( game, id, { level } ) } );

define( 'apiCommand', { id: 'combat.cast', desc: 'Cast a skill as the player at a world point (free of mana)', args: { id: 'skill id', x: 'aim x', z: 'aim z' },
	run( game, { id, x, z } = {} ) {

		const w = game.world, p = w?.player;
		if ( ! p ) return { error: 'no player' };
		return { result: castSkill( w, p, id, { aimX: x ?? p.x, aimZ: z ?? p.z + 3, free: true, force: true } ) };

	} } );
