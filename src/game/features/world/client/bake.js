// Part-list baker: turns a §5 part-list model ( { parts: [ { shape, pos, rot,
// scale, color, emissive } ] } ) into ONE BufferGeometry with per-vertex colour and
// glow, so a whole prop type is a single instanced draw no matter how many parts
// it has. Geometry is non-indexed with face normals: the faceted low-poly look of
// Polyreaver, for free.
//
//   bakeModel( def, palette ) -> BufferGeometry   ( attributes: position, normal, color, glow )
//
// Colours may be palette keys ( primary secondary accent skin metal glow dark ) or
// extra keys the caller supplies ( 'roof', 'canopy' ). Results are cached per
// model + palette, so a level with 300 rubble piles bakes rubble once.

import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const unit = {};

function shapeGeometry( shape ) {

	if ( unit[ shape ] ) return unit[ shape ];
	let g;
	switch ( shape ) {

		case 'box': g = new THREE.BoxGeometry( 1, 1, 1 ); break;
		case 'cyl': g = new THREE.CylinderGeometry( 0.5, 0.5, 1, 8 ); break;
		case 'cone': g = new THREE.ConeGeometry( 0.5, 1, 8 ); break;
		case 'sphere': g = new THREE.IcosahedronGeometry( 0.5, 1 ); break;
		case 'tetra': g = new THREE.TetrahedronGeometry( 0.5 ); break;
		case 'octa': g = new THREE.OctahedronGeometry( 0.5 ); break;
		case 'prism': g = new THREE.CylinderGeometry( 0.5, 0.5, 1, 3 ); break;
		case 'spike': g = new THREE.ConeGeometry( 0.5, 1, 4 ); break;
		case 'ring': g = new THREE.TorusGeometry( 0.42, 0.08, 5, 18 ); break;
		case 'disc': g = new THREE.CylinderGeometry( 0.5, 0.5, 0.1, 14 ); break;
		case 'capsule': g = new THREE.CapsuleGeometry( 0.5, 0.5, 3, 8 ).scale( 1, 1 / 1.5, 1 ); break;
		case 'blade': g = new THREE.BoxGeometry( 0.1, 1, 0.25 ); break;
		case 'wedge': {

			// a box whose top slopes from full height at -z to zero at +z
			g = new THREE.BoxGeometry( 1, 1, 1 );
			const pos = g.attributes.position;
			for ( let i = 0; i < pos.count; i ++ ) if ( pos.getY( i ) > 0 && pos.getZ( i ) > 0 ) pos.setY( i, - 0.5 );
			break;

		}

		default: g = new THREE.BoxGeometry( 1, 1, 1 );

	}

	g = g.index ? g.toNonIndexed() : g;
	g.deleteAttribute( 'uv' );
	return ( unit[ shape ] = g );

}

const cache = new Map();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();

export function resolveColor( c, palette ) {

	if ( typeof c === 'string' && c[ 0 ] === '#' ) return c;
	return palette?.[ c ] ?? FALLBACK[ c ] ?? '#888888';

}

const FALLBACK = { primary: '#8a8478', secondary: '#5a564e', accent: '#c8a050', skin: '#c8a088', metal: '#8a8e96', glow: '#ffb04a', dark: '#1a1a1e', roof: '#8a3a2a', canopy: '#b83a3a' };

export function bakeModel( def, palette = null, key = '' ) {

	const k = def.id + '|' + key;
	if ( cache.has( k ) ) return cache.get( k );
	const geos = [];
	for ( const part of def.parts || [] ) {

		const g = shapeGeometry( part.shape ).clone();
		_e.set( ...( part.rot || [ 0, 0, 0 ] ) );
		_m.compose( _p.set( ...( part.pos || [ 0, 0, 0 ] ) ), _q.setFromEuler( _e ), _s.set( ...( part.scale || [ 1, 1, 1 ] ) ) );
		g.applyMatrix4( _m );
		const n = g.attributes.position.count;
		_c.set( resolveColor( part.color, palette ) );
		const col = new Float32Array( n * 3 ), glow = new Float32Array( n );
		for ( let i = 0; i < n; i ++ ) {

			col[ i * 3 ] = _c.r; col[ i * 3 + 1 ] = _c.g; col[ i * 3 + 2 ] = _c.b;
			glow[ i ] = part.emissive || 0;

		}

		g.setAttribute( 'color', new THREE.BufferAttribute( col, 3 ) );
		g.setAttribute( 'glow', new THREE.BufferAttribute( glow, 1 ) );
		geos.push( g );

	}

	const merged = geos.length ? mergeGeometries( geos ) : new THREE.BoxGeometry( 0.5, 0.5, 0.5 );
	merged.computeVertexNormals(); // non-indexed -> per-face normals (faceted)
	merged.computeBoundingSphere();
	for ( const g of geos ) g.dispose();
	cache.set( k, merged );
	return merged;

}

// Bounding height of a baked model (for lights and labels).
export function modelHeight( geo ) {

	if ( ! geo.boundingBox ) geo.computeBoundingBox();
	return geo.boundingBox.max.y;

}

export function clearBakeCache() {

	for ( const g of cache.values() ) g.dispose();
	cache.clear();

}
