// An isolated, versioned build draft. Planning and importing only read the live
// character; previews rebuild stats on copies and never apply a loadout to play.
import { define, get } from '../../core/registry.js';
import { ensureSave } from './save.js';
import { EQUIP_SLOTS, SLOT_ACCEPTS } from './data/bases.js';
import { ASCENDANCY_LEVEL } from './data/ascendancy.js';
import { CORRUPT_IMPLICITS } from './data/currency.js';
import { getTree, START_INFO, pointsTotal, ascPointsTotal, pathTo, canRefund } from './tree.js';
import { maxSkillLevel, supportFits, supportSlots } from './skills.js';
import { simulateStats, compareStats, buildMods, COMPARE_STATS } from './stats.js';
import { computeItem, itemName, RARITIES, AFFIX_LIMIT } from './items.js';
import { skillTooltip, supportMods, readLoadout } from '../combat/skill-core.js';

export const BUILD_VERSION = 1;
export const BUILD_PREFIX = 'PRB1:';
export const MAX_BUILD_LEVEL = 10000;
export const MAX_BUILD_CODE = 200000;
const copy = ( value ) => structuredClone( value );
const object = ( value ) => value !== null && typeof value === 'object' && ! Array.isArray( value );
const integer = ( value, min, max ) => Number.isInteger( value ) && value >= min && value <= max;
const numeric = ( value ) => typeof value === 'number' && Number.isFinite( value ) && Math.abs( value ) <= 1e9;
const own = ( value, key ) => Object.hasOwn( value, key );
const reqLevel = ( def ) => def.levelReq ?? def.level ?? 1;

function inRollRange( value, range, multiplier = 1, corruptionScale = 1 ) {

	if ( ! numeric( value ) || ! range ) return false;
	const integers = range.every( Number.isInteger ), precision = integers ? 1 : range[ 1 ] < 1 ? 100 : 10;
	const lo = Math.round( range[ 0 ] * multiplier * precision ) / precision * corruptionScale;
	const hi = Math.round( range[ 1 ] * multiplier * precision ) / precision * corruptionScale;
	// Corrupting an integer roll rounds again; a fractional roll keeps two decimals.
	const tolerance = corruptionScale === 1 ? 0.051 : 0.501;
	return value >= lo - tolerance && value <= hi + tolerance;

}

export function createBuildPlan( save ) {

	const s = ensureSave( copy( save ) );
	const ids = [ ...new Set( s.skills.bar.filter( Boolean ) ) ];
	return {
		version: BUILD_VERSION, name: 'My build', level: s.level,
		tree: copy( s.tree ), equipment: copy( s.equipment ),
		skills: { bar: copy( s.skills.bar ), levels: Object.fromEntries( ids.map( ( id ) => [ id, s.skills.levels[ id ] ?? 1 ] ) ),
			supports: Object.fromEntries( ids.map( ( id ) => [ id, copy( s.skills.supports[ id ] || [] ) ] ) ) }
	};

}

function connected( nodes, ids, root ) {

	const selected = new Set( ids ), seen = new Set( [ root ] ), stack = [ root ];
	while ( stack.length ) for ( const next of nodes.get( stack.pop() )?.links || [] ) if ( selected.has( next ) && ! seen.has( next ) ) {

		seen.add( next ); stack.push( next );

	}
	return seen.size === selected.size;

}

function validIds( ids, nodes, root ) {

	return Array.isArray( ids ) && ids.length <= nodes.size && ids.every( ( id ) => typeof id === 'string' && nodes.has( id ) ) &&
		new Set( ids ).size === ids.length && ids.includes( root ) && connected( nodes, ids, root );

}

function itemErrors( item, slot ) {

	const out = [], bad = ( text ) => out.push( `${slot}: ${text}` );
	if ( ! object( item ) ) return [ `${slot}: invalid item` ];
	const b = get( 'itemBase', item.base );
	if ( ! b ) return [ `${slot}: unknown item base` ];
	if ( ! SLOT_ACCEPTS[ slot ].includes( b.slot ) ) bad( 'item does not fit this slot' );
	if ( slot === 'offhand' && b.hands === 2 ) bad( 'two-handed weapons require the main hand' );
	if ( typeof item.uid !== 'string' || ! item.uid.length || item.uid.length > 160 ) bad( 'invalid item identity' );
	if ( ! integer( item.ilvl, 1, MAX_BUILD_LEVEL ) || ! integer( item.quality, 0, 20 ) || ! integer( item.rev, 0, 1e9 ) ) bad( 'invalid item level, quality or revision' );
	if ( ! RARITIES.includes( item.rarity ) ) bad( 'unknown rarity' );
	if ( item.name !== undefined && ( typeof item.name !== 'string' || item.name.length > 100 ) ) bad( 'invalid item name' );
	if ( typeof item.corrupted !== 'boolean' ) bad( 'invalid corruption state' );
	if ( ! object( item.roll ) || Object.keys( item.roll ).some( ( key ) => ! own( b.defence || {}, key ) ) ||
		Object.entries( b.defence || {} ).some( ( [ key, range ] ) => ! inRollRange( item.roll[ key ], range ) ) ) bad( 'invalid defence roll' );
	if ( ! Array.isArray( item.implicits ) || item.implicits.length > 10 || item.implicits.some( ( m ) => ! object( m ) ||
		typeof m.stat !== 'string' || ! /^[a-z_][a-z_0-9]{0,63}$/.test( m.stat ) || ! [ 'flat', 'inc', 'more', 'override' ].includes( m.type ) ||
		! numeric( m.value ) || ( m.tags !== undefined && ( ! Array.isArray( m.tags ) || m.tags.length > 16 || m.tags.some( ( t ) => typeof t !== 'string' || t.length > 64 ) ) ) ) ) bad( 'invalid implicit modifier' );
	else for ( const m of item.implicits ) {

		const choices = m.corrupt && item.corrupted ? CORRUPT_IMPLICITS.filter( ( c ) => c.slots.includes( b.slot ) ) : b.implicit || [];
		const source = choices.find( ( c ) => c.stat === m.stat && c.type === m.type && JSON.stringify( c.tags || [] ) === JSON.stringify( m.tags || [] ) );
		if ( ! source || Object.keys( m ).some( ( key ) => ! [ 'stat', 'type', 'value', 'tags', 'corrupt' ].includes( key ) ) ) bad( 'unknown implicit modifier for this base' );
		else if ( ! inRollRange( m.value, source.range || [ source.value, source.value ] ) ) bad( 'implicit value is outside its supported range' );

	}
	if ( ! Array.isArray( item.affixes ) || item.affixes.length > 6 ) bad( 'invalid affix list' );
	else {

		const groups = new Set(), counts = { prefix: 0, suffix: 0 };
		for ( const x of item.affixes ) {

			const a = object( x ) ? get( 'affix', x.id ) : null;
			if ( ! a || ! integer( x.tier, 0, a.tiers.length - 1 ) ) { bad( 'unknown affix or tier' ); continue; }
			const tier = a.tiers[ x.tier ];
			if ( tier.level > item.ilvl || ! a.tags.some( ( t ) => b.tags.includes( t ) ) ) bad( 'affix cannot roll on this item' );
			if ( groups.has( a.group ) ) bad( 'duplicate affix group' );
			groups.add( a.group ); counts[ a.affixType ] ++;
			if ( ! Array.isArray( x.values ) || x.values.length !== a.stats.length || x.values.some( ( v ) => ! numeric( v ) ) ) bad( 'invalid affix values' );
			else {

				const multiplier = b.hands === 2 ? a.twoHand ?? 1 : 1;
				const empowered = item.corrupted && item.corruptOutcome === 'empowered';
				if ( x.values.some( ( v, i ) => ! inRollRange( v, tier.ranges[ a.same ? 0 : i ], multiplier ) && ! ( empowered && inRollRange( v, tier.ranges[ a.same ? 0 : i ], multiplier, 1.25 ) ) ) ) bad( 'affix value is outside its supported tier range' );
				if ( a.same && x.values.some( ( v ) => v !== x.values[ 0 ] ) ) bad( 'shared affix values must match' );

			}

		}
		if ( counts.prefix > AFFIX_LIMIT[ item.rarity ] || counts.suffix > AFFIX_LIMIT[ item.rarity ] ) bad( 'too many affixes for rarity' );

	}
	if ( item.rarity === 'unique' || item.unique ) {

		const u = get( 'unique', item.unique );
		if ( ! u || u.base !== item.base || item.rarity !== 'unique' ) bad( 'unknown unique or mismatched base' );
		else if ( item.ilvl < u.level || ! Array.isArray( item.uvals ) || item.uvals.length !== u.mods.length || item.uvals.some( ( v ) => ! numeric( v ) ) ) bad( 'invalid unique level or values' );
		else {

			const scale = item.corrupted && item.corruptOutcome === 'bricked' ? 0.8 : 1;
			if ( item.uvals.some( ( v, i ) => ! inRollRange( v, u.mods[ i ].range || [ u.mods[ i ].value, u.mods[ i ].value ], 1, scale ) ) ) bad( 'unique value is outside its supported range' );

		}

	}
	return out;

}

// Hard errors prevent import/export; unmet attribute requirements are preview
// warnings (the normal stat builder disables that equipment).
export function validateBuildPlan( plan ) {

	const errors = [], T = getTree();
	if ( ! object( plan ) ) return { ok: false, errors: [ 'Build must be an object' ] };
	if ( plan.version !== BUILD_VERSION ) errors.push( 'Unsupported build version' );
	if ( typeof plan.name !== 'string' || plan.name.length > 100 ) errors.push( 'Build name must be at most 100 characters' );
	if ( ! integer( plan.level, 1, MAX_BUILD_LEVEL ) ) errors.push( `Target level must be 1–${MAX_BUILD_LEVEL}` );
	const t = plan.tree;
	if ( ! object( t ) || typeof t.start !== 'string' || ! own( START_INFO, t.start ) ) errors.push( 'Unknown starting region' );
	else {

		if ( t.version !== T.version ) errors.push( 'Build uses a different passive tree version' );
		if ( ! integer( t.bonus, 0, 10000 ) ) errors.push( 'Invalid bonus passive points' );
		if ( ! validIds( t.allocated, T.nodes, `s.${t.start}` ) ) errors.push( 'Passive nodes must be known, unique and connected to the start' );
		else if ( t.allocated.length - 1 > pointsTotal( plan.level, t.bonus ) ) errors.push( 'Not enough passive points at the target level' );
		const a = t.asc;
		if ( ! object( a ) || ! Array.isArray( a.allocated ) ) errors.push( 'Invalid ascendancy' );
		else if ( a.id === null ) { if ( a.allocated.length ) errors.push( 'Ascendancy nodes require an ascendancy' ); }
		else if ( typeof a.id !== 'string' || ! own( T.asc, a.id ) ) errors.push( 'Unknown ascendancy' );
		else {

			if ( plan.level < ASCENDANCY_LEVEL ) errors.push( `Ascendancy requires level ${ASCENDANCY_LEVEL}` );
			if ( ! validIds( a.allocated, T.asc[ a.id ].nodes, `${a.id}:root` ) ) errors.push( 'Ascendancy nodes must be known, unique and connected' );
			else if ( a.allocated.length - 1 > ascPointsTotal( plan.level ) ) errors.push( 'Not enough ascendancy points at the target level' );

		}

	}
	if ( ! object( plan.equipment ) || Object.keys( plan.equipment ).some( ( k ) => ! EQUIP_SLOTS.includes( k ) ) ) errors.push( 'Invalid equipment slots' );
	else {

		const identities = new Set();
		for ( const slot of EQUIP_SLOTS ) {

			const item = plan.equipment[ slot ];
			if ( item === null ) continue;
			errors.push( ...itemErrors( item, slot ) );
			if ( item?.uid && identities.has( item.uid ) ) errors.push( 'One item cannot occupy multiple equipment slots' );
			identities.add( item?.uid );

		}
		const w = get( 'itemBase', plan.equipment.weapon?.base ), o = get( 'itemBase', plan.equipment.offhand?.base );
		if ( o?.tags.includes( 'quiver' ) && w?.weaponClass !== 'bow' ) errors.push( 'A quiver requires a bow' );
		if ( w?.hands === 2 && o && ! ( w.weaponClass === 'bow' && o.tags.includes( 'quiver' ) ) ) errors.push( 'Two-handed weapons cannot pair with this offhand' );

	}
	const s = plan.skills;
	if ( ! object( s ) || ! Array.isArray( s.bar ) || s.bar.length !== 6 || ! object( s.levels ) || ! object( s.supports ) ) errors.push( 'Invalid six-slot skill loadout' );
	else {

		const ids = s.bar.filter( ( id ) => id !== null );
		if ( new Set( ids ).size !== ids.length ) errors.push( 'Skills cannot occupy multiple bar slots' );
		if ( Object.keys( s.levels ).some( ( id ) => ! ids.includes( id ) ) || Object.keys( s.supports ).some( ( id ) => ! ids.includes( id ) ) ) errors.push( 'Skill settings must belong to a skill on the bar' );
		for ( const id of ids ) {

			const d = typeof id === 'string' ? get( 'skill', id ) : null;
			if ( ! d ) { errors.push( 'Unknown skill' ); continue; }
			if ( reqLevel( d ) > plan.level ) errors.push( `${d.name} requires level ${reqLevel( d )}` );
			if ( ! integer( s.levels[ id ], 1, maxSkillLevel( plan.level ) ) ) errors.push( `${d.name}: invalid skill level for target level` );
			const supports = s.supports[ id ];
			if ( ! Array.isArray( supports ) || supports.length > supportSlots( { level: plan.level } ) || new Set( supports ).size !== supports.length ) errors.push( `${d.name}: invalid support sockets` );
			else for ( const sid of supports ) {

				const sup = typeof sid === 'string' ? get( 'support', sid ) : null;
				if ( ! sup || ! supportFits( d, sup ) || reqLevel( sup ) > plan.level ) errors.push( `${d.name}: unknown, incompatible or locked support` );

			}

		}

	}
	return { ok: errors.length === 0, errors };

}

function assertPlan( plan ) {

	const r = validateBuildPlan( plan );
	if ( ! r.ok ) throw new Error( r.errors.join( '; ' ) );

}

export function buildPlanSave( save, plan ) {

	assertPlan( plan );
	const s = ensureSave( copy( save ) );
	s.level = plan.level; s.tree = copy( plan.tree ); s.equipment = copy( plan.equipment );
	s.skills = { ...copy( plan.skills ), known: plan.skills.bar.filter( Boolean ), xp: {}, runes: {} };
	return s;

}

function statsFor( game, save ) {

	const preview = { ...game, save }, stats = simulateStats( preview );
	// The ordinary stat simulator carries current support modifiers through as a
	// non-progression source. Replace that source for the planned bar/supports.
	stats.setSource( 'src:combat-supports', supportMods( readLoadout( save ) ) );
	return { preview, stats };

}

export function evaluateBuildPlan( game, plan ) {

	const save = buildPlanSave( game.save, plan ), live = ensureSave( copy( game.save ) );
	const before = statsFor( game, live ), after = statsFor( game, save );
	const build = buildMods( after.preview );
	const warnings = [ ...build.disabled ].map( ( slot ) => {

		const item = save.equipment[ slot ], req = computeItem( item ).req;
		return `${itemName( item )} (${slot}) is disabled: requires level ${req.level || 1}, STR ${req.str || 0}, DEX ${req.dex || 0}, INT ${req.int || 0}.`;

	} );
	const ownedIds = new Set( ownedBuildItems( live ).map( ( item ) => item.uid ) );
	for ( const slot of EQUIP_SLOTS ) {

		const item = plan.equipment[ slot ];
		if ( item && ! ownedIds.has( item.uid ) ) warnings.push( `Needs ${itemName( item )} (${slot}): this item is not owned by the current character.` );

	}
	const have = new Map();
	for ( const [ id, n ] of Object.entries( live.skills.runes ) ) have.set( id, n );
	for ( const list of Object.values( live.skills.supports ) ) for ( const id of list ) have.set( id, ( have.get( id ) || 0 ) + 1 );
	const wanted = new Map();
	for ( const list of Object.values( plan.skills.supports ) ) for ( const id of list ) wanted.set( id, ( wanted.get( id ) || 0 ) + 1 );
	for ( const [ id, n ] of wanted ) if ( n > ( have.get( id ) || 0 ) ) warnings.push( `Needs ${n - ( have.get( id ) || 0 )} more ${get( 'support', id ).name} rune(s).` );
	const entity = { ...game.world?.player, stats: after.stats, data: {} };
	const skillPreviews = plan.skills.bar.map( ( id ) => id ? skillTooltip( after.preview, id, { entity } ) : null );
	const beforeEntity = { ...game.world?.player, stats: before.stats, data: {} };
	const skillComparisons = skillPreviews.map( ( planned ) => {

		if ( ! planned ) return null;
		const current = live.skills.known.includes( planned.id ) ? skillTooltip( before.preview, planned.id, { entity: beforeEntity } ) : null;
		return { id: planned.id, current, planned, dpsDelta: current ? planned.dps - current.dps : null, manaDelta: current ? planned.manaCost - current.manaCost : null };

	} );
	for ( const id of plan.skills.bar.filter( Boolean ) ) {

		const d = get( 'skill', id );
		if ( d.weapon?.length && ! d.weapon.some( ( cls ) => after.stats.flags.has( 'wielding_' + cls ) ) ) warnings.push( `${d.name} requires ${d.weapon.join( ' / ' )}.` );

	}
	const spent = plan.tree.allocated.length - 1, total = pointsTotal( plan.level, plan.tree.bonus ), currentTotal = pointsTotal( live.level, live.tree.bonus );
	const stats = COMPARE_STATS.map( ( [ label, fn, decimals, unit = '' ] ) => ( { label, before: fn( before.stats ), after: fn( after.stats ), decimals, unit } ) );
	if ( stats.some( ( s ) => ! Number.isFinite( s.before ) || ! Number.isFinite( s.after ) ) || skillPreviews.some( ( s ) => s &&
		[ s.dps, s.manaCost, s.castTime, s.critChance, ...s.damage ].some( ( value ) => ! Number.isFinite( value ) ) ) ) throw new Error( 'Build preview produced nonfinite values' );
	return {
		level: plan.level, currentLevel: live.level, points: { spent, total, remaining: total - spent, currentTotal, shortfall: Math.max( 0, spent - currentTotal ),
			ascSpent: plan.tree.asc.id ? plan.tree.asc.allocated.length - 1 : 0, ascTotal: ascPointsTotal( plan.level ) },
		stats,
		deltas: compareStats( before.stats, after.stats ), skills: skillPreviews, skillComparisons, warnings
	};

}

export function allocatePlannedPath( plan, id ) {

	const next = copy( plan ), path = pathTo( { tree: next.tree }, id );
	if ( ! path?.length ) throw new Error( path ? 'Already planned' : 'Unknown passive node' );
	next.tree.allocated.push( ...path ); assertPlan( next );
	return next;

}

export function refundPlannedNode( plan, id ) {

	const next = copy( plan ), why = canRefund( { tree: next.tree }, id );
	if ( why ) throw new Error( why );
	next.tree.allocated = next.tree.allocated.filter( ( node ) => node !== id );
	return next;

}

// Catalog snapshots use median rolls. They neither consume an owned item nor
// advance the game's item identity sequence or random stream.
export function catalogBuildItem( id, slot, unique = false ) {

	const u = unique ? get( 'unique', id ) : null, b = get( 'itemBase', u?.base ?? id );
	if ( ! b || ( unique && ! u ) ) throw new Error( 'Unknown catalog item' );
	const median = ( range ) => Math.round( ( range[ 0 ] + range[ 1 ] ) * 5 ) / 10;
	const item = { uid: `plan:${slot}:${unique ? 'unique' : 'base'}:${id}`, base: b.id, ilvl: Math.max( b.level, u?.level ?? 1 ),
		rarity: unique ? 'unique' : 'normal', quality: 0, rev: 0, corrupted: false,
		roll: Object.fromEntries( Object.entries( b.defence || {} ).map( ( [ key, range ] ) => [ key, median( range ) ] ) ),
		implicits: ( b.implicit || [] ).map( ( m ) => ( { stat: m.stat, type: m.type, value: m.range ? median( m.range ) : m.value, ...( m.tags ? { tags: copy( m.tags ) } : {} ) } ) ), affixes: [] };
	if ( u ) { item.unique = u.id; item.uvals = u.mods.map( ( m ) => m.range ? median( m.range ) : m.value ); }
	return item;

}

export function ownedBuildItems( save ) {

	const items = [ ...Object.values( save.equipment ), ...save.inventory.items, ...save.stash.tabs.flatMap( ( tab ) => tab.items ) ].filter( Boolean );
	return [ ...new Map( items.map( ( item ) => [ item.uid, copy( item ) ] ) ).values() ];

}

export function encodeBuildPlan( plan ) {

	assertPlan( plan );
	const bytes = new TextEncoder().encode( JSON.stringify( plan ) );
	let binary = '';
	for ( const byte of bytes ) binary += String.fromCharCode( byte );
	const code = BUILD_PREFIX + btoa( binary ).replaceAll( '+', '-' ).replaceAll( '/', '_' ).replace( /=+$/, '' );
	if ( code.length > MAX_BUILD_CODE ) throw new Error( 'Build code is too large' );
	return code;

}

export function decodeBuildPlan( code ) {

	if ( typeof code !== 'string' || code.length > MAX_BUILD_CODE ) throw new Error( 'Invalid or oversized build code' );
	const raw = code.trim();
	if ( ! raw.startsWith( BUILD_PREFIX ) || ! /^[A-Za-z0-9_-]+$/.test( raw.slice( BUILD_PREFIX.length ) ) ) throw new Error( 'Expected a PRB1 build code' );
	let plan;
	try {

		const binary = atob( raw.slice( BUILD_PREFIX.length ).replaceAll( '-', '+' ).replaceAll( '_', '/' ) );
		plan = JSON.parse( new TextDecoder( 'utf-8', { fatal: true } ).decode( Uint8Array.from( binary, ( c ) => c.charCodeAt( 0 ) ) ) );

	} catch { throw new Error( 'Build code is not valid encoded JSON' ); }
	assertPlan( plan );
	// Only the documented fields survive import. In particular this is never a
	// save import: progression, resources, inventory and gold cannot enter play.
	return { version: BUILD_VERSION, name: plan.name, level: plan.level, tree: copy( plan.tree ), equipment: copy( plan.equipment ), skills: copy( plan.skills ) };

}

define( 'apiCommand', { id: 'planner.create', desc: 'Copy the character into an isolated build draft', args: {}, run: ( game ) => createBuildPlan( game.save ) } );
define( 'apiCommand', { id: 'planner.preview', desc: 'Validate a draft or build code and preview stat deltas without changing the character', args: { plan: 'build draft', code: 'optional PRB1 build code' },
	run: ( game, { plan, code } = {} ) => {

		try { return { ok: true, ...evaluateBuildPlan( game, code ? decodeBuildPlan( code ) : plan ) }; }
		catch ( error ) { return { ok: false, reason: error.message }; }

	} } );
