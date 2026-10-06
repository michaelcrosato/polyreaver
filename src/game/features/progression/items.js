// Items: rolling, computing and describing. An ITEM is plain JSON (it lives in the
// save file, in loot entities and in agent tool output):
//
//   { uid, base, ilvl, rarity: 'normal'|'magic'|'rare'|'unique', name?, unique?,
//     quality, corrupted, rev,
//     roll: { armor, evasion, shield },          rolled base defences
//     implicits: [ { stat, type, value, tags? } ],  from the base (+ corruption)
//     affixes: [ { id, tier, values: [ .. ] } ],     magic / rare modifiers
//     uvals: [ .. ],                                 unique line values
//     charges? }                                     flasks
//
// computeItem( item ) turns that into what the game needs: weapon damage / speed /
// crit after LOCAL modifiers, the armour pieces' defences, the list of GLOBAL stat
// modifiers it grants the wearer, display lines and requirements. Results are cached
// per item until its `rev` changes (crafting bumps it).
//
// RARITY RULES (Path of Exile style)
//   normal  no affixes                    magic  up to 1 prefix + 1 suffix
//   drop odds before bonuses: normal 55 : magic 32 : rare 10 : unique 1.5
//   rare    4-6 affixes, max 3 + 3        unique fixed lines + a signature mechanic

import { all, get, need, onDefine } from '../../core/registry.js';
import { RNG } from '../../core/rng.js';
import { fill, modsToLines, modLine, fmt, RARITY_NAMES } from './text.js';
import { SLOT_NAMES } from './data/bases.js';

export const RARITIES = [ 'normal', 'magic', 'rare', 'unique' ];
export const AFFIX_LIMIT = { normal: 0, magic: 1, rare: 3, unique: 0 }; // per kind (prefix / suffix)

// Text for local stats (they describe the item, not the wearer).
const LOCAL_TEXT = {
	local_phys_inc: '{0}% increased Physical Damage', local_aps_inc: '{0}% increased Attack Speed', local_crit_inc: '{0}% increased Critical Strike Chance',
	local_armor: '+{0} to Armour', local_armor_inc: '{0}% increased Armour', local_evasion: '+{0}% to chance to Evade Attacks',
	local_evasion_inc: '{0}% increased Evasion', local_shield: '+{0} to maximum Energy Shield', local_shield_inc: '{0}% increased Energy Shield',
	local_block: '+{0}% Chance to Block', local_defence_inc: '{0}% increased Armour, Evasion and Energy Shield'
};

// --- rng helpers ----------------------------------------------------------------------------

let uidSeq = 0;
// Identity belongs to the saved character, not to its seeded loot stream. A new
// process must never mint the same ids as an earlier session of the same seed.
const uidNamespace = globalThis.crypto?.randomUUID?.() || `${Date.now().toString( 36 )}-${Math.random().toString( 36 ).slice( 2 )}-${Math.random().toString( 36 ).slice( 2 )}`;

export function newUid( rng ) {

	// Keep the historical draw so item values and all later loot rolls stay exactly
	// reproducible. Repairing an identity passes no RNG and consumes no game draws.
	rng?.next();
	return `i-${uidNamespace}-${( ++ uidSeq ).toString( 36 )}`;

}

function rollRange( [ lo, hi ], mult, rng ) {

	if ( Number.isInteger( lo ) && Number.isInteger( hi ) ) return rng.int( Math.round( lo * mult ), Math.round( hi * mult ) );
	const dec = hi < 1 ? 100 : 10;
	return Math.round( ( lo + rng.next() * ( hi - lo ) ) * mult * dec ) / dec;

}

// --- affix pools -------------------------------------------------------------------------------

const poolCache = new Map();
onDefine( 'affix', () => poolCache.clear() );

// Every affix of `kind` that can roll on `base` (any tag in common), ignoring level.
export function affixPool( base, kind ) {

	const key = base.id + ':' + kind;
	let p = poolCache.get( key );
	if ( ! p ) {

		p = all( 'affix' ).filter( ( a ) => a.affixType === kind && a.tags.some( ( t ) => base.tags.includes( t ) ) );
		poolCache.set( key, p );

	}

	return p;

}

function tierIndex( a, ilvl, rng ) {

	let top = - 1;
	for ( let i = 0; i < a.tiers.length; i ++ ) if ( a.tiers[ i ].level <= ilvl ) top = i;
	if ( top < 0 ) return - 1;
	// the four best tiers the item level allows: the two just below the best are the
	// most common, the very best and the oldest one are rarer
	const W = [ 1, 1.4, 1.2, 0.6 ];
	const lo = Math.max( 0, top - 3 ), opts = [];
	for ( let i = lo; i <= top; i ++ ) opts.push( i );
	return rng.weighted( opts, ( i ) => W[ top - i ] );

}

export function rollAffixValues( a, tier, base, rng ) {

	const mult = base.hands === 2 ? a.twoHand ?? 1 : 1;
	if ( a.same ) {

		const v = rollRange( tier.ranges[ 0 ], mult, rng );
		return a.stats.map( () => v );

	}

	return tier.ranges.map( ( r ) => rollRange( r, mult, rng ) );

}

// Add one random affix of `kind` to `item` (respecting groups and item level).
// opts.filter( affix ) narrows the pool (crafting); returns the new entry or null.
export function addAffix( item, kind, rng, opts = {} ) {

	const base = need( 'itemBase', item.base );
	const groups = new Set( item.affixes.map( ( x ) => get( 'affix', x.id )?.group ) );
	const pool = affixPool( base, kind ).filter( ( a ) => ! groups.has( a.group ) && a.tiers[ 0 ].level <= item.ilvl && ( ! opts.filter || opts.filter( a ) ) );
	const a = rng.weighted( pool, ( x ) => x.weight );
	if ( ! a ) return null;
	const ti = tierIndex( a, item.ilvl, rng );
	const entry = { id: a.id, tier: ti, values: rollAffixValues( a, a.tiers[ ti ], base, rng ) };
	item.affixes.push( entry );
	return entry;

}

export function countKind( item, kind ) {

	let n = 0;
	for ( const x of item.affixes ) if ( get( 'affix', x.id )?.affixType === kind ) n ++;
	return n;

}

export function openSlots( item, kind ) {

	return Math.max( 0, ( AFFIX_LIMIT[ item.rarity ] ?? 0 ) - countKind( item, kind ) );

}

// Fill a magic item with 1-2 affixes or a rare with 4-6 (the PoE distribution).
export function fillAffixes( item, rng ) {

	item.affixes = [];
	if ( item.rarity === 'magic' ) {

		const both = rng.chance( 0.45 );
		const first = rng.chance( 0.5 ) ? 'prefix' : 'suffix';
		addAffix( item, first, rng );
		if ( both ) addAffix( item, first === 'prefix' ? 'suffix' : 'prefix', rng );

	} else if ( item.rarity === 'rare' ) {

		const n = rng.weighted( [ 4, 5, 6 ], ( k ) => ( { 4: 8, 5: 3, 6: 1 } )[ k ] );
		for ( let i = 0; i < n; i ++ ) {

			const kinds = [ 'prefix', 'suffix' ].filter( ( k ) => openSlots( item, k ) > 0 );
			if ( ! kinds.length ) break;
			if ( ! addAffix( item, rng.pick( kinds ), rng ) ) addAffix( item, kinds.find( ( k ) => openSlots( item, k ) > 0 ) || 'suffix', rng );

		}

		item.name = rareName( item, rng );

	}

	touch( item );
	return item;

}

// --- creating items -------------------------------------------------------------------------------

function rollImplicits( base, rng ) {

	return ( base.implicit || [] ).map( ( m ) => {

		const out = { stat: m.stat, type: m.type, value: m.range ? rollRange( m.range, 1, rng ) : m.value };
		if ( m.tags ) out.tags = m.tags;
		return out;

	} );

}

function rollDefences( base, rng ) {

	const roll = {};
	for ( const k in base.defence || {} ) roll[ k ] = rollRange( base.defence[ k ], 1, rng );
	return roll;

}

// A new item of `baseId` at item level `ilvl` (affixes rolled for magic / rare).
export function makeItem( baseId, ilvl, rarity = 'normal', rng = new RNG( Math.random() * 1e9 ) ) {

	const base = need( 'itemBase', baseId );
	const item = {
		uid: newUid( rng ), base: base.id, ilvl: Math.max( 1, Math.round( ilvl ) ), rarity, quality: 0, corrupted: false, rev: 0,
		roll: rollDefences( base, rng ), implicits: rollImplicits( base, rng ), affixes: []
	};
	if ( base.flask ) item.charges = base.flask.max;
	if ( rarity === 'magic' || rarity === 'rare' ) fillAffixes( item, rng );
	return item;

}

export function makeUnique( uniqueId, ilvl, rng = new RNG( Math.random() * 1e9 ) ) {

	const u = need( 'unique', uniqueId );
	const item = makeItem( u.base, Math.max( ilvl, u.level ), 'normal', rng );
	item.rarity = 'unique';
	item.unique = u.id;
	item.uvals = u.mods.map( ( m ) => m.range ? rollRange( m.range, 1, rng ) : m.value );
	touch( item );
	return item;

}

// Re-roll the numeric values of an item's lines inside their tiers (Divine Orb).
export function rerollValues( item, rng ) {

	const base = need( 'itemBase', item.base );
	for ( const x of item.affixes ) {

		const a = get( 'affix', x.id );
		if ( a ) x.values = rollAffixValues( a, a.tiers[ x.tier ], base, rng );

	}

	if ( item.unique ) {

		const u = get( 'unique', item.unique );
		if ( u ) item.uvals = u.mods.map( ( m ) => m.range ? rollRange( m.range, 1, rng ) : m.value );

	}

	item.implicits = item.implicits.map( ( m, i ) => {

		const src = base.implicit?.[ i ];
		return src?.range && ! m.corrupt ? { ...m, value: rollRange( src.range, 1, rng ) } : m;

	} );
	touch( item );

}

// --- picking bases and rarity for drops -----------------------------------------------------------

const SLOT_WEIGHTS = { weapon: 1.5, offhand: 0.8, helm: 1, chest: 1, gloves: 1, boots: 1, belt: 0.6, amulet: 0.5, ring: 0.8 };

// A base for a drop of item level `ilvl`. Slots are picked first (so slots with many
// bases are not over-represented), then bases near the item level are favoured.
export function pickBase( ilvl, rng, { slot = null, tags = null, flask = false } = {} ) {

	const ok = ( b ) => b.level <= ilvl && ( flask ? b.slot === 'flask' : b.slot !== 'flask' ) && ( ! tags || tags.every( ( t ) => b.tags.includes( t ) ) );
	let cands = all( 'itemBase' ).filter( ok );
	if ( slot ) cands = cands.filter( ( b ) => b.slot === slot || b.tags.includes( slot ) );
	if ( ! cands.length ) return null;
	const slots = [ ...new Set( cands.map( ( b ) => b.slot ) ) ];
	const s = slot || flask ? null : rng.weighted( slots, ( x ) => SLOT_WEIGHTS[ x ] ?? 1 );
	const pool = s ? cands.filter( ( b ) => b.slot === s ) : cands;
	return rng.weighted( pool, ( b ) => 1 / ( 1 + Math.max( 0, ilvl - b.level - 12 ) / 10 ) );

}

// Rarity of a drop. `bonus` = % increased rarity (player item_rarity + monster
// rarity bonus); `tuning` = the Loot rarity slider (0 = only white items).
export function rollRarity( rng, bonus = 0, tuning = 1 ) {

	if ( tuning <= 0 ) return 'normal';
	const r = Math.max( 0, 1 + bonus / 100 ) * tuning;
	const w = { normal: 55, magic: 32 * Math.sqrt( r ), rare: 10 * r, unique: 1.5 * r };
	return rng.weighted( RARITIES, ( k ) => w[ k ] );

}

export function pickUnique( ilvl, rng, { slot = null } = {} ) {

	const pool = all( 'unique' ).filter( ( u ) => {

		const b = get( 'itemBase', u.base );
		return b && u.level <= ilvl && b.level <= ilvl && ( ! slot || b.slot === slot || b.tags.includes( slot ) );

	} );
	return rng.weighted( pool, ( u ) => u.weight ?? 1 );

}

// THE loot roll used by drops, the vendor, gambling and agent tools.
//   opts: { rarity, slot, tags, base, unique, bonus (rarity %), tuning, flask }
export function rollItem( level, opts = {}, rng = new RNG( Math.random() * 1e9 ) ) {

	const ilvl = Math.max( 1, Math.round( level ) );
	if ( opts.unique ) return makeUnique( opts.unique, ilvl, rng );
	let rarity = opts.rarity || rollRarity( rng, opts.bonus ?? 0, opts.tuning ?? 1 );
	if ( rarity === 'unique' && ! opts.base ) {

		const u = pickUnique( ilvl, rng, opts );
		if ( u ) return makeUnique( u.id, ilvl, rng );
		rarity = 'rare';

	}

	const base = opts.base ? need( 'itemBase', opts.base ) : pickBase( ilvl, rng, opts );
	if ( ! base ) return null;
	if ( base.slot === 'flask' && rarity === 'rare' ) rarity = 'magic';
	if ( rarity === 'unique' ) rarity = 'rare';
	return makeItem( base.id, ilvl, rarity, rng );

}

// --- names -----------------------------------------------------------------------------------------

const RARE_A = [ 'Doom', 'Gale', 'Storm', 'Grim', 'Blood', 'Bone', 'Dread', 'Rune', 'Soul', 'Ghoul', 'Hate', 'Woe', 'Rage', 'Corpse', 'Plague', 'Mind', 'Kraken', 'Eagle', 'Viper', 'Brood', 'Havoc', 'Beast', 'Behemoth', 'Dragon', 'Pandemonium', 'Armageddon', 'Apocalypse', 'Morbid', 'Entropy', 'Vortex', 'Sol', 'Empyrean', 'Onslaught', 'Tempest', 'Wrath', 'Shadow', 'Spirit', 'Phoenix', 'Golem', 'Carrion', 'Chimeric', 'Damnation', 'Demon', 'Eclipse', 'Fate', 'Foe', 'Glyph', 'Honour', 'Horror', 'Loath', 'Mire', 'Oblivion', 'Raven', 'Sorrow', 'Torment', 'Vengeance', 'Victory', 'Agony', 'Blight', 'Dusk', 'Miracle', 'Sanguine', 'Spark', 'Thunder', 'Tide', 'Wraith' ];
const RARE_B = {
	sword: [ 'Bane', 'Edge', 'Fang', 'Song', 'Razor', 'Thirst', 'Bite', 'Sever', 'Slicer', 'Spine', 'Splitter', 'Stinger' ],
	axe: [ 'Chopper', 'Cleaver', 'Sunder', 'Hew', 'Hunger', 'Mangler', 'Splitter', 'Beak' ],
	mace: [ 'Crusher', 'Mallet', 'Batter', 'Thresher', 'Breaker', 'Knell', 'Pummel', 'Ram' ],
	dagger: [ 'Point', 'Needle', 'Sting', 'Barb', 'Fang', 'Skewer', 'Etcher', 'Quill' ],
	spear: [ 'Lance', 'Pike', 'Impaler', 'Prong', 'Thorn', 'Tine', 'Spike' ],
	wand: [ 'Bauble', 'Charm', 'Branch', 'Song', 'Spire', 'Wand', 'Twig' ],
	staff: [ 'Pillar', 'Staff', 'Beam', 'Branch', 'Spire', 'Mast', 'Stalk' ],
	greatsword: [ 'Bane', 'Edge', 'Reaver', 'Song', 'Severance', 'Cleaver', 'Executioner' ],
	greataxe: [ 'Chopper', 'Cleaver', 'Reaver', 'Splitter', 'Hunger', 'Butcher' ],
	maul: [ 'Crusher', 'Hammer', 'Knell', 'Breaker', 'Thunder', 'Ram', 'Mangler' ],
	bow: [ 'Arch', 'Bane', 'Blast', 'Fletch', 'Guide', 'Horn', 'Mark', 'Nock', 'Rain', 'Reach', 'Siege', 'Song', 'Strike', 'Volley', 'Wing' ],
	helm: [ 'Brow', 'Corona', 'Cowl', 'Crest', 'Crown', 'Dome', 'Glance', 'Halo', 'Horn', 'Keeper', 'Mask', 'Peak', 'Star', 'Veil', 'Visage', 'Visor' ],
	chest: [ 'Carapace', 'Cloak', 'Coat', 'Curtain', 'Hide', 'Jack', 'Keep', 'Mantle', 'Pelt', 'Sanctuary', 'Shell', 'Shelter', 'Shroud', 'Skin', 'Suit', 'Wrap' ],
	gloves: [ 'Caress', 'Claw', 'Clutches', 'Fingers', 'Fist', 'Grasp', 'Grip', 'Hand', 'Hold', 'Knuckle', 'Mitts', 'Nails', 'Palm', 'Paw', 'Talons', 'Touch' ],
	boots: [ 'Dash', 'Goad', 'Hoof', 'League', 'March', 'Pace', 'Road', 'Sole', 'Span', 'Spur', 'Stride', 'Track', 'Trail', 'Tread', 'Urge' ],
	belt: [ 'Bind', 'Bond', 'Buckle', 'Clasp', 'Cord', 'Girdle', 'Harness', 'Lash', 'Leash', 'Link', 'Shackle', 'Snare', 'Strap' ],
	amulet: [ 'Beads', 'Braid', 'Charm', 'Choker', 'Clasp', 'Collar', 'Idol', 'Gorget', 'Heart', 'Locket', 'Medallion', 'Pendant', 'Rosary', 'Scarab', 'Talisman', 'Torc' ],
	ring: [ 'Band', 'Circle', 'Coil', 'Eye', 'Finger', 'Grasp', 'Gyre', 'Hold', 'Knot', 'Loop', 'Nail', 'Spiral', 'Turn', 'Twirl', 'Whorl' ],
	shield: [ 'Aegis', 'Badge', 'Barrier', 'Bastion', 'Bulwark', 'Duty', 'Emblem', 'Fend', 'Guard', 'Refuge', 'Rock', 'Tower', 'Watch', 'Wing' ],
	quiver: [ 'Arrow', 'Barb', 'Bite', 'Bolt', 'Dart', 'Flight', 'Hail', 'Quill', 'Shot', 'Spike', 'Stinger' ],
	focus: [ 'Eye', 'Lens', 'Orb', 'Prism', 'Seal', 'Sigil', 'Star', 'Ward' ]
};

function nameKey( base ) {

	return base.weaponClass || ( base.tags.includes( 'shield' ) ? 'shield' : base.tags.includes( 'quiver' ) ? 'quiver' : base.tags.includes( 'focus' ) ? 'focus' : base.slot );

}

export function rareName( item, rng ) {

	const base = need( 'itemBase', item.base );
	return `${rng.pick( RARE_A )} ${rng.pick( RARE_B[ nameKey( base ) ] || RARE_B.amulet )}`;

}

export function itemName( item ) {

	const base = get( 'itemBase', item.base );
	if ( ! base ) return 'Unknown Item';
	if ( item.rarity === 'unique' ) return get( 'unique', item.unique )?.name || base.name;
	if ( item.rarity === 'rare' ) return item.name || base.name;
	if ( item.rarity === 'magic' ) {

		let pre = '', suf = '';
		for ( const x of item.affixes ) {

			const a = get( 'affix', x.id );
			const n = a?.tiers[ x.tier ]?.name;
			if ( ! n ) continue;
			if ( a.affixType === 'prefix' ) pre = n + ' '; else suf = ' ' + n;

		}

		return pre + base.name + suf;

	}

	return ( item.quality > 0 ? 'Superior ' : '' ) + base.name;

}

// --- computing -------------------------------------------------------------------------------------

export function touch( item ) {

	item.rev = ( item.rev ?? 0 ) + 1;
	return item;

}

const cache = new WeakMap();

// Expand an item into stat entries: { stat, type, value, tags, when, flaskBuff, line }.
function entriesOf( item ) {

	const out = [];
	for ( const m of item.implicits || [] ) out.push( { ...m, src: 'implicit' } );
	for ( const x of item.affixes || [] ) {

		const a = get( 'affix', x.id );
		if ( ! a ) continue;
		a.stats.forEach( ( s, i ) => {

			const v = x.values[ i ] ?? x.values[ 0 ];
			out.push( { stat: s.stat, type: s.type, value: s.negate ? - v : v, tags: s.tags, when: s.when, flaskBuff: s.flaskBuff, src: 'affix' } );

		} );

	}

	if ( item.unique ) {

		const u = get( 'unique', item.unique );
		u?.mods.forEach( ( m, i ) => out.push( { stat: m.stat, type: m.type, value: item.uvals?.[ i ] ?? m.value ?? 0, tags: m.tags, when: m.when, src: 'unique' } ) );

	}

	return out;

}

export function computeItem( item ) {

	const hit = cache.get( item );
	if ( hit && hit.rev === item.rev ) return hit.data;
	const base = need( 'itemBase', item.base );
	const name = itemName( item );
	const L = {}; // local accumulators
	const global = [];
	const flaskBuff = [];
	for ( const e of entriesOf( item ) ) {

		if ( e.stat.startsWith( 'local_' ) ) L[ e.stat ] = ( L[ e.stat ] ?? 0 ) + e.value;
		else if ( e.flaskBuff ) flaskBuff.push( clean( e ) );
		else global.push( clean( e ) );

	}

	const q = item.quality || 0;
	const out = { base, name, rarity: item.rarity, mods: [], weapon: null, defence: null, flask: null, req: null };

	if ( base.damage ) {

		const inc = 1 + ( ( L.local_phys_inc ?? 0 ) + q ) / 100;
		const min = ( base.damage[ 0 ] + ( L.local_phys_min ?? 0 ) ) * inc;
		const max = ( base.damage[ 1 ] + ( L.local_phys_max ?? 0 ) ) * inc;
		const aps = base.attackSpeed * ( 1 + ( L.local_aps_inc ?? 0 ) / 100 );
		const crit = base.crit * ( 1 + ( L.local_crit_inc ?? 0 ) / 100 );
		out.weapon = { min: Math.round( min ), max: Math.round( max ), aps: Math.round( aps * 100 ) / 100, crit: Math.round( crit * 10 ) / 10, cls: base.weaponClass, hands: base.hands };
		out.weapon.physDps = Math.round( ( min + max ) / 2 * aps * 10 ) / 10;
		// elemental "adds X to Y" lines on the weapon itself count toward its listed DPS
		let ele = 0;
		for ( const m of global ) if ( /^added_(fire|cold|lightning|chaos)_(min|max)$/.test( m.stat ) && m.tags?.includes( 'attack' ) ) ele += m.value / 2;
		out.weapon.eleDps = Math.round( ele * aps * 10 ) / 10;
		out.weapon.dps = Math.round( ( out.weapon.physDps + out.weapon.eleDps ) * 10 ) / 10;

	}

	if ( base.defence || base.block || L.local_block ) {

		const di = ( L.local_defence_inc ?? 0 ) + q;
		const r = item.roll || {};
		const d = {};
		if ( base.defence?.armor ) d.armor = Math.round( ( r.armor + ( L.local_armor ?? 0 ) ) * ( 1 + ( ( L.local_armor_inc ?? 0 ) + di ) / 100 ) );
		if ( base.defence?.evasion ) d.evasion = Math.round( ( r.evasion + ( L.local_evasion ?? 0 ) ) * ( 1 + ( ( L.local_evasion_inc ?? 0 ) + di ) / 100 ) * 10 ) / 10;
		if ( base.defence?.shield ) d.shield = Math.round( ( r.shield + ( L.local_shield ?? 0 ) ) * ( 1 + ( ( L.local_shield_inc ?? 0 ) + di ) / 100 ) );
		if ( base.block || L.local_block ) d.block = ( base.block ?? 0 ) + ( L.local_block ?? 0 );
		out.defence = d;

	}

	if ( base.flask ) {

		const f = base.flask;
		const eff = 1 + ( ( L.local_flask_effect ?? 0 ) + q ) / 100;
		out.flask = {
			kind: f.kind, amount: f.amount ? Math.round( f.amount * eff ) : 0, duration: f.duration,
			max: Math.round( f.max * ( 1 + ( L.local_flask_max_inc ?? 0 ) / 100 ) ),
			use: Math.max( 1, Math.round( f.use * ( 1 + ( L.local_flask_use_inc ?? 0 ) / 100 ) ) ),
			gain: 1 + ( L.local_flask_gain ?? 0 ) / 100, instant: ( L.local_flask_instant ?? 0 ) / 100, effect: eff,
			buff: [ ...( f.buff || [] ).map( ( m ) => ( { ...m, value: m.value * eff } ) ), ...flaskBuff ]
		};

	}

	// global modifiers the wearer gets (weapons and armour are handled by stats.js
	// from out.weapon / out.defence so off-hand rules can apply)
	out.mods = global.map( ( m ) => ( { ...m, from: name } ) );

	// requirements: the base's, raised by high affix tiers (like PoE's 80% rule)
	let lvl = base.req?.level ?? base.level ?? 1;
	for ( const x of item.affixes ) {

		const a = get( 'affix', x.id );
		if ( a ) lvl = Math.max( lvl, Math.floor( a.tiers[ x.tier ].level * 0.8 ) );

	}

	if ( item.unique ) lvl = Math.max( lvl, get( 'unique', item.unique )?.level ?? 1 );
	out.req = { level: lvl, str: base.req?.str ?? 0, dex: base.req?.dex ?? 0, int: base.req?.int ?? 0 };
	out.lines = itemLines( item, base, global, L );
	cache.set( item, { rev: item.rev, data: out } );
	return out;

}

function clean( e ) {

	const m = { stat: e.stat, type: e.type, value: e.value };
	if ( e.tags && e.tags.length ) m.tags = e.tags;
	if ( e.when ) m.when = e.when;
	return m;

}

function itemLines( item, base, global, L ) {

	const implicit = modsToLines( ( item.implicits || [] ).map( ( m ) => m.text ? m : clean( m ) ) );
	const explicit = [];
	for ( const x of item.affixes || [] ) {

		const a = get( 'affix', x.id );
		if ( ! a ) continue;
		explicit.push( { text: fill( a.text, x.values ), kind: a.affixType, tier: a.tiers.length - x.tier, tiers: a.tiers.length, affix: a.id, tierName: a.tiers[ x.tier ].name } );

	}

	if ( item.unique ) {

		const u = get( 'unique', item.unique );
		const entries = ( u?.mods || [] ).map( ( m, i ) => ( { ...m, value: item.uvals?.[ i ] ?? m.value ?? 0 } ) );
		const plain = [];
		const flush = () => {

			for ( const t of modsToLines( plain ) ) explicit.push( { text: t, kind: 'unique' } );
			plain.length = 0;

		};

		for ( const m of entries ) {

			if ( LOCAL_TEXT[ m.stat ] ) {

				flush();
				explicit.push( { text: fill( LOCAL_TEXT[ m.stat ], [ m.value ] ), kind: 'unique' } );

			} else plain.push( m.text ? { ...m, text: fill( m.text, [ m.value ] ) } : clean( m ) );

		}

		flush();

	}

	return { implicit, explicit };

}

// --- requirement checks, value, description ------------------------------------------------------------

export function meetsReq( item, attrs, level ) {

	const r = computeItem( item ).req;
	const fail = [];
	if ( level < r.level ) fail.push( 'level' );
	if ( r.str && ( attrs.strength ?? 0 ) < r.str ) fail.push( 'str' );
	if ( r.dex && ( attrs.dexterity ?? 0 ) < r.dex ) fail.push( 'dex' );
	if ( r.int && ( attrs.intelligence ?? 0 ) < r.int ) fail.push( 'int' );
	return fail;

}

// Vendor sell price in gold (buy price is a multiple of this, see inventory.js).
export function itemValue( item ) {

	const k = { normal: 1, magic: 3, rare: 8, unique: 25 }[ item.rarity ] ?? 1;
	const n = item.affixes?.length ?? 0;
	return Math.max( 1, Math.round( k * ( 2 + item.ilvl * 0.6 ) * ( 1 + n * 0.12 ) * ( 1 + ( item.quality || 0 ) / 40 ) * ( item.corrupted ? 1.2 : 1 ) ) );

}

// Plain-JSON description for agents, tooltips and tests.
export function describeItem( item ) {

	const c = computeItem( item );
	const base = c.base;
	const props = [];
	if ( c.weapon ) {

		props.push( [ 'Physical Damage', `${c.weapon.min}-${c.weapon.max}` ], [ 'Attacks per Second', fmt( c.weapon.aps ) ], [ 'Critical Strike Chance', fmt( c.weapon.crit ) + '%' ], [ 'DPS', fmt( c.weapon.dps ) ] );

	}

	if ( c.defence ) {

		if ( c.defence.armor ) props.push( [ 'Armour', String( c.defence.armor ) ] );
		if ( c.defence.evasion ) props.push( [ 'Evade Chance', fmt( c.defence.evasion ) + '%' ] );
		if ( c.defence.shield ) props.push( [ 'Energy Shield', String( c.defence.shield ) ] );
		if ( c.defence.block ) props.push( [ 'Chance to Block', fmt( c.defence.block ) + '%' ] );

	}

	if ( c.flask ) {

		const f = c.flask;
		if ( f.kind !== 'utility' ) props.push( [ `Recovers ${f.amount} ${f.kind === 'hybrid' ? 'Life and Mana' : f.kind === 'life' ? 'Life' : 'Mana'} over`, `${fmt( f.duration )} s` ] );
		else props.push( [ 'Lasts', `${fmt( f.duration )} s` ] );
		props.push( [ 'Consumes', `${f.use} of ${f.max} Charges` ] );

	}

	if ( item.quality ) props.push( [ 'Quality', `+${item.quality}%` ] );
	const u = item.unique ? get( 'unique', item.unique ) : null;
	return {
		uid: item.uid, name: c.name, baseName: base.name, rarity: item.rarity, rarityName: RARITY_NAMES[ item.rarity ], ilvl: item.ilvl,
		slot: base.slot, slotName: SLOT_NAMES[ base.slot ] || ( base.slot === 'ring' ? 'Ring' : base.slot ), weaponClass: base.weaponClass ?? null,
		quality: item.quality || 0, corrupted: !! item.corrupted, req: c.req, properties: props,
		implicits: c.lines.implicit, explicits: c.lines.explicit.map( ( e ) => e.text ), affixes: c.lines.explicit,
		mechanic: u?.mechanic ?? null, flavour: u?.flavour ?? null, value: itemValue( item ),
		weapon: c.weapon, defence: c.defence, flask: c.flask ? { ...c.flask, buff: modsToLines( c.flask.buff ) } : null
	};

}

// One-line summary (logs, agent output).
export function itemSummary( item ) {

	const d = describeItem( item );
	return `[${d.rarityName}] ${d.name}${d.name !== d.baseName ? ` (${d.baseName})` : ''} ilvl ${d.ilvl}: ${[ ...d.implicits, ...d.explicits ].join( '; ' )}`;

}

export { modLine };
