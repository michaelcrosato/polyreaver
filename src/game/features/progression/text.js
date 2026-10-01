// Human-readable text for stat modifiers. Items, passive nodes, keystones, flasks and
// the character sheet all describe themselves with the same mod objects that the
// stat engine consumes ( { stat, type, value, tags, when } ), so ONE formatter turns
// any of them into PoE-style lines:
//
//   { stat: 'life', type: 'flat', value: 40 }                       "+40 to maximum Life"
//   { stat: 'damage', type: 'inc', value: 12, tags: [ 'fire' ] }    "12% increased Fire Damage"
//   { stat: 'attack_speed', type: 'inc', value: 8, when: 'moving' } "8% increased Attack Speed while Moving"
//
// A def can always override the generated line with its own `text`.

export const RARITY_COLORS = {
	normal: '#e8e8e8', magic: '#8fb0ff', rare: '#ffe066', unique: '#ff9a3c',
	currency: '#e0cf9f', rune: '#6fe0c8', gold: '#ffd34d', flask: '#e8e8e8'
};

export const RARITY_NAMES = { normal: 'Normal', magic: 'Magic', rare: 'Rare', unique: 'Unique' };

// stat id -> noun used in lines. `pct: true` stats are already percentages, so a
// flat mod reads "+12% to X" instead of "+12 to X".
export const STATS = {
	life: { name: 'maximum Life' },
	mana: { name: 'maximum Mana' },
	shield: { name: 'maximum Energy Shield' },
	life_regen: { name: 'Life Regenerated per second', flatText: 'Regenerates {0} Life per second' },
	life_regen_pct: { name: 'of Life Regenerated per second', pct: true, plain: true },
	mana_regen: { name: 'Mana Regenerated per second', incName: 'Mana Regeneration Rate', flatText: 'Regenerates {0} Mana per second' },
	mana_regen_pct: { name: 'of Mana Regenerated per second', pct: true, plain: true },
	move_speed: { name: 'Movement Speed' },
	attack_speed: { name: 'Attack Speed' },
	cast_speed: { name: 'Cast Speed' },
	damage: { name: 'Damage' },
	crit_chance: { name: 'Critical Strike Chance', pct: true },
	crit_multi: { name: 'Critical Strike Multiplier', pct: true },
	area: { name: 'Area of Effect' },
	projectile_count: { name: 'additional Projectiles', plain: true },
	projectile_speed: { name: 'Projectile Speed' },
	pierce: { name: 'additional Pierce', plain: true },
	chain: { name: 'additional Chain', plain: true },
	duration: { name: 'Skill Effect Duration' },
	cooldown_recovery: { name: 'Cooldown Recovery Rate' },
	mana_cost: { name: 'Mana Cost of Skills' },
	armor: { name: 'Armour' },
	evade_chance: { name: 'chance to Evade Attacks', pct: true, incName: 'Evasion', flatText: '+{0}% chance to Evade Attacks' },
	block_chance: { name: 'Chance to Block', pct: true, flatText: '+{0}% Chance to Block' },
	damage_taken: { name: 'Damage taken' },
	life_leech: { name: 'of Damage Leeched as Life', pct: true, plain: true },
	mana_leech: { name: 'of Damage Leeched as Mana', pct: true, plain: true },
	life_on_hit: { name: 'Life gained for each Enemy hit', flatText: '+{0} Life gained for each Enemy hit' },
	life_on_kill: { name: 'Life gained on Kill', flatText: '+{0} Life gained on Kill' },
	mana_on_kill: { name: 'Mana gained on Kill', flatText: '+{0} Mana gained on Kill' },
	thorns: { name: 'Thorns', flatText: 'Reflects {0} Physical Damage to Melee Attackers' },
	knockback: { name: 'Knockback' },
	stun_threshold: { name: 'Stun Threshold' },
	pickup_radius: { name: 'Pickup Radius' },
	// additive percentages with no base: a flat +15 reads "15% increased ..."
	item_rarity: { name: 'Rarity of Items found', pct: true, flatText: '{0}% increased Rarity of Items found' },
	item_quantity: { name: 'Quantity of Items found', pct: true, flatText: '{0}% increased Quantity of Items found' },
	gold_find: { name: 'Gold found', pct: true, flatText: '{0}% increased Gold found' },
	xp_gain: { name: 'Experience gained', pct: true, flatText: '{0}% increased Experience gained' },
	dodge_cooldown: { name: 'Dodge Roll Cooldown' },
	dodge_distance: { name: 'Dodge Roll Distance' },
	strength: { name: 'Strength' },
	dexterity: { name: 'Dexterity' },
	intelligence: { name: 'Intelligence' },
	minion_damage: { name: 'Minion Damage' },
	minion_life: { name: 'Minion Life' },
	skill_level: { name: 'Level of Skills', plain: true },
	flask_charges_gained: { name: 'Flask Charges gained' },
	flask_effect: { name: 'Effect of Flasks' },
	flask_duration: { name: 'Flask Effect Duration' },
	status_duration_taken: { name: 'Duration of Ailments on you' },
	ignite_chance: { name: 'chance to Ignite', pct: true, flatText: '+{0}% chance to Ignite' },
	chill_chance: { name: 'chance to Chill', pct: true, flatText: '+{0}% chance to Chill' },
	freeze_chance: { name: 'chance to Freeze', pct: true, flatText: '+{0}% chance to Freeze' },
	shock_chance: { name: 'chance to Shock', pct: true, flatText: '+{0}% chance to Shock' },
	poison_chance: { name: 'chance to Poison', pct: true, flatText: '+{0}% chance to Poison' },
	bleed_chance: { name: 'chance to cause Bleeding', pct: true, flatText: '+{0}% chance to cause Bleeding' }
};

for ( const t of [ 'physical', 'fire', 'cold', 'lightning', 'chaos' ] ) {

	const T = cap( t );
	STATS[ 'res_' + t ] = { name: `${T} Resistance`, pct: true };
	STATS[ 'max_res_' + t ] = { name: `maximum ${T} Resistance`, pct: true };
	STATS[ 'pen_' + t ] = { name: `${T} Resistance Penetration`, pct: true, flatText: `Damage Penetrates {0}% ${T} Resistance` };
	STATS[ `added_${t}_min` ] = { name: `minimum added ${T} Damage` };
	STATS[ `added_${t}_max` ] = { name: `maximum added ${T} Damage` };

}

STATS.pen_armor = { name: 'Armour ignored by your Hits', flatText: 'Hits ignore {0} of enemy Armour' };

// conditions set by the progression mechanics system ( mechanics.js ) - see FLAG_DOCS there
export const WHEN_TEXT = {
	moving: 'while Moving', stationary: 'while Stationary', low_life: 'while on Low Life', full_life: 'while on Full Life',
	low_mana: 'while on Low Mana', full_shield: 'while on Full Energy Shield', killed_recently: "if you've Killed Recently",
	crit_recently: "if you've Crit Recently", hit_recently: "if you've been Hit Recently", not_hit_recently: "if you haven't been Hit Recently",
	dodged_recently: "if you've Dodged Recently", blocked_recently: "if you've Blocked Recently", flask_active: 'during any Flask Effect',
	near_enemy: 'while an Enemy is Nearby', dual_wield: 'while Dual Wielding', two_handed: 'while wielding a Two-Handed Weapon',
	holding_shield: 'while holding a Shield', unarmed: 'while Unarmed', wielding_sword: 'with Swords', wielding_axe: 'with Axes',
	wielding_mace: 'with Maces', wielding_dagger: 'with Daggers', wielding_spear: 'with Spears', wielding_staff: 'with Staves',
	wielding_bow: 'with Bows', wielding_wand: 'with Wands', in_town: 'in Town'
};

// Hit tags -> words, in the order they read best ("Melee Physical Damage").
const TAG_WORDS = {
	attack: 'Attack', spell: 'Spell', melee: 'Melee', projectile: 'Projectile', area: 'Area', minion: 'Minion',
	physical: 'Physical', fire: 'Fire', cold: 'Cold', lightning: 'Lightning', chaos: 'Chaos', elemental: 'Elemental',
	dot: 'Damage over Time', movement: 'Movement', buff: 'Buff', bow: 'Bow'
};
const TAG_ORDER = [ 'melee', 'projectile', 'area', 'minion', 'attack', 'spell', 'physical', 'fire', 'cold', 'lightning', 'chaos', 'elemental', 'dot', 'movement', 'buff', 'bow' ];

export function cap( s ) {

	return s ? s[ 0 ].toUpperCase() + s.slice( 1 ) : s;

}

export function fmt( v ) {

	const a = Math.abs( v );
	if ( a >= 100 || Number.isInteger( v ) ) return String( Math.round( v ) );
	if ( a >= 10 ) return String( Math.round( v * 10 ) / 10 );
	return String( Math.round( v * 100 ) / 100 );

}

function subject( m ) {

	const s = STATS[ m.stat ];
	// 'sk:<skill>' tags (support gems scope mods to one skill) are not shown
	const tags = ( m.tags || [] ).filter( ( t ) => ! t.startsWith( 'sk:' ) ).sort( ( a, b ) => TAG_ORDER.indexOf( a ) - TAG_ORDER.indexOf( b ) );
	if ( m.stat === 'damage' ) {

		if ( ! tags.length ) return 'Damage';
		if ( tags.length === 1 && tags[ 0 ] === 'attack' ) return 'Attack Damage';
		return tags.map( ( t ) => TAG_WORDS[ t ] || cap( t ) ).join( ' ' ) + ' Damage';

	}

	if ( m.stat === 'skill_level' ) return `Level of all ${tags.length ? tags.map( ( t ) => TAG_WORDS[ t ] || cap( t ) ).join( ' ' ) + ' ' : ''}Skills`;
	let name = ( m.type === 'inc' || m.type === 'more' ) && s?.incName ? s.incName : s?.name ?? m.stat.replace( /_/g, ' ' );
	if ( tags.length ) {

		const t = tags.map( ( x ) => TAG_WORDS[ x ] || cap( x ) ).join( ' ' );
		name += tags.includes( 'attack' ) && tags.length === 1 ? ' with Attacks' : tags.includes( 'spell' ) && tags.length === 1 ? ' for Spells' : ` (${t})`;

	}

	return name;

}

// One mod -> one line. Pairs of added min/max are merged by modsToLines().
export function modLine( m ) {

	if ( m.text ) return m.text;
	const s = STATS[ m.stat ] || {};
	const v = m.value;
	const what = subject( m );
	let line;
	switch ( m.type ) {

		case 'flat':
			if ( s.flatText && ! m.tags?.length ) line = s.flatText.replace( '{0}', fmt( v ) );
			else if ( m.stat === 'skill_level' ) line = `+${fmt( v )} to ${what}`;
			else if ( m.stat === 'projectile_count' || m.stat === 'pierce' || m.stat === 'chain' ) line = `${v >= 0 ? '+' : ''}${fmt( v )} ${what}`;
			else if ( s.plain ) line = `${fmt( v )}${s.pct ? '%' : ''} ${what}`;
			else line = `${v >= 0 ? '+' : ''}${fmt( v )}${s.pct ? '%' : ''} to ${what}`;
			break;
		case 'inc': line = `${fmt( Math.abs( v ) )}% ${v >= 0 ? 'increased' : 'reduced'} ${what}`; break;
		case 'more': line = `${fmt( Math.abs( v ) )}% ${v >= 0 ? 'more' : 'less'} ${what}`; break;
		case 'override': line = `${cap( what )} is ${fmt( v )}${s.pct ? '%' : ''}`; break;
		default: line = what;

	}

	if ( m.when ) line += ' ' + ( WHEN_TEXT[ m.when ] || `while ${m.when.replace( /_/g, ' ' )}` );
	return line;

}

// A list of mods -> display lines, merging "added X min" + "added X max" into
// "Adds 3 to 7 Fire Damage to Attacks".
export function modsToLines( mods ) {

	const out = [];
	for ( let i = 0; i < mods.length; i ++ ) {

		const m = mods[ i ];
		const pair = /^added_(\w+)_min$/.exec( m.stat );
		const n = mods[ i + 1 ];
		if ( pair && ! m.text && n && n.stat === `added_${pair[ 1 ]}_max` && ( n.tags || [] ).join() === ( m.tags || [] ).join() && n.when === m.when ) {

			out.push( addedLine( pair[ 1 ], m.value, n.value, m.tags, m.when ) );
			i ++;
			continue;

		}

		out.push( modLine( m ) );

	}

	return out;

}

export function addedLine( type, lo, hi, tags = [], when = null ) {

	const to = tags?.includes( 'spell' ) ? ' to Spells' : tags?.includes( 'attack' ) ? ' to Attacks' : '';
	return `Adds ${fmt( lo )} to ${fmt( hi )} ${cap( type )} Damage${to}` + ( when ? ' ' + ( WHEN_TEXT[ when ] || when ) : '' );

}

// "{0}" / "{1}" placeholders in affix texts.
export function fill( template, values ) {

	return template.replace( /\{(\d)\}/g, ( _, i ) => fmt( values[ + i ] ?? 0 ) );

}
