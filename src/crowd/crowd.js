// GPU crowd: simulation in a compute shader, animation in the vertex shader.
//
// Per-agent storage (all on the GPU):
//   renderBuf[i] = ( x, animPhase, z, packed )     packed = state + 8*heading8 + 2048*colourSeed
//   simBuf[i]    = ( targetX, targetZ, stateTimer, headingPrecise )
//   animBuf[i]   = ( prevState, blend, prevPhase, agentIndex )   cross-fade + skeletal lookup
//   (skeletal adds 480 B of bones per agent, capped at 131k agents; 'bat' reads the
//   same bones from one shared baked texture instead, so it has no per-agent cost)
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
//   motion.js     per-agent motion vectors for motion blur / TRAA

import * as THREE from 'three/webgpu';
import { uniform, uniformArray, instancedArray, varyingProperty } from 'three/tsl';
import { getModels } from './models.js';
import { makeClipTable, makeProcTable, animMemory } from './anim.js';
import { CLIP_RATE } from './clips.js';
import { buildComputes } from './sim.js';
import { ensureLodBuffers, buildCull, updateCullUniforms, maybeReadback, cullMemory } from './cull.js';
import { vertexNode, vat, makeMaterial, makeBlobMaterial, rebuildMeshes } from './materials.js';
import { crowdCapacityLimit } from './limits.js';

export { withPreviousPosition } from './materials.js';

export const STATE = { IDLE: 0, WALK: 1, RUN: 2, WAVE: 3, CHEER: 4, DANCE: 5, TALK: 6, KNOCKED: 7 };

export class Crowd {

	constructor( renderer, scene, options = {} ) {

		this.renderer = renderer;
		this.scene = scene;
		this.limits = options.limits || renderer.backend?.device?.limits || {};
		this.storageGeneration = 0;
		// Optional domain profile is installed before allocation/kernel construction.
		// The default stress test retains its existing simulation and model indices.
		this.profile = options.profile || null;
		this.models = this.profile?.models || getModels();
		this.storageInVertex = ( options.limits?.maxStorageBuffersInVertexStage ?? 8 ) > 0;

		this.capacity = 0;
		this.count = options.count ?? 20000;
		if ( ! Number.isFinite( this.count ) ) throw new RangeError( 'Crowd count must be finite.' );
		this.count = Math.max( 1, Math.floor( this.count ) );
		this.tier = this.profile?.tier ?? 0;
		this.path = this.profile?.path ?? 'direct';
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
		this.motionVectors = 'root'; // 'camera' | 'root' | 'full' - velocity buffer source (motion.js)
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
			initOffset: uniform( 0, 'uint' ),
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
		this.boneTexture = null; // 'bat' system: baked bone matrices, built on first use

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

		if ( ! Number.isFinite( capacity ) || capacity < 1 ) throw new RangeError( 'Crowd capacity must be a positive finite number.' );
		capacity = Math.min( Math.ceil( capacity / 64 ) * 64, crowdCapacityLimit( this.limits, { collide: this.collide } ) );
		if ( capacity < 64 ) throw new RangeError( 'GPU limits cannot support the crowd buffers and 64-thread compute kernels.' );
		if ( capacity === this.capacity ) return;

		this._disposeMeshes();
		this._freeStorage();
		this.capacity = capacity;
		this.count = Math.min( this.count, capacity );
		this.storageGeneration ++;

		this.renderBuf = instancedArray( capacity, 'vec4' ).setName( 'crowdRender' );
		this.simBuf = instancedArray( capacity, 'vec4' ).setName( 'crowdSim' );
		this.animBuf = instancedArray( capacity, 'vec4' ).setName( 'crowdAnim' );
		this.collider = null;
		this.boneBuf = null;
		this.rapierIO = null;
		this.lodBufs = null;
		this.lodGeos = null;
		this.casterBufs = null;
		this._initializedCount = 0;
		this._needsInit = true;
		this.profile?.allocate?.( this );
		this._buildComputes();
		this._rebuildMeshes();

	}

	// Kernels, culling and materials live in sim.js, cull.js and materials.js;
	// these methods forward to them so existing callers keep working.
	_buildComputes() {

		if ( this.profile?.buildComputes ) this.profile.buildComputes( this );
		else buildComputes( this );

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

		if ( ! Number.isFinite( n ) ) throw new RangeError( 'Crowd count must be finite.' );
		const count = Math.max( 1, Math.min( Math.floor( n ), this.capacity ) );
		if ( this.citySurface && count !== this.count ) this._needsInit = true;
		this.count = count;
		this._applyCount();

	}

	setCitySurface( texture, origin ) {

		const old = this.citySurface;
		this.citySurface = texture;
		this.cityOrigin = texture ? uniform( new THREE.Vector2( origin.x, origin.z ) ) : null;
		this._buildComputes();
		this._needsInit = true;
		if ( old !== texture ) old?.dispose();

	}

	set( options ) {

		let rebuild = false, recompute = false;
		for ( const key of [ 'tier', 'path', 'materialKind', 'outlines', 'rim', 'blobShadows', 'motionVectors' ] ) {

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
		if ( this.capacity > crowdCapacityLimit( this.limits, { collide: this.collide } ) ) {

			this.setCapacity( this.capacity );
			recompute = rebuild = false; // allocation already rebuilt kernels and meshes

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
		// Leaving skeletal: nothing references the per-agent bones any more (the new
		// meshes and kernels are built), so give the up-to-63 MB back to the GPU now.
		if ( this.boneBuf && this.animSystem !== 'skeletal' ) this._freeBones();

	}

	_freeBones() {

		try {

			this.renderer._attributes?.delete( this.boneBuf.value );

		} catch { /* never uploaded */ }

		this.boneBuf = null;
		this.boneCap = 0;

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

		if ( this.disposed ) return;
		if ( this.profile?.update ) return this.profile.update( this, dt, time, camera, viewportHeight );

		const u = this.u;
		u.dt.value = Math.min( dt, 0.1 );
		u.time.value = time;
		u.frame.value = ( u.frame.value + 1 ) >>> 0;
		u.count.value = this.count;
		u.rapierCount.value = this.rapierAgents > 0 ? Math.min( this.rapierAgents + 1, this.count ) : 0;

		if ( this.path === 'gpu' ) this._updateCullUniforms( camera, viewportHeight );
		this.renderer.compute( this._activeComputes() );
		this._completeInitialization();
		if ( this.collider ) this.collider.u.blast.value.w = 0; // explosion is a one-frame pulse
		if ( this.path === 'gpu' ) this._maybeReadback();

	}

	// Compile exactly the kernels the frame loop will dispatch, without running
	// simulation or consuming its pending initialization.
	prepare() {

		return this.renderer.compileComputeAsync( this._activeComputes() );

	}

	// Readbacks for Rapier may precede the first rendered frame. Seed their active
	// positions without advancing simulation or requiring a camera/cull dispatch.
	initialize() {

		this.u.count.value = this.count;
		if ( ! this._prepareInitialization() ) return;
		this.renderer.compute( this.initCompute );
		this._completeInitialization();

	}

	_prepareInitialization() {

		this._initializationEnd = undefined;
		const end = Math.max( 2, this.count );
		const start = this._needsInit ? 0 : Math.min( this._initializedCount, end );
		if ( start === end ) return false;
		this.u.initOffset.value = start;
		this.initCompute.count = end - start;
		this._initializationEnd = end;
		return true;

	}

	_completeInitialization() {

		if ( this._initializationEnd === undefined ) return;
		this._initializedCount = this._needsInit ? this._initializationEnd : Math.max( this._initializedCount, this._initializationEnd );
		this._initializationEnd = undefined;
		this._needsInit = false;

	}

	_activeComputes() {

		const computes = [];
		if ( this._prepareInitialization() ) computes.push( this.initCompute );

		if ( this.collide && this.collider ) {

			this.collider.updateSearchRadius();
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

		return computes;

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
		return { list: new Float32Array( list ), count: Math.min( new Uint32Array( cnt )[ 0 ], this.proxyCapacity ) };

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

		this._disposeComputes();
		const attrs = this.renderer._attributes;
		this.profile?.free?.( this );
		const list = [ this.renderBuf, this.simBuf, this.animBuf, this.boneBuf, this.rapierIO, this.proxyBuf, this.proxyCounter, ...( this.lodBufs || [] ), ...( this.lodAnimBufs || [] ),
			...( this.casterBufs || [] ), ...( this.casterAnimBufs || [] ) ].filter( Boolean ).map( ( n ) => n.value );
		if ( this.drawArgs ) list.push( this.drawArgs );
		for ( const a of list ) {

			try {

				attrs?.delete( a );

			} catch { /* not uploaded yet */ }

		}

		if ( this.collider ) this.collider.dispose( this.renderer );
		// These indirect wrappers are owned here; source model geometry remains
		// reusable. Its shared vertex attributes can be uploaded again if needed.
		for ( const geometry of new Set( [ ...( this.lodGeos || [] ), ...( this.casterGeos || [] ) ] ) ) geometry.dispose();
		this.drawArgs = null;
		this.boneBuf = null;
		this.boneCap = 0;
		this.rapierIO = this.proxyBuf = this.proxyCounter = null;
		this.collider = null;
		this.lodBufs = this.lodAnimBufs = this.casterBufs = this.casterAnimBufs = null;
		this.lodGeos = this.casterGeos = null;
		this.visibleByTier.fill( 0 ); this.castersByTier.fill( 0 );

	}

	_disposeComputes() {

		for ( const key of [ 'initCompute', 'simCompute', 'skelCompute', 'proxyReset', 'proxyGather', 'resetCompute' ] ) {

			this[ key ]?.dispose(); this[ key ] = null;

		}
		for ( const key of [ 'cullPasses', 'casterPasses' ] ) {

			for ( const compute of this[ key ] || [] ) compute.dispose();
			this[ key ] = null;

		}

	}

	dispose() {

		if ( this.disposed ) return;
		this.disposed = true;
		this._disposeMeshes();
		this._freeStorage();
		this.scene.remove( this.group );
		this.citySurface?.dispose();
		for ( const texture of this.vatTextures ) texture?.dispose();
		this.boneTexture?.dispose();
		this.blobGeo?.dispose();

	}

}
