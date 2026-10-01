// Ground decals: every flat shape painted on the floor - enemy TELEGRAPHS (the
// fairness layer: a shape that fills up until the hit lands), burning / frozen /
// poisoned ground, shockwave rings and scorch marks. One instanced quad per decal;
// the fragment shader draws the shape (circle, ring, cone, line) and the style
// procedurally, so hundreds of telegraphs cost one draw.
//
// Per instance:  matrix   position, facing (local +z = forward), size
//                aShape   x shape (0 circle 1 ring 2 cone 3 line), y inner radius (0..1),
//                         z cone half-angle (rad), w fill 0..1
//                aCol     rgb colour, a opacity
//                aStyle   x style, y age (s), z rim width (fraction of the size), w seed
// Styles: 0 enemy telegraph, 1 friendly target, 2 fire, 3 frost, 4 poison,
//         5 shockwave ring, 6 lightning field, 7 scorch (dark layer), 8 soft glow pool

import * as THREE from 'three/webgpu';
import { attribute, uv, vec3, vec4, float, floor, length, abs, atan, smoothstep, step, max, min, mix, sin, select, positionWorld, time, mx_noise_float, If, Fn } from 'three/tsl';

export const SHAPE = { circle: 0, ring: 1, cone: 2, line: 3 };
export const STYLE = { telegraph: 0, target: 1, fire: 2, frost: 3, poison: 4, wave: 5, storm: 6, scorch: 7, glow: 8 };

const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpP = new THREE.Vector3(), tmpS = new THREE.Vector3();
const UP = new THREE.Vector3( 0, 1, 0 );

class DecalLayer {

	constructor( scene, capacity, blending, y, order ) {

		this.max = capacity;
		this.n = 0;
		this.y = y;
		const geo = new THREE.PlaneGeometry( 1, 1 ).rotateX( - Math.PI / 2 );
		const mk = ( name ) => {

			const a = new THREE.InstancedBufferAttribute( new Float32Array( capacity * 4 ), 4 );
			a.setUsage( THREE.DynamicDrawUsage );
			geo.setAttribute( name, a );
			return a;

		};

		this.aShape = mk( 'aShape' );
		this.aCol = mk( 'aCol' );
		this.aStyle = mk( 'aStyle' );

		const S = attribute( 'aShape', 'vec4' ), C = attribute( 'aCol', 'vec4' ), T = attribute( 'aStyle', 'vec4' );
		const mat = new THREE.MeshBasicNodeMaterial( { transparent: true, depthWrite: false, blending, side: THREE.DoubleSide } );
		mat.polygonOffset = true;
		mat.polygonOffsetFactor = - 2;
		mat.polygonOffsetUnits = - 2;

		// Two TSL rules matter here:
		//  * instance attributes reach the fragment shader as interpolated varyings, so
		//    integer codes are ROUNDED before comparing (2.0 can arrive as 1.99999);
		//  * a value shared by several If blocks must be .toVar()'d up front - otherwise
		//    it is computed inside the first block that uses it and is garbage in the
		//    others. Noise is the opposite: made fresh per style block, so it is only
		//    paid for by the styles that use it.
		const shade = Fn( () => {

			// local coordinates: s across, f forward (the plane's -v is local +z after rotateX)
			const U = uv().sub( 0.5 ).mul( 2 ).toVar();
			const s = U.x.toVar(), f = U.y.negate().toVar();
			const r = length( U ).toVar();
			const shape = floor( S.x.add( 0.5 ) ).toVar(), style = floor( T.x.add( 0.5 ) ).toVar();
			const inner = S.y, half = S.z, fill = S.w, age = T.y, rimW = T.z;

			// inside mask + distance to the nearest edge (0 at the edge)
			const isRing = shape.equal( 1 ).toVar(), isCone = shape.equal( 2 ).toVar(), isLine = shape.equal( 3 ).toVar();
			const edge = float( 1 ).sub( r ).toVar();
			// (block bodies: an If callback that returns a value would become a `return`)
			If( isRing, () => {

				edge.assign( min( edge, r.sub( inner ) ) );

			} );
			If( isCone, () => {

				edge.assign( min( edge, half.sub( abs( atan( s, f ) ) ).mul( r ).mul( 0.9 ) ) );

			} );
			If( isLine, () => {

				edge.assign( min( float( 1 ).sub( abs( s ) ), float( 1 ).sub( abs( f ) ) ) );

			} );
			const inside = step( 0, edge ).toVar();
			// progress coordinate used by the fill: radius, or along the line
			const prog = select( isLine, f.add( 1 ).mul( 0.5 ), select( isRing, r.sub( inner ).div( max( float( 1 ).sub( inner ), 0.01 ) ), r ) ).toVar();

			const rim = float( 1 ).sub( smoothstep( 0, rimW, edge ) ).mul( inside ).toVar();
			const filled = step( prog, fill ).mul( inside ).toVar();
			const front = float( 1 ).sub( smoothstep( 0, 0.06, abs( prog.sub( fill ) ) ) ).mul( inside ).mul( step( 0.02, fill ) ).toVar();
			const soft = smoothstep( 0, 0.25, edge ).mul( inside ).toVar();
			const noiseA = () => mx_noise_float( vec3( positionWorld.x.mul( 1.3 ), positionWorld.z.mul( 1.3 ), time.mul( 1.6 ).add( T.w ) ) );
			const noiseB = () => mx_noise_float( vec3( positionWorld.x.mul( 3.1 ), positionWorld.z.mul( 3.1 ), time.mul( 0.7 ) ) );
			const a = float( 0 ).toVar();
			const rgb = C.rgb.toVar();

			// 0 telegraph: faint area, filling body, bright leading edge, rim that pulses near the end
			If( style.equal( 0 ), () => {

				const urgent = smoothstep( 0.75, 1, fill );
				const pulse = float( 1 ).add( sin( time.mul( 28 ) ).mul( 0.35 ).mul( urgent ) );
				a.assign( inside.mul( 0.1 ).add( filled.mul( 0.22 ) ).add( front.mul( 0.7 ) ).add( rim.mul( 0.85 ).mul( pulse ) ) );

			} );
			// 1 friendly target: thin rim + soft sweep
			If( style.equal( 1 ), () => {

				a.assign( rim.mul( 0.7 ).add( filled.mul( 0.08 ) ).add( front.mul( 0.4 ) ) );

			} );
			// 2 fire: licking flames from noise, hotter in the middle
			If( style.equal( 2 ), () => {

				const flame = smoothstep( - 0.1, 0.6, noiseA().add( noiseB().mul( 0.5 ) ) );
				rgb.assign( mix( C.rgb, vec3( 1.6, 1.2, 0.5 ), flame.mul( flame ) ) );
				a.assign( soft.mul( flame.mul( 0.9 ).add( 0.15 ) ) );

			} );
			// 3 frost: pale sheet with bright crack lines
			If( style.equal( 3 ), () => {

				const crack = float( 1 ).sub( smoothstep( 0, 0.06, abs( noiseB() ) ) );
				a.assign( soft.mul( crack.mul( 0.9 ).add( 0.18 ) ) );

			} );
			// 4 poison: slow churning cloud
			If( style.equal( 4 ), () => {

				const cloud = smoothstep( - 0.3, 0.7, noiseA() );
				a.assign( soft.mul( cloud.mul( 0.55 ).add( 0.1 ) ) );

			} );
			// 5 shockwave: a ring travelling outward (fill = its radius), fading as it grows
			If( style.equal( 5 ), () => {

				const band = float( 1 ).sub( smoothstep( 0, 0.1, abs( prog.sub( fill ) ) ) );
				a.assign( band.mul( inside ).mul( float( 1 ).sub( fill ) ).mul( 1.4 ) );

			} );
			// 6 storm: flickering violet field
			If( style.equal( 6 ), () => {

				const flick = step( 0.35, noiseB().add( sin( time.mul( 40 ).add( T.w ) ).mul( 0.3 ) ) );
				a.assign( soft.mul( flick.mul( 0.6 ).add( 0.12 ) ).add( rim.mul( 0.5 ) ) );

			} );
			// 7 scorch: dark burnt ground (normal blending layer)
			If( style.equal( 7 ), () => {

				a.assign( soft.mul( smoothstep( - 0.6, 0.4, noiseB() ) ).mul( 0.7 ) );

			} );
			// 8 glow pool: soft light on the floor
			If( style.equal( 8 ), () => {

				a.assign( inside.mul( float( 1 ).sub( r ) ).mul( 0.6 ) );

			} );

			return vec4( rgb, a.mul( C.a ).mul( smoothstep( 0, 0.06, age ) ) );

		} );

		const out = shade();
		mat.colorNode = out.rgb;
		mat.opacityNode = out.a;
		this.mesh = new THREE.InstancedMesh( geo, mat, capacity );
		this.mesh.instanceMatrix.setUsage( THREE.DynamicDrawUsage );
		this.mesh.count = 0;
		this.mesh.frustumCulled = false;
		this.mesh.renderOrder = order;
		scene.add( this.mesh );

	}

	// x, z centre; rot facing (rad, 0 = +z); sx, sz full size in metres
	push( x, z, rot, sx, sz, shape, inner, half, fill, color, alpha, style, age, rimW, seed = 0 ) {

		if ( this.n >= this.max ) return;
		const i = this.n;
		tmpQ.setFromAxisAngle( UP, rot );
		this.mesh.setMatrixAt( i, tmpM.compose( tmpP.set( x, this.y + i * 0.0004, z ), tmpQ, tmpS.set( sx, 1, sz ) ) );
		const o = i * 4;
		const S = this.aShape.array, C = this.aCol.array, T = this.aStyle.array;
		S[ o ] = shape; S[ o + 1 ] = inner; S[ o + 2 ] = half; S[ o + 3 ] = fill;
		C[ o ] = color.r; C[ o + 1 ] = color.g; C[ o + 2 ] = color.b; C[ o + 3 ] = alpha;
		T[ o ] = style; T[ o + 1 ] = age; T[ o + 2 ] = rimW; T[ o + 3 ] = seed;
		this.n ++;

	}

	end() {

		this.mesh.count = this.n;
		this.mesh.instanceMatrix.needsUpdate = true;
		for ( const a of [ this.aShape, this.aCol, this.aStyle ] ) a.needsUpdate = true;
		this.n = 0;

	}

}

export class Decals {

	constructor( scene, capacity = 512 ) {

		this.glow = new DecalLayer( scene, capacity, THREE.AdditiveBlending, 0.045, 3 );
		this.dark = new DecalLayer( scene, 128, THREE.NormalBlending, 0.03, 2 );

	}

	// Convenience: a decal for a sim area-like shape description.
	//   d = { x, z, shape, radius, inner, angle (deg), dir, length, width }
	shape( d, fill, color, alpha, style, age = 1, seed = 0 ) {

		const layer = style === STYLE.scorch ? this.dark : this.glow;
		if ( d.shape === 'line' ) {

			const fx = Math.sin( d.dir ), fz = Math.cos( d.dir );
			layer.push( d.x + fx * d.length / 2, d.z + fz * d.length / 2, d.dir, d.width, d.length, SHAPE.line, 0, 0, fill, color, alpha, style, age, 0.25 / Math.max( 0.5, d.width ), seed );
			return;

		}

		const r = d.radius;
		const shape = SHAPE[ d.shape ] ?? 0;
		const inner = d.shape === 'ring' ? Math.min( 0.98, ( d.inner ?? 0 ) / r ) : 0;
		layer.push( d.x, d.z, d.dir ?? 0, r * 2, r * 2, shape, inner, ( d.angle ?? 90 ) * Math.PI / 360, fill, color, alpha, style, age, Math.min( 0.5, 0.22 / Math.max( 0.3, r ) ), seed );

	}

	end() {

		this.glow.end();
		this.dark.end();

	}

}
