// Stat engine - the arithmetic behind every item affix, passive node, buff, aura
// and difficulty slider. It follows the Path of Exile model because that model
// composes cleanly no matter how many sources pile up:
//
//   value = ( base + Σ flat ) × ( 1 + Σ increased / 100 ) × Π ( 1 + more / 100 )
//
// * "increased" modifiers ADD to each other (+20% and +30% = +50%),
// * "more" modifiers MULTIPLY (20% more and 30% more = 56% more),
// * an "override" sets the value outright (keystones like "life is always 1").
//
// A modifier can be TAGGED: { stat: 'damage', type: 'inc', value: 20, tags: [ 'fire' ] }
// is "20% increased fire damage". It applies to a query whose tags include every
// one of its tags, so get( 'damage', [ 'spell', 'area', 'fire' ] ) picks it up but
// get( 'damage', [ 'attack', 'physical' ] ) does not. Conditional modifiers carry
// `when: 'flagName'` and only count while that flag is set (low life, moving,
// recently killed... - systems set flags with setFlag()).
//
// Modifiers are grouped by SOURCE ('item:helm', 'tree', 'status:shock', 'tuning')
// so a whole source can be replaced in one call when gear changes or a buff ends.

export const DAMAGE_TYPES = [ 'physical', 'fire', 'cold', 'lightning', 'chaos' ];
export const ELEMENTS = [ 'fire', 'cold', 'lightning' ];

const NO_TAGS = [];

export class StatBlock {

	constructor( base = {} ) {

		this.base = { ...base };
		this.sources = new Map(); // source -> mods[]
		this.flags = new Set();
		this._mods = [];
		this._cache = new Map();
		this.version = 0;

	}

	_dirty() {

		this._cache.clear();
		this.version ++;

	}

	setBase( stat, value ) {

		this.base[ stat ] = value;
		this._dirty();

	}

	// Replace every modifier from `source` with `mods` (pass [] or null to remove).
	setSource( source, mods ) {

		if ( mods && mods.length ) this.sources.set( source, mods.map( ( m ) => ( { ...m, source } ) ) );
		else this.sources.delete( source );
		this._mods = [ ...this.sources.values() ].flat();
		this._dirty();

	}

	hasSource( source ) {

		return this.sources.has( source );

	}

	setFlag( flag, on = true ) {

		if ( on === this.flags.has( flag ) ) return;
		if ( on ) this.flags.add( flag ); else this.flags.delete( flag );
		this._dirty();

	}

	_applies( m, stat, tags ) {

		if ( m.stat !== stat ) return false;
		if ( m.when && ! this.flags.has( m.when ) ) return false;
		if ( m.tags ) for ( const t of m.tags ) if ( ! tags.includes( t ) ) return false;
		return true;

	}

	get( stat, tags = NO_TAGS ) {

		const key = tags.length ? stat + '|' + tags.join( ',' ) : stat;
		const hit = this._cache.get( key );
		if ( hit !== undefined ) return hit;
		const b = this.breakdown( stat, tags, false );
		this._cache.set( key, b.total );
		return b.total;

	}

	// Same arithmetic as get(), but returns the parts: tooltips, the character sheet
	// and the agent inspector use it to explain where a number comes from.
	breakdown( stat, tags = NO_TAGS, withMods = true ) {

		let flat = 0, inc = 0, more = 1, override = null;
		const used = withMods ? [] : null;
		for ( const m of this._mods ) {

			if ( ! this._applies( m, stat, tags ) ) continue;
			if ( m.type === 'flat' ) flat += m.value;
			else if ( m.type === 'inc' ) inc += m.value;
			else if ( m.type === 'more' ) more *= 1 + m.value / 100;
			else if ( m.type === 'override' ) override = m.value;
			if ( used ) used.push( m );

		}

		const base = this.base[ stat ] ?? 0;
		const total = override !== null ? override : ( base + flat ) * Math.max( 0, 1 + inc / 100 ) * more;
		return { stat, tags, base, flat, inc, more, override, total, mods: used };

	}

	// All modifiers (for save files, inspectors and diffing builds).
	list() {

		return this._mods.slice();

	}

}

// Human-readable text for a modifier: "+12 to maximum life", "20% increased fire damage".
// Content can give a def its own `text`; this is the fallback used everywhere else.
export function modText( m ) {

	if ( m.text ) return m.text;
	const what = ( m.tags && m.tags.length ? m.tags.join( ' ' ) + ' ' : '' ) + m.stat.replace( /_/g, ' ' );
	const v = Math.round( m.value * 10 ) / 10;
	switch ( m.type ) {

		case 'flat': return `${v >= 0 ? '+' : ''}${v} to ${what}`;
		case 'inc': return `${Math.abs( v )}% ${v >= 0 ? 'increased' : 'reduced'} ${what}`;
		case 'more': return `${Math.abs( v )}% ${v >= 0 ? 'more' : 'less'} ${what}`;
		case 'override': return `${what} is always ${v}`;
		default: return what;

	}

}
