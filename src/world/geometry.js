// Prop geometry for the world: trees, lamp posts and the central monument.

import * as THREE from 'three/webgpu';

// --- tiny procedural prop geometries (vertex coloured, non-indexed merge) ------
function coloredGeometry( parts ) {

	const positions = [];
	const colors = [];
	for ( const { geometry, color: c, matrix } of parts ) {

		const g = geometry.index ? geometry.toNonIndexed() : geometry;
		if ( matrix ) g.applyMatrix4( matrix );
		const pos = g.getAttribute( 'position' );
		const col = new THREE.Color( c );
		for ( let i = 0; i < pos.count; i ++ ) {

			positions.push( pos.getX( i ), pos.getY( i ), pos.getZ( i ) );
			colors.push( col.r, col.g, col.b );

		}

	}

	const out = new THREE.BufferGeometry();
	out.setAttribute( 'position', new THREE.Float32BufferAttribute( positions, 3 ) );
	out.setAttribute( 'color', new THREE.Float32BufferAttribute( colors, 3 ) );
	out.computeVertexNormals();
	out.userData.triangles = positions.length / 9;
	return out;

}

export function treeGeometry() {

	const m = new THREE.Matrix4();
	return coloredGeometry( [
		{ geometry: new THREE.CylinderGeometry( 0.18, 0.25, 2.2, 5, 1 ), color: 0x6b4a2f, matrix: m.clone().makeTranslation( 0, 1.1, 0 ) },
		{ geometry: new THREE.ConeGeometry( 2.0, 3.2, 6, 1 ), color: 0x2f6b35, matrix: m.clone().makeTranslation( 0, 3.4, 0 ) },
		{ geometry: new THREE.ConeGeometry( 1.5, 2.6, 6, 1 ), color: 0x3b7d3f, matrix: m.clone().makeTranslation( 0, 4.8, 0 ) }
	] );

}

export function lampGeometry() {

	const m = new THREE.Matrix4();
	return coloredGeometry( [
		{ geometry: new THREE.CylinderGeometry( 0.08, 0.12, 4.2, 4, 1 ), color: 0x2c2f36, matrix: m.clone().makeTranslation( 0, 2.1, 0 ) },
		{ geometry: new THREE.BoxGeometry( 0.9, 0.12, 0.12 ), color: 0x2c2f36, matrix: m.clone().makeTranslation( 0.35, 4.1, 0 ) }
	] );

}

export function monumentGeometry() {

	const m = new THREE.Matrix4();
	const stone = 0xc9c2b4, dark = 0x8e877a;
	return coloredGeometry( [
		{ geometry: new THREE.CylinderGeometry( 6.5, 7, 0.4, 8, 1 ), color: dark, matrix: m.clone().makeTranslation( 0, 0.2, 0 ) },
		{ geometry: new THREE.CylinderGeometry( 5.2, 5.5, 0.5, 8, 1 ), color: stone, matrix: m.clone().makeTranslation( 0, 0.65, 0 ) },
		{ geometry: new THREE.CylinderGeometry( 1.0, 1.4, 1.2, 4, 1 ), color: dark, matrix: m.clone().makeTranslation( 0, 1.5, 0 ) },
		{ geometry: new THREE.CylinderGeometry( 0.25, 0.9, 9, 4, 1 ), color: stone, matrix: m.clone().makeTranslation( 0, 6.6, 0 ) },
		{ geometry: new THREE.ConeGeometry( 0.35, 0.8, 4, 1 ), color: 0xd8b84a, matrix: m.clone().makeTranslation( 0, 11.5, 0 ) }
	] );

}
