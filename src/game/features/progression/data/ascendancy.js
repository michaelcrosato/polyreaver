// ASCENDANCIES: a specialisation unlocked at level 30 (Mystic / passive tree panel).
// Each is a small hand-made tree of six branches - a minor node, then a powerful
// notable - paid for with ascendancy points (2 at levels 30, 45, 60 and 75).
// Notables use the same tools as keystones: mods, derive and event hooks.
//
//   define( 'ascendancy', { id, name, region, desc, color, nodes: [ { id, name, type, mods, hooks?, lines?, branch } ] } )
//
// Layout and links are generated from `branch` (0-5) by tree.js.

import { define } from '../../../core/registry.js';
import { M } from './clusters.js';

export const ASCENDANCY_LEVEL = 30;
export const ASCENDANCY_MILESTONES = [ 30, 45, 60, 75 ];

function A( id, name, region, color, desc, branches ) {

	const nodes = [ { id: `${id}:root`, name, type: 'start', mods: [], branch: - 1 } ];
	branches.forEach( ( [ small, notable ], i ) => {

		nodes.push( { id: `${id}:s${i}`, name: small.name, type: 'small', mods: small.mods, branch: i } );
		nodes.push( { id: `${id}:n${i}`, name: notable.name, type: 'notable', mods: notable.mods || [], lines: notable.lines, hooks: notable.hooks, derive: notable.derive, grants: notable.grants, branch: i } );

	} );
	define( 'ascendancy', { id, name, region, color, desc, nodes, tags: [ region ] } );

}

const S = ( name, ...mods ) => ( { name, mods } );

// --- Warbringer (Might) -------------------------------------------------------------------------
A( 'warbringer', 'Warbringer', 'might', '#e06050', 'An unstoppable front-line juggernaut: armour, stuns and earth-shaking kills.', [
	[ S( 'Armour', M( 'armor', 'inc', 15 ) ), { name: 'Unbreakable', mods: [ M( 'armor', 'inc', 30 ), M( 'max_res_fire', 'flat', 1 ), M( 'max_res_cold', 'flat', 1 ), M( 'max_res_lightning', 'flat', 1 ), M( 'damage_taken', 'more', - 10, null, 'stationary' ) ] } ],
	[ S( 'Melee Damage', M( 'damage', 'inc', 12, [ 'melee' ] ) ), { name: 'Earthshaker', lines: [ 'Melee Kills cause an Aftershock dealing 25% of the slain enemy\'s Life as Physical Damage around it' ],
		hooks: {
			kill( ctx, ev ) {

				if ( ! ( ev.hit?.tags || [] ).includes( 'melee' ) ) return;
				ctx.nova( ev.x, ev.z, 3.5, { physical: ev.entity.maxLife * 0.25 }, { delay: 0.15, fx: 'slam', color: '#c8a070', knockback: 8 } );

			}
		} } ],
	[ S( 'Life Leech', M( 'life_leech', 'flat', 0.3, [ 'attack' ] ) ), { name: 'Blood Rage', mods: [ M( 'life_leech', 'flat', 1, [ 'attack' ] ), M( 'attack_speed', 'inc', 20, null, 'low_life' ), M( 'damage', 'inc', 20, null, 'low_life' ) ] } ],
	[ S( 'Two-Handed Damage', M( 'damage', 'inc', 12, null, 'two_handed' ) ), { name: "Titan's Grip", mods: [ M( 'damage', 'more', 25, null, 'two_handed' ), M( 'area', 'inc', 15 ) ] } ],
	[ S( 'Life', M( 'life', 'inc', 6 ) ), { name: 'Immovable', lines: [ 'Cannot be Stunned', '10% less Damage taken' ], mods: [ M( 'damage_taken', 'more', - 10 ) ],
		hooks: {
			tick( ctx ) {

				if ( ctx.player.statuses.has( 'stun' ) ) ctx.world.removeStatus( ctx.player, 'stun' );

			}
		} } ],
	[ S( 'Strength', M( 'strength', 'flat', 15 ) ), { name: "Warlord's Command", mods: [ M( 'skill_level', 'flat', 1, [ 'melee' ] ), M( 'damage', 'inc', 20, [ 'melee' ] ), M( 'stun_threshold', 'inc', 30 ) ] } ]
] );

// --- Windrunner (Finesse) ---------------------------------------------------------------------------
A( 'windrunner', 'Windrunner', 'finesse', '#60d070', 'A blur of motion: momentum, ricocheting projectiles and assassinations.', [
	[ S( 'Movement Speed', M( 'move_speed', 'inc', 4 ) ), { name: 'Fleet', lines: [ 'Grants the Momentum keystone' ], mods: [ M( 'move_speed', 'inc', 10 ) ], grants: [ 'momentum' ] } ],
	[ S( 'Projectile Damage', M( 'damage', 'inc', 12, [ 'projectile' ] ) ), { name: 'Ricochet', mods: [ M( 'chain', 'flat', 1, [ 'projectile' ] ), M( 'pierce', 'flat', 1 ), M( 'damage', 'inc', 15, [ 'projectile' ] ) ] } ],
	[ S( 'Critical Strike Chance', M( 'crit_chance', 'inc', 20 ) ), { name: 'Assassinate', lines: [ 'Critical Strikes against enemies on Low Life deal 60% more Damage' ],
		hooks: {
			crit( ctx, ev ) {

				const t = ev.target;
				if ( t.alive && t.life / Math.max( 1, t.maxLife ) < 0.35 ) ctx.strike( t, ev.total * 0.6, 'physical' );

			}
		} } ],
	[ S( 'Dodge Cooldown', M( 'dodge_cooldown', 'inc', - 10 ) ), { name: 'Phantom Step', mods: [ M( 'dodge_cooldown', 'inc', - 30 ), M( 'damage', 'more', 25, null, 'dodged_recently' ) ] } ],
	[ S( 'Poison Chance', M( 'poison_chance', 'flat', 8 ) ), { name: 'Toxic Edge', lines: [ '+25% chance to Poison', 'Poisoned enemies you kill spread Poison to nearby enemies' ], mods: [ M( 'poison_chance', 'flat', 25 ) ],
		hooks: {
			kill( ctx, ev ) {

				if ( ctx.ailing( ev.entity, 'poison' ) ) ctx.nova( ev.x, ev.z, 4, { chaos: ctx.dmg( 0.3 ) }, { fx: 'poison', element: 'chaos', color: '#8aff4a', ailments: { poison: 100 } } );

			}
		} } ],
	[ S( 'Attack Speed', M( 'attack_speed', 'inc', 5 ) ), { name: 'Gale Force', mods: [ M( 'skill_level', 'flat', 1, [ 'projectile' ] ), M( 'projectile_speed', 'inc', 20 ), M( 'attack_speed', 'inc', 10 ) ] } ]
] );

// --- Stormweaver (Sorcery) -----------------------------------------------------------------------------
A( 'stormweaver', 'Stormweaver', 'sorcery', '#6090f0', 'A master of the elements who turns mana into raw power.', [
	[ S( 'Spell Damage', M( 'damage', 'inc', 12, [ 'spell' ] ) ), { name: 'Arcane Surge', lines: [ 'Spending 60 Mana grants Arcane Surge for 4 seconds: 25% more Spell Damage, 15% increased Cast Speed' ],
		hooks: {
			manaSpent( ctx, amount ) {

				ctx.state.spent = ( ctx.state.spent ?? 0 ) + amount;
				if ( ctx.state.spent < 60 ) return;
				ctx.state.spent = 0;
				ctx.buff( 'arcane-surge', 4, [ M( 'damage', 'more', 25, [ 'spell' ] ), M( 'cast_speed', 'inc', 15 ) ] );

			}
		} } ],
	[ S( 'Shock Chance', M( 'shock_chance', 'flat', 8 ) ), { name: 'Overcharged', lines: [ '+25% chance to Shock', 'Shocked enemies explode on death for 8% of their Life as Lightning Damage' ], mods: [ M( 'shock_chance', 'flat', 25 ) ],
		hooks: {
			kill( ctx, ev ) {

				if ( ctx.ailing( ev.entity, 'shock' ) ) ctx.nova( ev.x, ev.z, 3.2, { lightning: ev.entity.maxLife * 0.08 }, { fx: 'nova', element: 'lightning', color: '#ffe95a' } );

			}
		} } ],
	[ S( 'Mana', M( 'mana', 'inc', 8 ) ), { name: 'Mana Shield', lines: [ '35% of Damage taken from Hits is taken from Mana before Life' ],
		mods: [ M( 'damage_to_mana', 'flat', 35 ) ] } ],
	[ S( 'Elemental Damage', M( 'damage', 'inc', 8, [ 'fire' ] ), M( 'damage', 'inc', 8, [ 'cold' ] ), M( 'damage', 'inc', 8, [ 'lightning' ] ) ), { name: 'Elemental Mastery', mods: [ M( 'skill_level', 'flat', 1, [ 'fire' ] ), M( 'skill_level', 'flat', 1, [ 'cold' ] ), M( 'skill_level', 'flat', 1, [ 'lightning' ] ), M( 'pen_fire', 'flat', 10 ), M( 'pen_cold', 'flat', 10 ), M( 'pen_lightning', 'flat', 10 ) ] } ],
	[ S( 'Lightning Damage', M( 'damage', 'inc', 12, [ 'lightning' ] ) ), { name: 'Storm Herald', lines: [ 'Every 2.5 seconds, Lightning strikes a nearby enemy for heavy damage' ],
		hooks: {
			tick( ctx ) {

				const p = ctx.player;
				const t = ctx.nearestEnemy( p.x, p.z, 12 );
				if ( ! t || ! ctx.cooldown( 'herald', 2.5 ) ) return;
				ctx.nova( t.x, t.z, 2, { lightning: ctx.dmg( 1.8 ) }, { fx: 'lightning', element: 'lightning', color: '#ffe95a', ailments: { shock: 40 } } );

			}
		} } ],
	[ S( 'Energy Shield', M( 'shield', 'inc', 10 ) ), { name: 'Mind over Body', mods: [ M( 'shield', 'inc', 30 ), M( 'mana', 'inc', 20 ), M( 'mana_regen', 'inc', 30 ) ] } ]
] );
