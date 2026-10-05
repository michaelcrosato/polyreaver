// A single instanced low-poly fleet. CityWorld owns its meshes and materials so
// shading, shadows, preparation and scene disposal follow the original engine.
import * as THREE from 'three/webgpu';
import { boxGeometry, mergedGeometry } from './render/geometry.js';
import { TrafficSimulation, CPU_CARS, signalPhase, carCount } from './traffic-sim.js';
import { GpuTraffic } from './traffic-gpu.js';

const PALETTE = [ 0xddc9a4, 0xabcfbe, 0xadbfcb, 0xb1907c, 0xd39b72, 0xd0d6d2, 0x8298b4, 0xb87567 ];

export class CityTraffic {

	constructor( city, renderer, count = 128 ) {

		this.sim = new TrafficSimulation( city, count );
		this.count = carCount( count ); this.time = 0;
		const box = boxGeometry(), wheel = new THREE.CylinderGeometry( .3, .3, 1, 8 ).rotateZ( Math.PI / 2 ).toNonIndexed();
		const parts = [
			{ geometry: box, x: 0, y: .3, z: 0, sx: 1.7, sy: .55, sz: 3.6 },
			{ geometry: box, x: 0, y: .85, z: -.15, sx: 1.35, sy: .6, sz: 1.85, color: 0x718d9c },
			{ geometry: box, x: 0, y: 1.45, z: -.15, sx: 1.4, sy: .08, sz: 1.9 }
		];
		for ( const x of [ - .8, .8 ] ) for ( const z of [ - 1.15, 1.15 ] ) parts.push( { geometry: wheel, x, y: .3, z, sx: .22, color: 0x242b30 } );
		for ( const x of [ - .55, .55 ] ) {

			parts.push( { geometry: box, x, y: .52, z: 1.8, sx: .32, sy: .18, sz: .04, color: 0xfff0ba } );
			parts.push( { geometry: box, x, y: .52, z: - 1.8, sx: .32, sy: .18, sz: .04, color: 0xb83228 } );

		}
		const geometry = mergedGeometry( parts ); box.dispose(); wheel.dispose();
		const material = new THREE.MeshBasicNodeMaterial( { vertexColors: true } );
		this.mesh = new THREE.InstancedMesh( geometry, material, CPU_CARS ); this.mesh.name = 'City road cars'; this.mesh.userData.cityCars = true;
		this.mesh.instanceMatrix.setUsage( THREE.DynamicDrawUsage );
		// Fixed city bounds prevent the opening fleet position from culling moving
		// cars later; no bounds, geometry or shaders are rebuilt during driving.
		this.mesh.boundingBox = new THREE.Box3( new THREE.Vector3( - 1024, 0, - 1024 ), new THREE.Vector3( 1024, 2, 1024 ) );
		this.mesh.boundingSphere = new THREE.Sphere( new THREE.Vector3(), 1450 );
		for ( let i = 0; i < CPU_CARS; i ++ ) this.mesh.setColorAt( i, new THREE.Color( PALETTE[ i % PALETTE.length ] ) );
		this.gpu = new GpuTraffic( city, renderer, geometry ); this.carMeshes = [ this.mesh, ...this.gpu.meshes ];
		this.matrix = new THREE.Matrix4(); this.quaternion = new THREE.Quaternion(); this.position = new THREE.Vector3(); this.scale = new THREE.Vector3( 1, 1, 1 ); this.color = new THREE.Color();
		this.signalMesh = new THREE.InstancedMesh( boxGeometry(), new THREE.MeshBasicNodeMaterial(), city.signals.length * 2 );
		this.signalMesh.name = 'City traffic lights';
		for ( const s of city.signals ) {

			const i = s.id % 17, j = Math.floor( s.id / 17 );
			this.signalMesh.setMatrixAt( s.id * 2, new THREE.Matrix4().makeScale( .35, .6, .25 ).setPosition( s.x + city.halves[ i ] + city.config.sidewalk + .4, 2.8, s.z - city.halves[ j ] - city.config.sidewalk / 2 ) );
			this.signalMesh.setMatrixAt( s.id * 2 + 1, new THREE.Matrix4().makeScale( .25, .6, .35 ).setPosition( s.x - city.halves[ i ] - city.config.sidewalk / 2, 2.8, s.z + city.halves[ j ] + city.config.sidewalk + .4 ) );

		}
		this.signalMesh.computeBoundingSphere(); this.lightTick = - 1;
		this.setCount( count );

	}

	setCount( count ) {

		this.count = carCount( count );
		this.sim.setCount( this.count <= CPU_CARS ? this.count : 0 );
		this.gpu.setCount( this.count > CPU_CARS ? this.count : 0 );
		this.mesh.visible = this.count <= CPU_CARS && this.count > 0;
		this.update( 0 );

	}

	update( dt, camera ) {

		const advance = Number.isFinite( dt ) ? Math.max( 0, Math.min( dt, .1 ) ) : 0;
		this.sim.time = this.time; this.time += advance;
		this.sim.update( advance ); this.gpu.update( advance, this.time, camera ); this.mesh.count = this.sim.states.length;
		for ( const state of this.sim.states ) {

			this.quaternion.setFromAxisAngle( THREE.Object3D.DEFAULT_UP, state.heading );
			this.matrix.compose( this.position.set( state.x, .04, state.z ), this.quaternion, this.scale );
			this.mesh.setMatrixAt( state.id, this.matrix );

		}
		this.mesh.instanceMatrix.needsUpdate = true;
		const tick = Math.floor( this.time * 10 );
		if ( tick === this.lightTick ) return;
		this.lightTick = tick;
		for ( const s of this.sim.city.signals ) {

			const phase = signalPhase( s, this.time );
			this.signalMesh.setColorAt( s.id * 2, this.color.setHex( phase < 12 ? 0x79b794 : phase < 14 ? 0xf2cf76 : 0xb96555 ) );
			this.signalMesh.setColorAt( s.id * 2 + 1, this.color.setHex( phase >= 14 && phase < 26 ? 0x79b794 : phase >= 26 ? 0xf2cf76 : 0xb96555 ) );

		}
		this.signalMesh.instanceColor.needsUpdate = true;

	}

	get triangles() { return this.count <= CPU_CARS ? this.mesh.count * this.mesh.geometry.userData.triangles : this.gpu.triangles; }
	get draws() { return this.count > CPU_CARS ? 2 : this.count ? 1 : 0; }
	dispose() { this.gpu.dispose(); }

}
