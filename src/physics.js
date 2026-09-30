// Physics: Rapier 0.19.3 (CPU / WebAssembly) + GPU crowd collisions, coupled.
//
// What collides with what when physics is on:
//   bodies  <-> bodies, ground, props (trees, lamps, monument)      Rapier
//   hero    <-> props, bodies (kinematic character controller)      Rapier
//   people  <-> people, props, bodies (push + knockdown)            GPU spatial hash (collide.js)
//   bodies  <-> people near the hero (two-way)                      Rapier kinematic "proxies"
//                                                                   placed from a GPU readback
//   or: the first N people are real Rapier bodies                   "Rapier crowd" mode: GPU
//       (every collision two-way, steering from the GPU AI)          steers, CPU simulates
//
// It is deliberately two architectures side by side: the GPU path scales to huge
// crowds but is one-way/approximate; the Rapier path is exact and two-way but costs
// CPU time per body plus a GPU<->CPU round trip every frame.

import * as THREE from 'three/webgpu';
import { RAPIER, loadRapier, MONUMENT } from './physics/bodies.js';
import * as bodies from './physics/bodies.js';
import * as props from './physics/props.js';
import * as crowdLink from './physics/crowd-link.js';
import * as debug from './physics/debug.js';

export { SHAPES } from './physics/bodies.js';

export class PhysicsDemo {

	constructor( scene, world, crowd ) {

		this.scene = scene;
		this.worldGfx = world;
		this.crowd = crowd;
		this.world = null;
		this.ready = false;
		this.enabled = false;
		this.kind = 'unlit';
		this.castShadow = false;

		this.p = {
			bodies: 1000, shape: 'mixed', sizeVar: 'uniform', spawn: 'rain', restitution: 0.25, friction: 0.7,
			gravity: - 9.81, hz: 60, iterations: 4, ccd: false, sleep: true, recycle: true, props: true, propsDynamic: true,
			crowdMode: 'gpu', rapierAgents: 2000, proxies: true, proxyCount: 1024, agentRadius: 0.28, knockdown: true, debug: false
		};

		this.bodies = [];
		this.meshes = {};
		this.wrecking = [];
		this.propColliders = [];
		this.propBodies = [];
		this.proxyBodies = [];
		this.proxyMap = new Map();
		this.agentBodies = [];
		this.peopleColliders = new Set(); // proxies + Rapier agents: ignored by the hero controller
		this.stepMs = 0;
		this.syncMs = 0;
		this.readbackMs = 0;
		this._acc = 0;
		this._proxyPending = false;
		this._steerPending = false;
		this._steer = null;
		this._tmp = { m: new THREE.Matrix4(), q: new THREE.Quaternion(), p: new THREE.Vector3(), s: new THREE.Vector3() };
		this.heroPos = new THREE.Vector3();

	}

	get version() {

		return RAPIER ? RAPIER.version() : '0.19.3';

	}

	// ------------------------------------------------------------------------
	// lifecycle
	// ------------------------------------------------------------------------
	async enable( heroPos ) {

		this.enabled = true;
		this.heroPos.copy( heroPos );
		if ( ! this.ready ) {

			const R = await loadRapier();
			this.world = new R.World( { x: 0, y: this.p.gravity, z: 0 } );
			this.world.createCollider( R.ColliderDesc.cuboid( 5000, 0.5, 5000 ).setTranslation( 0, - 0.5, 0 ).setFriction( 0.9 ) );
			this.world.createCollider( R.ColliderDesc.cylinder( 0.45, 6.8 ).setTranslation( MONUMENT.x, 0.45, MONUMENT.z ) );
			this.world.createCollider( R.ColliderDesc.cylinder( 5.5, 0.9 ).setTranslation( MONUMENT.x, 5.5, MONUMENT.z ) );
			// hero: kinematic capsule moved by a character controller
			this.hero = this.world.createRigidBody( R.RigidBodyDesc.kinematicPositionBased().setTranslation( heroPos.x, 0.9, heroPos.z ) );
			this.heroCollider = this.world.createCollider( R.ColliderDesc.capsule( 0.55, 0.35 ), this.hero );
			this.controller = this.world.createCharacterController( 0.02 );
			this.controller.setApplyImpulsesToDynamicBodies( true );
			this.controller.setCharacterMass( 90 );
			this.ready = true;

		}

		if ( ! this.enabled ) return; // disabled while loading
		this.hero.setTranslation( { x: heroPos.x, y: 0.9, z: heroPos.z }, true );
		this.applyWorldParams();
		this.rebuildPropColliders();
		this.respawn();
		this._applyCrowdMode();

	}

	disable() {

		this.enabled = false;
		this._clearBodies();
		this._clearAgentBodies();
		this._clearProxies();
		this._removeMeshes();
		for ( const w of this.wrecking ) {

			this.world?.removeRigidBody( w.body );
			this.scene.remove( w.mesh );

		}

		this.wrecking = [];
		for ( const pb of this.propBodies ) this.world?.removeRigidBody( pb.body );
		for ( const c of this.propColliders ) this.world?.removeCollider( c, false );
		this.propBodies = [];
		this.propColliders = [];
		this.worldGfx.resetPropMatrices();
		this._setDebug( false );
		this.crowd.set( { collide: false, proxies: false, rapierAgents: 0 } );

	}

	// Apply a partial parameter set; rebuilds only what the change requires.
	configure( next ) {

		const prev = { ...this.p };
		Object.assign( this.p, next );
		if ( ! this.enabled || ! this.ready ) return;
		const changed = ( ...keys ) => keys.some( ( k ) => prev[ k ] !== this.p[ k ] );
		if ( changed( 'gravity', 'iterations', 'restitution', 'friction', 'ccd' ) ) this.applyWorldParams();
		if ( changed( 'props', 'propsDynamic' ) ) this.rebuildPropColliders();
		if ( changed( 'bodies', 'shape', 'sizeVar', 'spawn', 'sleep' ) ) this.respawn();
		if ( changed( 'crowdMode', 'rapierAgents', 'proxies', 'proxyCount', 'agentRadius', 'knockdown' ) ) this._applyCrowdMode( changed( 'crowdMode', 'rapierAgents', 'agentRadius' ) );
		if ( changed( 'debug' ) ) this._setDebug( this.p.debug );

	}

	applyWorldParams() {

		const w = this.world;
		w.gravity = { x: 0, y: this.p.gravity, z: 0 };
		w.numSolverIterations = this.p.iterations;
		for ( const b of this.bodies ) {

			b.collider.setRestitution( this.p.restitution );
			b.collider.setFriction( this.p.friction );
			b.body.enableCcd( this.p.ccd );
			b.body.wakeUp();

		}

	}

	setShading( kind ) {

		this.kind = kind;
		if ( this.enabled && Object.keys( this.meshes ).length ) this._buildMeshes();

	}

	setShadows( on ) {

		this.castShadow = on;
		for ( const m of Object.values( this.meshes ) ) m.castShadow = m.receiveShadow = on;
		for ( const w of this.wrecking ) w.mesh.castShadow = on;

	}

	// ------------------------------------------------------------------------
	// props (physics/props.js)
	// ------------------------------------------------------------------------
	rebuildPropColliders() {

		props.rebuildPropColliders( this );

	}

	_syncProps() {

		props.syncProps( this );

	}

	// ------------------------------------------------------------------------
	// dynamic bodies (physics/bodies.js)
	// ------------------------------------------------------------------------
	_removeMeshes() {

		bodies.removeMeshes( this );

	}

	_buildMeshes() {

		bodies.buildMeshes( this );

	}

	_clearBodies() {

		bodies.clearBodies( this );

	}

	_shapeFor( i ) {

		return bodies.shapeFor( this, i );

	}

	_createBody( shape, pos, size, rotY = 0 ) {

		return bodies.createBody( this, shape, pos, size, rotY );

	}

	_randomSize() {

		return bodies.randomSize( this );

	}

	_rainPosition( initial ) {

		return bodies.rainPosition( this, initial );

	}

	respawn() {

		bodies.respawn( this );

	}

	// ------------------------------------------------------------------------
	// actions
	// ------------------------------------------------------------------------
	explode( center ) {

		bodies.explode( this, center );

	}

	dropWreckingBall( heroPos, heading ) {

		bodies.dropWreckingBall( this, heroPos, heading );

	}

	// Hero movement through the character controller: slides along props and
	// shoves bodies instead of walking through them.
	moveHero( pos, delta ) {

		if ( ! this.enabled || ! this.ready ) return false;
		// People (proxies / Rapier agents) are excluded from the controller query: the hero's
		// kinematic body still shoves them in the solver, but they can't trap the player.
		const people = this.peopleColliders;
		this.controller.computeColliderMovement( this.heroCollider, { x: delta.x, y: 0, z: delta.z }, undefined, undefined,
			people.size ? ( c ) => ! people.has( c.handle ) : undefined );
		const m = this.controller.computedMovement();
		pos.x += m.x;
		pos.z += m.z;
		this.hero.setNextKinematicTranslation( { x: pos.x, y: 0.9, z: pos.z } );
		return true;

	}

	// ------------------------------------------------------------------------
	// crowd coupling (physics/crowd-link.js)
	// ------------------------------------------------------------------------
	_applyCrowdMode( rebuildAgents = true ) {

		crowdLink.applyCrowdMode( this, rebuildAgents );

	}

	_clearProxies() {

		crowdLink.clearProxies( this );

	}

	_clearAgentBodies() {

		crowdLink.clearAgentBodies( this );

	}

	_syncAgentBodies( dt ) {

		crowdLink.syncAgentBodies( this, dt );

	}

	_fillObstacles() {

		crowdLink.fillObstacles( this );

	}

	_requestReadbacks() {

		crowdLink.requestReadbacks( this );

	}

	// ------------------------------------------------------------------------
	// per frame
	// ------------------------------------------------------------------------
	update( dt, heroPos, heroHeading ) {

		if ( ! this.enabled || ! this.ready ) return;
		this.heroPos.copy( heroPos );
		this.heroHeading = heroHeading;
		if ( this.p.props && Math.abs( ( this._propRadius || 0 ) - this.worldGfx.radius ) > 10 ) this.rebuildPropColliders();

		// gradual spawning for the rain pattern
		for ( let i = 0; i < 200 && this._pendingSpawn > 0; i ++, this._pendingSpawn -- ) {

			this._createBody( this._shapeFor( this.bodies.length ), this._rainPosition( true ), this._randomSize() );

		}

		// GPU -> CPU readbacks (one in flight each; results arrive a frame or two later)
		this._requestReadbacks();

		// fixed-timestep simulation
		const t0 = performance.now();
		const h = 1 / this.p.hz;
		this._acc = Math.min( this._acc + dt, h * 4 );
		let steps = 0;
		this.world.timestep = h;
		while ( this._acc >= h && steps < 4 ) {

			this.world.step();
			this._acc -= h;
			steps ++;

		}

		const t1 = performance.now();

		this._syncAgentBodies( dt );
		this._syncProps();
		this._syncMeshes();
		this._fillObstacles();
		if ( this.p.debug ) this._updateDebug();
		const t2 = performance.now();
		this.stepMs += ( ( t1 - t0 ) - this.stepMs ) * 0.1;
		this.syncMs += ( ( t2 - t1 ) - this.syncMs ) * 0.1;
		this.lastSteps = steps;

	}

	_syncMeshes() {

		bodies.syncMeshes( this );

	}

	// ------------------------------------------------------------------------
	// debug draw (physics/debug.js)
	// ------------------------------------------------------------------------
	_setDebug( on ) {

		debug.setDebug( this, on );

	}

	_updateDebug() {

		debug.updateDebug( this );

	}

	// ------------------------------------------------------------------------
	// stats
	// ------------------------------------------------------------------------
	get triangles() {

		if ( ! this.enabled ) return 0;
		const per = { ball: 80, box: 12, capsule: 80, cylinder: 40, rock: 24 };
		let t = 0;
		for ( const [ shape, mesh ] of Object.entries( this.meshes ) ) t += mesh.count * per[ shape ];
		return t + this.wrecking.length * 320;

	}

	get awake() {

		if ( ! this.ready ) return 0;
		let n = 0;
		for ( const b of this.bodies ) if ( ! b.body.isSleeping() ) n ++;
		return n;

	}

	stats() {

		return {
			bodies: this.bodies.length + this.wrecking.length,
			colliders: this.world ? this.world.colliders.len() : 0,
			proxies: this.activeProxies || 0,
			agents: this.agentBodies.length,
			stepMs: this.stepMs, syncMs: this.syncMs, readbackMs: this.readbackMs, steps: this.lastSteps || 0
		};

	}

}
