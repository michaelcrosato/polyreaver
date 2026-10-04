// Four bytes per 2 m cell: surface kind, walkability, neighborhood, reserved.
// Exact corridor/rectangle collision remains authoritative at cell boundaries.
import { contains, edgeContains } from './geometry.js';

export const ATLAS_SIZE = 1024;
export const SURFACE = { LAND: 0, ROAD: 1, WALK: 2, PARK: 3, WATER: 4, BRIDGE: 5, SQUARE: 6, PARKING: 7, ALLEY: 8, BUILDING: 9 };

export function buildSurface( city ) {

	const data = new Uint8Array( ATLAS_SIZE * ATLAS_SIZE * 4 );
	const visit = ( r, fn ) => {

		const x0 = Math.max( 0, Math.floor( ( r.x0 + 1024 ) / 2 ) ), x1 = Math.min( 1023, Math.ceil( ( r.x1 + 1024 ) / 2 ) );
		const z0 = Math.max( 0, Math.floor( ( r.z0 + 1024 ) / 2 ) ), z1 = Math.min( 1023, Math.ceil( ( r.z1 + 1024 ) / 2 ) );
		for ( let z = z0; z <= z1; z ++ ) for ( let x = x0; x <= x1; x ++ ) fn( ( z * 1024 + x ) * 4, x * 2 - 1023, z * 2 - 1023 );

	};
	const fill = ( r, kind, walk = 0 ) => visit( r, ( i, x, z ) => {

		if ( contains( r, x, z ) ) { data[ i ] = kind; data[ i + 1 ] = walk; }

	} );
	fill( city.water, SURFACE.WATER );
	for ( const b of city.blocks ) {

		visit( b, ( i ) => { data[ i + 2 ] = b.district; } );
		if ( b.zone === 'park' || b.zone === 'square' ) fill( b, b.zone === 'park' ? SURFACE.PARK : SURFACE.SQUARE, 1 );
		else if ( b.zone === 'industrial' ) fill( { x0: b.x0 + 26, z0: b.z0 + 26, x1: b.x1 - 26, z1: b.z1 - 26 }, SURFACE.PARKING );

	}
	for ( const r of city.roads ) fill( r, r.kind === 'alley' ? SURFACE.ALLEY : r.bridge ? SURFACE.BRIDGE : SURFACE.ROAD );
	for ( const e of city.graph.edges ) {

		if ( e.id % 2 ) continue;
		const r = { x0: Math.min( e.x, e.x + e.dx * e.length ) - e.width / 2, z0: Math.min( e.z, e.z + e.dz * e.length ) - e.width / 2, x1: Math.max( e.x, e.x + e.dx * e.length ) + e.width / 2, z1: Math.max( e.z, e.z + e.dz * e.length ) + e.width / 2 };
		visit( r, ( i, x, z ) => {

			if ( edgeContains( e, x, z, 0.28 ) ) {

				if ( e.kind !== 'crossing' ) data[ i ] = e.kind === 'bridge' ? SURFACE.BRIDGE : e.kind === 'alley' ? SURFACE.ALLEY : SURFACE.WALK;
				data[ i + 1 ] = 1;

			}

		} );

	}
	for ( const b of city.buildings ) fill( b, SURFACE.BUILDING );
	let walkCells = 0;
	for ( let i = 1; i < data.length; i += 4 ) walkCells += data[ i ];
	return { data, size: ATLAS_SIZE, metersPerCell: 2, walkableArea: walkCells * 4 };

}
