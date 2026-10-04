import * as THREE from 'three/webgpu';

export function boxGeometry() {

	const p = [], uv = [];
	const faces = [
		[ [ - .5, 0, .5 ], [ .5, 0, .5 ], [ .5, 1, .5 ], [ - .5, 1, .5 ] ],
		[ [ .5, 0, - .5 ], [ - .5, 0, - .5 ], [ - .5, 1, - .5 ], [ .5, 1, - .5 ] ],
		[ [ .5, 0, .5 ], [ .5, 0, - .5 ], [ .5, 1, - .5 ], [ .5, 1, .5 ] ],
		[ [ - .5, 0, - .5 ], [ - .5, 0, .5 ], [ - .5, 1, .5 ], [ - .5, 1, - .5 ] ],
		[ [ - .5, 1, .5 ], [ .5, 1, .5 ], [ .5, 1, - .5 ], [ - .5, 1, - .5 ] ]
	];
	const tex = [ [ 0, 0 ], [ 1, 0 ], [ 1, 1 ], [ 0, 1 ] ];
	for ( const face of faces ) for ( const i of [ 0, 1, 2, 0, 2, 3 ] ) { p.push( ...face[ i ] ); uv.push( ...tex[ i ] ); }
	const g = new THREE.BufferGeometry();
	g.setAttribute( 'position', new THREE.Float32BufferAttribute( p, 3 ) );
	g.setAttribute( 'uv', new THREE.Float32BufferAttribute( uv, 2 ) );
	g.computeVertexNormals(); g.computeBoundingSphere(); g.userData.triangles = 10;
	return g;

}

export function pyramidGeometry() {

	const p = [], corners = [ [ - 1, 0, - 1 ], [ 1, 0, - 1 ], [ 1, 0, 1 ], [ - 1, 0, 1 ] ];
	for ( let i = 0; i < 4; i ++ ) p.push( ...corners[ i ], 0, 1, 0, ...corners[ ( i + 1 ) % 4 ] );
	p.push( ...corners[ 0 ], ...corners[ 1 ], ...corners[ 2 ], ...corners[ 0 ], ...corners[ 2 ], ...corners[ 3 ] );
	const g = new THREE.BufferGeometry(); g.setAttribute( 'position', new THREE.Float32BufferAttribute( p, 3 ) ); g.computeVertexNormals(); g.userData.triangles = 6;
	return g;

}

export function mergedGeometry( parts ) {

	const positions = [], colors = [];
	for ( const { geometry, x, y = 0, z, sx = 1, sy = 1, sz = 1, color = 0xffffff, rotation = 0 } of parts ) {

		const p = geometry.getAttribute( 'position' ), n = geometry.getAttribute( 'normal' );
		const c = new THREE.Color( color ), co = Math.cos( rotation ), si = Math.sin( rotation );
		for ( let i = 0; i < p.count; i ++ ) {

			const px = p.getX( i ) * sx, pz = p.getZ( i ) * sz;
			positions.push( x + px * co + pz * si, y + p.getY( i ) * sy, z - px * si + pz * co );
			const shade = n ? .6 + .4 * Math.max( 0, n.getY( i ) * .8 - n.getX( i ) * .35 + n.getZ( i ) * .3 ) : 1;
			colors.push( c.r * shade, c.g * shade, c.b * shade );

		}

	}
	const g = new THREE.BufferGeometry();
	g.setAttribute( 'position', new THREE.Float32BufferAttribute( positions, 3 ) );
	g.setAttribute( 'color', new THREE.Float32BufferAttribute( colors, 3 ) );
	g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere(); g.userData.triangles = positions.length / 9;
	return g;

}
