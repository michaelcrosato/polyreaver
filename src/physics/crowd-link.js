// Rapier <-> GPU crowd coupling: kinematic proxies for people near the hero, the
// "Rapier crowd" mode (agents as dynamic bodies steered by the GPU AI), and the
// obstacle list the GPU crowd collides with. Every function takes the PhysicsDemo
// (../physics.js) it works on.

import { RAPIER, MONUMENT } from './bodies.js';

// ------------------------------------------------------------------------
// crowd coupling
// ------------------------------------------------------------------------
export function applyCrowdMode( demo, rebuildAgents = true ) {

	const p = demo.p, crowd = demo.crowd;
	const mode = p.crowdMode;
	const gpu = mode === 'gpu' || mode === 'rapier';
	crowd.set( { collide: gpu, proxies: mode === 'gpu' && p.proxies } );
	if ( crowd.collider ) {

		crowd.collider.u.radius.value = p.agentRadius;
		crowd.collider.u.knockOn.value = p.knockdown ? 1 : 0;

	}

	if ( mode !== 'gpu' || ! p.proxies ) clearProxies( demo );
	if ( mode === 'rapier' ) {

		if ( rebuildAgents || ! demo.agentBodies.length ) buildAgentBodies( demo );

	} else {

		clearAgentBodies( demo );
		crowd.set( { rapierAgents: 0 } );

	}

}

export function clearProxies( demo ) {

	for ( const pb of demo.proxyBodies ) {

		demo.peopleColliders.delete( pb.handle );
		demo.world?.removeRigidBody( pb.body );

	}

	demo.proxyBodies = [];
	demo.proxyMap.clear();

}

export function ensureProxyPool( demo ) {

	const R = RAPIER;
	const want = demo.p.proxyCount;
	while ( demo.proxyBodies.length > want ) {

		const pb = demo.proxyBodies.pop();
		demo.peopleColliders.delete( pb.handle );
		demo.world.removeRigidBody( pb.body );

	}
	while ( demo.proxyBodies.length < want ) {

		const k = demo.proxyBodies.length;
		const body = demo.world.createRigidBody( R.RigidBodyDesc.kinematicPositionBased().setTranslation( k, - 50, 0 ) );
		const collider = demo.world.createCollider( R.ColliderDesc.capsule( 0.55, demo.p.agentRadius ), body );
		demo.peopleColliders.add( collider.handle );
		demo.proxyBodies.push( { body, agent: - 1, handle: collider.handle } );

	}

}

export function applyProxies( demo, { list, count } ) {

	ensureProxyPool( demo );
	const seen = new Set();
	const pool = demo.proxyBodies;
	const free = [];
	for ( let k = 0; k < pool.length; k ++ ) if ( pool[ k ].agent < 0 ) free.push( k );
	const n = Math.min( count, pool.length );
	for ( let e = 0; e < n; e ++ ) {

		const x = list[ e * 4 ], z = list[ e * 4 + 1 ], agent = list[ e * 4 + 2 ];
		seen.add( agent );
		let slot = demo.proxyMap.get( agent );
		if ( slot === undefined ) {

			slot = free.pop();
			if ( slot === undefined ) continue;
			pool[ slot ].agent = agent;
			demo.proxyMap.set( agent, slot );
			pool[ slot ].body.setTranslation( { x, y: 0.9, z }, true ); // teleport: no velocity

		} else {

			pool[ slot ].body.setNextKinematicTranslation( { x, y: 0.9, z } );

		}

	}

	for ( const [ agent, slot ] of demo.proxyMap ) {

		if ( seen.has( agent ) ) continue;
		demo.proxyMap.delete( agent );
		pool[ slot ].agent = - 1;
		pool[ slot ].body.setTranslation( { x: slot, y: - 50, z: 0 }, false );

	}

	demo.activeProxies = demo.proxyMap.size;

}

export function clearAgentBodies( demo ) {

	for ( const a of demo.agentBodies ) {

		demo.peopleColliders.delete( a.handle );
		demo.world?.removeRigidBody( a.body );

	}

	demo.agentBodies = [];
	demo._agentBuild = null;

}

// Rapier crowd: read the first N agent positions back from the GPU, create a
// dynamic capsule per agent, then hand those agents over to Rapier.
export function buildAgentBodies( demo ) {

	clearAgentBodies( demo );
	const crowd = demo.crowd;
	crowd.set( { rapierAgents: 0 } );
	const n = Math.min( demo.p.rapierAgents, crowd.count - 1 );
	if ( n <= 0 ) return;
	const token = {};
	demo._agentBuild = token;
	crowd.renderer.getArrayBufferAsync( crowd.renderBuf.value, null, 0, ( n + 1 ) * 16 ).then( ( buf ) => {

		if ( demo._agentBuild !== token || ! demo.enabled ) return;
		const R = RAPIER, src = new Float32Array( buf );
		crowd.set( { rapierAgents: n } );
		const arr = crowd.rapierIO.value.array; // 2 x vec4 per agent: [ position, steer ]
		for ( let i = 1; i <= n; i ++ ) {

			const x = src[ i * 4 ], z = src[ i * 4 + 2 ];
			const body = demo.world.createRigidBody( R.RigidBodyDesc.dynamic().setTranslation( x, 0.9, z ).lockRotations().setLinearDamping( 0.6 ).setCanSleep( false ) );
			const collider = demo.world.createCollider( R.ColliderDesc.capsule( 0.55, demo.p.agentRadius ).setFriction( 0.1 ).setDensity( 1.2 ), body );
			demo.peopleColliders.add( collider.handle );
			demo.agentBodies.push( { body, index: i, knock: 0, handle: collider.handle } );
			arr[ i * 8 ] = x;
			arr[ i * 8 + 1 ] = z;
			arr[ i * 8 + 2 ] = 0;

		}

		uploadAgentPositions( demo );

	} ).catch( ( e ) => console.warn( 'Rapier crowd setup failed', e ) );

}

export function uploadAgentPositions( demo ) {

	const attr = demo.crowd.rapierIO.value;
	attr.clearUpdateRanges();
	attr.addUpdateRange( 0, ( demo.agentBodies.length + 1 ) * 8 );
	attr.needsUpdate = true;

}

export function syncAgentBodies( demo, dt ) {

	if ( ! demo.agentBodies.length || ! demo.crowd.rapierIO ) return;
	const steer = demo._steer;
	const arr = demo.crowd.rapierIO.value.array;
	for ( const a of demo.agentBodies ) {

		const v = a.body.linvel();
		const t = a.body.translation();
		if ( steer && a.knock <= 0 ) {

			const dvx = steer[ a.index * 8 + 4 ], dvz = steer[ a.index * 8 + 5 ];
			// steer toward the desired velocity; collisions can still push agents around
			const k = Math.min( 1, dt * 8 );
			a.body.setLinvel( { x: v.x + ( dvx - v.x ) * k, y: v.y, z: v.z + ( dvz - v.z ) * k }, true );
			const dev = Math.hypot( v.x - dvx, v.z - dvz );
			if ( dev > 3.2 && demo.p.knockdown ) a.knock = 1.2;

		}

		a.knock = Math.max( 0, a.knock - dt );
		// keep people upright and on the ground
		if ( t.y > 1.4 || t.y < 0.5 ) a.body.setTranslation( { x: t.x, y: 0.9, z: t.z }, true );
		arr[ a.index * 8 ] = t.x;
		arr[ a.index * 8 + 1 ] = t.z;
		arr[ a.index * 8 + 2 ] = a.knock > 0 ? 1 : 0;

	}

	uploadAgentPositions( demo );

}

// Obstacles the GPU crowd collides with: static props + dynamic bodies.
export function fillObstacles( demo ) {

	const col = demo.crowd.collider;
	if ( ! col ) return;
	// 2 x vec4 per obstacle: position + radius, velocity + speed
	const obs = col.obs.value.array;
	let n = 0;
	const st = demo.staticObstacles || [];
	const maxN = obs.length / 8;
	for ( let i = 0; i < st.length && n < maxN; i += 4, n ++ ) {

		obs.set( [ st[ i ], st[ i + 1 ], st[ i + 2 ], st[ i + 3 ], 0, 0, 0, 0 ], n * 8 );

	}

	for ( const b of demo.bodies ) {

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
	big[ 0 ].set( MONUMENT.x, 0, MONUMENT.z, demo.worldGfx.propsOn ? 6.8 : 0 );
	demo.wrecking.forEach( ( w, k ) => {

		const t = w.body.translation(), v = w.body.linvel();
		big[ k + 1 ].set( t.x, t.y, t.z, w.radius );
		bigVel[ k + 1 ].set( v.x, v.y, v.z, Math.hypot( v.x, v.y, v.z ) );

	} );

}

// GPU -> CPU readbacks (one in flight each; results arrive a frame or two later)
export function requestReadbacks( demo ) {

	const crowd = demo.crowd;
	if ( crowd.proxies && crowd.proxyBuf && ! demo._proxyPending ) {

		demo._proxyPending = true;
		const t0 = performance.now();
		crowd.readProxies().then( ( res ) => {

			demo.readbackMs = performance.now() - t0;
			if ( demo.enabled && demo.crowd.proxies ) applyProxies( demo, res );
			demo._proxyPending = false;

		} ).catch( () => ( demo._proxyPending = false ) );

	}

	if ( demo.agentBodies.length && crowd.rapierIO && ! demo._steerPending ) {

		demo._steerPending = true;
		const t0 = performance.now();
		crowd.readSteer( demo.agentBodies.length + 1 ).then( ( s ) => {

			demo.readbackMs = performance.now() - t0;
			demo._steer = s;
			demo._steerPending = false;

		} ).catch( () => ( demo._steerPending = false ) );

	}

}
