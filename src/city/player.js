// Swept conservative circle/AABB collision with sliding. The spatial index limits
// checks to the swept region; population data is never read back for movement.
import { makeSpatialIndex } from './geometry.js';

export function sweepBox( x, z, dx, dz, b, radius = 0.35 ) {

	let enter = 0, exit = 1, nx = 0, nz = 0;
	for ( const [ p, d, lo, hi, axis ] of [ [ x, dx, b.x0 - radius, b.x1 + radius, 0 ], [ z, dz, b.z0 - radius, b.z1 + radius, 1 ] ] ) {

		if ( Math.abs( d ) < 1e-12 ) { if ( p < lo || p > hi ) return null; continue; }
		let a = ( lo - p ) / d, c = ( hi - p ) / d;
		const sign = d > 0 ? - 1 : 1;
		if ( a > c ) [ a, c ] = [ c, a ];
		if ( a > enter ) { enter = a; nx = axis === 0 ? sign : 0; nz = axis === 1 ? sign : 0; }
		exit = Math.min( exit, c );
		if ( enter > exit ) return null;

	}
	return enter >= 0 && enter <= 1 && exit >= 0 && ( nx || nz ) ? { t: enter, nx, nz } : null;

}

export class CityCollision {

	constructor( city, { props = true } = {} ) {

		this.city = city;
		this.rectangles = [ ...city.buildings ];
		// Three bridge apertures divide the water obstruction into four rectangles.
		let z = city.water.z0;
		for ( const row of city.bridgeRows ) {

			const width = city.halves[ row ] + city.config.sidewalk;
			this.rectangles.push( { ...city.water, z0: z, z1: city.zs[ row ] - width } );
			z = city.zs[ row ] + width;

		}
		this.rectangles.push( { ...city.water, z0: z } );
		for ( const p of props ? city.props : [] ) {

			const x = p.type === 'bench' ? .9 : p.type === 'parked-car' ? .85 : p.type === 'tree' ? .15 : p.type === 'lamp' ? .08 : p.type === 'signal-post' ? .05 : .25;
			const z = p.type === 'bench' ? .3 : p.type === 'parked-car' ? 1.8 : x;
			this.rectangles.push( { x0: p.x - x, x1: p.x + x, z0: p.z - z, z1: p.z + z } );

		}
		this.index = makeSpatialIndex( this.rectangles );

	}

	candidates( x0, z0, x1, z1, radius = 1 ) {

		const found = new Set(), { cells, cellSize } = this.index;
		for ( let z = Math.floor( ( Math.min( z0, z1 ) - radius ) / cellSize ); z <= Math.floor( ( Math.max( z0, z1 ) + radius ) / cellSize ); z ++ ) {

			for ( let x = Math.floor( ( Math.min( x0, x1 ) - radius ) / cellSize ); x <= Math.floor( ( Math.max( x0, x1 ) + radius ) / cellSize ); x ++ ) {

				for ( const id of cells.get( `${x},${z}` ) || [] ) found.add( id );

			}

		}
		return found;

	}

	move( position, dx, dz ) {

		let x = position.x, z = position.z;
		for ( let iteration = 0; iteration < 3 && Math.hypot( dx, dz ) > 1e-6; iteration ++ ) {

			let first = null;
			for ( const id of this.candidates( x, z, x + dx, z + dz ) ) {

				const hit = sweepBox( x, z, dx, dz, this.rectangles[ id ] );
				if ( hit && ( ! first || hit.t < first.t ) ) first = hit;

			}
			if ( ! first ) { x += dx; z += dz; break; }
			const t = Math.max( 0, first.t - 0.001 );
			x += dx * t; z += dz * t;
			dx *= 1 - t; dz *= 1 - t;
			const into = dx * first.nx + dz * first.nz;
			if ( into < 0 ) { dx -= into * first.nx; dz -= into * first.nz; }

		}
		position.x = Math.max( - 1018, Math.min( 1018, x ) );
		position.z = Math.max( - 1018, Math.min( 1018, z ) );

	}

}
