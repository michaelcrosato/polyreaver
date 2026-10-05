// Static city: one building batch and one colored prop batch per 256 m chunk.
// Facades and surface patterns are shader detail, never individual window meshes.
import * as THREE from 'three/webgpu';
import { attribute, normalLocal, positionWorld, uv, vec3, float, texture, mix, fract, step, dot, max, smoothstep, fwidth, abs, uniform } from 'three/tsl';
import { World } from '../../world.js';
import { makeMaterial } from '../../world/materials.js';
import { boxGeometry, pyramidGeometry, mergedGeometry } from './geometry.js';
import { CityTraffic } from '../traffic.js';

const PALETTES = {
	residential: [ 0xc7b69b, 0xb5a385, 0xd2c6b0, 0xa79888 ], apartments: [ 0xb6b9ad, 0xc3b69b, 0xa8b6bc, 0xcec4aa ],
	mixed: [ 0xc2b99b, 0xa0afa9, 0xc6baa8, 0xa6a3b4 ], downtown: [ 0x8cabb2, 0x91a3ad, 0xb1bdc0, 0x738b98 ], industrial: [ 0x949787, 0xb0a695, 0x9faba4, 0x858f9c ]
};

function buildingMaterial() {

	const m = new THREE.MeshBasicNodeMaterial();
	const dimensions = attribute( 'cityDimensions', 'vec3' ), floors = dimensions.z;
	const width = mix( dimensions.x, dimensions.y, abs( normalLocal.x ) );
	const windows = step( .18, fract( uv().x.mul( width.div( 3.5 ) ) ) ).mul( float( 1 ).sub( step( .76, fract( uv().x.mul( width.div( 3.5 ) ) ) ) ) ).mul( step( .25, fract( uv().y.mul( floors ) ) ) ).mul( float( 1 ).sub( step( .76, fract( uv().y.mul( floors ) ) ) ) );
	const sides = float( 1 ).sub( step( .5, normalLocal.y ) );
	const face = max( dot( normalLocal, vec3( -.35, .8, .3 ) ), 0 ).mul( .35 ).add( .65 );
	// Fade subpixel facade patterns when the camera is far from the fragment.
	const detail = float( 1 ).sub( smoothstep( .15, .6, fwidth( uv().y.mul( floors ) ) ) );
	const front = step( .8, dot( normalLocal, attribute( 'cityFront', 'vec3' ) ) );
	const door = float( 1 ).sub( step( .055, abs( uv().x.sub( .5 ) ) ) ).mul( float( 1 ).sub( step( .7, uv().y.mul( floors ) ) ) ).mul( front );
	m.colorNode = mix( mix( vec3( 1 ), vec3( .32, .46, .5 ), windows.mul( sides ).mul( detail ) ), vec3( .25, .3, .29 ), door ).mul( face );
	m.name = 'City box facades';
	return m;

}

function groundMaterial( atlas, detail ) {

	const m = new THREE.MeshBasicNodeMaterial();
	const sample = texture( atlas, positionWorld.xz.add( 1024 ).div( 2048 ) );
	const kind = sample.r.mul( 255 ).round();
	let c = vec3( .28, .37, .3 );
	for ( const [ id, col ] of [ [ 1, [ .16, .19, .21 ] ], [ 2, [ .61, .62, .56 ] ], [ 3, [ .29, .46, .3 ] ], [ 4, [ .15, .36, .44 ] ], [ 5, [ .46, .48, .45 ] ], [ 6, [ .73, .66, .52 ] ], [ 7, [ .3, .33, .32 ] ], [ 8, [ .4, .43, .4 ] ], [ 9, [ .47, .45, .39 ] ] ] ) c = mix( c, vec3( ...col ), kind.equal( id ) );
	const paving = step( .965, fract( positionWorld.x.mul( .5 ) ) ).max( step( .965, fract( positionWorld.z.mul( .5 ) ) ) );
	c = c.mul( float( 1 ).sub( paving.mul( detail ).mul( .08 ).mul( kind.equal( 2 ).or( kind.equal( 6 ) ) ) ) );
	const parking = step( .94, fract( positionWorld.x.div( 3 ) ) ).mul( kind.equal( 7 ) );
	m.colorNode = mix( c, vec3( .73, .72, .62 ), parking );
	return m;

}

export class CityWorld {

	constructor( city, scene ) {

		this.city = city; this.scene = scene;
		this.group = new THREE.Group(); this.group.name = 'Procedural city'; scene.add( this.group );
		this.meshes = []; this.materials = new Set(); this.geometries = new Set(); this.buildingMeshes = [];
		this.box = boxGeometry(); this.pyramid = pyramidGeometry(); this.geometries.add( this.box ); this.geometries.add( this.pyramid );
		this.atlas = new THREE.DataTexture( city.surface.data, 1024, 1024, THREE.RGBAFormat );
		this.atlas.magFilter = this.atlas.minFilter = THREE.NearestFilter; this.atlas.needsUpdate = true;
		this.groundDetail = uniform( 1 ); this.groundWet = uniform( 0 );
		const ground = groundMaterial( this.atlas, this.groundDetail );
		ground.userData.cityGround = true; this.materials.add( ground );
		const plane = ( x0, z0, x1, z1, y ) => {

			const geometry = new THREE.PlaneGeometry( x1 - x0, z1 - z0 ).rotateX( - Math.PI / 2 );
			const m = new THREE.Mesh( geometry, ground ); m.position.set( ( x0 + x1 ) / 2, y, ( z0 + z1 ) / 2 ); this.add( m );

		};
		plane( - 1024, - 1024, 1024, 1024, -.7 );
		plane( - 1024, - 1024, city.water.x0, 1024, 0 );
		plane( city.water.x1, - 1024, 1024, 1024, 0 );
		const bankMaterial = new THREE.MeshBasicNodeMaterial( { color: 0x748078 } ); this.materials.add( bankMaterial );
		for ( const [ x, turn ] of [ [ city.water.x0, Math.PI / 2 ], [ city.water.x1, - Math.PI / 2 ] ] ) {

			const geometry = new THREE.PlaneGeometry( 2048, .7 ).rotateY( turn );
			const bank = new THREE.Mesh( geometry, bankMaterial ); bank.position.set( x, -.35, 0 ); bank.name = 'Canal bank'; this.add( bank );

		}
		for ( const row of city.bridgeRows ) plane( city.water.x0, city.zs[ row ] - city.halves[ row ] - city.config.sidewalk, city.water.x1, city.zs[ row ] + city.halves[ row ] + city.config.sidewalk, 0 );
		const buildings = new Map(), props = new Map();
		const key = ( x, z ) => `${Math.floor( ( x + 1024 ) / 256 )},${Math.floor( ( z + 1024 ) / 256 )}`;
		const append = ( map, k, value ) => { if ( ! map.has( k ) ) map.set( k, [] ); map.get( k ).push( value ); };
		for ( const b of city.buildings ) append( buildings, key( ( b.x0 + b.x1 ) / 2, ( b.z0 + b.z1 ) / 2 ), b );
		for ( const p of city.props ) if ( ! [ 'tree', 'lamp' ].includes( p.type ) ) append( props, key( p.x, p.z ), p );
		for ( const b of city.buildings ) if ( b.landmark ) append( props, key( ( b.x0 + b.x1 ) / 2, ( b.z0 + b.z1 ) / 2 ), { type: 'landmark-cap', x: ( b.x0 + b.x1 ) / 2, z: ( b.z0 + b.z1 ) / 2, y: b.height, sx: ( b.x1 - b.x0 ) * .65, sz: ( b.z1 - b.z0 ) * .65 } );
		const bm = buildingMaterial(); this.materials.add( bm );
		const matrix = new THREE.Matrix4(), color = new THREE.Color();
		for ( const [ k, list ] of buildings ) {

			const geometry = this.box.clone();
			geometry.setAttribute( 'cityDimensions', new THREE.InstancedBufferAttribute( new Float32Array( list.flatMap( ( b ) => [ b.x1 - b.x0, b.z1 - b.z0, b.floors ] ) ), 3 ) );
			geometry.setAttribute( 'cityFront', new THREE.InstancedBufferAttribute( new Float32Array( list.flatMap( ( b ) => b.side === 'north' ? [ 0, 0, - 1 ] : b.side === 'south' ? [ 0, 0, 1 ] : b.side === 'west' ? [ - 1, 0, 0 ] : [ 1, 0, 0 ] ) ), 3 ) );
			const mesh = new THREE.InstancedMesh( geometry, bm, list.length );
			mesh.name = `City buildings ${k}`; mesh.userData.buildings = list;
			for ( const [ i, b ] of list.entries() ) {

				matrix.makeScale( b.x1 - b.x0, b.height, b.z1 - b.z0 ).setPosition( ( b.x0 + b.x1 ) / 2, 0, ( b.z0 + b.z1 ) / 2 );
				mesh.setMatrixAt( i, matrix );
				const palette = PALETTES[ b.type ] || [ 0xd2c39b, 0xe0c7a3, 0xbc9e89, 0xa9c7bf ];
				mesh.setColorAt( i, color.setHex( palette[ b.palette % palette.length ] ) );

			}
			mesh.computeBoundingBox(); mesh.computeBoundingSphere(); this.add( mesh ); this.buildingMeshes.push( mesh );

		}
		const pm = new THREE.MeshBasicNodeMaterial( { vertexColors: true } ); this.materials.add( pm );
		for ( const [ k, list ] of props ) {

			const parts = [];
			for ( const p of list ) {

				if ( p.type === 'tree' ) {

					parts.push( { geometry: this.box, x: p.x, z: p.z, sx: .3, sy: 1.8, sz: .3, color: 0x7a6951 }, { geometry: this.pyramid, x: p.x, y: 1.4, z: p.z, sx: 1.3, sy: p.height - 1.4, sz: 1.3, color: 0x567c50 } );

				} else if ( p.type === 'lamp' ) {

					parts.push( { geometry: this.box, x: p.x, z: p.z, sx: .13, sy: 4, sz: .13, color: 0x657478 }, { geometry: this.box, x: p.x, y: 4, z: p.z, sx: .55, sy: .17, sz: .4, color: 0xe5d99d } );

				} else if ( p.type === 'bench' ) {

					parts.push( { geometry: this.box, x: p.x, z: p.z, sx: 1.8, sy: .45, sz: .5, color: 0x91795d }, { geometry: this.box, x: p.x, y: .45, z: p.z + .2, sx: 1.8, sy: .45, sz: .12, color: 0x91795d } );

				} else if ( p.type === 'landmark-cap' ) parts.push( { geometry: this.box, x: p.x, y: p.y, z: p.z, sx: p.sx, sy: 1.4, sz: p.sz, color: 0xe2cc91 } );
				else if ( p.type === 'transit-stop' ) parts.push( { geometry: this.box, x: p.x, z: p.z, sx: .1, sy: 2.2, sz: .1, color: 0x526b72 }, { geometry: this.box, x: p.x, y: 1.5, z: p.z, sx: .65, sy: .6, sz: .12, color: 0x779fa8 } );
				else if ( p.type === 'signal-post' ) parts.push( { geometry: this.box, x: p.x, z: p.z, sx: .1, sy: 3.2, sz: .1, color: 0x536e74 } );
				else if ( p.type === 'parked-car' ) parts.push( { geometry: this.box, x: p.x, z: p.z, sx: 1.7, sy: .6, sz: 3.6, color: 0xa8b8b9 }, { geometry: this.box, x: p.x, y: .6, z: p.z, sx: 1.45, sy: .6, sz: 2, color: 0x7e949a } );
				else parts.push( { geometry: this.box, x: p.x, z: p.z, sx: .45, sy: .9, sz: .45, color: 0x586767 } );

			}
			const mesh = new THREE.Mesh( mergedGeometry( parts ), pm ); mesh.name = `City props ${k}`; this.add( mesh );

		}
		this.propsOn = true; this.radius = 1450;
		for ( const [ type, geo, meshKey, pointKey ] of [ [ 'tree', mergedGeometry( [ { x: 0, z: 0, geometry: this.box, sx: .3, sy: 1.8, sz: .3, color: 0x7a6951 }, { x: 0, z: 0, geometry: this.pyramid, y: 1.4, sx: 1.3, sy: 3.6, sz: 1.3, color: 0x567c50 } ] ), 'trees', 'treePts' ], [ 'lamp', mergedGeometry( [ { x: 0, z: 0, geometry: this.box, sx: .13, sy: 4, sz: .13, color: 0x657478 }, { x: 0, z: 0, geometry: this.box, y: 4, sx: .55, sy: .17, sz: .4, color: 0xe5d99d } ] ), 'lamps', 'lampPts' ] ] ) {

			const points = city.props.filter( ( p ) => p.type === type ).map( ( p ) => ( { x: p.x, z: p.z, rot: 0, s: type === 'tree' ? p.height / 5 : 1 } ) );
			const material = new THREE.MeshBasicNodeMaterial( { vertexColors: true } ); this.materials.add( material );
			const mesh = new THREE.InstancedMesh( geo, material, points.length ); mesh.name = `City props ${type}`;
			this[ meshKey ] = mesh; this[ pointKey ] = points; this.add( mesh );

		}
		this.resetPropMatrices();
		this.trees.computeBoundingSphere(); this.lamps.computeBoundingSphere();
		this.addMarkings();
		this.traffic = new CityTraffic( city );
		for ( const mesh of [ this.traffic.mesh, this.traffic.signalMesh ] ) {

			this.materials.add( mesh.material ); this.add( mesh );

		}
		this.staticTriangles = this.meshes.reduce( ( sum, m ) => sum + ( m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count ) / 3 * ( m.isInstancedMesh ? m.count : 1 ), 0 );
		this.bytes = city.surface.data.byteLength + this.meshes.reduce( ( n, m ) => n + Object.values( m.geometry.attributes ).reduce( ( sum, a ) => sum + a.array.byteLength, 0 ) + ( m.instanceMatrix?.array.byteLength || 0 ) + ( m.instanceColor?.array.byteLength || 0 ), 0 );

	}

	add( mesh ) {

		mesh.matrixAutoUpdate = false; mesh.updateMatrix();
		this.group.add( mesh ); this.meshes.push( mesh ); this.geometries.add( mesh.geometry );

	}

	addMarkings() {

		const byChunk = new Map();
		const quad = new THREE.PlaneGeometry( 1, 1 ).rotateX( - Math.PI / 2 ).toNonIndexed();
		this.geometries.add( quad );
		const append = ( x, z, sx, sz ) => {

			const key = `${Math.floor( ( x + 1024 ) / 256 )},${Math.floor( ( z + 1024 ) / 256 )}`;
			if ( ! byChunk.has( key ) ) byChunk.set( key, [] );
			byChunk.get( key ).push( { geometry: quad, x, y: .015, z, sx, sz, color: 0xe1dfc4 } );

		};
		for ( const r of this.city.roads ) {

			if ( r.kind === 'alley' ) continue;
			const length = r.axis === 'x' ? r.x1 - r.x0 : r.z1 - r.z0;
			for ( let t = 10; t < length - 10; t += 9 ) append( r.axis === 'x' ? r.x0 + t : ( r.x0 + r.x1 ) / 2, r.axis === 'z' ? r.z0 + t : ( r.z0 + r.z1 ) / 2, r.axis === 'x' ? 4 : .15, r.axis === 'z' ? 4 : .15 );

		}
		for ( const e of this.city.graph.edges ) if ( e.id % 2 === 0 && e.kind === 'crossing' ) {

			for ( let t = 3; t < e.length - 3; t += 2 ) append( e.x + e.dx * t, e.z + e.dz * t, e.dx ? .8 : 4, e.dz ? .8 : 4 );

		}
		for ( const p of this.city.parks ) if ( p.zone === 'park' ) {

			const x = ( p.x0 + p.x1 ) / 2 + 17, z = ( p.z0 + p.z1 ) / 2;
			append( x - 5, z, .15, 14 ); append( x + 5, z, .15, 14 ); append( x, z - 7, 10, .15 ); append( x, z + 7, 10, .15 ); append( x, z, 10, .1 );

		}
		const material = new THREE.MeshBasicNodeMaterial( { vertexColors: true } ); this.materials.add( material );
		for ( const parts of byChunk.values() ) this.add( new THREE.Mesh( mergedGeometry( parts ), material ) );

	}

	setShading( kind ) {

		if ( this.kind === kind ) return;
		this.kind = kind;
		const replacements = new Map();
		for ( const old of this.materials ) {

			const material = makeMaterial( kind, { color: old.color, vertexColors: old.vertexColors, side: old.side } );
			material.colorNode = old.colorNode;
			material.name = old.name;
			material.userData = { ...old.userData };
			if ( old.userData.cityGround && material.isMeshStandardNodeMaterial ) {

				material.roughnessNode = mix( float( .85 ), float( .12 ), this.groundWet );
				material.metalnessNode = mix( float( 0 ), float( .35 ), this.groundWet );

			}
			replacements.set( old, material );

		}
		for ( const mesh of this.meshes ) mesh.material = replacements.get( mesh.material );
		for ( const old of this.materials ) old.dispose();
		this.materials = new Set( replacements.values() );

	}

	resetPropMatrices() { World.prototype.resetPropMatrices.call( this ); }

	setProps( on ) {

		this.propsOn = on;

		for ( const mesh of this.meshes ) if ( mesh.name.startsWith( 'City props' ) ) mesh.visible = on;

	}

	setGroundDetail( on ) { this.groundDetail.value = on ? 1 : 0; }
	setWet( on ) { this.groundWet.value = on ? 1 : 0; }
	update( dt ) { this.traffic.update( dt ); }
	setCarCount( count ) {

		const old = this.traffic.mesh.count;
		this.traffic.setCount( count );
		this.staticTriangles += ( this.traffic.mesh.count - old ) * this.traffic.mesh.geometry.userData.triangles;

	}

	stats( camera ) {

		const frustum = new THREE.Frustum().setFromProjectionMatrix( new THREE.Matrix4().multiplyMatrices( camera.projectionMatrix, camera.matrixWorldInverse ), THREE.WebGPUCoordinateSystem );
		let triangles = 0, draws = 0;
		for ( const m of this.meshes ) if ( m.visible && frustum.intersectsObject( m ) ) {

			triangles += ( m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count ) / 3 * ( m.isInstancedMesh ? m.count : 1 ); draws ++;

		}
		return { triangles, draws, totalTriangles: this.staticTriangles, bytes: this.bytes };

	}

	dispose() {

		this.scene.remove( this.group );
		for ( const m of this.meshes ) if ( m.isInstancedMesh ) m.dispose();
		for ( const g of this.geometries ) g.dispose();
		for ( const m of this.materials ) m.dispose();
		this.atlas.dispose();

	}

}
