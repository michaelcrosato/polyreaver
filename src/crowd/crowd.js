// GPU crowd: simulation in a compute shader, animation in the vertex shader.
//
// Data layout (one vec4 per agent that the renderer reads):
//   renderBuf[i] = ( x, animPhase, z, packed )
//   packed       = state + 8 * headingQuantized(0..255) + 2048 * colourSeed(0..4095)
// Packing everything the vertex shader needs into 16 bytes keeps bandwidth low and
// means the GPU-driven path only has to copy one vec4 per visible agent.
//
//   simBuf[i]    = ( targetX, targetZ, stateTimer, headingPrecise )
// is only touched by the compute shader.
//
// Two render paths:
//   DIRECT     - one instanced draw call for the whole crowd (count = N). The GPU
//                transforms every agent, even ones that are off screen.
//   GPU-DRIVEN - a compute pass frustum-culls every agent, picks a level of detail
//                from its on-screen size, and appends it to a per-LOD list with an
//                atomic counter. Each LOD is then drawn with drawIndexedIndirect, so
//                the CPU never knows (or cares) how many agents are visible.

import * as THREE from 'three/webgpu';
import {
	Fn, If, float, int, uint, vec2, vec3, vec4, uniform, uniformArray, instancedArray, storage,
	attribute, instanceIndex, hash, sin, cos, abs, max, min, floor, fract, select, mix, clamp,
	length, atan, sqrt, step, varyingProperty, atomicAdd, atomicStore, mx_hsvtorgb, normalView,
	positionViewDirection, dot, pow, uv, smoothstep, positionPrevious, positionLocal
} from 'three/tsl';
import { getModels, buildBlobGeometry } from './models.js';

const TAU = Math.PI * 2;

export const STATE = { IDLE: 0, WALK: 1, RUN: 2, WAVE: 3, CHEER: 4, DANCE: 5, TALK: 6 };

export const BEHAVIOURS = [
	{ id: 0, label: 'Wander (random activities)' },
	{ id: 1, label: 'Converge on hero (mass rush)' },
	{ id: 2, label: 'Flee from hero' },
	{ id: 3, label: 'Dance party' },
	{ id: 4, label: 'Stadium wave' },
	{ id: 5, label: 'Freeze (simulation off)' }
];

// Per-state animation parameters, looked up in the vertex shader by state id.
// A: legSwing, armSwing, kneeBend, elbowBend
// B: raiseLeft, raiseRight, raiseOsc, bob
// C: hop, torsoTwist, headYaw, lean
// D: alternatingRaise, elbowOsc, -, -
const ANIM = [
	/* idle  */[ [ 0.02, 0.04, 0.0, - 0.12 ], [ 0.07, 0.07, 0.0, 0.008 ], [ 0.0, 0.0, 0.8, 0.0 ], [ 0, 0, 0, 0 ] ],
	/* walk  */[ [ 0.45, 0.4, 0.6, - 0.25 ], [ 0.08, 0.08, 0.0, 0.035 ], [ 0.0, 0.06, 0.15, 0.04 ], [ 0, 0, 0, 0 ] ],
	/* run   */[ [ 0.85, 0.9, 1.3, - 1.4 ], [ 0.12, 0.12, 0.0, 0.07 ], [ 0.0, 0.12, 0.05, 0.2 ], [ 0, 0, 0, 0 ] ],
	/* wave  */[ [ 0.02, 0.0, 0.0, - 0.3 ], [ 0.08, 2.5, 0.35, 0.01 ], [ 0.0, 0.0, 0.2, 0.0 ], [ 0, 0, 0, 0 ] ],
	/* cheer */[ [ 0.1, 0.0, 0.3, - 0.2 ], [ 2.7, 2.7, 0.25, 0.0 ], [ 0.22, 0.0, 0.1, 0.0 ], [ 0, 0, 0, 0 ] ],
	/* dance */[ [ 0.3, 0.0, 0.4, - 0.6 ], [ 0.9, 0.9, 0.0, 0.05 ], [ 0.03, 0.45, 0.2, 0.0 ], [ 0.7, 0, 0, 0 ] ],
	/* talk  */[ [ 0.02, 0.0, 0.0, - 1.1 ], [ 0.15, 0.15, 0.0, 0.008 ], [ 0.0, 0.12, 0.4, 0.0 ], [ 0, 0.45, 0, 0 ] ]
];

// Phase speed (radians / second) for the stationary states. Walk/run derive it from speed.
const PHASE_RATE = [ 1.6, 0, 0, 7.0, 8.0, 5.5, 3.0 ];

// ---------------------------------------------------------------------------
// Small helpers that emit rotation math (angles are nodes).
// ---------------------------------------------------------------------------
function rotX( r, a ) {

	const c = cos( a ), s = sin( a );
	return vec3( r.x, r.y.mul( c ).sub( r.z.mul( s ) ), r.y.mul( s ).add( r.z.mul( c ) ) );

}

function rotY( r, a ) {

	const c = cos( a ), s = sin( a );
	return vec3( r.x.mul( c ).add( r.z.mul( s ) ), r.y, r.z.mul( c ).sub( r.x.mul( s ) ) );

}

function rotZ( r, a ) {

	const c = cos( a ), s = sin( a );
	return vec3( r.x.mul( c ).sub( r.y.mul( s ) ), r.x.mul( s ).add( r.y.mul( c ) ), r.z );

}

// Integer hashing: the multiply must wrap in u32 (float math would saturate for
// large agent indices and give thousands of agents identical "random" numbers).
// three.js derives the "previous frame" vertex position (used for the velocity
// buffer -> motion blur / TRAA) from the raw geometry, which ignores positionNode.
// Our agents are placed entirely by positionNode, so without this every agent
// would appear to move from the world origin each frame. We make "previous" equal
// the current animated position: camera motion is still captured, agent motion
// (small) is not.
export function withPreviousPosition( material ) {

	const setupPosition = material.setupPosition.bind( material );
	material.setupPosition = ( builder ) => {

		const result = setupPosition( builder );
		if ( builder.needsPreviousData() ) positionPrevious.assign( positionLocal );
		return result;

	};

	return material;

}

const hashF = ( seed, salt ) => hash( uint( seed ).mul( 7919 ).add( uint( salt ) ) );

export class Crowd {

	constructor( renderer, scene, options = {} ) {

		this.renderer = renderer;
		this.scene = scene;
		this.models = getModels();

		this.capacity = 0;
		this.count = options.count ?? 20000;
		this.tier = 0; // model tier (index into MODEL_TIERS)
		this.path = 'direct';
		this.materialKind = 'unlit';
		this.animated = true;
		this.outlines = false;
		this.rim = false;
		this.blobShadows = false;
		this.castShadow = false;
		this.receiveShadow = false;
		this.lodEnabled = true;

		// Uniforms shared by compute + render
		this.u = {
			time: uniform( 0 ),
			dt: uniform( 0 ),
			frame: uniform( 0, 'uint' ),
			density: uniform( 0.35 ), // agents per m^2
			wander: uniform( 14 ), // wander radius (m)
			activity: uniform( 0.6 ), // fraction choosing to move
			speedScale: uniform( 1 ),
			behaviour: uniform( 0 ),
			count: uniform( 1 ),
			heroPos: uniform( new THREE.Vector2() ),
			heroHeading: uniform( 0 ),
			heroState: uniform( 0 ),
			heroSpeed: uniform( 0 ),
			outline: uniform( 0.03 ),
			rimColor: uniform( new THREE.Color( 0.35, 0.45, 0.6 ) ),
			rimPower: uniform( 3.0 ),
			// culling / LOD
			planes: [ 0, 1, 2, 3, 4, 5 ].map( () => uniform( new THREE.Vector4() ) ),
			camPos: uniform( new THREE.Vector3() ),
			isOrtho: uniform( 1 ),
			pxScale: uniform( 100 ),
			lodThresholds: uniform( new THREE.Vector3( 150, 60, 22 ) ),
			maxTier: uniform( 0 ),
			lodOn: uniform( 1 )
		};

		// One varying carries the per-vertex palette colour to the fragment stage.
		this.vColor = varyingProperty( 'vec3', 'vCrowdColor' );

		this.animTable = uniformArray( ANIM.flat().map( ( r ) => new THREE.Vector4( ...r ) ), 'vec4' );
		this.phaseRates = uniformArray( PHASE_RATE, 'float' );

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

		this._disposeBuffers();
		this._freeStorage();
		this.capacity = capacity;
		this.count = Math.min( this.count, capacity );

		this.renderBuf = instancedArray( capacity, 'vec4' ).setName( 'crowdRender' );
		this.simBuf = instancedArray( capacity, 'vec4' ).setName( 'crowdSim' );

		this._buildComputes();
		this.lodBufs = null; // allocated on demand by the GPU-driven path
		this.lodGeos = null;
		this._needsInit = true;
		this._rebuildMeshes();

	}

	_homeOf( fi ) {

		// Vogel / sunflower spiral: agent i lives at radius sqrt(i / (pi * density)).
		// The first N agents always fill a disc, so the crowd grows outward as N grows.
		const r = sqrt( fi.div( this.u.density.mul( Math.PI ) ) );
		const a = fi.mul( 2.39996323 );
		return vec2( cos( a ), sin( a ) ).mul( r );

	}

	_crowdRadius() {

		return sqrt( this.u.count.div( this.u.density.mul( Math.PI ) ) );

	}

	_buildComputes() {

		const u = this.u;
		const renderBuf = this.renderBuf;
		const simBuf = this.simBuf;

		// --- init: scatter everyone around their home ---------------------------
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
			renderBuf.element( i ).assign( vec4( pos.x, hashF( fi, 5 ).mul( TAU ), pos.y, packed ) );
			simBuf.element( i ).assign( vec4( pos.x, pos.y, hashF( fi, 6 ).mul( 5 ), heading ) );

		} )().compute( this.capacity ).setName( 'Crowd Init' );

		// --- per-frame simulation -------------------------------------------------
		this.simCompute = Fn( () => {

			const i = instanceIndex;
			const fi = float( i );
			const rd = renderBuf.element( i ).toVar();
			const sd = simBuf.element( i ).toVar();

			const pos = vec2( rd.x, rd.z ).toVar();
			const phase = rd.y.toVar();
			const seed = floor( rd.w.mul( 1 / 2048 ) ).toVar();
			const rem = rd.w.sub( seed.mul( 2048 ) );
			const state = rem.sub( floor( rem.mul( 0.125 ) ).mul( 8 ) ).toVar();
			const target = vec2( sd.x, sd.y ).toVar();
			const timer = sd.z.sub( u.dt ).toVar();
			const heading = sd.w.toVar();
			const speedMul = hashF( fi, 7 ).mul( 0.45 ).add( 0.8 ).mul( u.speedScale );
			const speed = float( 0 ).toVar();
			const beh = u.behaviour;

			const rnd = ( salt ) => hash( i.add( u.frame.mul( 2654435761 ) ).add( uint( salt * 97 ) ) );

			// Behaviour overrides -------------------------------------------------
			If( beh.equal( 1 ), () => {

				// Converge: everyone heads for a packed disc around the hero.
				const packR = sqrt( u.count.div( Math.PI * 2.2 ) );
				const a = fi.mul( 2.39996323 );
				const slot = vec2( cos( a ), sin( a ) ).mul( sqrt( fi.div( u.count ) ).mul( packR ).add( 1.5 ) );
				target.assign( u.heroPos.add( slot ) );
				const d = length( target.sub( pos ) );
				state.assign( select( d.greaterThan( 25 ), float( 2 ), select( d.greaterThan( 0.6 ), float( 1 ), float( 4 ) ) ) );
				timer.assign( 1 );

			} ).ElseIf( beh.equal( 2 ), () => {

				// Flee: anyone within 30 m of the hero runs directly away.
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

				// Stadium wave: a band sweeping around the centre makes people cheer.
				const ang = atan( pos.y, pos.x );
				const sweep = fract( u.time.mul( 0.08 ) ).mul( TAU ).sub( Math.PI );
				let dA = ang.sub( sweep );
				dA = dA.sub( floor( dA.add( Math.PI ).div( TAU ) ).mul( TAU ) );
				const arc = abs( dA ).mul( max( length( pos ), 5 ) );
				state.assign( select( arc.lessThan( 6 ), float( 4 ), float( 0 ) ) );
				timer.assign( 1 );

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

					// idle 35%, talk 15%, wave 15%, cheer 15%, dance 20%
					state.assign( select( r2.lessThan( 0.35 ), float( 0 ),
						select( r2.lessThan( 0.5 ), float( 6 ),
							select( r2.lessThan( 0.65 ), float( 3 ),
								select( r2.lessThan( 0.8 ), float( 4 ), float( 5 ) ) ) ) ) );
					timer.assign( r3.mul( 5 ).add( 2 ) );

				} );

			} );

			// Locomotion ---------------------------------------------------------
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
				const stride = min( speed.mul( u.dt ), dist );
				pos.addAssign( vec2( sin( heading ), cos( heading ) ).mul( stride ) );
				If( dist.lessThan( 0.6 ).and( beh.equal( 0 ).or( beh.equal( 2 ) ) ), () => {

					timer.assign( 0 );

				} );

			} );

			// Hero (agent 0) is driven by the player ------------------------------
			If( i.equal( 0 ), () => {

				pos.assign( u.heroPos );
				heading.assign( u.heroHeading );
				state.assign( u.heroState );
				speed.assign( u.heroSpeed );
				timer.assign( 1 );

			} );

			// Animation phase ----------------------------------------------------
			const stateI = int( state );
			const rate = select( state.equal( 1 ), speed.mul( 4.8 ),
				select( state.equal( 2 ), speed.mul( 3.2 ), this.phaseRates.element( stateI ).mul( speedMul.mul( 0.3 ).add( 0.7 ) ) ) );
			const frozen = beh.equal( 5 );
			phase.assign( select( frozen, phase, fract( phase.add( u.dt.mul( rate ) ).div( TAU ) ).mul( TAU ) ) );

			const hq = floor( fract( heading.div( TAU ) ).mul( 256 ) ).mod( 256 );
			const packed = state.add( hq.mul( 8 ) ).add( seed.mul( 2048 ) );
			renderBuf.element( i ).assign( vec4( pos.x, phase, pos.y, packed ) );
			simBuf.element( i ).assign( vec4( target, timer, heading ) );

		} )().compute( this.capacity ).setName( 'Crowd Simulate' );

	}

	_ensureLodBuffers() {

		if ( this.lodBufs ) return;

		const cap = this.capacity;
		this.lodBufs = [ 0, 1, 2, 3 ].map( ( k ) => instancedArray( cap, 'vec4' ).setName( 'crowdLod' + k ) );

		// Indirect args, 5 x u32 per tier: indexCount, instanceCount, firstIndex, baseVertex, firstInstance
		const args = new Uint32Array( 20 );
		this.models.forEach( ( m, k ) => {

			args[ k * 5 ] = m.geometry.index.count;

		} );
		this.drawArgs = new THREE.IndirectStorageBufferAttribute( args, 1 );
		const draw = storage( this.drawArgs, 'uint', 20 ).toAtomic();

		// One geometry per LOD tier sharing the model's vertex buffers but with its
		// own indirect-args offset. Created once and never disposed: disposing a
		// geometry in three.js also destroys the storage buffers its materials read.
		this.lodGeos = this.models.map( ( m, k ) => {

			const src = m.geometry;
			const g = new THREE.BufferGeometry();
			for ( const name of Object.keys( src.attributes ) ) g.setAttribute( name, src.getAttribute( name ) );
			g.setIndex( src.index );
			g.setIndirect( this.drawArgs, k * 5 * 4 );
			g.boundingSphere = src.boundingSphere;
			return g;

		} );

		this.resetCompute = Fn( () => {

			atomicStore( draw.element( instanceIndex.mul( 5 ).add( 1 ) ), uint( 0 ) );

		} )().compute( 4 ).setName( 'Crowd Reset Args' );

		const u = this.u;
		const renderBuf = this.renderBuf;
		const lodBufs = this.lodBufs;

		this.cullCompute = Fn( () => {

			const i = instanceIndex;
			const rd = renderBuf.element( i ).toVar();
			const c = vec3( rd.x, 0.9, rd.z );
			const radius = float( 1.3 );
			const visible = float( 1 ).toVar();
			for ( const p of u.planes ) {

				visible.mulAssign( step( radius.negate(), dot( p.xyz, c ).add( p.w ) ) );

			}

			If( visible.greaterThan( 0.5 ), () => {

				// Estimated on-screen height in pixels.
				const dist = length( c.sub( u.camPos ) );
				const px = select( u.isOrtho.greaterThan( 0.5 ), u.pxScale, u.pxScale.div( max( dist, 0.5 ) ) ).mul( 1.8 );
				const t = u.lodThresholds;
				const lodTier = select( px.greaterThan( t.x ), float( 3 ), select( px.greaterThan( t.y ), float( 2 ), select( px.greaterThan( t.z ), float( 1 ), float( 0 ) ) ) );
				const tier = int( select( u.lodOn.greaterThan( 0.5 ), min( lodTier, u.maxTier ), u.maxTier ) ).toVar();
				const slot = atomicAdd( draw.element( tier.mul( 5 ).add( 1 ) ), uint( 1 ) ).toVar( 'slot' );
				If( tier.equal( 0 ), () => {

					lodBufs[ 0 ].element( slot ).assign( rd );

				} ).ElseIf( tier.equal( 1 ), () => {

					lodBufs[ 1 ].element( slot ).assign( rd );

				} ).ElseIf( tier.equal( 2 ), () => {

					lodBufs[ 2 ].element( slot ).assign( rd );

				} ).Else( () => {

					lodBufs[ 3 ].element( slot ).assign( rd );

				} );

			} );

		} )().compute( this.capacity ).setName( 'Crowd Cull + LOD' );

	}

	// -----------------------------------------------------------------------
	// Vertex shader: decode instance, animate parts, place in world.
	// -----------------------------------------------------------------------
	_vertexNode( inst, { hull = false } = {} ) {

		const u = this.u;
		const animTable = this.animTable;
		const animated = this.animated;
		const vColor = this.vColor;

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
			let v = attribute( 'position', 'vec3' ).toVar();
			if ( hull ) v.addAssign( attribute( 'hullDir', 'vec3' ).mul( u.outline ) );

			if ( animated ) {

				const si = int( state ).mul( 4 );
				const A = animTable.element( si );
				const B = animTable.element( si.add( 1 ) );
				const C = animTable.element( si.add( 2 ) );
				const D = animTable.element( si.add( 3 ) );

				const part = jointA.w;
				const isLimb = step( 1.5, part );
				const isLower = step( 5.5, part );
				const qm = part.sub( 2 ).mod( 4 );
				const isArm = isLimb.mul( step( qm, 1.5 ) );
				const isLeg = isLimb.sub( isArm );
				const side = float( 1 ).sub( qm.mod( 2 ).mul( 2 ) ); // +1 left, -1 right
				const isHead = float( 1 ).sub( step( 0.5, abs( part.sub( 1 ) ) ) );
				const upperBody = float( 1 ).sub( isLeg );

				const sp = sin( p ), cp = cos( p ), s2p = sin( p.mul( 2 ) );

				const legSwing = A.x.mul( sp ).mul( side );
				const armSwing = A.y.mul( sp ).mul( side ).negate();
				const knee = A.z.mul( max( cp.mul( side ).negate(), 0 ) );
				const elbow = A.w.add( D.y.mul( sin( p.add( side ) ) ) );
				const raiseBase = select( side.greaterThan( 0 ), B.x, B.y );
				const raise = side.mul( raiseBase
					.add( B.z.mul( step( 1.0, raiseBase ) ).mul( s2p ) )
					.add( D.x.mul( side ).mul( sp ) ) );
				const bob = B.w.mul( abs( cp ) ).add( C.x.mul( max( s2p, 0 ) ) );
				const twist = C.y.mul( sp );
				const headYaw = C.z.mul( sin( u.time.mul( 0.45 ).add( seed ) ) );

				// 1. lower segment bends around elbow / knee
				const bend = isLower.mul( isArm.mul( elbow ).add( isLeg.mul( knee ) ) );
				v.assign( rotX( v.sub( jointA.xyz ), bend ).add( jointA.xyz ) );
				// 2. whole limb swings around shoulder / hip, arms can raise sideways
				const swing = isArm.mul( armSwing ).add( isLeg.mul( legSwing ) );
				const pivotB = jointB.xyz;
				v.assign( rotZ( rotX( v.sub( pivotB ), swing ), isArm.mul( raise ) ).add( pivotB ) );
				// 3. head looks around
				const neck = vec3( 0, 1.5, 0 );
				v.assign( rotY( v.sub( neck ), headYaw.mul( isHead ) ).add( neck ) );
				// 4. upper body leans / twists around the hips
				const hip = vec3( 0, 0.92, 0 );
				v.assign( rotY( rotX( v.sub( hip ), C.w.mul( upperBody ) ), twist.mul( upperBody ) ).add( hip ) );
				// 5. bob / hop
				v.y.addAssign( bob );

			}

			// Per-agent size variation, heading and placement.
			const scale = select( seed.equal( 0 ), float( 1.12 ), hashF( seed, 11 ).mul( 0.22 ).add( 0.88 ) );
			const world = rotY( v.mul( scale ), heading ).add( vec3( inst.x, 0, inst.z ) );

			// Palette (computed per vertex, handed to the fragment stage as one varying).
			if ( ! hull ) {

				// Colours are authored in sRGB and converted to linear (≈ gamma 2.2) so
				// the palette looks like clothing rather than neon.
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
				const col = pow( srgb, vec3( 2.2 ) );
				vColor.assign( col );

			}

			return world;

		} )();

	}

	_makeMaterial( inst, { hull = false } = {} ) {

		let mat;
		const kind = this.materialKind;
		if ( hull ) {

			mat = new THREE.MeshBasicNodeMaterial( { side: THREE.BackSide } );
			mat.colorNode = vec4( 0.02, 0.02, 0.03, 1 );
			mat.positionNode = this._vertexNode( inst, { hull: true } );
			mat.name = 'CrowdOutline';
			return withPreviousPosition( mat );

		}

		switch ( kind ) {

			case 'lambert': mat = new THREE.MeshLambertNodeMaterial(); break;
			case 'phong': mat = new THREE.MeshPhongNodeMaterial( { shininess: 40, specular: 0x333333 } ); break;
			case 'standard': mat = new THREE.MeshStandardNodeMaterial( { roughness: 0.65, metalness: 0.0 } ); break;
			case 'physical': mat = new THREE.MeshPhysicalNodeMaterial( { roughness: 0.45, metalness: 0.0, clearcoat: 0.6, clearcoatRoughness: 0.25, sheen: 0.5, sheenRoughness: 0.6, sheenColor: 0xffffff } ); break;
			case 'toon': mat = new THREE.MeshToonNodeMaterial(); break;
			default: mat = new THREE.MeshBasicNodeMaterial();

		}

		const vColor = this.vColor;
		mat.positionNode = this._vertexNode( inst );

		if ( this.rim ) {

			// Fresnel rim light: brightens silhouettes facing away from the camera.
			const fres = pow( float( 1 ).sub( clamp( dot( normalView, positionViewDirection ), 0, 1 ) ), this.u.rimPower );
			const rimCol = this.u.rimColor.mul( fres );
			if ( kind === 'unlit' ) mat.colorNode = vec4( vColor.add( rimCol ), 1 );
			else {

				mat.colorNode = vec4( vColor, 1 );
				mat.emissiveNode = rimCol;

			}

		} else {

			mat.colorNode = vec4( vColor, 1 );

		}

		mat.name = 'Crowd_' + kind;
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

		for ( const m of this.meshes ) {

			this.group.remove( m );
			m.material.dispose();

		}

		this.meshes = [];
		this.drawMeshes = [];

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
			const main = addMesh( model.geometry, this._makeMaterial( inst ), { kind: 'crowd', tier: this.tier } );
			main.castShadow = this.castShadow;
			main.receiveShadow = this.receiveShadow;
			this.drawMeshes.push( main );
			if ( this.outlines ) {

				const o = addMesh( model.geometry, this._makeMaterial( inst, { hull: true } ), { kind: 'outline', tier: this.tier } );
				this.drawMeshes.push( o );

			}

		} else {

			this._ensureLodBuffers();
			for ( let k = 0; k <= this.tier; k ++ ) {

				const inst = this.lodBufs[ k ].toAttribute();
				const geo = this.lodGeos[ k ];
				const main = addMesh( geo, this._makeMaterial( inst ), { kind: 'crowd', tier: k } );
				main.castShadow = this.castShadow;
				main.receiveShadow = this.receiveShadow;
				main.count = 2; // real count comes from the indirect buffer
				if ( this.outlines ) {

					const o = addMesh( geo, this._makeMaterial( inst, { hull: true } ), { kind: 'outline', tier: k } );
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

	// -----------------------------------------------------------------------
	// Public setters
	// -----------------------------------------------------------------------
	setCount( n ) {

		this.count = Math.max( 1, Math.min( Math.floor( n ), this.capacity ) );
		this._applyCount();

	}

	set( options ) {

		let rebuild = false;
		for ( const key of [ 'tier', 'path', 'materialKind', 'animated', 'outlines', 'rim', 'blobShadows' ] ) {

			if ( key in options && options[ key ] !== this[ key ] ) {

				this[ key ] = options[ key ];
				rebuild = true;

			}

		}

		for ( const key of [ 'castShadow', 'receiveShadow' ] ) {

			if ( key in options && options[ key ] !== this[ key ] ) {

				this[ key ] = options[ key ];
				for ( const m of this.meshes ) if ( m.userData.kind === 'crowd' ) m[ key ] = this[ key ];

			}

		}

		if ( 'lodEnabled' in options ) this.lodEnabled = options.lodEnabled;
		if ( rebuild ) this._rebuildMeshes();

	}

	// Radius of the disc the first `count` agents occupy (their homes).
	get radius() {

		return Math.sqrt( this.count / ( this.u.density.value * Math.PI ) ) + this.u.wander.value;

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

		const computes = [];
		if ( this._needsInit ) {

			computes.push( this.initCompute );
			this._needsInit = false;

		}

		this.simCompute.count = this.count;
		computes.push( this.simCompute );

		if ( this.path === 'gpu' ) {

			this._updateCullUniforms( camera, viewportHeight );
			this.cullCompute.count = this.count;
			computes.push( this.resetCompute, this.cullCompute );

		}

		this.renderer.compute( computes );

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

	// Triangles submitted per pass for the crowd (excluding shadow passes).
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

		return { tris, instances, draws, visibleByTier: this.visibleByTier.slice() };

	}

	_disposeBuffers() {

		for ( const m of this.meshes ) {

			this.group.remove( m );
			m.material.dispose();

		}

		this.meshes = [];

	}

	// Release the GPU memory of the old storage buffers right away instead of
	// waiting for garbage collection (matters when jumping between 1M and 4M agents).
	_freeStorage() {

		const attrs = this.renderer._attributes;
		if ( ! attrs || ! this.renderBuf ) return;
		const list = [ this.renderBuf, this.simBuf, ...( this.lodBufs || [] ) ].map( ( n ) => n.value );
		if ( this.drawArgs ) list.push( this.drawArgs );
		for ( const a of list ) {

			try {

				attrs.delete( a );

			} catch { /* not uploaded yet */ }

		}

		this.drawArgs = null;

	}

}
