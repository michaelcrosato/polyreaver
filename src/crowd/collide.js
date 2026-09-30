// GPU crowd collisions: a uniform-grid spatial hash rebuilt every frame in compute.
//
//   1. clear      zero every bucket counter                         (TABLE threads)
//   2. insert     each agent snapshots its position and appends its   (N threads)
//                 index to the bucket of the 1 m cell it stands in
//   3. obstacles  props + physics bodies near the ground are appended (O threads)
//                 with index = capacity + obstacleId
//   4. (sim)      each agent scans the 3x3 cells around it and pushes itself out of
//                 overlapping agents / obstacles; fast bodies knock agents over.
//
// Buckets have a fixed capacity (K) so no prefix sum / sort is needed: if more than
// K things land in one cell the extras are simply not seen that frame. That is the
// usual trade-off in real-time crowd separation.
//
// Buffer layout is packed to stay within 8 storage buffers per shader (the WebGPU
// default, and the real limit on many phones):
//   grid      atomic u32, (1 + K) per bucket: [count, item0 .. itemK-1]
//   obstacles 2 x vec4 per obstacle: (x, y, z, radius), (vx, vy, vz, speed)

import * as THREE from 'three/webgpu';
import {
	Fn, If, Loop, float, int, uint, vec2, uniform, uniformArray, instancedArray, instanceIndex,
	atomicAdd, atomicStore, atomicLoad, floor, min, sqrt, dot, max, ivec2
} from 'three/tsl';

export const CELL = 1.0;
export const BUCKET = 8;
export const MAX_OBSTACLES = 32768;
export const MAX_BIG = 8;

function hashCell( c, mask ) {

	return uint( c.x ).mul( 73856093 ).bitXor( uint( c.y ).mul( 19349663 ) ).bitAnd( mask );

}

export class CrowdCollider {

	constructor( capacity ) {

		let table = 4096;
		while ( table < capacity ) table *= 2;
		this.capacity = capacity;
		this.table = table;
		this.mask = uint( table - 1 );

		this.grid = instancedArray( table * ( BUCKET + 1 ), 'uint' ).setName( 'grid' ).toAtomic();
		this.snap = instancedArray( capacity, 'vec2' ).setName( 'crowdSnap' );
		// physics state per agent: knockback velocity xz, knock timer, unused
		this.phys = instancedArray( capacity, 'vec4' ).setName( 'crowdPhys' );

		// Obstacles (CPU -> GPU): [ xyz + radius, velocity xyz + speed ] per obstacle.
		this.obs = instancedArray( MAX_OBSTACLES * 2, 'vec4' ).setName( 'obstacles' );
		this.numObstacles = 0;

		this.u = {
			numObs: uniform( 0, 'uint' ),
			radius: uniform( 0.28 ),
			stiffness: uniform( 1.0 ),
			knockSpeed: uniform( 2.5 ),
			knockOn: uniform( 1 ),
			big: uniformArray( new Array( MAX_BIG ).fill( 0 ).map( () => new THREE.Vector4( 0, - 1000, 0, 0 ) ), 'vec4' ),
			bigVel: uniformArray( new Array( MAX_BIG ).fill( 0 ).map( () => new THREE.Vector4() ), 'vec4' ),
			blast: uniform( new THREE.Vector4( 0, 0, 0, 0 ) ) // x, z, radius, strength (one-frame pulse)
		};

	}

	buildComputes( renderBuf ) {

		const { grid, snap, obs, mask } = this;
		const cap = uint( this.capacity );
		const B1 = BUCKET + 1;

		this.clearCompute = Fn( () => {

			atomicStore( grid.element( instanceIndex.mul( B1 ) ), uint( 0 ) );

		} )().compute( this.table ).setName( 'Grid Clear' );

		this.insertCompute = Fn( () => {

			const i = instanceIndex;
			const rd = renderBuf.element( i );
			const p = vec2( rd.x, rd.z );
			snap.element( i ).assign( p );
			const h = hashCell( ivec2( floor( p.div( CELL ) ) ), mask ).mul( B1 ).toVar();
			const slot = atomicAdd( grid.element( h ), uint( 1 ) ).toVar();
			If( slot.lessThan( uint( BUCKET ) ), () => {

				atomicStore( grid.element( h.add( 1 ).add( slot ) ), i );

			} );

		} )().compute( this.capacity ).setName( 'Grid Insert Agents' );

		this.obstacleCompute = Fn( () => {

			const o = instanceIndex;
			If( o.lessThan( this.u.numObs ), () => {

				const ob = obs.element( o.mul( 2 ) );
				// only things low enough to touch a person
				If( ob.y.sub( ob.w ).lessThan( 2.0 ), () => {

					const h = hashCell( ivec2( floor( ob.xz.div( CELL ) ) ), mask ).mul( B1 ).toVar();
					const slot = atomicAdd( grid.element( h ), uint( 1 ) ).toVar();
					If( slot.lessThan( uint( BUCKET ) ), () => {

						atomicStore( grid.element( h.add( 1 ).add( slot ) ), cap.add( o ) );

					} );

				} );

			} );

		} )().compute( MAX_OBSTACLES ).setName( 'Grid Insert Obstacles' );

	}

	// Emits the separation / knockback code inside the simulation kernel.
	// Returns { push: vec2, knock: vec2, hit: float }.
	emitResolve( i, pos ) {

		const { grid, snap, obs, mask, u } = this;
		const cap = uint( this.capacity );
		const B1 = BUCKET + 1;
		const R = u.radius;
		const push = vec2( 0 ).toVar( 'push' );
		const knock = vec2( 0 ).toVar( 'knock' );
		const hit = float( 0 ).toVar( 'hit' );
		const cell = ivec2( floor( pos.div( CELL ) ) ).toVar( 'cell' );

		for ( let dz = - 1; dz <= 1; dz ++ ) {

			for ( let dx = - 1; dx <= 1; dx ++ ) {

				const h = hashCell( cell.add( ivec2( dx, dz ) ), mask ).mul( B1 ).toVar();
				const n = min( atomicLoad( grid.element( h ) ), uint( BUCKET ) ).toVar();
				Loop( { start: uint( 0 ), end: n, type: 'uint', condition: '<' }, ( { i: s } ) => {

					const j = atomicLoad( grid.element( h.add( 1 ).add( s ) ) ).toVar();
					If( j.lessThan( cap ), () => {

						If( j.notEqual( i ), () => {

							const d = pos.sub( snap.element( j ) ).toVar();
							const d2 = dot( d, d );
							const minD = R.mul( 2 );
							If( d2.lessThan( minD.mul( minD ) ).and( d2.greaterThan( 1e-8 ) ), () => {

								const dist = sqrt( d2 );
								push.addAssign( d.div( dist ).mul( minD.sub( dist ).mul( 0.5 ) ) );

							} );

						} );

					} ).Else( () => {

						const o = j.sub( cap );
						const ob = obs.element( o.mul( 2 ) );
						const d = pos.sub( ob.xz ).toVar();
						const d2 = dot( d, d );
						const minD = R.add( ob.w );
						If( d2.lessThan( minD.mul( minD ) ).and( d2.greaterThan( 1e-8 ) ), () => {

							const dist = sqrt( d2 );
							const n2 = d.div( dist );
							push.addAssign( n2.mul( minD.sub( dist ) ) );
							const v = obs.element( o.mul( 2 ).add( 1 ) );
							If( v.w.greaterThan( u.knockSpeed ), () => {

								knock.addAssign( n2.mul( v.w.mul( 0.7 ) ) );
								hit.assign( 1 );

							} );

						} );

					} );

				} );

			}

		}

		// Big obstacles (monument, wrecking ball) are checked by every agent.
		for ( let b = 0; b < MAX_BIG; b ++ ) {

			const ob = u.big.element( b );
			const d = pos.sub( ob.xz ).toVar();
			const d2 = dot( d, d );
			const minD = R.add( ob.w );
			If( d2.lessThan( minD.mul( minD ) ).and( d2.greaterThan( 1e-8 ) ).and( ob.y.sub( ob.w ).lessThan( 2.0 ) ), () => {

				const dist = sqrt( d2 );
				const n2 = d.div( dist );
				push.addAssign( n2.mul( minD.sub( dist ) ) );
				const v = u.bigVel.element( b );
				If( v.w.greaterThan( u.knockSpeed ), () => {

					knock.addAssign( n2.mul( v.w.mul( 0.9 ).add( 3 ) ) );
					hit.assign( 1 );

				} );

			} );

		}

		// Explosion pulse
		const bl = u.blast;
		const bd = pos.sub( bl.xy ).toVar();
		const bdist = max( sqrt( dot( bd, bd ) ), 0.01 );
		If( bl.w.greaterThan( 0 ).and( bdist.lessThan( bl.z ) ), () => {

			knock.addAssign( bd.div( bdist ).mul( bl.w.mul( float( 1 ).sub( bdist.div( bl.z ) ) ) ) );
			hit.assign( 1 );

		} );

		return { push, knock, hit };

	}

	// CPU side: upload obstacle list (xyz r) + velocities (xyz speed).
	upload( count ) {

		this.numObstacles = Math.min( count, MAX_OBSTACLES );
		this.u.numObs.value = this.numObstacles;
		const attr = this.obs.value;
		attr.clearUpdateRanges();
		attr.addUpdateRange( 0, Math.max( 8, this.numObstacles * 8 ) );
		attr.needsUpdate = true;

	}

	get memoryBytes() {

		return this.table * ( BUCKET + 1 ) * 4 + this.capacity * ( 8 + 16 ) + MAX_OBSTACLES * 32;

	}

	dispose( renderer ) {

		const attrs = renderer._attributes;
		if ( ! attrs ) return;
		for ( const n of [ this.grid, this.snap, this.phys, this.obs ] ) {

			try {

				attrs.delete( n.value );

			} catch { /* not uploaded */ }

		}

	}

}

export { int };
