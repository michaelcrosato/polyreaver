// The design language. Every piece of content and every pluggable piece of code is
// a definition registered under a KIND:
//
//   define( 'monsterFamily', { id: 'ashwalker', name: 'Ashwalker', tags: [ 'fire', 'biped' ], ... } )
//   define( 'mechanic',      { id: 'powder-keg', name: 'Powder Keg', tags: [ 'hazard' ], setup, update } )
//   define( 'system',        { id: 'ai', order: 30, update( world, dt ) { ... } } )
//
// and generators never hard-code lists: they ask the registry, usually by tags
// ( query( 'affix', { tags: [ 'weapon' ], none: [ 'unique' ] } ) ). Adding a new
// monster part, affix, mechanic or theme is one define() call in a content file -
// every procedural system (endless levels, loot, bosses) picks it up.
//
// Conventions for every def:
//   id      unique within its kind (kebab-case)
//   name    display name
//   tags    array of strings used for procedural selection
//   weight  relative chance when picked at random (default 1)
//   level   minimum area level where it can appear (default 1)
// Kinds in use are listed in docs/GAME.md.

const kinds = new Map();
const listeners = new Map();

export function define( kind, def ) {

	if ( ! def || typeof def.id !== 'string' ) throw new Error( `define( '${kind}' ): def.id must be a string` );
	if ( ! kinds.has( kind ) ) kinds.set( kind, new Map() );
	def.kind = kind;
	def.tags = def.tags || [];
	kinds.get( kind ).set( def.id, def );
	for ( const fn of listeners.get( kind ) || [] ) fn( def );
	return def;

}

export function defineAll( kind, defs ) {

	return defs.map( ( d ) => define( kind, d ) );

}

export function get( kind, id ) {

	return kinds.get( kind )?.get( id );

}

export function need( kind, id ) {

	const d = get( kind, id );
	if ( ! d ) throw new Error( `unknown ${kind} '${id}'` );
	return d;

}

export function all( kind ) {

	return [ ...( kinds.get( kind )?.values() || [] ) ];

}

// tags: must have all; any: must have at least one; none: must have none of these;
// level: def.level (default 1) <= level; filter: extra predicate.
export function query( kind, { tags = [], any = [], none = [], level = Infinity, filter = null } = {} ) {

	return all( kind ).filter( ( d ) =>
		tags.every( ( t ) => d.tags.includes( t ) ) &&
		( ! any.length || any.some( ( t ) => d.tags.includes( t ) ) ) &&
		! none.some( ( t ) => d.tags.includes( t ) ) &&
		( d.level ?? 1 ) <= level &&
		( ! filter || filter( d ) ) );

}

export function kindsList() {

	return [ ...kinds.keys() ].map( ( k ) => ( { kind: k, count: kinds.get( k ).size } ) );

}

// Called for every def of `kind`, including ones defined later.
export function onDefine( kind, fn ) {

	if ( ! listeners.has( kind ) ) listeners.set( kind, [] );
	listeners.get( kind ).push( fn );
	for ( const d of all( kind ) ) fn( d );

}
