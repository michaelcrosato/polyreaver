// Pure XZ rectangle/corridor helpers shared by generation, collision and tests.
export const rect = ( x0, z0, x1, z1 ) => ( { x0, z0, x1, z1 } );
export const area = ( r ) => Math.max( 0, r.x1 - r.x0 ) * Math.max( 0, r.z1 - r.z0 );
export const overlaps = ( a, b, margin = 0 ) => a.x0 < b.x1 + margin && a.x1 > b.x0 - margin && a.z0 < b.z1 + margin && a.z1 > b.z0 - margin;
export const contains = ( r, x, z, margin = 0 ) => x >= r.x0 + margin && x <= r.x1 - margin && z >= r.z0 + margin && z <= r.z1 - margin;
export const inside = ( a, b ) => a.x0 >= b.x0 && a.x1 <= b.x1 && a.z0 >= b.z0 && a.z1 <= b.z1;

export function projectEdge( e, x, z ) {

	const t = Math.max( 0, Math.min( e.length, ( x - e.x ) * e.dx + ( z - e.z ) * e.dz ) );
	const lateral = ( x - e.x - e.dx * t ) * - e.dz + ( z - e.z - e.dz * t ) * e.dx;
	return { t, lateral, x: e.x + e.dx * t, z: e.z + e.dz * t };

}

export function edgeContains( e, x, z, radius = 0.28 ) {

	const t = ( x - e.x ) * e.dx + ( z - e.z ) * e.dz;
	const lateral = ( x - e.x ) * - e.dz + ( z - e.z ) * e.dx;
	return t >= - 0.01 && t <= e.length + 0.01 && Math.abs( lateral ) <= e.width / 2 - radius + 0.01;

}

export function makeSpatialIndex( rectangles, cellSize = 64 ) {

	const cells = new Map();
	for ( const [ i, r ] of rectangles.entries() ) {

		for ( let z = Math.floor( r.z0 / cellSize ); z <= Math.floor( r.z1 / cellSize ); z ++ ) {

			for ( let x = Math.floor( r.x0 / cellSize ); x <= Math.floor( r.x1 / cellSize ); x ++ ) {

				const key = `${x},${z}`;
				if ( ! cells.has( key ) ) cells.set( key, [] );
				cells.get( key ).push( i );

			}

		}

	}
	return { cells, cellSize };

}
