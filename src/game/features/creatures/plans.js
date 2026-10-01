// Body plans: the skeleton topology of a creature ( define( 'bodyPlan', def ) ).
// A plan turns a genome's skeleton params into bones, IK legs and ANCHORS - the
// places where body parts ( parts.js ) attach: torso segments, head, arms, legs,
// back line, tail root, shoulders (wings). Parts never hard-code a plan; they dress
// whatever anchors exist, which is why any head works on any body.
//
//   define( 'bodyPlan', {
//     id, name, tags, weight,
//     params:  { key: [ min, max ] }            skeleton params the genome rolls (genome.body)
//     slots:   { slot: chance }                  which part slots it offers, and how often filled
//     defaults:{ slot: partId }                  dressing used when a slot is empty but required
//     gait:    { styles: [...], duty, lift, bounce, cadence, hover? }
//     styles:  [ attack styles ]                 base attackStyles (parts add more)
//     speed, density                             genomeMetrics multipliers
//     build( K )                                 make bones + anchors on K.B (a RigBuilder)
//   } )
//
// K (the build context) carries: B (RigBuilder), g (genome), b (g.body params),
// rng (deterministic per genome), and the anchor lists the plan fills:
//   K.torso  [ { bone, c: [x,y,z], s: [w,h,l] } ]  body segments, axis-aligned in bone space
//   K.neck   [ { bone, a, b, t } ]                  neck segments (drawn by the plan)
//   K.head   { bone, c, s, upright }                 head centre (bone space) and base size
//   K.arms   [ { upper, fore, hand, side, a, b, t } ]
//   K.legs   [ { thigh, shin, foot, a, b, t, side, front, ankle, footLen } ]
//   K.back   [ { bone, pos, w } ]                   points along the top line
//   K.tail   { bone, pos, len, t, dir }              where a tail grows (tail parts add the bones)
//   K.wings  { bone, pos, w }                        shoulder point for wings
//   K.belly  [ { bone, pos } ]                       underside points (sacs, tentacles)

import { define } from '../../core/registry.js';

// --- shared helpers ------------------------------------------------------------------

// One IK leg: thigh at `hip` (parent space), foot resting at `foot` (root space).
export function addLeg( K, parent, name, hip, foot, a, b, opts = {} ) {

	const B = K.B;
	const th = B.bone( name + 'Thigh', parent, hip );
	const sh = B.bone( name + 'Shin', th, [ 0, - a, 0 ] );
	const ft = B.bone( name + 'Foot', sh, [ 0, - b, 0 ] );
	const leg = {
		thigh: th, shin: sh, foot: ft, rest: foot, a, b,
		pole: opts.pole || [ 0, 0, 1 ], phase: opts.phase ?? 0, side: opts.side ?? 1,
		lift: opts.lift ?? 0.22, ankle: opts.ankle ?? 0.06, front: !! opts.front, tuck: opts.tuck || null
	};
	B.leg( leg );
	K.legs.push( { thigh: th, shin: sh, foot: ft, a, b, t: opts.t ?? 0.1, side: leg.side, front: leg.front, ankle: leg.ankle, footLen: opts.footLen ?? 0.18, name, pole: leg.pole } );
	return K.legs[ K.legs.length - 1 ];

}

// FK arm (shoulder -> elbow -> hand), hanging down along -Y.
export function addArm( K, parent, S, pos, a, b, t, opts = {} ) {

	const B = K.B, side = S === 'L' ? 1 : - 1;
	const pre = opts.prefix || '';
	const up = B.bone( pre + 'upperArm' + S, parent, pos, { role: opts.roles === false ? null : 'upperArm' + S, rot: [ opts.pitch ?? 0, 0, side * ( opts.splay ?? 0.14 ) ] } );
	const fo = B.bone( pre + 'foreArm' + S, up, [ 0, - a, 0 ], { role: opts.roles === false ? null : 'foreArm' + S, rot: [ opts.bend ?? - 0.3, 0, 0 ] } );
	const ha = B.bone( pre + 'hand' + S, fo, [ 0, - b, 0 ], { role: opts.roles === false ? null : 'hand' + S } );
	const arm = { upper: up, fore: fo, hand: ha, side, a, b, t, S };
	K.arms.push( arm );
	return arm;

}

// Draw a simple chain of segment bones (necks): bones[i] -> bones[i+1].
function neckParts( K, bones, t0, t1 ) {

	const B = K.B;
	for ( let i = 0; i < bones.length; i ++ ) {

		const b = B.bones[ bones[ i ] ];
		const next = B.bones.find( ( c ) => c.parent === bones[ i ] && ( i + 1 < bones.length ? c === B.bones[ bones[ i + 1 ] ] : true ) );
		if ( ! next ) continue;
		const t = t0 + ( t1 - t0 ) * ( i / Math.max( 1, bones.length - 1 ) );
		K.neck.push( { bone: bones[ i ], a: [ 0, 0, 0 ], b: next.pos, t } );
		void b;

	}

}

const lerp = ( a, b, t ) => a + ( b - a ) * t;

// --- biped ---------------------------------------------------------------------------
// Upright two-legged body with arms: brutes, imps, golems, lizardfolk, cultists.
// Shares role names with the humanoid hero rig, so every humanoid action pose
// (slash, cast, slam...) also works on biped monsters.
define( 'bodyPlan', { id: 'biped', name: 'Biped', tags: [ 'humanoid', 'legged' ], weight: 1.3,
	params: { length: [ 0.8, 1.25 ], girth: [ 0.75, 1.5 ], legLen: [ 0.7, 1.25 ], legThick: [ 0.7, 1.4 ], armLen: [ 0.8, 1.5 ], armThick: [ 0.7, 1.5 ], neckLen: [ 0, 0.8 ], headSize: [ 0.8, 1.4 ], tailLen: [ 0, 1.2 ], hunch: [ 0, 0.8 ], taper: [ - 0.3, 0.5 ], limbs: [ 1, 1.6 ] },
	slots: { torso: 1, legs: 1, arms: 1, head: 1, eyes: 1, horns: 0.45, back: 0.35, tail: 0.35, wings: 0.12, extra: 0.4 },
	defaults: { torso: 'muscled', legs: 'plain', arms: 'claws', head: 'brute', eyes: 'pair' },
	gait: { styles: [ 'biped' ], duty: 0.58, lift: 0.18, bounce: 0.05, cadence: 1.05 },
	styles: [ 'claw', 'slam' ], speed: 1, density: 1,
	build( K ) {

		const { B, b, g } = K;
		const L = b.legLen, G = b.girth, Ln = b.length;
		const digi = !! g.gait.digi;
		const a = 0.43 * L, bb = 0.43 * L, ankle = 0.07;
		const hipY = ( a + bb ) * ( digi ? 0.86 : 0.95 ) + ankle;
		const pw = 0.14 * G * ( 1 - b.taper * 0.4 ), cw = 0.2 * G * ( 1 + b.taper * 0.6 );
		const pelvis = B.bone( 'pelvis', 'root', [ 0, hipY, 0 ], { role: 'pelvis' } );
		B.role( 'body', pelvis );
		const spine = B.bone( 'spine', pelvis, [ 0, 0.14 * Ln, 0 ], { role: 'spine' } );
		const chest = B.bone( 'chest', spine, [ 0, 0.16 * Ln, 0 ], { role: 'chest', rot: [ b.hunch * 0.45, 0, 0 ] } );
		K.torso.push(
			{ bone: pelvis, c: [ 0, 0.03, 0 ], s: [ pw * 2.1, 0.2 * Ln, 0.24 * G ] },
			{ bone: spine, c: [ 0, 0.07 * Ln, 0.005 ], s: [ ( pw + cw ) * 0.95, 0.2 * Ln, 0.23 * G ] },
			{ bone: chest, c: [ 0, 0.15 * Ln, 0.01 ], s: [ cw * 2, 0.32 * Ln, 0.3 * G ] } );
		const neck = B.bone( 'neck', chest, [ 0, 0.31 * Ln, 0.02 ], { role: 'neck', rot: [ - b.hunch * 0.25, 0, 0 ] } );
		const nl = 0.05 + 0.13 * b.neckLen;
		const head = B.bone( 'head', neck, [ 0, nl, 0.01 ], { role: 'head', rot: [ - b.hunch * 0.2, 0, 0 ] } );
		K.neck.push( { bone: neck, a: [ 0, - 0.03, 0 ], b: [ 0, nl + 0.02, 0 ], t: 0.1 * G * 0.9 } );
		const hs = 0.23 * b.headSize;
		K.head = { bone: head, c: [ 0, hs * 0.5, hs * 0.08 ], s: hs, upright: true };
		const ua = 0.31 * b.armLen, fa = 0.29 * b.armLen, at = 0.085 * b.armThick;
		B.pair( ( side, S ) => {

			addArm( K, chest, S, [ side * ( cw + 0.035 ), 0.27 * Ln, 0 ], ua, fa, at );

		} );
		if ( b.limbs >= 1.48 ) {

			// a second, smaller pair of arms lower on the torso
			B.pair( ( side, S ) => addArm( K, spine, S, [ side * ( ( pw + cw ) * 0.5 + 0.03 ), 0.14 * Ln, 0.04 ], ua * 0.8, fa * 0.8, at * 0.8, { prefix: 'low', roles: false, splay: 0.4, bend: - 0.9 } ) );

		}

		const lt = 0.1 * b.legThick;
		B.pair( ( side, S ) => addLeg( K, pelvis, 'leg' + S, [ side * pw * 0.72, - 0.02, 0 ], [ side * ( pw * 0.72 + 0.03 ), ankle, digi ? - 0.04 : 0.02 ], a, bb,
			{ side, phase: side > 0 ? 0 : 0.5, pole: digi ? [ 0, 0, - 1 ] : [ 0, 0, 1 ], ankle, t: lt, footLen: digi ? 0.24 : 0.2, lift: 0.18 * L } ) );
		K.back.push( { bone: chest, pos: [ 0, 0.25 * Ln, - 0.15 * G ], w: cw }, { bone: chest, pos: [ 0, 0.1 * Ln, - 0.15 * G ], w: cw * 0.9 }, { bone: spine, pos: [ 0, 0.08, - 0.12 * G ], w: pw } );
		K.wings = { bone: chest, pos: [ 0, 0.24 * Ln, - 0.14 * G ], w: cw };
		K.tail = { bone: pelvis, pos: [ 0, - 0.02, - 0.11 * G ], len: 0.9 * b.tailLen, t: 0.09 * G, dir: - 0.9 };
		K.belly.push( { bone: spine, pos: [ 0, 0.06, 0.12 * G ] } );
		B.point( 'chest', chest, [ 0, 0.15 * Ln, 0.15 * G ] );

	}
} );

// --- quadruped -----------------------------------------------------------------------
// Four legs under a horizontal spine: wolves, boars, lizards, beetle-hounds, behemoths.
define( 'bodyPlan', { id: 'quadruped', name: 'Quadruped', tags: [ 'beast', 'legged' ], weight: 1.3,
	params: { length: [ 0.75, 1.4 ], girth: [ 0.75, 1.5 ], legLen: [ 0.6, 1.35 ], legThick: [ 0.7, 1.5 ], neckLen: [ 0.1, 1.2 ], headSize: [ 0.8, 1.4 ], tailLen: [ 0, 1.4 ], spineSegs: [ 1, 3 ], taper: [ - 0.3, 0.5 ], hunch: [ 0, 0.5 ] },
	slots: { torso: 1, legs: 1, head: 1, eyes: 1, horns: 0.5, back: 0.5, tail: 0.75, wings: 0.08, extra: 0.4 },
	defaults: { torso: 'muscled', legs: 'plain', head: 'snout', eyes: 'pair' },
	gait: { styles: [ 'trot', 'walk', 'pace', 'bound' ], duty: 0.55, lift: 0.16, bounce: 0.04, cadence: 1.2 },
	styles: [ 'bite', 'charge' ], speed: 1.22, density: 1.1,
	build( K ) {

		const { B, b } = K;
		const L = b.legLen, G = b.girth;
		const bl = 0.95 * b.length, half = bl / 2;
		const a = 0.31 * L, bb = 0.33 * L, ankle = 0.06;
		const hipY = ( a + bb ) * 0.92 + ankle;
		const th = 0.34 * G, w = 0.3 * G;
		const n = Math.round( b.spineSegs );
		const pelvis = B.bone( 'pelvis', 'root', [ 0, hipY + 0.05, - half * 0.82 ], { role: 'pelvis' } );
		B.role( 'body', pelvis );
		const spine = [ pelvis ];
		for ( let i = 0; i < n; i ++ ) spine.push( B.bone( i === n - 1 ? 'chest' : 'spine' + i, spine[ i ], [ 0, 0, bl * 0.82 / n ], { role: i === n - 1 ? 'chest' : null } ) );
		B.roles.spine = spine.slice( 1, - 1 ).length ? spine.slice( 1, - 1 ) : [ spine[ spine.length - 1 ] ];
		const chest = spine[ spine.length - 1 ];
		const seg = bl * 0.82 / n;
		for ( let i = 0; i <= n; i ++ ) {

			const f = i / n; // 0 rear .. 1 front
			const k = 1 + b.taper * ( f - 0.5 ) * 0.8;
			K.torso.push( { bone: spine[ i ], c: [ 0, 0.01 * i, i === 0 ? - 0.04 : i === n ? 0.05 : - seg * 0.5 ], s: [ w * k, th * k * ( i === n ? 1.08 : 1 ), i === 0 || i === n ? Math.max( 0.36, seg * 0.7 ) * ( 0.8 + 0.2 * G ) : seg * 1.1 ] } );

		}

		// neck chain up and forward from the chest, head levelled at the end
		const nn = 1 + Math.round( b.neckLen * 1.4 ), nl = 0.08 + 0.12 * b.neckLen;
		const neck = [];
		let parent = chest;
		for ( let i = 0; i < nn; i ++ ) {

			neck.push( B.bone( 'neck' + i, parent, i === 0 ? [ 0, th * 0.25, 0.14 ] : [ 0, 0, nl ], { rot: [ i === 0 ? - 0.75 + b.hunch * 0.6 : 0.18, 0, 0 ] } ) );
			parent = neck[ i ];

		}

		B.roles.neck = neck;
		B.role( 'neck', neck[ 0 ] );
		const head = B.bone( 'head', parent, [ 0, 0, nl ], { role: 'head', rot: [ 0.75 - b.hunch * 0.6 - 0.18 * ( nn - 1 ), 0, 0 ] } );
		neckParts( K, [ ...neck, head ].slice( 0, - 1 ), 0.17 * G, 0.12 * G );
		const hs = 0.27 * b.headSize;
		K.head = { bone: head, c: [ 0, 0.02, hs * 0.45 ], s: hs, upright: false };
		const lt = 0.11 * b.legThick;
		const style = K.g.gait.style;
		const PH = {
			walk: { LH: 0, LF: 0.25, RH: 0.5, RF: 0.75 }, trot: { LF: 0, RH: 0, RF: 0.5, LH: 0.5 },
			pace: { LF: 0, LH: 0, RF: 0.5, RH: 0.5 }, bound: { LF: 0, RF: 0.1, LH: 0.5, RH: 0.6 }
		}[ style ] || { LF: 0, RH: 0, RF: 0.5, LH: 0.5 };
		B.pair( ( side, S ) => {

			const x = side * w * 0.4;
			addLeg( K, chest, 'front' + S, [ x, - th * 0.28, 0.04 ], [ side * w * 0.46, ankle, half * 0.82 + 0.06 ], a, bb, { side, front: true, phase: PH[ S + 'F' ], pole: [ 0, 0, - 1 ], ankle, t: lt, footLen: 0.14, lift: 0.17 * L } );
			addLeg( K, pelvis, 'hind' + S, [ x, - th * 0.25, - 0.02 ], [ side * w * 0.46, ankle, - half * 0.82 - 0.04 ], a, bb, { side, phase: PH[ S + 'H' ], pole: [ 0, 0, - 1 ], ankle, t: lt * 1.1, footLen: 0.16, lift: 0.15 * L } );

		} );
		for ( let i = 0; i <= n; i ++ ) K.back.push( { bone: spine[ i ], pos: [ 0, th * 0.48, i === 0 ? - 0.02 : i === n ? 0.04 : - seg * 0.5 ], w: w * 0.5 } );
		K.wings = { bone: chest, pos: [ 0, th * 0.45, 0 ], w: w * 0.5 };
		K.tail = { bone: pelvis, pos: [ 0, th * 0.2, - 0.2 * ( 0.8 + 0.2 * G ) ], len: 0.7 * b.tailLen, t: 0.1 * G, dir: 0.25 };
		K.belly.push( { bone: spine[ Math.floor( n / 2 ) ], pos: [ 0, - th * 0.5, 0 ] } );
		B.point( 'chest', chest, [ 0, 0, 0.2 ] );

	}
} );

// --- hexapod -------------------------------------------------------------------------
// Insects: head, thorax with six legs (tripod gait), big abdomen, antennae, mandibles.
define( 'bodyPlan', { id: 'hexapod', name: 'Hexapod', tags: [ 'insect', 'legged' ], weight: 1,
	params: { length: [ 0.8, 1.4 ], girth: [ 0.7, 1.4 ], legLen: [ 0.7, 1.4 ], legThick: [ 0.6, 1.3 ], headSize: [ 0.8, 1.4 ], tailLen: [ 0.6, 1.5 ], neckLen: [ 0, 0.4 ], taper: [ - 0.3, 0.4 ], hunch: [ 0, 0.6 ] },
	slots: { torso: 1, legs: 1, head: 1, eyes: 1, horns: 0.35, back: 0.4, tail: 0.3, wings: 0.4, extra: 0.3, arms: 0.25 },
	defaults: { torso: 'chitin', legs: 'insect', head: 'mandibled', eyes: 'compound' },
	gait: { styles: [ 'tripod' ], duty: 0.55, lift: 0.14, bounce: 0.015, cadence: 1.9 },
	styles: [ 'bite', 'charge' ], speed: 1.15, density: 0.8,
	build( K ) {

		const { B, b } = K;
		const L = b.legLen, G = b.girth, Ln = b.length;
		const y = 0.36 + 0.14 * L;
		const thorax = B.bone( 'thorax', 'root', [ 0, y, 0.05 * Ln ], { role: 'pelvis' } );
		B.role( 'body', thorax );
		B.role( 'chest', thorax );
		const tw = 0.26 * G, tl = 0.32 * Ln;
		K.torso.push( { bone: thorax, c: [ 0, 0, 0 ], s: [ tw, tw * 0.8, tl ] } );
		const abd = B.bone( 'abdomen', thorax, [ 0, 0.03, - tl * 0.45 ], { role: 'abdomen', rot: [ - 0.15 + b.hunch * 0.3, 0, 0 ] } );
		const al = 0.52 * b.tailLen * ( 0.8 + Ln * 0.2 ), aw = 0.38 * G * ( 1 + b.taper * 0.4 );
		K.torso.push( { bone: abd, c: [ 0, 0.02, - al * 0.5 ], s: [ aw, aw * 0.78, al ] } );
		B.roles.spine = [ abd ];
		const neck = B.bone( 'neck', thorax, [ 0, 0.02, tl * 0.45 ], { role: 'neck', rot: [ b.hunch * 0.3, 0, 0 ] } );
		const head = B.bone( 'head', neck, [ 0, 0, 0.04 + 0.12 * b.neckLen ], { role: 'head' } );
		if ( b.neckLen > 0.15 ) K.neck.push( { bone: neck, a: [ 0, 0, 0 ], b: [ 0, 0, 0.04 + 0.12 * b.neckLen ], t: tw * 0.4 } );
		const hs = 0.22 * b.headSize;
		K.head = { bone: head, c: [ 0, 0.01, hs * 0.45 ], s: hs, upright: false };
		const a = 0.36 * L, bb = 0.5 * L, ankle = 0.03;
		const lt = 0.06 * b.legThick;
		const rows = [ [ tl * 0.3, 0.42, 0 ], [ 0, 0.05, 0.5 ], [ - tl * 0.3, - 0.36, 0 ] ];
		rows.forEach( ( [ hz, fz, ph ], r ) => B.pair( ( side, S ) => {

			// tripod: L1 R2 L3 move together, then R1 L2 R3
			const phase = ( side > 0 ? ph : 0.5 - ph ) % 1;
			addLeg( K, thorax, 'leg' + r + S, [ side * tw * 0.42, - tw * 0.2, hz ], [ side * ( 0.42 + 0.3 * L ), ankle, ( fz * L + hz * 0.5 ) ], a, bb,
				{ side, phase: Math.abs( phase ), front: r === 0, pole: [ side * 0.35, 1, 0 ], ankle, t: lt, footLen: 0.06, lift: 0.16 * L } );

		} ) );
		K.back.push( { bone: thorax, pos: [ 0, tw * 0.4, 0 ], w: tw * 0.5 }, { bone: abd, pos: [ 0, aw * 0.38, - al * 0.35 ], w: aw * 0.4 }, { bone: abd, pos: [ 0, aw * 0.3, - al * 0.75 ], w: aw * 0.3 } );
		K.wings = { bone: thorax, pos: [ 0, tw * 0.4, - 0.02 ], w: tw * 0.4 };
		K.tail = { bone: abd, pos: [ 0, 0.02, - al * 0.95 ], len: 0.5 * b.tailLen, t: 0.06 * G, dir: 0.4 };
		K.belly.push( { bone: abd, pos: [ 0, - aw * 0.38, - al * 0.5 ] } );
		K.armMount = { bone: thorax, pos: [ 0, tw * 0.15, tl * 0.48 ], w: tw * 0.35 };
		B.point( 'chest', thorax, [ 0, 0, tl * 0.5 ] );

	}
} );

// --- arachnid ------------------------------------------------------------------------
// Spiders and scorpion-likes: cephalothorax, big abdomen, eight splayed legs with high
// knees (alternating tetrapod gait), fangs, many eyes.
define( 'bodyPlan', { id: 'arachnid', name: 'Arachnid', tags: [ 'spider', 'legged' ], weight: 1,
	params: { length: [ 0.8, 1.3 ], girth: [ 0.8, 1.5 ], legLen: [ 0.8, 1.5 ], legThick: [ 0.6, 1.3 ], headSize: [ 0.8, 1.3 ], tailLen: [ 0.7, 1.5 ], taper: [ - 0.2, 0.5 ], hunch: [ 0, 0.5 ] },
	slots: { torso: 1, legs: 1, head: 1, eyes: 1, back: 0.45, tail: 0.25, extra: 0.3, arms: 0.3 },
	defaults: { torso: 'chitin', legs: 'hairy', head: 'fanged', eyes: 'many' },
	gait: { styles: [ 'tetrapod' ], duty: 0.6, lift: 0.16, bounce: 0.01, cadence: 1.7 },
	styles: [ 'bite', 'spit' ], speed: 1.25, density: 0.8,
	build( K ) {

		const { B, b } = K;
		const L = b.legLen, G = b.girth, Ln = b.length;
		const y = 0.34 + 0.12 * L;
		const ceph = B.bone( 'ceph', 'root', [ 0, y, 0.12 * Ln ], { role: 'pelvis' } );
		B.role( 'body', ceph );
		B.role( 'chest', ceph );
		const cw = 0.34 * G, cl = 0.36 * Ln;
		K.torso.push( { bone: ceph, c: [ 0, 0.02, 0 ], s: [ cw, cw * 0.62, cl ] } );
		const abd = B.bone( 'abdomen', ceph, [ 0, 0.06, - cl * 0.48 ], { role: 'abdomen', rot: [ - 0.25 + b.hunch * 0.5, 0, 0 ] } );
		const al = 0.62 * b.tailLen * ( 0.85 + Ln * 0.15 ), aw = 0.55 * G * ( 1 + b.taper * 0.4 );
		K.torso.push( { bone: abd, c: [ 0, 0.05, - al * 0.48 ], s: [ aw, aw * 0.85, al ] } );
		B.roles.spine = [ abd ];
		const head = B.bone( 'head', ceph, [ 0, 0.02, cl * 0.42 ], { role: 'head' } );
		B.role( 'neck', head );
		const hs = 0.2 * b.headSize;
		K.head = { bone: head, c: [ 0, 0.02, hs * 0.3 ], s: hs, upright: false };
		const a = 0.48 * L, bb = 0.62 * L, ankle = 0.03;
		const lt = 0.07 * b.legThick;
		// legs fan out from the cephalothorax: front pair reaches forward, back pair back
		const ang = [ 0.95, 0.35, - 0.25, - 0.8 ];
		ang.forEach( ( an, r ) => B.pair( ( side, S ) => {

			const hz = cl * ( 0.3 - r * 0.2 );
			const reach = 0.62 + 0.42 * L;
			const phase = ( r % 2 === 0 ) === ( side > 0 ) ? 0 : 0.5;
			addLeg( K, ceph, 'leg' + r + S, [ side * cw * 0.42, 0, hz ], [ side * Math.cos( an ) * reach, ankle, 0.12 * Ln + Math.sin( an ) * reach ], a, bb,
				{ side, phase, front: r === 0, pole: [ side * 0.3, 1, Math.sin( an ) * 0.3 ], ankle, t: lt, footLen: 0.05, lift: 0.18 * L } );

		} ) );
		K.back.push( { bone: abd, pos: [ 0, aw * 0.45, - al * 0.3 ], w: aw * 0.45 }, { bone: abd, pos: [ 0, aw * 0.42, - al * 0.65 ], w: aw * 0.4 }, { bone: ceph, pos: [ 0, cw * 0.3, 0 ], w: cw * 0.3 } );
		K.wings = { bone: ceph, pos: [ 0, cw * 0.3, - 0.05 ], w: cw * 0.4 };
		K.tail = { bone: abd, pos: [ 0, 0.08, - al * 0.95 ], len: 0.6 * b.tailLen, t: 0.07 * G, dir: 0.9 };
		K.belly.push( { bone: abd, pos: [ 0, - aw * 0.35, - al * 0.5 ] } );
		K.armMount = { bone: ceph, pos: [ 0, 0, cl * 0.45 ], w: cw * 0.3 };
		B.point( 'chest', ceph, [ 0, 0, cl * 0.5 ] );

	}
} );

// --- serpent -------------------------------------------------------------------------
// A chain of segments from a middle anchor: the front half can rear up (cobra), the
// whole body slithers with a travelling sine wave. No legs.
define( 'bodyPlan', { id: 'serpent', name: 'Serpent', tags: [ 'serpent', 'legless' ], weight: 0.9,
	params: { length: [ 0.8, 1.4 ], girth: [ 0.8, 1.5 ], segments: [ 7, 11 ], headSize: [ 0.8, 1.4 ], hunch: [ 0, 1 ], taper: [ 0, 0.6 ], neckLen: [ 0, 1 ] },
	slots: { torso: 1, head: 1, eyes: 1, horns: 0.4, back: 0.55, tail: 0.5, wings: 0.1, extra: 0.35, arms: 0.15 },
	defaults: { torso: 'scaled', head: 'serpent', eyes: 'slits' },
	gait: { styles: [ 'slither' ], duty: 1, lift: 0, bounce: 0, cadence: 1.1 },
	styles: [ 'bite', 'spit' ], speed: 0.95, density: 0.9,
	build( K ) {

		const { B, b } = K;
		const n = Math.round( b.segments ), sl = 0.19 * b.length, G = b.girth;
		const t0 = 0.3 * G;
		const nf = Math.ceil( n * 0.42 ), nb = n - nf;
		const body = B.bone( 'body', 'root', [ 0, t0 * 0.5, 0 ], { role: 'pelvis' } );
		B.role( 'body', body );
		const front = [], back = [];
		let p = body;
		const rear = b.hunch; // how far the front rears up (cobra posture)
		for ( let i = 0; i < nf; i ++ ) {

			const up = i < 3 ? - rear * ( 0.35 - i * 0.05 ) : 0;
			p = B.bone( 'f' + i, p, [ 0, 0, sl ], { rot: [ up, 0, 0 ] } );
			front.push( p );

		}

		p = body;
		for ( let i = 0; i < nb; i ++ ) {

			p = B.bone( 'b' + i, p, [ 0, 0, - sl ] );
			back.push( p );

		}

		B.roles.front = front; B.roles.back = back;
		B.role( 'chest', front[ 0 ] );
		B.roles.spine = front;
		const head = B.bone( 'head', front[ nf - 1 ], [ 0, 0, sl * 0.7 ], { role: 'head', rot: [ rear * 0.75, 0, 0 ] } );
		B.role( 'neck', front[ nf - 1 ] );
		// segments thicken toward the middle and taper to the tail tip
		const thick = ( k ) => t0 * ( 1 - Math.pow( Math.max( 0, k ), 1.3 ) * ( 0.75 + b.taper * 0.2 ) );
		K.torso.push( { bone: body, c: [ 0, 0, 0 ], s: [ t0 * 1.05, t0 * 0.85, sl * 1.15 ], i: 0 } );
		front.forEach( ( bn, i ) => K.torso.push( { bone: bn, c: [ 0, 0, 0 ], s: [ thick( ( i + 1 ) / nf * 0.35 ), thick( ( i + 1 ) / nf * 0.35 ) * 0.85, sl * 1.15 ], i: i + 1 } ) );
		back.forEach( ( bn, i ) => K.torso.push( { bone: bn, c: [ 0, 0, 0 ], s: [ thick( ( i + 1 ) / nb ), thick( ( i + 1 ) / nb ) * 0.85, sl * 1.15 ], i: - i - 1 } ) );
		const hs = 0.22 * b.headSize * ( 0.8 + G * 0.2 );
		K.head = { bone: head, c: [ 0, 0.02, hs * 0.4 ], s: hs, upright: false };
		// every other segment carries back parts (spines, sails...) to keep part counts lean
		[ body, ...front.slice( 0, - 1 ), ...back.slice( 0, - 2 ) ].forEach( ( bn, i ) => {

			if ( i % 2 === 0 ) K.back.push( { bone: bn, pos: [ 0, t0 * 0.4, 0 ], w: t0 * 0.45, i } );

		} );
		K.wings = { bone: front[ 1 ] ?? body, pos: [ 0, t0 * 0.4, 0 ], w: t0 * 0.4 };
		K.tail = { bone: back[ nb - 1 ], pos: [ 0, 0, - sl * 0.5 ], len: 0.4, t: thick( 1 ), dir: 0, tip: true };
		K.belly.push( { bone: body, pos: [ 0, - t0 * 0.3, 0 ] } );
		K.armMount = { bone: front[ Math.min( 1, nf - 1 ) ], pos: [ 0, 0, 0 ], w: t0 * 0.5 };
		B.point( 'chest', front[ 0 ], [ 0, 0, 0 ] );

	}
} );

// --- floater -------------------------------------------------------------------------
// Hovering body (eye orbs, jellies, haunted skulls, rock spirits) with tentacles and
// eyestalks on spring chains. Ignores pits and water ( metrics.flying ).
define( 'bodyPlan', { id: 'floater', name: 'Floater', tags: [ 'flying', 'magic', 'legless' ], weight: 0.9,
	params: { girth: [ 0.7, 1.5 ], length: [ 0.8, 1.3 ], legLen: [ 0.6, 1.4 ], headSize: [ 0.8, 1.3 ], tailLen: [ 0.4, 1.4 ], limbs: [ 0, 8 ], hunch: [ 0, 0.4 ] },
	slots: { torso: 1, eyes: 1, head: 0.35, horns: 0.3, back: 0.4, tail: 0.25, wings: 0.35, extra: 0.5, arms: 0.2 },
	defaults: { torso: 'orb', eyes: 'cyclops' },
	gait: { styles: [ 'hover' ], duty: 1, lift: 0, bounce: 0.12, cadence: 0.6, hover: 1 },
	styles: [ 'cast', 'spit' ], speed: 0.9, density: 0.5,
	build( K ) {

		const { B, b } = K;
		const G = b.girth, r = 0.36 * G;
		const hover = 0.7 + 0.4 * b.legLen;
		const body = B.bone( 'body', 'root', [ 0, hover + r, 0 ], { role: 'pelvis' } );
		B.role( 'body', body );
		B.role( 'chest', body );
		B.role( 'head', body );
		B.role( 'neck', body );
		K.torso.push( { bone: body, c: [ 0, 0, 0 ], s: [ r * 2, r * 2 * ( 0.8 + 0.3 * b.length ), r * 2 * b.length ] } );
		K.head = { bone: body, c: [ 0, 0, r * 0.2 ], s: r * 1.4, upright: true, isBody: true, r };
		K.eyeFace = { bone: body, c: [ 0, r * 0.15, r * 0.95 * b.length ], s: r };
		K.back.push( { bone: body, pos: [ 0, r * 0.95, 0 ], w: r * 0.6 }, { bone: body, pos: [ 0, r * 0.75, - r * 0.6 ], w: r * 0.5 }, { bone: body, pos: [ 0, r * 0.7, r * 0.55 ], w: r * 0.5 } );
		K.wings = { bone: body, pos: [ 0, r * 0.1, 0 ], w: r * 0.9 };
		K.tail = { bone: body, pos: [ 0, - r * 0.2, - r * 0.9 ], len: 0.8 * b.tailLen, t: r * 0.3, dir: - 0.3 };
		K.belly.push( { bone: body, pos: [ 0, - r * 0.85, 0 ] } );
		K.armMount = { bone: body, pos: [ 0, - r * 0.3, r * 0.5 ], w: r * 0.8 };
		K.floatR = r;
		B.point( 'chest', body, [ 0, 0, r ] );
		B.meta.hover = hover;

	}
} );

// --- blob ----------------------------------------------------------------------------
// A squashy single mass that hops (squash & stretch). Eyes, mouths and spikes sit on
// its surface and squash with it.
define( 'bodyPlan', { id: 'blob', name: 'Blob', tags: [ 'ooze', 'legless' ], weight: 0.8,
	params: { girth: [ 0.7, 1.6 ], length: [ 0.8, 1.3 ], headSize: [ 0.8, 1.4 ], hunch: [ 0, 0.5 ], limbs: [ 0, 1 ] },
	slots: { torso: 1, eyes: 1, head: 0.3, horns: 0.3, back: 0.6, extra: 0.5, arms: 0.3 },
	defaults: { torso: 'jelly', eyes: 'pair' },
	gait: { styles: [ 'hop' ], duty: 0.45, lift: 0.35, bounce: 0.3, cadence: 1.3 },
	styles: [ 'slam', 'spit' ], speed: 0.72, density: 1.4,
	build( K ) {

		const { B, b } = K;
		const r = 0.42 * b.girth;
		const body = B.bone( 'body', 'root', [ 0, 0, 0 ], { role: 'pelvis' } );
		B.role( 'body', body );
		B.role( 'chest', body );
		B.role( 'neck', body );
		B.role( 'head', body );
		const h = r * 2 * ( 0.75 + 0.25 * b.length );
		K.torso.push( { bone: body, c: [ 0, h * 0.5, 0 ], s: [ r * 2, h, r * 2 * b.length ] } );
		K.head = { bone: body, c: [ 0, h * 0.62, r * 0.1 ], s: r * 1.3, upright: true, isBody: true, r };
		K.eyeFace = { bone: body, c: [ 0, h * 0.68, r * 0.82 * b.length ], s: r };
		K.back.push( { bone: body, pos: [ 0, h * 0.98, 0 ], w: r * 0.5 }, { bone: body, pos: [ 0, h * 0.85, - r * 0.6 ], w: r * 0.45 }, { bone: body, pos: [ r * 0.55, h * 0.8, - r * 0.1 ], w: r * 0.4 }, { bone: body, pos: [ - r * 0.55, h * 0.8, - r * 0.1 ], w: r * 0.4 } );
		K.wings = { bone: body, pos: [ 0, h * 0.7, - r * 0.3 ], w: r * 0.6 };
		K.tail = null;
		K.belly.push( { bone: body, pos: [ 0, h * 0.3, r * 0.85 ] } );
		K.armMount = { bone: body, pos: [ 0, h * 0.45, r * 0.6 ], w: r * 0.9 };
		K.blobH = h;
		B.point( 'chest', body, [ 0, h * 0.5, r ] );

	}
} );

// --- avian ---------------------------------------------------------------------------
// Bird-like: digitigrade legs (knees bend backward), long neck, beak, wings, tail fan.
// Big-winged genomes fly (hover with flapping); the rest run like raptors.
define( 'bodyPlan', { id: 'avian', name: 'Avian', tags: [ 'bird', 'legged' ], weight: 0.9,
	params: { length: [ 0.8, 1.3 ], girth: [ 0.7, 1.3 ], legLen: [ 0.7, 1.4 ], legThick: [ 0.6, 1.2 ], neckLen: [ 0.3, 1.4 ], headSize: [ 0.8, 1.3 ], tailLen: [ 0.4, 1.4 ], hunch: [ 0, 0.6 ], limbs: [ 0, 1 ] },
	slots: { torso: 1, legs: 1, head: 1, eyes: 1, horns: 0.3, back: 0.3, tail: 1, wings: 1, extra: 0.35 },
	defaults: { torso: 'feathered', legs: 'talons', head: 'beaked', eyes: 'pair', wings: 'feather', tail: 'fan' },
	gait: { styles: [ 'biped' ], duty: 0.55, lift: 0.2, bounce: 0.05, cadence: 1.4 },
	styles: [ 'bite', 'leap' ], speed: 1.1, density: 0.6,
	build( K ) {

		const { B, b, g } = K;
		const L = b.legLen, G = b.girth, Ln = b.length;
		const a = 0.3 * L, bb = 0.38 * L, ankle = 0.09;
		const hipY = ( a + bb ) * 0.88 + ankle;
		const body = B.bone( 'pelvis', 'root', [ 0, hipY + 0.06, - 0.05 ], { role: 'pelvis', rot: [ - 0.25 + b.hunch * 0.4, 0, 0 ] } );
		B.role( 'body', body );
		const bw = 0.3 * G, bl = 0.5 * Ln;
		const chest = B.bone( 'chest', body, [ 0, 0.04, bl * 0.4 ], { role: 'chest', rot: [ - 0.2, 0, 0 ] } );
		K.torso.push( { bone: body, c: [ 0, 0, - bl * 0.12 ], s: [ bw, bw * 0.95, bl * 0.75 ] }, { bone: chest, c: [ 0, 0.02, 0.02 ], s: [ bw * 1.05, bw * 1.05, bl * 0.55 ] } );
		const nn = 1 + Math.round( b.neckLen * 1.5 ), nl = 0.06 + 0.1 * b.neckLen;
		const neck = [];
		let parent = chest;
		for ( let i = 0; i < nn; i ++ ) {

			neck.push( B.bone( 'neck' + i, parent, i === 0 ? [ 0, bw * 0.3, bl * 0.2 ] : [ 0, nl, 0 ], { rot: [ i === 0 ? 0.2 : - 0.1, 0, 0 ] } ) );
			parent = neck[ i ];

		}

		B.roles.neck = neck;
		B.role( 'neck', neck[ 0 ] );
		const head = B.bone( 'head', parent, [ 0, nl, 0 ], { role: 'head', rot: [ 0.45 - 0.1 * nn - b.hunch * 0.3, 0, 0 ] } );
		for ( let i = 0; i < nn; i ++ ) K.neck.push( { bone: neck[ i ], a: [ 0, 0, 0 ], b: [ 0, nl, 0 ], t: ( 0.12 - i * 0.015 ) * G } );
		const hs = 0.2 * b.headSize;
		K.head = { bone: head, c: [ 0, hs * 0.3, hs * 0.2 ], s: hs, upright: true };
		const lt = 0.075 * b.legThick;
		B.pair( ( side, S ) => addLeg( K, body, 'leg' + S, [ side * bw * 0.35, - 0.05, - 0.02 ], [ side * bw * 0.4, ankle, 0.04 ], a, bb,
			{ side, phase: side > 0 ? 0 : 0.5, pole: [ 0, 0, - 1 ], ankle, t: lt, footLen: 0.2, lift: 0.22 * L, tuck: [ 0, hipY * 0.75, - 0.15 ] } ) );
		K.back.push( { bone: body, pos: [ 0, bw * 0.45, - bl * 0.1 ], w: bw * 0.4 }, { bone: chest, pos: [ 0, bw * 0.5, 0 ], w: bw * 0.4 } );
		K.wings = { bone: chest, pos: [ 0, bw * 0.3, - 0.02 ], w: bw * 0.45 };
		K.tail = { bone: body, pos: [ 0, 0.02, - bl * 0.48 ], len: 0.7 * b.tailLen, t: 0.06 * G, dir: 0.2 };
		K.belly.push( { bone: body, pos: [ 0, - bw * 0.45, 0 ] } );
		K.armMount = { bone: chest, pos: [ 0, - 0.02, bl * 0.25 ], w: bw * 0.45 };
		B.point( 'chest', chest, [ 0, 0, bl * 0.3 ] );
		B.meta.hover = g.gait.fly ? 0.55 + 0.25 * L : 0;

	}
} );

export { lerp };
