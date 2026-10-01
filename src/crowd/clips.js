// Hand-keyed animation clips shared by the keyframe, skeletal, baked-bone and VAT systems.
//
// A pose is 16 joint channels (radians, except rootY in metres):
//   0 rootY      body bob / jump height
//   1 rootYaw    upper-body twist
//   2 spinePitch lean forward (+)
//   3 spineRoll  lean sideways (+ = toward the character's left)
//   4 headYaw    5 headPitch (+ = nod down)
//   6 lSwing  7 lRaise  8 lElbow      (swing + = arm back, raise + = outward/up,
//   9 rSwing 10 rRaise 11 rElbow       elbow - = forearm forward/up)
//  12 lHip   13 lKnee  14 rHip  15 rKnee  (hip + = leg back, knee + = bend)
//
// Each clip is a loop of 8 authored key poses. At load time the keys are resampled
// with a periodic Catmull-Rom spline into KEYS_BAKED evenly spaced keys, so the GPU
// only needs cheap linear interpolation between two neighbouring keys and still
// gets smooth, ease-in/ease-out motion.

export const CHANNELS = 16;
export const KEYS_BAKED = 32;
export const STATE_COUNT = 8; // idle, walk, run, wave, cheer, dance, talk, knocked

// Joint pivots (must match models.js)
export const PIVOTS = {
	hip: [ 0, 0.92, 0 ], neck: [ 0, 1.5, 0 ],
	lShoulder: [ 0.22, 1.43, 0 ], rShoulder: [ - 0.22, 1.43, 0 ],
	lElbow: [ 0.25, 1.16, - 0.01 ], rElbow: [ - 0.25, 1.16, - 0.01 ],
	lHip: [ 0.1, 0.92, 0 ], rHip: [ - 0.1, 0.92, 0 ],
	lKnee: [ 0.11, 0.5, 0.01 ], rKnee: [ - 0.11, 0.5, 0.01 ]
};

const NAMES = [ 'rootY', 'rootYaw', 'spinePitch', 'spineRoll', 'headYaw', 'headPitch',
	'lSwing', 'lRaise', 'lElbow', 'rSwing', 'rRaise', 'rElbow', 'lHip', 'lKnee', 'rHip', 'rKnee' ];

const REST = { lRaise: 0.07, rRaise: 0.07, lElbow: - 0.12, rElbow: - 0.12 };

function P( o ) {

	const a = new Float32Array( CHANNELS );
	const src = { ...REST, ...o };
	NAMES.forEach( ( n, i ) => {

		a[ i ] = src[ n ] || 0;

	} );
	return a;

}

// Mirror a pose left <-> right (for the second half of symmetric cycles).
function M( pose ) {

	const o = {};
	NAMES.forEach( ( n, i ) => {

		o[ n ] = pose[ i ];

	} );
	const m = { ...o };
	for ( const [ l, r ] of [ [ 'lSwing', 'rSwing' ], [ 'lRaise', 'rRaise' ], [ 'lElbow', 'rElbow' ], [ 'lHip', 'rHip' ], [ 'lKnee', 'rKnee' ] ] ) {

		m[ l ] = o[ r ];
		m[ r ] = o[ l ];

	}

	m.rootYaw = - o.rootYaw;
	m.spineRoll = - o.spineRoll;
	m.headYaw = - o.headYaw;
	return P( m );

}

// --- walk: contact, down, passing, up (then mirrored) ----------------------
const walkContact = P( { rootY: - 0.015, rootYaw: 0.1, spinePitch: 0.05, headPitch: 0.04, lHip: - 0.42, lKnee: 0.05, rHip: 0.36, rKnee: 0.12, lSwing: 0.32, rSwing: - 0.34, lElbow: - 0.15, rElbow: - 0.35 } );
const walkDown = P( { rootY: - 0.035, rootYaw: 0.06, spinePitch: 0.06, headPitch: 0.05, lHip: - 0.25, lKnee: 0.22, rHip: 0.24, rKnee: 0.55, lSwing: 0.2, rSwing: - 0.2, lElbow: - 0.15, rElbow: - 0.28 } );
const walkPass = P( { rootY: 0.01, rootYaw: 0.0, spinePitch: 0.05, headPitch: 0.04, lHip: 0.02, lKnee: 0.05, rHip: - 0.12, rKnee: 0.85, lSwing: 0.0, rSwing: 0.0, lElbow: - 0.2, rElbow: - 0.2 } );
const walkUp = P( { rootY: 0.03, rootYaw: - 0.05, spinePitch: 0.04, headPitch: 0.03, lHip: 0.24, lKnee: 0.04, rHip: - 0.36, rKnee: 0.32, lSwing: - 0.2, rSwing: 0.2, lElbow: - 0.28, rElbow: - 0.15 } );

// --- run -------------------------------------------------------------------
const runContact = P( { rootY: - 0.03, rootYaw: 0.18, spinePitch: 0.22, headPitch: - 0.08, lHip: - 0.7, lKnee: 0.25, rHip: 0.6, rKnee: 0.6, lSwing: 0.75, rSwing: - 0.8, lElbow: - 1.3, rElbow: - 1.6, lRaise: 0.15, rRaise: 0.15 } );
const runDown = P( { rootY: - 0.06, rootYaw: 0.1, spinePitch: 0.25, headPitch: - 0.08, lHip: - 0.35, lKnee: 0.55, rHip: 0.55, rKnee: 1.2, lSwing: 0.45, rSwing: - 0.45, lElbow: - 1.4, rElbow: - 1.5, lRaise: 0.15, rRaise: 0.15 } );
const runPush = P( { rootY: 0.04, rootYaw: - 0.05, spinePitch: 0.24, headPitch: - 0.08, lHip: 0.35, lKnee: 0.15, rHip: - 0.4, rKnee: 1.45, lSwing: - 0.3, rSwing: 0.35, lElbow: - 1.5, rElbow: - 1.35, lRaise: 0.15, rRaise: 0.15 } );
const runFlight = P( { rootY: 0.09, rootYaw: - 0.15, spinePitch: 0.2, headPitch: - 0.08, lHip: 0.55, lKnee: 0.7, rHip: - 0.75, rKnee: 0.9, lSwing: - 0.7, rSwing: 0.7, lElbow: - 1.6, rElbow: - 1.3, lRaise: 0.15, rRaise: 0.15 } );

const CLIP_KEYS = [
	// 0 idle: breathing, weight shift, looking around
	[
		P( { rootY: 0.0, headYaw: 0.0, spineRoll: 0.02, lHip: - 0.02, rHip: 0.03 } ),
		P( { rootY: 0.008, headYaw: 0.25, spineRoll: 0.03, headPitch: - 0.05 } ),
		P( { rootY: 0.0, headYaw: 0.55, spineRoll: 0.03, headPitch: - 0.02, rElbow: - 0.3, rSwing: - 0.1 } ),
		P( { rootY: 0.006, headYaw: 0.5, spineRoll: 0.0, headPitch: 0.05 } ),
		P( { rootY: 0.0, headYaw: 0.0, spineRoll: - 0.03, lHip: 0.03, rHip: - 0.02 } ),
		P( { rootY: 0.008, headYaw: - 0.4, spineRoll: - 0.03, headPitch: - 0.06 } ),
		P( { rootY: 0.0, headYaw: - 0.45, spineRoll: - 0.02, lElbow: - 0.35, lSwing: - 0.1 } ),
		P( { rootY: 0.006, headYaw: - 0.1, spineRoll: 0.0, headPitch: 0.04 } )
	],
	// 1 walk
	[ walkContact, walkDown, walkPass, walkUp, M( walkContact ), M( walkDown ), M( walkPass ), M( walkUp ) ],
	// 2 run
	[ runContact, runDown, runPush, runFlight, M( runContact ), M( runDown ), M( runPush ), M( runFlight ) ],
	// 3 wave: right arm up, forearm waving side to side
	[
		P( { rRaise: 2.45, rElbow: - 0.35, rSwing: - 0.1, spineRoll: - 0.05, headYaw: - 0.1, headPitch: - 0.08 } ),
		P( { rRaise: 2.8, rElbow: - 0.75, rSwing: - 0.12, spineRoll: - 0.06, headYaw: - 0.1, headPitch: - 0.08 } ),
		P( { rRaise: 2.45, rElbow: - 0.35, rSwing: - 0.1, spineRoll: - 0.05, headYaw: - 0.08, headPitch: - 0.08 } ),
		P( { rRaise: 2.15, rElbow: - 0.2, rSwing: - 0.08, spineRoll: - 0.04, headYaw: - 0.08, headPitch: - 0.08 } ),
		P( { rRaise: 2.45, rElbow: - 0.35, rSwing: - 0.1, spineRoll: - 0.05, headYaw: - 0.1, headPitch: - 0.1 } ),
		P( { rRaise: 2.8, rElbow: - 0.75, rSwing: - 0.12, spineRoll: - 0.06, headYaw: - 0.12, headPitch: - 0.1 } ),
		P( { rRaise: 2.45, rElbow: - 0.35, rSwing: - 0.1, spineRoll: - 0.05, headYaw: - 0.1, headPitch: - 0.08 } ),
		P( { rRaise: 2.15, rElbow: - 0.2, rSwing: - 0.08, spineRoll: - 0.04, headYaw: - 0.08, headPitch: - 0.08 } )
	],
	// 4 cheer: two jumps per loop, arms pumping overhead
	[
		P( { rootY: - 0.12, spinePitch: 0.18, lHip: - 0.35, rHip: - 0.35, lKnee: 0.75, rKnee: 0.75, lRaise: 2.0, rRaise: 2.0, lElbow: - 0.9, rElbow: - 0.9, headPitch: 0.1 } ),
		P( { rootY: 0.16, spinePitch: - 0.05, lHip: - 0.05, rHip: - 0.05, lKnee: 0.1, rKnee: 0.1, lRaise: 2.85, rRaise: 2.85, lElbow: - 0.15, rElbow: - 0.15, headPitch: - 0.25 } ),
		P( { rootY: 0.3, spinePitch: - 0.08, lHip: - 0.2, rHip: - 0.2, lKnee: 0.45, rKnee: 0.45, lRaise: 2.95, rRaise: 2.95, lElbow: - 0.1, rElbow: - 0.1, headPitch: - 0.3 } ),
		P( { rootY: 0.02, spinePitch: 0.05, lHip: - 0.15, rHip: - 0.15, lKnee: 0.3, rKnee: 0.3, lRaise: 2.6, rRaise: 2.6, lElbow: - 0.4, rElbow: - 0.4, headPitch: - 0.1 } ),
		P( { rootY: - 0.12, spinePitch: 0.18, lHip: - 0.35, rHip: - 0.35, lKnee: 0.75, rKnee: 0.75, lRaise: 2.0, rRaise: 2.0, lElbow: - 0.9, rElbow: - 0.9, headPitch: 0.1 } ),
		P( { rootY: 0.16, spinePitch: - 0.05, lHip: - 0.05, rHip: - 0.05, lKnee: 0.1, rKnee: 0.1, lRaise: 2.85, rRaise: 2.85, lElbow: - 0.15, rElbow: - 0.15, headPitch: - 0.25 } ),
		P( { rootY: 0.3, spinePitch: - 0.08, lHip: - 0.2, rHip: - 0.2, lKnee: 0.45, rKnee: 0.45, lRaise: 2.95, rRaise: 2.95, lElbow: - 0.1, rElbow: - 0.1, headPitch: - 0.3 } ),
		P( { rootY: 0.02, spinePitch: 0.05, lHip: - 0.15, rHip: - 0.15, lKnee: 0.3, rKnee: 0.3, lRaise: 2.6, rRaise: 2.6, lElbow: - 0.4, rElbow: - 0.4, headPitch: - 0.1 } )
	],
	// 5 dance: disco point left / right with hip sway and knee bounce
	[
		P( { rootY: - 0.05, rootYaw: 0.35, spineRoll: 0.12, lRaise: 2.5, lElbow: - 0.1, rRaise: 0.35, rElbow: - 1.3, rSwing: - 0.3, lKnee: 0.35, rKnee: 0.1, lHip: - 0.2, headYaw: 0.3, headPitch: - 0.1 } ),
		P( { rootY: 0.0, rootYaw: 0.2, spineRoll: 0.06, lRaise: 1.6, lElbow: - 0.6, rRaise: 0.3, rElbow: - 1.2, lKnee: 0.15, rKnee: 0.15, headYaw: 0.15 } ),
		P( { rootY: - 0.06, rootYaw: 0.0, spineRoll: 0.0, lRaise: 0.9, lElbow: - 1.4, rRaise: 0.9, rElbow: - 1.4, lSwing: - 0.4, rSwing: - 0.4, lKnee: 0.4, rKnee: 0.4, lHip: - 0.2, rHip: - 0.2, headPitch: 0.1 } ),
		P( { rootY: 0.0, rootYaw: - 0.2, spineRoll: - 0.06, rRaise: 1.6, rElbow: - 0.6, lRaise: 0.3, lElbow: - 1.2, lKnee: 0.15, rKnee: 0.15, headYaw: - 0.15 } ),
		P( { rootY: - 0.05, rootYaw: - 0.35, spineRoll: - 0.12, rRaise: 2.5, rElbow: - 0.1, lRaise: 0.35, lElbow: - 1.3, lSwing: - 0.3, rKnee: 0.35, lKnee: 0.1, rHip: - 0.2, headYaw: - 0.3, headPitch: - 0.1 } ),
		P( { rootY: 0.0, rootYaw: - 0.2, spineRoll: - 0.06, rRaise: 1.6, rElbow: - 0.6, lRaise: 0.3, lElbow: - 1.2, lKnee: 0.15, rKnee: 0.15, headYaw: - 0.15 } ),
		P( { rootY: - 0.06, rootYaw: 0.0, spineRoll: 0.0, lRaise: 0.9, lElbow: - 1.4, rRaise: 0.9, rElbow: - 1.4, lSwing: - 0.4, rSwing: - 0.4, lKnee: 0.4, rKnee: 0.4, lHip: - 0.2, rHip: - 0.2, headPitch: 0.1 } ),
		P( { rootY: 0.0, rootYaw: 0.2, spineRoll: 0.06, lRaise: 1.6, lElbow: - 0.6, rRaise: 0.3, rElbow: - 1.2, lKnee: 0.15, rKnee: 0.15, headYaw: 0.15 } )
	],
	// 6 talk: hand gestures, head nods
	[
		P( { lElbow: - 1.3, rElbow: - 1.0, lSwing: - 0.25, rSwing: - 0.1, lRaise: 0.25, rRaise: 0.15, headPitch: 0.05, headYaw: 0.1, rootYaw: 0.05 } ),
		P( { lElbow: - 1.55, rElbow: - 1.0, lSwing: - 0.4, rSwing: - 0.1, lRaise: 0.4, rRaise: 0.15, headPitch: - 0.05, headYaw: 0.15, rootYaw: 0.08 } ),
		P( { lElbow: - 1.2, rElbow: - 1.1, lSwing: - 0.2, rSwing: - 0.15, lRaise: 0.2, rRaise: 0.2, headPitch: 0.08, headYaw: 0.05, rootYaw: 0.02 } ),
		P( { lElbow: - 1.0, rElbow: - 1.4, lSwing: - 0.1, rSwing: - 0.35, lRaise: 0.15, rRaise: 0.35, headPitch: - 0.04, headYaw: - 0.1, rootYaw: - 0.04 } ),
		P( { lElbow: - 1.0, rElbow: - 1.55, lSwing: - 0.1, rSwing: - 0.45, lRaise: 0.15, rRaise: 0.45, headPitch: 0.06, headYaw: - 0.15, rootYaw: - 0.08 } ),
		P( { lElbow: - 1.1, rElbow: - 1.2, lSwing: - 0.15, rSwing: - 0.2, lRaise: 0.2, rRaise: 0.2, headPitch: - 0.02, headYaw: - 0.05, rootYaw: - 0.02 } ),
		P( { lElbow: - 1.35, rElbow: - 1.0, lSwing: - 0.3, rSwing: - 0.1, lRaise: 0.3, rRaise: 0.15, headPitch: 0.1, headYaw: 0.05, rootYaw: 0.03 } ),
		P( { lElbow: - 1.2, rElbow: - 1.05, lSwing: - 0.2, rSwing: - 0.1, lRaise: 0.2, rRaise: 0.15, headPitch: 0.0, headYaw: 0.08, rootYaw: 0.04 } )
	],
	// 7 knocked: hit by something - stagger backwards, arms flailing
	[
		P( { rootY: - 0.1, spinePitch: - 0.35, spineRoll: 0.15, rootYaw: 0.3, lRaise: 1.6, rRaise: 1.1, lElbow: - 0.4, rElbow: - 0.9, lSwing: - 0.6, rSwing: 0.4, lHip: - 0.4, lKnee: 0.6, rHip: 0.3, rKnee: 0.3, headPitch: - 0.35 } ),
		P( { rootY: - 0.14, spinePitch: - 0.45, spineRoll: - 0.1, rootYaw: - 0.2, lRaise: 1.0, rRaise: 1.8, lElbow: - 1.0, rElbow: - 0.3, lSwing: 0.4, rSwing: - 0.7, lHip: 0.3, lKnee: 0.4, rHip: - 0.45, rKnee: 0.7, headPitch: - 0.4 } ),
		P( { rootY: - 0.08, spinePitch: - 0.3, spineRoll: 0.12, rootYaw: 0.25, lRaise: 1.9, rRaise: 1.2, lElbow: - 0.3, rElbow: - 1.1, lSwing: - 0.5, rSwing: 0.5, lHip: - 0.3, lKnee: 0.5, rHip: 0.2, rKnee: 0.4, headPitch: - 0.3 } ),
		P( { rootY: - 0.15, spinePitch: - 0.5, spineRoll: - 0.15, rootYaw: - 0.3, lRaise: 1.2, rRaise: 2.0, lElbow: - 0.8, rElbow: - 0.2, lSwing: 0.5, rSwing: - 0.5, lHip: 0.35, lKnee: 0.5, rHip: - 0.35, rKnee: 0.6, headPitch: - 0.45 } ),
		P( { rootY: - 0.1, spinePitch: - 0.35, spineRoll: 0.15, rootYaw: 0.3, lRaise: 1.6, rRaise: 1.1, lElbow: - 0.4, rElbow: - 0.9, lSwing: - 0.6, rSwing: 0.4, lHip: - 0.4, lKnee: 0.6, rHip: 0.3, rKnee: 0.3, headPitch: - 0.35 } ),
		P( { rootY: - 0.14, spinePitch: - 0.45, spineRoll: - 0.1, rootYaw: - 0.2, lRaise: 1.0, rRaise: 1.8, lElbow: - 1.0, rElbow: - 0.3, lSwing: 0.4, rSwing: - 0.7, lHip: 0.3, lKnee: 0.4, rHip: - 0.45, rKnee: 0.7, headPitch: - 0.4 } ),
		P( { rootY: - 0.08, spinePitch: - 0.3, spineRoll: 0.12, rootYaw: 0.25, lRaise: 1.9, rRaise: 1.2, lElbow: - 0.3, rElbow: - 1.1, lSwing: - 0.5, rSwing: 0.5, lHip: - 0.3, lKnee: 0.5, rHip: 0.2, rKnee: 0.4, headPitch: - 0.3 } ),
		P( { rootY: - 0.15, spinePitch: - 0.5, spineRoll: - 0.15, rootYaw: - 0.3, lRaise: 1.2, rRaise: 2.0, lElbow: - 0.8, rElbow: - 0.2, lSwing: 0.5, rSwing: - 0.5, lHip: 0.35, lKnee: 0.5, rHip: - 0.35, rKnee: 0.6, headPitch: - 0.45 } )
	]
];

// Periodic Catmull-Rom resample: 8 authored keys -> KEYS_BAKED smooth keys.
function resample( keys ) {

	const n = keys.length;
	const out = [];
	for ( let k = 0; k < KEYS_BAKED; k ++ ) {

		const f = ( k / KEYS_BAKED ) * n;
		const i1 = Math.floor( f ) % n;
		const t = f - Math.floor( f );
		const i0 = ( i1 + n - 1 ) % n, i2 = ( i1 + 1 ) % n, i3 = ( i1 + 2 ) % n;
		const pose = new Float32Array( CHANNELS );
		for ( let c = 0; c < CHANNELS; c ++ ) {

			const p0 = keys[ i0 ][ c ], p1 = keys[ i1 ][ c ], p2 = keys[ i2 ][ c ], p3 = keys[ i3 ][ c ];
			const t2 = t * t, t3 = t2 * t;
			pose[ c ] = 0.5 * ( ( 2 * p1 ) + ( - p0 + p2 ) * t + ( 2 * p0 - 5 * p1 + 4 * p2 - p3 ) * t2 + ( - p0 + 3 * p1 - 3 * p2 + p3 ) * t3 );

		}

		out.push( pose );

	}

	return out;

}

export const BAKED = CLIP_KEYS.map( resample );

// Flat table for the GPU: [state][key][4 x vec4]
export function clipTable() {

	const flat = [];
	for ( let s = 0; s < STATE_COUNT; s ++ ) {

		for ( let k = 0; k < KEYS_BAKED; k ++ ) {

			const p = BAKED[ s ][ k ];
			for ( let v = 0; v < 4; v ++ ) flat.push( [ p[ v * 4 ], p[ v * 4 + 1 ], p[ v * 4 + 2 ], p[ v * 4 + 3 ] ] );

		}

	}

	return flat;

}

// Phase speed (rad/s) per state, used for stationary clips and for the outgoing
// clip during a cross-fade. Walk/run normally derive it from the agent's speed.
export const CLIP_RATE = [ 1.1, 6.5, 11.0, 4.5, 5.0, 4.2, 2.4, 9.0 ];

// --- CPU reference implementation (used to bake the VAT and bone textures) --
export function samplePose( state, phase, out = new Float32Array( CHANNELS ) ) {

	const f = ( ( ( phase / ( Math.PI * 2 ) ) % 1 ) + 1 ) % 1 * KEYS_BAKED;
	const k0 = Math.floor( f ) % KEYS_BAKED, k1 = ( k0 + 1 ) % KEYS_BAKED, t = f - Math.floor( f );
	const a = BAKED[ state ][ k0 ], b = BAKED[ state ][ k1 ];
	for ( let c = 0; c < CHANNELS; c ++ ) out[ c ] = a[ c ] + ( b[ c ] - a[ c ] ) * t;
	return out;

}

function rotXAbout( p, c, a ) {

	const y = p[ 1 ] - c[ 1 ], z = p[ 2 ] - c[ 2 ], cs = Math.cos( a ), sn = Math.sin( a );
	p[ 1 ] = c[ 1 ] + y * cs - z * sn;
	p[ 2 ] = c[ 2 ] + y * sn + z * cs;

}

function rotYAbout( p, c, a ) {

	const x = p[ 0 ] - c[ 0 ], z = p[ 2 ] - c[ 2 ], cs = Math.cos( a ), sn = Math.sin( a );
	p[ 0 ] = c[ 0 ] + x * cs + z * sn;
	p[ 2 ] = c[ 2 ] + z * cs - x * sn;

}

function rotZAbout( p, c, a ) {

	const x = p[ 0 ] - c[ 0 ], y = p[ 1 ] - c[ 1 ], cs = Math.cos( a ), sn = Math.sin( a );
	p[ 0 ] = c[ 0 ] + x * cs - y * sn;
	p[ 1 ] = c[ 1 ] + x * sn + y * cs;

}

// Apply a pose to one rest-pose vertex of body part `part` (see models.js PART).
// Mirrors poseVertexDynamic() in anim.js exactly.
export function poseVertexJS( v, part, jointA, jointB, pose ) {

	const p = [ v[ 0 ], v[ 1 ], v[ 2 ] ];
	const isLimb = part >= 2;
	const isLower = part >= 6;
	const q = isLimb ? ( part - 2 ) % 4 : - 1;
	const isArm = isLimb && q <= 1;
	const isLeg = isLimb && ! isArm;
	const left = q % 2 === 0;
	const side = left ? 1 : - 1;
	if ( isLower ) {

		const bend = isArm ? pose[ left ? 8 : 11 ] : pose[ left ? 13 : 15 ];
		rotXAbout( p, jointA, bend );

	}

	if ( isLimb ) {

		const swing = isArm ? pose[ left ? 6 : 9 ] : pose[ left ? 12 : 14 ];
		rotXAbout( p, jointB, swing );
		if ( isArm ) rotZAbout( p, jointB, side * pose[ left ? 7 : 10 ] );

	}

	if ( part === 1 ) {

		rotXAbout( p, PIVOTS.neck, pose[ 5 ] );
		rotYAbout( p, PIVOTS.neck, pose[ 4 ] );

	}

	if ( ! isLeg ) {

		rotXAbout( p, PIVOTS.hip, pose[ 2 ] );
		rotZAbout( p, PIVOTS.hip, pose[ 3 ] );
		rotYAbout( p, PIVOTS.hip, pose[ 1 ] );

	}

	p[ 1 ] += pose[ 0 ];
	return p;

}
