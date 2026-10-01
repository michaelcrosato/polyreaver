// Six crowd animation systems, all driven by the same agent state + phase so
// they can be compared like-for-like:
//
//   none        static rest pose - pure transform cost, the baseline
//   procedural  sine curves per joint, evaluated per vertex (the original system).
//               Cheapest moving option, but states switch with a visible "pop".
//   keyframe    hand-keyed clips (clips.js) sampled per VERTEX from a uniform table,
//               with a cross-fade between the previous and current clip.
//   skeletal    the same clips sampled once per AGENT in a compute pass, forward
//               kinematics -> 10 bone matrices per agent in a storage buffer, then
//               linear-blend skinning in the vertex shader (smooth elbows / knees).
//               How most game engines animate characters; costs bone memory.
//   bat         Skeletal with a baked bone texture: the bone matrices of every clip key
//               are computed ONCE on the CPU into a small float texture; the vertex
//               shader fetches + interpolates them and skins like `skeletal`. No
//               per-agent bones, so no agent cap - paid for with texture fetches.
//   vat         Vertex Animation Texture: every vertex position of every clip frame is
//               baked into a float texture at load time; the vertex shader just reads
//               it. Zero joint math at runtime - the classic huge-crowd technique.

import * as THREE from 'three/webgpu';
import {
	Fn, If, float, int, vec3, vec4, sin, cos, abs, max, floor, fract, select, mix, step, uniformArray,
	attribute, textureLoad, ivec2, vertexIndex, dot
} from 'three/tsl';
import { CHANNELS, KEYS_BAKED, STATE_COUNT, PIVOTS, BAKED, clipTable, samplePose, poseVertexJS } from './clips.js';

const TAU = Math.PI * 2;

export const ANIM_SYSTEMS = [ 'none', 'procedural', 'keyframe', 'skeletal', 'bat', 'vat' ];
export const BONES = 10;
export const BONE_ROWS = 3; // mat3x4 per bone

// Pivots per bone (bone id == body part id): [own pivot, parent pivot]
const BONE_PIVOTS = [
	[ PIVOTS.hip, PIVOTS.hip ], [ PIVOTS.neck, PIVOTS.neck ],
	[ PIVOTS.lShoulder, PIVOTS.lShoulder ], [ PIVOTS.rShoulder, PIVOTS.rShoulder ],
	[ PIVOTS.lHip, PIVOTS.lHip ], [ PIVOTS.rHip, PIVOTS.rHip ],
	[ PIVOTS.lElbow, PIVOTS.lShoulder ], [ PIVOTS.rElbow, PIVOTS.rShoulder ],
	[ PIVOTS.lKnee, PIVOTS.lHip ], [ PIVOTS.rKnee, PIVOTS.rHip ]
];

// --- rotation helpers (angle given as { c, s } so sin/cos are computed once) -------
const cs = ( a ) => ( { c: cos( a ), s: sin( a ) } );

function rotXcs( r, t ) {

	return vec3( r.x, r.y.mul( t.c ).sub( r.z.mul( t.s ) ), r.y.mul( t.s ).add( r.z.mul( t.c ) ) );

}

function rotYcs( r, t ) {

	return vec3( r.x.mul( t.c ).add( r.z.mul( t.s ) ), r.y, r.z.mul( t.c ).sub( r.x.mul( t.s ) ) );

}

function rotZcs( r, t ) {

	return vec3( r.x.mul( t.c ).sub( r.y.mul( t.s ) ), r.x.mul( t.s ).add( r.y.mul( t.c ) ), r.z );

}

const about = ( rot, v, pivot, t ) => rot( v.sub( pivot ), t ).add( pivot );

export function rotY( r, a ) {

	return rotYcs( r, cs( a ) );

}

// ----------------------------------------------------------------------------
// Clip sampling (GPU). Table layout: [state][key][4 x vec4] -> 16 channels.
// ----------------------------------------------------------------------------
export function makeClipTable() {

	return uniformArray( clipTable().map( ( r ) => new THREE.Vector4( ...r ) ), 'vec4' );

}

// Returns 4 vec4 nodes (16 channels) for (state, phase), linearly interpolating the
// Catmull-Rom-resampled keys.
export function sampleClip( table, state, phase ) {

	const f = fract( phase.div( TAU ) ).mul( KEYS_BAKED );
	const k0 = floor( f );
	const t = f.sub( k0 );
	const k1 = k0.add( 1 ).mod( KEYS_BAKED );
	const base0 = int( state ).mul( KEYS_BAKED ).add( int( k0 ) ).mul( 4 );
	const base1 = int( state ).mul( KEYS_BAKED ).add( int( k1 ) ).mul( 4 );
	return [ 0, 1, 2, 3 ].map( ( c ) => mix( table.element( base0.add( c ) ), table.element( base1.add( c ) ), t ) );

}

// Cross-fade: previous clip -> current clip by `blend` (0..1).
export function sampleBlended( table, state, phase, prevState, prevPhase, blend ) {

	const cur = sampleClip( table, state, phase );
	const prev = sampleClip( table, prevState, prevPhase );
	return cur.map( ( c, k ) => mix( prev[ k ], c, blend ) );

}

// 4 x vec4 -> array of 16 float nodes
export const channels = ( P ) => [ P[ 0 ].x, P[ 0 ].y, P[ 0 ].z, P[ 0 ].w, P[ 1 ].x, P[ 1 ].y, P[ 1 ].z, P[ 1 ].w,
	P[ 2 ].x, P[ 2 ].y, P[ 2 ].z, P[ 2 ].w, P[ 3 ].x, P[ 3 ].y, P[ 3 ].z, P[ 3 ].w ];

// ----------------------------------------------------------------------------
// Pose chain with a per-vertex (dynamic) part id - mirrors poseVertexJS().
// ----------------------------------------------------------------------------
export function poseVertexDynamic( v, jointA, jointB, ch ) {

	const part = jointA.w;
	const isLimb = step( 1.5, part );
	const isLower = step( 5.5, part );
	const qm = part.sub( 2 ).mod( 4 );
	const isArm = isLimb.mul( step( qm, 1.5 ) );
	const isLeg = isLimb.sub( isArm );
	const left = float( 1 ).sub( qm.mod( 2 ) ); // 1 = left side
	const side = left.mul( 2 ).sub( 1 );
	const isHead = float( 1 ).sub( step( 0.5, abs( part.sub( 1 ) ) ) );
	const upper = float( 1 ).sub( isLeg );

	const armSwing = mix( ch[ 9 ], ch[ 6 ], left );
	const armRaise = mix( ch[ 10 ], ch[ 7 ], left );
	const elbow = mix( ch[ 11 ], ch[ 8 ], left );
	const hip = mix( ch[ 14 ], ch[ 12 ], left );
	const knee = mix( ch[ 15 ], ch[ 13 ], left );

	const neck = vec3( ...PIVOTS.neck ), pelvis = vec3( ...PIVOTS.hip );
	let p = v;
	p = about( rotXcs, p, jointA.xyz, cs( isLower.mul( isArm.mul( elbow ).add( isLeg.mul( knee ) ) ) ) );
	p = about( rotXcs, p, jointB.xyz, cs( isArm.mul( armSwing ).add( isLeg.mul( hip ) ) ) );
	p = about( rotZcs, p, jointB.xyz, cs( isArm.mul( side ).mul( armRaise ) ) );
	p = about( rotXcs, p, neck, cs( ch[ 5 ].mul( isHead ) ) );
	p = about( rotYcs, p, neck, cs( ch[ 4 ].mul( isHead ) ) );
	p = about( rotXcs, p, pelvis, cs( ch[ 2 ].mul( upper ) ) );
	p = about( rotZcs, p, pelvis, cs( ch[ 3 ].mul( upper ) ) );
	p = about( rotYcs, p, pelvis, cs( ch[ 1 ].mul( upper ) ) );
	return p.add( vec3( 0, ch[ 0 ], 0 ) );

}

// Same chain for a bone whose id is known in JavaScript: only the rotations that
// apply to that bone are emitted. `T` holds precomputed { c, s } per channel.
function poseBoneStatic( v, bone, T, ch ) {

	const [ jA, jB ] = BONE_PIVOTS[ bone ];
	const isLimb = bone >= 2, isLower = bone >= 6;
	const q = isLimb ? ( bone - 2 ) % 4 : - 1;
	const isArm = isLimb && q <= 1, isLeg = isLimb && ! isArm;
	const left = q % 2 === 0;
	let p = v;
	if ( isLower ) p = about( rotXcs, p, vec3( ...jA ), T[ isArm ? ( left ? 8 : 11 ) : ( left ? 13 : 15 ) ] );
	if ( isLimb ) {

		p = about( rotXcs, p, vec3( ...jB ), T[ isArm ? ( left ? 6 : 9 ) : ( left ? 12 : 14 ) ] );
		if ( isArm ) p = about( rotZcs, p, vec3( ...jB ), left ? T[ 7 ] : T.negR );

	}

	if ( bone === 1 ) {

		p = about( rotXcs, p, vec3( ...PIVOTS.neck ), T[ 5 ] );
		p = about( rotYcs, p, vec3( ...PIVOTS.neck ), T[ 4 ] );

	}

	if ( ! isLeg ) {

		p = about( rotXcs, p, vec3( ...PIVOTS.hip ), T[ 2 ] );
		p = about( rotZcs, p, vec3( ...PIVOTS.hip ), T[ 3 ] );
		p = about( rotYcs, p, vec3( ...PIVOTS.hip ), T[ 1 ] );

	}

	return p.add( vec3( 0, ch[ 0 ], 0 ) );

}

// Writes the 10 bone matrices (mat3x4 rows) for one agent into boneBuf.
// Each bone transform is affine, so it is recovered by pushing the origin and the
// three unit axes through that bone's pose chain.
export function emitBoneMatrices( boneBuf, base, ch ) {

	const T = ch.map( ( a ) => ( { c: cos( a ).toVar(), s: sin( a ).toVar() } ) );
	T.negR = { c: T[ 10 ].c, s: T[ 10 ].s.negate() }; // right arm raises toward -X
	for ( let b = 0; b < BONES; b ++ ) {

		const o = poseBoneStatic( vec3( 0, 0, 0 ), b, T, ch ).toVar();
		const ex = poseBoneStatic( vec3( 1, 0, 0 ), b, T, ch ).sub( o ).toVar();
		const ey = poseBoneStatic( vec3( 0, 1, 0 ), b, T, ch ).sub( o ).toVar();
		const ez = poseBoneStatic( vec3( 0, 0, 1 ), b, T, ch ).sub( o ).toVar();
		const row = base.add( b * BONE_ROWS );
		boneBuf.element( row ).assign( vec4( ex.x, ey.x, ez.x, o.x ) );
		boneBuf.element( row.add( 1 ) ).assign( vec4( ex.y, ey.y, ez.y, o.y ) );
		boneBuf.element( row.add( 2 ) ).assign( vec4( ex.z, ey.z, ez.z, o.z ) );

	}

}

// Linear blend skinning with up to two bones per vertex.
export function skinVertex( boneBuf, agentIndex, v, smooth ) {

	const base = int( agentIndex ).mul( BONES * BONE_ROWS );
	const skinIdx = attribute( 'skinIdx', 'vec2' );
	const apply = ( bone ) => {

		const row = base.add( int( bone ).mul( BONE_ROWS ) );
		const r0 = boneBuf.element( row ), r1 = boneBuf.element( row.add( 1 ) ), r2 = boneBuf.element( row.add( 2 ) );
		const h = vec4( v, 1 );
		return vec3( dot( r0, h ), dot( r1, h ), dot( r2, h ) );

	};

	const p0 = apply( skinIdx.x );
	if ( ! smooth ) return p0;
	const w = attribute( 'skinW', 'float' );
	return mix( apply( skinIdx.y ), p0, w );

}

// ----------------------------------------------------------------------------
// Baked bone texture ("bat"): skeletal skinning without the per-agent compute pass.
//
// The skeletal system runs forward kinematics for every agent every frame and keeps
// 480 bytes of bone matrices per agent. But an agent's pose depends only on
// (state, phase) plus the cross-fade - so the bones of every clip at every baked key
// can be computed ONCE on the CPU and stored in a texture. The vertex shader then
// fetches the two keys around the agent's phase, interpolates, cross-fades with the
// previous clip and skins exactly like skinVertex(). Nothing is stored per agent, so
// there is no agent cap and no FK pass; the price moves into the vertex shader:
// 12 texel fetches per vertex (2 bones x 3 rows x 2 keys), 24 while cross-fading,
// versus 6 storage reads for `skeletal`. All agents read the same 120 KB, so the
// fetches hit the texture cache. VAT is the far end of the same trade: it bakes the
// final vertex POSITIONS (every vertex of every tier, ~1 MB for Hi) so the vertex
// shader does no joint maths at all, just 2-4 fetches.
//
// Layout: one RGBA32F texel per mat3x4 row. Column = bone * 3 + row (30 wide),
// row = state * KEYS_BAKED + key (256 tall): 30 x 256 x 16 B = 120 KB, shared by all
// model tiers because the bones do not depend on the mesh.
// ----------------------------------------------------------------------------
export const BAT_WIDTH = BONES * BONE_ROWS;

// CPU forward kinematics for one bone: the 3 x 4 affine matrix (rows of x y z w,
// 12 floats at out[ o ]). poseVertexJS() run with the bone's BONE_PIVOTS applies the
// same rotations, pivots and channel mapping as poseBoneStatic() on the GPU, and
// the matrix is recovered the same way: push the origin and the three unit axes
// through the chain.
export function boneMatrixJS( bone, pose, out = new Float32Array( BONE_ROWS * 4 ), o = 0 ) {

	const [ jA, jB ] = BONE_PIVOTS[ bone ];
	const at = ( x, y, z ) => poseVertexJS( [ x, y, z ], bone, jA, jB, pose );
	const org = at( 0, 0, 0 ), ex = at( 1, 0, 0 ), ey = at( 0, 1, 0 ), ez = at( 0, 0, 1 );
	for ( let r = 0; r < BONE_ROWS; r ++ ) {

		out[ o + r * 4 ] = ex[ r ] - org[ r ];
		out[ o + r * 4 + 1 ] = ey[ r ] - org[ r ];
		out[ o + r * 4 + 2 ] = ez[ r ] - org[ r ];
		out[ o + r * 4 + 3 ] = org[ r ];

	}

	return out;

}

// Bakes every bone of every clip key: 10k CPU pose evaluations, a few milliseconds once.
export function bakeBoneTexture() {

	const rows = STATE_COUNT * KEYS_BAKED;
	const data = new Float32Array( BAT_WIDTH * rows * 4 );
	for ( let s = 0; s < STATE_COUNT; s ++ ) {

		for ( let k = 0; k < KEYS_BAKED; k ++ ) {

			const row = s * KEYS_BAKED + k;
			for ( let b = 0; b < BONES; b ++ ) boneMatrixJS( b, BAKED[ s ][ k ], data, ( row * BAT_WIDTH + b * BONE_ROWS ) * 4 );

		}

	}

	const tex = new THREE.DataTexture( data, BAT_WIDTH, rows, THREE.RGBAFormat, THREE.FloatType );
	tex.minFilter = tex.magFilter = THREE.NearestFilter;
	tex.generateMipmaps = false;
	tex.needsUpdate = true;
	tex.name = 'BoneAnimTexture';
	tex.userData.bytes = data.byteLength;
	return tex;

}

// Texture rows of the two baked keys around `phase` in clip `state`, and the fraction
// between them (the same key maths as sampleClip / sampleVAT).
function boneKeys( state, phase ) {

	const f = fract( phase.div( TAU ) ).mul( KEYS_BAKED );
	const k0 = floor( f );
	const base = int( state ).mul( KEYS_BAKED );
	return { r0: base.add( int( k0 ) ), r1: base.add( int( k0.add( 1 ).mod( KEYS_BAKED ) ) ), t: f.sub( k0 ) };

}

// The 3 rows of one bone matrix, interpolated between the two keys. This lerps
// MATRICES, while `skeletal` lerps joint angles and then runs FK: a lerped rotation
// cuts the chord of the arc, so a limb is slightly short mid-way between keys. At the
// KEYS_BAKED = 32 keys per loop that VAT also uses, the joints turn at most 0.41 rad
// from one key to the next, and the skinned vertices end up 0.5 mm off the
// angle-lerped pose on average, 2 cm at worst (a hand, mid-way between two keys of
// the fast knocked-down stagger, for a frame) - fine for a crowd. The error grows
// with the square of the key spacing: 64 keys (240 KB) would quarter it.
function boneRows( tex, keys, col ) {

	return [ 0, 1, 2 ].map( ( r ) => mix(
		textureLoad( tex, ivec2( col.add( r ), keys.r0 ) ),
		textureLoad( tex, ivec2( col.add( r ), keys.r1 ) ), keys.t ) );

}

// Linear blend skinning from the baked texture: skinVertex() maths, with each bone
// matrix fetched + interpolated per vertex instead of read from a per-agent buffer.
// The cross-fade uses the same animBuf data as keyframe / skeletal (prevState,
// prevPhase, blend) but blends the matrices - i.e. the skinned positions, like VAT -
// not the joint angles. A fade between very different poses therefore moves a limb
// in a straight line instead of an arc for those 0.25 s: a hand dropping from a wave
// to walking passes up to ~0.5 m inside the arc that `skeletal` draws. Baking a
// quaternion + joint position per bone instead would blend rotations properly, for
// more ALU per vertex.
export function skinVertexBaked( tex, v, state, phase, prevState, prevPhase, blend ) {

	const skinIdx = attribute( 'skinIdx', 'vec2' );
	const colA = int( skinIdx.x ).mul( BONE_ROWS ), colB = int( skinIdx.y ).mul( BONE_ROWS );
	const cur = boneKeys( state, phase );
	const A = boneRows( tex, cur, colA ).map( ( r ) => r.toVar() );
	const B = boneRows( tex, cur, colB ).map( ( r ) => r.toVar() );

	// Most agents are not mid-fade (blend == 1), so the previous clip's 12 fetches sit
	// behind a branch they skip. The branch is per agent, so it rarely diverges.
	If( blend.lessThan( 1 ), () => {

		const prev = boneKeys( prevState, prevPhase );
		const pA = boneRows( tex, prev, colA ), pB = boneRows( tex, prev, colB );
		for ( let r = 0; r < BONE_ROWS; r ++ ) {

			A[ r ].assign( mix( pA[ r ], A[ r ], blend ) );
			B[ r ].assign( mix( pB[ r ], B[ r ], blend ) );

		}

	} );

	const h = vec4( v, 1 );
	const apply = ( M ) => vec3( dot( M[ 0 ], h ), dot( M[ 1 ], h ), dot( M[ 2 ], h ) );
	return mix( apply( B ), apply( A ), attribute( 'skinW', 'float' ) );

}

// ----------------------------------------------------------------------------
// Vertex Animation Texture baking (CPU, once per model tier).
// Width = vertex count, height = STATE_COUNT * KEYS_BAKED rows of RGBA32F positions.
// ----------------------------------------------------------------------------
export function bakeVAT( geometry ) {

	const pos = geometry.getAttribute( 'position' );
	const ja = geometry.getAttribute( 'jointA' );
	const jb = geometry.getAttribute( 'jointB' );
	const V = pos.count;
	const rows = STATE_COUNT * KEYS_BAKED;
	const data = new Float32Array( V * rows * 4 );
	const pose = new Float32Array( CHANNELS );
	for ( let s = 0; s < STATE_COUNT; s ++ ) {

		for ( let k = 0; k < KEYS_BAKED; k ++ ) {

			samplePose( s, ( k / KEYS_BAKED ) * TAU, pose );
			const row = s * KEYS_BAKED + k;
			for ( let i = 0; i < V; i ++ ) {

				const p = poseVertexJS(
					[ pos.getX( i ), pos.getY( i ), pos.getZ( i ) ], ja.getW( i ),
					[ ja.getX( i ), ja.getY( i ), ja.getZ( i ) ], [ jb.getX( i ), jb.getY( i ), jb.getZ( i ) ], pose );
				const o = ( row * V + i ) * 4;
				data[ o ] = p[ 0 ];
				data[ o + 1 ] = p[ 1 ];
				data[ o + 2 ] = p[ 2 ];
				data[ o + 3 ] = 1;

			}

		}

	}

	const tex = new THREE.DataTexture( data, V, rows, THREE.RGBAFormat, THREE.FloatType );
	tex.minFilter = tex.magFilter = THREE.NearestFilter;
	tex.generateMipmaps = false;
	tex.needsUpdate = true;
	tex.name = 'VAT_' + geometry.name;
	tex.userData.bytes = data.byteLength;
	return tex;

}

export function sampleVAT( tex, state, phase ) {

	const f = fract( phase.div( TAU ) ).mul( KEYS_BAKED );
	const k0 = floor( f );
	const t = f.sub( k0 );
	const k1 = k0.add( 1 ).mod( KEYS_BAKED );
	const col = int( vertexIndex );
	const r0 = int( state ).mul( KEYS_BAKED ).add( int( k0 ) );
	const r1 = int( state ).mul( KEYS_BAKED ).add( int( k1 ) );
	const a = textureLoad( tex, ivec2( col, r0 ) ).xyz;
	const b = textureLoad( tex, ivec2( col, r1 ) ).xyz;
	return mix( a, b, t );

}

// ----------------------------------------------------------------------------
// Procedural (sine) system - per-state amplitude table.
// A: legSwing, armSwing, kneeBend, elbowBend  B: raiseL, raiseR, raiseOsc, bob
// C: hop, torsoTwist, headYaw, lean           D: alternatingRaise, elbowOsc, -, -
// ----------------------------------------------------------------------------
const PROC = [
	/* idle    */[ [ 0.02, 0.04, 0.0, - 0.12 ], [ 0.07, 0.07, 0.0, 0.008 ], [ 0.0, 0.0, 0.8, 0.0 ], [ 0, 0, 0, 0 ] ],
	/* walk    */[ [ 0.45, 0.4, 0.6, - 0.25 ], [ 0.08, 0.08, 0.0, 0.035 ], [ 0.0, 0.06, 0.15, 0.04 ], [ 0, 0, 0, 0 ] ],
	/* run     */[ [ 0.85, 0.9, 1.3, - 1.4 ], [ 0.12, 0.12, 0.0, 0.07 ], [ 0.0, 0.12, 0.05, 0.2 ], [ 0, 0, 0, 0 ] ],
	/* wave    */[ [ 0.02, 0.0, 0.0, - 0.3 ], [ 0.08, 2.5, 0.35, 0.01 ], [ 0.0, 0.0, 0.2, 0.0 ], [ 0, 0, 0, 0 ] ],
	/* cheer   */[ [ 0.1, 0.0, 0.3, - 0.2 ], [ 2.7, 2.7, 0.25, 0.0 ], [ 0.22, 0.0, 0.1, 0.0 ], [ 0, 0, 0, 0 ] ],
	/* dance   */[ [ 0.3, 0.0, 0.4, - 0.6 ], [ 0.9, 0.9, 0.0, 0.05 ], [ 0.03, 0.45, 0.2, 0.0 ], [ 0.7, 0, 0, 0 ] ],
	/* talk    */[ [ 0.02, 0.0, 0.0, - 1.1 ], [ 0.15, 0.15, 0.0, 0.008 ], [ 0.0, 0.12, 0.4, 0.0 ], [ 0, 0.45, 0, 0 ] ],
	/* knocked */[ [ 0.3, 0.3, 0.5, - 0.6 ], [ 1.5, 1.5, 0.6, 0.03 ], [ 0.0, 0.3, 0.3, - 0.3 ], [ 0.4, 0.3, 0, 0 ] ]
];

export function makeProcTable() {

	return uniformArray( PROC.flat().map( ( r ) => new THREE.Vector4( ...r ) ), 'vec4' );

}

export function proceduralVertex( v, jointA, jointB, table, state, p, time, seed ) {

	const si = int( state ).mul( 4 );
	const A = table.element( si ), B = table.element( si.add( 1 ) ), C = table.element( si.add( 2 ) ), D = table.element( si.add( 3 ) );
	const part = jointA.w;
	const isLimb = step( 1.5, part );
	const isLower = step( 5.5, part );
	const qm = part.sub( 2 ).mod( 4 );
	const isArm = isLimb.mul( step( qm, 1.5 ) );
	const isLeg = isLimb.sub( isArm );
	const side = float( 1 ).sub( qm.mod( 2 ).mul( 2 ) );
	const isHead = float( 1 ).sub( step( 0.5, abs( part.sub( 1 ) ) ) );
	const upperBody = float( 1 ).sub( isLeg );
	const sp = sin( p ), cp = cos( p ), s2p = sin( p.mul( 2 ) );

	const legSwing = A.x.mul( sp ).mul( side );
	const armSwing = A.y.mul( sp ).mul( side ).negate();
	const knee = A.z.mul( max( cp.mul( side ).negate(), 0 ) );
	const elbow = A.w.add( D.y.mul( sin( p.add( side ) ) ) );
	const raiseBase = select( side.greaterThan( 0 ), B.x, B.y );
	const raise = side.mul( raiseBase.add( B.z.mul( step( 1.0, raiseBase ) ).mul( s2p ) ).add( D.x.mul( side ).mul( sp ) ) );
	const bob = B.w.mul( abs( cp ) ).add( C.x.mul( max( s2p, 0 ) ) );
	const twist = C.y.mul( sp );
	const headYaw = C.z.mul( sin( time.mul( 0.45 ).add( seed ) ) );

	const neck = vec3( ...PIVOTS.neck ), hip = vec3( ...PIVOTS.hip );
	let q = v;
	q = about( rotXcs, q, jointA.xyz, cs( isLower.mul( isArm.mul( elbow ).add( isLeg.mul( knee ) ) ) ) );
	q = about( rotXcs, q, jointB.xyz, cs( isArm.mul( armSwing ).add( isLeg.mul( legSwing ) ) ) );
	q = about( rotZcs, q, jointB.xyz, cs( isArm.mul( raise ) ) );
	q = about( rotYcs, q, neck, cs( headYaw.mul( isHead ) ) );
	q = about( rotXcs, q, hip, cs( C.w.mul( upperBody ) ) );
	q = about( rotYcs, q, hip, cs( twist.mul( upperBody ) ) );
	return q.add( vec3( 0, bob, 0 ) );

}

// Bytes of animation data the GPU has to hold for a system (for the HUD / docs).
export function animMemory( system, agents, models ) {

	if ( system === 'skeletal' ) return agents * BONES * BONE_ROWS * 16;
	if ( system === 'bat' ) return BAT_WIDTH * STATE_COUNT * KEYS_BAKED * 16; // one texture, any crowd size
	if ( system === 'vat' ) return models.reduce( ( s, m ) => s + m.vertices * STATE_COUNT * KEYS_BAKED * 16, 0 );
	if ( system === 'keyframe' ) return STATE_COUNT * KEYS_BAKED * 64;
	return 0;

}

export { Fn };
