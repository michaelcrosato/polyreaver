// Primitive shapes for the part instancer: tiny, faceted, unit-sized (rig.js SHAPES
// documents each). No normals or UVs: the material shades flat from screen-space
// derivatives - the engine's Star Fox look, and 20 fewer bytes per vertex.

import * as THREE from 'three/webgpu';

function custom( points, faces ) {

	const g = new THREE.BufferGeometry();
	g.setAttribute( 'position', new THREE.Float32BufferAttribute( points.flat(), 3 ) );
	// orient every face outward (away from the centroid) so authoring order does not matter
	const c = points.reduce( ( a, p ) => [ a[ 0 ] + p[ 0 ] / points.length, a[ 1 ] + p[ 1 ] / points.length, a[ 2 ] + p[ 2 ] / points.length ], [ 0, 0, 0 ] );
	const idx = [];
	for ( const [ a, b, d ] of faces ) {

		const A = points[ a ], Bp = points[ b ], Dp = points[ d ];
		const u = [ Bp[ 0 ] - A[ 0 ], Bp[ 1 ] - A[ 1 ], Bp[ 2 ] - A[ 2 ] ], v = [ Dp[ 0 ] - A[ 0 ], Dp[ 1 ] - A[ 1 ], Dp[ 2 ] - A[ 2 ] ];
		const n = [ u[ 1 ] * v[ 2 ] - u[ 2 ] * v[ 1 ], u[ 2 ] * v[ 0 ] - u[ 0 ] * v[ 2 ], u[ 0 ] * v[ 1 ] - u[ 1 ] * v[ 0 ] ];
		const m = [ ( A[ 0 ] + Bp[ 0 ] + Dp[ 0 ] ) / 3 - c[ 0 ], ( A[ 1 ] + Bp[ 1 ] + Dp[ 1 ] ) / 3 - c[ 1 ], ( A[ 2 ] + Bp[ 2 ] + Dp[ 2 ] ) / 3 - c[ 2 ] ];
		if ( n[ 0 ] * m[ 0 ] + n[ 1 ] * m[ 1 ] + n[ 2 ] * m[ 2 ] >= 0 ) idx.push( a, b, d );
		else idx.push( a, d, b );

	}

	g.setIndex( idx );
	return g;

}

const MAKERS = {
	box: () => new THREE.BoxGeometry( 1, 1, 1 ),
	// ramp: full height at -Z, a thin edge at +Z
	wedge: () => custom(
		[ [ - 0.5, - 0.5, - 0.5 ], [ 0.5, - 0.5, - 0.5 ], [ 0.5, - 0.5, 0.5 ], [ - 0.5, - 0.5, 0.5 ], [ - 0.5, 0.5, - 0.5 ], [ 0.5, 0.5, - 0.5 ] ],
		[ [ 0, 1, 2 ], [ 0, 2, 3 ], [ 0, 1, 5 ], [ 0, 5, 4 ], [ 3, 2, 5 ], [ 3, 5, 4 ], [ 0, 3, 4 ], [ 1, 2, 5 ] ] ),
	cyl: () => new THREE.CylinderGeometry( 0.5, 0.5, 1, 6 ),
	cone: () => new THREE.ConeGeometry( 0.5, 1, 6 ),
	sphere: () => new THREE.IcosahedronGeometry( 0.5, 1 ),
	tetra: () => custom( [ [ 0, - 0.5, 0.5 ], [ 0.433, - 0.5, - 0.25 ], [ - 0.433, - 0.5, - 0.25 ], [ 0, 0.5, 0 ] ], [ [ 0, 1, 2 ], [ 0, 1, 3 ], [ 1, 2, 3 ], [ 2, 0, 3 ] ] ),
	prism: () => new THREE.CylinderGeometry( 0.5, 0.5, 1, 3 ),
	spike: () => new THREE.ConeGeometry( 0.5, 1, 4 ),
	// sword blade: diamond cross-section, parallel edges, a pointed tip at +Y
	blade: () => custom(
		[ [ 0, 0.5, 0 ], [ 0.5, 0.25, 0 ], [ 0, 0.25, 0.5 ], [ - 0.5, 0.25, 0 ], [ 0, 0.25, - 0.5 ], [ 0.5, - 0.5, 0 ], [ 0, - 0.5, 0.5 ], [ - 0.5, - 0.5, 0 ], [ 0, - 0.5, - 0.5 ] ],
		[ [ 0, 1, 2 ], [ 0, 2, 3 ], [ 0, 3, 4 ], [ 0, 4, 1 ],
			[ 1, 5, 6 ], [ 1, 6, 2 ], [ 2, 6, 7 ], [ 2, 7, 3 ], [ 3, 7, 8 ], [ 3, 8, 4 ], [ 4, 8, 5 ], [ 4, 5, 1 ],
			[ 5, 6, 7 ], [ 5, 7, 8 ] ] ),
	ring: () => new THREE.TorusGeometry( 0.43, 0.07, 4, 10 ).rotateX( Math.PI / 2 ),
	disc: () => new THREE.CylinderGeometry( 0.5, 0.5, 0.12, 8 ),
	capsule: () => new THREE.CapsuleGeometry( 0.25, 0.5, 2, 6 ).scale( 2, 1, 2 ),
	octa: () => new THREE.OctahedronGeometry( 0.5 )
};

export function makeShapeGeometry( shape ) {

	const g = MAKERS[ shape ]();
	g.deleteAttribute( 'normal' );
	g.deleteAttribute( 'uv' );
	g.computeBoundingSphere();
	return g;

}
