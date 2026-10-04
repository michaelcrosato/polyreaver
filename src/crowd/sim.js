// Crowd compute kernels, rebuilt whenever the configuration changes and dispatched
// by Crowd.update():
//
//   init      scatter agents around their home slot with a random state / heading / phase
//   simulate  behaviour + activity choice, steering, Rapier hand-off, GPU collisions,
//             hero override, animation phase and cross-fade bookkeeping
//   skeletal  per-agent forward kinematics -> bone matrices (skeletal anim system only)
//   proxies   gather the agents near the hero so Rapier can give them colliders

import {
	Fn, If, float, int, uint, vec2, vec4, instancedArray, storage, instanceIndex, hash, sin, cos,
	abs, max, min, floor, fract, select, clamp, length, atan, sqrt, step, atomicAdd, atomicStore
} from 'three/tsl';
import { sampleBlended, channels, emitBoneMatrices, BONES, BONE_ROWS } from './anim.js';
import { CrowdCollider } from './collide.js';
import { buildCull } from './cull.js';

export const TAU = Math.PI * 2;
const SKELETAL_MAX = 131072; // bone buffer cap: 131k agents x 480 B = 63 MB ('bat' has no buffer, no cap)
export const MAX_PROXIES = 4096;

// Integer hashing: the multiply must wrap in u32 (float math would saturate for
// large agent indices and give thousands of agents identical "random" numbers).
export const hashF = ( seed, salt ) => hash( uint( seed ).mul( 7919 ).add( uint( salt ) ) );

function homeOf( crowd, fi ) {

	// Vogel / sunflower spiral: agent i lives at radius sqrt(i / (pi * density)).
	const r = sqrt( fi.div( crowd.u.density.mul( Math.PI ) ) );
	const a = fi.mul( 2.39996323 );
	return vec2( cos( a ), sin( a ) ).mul( r );

}

function crowdRadius( crowd ) {

	return sqrt( crowd.u.count.div( crowd.u.density.mul( Math.PI ) ) );

}

export function ensurePhysicsBuffers( crowd ) {

	if ( crowd.collide && ! crowd.collider ) {

		crowd.collider = new CrowdCollider( crowd.capacity );
		crowd.collider.buildComputes( crowd.renderBuf );

	}

	if ( crowd.rapierAgents > 0 && ( ! crowd.rapierIO || crowd.rapierIO.value.count < ( crowd.rapierAgents + 1 ) * 2 ) ) {

		// 2 x vec4 per agent: [ position from Rapier (CPU writes), desired velocity (GPU writes) ]
		crowd.rapierIO = instancedArray( ( crowd.rapierAgents + 1 ) * 2, 'vec4' ).setName( 'rapierIO' );

	}

	if ( crowd.proxies && ! crowd.proxyBuf ) {

		crowd.proxyBuf = instancedArray( MAX_PROXIES, 'vec4' ).setName( 'proxyList' );
		crowd.proxyCounter = instancedArray( 1, 'uint' ).setName( 'proxyCounter' );

	}

}

export function buildComputes( crowd ) {

	const u = crowd.u;
	const renderBuf = crowd.renderBuf;
	const simBuf = crowd.simBuf;
	const animBuf = crowd.animBuf;
	ensurePhysicsBuffers( crowd );
	const collider = crowd.collide ? crowd.collider : null;
	const rapier = crowd.rapierAgents > 0;

	// --- init ---------------------------------------------------------------
	crowd.initCompute = Fn( () => {

		const i = instanceIndex;
		const fi = float( i );
		const home = homeOf( crowd, fi );
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

	} )().compute( crowd.capacity ).setName( 'Crowd Init' );

	// --- per-frame simulation -------------------------------------------------
	crowd.simCompute = Fn( () => {

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

				const pp = crowd.rapierIO.element( i.mul( 2 ) );
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
					const home = homeOf( crowd, fi );
					const a = rnd( 4 ).mul( TAU );
					const longTrip = r3.lessThan( 0.08 );
					const radius = select( longTrip, crowdRadius( crowd ).mul( 0.9 ), u.wander );
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

				crowd.rapierIO.element( i.mul( 2 ).add( 1 ) ).assign( vec4( move.div( max( u.dt, 1e-4 ) ), heading, 1 ) );

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
		prevPhase.assign( fract( prevPhase.add( u.dt.mul( crowd.clipRates.element( int( prevState ) ) ) ).div( TAU ) ).mul( TAU ) );

		const rate = select( state.equal( 1 ), speed.mul( 4.8 ),
			select( state.equal( 2 ), speed.mul( 3.2 ), crowd.clipRates.element( int( state ) ).mul( speedMul.mul( 0.3 ).add( 0.7 ) ) ) );
		const frozen = beh.equal( 5 );
		phase.assign( select( frozen, phase, fract( phase.add( u.dt.mul( rate ) ).div( TAU ) ).mul( TAU ) ) );

		const hq = floor( fract( heading.div( TAU ) ).mul( 256 ) ).mod( 256 );
		const packed = state.add( hq.mul( 8 ) ).add( seed.mul( 2048 ) );
		renderBuf.element( i ).assign( vec4( pos.x, phase, pos.y, packed ) );
		simBuf.element( i ).assign( vec4( target, timer, heading ) );
		animBuf.element( i ).assign( vec4( prevState, blend, prevPhase, fi ) );

	} )().compute( crowd.capacity ).setName( 'Crowd Simulate' );

	buildSharedComputes( crowd );

}

// Animation and physics transfer kernels shared by domain-specific simulations.
export function buildSharedComputes( crowd ) {

	const u = crowd.u, renderBuf = crowd.renderBuf, animBuf = crowd.animBuf;
	ensurePhysicsBuffers( crowd );
	crowd.skelCompute?.dispose(); crowd.proxyReset?.dispose(); crowd.proxyGather?.dispose();

	// --- skeletal: per-agent forward kinematics -> bone matrices --------------
	crowd.skelCompute = null;
	if ( crowd.animSystem === 'skeletal' ) {

		const cap = Math.min( crowd.capacity, SKELETAL_MAX );
		if ( ! crowd.boneBuf || crowd.boneCap !== cap ) {

			crowd.boneBuf = instancedArray( cap * BONES * BONE_ROWS, 'vec4' ).setName( 'boneMatrices' );
			crowd.boneCap = cap;

		}

		const boneBuf = crowd.boneBuf;
		crowd.skelCompute = Fn( () => {

			const i = instanceIndex;
			const rd = renderBuf.element( i );
			const ad = animBuf.element( i );
			const seed = floor( rd.w.mul( 1 / 2048 ) );
			const rem = rd.w.sub( seed.mul( 2048 ) );
			const state = rem.sub( floor( rem.mul( 0.125 ) ).mul( 8 ) );
			const P = sampleBlended( crowd.clipTable, state, rd.y, ad.x, ad.z, ad.y );
			emitBoneMatrices( boneBuf, int( i ).mul( BONES * BONE_ROWS ), channels( P ) );

		} )().compute( cap ).setName( 'Skeleton FK' );

	}

	// --- proxies: agents near the hero, read back for Rapier ---------------
	crowd.proxyReset = crowd.proxyGather = null;
	if ( crowd.proxies ) {

		const counter = storage( crowd.proxyCounter.value, 'uint', 1 ).toAtomic();
		const proxyBuf = crowd.proxyBuf;
		crowd.proxyReset = Fn( () => {

			atomicStore( counter.element( 0 ), uint( 0 ) );

		} )().compute( 1 ).setName( 'Proxy Reset' );
		crowd.proxyGather = Fn( () => {

			const i = instanceIndex;
			const rd = renderBuf.element( i );
			const d = length( vec2( rd.x, rd.z ).sub( u.heroPos ) );
			If( i.notEqual( 0 ).and( d.lessThan( u.proxyRadius ) ), () => {

				const slot = atomicAdd( counter.element( 0 ), uint( 1 ) ).toVar();
				If( slot.lessThan( uint( MAX_PROXIES ) ), () => {

					proxyBuf.element( slot ).assign( vec4( rd.x, rd.z, float( i ), 0 ) );

				} );

			} );

		} )().compute( crowd.capacity ).setName( 'Proxy Gather' );

	}

	if ( crowd.lodBufs ) buildCull( crowd );

}
