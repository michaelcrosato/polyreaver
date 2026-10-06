// Rendering ownership, allocation and asynchronous physics invariants. GPU
// integration checks complement these tests; no browser/device is needed here.
import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { Crowd } from '../src/crowd/crowd.js';
import { CrowdCollider, CELL, BUCKET, collisionSearchRadius } from '../src/crowd/collide.js';
import { crowdCapacityLimit, collisionTableSize, storageByteLimit, computeCountLimit, skeletalCapacity } from '../src/crowd/limits.js';
import { applyProxies, clearAgentBodies, requestReadbacks, syncAgentBodies } from '../src/physics/crowd-link.js';
import { loadRapier } from '../src/physics/bodies.js';

function recorder() {

	const freed = new Set(), dispatches = [];
	return { freed, dispatches, _attributes: { delete: ( attribute ) => freed.add( attribute ) },
		compute: ( nodes ) => { for ( const node of Array.isArray( nodes ) ? nodes : [ nodes ] ) dispatches.push( { name: node.name, count: node.count } ); },
		compileComputeAsync: async () => {} };

}

test( 'shrinking an occupied proxy pool preserves only live mappings and immediately assigns newcomers', () => {

	const removed = [], body = () => ( { setTranslation() {}, setNextKinematicTranslation() {} } );
	const demo = { p: { proxyCount: 256 }, proxyBodies: Array.from( { length: 1024 }, ( _, i ) => ( { agent: i + 1, handle: i, body: body() } ) ),
		proxyMap: new Map( Array.from( { length: 1024 }, ( _, i ) => [ i + 1, i ] ) ), peopleColliders: new Set( Array.from( { length: 1024 }, ( _, i ) => i ) ),
		world: { removeRigidBody: ( value ) => removed.push( value ) } };
	applyProxies( demo, { list: new Float32Array( [ 0, 0, 1024, 0, 1, 1, 9999, 0 ] ), count: 2 } );
	assert.equal( demo.proxyBodies.length, 256 );
	assert.equal( removed.length, 768 );
	assert.equal( demo.peopleColliders.size, 256 );
	assert.deepEqual( [ ...demo.proxyMap.keys() ].sort( ( a, b ) => a - b ), [ 1024, 9999 ] );
	for ( const [ agent, slot ] of demo.proxyMap ) assert.equal( demo.proxyBodies[ slot ].agent, agent );
	assert.equal( demo.activeProxies, 2 );

} );

test( 'invalid or short steering never poisons a real Rapier body after fleet growth', async () => {

	const R = await loadRapier(), world = new R.World( { x: 0, y: 0, z: 0 } );
	try {

		const body = world.createRigidBody( R.RigidBodyDesc.dynamic().setTranslation( 0, .9, 0 ) );
		world.createCollider( R.ColliderDesc.capsule( .55, .28 ), body );
		const attribute = { array: new Float32Array( 1001 * 8 ), clearUpdateRanges() {}, addUpdateRange( start, count ) { assert.ok( start + count <= this.array.length ); } };
		const demo = { agentBodies: [ { body, index: 501, knock: 0 } ], crowd: { storageGeneration: 1, rapierIO: { value: attribute } },
			_steer: new Float32Array( 501 * 8 ), _steerStorageGeneration: 1, p: { knockdown: false } };
		syncAgentBodies( demo, 1 / 60 );
		demo._steer = new Float32Array( 1001 * 8 ); demo._steer[ 501 * 8 + 4 ] = NaN;
		syncAgentBodies( demo, 1 / 60 );
		world.step();
		for ( const value of Object.values( body.translation() ) ) assert.ok( Number.isFinite( value ) );
		assert.equal( body.linvel().x, 0 );
		demo._steer[ 501 * 8 + 4 ] = 3;
		syncAgentBodies( demo, 1 / 60 );
		assert.ok( body.linvel().x > 0 );

	} finally { world.free(); }

} );

test( 'readbacks from replaced fleets or storage generations cannot install stale steering', async () => {

	let resolve;
	const attribute = {}, demo = { enabled: true, agentBodies: [ { handle: 1, body: {} } ], peopleColliders: new Set(), world: { removeRigidBody() {} },
		crowd: { storageGeneration: 1, proxies: false, rapierIO: { value: attribute }, readSteer: () => new Promise( ( done ) => { resolve = done; } ) } };
	requestReadbacks( demo );
	clearAgentBodies( demo );
	resolve( new Float32Array( 16 ) );
	await Promise.resolve();
	assert.equal( demo._steer, null );
	assert.equal( demo._steerPending, false );
	demo.agentBodies = [ { handle: 2, body: {} } ];
	requestReadbacks( demo );
	demo.crowd.storageGeneration ++;
	resolve( new Float32Array( 16 ) );
	await Promise.resolve();
	assert.equal( demo._steer, null );
	requestReadbacks( demo );
	const current = new Float32Array( 16 ); resolve( current );
	await Promise.resolve();
	assert.equal( demo._steer, current );
	assert.equal( demo._steerStorageGeneration, 2 );

} );

test( 'capacity bounds cover storage, rounded collision grids, skeletons and two-dimensional dispatch', () => {

	for ( const bytes of [ 1048576, 16777216, 33554432, 134217728, 268435456 ] ) {

		for ( const dimension of [ 128, 1024, 65535 ] ) for ( const collide of [ false, true ] ) {

			const limits = { maxStorageBufferBindingSize: bytes, maxBufferSize: bytes, maxComputeWorkgroupsPerDimension: dimension };
			const capacity = crowdCapacityLimit( limits, { collide } );
			assert.equal( capacity % 64, 0 );
			assert.ok( capacity * 16 <= storageByteLimit( limits ) );
			assert.ok( capacity <= computeCountLimit( limits ) );
			if ( collide ) {

				assert.ok( collisionTableSize( capacity ) * ( BUCKET + 1 ) * 4 <= bytes );
				assert.ok( collisionTableSize( capacity ) <= computeCountLimit( limits ) );

			}
			assert.ok( skeletalCapacity( limits, capacity ) * 480 <= bytes );

		}

	}
	assert.equal( crowdCapacityLimit( { maxStorageBufferBindingSize: 134217728 } ), 4194304 );
	assert.equal( crowdCapacityLimit( { maxStorageBufferBindingSize: 134217728 }, { collide: true } ), 2097152 );
	assert.equal( crowdCapacityLimit( { maxComputeWorkgroupSizeX: 32 } ), 0 );
	assert.throws( () => new CrowdCollider( 4194304, { maxStorageBufferBindingSize: 134217728 } ), RangeError );

} );

test( 'collision search covers supported radii and larger obstacle bounds across cell boundaries', () => {

	for ( const radius of [ .15, .28, .5, .6 ] ) for ( const obstacle of [ 0, .3, .81 ] ) {

		const range = collisionSearchRadius( radius, obstacle ), reach = Math.max( 2 * radius, radius + obstacle );
		for ( const position of [ -.99, -.01, 0, .99, 1.99 ] ) {

			const cell = Math.floor( position / CELL );
			for ( const neighbor of [ position - reach + .0001, position + reach - .0001 ] ) {

				assert.ok( Math.abs( Math.floor( neighbor / CELL ) - cell ) <= range );

			}

		}

	}
	const collider = new CrowdCollider( 64 );
	collider.u.radius.value = .6; collider.obs.value.array[ 3 ] = .81; collider.upload( 1 );
	assert.equal( collider.u.searchRadius.value, 2 );
	collider.u.radius.value = .28; collider.upload( 0 );
	assert.equal( collider.u.searchRadius.value, 1 );

} );

test( 'initialization seeds only active/new slots, preserves shrink-regrow state, and repacks changed surfaces', async () => {

	const renderer = recorder(), crowd = new Crowd( renderer, new THREE.Scene(), { capacity: 1048576, count: 20 } );
	const seed = () => { crowd.initialize(); return [ crowd.u.initOffset.value, renderer.dispatches.at( - 1 ).count ]; };
	assert.deepEqual( seed(), [ 0, 20 ] );
	crowd.setCount( 30 ); assert.deepEqual( seed(), [ 20, 10 ] );
	const dispatched = renderer.dispatches.length;
	crowd.setCount( 5 ); await crowd.prepare(); crowd.initialize();
	crowd.setCount( 25 ); crowd.initialize();
	assert.equal( renderer.dispatches.length, dispatched );
	crowd.setCount( 40 ); assert.deepEqual( seed(), [ 30, 10 ] );
	crowd.setCitySurface( new THREE.DataTexture( new Uint8Array( 4 ), 1, 1 ), { x: 0, z: 0 } );
	assert.deepEqual( seed(), [ 0, 40 ] );
	crowd.setCount( 12 ); assert.deepEqual( seed(), [ 0, 12 ] );
	crowd.setCount( 18 ); assert.deepEqual( seed(), [ 0, 18 ] );
	crowd._needsInit = true; // the app's density-change reset
	assert.deepEqual( seed(), [ 0, 18 ] );
	crowd.setCitySurface( null ); assert.deepEqual( seed(), [ 0, 18 ] );
	crowd.setCapacity( 64 ); assert.deepEqual( seed(), [ 0, 18 ] );
	crowd.dispose();

} );

test( 'reconfiguration releases replaced buffers/kernels and final disposal releases all owned assets', () => {

	const renderer = recorder(), crowd = new Crowd( renderer, new THREE.Scene(), { capacity: 128, count: 100 } );
	let oldDisposed = 0;
	crowd.initCompute.addEventListener( 'dispose', () => oldDisposed ++ );
	crowd.simCompute.addEventListener( 'dispose', () => oldDisposed ++ );
	crowd.set( { rapierAgents: 50, proxies: true, collide: true, path: 'gpu', castShadow: true } );
	assert.equal( oldDisposed, 2 );
	const oldIO = crowd.rapierIO.value;
	crowd.set( { rapierAgents: 75 } );
	assert.ok( renderer.freed.has( oldIO ) );
	const resources = [ crowd.renderBuf, crowd.simBuf, crowd.animBuf, crowd.rapierIO, crowd.proxyBuf, crowd.proxyCounter,
		...crowd.lodBufs, ...crowd.lodAnimBufs, ...crowd.casterBufs, ...crowd.casterAnimBufs,
		crowd.collider.grid, crowd.collider.snap, crowd.collider.phys, crowd.collider.obs ].map( ( node ) => node.value );
	resources.push( crowd.drawArgs );
	const kernels = [ crowd.initCompute, crowd.simCompute, crowd.proxyReset, crowd.proxyGather, crowd.resetCompute, ...crowd.cullPasses, ...crowd.casterPasses,
		crowd.collider.clearCompute, crowd.collider.insertCompute, crowd.collider.obstacleCompute ];
	const disposed = new Set();
	for ( const kernel of kernels ) kernel.addEventListener( 'dispose', () => disposed.add( kernel ) );
	let geometries = 0, textures = 0;
	for ( const geometry of [ ...crowd.lodGeos, ...crowd.casterGeos ] ) geometry.addEventListener( 'dispose', () => geometries ++ );
	crowd.vatTextures = [ new THREE.Texture() ]; crowd.boneTexture = new THREE.Texture();
	for ( const texture of [ ...crowd.vatTextures, crowd.boneTexture ] ) texture.addEventListener( 'dispose', () => textures ++ );
	crowd.dispose(); crowd.dispose();
	assert.ok( resources.every( ( attribute ) => renderer.freed.has( attribute ) ) );
	assert.equal( disposed.size, kernels.length );
	assert.equal( geometries, 8 );
	assert.equal( textures, 2 );

} );
