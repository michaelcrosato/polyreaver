// Props as rigid bodies or static colliders, and the GPU crowd's static obstacle
// list that follows them. Every function takes the PhysicsDemo (../physics.js).

import * as THREE from 'three/webgpu';
import { RAPIER } from './bodies.js';

// ------------------------------------------------------------------------
// props: trees (trunk + canopy cone), lamps, all inside the current world radius
// ------------------------------------------------------------------------
export function rebuildPropColliders( demo ) {

	const R = RAPIER, w = demo.world, g = demo.worldGfx;
	for ( const c of demo.propColliders ) w.removeCollider( c, false );
	for ( const pb of demo.propBodies || [] ) w.removeRigidBody( pb.body );
	demo.propColliders = [];
	demo.propBodies = [];
	demo.staticObstacles = [];
	g.resetPropMatrices();
	if ( ! demo.p.props || ! g.propsOn || ! g.trees ) return;
	const dynamic = demo.p.propsDynamic;
	const up = new THREE.Vector3( 0, 1, 0 ), q = new THREE.Quaternion();

	// Static: plain colliders. Dynamic: a sleeping rigid body per prop that wakes up
	// (and can topple) when something heavy hits it.
	const addProp = ( pt, index, mesh, parts, density, radius ) => {

		if ( ! dynamic ) {

			for ( const [ desc, y ] of parts ) demo.propColliders.push( w.createCollider( desc.setTranslation( pt.x, y, pt.z ) ) );
			demo.staticObstacles.push( pt.x, 0, pt.z, radius );
			return;

		}

		q.setFromAxisAngle( up, pt.rot );
		const body = w.createRigidBody( R.RigidBodyDesc.dynamic().setTranslation( pt.x, 0, pt.z )
			.setRotation( { x: q.x, y: q.y, z: q.z, w: q.w } ).setCanSleep( true ).setAngularDamping( 0.4 ) );
		for ( const [ desc, y ] of parts ) w.createCollider( desc.setTranslation( 0, y, 0 ).setDensity( density ).setFriction( 0.9 ), body );
		body.sleep();
		demo.propBodies.push( { body, mesh, index, s: pt.s, radius } );

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

	demo._propRadius = g.radius;

}

// Copy awake (moving / toppled) props back into their instanced meshes, and keep
// the GPU crowd's obstacle list in sync with where they now stand or lie.
export function syncProps( demo ) {

	if ( ! demo.propBodies.length ) return;
	const { m, q, p, s } = demo._tmp;
	let moved = false;
	for ( const pb of demo.propBodies ) {

		if ( pb.body.isSleeping() && ! pb.dirty ) continue;
		const t = pb.body.translation(), r = pb.body.rotation();
		pb.mesh.setMatrixAt( pb.index, m.compose( p.set( t.x, t.y, t.z ), q.set( r.x, r.y, r.z, r.w ), s.setScalar( pb.s ) ) );
		pb.mesh.instanceMatrix.needsUpdate = true;
		pb.dirty = ! pb.body.isSleeping();
		moved = true;

	}

	if ( moved || ! demo.staticObstacles.length ) {

		const st = [];
		for ( const pb of demo.propBodies ) {

			const t = pb.body.translation(), r = pb.body.rotation();
			// upright props block people; toppled ones (tilted > ~50°) are stepped over
			const upY = 1 - 2 * ( r.x * r.x + r.z * r.z );
			if ( upY > 0.6 ) st.push( t.x, 0, t.z, pb.radius );

		}

		demo.staticObstacles = st;

	}

}
