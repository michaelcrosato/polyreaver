// Humanoid rigs: the hero ('reaver'), town NPCs and anything else built like a
// person. Proportions follow the engine's crowd "Hi" triangle-person ( src/crowd/
// models.js: hexagonal limbs, faceted head, hair cap) scaled up a little - the hero
// IS the stress test's red-shirted hero, now with a full combat rig.
//
// A humanoid is described by a LOOK (plain data, so NPC defs and saves can hold it):
//   {
//     height: 1, girth: 1, headSize: 1,
//     colors: { shirt, pants, skin, shoes, hair, accent, metal, cape, glow },   hex strings
//     hair: 'short' | 'long' | 'bald' | 'pony' | 'mohawk' | 'bun',
//     beard: false,
//     outfit: [ 'pauldrons', 'belt', 'bracers', 'boots', 'cape', 'scarf', 'apron', 'robe',
//               'hood', 'hat', 'turban', 'helmet', 'plate', 'skirt', 'bag', 'gloves' ],
//     weapon: { base, rarity, color } | null      hero weapons (model library 'weapon-*')
//     tool: 'hammer' | 'broom' | 'ledger' | 'staff' | 'spear' | 'lantern' | 'shield' | null
//   }
// Bones carry the standard humanoid roles (pelvis spine chest neck head upperArmL/R
// foreArmL/R handL/R weapon offhand + two IK legs), so every humanoid action pose in
// actions.js works on every look.

import { RigBuilder } from './rig.js';
import { get } from '../../core/registry.js';
import { mixHex } from './math.js';

export const RARITY_GLOW = { normal: null, magic: '#6f9cff', rare: '#ffd84a', unique: '#ff8a2a', set: '#5ef08a', boss: '#ff3a3a' };
export const RARITY_METAL = { normal: '#b5bcc4', magic: '#b9c8e6', rare: '#e2cf86', unique: '#e8a45a', set: '#9fd6a8' };

// The hero's colours come straight from the crowd shader (agent 0): red shirt, blue
// trousers, warm skin, dark shoes - plus the yellow of the hero marker as accent.
export const REAVER_LOOK = {
	height: 1.06, girth: 1.04, headSize: 1.05,
	colors: { shirt: '#f2331f', pants: '#1f338c', skin: '#f7d1b3', shoes: '#29241f', hair: '#3a281c', accent: '#ffd23f', metal: '#b5bcc4', cape: '#8c1a14', glow: '#ffd23f' },
	hair: 'short', beard: false,
	outfit: [ 'pauldrons', 'belt', 'bracers', 'boots', 'cape' ]
};

// Weapon class -> how it is carried ( animate.js carryStance ) and which hand holds it.
export const WEAPON_CLASSES = {
	sword: 'onehand', axe: 'onehand', mace: 'onehand', dagger: 'onehand', wand: 'onehand', claw: 'onehand', sceptre: 'onehand',
	spear: 'twohand', staff: 'twohand', hammer: 'twohand', greatsword: 'twohand', scythe: 'twohand', polearm: 'twohand', greataxe: 'twohand',
	bow: 'bow', crossbow: 'bow'
};

// Resolve whatever progression put in model.weapon.base ('sword', 'rusted-sword',
// an itemBase id with a `model` / `weaponClass`) to a weapon model def.
export function resolveWeapon( base ) {

	if ( ! base ) return null;
	const b = String( base );
	let def = get( 'model', b ) || get( 'model', 'weapon-' + b );
	if ( def ) return def;
	const item = get( 'itemBase', b );
	if ( item ) {

		def = ( item.model && ( get( 'model', item.model ) || get( 'model', 'weapon-' + item.model ) ) ) || ( item.weaponClass && get( 'model', 'weapon-' + item.weaponClass ) );
		if ( def ) return def;

	}

	for ( const cls of Object.keys( WEAPON_CLASSES ) ) if ( b.includes( cls ) ) return get( 'model', 'weapon-' + cls );
	return get( 'model', 'weapon-sword' );

}

export function buildHumanoid( look = REAVER_LOOK, { id = 'humanoid', kind = 'humanoid', weapon = null, gear = null } = {} ) {

	const L = { ...REAVER_LOOK, ...look, colors: { ...REAVER_LOOK.colors, ...( look.colors || {} ) } };
	const col = { ...L.colors };
	// progression's gear tints ( model.gear: { chest, legs, boots, gloves, helm, cape } )
	if ( gear ) {

		const tint = ( v ) => ( typeof v === 'string' ? v : v?.color );
		if ( tint( gear.chest ) ) col.shirt = tint( gear.chest );
		if ( tint( gear.legs ) ) col.pants = tint( gear.legs );
		if ( tint( gear.boots ) ) col.shoes = tint( gear.boots );
		if ( tint( gear.cape ) ) col.cape = tint( gear.cape );

	}

	const outfit = new Set( L.outfit || [] );
	if ( gear?.helm ) outfit.add( 'helmet' );
	if ( gear?.gloves ) outfit.add( 'gloves' );
	if ( gear?.chest ) outfit.add( 'plate' );
	const s = L.height ?? 1, g = L.girth ?? 1, hs = L.headSize ?? 1;
	const B = new RigBuilder( kind, id );
	const hipY = 0.92 * s;
	const pelvis = B.bone( 'pelvis', 'root', [ 0, hipY, 0 ], { role: 'pelvis' } );
	B.role( 'body', pelvis );
	const spine = B.bone( 'spine', pelvis, [ 0, 0.13 * s, 0 ], { role: 'spine' } );
	const chest = B.bone( 'chest', spine, [ 0, 0.2 * s, 0 ], { role: 'chest' } );
	const neck = B.bone( 'neck', chest, [ 0, 0.255 * s, 0 ], { role: 'neck' } );
	const head = B.bone( 'head', neck, [ 0, 0.07 * s, 0.005 ], { role: 'head' } );

	// torso: hips (trousers), belt, belly, chest - hexagonal like the crowd's Hi tier
	const P = ( bone, shape, pos, scale, color, opts ) => B.part( bone, shape, pos, [ 0, 0, 0 ], scale, color, opts );
	const robe = outfit.has( 'robe' );
	P( pelvis, 'cyl', [ 0, 0.02, 0 ], [ 0.33 * g, 0.18, 0.21 * g ], robe ? col.shirt : col.pants );
	P( spine, 'cyl', [ 0, 0.09, 0 ], [ 0.31 * g, 0.21, 0.2 * g ], col.shirt );
	P( chest, 'cyl', [ 0, 0.1, 0 ], [ 0.41 * g, 0.25, 0.235 * g ], col.shirt );
	P( chest, 'box', [ 0, 0.205, - 0.005 ], [ 0.4 * g, 0.055, 0.2 * g ], col.shirt, { shade: 0.88 } );
	if ( outfit.has( 'belt' ) ) {

		P( pelvis, 'cyl', [ 0, 0.11, 0 ], [ 0.345 * g, 0.06, 0.225 * g ], '#3b2a1e' );
		P( pelvis, 'box', [ 0, 0.11, 0.115 * g ], [ 0.07, 0.05, 0.02 ], col.accent, { shine: true } );

	}

	if ( outfit.has( 'plate' ) ) {

		P( chest, 'box', [ 0, 0.11, 0.075 * g ], [ 0.36 * g, 0.22, 0.1 * g ], col.metal, { shine: true } );
		P( spine, 'box', [ 0, 0.1, 0.07 * g ], [ 0.28 * g, 0.14, 0.08 * g ], col.metal, { shine: true, shade: 0.85 } );

	}

	if ( outfit.has( 'apron' ) ) {

		P( chest, 'box', [ 0, 0.02, 0.12 * g ], [ 0.3 * g, 0.3, 0.02 ], '#6b4a2e' );
		P( pelvis, 'box', [ 0, - 0.08, 0.12 * g ], [ 0.3 * g, 0.36, 0.02 ], '#6b4a2e' );

	}

	if ( robe || outfit.has( 'skirt' ) ) {

		// a cone skirt hides the legs' upper half; legs still step underneath
		P( pelvis, 'cone', [ 0, - 0.2, 0 ], [ 0.52 * g, robe ? 0.75 : 0.45, 0.42 * g ], robe ? col.shirt : col.pants, { shade: 0.9 } );

	}

	if ( outfit.has( 'bag' ) ) P( pelvis, 'box', [ - 0.17 * g, 0.03, 0.04 ], [ 0.08, 0.12, 0.13 ], '#6b4a2e' );

	// neck + head
	P( neck, 'cyl', [ 0, 0.03, 0 ], [ 0.095, 0.1, 0.095 ], col.skin );
	const H = ( pos, scale, color, shape = 'sphere', rot = [ 0, 0, 0 ], opts ) => B.part( head, shape, [ pos[ 0 ] * hs, pos[ 1 ] * hs, pos[ 2 ] * hs ], rot, [ scale[ 0 ] * hs, scale[ 1 ] * hs, scale[ 2 ] * hs ], color, opts );
	H( [ 0, 0.1, 0.01 ], [ 0.24, 0.28, 0.25 ], col.skin );
	H( [ 0.05, 0.115, 0.118 ], [ 0.035, 0.045, 0.02 ], '#1a1414', 'box' );
	H( [ - 0.05, 0.115, 0.118 ], [ 0.035, 0.045, 0.02 ], '#1a1414', 'box' );
	H( [ 0, 0.09, 0.12 ], [ 0.035, 0.05, 0.03 ], col.skin, 'box', [ 0, 0, 0 ], { shade: 1.06 } );
	const hair = L.hair || 'short';
	const hooded = outfit.has( 'hood' ), helm = outfit.has( 'helmet' );
	if ( hooded ) {

		H( [ 0, 0.14, - 0.02 ], [ 0.31, 0.32, 0.31 ], col.cape || col.shirt, 'sphere', [ 0, 0, 0 ], { shade: 0.85 } );
		H( [ 0, 0.27, - 0.08 ], [ 0.12, 0.16, 0.12 ], col.cape || col.shirt, 'cone', [ - 0.6, 0, 0 ], { shade: 0.8 } );

	} else if ( helm ) {

		const hc = typeof gear?.helm === 'string' ? gear.helm : gear?.helm?.color ?? col.metal;
		H( [ 0, 0.16, - 0.005 ], [ 0.27, 0.22, 0.28 ], hc, 'sphere', [ 0, 0, 0 ], { shine: true } );
		H( [ 0, 0.1, 0.03 ], [ 0.28, 0.06, 0.25 ], hc, 'cyl', [ 0, 0, 0 ], { shine: true, shade: 0.85 } );
		H( [ 0, 0.27, - 0.02 ], [ 0.03, 0.12, 0.2 ], col.accent, 'box' );

	} else if ( hair !== 'bald' ) {

		H( [ 0, 0.15, - 0.02 ], [ 0.255, 0.21, 0.265 ], col.hair );
		if ( hair === 'long' ) H( [ 0, 0.04, - 0.1 ], [ 0.24, 0.26, 0.09 ], col.hair, 'box' );
		if ( hair === 'pony' ) H( [ 0, 0.1, - 0.15 ], [ 0.07, 0.2, 0.07 ], col.hair, 'cone', [ 2.6, 0, 0 ] );
		if ( hair === 'mohawk' ) H( [ 0, 0.25, - 0.02 ], [ 0.04, 0.12, 0.24 ], col.hair, 'box' );
		if ( hair === 'bun' ) H( [ 0, 0.26, - 0.06 ], [ 0.1, 0.1, 0.1 ], col.hair );

	}

	if ( L.beard ) H( [ 0, 0.02, 0.07 ], [ 0.2, 0.17, 0.14 ], col.hair, 'box', [ 0.2, 0, 0 ] );
	if ( outfit.has( 'hat' ) ) {

		H( [ 0, 0.24, 0 ], [ 0.42, 0.04, 0.42 ], col.accent, 'cyl', [ 0, 0, 0 ], { shade: 0.7 } );
		H( [ 0, 0.31, 0 ], [ 0.22, 0.14, 0.22 ], col.accent, 'cyl', [ 0, 0, 0 ], { shade: 0.7 } );

	}

	if ( outfit.has( 'turban' ) ) {

		H( [ 0, 0.22, - 0.01 ], [ 0.3, 0.16, 0.3 ], col.accent, 'sphere' );
		H( [ 0, 0.22, 0.14 ], [ 0.05, 0.05, 0.03 ], col.glow, 'octa', [ 0, 0, 0 ], { emissive: 0.6 } );

	}

	// arms: sleeves, forearms, fists (+ pauldrons, bracers, gloves)
	const ua = 0.28 * s, fa = 0.27 * s;
	B.pair( ( side, S ) => {

		const up = B.bone( 'upperArm' + S, chest, [ side * 0.222 * s * g, 0.19 * s, 0 ], { role: 'upperArm' + S, rot: [ 0, 0, side * 0.07 ] } );
		const fo = B.bone( 'foreArm' + S, up, [ 0, - ua, 0 ], { role: 'foreArm' + S, rot: [ - 0.12, 0, 0 ] } );
		const ha = B.bone( 'hand' + S, fo, [ 0, - fa, 0 ], { role: 'hand' + S } );
		B.segment( up, 'cyl', [ 0, 0.01, 0 ], [ 0, - ua, 0 ], 0.1 * g, col.shirt, { overlap: 1.08 } );
		B.segment( fo, 'cyl', [ 0, 0, 0 ], [ 0, - fa, 0 ], 0.083, col.skin, { overlap: 1.04 } );
		if ( outfit.has( 'pauldrons' ) ) B.part( up, 'sphere', [ side * 0.015, 0.0, 0 ], [ 0, 0, 0 ], [ 0.17 * g, 0.13, 0.17 * g ], col.metal, { shine: true } );
		if ( outfit.has( 'bracers' ) ) B.part( fo, 'cyl', [ 0, - fa * 0.62, 0 ], [ 0, 0, 0 ], [ 0.1, fa * 0.46, 0.1 ], '#4a3324' );
		B.part( ha, 'box', [ 0, - 0.045, 0.005 ], [ 0, 0, 0 ], [ 0.085, 0.095, 0.08 ], outfit.has( 'gloves' ) ? ( typeof gear?.gloves === 'string' ? gear.gloves : '#4a3324' ) : col.skin );
		B.point( 'hand' + S, ha, [ 0, - 0.05, 0.02 ] );

	} );
	const handR = B.roles.handR, handL = B.roles.handL;
	const wBone = B.bone( 'weapon', handR, [ 0, - 0.055, 0.0 ], { role: 'weapon', rot: [ Math.PI / 2, 0, 0 ] } );
	const oBone = B.bone( 'offhand', handL, [ 0, - 0.055, 0.0 ], { role: 'offhand', rot: [ Math.PI / 2, 0, 0 ] } );

	// legs: two-bone IK, boots and feet
	const a = 0.44 * s, b = 0.44 * s, ankle = 0.085 * s;
	B.pair( ( side, S ) => {

		const th = B.bone( 'thigh' + S, pelvis, [ side * 0.098 * s * g, - 0.02, 0 ] );
		const sh = B.bone( 'shin' + S, th, [ 0, - a, 0 ] );
		const ft = B.bone( 'foot' + S, sh, [ 0, - b, 0 ] );
		B.leg( { thigh: th, shin: sh, foot: ft, rest: [ side * 0.105 * s * g, ankle, 0.015 ], a, b, pole: [ 0, 0, 1 ], phase: side > 0 ? 0 : 0.5, side, lift: 0.2 * s, ankle } );
		B.segment( th, 'cyl', [ 0, 0.03, 0 ], [ 0, - a, 0 ], 0.15 * g, col.pants, { overlap: 1.06 } );
		B.segment( sh, 'cyl', [ 0, 0, 0 ], [ 0, - b, 0 ], 0.115 * g, col.pants, { overlap: 1.02 } );
		if ( outfit.has( 'boots' ) ) B.part( sh, 'cyl', [ 0, - b * 0.74, 0 ], [ 0, 0, 0 ], [ 0.13 * g, b * 0.5, 0.13 * g ], col.shoes );
		B.part( ft, 'box', [ 0, - ankle * 0.45, 0.05 ], [ 0, 0, 0 ], [ 0.11 * g, ankle * 0.95, 0.25 ], col.shoes );

	} );

	// cape / scarf: spring chains (they flow behind on the run, flick on turns)
	if ( outfit.has( 'cape' ) ) {

		const c0 = B.bone( 'cape0', chest, [ 0, 0.18 * s, - 0.12 * g ], { rot: [ 0.1, 0, 0 ] } );
		const c1 = B.bone( 'cape1', c0, [ 0, - 0.27 * s, 0 ] );
		B.part( c0, 'box', [ 0, - 0.135 * s, 0 ], [ 0, 0, 0 ], [ 0.36 * g, 0.28 * s, 0.025 ], col.cape );
		B.part( c1, 'wedge', [ 0, - 0.12 * s, 0 ], [ - Math.PI / 2, 0, 0 ], [ 0.34 * g, 0.03, 0.26 * s ], col.cape, { shade: 0.85 } );
		B.chain( 'cape', [ c0, c1 ], { stiff: 55, damp: 8, swing: 1 } );

	}

	if ( outfit.has( 'scarf' ) ) {

		P( chest, 'cyl', [ 0, 0.24, 0 ], [ 0.2, 0.06, 0.18 ], col.accent );
		const s0 = B.bone( 'scarf0', chest, [ 0.06, 0.23 * s, - 0.08 ], { rot: [ 0.4, 0, 0 ] } );
		const s1 = B.bone( 'scarf1', s0, [ 0, - 0.18, 0 ] );
		B.part( s0, 'box', [ 0, - 0.09, 0 ], [ 0, 0, 0 ], [ 0.07, 0.19, 0.02 ], col.accent );
		B.part( s1, 'box', [ 0, - 0.08, 0 ], [ 0, 0, 0 ], [ 0.065, 0.17, 0.02 ], col.accent, { shade: 0.85 } );
		B.chain( 'cape', [ s0, s1 ], { stiff: 40, damp: 5, swing: 1.4 } );

	}

	// held items: hero weapon (model library) or an NPC tool
	let stance = 'none';
	if ( weapon ) {

		const def = resolveWeapon( weapon.base );
		if ( def ) {

			stance = WEAPON_CLASSES[ def.weaponClass ] || 'onehand';
			const rar = weapon.rarity || 'normal';
			const glow = weapon.color || RARITY_GLOW[ rar ] || col.glow;
			const metal = weapon.color && rar !== 'normal' ? mixHex( RARITY_METAL[ rar ] || col.metal, weapon.color, 0.25 ) : RARITY_METAL[ rar ] || col.metal;
			const emis = { normal: 0, magic: 0.45, rare: 0.6, unique: 0.9, set: 0.7 }[ rar ] ?? 0.4;
			const bone = def.hand === 'L' ? oBone : wBone;
			for ( const p of def.parts ) {

				const c = p.color === 'metal' ? metal : p.color === 'glow' ? ( glow || col.accent ) : p.color === 'accent' && rar !== 'normal' ? mixHex( col.accent, glow || col.accent, 0.4 ) : p.color;
				const e = p.color === 'glow' ? ( glow ? Math.max( 0.35, emis ) : 0 ) : ( p.emissive || 0 ) * ( emis > 0 ? 1 : 0 );
				B.part( bone, p.shape, scaleVec( p.pos, s ), p.rot, scaleVec( p.scale, s ), c, { emissive: e, shine: p.shine || p.color === 'metal', flags: 4 } );

			}

			const len = ( def.length ?? 0.9 ) * s;
			B.point( 'weaponBase', bone, [ 0, ( def.base ?? 0.1 ) * s, 0 ] );
			B.point( 'weaponTip', bone, [ 0, len, 0 ] );
			if ( def.grip2 !== undefined && stance === 'twohand' ) B.meta.grip2 = { bone, pos: [ 0, def.grip2 * s, 0 ] };
			B.meta.weaponClass = def.weaponClass;

		}

	} else if ( L.tool ) {

		const def = get( 'model', 'tool-' + L.tool );
		if ( def ) {

			if ( L.tool === 'spear' || L.tool === 'staff' ) stance = 'pole';
			const bone = def.hand === 'L' ? oBone : wBone;
			for ( const p of def.parts ) B.part( bone, p.shape, scaleVec( p.pos, s ), p.rot, scaleVec( p.scale, s ), p.color === 'metal' ? col.metal : p.color === 'glow' ? col.glow : p.color === 'accent' ? col.accent : p.color, { emissive: p.emissive, shine: p.shine } );
			B.point( 'weaponBase', bone, [ 0, 0, 0 ] );
			B.point( 'weaponTip', bone, [ 0, ( def.length ?? 0.6 ) * s, 0 ] );

		}

	}

	if ( ! B.attach.weaponBase ) {

		B.point( 'weaponBase', handR, [ 0, - 0.06, 0.03 ] );
		B.point( 'weaponTip', handR, [ 0, - 0.08, 0.25 ] );

	}

	B.point( 'head', head, [ 0, 0.1 * hs, 0.13 * hs ] );
	B.point( 'chest', chest, [ 0, 0.1, 0.13 * g ] );
	B.meta.plan = 'humanoid';
	B.meta.stance = stance;
	B.meta.gait = { duty: 0.6, lift: 0.2, baseBounce: 0.04, bounce: 1, baseCadence: 1, cadence: 1, stride: 1, posture: 0.05 };
	B.meta.personality = null;
	return B.build( { primary: col.shirt, secondary: col.pants, accent: col.accent, skin: col.skin, metal: col.metal, glow: col.glow, dark: col.shoes } );

}

function scaleVec( v, s ) {

	return v ? [ v[ 0 ] * s, v[ 1 ] * s, v[ 2 ] * s ] : [ 0, 0, 0 ];

}
