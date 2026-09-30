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
//   GPU-DRIVEN - compute frustum-cull + LOD selection + drawIndexedIndirect per LOD.

import * as THREE from 'three/webgpu';
import {
	Fn, If, float, int, uint, vec2, vec3, vec4, uniform, uniformArray, instancedArray, storage,
	attribute, instanceIndex, hash, sin, cos, abs, max, min, floor, fract, select, mix, clamp,
	length, atan, sqrt, step, varyingProperty, atomicAdd, atomicStore, mx_hsvtorgb, normalView,
	positionViewDirection, dot, pow, uv, smoothstep, positionPrevious, positionLocal
} from 'three/tsl';
import { getModels, buildBlobGeometry } from './models.js';
import {
	makeClipTable, makeProcTable, sampleBlended, channels, poseVertexDynamic, proceduralVertex,
	emitBoneMatrices, skinVertex, bakeVAT, sampleVAT, rotY, BONES, BONE_ROWS, animMemory
} from './anim.js';
import { CLIP_RATE } from './clips.js';
import { CrowdCollider } from './collide.js';

const TAU = Math.PI * 2;
const SKELETAL_MAX = 131072; // bone buffer cap: 131k agents x 480 B = 63 MB
const MAX_PROXIES = 4096;

export const STATE = { IDLE: 0, WALK: 1, RUN: 2, WAVE: 3, CHEER: 4, DANCE: 5, TALK: 6, KNOCKED: 7 };

// three.js derives the "previous frame" vertex position (velocity buffer for motion
// blur / TRAA) from the raw geometry, which ignores positionNode. Our agents are
// placed entirely by positionNode, so make "previous" equal the current animated
// position: camera motion is still captured, agent motion is not.
export function withPreviousPosition( material ) {

	const setupPosition = material.setupPosition.bind( material );
	material.setupPosition = ( builder ) => {

		const result = setupPosition( builder );
		if ( builder.needsPreviousData() ) positionPrevious.assign( positionLocal );
		return result;

	};

	return material;

}

// Integer hashing: the multiply must wrap in u32 (float math would saturate for
// large agent indices and give thousands of agents identical "random" numbers).
const hashF = ( seed, salt ) => hash( uint( seed ).mul( 7919 ).add( uint( salt ) ) );

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
		this._needsInit = true;
		this._buildComputes();
		this._rebuildMeshes();

	}

	_homeOf( fi ) {

		// Vogel / sunflower spiral: agent i lives at radius sqrt(i / (pi * density)).
		const r = sqrt( fi.div( this.u.density.mul( Math.PI ) ) );
		const a = fi.mul( 2.39996323 );
		return vec2( cos( a ), sin( a ) ).mul( r );

	}

	_crowdRadius() {

		return sqrt( this.u.count.div( this.u.density.mul( Math.PI ) ) );

	}

	_ensurePhysicsBuffers() {

		if ( this.collide && ! this.collider ) {

			this.collider = new CrowdCollider( this.capacity );
			this.collider.buildComputes( this.renderBuf );

		}

		if ( this.rapierAgents > 0 && ( ! this.rapierIO || this.rapierIO.value.count < ( this.rapierAgents + 1 ) * 2 ) ) {

			// 2 x vec4 per agent: [ position from Rapier (CPU writes), desired velocity (GPU writes) ]
			this.rapierIO = instancedArray( ( this.rapierAgents + 1 ) * 2, 'vec4' ).setName( 'rapierIO' );

		}

		if ( this.proxies && ! this.proxyBuf ) {

			this.proxyBuf = instancedArray( MAX_PROXIES, 'vec4' ).setName( 'proxyList' );
			this.proxyCounter = instancedArray( 1, 'uint' ).setName( 'proxyCounter' );

		}

	}

	_buildComputes() {

		const u = this.u;
		const renderBuf = this.renderBuf;
		const simBuf = this.simBuf;
		const animBuf = this.animBuf;
		this._ensurePhysicsBuffers();
		const collider = this.collide ? this.collider : null;
		const rapier = this.rapierAgents > 0;

		// --- init ---------------------------------------------------------------
		this.initCompute = Fn( () => {

			const i = instanceIndex;
			const fi = float( i );
			const home = this._homeOf( fi );
			const ang = hashF( fi, 1 ).mul( TAU );
			const rad = sqrt( hashF( fi, 2 ) ).mul( u.wander );
			const pos = home.add( vec2( cos( ang ), sin( ang ) ).mul( rad ) ).toVar();
			const state = floor( hashF( fi, 3 ).mul( 7 ) ).toVar();
			const heading = hashF( fi, 4 ).mul( TAU );
			const seed = float( i.mod( 4095 ).add( 1 ) ).toVar();
			If( i.equal( 0 ), () => {

				seed.assign( 0 );
				state.assign( 0 );

			} );
			const hq = floor( heading.div( TAU ).mul( 256 ) ).mod( 256 );
			const packed = state.add( hq.mul( 8 ) ).add( seed.mul( 2048 ) );
			const phase = hashF( fi, 5 ).mul( TAU );
			renderBuf.element( i ).assign( vec4( pos.x, phase, pos.y, packed ) );
			simBuf.element( i ).assign( vec4( pos.x, pos.y, hashF( fi, 6 ).mul( 5 ), heading ) );
			animBuf.element( i ).assign( vec4( state, 1, phase, fi ) );

		} )().compute( this.capacity ).setName( 'Crowd Init' );

		// --- per-frame simulation -------------------------------------------------
		this.simCompute = Fn( () => {

			const i = instanceIndex;
			const fi = float( i );
			const rd = renderBuf.element( i ).toVar();
			const sd = simBuf.element( i ).toVar();
			const ad = animBuf.element( i ).toVar();

			const pos = vec2( rd.x, rd.z ).toVar();
			const phase = rd.y.toVar();
			const seed = floor( rd.w.mul( 1 / 2048 ) ).toVar();
			const rem = rd.w.sub( seed.mul( 2048 ) );
			const stateIn = rem.sub( floor( rem.mul( 0.125 ) ).mul( 8 ) ).toVar();
			const state = stateIn.toVar();
			const target = vec2( sd.x, sd.y ).toVar();
			const timer = sd.z.sub( u.dt ).toVar();
			const heading = sd.w.toVar();
			const speedMul = hashF( fi, 7 ).mul( 0.45 ).add( 0.8 ).mul( u.speedScale );
			const speed = float( 0 ).toVar();
			const move = vec2( 0 ).toVar();
			const beh = u.behaviour;
			const knocked = float( 0 ).toVar();

			const rnd = ( salt ) => hash( i.add( u.frame.mul( 2654435761 ) ).add( uint( salt * 97 ) ) );

			// physics state (knockback) -------------------------------------------
			const knockVel = vec2( 0 ).toVar();
			const knockT = float( 0 ).toVar();
			if ( collider ) {

				const ph = collider.phys.element( i );
				knockVel.assign( ph.xy );
				knockT.assign( ph.z.sub( u.dt ) );
				knocked.assign( step( 0.0001, knockT ) );

			}

			const isRapier = rapier ? i.greaterThanEqual( 1 ).and( i.lessThan( u.rapierCount ) ) : null;
			if ( rapier ) {

				If( isRapier, () => {

					const pp = this.rapierIO.element( i.mul( 2 ) );
					pos.assign( pp.xy );
					knocked.assign( step( 0.5, pp.z ) );

				} );

			}

			If( knocked.lessThan( 0.5 ), () => {

				// Behaviour overrides -------------------------------------------------
				If( beh.equal( 1 ), () => {

					const packR = sqrt( u.count.div( Math.PI * 2.2 ) );
					const a = fi.mul( 2.39996323 );
					const slot = vec2( cos( a ), sin( a ) ).mul( sqrt( fi.div( u.count ) ).mul( packR ).add( 1.5 ) );
					target.assign( u.heroPos.add( slot ) );
					const d = length( target.sub( pos ) );
					state.assign( select( d.greaterThan( 25 ), float( 2 ), select( d.greaterThan( 0.6 ), float( 1 ), float( 4 ) ) ) );
					timer.assign( 1 );

				} ).ElseIf( beh.equal( 2 ), () => {

					const away = pos.sub( u.heroPos );
					const d = length( away );
					If( d.lessThan( 30 ), () => {

						target.assign( pos.add( away.div( max( d, 0.01 ) ).mul( 12 ) ) );
						state.assign( 2 );
						timer.assign( 1.5 );

					} );

				} ).ElseIf( beh.equal( 3 ), () => {

					state.assign( 5 );
					timer.assign( 1 );

				} ).ElseIf( beh.equal( 4 ), () => {

					const ang = atan( pos.y, pos.x );
					const sweep = fract( u.time.mul( 0.08 ) ).mul( TAU ).sub( Math.PI );
					let dA = ang.sub( sweep );
					dA = dA.sub( floor( dA.add( Math.PI ).div( TAU ) ).mul( TAU ) );
					const arc = abs( dA ).mul( max( length( pos ), 5 ) );
					state.assign( select( arc.lessThan( 6 ), float( 4 ), float( 0 ) ) );
					timer.assign( 1 );

				} );

				// Recovering from a knockdown: pick something new.
				If( state.equal( 7 ), () => {

					state.assign( 0 );
					timer.assign( 0 );

				} );

				// Pick a new activity when the timer runs out --------------------------
				If( timer.lessThanEqual( 0 ).and( beh.equal( 0 ).or( beh.equal( 2 ) ) ), () => {

					const r1 = rnd( 1 ), r2 = rnd( 2 ), r3 = rnd( 3 );
					If( r1.lessThan( u.activity.mul( 0.85 ) ), () => {

						state.assign( select( r2.lessThan( 0.12 ), float( 2 ), float( 1 ) ) );
						const home = this._homeOf( fi );
						const a = rnd( 4 ).mul( TAU );
						const longTrip = r3.lessThan( 0.08 );
						const radius = select( longTrip, this._crowdRadius().mul( 0.9 ), u.wander );
						const centre = select( longTrip, vec2( 0 ), home );
						target.assign( centre.add( vec2( cos( a ), sin( a ) ).mul( sqrt( rnd( 5 ) ).mul( radius ) ) ) );
						timer.assign( 600 );

					} ).Else( () => {

						state.assign( select( r2.lessThan( 0.35 ), float( 0 ),
							select( r2.lessThan( 0.5 ), float( 6 ),
								select( r2.lessThan( 0.65 ), float( 3 ),
									select( r2.lessThan( 0.8 ), float( 4 ), float( 5 ) ) ) ) ) );
						timer.assign( r3.mul( 5 ).add( 2 ) );

					} );

				} );

				// Locomotion (desired movement) -----------------------------------------
				const moving = state.equal( 1 ).or( state.equal( 2 ) );
				If( moving.and( beh.notEqual( 5 ) ), () => {

					speed.assign( select( state.equal( 2 ), float( 3.6 ), float( 1.35 ) ).mul( speedMul ) );
					const toT = target.sub( pos );
					const dist = length( toT );
					const desired = atan( toT.x, toT.y );
					let dh = desired.sub( heading );
					dh = dh.sub( floor( dh.add( Math.PI ).div( TAU ) ).mul( TAU ) );
					const maxTurn = u.dt.mul( 5 );
					heading.addAssign( clamp( dh, maxTurn.negate(), maxTurn ) );
					move.assign( vec2( sin( heading ), cos( heading ) ).mul( min( speed.mul( u.dt ), dist ) ) );
					If( dist.lessThan( 0.6 ).and( beh.equal( 0 ).or( beh.equal( 2 ) ) ), () => {

						timer.assign( 0 );

					} );

				} );

			} ).Else( () => {

				state.assign( 7 );
				timer.assign( 0.3 );

			} );

			// Apply movement: Rapier-driven agents hand their desired velocity to the CPU.
			if ( rapier ) {

				If( isRapier, () => {

					this.rapierIO.element( i.mul( 2 ).add( 1 ) ).assign( vec4( move.div( max( u.dt, 1e-4 ) ), heading, 1 ) );

				} ).Else( () => {

					pos.addAssign( move );

				} );

			} else {

				pos.addAssign( move );

			}

			// GPU collisions + knockback -------------------------------------------
			if ( collider ) {

				// Rapier-driven agents get their collisions from Rapier instead.
				const gpuAgent = rapier ? i.notEqual( 0 ).and( isRapier.not() ) : i.notEqual( 0 );
				If( gpuAgent, () => {

					const res = collider.emitResolve( i, pos );
					pos.addAssign( res.push.mul( collider.u.stiffness ) );
					If( res.hit.greaterThan( 0.5 ).and( collider.u.knockOn.greaterThan( 0.5 ) ), () => {

						knockVel.addAssign( res.knock );
						knockT.assign( 1.3 );
						state.assign( 7 );

					} );

				} );
				pos.addAssign( knockVel.mul( u.dt ) );
				knockVel.mulAssign( max( float( 1 ).sub( u.dt.mul( 3 ) ), 0 ) );
				collider.phys.element( i ).assign( vec4( knockVel, max( knockT, 0 ), 0 ) );

			}

			// Hero (agent 0) is driven by the player ------------------------------
			If( i.equal( 0 ), () => {

				pos.assign( u.heroPos );
				heading.assign( u.heroHeading );
				state.assign( u.heroState );
				speed.assign( u.heroSpeed );
				timer.assign( 1 );

			} );

			// Animation phase + cross-fade bookkeeping ----------------------------
			const changed = state.notEqual( stateIn );
			const prevState = select( changed, stateIn, ad.x ).toVar();
			const prevPhase = select( changed, phase, ad.z ).toVar();
			const blend = select( changed, float( 0 ), ad.y ).toVar();
			blend.assign( select( u.blendOn.greaterThan( 0.5 ), min( blend.add( u.dt.mul( u.blendSpeed ) ), 1 ), float( 1 ) ) );
			prevPhase.assign( fract( prevPhase.add( u.dt.mul( this.clipRates.element( int( prevState ) ) ) ).div( TAU ) ).mul( TAU ) );

			const rate = select( state.equal( 1 ), speed.mul( 4.8 ),
				select( state.equal( 2 ), speed.mul( 3.2 ), this.clipRates.element( int( state ) ).mul( speedMul.mul( 0.3 ).add( 0.7 ) ) ) );
			const frozen = beh.equal( 5 );
			phase.assign( select( frozen, phase, fract( phase.add( u.dt.mul( rate ) ).div( TAU ) ).mul( TAU ) ) );

			const hq = floor( fract( heading.div( TAU ) ).mul( 256 ) ).mod( 256 );
			const packed = state.add( hq.mul( 8 ) ).add( seed.mul( 2048 ) );
			renderBuf.element( i ).assign( vec4( pos.x, phase, pos.y, packed ) );
			simBuf.element( i ).assign( vec4( target, timer, heading ) );
			animBuf.element( i ).assign( vec4( prevState, blend, prevPhase, fi ) );

		} )().compute( this.capacity ).setName( 'Crowd Simulate' );

		// --- skeletal: per-agent forward kinematics -> bone matrices --------------
		this.skelCompute = null;
		if ( this.animSystem === 'skeletal' ) {

			const cap = Math.min( this.capacity, SKELETAL_MAX );
			if ( ! this.boneBuf || this.boneCap !== cap ) {

				this.boneBuf = instancedArray( cap * BONES * BONE_ROWS, 'vec4' ).setName( 'boneMatrices' );
				this.boneCap = cap;

			}

			const boneBuf = this.boneBuf;
			this.skelCompute = Fn( () => {

				const i = instanceIndex;
				const rd = renderBuf.element( i );
				const ad = animBuf.element( i );
				const seed = floor( rd.w.mul( 1 / 2048 ) );
				const rem = rd.w.sub( seed.mul( 2048 ) );
				const state = rem.sub( floor( rem.mul( 0.125 ) ).mul( 8 ) );
				const P = sampleBlended( this.clipTable, state, rd.y, ad.x, ad.z, ad.y );
				emitBoneMatrices( boneBuf, int( i ).mul( BONES * BONE_ROWS ), channels( P ) );

			} )().compute( cap ).setName( 'Skeleton FK' );

		}

		// --- proxies: agents near the hero, read back for Rapier ---------------
		this.proxyReset = this.proxyGather = null;
		if ( this.proxies ) {

			const counter = storage( this.proxyCounter.value, 'uint', 1 ).toAtomic();
			const proxyBuf = this.proxyBuf;
			this.proxyReset = Fn( () => {

				atomicStore( counter.element( 0 ), uint( 0 ) );

			} )().compute( 1 ).setName( 'Proxy Reset' );
			this.proxyGather = Fn( () => {

				const i = instanceIndex;
				const rd = renderBuf.element( i );
				const d = length( vec2( rd.x, rd.z ).sub( u.heroPos ) );
				If( i.notEqual( 0 ).and( d.lessThan( u.proxyRadius ) ), () => {

					const slot = atomicAdd( counter.element( 0 ), uint( 1 ) ).toVar();
					If( slot.lessThan( uint( MAX_PROXIES ) ), () => {

						proxyBuf.element( slot ).assign( vec4( rd.x, rd.z, float( i ), 0 ) );

					} );

				} );

			} )().compute( this.capacity ).setName( 'Proxy Gather' );

		}

		if ( this.lodBufs ) this._buildCull();

	}

	_ensureLodBuffers() {

		if ( this.lodBufs ) return;

		const cap = this.capacity;
		this.lodBufs = [ 0, 1, 2, 3 ].map( ( k ) => instancedArray( cap, 'vec4' ).setName( 'crowdLod' + k ) );
		this.lodAnimBufs = [ 0, 1, 2, 3 ].map( ( k ) => instancedArray( cap, 'vec4' ).setName( 'crowdLodAnim' + k ) );

		const args = new Uint32Array( 20 );
		this.models.forEach( ( m, k ) => {

			args[ k * 5 ] = m.geometry.index.count;

		} );
		this.drawArgs = new THREE.IndirectStorageBufferAttribute( args, 1 );

		// One geometry per LOD tier sharing the model's vertex buffers but with its own
		// indirect-args offset. Never disposed: disposing a geometry in three.js also
		// destroys the storage buffers its materials read.
		this.lodGeos = this.models.map( ( m, k ) => {

			const src = m.geometry;
			const g = new THREE.BufferGeometry();
			for ( const name of Object.keys( src.attributes ) ) g.setAttribute( name, src.getAttribute( name ) );
			g.setIndex( src.index );
			g.setIndirect( this.drawArgs, k * 5 * 4 );
			g.boundingSphere = src.boundingSphere;
			g.name = src.name;
			return g;

		} );

		this._buildCull();

	}

	_buildCull() {

		const draw = storage( this.drawArgs, 'uint', 20 ).toAtomic();
		this.resetCompute = Fn( () => {

			atomicStore( draw.element( instanceIndex.mul( 5 ).add( 1 ) ), uint( 0 ) );

		} )().compute( 4 ).setName( 'Crowd Reset Args' );

		const u = this.u;
		const renderBuf = this.renderBuf, animBuf = this.animBuf;
		const lodBufs = this.lodBufs, lodAnim = this.lodAnimBufs;

		// The cull is split into passes that each own two LOD tiers, so no pass binds
		// more than 7 storage buffers (8 is the default limit per shader stage and the
		// real limit on many phones). Each pass re-tests visibility (cheap) and only
		// appends agents whose tier it owns.
		const makePass = ( tiers ) => Fn( () => {

			const i = instanceIndex;
			const rd = renderBuf.element( i ).toVar();
			const c = vec3( rd.x, 0.9, rd.z );
			const visible = float( 1 ).toVar();
			for ( const p of u.planes ) visible.mulAssign( step( - 1.3, dot( p.xyz, c ).add( p.w ) ) );

			If( visible.greaterThan( 0.5 ), () => {

				const dist = length( c.sub( u.camPos ) );
				const px = select( u.isOrtho.greaterThan( 0.5 ), u.pxScale, u.pxScale.div( max( dist, 0.5 ) ) ).mul( 1.8 );
				const t = u.lodThresholds;
				const lodTier = select( px.greaterThan( t.x ), float( 3 ), select( px.greaterThan( t.y ), float( 2 ), select( px.greaterThan( t.z ), float( 1 ), float( 0 ) ) ) );
				const tier = int( select( u.lodOn.greaterThan( 0.5 ), min( lodTier, u.maxTier ), u.maxTier ) ).toVar();
				for ( const k of tiers ) {

					If( tier.equal( k ), () => {

						const slot = atomicAdd( draw.element( k * 5 + 1 ), uint( 1 ) ).toVar();
						lodBufs[ k ].element( slot ).assign( rd );
						lodAnim[ k ].element( slot ).assign( animBuf.element( i ) );

					} );

				}

			} );

		} )().compute( this.capacity ).setName( `Crowd Cull + LOD ${tiers.join( '/' )}` );

		this.cullPasses = [ makePass( [ 0, 1 ] ), makePass( [ 2, 3 ] ) ];

	}

	// -----------------------------------------------------------------------
	// Vertex shader: decode instance, animate, place in world.
	// -----------------------------------------------------------------------
	_vertexNode( inst, anim, tier, { hull = false } = {} ) {

		const u = this.u;
		const vColor = this.vColor;
		const system = this.animSystem;

		return Fn( () => {

			const packed = inst.w;
			const seed = floor( packed.mul( 1 / 2048 ) ).toVar();
			const rem = packed.sub( seed.mul( 2048 ) );
			const hq = floor( rem.mul( 0.125 ) );
			const state = rem.sub( hq.mul( 8 ) );
			const heading = hq.mul( TAU / 256 );
			const p = inst.y;

			const jointA = attribute( 'jointA', 'vec4' );
			const jointB = attribute( 'jointB', 'vec4' );
			const hullOffset = hull ? attribute( 'hullDir', 'vec3' ).mul( u.outline ) : null;
			let v = attribute( 'position', 'vec3' );
			if ( hullOffset && system !== 'vat' ) v = v.add( hullOffset );

			if ( system === 'procedural' ) {

				v = proceduralVertex( v, jointA, jointB, this.procTable, state, p, u.time, seed );

			} else if ( system === 'keyframe' ) {

				const P = sampleBlended( this.clipTable, state, p, anim.x, anim.z, anim.y );
				v = poseVertexDynamic( v, jointA, jointB, channels( P ) );

			} else if ( system === 'skeletal' ) {

				const skinned = skinVertex( this.boneBuf, anim.w, v, true );
				v = select( anim.w.lessThan( this.boneCap ), skinned, v );

			} else if ( system === 'vat' ) {

				const tex = this._vat( tier );
				const cur = sampleVAT( tex, state, p );
				const prev = sampleVAT( tex, anim.x, anim.z );
				v = mix( prev, cur, anim.y );
				if ( hullOffset ) v = v.add( hullOffset );

			}

			const scale = select( seed.equal( 0 ), float( 1.12 ), hashF( seed, 11 ).mul( 0.22 ).add( 0.88 ) );
			const world = rotY( v.mul( scale ), heading ).add( vec3( inst.x, 0, inst.z ) );

			if ( ! hull ) {

				// Colours authored in sRGB and converted to linear (≈ gamma 2.2).
				const slot = attribute( 'slot', 'float' );
				const skin = mix( vec3( 0.97, 0.82, 0.7 ), vec3( 0.38, 0.24, 0.16 ), hashF( seed, 12 ) );
				const shirt = mx_hsvtorgb( vec3( hashF( seed, 13 ), hashF( seed, 14 ).mul( 0.4 ).add( 0.2 ), hashF( seed, 15 ).mul( 0.5 ).add( 0.4 ) ) );
				const pants = mix( vec3( 0.16, 0.2, 0.34 ), vec3( 0.52, 0.47, 0.38 ), hashF( seed, 16 ) ).mul( hashF( seed, 17 ).mul( 0.6 ).add( 0.55 ) );
				const hair = mix( vec3( 0.12, 0.09, 0.07 ), vec3( 0.72, 0.56, 0.32 ), pow( hashF( seed, 18 ), 3 ) );
				const hero = seed.equal( 0 );
				const shirtF = select( hero, vec3( 0.95, 0.2, 0.12 ), shirt );
				const pantsF = select( hero, vec3( 0.12, 0.2, 0.55 ), pants );
				const srgb = select( slot.lessThan( 0.5 ), skin,
					select( slot.lessThan( 1.5 ), shirtF,
						select( slot.lessThan( 2.5 ), pantsF,
							select( slot.lessThan( 3.5 ), vec3( 0.16, 0.14, 0.13 ), hair ) ) ) );
				vColor.assign( pow( srgb, vec3( 2.2 ) ) );

			}

			return world;

		} )();

	}

	_vat( tier ) {

		if ( ! this.vatTextures[ tier ] ) this.vatTextures[ tier ] = bakeVAT( this.models[ tier ].geometry );
		return this.vatTextures[ tier ];

	}

	_makeMaterial( inst, anim, tier, { hull = false } = {} ) {

		if ( hull ) {

			const mat = new THREE.MeshBasicNodeMaterial( { side: THREE.BackSide } );
			mat.colorNode = vec4( this.u.outlineColor, 1 );
			mat.positionNode = this._vertexNode( inst, anim, tier, { hull: true } );
			mat.fog = true;
			mat.name = 'CrowdOutline';
			return withPreviousPosition( mat );

		}

		const kind = this.materialKind;
		let mat = this.materialFactory ? this.materialFactory( kind ) : null;
		if ( ! mat ) {

			switch ( kind ) {

				case 'lambert': mat = new THREE.MeshLambertNodeMaterial(); break;
				case 'phong': mat = new THREE.MeshPhongNodeMaterial( { shininess: 40, specular: 0x333333 } ); break;
				case 'standard': mat = new THREE.MeshStandardNodeMaterial( { roughness: 0.65, metalness: 0.0 } ); break;
				case 'physical': mat = new THREE.MeshPhysicalNodeMaterial( { roughness: 0.45, metalness: 0.0, clearcoat: 0.6, clearcoatRoughness: 0.25, sheen: 0.5, sheenRoughness: 0.6, sheenColor: 0xffffff } ); break;
				case 'toon': mat = new THREE.MeshToonNodeMaterial(); break;
				default: mat = new THREE.MeshBasicNodeMaterial();

			}

		}

		const vColor = this.vColor;
		mat.positionNode = this._vertexNode( inst, anim, tier );
		const baseColor = mat.userData.crowdColor ? mat.userData.crowdColor( vColor ) : vColor;

		if ( this.rim ) {

			const fres = pow( float( 1 ).sub( clamp( dot( normalView, positionViewDirection ), 0, 1 ) ), this.u.rimPower );
			const rimCol = this.u.rimColor.mul( fres );
			if ( mat.isMeshBasicNodeMaterial ) mat.colorNode = vec4( baseColor.add( rimCol ), 1 );
			else {

				mat.colorNode = vec4( baseColor, 1 );
				mat.emissiveNode = rimCol;

			}

		} else {

			mat.colorNode = vec4( baseColor, 1 );

		}

		mat.name = 'Crowd_' + kind + '_' + this.animSystem;
		return withPreviousPosition( mat );

	}

	_makeBlobMaterial() {

		const inst = this.renderBuf.toAttribute();
		const mat = new THREE.MeshBasicNodeMaterial( { transparent: true, depthWrite: false } );
		mat.positionNode = Fn( () => {

			const seed = floor( inst.w.mul( 1 / 2048 ) );
			const scale = select( seed.equal( 0 ), float( 1.12 ), hashF( seed, 11 ).mul( 0.22 ).add( 0.88 ) );
			return attribute( 'position', 'vec3' ).mul( scale.mul( 0.95 ) ).add( vec3( inst.x, 0.03, inst.z ) );

		} )();
		const d = uv().sub( 0.5 ).length().mul( 2 );
		mat.colorNode = vec3( 0, 0, 0 );
		mat.opacityNode = float( 1 ).sub( smoothstep( 0.35, 1.0, d ) ).mul( 0.55 );
		mat.name = 'BlobShadow';
		return withPreviousPosition( mat );

	}

	// -----------------------------------------------------------------------
	// Mesh management
	// -----------------------------------------------------------------------
	_rebuildMeshes() {

		this._disposeMeshes();
		const addMesh = ( geometry, material, extra = {} ) => {

			const mesh = new THREE.Mesh( geometry, material );
			mesh.frustumCulled = false;
			mesh.matrixAutoUpdate = false;
			Object.assign( mesh.userData, extra );
			this.group.add( mesh );
			this.meshes.push( mesh );
			return mesh;

		};

		if ( this.path === 'direct' ) {

			const model = this.models[ this.tier ];
			const inst = this.renderBuf.toAttribute();
			const anim = this.animBuf.toAttribute();
			const main = addMesh( model.geometry, this._makeMaterial( inst, anim, this.tier ), { kind: 'crowd', tier: this.tier } );
			main.castShadow = this.castShadow;
			main.receiveShadow = this.receiveShadow;
			if ( this.outlines ) addMesh( model.geometry, this._makeMaterial( inst, anim, this.tier, { hull: true } ), { kind: 'outline', tier: this.tier } );

		} else {

			this._ensureLodBuffers();
			for ( let k = 0; k <= this.tier; k ++ ) {

				const inst = this.lodBufs[ k ].toAttribute();
				const anim = this.lodAnimBufs[ k ].toAttribute();
				const geo = this.lodGeos[ k ];
				const main = addMesh( geo, this._makeMaterial( inst, anim, k ), { kind: 'crowd', tier: k } );
				main.castShadow = this.castShadow;
				main.receiveShadow = this.receiveShadow;
				main.count = 2; // real count comes from the indirect buffer
				if ( this.outlines ) {

					const o = addMesh( geo, this._makeMaterial( inst, anim, k, { hull: true } ), { kind: 'outline', tier: k } );
					o.count = 2;

				}

			}

		}

		if ( this.blobShadows ) {

			this.blobGeo = this.blobGeo || buildBlobGeometry();
			const blob = addMesh( this.blobGeo, this._makeBlobMaterial(), { kind: 'blob' } );
			blob.renderOrder = 1;

		}

		this._applyCount();

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
				for ( const m of this.meshes ) if ( m.userData.kind === 'crowd' ) m[ key ] = this[ key ];

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
			const passes = this.tier >= 2 ? this.cullPasses : this.cullPasses.slice( 0, 1 );
			for ( const pass of passes ) {

				pass.count = this.count;
				computes.push( pass );

			}

		}

		this.renderer.compute( computes );
		if ( this.collider ) this.collider.u.blast.value.w = 0; // explosion is a one-frame pulse
		if ( this.path === 'gpu' ) this._maybeReadback();

	}

	_updateCullUniforms( camera, viewportHeight ) {

		const u = this.u;
		const m = new THREE.Matrix4().multiplyMatrices( camera.projectionMatrix, camera.matrixWorldInverse );
		const frustum = new THREE.Frustum().setFromProjectionMatrix( m, camera.coordinateSystem );
		frustum.planes.forEach( ( p, k ) => u.planes[ k ].value.set( p.normal.x, p.normal.y, p.normal.z, p.constant ) );
		camera.getWorldPosition( u.camPos.value );
		if ( camera.isOrthographicCamera ) {

			u.isOrtho.value = 1;
			u.pxScale.value = viewportHeight / ( ( camera.top - camera.bottom ) / camera.zoom );

		} else {

			u.isOrtho.value = 0;
			u.pxScale.value = viewportHeight / ( 2 * Math.tan( THREE.MathUtils.degToRad( camera.fov ) / 2 ) );

		}

		u.maxTier.value = this.tier;
		u.lodOn.value = this.lodEnabled ? 1 : 0;

	}

	_maybeReadback() {

		const now = performance.now();
		if ( this._readbackPending || now - this._lastReadback < 400 ) return;
		this._readbackPending = true;
		this._lastReadback = now;
		this.renderer.getArrayBufferAsync( this.drawArgs ).then( ( buf ) => {

			const a = new Uint32Array( buf );
			for ( let k = 0; k < 4; k ++ ) this.visibleByTier[ k ] = a[ k * 5 + 1 ];
			this._readbackPending = false;

		} ).catch( () => {

			this._readbackPending = false;

		} );

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

		let tris = 0, instances = 0, draws = 0;
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

		return {
			tris, instances, draws, visibleByTier: this.visibleByTier.slice(),
			animBytes: animMemory( this.animSystem, Math.min( this.count, this.skeletalLimit ), this.models.slice( 0, this.tier + 1 ) ),
			collideBytes: this.collider ? this.collider.memoryBytes : 0
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
		const list = [ this.renderBuf, this.simBuf, this.animBuf, this.boneBuf, ...( this.lodBufs || [] ), ...( this.lodAnimBufs || [] ) ]
			.filter( Boolean ).map( ( n ) => n.value );
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
