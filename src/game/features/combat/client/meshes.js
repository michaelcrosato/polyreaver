// Instanced mesh pools for solid-looking VFX: projectile bodies (orbs, ice shards,
// knives, bolts), falling meteors, ice crystals (freeze, Ice Armour, Glacial Cascade
// spikes), orbiting Blade Vortex blades and the spectral minions. Each pool is one
// InstancedMesh refilled every frame (begin -> add... -> end).
//
// Glowing pools use MeshBasicNodeMaterial with an HDR base colour: instance colours
// are multiplied above 1.0 and the tone mapper turns that into a hot, bright core.

import * as THREE from 'three/webgpu';

const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler(), tmpP = new THREE.Vector3(), tmpS = new THREE.Vector3();

class Pool {

	constructor( scene, geo, mat, max, { shadow = false, order = 0 } = {} ) {

		this.mesh = new THREE.InstancedMesh( geo, mat, max );
		this.mesh.instanceMatrix.setUsage( THREE.DynamicDrawUsage );
		this.mesh.count = 0;
		this.mesh.frustumCulled = false;
		this.mesh.castShadow = shadow;
		this.mesh.renderOrder = order;
		this.max = max;
		this.n = 0;
		// make sure the colour attribute exists before the first draw
		this.mesh.setColorAt( 0, new THREE.Color( 1, 1, 1 ) );
		scene.add( this.mesh );

	}

	// yaw: facing (0 = +z), pitch / roll in radians; sx, sy, sz scale
	add( x, y, z, yaw, pitch, roll, sx, sy, sz, color ) {

		if ( this.n >= this.max ) return;
		tmpQ.setFromEuler( tmpE.set( pitch, yaw, roll, 'YXZ' ) );
		this.mesh.setMatrixAt( this.n, tmpM.compose( tmpP.set( x, y, z ), tmpQ, tmpS.set( sx, sy, sz ) ) );
		this.mesh.setColorAt( this.n, color );
		this.n ++;

	}

	end() {

		this.mesh.count = this.n;
		this.mesh.instanceMatrix.needsUpdate = true;
		if ( this.mesh.instanceColor ) this.mesh.instanceColor.needsUpdate = true;
		this.n = 0;

	}

}

const glowMat = ( hdr = 2.5, opts = {} ) => {

	const m = new THREE.MeshBasicNodeMaterial( { ...opts } );
	m.color.setScalar( hdr );
	return m;

};

export class FxMeshes {

	constructor( scene ) {

		const add = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };
		this.orb = new Pool( scene, new THREE.IcosahedronGeometry( 0.5, 1 ), glowMat( 2.6 ), 768 );
		this.shard = new Pool( scene, new THREE.OctahedronGeometry( 0.5, 0 ).scale( 0.32, 0.32, 1.6 ), glowMat( 2.2 ), 768 );
		this.blade = new Pool( scene, new THREE.OctahedronGeometry( 0.5, 0 ).scale( 0.28, 0.05, 1.5 ), glowMat( 2.0 ), 768 );
		this.bolt = new Pool( scene, new THREE.CylinderGeometry( 0.05, 0.12, 1, 6 ).rotateX( Math.PI / 2 ), glowMat( 2.0 ), 512 );
		this.rock = new Pool( scene, new THREE.DodecahedronGeometry( 0.7, 0 ), new THREE.MeshStandardNodeMaterial( { color: 0x3a2418, emissive: 0xff5a10, emissiveIntensity: 2.4, roughness: 0.8 } ), 32, { shadow: true } );
		this.crystal = new Pool( scene, new THREE.OctahedronGeometry( 0.5, 0 ).scale( 0.55, 1.4, 0.55 ),
			new THREE.MeshStandardNodeMaterial( { color: 0xbfefff, emissive: 0x2a7aa8, emissiveIntensity: 0.9, roughness: 0.12, metalness: 0.05, transparent: true, opacity: 0.72 } ), 1024 );
		// spectral minions: additive ghosts
		this.ghost = new Pool( scene, new THREE.CapsuleGeometry( 0.3, 0.8, 4, 10 ), glowMat( 0.9, add ), 64, { order: 3 } );
		this.ghostHead = new Pool( scene, new THREE.SphereGeometry( 0.22, 12, 8 ), glowMat( 1.0, add ), 64, { order: 3 } );
		this.ghostBlade = new Pool( scene, new THREE.BoxGeometry( 0.06, 0.06, 1.1 ).translate( 0, 0, 0.5 ), glowMat( 2.2, add ), 128, { order: 3 } );
		this.pools = [ this.orb, this.shard, this.blade, this.bolt, this.rock, this.crystal, this.ghost, this.ghostHead, this.ghostBlade ];

	}

	end() {

		for ( const p of this.pools ) p.end();

	}

}
