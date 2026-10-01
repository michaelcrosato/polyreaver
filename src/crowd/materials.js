// Crowd rendering: the vertex shader that decodes each agent's packed instance data,
// animates it with the active animation system and places it in the world; the
// materials built on it (plus the outline hull and blob shadows); and the meshes
// that draw them for the current render path.

import * as THREE from 'three/webgpu';
import {
	Fn, float, vec3, vec4, attribute, floor, select, mix, clamp, mx_hsvtorgb, normalView,
	positionViewDirection, dot, pow, uv, smoothstep, positionPrevious, positionLocal
} from 'three/tsl';
import { buildBlobGeometry } from './models.js';
import {
	sampleBlended, channels, poseVertexDynamic, proceduralVertex, skinVertex, bakeVAT, sampleVAT, rotY
} from './anim.js';
import { TAU, hashF } from './sim.js';
import { ensureLodBuffers } from './cull.js';
import { previousPosition, previousBlobPosition } from './motion.js';

// three.js derives the "previous frame" vertex position (velocity buffer for motion
// blur / TRAA) from the raw geometry, which ignores positionNode. Our agents are
// placed entirely by positionNode, so supply it ourselves: `previous()` builds it
// (agent motion, see motion.js); without one, "previous" equals the current animated
// position, so only camera motion is captured. Only passes that render a velocity
// buffer call it - every other pass compiles without any of that work.
export function withPreviousPosition( material, previous = null ) {

	const setupPosition = material.setupPosition.bind( material );
	material.setupPosition = ( builder ) => {

		const result = setupPosition( builder );
		if ( builder.needsPreviousData() ) positionPrevious.assign( previous ? previous() : positionLocal );
		return result;

	};

	return material;

}

// -----------------------------------------------------------------------
// Vertex shader: decode instance, animate, place in world.
// -----------------------------------------------------------------------
// `previous`: re-run for last frame's pose (motion vectors), skipping the colours.
export function vertexNode( crowd, inst, anim, tier, { hull = false, previous = false } = {} ) {

	const u = crowd.u;
	const vColor = crowd.vColor;
	const system = crowd.animSystem;
	const time = previous ? u.time.sub( u.dt ) : u.time;

	return Fn( () => {

		const packed = inst.w;
		const seed = floor( packed.mul( 1 / 2048 ) ).toVar();
		const rem = packed.sub( seed.mul( 2048 ) );
		const hq = floor( rem.mul( 0.125 ) );
		const state = rem.sub( hq.mul( 8 ) );
		const heading = hq.mul( TAU / 256 );
		const p = inst.y;

		const jointA = attribute( 'jointA', 'vec4' );
		const jointB = attribute( 'jointB', 'vec4' );
		const hullOffset = hull ? attribute( 'hullDir', 'vec3' ).mul( u.outline ) : null;
		let v = attribute( 'position', 'vec3' );
		if ( hullOffset && system !== 'vat' ) v = v.add( hullOffset );

		if ( system === 'procedural' ) {

			v = proceduralVertex( v, jointA, jointB, crowd.procTable, state, p, time, seed );

		} else if ( system === 'keyframe' ) {

			const P = sampleBlended( crowd.clipTable, state, p, anim.x, anim.z, anim.y );
			v = poseVertexDynamic( v, jointA, jointB, channels( P ) );

		} else if ( system === 'skeletal' ) {

			const skinned = skinVertex( crowd.boneBuf, anim.w, v, true );
			v = select( anim.w.lessThan( crowd.boneCap ), skinned, v );

		} else if ( system === 'vat' ) {

			const tex = vat( crowd, tier );
			const cur = sampleVAT( tex, state, p );
			const prev = sampleVAT( tex, anim.x, anim.z );
			v = mix( prev, cur, anim.y );
			if ( hullOffset ) v = v.add( hullOffset );

		}

		const scale = select( seed.equal( 0 ), float( 1.12 ), hashF( seed, 11 ).mul( 0.22 ).add( 0.88 ) );
		const world = rotY( v.mul( scale ), heading ).add( vec3( inst.x, 0, inst.z ) );

		if ( ! hull && ! previous ) {

			// Colours authored in sRGB and converted to linear (≈ gamma 2.2).
			const slot = attribute( 'slot', 'float' );
			const skin = mix( vec3( 0.97, 0.82, 0.7 ), vec3( 0.38, 0.24, 0.16 ), hashF( seed, 12 ) );
			const shirt = mx_hsvtorgb( vec3( hashF( seed, 13 ), hashF( seed, 14 ).mul( 0.4 ).add( 0.2 ), hashF( seed, 15 ).mul( 0.5 ).add( 0.4 ) ) );
			const pants = mix( vec3( 0.16, 0.2, 0.34 ), vec3( 0.52, 0.47, 0.38 ), hashF( seed, 16 ) ).mul( hashF( seed, 17 ).mul( 0.6 ).add( 0.55 ) );
			const hair = mix( vec3( 0.12, 0.09, 0.07 ), vec3( 0.72, 0.56, 0.32 ), pow( hashF( seed, 18 ), 3 ) );
			const hero = seed.equal( 0 );
			const shirtF = select( hero, vec3( 0.95, 0.2, 0.12 ), shirt );
			const pantsF = select( hero, vec3( 0.12, 0.2, 0.55 ), pants );
			const srgb = select( slot.lessThan( 0.5 ), skin,
				select( slot.lessThan( 1.5 ), shirtF,
					select( slot.lessThan( 2.5 ), pantsF,
						select( slot.lessThan( 3.5 ), vec3( 0.16, 0.14, 0.13 ), hair ) ) ) );
			vColor.assign( pow( srgb, vec3( 2.2 ) ) );

		}

		return world;

	} )();

}

export function vat( crowd, tier ) {

	if ( ! crowd.vatTextures[ tier ] ) crowd.vatTextures[ tier ] = bakeVAT( crowd.models[ tier ].geometry );
	return crowd.vatTextures[ tier ];

}

export function makeMaterial( crowd, inst, anim, tier, { hull = false } = {} ) {

	if ( hull ) {

		const mat = new THREE.MeshBasicNodeMaterial( { side: THREE.BackSide } );
		mat.colorNode = vec4( crowd.u.outlineColor, 1 );
		mat.positionNode = vertexNode( crowd, inst, anim, tier, { hull: true } );
		mat.fog = true;
		mat.name = 'CrowdOutline';
		const pose = ( i, a ) => vertexNode( crowd, i, a, tier, { hull: true, previous: true } );
		return withPreviousPosition( mat, previousPosition( crowd, inst, anim, pose ) );

	}

	const kind = crowd.materialKind;
	let mat = crowd.materialFactory ? crowd.materialFactory( kind ) : null;
	if ( ! mat ) {

		switch ( kind ) {

			case 'lambert': mat = new THREE.MeshLambertNodeMaterial(); break;
			case 'phong': mat = new THREE.MeshPhongNodeMaterial( { shininess: 40, specular: 0x333333 } ); break;
			case 'standard': mat = new THREE.MeshStandardNodeMaterial( { roughness: 0.65, metalness: 0.0 } ); break;
			case 'physical': mat = new THREE.MeshPhysicalNodeMaterial( { roughness: 0.45, metalness: 0.0, clearcoat: 0.6, clearcoatRoughness: 0.25, sheen: 0.5, sheenRoughness: 0.6, sheenColor: 0xffffff } ); break;
			case 'toon': mat = new THREE.MeshToonNodeMaterial(); break;
			default: mat = new THREE.MeshBasicNodeMaterial();

		}

	}

	const vColor = crowd.vColor;
	mat.positionNode = vertexNode( crowd, inst, anim, tier );
	const baseColor = mat.userData.crowdColor ? mat.userData.crowdColor( vColor ) : vColor;

	if ( crowd.rim ) {

		const fres = pow( float( 1 ).sub( clamp( dot( normalView, positionViewDirection ), 0, 1 ) ), crowd.u.rimPower );
		const rimCol = crowd.u.rimColor.mul( fres );
		if ( mat.isMeshBasicNodeMaterial ) mat.colorNode = vec4( baseColor.add( rimCol ), 1 );
		else {

			mat.colorNode = vec4( baseColor, 1 );
			mat.emissiveNode = rimCol;

		}

	} else {

		mat.colorNode = vec4( baseColor, 1 );

	}

	mat.name = 'Crowd_' + kind + '_' + crowd.animSystem;
	const pose = ( i, a ) => vertexNode( crowd, i, a, tier, { previous: true } );
	return withPreviousPosition( mat, previousPosition( crowd, inst, anim, pose ) );

}

export function makeBlobMaterial( crowd ) {

	const inst = crowd.renderBuf.toAttribute();
	const mat = new THREE.MeshBasicNodeMaterial( { transparent: true, depthWrite: false } );
	mat.positionNode = Fn( () => {

		const seed = floor( inst.w.mul( 1 / 2048 ) );
		const scale = select( seed.equal( 0 ), float( 1.12 ), hashF( seed, 11 ).mul( 0.22 ).add( 0.88 ) );
		return attribute( 'position', 'vec3' ).mul( scale.mul( 0.95 ) ).add( vec3( inst.x, 0.03, inst.z ) );

	} )();
	const d = uv().sub( 0.5 ).length().mul( 2 );
	mat.colorNode = vec3( 0, 0, 0 );
	mat.opacityNode = float( 1 ).sub( smoothstep( 0.35, 1.0, d ) ).mul( 0.55 );
	mat.name = 'BlobShadow';
	return withPreviousPosition( mat, previousBlobPosition( crowd, inst ) );

}

// -----------------------------------------------------------------------
// Meshes: the geometry + material pairs drawn by the current render path.
// -----------------------------------------------------------------------
export function rebuildMeshes( crowd ) {

	crowd._disposeMeshes();
	const addMesh = ( geometry, material, extra = {} ) => {

		const mesh = new THREE.Mesh( geometry, material );
		mesh.frustumCulled = false;
		mesh.matrixAutoUpdate = false;
		Object.assign( mesh.userData, extra );
		crowd.group.add( mesh );
		crowd.meshes.push( mesh );
		return mesh;

	};

	if ( crowd.path === 'direct' ) {

		const model = crowd.models[ crowd.tier ];
		const inst = crowd.renderBuf.toAttribute();
		const anim = crowd.animBuf.toAttribute();
		const main = addMesh( model.geometry, makeMaterial( crowd, inst, anim, crowd.tier ), { kind: 'crowd', tier: crowd.tier } );
		main.castShadow = crowd.castShadow;
		main.receiveShadow = crowd.receiveShadow;
		if ( crowd.outlines ) addMesh( model.geometry, makeMaterial( crowd, inst, anim, crowd.tier, { hull: true } ), { kind: 'outline', tier: crowd.tier } );

	} else {

		ensureLodBuffers( crowd );
		for ( let k = 0; k <= crowd.tier; k ++ ) {

			const inst = crowd.lodBufs[ k ].toAttribute();
			const anim = crowd.lodAnimBufs[ k ].toAttribute();
			const geo = crowd.lodGeos[ k ];
			const main = addMesh( geo, makeMaterial( crowd, inst, anim, k ), { kind: 'crowd', tier: k } );
			main.castShadow = crowd.castShadow;
			main.receiveShadow = crowd.receiveShadow;
			main.count = 2; // real count comes from the indirect buffer
			if ( crowd.outlines ) {

				const o = addMesh( geo, makeMaterial( crowd, inst, anim, k, { hull: true } ), { kind: 'outline', tier: k } );
				o.count = 2;

			}

		}

	}

	if ( crowd.blobShadows ) {

		crowd.blobGeo = crowd.blobGeo || buildBlobGeometry();
		const blob = addMesh( crowd.blobGeo, makeBlobMaterial( crowd ), { kind: 'blob' } );
		blob.renderOrder = 1;

	}

	crowd._applyCount();

}
