// Dynamic bodies: Rapier loading, body shapes and their instanced meshes, spawn
// patterns, and the explode / wrecking-ball actions. Every function takes the
// PhysicsDemo (../physics.js) it works on.

import * as THREE from 'three/webgpu';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { makeMaterial } from '../world.js';

// Rapier stays a dynamic import: it only loads once physics is turned on. RAPIER is
// a live binding, so importers see the module as soon as loadRapier() has set it.
export let RAPIER = null;

export async function loadRapier() {

	if ( RAPIER ) return RAPIER;
	const mod = await import( '@dimforge/rapier3d-compat' );
	RAPIER = mod.default || mod;
	await RAPIER.init();
	return RAPIER;

}

export const SHAPES = [ 'ball', 'box', 'capsule', 'cylinder', 'rock' ];
export const MONUMENT = { x: 0, z: - 14 };
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

// ------------------------------------------------------------------------
// dynamic bodies
// ------------------------------------------------------------------------
export function removeMeshes( demo ) {

	for ( const m of Object.values( demo.meshes ) ) {

		demo.scene.remove( m );
		m.material.dispose();
		m.dispose();

	}

	demo.meshes = {};

}

export function buildMeshes( demo ) {

	removeMeshes( demo );
	const n = Math.max( 1, demo.p.bodies );
	const geos = {
		ball: new THREE.IcosahedronGeometry( 0.4, 1 ),
		box: new THREE.BoxGeometry( 0.7, 0.7, 0.7 ),
		capsule: new THREE.CapsuleGeometry( 0.25, 0.6, 2, 8 ),
		cylinder: new THREE.CylinderGeometry( 0.3, 0.3, 0.7, 10 ),
		rock: new ConvexGeometry( ROCK )
	};
	for ( const shape of SHAPES ) {

		const mesh = new THREE.InstancedMesh( geos[ shape ], makeMaterial( demo.kind ), n );
		mesh.instanceMatrix.setUsage( THREE.DynamicDrawUsage );
		mesh.count = 0;
		mesh.frustumCulled = false;
		mesh.castShadow = mesh.receiveShadow = demo.castShadow;
		mesh.name = 'Rapier ' + shape;
		const c = new THREE.Color();
		for ( let i = 0; i < n; i ++ ) mesh.setColorAt( i, shape === 'rock' ? c.setHSL( 0.08, 0.15, 0.35 + Math.random() * 0.2 ) : c.setHSL( Math.random(), 0.6, 0.55 ) );
		demo.scene.add( mesh );
		demo.meshes[ shape ] = mesh;

	}

}

export function clearBodies( demo ) {

	if ( ! demo.world ) return;
	for ( const b of demo.bodies ) demo.world.removeRigidBody( b.body );
	demo.bodies = [];

}

export function shapeFor( demo, i ) {

	if ( demo.p.spawn === 'wall' || demo.p.spawn === 'towers' ) return 'box';
	return demo.p.shape === 'mixed' ? SHAPES[ i % SHAPES.length ] : demo.p.shape;

}

export function createBody( demo, shape, pos, size, rotY = 0 ) {

	const R = RAPIER;
	const desc = R.RigidBodyDesc.dynamic().setTranslation( pos.x, pos.y, pos.z ).setCanSleep( demo.p.sleep ).setCcdEnabled( demo.p.ccd );
	if ( rotY ) desc.setRotation( { x: 0, y: Math.sin( rotY / 2 ), z: 0, w: Math.cos( rotY / 2 ) } );
	const body = demo.world.createRigidBody( desc );
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

	cd.setRestitution( demo.p.restitution ).setFriction( demo.p.friction ).setDensity( 1 );
	const collider = demo.world.createCollider( cd, body );
	const b = { body, collider, shape, size, radius };
	demo.bodies.push( b );
	return b;

}

export function randomSize( demo ) {

	return demo.p.sizeVar === 'varied' ? 0.6 + Math.random() * 1.2 : 1;

}

export function rainPosition( demo, initial ) {

	const a = Math.random() * Math.PI * 2, r = Math.sqrt( Math.random() ) * 14;
	return { x: demo.heroPos.x + Math.cos( a ) * r, y: initial ? 3 + Math.random() * 30 : 18 + Math.random() * 10, z: demo.heroPos.z + Math.sin( a ) * r };

}

export function respawn( demo ) {

	clearBodies( demo );
	buildMeshes( demo );
	const n = demo.p.bodies, h = demo.heroPos;
	const heading = demo.heroHeading || 0;
	const fwd = { x: Math.sin( heading ), z: Math.cos( heading ) }, right = { x: fwd.z, z: - fwd.x };
	demo._pendingSpawn = 0;
	if ( demo.p.spawn === 'rain' ) {

		demo._pendingSpawn = n; // spawned gradually in update()

	} else if ( demo.p.spawn === 'pile' ) {

		const per = 8, sp = 0.95;
		for ( let i = 0; i < n; i ++ ) {

			const layer = Math.floor( i / ( per * per ) ), k = i % ( per * per );
			const s = randomSize( demo );
			createBody( demo, shapeFor( demo, i ), {
				x: h.x + fwd.x * 7 + ( ( k % per ) - per / 2 ) * sp + ( Math.random() - 0.5 ) * 0.1,
				y: 4 + layer * sp,
				z: h.z + fwd.z * 7 + ( Math.floor( k / per ) - per / 2 ) * sp + ( Math.random() - 0.5 ) * 0.1
			}, s );

		}

	} else if ( demo.p.spawn === 'wall' ) {

		const cols = Math.max( 4, Math.round( Math.sqrt( n * 2 ) ) );
		for ( let i = 0; i < n; i ++ ) {

			const row = Math.floor( i / cols ), col = i % cols;
			const off = ( col - cols / 2 + ( row % 2 ) * 0.5 ) * 0.72;
			createBody( demo, 'box', { x: h.x + fwd.x * 9 + right.x * off, y: 0.36 + row * 0.71, z: h.z + fwd.z * 9 + right.z * off }, 1, heading );

		}

	} else if ( demo.p.spawn === 'towers' ) {

		const towers = 8, per = Math.ceil( n / towers );
		for ( let i = 0; i < n; i ++ ) {

			const t = i % towers, level = Math.floor( i / towers );
			const a = ( t / towers ) * Math.PI * 2;
			createBody( demo, 'box', { x: h.x + Math.cos( a ) * 9, y: 0.36 + level * 0.71, z: h.z + Math.sin( a ) * 9 }, 1, ( level % 2 ) * 0.4 );
			void per;

		}

	}

}

// ------------------------------------------------------------------------
// actions
// ------------------------------------------------------------------------
export function explode( demo, center ) {

	if ( ! demo.ready || ! demo.enabled ) return;
	for ( const b of demo.bodies ) {

		const p = b.body.translation();
		const dx = p.x - center.x, dz = p.z - center.z;
		const d = Math.hypot( dx, dz );
		if ( d > 20 ) continue;
		const f = ( 1 - d / 20 ) * 9 * b.size * b.size * b.size;
		b.body.applyImpulse( { x: ( dx / ( d + 0.1 ) ) * f, y: f * 1.4, z: ( dz / ( d + 0.1 ) ) * f }, true );

	}

	const col = demo.crowd.collider;
	if ( col ) col.u.blast.value.set( center.x, center.z, 16, 12 );

}

export function dropWreckingBall( demo, heroPos, heading ) {

	if ( ! demo.ready || ! demo.enabled ) return;
	const R = RAPIER;
	if ( demo.wrecking.length >= MAX_WRECKING ) {

		const old = demo.wrecking.shift();
		demo.world.removeRigidBody( old.body );
		demo.scene.remove( old.mesh );

	}

	const x = heroPos.x + Math.sin( heading ) * 8, z = heroPos.z + Math.cos( heading ) * 8;
	const body = demo.world.createRigidBody( R.RigidBodyDesc.dynamic().setTranslation( x, 26, z ).setCcdEnabled( true ) );
	demo.world.createCollider( R.ColliderDesc.ball( 2.4 ).setDensity( 6 ).setRestitution( 0.2 ).setFriction( 0.6 ), body );
	const mesh = new THREE.Mesh( new THREE.IcosahedronGeometry( 2.4, 2 ), makeMaterial( demo.kind === 'unlit' ? 'unlit' : 'standard', { color: 0x2a2d33, ...( demo.kind === 'unlit' ? {} : { metalness: 0.8, roughness: 0.35 } ) } ) );
	mesh.castShadow = demo.castShadow;
	mesh.name = 'Wrecking ball';
	demo.scene.add( mesh );
	demo.wrecking.push( { body, mesh, radius: 2.4 } );

}

// ------------------------------------------------------------------------
// per frame: body and wrecking-ball meshes follow Rapier
// ------------------------------------------------------------------------
export function syncMeshes( demo ) {

	const { m, q, p, s } = demo._tmp;
	const counts = {};
	for ( const shape of SHAPES ) counts[ shape ] = 0;
	const range2 = 56 ** 2;
	const hp = demo.heroPos;
	for ( const b of demo.bodies ) {

		const t = b.body.translation();
		if ( demo.p.recycle && demo.p.spawn === 'rain' && ( t.y < - 5 || ( t.x - hp.x ) ** 2 + ( t.z - hp.z ) ** 2 > range2 ) ) {

			const np = rainPosition( demo, false );
			b.body.setTranslation( np, true );
			b.body.setLinvel( { x: 0, y: 0, z: 0 }, true );
			continue;

		}

		const r = b.body.rotation();
		m.compose( p.set( t.x, t.y, t.z ), q.set( r.x, r.y, r.z, r.w ), s.setScalar( b.size ) );
		const mesh = demo.meshes[ b.shape ];
		mesh.setMatrixAt( counts[ b.shape ] ++, m );

	}

	for ( const shape of SHAPES ) {

		const mesh = demo.meshes[ shape ];
		if ( ! mesh ) continue;
		mesh.count = counts[ shape ];
		mesh.instanceMatrix.needsUpdate = true;

	}

	for ( const w of demo.wrecking ) {

		const t = w.body.translation(), r = w.body.rotation();
		w.mesh.position.set( t.x, t.y, t.z );
		w.mesh.quaternion.set( r.x, r.y, r.z, r.w );

	}

}
