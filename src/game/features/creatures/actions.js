// Action poses: every name in the animation vocabulary ( docs/GAME.md §4 ).
//
// THE SHAPE OF AN ATTACK. The sim only says which phase an action is in (windup,
// active, recovery) and how far through it is. Every action here is two additive
// poses - W (the anticipation, reached during windup) and A (the strike, reached
// during the active frames) - mixed by two weights:
//
//   windup    cW = easeOutCubic( u )        cA = 0                  slow, readable draw-back
//   active    cW = 1 - easeOutExpo( u )     cA = easeOutExpo( u )   snaps to the strike in a few frames
//   recovery  cW = 0                        cA = 1 - easeOutBack( u ) settles PAST rest and back (overshoot)
//
// (u = progress inside the current phase.) Humanoid actions (hero, NPCs, biped
// monsters) are KEY POSES by role (poser.js); creature actions are small functions
// over roles, so one 'bite' drives a wolf, a cobra and a spider. Unknown action
// names fall back to a generic draw-back / strike / settle.
//
// Signs (Euler offsets): x + = pitch forward / arm swings back / head nods down /
// jaw opens; arm raised forward = x -1.6, straight up = x -3; a raised arm's y aims
// it left (+) / right (-); right arm out to the side = z -1.5, left = z +1.5;
// forearm bend = x -.

import { mirrorKey } from './poser.js';
import { noise1, TAU } from './math.js';

// --- humanoid key poses -----------------------------------------------------------------

const H = {};

// The right-arm angles below were FITTED, not guessed: an offline solver ran the real
// rig (rig.js) and searched shoulder / elbow / twist / wrist angles so the hand lands
// where a swordsman's hand goes and the blade points where it should (e.g. slash v1
// windup: hand behind the right shoulder, blade back and up; impact: hand in front,
// blade forward-left; follow-through: hand at the left hip, blade trailing back).
// Swings carry a third key M (impact) so the blade sweeps an arc through the front
// instead of cutting the corner between windup and follow-through.
const R = ( up, fo, ha = 0 ) => ( { upperArmR: up, foreArmR: [ fo[ 0 ], fo[ 1 ], 0 ], handR: [ ha, 0, 0 ] } );
const L = ( up, fo, ha = 0 ) => ( { upperArmL: up, foreArmL: [ fo[ 0 ], fo[ 1 ], 0 ], handL: [ ha, 0, 0 ] } );

// slash: variant 0 = left -> right (a draw-cut from the left hip), 1 = right -> left
// (forehand), 2 = overhead chop. The left arm counter-balances.
H.slash0 = {
	W: { pelvisO: [ 0, - 0.04, - 0.03 ], spine: [ 0.05, 0.45, 0 ], chest: [ 0, 0.35, 0 ], head: [ 0, - 0.5, 0 ], footR: [ 0, 0, - 0.06 ],
		...R( [ - 0.43, 1.59, - 0.51 ], [ - 0.22, 0.58 ], 0.67 ), upperArmL: [ 0.35, 0, 0.35 ], foreArmL: [ - 0.7, 0, 0 ] },
	M: { pelvisO: [ 0, - 0.05, 0.06 ], spine: [ 0.15, 0, 0 ], chest: [ 0.03, 0, 0 ], footL: [ 0, 0, 0.1 ],
		...R( [ - 1.17, - 0.26, 0.62 ], [ - 0.01, - 0.94 ], 0.67 ), upperArmL: [ 0.1, 0, 0.5 ], foreArmL: [ - 0.9, 0, 0 ] },
	A: { pelvisO: [ 0, - 0.06, 0.12 ], spine: [ 0.22, - 0.45, 0 ], chest: [ 0.05, - 0.4, 0 ], head: [ 0, 0.6, 0 ], footL: [ 0, 0, 0.18 ], footR: [ 0, 0, - 0.08 ],
		...R( [ - 1.48, - 0.06, 0.49 ], [ - 0.84, - 1.5 ], 0.71 ), upperArmL: [ - 0.4, 0, 0.6 ], foreArmL: [ - 1.1, 0, 0 ] }
};
H.slash1 = {
	W: { pelvisO: [ 0, - 0.04, - 0.03 ], spine: [ 0.05, - 0.45, 0 ], chest: [ 0, - 0.4, 0 ], head: [ 0, 0.55, 0 ], footL: [ 0, 0, 0.06 ],
		...R( [ - 1.2, - 0.45, 0.9 ], [ - 1.72, - 1.04 ], 1.1 ), upperArmL: [ - 0.7, 0, 0.25 ], foreArmL: [ - 0.9, 0, 0 ] },
	M: { pelvisO: [ 0, - 0.05, 0.07 ], spine: [ 0.15, 0, 0 ], chest: [ 0.03, 0, 0 ], footL: [ 0, 0, 0.12 ],
		...R( [ - 1.34, 0.23, 0.34 ], [ 0, 0.3 ], 1.1 ), upperArmL: [ 0.1, 0, 0.45 ], foreArmL: [ - 0.7, 0, 0 ] },
	A: { pelvisO: [ 0, - 0.07, 0.14 ], spine: [ 0.25, 0.45, 0 ], chest: [ 0.05, 0.45, 0 ], head: [ 0, - 0.6, 0 ], footL: [ 0, 0, 0.2 ], footR: [ 0, 0, - 0.1 ],
		...R( [ - 1.19, 0.68, 0.07 ], [ 0, 1.33 ], 1.1 ), upperArmL: [ 0.55, 0, 0.55 ], foreArmL: [ - 0.5, 0, 0 ] }
};
H.slash2 = {
	W: { pelvisO: [ 0, 0.02, - 0.05 ], spine: [ - 0.25, - 0.15, 0 ], chest: [ - 0.15, 0, 0 ], head: [ - 0.2, 0, 0 ], footL: [ 0, 0, 0.08 ],
		...R( [ - 1.75, 0.26, 0.1 ], [ - 1.16, 0.12 ], 0.53 ), ...L( [ - 1.42, - 0.22, - 0.09 ], [ - 1.34, - 0.36 ], 0.74 ) },
	M: { pelvisO: [ 0, - 0.08, 0.08 ], spine: [ 0.15, 0, 0 ], chest: [ 0.1, 0, 0 ], footL: [ 0, 0, 0.18 ],
		...R( [ - 1.97, 0.47, 0.24 ], [ - 0.95, - 0.11 ], 1.1 ), upperArmL: [ - 0.6, 0, 0.5 ], foreArmL: [ - 0.9, 0, 0 ] },
	A: { pelvisO: [ 0, - 0.2, 0.2 ], spine: [ 0.5, 0, 0 ], chest: [ 0.25, 0, 0 ], head: [ - 0.25, 0, 0 ], footL: [ 0, 0, 0.32 ], footR: [ 0, 0, - 0.15 ],
		...R( [ - 1.0, 0.45, 0.89 ], [ - 1.55, - 0.95 ], 1.5 ), upperArmL: [ 0.3, 0, 0.6 ], foreArmL: [ - 0.6, 0, 0 ] }
};
H.thrust = {
	W: { pelvisO: [ 0, - 0.06, - 0.08 ], spine: [ 0, - 0.55, 0 ], chest: [ 0, - 0.2, 0 ], head: [ 0, 0.65, 0 ], footR: [ 0, 0, - 0.12 ],
		...R( [ 0.32, 0.47, - 0.38 ], [ - 1.45, 0.21 ], 1.08 ), upperArmL: [ - 1.2, 0.5, 0.2 ], foreArmL: [ - 0.4, 0, 0 ] },
	A: { pelvisO: [ 0, - 0.12, 0.3 ], spine: [ 0.3, 0.25, 0 ], chest: [ 0.05, 0.1, 0 ], head: [ - 0.1, - 0.3, 0 ], footL: [ 0, 0, 0.42 ], footR: [ 0, 0, - 0.18 ],
		...R( [ - 1.68, - 0.07, 0.08 ], [ 0, - 0.77 ], 1.1 ), upperArmL: [ 0.6, 0, 0.5 ], foreArmL: [ - 0.4, 0, 0 ] }
};
H.overhead = {
	W: { pelvisO: [ 0, 0.05, - 0.08 ], spine: [ - 0.35, 0, 0 ], chest: [ - 0.2, 0, 0 ], head: [ - 0.3, 0, 0 ], footL: [ 0, 0.05, 0.1 ],
		...R( [ - 2.07, 0.37, 0.07 ], [ - 0.43, 0.32 ], 0.18 ), ...L( [ - 1.83, - 0.31, - 0.09 ], [ - 0.78, - 0.31 ], 0.29 ) },
	M: { pelvisO: [ 0, - 0.1, 0.1 ], spine: [ 0.2, 0, 0 ], chest: [ 0.1, 0, 0 ], footL: [ 0.02, 0, 0.2 ],
		...R( [ - 2.52, 0.72, 0.3 ], [ - 0.37, - 0.05 ], 1.1 ), ...L( [ - 2.52, - 0.72, - 0.3 ], [ - 0.37, 0.05 ], 1.1 ) },
	A: { pelvisO: [ 0, - 0.32, 0.25 ], spine: [ 0.75, 0, 0 ], chest: [ 0.35, 0, 0 ], head: [ - 0.45, 0, 0 ], footL: [ 0.04, 0, 0.35 ], footR: [ - 0.04, 0, - 0.2 ],
		...R( [ - 1.6, 1.11, 0.3 ], [ - 1.43, - 1.52 ], 1.5 ), ...L( [ - 1.45, - 0.77, - 0.9 ], [ - 1.7, 1.42 ], 1.5 ) }
};
H.slam = {
	W: { pelvisO: [ 0, 0.06, 0 ], spine: [ - 0.3, 0, 0 ], chest: [ - 0.2, 0, 0 ], head: [ - 0.35, 0, 0 ],
		...R( [ - 2.2, 0.18, 0.17 ], [ 0, 0.06 ], 0.33 ), ...L( [ - 2.19, - 0.28, - 0.09 ], [ - 0.01, - 0.11 ], 0.33 ) },
	A: { pelvisO: [ 0, - 0.42, 0.1 ], spine: [ 0.85, 0, 0 ], chest: [ 0.3, 0, 0 ], head: [ - 0.5, 0, 0 ], footL: [ 0.12, 0, 0.12 ], footR: [ - 0.12, 0, - 0.06 ],
		...R( [ - 0.89, 0.01, 0.9 ], [ - 1.25, - 0.51 ], 1.5 ), ...L( [ - 1.02, - 0.15, - 0.82 ], [ - 1.24, 0.7 ], 1.5 ) }
};
H.spin = {
	W: { pelvisO: [ 0, - 0.12, 0 ], spine: [ 0.15, - 0.6, 0 ], chest: [ 0, - 0.3, 0 ], head: [ 0, 0.7, 0 ],
		...R( [ - 0.88, - 1.18, 0.85 ], [ - 0.96, - 0.89 ], 1.1 ), upperArmL: [ - 0.9, 0, 0.6 ], foreArmL: [ - 1.2, 0, 0 ] },
	A: { pelvisO: [ 0, - 0.14, 0 ], spine: [ 0.1, 0.1, 0 ], chest: [ 0, 0.1, 0 ], head: [ 0, - 0.1, 0 ],
		...R( [ - 0.25, - 0.29, - 1.28 ], [ 0, - 0.32 ], 1.1 ), upperArmL: [ - 0.3, 0, 1.4 ], foreArmL: [ - 0.2, 0, 0 ] }
};
H.leap = {
	W: { pelvisO: [ 0, - 0.3, - 0.05 ], spine: [ 0.5, 0, 0 ], head: [ - 0.4, 0, 0 ],
		...R( [ 0.14, 1.44, 0.35 ], [ 0, 1.52 ], 1.1 ), ...L( [ 0.1, - 1.59, - 0.38 ], [ 0, - 1.37 ], 1.22 ) },
	A: { pelvisO: [ 0, 0.05, 0 ], spine: [ - 0.15, 0, 0 ], head: [ 0.1, 0, 0 ], footL: [ 0, 0.35, 0.2 ], footR: [ 0, 0.25, - 0.15 ],
		...R( [ - 2.17, 0.12, 0.15 ], [ - 0.86, 0.12 ], 0.7 ), ...L( [ - 1.95, - 0.12, 0.15 ], [ - 1.08, 0.01 ], 0.68 ) }
};
H.dash = {
	W: { pelvisO: [ 0, - 0.15, - 0.05 ], spine: [ 0.4, 0, 0 ], head: [ - 0.3, 0, 0 ],
		...R( [ 0.14, 1.6, 0.01 ], [ - 0.43, 1.43 ], 1.1 ), upperArmL: [ - 0.6, 0, 0.2 ], foreArmL: [ - 1.2, 0, 0 ] },
	A: { pelvisO: [ 0, - 0.12, 0.1 ], spine: [ 0.7, 0, 0 ], chest: [ 0.1, 0, 0 ], head: [ - 0.55, 0, 0 ], footL: [ 0, 0.1, 0.4 ], footR: [ 0, 0.15, - 0.4 ],
		...R( [ - 0.11, - 1.6, - 0.28 ], [ 0, - 1.24 ], 1.1 ), upperArmL: [ 1.0, 0, 0.35 ], foreArmL: [ - 0.3, 0, 0 ] }
};
// casting is done with the off hand; the weapon hangs low behind
H.cast = {
	W: { pelvisO: [ 0, - 0.03, - 0.04 ], spine: [ - 0.05, - 0.25, 0 ], head: [ 0.1, 0.2, 0 ],
		...R( [ 0.05, 1.57, 0.43 ], [ 0, 1.14 ], 1.1 ), ...L( [ 0.1, - 0.11, - 0.39 ], [ - 1.83, 0.01 ], 1.05 ) },
	A: { pelvisO: [ 0, - 0.05, 0.1 ], spine: [ 0.2, 0.2, 0 ], head: [ - 0.1, - 0.2, 0 ], footL: [ 0, 0, 0.15 ],
		...R( [ 0.05, 1.57, 0.43 ], [ 0, 1.14 ], 1.1 ), ...L( [ - 1.66, - 0.37, - 0.24 ], [ 0, - 0.09 ], 0.03 ) }
};
H.cast_aoe = {
	W: { pelvisO: [ 0, - 0.14, 0 ], spine: [ 0.3, 0, 0 ], head: [ 0.35, 0, 0 ],
		...R( [ 0.21, 0.25, - 0.28 ], [ - 1.34, 0.11 ], 1.5 ), ...L( [ 0.06, - 0.02, - 0.15 ], [ - 1.66, - 0.07 ], 0.89 ) },
	A: { pelvisO: [ 0, 0.06, 0 ], spine: [ - 0.3, 0, 0 ], chest: [ - 0.15, 0, 0 ], head: [ - 0.5, 0, 0 ],
		...R( [ - 2.01, - 0.44, - 0.18 ], [ 0, 0.19 ], 1.08 ), ...L( [ - 2.01, 0.42, 0.19 ], [ 0, - 0.19 ], 1.08 ) }
};
H.channel = {
	W: { pelvisO: [ 0, - 0.05, 0 ], spine: [ - 0.1, 0, 0 ], head: [ 0.05, 0, 0 ],
		...R( [ - 1.21, 0.04, 0.2 ], [ 0, - 0.27 ], 1.09 ), ...L( [ - 1.21, - 0.08, - 0.19 ], [ 0, 0.02 ], 0.05 ) },
	A: { pelvisO: [ 0, - 0.06, 0 ], spine: [ - 0.12, 0, 0 ], head: [ 0.05, 0, 0 ],
		...R( [ - 1.25, 0.04, 0.22 ], [ 0, - 0.27 ], 1.09 ), ...L( [ - 1.25, - 0.08, - 0.21 ], [ 0, 0.02 ], 0.05 ) }
};
// bow in the left hand; the right hand draws to the cheek and releases
H.shoot = {
	W: { spine: [ 0, - 0.75, 0 ], chest: [ 0, - 0.2, 0 ], head: [ 0, 0.9, 0 ], footL: [ 0.06, 0, 0.08 ],
		...R( [ - 1.55, 0.3, 0.29 ], [ - 1.49, 1.58 ], 1.18 ), ...L( [ - 0.97, 0.15, 0.42 ], [ - 0.65, 0.31 ], 0.25 ) },
	A: { spine: [ - 0.05, - 0.8, 0 ], chest: [ 0, - 0.2, 0 ], head: [ 0, 0.95, 0 ], footL: [ 0.06, 0, 0.08 ],
		...R( [ - 1.45, 0.5, 0.6 ], [ - 1.95, 1.58 ], 1.18 ), ...L( [ - 0.95, 0.15, 0.42 ], [ - 0.65, 0.31 ], 0.25 ) }
};
H.throw = {
	W: { pelvisO: [ 0, - 0.03, - 0.08 ], spine: [ - 0.2, - 0.6, 0 ], chest: [ - 0.1, - 0.2, 0 ], head: [ 0, 0.7, 0 ], footR: [ 0, 0, - 0.12 ],
		...R( [ - 1.74, 0.19, 0.04 ], [ - 1.23, - 0.53 ], 1.04 ), ...L( [ - 0.88, 0.28, 0.5 ], [ - 0.62, 0.09 ], 1.5 ) },
	A: { pelvisO: [ 0, - 0.08, 0.15 ], spine: [ 0.35, 0.45, 0 ], chest: [ 0.1, 0.15, 0 ], head: [ - 0.2, - 0.5, 0 ], footL: [ 0, 0, 0.3 ],
		...R( [ - 0.47, - 0.23, 0.3 ], [ - 1.58, - 0.22 ], 1.5 ), ...L( [ - 0.18, 1.6, - 0.57 ], [ - 1.23, 1.04 ], 1.43 ) }
};
H.shout = {
	W: { pelvisO: [ 0, - 0.12, 0 ], spine: [ 0.4, 0, 0 ], chest: [ 0.2, 0, 0 ], head: [ 0.4, 0, 0 ],
		...R( [ - 0.06, 0.33, 0.16 ], [ - 2.29, 0.13 ], 1.07 ), ...L( [ - 0.06, - 0.24, - 0.17 ], [ - 2.29, - 0.22 ], 1.07 ) },
	A: { pelvisO: [ 0, - 0.02, 0 ], spine: [ - 0.35, 0, 0 ], chest: [ - 0.25, 0, 0 ], head: [ - 0.55, 0, 0 ], jaw: [ 0.6, 0, 0 ], footL: [ 0.08, 0, 0.05 ], footR: [ - 0.08, 0, 0 ],
		...R( [ - 0.68, - 1.6, 0.38 ], [ - 0.96, - 1.16 ], 1.1 ), ...L( [ - 0.67, 1.6, - 0.4 ], [ - 0.99, 1.15 ], 1.1 ) }
};
H.block = {
	W: { pelvisO: [ 0, - 0.1, - 0.04 ], spine: [ 0.15, 0.15, 0 ], head: [ 0.1, - 0.1, 0 ], footL: [ 0.03, 0, 0.12 ], footR: [ - 0.03, 0, - 0.1 ],
		...R( [ - 0.25, 0.51, - 1.6 ], [ - 1.65, - 0.28 ], 1.1 ), ...L( [ - 1.2, - 0.27, - 0.25 ], [ - 1.3, - 0.09 ], 1.22 ) },
	A: { pelvisO: [ 0, - 0.13, - 0.08 ], spine: [ 0.2, 0.2, 0 ], head: [ 0.15, - 0.1, 0 ], footL: [ 0.03, 0, 0.12 ], footR: [ - 0.03, 0, - 0.12 ],
		...R( [ - 0.25, 0.51, - 1.68 ], [ - 1.73, - 0.28 ], 1.1 ), ...L( [ - 1.28, - 0.27, - 0.25 ], [ - 1.38, - 0.09 ], 1.22 ) }
};
H.kick = {
	W: { pelvisO: [ 0, - 0.02, - 0.06 ], spine: [ - 0.15, 0.15, 0 ], head: [ 0.2, 0, 0 ], footR: [ 0, 0.45, 0.15 ],
		upperArmR: [ - 0.5, 0, - 0.5 ], foreArmR: [ - 1.2, 0, 0 ], upperArmL: [ - 0.6, 0, 0.5 ], foreArmL: [ - 1.2, 0, 0 ] },
	A: { pelvisO: [ 0, - 0.04, - 0.1 ], spine: [ - 0.4, - 0.1, 0 ], head: [ 0.35, 0, 0 ], footR: [ 0, 0.55, 0.75 ], footL: [ 0, 0, - 0.05 ],
		...R( [ 0.03, - 1.49, 0.66 ], [ - 1.74, - 0.64 ], 0.7 ), upperArmL: [ - 0.9, 0, 0.6 ], foreArmL: [ - 1.0, 0, 0 ] }
};
// drinking uses the off hand (the weapon stays ready)
H.drink = {
	W: { spine: [ - 0.05, 0.1, 0 ], head: [ - 0.25, 0, 0 ],
		...R( [ 0.13, - 0.01, - 0.05 ], [ - 0.43, - 0.01 ], 1.1 ), ...L( [ - 0.2, - 0.26, - 0.24 ], [ - 1.76, - 0.15 ], 0.89 ) },
	A: { spine: [ - 0.15, 0.1, 0 ], head: [ - 0.65, 0, 0 ],
		...R( [ 0.13, - 0.01, - 0.05 ], [ - 0.43, - 0.01 ], 1.1 ), ...L( [ - 0.92, - 0.51, 0.12 ], [ - 1.79, - 0.44 ], 0.53 ) }
};

// Weapon carry stances (locomotion layer, animate.js carryStance): idle and run.
export const CARRY = {
	onehand: { idle: R( [ - 0.29, 0.05, 0 ], [ - 0.01, 0.12 ], 0.76 ), run: R( [ - 0.09, - 1.6, - 0.08 ], [ 0, - 1.46 ], 1.05 ) },
	twohand: { idle: R( [ - 0.45, 0.17, 0.14 ], [ - 0.04, 0.31 ], - 0.25 ), run: R( [ 0, 0.37, - 0.09 ], [ - 0.78, 0.17 ], 0.08 ) },
	bow: { idle: L( [ 0.1, 0.05, - 0.06 ], [ - 0.47, 0.1 ], 1.41 ), run: L( [ 0.38, - 0.05, - 0.06 ], [ - 0.76, 0.15 ], 0.79 ) },
	// NPC spears and staves stand upright beside the body
	pole: { idle: R( [ 0.39, - 0.08, 0.04 ], [ - 1.36, 0.05 ], - 0.4 ), run: R( [ 0.25, - 0.06, 0.06 ], [ - 1.38, 0.04 ], - 0.26 ) }
};

// creature verbs on humanoid bodies
H.bite = {
	W: { spine: [ - 0.2, 0, 0 ], neck: [ - 0.3, 0, 0 ], head: [ - 0.3, 0, 0 ], jaw: [ 0.5, 0, 0 ], upperArmR: [ - 0.9, 0, - 0.6 ], upperArmL: [ - 0.9, 0, 0.6 ], foreArmR: [ - 0.8, 0, 0 ], foreArmL: [ - 0.8, 0, 0 ] },
	A: { pelvisO: [ 0, - 0.08, 0.25 ], spine: [ 0.55, 0, 0 ], neck: [ 0.3, 0, 0 ], head: [ 0.2, 0, 0 ], jaw: [ 0.1, 0, 0 ], upperArmR: [ - 1.5, 0, 0.2 ], upperArmL: [ - 1.5, 0, - 0.2 ], foreArmR: [ - 0.3, 0, 0 ], foreArmL: [ - 0.3, 0, 0 ], footL: [ 0, 0, 0.25 ] }
};
H.claw0 = {
	W: { spine: [ 0, 0.3, 0 ], upperArmL: [ - 2.5, 0, 0.6 ], foreArmL: [ - 0.9, 0, 0 ], upperArmR: [ - 0.4, 0, - 0.3 ], jaw: [ 0.3, 0, 0 ] },
	A: { pelvisO: [ 0, - 0.08, 0.15 ], spine: [ 0.35, - 0.35, 0 ], upperArmL: [ - 0.6, - 0.6, - 0.5 ], foreArmL: [ - 0.2, 0, 0 ], upperArmR: [ 0.3, 0, - 0.4 ], footL: [ 0, 0, 0.2 ] }
};
H.claw1 = mirrorKey( H.claw0 );
H.stomp = {
	W: { pelvisO: [ 0, 0.04, - 0.04 ], spine: [ - 0.2, 0, 0 ], upperArmR: [ - 0.6, 0, - 0.7 ], upperArmL: [ - 0.6, 0, 0.7 ], footR: [ 0, 0.55, 0.15 ] },
	A: { pelvisO: [ 0, - 0.2, 0.05 ], spine: [ 0.4, 0, 0 ], upperArmR: [ - 0.3, 0, - 0.9 ], upperArmL: [ - 0.3, 0, 0.9 ], footR: [ 0, 0, 0.25 ], footL: [ 0, 0, - 0.08 ] }
};
H.burrow = {
	W: { pelvisO: [ 0, - 0.35, 0 ], spine: [ 0.9, 0, 0 ], upperArmR: [ - 1.3, 0, 0 ], upperArmL: [ - 1.3, 0, 0 ] },
	A: { rootO: [ 0, - 1.6, 0 ], pelvisO: [ 0, - 0.4, 0 ], spine: [ 1.0, 0, 0 ], upperArmR: [ - 2.8, 0, 0 ], upperArmL: [ - 2.8, 0, 0 ] }
};
H.breath = {
	W: { spine: [ - 0.35, 0, 0 ], neck: [ - 0.3, 0, 0 ], head: [ - 0.4, 0, 0 ], upperArmR: [ 0.6, 0, - 0.5 ], upperArmL: [ 0.6, 0, 0.5 ] },
	A: { pelvisO: [ 0, - 0.05, 0.08 ], spine: [ 0.35, 0, 0 ], neck: [ 0.3, 0, 0 ], head: [ 0.1, 0, 0 ], jaw: [ 0.7, 0, 0 ], upperArmR: [ 0.7, 0, - 0.7 ], upperArmL: [ 0.7, 0, 0.7 ] }
};
H.tail = {
	W: { spine: [ 0.1, 0.6, 0 ], chest: [ 0, 0.3, 0 ], upperArmR: [ - 0.5, 0, - 0.8 ], upperArmL: [ - 0.5, 0, 0.8 ] },
	A: { spine: [ 0.1, - 0.6, 0 ], chest: [ 0, - 0.3, 0 ], upperArmR: [ - 0.3, 0, - 1.2 ], upperArmL: [ - 0.3, 0, 1.2 ] }
};
// aliases
H.charge = H.dash; H.roar = H.shout; H.summon = H.cast_aoe; H.claw = H.claw0;

export const HUMANOID_KEYS = H;

// Actions that light up glow parts (eyes, crystals, runes, magic weapons) while active.
export const GLOW_ACTIONS = new Set( [ 'cast', 'cast_aoe', 'channel', 'summon', 'breath', 'spit', 'roar', 'shout' ] );

// Humanoid actions with procedural extras on top of the keys.
export function humanoidExtra( p, act, cW, cA, u, phase, ctx ) {

	const R = p.R;
	if ( act === 'spin' && phase !== 'windup' ) {

		// one full turn of the body during the active frames, eased
		const turn = phase === 'active' ? ctx.easeSpin : 1;
		p.rot( 0, 0, - turn * TAU * ( phase === 'recovery' ? 1 : 1 ), 0 );

	} else if ( act === 'channel' ) {

		// trembling hands, a slow sway while the beam holds
		const n = noise1( ctx.time * 9, 3 ) * 0.06, m = noise1( ctx.time * 7, 9 ) * 0.06;
		p.rot( R.foreArmR, n, 0, m ); p.rot( R.foreArmL, m, 0, n );
		p.rot( R.spine, 0, Math.sin( ctx.time * 1.7 ) * 0.05, 0 );

	} else if ( act === 'shout' || act === 'roar' ) {

		if ( phase === 'active' ) p.rot( R.head, noise1( ctx.time * 30, 1 ) * 0.06 * cA, noise1( ctx.time * 27, 2 ) * 0.08 * cA, 0 );

	} else if ( act === 'leap' && phase === 'recovery' ) {

		// landing: a crouch that springs back up
		p.o( 'pelvis', 0, - 0.22 * Math.sin( Math.min( 1, u * 1.4 ) * Math.PI ), 0 );

	} else if ( act === 'drink' && phase === 'active' ) {

		p.rot( R.head, Math.sin( u * Math.PI * 3 ) * 0.05, 0, 0 );

	}

}

// --- emotes (NPCs) ------------------------------------------------------------------------
// Emotes are loops: s = time in seconds (from the action timeline or an idle clock).

export const EMOTES = {

	hammer( p, s ) {

		// raise slowly, strike fast, small bounce on the anvil
		const R = p.R, per = 1.15, f = ( s % per ) / per;
		const up = f < 0.6 ? Math.sin( f / 0.6 * Math.PI / 2 ) : 1 - Math.pow( ( f - 0.6 ) / 0.4, 0.35 );
		const hit = f > 0.6 && f < 0.75 ? 1 - ( f - 0.6 ) / 0.15 : 0;
		p.rot( R.upperArmR, - 0.6 - 1.8 * up, 0.15, - 0.25 );
		p.rot( R.foreArmR, - 0.5 - 0.9 * up, 0, 0 );
		p.rot( R.handR, 0.4 - 0.2 * up, 0, 0 );
		p.rot( R.upperArmL, - 0.9, - 0.2, 0.15 );
		p.rot( R.foreArmL, - 0.7, 0, 0 );
		p.rot( R.spine, 0.25 + 0.1 * ( 1 - up ), - 0.1, 0 );
		p.rot( R.head, 0.35, 0, 0 );
		p.o( 'pelvis', 0, - 0.04 - hit * 0.03, 0 );

	},

	sweep( p, s ) {

		const R = p.R, a = Math.sin( s * TAU / 1.6 );
		p.rot( R.spine, 0.3, a * 0.35, 0 );
		p.rot( R.chest, 0.1, a * 0.15, 0 );
		p.rot( R.upperArmR, - 0.7, 0.3, 0.2 );
		p.rot( R.foreArmR, - 0.9, 0, 0 );
		p.rot( R.upperArmL, - 1.0, - 0.3, - 0.1 );
		p.rot( R.foreArmL, - 0.6, 0, 0 );
		p.rot( R.head, 0.45, a * 0.2, 0 );
		p.o( 'pelvis', a * 0.02, - 0.03, 0 );

	},

	talk( p, s, seed = 0 ) {

		const R = p.R;
		const g1 = noise1( s * 1.3, seed + 1 ), g2 = noise1( s * 1.1, seed + 2 ), nod = noise1( s * 2.2, seed + 3 );
		p.rot( R.upperArmR, - 0.5 + g1 * 0.3, 0, - 0.25 );
		p.rot( R.foreArmR, - 1.3 + g1 * 0.5, 0.3 * g2, 0 );
		p.rot( R.upperArmL, - 0.4 + g2 * 0.3, 0, 0.25 );
		p.rot( R.foreArmL, - 1.2 + g2 * 0.5, - 0.3 * g1, 0 );
		p.rot( R.head, nod * 0.15, g2 * 0.2, g1 * 0.08 );
		p.rot( R.jaw, Math.max( 0, Math.sin( s * 11 ) ) * 0.2, 0, 0 );
		p.rot( R.spine, 0.02, g1 * 0.1, 0 );

	},

	wave( p, s ) {

		const R = p.R, w = Math.sin( s * TAU * 1.6 );
		p.rot( R.upperArmR, - 2.6, 0.2, - 0.45 + w * 0.3 );
		p.rot( R.foreArmR, - 0.6, 0, w * 0.2 );
		p.rot( R.head, - 0.05, 0.1, 0 );
		p.rot( R.spine, - 0.05, 0.1, w * 0.03 );

	},

	count( p, s ) {

		const R = p.R, tap = Math.max( 0, Math.sin( s * TAU * 1.8 ) );
		p.rot( R.head, 0.55, 0.1, 0 );
		p.rot( R.spine, 0.12, 0, 0 );
		p.rot( R.upperArmR, - 0.55, 0.3, 0.3 );
		p.rot( R.foreArmR, - 1.2 - tap * 0.3, 0, 0 );
		p.rot( R.upperArmL, - 0.55, - 0.3, - 0.3 );
		p.rot( R.foreArmL, - 1.25, 0, 0 );
		p.rot( R.handR, tap * 0.4, 0, 0 );

	},

	meditate( p, s ) {

		// levitating, legs folded under, hands resting on the knees, slow breath
		const R = p.R, br = Math.sin( s * TAU / 4.5 );
		p.o( 'root', 0, 0.28 + br * 0.04, 0 );
		p.o( 'pelvis', 0, - 0.3, 0 );
		if ( R.footL >= 0 ) p.foot( R.footL, - 0.06, 0.55, 0.28 );
		if ( R.footR >= 0 ) p.foot( R.footR, 0.06, 0.55, 0.28 );
		p.rot( R.upperArmR, - 0.55, 0, - 0.35 );
		p.rot( R.foreArmR, - 0.8, 0, 0 );
		p.rot( R.upperArmL, - 0.55, 0, 0.35 );
		p.rot( R.foreArmL, - 0.8, 0, 0 );
		p.rot( R.chest, - 0.04 * br, 0, 0 );
		p.rot( R.head, 0.25 + br * 0.03, 0, 0 );

	},

	idle_look( p, s, seed = 0 ) {

		const R = p.R;
		// look left, pause, look right... the noise is slow and stepped
		const look = noise1( s * 0.35, seed + 7 ) * 1.6, tilt = noise1( s * 0.5, seed + 8 ) * 0.15;
		p.rot( R.head, tilt, Math.max( - 1.1, Math.min( 1.1, look ) ) * 0.6, 0 );
		p.rot( R.neck, 0, look * 0.25, 0 );
		p.rot( R.spine, 0, look * 0.1, 0 );
		// hand on hip
		p.rot( R.upperArmL, 0.2, 0, 0.55 );
		p.rot( R.foreArmL, - 1.5, 0, 0 );
		p.o( 'pelvis', Math.sin( s * 0.4 ) * 0.02, 0, 0 );

	}

};

// --- creature actions (any body plan) ---------------------------------------------------
// Each writes cW * (anticipation) + cA * (strike) through role helpers; missing roles
// are ignored, so the same function animates every plan.

function jawOpen( p, a ) {

	const R = p.R;
	p.rot( R.jaw, a, 0, 0 );
	p.rot( R.jawL, 0, a * 0.9, 0 );
	p.rot( R.jawR, 0, - a * 0.9, 0 );

}

function neckBend( p, x, y = 0 ) {

	const R = p.R;
	if ( R.neckChain.length ) p.chain( R.neckChain, x, y, 0 );
	else if ( R.front.length ) p.chain( R.front.slice( - 3 ), x, y, 0 );
	p.rot( R.head, x * 0.5, y * 0.5, 0 );

}

// wings: flare (spread up and out), 0..1
export function wingFlare( p, a ) {

	const R = p.R;
	p.rot( R.wingL, 0, - a * 1.0, a * 0.7 );
	p.rot( R.wingR, 0, a * 1.0, - a * 0.7 );
	p.rot( R.wingL2, 0, - a * 0.6, a * 0.2 );
	p.rot( R.wingR2, 0, a * 0.6, - a * 0.2 );

}

// lift a front foot (or both): y up, z forward
function liftFront( p, l, y, z ) {

	p.foot( l, 0, y, z );

}

const C = {};

C.bite = ( p, c, cW, cA, u, phase ) => {

	const snap = phase === 'active' ? Math.max( 0, 1 - u * 2.2 ) : 0;
	neckBend( p, - 0.7 * cW + 0.8 * cA );
	jawOpen( p, 0.75 * cW + 0.7 * snap * cA );
	p.o( 'root', 0, - 0.04 * cW * c.h, ( - 0.15 * cW + 0.45 * cA ) * c.reach );
	p.r( 'body', - 0.2 * cW + 0.2 * cA, 0, 0 );
	for ( const l of p.R.hindLegs ) p.foot( l, 0, 0, - 0.12 * cA );
	if ( p.R.front.length ) p.chain( p.R.front, - 0.5 * cW + 0.3 * cA, 0, 0 );

};

C.claw = ( p, c, cW, cA, u, phase, v ) => {

	const R = p.R, side = v % 2 ? - 1 : 1;
	if ( R.hasArms ) {

		const up = side > 0 ? R.upperArmL : R.upperArmR, fo = side > 0 ? R.foreArmL : R.foreArmR;
		p.rot( up, - 2.2 * cW - 0.9 * cA, - side * 0.6 * cA, side * ( 0.7 * cW - 0.4 * cA ) );
		p.rot( fo, - 0.8 * cW - 0.1 * cA, 0, 0 );
		p.r( 'body', - 0.1 * cW + 0.15 * cA, side * ( 0.25 * cW - 0.3 * cA ), 0 );

	} else {

		const l = side > 0 ? R.footL : R.footR;
		liftFront( p, l, 0.32 * cW * c.legLen + 0.05 * cA, 0.1 * cW + 0.35 * cA * c.legLen );
		p.r( 'body', - 0.22 * cW + 0.12 * cA, side * 0.15 * cW, side * 0.1 * cW );
		if ( c.plan === 'arachnid' || c.plan === 'hexapod' ) liftFront( p, side > 0 ? R.footR : R.footL, 0.25 * cW * c.legLen, 0.25 * cA * c.legLen );

	}

	neckBend( p, - 0.15 * cW + 0.2 * cA );
	jawOpen( p, 0.3 * cW );
	p.o( 'root', 0, 0, 0.15 * cA * c.reach );

};

C.slam = ( p, c, cW, cA ) => {

	const R = p.R;
	if ( c.plan === 'blob' ) {

		p.o( 'root', 0, 0.7 * cW * c.h, 0 );
		p.scl( R.body, 1 - 0.15 * cW + 0.35 * cA, 1 + 0.25 * cW - 0.45 * cA, 1 - 0.15 * cW + 0.35 * cA );
		return;

	}

	// rear up on the hind legs, then crash down
	p.pivot( 0, 0, - c.len * 0.4, - 0.45 * cW + 0.12 * cA, 0 );
	p.o( 'root', 0, - 0.08 * cA, 0 );
	if ( R.hasArms ) {

		p.rot( R.upperArmL, - 2.8 * cW - 0.8 * cA, 0, 0.3 * cW );
		p.rot( R.upperArmR, - 2.8 * cW - 0.8 * cA, 0, - 0.3 * cW );

	}

	for ( const l of R.frontLegs ) p.foot( l, 0, 0.35 * cW * c.legLen, 0.15 * cW );
	neckBend( p, - 0.3 * cW + 0.35 * cA );
	jawOpen( p, 0.4 * cW );

};

C.charge = ( p, c, cW, cA, u, phase ) => {

	const R = p.R;
	const scrape = phase === 'windup' ? Math.sin( u * Math.PI * 4 ) * cW : 0;
	p.o( 'root', 0, - 0.1 * cW * c.h, ( - 0.15 * cW + 0.35 * cA ) * c.reach );
	p.r( 'body', 0.18 * cW + 0.1 * cA, 0, 0 );
	neckBend( p, 0.4 * cW + 0.35 * cA );
	if ( R.footR >= 0 ) p.foot( R.footR, 0, Math.max( 0, scrape ) * 0.12, scrape * 0.15 );
	for ( const l of R.hindLegs ) p.foot( l, 0, 0, - 0.2 * cA );
	for ( const l of R.frontLegs ) p.foot( l, 0, 0.05 * cA, 0.2 * cA );
	wingFlare( p, 0.3 * cA );

};

C.spit = ( p, c, cW, cA ) => {

	neckBend( p, - 0.5 * cW + 0.45 * cA );
	jawOpen( p, 0.25 * cW + 0.75 * cA );
	p.scl( p.R.chest, 1 + 0.15 * cW, 1 + 0.12 * cW, 1 + 0.1 * cW );
	p.o( 'root', 0, 0, ( 0.05 * cW - 0.12 * cA ) * c.reach );
	if ( p.R.front.length ) p.chain( p.R.front, - 0.6 * cW, 0, 0 );

};

C.roar = ( p, c, cW, cA, u, phase, v, ctx ) => {

	const R = p.R;
	const shake = phase === 'active' ? noise1( ctx.time * 28, 4 ) * 0.08 * cA : 0;
	p.pivot( 0, 0, - c.len * 0.35, 0.12 * cW - 0.35 * cA, 0 );
	neckBend( p, 0.35 * cW - 0.75 * cA, shake * 3 );
	jawOpen( p, 0.95 * cA );
	wingFlare( p, cA );
	if ( R.hasArms ) {

		p.rot( R.upperArmL, 0.3 * cA, 0, 1.2 * cA );
		p.rot( R.upperArmR, 0.3 * cA, 0, - 1.2 * cA );

	}

	p.scl( R.chest, 1 + 0.08 * cA, 1 + 0.08 * cA, 1 + 0.08 * cA );
	if ( R.tail.length ) p.chain( R.tail, - 0.6 * cA, 0, 0 );

};

C.stomp = ( p, c, cW, cA ) => {

	const R = p.R;
	const l = R.footR >= 0 ? R.footR : R.footL;
	p.foot( l, 0, 0.45 * cW * c.legLen, 0.1 * cW + 0.1 * cA );
	if ( R.frontLegs.length > 1 && c.plan !== 'biped' ) p.foot( R.footL, 0, 0.45 * cW * c.legLen, 0.1 * cW + 0.1 * cA );
	p.pivot( 0, 0, - c.len * 0.4, - 0.25 * cW + 0.05 * cA, 0 );
	p.o( 'root', 0, - 0.08 * cA, 0 );
	neckBend( p, - 0.2 * cW + 0.3 * cA );

};

C.tail = ( p, c, cW, cA ) => {

	const R = p.R;
	p.rot( 0, 0, 0.5 * cW - 1.1 * cA, 0 );
	if ( R.tail.length ) {

		const sting = c.stinger;
		if ( sting ) p.chain( R.tail, - 0.5 * cW + 0.9 * cA, 0, 0 );
		else p.chain( R.tail, 0, - 1.2 * cW + 1.8 * cA, 0 );

	}

	if ( R.back.length ) p.chain( R.back, 0, - 1.0 * cW + 1.6 * cA, 0 );
	neckBend( p, 0, 0.3 * cW - 0.3 * cA );

};

C.leap = ( p, c, cW, cA, u, phase ) => {

	const R = p.R;
	p.o( 'root', 0, - 0.15 * cW * c.h, 0 );
	p.r( 'body', 0.2 * cW - 0.25 * cA, 0, 0 );
	for ( const l of R.frontLegs ) p.foot( l, 0, 0.25 * cA * c.legLen, 0.3 * cA * c.legLen );
	for ( const l of R.hindLegs ) p.foot( l, 0, 0.15 * cA * c.legLen, - 0.35 * cA * c.legLen );
	wingFlare( p, cA );
	neckBend( p, 0.2 * cW - 0.3 * cA );
	jawOpen( p, 0.5 * cA );
	if ( c.plan === 'blob' ) p.scl( R.body, 1 + 0.15 * cW - 0.1 * cA, 1 - 0.25 * cW + 0.3 * cA, 1 + 0.15 * cW - 0.1 * cA );
	if ( phase === 'recovery' ) p.o( 'root', 0, - 0.12 * Math.sin( Math.min( 1, u * 1.5 ) * Math.PI ) * c.h, 0 );

};

C.cast = ( p, c, cW, cA ) => {

	const R = p.R;
	p.o( 'root', 0, ( 0.12 * cW + 0.05 * cA ) * c.h, 0.12 * cA );
	neckBend( p, - 0.35 * cW + 0.2 * cA );
	jawOpen( p, 0.4 * cA );
	wingFlare( p, 0.6 * cW + 0.4 * cA );
	if ( R.hasArms ) {

		p.rot( R.upperArmL, - 2.0 * cW - 1.4 * cA, 0, 0.6 * cW );
		p.rot( R.upperArmR, - 2.0 * cW - 1.4 * cA, 0, - 0.6 * cW );

	}

	if ( c.plan === 'floater' || c.plan === 'blob' ) p.scl( R.body, 1 + 0.12 * cW, 1 + 0.12 * cW, 1 + 0.12 * cW );

};

C.summon = ( p, c, cW, cA ) => {

	const R = p.R;
	p.o( 'root', 0, ( 0.25 * cW - 0.05 * cA ) * c.h, 0 );
	p.pivot( 0, 0, - c.len * 0.3, - 0.3 * cW + 0.1 * cA, 0 );
	neckBend( p, - 0.6 * cW + 0.3 * cA );
	jawOpen( p, 0.7 * cW );
	wingFlare( p, cW );
	if ( R.hasArms ) {

		p.rot( R.upperArmL, - 2.8 * cW - 1.0 * cA, 0, 0.9 * cW );
		p.rot( R.upperArmR, - 2.8 * cW - 1.0 * cA, 0, - 0.9 * cW );

	}

};

C.burrow = ( p, c, cW, cA, u, phase ) => {

	const R = p.R;
	const dig = phase === 'windup' ? Math.sin( u * Math.PI * 6 ) : 0;
	p.r( 'body', 0.35 * cW, 0, 0 );
	for ( const l of R.frontLegs ) p.foot( l, 0, Math.max( 0, dig ) * 0.15, dig * 0.12 );
	p.o( 'root', 0, - ( 0.15 * cW + 1.2 * cA ) * c.h, 0 );
	neckBend( p, 0.5 * cW );

};

C.breath = ( p, c, cW, cA, u, phase ) => {

	const sweep = phase === 'active' ? Math.sin( u * TAU ) * 0.5 * cA : 0;
	neckBend( p, - 0.5 * cW + 0.35 * cA, sweep );
	jawOpen( p, 0.15 * cW + 0.85 * cA );
	p.scl( p.R.chest, 1 + 0.18 * cW, 1 + 0.12 * cW, 1 + 0.12 * cW );
	p.o( 'root', 0, 0, - 0.08 * cA * c.reach );
	wingFlare( p, 0.5 * cA );

};

// any action name the rig layer does not know: draw back, strike, settle
C.generic = ( p, c, cW, cA ) => {

	const R = p.R;
	p.o( 'root', 0, 0, ( - 0.1 * cW + 0.25 * cA ) * c.reach );
	p.r( 'body', - 0.15 * cW + 0.15 * cA, 0, 0 );
	neckBend( p, - 0.3 * cW + 0.35 * cA );
	jawOpen( p, 0.4 * cW + 0.2 * cA );
	if ( R.hasArms ) {

		p.rot( R.upperArmR, - 1.8 * cW - 1.2 * cA, 0, - 0.4 * cW );
		p.rot( R.foreArmR, - 0.8 * cW, 0, 0 );

	}

};

export const CREATURE_ACTIONS = C;
