// Physics debug draw. Every function takes the PhysicsDemo (../physics.js) it works on.

import * as THREE from 'three/webgpu';

// ------------------------------------------------------------------------
// debug draw: every collider as wireframe lines, straight from Rapier
// ------------------------------------------------------------------------
export function setDebug( demo, on ) {

	if ( ! on && demo.debugLines ) {

		demo.scene.remove( demo.debugLines );
		demo.debugLines.material.dispose();
		demo.debugLines = null;

	}

	if ( on && ! demo.debugLines ) {

		const g = new THREE.BufferGeometry();
		demo.debugLines = new THREE.LineSegments( g, new THREE.LineBasicNodeMaterial( { vertexColors: true, transparent: true, opacity: 0.8, depthTest: true } ) );
		demo.debugLines.frustumCulled = false;
		demo.debugLines.name = 'Rapier debug';
		demo.scene.add( demo.debugLines );
		demo._debugCap = 0;

	}

}

export function updateDebug( demo ) {

	if ( ! demo.debugLines ) setDebug( demo, true );
	const { vertices, colors } = demo.world.debugRender();
	const g = demo.debugLines.geometry;
	const nv = vertices.length / 3;
	if ( nv > demo._debugCap ) {

		demo._debugCap = Math.ceil( nv * 1.5 );
		g.setAttribute( 'position', new THREE.BufferAttribute( new Float32Array( demo._debugCap * 3 ), 3 ).setUsage( THREE.DynamicDrawUsage ) );
		g.setAttribute( 'color', new THREE.BufferAttribute( new Float32Array( demo._debugCap * 4 ), 4 ).setUsage( THREE.DynamicDrawUsage ) );

	}

	g.getAttribute( 'position' ).array.set( vertices );
	g.getAttribute( 'color' ).array.set( colors );
	g.getAttribute( 'position' ).needsUpdate = true;
	g.getAttribute( 'color' ).needsUpdate = true;
	g.setDrawRange( 0, nv );
	demo.debugVertices = nv;

}
