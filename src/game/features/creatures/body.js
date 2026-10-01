// Genome -> rig template. Runs the body plan (skeleton + anchors), then every part
// slot in a fixed order (torso, legs, arms, head, eyes, horns, back, tail, wings,
// extra), then publishes the VFX attachment points and compiles ( rig.js ).
// Sim-safe and deterministic: genomeMetrics() calls this in Node to measure bodies.

import { RNG } from '../../core/rng.js';
import { get } from '../../core/registry.js';
import { RigBuilder } from './rig.js';
import { validateGenome, SLOTS } from './genome.js';

const cache = new WeakMap();

export function buildBody( genome ) {

	if ( genome && typeof genome === 'object' && cache.has( genome ) ) return cache.get( genome );
	const g = validateGenome( genome );
	const planDef = get( 'bodyPlan', g.plan );
	const B = new RigBuilder( 'creature', g.plan );
	const K = {
		B, g, b: g.body, rng: new RNG( g.seed ).fork( 'build' ),
		torso: [], neck: [], head: null, arms: [], legs: [], back: [], tail: null, wings: null, belly: [],
		eyes: null, hornBase: null, armMount: null
	};
	planDef.build( K );

	// neck segments (drawn here so every torso style gets a matching neck)
	for ( const n of K.neck ) B.segment( n.bone, 'cyl', n.a, n.b, n.t, 'primary', { overlap: 1.15, shade: 0.95 } );

	for ( const slot of SLOTS ) {

		const list = slot === 'extra' ? g.parts.extra : g.parts[ slot ] ? [ g.parts[ slot ] ] : [];
		for ( const p of list ) {

			if ( slot === 'eyes' && K.forceEyes && p.id !== K.forceEyes ) continue;
			const def = get( 'bodyPart', p.id );
			if ( def ) def.build( K, p );

		}

		if ( slot === 'eyes' && K.forceEyes && ! list.some( ( p ) => p.id === K.forceEyes ) ) get( 'bodyPart', K.forceEyes )?.build( K, { id: K.forceEyes, s: 1, v: 0 } );
		// arms on a biped are part of the skeleton even when the slot is empty
		if ( slot === 'arms' && ! list.length && K.arms.length ) get( 'bodyPart', 'claws' ).build( K, { id: 'claws', s: 1, v: 0 } );

	}

	// attachment points for VFX ( rc.attach ): head, chest, hands, weapon base/tip
	const head = K.head;
	if ( head ) B.point( 'head', head.bone, [ head.c[ 0 ], head.c[ 1 ], head.c[ 2 ] + head.s * 0.5 ] );
	const jaw = B.roles.jaw ?? B.roles.jawL;
	const armL = K.arms.find( ( a ) => a.side > 0 ), armR = K.arms.find( ( a ) => a.side < 0 );
	const frontL = K.legs.find( ( l ) => l.front && l.side > 0 ), frontR = K.legs.find( ( l ) => l.front && l.side < 0 );
	const hand = ( arm, leg ) => arm ? [ arm.hand, [ 0, - arm.t, 0 ] ] : leg ? [ leg.foot, [ 0, 0, 0.05 ] ] : head ? [ head.bone, head.c ] : [ 0, [ 0, 0.5, 0 ] ];
	const [ hlB, hlP ] = hand( armL, frontL ), [ hrB, hrP ] = hand( armR, frontR );
	if ( ! B.attach.handL ) B.point( 'handL', hlB, hlP );
	if ( ! B.attach.handR ) B.point( 'handR', hrB, hrP );
	if ( ! B.attach.weaponBase ) {

		// creatures "strike" with the right hand, else the jaw, else the head
		if ( armR ) B.point( 'weaponBase', armR.hand, [ 0, - armR.t, 0 ] );
		else if ( jaw !== undefined ) B.point( 'weaponBase', jaw, [ 0, 0, head ? head.s * 0.4 : 0.1 ] );
		else if ( head ) B.point( 'weaponBase', head.bone, head.c );

	}

	if ( ! B.attach.weaponTip ) {

		if ( armR ) B.point( 'weaponTip', armR.hand, [ 0, - armR.t * 3, 0 ] );
		else if ( B.attach.stinger ) B.attach.weaponTip = B.attach.stinger;
		else if ( head ) B.point( 'weaponTip', head.bone, [ head.c[ 0 ], head.c[ 1 ], head.c[ 2 ] + head.s * 0.9 ] );

	}

	if ( ! B.attach.chest ) B.point( 'chest', B.roles.chest ?? B.roles.body ?? 0, [ 0, 0, 0 ] );
	if ( ! B.attach.head ) B.attach.head = B.attach.chest;

	B.meta.genome = g;
	B.meta.plan = g.plan;
	B.meta.gait = { ...planDef.gait, ...g.gait, duty: planDef.gait.duty, lift: planDef.gait.lift, baseBounce: planDef.gait.bounce, baseCadence: planDef.gait.cadence };
	B.meta.personality = g.personality;
	B.meta.armReach = K.arms.length ? Math.max( ...K.arms.map( ( a ) => a.a + a.b ) ) * 0.85 : 0;
	B.meta.headSize = head?.s ?? 0.2;
	B.meta.size = g.size;
	const T = B.build( g.palette );
	if ( genome && typeof genome === 'object' ) cache.set( genome, T );
	return T;

}
