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
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { makeMaterial } from './world.js';

let RAPIER = null;

async function loadRapier() {

	if ( RAPIER ) return RAPIER;
	const mod = await import( '@dimforge/rapier3d-compat' );
	RAPIER = mod.default || mod;
	await RAPIER.init();
	return RAPIER;

}

export const SHAPES = [ 'ball', 'box', 'capsule', 'cylinder', 'rock' ];
const MONUMENT = { x: 0, z: - 14 };
const MAX_WRECKING = 6;

function rockPoints() {

	let s = 99;
	const rnd = () => ( ( s = ( s * 16807 ) % 2147483647 ) / 2147483647 );
	const pts = [];
	for ( let i = 0; i < 14; i ++ ) {

		const u = rnd() * Math.PI * 2, v = Math.acos( 2 * rnd() - 1 ), r = 0.3 + rnd() * 0.15;
		pts.push( new THREE.Vector3( r * Math.sin( v ) * Math.cos( u ), r * Math.cos( v ) * 0.75, r * Math.sin( v ) * Math.sin( u ) ) );

	}

	return pts;

}

const ROCK = rockPoints();

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
	// props: trees (trunk + canopy cone), lamps, all inside the current world radius
	// ------------------------------------------------------------------------
	rebuildPropColliders() {

		const R = RAPIER, w = this.world, g = this.worldGfx;
		for ( const c of this.propColliders ) w.removeCollider( c, false );
		for ( const pb of this.propBodies || [] ) w.removeRigidBody( pb.body );
		this.propColliders = [];
		this.propBodies = [];
		this.staticObstacles = [];
		g.resetPropMatrices();
		if ( ! this.p.props || ! g.propsOn || ! g.trees ) return;
		const dynamic = this.p.propsDynamic;
		const up = new THREE.Vector3( 0, 1, 0 ), q = new THREE.Quaternion();

		// Static: plain colliders. Dynamic: a sleeping rigid body per prop that wakes up
		// (and can topple) when something heavy hits it.
		const addProp = ( pt, index, mesh, parts, density, radius ) => {

			if ( ! dynamic ) {

				for ( const [ desc, y ] of parts ) this.propColliders.push( w.createCollider( desc.setTranslation( pt.x, y, pt.z ) ) );
				this.staticObstacles.push( pt.x, 0, pt.z, radius );
				return;

			}

			q.setFromAxisAngle( up, pt.rot );
			const body = w.createRigidBody( R.RigidBodyDesc.dynamic().setTranslation( pt.x, 0, pt.z )
				.setRotation( { x: q.x, y: q.y, z: q.z, w: q.w } ).setCanSleep( true ).setAngularDamping( 0.4 ) );
			for ( const [ desc, y ] of parts ) w.createCollider( desc.setTranslation( 0, y, 0 ).setDensity( density ).setFriction( 0.9 ), body );
			body.sleep();
			this.propBodies.push( { body, mesh, index, s: pt.s, radius } );

		};

		for ( let i = 0; i < g.trees.count; i ++ ) {

			const t = g.treePts[ i ];
			addProp( t, i, g.trees, [
				[ R.ColliderDesc.cylinder( 1.1 * t.s, 0.22 * t.s ), 1.1 * t.s ],
				[ R.ColliderDesc.cone( 1.6 * t.s, 2.0 * t.s ), 3.4 * t.s ]
			], 6, 0.3 * t.s );

		}

		for ( let i = 0; i < g.lamps.count; i ++ ) {

			const t = g.lampPts[ i ];
			addProp( t, i, g.lamps, [ [ R.ColliderDesc.cylinder( 2.1 * t.s, 0.12 * t.s ), 2.1 * t.s ] ], 30, 0.18 * t.s );

		}

		this._propRadius = g.radius;

	}

	// Copy awake (moving / toppled) props back into their instanced meshes, and keep
	// the GPU crowd's obstacle list in sync with where they now stand or lie.
	_syncProps() {

		if ( ! this.propBodies.length ) return;
		const { m, q, p, s } = this._tmp;
		let moved = false;
		for ( const pb of this.propBodies ) {

			if ( pb.body.isSleeping() && ! pb.dirty ) continue;
			const t = pb.body.translation(), r = pb.body.rotation();
			pb.mesh.setMatrixAt( pb.index, m.compose( p.set( t.x, t.y, t.z ), q.set( r.x, r.y, r.z, r.w ), s.setScalar( pb.s ) ) );
			pb.mesh.instanceMatrix.needsUpdate = true;
			pb.dirty = ! pb.body.isSleeping();
			moved = true;

		}

		if ( moved || ! this.staticObstacles.length ) {

			const st = [];
			for ( const pb of this.propBodies ) {

				const t = pb.body.translation(), r = pb.body.rotation();
				// upright props block people; toppled ones (tilted > ~50°) are stepped over
				const upY = 1 - 2 * ( r.x * r.x + r.z * r.z );
				if ( upY > 0.6 ) st.push( t.x, 0, t.z, pb.radius );

			}

			this.staticObstacles = st;

		}

	}

	// ------------------------------------------------------------------------
	// dynamic bodies
	// ------------------------------------------------------------------------
	_removeMeshes() {

		for ( const m of Object.values( this.meshes ) ) {

			this.scene.remove( m );
			m.material.dispose();
			m.dispose();

		}

		this.meshes = {};

	}

	_buildMeshes() {

		this._removeMeshes();
		const n = Math.max( 1, this.p.bodies );
		const geos = {
			ball: new THREE.IcosahedronGeometry( 0.4, 1 ),
			box: new THREE.BoxGeometry( 0.7, 0.7, 0.7 ),
			capsule: new THREE.CapsuleGeometry( 0.25, 0.6, 2, 8 ),
			cylinder: new THREE.CylinderGeometry( 0.3, 0.3, 0.7, 10 ),
			rock: new ConvexGeometry( ROCK )
		};
		for ( const shape of SHAPES ) {

			const mesh = new THREE.InstancedMesh( geos[ shape ], makeMaterial( this.kind ), n );
			mesh.instanceMatrix.setUsage( THREE.DynamicDrawUsage );
			mesh.count = 0;
			mesh.frustumCulled = false;
			mesh.castShadow = mesh.receiveShadow = this.castShadow;
			mesh.name = 'Rapier ' + shape;
			const c = new THREE.Color();
			for ( let i = 0; i < n; i ++ ) mesh.setColorAt( i, shape === 'rock' ? c.setHSL( 0.08, 0.15, 0.35 + Math.random() * 0.2 ) : c.setHSL( Math.random(), 0.6, 0.55 ) );
			this.scene.add( mesh );
			this.meshes[ shape ] = mesh;

		}

	}

	_clearBodies() {

		if ( ! this.world ) return;
		for ( const b of this.bodies ) this.world.removeRigidBody( b.body );
		this.bodies = [];

	}

	_shapeFor( i ) {

		if ( this.p.spawn === 'wall' || this.p.spawn === 'towers' ) return 'box';
		return this.p.shape === 'mixed' ? SHAPES[ i % SHAPES.length ] : this.p.shape;

	}

	_createBody( shape, pos, size, rotY = 0 ) {

		const R = RAPIER;
		const desc = R.RigidBodyDesc.dynamic().setTranslation( pos.x, pos.y, pos.z ).setCanSleep( this.p.sleep ).setCcdEnabled( this.p.ccd );
		if ( rotY ) desc.setRotation( { x: 0, y: Math.sin( rotY / 2 ), z: 0, w: Math.cos( rotY / 2 ) } );
		const body = this.world.createRigidBody( desc );
		let cd, radius;
		switch ( shape ) {

			case 'ball': cd = R.ColliderDesc.ball( 0.4 * size ); radius = 0.4 * size; break;
			case 'box': cd = R.ColliderDesc.cuboid( 0.35 * size, 0.35 * size, 0.35 * size ); radius = 0.45 * size; break;
			case 'capsule': cd = R.ColliderDesc.capsule( 0.3 * size, 0.25 * size ); radius = 0.3 * size; break;
			case 'cylinder': cd = R.ColliderDesc.cylinder( 0.35 * size, 0.3 * size ); radius = 0.35 * size; break;
			default: {

				const pts = new Float32Array( ROCK.length * 3 );
				ROCK.forEach( ( p, k ) => pts.set( [ p.x * size, p.y * size, p.z * size ], k * 3 ) );
				cd = R.ColliderDesc.convexHull( pts ) || R.ColliderDesc.ball( 0.35 * size );
				radius = 0.4 * size;

			}

		}

		cd.setRestitution( this.p.restitution ).setFriction( this.p.friction ).setDensity( 1 );
		const collider = this.world.createCollider( cd, body );
		const b = { body, collider, shape, size, radius };
		this.bodies.push( b );
		return b;

	}

	_randomSize() {

		return this.p.sizeVar === 'varied' ? 0.6 + Math.random() * 1.2 : 1;

	}

	_rainPosition( initial ) {

		const a = Math.random() * Math.PI * 2, r = Math.sqrt( Math.random() ) * 14;
		return { x: this.heroPos.x + Math.cos( a ) * r, y: initial ? 3 + Math.random() * 30 : 18 + Math.random() * 10, z: this.heroPos.z + Math.sin( a ) * r };

	}

	respawn() {

		this._clearBodies();
		this._buildMeshes();
		const n = this.p.bodies, h = this.heroPos;
		const heading = this.heroHeading || 0;
		const fwd = { x: Math.sin( heading ), z: Math.cos( heading ) }, right = { x: fwd.z, z: - fwd.x };
		this._pendingSpawn = 0;
		if ( this.p.spawn === 'rain' ) {

			this._pendingSpawn = n; // spawned gradually in update()

		} else if ( this.p.spawn === 'pile' ) {

			const per = 8, sp = 0.95;
			for ( let i = 0; i < n; i ++ ) {

				const layer = Math.floor( i / ( per * per ) ), k = i % ( per * per );
				const s = this._randomSize();
				this._createBody( this._shapeFor( i ), {
					x: h.x + fwd.x * 7 + ( ( k % per ) - per / 2 ) * sp + ( Math.random() - 0.5 ) * 0.1,
					y: 4 + layer * sp,
					z: h.z + fwd.z * 7 + ( Math.floor( k / per ) - per / 2 ) * sp + ( Math.random() - 0.5 ) * 0.1
				}, s );

			}

		} else if ( this.p.spawn === 'wall' ) {

			const cols = Math.max( 4, Math.round( Math.sqrt( n * 2 ) ) );
			for ( let i = 0; i < n; i ++ ) {

				const row = Math.floor( i / cols ), col = i % cols;
				const off = ( col - cols / 2 + ( row % 2 ) * 0.5 ) * 0.72;
				this._createBody( 'box', { x: h.x + fwd.x * 9 + right.x * off, y: 0.36 + row * 0.71, z: h.z + fwd.z * 9 + right.z * off }, 1, heading );

			}

		} else if ( this.p.spawn === 'towers' ) {

			const towers = 8, per = Math.ceil( n / towers );
			for ( let i = 0; i < n; i ++ ) {

				const t = i % towers, level = Math.floor( i / towers );
				const a = ( t / towers ) * Math.PI * 2;
				this._createBody( 'box', { x: h.x + Math.cos( a ) * 9, y: 0.36 + level * 0.71, z: h.z + Math.sin( a ) * 9 }, 1, ( level % 2 ) * 0.4 );
				void per;

			}

		}

	}

	// ------------------------------------------------------------------------
	// actions
	// ------------------------------------------------------------------------
	explode( center ) {

		if ( ! this.ready || ! this.enabled ) return;
		for ( const b of this.bodies ) {

			const p = b.body.translation();
			const dx = p.x - center.x, dz = p.z - center.z;
			const d = Math.hypot( dx, dz );
			if ( d > 20 ) continue;
			const f = ( 1 - d / 20 ) * 9 * b.size * b.size * b.size;
			b.body.applyImpulse( { x: ( dx / ( d + 0.1 ) ) * f, y: f * 1.4, z: ( dz / ( d + 0.1 ) ) * f }, true );

		}

		const col = this.crowd.collider;
		if ( col ) col.u.blast.value.set( center.x, center.z, 16, 12 );

	}

	dropWreckingBall( heroPos, heading ) {

		if ( ! this.ready || ! this.enabled ) return;
		const R = RAPIER;
		if ( this.wrecking.length >= MAX_WRECKING ) {

			const old = this.wrecking.shift();
			this.world.removeRigidBody( old.body );
			this.scene.remove( old.mesh );

		}

		const x = heroPos.x + Math.sin( heading ) * 8, z = heroPos.z + Math.cos( heading ) * 8;
		const body = this.world.createRigidBody( R.RigidBodyDesc.dynamic().setTranslation( x, 26, z ).setCcdEnabled( true ) );
		this.world.createCollider( R.ColliderDesc.ball( 2.4 ).setDensity( 6 ).setRestitution( 0.2 ).setFriction( 0.6 ), body );
		const mesh = new THREE.Mesh( new THREE.IcosahedronGeometry( 2.4, 2 ), makeMaterial( this.kind === 'unlit' ? 'unlit' : 'standard', { color: 0x2a2d33, ...( this.kind === 'unlit' ? {} : { metalness: 0.8, roughness: 0.35 } ) } ) );
		mesh.castShadow = this.castShadow;
		mesh.name = 'Wrecking ball';
		this.scene.add( mesh );
		this.wrecking.push( { body, mesh, radius: 2.4 } );

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
	// crowd coupling
	// ------------------------------------------------------------------------
	_applyCrowdMode( rebuildAgents = true ) {

		const p = this.p, crowd = this.crowd;
		const mode = p.crowdMode;
		const gpu = mode === 'gpu' || mode === 'rapier';
		crowd.set( { collide: gpu, proxies: mode === 'gpu' && p.proxies } );
		if ( crowd.collider ) {

			crowd.collider.u.radius.value = p.agentRadius;
			crowd.collider.u.knockOn.value = p.knockdown ? 1 : 0;

		}

		if ( mode !== 'gpu' || ! p.proxies ) this._clearProxies();
		if ( mode === 'rapier' ) {

			if ( rebuildAgents || ! this.agentBodies.length ) this._buildAgentBodies();

		} else {

			this._clearAgentBodies();
			crowd.set( { rapierAgents: 0 } );

		}

	}

	_clearProxies() {

		for ( const pb of this.proxyBodies ) {

			this.peopleColliders.delete( pb.handle );
			this.world?.removeRigidBody( pb.body );

		}

		this.proxyBodies = [];
		this.proxyMap.clear();

	}

	_ensureProxyPool() {

		const R = RAPIER;
		const want = this.p.proxyCount;
		while ( this.proxyBodies.length > want ) {

			const pb = this.proxyBodies.pop();
			this.peopleColliders.delete( pb.handle );
			this.world.removeRigidBody( pb.body );

		}
		while ( this.proxyBodies.length < want ) {

			const k = this.proxyBodies.length;
			const body = this.world.createRigidBody( R.RigidBodyDesc.kinematicPositionBased().setTranslation( k, - 50, 0 ) );
			const collider = this.world.createCollider( R.ColliderDesc.capsule( 0.55, this.p.agentRadius ), body );
			this.peopleColliders.add( collider.handle );
			this.proxyBodies.push( { body, agent: - 1, handle: collider.handle } );

		}

	}

	_applyProxies( { list, count } ) {

		this._ensureProxyPool();
		const seen = new Set();
		const pool = this.proxyBodies;
		const free = [];
		for ( let k = 0; k < pool.length; k ++ ) if ( pool[ k ].agent < 0 ) free.push( k );
		const n = Math.min( count, pool.length );
		for ( let e = 0; e < n; e ++ ) {

			const x = list[ e * 4 ], z = list[ e * 4 + 1 ], agent = list[ e * 4 + 2 ];
			seen.add( agent );
			let slot = this.proxyMap.get( agent );
			if ( slot === undefined ) {

				slot = free.pop();
				if ( slot === undefined ) continue;
				pool[ slot ].agent = agent;
				this.proxyMap.set( agent, slot );
				pool[ slot ].body.setTranslation( { x, y: 0.9, z }, true ); // teleport: no velocity

			} else {

				pool[ slot ].body.setNextKinematicTranslation( { x, y: 0.9, z } );

			}

		}

		for ( const [ agent, slot ] of this.proxyMap ) {

			if ( seen.has( agent ) ) continue;
			this.proxyMap.delete( agent );
			pool[ slot ].agent = - 1;
			pool[ slot ].body.setTranslation( { x: slot, y: - 50, z: 0 }, false );

		}

		this.activeProxies = this.proxyMap.size;

	}

	_clearAgentBodies() {

		for ( const a of this.agentBodies ) {

			this.peopleColliders.delete( a.handle );
			this.world?.removeRigidBody( a.body );

		}

		this.agentBodies = [];
		this._agentBuild = null;

	}

	// Rapier crowd: read the first N agent positions back from the GPU, create a
	// dynamic capsule per agent, then hand those agents over to Rapier.
	_buildAgentBodies() {

		this._clearAgentBodies();
		const crowd = this.crowd;
		crowd.set( { rapierAgents: 0 } );
		const n = Math.min( this.p.rapierAgents, crowd.count - 1 );
		if ( n <= 0 ) return;
		const token = {};
		this._agentBuild = token;
		crowd.renderer.getArrayBufferAsync( crowd.renderBuf.value, null, 0, ( n + 1 ) * 16 ).then( ( buf ) => {

			if ( this._agentBuild !== token || ! this.enabled ) return;
			const R = RAPIER, src = new Float32Array( buf );
			crowd.set( { rapierAgents: n } );
			const arr = crowd.rapierIO.value.array; // 2 x vec4 per agent: [ position, steer ]
			for ( let i = 1; i <= n; i ++ ) {

				const x = src[ i * 4 ], z = src[ i * 4 + 2 ];
				const body = this.world.createRigidBody( R.RigidBodyDesc.dynamic().setTranslation( x, 0.9, z ).lockRotations().setLinearDamping( 0.6 ).setCanSleep( false ) );
				const collider = this.world.createCollider( R.ColliderDesc.capsule( 0.55, this.p.agentRadius ).setFriction( 0.1 ).setDensity( 1.2 ), body );
				this.peopleColliders.add( collider.handle );
				this.agentBodies.push( { body, index: i, knock: 0, handle: collider.handle } );
				arr[ i * 8 ] = x;
				arr[ i * 8 + 1 ] = z;
				arr[ i * 8 + 2 ] = 0;

			}

			this._uploadAgentPositions();

		} ).catch( ( e ) => console.warn( 'Rapier crowd setup failed', e ) );

	}

	_uploadAgentPositions() {

		const attr = this.crowd.rapierIO.value;
		attr.clearUpdateRanges();
		attr.addUpdateRange( 0, ( this.agentBodies.length + 1 ) * 8 );
		attr.needsUpdate = true;

	}

	_syncAgentBodies( dt ) {

		if ( ! this.agentBodies.length || ! this.crowd.rapierIO ) return;
		const steer = this._steer;
		const arr = this.crowd.rapierIO.value.array;
		for ( const a of this.agentBodies ) {

			const v = a.body.linvel();
			const t = a.body.translation();
			if ( steer && a.knock <= 0 ) {

				const dvx = steer[ a.index * 8 + 4 ], dvz = steer[ a.index * 8 + 5 ];
				// steer toward the desired velocity; collisions can still push agents around
				const k = Math.min( 1, dt * 8 );
				a.body.setLinvel( { x: v.x + ( dvx - v.x ) * k, y: v.y, z: v.z + ( dvz - v.z ) * k }, true );
				const dev = Math.hypot( v.x - dvx, v.z - dvz );
				if ( dev > 3.2 && this.p.knockdown ) a.knock = 1.2;

			}

			a.knock = Math.max( 0, a.knock - dt );
			// keep people upright and on the ground
			if ( t.y > 1.4 || t.y < 0.5 ) a.body.setTranslation( { x: t.x, y: 0.9, z: t.z }, true );
			arr[ a.index * 8 ] = t.x;
			arr[ a.index * 8 + 1 ] = t.z;
			arr[ a.index * 8 + 2 ] = a.knock > 0 ? 1 : 0;

		}

		this._uploadAgentPositions();

	}

	// Obstacles the GPU crowd collides with: static props + dynamic bodies.
	_fillObstacles() {

		const col = this.crowd.collider;
		if ( ! col ) return;
		// 2 x vec4 per obstacle: position + radius, velocity + speed
		const obs = col.obs.value.array;
		let n = 0;
		const st = this.staticObstacles || [];
		const maxN = obs.length / 8;
		for ( let i = 0; i < st.length && n < maxN; i += 4, n ++ ) {

			obs.set( [ st[ i ], st[ i + 1 ], st[ i + 2 ], st[ i + 3 ], 0, 0, 0, 0 ], n * 8 );

		}

		for ( const b of this.bodies ) {

			if ( n >= maxN ) break;
			const t = b.body.translation();
			if ( t.y - b.radius > 2.0 ) continue;
			const v = b.body.linvel();
			obs.set( [ t.x, t.y, t.z, b.radius, v.x, v.y, v.z, Math.hypot( v.x, v.y, v.z ) ], n * 8 );
			n ++;

		}

		col.upload( n );

		// Big obstacles: monument + wrecking balls
		const big = col.u.big.array, bigVel = col.u.bigVel.array;
		for ( const v of big ) v.set( 0, - 1000, 0, 0 );
		for ( const v of bigVel ) v.set( 0, 0, 0, 0 );
		big[ 0 ].set( MONUMENT.x, 0, MONUMENT.z, this.worldGfx.propsOn ? 6.8 : 0 );
		this.wrecking.forEach( ( w, k ) => {

			const t = w.body.translation(), v = w.body.linvel();
			big[ k + 1 ].set( t.x, t.y, t.z, w.radius );
			bigVel[ k + 1 ].set( v.x, v.y, v.z, Math.hypot( v.x, v.y, v.z ) );

		} );

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
		const crowd = this.crowd;
		if ( crowd.proxies && crowd.proxyBuf && ! this._proxyPending ) {

			this._proxyPending = true;
			const t0 = performance.now();
			crowd.readProxies().then( ( res ) => {

				this.readbackMs = performance.now() - t0;
				if ( this.enabled && this.crowd.proxies ) this._applyProxies( res );
				this._proxyPending = false;

			} ).catch( () => ( this._proxyPending = false ) );

		}

		if ( this.agentBodies.length && crowd.rapierIO && ! this._steerPending ) {

			this._steerPending = true;
			const t0 = performance.now();
			crowd.readSteer( this.agentBodies.length + 1 ).then( ( s ) => {

				this.readbackMs = performance.now() - t0;
				this._steer = s;
				this._steerPending = false;

			} ).catch( () => ( this._steerPending = false ) );

		}

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

		const { m, q, p, s } = this._tmp;
		const counts = {};
		for ( const shape of SHAPES ) counts[ shape ] = 0;
		const range2 = 56 ** 2;
		const hp = this.heroPos;
		for ( const b of this.bodies ) {

			const t = b.body.translation();
			if ( this.p.recycle && this.p.spawn === 'rain' && ( t.y < - 5 || ( t.x - hp.x ) ** 2 + ( t.z - hp.z ) ** 2 > range2 ) ) {

				const np = this._rainPosition( false );
				b.body.setTranslation( np, true );
				b.body.setLinvel( { x: 0, y: 0, z: 0 }, true );
				continue;

			}

			const r = b.body.rotation();
			m.compose( p.set( t.x, t.y, t.z ), q.set( r.x, r.y, r.z, r.w ), s.setScalar( b.size ) );
			const mesh = this.meshes[ b.shape ];
			mesh.setMatrixAt( counts[ b.shape ] ++, m );

		}

		for ( const shape of SHAPES ) {

			const mesh = this.meshes[ shape ];
			if ( ! mesh ) continue;
			mesh.count = counts[ shape ];
			mesh.instanceMatrix.needsUpdate = true;

		}

		for ( const w of this.wrecking ) {

			const t = w.body.translation(), r = w.body.rotation();
			w.mesh.position.set( t.x, t.y, t.z );
			w.mesh.quaternion.set( r.x, r.y, r.z, r.w );

		}

	}

	// ------------------------------------------------------------------------
	// debug draw: every collider as wireframe lines, straight from Rapier
	// ------------------------------------------------------------------------
	_setDebug( on ) {

		if ( ! on && this.debugLines ) {

			this.scene.remove( this.debugLines );
			this.debugLines.material.dispose();
			this.debugLines = null;

		}

		if ( on && ! this.debugLines ) {

			const g = new THREE.BufferGeometry();
			this.debugLines = new THREE.LineSegments( g, new THREE.LineBasicNodeMaterial( { vertexColors: true, transparent: true, opacity: 0.8, depthTest: true } ) );
			this.debugLines.frustumCulled = false;
			this.debugLines.name = 'Rapier debug';
			this.scene.add( this.debugLines );
			this._debugCap = 0;

		}

	}

	_updateDebug() {

		if ( ! this.debugLines ) this._setDebug( true );
		const { vertices, colors } = this.world.debugRender();
		const g = this.debugLines.geometry;
		const nv = vertices.length / 3;
		if ( nv > this._debugCap ) {

			this._debugCap = Math.ceil( nv * 1.5 );
			g.setAttribute( 'position', new THREE.BufferAttribute( new Float32Array( this._debugCap * 3 ), 3 ).setUsage( THREE.DynamicDrawUsage ) );
			g.setAttribute( 'color', new THREE.BufferAttribute( new Float32Array( this._debugCap * 4 ), 4 ).setUsage( THREE.DynamicDrawUsage ) );

		}

		g.getAttribute( 'position' ).array.set( vertices );
		g.getAttribute( 'color' ).array.set( colors );
		g.getAttribute( 'position' ).needsUpdate = true;
		g.getAttribute( 'color' ).needsUpdate = true;
		g.setDrawRange( 0, nv );
		this.debugVertices = nv;

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
