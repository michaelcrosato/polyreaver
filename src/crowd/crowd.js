// GPU crowd: simulation in a compute shader, animation in the vertex shader.
//
// Per-agent storage (all on the GPU):
//   renderBuf[i] = ( x, animPhase, z, packed )     packed = state + 8*heading8 + 2048*colourSeed
//   simBuf[i]    = ( targetX, targetZ, stateTimer, headingPrecise )
//   animBuf[i]   = ( prevState, blend, prevPhase, agentIndex )   cross-fade + skeletal lookup
// Optional (physics):
//   collider.*   spatial hash grid, knockback state, obstacle list   (collide.js)
//   rapierIO     Rapier-driven agents: CPU writes positions, GPU writes desired velocity
//   proxyBuf     agents near the hero, read back so Rapier can give them colliders
//
// Two render paths:
//   DIRECT     - one instanced draw call for the whole crowd.
//   GPU-DRIVEN - compute frustum-cull + LOD selection + drawIndexedIndirect per LOD;
//                shadow casters are culled separately against the sun (cull.js).
//
// Code layout:
//   crowd.js      the Crowd class: buffers, options, per-frame dispatch, stats, readbacks
//   sim.js        compute kernels: init, simulation, skeletal FK, proxy gather
//   cull.js       GPU-driven path: cull + LOD passes, indirect draw args, readback
//   materials.js  vertex shader, materials and the meshes that draw them

import * as THREE from 'three/webgpu';
import { uniform, uniformArray, instancedArray, varyingProperty } from 'three/tsl';
import { getModels } from './models.js';
import { makeClipTable, makeProcTable, animMemory } from './anim.js';
import { CLIP_RATE } from './clips.js';
import { buildComputes, MAX_PROXIES } from './sim.js';
import { ensureLodBuffers, buildCull, updateCullUniforms, maybeReadback, cullMemory } from './cull.js';
import { vertexNode, vat, makeMaterial, makeBlobMaterial, rebuildMeshes } from './materials.js';

export { withPreviousPosition } from './materials.js';

export const STATE = { IDLE: 0, WALK: 1, RUN: 2, WAVE: 3, CHEER: 4, DANCE: 5, TALK: 6, KNOCKED: 7 };

export class Crowd {

	constructor( renderer, scene, options = {} ) {

		this.renderer = renderer;
		this.scene = scene;
		this.models = getModels();
		this.storageInVertex = ( options.limits?.maxStorageBuffersInVertexStage ?? 8 ) > 0;

		this.capacity = 0;
		this.count = options.count ?? 20000;
		this.tier = 0;
		this.path = 'direct';
		this.materialKind = 'unlit';
		this.animSystem = 'procedural';
		this.animBlend = true;
		this.outlines = false;
		this.rim = false;
		this.blobShadows = false;
		this.castShadow = false;
		this.receiveShadow = false;
		this.shadowLight = null; // the sun: GPU-driven shadow casters are culled against its shadow camera
		this.lodEnabled = true;
		this.materialFactory = null; // optional ( kind ) => material, supplied by the app (cel shading)

		// physics coupling (set by the app / physics module)
		this.collide = false; // GPU spatial-hash collisions
		this.rapierAgents = 0; // agents 1..N driven by Rapier bodies (0 = off)
		this.proxies = false; // gather agents near the hero for Rapier proxies

		this.u = {
			time: uniform( 0 ),
			dt: uniform( 0 ),
			frame: uniform( 0, 'uint' ),
			density: uniform( 0.35 ),
			wander: uniform( 14 ),
			activity: uniform( 0.6 ),
			speedScale: uniform( 1 ),
			behaviour: uniform( 0 ),
			count: uniform( 1 ),
			heroPos: uniform( new THREE.Vector2() ),
			heroHeading: uniform( 0 ),
			heroState: uniform( 0 ),
			heroSpeed: uniform( 0 ),
			outline: uniform( 0.03 ),
			outlineColor: uniform( new THREE.Color( 0.02, 0.02, 0.03 ) ),
			rimColor: uniform( new THREE.Color( 0.35, 0.45, 0.6 ) ),
			rimPower: uniform( 3.0 ),
			blendOn: uniform( 1 ),
			blendSpeed: uniform( 4 ), // 1 / crossfade seconds
			rapierCount: uniform( 0, 'uint' ),
			proxyRadius: uniform( 18 ),
			// culling / LOD
			planes: [ 0, 1, 2, 3, 4, 5 ].map( () => uniform( new THREE.Vector4() ) ),
			shadowPlanes: Array.from( { length: 12 }, () => uniform( new THREE.Vector4() ) ), // sun frustum + swept view (cull.js)
			camPos: uniform( new THREE.Vector3() ),
			isOrtho: uniform( 1 ),
			pxScale: uniform( 100 ),
			lodThresholds: uniform( new THREE.Vector3( 150, 60, 22 ) ),
			maxTier: uniform( 0 ),
			lodOn: uniform( 1 )
		};

		this.vColor = varyingProperty( 'vec3', 'vCrowdColor' );
		this.clipTable = makeClipTable();
		this.procTable = makeProcTable();
		this.clipRates = uniformArray( CLIP_RATE, 'float' );
		this.vatTextures = [];

		this.group = new THREE.Group();
		this.group.name = 'Crowd';
		scene.add( this.group );

		this.meshes = [];
		this.visibleByTier = [ 0, 0, 0, 0 ];
		this.castersByTier = [ 0, 0, 0, 0 ];
		this._readbackPending = false;
		this._lastReadback = 0;

		this.setCapacity( options.capacity ?? 262144 );

	}

	// -----------------------------------------------------------------------
	// Buffers & compute kernels
	// -----------------------------------------------------------------------
	setCapacity( capacity ) {

		capacity = Math.ceil( capacity / 64 ) * 64;
		if ( capacity === this.capacity ) return;

		this._disposeMeshes();
		this._freeStorage();
		this.capacity = capacity;
		this.count = Math.min( this.count, capacity );

		this.renderBuf = instancedArray( capacity, 'vec4' ).setName( 'crowdRender' );
		this.simBuf = instancedArray( capacity, 'vec4' ).setName( 'crowdSim' );
		this.animBuf = instancedArray( capacity, 'vec4' ).setName( 'crowdAnim' );
		this.collider = null;
		this.boneBuf = null;
		this.rapierIO = null;
		this.lodBufs = null;
		this.lodGeos = null;
		this.casterBufs = null;
		this._needsInit = true;
		this._buildComputes();
		this._rebuildMeshes();

	}

	// Kernels, culling and materials live in sim.js, cull.js and materials.js;
	// these methods forward to them so existing callers keep working.
	_buildComputes() {

		buildComputes( this );

	}

	_ensureLodBuffers() {

		ensureLodBuffers( this );

	}

	_buildCull() {

		buildCull( this );

	}

	_vertexNode( inst, anim, tier, options ) {

		return vertexNode( this, inst, anim, tier, options );

	}

	_vat( tier ) {

		return vat( this, tier );

	}

	_makeMaterial( inst, anim, tier, options ) {

		return makeMaterial( this, inst, anim, tier, options );

	}

	_makeBlobMaterial() {

		return makeBlobMaterial( this );

	}

	// -----------------------------------------------------------------------
	// Mesh management
	// -----------------------------------------------------------------------
	_rebuildMeshes() {

		rebuildMeshes( this );

	}

	_applyCount() {

		const n = Math.max( 2, this.count );
		for ( const m of this.meshes ) {

			if ( m.userData.kind === 'blob' || this.path === 'direct' ) m.count = n;

		}

	}

	setCount( n ) {

		this.count = Math.max( 1, Math.min( Math.floor( n ), this.capacity ) );
		this._applyCount();

	}

	set( options ) {

		let rebuild = false, recompute = false;
		for ( const key of [ 'tier', 'path', 'materialKind', 'outlines', 'rim', 'blobShadows' ] ) {

			if ( key in options && options[ key ] !== this[ key ] ) {

				this[ key ] = options[ key ];
				rebuild = true;

			}

		}

		if ( 'animSystem' in options ) {

			let sys = options.animSystem;
			if ( sys === 'skeletal' && ! this.storageInVertex ) sys = 'keyframe';
			if ( sys !== this.animSystem ) {

				this.animSystem = sys;
				rebuild = recompute = true;

			}

		}

		for ( const key of [ 'collide', 'rapierAgents', 'proxies' ] ) {

			if ( key in options && options[ key ] !== this[ key ] ) {

				this[ key ] = options[ key ];
				recompute = true;

			}

		}

		for ( const key of [ 'castShadow', 'receiveShadow' ] ) {

			if ( key in options && options[ key ] !== this[ key ] ) {

				this[ key ] = options[ key ];
				// GPU-driven: separate sun-culled meshes do the casting, so (re)build them
				if ( key === 'castShadow' && this.path === 'gpu' ) rebuild = true;
				else for ( const m of this.meshes ) if ( m.userData.kind === 'crowd' ) m[ key ] = this[ key ];

			}

		}

		if ( 'animBlend' in options ) {

			this.animBlend = options.animBlend;
			this.u.blendOn.value = options.animBlend ? 1 : 0;

		}

		if ( 'lodEnabled' in options ) this.lodEnabled = options.lodEnabled;
		if ( recompute ) this._buildComputes();
		if ( rebuild ) this._rebuildMeshes();

	}

	get radius() {

		return Math.sqrt( this.count / ( this.u.density.value * Math.PI ) ) + this.u.wander.value;

	}

	get skeletalLimit() {

		return this.animSystem === 'skeletal' ? ( this.boneCap || 0 ) : Infinity;

	}

	// -----------------------------------------------------------------------
	// Per-frame update
	// -----------------------------------------------------------------------
	update( dt, time, camera, viewportHeight ) {

		const u = this.u;
		u.dt.value = Math.min( dt, 0.1 );
		u.time.value = time;
		u.frame.value = ( u.frame.value + 1 ) >>> 0;
		u.count.value = this.count;
		u.rapierCount.value = this.rapierAgents > 0 ? Math.min( this.rapierAgents + 1, this.count ) : 0;

		const computes = [];
		if ( this._needsInit ) {

			computes.push( this.initCompute );
			this._needsInit = false;

		}

		if ( this.collide && this.collider ) {

			this.collider.insertCompute.count = this.count;
			this.collider.obstacleCompute.count = Math.max( 1, this.collider.numObstacles );
			computes.push( this.collider.clearCompute, this.collider.insertCompute, this.collider.obstacleCompute );

		}

		this.simCompute.count = this.count;
		computes.push( this.simCompute );

		if ( this.skelCompute ) {

			this.skelCompute.count = Math.min( this.count, this.boneCap );
			computes.push( this.skelCompute );

		}

		if ( this.proxyGather ) {

			this.proxyGather.count = this.count;
			computes.push( this.proxyReset, this.proxyGather );

		}

		if ( this.path === 'gpu' ) {

			this._updateCullUniforms( camera, viewportHeight );
			computes.push( this.resetCompute );
			const used = ( list ) => ( this.tier >= 2 ? list : list.slice( 0, 1 ) );
			const passes = used( this.cullPasses );
			// shadow casters: a second cull against the sun, only while the crowd casts
			const casters = this.castShadow && this.casterBufs ? used( this.casterPasses ) : [];
			for ( const pass of [ ...passes, ...casters ] ) {

				pass.count = this.count;
				computes.push( pass );

			}

		}

		this.renderer.compute( computes );
		if ( this.collider ) this.collider.u.blast.value.w = 0; // explosion is a one-frame pulse
		if ( this.path === 'gpu' ) this._maybeReadback();

	}

	_updateCullUniforms( camera, viewportHeight ) {

		updateCullUniforms( this, camera, viewportHeight );

	}

	_maybeReadback() {

		maybeReadback( this );

	}

	// Async GPU -> CPU reads used by the physics module.
	async readProxies() {

		const [ list, cnt ] = await Promise.all( [
			this.renderer.getArrayBufferAsync( this.proxyBuf.value ),
			this.renderer.getArrayBufferAsync( this.proxyCounter.value )
		] );
		return { list: new Float32Array( list ), count: Math.min( new Uint32Array( cnt )[ 0 ], MAX_PROXIES ) };

	}

	// Returns the whole [position, steer] array for agents 0..n-1 (steer at i*8+4).
	async readSteer( n ) {

		const buf = await this.renderer.getArrayBufferAsync( this.rapierIO.value, null, 0, n * 32 );
		return new Float32Array( buf );

	}

	stats() {

		let tris = 0, instances = 0, draws;
		const outlineMul = this.outlines ? 2 : 1;
		if ( this.path === 'direct' ) {

			tris = this.count * this.models[ this.tier ].triangles * outlineMul;
			instances = this.count;
			draws = outlineMul;

		} else {

			for ( let k = 0; k <= this.tier; k ++ ) {

				tris += this.visibleByTier[ k ] * this.models[ k ].triangles * outlineMul;
				instances += this.visibleByTier[ k ];

			}

			draws = ( this.tier + 1 ) * outlineMul;

		}

		if ( this.blobShadows ) {

			tris += this.count * 2;
			draws += 1;

		}

		// Shadow pass: the direct path re-draws the whole crowd, the GPU-driven path
		// draws what its sun-frustum cull kept.
		let shadowTris = 0, shadowDraws = 0, casters = 0;
		if ( this.castShadow && this.path === 'direct' ) {

			shadowTris = this.count * this.models[ this.tier ].triangles;
			shadowDraws = 1;

		} else if ( this.castShadow ) {

			for ( let k = 0; k <= this.tier; k ++ ) {

				shadowTris += this.castersByTier[ k ] * this.models[ k ].triangles;
				casters += this.castersByTier[ k ];

			}

			shadowDraws = this.tier + 1;

		}

		return {
			tris, instances, draws, visibleByTier: this.visibleByTier.slice(), shadowTris, shadowDraws, casters,
			animBytes: animMemory( this.animSystem, Math.min( this.count, this.skeletalLimit ), this.models.slice( 0, this.tier + 1 ) ),
			collideBytes: this.collider ? this.collider.memoryBytes : 0,
			cullBytes: cullMemory( this )
		};

	}

	_disposeMeshes() {

		for ( const m of this.meshes ) {

			this.group.remove( m );
			m.material.dispose();

		}

		this.meshes = [];

	}

	// Release old storage buffers right away instead of waiting for garbage collection.
	_freeStorage() {

		const attrs = this.renderer._attributes;
		if ( ! attrs || ! this.renderBuf ) return;
		const list = [ this.renderBuf, this.simBuf, this.animBuf, this.boneBuf, ...( this.lodBufs || [] ), ...( this.lodAnimBufs || [] ),
			...( this.casterBufs || [] ), ...( this.casterAnimBufs || [] ) ].filter( Boolean ).map( ( n ) => n.value );
		if ( this.drawArgs ) list.push( this.drawArgs );
		for ( const a of list ) {

			try {

				attrs.delete( a );

			} catch { /* not uploaded yet */ }

		}

		if ( this.collider ) this.collider.dispose( this.renderer );
		this.drawArgs = null;
		this.boneBuf = null;
		this.boneCap = 0;

	}

}
