// Generation parameters are validated before workers or GPU allocations start.
export const CITY_VERSION = 1;
export const NO_EDGE = 0xffffffff;
export const CITY_DEFAULTS = Object.freeze( {
	seed: 'harbor-100k', size: 2048, population: 100000, blocks: 16,
	sidewalk: 10, riverColumn: 8, decoration: 1
} );

export function cityConfig( input = {} ) {

	const c = { ...CITY_DEFAULTS, ...input };
	c.seed = String( c.seed ).slice( 0, 128 );
	for ( const key of [ 'size', 'population', 'blocks', 'sidewalk', 'riverColumn', 'decoration' ] ) {

		if ( ! Number.isFinite( c[ key ] ) ) throw new Error( `Invalid city ${key}` );

	}
	if ( c.size !== 2048 || c.blocks !== 16 ) throw new Error( 'This city version supports a 2048 m map with 16 block intervals per axis.' );
	if ( ! Number.isInteger( c.population ) || c.population < 1 || c.population > 100000 ) throw new Error( 'Population must be an integer from 1 to 100000.' );
	if ( c.sidewalk < 8 || c.sidewalk > 14 ) throw new Error( 'Sidewalk width must be 8–14 m for the supported outdoor population.' );
	if ( ! Number.isInteger( c.riverColumn ) || c.riverColumn < 5 || c.riverColumn > 10 ) throw new Error( 'River column must be 5–10.' );
	if ( c.decoration < 0 || c.decoration > 2 ) throw new Error( 'Decoration must be 0–2.' );
	return c;

}
