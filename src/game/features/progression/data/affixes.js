// Affixes: the random modifiers that make loot interesting. Each affix is a PREFIX or
// a SUFFIX (a rare holds at most 3 of each), rolls on any base whose tags include one
// of the affix's `tags`, and has TIERS unlocked by item level - a level-70 drop can
// roll "+110 to maximum Life", a level-5 drop cannot.
//
//   define( 'affix', {
//     id, affixType: 'prefix' | 'suffix', group, one affix per group per item
//                                                 (not 'kind': define() sets def.kind = 'affix')
//     tags: [ 'helm', 'ring', ... ],              base tags it can roll on (any of)
//     text: '+{0} to maximum Life',               {0} {1} = rolled values
//     stats: [ { stat, type, tags?, when?, negate? } ],   one entry per rolled value
//     tiers: [ { level, ranges: [ [ lo, hi ], ... ], name } ],   lowest level first
//     weight, modTags: [ 'life', 'defence' ], twoHand?: 1.7 } )
//
// `local_*` stats modify the ITEM ITSELF (weapon damage, armour on that piece,
// flask charges) and are resolved by items.js; everything else becomes a stat
// modifier on the player. Tiers are generated from the first and last ranges so
// the whole table stays readable.

import { define } from '../../../core/registry.js';

export const LADDER = [ 1, 8, 16, 25, 35, 46, 58, 70, 82 ];

const GEAR = [ 'helm', 'chest', 'gloves', 'boots', 'shield', 'belt', 'amulet', 'ring' ];
const ARMOUR = [ 'helm', 'chest', 'gloves', 'boots', 'shield' ];
const RES_SLOTS = [ 'helm', 'chest', 'gloves', 'boots', 'shield', 'belt', 'amulet', 'ring', 'quiver', 'focus' ];
const CASTER = [ 'wand', 'staff', 'focus' ];
const MELEE_W = [ 'sword', 'axe', 'mace', 'dagger', 'spear', 'greatsword', 'greataxe', 'maul', 'staff' ];

function lerpRange( a, b, t, geo, dec ) {

	const f = ( x, y ) => {

		const v = geo && x > 0 && y > 0 ? x * Math.pow( y / x, t ) : x + ( y - x ) * t;
		const p = Math.pow( 10, dec );
		return Math.round( v * p ) / p;

	};

	return [ f( a[ 0 ], b[ 0 ] ), f( a[ 1 ], b[ 1 ] ) ];

}

// A( id, kind, text, stats, tags, first ranges, last ranges, opts )
//   first / last: [lo, hi] for one stat, or [ [lo, hi], [lo, hi] ] for several
//   opts: levels (tier unlock levels), names, weight, modTags, geo, dec, twoHand, same, group
function A( id, kind, text, stats, tags, first, last, opts = {} ) {

	const levels = opts.levels || LADDER;
	const multi = Array.isArray( first[ 0 ] );
	const F = multi ? first : [ first ], L = multi ? last : [ last ];
	const n = levels.length;
	const names = opts.names || [];
	const tiers = levels.map( ( level, i ) => {

		const t = n > 1 ? i / ( n - 1 ) : 1;
		return {
			level,
			ranges: F.map( ( f, k ) => lerpRange( f, L[ k ], t, opts.geo, opts.dec ?? 0 ) ),
			name: names.length ? names[ Math.min( names.length - 1, Math.floor( i * names.length / n ) ) ] : null
		};

	} );
	const st = stats.map( ( s ) => typeof s === 'string' ? { stat: s, type: 'flat' } : s );
	return define( 'affix', {
		id, affixType: kind, group: opts.group || id, text, stats: st, tags, tiers, weight: opts.weight ?? 500,
		modTags: opts.modTags || [], twoHand: opts.twoHand ?? 1, same: opts.same ?? false, level: levels[ 0 ]
	} );

}

const S = ( stat, type = 'flat', extra = {} ) => ( { stat, type, ...extra } );

// =====================================================================================
// PREFIXES
// =====================================================================================

// --- life, mana, energy shield ---------------------------------------------------------
A( 'life', 'prefix', '+{0} to maximum Life', [ 'life' ], GEAR, [ 8, 14 ], [ 110, 125 ], { geo: true, weight: 1000, modTags: [ 'life' ], names: [ 'Hale', 'Healthy', 'Sanguine', 'Stalwart', 'Stout', 'Robust', 'Rotund', 'Virile', "Athlete's" ] } );
A( 'life-pct', 'prefix', '{0}% increased maximum Life', [ S( 'life', 'inc' ) ], [ 'chest', 'belt', 'amulet' ], [ 3, 5 ], [ 10, 12 ], { levels: [ 20, 40, 60, 80 ], weight: 250, modTags: [ 'life' ], names: [ 'Vigorous', 'Vital', 'Hearty', 'Colossal' ] } );
A( 'mana', 'prefix', '+{0} to maximum Mana', [ 'mana' ], [ 'helm', 'gloves', 'boots', 'ring', 'amulet', 'belt', ...CASTER ], [ 10, 18 ], [ 80, 95 ], { geo: true, weight: 800, modTags: [ 'mana' ], names: [ 'Beryl', 'Cobalt', 'Azure', 'Sapphire', 'Cerulean', 'Aqua', 'Opalescent', 'Gentian', 'Chalybeous' ] } );
A( 'mana-pct', 'prefix', '{0}% increased maximum Mana', [ S( 'mana', 'inc' ) ], [ 'amulet', 'focus', 'staff' ], [ 6, 10 ], [ 18, 22 ], { levels: [ 10, 30, 50, 70 ], weight: 300, modTags: [ 'mana' ], names: [ 'Clear', 'Lucid', 'Limpid', 'Pellucid' ] } );
A( 'es-global', 'prefix', '+{0} to maximum Energy Shield', [ 'shield' ], [ 'ring', 'amulet', 'belt' ], [ 3, 6 ], [ 38, 45 ], { geo: true, modTags: [ 'defence', 'es' ], names: [ 'Shining', 'Glimmering', 'Glittering', 'Glowing', 'Radiating', 'Pulsing', 'Seething', 'Blazing', 'Scintillating' ] } );
A( 'life-mana', 'prefix', '+{0} to maximum Life, +{1} to maximum Mana', [ 'life', 'mana' ], [ 'amulet', 'ring', 'belt' ], [ [ 10, 15 ], [ 10, 15 ] ], [ [ 50, 60 ], [ 50, 60 ] ], { levels: [ 10, 30, 50, 70 ], weight: 200, modTags: [ 'life', 'mana' ], names: [ 'Hearty', 'Robust', 'Vibrant', 'Radiant' ] } );

// --- local defences (they scale the piece they are on) ------------------------------------
A( 'local-es', 'prefix', '+{0} to maximum Energy Shield', [ 'local_shield' ], [ 'int_armour' ], [ 4, 8 ], [ 60, 70 ], { geo: true, weight: 900, modTags: [ 'defence', 'es' ], names: [ 'Shining', 'Glimmering', 'Glittering', 'Glowing', 'Radiating', 'Pulsing', 'Seething', 'Blazing', 'Scintillating' ] } );
A( 'local-es-inc', 'prefix', '{0}% increased Energy Shield', [ 'local_shield_inc' ], [ 'int_armour' ], [ 11, 28 ], [ 101, 110 ], { weight: 900, modTags: [ 'defence', 'es' ], names: [ 'Protective', 'Strong-Willed', 'Resolute', 'Fearless', 'Dauntless', 'Indomitable', 'Unassailable', 'Unfaltering' ] } );
A( 'local-armor', 'prefix', '+{0} to Armour', [ 'local_armor' ], [ 'str_armour' ], [ 6, 12 ], [ 180, 220 ], { geo: true, weight: 900, modTags: [ 'defence', 'armour' ], names: [ 'Lacquered', 'Studded', 'Ribbed', 'Fortified', 'Plated', 'Carapaced', 'Encased', 'Enveloped', 'Abating' ] } );
A( 'local-armor-inc', 'prefix', '{0}% increased Armour', [ 'local_armor_inc' ], [ 'str_armour' ], [ 11, 28 ], [ 101, 110 ], { weight: 900, modTags: [ 'defence', 'armour' ], names: [ 'Reinforced', 'Layered', 'Lobstered', 'Buttressed', 'Thickened', 'Girded', 'Impregnable', 'Unyielding' ] } );
A( 'local-evasion', 'prefix', '+{0}% to chance to Evade Attacks', [ 'local_evasion' ], [ 'dex_armour' ], [ 0.5, 1 ], [ 4, 5 ], { dec: 1, weight: 900, modTags: [ 'defence', 'evasion' ], names: [ 'Agile', 'Dancer\'s', 'Acrobat\'s', 'Fleet', 'Blurred', 'Phased', 'Vaporous', 'Elusory', 'Adroit' ] } );
A( 'local-evasion-inc', 'prefix', '{0}% increased Evasion', [ 'local_evasion_inc' ], [ 'dex_armour' ], [ 11, 28 ], [ 101, 110 ], { weight: 900, modTags: [ 'defence', 'evasion' ], names: [ "Shade's", "Ghost's", "Spectre's", "Wraith's", "Phantasm's", "Nightmare's", "Mirage's", "Illusion's" ] } );
A( 'local-def-life', 'prefix', '{0}% increased Armour, Evasion and Energy Shield, +{1} to maximum Life', [ 'local_defence_inc', 'life' ], ARMOUR, [ [ 6, 13 ], [ 7, 10 ] ], [ [ 39, 42 ], [ 34, 38 ] ], { levels: [ 1, 18, 30, 44, 60, 78 ], weight: 400, modTags: [ 'defence', 'life' ], names: [ "Oyster's", "Lobster's", "Urchin's", "Nautilus's", "Octopus's", "Crocodile's" ] } );
A( 'local-es-mana', 'prefix', '{0}% increased Energy Shield, +{1} to maximum Mana', [ 'local_shield_inc', 'mana' ], [ 'int_armour' ], [ [ 6, 13 ], [ 11, 15 ] ], [ [ 39, 42 ], [ 33, 36 ] ], { levels: [ 1, 18, 30, 44, 60, 78 ], weight: 400, modTags: [ 'defence', 'es', 'mana' ], names: [ "Acolyte's", "Deacon's", "Priest's", "Bishop's", "Exarch's", "Pontiff's" ] } );
A( 'local-block', 'prefix', '+{0}% Chance to Block', [ 'local_block' ], [ 'shield' ], [ 1, 2 ], [ 6, 8 ], { levels: [ 1, 16, 30, 44, 58, 72 ], weight: 500, modTags: [ 'defence', 'block' ], names: [ 'Steadfast', 'Warded', 'Bastioned', 'Bulwark', 'Rampart', 'Citadel' ] } );
A( 'armor-global', 'prefix', '+{0} to Armour', [ 'armor' ], [ 'belt', 'amulet', 'ring' ], [ 20, 40 ], [ 300, 360 ], { geo: true, levels: [ 1, 16, 30, 46, 62, 80 ], modTags: [ 'defence', 'armour' ], names: [ 'Lacquered', 'Studded', 'Ribbed', 'Fortified', 'Plated', 'Carapaced' ] } );
A( 'evasion-global', 'prefix', '+{0}% to chance to Evade Attacks', [ 'evade_chance' ], [ 'belt', 'amulet', 'ring', 'quiver' ], [ 0.5, 1 ], [ 3, 4 ], { dec: 1, levels: [ 1, 20, 40, 60, 80 ], modTags: [ 'defence', 'evasion' ], names: [ 'Agile', 'Fleet', 'Blurred', 'Phased', 'Vaporous' ] } );

// --- utility prefixes ---------------------------------------------------------------------------
A( 'move-speed', 'prefix', '{0}% increased Movement Speed', [ S( 'move_speed', 'inc' ) ], [ 'boots' ], [ 8, 10 ], [ 30, 32 ], { levels: [ 1, 15, 30, 40, 55, 70, 86 ], weight: 800, modTags: [ 'speed' ], names: [ "Runner's", "Sprinter's", "Stallion's", "Gazelle's", "Cheetah's", "Hellion's", "Tailwind's" ] } );
A( 'rarity-prefix', 'prefix', '{0}% increased Rarity of Items found', [ 'item_rarity' ], [ 'helm', 'boots', 'gloves', 'amulet', 'ring' ], [ 6, 10 ], [ 24, 28 ], { levels: [ 1, 15, 30, 53, 75 ], weight: 300, modTags: [ 'loot' ], names: [ "Magpie's", "Pirate's", "Dragon's", "Treasure Hunter's", "Hoarder's" ] } );
A( 'gold-find', 'prefix', '{0}% increased Gold found', [ 'gold_find' ], [ 'helm', 'gloves', 'belt', 'amulet', 'ring' ], [ 8, 14 ], [ 40, 50 ], { levels: [ 1, 20, 40, 60, 80 ], weight: 300, modTags: [ 'loot' ], names: [ 'Gilded', 'Golden', 'Opulent', "Midas'", "Croesus'" ] } );
A( 'thorns', 'prefix', 'Reflects {0} Physical Damage to Melee Attackers', [ 'thorns' ], [ 'chest', 'shield', 'gloves' ], [ 2, 5 ], [ 60, 80 ], { geo: true, levels: [ 1, 12, 24, 36, 50, 64, 80 ], weight: 300, modTags: [ 'physical', 'defence' ], names: [ 'Thorny', 'Spiny', 'Barbed', 'Pointed', 'Spiked', 'Jagged', 'Bramble' ] } );

// --- weapon damage (local) ------------------------------------------------------------------
A( 'local-phys-inc', 'prefix', '{0}% increased Physical Damage', [ 'local_phys_inc' ], [ 'weapon' ], [ 40, 49 ], [ 170, 179 ], { levels: [ 1, 11, 23, 35, 46, 60, 73, 83 ], weight: 1000, modTags: [ 'damage', 'physical', 'attack' ], names: [ 'Heavy', 'Serrated', 'Wicked', 'Vicious', 'Bloodthirsty', 'Cruel', 'Tyrannical', 'Merciless' ] } );
A( 'local-phys-flat', 'prefix', 'Adds {0} to {1} Physical Damage', [ 'local_phys_min', 'local_phys_max' ], [ 'weapon' ], [ [ 1, 2 ], [ 3, 4 ] ], [ [ 20, 27 ], [ 42, 48 ] ], { geo: true, twoHand: 1.7, weight: 1000, modTags: [ 'damage', 'physical', 'attack' ], names: [ 'Glinting', 'Burnished', 'Polished', 'Honed', 'Gleaming', 'Annealed', 'Razor-sharp', 'Tempered', 'Flaring' ] } );
A( 'local-phys-leech', 'prefix', '{0}% increased Physical Damage, {1}% of Attack Damage Leeched as Life', [ 'local_phys_inc', S( 'life_leech', 'flat', { tags: [ 'attack' ] } ) ], [ 'weapon' ], [ [ 15, 24 ], [ 0.2, 0.3 ] ], [ [ 50, 64 ], [ 0.6, 0.8 ] ], { dec: 1, levels: [ 1, 20, 40, 60, 80 ], weight: 300, modTags: [ 'damage', 'physical', 'life' ], names: [ 'Thirsty', 'Gluttonous', 'Ravenous', 'Insatiable', 'Bloodsucking' ] } );

// --- added elemental / chaos damage ------------------------------------------------------------
const ATTACK_ADD = [ 'weapon', 'quiver', 'ring', 'gloves', 'amulet' ];
const SPELL_ADD = [ 'wand', 'staff', 'focus', 'amulet' ];
const ELEM_NAMES = {
	fire: [ 'Heated', 'Smouldering', 'Smoking', 'Burning', 'Flaming', 'Scorching', 'Incinerating', 'Blasting', 'Cremating' ],
	cold: [ 'Frosted', 'Chilled', 'Icy', 'Frigid', 'Freezing', 'Frozen', 'Glaciated', 'Polar', 'Entombing' ],
	lightning: [ 'Humming', 'Buzzing', 'Snapping', 'Crackling', 'Sparking', 'Arcing', 'Shocking', 'Discharging', 'Electrocuting' ],
	chaos: [ 'Malicious', 'Poisonous', 'Vile', 'Venomous', 'Toxic', 'Corrosive', 'Pestilent', 'Plagued', 'Blighted' ]
};
const ADD_RANGES = {
	fire: [ [ [ 1, 2 ], [ 3, 4 ] ], [ [ 30, 40 ], [ 60, 72 ] ] ],
	cold: [ [ [ 1, 2 ], [ 3, 4 ] ], [ [ 27, 36 ], [ 54, 64 ] ] ],
	lightning: [ [ [ 1, 1 ], [ 3, 6 ] ], [ [ 5, 8 ], [ 110, 125 ] ] ],
	chaos: [ [ [ 1, 2 ], [ 3, 5 ] ], [ [ 22, 30 ], [ 44, 55 ] ] ]
};

for ( const type of [ 'fire', 'cold', 'lightning', 'chaos' ] ) {

	const T = type[ 0 ].toUpperCase() + type.slice( 1 );
	const [ f, l ] = ADD_RANGES[ type ];
	const levels = type === 'chaos' ? [ 8, 16, 25, 35, 46, 58, 70, 82 ] : LADDER;
	A( `added-${type}-attack`, 'prefix', `Adds {0} to {1} ${T} Damage to Attacks`, [ S( `added_${type}_min`, 'flat', { tags: [ 'attack' ] } ), S( `added_${type}_max`, 'flat', { tags: [ 'attack' ] } ) ], ATTACK_ADD, f, l, { geo: true, twoHand: 1.7, levels, weight: 600, modTags: [ 'damage', type, 'attack', type === 'chaos' ? 'chaos' : 'elemental' ], names: ELEM_NAMES[ type ] } );
	A( `added-${type}-spell`, 'prefix', `Adds {0} to {1} ${T} Damage to Spells`, [ S( `added_${type}_min`, 'flat', { tags: [ 'spell' ] } ), S( `added_${type}_max`, 'flat', { tags: [ 'spell' ] } ) ], SPELL_ADD, f, l.map( ( r ) => r.map( ( v ) => Math.round( v * 0.8 ) ) ), { geo: true, twoHand: 1.5, levels, weight: 600, modTags: [ 'damage', type, 'spell', type === 'chaos' ? 'chaos' : 'elemental' ], names: ELEM_NAMES[ type ] } );
	A( `${type}-damage`, 'prefix', `{0}% increased ${T} Damage`, [ S( 'damage', 'inc', { tags: [ type ] } ) ], [ 'weapon', 'amulet', 'ring', 'focus', 'quiver' ], [ 10, 14 ], [ 50, 59 ], { twoHand: 1.5, levels: [ 4, 15, 28, 42, 56, 70, 84 ], weight: 400, modTags: [ 'damage', type ], names: ELEM_NAMES[ type ].slice( 2 ) } );

}

// --- generic damage prefixes ---------------------------------------------------------------------
const DMG = ( id, text, tags, slots, first, last, names, extra = {} ) => A( id, 'prefix', text, [ S( 'damage', 'inc', { tags } ) ], slots, first, last, { weight: 400, modTags: [ 'damage', ...tags ], names, ...extra } );
DMG( 'spell-damage', '{0}% increased Spell Damage', [ 'spell' ], [ ...CASTER, 'amulet' ], [ 10, 19 ], [ 75, 84 ], [ "Apprentice's", "Adept's", "Scholar's", "Professor's", "Occultist's", "Incanter's", 'Glyphic', 'Runic' ], { twoHand: 1.5, levels: [ 1, 11, 23, 35, 46, 60, 73, 83 ], weight: 800 } );
DMG( 'minion-damage', '{0}% increased Minion Damage', [ 'minion' ], [ 'wand', 'focus', 'helm', 'amulet', 'staff' ], [ 10, 14 ], [ 50, 60 ], [ "Baron's", "Viscount's", "Marquess's", "Duke's", "Prince's", "Lord's" ], { levels: [ 4, 18, 32, 48, 64, 80 ] } );
DMG( 'melee-damage', '{0}% increased Melee Damage', [ 'melee' ], [ 'gloves', 'amulet', 'ring', 'belt' ], [ 6, 10 ], [ 28, 32 ], [ "Brawler's", "Fighter's", "Warrior's", "Champion's", "Gladiator's" ], { levels: [ 1, 20, 40, 60, 80 ] } );
DMG( 'projectile-damage', '{0}% increased Projectile Damage', [ 'projectile' ], [ 'quiver', 'bow', 'gloves', 'amulet', 'wand' ], [ 6, 10 ], [ 30, 34 ], [ "Archer's", "Marksman's", "Sharpshooter's", "Deadeye's", "Sniper's" ], { levels: [ 1, 20, 40, 60, 80 ] } );
DMG( 'area-damage', '{0}% increased Area Damage', [ 'area' ], [ 'amulet', 'helm', 'staff', 'maul', 'greataxe' ], [ 6, 10 ], [ 30, 34 ], [ 'Wide', 'Sweeping', 'Expansive', 'Vast', 'Cataclysmic' ], { levels: [ 1, 20, 40, 60, 80 ] } );
DMG( 'physical-damage', '{0}% increased Global Physical Damage', [ 'physical' ], [ 'amulet', 'ring', 'belt', 'gloves' ], [ 8, 12 ], [ 30, 35 ], [ 'Brutal', 'Savage', 'Feral', 'Primal', 'Bestial' ], { levels: [ 4, 22, 40, 58, 76 ] } );
A( 'elemental-attack', 'prefix', '{0}% increased Elemental Damage with Attacks', [ S( 'damage', 'inc', { tags: [ 'attack', 'fire' ] } ), S( 'damage', 'inc', { tags: [ 'attack', 'cold' ] } ), S( 'damage', 'inc', { tags: [ 'attack', 'lightning' ] } ) ], [ 'weapon', 'quiver', 'ring', 'amulet', 'gloves', 'belt' ], [ 5, 10 ], [ 37, 42 ], { same: true, levels: [ 4, 15, 30, 45, 60, 81 ], weight: 400, modTags: [ 'damage', 'elemental', 'attack' ], names: [ 'Catalysing', 'Infusing', 'Empowering', 'Unleashed', 'Overpowering', 'Devastating' ] } );
A( 'damage-moving', 'prefix', '{0}% increased Damage while Moving', [ S( 'damage', 'inc', { when: 'moving' } ) ], [ 'boots', 'gloves', 'amulet' ], [ 10, 14 ], [ 30, 35 ], { levels: [ 10, 35, 60, 85 ], weight: 250, modTags: [ 'damage', 'conditional' ], names: [ 'Rushing', 'Charging', 'Stampeding', 'Unstoppable' ] } );
A( 'damage-full-life', 'prefix', '{0}% increased Damage while on Full Life', [ S( 'damage', 'inc', { when: 'full_life' } ) ], [ 'helm', 'chest', 'amulet' ], [ 12, 16 ], [ 40, 45 ], { levels: [ 10, 40, 70 ], weight: 250, modTags: [ 'damage', 'conditional' ], names: [ 'Pristine', 'Unscathed', 'Untouchable' ] } );
A( 'damage-low-life', 'prefix', '{0}% increased Damage while on Low Life', [ S( 'damage', 'inc', { when: 'low_life' } ) ], [ 'helm', 'ring' ], [ 15, 20 ], [ 45, 50 ], { levels: [ 10, 40, 70 ], weight: 200, modTags: [ 'damage', 'conditional' ], names: [ 'Desperate', 'Cornered', 'Deathless' ] } );

// =====================================================================================
// SUFFIXES
// =====================================================================================

// --- resistances ------------------------------------------------------------------------
const RES_NAMES = {
	fire: [ 'of the Whelpling', 'of the Salamander', 'of the Drake', 'of the Kiln', 'of the Furnace', 'of the Volcano', 'of Magma', 'of Tzteosh' ],
	cold: [ 'of the Inuit', 'of the Seal', 'of the Penguin', 'of the Yeti', 'of the Walrus', 'of the Polar Bear', 'of the Ice', 'of Haast' ],
	lightning: [ 'of the Cloud', 'of the Squall', 'of the Storm', 'of the Thunderhead', 'of the Tempest', 'of the Maelstrom', 'of the Lightning', 'of Ephij' ]
};

for ( const type of [ 'fire', 'cold', 'lightning' ] ) {

	const T = type[ 0 ].toUpperCase() + type.slice( 1 );
	A( `res-${type}`, 'suffix', `+{0}% to ${T} Resistance`, [ `res_${type}` ], RES_SLOTS, [ 6, 11 ], [ 46, 48 ], { levels: [ 1, 12, 24, 36, 48, 60, 72, 84 ], weight: 1000, modTags: [ 'resistance', type ], names: RES_NAMES[ type ] } );
	A( `max-res-${type}`, 'suffix', `+{0}% to maximum ${T} Resistance`, [ `max_res_${type}` ], [ 'shield', 'chest' ], [ 1, 1 ], [ 3, 3 ], { levels: [ 40, 60, 80 ], weight: 120, modTags: [ 'resistance', type ], names: [ 'of Tempering', 'of Hardening', 'of Annealing' ] } );

}

A( 'res-chaos', 'suffix', '+{0}% to Chaos Resistance', [ 'res_chaos' ], RES_SLOTS, [ 5, 10 ], [ 31, 35 ], { levels: [ 16, 30, 44, 56, 68, 81 ], weight: 300, modTags: [ 'resistance', 'chaos' ], names: [ 'of the Lost', 'of Banishment', 'of Eviction', 'of Expulsion', 'of Exile', 'of Bameth' ] } );
A( 'res-all', 'suffix', '+{0}% to all Elemental Resistances', [ 'res_fire', 'res_cold', 'res_lightning' ], [ 'amulet', 'ring', 'shield', 'chest', 'belt' ], [ 3, 5 ], [ 16, 18 ], { same: true, levels: [ 12, 24, 36, 48, 60, 85 ], weight: 300, modTags: [ 'resistance' ], names: [ 'of the Crystal', 'of the Prism', 'of the Kaleidoscope', 'of Variegation', 'of the Rainbow', 'of the Span' ] } );
A( 'res-fire-cold', 'suffix', '+{0}% to Fire and Cold Resistances', [ 'res_fire', 'res_cold' ], [ 'ring', 'amulet', 'belt', 'boots', 'gloves' ], [ 6, 10 ], [ 20, 24 ], { same: true, levels: [ 20, 40, 60, 80 ], weight: 250, modTags: [ 'resistance' ], names: [ 'of Tides', 'of Steam', 'of Mist', 'of the Geyser' ] } );
A( 'res-cold-lightning', 'suffix', '+{0}% to Cold and Lightning Resistances', [ 'res_cold', 'res_lightning' ], [ 'ring', 'amulet', 'belt', 'boots', 'gloves' ], [ 6, 10 ], [ 20, 24 ], { same: true, levels: [ 20, 40, 60, 80 ], weight: 250, modTags: [ 'resistance' ], names: [ 'of Sleet', 'of Hail', 'of the Blizzard', 'of the Aurora' ] } );
A( 'res-fire-lightning', 'suffix', '+{0}% to Fire and Lightning Resistances', [ 'res_fire', 'res_lightning' ], [ 'ring', 'amulet', 'belt', 'boots', 'gloves' ], [ 6, 10 ], [ 20, 24 ], { same: true, levels: [ 20, 40, 60, 80 ], weight: 250, modTags: [ 'resistance' ], names: [ 'of Embers', 'of the Forge', 'of Plasma', 'of the Sun' ] } );
A( 'max-res-all', 'suffix', '+{0}% to all maximum Elemental Resistances', [ 'max_res_fire', 'max_res_cold', 'max_res_lightning' ], [ 'chest', 'shield', 'amulet' ], [ 1, 1 ], [ 2, 2 ], { same: true, levels: [ 70, 86 ], weight: 40, modTags: [ 'resistance' ], names: [ 'of the Bulwark', 'of the Unbroken' ] } );

// --- attributes ----------------------------------------------------------------------------------
const ATTR_SLOTS = [ 'helm', 'chest', 'gloves', 'boots', 'belt', 'amulet', 'ring', 'weapon', 'shield', 'quiver', 'focus' ];
A( 'strength', 'suffix', '+{0} to Strength', [ 'strength' ], ATTR_SLOTS, [ 8, 12 ], [ 51, 55 ], { levels: [ 1, 11, 22, 33, 44, 55, 66, 74, 82 ], weight: 1000, modTags: [ 'attribute' ], names: [ 'of the Brute', 'of the Wrestler', 'of the Bear', 'of the Lion', 'of the Gorilla', 'of the Goliath', 'of the Leviathan', 'of the Titan', 'of the Gods' ] } );
A( 'dexterity', 'suffix', '+{0} to Dexterity', [ 'dexterity' ], ATTR_SLOTS, [ 8, 12 ], [ 51, 55 ], { levels: [ 1, 11, 22, 33, 44, 55, 66, 74, 82 ], weight: 1000, modTags: [ 'attribute' ], names: [ 'of the Mongoose', 'of the Lynx', 'of the Fox', 'of the Falcon', 'of the Panther', 'of the Leopard', 'of the Jaguar', 'of the Phantom', 'of the Wind' ] } );
A( 'intelligence', 'suffix', '+{0} to Intelligence', [ 'intelligence' ], ATTR_SLOTS, [ 8, 12 ], [ 51, 55 ], { levels: [ 1, 11, 22, 33, 44, 55, 66, 74, 82 ], weight: 1000, modTags: [ 'attribute' ], names: [ 'of the Pupil', 'of the Student', 'of the Prodigy', 'of the Augur', 'of the Philosopher', 'of the Sage', 'of the Savant', 'of the Virtuoso', 'of the Genius' ] } );
A( 'all-attributes', 'suffix', '+{0} to all Attributes', [ 'strength', 'dexterity', 'intelligence' ], [ 'amulet', 'ring' ], [ 1, 4 ], [ 33, 35 ], { same: true, levels: [ 1, 11, 22, 33, 44, 55, 66, 77 ], weight: 250, modTags: [ 'attribute' ], names: [ 'of the Clouds', 'of the Sky', 'of the Meteor', 'of the Comet', 'of the Heavens', 'of the Galaxy', 'of the Universe', 'of the Infinite' ] } );
A( 'str-dex', 'suffix', '+{0} to Strength and Dexterity', [ 'strength', 'dexterity' ], [ 'amulet', 'ring', 'belt', 'gloves', 'boots' ], [ 5, 8 ], [ 28, 32 ], { same: true, levels: [ 10, 30, 50, 70 ], weight: 200, modTags: [ 'attribute' ], names: [ 'of the Duelist', 'of the Gladiator', 'of the Champion', 'of the Slayer' ] } );
A( 'dex-int', 'suffix', '+{0} to Dexterity and Intelligence', [ 'dexterity', 'intelligence' ], [ 'amulet', 'ring', 'belt', 'gloves', 'boots' ], [ 5, 8 ], [ 28, 32 ], { same: true, levels: [ 10, 30, 50, 70 ], weight: 200, modTags: [ 'attribute' ], names: [ 'of the Shadow', 'of the Trickster', 'of the Saboteur', 'of the Assassin' ] } );
A( 'int-str', 'suffix', '+{0} to Strength and Intelligence', [ 'strength', 'intelligence' ], [ 'amulet', 'ring', 'belt', 'gloves', 'boots' ], [ 5, 8 ], [ 28, 32 ], { same: true, levels: [ 10, 30, 50, 70 ], weight: 200, modTags: [ 'attribute' ], names: [ 'of the Templar', 'of the Hierophant', 'of the Inquisitor', 'of the Guardian' ] } );

// --- speed, crit, leech ------------------------------------------------------------------------
A( 'local-attack-speed', 'suffix', '{0}% increased Attack Speed', [ 'local_aps_inc' ], [ 'weapon' ], [ 5, 7 ], [ 26, 27 ], { levels: [ 1, 11, 22, 30, 37, 45, 60, 77 ], weight: 800, modTags: [ 'attack', 'speed' ], names: [ 'of Skill', 'of Ease', 'of Mastery', 'of Grace', 'of Fame', 'of Infamy', 'of Celebration', 'of Incision' ] } );
A( 'attack-speed', 'suffix', '{0}% increased Attack Speed', [ S( 'attack_speed', 'inc' ) ], [ 'gloves', 'quiver', 'ring', 'amulet', 'shield' ], [ 5, 7 ], [ 14, 16 ], { levels: [ 1, 15, 30, 45, 60, 76 ], weight: 500, modTags: [ 'attack', 'speed' ], names: [ 'of Skill', 'of Ease', 'of Mastery', 'of Grace', 'of Fame', 'of Infamy' ] } );
A( 'cast-speed', 'suffix', '{0}% increased Cast Speed', [ S( 'cast_speed', 'inc' ) ], [ ...CASTER, 'amulet', 'ring' ], [ 5, 8 ], [ 29, 32 ], { twoHand: 1.5, levels: [ 1, 15, 30, 40, 55, 72, 83 ], weight: 600, modTags: [ 'caster', 'speed' ], names: [ 'of Talent', 'of Nimbleness', 'of Expertise', 'of Legerdemain', 'of Prestidigitation', 'of Sortilege', 'of Finesse' ] } );
A( 'local-crit', 'suffix', '{0}% increased Critical Strike Chance', [ 'local_crit_inc' ], [ 'weapon' ], [ 10, 14 ], [ 35, 38 ], { levels: [ 1, 20, 30, 44, 58, 73 ], weight: 600, modTags: [ 'critical', 'attack' ], names: [ 'of Needling', 'of Stinging', 'of Piercing', 'of Puncturing', 'of Penetrating', 'of Incision' ] } );
A( 'crit-global', 'suffix', '{0}% increased Global Critical Strike Chance', [ S( 'crit_chance', 'inc' ) ], [ 'amulet', 'quiver', 'focus', 'helm', 'ring' ], [ 10, 14 ], [ 38, 42 ], { levels: [ 1, 20, 30, 44, 58, 72 ], weight: 500, modTags: [ 'critical' ], names: [ 'of Menace', 'of Havoc', 'of Disaster', 'of Calamity', 'of Ruin', 'of Unmaking' ] } );
A( 'crit-multi', 'suffix', '+{0}% to Global Critical Strike Multiplier', [ 'crit_multi' ], [ 'weapon', 'amulet', 'gloves', 'quiver', 'ring' ], [ 8, 12 ], [ 35, 38 ], { levels: [ 8, 21, 30, 44, 59, 74 ], weight: 500, modTags: [ 'critical' ], names: [ 'of Ire', 'of Anger', 'of Rage', 'of Fury', 'of Ferocity', 'of Destruction' ] } );
A( 'spell-crit', 'suffix', '{0}% increased Critical Strike Chance for Spells', [ S( 'crit_chance', 'inc', { tags: [ 'spell' ] } ) ], CASTER, [ 10, 19 ], [ 80, 89 ], { twoHand: 1.5, levels: [ 1, 15, 30, 45, 60, 76 ], weight: 500, modTags: [ 'critical', 'caster' ], names: [ 'of Menace', 'of Havoc', 'of Disaster', 'of Calamity', 'of Ruin', 'of Unmaking' ] } );
A( 'life-leech', 'suffix', '{0}% of Attack Damage Leeched as Life', [ S( 'life_leech', 'flat', { tags: [ 'attack' ] } ) ], [ 'weapon', 'gloves', 'ring', 'amulet', 'quiver' ], [ 0.3, 0.5 ], [ 1.2, 1.4 ], { dec: 1, levels: [ 9, 30, 50, 70, 85 ], weight: 400, modTags: [ 'life', 'attack' ], names: [ 'of the Remora', 'of the Lamprey', 'of the Vampire', 'of the Leech', 'of the Gorger' ] } );
A( 'mana-leech', 'suffix', '{0}% of Attack Damage Leeched as Mana', [ S( 'mana_leech', 'flat', { tags: [ 'attack' ] } ) ], [ 'weapon', 'gloves', 'ring', 'amulet' ], [ 0.2, 0.4 ], [ 0.8, 1.0 ], { dec: 1, levels: [ 12, 40, 70 ], weight: 250, modTags: [ 'mana', 'attack' ], names: [ 'of Thirst', 'of Craving', 'of Consumption' ] } );
A( 'life-on-hit', 'suffix', '+{0} Life gained for each Enemy hit by Attacks', [ S( 'life_on_hit', 'flat', { tags: [ 'attack' ] } ) ], [ 'weapon', 'gloves', 'ring', 'amulet', 'quiver' ], [ 2, 3 ], [ 20, 26 ], { geo: true, levels: [ 8, 20, 30, 40, 50, 60, 75 ], weight: 400, modTags: [ 'life', 'attack' ], names: [ 'of Rejuvenation', 'of Restoration', 'of Regrowth', 'of Nourishment', 'of Renewal', 'of Recovery', 'of Revival' ] } );
A( 'life-on-kill', 'suffix', '+{0} Life gained on Kill', [ 'life_on_kill' ], [ 'weapon', 'gloves', 'ring', 'amulet', 'belt' ], [ 3, 6 ], [ 40, 52 ], { geo: true, levels: [ 1, 11, 22, 33, 44, 58, 72 ], weight: 500, modTags: [ 'life' ], names: [ 'of Success', 'of Victory', 'of Triumph', 'of Conquest', 'of Glory', 'of Dominance', 'of Legend' ] } );
A( 'mana-on-kill', 'suffix', '+{0} Mana gained on Kill', [ 'mana_on_kill' ], [ 'weapon', 'gloves', 'ring', 'amulet' ], [ 1, 2 ], [ 10, 14 ], { levels: [ 1, 20, 40, 60, 80 ], weight: 400, modTags: [ 'mana' ], names: [ 'of Absorption', 'of Osmosis', 'of Consumption', 'of Siphoning', 'of Devouring' ] } );
A( 'aspd-killed', 'suffix', "{0}% increased Attack and Cast Speed if you've Killed Recently", [ S( 'attack_speed', 'inc', { when: 'killed_recently' } ), S( 'cast_speed', 'inc', { when: 'killed_recently' } ) ], [ 'gloves', 'amulet', 'weapon', 'ring' ], [ 4, 6 ], [ 12, 15 ], { same: true, levels: [ 12, 40, 70 ], weight: 250, modTags: [ 'speed', 'conditional' ], names: [ 'of Momentum', 'of Frenzy', 'of the Rampage' ] } );
A( 'crit-killed', 'suffix', "{0}% increased Critical Strike Chance if you've Killed Recently", [ S( 'crit_chance', 'inc', { when: 'killed_recently' } ) ], [ 'weapon', 'gloves', 'ring' ], [ 15, 20 ], [ 50, 60 ], { levels: [ 10, 40, 70 ], weight: 250, modTags: [ 'critical', 'conditional' ], names: [ 'of the Hunt', 'of the Kill', 'of the Massacre' ] } );

// --- regeneration --------------------------------------------------------------------------------
A( 'life-regen', 'suffix', 'Regenerates {0} Life per second', [ 'life_regen' ], [ 'helm', 'chest', 'boots', 'gloves', 'belt', 'amulet', 'ring', 'shield' ], [ 1, 2 ], [ 32, 40 ], { geo: true, dec: 1, weight: 600, modTags: [ 'life' ], names: [ 'of the Newt', 'of the Lizard', 'of the Flatworm', 'of the Starfish', 'of the Hydra', 'of the Troll', 'of Ryslatha', 'of the Phoenix', 'of Immortality' ] } );
A( 'life-regen-pct', 'suffix', 'Regenerates {0}% of Life per second', [ 'life_regen_pct' ], [ 'chest', 'amulet', 'belt' ], [ 0.4, 0.6 ], [ 1.4, 1.6 ], { dec: 1, levels: [ 20, 40, 60, 80 ], weight: 200, modTags: [ 'life' ], names: [ 'of Mending', 'of Healing', 'of Recovery', 'of the Undying' ] } );
A( 'regen-not-hit', 'suffix', "Regenerates {0}% of Life per second if you haven't been Hit Recently", [ S( 'life_regen_pct', 'flat', { when: 'not_hit_recently' } ) ], [ 'chest', 'belt', 'helm' ], [ 0.5, 0.8 ], [ 2, 2.5 ], { dec: 1, levels: [ 15, 45, 75 ], weight: 200, modTags: [ 'life', 'conditional' ], names: [ 'of Respite', 'of Repose', 'of Serenity' ] } );
A( 'mana-regen', 'suffix', '{0}% increased Mana Regeneration Rate', [ S( 'mana_regen', 'inc' ) ], [ 'helm', 'ring', 'amulet', 'belt', ...CASTER ], [ 10, 19 ], [ 70, 79 ], { levels: [ 1, 18, 29, 42, 55, 79 ], weight: 500, modTags: [ 'mana' ], names: [ 'of Excitement', 'of Joy', 'of Elation', 'of Bliss', 'of Euphoria', 'of Nirvana' ] } );

// --- ailments and penetration ---------------------------------------------------------------------
const AIL_SLOTS = [ 'weapon', 'ring', 'amulet', 'gloves', 'focus', 'quiver' ];
for ( const [ ail, word, names ] of [
	[ 'ignite', 'Ignite', [ 'of Ignition', 'of Combustion', 'of Conflagration', 'of Immolation' ] ],
	[ 'chill', 'Chill', [ 'of Frost', 'of Rime', 'of Hoarfrost', 'of Permafrost' ] ],
	[ 'shock', 'Shock', [ 'of Static', 'of Voltage', 'of Electrocution', 'of the Thunderbolt' ] ],
	[ 'poison', 'Poison', [ 'of Venom', 'of Toxins', 'of Blight', 'of the Plague' ] ],
	[ 'bleed', 'cause Bleeding', [ 'of Bleeding', 'of Haemorrhage', 'of Exsanguination', 'of the Butcher' ] ]
] ) A( `${ail}-chance`, 'suffix', `+{0}% chance to ${word}`, [ `${ail}_chance` ], AIL_SLOTS, [ 5, 8 ], [ 25, 30 ], { levels: [ 8, 28, 48, 68 ], weight: 350, modTags: [ 'ailment', ail ], names } );
A( 'freeze-chance', 'suffix', '+{0}% chance to Freeze', [ 'freeze_chance' ], AIL_SLOTS, [ 3, 5 ], [ 15, 18 ], { levels: [ 14, 38, 62 ], weight: 250, modTags: [ 'ailment', 'cold' ], names: [ 'of the Glacier', 'of the Ice Age', 'of the Absolute Zero' ] } );
for ( const type of [ 'fire', 'cold', 'lightning' ] ) {

	const T = type[ 0 ].toUpperCase() + type.slice( 1 );
	A( `pen-${type}`, 'suffix', `Damage Penetrates {0}% ${T} Resistance`, [ `pen_${type}` ], [ 'weapon', 'focus', 'amulet' ], [ 3, 4 ], [ 10, 12 ], { levels: [ 30, 50, 70, 85 ], weight: 200, modTags: [ 'damage', type ], names: [ 'of Piercing', 'of Boring', 'of Drilling', 'of Puncturing' ].map( ( n ) => `${n} ${T}` ) } );

}

A( 'pen-armor', 'suffix', 'Hits ignore {0} of enemy Armour', [ 'pen_armor' ], [ 'weapon', 'gloves' ], [ 10, 20 ], [ 200, 300 ], { geo: true, levels: [ 10, 30, 50, 70, 85 ], weight: 250, modTags: [ 'damage', 'physical' ], names: [ 'of Sundering', 'of Shattering', 'of Breaching', 'of Rending', 'of Annihilation' ] } );

// --- projectiles, area, duration, cooldown, cost ---------------------------------------------------
A( 'pierce', 'suffix', 'Projectiles Pierce {0} additional Targets', [ 'pierce' ], [ 'quiver', 'bow', 'wand' ], [ 1, 1 ], [ 2, 2 ], { levels: [ 20, 60 ], weight: 250, modTags: [ 'projectile' ], names: [ 'of Skewering', 'of Impaling' ] } );
A( 'projectile-count', 'suffix', '+{0} Projectile', [ 'projectile_count' ], [ 'bow', 'quiver', 'wand' ], [ 1, 1 ], [ 1, 1 ], { levels: [ 50 ], weight: 60, modTags: [ 'projectile' ], names: [ 'of Splintering' ] } );
A( 'projectile-speed', 'suffix', '{0}% increased Projectile Speed', [ S( 'projectile_speed', 'inc' ) ], [ 'bow', 'quiver', 'wand', 'amulet' ], [ 10, 17 ], [ 42, 46 ], { levels: [ 1, 14, 28, 42, 56, 74 ], weight: 400, modTags: [ 'projectile', 'speed' ], names: [ 'of Darting', 'of Flight', 'of Propulsion', 'of the Zephyr', 'of the Gale', 'of the Hurricane' ] } );
A( 'area', 'suffix', '{0}% increased Area of Effect', [ S( 'area', 'inc' ) ], [ 'amulet', 'helm', 'staff', 'maul', 'greatsword', 'focus' ], [ 6, 8 ], [ 18, 20 ], { levels: [ 10, 30, 50, 70 ], weight: 300, modTags: [ 'area' ], names: [ 'of Reach', 'of Breadth', 'of Expanse', 'of the Horizon' ] } );
A( 'duration', 'suffix', '{0}% increased Skill Effect Duration', [ S( 'duration', 'inc' ) ], [ 'amulet', 'helm', 'focus', 'staff', 'belt' ], [ 6, 10 ], [ 24, 28 ], { levels: [ 10, 30, 50, 70 ], weight: 250, modTags: [ 'duration' ], names: [ 'of Lingering', 'of Persistence', 'of Endurance', 'of Eternity' ] } );
A( 'cooldown', 'suffix', '{0}% increased Cooldown Recovery Rate', [ S( 'cooldown_recovery', 'inc' ) ], [ 'helm', 'amulet', 'belt', 'focus' ], [ 4, 6 ], [ 16, 18 ], { levels: [ 16, 36, 56, 76 ], weight: 250, modTags: [ 'speed' ], names: [ 'of Readiness', 'of Alacrity', 'of Haste', 'of the Instant' ] } );
A( 'mana-cost', 'suffix', '{0}% reduced Mana Cost of Skills', [ S( 'mana_cost', 'inc', { negate: true } ) ], [ 'amulet', 'ring', 'helm', ...CASTER ], [ 4, 6 ], [ 14, 16 ], { levels: [ 10, 30, 50, 70 ], weight: 300, modTags: [ 'mana' ], names: [ 'of Thrift', 'of Economy', 'of Frugality', 'of Austerity' ] } );

// --- +skill levels -----------------------------------------------------------------------------
for ( const [ tag, word, slots, levels ] of [
	[ 'melee', 'Melee', [ 'amulet', 'gloves', ...MELEE_W ], [ 25, 75 ] ],
	[ 'spell', 'Spell', [ 'amulet', 'helm', ...CASTER ], [ 25, 75 ] ],
	[ 'projectile', 'Projectile', [ 'amulet', 'bow', 'quiver', 'wand' ], [ 25, 75 ] ],
	[ 'fire', 'Fire', [ 'amulet', ...CASTER ], [ 30, 80 ] ],
	[ 'cold', 'Cold', [ 'amulet', ...CASTER ], [ 30, 80 ] ],
	[ 'lightning', 'Lightning', [ 'amulet', ...CASTER ], [ 30, 80 ] ],
	[ 'chaos', 'Chaos', [ 'amulet', ...CASTER ], [ 30, 80 ] ],
	[ 'minion', 'Minion', [ 'helm', 'amulet', 'wand', 'focus' ], [ 30, 80 ] ]
] ) A( `skill-${tag}`, 'suffix', `+{0} to Level of all ${word} Skills`, [ S( 'skill_level', 'flat', { tags: [ tag ] } ) ], slots, [ 1, 1 ], [ 2, 2 ], { levels, weight: 90, modTags: [ 'skill', tag ], names: [ `of the ${word}master`, `of the ${word} Grandmaster` ] } );
A( 'skill-all', 'suffix', '+{0} to Level of all Skills', [ 'skill_level' ], [ 'amulet' ], [ 1, 1 ], [ 1, 1 ], { levels: [ 60 ], weight: 20, modTags: [ 'skill' ], names: [ 'of the Polymath' ] } );

// --- defence suffixes ---------------------------------------------------------------------------
A( 'stun-threshold', 'suffix', '{0}% increased Stun Threshold', [ S( 'stun_threshold', 'inc' ) ], [ 'belt', 'chest', 'shield' ], [ 10, 14 ], [ 30, 35 ], { levels: [ 5, 25, 45, 65 ], weight: 300, modTags: [ 'defence' ], names: [ 'of Composure', 'of Steadiness', 'of Poise', 'of the Mountain' ] } );
A( 'phys-taken', 'suffix', '{0}% less Physical Damage taken', [ S( 'damage_taken', 'more', { tags: [ 'physical' ], negate: true } ) ], [ 'chest', 'shield' ], [ 2, 3 ], [ 6, 8 ], { levels: [ 30, 60, 80 ], weight: 150, modTags: [ 'defence', 'physical' ], names: [ 'of the Turtle', 'of the Tortoise', 'of the Ironhide' ] } );
A( 'block-global', 'suffix', '+{0}% Chance to Block', [ 'block_chance' ], [ 'amulet', 'belt', 'gloves' ], [ 1, 2 ], [ 4, 5 ], { levels: [ 20, 50, 80 ], weight: 150, modTags: [ 'defence', 'block' ], names: [ 'of Deflection', 'of Parrying', 'of the Bulwark' ] } );
A( 'evade-moving', 'suffix', '+{0}% chance to Evade Attacks while Moving', [ S( 'evade_chance', 'flat', { when: 'moving' } ) ], [ 'boots', 'chest' ], [ 2, 3 ], [ 8, 10 ], { levels: [ 8, 40, 72 ], weight: 250, modTags: [ 'defence', 'evasion', 'conditional' ], names: [ 'of the Breeze', 'of the Gust', 'of the Squall' ] } );
A( 'armor-stationary', 'suffix', '{0}% increased Armour while Stationary', [ S( 'armor', 'inc', { when: 'stationary' } ) ], [ 'chest', 'helm', 'boots' ], [ 20, 30 ], [ 60, 80 ], { levels: [ 8, 40, 72 ], weight: 250, modTags: [ 'defence', 'armour', 'conditional' ], names: [ 'of the Rock', 'of the Boulder', 'of the Bedrock' ] } );
A( 'ms-low-life', 'suffix', '{0}% increased Movement Speed while on Low Life', [ S( 'move_speed', 'inc', { when: 'low_life' } ) ], [ 'boots' ], [ 8, 10 ], [ 20, 25 ], { levels: [ 10, 40, 70 ], weight: 250, modTags: [ 'speed', 'conditional' ], names: [ 'of Escape', 'of Flight', 'of the Fugitive' ] } );

// --- loot and utility ---------------------------------------------------------------------------
A( 'rarity-suffix', 'suffix', '{0}% increased Rarity of Items found', [ 'item_rarity' ], [ 'helm', 'boots', 'gloves', 'amulet', 'ring' ], [ 6, 10 ], [ 18, 22 ], { levels: [ 3, 30, 53, 75 ], weight: 300, modTags: [ 'loot' ], names: [ 'of Plunder', 'of Raiding', 'of Archaeology', 'of Excavation' ] } );
A( 'quantity', 'suffix', '{0}% increased Quantity of Items found', [ 'item_quantity' ], [ 'amulet', 'ring', 'helm', 'boots' ], [ 3, 5 ], [ 10, 12 ], { levels: [ 20, 50, 80 ], weight: 80, modTags: [ 'loot' ], names: [ 'of Collecting', 'of Gathering', 'of Hoarding' ] } );
A( 'xp-gain', 'suffix', '{0}% increased Experience gained', [ 'xp_gain' ], [ 'amulet' ], [ 2, 3 ], [ 5, 6 ], { levels: [ 30, 70 ], weight: 50, modTags: [ 'loot' ], names: [ 'of Learning', 'of Wisdom' ] } );
A( 'pickup-radius', 'suffix', '{0}% increased Pickup Radius', [ S( 'pickup_radius', 'inc' ) ], [ 'boots', 'belt', 'gloves', 'amulet' ], [ 20, 30 ], [ 60, 80 ], { levels: [ 1, 30, 60 ], weight: 250, modTags: [ 'loot' ], names: [ 'of the Magnet', 'of Attraction', 'of the Lodestone' ] } );
A( 'dodge-cooldown', 'suffix', '{0}% reduced Dodge Roll Cooldown', [ S( 'dodge_cooldown', 'inc', { negate: true } ) ], [ 'boots' ], [ 5, 8 ], [ 18, 22 ], { levels: [ 10, 35, 60, 80 ], weight: 400, modTags: [ 'speed', 'dodge' ], names: [ 'of Evasion', 'of Tumbling', 'of the Acrobat', 'of the Wraith' ] } );
A( 'dodge-distance', 'suffix', '{0}% increased Dodge Roll Distance', [ S( 'dodge_distance', 'inc' ) ], [ 'boots', 'belt' ], [ 6, 10 ], [ 20, 25 ], { levels: [ 5, 40, 75 ], weight: 300, modTags: [ 'dodge' ], names: [ 'of the Leap', 'of the Bound', 'of the Vault' ] } );
A( 'minion-life', 'suffix', '{0}% increased Minion Life', [ S( 'minion_life', 'inc' ) ], [ 'helm', 'focus', 'amulet', 'wand', 'belt' ], [ 10, 14 ], [ 35, 40 ], { levels: [ 8, 30, 55, 80 ], weight: 250, modTags: [ 'minion' ], names: [ 'of the Master', 'of the Overseer', 'of the Warden', 'of the Necromancer' ] } );
A( 'knockback', 'suffix', '{0}% increased Knockback Distance', [ S( 'knockback', 'inc' ) ], [ 'mace', 'maul', 'gloves', 'staff' ], [ 10, 15 ], [ 30, 40 ], { levels: [ 1, 30, 60 ], weight: 250, modTags: [ 'physical' ], names: [ 'of Shoving', 'of Battering', 'of the Ram' ] } );
A( 'flask-charges', 'suffix', '{0}% increased Flask Charges gained', [ S( 'flask_charges_gained', 'inc' ) ], [ 'belt' ], [ 10, 15 ], [ 30, 40 ], { levels: [ 5, 30, 60 ], weight: 400, modTags: [ 'flask' ], names: [ 'of Refilling', 'of Replenishing', 'of Overflowing' ] } );
A( 'flask-effect', 'suffix', '{0}% increased Effect of Flasks', [ S( 'flask_effect', 'inc' ) ], [ 'belt' ], [ 4, 6 ], [ 12, 15 ], { levels: [ 30, 60, 85 ], weight: 250, modTags: [ 'flask' ], names: [ 'of the Alchemist', 'of the Distiller', 'of the Transmuter' ] } );
A( 'flask-duration', 'suffix', '{0}% increased Flask Effect Duration', [ S( 'flask_duration', 'inc' ) ], [ 'belt' ], [ 6, 10 ], [ 20, 25 ], { levels: [ 10, 40, 70 ], weight: 300, modTags: [ 'flask' ], names: [ 'of Savouring', 'of Lingering Taste', 'of the Long Draught' ] } );

// =====================================================================================
// FLASK AFFIXES (local to the flask; `flask_buff` stats apply only during its effect)
// =====================================================================================

const FB = ( stat, type = 'flat', tags ) => ( { stat, type, tags, flaskBuff: true } );
A( 'flask-max-charges', 'prefix', '{0}% increased Charges', [ 'local_flask_max_inc' ], [ 'flask' ], [ 20, 30 ], [ 50, 60 ], { levels: [ 1, 30, 60 ], names: [ 'Ample', 'Plentiful', 'Bountiful' ] } );
A( 'flask-charges-used', 'prefix', '{0}% reduced Charges per use', [ S( 'local_flask_use_inc', 'flat', { negate: true } ) ], [ 'flask' ], [ 10, 15 ], [ 20, 25 ], { levels: [ 1, 30, 60 ], names: [ "Chemist's", "Apothecary's", "Alchemist's" ] } );
A( 'flask-potency', 'prefix', '{0}% increased Effect', [ 'local_flask_effect' ], [ 'flask' ], [ 10, 15 ], [ 25, 30 ], { levels: [ 10, 40, 70 ], names: [ 'Potent', 'Concentrated', 'Saturated' ] } );
A( 'flask-instant', 'prefix', 'Recovers {0}% of the amount instantly', [ 'local_flask_instant' ], [ 'life_flask', 'mana_flask' ], [ 20, 30 ], [ 50, 60 ], { levels: [ 5, 30, 60 ], names: [ 'Bubbling', 'Seething', 'Catalysed' ] } );
A( 'flask-recharge', 'suffix', '{0}% increased Charge Recovery', [ 'local_flask_gain' ], [ 'flask' ], [ 20, 30 ], [ 50, 60 ], { levels: [ 1, 30, 60 ], names: [ 'of the Abundant', 'of the Plenty', 'of the Bounty' ] } );
A( 'flask-speed', 'suffix', '{0}% increased Movement Speed during Effect', [ FB( 'move_speed', 'inc' ) ], [ 'flask' ], [ 6, 8 ], [ 12, 14 ], { levels: [ 5, 35, 65 ], names: [ 'of Adrenaline', 'of the Cheetah', 'of the Gale' ] } );
A( 'flask-armor', 'suffix', '{0}% increased Armour during Effect', [ FB( 'armor', 'inc' ) ], [ 'flask' ], [ 40, 50 ], [ 80, 100 ], { levels: [ 5, 35, 65 ], names: [ 'of Iron Skin', 'of Reinforced Skin', 'of Stone Skin' ] } );
A( 'flask-damage', 'suffix', '{0}% increased Damage during Effect', [ FB( 'damage', 'inc' ) ], [ 'flask' ], [ 10, 15 ], [ 25, 30 ], { levels: [ 8, 38, 68 ], names: [ 'of Fury', 'of Wrath', 'of the Rampage' ] } );
A( 'flask-resist', 'suffix', '+{0}% to all Elemental Resistances during Effect', [ FB( 'res_fire' ), FB( 'res_cold' ), FB( 'res_lightning' ) ], [ 'flask' ], [ 10, 15 ], [ 25, 30 ], { same: true, levels: [ 8, 38, 68 ], names: [ 'of Warding', 'of Shielding', 'of the Aegis' ] } );
A( 'flask-leech', 'suffix', '{0}% of Damage Leeched as Life during Effect', [ FB( 'life_leech' ) ], [ 'flask' ], [ 0.5, 0.8 ], [ 1.5, 2 ], { dec: 1, levels: [ 12, 42, 72 ], names: [ 'of Bloodlust', 'of the Leech', 'of the Vampire' ] } );
