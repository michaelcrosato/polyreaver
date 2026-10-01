// Camera-facing quads in one instanced draw: projectile halos (soft additive glow)
// and damage-number glyphs (a canvas atlas). Every instance is rewritten each frame
// from CPU arrays - cheap for a few thousand quads - and the vertex shader does the
// billboarding itself: it moves the quad centre into view space and offsets the
// corners there, so quads always face the camera without a per-quad matrix.
//
// Per instance:  aPos   xyz centre, w size (metres)
//                aCol   rgb colour, a opacity
//                aParam x glyph index (atlas) / unused, y rotation (rad), z width stretch, w x offset (in sizes)

import * as THREE from 'three/webgpu';
import { Fn, attribute, positionGeometry, cameraViewMatrix, cameraProjectionMatrix, vec2, vec4, float, uv, length, smoothstep, texture, floor, mod, cos, sin } from 'three/tsl';

export class Billboards {

	constructor( scene, max, { blending = THREE.AdditiveBlending, atlas = null, cols = 16, rows = 4, depthTest = true, renderOrder = 6 } = {} ) {

		this.max = max;
		this.n = 0;
		const geo = new THREE.PlaneGeometry( 1, 1 );
		const mk = ( name ) => {

			const a = new THREE.InstancedBufferAttribute( new Float32Array( max * 4 ), 4 );
			a.setUsage( THREE.DynamicDrawUsage );
			geo.setAttribute( name, a );
			return a;

		};

		this.aPos = mk( 'aPos' );
		this.aCol = mk( 'aCol' );
		this.aParam = mk( 'aParam' );

		const mat = new THREE.MeshBasicNodeMaterial( { transparent: true, depthWrite: false, depthTest, blending, side: THREE.DoubleSide } );
		const P = attribute( 'aPos', 'vec4' ), C = attribute( 'aCol', 'vec4' ), Q = attribute( 'aParam', 'vec4' );
		mat.vertexNode = Fn( () => {

			const c = positionGeometry.xy.mul( vec2( Q.z, 1 ) ).add( vec2( Q.w, 0 ) );
			const cs = cos( Q.y ), sn = sin( Q.y );
			const r = vec2( c.x.mul( cs ).sub( c.y.mul( sn ) ), c.x.mul( sn ).add( c.y.mul( cs ) ) );
			const view = cameraViewMatrix.mul( vec4( P.xyz, 1 ) );
			return cameraProjectionMatrix.mul( vec4( view.xy.add( r.mul( P.w ) ), view.z, 1 ) );

		} )();

		if ( atlas ) {

			// glyph cell -> atlas uv (row 0 at the top of the canvas); the index arrives as an
			// interpolated varying, so round it before splitting into column and row
			const idx = floor( Q.x.add( 0.5 ) );
			const cell = vec2( mod( idx, cols ), floor( idx.div( cols ) ) );
			const tuv = vec2( cell.x.add( uv().x ).div( cols ), float( 1 ).sub( cell.y.add( float( 1 ).sub( uv().y ) ).div( rows ) ) );
			const t = texture( atlas, tuv );
			mat.colorNode = t.rgb.mul( C.rgb );
			mat.opacityNode = t.a.mul( C.a );

		} else {

			const d = length( uv().sub( 0.5 ) ).mul( 2 );
			const glow = float( 1 ).sub( smoothstep( 0, 1, d ) );
			mat.colorNode = C.rgb;
			mat.opacityNode = glow.mul( glow ).mul( C.a );

		}

		this.mesh = new THREE.Mesh( geo, mat );
		this.mesh.count = 0;
		this.mesh.frustumCulled = false;
		this.mesh.renderOrder = renderOrder;
		scene.add( this.mesh );

	}

	begin() {

		this.n = 0;

	}

	push( x, y, z, size, r, g, b, a, glyph = 0, rot = 0, stretch = 1, offset = 0 ) {

		if ( this.n >= this.max ) return;
		const i = this.n * 4;
		const P = this.aPos.array, C = this.aCol.array, Q = this.aParam.array;
		P[ i ] = x; P[ i + 1 ] = y; P[ i + 2 ] = z; P[ i + 3 ] = size;
		C[ i ] = r; C[ i + 1 ] = g; C[ i + 2 ] = b; C[ i + 3 ] = a;
		Q[ i ] = glyph; Q[ i + 1 ] = rot; Q[ i + 2 ] = stretch; Q[ i + 3 ] = offset;
		this.n ++;

	}

	end() {

		this.mesh.count = this.n;
		for ( const a of [ this.aPos, this.aCol, this.aParam ] ) {

			a.clearUpdateRanges();
			a.addUpdateRange( 0, Math.max( 1, this.n ) * 4 );
			a.needsUpdate = true;

		}

	}

}
