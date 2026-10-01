// The Swarm, drawn: thousands of ashlings in ONE instanced draw. The sim keeps
// them in typed arrays (mechanics/swarm.js); every frame we copy position, heading
// and a wing phase into one vec4 per ashling and the vertex shader does the rest -
// turning each body to its heading, flapping the wings and bobbing it in the air.
// Dead slots collapse to nothing, so the draw count never has to shrink.

import * as THREE from 'three/webgpu';
import { attribute, vec3, float, sin, cos, abs, positionLocal, smoothstep } from 'three/tsl';
import { U } from './materials.js';
import { bakeModel } from './bake.js';

const ASHLING = { id: 'ashling', parts: [
	{ shape: 'tetra', pos: [ 0, 0, 0.05 ], scale: [ 0.32, 0.26, 0.42 ], color: '#3a302a' },
	{ shape: 'sphere', pos: [ 0, 0.02, - 0.2 ], scale: [ 0.2, 0.18, 0.24 ], color: '#ff8a2a', emissive: 1 },
	{ shape: 'box', pos: [ 0.26, 0.08, 0 ], scale: [ 0.4, 0.02, 0.18 ], color: '#6a5a50' },
	{ shape: 'box', pos: [ - 0.26, 0.08, 0 ], scale: [ 0.4, 0.02, 0.18 ], color: '#6a5a50' }
] };

export function swarmView( rc, world, ctx ) {

	const st = ctx.state, N = st.cap;
	const base = bakeModel( ASHLING, null, 'ashling' );
	const geo = new THREE.BufferGeometry();
	for ( const k in base.attributes ) geo.setAttribute( k, base.attributes[ k ] );
	const data = new Float32Array( N * 4 );
	for ( let i = 0; i < N; i ++ ) data[ i * 4 + 3 ] = - 1; // every slot starts dead (collapsed)
	const agents = new THREE.InstancedBufferAttribute( data, 4 ).setUsage( THREE.DynamicDrawUsage );
	geo.setAttribute( 'aAgent', agents );

	const a = attribute( 'aAgent', 'vec4' ); // ( x, z, heading, phase | -1 = dead )
	const alive = smoothstep( - 0.5, 0, a.w );
	const p = positionLocal;
	const wing = smoothstep( 0.12, 0.3, abs( p.x ) );
	const flap = sin( U.time.mul( 38 ).add( a.w.mul( 6.28 ) ) ).mul( wing ).mul( abs( p.x ) ).mul( 1.1 );
	const local = vec3( p.x, p.y.add( flap ), p.z ).mul( alive.mul( 1.5 ) ); // 1.5: readable from the game camera
	const c = cos( a.z ), s = sin( a.z );
	const turned = vec3( local.x.mul( c ).add( local.z.mul( s ) ), local.y, local.z.mul( c ).sub( local.x.mul( s ) ) );
	const bob = sin( U.time.mul( 5 ).add( a.w.mul( 20 ) ) ).mul( 0.12 ).add( 0.55 );
	const mat = new THREE.MeshStandardNodeMaterial( { roughness: 0.7 } );
	mat.positionNode = turned.add( vec3( a.x, bob, a.y ) );
	mat.colorNode = attribute( 'color', 'vec3' );
	mat.emissiveNode = attribute( 'color', 'vec3' ).mul( attribute( 'glow', 'float' ) ).mul( float( 1.6 ).add( sin( U.time.mul( 9 ).add( a.w.mul( 30 ) ) ).mul( 0.5 ) ) );

	const mesh = new THREE.Mesh( geo, mat );
	mesh.count = 1;
	mesh.frustumCulled = false;
	mesh.castShadow = true;
	mesh.name = 'Swarm';
	rc.scene.add( mesh );

	return {
		dispose() {

			rc.scene.remove( mesh );
			mat.dispose();

		},
		update() {

			const n = Math.max( 1, st.used );
			for ( let i = 0; i < n; i ++ ) {

				const k = i * 4;
				if ( ! st.alive[ i ] ) {

					data[ k + 3 ] = - 1;
					continue;

				}

				data[ k ] = st.x[ i ]; data[ k + 1 ] = st.z[ i ];
				const vx = st.vx[ i ], vz = st.vz[ i ];
				if ( vx * vx + vz * vz > 0.04 ) data[ k + 2 ] = Math.atan2( vx, vz );
				data[ k + 3 ] = st.seed[ i ];

			}

			agents.needsUpdate = true;
			agents.clearUpdateRanges();
			agents.addUpdateRange( 0, n * 4 );
			mesh.count = n;

		}
	};

}
