// Ribbons: everything drawn as a strip of triangles that changes every frame -
// melee slash crescents, weapon trails (from the rig's weapon tip history) and
// lightning beams. One dynamic, non-indexed geometry for all of them, rebuilt per
// frame on the CPU; only the used range is uploaded and drawn.
//
// The shader is shared: `v` (0..1 across the ribbon) gives soft edges and a hot
// core, so a flat strip reads as a glowing blade of light.

import * as THREE from 'three/webgpu';
import { attribute, float, sin, pow, PI } from 'three/tsl';

export class Ribbons {

	constructor( scene, maxVerts = 24000 ) {

		this.max = maxVerts;
		this.n = 0;
		const geo = new THREE.BufferGeometry();
		const mk = ( name, size ) => {

			const a = new THREE.BufferAttribute( new Float32Array( maxVerts * size ), size );
			a.setUsage( THREE.DynamicDrawUsage );
			geo.setAttribute( name, a );
			return a;

		};

		this.pos = mk( 'position', 3 );
		this.col = mk( 'aColor', 4 );
		this.uvs = mk( 'aUv', 2 );
		geo.setDrawRange( 0, 0 );
		geo.boundingSphere = new THREE.Sphere( new THREE.Vector3(), 1e6 );
		this.geo = geo;

		const C = attribute( 'aColor', 'vec4' ), U = attribute( 'aUv', 'vec2' );
		const across = sin( U.y.mul( PI ) );
		const mat = new THREE.MeshBasicNodeMaterial( { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide } );
		mat.colorNode = C.rgb.mul( float( 1 ).add( pow( across, 8 ).mul( 1.6 ) ) );
		mat.opacityNode = C.a.mul( pow( across, 1.5 ) );
		this.mesh = new THREE.Mesh( geo, mat );
		this.mesh.frustumCulled = false;
		this.mesh.renderOrder = 4;
		scene.add( this.mesh );

	}

	begin() {

		this.n = 0;

	}

	// one vertex
	v( x, y, z, r, g, b, a, u, w ) {

		if ( this.n >= this.max ) return;
		const i = this.n;
		this.pos.array[ i * 3 ] = x; this.pos.array[ i * 3 + 1 ] = y; this.pos.array[ i * 3 + 2 ] = z;
		const c = this.col.array;
		c[ i * 4 ] = r; c[ i * 4 + 1 ] = g; c[ i * 4 + 2 ] = b; c[ i * 4 + 3 ] = a;
		this.uvs.array[ i * 2 ] = u; this.uvs.array[ i * 2 + 1 ] = w;
		this.n ++;

	}

	// A quad from two cross-sections: (a0 -> a1) at the start, (b0 -> b1) at the end;
	// each section carries its own colour and alpha so strips can fade along their length.
	// inner < 1 dims the a0 / b0 side (a slash is brightest toward the blade's edge).
	quad( a0, a1, b0, b1, ca, aa, cb, ab, ua = 0, ub = 1, inner = 1 ) {

		if ( this.n + 6 > this.max || ( aa <= 0.002 && ab <= 0.002 ) ) return;
		this.v( a0.x, a0.y, a0.z, ca.r, ca.g, ca.b, aa * inner, ua, 0 );
		this.v( a1.x, a1.y, a1.z, ca.r, ca.g, ca.b, aa, ua, 1 );
		this.v( b1.x, b1.y, b1.z, cb.r, cb.g, cb.b, ab, ub, 1 );
		this.v( a0.x, a0.y, a0.z, ca.r, ca.g, ca.b, aa * inner, ua, 0 );
		this.v( b1.x, b1.y, b1.z, cb.r, cb.g, cb.b, ab, ub, 1 );
		this.v( b0.x, b0.y, b0.z, cb.r, cb.g, cb.b, ab * inner, ub, 0 );

	}

	end() {

		for ( const [ a, size ] of [ [ this.pos, 3 ], [ this.col, 4 ], [ this.uvs, 2 ] ] ) {

			a.clearUpdateRanges();
			a.addUpdateRange( 0, Math.max( 1, this.n ) * size );
			a.needsUpdate = true;

		}

		this.geo.setDrawRange( 0, this.n );
		this.mesh.visible = this.n > 0;

	}

}
