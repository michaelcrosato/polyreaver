// KEYSTONES: passive nodes that change a rule instead of adding a number. Each one
// is built from up to four tools, from simplest to most powerful:
//
//   mods       ordinary stat modifiers, incl. `override` ("maximum Life is 1") and
//              conditional `when` mods ("while on Low Life")
//   derive     ( T, level, raw ) -> mods, computed from the build's other stats
//              ( raw( stat ) reads a stat ignoring overrides )
//              ("gain Energy Shield equal to 50% of maximum Mana")
//   transform  ( mods ) -> mods, rewrites the build's modifiers ("convert added
//              physical damage to fire")
//   hooks      event handlers run by the mechanics runtime ( mechanics.js ):
//              hit, crit, kill, struck, dodge, evade, block, action, flask, pickup,
//              manaSpent, tick - each gets a ctx with damage / buff / heal helpers
//
//   define( 'keystone', { id, name, region, lines: [ text ], mods, derive?, transform?, hooks?, lowLife? } )
//
// Uniques can grant keystones too ( `grants: [ id ]` in uniques.js ).

import { define } from '../../../core/registry.js';
import { M } from './clusters.js';

function K( def ) {

	define( 'keystone', { mods: [], tags: [ 'keystone', def.region ], ...def } );

}

// --- Might (STR) -------------------------------------------------------------------------------
K( { id: 'blood-magic', name: 'Blood Magic', region: 'might', icon: 'drop',
	lines: [ 'Skills cost Life instead of Mana', 'Your Mana is always kept full', '10% increased maximum Life' ],
	mods: [ M( 'life', 'inc', 10 ), M( 'skill_cost_life', 'override', 1 ) ],
	hooks: {
		tick( ctx ) {

			ctx.player.mana = ctx.player.maxMana;

		}
	} } );
K( { id: 'unwavering', name: 'Unwavering Stance', region: 'might', icon: 'anchor',
	lines: [ 'Cannot be Stunned or Knocked Back', 'Cannot Evade Attacks' ],
	mods: [ M( 'evade_chance', 'override', 0 ) ],
	hooks: {
		tick( ctx ) {

			ctx.player.flags.unstoppable = true;
			if ( ctx.player.statuses.has( 'stun' ) ) ctx.world.removeStatus( ctx.player, 'stun' );

		},
		end( ctx ) {

			ctx.player.flags.unstoppable = false;

		}
	} } );
K( { id: 'vaal-pact', name: 'Vaal Pact', region: 'might', icon: 'fang',
	lines: [ '100% more Life Leeched', 'You have no Life Regeneration' ],
	mods: [ M( 'life_leech', 'more', 100 ), M( 'life_on_hit', 'more', 100 ), M( 'life_regen', 'override', 0 ), M( 'life_regen_pct', 'override', 0 ) ] } );
K( { id: 'resolute-technique', name: 'Resolute Technique', region: 'might', icon: 'fist',
	lines: [ 'Never deal Critical Strikes', '30% more Attack Damage', '25% increased Stun Threshold' ],
	mods: [ M( 'crit_chance', 'override', 0 ), M( 'damage', 'more', 30, [ 'attack' ] ), M( 'stun_threshold', 'inc', 25 ) ] } );
K( { id: 'cull-the-weak', name: 'Cull the Weak', region: 'might', icon: 'skull',
	lines: [ 'Your Hits instantly kill enemies below 10% of their Life', 'Bosses are culled below 5% instead' ],
	hooks: {
		hit( ctx, ev ) {

			const t = ev.target;
			if ( ! t.alive ) return;
			const limit = t.kind === 'boss' || t.data.rarity === 'boss' ? 0.05 : 0.1;
			if ( t.life / Math.max( 1, t.maxLife ) < limit ) {

				ctx.fx( 'cull', { x: t.x, z: t.z } );
				ctx.world.kill( t, ctx.player, { tags: [ 'proc', 'cull' ] } );

			}

		}
	} } );

// --- Might / Sorcery hybrid ------------------------------------------------------------------------
K( { id: 'avatar-of-fire', name: 'Avatar of Fire', region: 'ms', icon: 'flame',
	lines: [ '50% of added Physical, Cold and Lightning Damage is Converted to Fire', '30% more Fire Damage', '30% less Physical, Cold and Lightning Damage' ],
	mods: [ M( 'damage', 'more', 30, [ 'fire' ] ), M( 'damage', 'more', - 30, [ 'physical' ] ), M( 'damage', 'more', - 30, [ 'cold' ] ), M( 'damage', 'more', - 30, [ 'lightning' ] ) ],
	transform( mods ) {

		// conversion at the source: every flat "added X damage" mod gives half of itself to fire
		const out = [];
		for ( const m of mods ) {

			const r = /^added_(physical|cold|lightning)_(min|max)$/.exec( m.stat );
			if ( r && m.type === 'flat' ) {

				out.push( { ...m, value: m.value * 0.5 }, { ...m, stat: `added_fire_${r[ 2 ]}`, value: m.value * 0.5, from: ( m.from || '' ) + ' (converted)' } );

			} else out.push( m );

		}

		return out;

	} } );
K( { id: 'pain-attunement', name: 'Pain Attunement', region: 'ms', icon: 'heart',
	lines: [ 'You count as on Low Life while below 50% of maximum Life', '30% more Spell Damage while on Low Life' ],
	lowLife: 0.5,
	mods: [ M( 'damage', 'more', 30, [ 'spell' ], 'low_life' ) ] } );
K( { id: 'iron-will', name: 'Iron Will', region: 'ms', icon: 'fist',
	lines: [ "Strength's Melee Damage bonus also applies to Spell Damage", '+20 to Strength' ],
	mods: [ M( 'strength', 'flat', 20 ) ],
	derive( T ) {

		return [ M( 'damage', 'inc', Math.floor( T.get( 'strength' ) * 0.2 ), [ 'spell' ] ) ];

	} } );
K( { id: 'conflagration', name: 'Conflagration', region: 'ms', icon: 'flame',
	lines: [ '+20% chance to Ignite', 'Enemies you kill while they are Ignited explode, dealing 6% of their Life as Fire Damage' ],
	mods: [ M( 'ignite_chance', 'flat', 20 ) ],
	hooks: {
		kill( ctx, ev ) {

			if ( ! ctx.ailing( ev.entity, 'ignite' ) ) return;
			ctx.nova( ev.x, ev.z, 3, { fire: ev.entity.maxLife * 0.06 }, { fx: 'explosion', element: 'fire', color: '#ff7a2a' } );

		}
	} } );

// --- Sorcery (INT) ---------------------------------------------------------------------------------
K( { id: 'eldritch-battery', name: 'Eldritch Battery', region: 'sorcery', icon: 'battery',
	lines: [ 'Skill costs are paid from Energy Shield before Mana', 'Gain maximum Energy Shield equal to 50% of maximum Mana', '50% less Mana Regeneration' ],
	mods: [ M( 'mana_regen', 'more', - 50 ), M( 'skill_cost_shield_first', 'override', 1 ) ],
	derive( T ) {

		return [ M( 'shield', 'flat', Math.round( T.get( 'mana' ) * 0.5 ) ) ];

	} } );
K( { id: 'chaos-inoculation', name: 'Chaos Inoculation', region: 'sorcery', icon: 'void',
	lines: [ 'Maximum Life is 1', 'Immune to Chaos Damage', '40% more maximum Energy Shield' ],
	mods: [ M( 'life', 'override', 1 ), M( 'res_chaos', 'override', 100 ), M( 'max_res_chaos', 'flat', 25 ), M( 'shield', 'more', 40 ), M( 'chaos_immune', 'override', 1 ) ] } );
K( { id: 'mind-over-matter', name: 'Mind over Matter', region: 'sorcery', icon: 'mind',
	lines: [ '30% of Damage taken from Hits is taken from Mana before Life', '15% increased maximum Mana' ],
	mods: [ M( 'mana', 'inc', 15 ), M( 'damage_to_mana', 'flat', 30 ) ] } );
K( { id: 'zealots-oath', name: "Zealot's Oath", region: 'sorcery', icon: 'halo',
	lines: [ 'Life Regeneration applies to Energy Shield instead of Life' ],
	hooks: {
		tick( ctx, dt ) {

			// read the regeneration the build WOULD have, then route it to shield
			const p = ctx.player, S = p.stats;
			const b = S.breakdown( 'life_regen', [], false ), bp = S.breakdown( 'life_regen_pct', [], false );
			const regen = ( b.base + b.flat ) * Math.max( 0, 1 + b.inc / 100 ) * b.more + p.maxLife * ( bp.base + bp.flat ) / 100;
			const maxS = S.get( 'shield' );
			if ( maxS > 0 ) p.shield = Math.min( maxS, p.shield + regen * dt );

		}
	},
	mods: [ M( 'life_regen', 'override', 0 ), M( 'life_regen_pct', 'override', 0 ) ] } );
K( { id: 'necromantic-pact', name: 'Necromantic Pact', region: 'sorcery', icon: 'skull',
	lines: [ 'Minions deal 40% more Damage', 'Minions have 30% more Life', 'You deal 20% less Damage' ],
	mods: [ M( 'minion_damage', 'more', 40 ), M( 'minion_life', 'more', 30 ), M( 'damage', 'more', - 20 ) ] } );
K( { id: 'overcharge', name: 'Overcharge', region: 'sorcery', icon: 'bolt',
	lines: [ '100% more Mana Regeneration', 'Skills cost 40% more Mana', '1% more Spell Damage per 30 maximum Mana' ],
	mods: [ M( 'mana_regen', 'more', 100 ), M( 'mana_cost', 'more', 40 ) ],
	derive( T ) {

		return [ M( 'damage', 'more', Math.floor( T.get( 'mana' ) / 30 ), [ 'spell' ] ) ];

	} } );

// --- Finesse / Sorcery hybrid -------------------------------------------------------------------------
K( { id: 'elemental-overload', name: 'Elemental Overload', region: 'fs', icon: 'prism',
	lines: [ 'Critical Strikes grant Elemental Overload for 8 seconds: 40% more Elemental Damage', 'Your Critical Strikes deal no extra Damage' ],
	mods: [ M( 'crit_multi', 'override', 100 ) ],
	hooks: {
		crit( ctx ) {

			ctx.buff( 'elemental-overload', 8, [ M( 'damage', 'more', 40, [ 'fire' ] ), M( 'damage', 'more', 40, [ 'cold' ] ), M( 'damage', 'more', 40, [ 'lightning' ] ) ] );

		}
	} } );
K( { id: 'arrow-dancing', name: 'Arrow Dancing', region: 'fs', icon: 'feather',
	lines: [ '+25% chance to Evade Projectile Attacks', '50% less chance to Evade Melee Attacks' ],
	mods: [ M( 'evade_chance', 'flat', 25, [ 'projectile' ] ), M( 'evade_chance', 'more', - 50, [ 'melee' ] ) ] } );
K( { id: 'glass-cannon', name: 'Glass Cannon', region: 'fs', icon: 'shard',
	lines: [ '40% more Damage', '40% less maximum Life and Energy Shield' ],
	mods: [ M( 'damage', 'more', 40 ), M( 'life', 'more', - 40 ), M( 'shield', 'more', - 40 ) ] } );

// --- Finesse (DEX) -----------------------------------------------------------------------------------
K( { id: 'momentum', name: 'Momentum', region: 'finesse', icon: 'wind',
	lines: [ 'Gain a Momentum stack every 0.4 s while moving (max 10)', 'Each stack: 3% increased Movement Speed, 2% increased Attack and Cast Speed', 'Lose all stacks after standing still for 1 second' ],
	hooks: {
		tick( ctx, dt ) {

			const s = ctx.state, p = ctx.player;
			s.stacks ??= 0; s.acc ??= 0; s.still ??= 0;
			if ( Math.hypot( p.vx, p.vz ) > 0.5 ) {

				s.still = 0;
				s.acc += dt;
				if ( s.acc >= 0.4 && s.stacks < 10 ) {

					s.acc = 0;
					s.stacks ++;
					s.dirty = true;

				}

			} else {

				s.still += dt;
				if ( s.still > 1 && s.stacks > 0 ) {

					s.stacks = 0;
					s.dirty = true;

				}

			}

			if ( s.dirty ) {

				s.dirty = false;
				ctx.buff( 'momentum', 9999, s.stacks ? [ M( 'move_speed', 'inc', 3 * s.stacks ), M( 'attack_speed', 'inc', 2 * s.stacks ), M( 'cast_speed', 'inc', 2 * s.stacks ) ] : [], { stacks: s.stacks } );

			}

		}
	} } );
K( { id: 'point-blank', name: 'Point Blank', region: 'finesse', icon: 'target',
	lines: [ '35% more Projectile Damage while an Enemy is within 5 metres', '15% less Projectile Damage otherwise' ],
	mods: [ M( 'damage', 'more', 35, [ 'projectile' ], 'near_enemy' ), M( 'damage', 'more', - 15, [ 'projectile' ], 'no_enemy_near' ) ] } );
K( { id: 'acrobatics', name: 'Acrobatics', region: 'finesse', icon: 'feather',
	lines: [ '+15% chance to Evade Attacks', '30% reduced Dodge Roll Cooldown', '50% less Armour and Energy Shield' ],
	mods: [ M( 'evade_chance', 'flat', 15 ), M( 'dodge_cooldown', 'inc', - 30 ), M( 'armor', 'more', - 50 ), M( 'shield', 'more', - 50 ) ] } );
K( { id: 'wind-dancer', name: 'Wind Dancer', region: 'finesse', icon: 'wind',
	lines: [ "20% less Damage taken if you haven't been Hit Recently", "20% more Damage taken if you've been Hit Recently", '+5% chance to Evade Attacks' ],
	mods: [ M( 'damage_taken', 'more', - 20, null, 'not_hit_recently' ), M( 'damage_taken', 'more', 20, null, 'hit_recently' ), M( 'evade_chance', 'flat', 5 ) ] } );
K( { id: 'heartstopper', name: 'Heartstopper', region: 'finesse', icon: 'heart',
	lines: [ "50% less Damage taken if you've Dodged in the last 2 seconds", '30% increased Dodge Roll Cooldown' ],
	mods: [ M( 'damage_taken', 'more', - 50, null, 'dodged_recently' ), M( 'dodge_cooldown', 'inc', 30 ) ] } );

// --- Might / Finesse hybrid ----------------------------------------------------------------------------
K( { id: 'iron-reflexes', name: 'Iron Reflexes', region: 'mf', icon: 'shield',
	lines: [ 'Converts all Evasion into Armour', 'Cannot Evade Attacks' ],
	mods: [ M( 'evade_chance', 'override', 0 ) ],
	derive( T, level, raw ) {

		// every 1% evade chance the gear and tree WOULD give (raw ignores this keystone's
		// own "evade is 0" override) becomes ( 12 + 2 x level ) armour
		return [ M( 'armor', 'flat', Math.round( raw( 'evade_chance' ) * ( 12 + 2 * level ) ) ) ];

	} } );
K( { id: 'rampage', name: 'Rampage', region: 'mf', icon: 'skull',
	lines: [ 'Kills grant a Rampage stack (max 50); stacks expire 5 s after your last kill', '1% more Damage and 0.4% increased Movement Speed per 2 stacks' ],
	hooks: {
		kill( ctx ) {

			const s = ctx.state;
			s.stacks = Math.min( 50, ( s.stacks ?? 0 ) + 1 );
			ctx.buff( 'rampage', 5, [ M( 'damage', 'more', Math.floor( s.stacks / 2 ) ), M( 'move_speed', 'inc', Math.floor( s.stacks / 2 ) * 0.4 ) ], { stacks: s.stacks, onEnd: () => ( s.stacks = 0 ) } );

		}
	} } );
K( { id: 'executioner', name: 'Executioner', region: 'mf', icon: 'axe',
	lines: [ 'Your Hits deal 40% more Damage to enemies on Low Life (below 35%)' ],
	hooks: {
		hit( ctx, ev ) {

			const t = ev.target;
			if ( t.alive && t.life / Math.max( 1, t.maxLife ) < 0.35 ) ctx.strike( t, ev.total * 0.4, 'physical' );

		}
	} } );
