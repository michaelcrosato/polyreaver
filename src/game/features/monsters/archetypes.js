// Behaviour archetypes: HOW a monster fights, independent of what it looks like.
// A family (looks + theme + element) fields one or more archetypes; the same Slag
// Hound genome can be a brawler or a charger. Each def is numbers plus a tactic:
//
//   roles        ability roles it can slot from its family ( see abilities.js )
//   core         abilities it always has ( a charger always has 'charge' )
//   fallback     ( family ) => ability id when the family offers nothing that fits
//   stats        multipliers: life, damage, speed, armor, xp, loot, poise (stun threshold)
//   mods         extra stat modifiers ( the tank's frontal block )
//   size         genome size multiplier;  plans: allowed body plans (optional)
//   aggro        sight radius (m);  leash: how far from home it follows (m)
//   pause        [ min, max ] seconds of breathing room after each attack
//   faceTarget   keep facing the target while moving ( turnSpeed rad/s )
//   move( world, e, brain, target, dist, dt )   positioning between attacks
//   think?( world, e, brain, dt )               per-step hook (guards, fuses...)
//   onUse?( world, e, brain, ability )          after an ability starts
//
// Readability rules every archetype follows: a reaction delay when it first sees
// you, a pause after each attack, attack tokens shared with the rest of the level,
// and telegraphs on every heavy hit.

import { define } from '../../core/registry.js';
import { approach, kite, skirmish, flock, escort } from './tactics.js';
import { stop, retreatFrom } from './nav.js';
import { hooks } from './factory.js';

const archetype = ( def ) => define( 'archetype', { aggro: 13, leash: 42, pause: [ 0.35, 0.8 ], roles: [], core: [], stats: {}, maxAbilities: 3, ...def } );

// Element-appropriate defaults when a family brings no ranged / caster verbs.
const BOLT = ( fam ) => fam.element === 'physical' ? 'arrow' : fam.element === 'chaos' ? 'spit' : 'bolt';
const NUKE = { fire: 'meteor', cold: 'frost-nova', lightning: 'lightning-strike', chaos: 'poison-cloud', physical: 'quake' };

archetype( { id: 'brawler', name: 'Brawler', tags: [ 'melee' ], desc: 'Closes in and trades blows; packs of brawlers surround you.',
	roles: [ 'melee' ], core: [ 'strike' ], pause: [ 0.3, 0.75 ],
	move: ( world, e, b, t, d ) => approach( world, e, b, t, d ) } );

archetype( { id: 'brute', name: 'Brute', tags: [ 'melee', 'heavy' ], desc: 'Big and slow. Every swing is a telegraphed slam that you must not stand in.',
	roles: [ 'melee', 'heavy' ], core: [ 'slam' ], size: 1.35, stats: { life: 2.4, damage: 1.35, speed: 0.78, armor: 1.5, xp: 2, loot: 1.6, poise: 2.5 },
	pause: [ 0.7, 1.3 ], aggro: 12,
	move: ( world, e, b, t, d ) => approach( world, e, b, t, d, 0.9 ) } );

archetype( { id: 'charger', name: 'Charger', tags: [ 'melee', 'mobile' ], desc: 'Shows a charge lane, then barrels down it. Sidestep - and if it hits a wall it is stunned and exposed.',
	roles: [ 'melee' ], core: [ 'charge', 'strike' ], stats: { life: 1.3, damage: 1.15, speed: 0.95, xp: 1.3, poise: 1.4 },
	pause: [ 0.5, 1 ], aggro: 15,
	move( world, e, b, t, d ) {

		// hang at charging distance while the charge is ready; brawl otherwise
		const ready = ( e.cooldowns.get( 'charge' ) ?? 0 ) <= world.time;
		if ( ready && d < 4 && ! b.waiting ) return retreatFrom( world, e, t, 0.8, b.strafeDir );
		approach( world, e, b, t, d );

	} } );

archetype( { id: 'skirmisher', name: 'Skirmisher', tags: [ 'melee', 'mobile' ], desc: 'Darts in, strikes, falls back. Punish it while it retreats.',
	roles: [ 'melee', 'mobility' ], core: [ 'strike' ], stats: { life: 0.8, damage: 0.9, speed: 1.25 }, pause: [ 0.2, 0.5 ],
	onUse( world, e, b ) {

		b.fadeUntil = world.time + 1.6;

	},
	move: ( world, e, b, t, d ) => skirmish( world, e, b, t, d ) } );

archetype( { id: 'kiter', name: 'Ranged', tags: [ 'ranged' ], desc: 'Keeps its distance and shoots. Backs away when you close in - corner it.',
	roles: [ 'ranged' ], fallback: BOLT, stats: { life: 0.7, damage: 0.9, speed: 0.95, xp: 1.1 }, pause: [ 0.5, 1.1 ],
	faceTarget: true, turnSpeed: 8, band: [ 5.5, 10.5 ],
	move: ( world, e, b, t, d ) => kite( world, e, b, t, d, 5.5, 10.5 ) } );

archetype( { id: 'caster', name: 'Caster', tags: [ 'ranged', 'caster' ], desc: 'Calls down telegraphed spells where you stand. Keep moving.',
	roles: [ 'caster', 'ranged' ], fallback: ( fam ) => NUKE[ fam.element ] || 'meteor', stats: { life: 0.75, damage: 1.05, speed: 0.9, xp: 1.3 },
	pause: [ 0.8, 1.5 ], faceTarget: true, turnSpeed: 7, aggro: 15,
	move: ( world, e, b, t, d ) => kite( world, e, b, t, d, 7, 12 ) } );

archetype( { id: 'summoner', name: 'Summoner', tags: [ 'caster', 'summoner' ], desc: 'Hangs back and calls minions. Kill it first or the room never empties.',
	roles: [ 'summon', 'ranged' ], core: [ 'summon' ], stats: { life: 0.9, damage: 0.75, speed: 0.85, xp: 1.6, loot: 1.4 },
	pause: [ 0.9, 1.6 ], faceTarget: true, turnSpeed: 6, aggro: 15,
	move: ( world, e, b, t, d ) => kite( world, e, b, t, d, 8, 13 ) } );

archetype( { id: 'exploder', name: 'Exploder', tags: [ 'melee', 'suicide' ], desc: 'Rushes you and detonates after a short fuse. Kill it during the fuse, or roll away.',
	roles: [], core: [ 'fuse' ], maxAbilities: 1, size: 0.85, stats: { life: 0.5, damage: 1, speed: 1.3, xp: 0.7, loot: 0.6 },
	pause: [ 0, 0.1 ], aggro: 14,
	move: ( world, e, b, t, d ) => approach( world, e, b, t, d ) } );

// Tank: a frontal guard. While facing you (and not attacking) it blocks most
// attacks and projectiles; it turns slowly, so roll behind it or use areas - or
// batter the shield: four blocks in quick succession BREAK the guard (staggered
// and exposed for a moment). Two answers, both readable.
archetype( { id: 'tank', name: 'Shield Bearer', tags: [ 'melee', 'tank' ], desc: 'Blocks from the front. Circle behind it, hit it with areas, or batter the shield until the guard breaks.',
	roles: [ 'melee' ], core: [ 'shield-bash', 'strike' ], stats: { life: 1.8, damage: 0.9, speed: 0.8, armor: 2, xp: 1.6, poise: 2 },
	mods: [ { stat: 'block_chance', type: 'flat', value: 65, when: 'guarding' } ],
	pause: [ 0.6, 1.1 ], faceTarget: true, turnSpeed: 2.6,
	think( world, e, b ) {

		let guard = false;
		const t = b.target;
		if ( t && ! e.action && b.state === 'combat' && world.time > ( e.data.guardBrokenUntil ?? 0 ) ) {

			const want = Math.atan2( t.x - e.x, t.z - e.z );
			guard = Math.abs( Math.atan2( Math.sin( want - e.facing ), Math.cos( want - e.facing ) ) ) < 1.0;

		}

		e.stats.setFlag( 'guarding', guard );
		e.data.guarding = guard; // renderers raise the shield ( anim: block pose )

	},
	move: ( world, e, b, t, d ) => approach( world, e, b, t, d, 0.85 ) } );

hooks.block.push( ( world, ev ) => {

	const e = ev.target;
	if ( e.data?.archetype !== 'tank' ) return;
	const g = e.data.guard || ( e.data.guard = { n: 0, at: 0 } );
	g.n = world.time - g.at < 2 ? g.n + 1 : 1;
	g.at = world.time;
	if ( g.n < 4 ) return;
	g.n = 0;
	e.data.guardBrokenUntil = world.time + 3;
	e.stats.setFlag( 'guarding', false );
	world.applyStatus( e, 'stun', { duration: 1 } );
	world.applyStatus( e, 'm-exposed', { duration: 2.5 } );
	world.events.emit( 'guardBreak', { entity: e, x: e.x, z: e.z } );

} );

// Assassin: circles at the edge of your vision and strikes from behind.
archetype( { id: 'assassin', name: 'Assassin', tags: [ 'melee', 'mobile' ], desc: 'Circles you, then steps through the shadows behind you. Watch the circle under your feet.',
	roles: [ 'melee', 'mobility' ], core: [ 'blink-strike', 'strike' ], stats: { life: 0.8, damage: 1.15, speed: 1.15, xp: 1.4 },
	pause: [ 0.5, 1 ], aggro: 15,
	onUse( world, e, b, ab ) {

		if ( ab.id !== 'blink-strike' ) b.fadeUntil = world.time + 1.4;

	},
	move( world, e, b, t, d ) {

		// set up the shadow step only when it can actually happen (cooldown ready
		// and no attack-token wait); otherwise brawl - never kite forever
		const ready = ( e.cooldowns.get( 'blink-strike' ) ?? 0 ) <= world.time && ! b.waiting;
		if ( world.time < ( b.fadeUntil ?? 0 ) ) return kite( world, e, b, t, d, 5, 8 );
		if ( ready && d < 4 ) return kite( world, e, b, t, d, 4, 7 );
		approach( world, e, b, t, d );

	} } );

archetype( { id: 'swarmer', name: 'Swarmer', tags: [ 'melee', 'swarm' ], desc: 'Fast, weak and many. Flocks around you - an area skill clears a dozen.',
	roles: [], core: [ 'peck' ], maxAbilities: 1, size: 0.62, stats: { life: 0.32, damage: 0.5, speed: 1.4, xp: 0.35, loot: 0.35 },
	pause: [ 0.35, 0.9 ], aggro: 15,
	move: ( world, e, b, t, d ) => flock( world, e, b, t, d ) } );

archetype( { id: 'support', name: 'Support', tags: [ 'caster', 'support' ], desc: 'Heals and wards its allies from the back line. A priority target.',
	roles: [ 'support', 'ranged' ], core: [ 'heal' ], stats: { life: 0.8, damage: 0.6, speed: 0.95, xp: 1.5, loot: 1.3 },
	pause: [ 0.8, 1.4 ], faceTarget: true, turnSpeed: 6, aggro: 15,
	move: ( world, e, b, t, d ) => escort( world, e, b, t, d ) } );

// Turret: never moves; turns slowly; long-range telegraphed fire. Totems,
// crystals, clockwork sentries.
archetype( { id: 'turret', name: 'Turret', tags: [ 'ranged', 'stationary' ], desc: 'Rooted in place and slow to turn. Its lanes are telegraphed - stay out of them or get behind it.',
	roles: [ 'ranged', 'caster' ], fallback: BOLT, maxAbilities: 2, stats: { life: 1.4, damage: 1.0, speed: 0, armor: 2, xp: 1.2, poise: 4 },
	pause: [ 0.6, 1.2 ], faceTarget: true, turnSpeed: 2.2, aggro: 16, leash: 999,
	move: ( world, e ) => stop( e ) } );

// Burrower: digs in, travels underground (untargetable), erupts under you.
archetype( { id: 'burrower', name: 'Burrower', tags: [ 'melee', 'burrow' ], desc: 'Dives underground and erupts beneath you - the dust ring is your warning.',
	roles: [ 'melee' ], core: [ 'burrow', 'strike' ], stats: { life: 1.1, damage: 1.1, speed: 1, xp: 1.3 },
	pause: [ 0.5, 1 ],
	move: ( world, e, b, t, d ) => approach( world, e, b, t, d ) } );

// Shown in the agent API / Workshop.
export function describeArchetype( a ) {

	return { id: a.id, name: a.name, desc: a.desc, roles: a.roles, core: a.core, stats: a.stats, aggro: a.aggro, leash: a.leash, pause: a.pause };

}
