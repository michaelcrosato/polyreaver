// Crowd motion vectors: where was this vertex last frame?
//
// Motion blur, TRAA and SSGI read a velocity buffer (an extra MRT output of the main
// pass): how far every pixel moved on screen since the previous frame. three.js
// computes it per vertex from last frame's camera and model matrices plus
// `positionPrevious`, the vertex's previous local position, which it can only derive
// from the raw geometry (or its own skinning / instancing). Agents are placed entirely
// by our vertex shader from GPU data, so the crowd has to supply that position itself.
// The "Crowd motion vectors" setting (crowd.motionVectors) picks how:
//
//   camera  previous = current. Only the camera's motion is captured: walking people
//           get no motion blur and TRAA reprojects them as if they stood still (smears).
//   root    previous = current - velocity x dt. The velocity is rebuilt from data the
//           vertex shader already has (state + heading from the packed word, the agent
//           index for the per-agent speed hash) with the simulation's own formula
//           (sim.js). A hash and a sin/cos per vertex, no extra buffers.
//   full    root + the previous animation pose: the whole vertex shader runs a second
//           time on instance data rewound by one frame (phase, cross-fade, time), so
//           swinging arms and legs blur too. Roughly doubles the per-vertex animation
//           cost. Skeletal falls back to root: its bone buffer only holds this frame's
//           matrices (keeping last frame's as well would double its 480 B per agent).
//
// None of this runs unless a pass writes velocity: withPreviousPosition() (materials.js)
// only calls these builders while compiling such a pass, and shadow passes never do.
// Not captured: GPU-collision pushes, knockbacks and turning (the heading is current).

import { float, int, vec3, vec4, floor, select, sin, cos, max, instanceIndex, positionLocal } from 'three/tsl';
import { TAU, hashF } from './sim.js';

// Systems that cannot (skeletal) or need not (none: static pose) rebuild last frame's pose.
const ROOT_ONLY = new Set( [ 'none', 'skeletal' ] );

// One simulation step of an agent's movement, decoded in the vertex shader.
// `agent` is the agent index as a float: animBuf.w in both render paths (the GPU-driven
// cull copies it into each LOD's visible list), the instance index for blob shadows.
export function agentMotion( crowd, packed, agent ) {

	const u = crowd.u;
	const seed = floor( packed.mul( 1 / 2048 ) );
	const rem = packed.sub( seed.mul( 2048 ) );
	const hq = floor( rem.mul( 0.125 ) );
	const state = rem.sub( hq.mul( 8 ) );
	const heading = hq.mul( TAU / 256 );
	// As in sim.js: walk 1.35 m/s, run 3.6 m/s, times a per-agent hash and the global
	// speed; nobody walks in "Freeze"; the hero (agent 0) moves at the player's speed.
	const speedMul = hashF( agent, 7 ).mul( 0.45 ).add( 0.8 ).mul( u.speedScale );
	const moving = state.equal( 1 ).or( state.equal( 2 ) ).and( u.behaviour.notEqual( 5 ) );
	const gait = select( state.equal( 2 ), float( 3.6 ), float( 1.35 ) ).mul( speedMul );
	const speed = select( agent.equal( 0 ), u.heroSpeed, select( moving, gait, float( 0 ) ) );
	return { state, speed, speedMul, velocity: vec3( sin( heading ), 0, cos( heading ) ).mul( speed ) };

}

// Builder of the previous local position for a crowd material (null = camera only).
// `pose( inst, anim )` runs the material's vertex shader on other instance data.
export function previousPosition( crowd, inst, anim, pose ) {

	const mode = crowd.motionVectors;
	if ( mode === 'camera' ) return null;
	const full = mode === 'full' && ! ROOT_ONLY.has( crowd.animSystem );

	return () => {

		const u = crowd.u;
		const m = agentMotion( crowd, inst.w, anim.w );
		const step = m.velocity.mul( u.dt );
		if ( ! full ) return positionLocal.sub( step );

		// Rewind the inputs of the animation by one step, mirroring sim.js: the phase
		// advances with the walking speed (or the clip's own rate), the outgoing clip of
		// a cross-fade at its clip rate, and the blend weight at blendSpeed.
		const rate = select( m.state.equal( 1 ), m.speed.mul( 4.8 ), select( m.state.equal( 2 ), m.speed.mul( 3.2 ),
			crowd.clipRates.element( int( m.state ) ).mul( m.speedMul.mul( 0.3 ).add( 0.7 ) ) ) );
		const phaseStep = select( u.behaviour.equal( 5 ), float( 0 ), rate.mul( u.dt ) );
		const blend = select( anim.y.lessThan( 1 ), max( anim.y.sub( u.dt.mul( u.blendSpeed ) ), 0 ), float( 1 ) );
		const prevPhase = anim.z.sub( crowd.clipRates.element( int( anim.x ) ).mul( u.dt ) );
		return pose(
			vec4( inst.x.sub( step.x ), inst.y.sub( phaseStep ), inst.z.sub( step.z ), inst.w ),
			vec4( anim.x, blend, prevPhase, anim.w )
		);

	};

}

// Blob shadows are not animated: root motion is all they need ("full" included).
export function previousBlobPosition( crowd, inst ) {

	if ( crowd.motionVectors === 'camera' ) return null;
	return () => positionLocal.sub( agentMotion( crowd, inst.w, float( instanceIndex ) ).velocity.mul( crowd.u.dt ) );

}
