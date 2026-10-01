// Passive tree CLUSTER TEMPLATES. The tree generator ( tree.js ) never hard-codes
// nodes: it walks a fixed grid of cluster slots around the three start regions and
// fills each slot with a template picked by region weight, so adding a theme to the
// tree is one define() here.
//
//   define( 'treeCluster', {
//     id, name, theme,                      theme = colour / icon family and search word
//     regions: { might: 3, ms: 1, ... },    where it may appear (weight per sector)
//     shapes: [ 'wheel', 'chain', ... ],    layouts it can take ( tree.js SHAPES )
//     small: { name, mods },                the repeated small node
//     notables: [ { name, mods } ],         named notables (each instance takes 1-2)
//     rings: [ min, max ]                   radial band (0 = next to the starts)
//   } )
//
// Sectors: might (STR, lower left), finesse (DEX, lower right), sorcery (INT, top),
// and the hybrid zones between them: mf (STR/DEX), fs (DEX/INT), ms (STR/INT).

import { define } from '../../../core/registry.js';

// M( stat, type, value, tags?, when? ) - one stat modifier
export const M = ( stat, type, value, tags = null, when = null ) => {

	const m = { stat, type, value };
	if ( tags ) m.tags = tags;
	if ( when ) m.when = when;
	return m;

};

const N = ( name, ...mods ) => ( { name, mods } );
const ELE = ( v, when ) => [ M( 'damage', 'inc', v, [ 'fire' ], when ), M( 'damage', 'inc', v, [ 'cold' ], when ), M( 'damage', 'inc', v, [ 'lightning' ], when ) ];
const RES = ( v ) => [ M( 'res_fire', 'flat', v ), M( 'res_cold', 'flat', v ), M( 'res_lightning', 'flat', v ) ];

function C( id, name, theme, regions, small, notables, opts = {} ) {

	define( 'treeCluster', {
		id, name, theme, regions, small, notables,
		shapes: opts.shapes || [ 'wheel', 'chain', 'fork', 'ring', 'star' ],
		rings: opts.rings || [ 0, 5 ], weight: opts.weight ?? 1, tags: [ theme, ...( opts.tags || [] ) ]
	} );

}

// --- life, defences, recovery ------------------------------------------------------------
C( 'life', 'Vitality', 'life', { might: 4, ms: 2, mf: 2, finesse: 1, sorcery: 1, fs: 1 }, { name: 'Life', mods: [ M( 'life', 'inc', 4 ) ] }, [
	N( 'Thick Skin', M( 'life', 'inc', 10 ), M( 'life_regen', 'flat', 3 ) ),
	N( 'Heart of Oak', M( 'life', 'inc', 8 ), M( 'life_regen_pct', 'flat', 0.5 ) ),
	N( 'Bloodline', M( 'life', 'inc', 10 ), M( 'stun_threshold', 'inc', 25 ) ),
	N( 'Unbreakable Spirit', M( 'life', 'inc', 8 ), ...RES( 8 ) ),
	N( 'Titanic Constitution', M( 'life', 'inc', 12 ), M( 'move_speed', 'inc', - 3 ) ),
	N( 'Survivor\'s Instinct', M( 'life', 'inc', 8 ), M( 'life_regen_pct', 'flat', 1.5, null, 'low_life' ) )
], { weight: 2.2 } );
C( 'regen', 'Regrowth', 'life', { might: 2, ms: 2, mf: 1 }, { name: 'Life Regeneration', mods: [ M( 'life_regen_pct', 'flat', 0.3 ) ] }, [
	N( 'Troll Blood', M( 'life_regen_pct', 'flat', 1 ), M( 'life', 'inc', 5 ) ),
	N( 'Hydra\'s Resilience', M( 'life_regen_pct', 'flat', 0.8 ), M( 'life_regen_pct', 'flat', 1.2, null, 'not_hit_recently' ) ),
	N( 'Sap of the World Tree', M( 'life_regen', 'flat', 12 ), M( 'life_on_kill', 'flat', 8 ) ),
	N( 'Second Wind', M( 'life_regen_pct', 'flat', 2, null, 'low_life' ), M( 'move_speed', 'inc', 8, null, 'low_life' ) )
], { rings: [ 1, 5 ] } );
C( 'armour', 'Ironclad', 'armour', { might: 4, mf: 2, ms: 1 }, { name: 'Armour', mods: [ M( 'armor', 'inc', 12 ) ] }, [
	N( 'Iron Hide', M( 'armor', 'inc', 25 ), M( 'life', 'inc', 5 ) ),
	N( 'Juggernaut\'s Carapace', M( 'armor', 'inc', 30 ), M( 'damage_taken', 'more', - 4, [ 'physical' ] ) ),
	N( 'Stone Skin', M( 'armor', 'flat', 120 ), M( 'armor', 'inc', 20 ) ),
	N( 'Bastion of Stone', M( 'armor', 'inc', 50, null, 'stationary' ), M( 'stun_threshold', 'inc', 20 ) ),
	N( 'Plated Fortress', M( 'armor', 'inc', 30 ), M( 'res_fire', 'flat', 10 ), M( 'res_cold', 'flat', 10 ) )
], { weight: 1.8 } );
C( 'evasion', 'Elusion', 'evasion', { finesse: 4, mf: 2, fs: 2 }, { name: 'Evasion', mods: [ M( 'evade_chance', 'inc', 10 ) ] }, [
	N( 'Blur', M( 'evade_chance', 'inc', 20 ), M( 'move_speed', 'inc', 4 ) ),
	N( 'Shadow Dancer', M( 'evade_chance', 'flat', 4 ), M( 'evade_chance', 'inc', 15 ) ),
	N( 'Mist Walker', M( 'evade_chance', 'flat', 6, null, 'moving' ), M( 'dodge_distance', 'inc', 10 ) ),
	N( 'Fleet of Foot', M( 'evade_chance', 'inc', 18 ), M( 'dodge_cooldown', 'inc', - 10 ) ),
	N( 'Will of the Wisp', M( 'evade_chance', 'inc', 15 ), M( 'life', 'inc', 5 ) )
], { weight: 1.8 } );
C( 'shield', 'Aegis Weave', 'shield', { sorcery: 4, fs: 2, ms: 2 }, { name: 'Energy Shield', mods: [ M( 'shield', 'inc', 8 ) ] }, [
	N( 'Arcane Barrier', M( 'shield', 'inc', 20 ), M( 'mana', 'inc', 5 ) ),
	N( 'Soul Ward', M( 'shield', 'inc', 15 ), M( 'shield', 'flat', 30 ) ),
	N( 'Prism Guard', M( 'shield', 'inc', 15 ), ...RES( 6 ) ),
	N( 'Serene Mind', M( 'shield', 'inc', 25, null, 'full_shield' ), M( 'damage', 'inc', 15, [ 'spell' ], 'full_shield' ) ),
	N( 'Quickened Ward', M( 'shield', 'inc', 18 ), M( 'cast_speed', 'inc', 4 ) )
], { weight: 1.8 } );
C( 'mana', 'Wellspring', 'mana', { sorcery: 3, fs: 1, ms: 1 }, { name: 'Mana', mods: [ M( 'mana', 'inc', 6 ) ] }, [
	N( 'Deep Wisdom', M( 'mana', 'inc', 15 ), M( 'mana_regen', 'inc', 20 ) ),
	N( 'Infused Flesh', M( 'mana', 'inc', 10 ), M( 'life', 'inc', 5 ) ),
	N( 'Frugality', M( 'mana_cost', 'inc', - 12 ), M( 'mana_regen', 'inc', 15 ) ),
	N( 'Spring of Insight', M( 'mana_regen', 'inc', 30 ), M( 'mana_on_kill', 'flat', 5 ) )
] );
C( 'mana-regen', 'Clarity', 'mana', { sorcery: 2, fs: 1, ms: 1 }, { name: 'Mana Regeneration', mods: [ M( 'mana_regen', 'inc', 12 ) ] }, [
	N( 'Lucid Dreaming', M( 'mana_regen', 'inc', 30 ), M( 'mana', 'flat', 20 ) ),
	N( 'Arcane Flow', M( 'mana_regen', 'inc', 25 ), M( 'cast_speed', 'inc', 5 ) ),
	N( 'Mental Rapidity', M( 'mana_regen', 'inc', 20 ), M( 'mana_cost', 'inc', - 8 ), M( 'cast_speed', 'inc', 4 ) )
], { rings: [ 1, 5 ] } );
C( 'block', 'Shield Wall', 'block', { might: 2, mf: 1, ms: 1 }, { name: 'Block', mods: [ M( 'block_chance', 'flat', 1 ) ] }, [
	N( 'Defiance', M( 'block_chance', 'flat', 4 ), M( 'armor', 'inc', 15 ) ),
	N( 'Testudo', M( 'block_chance', 'flat', 5, null, 'holding_shield' ), M( 'life', 'inc', 5 ) ),
	N( 'Retaliation', M( 'block_chance', 'flat', 3 ), M( 'damage', 'inc', 20, null, 'blocked_recently' ) ),
	N( 'Deflection', M( 'block_chance', 'flat', 3 ), M( 'evade_chance', 'inc', 10 ) )
], { rings: [ 1, 5 ] } );
C( 'resist', 'Warding', 'resistance', { might: 1, finesse: 1, sorcery: 1, ms: 1, mf: 1, fs: 1 }, { name: 'Elemental Resistances', mods: RES( 3 ) }, [
	N( 'Prismatic Skin', ...RES( 10 ) ),
	N( 'Flamewalker', M( 'res_fire', 'flat', 20 ), M( 'max_res_fire', 'flat', 1 ) ),
	N( 'Frostborn', M( 'res_cold', 'flat', 20 ), M( 'max_res_cold', 'flat', 1 ) ),
	N( 'Stormskin', M( 'res_lightning', 'flat', 20 ), M( 'max_res_lightning', 'flat', 1 ) ),
	N( 'Purity of Flesh', M( 'res_chaos', 'flat', 20 ), M( 'life', 'inc', 4 ) ),
	N( 'Elemental Equilibrium', ...RES( 6 ), M( 'max_res_fire', 'flat', 1 ), M( 'max_res_cold', 'flat', 1 ), M( 'max_res_lightning', 'flat', 1 ) )
], { weight: 1.4 } );
C( 'leech', 'Sanguine Hunger', 'leech', { might: 2, mf: 2, ms: 1 }, { name: 'Life Leech', mods: [ M( 'life_leech', 'flat', 0.2, [ 'attack' ] ) ] }, [
	N( 'Blood Drinker', M( 'life_leech', 'flat', 0.8, [ 'attack' ] ), M( 'damage', 'inc', 10, [ 'attack' ] ) ),
	N( 'Vampirism', M( 'life_leech', 'flat', 0.6 ), M( 'life', 'inc', 4 ) ),
	N( 'Feast of Flesh', M( 'life_on_hit', 'flat', 6, [ 'attack' ] ), M( 'life_leech', 'flat', 0.4, [ 'attack' ] ) ),
	N( 'Soul Thief', M( 'mana_leech', 'flat', 0.5, [ 'attack' ] ), M( 'life_leech', 'flat', 0.4, [ 'attack' ] ) )
], { rings: [ 1, 5 ] } );
C( 'on-kill', 'Reaping', 'leech', { might: 1, mf: 2, finesse: 1 }, { name: 'Life on Kill', mods: [ M( 'life_on_kill', 'flat', 4 ) ] }, [
	N( 'Grim Harvest', M( 'life_on_kill', 'flat', 15 ), M( 'mana_on_kill', 'flat', 5 ) ),
	N( 'Bloodbath', M( 'life_on_kill', 'flat', 10 ), M( 'damage', 'inc', 15, null, 'killed_recently' ) ),
	N( 'Carrion Feast', M( 'life_on_kill', 'flat', 12 ), M( 'life_regen_pct', 'flat', 1, null, 'killed_recently' ) )
] );

// --- elements ----------------------------------------------------------------------------
C( 'fire', 'Inferno', 'fire', { might: 2, ms: 4, sorcery: 2 }, { name: 'Fire Damage', mods: [ M( 'damage', 'inc', 10, [ 'fire' ] ) ] }, [
	N( 'Blacksmith\'s Clout', M( 'damage', 'inc', 25, [ 'fire' ] ), M( 'armor', 'inc', 10 ) ),
	N( 'Cremator', M( 'damage', 'inc', 20, [ 'fire' ] ), M( 'ignite_chance', 'flat', 8 ) ),
	N( 'Heart of Flame', M( 'damage', 'inc', 20, [ 'fire' ] ), M( 'res_fire', 'flat', 15 ) ),
	N( 'Wildfire', M( 'damage', 'inc', 20, [ 'fire' ] ), M( 'area', 'inc', 8 ) ),
	N( 'Pyromaniac', M( 'damage', 'inc', 30, [ 'fire' ], 'killed_recently' ), M( 'pen_fire', 'flat', 4 ) )
], { weight: 1.6 } );
C( 'cold', 'Hoarfrost', 'cold', { finesse: 2, fs: 4, sorcery: 2 }, { name: 'Cold Damage', mods: [ M( 'damage', 'inc', 10, [ 'cold' ] ) ] }, [
	N( 'Winter Spirit', M( 'damage', 'inc', 25, [ 'cold' ] ), M( 'chill_chance', 'flat', 8 ) ),
	N( 'Frost Walker', M( 'damage', 'inc', 20, [ 'cold' ] ), M( 'res_cold', 'flat', 15 ) ),
	N( 'Glacial Heart', M( 'damage', 'inc', 20, [ 'cold' ] ), M( 'freeze_chance', 'flat', 5 ) ),
	N( 'Hibernation', M( 'damage', 'inc', 20, [ 'cold' ] ), M( 'stun_threshold', 'inc', 20 ) ),
	N( 'Cold Blooded', M( 'damage', 'inc', 25, [ 'cold' ] ), M( 'pen_cold', 'flat', 4 ) )
], { weight: 1.6 } );
C( 'lightning', 'Tempest', 'lightning', { sorcery: 3, fs: 3, finesse: 1 }, { name: 'Lightning Damage', mods: [ M( 'damage', 'inc', 10, [ 'lightning' ] ) ] }, [
	N( 'Storm Weaver', M( 'damage', 'inc', 25, [ 'lightning' ] ), M( 'shock_chance', 'flat', 8 ) ),
	N( 'Thunderhead', M( 'damage', 'inc', 20, [ 'lightning' ] ), M( 'res_lightning', 'flat', 15 ) ),
	N( 'Arc Flash', M( 'damage', 'inc', 20, [ 'lightning' ] ), M( 'cast_speed', 'inc', 4 ), M( 'attack_speed', 'inc', 4 ) ),
	N( 'Voltaic Surge', M( 'damage', 'inc', 30, [ 'lightning' ], 'crit_recently' ), M( 'pen_lightning', 'flat', 4 ) ),
	N( 'Static Blows', M( 'damage', 'inc', 20, [ 'lightning' ] ), M( 'shock_chance', 'flat', 10, [ 'melee' ] ) )
], { weight: 1.6 } );
C( 'chaos', 'Blight', 'chaos', { finesse: 2, fs: 2, sorcery: 2 }, { name: 'Chaos Damage', mods: [ M( 'damage', 'inc', 10, [ 'chaos' ] ) ] }, [
	N( 'Corruption', M( 'damage', 'inc', 25, [ 'chaos' ] ), M( 'res_chaos', 'flat', 10 ) ),
	N( 'Toxic Strikes', M( 'damage', 'inc', 20, [ 'chaos' ] ), M( 'poison_chance', 'flat', 10 ) ),
	N( 'Void Beckons', M( 'damage', 'inc', 30, [ 'chaos' ] ), M( 'area', 'inc', 5 ) ),
	N( 'Malediction', M( 'damage', 'inc', 20, [ 'chaos' ] ), M( 'duration', 'inc', 15 ) )
], { weight: 1.3 } );
C( 'elemental', 'Elementalist', 'elemental', { fs: 2, ms: 2, sorcery: 1 }, { name: 'Elemental Damage', mods: ELE( 6 ) }, [
	N( 'Elemental Focus', ...ELE( 18 ), M( 'duration', 'inc', 10 ) ),
	N( 'Prism Weave', ...ELE( 15 ), ...RES( 6 ) ),
	N( 'Primal Fury', ...ELE( 22, 'killed_recently' ) ),
	N( 'Breach the Elements', M( 'pen_fire', 'flat', 4 ), M( 'pen_cold', 'flat', 4 ), M( 'pen_lightning', 'flat', 4 ) )
], { rings: [ 1, 5 ] } );
C( 'penetration', 'Breach', 'elemental', { sorcery: 1, fs: 1, ms: 1 }, { name: 'Penetration', mods: [ M( 'pen_fire', 'flat', 1 ), M( 'pen_cold', 'flat', 1 ), M( 'pen_lightning', 'flat', 1 ) ] }, [
	N( 'Searing Truth', M( 'pen_fire', 'flat', 8 ), M( 'damage', 'inc', 10, [ 'fire' ] ) ),
	N( 'Shattering Cold', M( 'pen_cold', 'flat', 8 ), M( 'damage', 'inc', 10, [ 'cold' ] ) ),
	N( 'Overload', M( 'pen_lightning', 'flat', 8 ), M( 'damage', 'inc', 10, [ 'lightning' ] ) )
], { rings: [ 3, 5 ], shapes: [ 'chain', 'fork' ] } );

// --- attack styles ---------------------------------------------------------------------------
C( 'physical', 'Brutality', 'physical', { might: 3, mf: 2 }, { name: 'Physical Damage', mods: [ M( 'damage', 'inc', 10, [ 'physical' ] ) ] }, [
	N( 'Brute Force', M( 'damage', 'inc', 25, [ 'physical' ] ), M( 'strength', 'flat', 10 ) ),
	N( 'Butchery', M( 'damage', 'inc', 20, [ 'physical' ] ), M( 'bleed_chance', 'flat', 10 ) ),
	N( 'Bone Breaker', M( 'damage', 'inc', 20, [ 'physical' ] ), M( 'pen_armor', 'flat', 60 ) ),
	N( 'Slaughter', M( 'damage', 'inc', 30, [ 'physical' ], 'killed_recently' ), M( 'life_on_kill', 'flat', 6 ) )
], { weight: 1.4 } );
C( 'melee', 'Warrior\'s Way', 'melee', { might: 3, mf: 2 }, { name: 'Melee Damage', mods: [ M( 'damage', 'inc', 10, [ 'melee' ] ) ] }, [
	N( 'Blade Master', M( 'damage', 'inc', 22, [ 'melee' ] ), M( 'attack_speed', 'inc', 4 ) ),
	N( 'Cleaving', M( 'damage', 'inc', 18, [ 'melee' ] ), M( 'area', 'inc', 10, [ 'melee' ] ) ),
	N( 'Brawler', M( 'damage', 'inc', 20, [ 'melee' ] ), M( 'knockback', 'inc', 20 ), M( 'life', 'inc', 3 ) ),
	N( 'Weapon Artistry', M( 'damage', 'inc', 18, [ 'melee' ] ), M( 'crit_chance', 'inc', 15, [ 'melee' ] ) )
], { weight: 1.6 } );
C( 'attack-speed', 'Swiftness', 'speed', { finesse: 3, mf: 2, might: 1 }, { name: 'Attack Speed', mods: [ M( 'attack_speed', 'inc', 3 ) ] }, [
	N( 'Lightning Reflexes', M( 'attack_speed', 'inc', 8 ), M( 'dexterity', 'flat', 10 ) ),
	N( 'Flurry', M( 'attack_speed', 'inc', 10 ), M( 'damage', 'inc', 8, [ 'attack' ] ) ),
	N( 'Frenzied Assault', M( 'attack_speed', 'inc', 12, null, 'killed_recently' ), M( 'move_speed', 'inc', 4, null, 'killed_recently' ) ),
	N( 'Precision', M( 'attack_speed', 'inc', 6 ), M( 'crit_chance', 'inc', 15, [ 'attack' ] ) )
], { weight: 1.5 } );
C( 'projectile', 'Marksman', 'projectile', { finesse: 4, fs: 2, mf: 1 }, { name: 'Projectile Damage', mods: [ M( 'damage', 'inc', 10, [ 'projectile' ] ) ] }, [
	N( 'Deadeye', M( 'damage', 'inc', 22, [ 'projectile' ] ), M( 'projectile_speed', 'inc', 15 ) ),
	N( 'Ricochet', M( 'chain', 'flat', 1, [ 'projectile' ] ), M( 'damage', 'inc', 10, [ 'projectile' ] ) ),
	N( 'Skewer', M( 'pierce', 'flat', 1 ), M( 'damage', 'inc', 15, [ 'projectile' ] ) ),
	N( 'Hail of Arrows', M( 'damage', 'inc', 15, [ 'projectile' ] ), M( 'attack_speed', 'inc', 6 ) ),
	N( 'Far Shot', M( 'damage', 'inc', 30, [ 'projectile' ], 'no_enemy_near' ), M( 'projectile_speed', 'inc', 10 ) )
], { weight: 1.6 } );
C( 'area', 'Devastation', 'area', { might: 2, sorcery: 2, ms: 2 }, { name: 'Area', mods: [ M( 'area', 'inc', 4 ) ] }, [
	N( 'Blast Radius', M( 'area', 'inc', 12 ), M( 'damage', 'inc', 10, [ 'area' ] ) ),
	N( 'Cataclysm', M( 'damage', 'inc', 25, [ 'area' ] ), M( 'area', 'inc', 5 ) ),
	N( 'Shockwave', M( 'area', 'inc', 10 ), M( 'knockback', 'inc', 25 ) ),
	N( 'Amplify', M( 'area', 'inc', 15 ), M( 'mana_cost', 'inc', 5 ) )
], { weight: 1.3 } );
C( 'crit', 'Precision Strikes', 'crit', { finesse: 3, fs: 3, mf: 1 }, { name: 'Critical Strike Chance', mods: [ M( 'crit_chance', 'inc', 12 ) ] }, [
	N( 'Assassination', M( 'crit_chance', 'inc', 30 ), M( 'crit_multi', 'flat', 10 ) ),
	N( 'Killer Instinct', M( 'crit_chance', 'inc', 25 ), M( 'attack_speed', 'inc', 4 ) ),
	N( 'Eagle Eye', M( 'crit_chance', 'inc', 30, [ 'projectile' ] ), M( 'damage', 'inc', 10, [ 'projectile' ] ) ),
	N( 'Spell Breaker', M( 'crit_chance', 'inc', 35, [ 'spell' ] ), M( 'cast_speed', 'inc', 4 ) ),
	N( 'Lethality', M( 'crit_chance', 'inc', 40, null, 'killed_recently' ) )
], { weight: 1.5 } );
C( 'crit-multi', 'Ruthlessness', 'crit', { finesse: 2, fs: 2, mf: 1 }, { name: 'Critical Strike Multiplier', mods: [ M( 'crit_multi', 'flat', 6 ) ] }, [
	N( 'Executioner\'s Eye', M( 'crit_multi', 'flat', 20 ), M( 'crit_chance', 'inc', 10 ) ),
	N( 'Coup de Grace', M( 'crit_multi', 'flat', 30, null, 'crit_recently' ) ),
	N( 'Brutal Precision', M( 'crit_multi', 'flat', 15 ), M( 'damage', 'inc', 10, [ 'physical' ] ) )
], { rings: [ 1, 5 ] } );
C( 'dual-wield', 'Twin Blades', 'dual-wield', { finesse: 2, mf: 3 }, { name: 'Dual Wield Damage', mods: [ M( 'damage', 'inc', 10, null, 'dual_wield' ) ] }, [
	N( 'Ambidexterity', M( 'attack_speed', 'inc', 10, null, 'dual_wield' ), M( 'damage', 'inc', 10, null, 'dual_wield' ) ),
	N( 'Whirling Steel', M( 'block_chance', 'flat', 6, null, 'dual_wield' ), M( 'damage', 'inc', 15, null, 'dual_wield' ) ),
	N( 'Twin Terrors', M( 'crit_chance', 'inc', 30, null, 'dual_wield' ), M( 'crit_multi', 'flat', 10, null, 'dual_wield' ) )
], { rings: [ 1, 5 ] } );
C( 'two-handed', 'Heavy Arms', 'two-handed', { might: 3, mf: 2, ms: 1 }, { name: 'Two-Handed Damage', mods: [ M( 'damage', 'inc', 12, null, 'two_handed' ) ] }, [
	N( 'Executioner', M( 'damage', 'inc', 25, null, 'two_handed' ), M( 'crit_multi', 'flat', 10, null, 'two_handed' ) ),
	N( 'Giant Slayer', M( 'damage', 'inc', 20, null, 'two_handed' ), M( 'stun_threshold', 'inc', 20 ) ),
	N( 'Sweeping Arc', M( 'area', 'inc', 15, null, 'two_handed' ), M( 'damage', 'inc', 15, null, 'two_handed' ) ),
	N( 'Unrelenting Force', M( 'attack_speed', 'inc', 8, null, 'two_handed' ), M( 'knockback', 'inc', 30 ) )
], { rings: [ 1, 5 ] } );
C( 'sword-and-board', 'Sword and Board', 'block', { might: 2, ms: 1 }, { name: 'Shield Damage', mods: [ M( 'damage', 'inc', 8, null, 'holding_shield' ), M( 'block_chance', 'flat', 0.5 ) ] }, [
	N( 'Guardian\'s Riposte', M( 'damage', 'inc', 30, null, 'blocked_recently' ), M( 'block_chance', 'flat', 3 ) ),
	N( 'Phalanx', M( 'block_chance', 'flat', 5, null, 'holding_shield' ), M( 'armor', 'inc', 25, null, 'holding_shield' ) ),
	N( 'Shield Bash', M( 'damage', 'inc', 20, [ 'melee' ], 'holding_shield' ), M( 'knockback', 'inc', 30 ) )
], { rings: [ 1, 5 ] } );

// --- weapon masteries ----------------------------------------------------------------------
const WEAPON_THEMES = [
	[ 'sword', 'Swordsmanship', { might: 1, mf: 2, finesse: 1 }, [ N( 'Blade Dancer', M( 'attack_speed', 'inc', 10, null, 'wielding_sword' ), M( 'damage', 'inc', 15, null, 'wielding_sword' ) ), N( 'Duelist\'s Edge', M( 'crit_chance', 'inc', 30, null, 'wielding_sword' ), M( 'life_leech', 'flat', 0.5, [ 'attack' ] ) ), N( 'Riposte', M( 'damage', 'inc', 30, null, 'blocked_recently' ), M( 'block_chance', 'flat', 3, null, 'wielding_sword' ) ) ] ],
	[ 'axe', 'Axe Mastery', { might: 2, mf: 2 }, [ N( 'Cleaver', M( 'damage', 'inc', 25, null, 'wielding_axe' ), M( 'bleed_chance', 'flat', 10 ) ), N( 'Hatchet Master', M( 'attack_speed', 'inc', 10, null, 'wielding_axe' ), M( 'life_on_kill', 'flat', 8 ) ), N( 'Lumberjack', M( 'damage', 'inc', 20, null, 'wielding_axe' ), M( 'area', 'inc', 10, null, 'wielding_axe' ) ) ] ],
	[ 'mace', 'Bludgeoning', { might: 3, ms: 1 }, [ N( 'Skull Cracking', M( 'damage', 'inc', 25, null, 'wielding_mace' ), M( 'stun_threshold', 'inc', 20 ) ), N( 'Earthquake', M( 'area', 'inc', 15, null, 'wielding_mace' ), M( 'damage', 'inc', 15, null, 'wielding_mace' ) ), N( 'Smashing Strikes', M( 'knockback', 'inc', 40 ), M( 'damage', 'inc', 20, [ 'physical' ], 'wielding_mace' ) ) ] ],
	[ 'dagger', 'Knife Work', { finesse: 3, fs: 1 }, [ N( 'Backstabbing', M( 'crit_chance', 'inc', 40, null, 'wielding_dagger' ), M( 'crit_multi', 'flat', 15, null, 'wielding_dagger' ) ), N( 'Poisoned Blades', M( 'poison_chance', 'flat', 15 ), M( 'damage', 'inc', 20, [ 'chaos' ], 'wielding_dagger' ) ), N( 'Flaying', M( 'attack_speed', 'inc', 10, null, 'wielding_dagger' ), M( 'damage', 'inc', 15, null, 'wielding_dagger' ) ) ] ],
	[ 'spear', 'Spear Discipline', { finesse: 2, mf: 2 }, [ N( 'Impaler', M( 'damage', 'inc', 25, null, 'wielding_spear' ), M( 'pen_armor', 'flat', 80 ) ), N( 'Long Reach', M( 'area', 'inc', 15, [ 'melee' ], 'wielding_spear' ), M( 'attack_speed', 'inc', 6, null, 'wielding_spear' ) ), N( 'Javelineer', M( 'damage', 'inc', 20, [ 'projectile' ] ), M( 'damage', 'inc', 15, null, 'wielding_spear' ) ) ] ],
	[ 'staff', 'Staff Mastery', { sorcery: 2, ms: 2 }, [ N( 'Counterweight', M( 'block_chance', 'flat', 6, null, 'wielding_staff' ), M( 'damage', 'inc', 15, null, 'wielding_staff' ) ), N( 'Spinning Weapon', M( 'area', 'inc', 15, null, 'wielding_staff' ), M( 'attack_speed', 'inc', 8, null, 'wielding_staff' ) ), N( 'Arcane Conduit', M( 'damage', 'inc', 30, [ 'spell' ], 'wielding_staff' ), M( 'cast_speed', 'inc', 6, null, 'wielding_staff' ) ) ] ],
	[ 'bow', 'Archery', { finesse: 3, fs: 1 }, [ N( 'Heavy Draw', M( 'damage', 'inc', 25, null, 'wielding_bow' ), M( 'projectile_speed', 'inc', 15 ) ), N( 'Rapid Fire', M( 'attack_speed', 'inc', 12, null, 'wielding_bow' ), M( 'move_speed', 'inc', 3 ) ), N( 'King of the Hill', M( 'damage', 'inc', 30, null, 'stationary' ), M( 'crit_chance', 'inc', 20, null, 'wielding_bow' ) ) ] ],
	[ 'wand', 'Wand Mastery', { sorcery: 2, fs: 2 }, [ N( 'Wandslinger', M( 'attack_speed', 'inc', 12, null, 'wielding_wand' ), M( 'damage', 'inc', 15, null, 'wielding_wand' ) ), N( 'Spellsword\'s Spark', M( 'damage', 'inc', 20, [ 'spell' ], 'wielding_wand' ), M( 'cast_speed', 'inc', 6, null, 'wielding_wand' ) ), N( 'Focused Channel', M( 'crit_chance', 'inc', 35, null, 'wielding_wand' ), M( 'damage', 'inc', 10, null, 'wielding_wand' ) ) ] ]
];
for ( const [ cls, name, regions, notables ] of WEAPON_THEMES ) {

	C( `weapon-${cls}`, name, 'weapon', regions, { name: `${cls[ 0 ].toUpperCase() + cls.slice( 1 )} Damage`, mods: [ M( 'damage', 'inc', 12, null, `wielding_${cls}` ) ] }, notables, { rings: [ 1, 5 ], shapes: [ 'chain', 'fork', 'wheel' ], tags: [ cls ] } );

}

// --- spells, casting, minions ---------------------------------------------------------------
C( 'spell', 'Spellcraft', 'spell', { sorcery: 4, ms: 2, fs: 2 }, { name: 'Spell Damage', mods: [ M( 'damage', 'inc', 10, [ 'spell' ] ) ] }, [
	N( 'Arcane Potency', M( 'damage', 'inc', 25, [ 'spell' ] ), M( 'crit_chance', 'inc', 15, [ 'spell' ] ) ),
	N( 'Sorcery', M( 'damage', 'inc', 20, [ 'spell' ] ), M( 'mana', 'inc', 6 ) ),
	N( 'Spell Echo', M( 'damage', 'inc', 15, [ 'spell' ] ), M( 'cast_speed', 'inc', 8 ) ),
	N( 'Archmage\'s Will', M( 'damage', 'inc', 30, [ 'spell' ], 'full_shield' ), M( 'shield', 'inc', 10 ) ),
	N( 'Spellblade', M( 'damage', 'inc', 15, [ 'spell' ] ), M( 'damage', 'inc', 15, [ 'attack' ] ) )
], { weight: 2 } );
C( 'cast-speed', 'Incantation', 'speed', { sorcery: 3, fs: 1, ms: 1 }, { name: 'Cast Speed', mods: [ M( 'cast_speed', 'inc', 3 ) ] }, [
	N( 'Quick Recovery', M( 'cast_speed', 'inc', 10 ), M( 'mana_regen', 'inc', 15 ) ),
	N( 'Fervour', M( 'cast_speed', 'inc', 8 ), M( 'damage', 'inc', 10, [ 'spell' ] ) ),
	N( 'Mental Agility', M( 'cast_speed', 'inc', 12, null, 'killed_recently' ), M( 'mana_on_kill', 'flat', 4 ) )
], { weight: 1.3 } );
C( 'minion', 'Necromancy', 'minion', { sorcery: 3, ms: 2 }, { name: 'Minion Damage', mods: [ M( 'minion_damage', 'inc', 10 ) ] }, [
	N( 'Death Attunement', M( 'minion_damage', 'inc', 25 ), M( 'minion_life', 'inc', 15 ) ),
	N( 'Gravepact', M( 'minion_life', 'inc', 30 ), M( 'life', 'inc', 4 ) ),
	N( 'Lord of the Dead', M( 'minion_damage', 'inc', 30 ), M( 'skill_level', 'flat', 1, [ 'minion' ] ) ),
	N( 'Commander of Darkness', M( 'minion_damage', 'inc', 20 ), M( 'damage', 'inc', 10 ) )
], { rings: [ 1, 5 ] } );
C( 'duration', 'Persistence', 'utility', { sorcery: 2, ms: 1, fs: 1 }, { name: 'Skill Duration', mods: [ M( 'duration', 'inc', 5 ) ] }, [
	N( 'Lasting Impression', M( 'duration', 'inc', 20 ), M( 'damage', 'inc', 10, [ 'area' ] ) ),
	N( 'Timeless', M( 'duration', 'inc', 15 ), M( 'cooldown_recovery', 'inc', 8 ) ),
	N( 'Inevitability', M( 'duration', 'inc', 15 ), M( 'damage', 'inc', 15, [ 'chaos' ] ) )
], { rings: [ 1, 5 ] } );
C( 'cooldown', 'Quickening', 'utility', { sorcery: 1, fs: 2, mf: 1 }, { name: 'Cooldown Recovery', mods: [ M( 'cooldown_recovery', 'inc', 4 ) ] }, [
	N( 'Restless', M( 'cooldown_recovery', 'inc', 12 ), M( 'move_speed', 'inc', 3 ) ),
	N( 'Tactician', M( 'cooldown_recovery', 'inc', 10 ), M( 'mana_cost', 'inc', - 8 ) ),
	N( 'Unending Rhythm', M( 'cooldown_recovery', 'inc', 15, null, 'killed_recently' ), M( 'attack_speed', 'inc', 5 ) )
], { rings: [ 2, 5 ] } );

// --- ailments ----------------------------------------------------------------------------------
C( 'ignite', 'Immolation', 'fire', { ms: 3, might: 1, sorcery: 1 }, { name: 'Ignite Chance', mods: [ M( 'ignite_chance', 'flat', 3 ) ] }, [
	N( 'Burning Brand', M( 'ignite_chance', 'flat', 10 ), M( 'damage', 'inc', 15, [ 'fire' ] ) ),
	N( 'Everlasting Flame', M( 'ignite_chance', 'flat', 8 ), M( 'duration', 'inc', 15 ) ),
	N( 'Kindling', M( 'ignite_chance', 'flat', 15, null, 'crit_recently' ), M( 'damage', 'inc', 10, [ 'fire' ] ) )
], { rings: [ 1, 5 ] } );
C( 'chill', 'Permafrost', 'cold', { fs: 3, finesse: 1, sorcery: 1 }, { name: 'Chill Chance', mods: [ M( 'chill_chance', 'flat', 4 ) ] }, [
	N( 'Deep Freeze', M( 'freeze_chance', 'flat', 8 ), M( 'damage', 'inc', 15, [ 'cold' ] ) ),
	N( 'Biting Cold', M( 'chill_chance', 'flat', 12 ), M( 'damage', 'inc', 10, [ 'cold' ] ) ),
	N( 'Shatter Point', M( 'freeze_chance', 'flat', 6 ), M( 'crit_chance', 'inc', 20 ) )
], { rings: [ 1, 5 ] } );
C( 'shock', 'Electrocution', 'lightning', { sorcery: 2, fs: 2 }, { name: 'Shock Chance', mods: [ M( 'shock_chance', 'flat', 3 ) ] }, [
	N( 'High Voltage', M( 'shock_chance', 'flat', 12 ), M( 'damage', 'inc', 15, [ 'lightning' ] ) ),
	N( 'Conductivity', M( 'shock_chance', 'flat', 8 ), M( 'pen_lightning', 'flat', 5 ) ),
	N( 'Chain Reaction', M( 'shock_chance', 'flat', 8 ), M( 'chain', 'flat', 1, [ 'lightning' ] ) )
], { rings: [ 1, 5 ] } );
C( 'poison', 'Venomancy', 'chaos', { finesse: 3, fs: 1 }, { name: 'Poison Chance', mods: [ M( 'poison_chance', 'flat', 4 ) ] }, [
	N( 'Virulence', M( 'poison_chance', 'flat', 12 ), M( 'damage', 'inc', 15, [ 'chaos' ] ) ),
	N( 'Toxic Delivery', M( 'poison_chance', 'flat', 10 ), M( 'duration', 'inc', 15 ) ),
	N( 'Noxious Strike', M( 'poison_chance', 'flat', 10, [ 'attack' ] ), M( 'attack_speed', 'inc', 5 ) )
], { rings: [ 1, 5 ] } );
C( 'bleed', 'Haemorrhage', 'physical', { mf: 3, might: 1 }, { name: 'Bleed Chance', mods: [ M( 'bleed_chance', 'flat', 4 ) ] }, [
	N( 'Blood Rite', M( 'bleed_chance', 'flat', 12 ), M( 'damage', 'inc', 15, [ 'physical' ] ) ),
	N( 'Lacerate', M( 'bleed_chance', 'flat', 10 ), M( 'crit_chance', 'inc', 15 ) ),
	N( 'Exsanguinate', M( 'bleed_chance', 'flat', 8 ), M( 'life_leech', 'flat', 0.5, [ 'attack' ] ) )
], { rings: [ 1, 5 ] } );

// --- mobility, flasks, loot, conditions ---------------------------------------------------------
C( 'movement', 'Fleetness', 'movement', { finesse: 3, fs: 2, mf: 2 }, { name: 'Movement Speed', mods: [ M( 'move_speed', 'inc', 2 ) ] }, [
	N( 'Quickstep', M( 'move_speed', 'inc', 6 ), M( 'dodge_cooldown', 'inc', - 10 ) ),
	N( 'Wind Runner', M( 'move_speed', 'inc', 5 ), M( 'evade_chance', 'flat', 3, null, 'moving' ) ),
	N( 'Flash Step', M( 'dodge_distance', 'inc', 20 ), M( 'dodge_cooldown', 'inc', - 12 ) ),
	N( 'Hit and Run', M( 'move_speed', 'inc', 10, null, 'killed_recently' ), M( 'damage', 'inc', 15, null, 'dodged_recently' ) )
], { weight: 1.4 } );
C( 'dodge', 'Tumbling', 'movement', { finesse: 2, mf: 1, fs: 1 }, { name: 'Dodge Cooldown', mods: [ M( 'dodge_cooldown', 'inc', - 4 ) ] }, [
	N( 'Acrobat\'s Grace', M( 'dodge_cooldown', 'inc', - 15 ), M( 'evade_chance', 'inc', 15 ) ),
	N( 'Counterattack', M( 'damage', 'inc', 30, null, 'dodged_recently' ), M( 'crit_chance', 'inc', 20, null, 'dodged_recently' ) ),
	N( 'Roll With It', M( 'damage_taken', 'more', - 8, null, 'dodged_recently' ), M( 'dodge_distance', 'inc', 10 ) )
], { rings: [ 1, 5 ] } );
C( 'flask', 'Alchemy', 'flask', { mf: 2, finesse: 1, might: 1 }, { name: 'Flask Charges', mods: [ M( 'flask_charges_gained', 'inc', 8 ) ] }, [
	N( 'Master Alchemist', M( 'flask_effect', 'inc', 15 ), M( 'flask_duration', 'inc', 15 ) ),
	N( 'Distilled Fury', M( 'damage', 'inc', 20, null, 'flask_active' ), M( 'attack_speed', 'inc', 6, null, 'flask_active' ) ),
	N( 'Tonic Flow', M( 'flask_charges_gained', 'inc', 30 ), M( 'life_regen_pct', 'flat', 1, null, 'flask_active' ) )
], { rings: [ 1, 5 ] } );
C( 'treasure', 'Treasure Hunter', 'loot', { might: 1, finesse: 1, sorcery: 1, ms: 1, mf: 1, fs: 1 }, { name: 'Item Rarity', mods: [ M( 'item_rarity', 'flat', 4 ) ] }, [
	N( 'Fortune Seeker', M( 'item_rarity', 'flat', 15 ), M( 'gold_find', 'flat', 15 ) ),
	N( 'Plunderer', M( 'item_quantity', 'flat', 6 ), M( 'item_rarity', 'flat', 8 ) ),
	N( 'Golden Touch', M( 'gold_find', 'flat', 30 ), M( 'pickup_radius', 'inc', 40 ) ),
	N( 'Scholar\'s Insight', M( 'xp_gain', 'flat', 5 ), M( 'item_rarity', 'flat', 8 ) )
], { weight: 0.6, rings: [ 2, 5 ], shapes: [ 'chain', 'fork' ] } );
C( 'berserker', 'Bloodrage', 'conditional', { might: 2, mf: 2 }, { name: 'Damage on Low Life', mods: [ M( 'damage', 'inc', 10, null, 'low_life' ) ] }, [
	N( 'Berserk', M( 'damage', 'inc', 30, null, 'low_life' ), M( 'attack_speed', 'inc', 10, null, 'low_life' ) ),
	N( 'Deathless Fury', M( 'life_leech', 'flat', 1, [ 'attack' ], 'low_life' ), M( 'damage_taken', 'more', - 8, null, 'low_life' ) ),
	N( 'Defy Death', M( 'life', 'inc', 6 ), M( 'life_regen_pct', 'flat', 2, null, 'low_life' ) )
], { rings: [ 2, 5 ] } );
C( 'pristine', 'Untouchable', 'conditional', { ms: 2, fs: 1, sorcery: 1 }, { name: 'Damage on Full Life', mods: [ M( 'damage', 'inc', 10, null, 'full_life' ) ] }, [
	N( 'Pristine Form', M( 'damage', 'inc', 30, null, 'full_life' ), M( 'crit_chance', 'inc', 20, null, 'full_life' ) ),
	N( 'Unscathed', M( 'damage', 'inc', 20, null, 'not_hit_recently' ), M( 'move_speed', 'inc', 5, null, 'not_hit_recently' ) ),
	N( 'Perfect Poise', M( 'life_regen_pct', 'flat', 1 ), M( 'damage', 'inc', 15, null, 'full_life' ) )
], { rings: [ 2, 5 ] } );
C( 'skirmisher', 'Skirmisher', 'conditional', { finesse: 2, mf: 1, fs: 1 }, { name: 'Damage while Moving', mods: [ M( 'damage', 'inc', 8, null, 'moving' ) ] }, [
	N( 'Running Battle', M( 'damage', 'inc', 25, null, 'moving' ), M( 'move_speed', 'inc', 4 ) ),
	N( 'Kite Master', M( 'damage', 'inc', 20, [ 'projectile' ], 'moving' ), M( 'evade_chance', 'flat', 4, null, 'moving' ) ),
	N( 'Momentum Strikes', M( 'attack_speed', 'inc', 8, null, 'moving' ), M( 'cast_speed', 'inc', 8, null, 'moving' ) )
], { rings: [ 1, 5 ] } );
C( 'slayer', 'Slayer', 'conditional', { might: 1, mf: 2, finesse: 1 }, { name: "Damage if you've Killed Recently", mods: [ M( 'damage', 'inc', 8, null, 'killed_recently' ) ] }, [
	N( 'Bloodlust', M( 'damage', 'inc', 25, null, 'killed_recently' ), M( 'life_on_kill', 'flat', 6 ) ),
	N( 'Reaper\'s Pace', M( 'move_speed', 'inc', 8, null, 'killed_recently' ), M( 'attack_speed', 'inc', 6, null, 'killed_recently' ) ),
	N( 'Carnage', M( 'area', 'inc', 15, null, 'killed_recently' ), M( 'damage', 'inc', 15, [ 'area' ] ) )
], { rings: [ 1, 5 ] } );
C( 'stun', 'Juggernaut', 'armour', { might: 3, ms: 1 }, { name: 'Stun Threshold', mods: [ M( 'stun_threshold', 'inc', 8 ) ] }, [
	N( 'Unflinching', M( 'stun_threshold', 'inc', 30 ), M( 'armor', 'inc', 15 ) ),
	N( 'Battle Hardened', M( 'damage_taken', 'more', - 5, null, 'hit_recently' ), M( 'life', 'inc', 4 ) ),
	N( 'Steadfast', M( 'stun_threshold', 'inc', 25 ), M( 'damage', 'inc', 15, null, 'stationary' ) )
], { rings: [ 1, 5 ] } );
C( 'thorns', 'Bramble', 'armour', { might: 2, mf: 1 }, { name: 'Thorns', mods: [ M( 'thorns', 'flat', 5 ) ] }, [
	N( 'Barbed Hide', M( 'thorns', 'flat', 25 ), M( 'armor', 'inc', 15 ) ),
	N( 'Vengeful Spirit', M( 'thorns', 'flat', 15 ), M( 'damage', 'inc', 20, null, 'hit_recently' ) ),
	N( 'Iron Thorns', M( 'thorns', 'flat', 20 ), M( 'block_chance', 'flat', 2 ) )
], { rings: [ 1, 5 ], weight: 0.8 } );

// --- attributes (big stat clusters near the starts) -------------------------------------------
C( 'str', 'Might of the Titan', 'attribute', { might: 3, ms: 1, mf: 1 }, { name: 'Strength', mods: [ M( 'strength', 'flat', 6 ) ] }, [
	N( 'Titan\'s Strength', M( 'strength', 'inc', 8 ), M( 'life', 'inc', 4 ) ),
	N( 'Raw Power', M( 'strength', 'flat', 20 ), M( 'damage', 'inc', 10, [ 'melee' ] ) )
], { rings: [ 0, 3 ] } );
C( 'dex', 'Grace of the Wind', 'attribute', { finesse: 3, mf: 1, fs: 1 }, { name: 'Dexterity', mods: [ M( 'dexterity', 'flat', 6 ) ] }, [
	N( 'Nimble Fingers', M( 'dexterity', 'inc', 8 ), M( 'attack_speed', 'inc', 4 ) ),
	N( 'Agility', M( 'dexterity', 'flat', 20 ), M( 'evade_chance', 'inc', 10 ) )
], { rings: [ 0, 3 ] } );
C( 'int', 'Mind of the Sage', 'attribute', { sorcery: 3, ms: 1, fs: 1 }, { name: 'Intelligence', mods: [ M( 'intelligence', 'flat', 6 ) ] }, [
	N( 'Brilliance', M( 'intelligence', 'inc', 8 ), M( 'mana', 'inc', 5 ) ),
	N( 'Erudition', M( 'intelligence', 'flat', 20 ), M( 'damage', 'inc', 10, [ 'spell' ] ) )
], { rings: [ 0, 3 ] } );
