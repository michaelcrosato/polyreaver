// Dynamic light budget. A level has dozens to hundreds of light sources (torches,
// braziers, lava, crystals, lit mechanic objects, VFX) but a forward renderer pays
// for every light on every pixel, and changing the NUMBER of lights recompiles
// shaders. So: a FIXED pool of PointLights (count never changes), reassigned every
// frame to the sources nearest the player, faded by distance so swaps are invisible,
// with per-source flicker. Everything else glows through emissive materials and
// additive halos, which cost almost nothing.
//
// Pool size: 12 on desktop, 6 on phones; '#lights=N' overrides; '#clustered' switches
// the renderer to three's ClusteredLighting (Forward+) and raises the pool to 48 -
// the engine showcase setting for the lamp-lit town.
//
// Other features can add transient lights for one frame:
//   rc.dynLights.push( { x, y, z, color, intensity, range } )

import * as THREE from 'three/webgpu';

export class LightPool {

	constructor( scene, size ) {

		this.lights = [];
		for ( let i = 0; i < size; i ++ ) {

			const l = new THREE.PointLight( 0xffffff, 0, 10, 2 );
			l.name = 'pool-light-' + i;
			scene.add( l );
			this.lights.push( l );

		}

		this._cands = [];

	}

	// sources: [ { x, y, z, color (THREE.Color | hex), intensity, range, flicker } ]
	update( sources, fx, fz, time, maxDist = 30 ) {

		const c = this._cands;
		c.length = 0;
		for ( const s of sources ) {

			const d = Math.hypot( s.x - fx, s.z - fz );
			if ( d > maxDist + ( s.range ?? 10 ) * 0.3 ) continue;
			s._d = d;
			c.push( s );

		}

		c.sort( ( a, b ) => a._d - b._d );
		for ( let i = 0; i < this.lights.length; i ++ ) {

			const l = this.lights[ i ], s = c[ i ];
			if ( ! s ) {

				l.intensity = 0;
				continue;

			}

			const fade = 1 - smooth( maxDist * 0.6, maxDist, s._d );
			const seed = s._seed ?? ( s._seed = ( s.x * 12.9898 + s.z * 78.233 ) % 6.283 );
			const f = s.flicker ?? 0;
			const flick = f ? 1 - f * ( 0.5 + 0.25 * Math.sin( time * 9.1 + seed * 7 ) + 0.25 * Math.sin( time * 23.3 + seed * 13 ) ) : 1;
			l.position.set( s.x, s.y ?? 2, s.z );
			if ( s.color?.isColor ) l.color.copy( s.color ); else l.color.set( s.color ?? 0xffffff );
			l.intensity = ( s.intensity ?? 20 ) * fade * flick;
			l.distance = s.range ?? 10;

		}

	}

	dispose( scene ) {

		for ( const l of this.lights ) scene.remove( l );
		this.lights = [];

	}

}

function smooth( a, b, x ) {

	const t = Math.max( 0, Math.min( 1, ( x - a ) / ( b - a ) ) );
	return t * t * ( 3 - 2 * t );

}
