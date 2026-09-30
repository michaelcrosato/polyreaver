// Shading models shared by the world, the props and the physics bodies, plus the
// procedural paving used as the ground colour.

import * as THREE from 'three/webgpu';
import {
	Fn, float, vec2, vec3, positionWorld, floor, fract, sin, dot, mix, smoothstep, min, abs, length, pow, fwidth
} from 'three/tsl';
import { isCel, makeCelMaterial } from '../cel.js';

export const SHADING_KINDS = [ 'unlit', 'lambert', 'phong', 'standard', 'physical', 'toon', 'celWW', 'celJSR' ];

export function makeMaterial( kind, params = {} ) {

	const common = { ...params };
	if ( isCel( kind ) ) {

		delete common.metalness;
		delete common.roughness;
		return makeCelMaterial( kind, common );

	}
	switch ( kind ) {

		case 'lambert': return new THREE.MeshLambertNodeMaterial( common );
		case 'phong': return new THREE.MeshPhongNodeMaterial( { shininess: 30, ...common } );
		case 'standard': return new THREE.MeshStandardNodeMaterial( { roughness: 0.8, metalness: 0, ...common } );
		case 'physical': return new THREE.MeshPhysicalNodeMaterial( { roughness: 0.7, metalness: 0, ...common } );
		case 'toon': return new THREE.MeshToonNodeMaterial( common );
		default: return new THREE.MeshBasicNodeMaterial( common );

	}

}

// Classic float hash for procedural patterns (works for negative coordinates).
const hash2 = ( p ) => fract( sin( dot( p, vec2( 12.9898, 78.233 ) ) ).mul( 43758.5453 ) );

export function groundColorNode( world ) {

	const u = world.u;
	return Fn( () => {

		const p = positionWorld.xz;
		const base = vec3( 0.18, 0.17, 0.15 );
		if ( ! world.groundDetail ) return base;
		const tile = p.div( 2.5 );
		const cell = floor( tile );
		const f = fract( tile );
		// Anti-aliased grout: line width measured in screen pixels via fwidth(),
		// faded out once tiles are only a few pixels wide (avoids moiré).
		const fw = fwidth( tile ).x.max( 1e-4 );
		const edge = min( min( f.x, float( 1 ).sub( f.x ) ), min( f.y, float( 1 ).sub( f.y ) ) );
		const grout = smoothstep( fw.mul( 0.5 ), fw.mul( 1.5 ).add( 0.015 ), edge );
		const groutFade = smoothstep( 0.25, 0.08, fw );
		const n = hash2( cell );
		const stone = mix( vec3( 0.58, 0.55, 0.5 ), vec3( 0.68, 0.64, 0.57 ), n );
		// wide paving rings every 24 m for a plaza feel
		const r = length( p );
		const ringD = abs( fract( r.div( 24 ) ).sub( 0.5 ) ).mul( 24 );
		const ring = smoothstep( 10.6, 11.4, ringD );
		const col = mix( stone, vec3( 0.5, 0.46, 0.42 ), ring.mul( 0.7 ) );
		const withGrout = mix( col, vec3( 0.4, 0.38, 0.35 ), float( 1 ).sub( grout ).mul( groutFade ) );
		// darker when "wet" (used with SSR); authored in sRGB -> linear
		return pow( mix( withGrout, withGrout.mul( 0.5 ), u.groundWet ), vec3( 2.2 ) );

	} )();

}

export function propMaterial( kind ) {

	const mat = makeMaterial( kind, { vertexColors: true } );
	mat.name = 'Prop_' + kind;
	return mat;

}
