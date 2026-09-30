// Rapier 0.19.3 demo: rigid bodies raining around the hero.
//
// This is the opposite architecture to the crowd: the simulation runs on the CPU
// (Rust -> WebAssembly), and every frame we copy each body's transform into an
// InstancedMesh, which is uploaded to the GPU. Watch the "physics" CPU time in the
// HUD grow with the body count while the GPU barely notices.

import * as THREE from 'three/webgpu';
import { makeMaterial } from './world.js';

let RAPIER = null;

async function loadRapier() {

	if ( RAPIER ) return RAPIER;
	const mod = await import( '@dimforge/rapier3d-compat' );
	RAPIER = mod.default || mod;
	await RAPIER.init();
	return RAPIER;

}

export class PhysicsDemo {

	constructor( scene ) {

		this.scene = scene;
		this.world = null;
		this.bodies = [];
		this.target = 0;
		this.shape = 'mixed';
		this.kind = 'unlit';
		this.stepMs = 0;
		this.syncMs = 0;
		this.ready = false;
		this.enabled = false;
		this.castShadow = false;
		this.boxMesh = null;
		this.ballMesh = null;
		this.spawnRadius = 14;
		this._tmp = { m: new THREE.Matrix4(), q: new THREE.Quaternion(), p: new THREE.Vector3(), s: new THREE.Vector3( 1, 1, 1 ) };

	}

	get version() {

		return RAPIER ? RAPIER.version() : '0.19.3';

	}

	async enable( heroPos ) {

		this.enabled = true;
		if ( ! this.ready ) {

			const R = await loadRapier();
			this.world = new R.World( { x: 0, y: - 9.81, z: 0 } );
			this.world.timestep = 1 / 60;
			// ground slab
			this.world.createCollider( R.ColliderDesc.cuboid( 5000, 0.5, 5000 ).setTranslation( 0, - 0.5, 0 ).setFriction( 0.8 ) );
			// monument (matches world.js, placed at z = -14)
			this.world.createCollider( R.ColliderDesc.cylinder( 0.45, 6.8 ).setTranslation( 0, 0.45, - 14 ) );
			this.world.createCollider( R.ColliderDesc.cylinder( 5.5, 0.9 ).setTranslation( 0, 5.5, - 14 ) );
			// hero: kinematic capsule the player drives around
			this.hero = this.world.createRigidBody( R.RigidBodyDesc.kinematicPositionBased().setTranslation( heroPos.x, 0.9, heroPos.z ) );
			this.world.createCollider( R.ColliderDesc.capsule( 0.55, 0.35 ), this.hero );
			this.ready = true;

		}

		this._buildMeshes();

	}

	disable() {

		this.enabled = false;
		this._clearBodies();
		this._removeMeshes();

	}

	setShading( kind ) {

		this.kind = kind;
		if ( this.boxMesh ) this._buildMeshes();

	}

	setShadows( on ) {

		this.castShadow = on;
		for ( const m of [ this.boxMesh, this.ballMesh ] ) if ( m ) m.castShadow = m.receiveShadow = on;

	}

	setTarget( n, shape ) {

		const rebuild = shape !== this.shape || n !== this.target;
		this.target = n;
		this.shape = shape;
		if ( this.enabled && this.ready && rebuild ) {

			this._clearBodies();
			this._buildMeshes();

		}

	}

	_removeMeshes() {

		for ( const m of [ this.boxMesh, this.ballMesh ] ) {

			if ( ! m ) continue;
			this.scene.remove( m );
			m.material.dispose();
			m.dispose();

		}

		this.boxMesh = this.ballMesh = null;

	}

	_buildMeshes() {

		this._removeMeshes();
		const n = Math.max( 1, this.target );
		const mk = ( geometry, name ) => {

			const mesh = new THREE.InstancedMesh( geometry, makeMaterial( this.kind ), n );
			mesh.instanceMatrix.setUsage( THREE.DynamicDrawUsage );
			mesh.count = 0;
			mesh.frustumCulled = false;
			mesh.castShadow = mesh.receiveShadow = this.castShadow;
			mesh.name = name;
			const c = new THREE.Color();
			for ( let i = 0; i < n; i ++ ) mesh.setColorAt( i, c.setHSL( Math.random(), 0.55, 0.55 ) );
			this.scene.add( mesh );
			return mesh;

		};

		this.boxMesh = mk( new THREE.BoxGeometry( 0.7, 0.7, 0.7 ), 'Rapier boxes' );
		this.ballMesh = mk( new THREE.IcosahedronGeometry( 0.4, 1 ), 'Rapier balls' );

	}

	_clearBodies() {

		if ( ! this.world ) return;
		for ( const b of this.bodies ) this.world.removeRigidBody( b.body );
		this.bodies = [];

	}

	_spawn( b, heroPos, initial ) {

		const a = Math.random() * Math.PI * 2;
		const r = Math.sqrt( Math.random() ) * this.spawnRadius;
		const y = initial ? 3 + Math.random() * 30 : 18 + Math.random() * 10;
		b.body.setTranslation( { x: heroPos.x + Math.cos( a ) * r, y, z: heroPos.z + Math.sin( a ) * r }, true );
		b.body.setLinvel( { x: 0, y: 0, z: 0 }, true );
		b.body.setAngvel( { x: Math.random() - 0.5, y: Math.random() - 0.5, z: Math.random() - 0.5 }, true );

	}

	_addBody( heroPos ) {

		const R = RAPIER;
		const ball = this.shape === 'ball' || ( this.shape === 'mixed' && this.bodies.length % 2 === 1 );
		const body = this.world.createRigidBody( R.RigidBodyDesc.dynamic().setTranslation( 0, 10, 0 ) );
		const desc = ball ? R.ColliderDesc.ball( 0.4 ) : R.ColliderDesc.cuboid( 0.35, 0.35, 0.35 );
		desc.setRestitution( 0.25 ).setFriction( 0.7 ).setDensity( 1 );
		this.world.createCollider( desc, body );
		const b = { body, ball };
		this.bodies.push( b );
		this._spawn( b, heroPos, true );

	}

	explode( center ) {

		if ( ! this.ready ) return;
		for ( const b of this.bodies ) {

			const p = b.body.translation();
			const dx = p.x - center.x, dz = p.z - center.z;
			const d = Math.hypot( dx, dz );
			if ( d > 20 ) continue;
			const f = ( 1 - d / 20 ) * 9;
			b.body.applyImpulse( { x: ( dx / ( d + 0.1 ) ) * f, y: f * 1.4, z: ( dz / ( d + 0.1 ) ) * f }, true );

		}

	}

	update( dt, heroPos ) {

		if ( ! this.enabled || ! this.ready ) return;

		// Spawn gradually (at most 200 per frame) so creation cost is spread out.
		for ( let i = 0; i < 200 && this.bodies.length < this.target; i ++ ) this._addBody( heroPos );

		this.hero.setNextKinematicTranslation( { x: heroPos.x, y: 0.9, z: heroPos.z } );

		const t0 = performance.now();
		this.world.timestep = Math.min( Math.max( dt, 1 / 240 ), 1 / 30 );
		this.world.step();
		const t1 = performance.now();

		const { m, q, p, s } = this._tmp;
		let nb = 0, nl = 0;
		const range2 = ( this.spawnRadius * 4 ) ** 2;
		for ( const b of this.bodies ) {

			const t = b.body.translation();
			if ( t.y < - 5 || ( t.x - heroPos.x ) ** 2 + ( t.z - heroPos.z ) ** 2 > range2 ) {

				// recycle bodies that fell off or were left behind: keep it raining around the hero
				this._spawn( b, heroPos, false );
				continue;

			}

			const r = b.body.rotation();
			m.compose( p.set( t.x, t.y, t.z ), q.set( r.x, r.y, r.z, r.w ), s );
			if ( b.ball ) this.ballMesh.setMatrixAt( nl ++, m );
			else this.boxMesh.setMatrixAt( nb ++, m );

		}

		this.boxMesh.count = nb;
		this.ballMesh.count = nl;
		this.boxMesh.instanceMatrix.needsUpdate = true;
		this.ballMesh.instanceMatrix.needsUpdate = true;
		if ( this.boxMesh.instanceColor ) this.boxMesh.instanceColor.needsUpdate = false;

		const t2 = performance.now();
		// smoothed timings for the HUD
		this.stepMs += ( ( t1 - t0 ) - this.stepMs ) * 0.1;
		this.syncMs += ( ( t2 - t1 ) - this.syncMs ) * 0.1;

	}

	get triangles() {

		if ( ! this.enabled || ! this.boxMesh ) return 0;
		return this.boxMesh.count * 12 + this.ballMesh.count * 80;

	}

	get awake() {

		if ( ! this.ready ) return 0;
		let n = 0;
		for ( const b of this.bodies ) if ( ! b.body.isSleeping() ) n ++;
		return n;

	}

}
