// Procedural animation: turns the ANIMATION CONTRACT ( entity.anim, docs/GAME.md §3 )
// into a pose for any rig template. No clips, no keyframe files - every frame is
// computed from state, phase, speed, aim and hit direction, so 10 000 different
// monsters all move correctly without anyone authoring their animations.
//
// Per frame, per entity ( animateRig ):
//   1. transition check  a new state / action / death starts a CROSSFADE: the current
//                        pose is snapshotted and blended into the new target (~50-150 ms)
//   2. locomotion        gait cycle by plan: IK foot planting (stance feet move back at
//                        exactly ground speed so they never slide), tripod / trot / walk
//                        phase offsets, serpentine waves, floater bob, blob hops, wing flaps
//   3. state layer       action poses ( actions.js ), dodge roll, stun wobble, death, spawn
//   4. reactions         hit flinch along hitDir, head look-at toward aim (or the player
//                        for NPCs), lean into velocity and turns
//   5. secondary motion  spring chains (tails, antennae, tentacles, crests, capes) driven
//                        by the body's acceleration and turn rate
//   6. solve             FK + two-bone IK ( rig.js ) -> bone world matrices
//
// Sim-safe (no three.js): the renderer calls it, but Node tools can pose rigs too.

import { restPose, solveSkeleton, solveArmIK } from './rig.js';
import { Poser, roleTable, compileKey } from './poser.js';
import { HUMANOID_KEYS, CREATURE_ACTIONS, EMOTES, GLOW_ACTIONS, CARRY, humanoidExtra, wingFlare } from './actions.js';
import { clamp, lerp, smooth, easeOutCubic, easeOutExpo, easeOutBack, easeInOut, noise1, hash01, wrapAngle, spring, composeYXZ, xformPoint, TAU } from './math.js';

// Expected windup / active boundaries per action (fractions of the timeline). The
// contract only reports the CURRENT phase, so the animator starts from these and
// corrects itself the moment it sees the phase change.
const PHASE_EST = {
	slash: [ 0.3, 0.55 ], thrust: [ 0.35, 0.55 ], overhead: [ 0.45, 0.62 ], slam: [ 0.5, 0.65 ], spin: [ 0.2, 0.75 ],
	leap: [ 0.3, 0.75 ], dash: [ 0.15, 0.8 ], cast: [ 0.4, 0.6 ], cast_aoe: [ 0.45, 0.65 ], channel: [ 0.15, 0.9 ],
	shoot: [ 0.55, 0.7 ], throw: [ 0.45, 0.6 ], shout: [ 0.35, 0.75 ], block: [ 0.2, 0.85 ], kick: [ 0.35, 0.55 ],
	drink: [ 0.3, 0.75 ], bite: [ 0.55, 0.7 ], claw: [ 0.45, 0.62 ], charge: [ 0.35, 0.8 ], spit: [ 0.5, 0.65 ],
	roar: [ 0.3, 0.8 ], stomp: [ 0.5, 0.65 ], tail: [ 0.45, 0.62 ], summon: [ 0.5, 0.8 ], burrow: [ 0.4, 0.9 ], breath: [ 0.35, 0.85 ]
};

const EMOTE_NAMES = new Set( Object.keys( EMOTES ) );
// actions where a two-handed wielder lets go with the left hand
const FREE_LEFT = new Set( [ 'cast', 'throw', 'drink', 'shoot', 'shout', 'roar', 'kick', 'claw' ] );

export class RigInstance {

	constructor( T, seed = 0 ) {

		this.T = T;
		const n = T.poseSize;
		this.target = restPose( T, new Float32Array( n ) );
		this.pose = restPose( T, new Float32Array( n ) );
		this.from = restPose( T, new Float32Array( n ) );
		this.final = restPose( T, new Float32Array( n ) );
		this.W = new Float32Array( T.nb * 12 );
		this.root = new Float32Array( 12 );
		this.seed = seed;
		this.phase = hash01( seed, 1 );
		this.flap = hash01( seed, 2 );
		this.key = '';
		this.blendT = 1; this.blendDur = 0.1;
		this.stateTime = 0;
		let cn = 0;
		for ( const c of T.chains ) cn += c.bones.length;
		this.springs = new Float32Array( cn * 4 );
		this.px = NaN; this.pz = 0; this.pf = 0;
		this.vx = 0; this.vz = 0; this.yawRate = 0; this.accF = 0; this.accS = 0;
		this.mark = { w: 0.35, a: 0.6, wSeen: false, aSeen: false, last: null };
		this.lookYaw = 0; this.lookPitch = 0;
		this.glow = 0; this.flash = 0; this.dissolve = 0; this.scatter = 0.6; this.extraScale = 1;
		this.greet = - 1; this.near = false;
		this.fxState = new Float32Array( T.nb );
		this.fxLast = [];
		this.attach = new Float32Array( 18 ); // weaponBase, weaponTip, handL, handR, head, chest (x y z)
		this.visible = true;
		this.cW = 0; this.cA = 0;

	}

}

const poser = new Poser();
const _p = new Float32Array( 3 );
const ATTACH_KEYS = [ 'weaponBase', 'weaponTip', 'handL', 'handR', 'head', 'chest' ];

// ctx: { dt, time, worldTime, x, y, z, facing, size, kind, boss, player: {x,z}|null, emote, state }
export function animateRig( inst, e, ctx ) {

	const T = inst.T, a = e.anim, dt = Math.max( 1e-4, Math.min( 0.1, ctx.dt ) );
	roleTable( T );
	const meta = T.meta || {};
	const size = ctx.size;

	// --- motion estimates (local frame) -------------------------------------------------
	if ( Number.isNaN( inst.px ) ) {

		inst.px = ctx.x; inst.pz = ctx.z; inst.pf = ctx.facing;

	}

	const cf = Math.cos( ctx.facing ), sf = Math.sin( ctx.facing );
	const wvx = e.vx ?? ( ctx.x - inst.px ) / dt, wvz = e.vz ?? ( ctx.z - inst.pz ) / dt;
	const lvx = wvx * cf - wvz * sf, lvz = wvx * sf + wvz * cf;
	const k = Math.min( 1, dt * 10 );
	const accF = ( lvz - inst.vz ) / dt, accS = ( lvx - inst.vx ) / dt;
	inst.accF += ( clamp( accF, - 40, 40 ) - inst.accF ) * k;
	inst.accS += ( clamp( accS, - 40, 40 ) - inst.accS ) * k;
	inst.vx = lvx; inst.vz = lvz;
	inst.yawRate += ( clamp( wrapAngle( ctx.facing - inst.pf ) / dt, - 20, 20 ) - inst.yawRate ) * k;
	inst.px = ctx.x; inst.pz = ctx.z; inst.pf = ctx.facing;

	// --- transitions -------------------------------------------------------------------
	const state = e.alive === false ? 'dead' : a.state;
	const act = state === 'action' ? a.action || 'generic' : null;
	const key = state === 'action' ? 'a:' + act + ':' + a.seq : state === 'dodge' ? 'd:' + a.seq : state === 'idle' || state === 'move' || state === 'hit' ? 'loco' : state;
	if ( key !== inst.key ) {

		const prev = inst.key;
		inst.from.set( inst.pose );
		inst.blendT = 0;
		inst.blendDur = state === 'action' ? ( prev.startsWith( 'a:' ) ? 0.045 : 0.06 ) : state === 'dodge' ? 0.04 : state === 'dead' ? 0.08 : state === 'spawn' ? 0 : 0.14;
		inst.key = key;
		inst.stateTime = 0;
		if ( state === 'action' ) {

			const est = PHASE_EST[ act ] || [ 0.35, 0.6 ];
			inst.mark.w = est[ 0 ]; inst.mark.a = est[ 1 ]; inst.mark.wSeen = false; inst.mark.aSeen = false; inst.mark.last = a.phase;

		}

	} else inst.stateTime += dt;

	const c = ctx;
	c.plan = meta.plan || 'humanoid';
	c.legLen = T.legs.length ? ( T.legs[ 0 ].a + T.legs[ 0 ].b ) : 0.8;
	c.h = Math.max( 0.3, T.dims.height );
	c.len = Math.max( 0.3, T.dims.length );
	c.reach = clamp( T.dims.front + 0.2, 0.4, 1.2 );
	c.stinger = !! T.attach.stinger;
	c.speed = ( a.speed ?? Math.hypot( wvx, wvz ) ) / size;
	c.lvx = lvx / size; c.lvz = lvz / size;

	// --- target pose ---------------------------------------------------------------------
	const P = restPose( T, inst.target );
	const p = poser.bind( T, P );
	inst.extraScale = 1;
	let upper = 1;
	if ( state === 'action' ) upper = 0;
	else if ( state === 'dodge' || state === 'dead' || state === 'stun' ) upper = 0;

	if ( T.kind === 'prop' || T.kind === 'loot' ) {

		applyFx( inst, p, e, ctx );
		propState( inst, p, e, ctx, state );

	} else {

		locomotion( inst, p, c, dt, upper, state );
		applyFx( inst, p, e, ctx );
		let cA = 0, cW = 0;
		if ( state === 'action' ) {

			actionPose( inst, p, e, c, act );
			cW = inst.cW; cA = inst.cA;

		} else if ( state === 'dodge' ) dodgePose( inst, p, c );
		else if ( state === 'stun' ) stunPose( inst, p, c );
		else if ( state === 'dead' ) deathPose( inst, p, e, c );
		else if ( state === 'spawn' ) spawnPose( inst, p, e, c );
		else npcIdle( inst, p, e, c );

		// glow: casters light up their runes, eyes and crystals
		const gTarget = state === 'action' && GLOW_ACTIONS.has( act ) ? 0.5 * cW + cA : 0;
		inst.glow += ( gTarget - inst.glow ) * Math.min( 1, dt * ( gTarget > inst.glow ? 20 : 5 ) );
		if ( state !== 'dead' ) {

			flinch( inst, p, e, c );
			lookAt( inst, p, e, c, state );

		}

	}

	// --- blend ------------------------------------------------------------------------------
	const n = T.poseSize, pose = inst.pose;
	if ( inst.blendT < inst.blendDur ) {

		inst.blendT += dt;
		const w = smooth( inst.blendT / inst.blendDur ), from = inst.from;
		for ( let i = 0; i < n; i ++ ) pose[ i ] = from[ i ] + ( P[ i ] - from[ i ] ) * w;

	} else pose.set( P );

	// --- secondary motion --------------------------------------------------------------------
	const F = inst.final;
	F.set( pose );
	if ( T.chains.length ) springsStep( inst, F, c, dt, state );

	// --- solve ---------------------------------------------------------------------------------
	const s = size * inst.extraScale;
	composeYXZ( inst.root, 0, ctx.x, ctx.y, ctx.z, 0, ctx.facing, 0, s, s, s );
	solveSkeleton( T, F, inst.root, inst.W );
	// two-handed weapons: the off hand rides the haft (IK), except when it is busy
	const g2 = meta.grip2;
	if ( g2 ) {

		const want = state === 'dodge' || state === 'dead' || state === 'stun' || ( state === 'action' && FREE_LEFT.has( act ) ) ? 0 : 1;
		inst.ik2 = ( inst.ik2 ?? want ) + ( want - ( inst.ik2 ?? want ) ) * Math.min( 1, dt * 14 );
		if ( inst.ik2 > 0.01 ) {

			const R2 = roleTable( T );
			solveArmIK( T, inst.W, R2.upperArmL, R2.foreArmL, R2.handL, g2.bone, g2.pos, inst.ik2, s );

		}

	}
	// attachments for VFX
	const W = inst.W;
	for ( let i = 0; i < 6; i ++ ) {

		const at = T.attach[ ATTACH_KEYS[ i ] ];
		if ( at ) {

			xformPoint( _p, 0, W, at.bone * 12, at.pos[ 0 ], at.pos[ 1 ], at.pos[ 2 ] );
			inst.attach[ i * 3 ] = _p[ 0 ]; inst.attach[ i * 3 + 1 ] = _p[ 1 ]; inst.attach[ i * 3 + 2 ] = _p[ 2 ];

		} else {

			inst.attach[ i * 3 ] = ctx.x + sf * 0.4 * s; inst.attach[ i * 3 + 1 ] = ctx.y + 1 * s; inst.attach[ i * 3 + 2 ] = ctx.z + cf * 0.4 * s;

		}

	}

	return inst;

}

// --- locomotion ---------------------------------------------------------------------------

function locomotion( inst, p, c, dt, upper, state ) {

	const T = inst.T, R = p.R, g = T.meta.gait || {}, plan = c.plan;
	if ( plan === 'serpent' ) return serpentLoco( inst, p, c, dt );
	if ( plan === 'blob' ) return blobLoco( inst, p, c, dt );
	if ( plan === 'floater' ) return floaterLoco( inst, p, c, dt );
	const flying = plan === 'avian' && g.fly;
	if ( flying ) flyLoco( inst, p, c, dt );
	else if ( R.wingL >= 0 ) foldWings( p, c );
	if ( ! T.legs.length ) return;

	const humanoid = R.humanoid;
	const v = flying ? 0 : c.speed, legLen = c.legLen;
	const runK = humanoid ? smooth( ( v - 2.6 ) / 2.4 ) : smooth( ( v / legLen - 2.2 ) / 3 );
	const duty = humanoid ? lerp( 0.6, 0.36, runK ) : ( g.duty ?? 0.55 ) - 0.12 * runK;
	const f0 = ( g.baseCadence ?? 1 ) * ( g.cadence ?? 1 ) * ( humanoid ? 0.95 : 1 );
	const sMax = legLen * ( humanoid ? 0.9 + 0.3 * runK : 0.85 ) * ( g.stride ?? 1 );
	let S = v * duty / f0, f = f0;
	if ( S > sMax ) {

		S = sMax; f = v * duty / sMax;

	}

	const amp = smooth( v / ( 0.25 + 0.35 * legLen ) );
	inst.phase = ( inst.phase + f * dt * ( 0.35 + 0.65 * amp ) ) % 1;
	const ph = inst.phase;
	let mx = 0, mz = 1;
	const vl = Math.hypot( c.lvx, c.lvz );
	if ( vl > 0.05 ) {

		mx = c.lvx / vl; mz = c.lvz / vl;

	}

	const legs = T.legs, FOOT = T.nb * 9;
	for ( let i = 0; i < legs.length; i ++ ) {

		const L = legs[ i ];
		const q = ( ph + L.phase ) % 1;
		let d, y = 0, pitch = 0;
		if ( q < duty ) {

			const s = q / duty;
			d = 0.5 - s;
			if ( humanoid ) pitch = s > 0.7 ? ( s - 0.7 ) / 0.3 * 0.7 : 0; // heel lifts before toe-off

		} else {

			const s = ( q - duty ) / ( 1 - duty );
			d = - 0.5 + ( 1 - Math.cos( Math.PI * s ) ) / 2;
			y = Math.sin( Math.PI * s ) * L.lift * ( 0.7 + 0.5 * runK );
			// runners kick the heel up behind them early in the swing
			if ( humanoid ) y += runK * L.lift * 1.1 * Math.sin( Math.PI * Math.min( 1, s * 1.7 ) ) * ( 1 - s );
			if ( humanoid ) pitch = 0.7 * ( 1 - s ) - 0.35 * Math.sin( Math.PI * s * 0.8 ) * runK;

		}

		if ( flying ) continue;
		p.P[ FOOT + i * 3 ] += mx * d * S;
		p.P[ FOOT + i * 3 + 1 ] += y * amp;
		p.P[ FOOT + i * 3 + 2 ] += mz * d * S;
		if ( L.foot >= 0 && humanoid ) p.rot( L.foot, pitch * amp, 0, 0 );

	}

	if ( flying ) return;
	const bounce = ( g.baseBounce ?? 0.04 ) * ( g.bounce ?? 1 );
	const lean = clamp( c.lvz * 0.035, - 0.15, 0.3 ) + ( g.posture ?? 0 ) * 0.25 * amp + clamp( inst.accF * 0.004, - 0.12, 0.12 );
	const turnRoll = clamp( - inst.yawRate * v * 0.012, - 0.25, 0.25 );

	if ( humanoid ) {

		humanoidLoco( inst, p, c, ph, amp, runK, upper, lean, turnRoll, bounce );
		return;

	}

	// generic legged body: bob twice per cycle, lean, roll into turns, spine flex
	const bob = - bounce * amp * ( 0.5 - 0.5 * Math.cos( 4 * Math.PI * ph ) ) - 0.02 * runK;
	p.o( 'body', 0, bob, 0 );
	p.r( 'body', lean * 0.6, 0, turnRoll * 0.6 );
	if ( R.spineChain.length ) p.chain( R.spineChain, 0, Math.sin( TAU * ph ) * 0.08 * amp, 0 );
	if ( g.style === 'bound' ) p.r( 'body', Math.sin( TAU * ph ) * 0.12 * amp, 0, 0 );
	if ( R.abdomen >= 0 ) p.rot( R.abdomen, Math.cos( 4 * Math.PI * ph ) * 0.03 * amp, Math.sin( TAU * ph ) * 0.1 * amp, 0 );
	// keep the head steady: counter the bob and lean
	if ( R.neckChain.length ) p.chain( R.neckChain, - lean * 0.5 - bob * 1.5, 0, 0 );
	if ( plan === 'avian' ) {

		// pigeon head bob: the head darts forward each step, then holds
		const hb = Math.pow( Math.max( 0, Math.sin( 4 * Math.PI * ph ) ), 3 ) * 0.25 * amp;
		p.chain( R.neckChain, hb, 0, 0 );
		p.rot( R.head, - hb * 0.8, 0, 0 );

	}

	idleLife( inst, p, c, 1 - amp );

}

// Upright two-legged bodies: hero, NPCs, biped monsters.
function humanoidLoco( inst, p, c, ph, amp, runK, upper, lean, turnRoll, bounce ) {

	const R = p.R, T = inst.T, t = c.time;
	const cyc = Math.cos( TAU * ph );
	// pelvis: drop into the run, bob twice per cycle, rotate with the stride
	const bobW = 0.022 * Math.cos( 4 * Math.PI * ph ) * ( 1 - runK );
	const bobR = - 0.045 * Math.abs( Math.cos( 2 * Math.PI * ph ) ) * runK;
	p.o( 'pelvis', 0, ( - 0.025 - 0.05 * runK + bobW + bobR ) * amp * ( 0.6 + bounce * 8 ), 0 );
	p.rot( R.pelvis, 0, - 0.12 * cyc * amp * ( 1 - 0.3 * runK ), 0.035 * Math.sin( TAU * ph ) * amp * ( 1 - runK ) + turnRoll * 0.5 );
	// torso: counter-rotate the shoulders, lean into speed and acceleration
	p.rot( R.spine, lean + 0.06 * amp + 0.12 * runK * amp, 0.16 * cyc * amp * upper, turnRoll * 0.4 );
	p.rot( R.chest, 0.04 * runK * amp, 0.06 * cyc * amp * upper, 0 );
	p.rot( R.head, - ( lean + 0.1 * runK * amp ) * 0.7, - 0.1 * cyc * amp * upper, 0 );
	// arms swing opposite to the legs (L arm back when L foot is forward)
	const swing = ( 0.32 + 0.6 * runK ) * amp * upper;
	const stance = T.meta.stance;
	// the weapon hand swings less (it carries the weapon); two-handers and bows also calm the left
	const kR = stance === 'onehand' || stance === 'twohand' ? 0.3 : 1, kL = stance === 'twohand' || stance === 'bow' ? 0.35 : 1;
	p.rot( R.upperArmL, swing * cyc * kL, 0, ( 0.05 + 0.12 * runK ) * upper );
	p.rot( R.foreArmL, ( - ( 0.15 + 1.05 * runK * amp ) * upper - 0.15 * Math.max( 0, - cyc ) * amp * upper ) * kL, 0, 0 );
	p.rot( R.upperArmR, - swing * cyc * kR, 0, - ( 0.05 + 0.12 * runK ) * upper );
	p.rot( R.foreArmR, ( - ( 0.15 + 1.05 * runK * amp ) * upper - 0.15 * Math.max( 0, cyc ) * amp * upper ) * kR, 0, 0 );
	// weapon stances: how the hero carries each weapon class at rest and on the run
	if ( stance ) carryStance( p, stance, amp, runK, upper );
	// idle: breathing, weight shift, a staggered ready stance
	const idle = 1 - amp;
	if ( idle > 0.01 ) {

		const br = Math.sin( t * TAU / 3.4 + inst.seed );
		p.rot( R.chest, - 0.03 * br * idle, 0, 0 );
		p.rot( R.head, 0.02 * br * idle, 0, 0 );
		p.o( 'pelvis', Math.sin( t * 0.55 + inst.seed ) * 0.012 * idle, - 0.015 * idle, 0 );
		p.rot( R.upperArmL, 0.03 * br * idle * upper, 0, 0.04 * idle * upper );
		p.rot( R.upperArmR, 0.03 * br * idle * upper, 0, - 0.04 * idle * upper );
		if ( stance && stance !== 'none' ) {

			p.foot( R.footL, 0.03 * idle, 0, 0.07 * idle );
			p.foot( R.footR, - 0.03 * idle, 0, - 0.07 * idle );
			p.rot( R.spine, 0, 0.12 * idle * upper, 0 );
			p.rot( R.head, 0, - 0.1 * idle * upper, 0 );
			p.o( 'pelvis', 0, - 0.03 * idle, 0 );

		}

	}

	idleLife( inst, p, c, idle );

}

// How each weapon class is held: fitted key poses ( actions.js CARRY ) - the idle
// carry also serves walking; the run carry (blade trailing low behind) fades in with
// the run. Added on top of the arm swing; fades with `upper` (0 during actions).
function carryStance( p, stance, amp, runK, upper ) {

	const K = CARRY[ stance ];
	if ( ! K || upper <= 0 ) return;
	const run = runK * amp;
	p.key( compileKey( p.T, K.idle ), ( 1 - run ) * upper );
	p.key( compileKey( p.T, K.run ), run * upper );

}

// Personality fidgets for creatures (and everyone else at rest): sniffs, shuffles, twitches.
function idleLife( inst, p, c, idle ) {

	if ( idle < 0.02 ) return;
	const pers = inst.T.meta.personality;
	if ( ! pers ) return;
	const R = p.R, t = c.time, s = inst.seed;
	const br = Math.sin( t * TAU / ( 2.6 + hash01( s, 5 ) ) );
	p.scl( R.chest, 1 + 0.025 * br * idle, 1 + 0.02 * br * idle, 1 + 0.025 * br * idle );
	const fid = pers.fidget ?? 0.5, tw = pers.twitch ?? 0.3;
	const look = noise1( t * ( 0.25 + fid * 0.5 ), s ) * ( 0.3 + fid * 0.6 );
	const nod = noise1( t * 0.4, s + 11 ) * 0.2;
	p.rot( R.head, nod * idle, look * idle, 0 );
	if ( R.neckChain.length ) p.chain( R.neckChain, 0, look * 0.4 * idle, 0 );
	if ( tw > 0.4 ) {

		// sharp twitches: quantised noise snaps the head now and then
		const q = Math.floor( t * ( 1 + tw * 3 ) );
		if ( hash01( q, s ) > 0.82 ) p.rot( R.head, ( hash01( q, s + 1 ) - 0.5 ) * 0.4 * idle, ( hash01( q, s + 2 ) - 0.5 ) * 0.6 * idle, 0 );

	}

	if ( pers.idle === 'sniff' ) p.rot( R.head, Math.max( 0, Math.sin( t * 9 ) ) * 0.06 * idle * ( noise1( t * 0.3, s ) > 0.2 ? 1 : 0 ), 0, 0 );
	if ( pers.idle === 'sway' ) p.r( 'body', 0, 0, Math.sin( t * 1.1 + s ) * 0.04 * idle );
	if ( pers.idle === 'shuffle' && inst.T.legs.length ) {

		const l = Math.floor( t * 0.7 + s ) % inst.T.legs.length, w = Math.max( 0, Math.sin( ( t * 0.7 + s ) % 1 * Math.PI ) );
		p.foot( l, 0, 0.05 * w * idle, 0.03 * w * idle );

	}

	// aggressive creatures crouch, lean in and keep the jaw a little open
	const ag = pers.aggression ?? 0.5;
	if ( ag > 0.6 ) {

		p.o( 'body', 0, - 0.03 * ( ag - 0.6 ) * 2.5 * idle, 0 );
		p.rot( R.jaw, 0.1 * ( ag - 0.6 ) * 2.5 * idle * ( 0.5 + 0.5 * br ), 0, 0 );

	}

}

function serpentLoco( inst, p, c, dt ) {

	const R = p.R, v = c.speed;
	const amp = smooth( v / 1.2 );
	inst.phase = ( inst.phase + dt * ( 0.25 + v * 0.55 ) ) % 1;
	const ph = inst.phase * TAU, A = 0.08 + 0.3 * amp, kk = 0.95;
	const nf = R.front.length;
	let sum = 0;
	for ( let i = 0; i < nf; i ++ ) {

		const y = A * Math.sin( ph + ( nf - i ) * kk ) * ( 0.5 + 0.5 * i / nf );
		p.rot( R.front[ i ], 0, y, 0 );
		sum += y;

	}

	for ( let i = 0; i < R.back.length; i ++ ) p.rot( R.back[ i ], 0, - A * Math.sin( ph - ( i + 1 ) * kk ) * ( 1 + i * 0.08 ), 0 );
	// head stays aimed forward, the body drops its rear-up a little at speed
	p.rot( R.head, 0, - sum * 0.85, 0 );
	if ( nf ) p.chain( R.front.slice( 0, 3 ), 0.25 * amp, 0, 0 );
	p.o( 'body', 0, 0, 0 );
	idleLife( inst, p, c, 1 - amp );

}

function blobLoco( inst, p, c, dt ) {

	const R = p.R, v = c.speed, g = inst.T.meta.gait || {};
	const amp = smooth( v / 0.6 );
	const duty = g.duty ?? 0.45;
	inst.phase = ( inst.phase + dt * ( g.baseCadence ?? 1.3 ) * ( g.cadence ?? 1 ) * ( 0.25 + 0.75 * amp + v * 0.15 ) ) % 1;
	const s = inst.phase;
	let y = 0, sy, sxz;
	if ( s < duty ) {

		// on the ground: landing squash decays, then a crouch before the next hop
		const q = s / duty;
		const squash = Math.exp( - q * 5 ) * 0.28 + Math.max( 0, ( q - 0.65 ) / 0.35 ) * 0.18;
		sy = 1 - squash * amp; sxz = 1 + squash * 0.55 * amp;

	} else {

		const q = ( s - duty ) / ( 1 - duty );
		y = Math.sin( Math.PI * q ) * 0.32 * c.h * amp;
		const st = Math.sin( Math.PI * q ) * 0.16 * amp;
		sy = 1 + st; sxz = 1 - st * 0.5;

	}

	// idle jiggle (always a little alive)
	const j = Math.sin( c.time * 3.1 + inst.seed ) * 0.035 * ( 1 - amp * 0.5 );
	p.scl( R.body, sxz - j * 0.5, sy + j, sxz - j * 0.5 );
	p.o( 'root', 0, y, 0 );
	p.r( 'body', clamp( c.lvz * 0.05, - 0.1, 0.2 ), 0, clamp( - c.lvx * 0.05, - 0.15, 0.15 ) );

}

function floaterLoco( inst, p, c, dt ) {

	const R = p.R, t = c.time + inst.seed;
	const bob = Math.sin( t * 1.7 ) * 0.07 + Math.sin( t * 0.63 ) * 0.04;
	p.o( 'body', 0, bob, 0 );
	p.r( 'body', clamp( c.lvz * 0.07, - 0.35, 0.35 ) + Math.sin( t * 0.9 ) * 0.04, Math.sin( t * 0.37 ) * 0.1, clamp( - c.lvx * 0.07, - 0.3, 0.3 ) + Math.sin( t * 1.3 ) * 0.03 );
	if ( R.wingL >= 0 ) {

		inst.flap = ( inst.flap + dt * ( 0.9 + c.speed * 0.3 ) ) % 1;
		const fl = Math.sin( inst.flap * TAU ) * 0.45;
		p.rot( R.wingL, 0, 0, fl ); p.rot( R.wingR, 0, 0, - fl );
		p.rot( R.wingL2, 0, 0, fl * 0.6 ); p.rot( R.wingR2, 0, 0, - fl * 0.6 );

	}

	idleLife( inst, p, c, 1 );

}

function flyLoco( inst, p, c, dt ) {

	const R = p.R, T = inst.T, v = c.speed;
	inst.flap = ( inst.flap + dt * ( 2.6 + v * 0.35 ) ) % 1;
	const f = inst.flap * TAU;
	const hover = T.meta.hover || 1.2;
	p.o( 'root', 0, hover + Math.sin( f + Math.PI ) * 0.06, 0 );
	const fl = Math.sin( f ) * 0.95 + 0.15;
	p.rot( R.wingL, 0, 0.1, fl ); p.rot( R.wingR, 0, - 0.1, - fl );
	p.rot( R.wingL2, 0, 0, Math.sin( f - 0.9 ) * 0.55 ); p.rot( R.wingR2, 0, 0, - Math.sin( f - 0.9 ) * 0.55 );
	p.r( 'body', clamp( 0.1 + c.lvz * 0.05, - 0.2, 0.45 ), 0, clamp( - inst.yawRate * 0.08, - 0.4, 0.4 ) );
	// legs tucked up under the body
	T.legs.forEach( ( L, i ) => {

		const tk = L.tuck || [ 0, 0.3, - 0.1 ];
		p.foot( i, tk[ 0 ] * L.side, tk[ 1 ], tk[ 2 ] );

	} );
	if ( R.neckChain.length ) p.chain( R.neckChain, - 0.15, 0, 0 );

}

function foldWings( p, c ) {

	const R = p.R;
	// folded along the back; a slow breath ruffle
	const b = Math.sin( c.time * 1.3 ) * 0.04;
	p.rot( R.wingL, 0, 1.5, 0.18 + b ); p.rot( R.wingR, 0, - 1.5, - 0.18 - b );
	p.rot( R.wingL2, 0, 1.9, 0 ); p.rot( R.wingR2, 0, - 1.9, 0 );

}

// --- actions --------------------------------------------------------------------------------

function phaseLocal( inst, t, phase ) {

	const m = inst.mark;
	if ( phase !== m.last ) {

		if ( phase === 'active' && ! m.wSeen ) {

			m.w = t; m.wSeen = true;

		} else if ( phase === 'recovery' && ! m.aSeen ) {

			m.a = Math.max( t, m.w + 0.01 ); m.aSeen = true;

		}

		m.last = phase;

	}

	if ( phase === 'windup' ) return clamp( t / Math.max( 0.01, m.w ), 0, 1 );
	if ( phase === 'active' ) return clamp( ( t - m.w ) / Math.max( 0.01, m.a - m.w ), 0, 1 );
	return clamp( ( t - m.a ) / Math.max( 0.01, 1 - m.a ), 0, 1 );

}

function actionPose( inst, p, e, c, act ) {

	const a = e.anim, R = p.R, T = inst.T;
	const phase = a.phase || ( a.t < 0.35 ? 'windup' : a.t < 0.6 ? 'active' : 'recovery' );
	const u = phaseLocal( inst, a.t ?? 0, phase );
	let cW = 0, cA = 0;
	if ( phase === 'windup' ) cW = easeOutCubic( u );
	else if ( phase === 'active' ) {

		const ex = easeOutExpo( u );
		cW = 1 - ex; cA = ex;

	} else cA = 1 - easeOutBack( u, 1.4 );

	// NPC emotes loop on their own clock
	if ( EMOTE_NAMES.has( act ) ) {

		EMOTES[ act ]( p, inst.stateTime, inst.seed );
		inst.cW = inst.cA = 0;
		return;

	}

	const v = a.variant ?? 0;
	if ( R.humanoid ) {

		const name = act === 'slash' ? 'slash' + ( v % 3 ) : act === 'claw' ? 'claw' + ( v % 2 ) : act;
		const H = HUMANOID_KEYS[ name ] || ( CREATURE_ACTIONS[ act ] ? null : HUMANOID_KEYS.slash1 );
		if ( H ) {

			if ( H.M && phase === 'active' ) {

				// three-key swing: windup -> impact -> follow-through, one fast eased sweep
				let cM;
				const e2 = 1 - Math.pow( 1 - u, 2.6 );
				if ( e2 < 0.5 ) {

					cM = e2 * 2; cW = 1 - cM; cA = 0;

				} else {

					cA = ( e2 - 0.5 ) * 2; cM = 1 - cA; cW = 0;

				}

				p.key( compileKey( T, H.M ), cM );

			}

			p.key( compileKey( T, H.W ), cW );
			p.key( compileKey( T, H.A ), cA );
			c.easeSpin = phase === 'active' ? easeInOut( u ) : 0;
			humanoidExtra( p, act, cW, cA, u, phase, c );
			inst.cW = cW; inst.cA = cA;
			return;

		}

	}

	const fn = CREATURE_ACTIONS[ act ] || CREATURE_ACTIONS.generic;
	fn( p, c, cW, cA, u, phase, v, c );
	inst.cW = cW; inst.cA = cA;

}

// --- reactions --------------------------------------------------------------------------------

function dodgePose( inst, p, c ) {

	const R = p.R, u = clamp( inst.stateTime / 0.3, 0, 1 );
	if ( R.humanoid ) {

		// forward roll: tuck into a ball, turn once about its centre, open out
		const tuck = Math.sin( Math.PI * Math.min( 1, u * 1.1 ) );
		p.pivot( 0, 0.52 + 0.06 * tuck, 0.1, TAU * easeInOut( u ), 0 );
		p.o( 'pelvis', 0, - 0.36 * tuck, 0.05 * tuck );
		p.rot( R.spine, 1.0 * tuck, 0, 0 );
		p.rot( R.chest, 0.5 * tuck, 0, 0 );
		p.rot( R.head, 0.7 * tuck, 0, 0 );
		p.rot( R.upperArmL, - 1.3 * tuck, 0, - 0.3 * tuck );
		p.rot( R.upperArmR, - 1.3 * tuck, 0, 0.3 * tuck );
		p.rot( R.foreArmL, - 1.7 * tuck, 0, 0 );
		p.rot( R.foreArmR, - 1.7 * tuck, 0, 0 );
		p.foot( R.footL, 0, 0.55 * tuck, 0.22 * tuck );
		p.foot( R.footR, 0, 0.5 * tuck, 0.12 * tuck );
		return;

	}

	// creatures: a low skittering hop
	const hop = Math.sin( Math.PI * u );
	p.o( 'root', 0, 0.25 * hop * c.h, 0 );
	p.r( 'body', - 0.2 * hop, 0, 0 );
	for ( let i = 0; i < inst.T.legs.length; i ++ ) p.foot( i, 0, 0.15 * hop, 0 );

}

function stunPose( inst, p, c ) {

	const R = p.R, t = c.time * 6 + inst.seed;
	p.r( 'body', Math.sin( t ) * 0.09, 0, Math.cos( t ) * 0.11 );
	p.rot( R.head, 0.45 + Math.sin( t * 0.5 ) * 0.1, Math.sin( t * 0.5 ) * 0.4, 0 );
	if ( R.neckChain.length ) p.chain( R.neckChain, 0.4, 0, 0 );
	p.rot( R.jaw, 0.3, 0, 0 );
	if ( R.humanoid ) {

		p.o( 'pelvis', 0, - 0.08, 0 );
		p.rot( R.spine, 0.25, 0, Math.sin( t ) * 0.12 );
		p.rot( R.upperArmL, 0.1, 0, 0.2 + Math.sin( t ) * 0.1 );
		p.rot( R.upperArmR, 0.1, 0, - 0.2 + Math.sin( t ) * 0.1 );

	}

	wingFlare( p, 0.2 + 0.1 * Math.sin( t ) );

}

function flinch( inst, p, e, c ) {

	const a = e.anim;
	if ( a.hitTime == null || a.hitTime < 0 ) return;
	const age = ( c.worldTime ?? 0 ) - a.hitTime;
	if ( age < 0 || age > 0.45 ) return;
	const strong = a.state === 'hit' ? 1.5 : 1;
	const w = Math.exp( - age * 9 ) * ( 1 - Math.exp( - age * 70 ) ) * strong;
	const cf = Math.cos( c.facing ), sf = Math.sin( c.facing );
	let hx = a.hitDirX * cf - a.hitDirZ * sf, hz = a.hitDirX * sf + a.hitDirZ * cf;
	const l = Math.hypot( hx, hz );
	if ( l < 1e-4 ) {

		hx = 0; hz = - 1;

	} else {

		hx /= l; hz /= l;

	}

	const R = p.R;
	p.o( 'root', hx * 0.07 * w, 0, hz * 0.07 * w );
	if ( R.humanoid ) {

		p.rot( R.spine, hz * 0.4 * w, 0, - hx * 0.3 * w );
		p.rot( R.chest, hz * 0.2 * w, 0, - hx * 0.15 * w );
		p.rot( R.head, hz * 0.45 * w, hx * 0.3 * w, 0 );
		p.o( 'pelvis', 0, - 0.05 * w, 0 );

	} else {

		p.r( 'body', hz * 0.25 * w, 0, - hx * 0.25 * w );
		p.rot( R.head, hz * 0.4 * w, hx * 0.3 * w, 0 );
		p.scl( R.body, 1 + 0.06 * w, 1 - 0.08 * w, 1 + 0.06 * w );

	}

	if ( R.neckChain.length ) p.chain( R.neckChain, hz * 0.3 * w, 0, 0 );

}

function lookAt( inst, p, e, c, state ) {

	const a = e.anim, R = p.R;
	let tx = a.aimX, tz = a.aimZ, want = 0, wantP = 0;
	if ( c.kind === 'npc' && c.player ) {

		tx = c.player.x; tz = c.player.z;

	}

	const dx = tx - c.x, dz = tz - c.z, d = Math.hypot( dx, dz );
	const ok = state !== 'dodge' && state !== 'stun' && ( tx !== 0 || tz !== 0 ) && d > 0.6 && d < ( c.kind === 'npc' ? 7 : 40 );
	if ( ok ) {

		want = clamp( wrapAngle( Math.atan2( dx, dz ) - c.facing ), - 1.35, 1.35 );
		wantP = clamp( 0.9 / Math.max( 1, d ) * c.h * 0.3, 0, 0.35 );

	}

	const k = Math.min( 1, c.dt * ( ok ? 9 : 4 ) );
	inst.lookYaw += ( want - inst.lookYaw ) * k;
	inst.lookPitch += ( wantP - inst.lookPitch ) * k;
	const y = inst.lookYaw, x = inst.lookPitch;
	if ( R.neckChain.length > 1 ) {

		p.chain( R.neckChain, x * 0.3, y * 0.5, 0 );
		p.rot( R.head, x * 0.7, y * 0.45, 0 );

	} else {

		p.rot( R.neck, 0, y * 0.3, 0 );
		p.rot( R.head, x, y * 0.6, 0 );
		if ( R.humanoid && state !== 'action' ) p.rot( R.chest, 0, y * 0.15, 0 );

	}

}

function deathPose( inst, p, e, c ) {

	const R = p.R, T = inst.T, age = inst.stateTime, a = e.anim;
	const boss = c.boss;
	const cf = Math.cos( c.facing ), sf = Math.sin( c.facing );
	const hz = a.hitDirX * sf + a.hitDirZ * cf, hx = a.hitDirX * cf - a.hitDirZ * sf;
	const dir = hz > 0.1 ? 1 : - 1; // fall forward when pushed forward, else backward
	const side = hash01( inst.seed, 9 ) > 0.5 ? 1 : - 1;
	// bosses tremble and flare before they fall apart
	const tremble = boss ? Math.max( 0, 1 - age / 1.3 ) : 0;
	if ( tremble > 0 ) {

		p.o( 'root', noise1( c.time * 40, 1 ) * 0.05 * tremble, 0, noise1( c.time * 37, 2 ) * 0.05 * tremble );
		inst.glow = Math.max( inst.glow, tremble );

	}

	const t0 = boss ? 0.5 : 0;
	const f = easeOutBounceSoft( clamp( ( age - t0 - 0.1 ) / 0.55, 0, 1 ) );
	const buckle = smooth( ( age - t0 ) / 0.3 );
	if ( R.humanoid ) {

		p.o( 'pelvis', 0, - 0.3 * buckle, 0 );
		p.rot( R.spine, 0.35 * buckle * - dir, 0, 0 );
		p.pivot( 0, 0, dir * 0.1, dir * 1.42 * f, - hx * 0.35 * f );
		p.rot( R.head, - 0.35 * f * dir, side * 0.4 * f, 0 );
		p.rot( R.upperArmL, - 0.9 * f, 0, 0.7 * f );
		p.rot( R.upperArmR, - 0.7 * f, 0, - 0.9 * f );
		p.rot( R.foreArmL, - 0.3 * f, 0, 0 );
		p.foot( R.footL, 0.05, 0.1 * buckle, 0.25 * buckle );
		p.foot( R.footR, - 0.05, 0.05 * buckle, 0.1 * buckle );

	} else {

		const plan = c.plan;
		if ( plan === 'floater' || ( plan === 'avian' && T.meta.gait?.fly ) ) {

			const hover = plan === 'floater' ? ( T.meta.hover || 1.2 ) : 0;
			p.o( 'root', 0, - hover * Math.min( 1, ( age / 0.45 ) ** 2 ), 0 );
			if ( plan === 'avian' ) p.o( 'root', 0, - ( T.meta.hover || 1 ) * ( 1 - Math.min( 1, ( age / 0.45 ) ** 2 ) ) * 0, 0 );

		}

		if ( plan === 'blob' ) {

			p.scl( R.body, 1 + 0.4 * f, 1 - 0.68 * f, 1 + 0.4 * f );

		} else if ( plan === 'arachnid' || plan === 'hexapod' ) {

			// flipped on its back, legs curled up
			p.pivot( 0, T.dims.height * 0.35, 0, 0, side * Math.PI * f );
			T.legs.forEach( ( L, i ) => p.foot( i, - L.rest[ 0 ] * 0.55 * f, - 0.35 * f * c.legLen, - L.rest[ 2 ] * 0.4 * f ) );

		} else if ( plan === 'serpent' ) {

			p.chain( R.front, 0.5 * f, 0, 0 );
			p.r( 'body', 0, 0, side * 1.3 * f );
			p.chain( R.back, 0, 0, side * 0.3 * f );

		} else {

			// roll onto the side, legs go limp
			const w = Math.max( 0.2, T.dims.width * 0.45 );
			p.pivot( side * w, 0, 0, 0, side * 1.35 * f );
			T.legs.forEach( ( L, i ) => p.foot( i, - L.rest[ 0 ] * 0.3 * f, 0.15 * f * c.legLen, 0.1 * f ) );

		}

		if ( R.neckChain.length ) p.chain( R.neckChain, 0.6 * f, 0, side * 0.3 * f );
		p.rot( R.head, 0.4 * f, 0, 0 );
		p.rot( R.jaw, 0.45 * f, 0, 0 );
		p.rot( R.jawL, 0, 0.6 * f, 0 ); p.rot( R.jawR, 0, - 0.6 * f, 0 );
		if ( R.tail.length ) p.chain( R.tail, 0.4 * f, side * 0.4 * f, 0 );
		wingFlare( p, - 0.3 * f );

	}

	// dissolve: parts scatter and shrink (dramatic burst for bosses). The player stays.
	if ( c.kind !== 'player' ) {

		const start = boss ? 1.3 : 1.5, dur = boss ? 1.6 : 0.9;
		inst.dissolve = clamp( ( age - start ) / dur, 0, 1 );
		inst.scatter = boss ? 3.2 : 0.7;

	} else inst.dissolve = 0;

}

function easeOutBounceSoft( t ) {

	// a fall that hits, bounces a little and settles
	if ( t < 0.7 ) return ( t / 0.7 ) ** 2;
	const u = ( t - 0.7 ) / 0.3;
	return 1 - Math.sin( u * Math.PI ) * 0.08;

}

function spawnPose( inst, p, e, c ) {

	const a = e.anim;
	const u = a.t > 0 && a.t < 1 ? a.t : clamp( inst.stateTime / 0.6, 0, 1 );
	const r = easeOutBack( u, 1.6 );
	p.o( 'root', 0, - c.h * ( 1 - r ), 0 );
	inst.extraScale = 0.55 + 0.45 * r;
	p.r( 'body', - 0.4 * ( 1 - u ), 0, 0 );
	p.rot( p.R.jaw, 0.5 * Math.sin( Math.PI * u ), 0, 0 );
	wingFlare( p, Math.sin( Math.PI * u ) );

}

// NPC idle emotes: loop the model's emote; greet the player with a wave on approach.
function npcIdle( inst, p, e, c ) {

	if ( c.kind !== 'npc' ) return;
	const pl = c.player;
	const near = pl ? Math.hypot( pl.x - c.x, pl.z - c.z ) < 4.5 : false;
	if ( near && ! inst.near ) inst.greet = 0;
	inst.near = near;
	if ( inst.greet >= 0 ) {

		inst.greet += c.dt;
		if ( inst.greet > 1.8 ) inst.greet = - 1;
		else {

			// blend the wave in and out by scaling everything it writes
			const w = Math.min( 1, inst.greet * 5, ( 1.8 - inst.greet ) * 5 );
			EMOTES.wave( scaled( p, w ), inst.greet );
			return;

		}

	}

	const em = c.emote;
	if ( em && EMOTES[ em ] && ! near ) EMOTES[ em ]( p, c.time + inst.seed * 7, inst.seed );
	else if ( near ) EMOTES.talk( scaled( p, 0.35 ), c.time, inst.seed );

}

// A Poser view that scales every rotation it writes by w (soft emote blending).
const scaledPoser = new Poser();
function scaled( p, w ) {

	scaledPoser.T = p.T; scaledPoser.P = p.P; scaledPoser.nb = p.nb; scaledPoser.R = p.R; scaledPoser.w = w;
	return scaledPoser;

}

scaledPoser.rot = function ( b, x, y = 0, z = 0 ) {

	Poser.prototype.rot.call( this, b, x * this.w, y * this.w, z * this.w );

};

scaledPoser.off = function ( b, x, y = 0, z = 0 ) {

	Poser.prototype.off.call( this, b, x * this.w, y * this.w, z * this.w );

};

// --- props: bone effects ( model part lists with `bones: [ { name, fx } ]` ) ---------------
//   fx: { type: 'spin', speed, axis: 'y' }  { type: 'bob', amp, speed }  { type: 'sway', amp, speed }
//       { type: 'flicker', amp }  { type: 'pulse', amp, speed }  { type: 'orbit', speed, phase, tilt }
//       { type: 'state', states: { open: { rot, off, scl } }, speed }   driven by entity.model.state
//       { type: 'wobble' }  rocks when hit ( training dummies )

function applyFx( inst, p, e, ctx ) {

	const T = inst.T;
	if ( ! T.fxList ) T.fxList = T.fx.map( ( f, i ) => ( f ? i : - 1 ) ).filter( ( i ) => i >= 0 );
	if ( ! T.fxList.length ) return;
	const t = ctx.time + inst.seed * 0.37;
	for ( const b of T.fxList ) {

		const f = T.fx[ b ];
		switch ( f.type ) {

			case 'spin': {

				const a = t * ( f.speed ?? 1 );
				if ( f.axis === 'x' ) p.rot( b, a, 0, 0 ); else if ( f.axis === 'z' ) p.rot( b, 0, 0, a ); else p.rot( b, 0, a, 0 );
				break;

			}

			case 'bob': p.off( b, 0, Math.sin( t * ( f.speed ?? 2 ) ) * ( f.amp ?? 0.05 ), 0 ); break;
			case 'sway': p.rot( b, Math.sin( t * ( f.speed ?? 1.3 ) ) * ( f.amp ?? 0.1 ) * 0.5, 0, Math.sin( t * ( f.speed ?? 1.3 ) * 0.8 + 1 ) * ( f.amp ?? 0.1 ) ); break;
			case 'flicker': {

				const n = 1 + noise1( t * 9, b ) * ( f.amp ?? 0.18 ) + Math.sin( t * 23 ) * 0.04;
				p.scl( b, 1 + ( n - 1 ) * 0.6, n, 1 + ( n - 1 ) * 0.6 );
				p.rot( b, noise1( t * 5, b + 3 ) * 0.08, 0, noise1( t * 4, b + 5 ) * 0.08 );
				break;

			}

			case 'pulse': {

				const s = 1 + Math.sin( t * ( f.speed ?? 2 ) ) * ( f.amp ?? 0.06 );
				p.scl( b, s, s, s );
				break;

			}

			case 'orbit': {

				const a = t * ( f.speed ?? 1.5 ) + ( f.phase ?? 0 );
				p.rot( b, f.tilt ?? 0, a, 0 );
				break;

			}

			case 'state': {

				const cur = e.model?.state;
				const want = f.states?.[ cur ] ? 1 : 0;
				if ( want ) inst.fxLast[ b ] = cur;
				inst.fxState[ b ] += ( want - inst.fxState[ b ] ) * Math.min( 1, ctx.dt * ( f.speed ?? 6 ) );
				const k = inst.fxState[ b ], st = f.states?.[ inst.fxLast[ b ] ] || null;
				if ( st && k > 0.001 ) {

					if ( st.rot ) p.rot( b, st.rot[ 0 ] * k, st.rot[ 1 ] * k, st.rot[ 2 ] * k );
					if ( st.off ) p.off( b, st.off[ 0 ] * k, st.off[ 1 ] * k, st.off[ 2 ] * k );
					if ( st.scl ) p.scl( b, 1 + ( st.scl[ 0 ] - 1 ) * k, 1 + ( st.scl[ 1 ] - 1 ) * k, 1 + ( st.scl[ 2 ] - 1 ) * k );

				}

				break;

			}

			case 'wobble': {

				const age = ( ctx.worldTime ?? 0 ) - ( e.anim?.hitTime ?? - 9 );
				if ( age >= 0 && age < 1.5 ) {

					const w = Math.exp( - age * 3 ) * Math.sin( age * 18 ) * 0.25;
					p.rot( b, w * ( e.anim.hitDirZ || 0.7 ), 0, - w * ( e.anim.hitDirX || 0.7 ) );

				}

				break;

			}

		}

	}

}

// props: dead = burst (explosive barrels, crates), loot bobs and spins
function propState( inst, p, e, ctx, state ) {

	if ( state === 'dead' ) {

		inst.dissolve = clamp( inst.stateTime / 0.7, 0, 1 );
		inst.scatter = 2.2;

	}

	if ( inst.T.kind === 'loot' ) {

		const t = ctx.time + inst.seed;
		p.off( 0, 0, 0.18 + Math.sin( t * 2.4 ) * 0.06, 0 );
		p.rot( 0, 0.2, t * 1.2, 0 );

	}

	if ( state === 'spawn' ) {

		const u = clamp( inst.stateTime / 0.4, 0, 1 );
		inst.extraScale = easeOutBack( u, 2 );

	}

}

// --- spring chains ------------------------------------------------------------------------

function springsStep( inst, F, c, dt, state ) {

	const T = inst.T, S = inst.springs;
	const speed = Math.hypot( c.lvx, c.lvz );
	const yawR = inst.yawRate, accF = inst.accF;
	const dead = state === 'dead';
	let o = 0;
	for ( const ch of T.chains ) {

		const n = ch.bones.length;
		const hanging = ch.kind === 'cape' || ch.kind === 'tentacle';
		for ( let i = 0; i < n; i ++ ) {

			const b = ch.bones[ i ], grow = 1 + i * 0.6;
			let tx, ty;
			const wave = ch.wave ? Math.sin( c.time * 2.2 + i * 0.9 + inst.seed ) * ch.wave : 0;
			if ( hanging ) {

				tx = clamp( speed * 0.09 + accF * 0.012, - 0.4, 1.4 ) * ch.swing + wave * 0.5;
				ty = clamp( yawR * 0.1, - 0.8, 0.8 ) * ch.swing + wave;

			} else if ( ch.kind === 'antenna' || ch.kind === 'crest' ) {

				tx = clamp( - accF * 0.012 - speed * 0.04, - 0.7, 0.7 ) * ch.swing + wave * 0.3;
				ty = clamp( - yawR * 0.06, - 0.6, 0.6 ) * ch.swing + wave * 0.5;

			} else {

				// tails: drag behind turns, lift a little with speed, wag at rest
				tx = clamp( - speed * 0.03 + accF * 0.006, - 0.4, 0.4 ) * ch.swing;
				ty = clamp( - yawR * 0.09, - 0.9, 0.9 ) * ch.swing * grow + wave * ( 1 - Math.min( 1, speed * 0.3 ) );

			}

			if ( dead ) {

				tx *= 0.2; ty *= 0.2;

			}

			const sx = spring( S, o, tx, ch.stiff, ch.damp, dt );
			const sy = spring( S, o + 2, ty, ch.stiff * 0.8, ch.damp * 0.9, dt );
			const bi = b * 3;
			F[ bi ] += sx;
			if ( hanging ) F[ bi + 2 ] += sy; else F[ bi + 1 ] += sy;
			o += 4;

		}

	}

}

export function attachKeys() {

	return ATTACH_KEYS;

}
