// Supported rolled-value bounds, including the real crafting corruption outcomes.
// Identity and numeric shape checks live in save.js; these functions validate the
// values against registered content instead of accepting arbitrary finite stats.
import { get } from '../../core/registry.js';
import { CORRUPT_IMPLICITS } from './data/currency.js';

export function inRollRange( value, range, multiplier = 1, scale = 1 ) {

	if ( ! Number.isFinite( value ) || Math.abs( value ) > 1e9 || ! range ) return false;
	const integer = range.every( Number.isInteger ), precision = integer ? 1 : range[ 1 ] < 1 ? 100 : 10;
	const lo = Math.round( range[ 0 ] * multiplier * precision ) / precision * scale;
	const hi = Math.round( range[ 1 ] * multiplier * precision ) / precision * scale;
	const tolerance = scale === 1 ? 0.051 : 0.501;
	return value >= lo - tolerance && value <= hi + tolerance;

}

export function validAffixRoll( item, affix ) {

	const def = get( 'affix', affix.id ), base = get( 'itemBase', item.base );
	if ( ! def || ! base || ! Number.isInteger( affix.tier ) || affix.tier < 0 || affix.tier >= def.tiers.length || ! Array.isArray( affix.values ) || affix.values.length !== def.stats.length ) return false;
	const tier = def.tiers[ affix.tier ], multiplier = base.hands === 2 ? def.twoHand ?? 1 : 1;
	if ( tier.level > item.ilvl || ! def.tags.some( ( tag ) => base.tags.includes( tag ) ) ) return false;
	const empowered = item.corrupted && item.corruptOutcome === 'empowered';
	return affix.values.every( ( value, index ) => inRollRange( value, tier.ranges[ def.same ? 0 : index ], multiplier ) || empowered && inRollRange( value, tier.ranges[ def.same ? 0 : index ], multiplier, 1.25 ) ) && ( ! def.same || affix.values.every( ( value ) => value === affix.values[ 0 ] ) );

}

export function validImplicitRoll( item, mod ) {

	const base = get( 'itemBase', item.base );
	if ( ! base ) return false;
	let sources = base.implicit || [];
	if ( mod.corrupt && item.corrupted ) {

		sources = CORRUPT_IMPLICITS.filter( ( source ) => source.slots.includes( base.slot ) );
		// Vaal on a base without matching corruption choices uses the full pool.
		if ( ! sources.length ) sources = CORRUPT_IMPLICITS;

	}
	return sources.some( ( source ) => source.stat === mod.stat && source.type === mod.type && JSON.stringify( source.tags || [] ) === JSON.stringify( mod.tags || [] ) && inRollRange( mod.value, source.range || [ source.value, source.value ] ) );

}

export function validUniqueRoll( item, value, index ) {

	const mod = get( 'unique', item.unique )?.mods[ index ];
	const scale = item.corrupted && item.corruptOutcome === 'bricked' ? 0.8 : 1;
	return !! mod && inRollRange( value, mod.range || [ mod.value, mod.value ], 1, scale );

}
