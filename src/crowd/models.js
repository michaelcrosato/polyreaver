// Procedural low-poly "triangle people".
//
// Every model is built from a handful of convex primitives (tetrahedra, prisms,
// octahedra). Each vertex carries:
//   position  - rest pose, model space (metres, Y up, character faces +Z, left = +X)
//   jointA    - xyz: pivot this part rotates around, w: part id
//   jointB    - xyz: parent pivot (shoulder / hip) for two-segment limbs, w: unused
//   slot      - colour slot (skin / shirt / pants / shoes / hair)
//   hullDir   - direction used to "inflate" the mesh for inverted-hull outlines
//   skinIdx   - two bone ids (bone id == part id) for the skeletal-skinning system
//   skinW     - weight of the first bone (1 = rigid). Joint rings of the two-segment
//               limbs are shared 50/50 so skeletal mode bends smoothly at elbows/knees.
//
// No normals are stored: the renderer falls back to flat shading computed from
// screen-space derivatives, which is exactly the faceted Star Fox look we want
// and saves 12 bytes per vertex.
//
// Animation is done in the vertex shader (see crowd.js) by rotating each part
// around its pivot, so there is no skeleton, no skinning matrices and no
// per-bone uniforms - just math on the part id.

import * as THREE from 'three/webgpu';

export const PART = {
	TORSO: 0, HEAD: 1,
	L_ARM: 2, R_ARM: 3, L_LEG: 4, R_LEG: 5,
	L_FOREARM: 6, R_FOREARM: 7, L_SHIN: 8, R_SHIN: 9
};

export const SLOT = { SKIN: 0, SHIRT: 1, PANTS: 2, SHOES: 3, HAIR: 4 };

// Joint positions (metres). A person ~1.75 m tall.
const J = {
	hip: [ 0, 0.92, 0 ],
	lHip: [ 0.1, 0.92, 0 ], rHip: [ - 0.1, 0.92, 0 ],
	lKnee: [ 0.11, 0.5, 0.01 ], rKnee: [ - 0.11, 0.5, 0.01 ],
	lAnkle: [ 0.11, 0.08, 0 ], rAnkle: [ - 0.11, 0.08, 0 ],
	lShoulder: [ 0.22, 1.43, 0 ], rShoulder: [ - 0.22, 1.43, 0 ],
	lElbow: [ 0.25, 1.16, - 0.01 ], rElbow: [ - 0.25, 1.16, - 0.01 ],
	lWrist: [ 0.26, 0.9, 0.02 ], rWrist: [ - 0.26, 0.9, 0.02 ],
	neck: [ 0, 1.5, 0 ]
};

const v3 = ( a ) => new THREE.Vector3( a[ 0 ], a[ 1 ], a[ 2 ] );

class ModelBuilder {

	constructor() {

		this.positions = [];
		this.jointA = [];
		this.jointB = [];
		this.slots = [];
		this.hull = [];
		this.skinIdx = [];
		this.skinW = [];
		this.indices = [];
		this.vertexCount = 0;

	}

	// Adds a convex hull given its points and triangle faces (indices into points).
	// Faces are re-oriented so they always wind counter-clockwise when seen from
	// outside (relative to the centroid), so authoring order doesn't matter.
	// skin(i) -> [ otherBone, weightOfOther ] or null for rigid vertices.
	convex( points, faces, part, slot, pivot, parentPivot = pivot, skin = null ) {

		const base = this.vertexCount;
		const centroid = new THREE.Vector3();
		for ( const p of points ) centroid.add( p );
		centroid.divideScalar( points.length );

		points.forEach( ( p, pi ) => {

			const blend = skin ? skin( pi ) : null;
			this.skinIdx.push( part, blend ? blend[ 0 ] : part );
			this.skinW.push( blend ? 1 - blend[ 1 ] : 1 );
			this.positions.push( p.x, p.y, p.z );
			this.jointA.push( pivot[ 0 ], pivot[ 1 ], pivot[ 2 ], part );
			this.jointB.push( parentPivot[ 0 ], parentPivot[ 1 ], parentPivot[ 2 ], 0 );
			this.slots.push( slot );
			const h = p.clone().sub( centroid );
			if ( h.lengthSq() < 1e-8 ) h.set( 0, 1, 0 );
			h.normalize();
			this.hull.push( h.x, h.y, h.z );

		} );

		const ab = new THREE.Vector3(), ac = new THREE.Vector3(), n = new THREE.Vector3(), c = new THREE.Vector3();

		for ( const [ a, b, d ] of faces ) {

			const pa = points[ a ], pb = points[ b ], pd = points[ d ];
			ab.subVectors( pb, pa );
			ac.subVectors( pd, pa );
			n.crossVectors( ab, ac );
			c.copy( pa ).add( pb ).add( pd ).divideScalar( 3 ).sub( centroid );
			if ( n.dot( c ) >= 0 ) this.indices.push( base + a, base + b, base + d );
			else this.indices.push( base + a, base + d, base + b );

		}

		this.vertexCount += points.length;

	}

	tetra( p0, p1, p2, p3, part, slot, pivot, parentPivot ) {

		this.convex( [ p0, p1, p2, p3 ].map( v3 ), [ [ 0, 1, 2 ], [ 0, 1, 3 ], [ 1, 2, 3 ], [ 0, 2, 3 ] ], part, slot, pivot, parentPivot );

	}

	// N-sided prism (frustum) between two centres. rA/rB are [rx, rz] half extents.
	// The cross-section is built perpendicular to the segment direction.
	// skinBlend: { a: [ bone, weight ], b: [ bone, weight ] } shares the ring at end a / b
	// with another bone (used by skeletal skinning only).
	prism( a, b, rA, rB, sides, part, slot, pivot, parentPivot, rot = 0, skinBlend = null ) {

		const A = v3( a ), B = v3( b );
		const axis = B.clone().sub( A ).normalize();
		const ref = Math.abs( axis.y ) > 0.9 ? new THREE.Vector3( 1, 0, 0 ) : new THREE.Vector3( 0, 1, 0 );
		const u = new THREE.Vector3().crossVectors( ref, axis ).normalize();
		const w = new THREE.Vector3().crossVectors( axis, u ).normalize();
		// Prefer u ≈ X and w ≈ Z for near-vertical segments so rx/rz mean width/depth.
		if ( Math.abs( axis.y ) > 0.9 ) {

			u.set( 1, 0, 0 ).sub( axis.clone().multiplyScalar( axis.x ) ).normalize();
			w.crossVectors( u, axis ).normalize().negate();

		}

		const pts = [];
		for ( let ring = 0; ring < 2; ring ++ ) {

			const C = ring === 0 ? A : B;
			const r = ring === 0 ? rA : rB;
			for ( let i = 0; i < sides; i ++ ) {

				const t = rot + ( i / sides ) * Math.PI * 2 + ( sides === 4 ? Math.PI / 4 : 0 );
				const s = sides === 4 ? Math.SQRT2 : 1;
				pts.push( C.clone()
					.addScaledVector( u, Math.cos( t ) * r[ 0 ] * s )
					.addScaledVector( w, Math.sin( t ) * r[ 1 ] * s ) );

			}

		}

		const faces = [];
		for ( let i = 0; i < sides; i ++ ) {

			const j = ( i + 1 ) % sides;
			faces.push( [ i, j, sides + j ], [ i, sides + j, sides + i ] );

		}

		for ( let i = 1; i < sides - 1; i ++ ) {

			faces.push( [ 0, i, i + 1 ] );
			faces.push( [ sides, sides + i, sides + i + 1 ] );

		}

		const skin = skinBlend ? ( i ) => ( i < sides ? skinBlend.a : skinBlend.b ) || null : null;
		this.convex( pts, faces, part, slot, pivot, parentPivot, skin );

	}

	octa( c, rx, ry, rz, part, slot, pivot, parentPivot ) {

		const C = v3( c );
		const pts = [
			C.clone().add( new THREE.Vector3( rx, 0, 0 ) ), C.clone().add( new THREE.Vector3( - rx, 0, 0 ) ),
			C.clone().add( new THREE.Vector3( 0, ry, 0 ) ), C.clone().add( new THREE.Vector3( 0, - ry, 0 ) ),
			C.clone().add( new THREE.Vector3( 0, 0, rz ) ), C.clone().add( new THREE.Vector3( 0, 0, - rz ) )
		];
		const faces = [
			[ 0, 2, 4 ], [ 4, 2, 1 ], [ 1, 2, 5 ], [ 5, 2, 0 ],
			[ 0, 4, 3 ], [ 4, 1, 3 ], [ 1, 5, 3 ], [ 5, 0, 3 ]
		];
		this.convex( pts, faces, part, slot, pivot, parentPivot );

	}

	// Icosphere (subdivided icosahedron) - used for the "hi" tier head.
	sphere( c, r, detail, part, slot, pivot, sy = 1 ) {

		const g = new THREE.IcosahedronGeometry( r, detail );
		const pos = g.getAttribute( 'position' );
		// IcosahedronGeometry is non-indexed; weld it.
		const map = new Map();
		const pts = [];
		const idx = [];
		for ( let i = 0; i < pos.count; i ++ ) {

			const x = pos.getX( i ), y = pos.getY( i ) * sy, z = pos.getZ( i );
			const key = `${x.toFixed( 4 )},${y.toFixed( 4 )},${z.toFixed( 4 )}`;
			let k = map.get( key );
			if ( k === undefined ) {

				k = pts.length;
				map.set( key, k );
				pts.push( new THREE.Vector3( x + c[ 0 ], y + c[ 1 ], z + c[ 2 ] ) );

			}

			idx.push( k );

		}

		const faces = [];
		for ( let i = 0; i < idx.length; i += 3 ) faces.push( [ idx[ i ], idx[ i + 1 ], idx[ i + 2 ] ] );
		g.dispose();
		this.convex( pts, faces, part, slot, pivot );

	}

	build( name ) {

		const g = new THREE.BufferGeometry();
		g.setAttribute( 'position', new THREE.Float32BufferAttribute( this.positions, 3 ) );
		g.setAttribute( 'jointA', new THREE.Float32BufferAttribute( this.jointA, 4 ) );
		g.setAttribute( 'jointB', new THREE.Float32BufferAttribute( this.jointB, 4 ) );
		g.setAttribute( 'slot', new THREE.Float32BufferAttribute( this.slots, 1 ) );
		g.setAttribute( 'hullDir', new THREE.Float32BufferAttribute( this.hull, 3 ) );
		g.setAttribute( 'skinIdx', new THREE.Float32BufferAttribute( this.skinIdx, 2 ) );
		g.setAttribute( 'skinW', new THREE.Float32BufferAttribute( this.skinW, 1 ) );
		g.setIndex( this.indices );
		g.name = name;
		g.boundingSphere = new THREE.Sphere( new THREE.Vector3( 0, 0.9, 0 ), 1.2 );
		g.userData.triangles = this.indices.length / 3;
		g.userData.vertices = this.vertexCount;
		return g;

	}

}

// ---------------------------------------------------------------------------
// Tier 0: "Tetra" - every body part is a single tetrahedron (4 triangles).
// 6 parts x 4 = 24 triangles, 24 vertices. About as low as a readable person gets.
// ---------------------------------------------------------------------------
function buildTetra() {

	const m = new ModelBuilder();
	// torso: wide shoulders tapering to the crotch
	m.tetra( [ 0.24, 1.47, - 0.07 ], [ - 0.24, 1.47, - 0.07 ], [ 0, 1.42, 0.15 ], [ 0, 0.86, 0.0 ], PART.TORSO, SLOT.SHIRT, J.hip );
	// head: inverted pyramid with a chin point
	m.tetra( [ 0.11, 1.78, - 0.08 ], [ - 0.11, 1.78, - 0.08 ], [ 0, 1.76, 0.13 ], [ 0, 1.5, 0.04 ], PART.HEAD, SLOT.SKIN, J.neck );
	// arms: shoulder triangle -> hand point
	for ( const s of [ 1, - 1 ] ) {

		const sh = s > 0 ? J.lShoulder : J.rShoulder;
		m.tetra( [ sh[ 0 ] + 0.06 * s, 1.47, - 0.05 ], [ sh[ 0 ] - 0.04 * s, 1.46, 0.0 ], [ sh[ 0 ] + 0.02 * s, 1.45, 0.07 ], [ 0.28 * s, 0.86, 0.02 ],
			s > 0 ? PART.L_ARM : PART.R_ARM, SLOT.SHIRT, sh );

	}

	// legs: hip triangle -> foot point (pointing slightly forward)
	for ( const s of [ 1, - 1 ] ) {

		const hp = s > 0 ? J.lHip : J.rHip;
		m.tetra( [ hp[ 0 ] + 0.08 * s, 0.94, - 0.06 ], [ hp[ 0 ] - 0.07 * s, 0.9, - 0.04 ], [ hp[ 0 ] + 0.01 * s, 0.92, 0.08 ], [ 0.12 * s, 0.0, 0.12 ],
			s > 0 ? PART.L_LEG : PART.R_LEG, SLOT.PANTS, hp );

	}

	return m.build( 'Tetra' );

}

// ---------------------------------------------------------------------------
// Tier 1: "Prism" (Star Fox) - box torso, diamond head, triangular-prism limbs.
// ---------------------------------------------------------------------------
function buildPrism() {

	const m = new ModelBuilder();
	m.prism( [ 0, 0.86, 0 ], [ 0, 1.48, 0 ], [ 0.14, 0.09 ], [ 0.23, 0.11 ], 4, PART.TORSO, SLOT.SHIRT, J.hip );
	m.octa( [ 0, 1.65, 0.01 ], 0.1, 0.14, 0.11, PART.HEAD, SLOT.SKIN, J.neck );
	for ( const s of [ 1, - 1 ] ) {

		const sh = s > 0 ? J.lShoulder : J.rShoulder;
		m.prism( [ sh[ 0 ] + 0.03 * s, 1.46, 0 ], [ 0.27 * s, 0.86, 0.02 ], [ 0.06, 0.06 ], [ 0.035, 0.035 ], 3,
			s > 0 ? PART.L_ARM : PART.R_ARM, SLOT.SHIRT, sh, sh, Math.PI / 2 );
		const hp = s > 0 ? J.lHip : J.rHip;
		m.prism( [ hp[ 0 ], 0.94, 0 ], [ 0.12 * s, 0.02, 0.03 ], [ 0.085, 0.085 ], [ 0.05, 0.07 ], 3,
			s > 0 ? PART.L_LEG : PART.R_LEG, SLOT.PANTS, hp, hp, - Math.PI / 2 );

	}

	return m.build( 'Prism' );

}

// ---------------------------------------------------------------------------
// Tier 2: "Box-man" (Alone in the Dark) - boxes everywhere, two-segment limbs
// with elbows and knees, separate feet.
// ---------------------------------------------------------------------------
function buildBoxMan() {

	const m = new ModelBuilder();
	m.prism( [ 0, 1.02, 0 ], [ 0, 1.47, 0 ], [ 0.16, 0.1 ], [ 0.22, 0.12 ], 4, PART.TORSO, SLOT.SHIRT, J.hip );
	m.prism( [ 0, 0.84, 0 ], [ 0, 1.02, 0 ], [ 0.16, 0.1 ], [ 0.16, 0.1 ], 4, PART.TORSO, SLOT.PANTS, J.hip );
	m.prism( [ 0, 1.52, 0.0 ], [ 0, 1.78, 0.0 ], [ 0.1, 0.11 ], [ 0.1, 0.11 ], 4, PART.HEAD, SLOT.SKIN, J.neck );
	m.prism( [ 0, 1.74, - 0.01 ], [ 0, 1.81, - 0.01 ], [ 0.105, 0.115 ], [ 0.1, 0.11 ], 4, PART.HEAD, SLOT.HAIR, J.neck );
	for ( const s of [ 1, - 1 ] ) {

		const L = s > 0;
		const sh = L ? J.lShoulder : J.rShoulder, el = L ? J.lElbow : J.rElbow, wr = L ? J.lWrist : J.rWrist;
		const UA = L ? PART.L_ARM : PART.R_ARM, FA = L ? PART.L_FOREARM : PART.R_FOREARM;
		const TH = L ? PART.L_LEG : PART.R_LEG, SH = L ? PART.L_SHIN : PART.R_SHIN;
		m.prism( [ sh[ 0 ] + 0.02 * s, 1.47, 0 ], el, [ 0.055, 0.06 ], [ 0.045, 0.05 ], 4, UA, SLOT.SHIRT, sh, sh, 0, { b: [ FA, 0.5 ] } );
		m.prism( el, wr, [ 0.045, 0.045 ], [ 0.035, 0.035 ], 4, FA, SLOT.SKIN, el, sh, 0, { a: [ UA, 0.5 ] } );
		const hp = L ? J.lHip : J.rHip, kn = L ? J.lKnee : J.rKnee, an = L ? J.lAnkle : J.rAnkle;
		m.prism( [ hp[ 0 ], 0.9, 0 ], kn, [ 0.075, 0.08 ], [ 0.06, 0.065 ], 4, TH, SLOT.PANTS, hp, hp, 0, { b: [ SH, 0.5 ] } );
		m.prism( kn, an, [ 0.055, 0.06 ], [ 0.045, 0.05 ], 4, SH, SLOT.PANTS, kn, hp, 0, { a: [ TH, 0.5 ] } );
		m.prism( [ an[ 0 ], 0.0, 0.04 ], [ an[ 0 ], 0.09, 0.04 ], [ 0.05, 0.11 ], [ 0.05, 0.1 ], 4, L ? PART.L_SHIN : PART.R_SHIN, SLOT.SHOES, kn, hp );

	}

	return m.build( 'BoxMan' );

}

// ---------------------------------------------------------------------------
// Tier 3: "Hi" - hexagonal limbs, icosphere head, hands, shaped torso.
// Still tiny by modern standards; used to show how triangle count scales.
// ---------------------------------------------------------------------------
function buildHi() {

	const m = new ModelBuilder();
	m.prism( [ 0, 1.0, 0 ], [ 0, 1.25, 0 ], [ 0.15, 0.1 ], [ 0.19, 0.12 ], 8, PART.TORSO, SLOT.SHIRT, J.hip );
	m.prism( [ 0, 1.25, 0 ], [ 0, 1.47, 0 ], [ 0.19, 0.12 ], [ 0.21, 0.1 ], 8, PART.TORSO, SLOT.SHIRT, J.hip );
	m.prism( [ 0, 0.84, 0 ], [ 0, 1.0, 0 ], [ 0.17, 0.1 ], [ 0.15, 0.1 ], 8, PART.TORSO, SLOT.PANTS, J.hip );
	m.prism( [ 0, 1.46, 0 ], [ 0, 1.54, 0 ], [ 0.05, 0.05 ], [ 0.045, 0.045 ], 6, PART.HEAD, SLOT.SKIN, J.neck, J.neck, 0, { a: [ PART.TORSO, 0.6 ] } );
	m.sphere( [ 0, 1.65, 0.01 ], 0.12, 1, PART.HEAD, SLOT.SKIN, J.neck, 1.15 );
	m.sphere( [ 0, 1.7, - 0.015 ], 0.122, 0, PART.HEAD, SLOT.HAIR, J.neck, 1.0 );
	for ( const s of [ 1, - 1 ] ) {

		const L = s > 0;
		const sh = L ? J.lShoulder : J.rShoulder, el = L ? J.lElbow : J.rElbow, wr = L ? J.lWrist : J.rWrist;
		m.octa( [ sh[ 0 ], 1.43, 0 ], 0.07, 0.06, 0.07, L ? PART.L_ARM : PART.R_ARM, SLOT.SHIRT, sh );
		const UA = L ? PART.L_ARM : PART.R_ARM, FA = L ? PART.L_FOREARM : PART.R_FOREARM;
		const TH = L ? PART.L_LEG : PART.R_LEG, SH = L ? PART.L_SHIN : PART.R_SHIN;
		m.prism( [ sh[ 0 ] + 0.01 * s, 1.44, 0 ], el, [ 0.05, 0.055 ], [ 0.042, 0.045 ], 6, UA, SLOT.SHIRT, sh, sh, 0, { b: [ FA, 0.5 ] } );
		m.prism( el, wr, [ 0.042, 0.042 ], [ 0.032, 0.032 ], 6, FA, SLOT.SKIN, el, sh, 0, { a: [ UA, 0.5 ] } );
		m.octa( [ wr[ 0 ], wr[ 1 ] - 0.05, wr[ 2 ] ], 0.035, 0.06, 0.045, L ? PART.L_FOREARM : PART.R_FOREARM, SLOT.SKIN, el, sh );
		const hp = L ? J.lHip : J.rHip, kn = L ? J.lKnee : J.rKnee, an = L ? J.lAnkle : J.rAnkle;
		m.prism( [ hp[ 0 ], 0.92, 0 ], kn, [ 0.075, 0.08 ], [ 0.058, 0.062 ], 6, TH, SLOT.PANTS, hp, hp, 0, { b: [ SH, 0.5 ] } );
		m.prism( kn, an, [ 0.056, 0.06 ], [ 0.042, 0.046 ], 6, SH, SLOT.PANTS, kn, hp, 0, { a: [ TH, 0.5 ] } );
		m.prism( [ an[ 0 ], 0.0, 0.04 ], [ an[ 0 ], 0.09, 0.05 ], [ 0.05, 0.12 ], [ 0.045, 0.09 ], 6, L ? PART.L_SHIN : PART.R_SHIN, SLOT.SHOES, kn, hp );

	}

	return m.build( 'Hi' );

}

export const MODEL_TIERS = [
	{ id: 'tetra', label: 'Tetra (Virtua-style minimum)', build: buildTetra },
	{ id: 'prism', label: 'Prism (Star Fox)', build: buildPrism },
	{ id: 'boxman', label: 'Box-man (Alone in the Dark)', build: buildBoxMan },
	{ id: 'hi', label: 'Hi (hex limbs + sphere head)', build: buildHi }
];

let _cache = null;

export function getModels() {

	if ( _cache === null ) _cache = MODEL_TIERS.map( ( t ) => {

		const geometry = t.build();
		return { ...t, geometry, triangles: geometry.userData.triangles, vertices: geometry.userData.vertices };

	} );

	return _cache;

}

// Blob shadow: a single quad (2 triangles) lying on the ground.
export function buildBlobGeometry() {

	const g = new THREE.PlaneGeometry( 1, 1 );
	g.rotateX( - Math.PI / 2 );
	g.deleteAttribute( 'normal' );
	g.userData.triangles = 2;
	return g;

}
