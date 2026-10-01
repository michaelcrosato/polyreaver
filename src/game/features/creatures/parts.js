// Body parts: the Spore-style building blocks ( define( 'bodyPart', def ) ). A body
// plan ( plans.js ) builds the skeleton and leaves ANCHORS; each part def dresses
// the anchors of its slot with primitives - so 'horned' horns sit on a wolf, a
// beetle or a beholder without knowing which.
//
//   define( 'bodyPart', {
//     id, name, slot, tags, weight,
//     plans?: [ planIds ]              restrict to body plans (default: any plan offering the slot)
//     styles?: [ attack styles ]       added to genomeMetrics().attackStyles ( 'bite', 'claw', ... )
//     build( K, p )                    p = the genome's choice { id, s: size 0.6..1.5, v: variant 0..1 }
//   } )
//
// Slots (in build order): torso, legs, arms, head, eyes, horns, back, tail, wings, extra.
// Colours are palette KEYS, so every part reads correctly in every palette; parts
// mark glowing bits with `emissive` (and the 'glow' key) - casters pulse them.
// Keep parts lean: a monster should land around 20-35 primitives.

import { define, get as getDef } from '../../core/registry.js';
import { addArm } from './plans.js';
import { PF } from './rig.js';

const D2R = Math.PI / 180;

// --- helpers ---------------------------------------------------------------------------

// Colour of torso segment i under the genome's pattern.
function segColor( K, i ) {

	const pat = K.g.pattern;
	if ( pat === 'banded' ) return Math.abs( i ) % 2 ? 'secondary' : 'primary';
	return 'primary';

}

function segShade( K, i, n ) {

	return K.g.pattern === 'gradient' ? 0.75 + 0.5 * ( ( i + n ) / ( 2 * n || 1 ) ) : 1;

}

// Long axis of a torso segment: 'y' (upright bipeds) or 'z' (horizontal bodies).
const longY = ( s ) => s[ 1 ] > s[ 2 ] * 1.05;

// Pattern overlays every torso style shares: spots and stripes.
function patternOverlay( K, seg, i ) {

	const { B, g } = K;
	const [ w, h, l ] = seg.s, c = seg.c;
	if ( g.pattern === 'spotted' && i % 2 === 0 ) {

		for ( const sx of [ - 1, 1 ] ) B.part( seg.bone, 'sphere', [ c[ 0 ] + sx * w * 0.32, c[ 1 ] + h * 0.33, c[ 2 ] + l * 0.12 * sx ], [ 0, 0, 0 ], [ w * 0.22, h * 0.18, w * 0.22 ], 'accent' );

	} else if ( g.pattern === 'striped' ) {

		if ( longY( seg.s ) ) B.part( seg.bone, 'box', [ c[ 0 ], c[ 1 ] + h * 0.1, c[ 2 ] ], [ 0, 0, 0 ], [ w * 1.02, h * 0.12, l * 1.02 ], 'dark' );
		else B.part( seg.bone, 'box', [ c[ 0 ], c[ 1 ] + h * 0.12, c[ 2 ] ], [ 0, 0, 0 ], [ w * 0.9, h * 0.8, l * 0.14 ], 'dark' );

	}

}

// --- torso -------------------------------------------------------------------------------

function torsoBase( K, shapeY, shapeZ, opts = {} ) {

	const { B } = K;
	const n = K.torso.length;
	// the lighter underside goes on the biggest segment only (part budget)
	const big = K.torso.reduce( ( a, sg ) => ( sg.s[ 0 ] * sg.s[ 1 ] * sg.s[ 2 ] > a.s[ 0 ] * a.s[ 1 ] * a.s[ 2 ] ? sg : a ), K.torso[ 0 ] );
	K.torso.forEach( ( seg, k ) => {

		const i = seg.i ?? k;
		const [ w, h, l ] = seg.s, c = seg.c;
		const col = opts.color ? opts.color( i ) : segColor( K, i );
		const shade = segShade( K, i, n );
		if ( longY( seg.s ) ) B.part( seg.bone, shapeY, c, [ 0, 0, 0 ], [ w, h, l ], col, { shade } );
		else if ( shapeZ === 'capsule' || shapeZ === 'cyl' || shapeZ === 'cone' ) B.part( seg.bone, shapeZ, c, [ Math.PI / 2, 0, 0 ], [ w, l, h ], col, { shade } );
		else B.part( seg.bone, shapeZ, c, [ 0, 0, 0 ], [ w, h, l ], col, { shade } );
		if ( opts.belly !== false && ! K.head?.isBody && h > 0.14 && seg === big ) {

			// lighter underside: the two-tone read of almost every animal
			B.part( seg.bone, longY( seg.s ) ? 'box' : 'sphere', [ c[ 0 ], c[ 1 ] - h * 0.18, c[ 2 ] + ( longY( seg.s ) ? l * 0.22 : 0 ) ], [ 0, 0, 0 ],
				longY( seg.s ) ? [ w * 0.6, h * 0.55, l * 0.6 ] : [ w * 0.78, h * 0.6, l * 0.85 ], 'secondary' );

		}

		patternOverlay( K, seg, i );
		// long bodies (serpents, long spines) decorate every other segment
		if ( n <= 4 || k % 2 === 0 ) opts.each?.( seg, i );

	} );

}

const T = ( id, name, tags, build, extra = {} ) => define( 'bodyPart', { id, name, slot: 'torso', tags, build, ...extra } );

T( 'muscled', 'Muscled', [ 'flesh' ], ( K ) => torsoBase( K, 'cyl', 'sphere' ), { plans: [ 'biped', 'quadruped', 'avian', 'serpent' ] } );

T( 'barrel', 'Barrel-chested', [ 'flesh', 'brute' ], ( K ) => torsoBase( K, 'sphere', 'sphere', { each( seg ) {

	// a big round gut on the middle segment
	if ( seg === K.torso[ 1 ] ) K.B.part( seg.bone, 'sphere', [ 0, seg.c[ 1 ] - seg.s[ 1 ] * 0.1, seg.c[ 2 ] + seg.s[ 2 ] * 0.15 ], [ 0, 0, 0 ], [ seg.s[ 0 ] * 1.25, seg.s[ 1 ] * 1.1, seg.s[ 2 ] * 1.25 ], 'skin' );

} } ), { plans: [ 'biped', 'quadruped' ], weight: 0.8 } );

T( 'plated', 'Armour-plated', [ 'armored', 'metal' ], ( K ) => torsoBase( K, 'cyl', 'sphere', { each( seg ) {

	const [ w, h, l ] = seg.s, c = seg.c;
	if ( longY( seg.s ) ) K.B.part( seg.bone, 'box', [ c[ 0 ], c[ 1 ] + h * 0.08, c[ 2 ] + l * 0.32 ], [ 0.1, 0, 0 ], [ w * 0.95, h * 0.7, l * 0.35 ], 'metal', { shine: true } );
	else K.B.part( seg.bone, 'wedge', [ c[ 0 ], c[ 1 ] + h * 0.36, c[ 2 ] ], [ 0, 0, 0 ], [ w * 0.95, h * 0.35, l * 0.95 ], 'metal', { shine: true } );

} } ), { plans: [ 'biped', 'quadruped', 'hexapod', 'serpent', 'avian' ], styles: [ 'charge' ] } );

T( 'chitin', 'Chitin', [ 'insect', 'armored' ], ( K ) => torsoBase( K, 'octa', 'sphere', { belly: false, each( seg, i ) {

	// glossy dark bands across each segment
	const [ w, h, l ] = seg.s, c = seg.c;
	if ( l > 0.3 ) for ( let k = - 1; k <= 1; k += 2 ) K.B.part( seg.bone, 'box', [ c[ 0 ], c[ 1 ] + h * 0.05, c[ 2 ] + k * l * 0.22 ], [ 0, 0, 0 ], [ w * 0.96, h * 0.9, l * 0.07 ], i % 2 ? 'accent' : 'dark', { shine: true } );

} } ), { plans: [ 'hexapod', 'arachnid', 'quadruped', 'biped', 'serpent' ] } );

T( 'scaled', 'Scaled', [ 'reptile' ], ( K ) => torsoBase( K, 'cyl', 'octa', { each( seg, i ) {

	const [ w, h, l ] = seg.s, c = seg.c;
	// belly plates: flat boxes underneath, the classic snake read
	if ( ! longY( seg.s ) && i % 2 === 0 ) K.B.part( seg.bone, 'box', [ c[ 0 ], c[ 1 ] - h * 0.36, c[ 2 ] ], [ 0, 0, 0 ], [ w * 0.7, h * 0.25, l * 1.6 ], 'skin' );

}, belly: false } ), { plans: [ 'serpent', 'quadruped', 'biped' ] } );

T( 'furred', 'Shaggy fur', [ 'beast', 'cold' ], ( K ) => torsoBase( K, 'cyl', 'sphere', { each( seg, i ) {

	const [ w, h, l ] = seg.s, c = seg.c;
	for ( const sx of [ - 1, 1 ] ) K.B.part( seg.bone, 'tetra', [ c[ 0 ] + sx * w * 0.3, c[ 1 ] + h * 0.38, c[ 2 ] - l * 0.1 ], [ 0.4, sx * 0.6, sx * 0.4 ], [ w * 0.45, h * 0.5, l * 0.45 ], i % 2 ? 'secondary' : 'primary', { shade: 0.85 } );

} } ), { plans: [ 'biped', 'quadruped', 'avian' ] } );

T( 'skeletal', 'Skeletal', [ 'undead', 'bone' ], ( K ) => {

	const { B } = K;
	K.torso.forEach( ( seg, k ) => {

		const [ w, h, l ] = seg.s, c = seg.c;
		const up = longY( seg.s );
		// dark spine core + bone ribs
		B.part( seg.bone, up ? 'cyl' : 'capsule', c, up ? [ 0, 0, 0 ] : [ Math.PI / 2, 0, 0 ], up ? [ w * 0.25, h, w * 0.25 ] : [ w * 0.25, l, w * 0.25 ], 'dark' );
		// rib slats: thin bone bars wrapping the core
		for ( let r = 0; r < 2; r ++ ) {

			const o = ( r - 0.5 ) * ( up ? h * 0.42 : l * 0.42 );
			if ( up ) B.part( seg.bone, 'box', [ c[ 0 ], c[ 1 ] + o, c[ 2 ] + l * 0.05 ], [ 0.15, 0, 0 ], [ w * 0.95, h * 0.11, l * 0.85 ], 'skin' );
			else B.part( seg.bone, 'box', [ c[ 0 ], c[ 1 ] + h * 0.05, c[ 2 ] + o ], [ 0, 0, 0 ], [ w * 0.95, h * 0.85, l * 0.11 ], 'skin' );

		}

		if ( k === 0 ) B.part( seg.bone, 'tetra', c, [ 0, 0, 0 ], [ w * 0.7, h * 0.5, l * 0.6 ], 'skin' );

	} );

}, { plans: [ 'biped', 'quadruped', 'serpent', 'avian' ], weight: 0.8 } );

T( 'crystal', 'Crystal growths', [ 'crystal', 'magic' ], ( K ) => torsoBase( K, 'octa', 'octa', { each( seg, i ) {

	const [ w, h ] = seg.s, c = seg.c;
	if ( i % 2 === 0 ) K.B.part( seg.bone, 'octa', [ c[ 0 ] + w * 0.3, c[ 1 ] + h * 0.42, c[ 2 ] ], [ 0.3, 0, - 0.4 ], [ w * 0.25, h * 0.7, w * 0.25 ], 'glow', { emissive: 0.7 } );
	else K.B.part( seg.bone, 'octa', [ c[ 0 ] - w * 0.25, c[ 1 ] + h * 0.4, c[ 2 ] ], [ - 0.2, 0, 0.5 ], [ w * 0.2, h * 0.55, w * 0.2 ], 'glow', { emissive: 0.7 } );

} } ), { styles: [ 'cast' ], weight: 0.7 } );

T( 'rocky', 'Rocky', [ 'earth', 'golem' ], ( K ) => torsoBase( K, 'octa', 'octa', { each( seg ) {

	const [ w, h, l ] = seg.s, c = seg.c;
	K.B.part( seg.bone, 'tetra', [ c[ 0 ] + w * 0.2, c[ 1 ] + h * 0.25, c[ 2 ] - l * 0.1 ], [ 0.5, 0.3, 0.2 ], [ w * 0.6, h * 0.6, l * 0.6 ], 'secondary' );

} } ), { plans: [ 'biped', 'quadruped', 'blob', 'floater' ], styles: [ 'slam' ], weight: 0.8 } );

T( 'feathered', 'Feathered', [ 'bird' ], ( K ) => torsoBase( K, 'sphere', 'sphere', { each( seg ) {

	const [ w, h, l ] = seg.s, c = seg.c;
	K.B.part( seg.bone, 'wedge', [ c[ 0 ], c[ 1 ] + h * 0.28, c[ 2 ] - l * 0.15 ], [ - 0.2, 0, 0 ], [ w * 0.85, h * 0.4, l * 0.8 ], 'accent', { shade: 0.8 } );

} } ), { plans: [ 'avian', 'biped', 'quadruped' ] } );

// floater / blob bodies (the head IS the body)
T( 'orb', 'Eye orb', [ 'magic' ], ( K ) => {

	const seg = K.torso[ 0 ], [ w, h, l ] = seg.s;
	K.B.part( seg.bone, 'sphere', seg.c, [ 0, 0, 0 ], [ w, h, l ], 'primary' );
	K.B.part( seg.bone, 'ring', [ 0, - h * 0.05, 0 ], [ 0, 0, 0 ], [ w * 1.08, h * 0.35, l * 1.08 ], 'accent' );
	K.B.part( seg.bone, 'sphere', [ 0, - h * 0.25, 0 ], [ 0, 0, 0 ], [ w * 0.8, h * 0.6, l * 0.8 ], 'secondary' );

}, { plans: [ 'floater', 'blob' ], styles: [ 'cast' ] } );

T( 'jelly', 'Jelly', [ 'ooze', 'water' ], ( K ) => {

	const seg = K.torso[ 0 ], [ w, h, l ] = seg.s, c = seg.c;
	K.B.part( seg.bone, 'sphere', c, [ 0, 0, 0 ], [ w, h, l ], 'primary' );
	// a bright nucleus showing at the crown, plus a rim of drips
	K.B.part( seg.bone, 'sphere', [ c[ 0 ], c[ 1 ] + h * 0.18, c[ 2 ] ], [ 0, 0, 0 ], [ w * 0.45, h * 0.4, l * 0.45 ], 'glow', { emissive: 0.6 } );
	for ( let i = 0; i < 4; i ++ ) {

		const a = i / 4 * Math.PI * 2 + 0.4;
		K.B.part( seg.bone, 'cone', [ c[ 0 ] + Math.sin( a ) * w * 0.4, c[ 1 ] - h * 0.32, c[ 2 ] + Math.cos( a ) * l * 0.4 ], [ Math.PI, 0, 0 ], [ w * 0.16, h * 0.3, w * 0.16 ], 'secondary' );

	}

}, { plans: [ 'floater', 'blob' ], styles: [ 'spit' ] } );

T( 'skullbody', 'Haunted skull', [ 'undead', 'bone' ], ( K ) => {

	const seg = K.torso[ 0 ], [ w, h, l ] = seg.s, c = seg.c;
	K.B.part( seg.bone, 'sphere', [ c[ 0 ], c[ 1 ] + h * 0.08, c[ 2 ] ], [ 0, 0, 0 ], [ w, h * 0.9, l ], 'skin' );
	K.B.part( seg.bone, 'box', [ c[ 0 ], c[ 1 ] - h * 0.32, c[ 2 ] + l * 0.18 ], [ 0, 0, 0 ], [ w * 0.62, h * 0.32, l * 0.6 ], 'skin', { shade: 0.85 } );
	K.B.part( seg.bone, 'tetra', [ c[ 0 ], c[ 1 ] - h * 0.05, c[ 2 ] + l * 0.48 ], [ 0.5, 0.78, 0 ], [ w * 0.16, h * 0.16, l * 0.1 ], 'dark' );
	// a ghostly flame trail behind
	K.B.part( seg.bone, 'cone', [ c[ 0 ], c[ 1 ] + h * 0.1, c[ 2 ] - l * 0.62 ], [ - Math.PI / 2 - 0.3, 0, 0 ], [ w * 0.55, l * 0.75, h * 0.5 ], 'glow', { emissive: 0.75 } );

}, { plans: [ 'floater' ], styles: [ 'cast', 'charge' ], weight: 0.8 } );

T( 'slime', 'Slime', [ 'ooze', 'poison' ], ( K ) => {

	const seg = K.torso[ 0 ], [ w, h, l ] = seg.s, c = seg.c;
	K.B.part( seg.bone, 'sphere', c, [ 0, 0, 0 ], [ w, h, l ], 'primary' );
	K.B.part( seg.bone, 'sphere', [ c[ 0 ], c[ 1 ] - h * 0.32, c[ 2 ] ], [ 0, 0, 0 ], [ w * 1.15, h * 0.4, l * 1.15 ], 'secondary' );
	for ( let i = 0; i < 3; i ++ ) {

		const a = i * 2.1 + 0.5;
		K.B.part( seg.bone, 'sphere', [ c[ 0 ] + Math.sin( a ) * w * 0.28, c[ 1 ] + h * ( 0.1 + i * 0.12 ), c[ 2 ] + Math.cos( a ) * l * 0.3 ], [ 0, 0, 0 ], [ w * 0.14, w * 0.14, w * 0.14 ], 'glow', { emissive: 0.5 } );

	}

}, { plans: [ 'blob' ], styles: [ 'spit' ] } );

// --- legs ----------------------------------------------------------------------------------

function legBase( K, opts ) {

	const { B } = K;
	// part budget: many-legged bodies only dress their front pair
	const many = K.legs.length > 4;
	for ( const L of K.legs ) {

		L.detail = ! many || L.front;
		const t = L.t, { a, b } = L;
		const thighShape = opts.thigh || 'cyl', shinShape = opts.shin || 'cyl';
		B.segment( L.thigh, thighShape, [ 0, 0.02, 0 ], [ 0, - a, 0 ], [ t * ( opts.thighK ?? 1.15 ), t * ( opts.thighK ?? 1.15 ) ], opts.thighColor || 'primary', { overlap: 1.08 } );
		B.segment( L.shin, shinShape, [ 0, 0, 0 ], [ 0, - b, 0 ], [ t * ( opts.shinK ?? 0.8 ), t * ( opts.shinK ?? 0.8 ) ], opts.shinColor || ( K.g.pattern === 'banded' ? 'accent' : 'primary' ), { overlap: 1.04, shade: opts.shinShade ?? 0.9 } );
		opts.each?.( L );

	}

}

const LG = ( id, name, tags, build, extra = {} ) => define( 'bodyPart', { id, name, slot: 'legs', tags, build, ...extra } );

LG( 'plain', 'Sturdy legs', [ 'flesh' ], ( K ) => legBase( K, { each( L ) {

	K.B.part( L.foot, 'box', [ 0, - L.ankle * 0.45, L.footLen * 0.28 ], [ 0, 0, 0 ], [ L.t * 1.1, L.ankle * 1.1, L.footLen ], 'dark' );

} } ), { plans: [ 'biped', 'quadruped', 'avian' ] } );

LG( 'clawed', 'Clawed legs', [ 'beast' ], ( K ) => legBase( K, { each( L ) {

	K.B.part( L.foot, 'box', [ 0, - L.ankle * 0.4, L.footLen * 0.22 ], [ 0, 0, 0 ], [ L.t * 1.2, L.ankle * 1.1, L.footLen * 0.8 ], 'primary', { shade: 0.8 } );
	if ( L.detail ) K.B.part( L.foot, 'spike', [ 0, - L.ankle * 0.55, L.footLen * 0.65 ], [ 1.45, 0, 0 ], [ L.t * 0.9, L.footLen * 0.45, L.t * 0.25 ], 'metal' );

} } ), { plans: [ 'biped', 'quadruped' ], styles: [ 'claw' ] } );

LG( 'hoofed', 'Hooves', [ 'beast' ], ( K ) => legBase( K, { shin: 'cone', shinK: 0.9, each( L ) {

	K.B.part( L.foot, 'cyl', [ 0, - L.ankle * 0.4, 0.02 ], [ 0, 0, 0 ], [ L.t * 1.1, L.ankle * 1.3, L.t * 1.2 ], 'dark' );

} } ), { plans: [ 'quadruped', 'biped' ], styles: [ 'charge', 'stomp' ] } );

LG( 'armored', 'Armoured legs', [ 'armored', 'metal' ], ( K ) => legBase( K, { each( L ) {

	const fw = L.pole[ 2 ] < 0 ? - 1 : 1;
	K.B.part( L.shin, 'box', [ 0, - L.b * 0.45, fw * L.t * 0.4 ], [ 0, 0, 0 ], [ L.t * 1.1, L.b * 0.7, L.t * 0.4 ], 'metal', { shine: true } );
	if ( L.detail ) K.B.part( L.shin, 'spike', [ 0, 0, fw * L.t * 0.5 ], [ fw * 1.4, 0, 0 ], [ L.t * 0.4, L.t * 1.2, L.t * 0.4 ], 'metal', { shine: true } );
	K.B.part( L.foot, 'box', [ 0, - L.ankle * 0.4, L.footLen * 0.25 ], [ 0, 0, 0 ], [ L.t * 1.25, L.ankle * 1.2, L.footLen ], 'metal', { shine: true } );

} } ), { plans: [ 'biped', 'quadruped' ], styles: [ 'stomp' ] } );

LG( 'insect', 'Jointed legs', [ 'insect' ], ( K ) => legBase( K, { thigh: 'prism', shin: 'cone', thighK: 1, shinK: 0.9, shinColor: 'dark', shinShade: 1, each( L ) {

	if ( L.detail ) K.B.part( L.thigh, 'sphere', [ 0, - L.a, 0 ], [ 0, 0, 0 ], [ L.t * 1.3, L.t * 1.3, L.t * 1.3 ], 'accent' );

} } ), { plans: [ 'hexapod', 'arachnid' ] } );

LG( 'hairy', 'Hairy legs', [ 'spider' ], ( K ) => legBase( K, { thigh: 'tetra', shin: 'cone', thighK: 1.7, shinK: 0.8, shinColor: 'secondary', each( L ) {

	if ( L.detail ) K.B.part( L.shin, 'spike', [ 0, - L.b - 0.02, 0 ], [ Math.PI, 0, 0 ], [ L.t * 0.5, 0.08, L.t * 0.5 ], 'accent' );

} } ), { plans: [ 'arachnid', 'hexapod' ] } );

LG( 'stilt', 'Stilt legs', [ 'insect', 'bird' ], ( K ) => legBase( K, { thighK: 0.7, shinK: 0.45, shin: 'cone', each( L ) {

	if ( L.detail ) K.B.part( L.foot, 'spike', [ 0, - L.ankle * 0.5, 0.02 ], [ Math.PI, 0, 0 ], [ L.t * 0.6, L.ankle * 1.5, L.t * 0.6 ], 'dark' );

} } ), { plans: [ 'hexapod', 'arachnid', 'avian', 'quadruped' ], weight: 0.7 } );

LG( 'talons', 'Talons', [ 'bird' ], ( K ) => legBase( K, { thigh: 'sphere', thighK: 1.8, shinK: 0.55, shinColor: 'accent', each( L ) {

	for ( const k of [ - 1, 1 ] ) K.B.part( L.foot, 'spike', [ k * 0.035, - L.ankle * 0.7, 0.06 ], [ 1.5, k * 0.3, 0 ], [ 0.04, L.footLen * 0.6, 0.04 ], 'accent' );
	K.B.part( L.foot, 'spike', [ 0, - L.ankle * 0.7, - 0.05 ], [ - 1.5, 0, 0 ], [ 0.03, L.footLen * 0.35, 0.03 ], 'metal' );

} } ), { plans: [ 'avian', 'biped' ], styles: [ 'claw' ] } );

LG( 'bony', 'Bone legs', [ 'undead', 'bone' ], ( K ) => legBase( K, { thighK: 0.6, shinK: 0.5, thighColor: 'skin', shinColor: 'skin', each( L ) {

	if ( L.detail ) K.B.part( L.thigh, 'sphere', [ 0, - L.a, 0 ], [ 0, 0, 0 ], [ L.t * 1.1, L.t * 1.1, L.t * 1.1 ], 'skin', { shade: 0.85 } );
	K.B.part( L.foot, 'box', [ 0, - L.ankle * 0.4, L.footLen * 0.25 ], [ 0, 0, 0 ], [ L.t * 0.9, L.ankle * 0.8, L.footLen * 0.9 ], 'skin', { shade: 0.85 } );

} } ), { plans: [ 'biped', 'quadruped', 'avian', 'arachnid' ], weight: 0.7 } );

LG( 'furpaws', 'Furred paws', [ 'beast', 'cold' ], ( K ) => legBase( K, { thigh: 'sphere', thighK: 1.7, shinK: 0.75, each( L ) {

	K.B.part( L.foot, 'sphere', [ 0, - L.ankle * 0.2, L.footLen * 0.2 ], [ 0, 0, 0 ], [ L.t * 1.5, L.ankle * 1.6, L.footLen * 0.9 ], 'secondary' );

} } ), { plans: [ 'quadruped', 'biped' ] } );

// --- arms ------------------------------------------------------------------------------------
// Bipeds already have arm bones; other plans grow a pair at K.armMount (mantis
// scythes, crab pincers, naga arms, floater tentacle-claws) so 'claw' poses work.

function ensureArms( K, len = 1 ) {

	if ( K.arms.length ) return K.arms;
	const m = K.armMount;
	if ( ! m ) return [];
	const s = K.head?.s ?? 0.2;
	const a = ( 0.22 + s * 0.4 ) * len, b = ( 0.24 + s * 0.4 ) * len;
	K.B.pair( ( side, S ) => addArm( K, m.bone, S, [ m.pos[ 0 ] + side * m.w, m.pos[ 1 ], m.pos[ 2 ] ], a, b, 0.06 * ( K.b.girth ?? 1 ), { splay: 0.35, pitch: - 0.5, bend: - 1.4 } ) );
	return K.arms;

}

function armBase( K, opts = {} ) {

	const { B } = K;
	for ( const A of K.arms ) {

		B.segment( A.upper, opts.upper || 'cyl', [ 0, 0.03, 0 ], [ 0, - A.a, 0 ], A.t * ( opts.upperK ?? 1.1 ), opts.upperColor || 'primary', { overlap: 1.08 } );
		B.segment( A.fore, opts.fore || 'cyl', [ 0, 0, 0 ], [ 0, - A.b, 0 ], A.t * ( opts.foreK ?? 0.9 ), opts.foreColor || 'primary', { overlap: 1.04, shade: 0.92 } );
		if ( opts.shoulder !== false && K.g.plan === 'biped' && A.t > 0.085 ) B.part( A.upper, 'sphere', [ 0, - 0.01, 0 ], [ 0, 0, 0 ], A.t * 1.6, 'primary' );
		opts.hand?.( A );

	}

}

const AR = ( id, name, tags, build, extra = {} ) => define( 'bodyPart', { id, name, slot: 'arms', tags, build, ...extra } );

AR( 'claws', 'Claws', [ 'beast' ], ( K ) => {

	ensureArms( K );
	armBase( K, { hand( A ) {

		K.B.part( A.hand, 'box', [ 0, - A.t * 0.6, 0 ], [ 0, 0, 0 ], [ A.t * 1.4, A.t * 1.3, A.t * 1.2 ], 'skin' );
		for ( const k of [ - 1, 1 ] ) K.B.part( A.hand, 'spike', [ k * A.t * 0.35, - A.t * 1.6, A.t * 0.25 ], [ 0.25, 0, 0 ], [ A.t * 0.38, A.t * 1.6, A.t * 0.38 ], 'metal' );

	} } );

}, { styles: [ 'claw' ] } );

AR( 'blades', 'Scythe arms', [ 'insect', 'blade' ], ( K ) => {

	ensureArms( K, 1.15 );
	armBase( K, { foreK: 0.7, hand( A ) {

		K.B.part( A.hand, 'blade', [ 0, A.b * 0.2, A.t * 0.9 ], [ - 2.6, 0, 0 ], [ A.t * 0.9, A.b * 1.3, A.t * 0.35 ], 'metal', { shine: true } );

	} } );

}, { styles: [ 'claw' ], plans: [ 'biped', 'hexapod', 'arachnid', 'serpent' ] } );

AR( 'pincers', 'Pincers', [ 'crab', 'armored' ], ( K ) => {

	ensureArms( K );
	armBase( K, { foreK: 1.3, hand( A ) {

		K.B.part( A.hand, 'sphere', [ 0, - A.t * 0.8, 0 ], [ 0, 0, 0 ], [ A.t * 2.2, A.t * 2, A.t * 2.4 ], 'accent', { shine: true } );
		K.B.part( A.hand, 'wedge', [ A.t * 0.3, - A.t * 2.2, A.t * 0.2 ], [ 0, 0, 0.15 ], [ A.t * 0.8, A.t * 2, A.t * 0.9 ], 'accent' );
		K.B.part( A.hand, 'wedge', [ - A.t * 0.4, - A.t * 1.9, A.t * 0.2 ], [ 0, Math.PI, - 0.3 ], [ A.t * 0.7, A.t * 1.6, A.t * 0.8 ], 'accent', { shade: 0.8 } );

	} } );

}, { styles: [ 'claw' ] } );

AR( 'fists', 'Hammer fists', [ 'golem', 'brute' ], ( K ) => {

	ensureArms( K );
	armBase( K, { foreK: 1.5, fore: 'cone', hand( A ) {

		K.B.part( A.hand, 'box', [ 0, - A.t * 0.9, 0 ], [ 0.2, 0.3, 0 ], [ A.t * 2.4, A.t * 2.2, A.t * 2.4 ], 'secondary' );

	} } );

}, { styles: [ 'slam' ], plans: [ 'biped', 'blob', 'floater' ] } );

AR( 'tentarms', 'Tentacle arms', [ 'aquatic', 'chaos' ], ( K ) => {

	ensureArms( K, 1.2 );
	armBase( K, { upper: 'cone', fore: 'cone', upperK: 1, foreK: 0.75, shoulder: false, upperColor: 'secondary', hand( A ) {

		K.B.part( A.hand, 'spike', [ 0, - A.t * 0.8, 0 ], [ Math.PI, 0, 0 ], [ A.t * 0.7, A.t * 2, A.t * 0.7 ], 'accent' );

	} } );

}, { styles: [ 'claw' ] } );

AR( 'armed', 'Crude weapon', [ 'humanoid', 'brute' ], ( K ) => {

	armBase( K, { hand( A ) {

		K.B.part( A.hand, 'box', [ 0, - A.t * 0.6, 0 ], [ 0, 0, 0 ], [ A.t * 1.3, A.t * 1.3, A.t * 1.2 ], 'skin' );
		if ( A.side < 0 && ! K.armedDone ) {

			// a club or cleaver in the right hand
			K.armedDone = true;
			const club = K.rng.chance( 0.5 );
			K.B.part( A.hand, 'cyl', [ 0, - A.t * 0.7, A.t * 1.2 ], [ Math.PI / 2, 0, 0 ], [ A.t * 0.6, A.t * 5, A.t * 0.6 ], 'dark' );
			if ( club ) K.B.part( A.hand, 'octa', [ 0, - A.t * 0.7, A.t * 4.2 ], [ 0, 0, 0 ], [ A.t * 2.2, A.t * 2.2, A.t * 3.4 ], 'secondary' );
			else K.B.part( A.hand, 'box', [ 0, - A.t * 1.6, A.t * 3.5 ], [ 0, 0, 0 ], [ A.t * 0.3, A.t * 3, A.t * 3.2 ], 'metal', { shine: true } );
			K.B.point( 'weaponTip', A.hand, [ 0, - A.t * 0.7, A.t * 5 ] );

		}

	} } );

}, { styles: [ 'slam', 'claw' ], plans: [ 'biped' ] } );

// --- heads -----------------------------------------------------------------------------------
// Heads place K.eyes ( [ { bone, pos, r } ] ) and K.hornBase ( { bone, pos, w } ) for
// the eyes and horns slots, and usually add a JAW bone (role 'jaw') for bites/roars.

function jaw( K, pos, rot = [ 0, 0, 0 ] ) {

	const j = K.B.bone( 'jaw', K.head.bone, pos, { role: 'jaw', rot } );
	return j;

}

function eyesAt( K, bone, pos, r, n = 2 ) {

	K.eyes = [];
	for ( let i = 0; i < n; i ++ ) {

		const side = n === 1 ? 0 : ( i % 2 ? - 1 : 1 );
		K.eyes.push( { bone, pos: [ pos[ 0 ] * side, pos[ 1 ], pos[ 2 ] ], r, side } );

	}

}

const HD = ( id, name, tags, build, extra = {} ) => define( 'bodyPart', { id, name, slot: 'head', tags, build, ...extra } );

HD( 'brute', 'Brute head', [ 'humanoid', 'brute' ], ( K ) => {

	const { B } = K, { bone, c, s } = K.head;
	B.part( bone, 'box', [ c[ 0 ], c[ 1 ] + s * 0.08, c[ 2 ] ], [ 0, 0, 0 ], [ s * 0.95, s * 0.85, s * 0.95 ], 'skin' );
	B.part( bone, 'box', [ c[ 0 ], c[ 1 ] + s * 0.28, c[ 2 ] + s * 0.42 ], [ 0.2, 0, 0 ], [ s * 1.02, s * 0.2, s * 0.25 ], 'dark' );
	const j = jaw( K, [ 0, c[ 1 ] - s * 0.22, c[ 2 ] - s * 0.1 ] );
	B.part( j, 'box', [ 0, - s * 0.1, s * 0.22 ], [ 0, 0, 0 ], [ s * 0.88, s * 0.32, s * 0.75 ], 'skin', { shade: 0.85 } );
	for ( const sx of [ - 1, 1 ] ) B.part( j, 'cone', [ sx * s * 0.3, s * 0.12, s * 0.5 ], [ 0, 0, sx * 0.2 ], [ s * 0.12, s * 0.3, s * 0.12 ], 'metal' );
	eyesAt( K, bone, [ s * 0.22, c[ 1 ] + s * 0.14, c[ 2 ] + s * 0.47 ], s * 0.12 );
	K.hornBase = { bone, pos: [ 0, c[ 1 ] + s * 0.45, c[ 2 ] ], w: s * 0.45 };

}, { plans: [ 'biped', 'quadruped' ], styles: [ 'bite', 'roar' ] } );

HD( 'snout', 'Snout', [ 'beast' ], ( K ) => {

	const { B } = K, { bone, c, s } = K.head;
	B.part( bone, 'sphere', [ c[ 0 ], c[ 1 ] + s * 0.1, c[ 2 ] - s * 0.15 ], [ 0, 0, 0 ], [ s * 0.95, s * 0.85, s * 0.9 ], 'primary' );
	B.part( bone, 'box', [ c[ 0 ], c[ 1 ] + s * 0.02, c[ 2 ] + s * 0.42 ], [ 0.12, 0, 0 ], [ s * 0.5, s * 0.36, s * 0.8 ], 'primary', { shade: 0.9 } );
	B.part( bone, 'octa', [ c[ 0 ], c[ 1 ] + s * 0.12, c[ 2 ] + s * 0.84 ], [ 0, 0, 0 ], [ s * 0.22, s * 0.16, s * 0.12 ], 'dark' );
	const j = jaw( K, [ 0, c[ 1 ] - s * 0.15, c[ 2 ] ] );
	B.part( j, 'wedge', [ 0, - s * 0.05, s * 0.38 ], [ 0, Math.PI, 0 ], [ s * 0.44, s * 0.18, s * 0.78 ], 'secondary' );
	B.part( j, 'spike', [ s * 0.15, s * 0.08, s * 0.66 ], [ 0, 0, 0 ], [ s * 0.07, s * 0.16, s * 0.07 ], 'skin' );
	B.part( j, 'spike', [ - s * 0.15, s * 0.08, s * 0.66 ], [ 0, 0, 0 ], [ s * 0.07, s * 0.16, s * 0.07 ], 'skin' );
	// ears (spring chain-free: little tetras)
	for ( const sx of [ - 1, 1 ] ) B.part( bone, 'tetra', [ sx * s * 0.3, c[ 1 ] + s * 0.5, c[ 2 ] - s * 0.35 ], [ - 0.3, 0, sx * 0.3 ], [ s * 0.25, s * 0.45, s * 0.18 ], 'primary', { shade: 0.85 } );
	eyesAt( K, bone, [ s * 0.24, c[ 1 ] + s * 0.24, c[ 2 ] + s * 0.18 ], s * 0.09 );
	K.hornBase = { bone, pos: [ 0, c[ 1 ] + s * 0.45, c[ 2 ] - s * 0.1 ], w: s * 0.42 };

}, { plans: [ 'quadruped', 'biped', 'serpent' ], styles: [ 'bite' ] } );

HD( 'tusked', 'Tusked snout', [ 'beast', 'brute' ], ( K ) => {

	const { B } = K, { bone, c, s } = K.head;
	B.part( bone, 'box', [ c[ 0 ], c[ 1 ] + s * 0.05, c[ 2 ] ], [ 0, 0, 0 ], [ s * 0.9, s * 0.8, s * 1.0 ], 'primary' );
	B.part( bone, 'cyl', [ c[ 0 ], c[ 1 ] - s * 0.05, c[ 2 ] + s * 0.6 ], [ Math.PI / 2, 0, 0 ], [ s * 0.45, s * 0.3, s * 0.38 ], 'skin' );
	const j = jaw( K, [ 0, c[ 1 ] - s * 0.25, c[ 2 ] + s * 0.1 ] );
	B.part( j, 'box', [ 0, - s * 0.05, s * 0.3 ], [ 0, 0, 0 ], [ s * 0.6, s * 0.2, s * 0.6 ], 'secondary' );
	for ( const sx of [ - 1, 1 ] ) B.part( j, 'cone', [ sx * s * 0.28, s * 0.25, s * 0.55 ], [ - 0.5, 0, sx * 0.5 ], [ s * 0.14, s * 0.55, s * 0.14 ], 'skin', { shade: 1.15 } );
	eyesAt( K, bone, [ s * 0.28, c[ 1 ] + s * 0.2, c[ 2 ] + s * 0.42 ], s * 0.08 );
	K.hornBase = { bone, pos: [ 0, c[ 1 ] + s * 0.42, c[ 2 ] - s * 0.1 ], w: s * 0.4 };

}, { plans: [ 'quadruped', 'biped' ], styles: [ 'charge', 'bite' ] } );

HD( 'beaked', 'Beak', [ 'bird' ], ( K ) => {

	const { B } = K, { bone, c, s } = K.head;
	B.part( bone, 'sphere', c, [ 0, 0, 0 ], [ s * 0.9, s * 0.9, s * 1.0 ], 'primary' );
	B.part( bone, 'cone', [ c[ 0 ], c[ 1 ] + s * 0.02, c[ 2 ] + s * 0.75 ], [ Math.PI / 2, 0, 0 ], [ s * 0.38, s * 0.85, s * 0.3 ], 'accent' );
	const j = jaw( K, [ 0, c[ 1 ] - s * 0.12, c[ 2 ] + s * 0.25 ] );
	B.part( j, 'cone', [ 0, 0, s * 0.35 ], [ Math.PI / 2, 0, 0 ], [ s * 0.3, s * 0.6, s * 0.15 ], 'accent', { shade: 0.8 } );
	eyesAt( K, bone, [ s * 0.3, c[ 1 ] + s * 0.15, c[ 2 ] + s * 0.25 ], s * 0.1 );
	K.hornBase = { bone, pos: [ 0, c[ 1 ] + s * 0.42, c[ 2 ] - s * 0.05 ], w: s * 0.35 };

}, { plans: [ 'avian', 'biped', 'quadruped' ], styles: [ 'bite' ] } );

HD( 'mandibled', 'Mandibles', [ 'insect' ], ( K ) => {

	const { B } = K, { bone, c, s } = K.head;
	B.part( bone, 'sphere', c, [ 0, 0, 0 ], [ s * 1.0, s * 0.8, s * 0.9 ], 'primary', { shine: true } );
	// two pincer jaws closing sideways (roles jawL / jawR; 'jaw' drives both)
	for ( const [ sx, S ] of [ [ 1, 'L' ], [ - 1, 'R' ] ] ) {

		const j = K.B.bone( 'jaw' + S, bone, [ sx * s * 0.28, c[ 1 ] - s * 0.15, c[ 2 ] + s * 0.35 ], { role: 'jaw' + S } );
		B.part( j, 'cone', [ - sx * s * 0.1, 0, s * 0.3 ], [ Math.PI / 2, 0, sx * 0.0 ], [ s * 0.16, s * 0.6, s * 0.12 ], 'dark' );
		B.part( j, 'spike', [ - sx * s * 0.22, 0, s * 0.58 ], [ Math.PI / 2, - sx * 1.0, 0 ], [ s * 0.1, s * 0.3, s * 0.1 ], 'metal' );

	}

	eyesAt( K, bone, [ s * 0.36, c[ 1 ] + s * 0.18, c[ 2 ] + s * 0.18 ], s * 0.14 );
	K.hornBase = { bone, pos: [ 0, c[ 1 ] + s * 0.32, c[ 2 ] + s * 0.1 ], w: s * 0.3 };

}, { plans: [ 'hexapod', 'arachnid', 'quadruped', 'serpent', 'biped' ], styles: [ 'bite' ] } );

HD( 'fanged', 'Fangs', [ 'spider' ], ( K ) => {

	const { B } = K, { bone, c, s } = K.head;
	B.part( bone, 'sphere', c, [ 0, 0, 0 ], [ s * 1.2, s * 0.8, s * 0.9 ], 'primary' );
	for ( const [ sx, S ] of [ [ 1, 'L' ], [ - 1, 'R' ] ] ) {

		const j = K.B.bone( 'jaw' + S, bone, [ sx * s * 0.25, c[ 1 ] - s * 0.1, c[ 2 ] + s * 0.35 ], { role: 'jaw' + S } );
		B.part( j, 'cone', [ 0, - s * 0.15, s * 0.08 ], [ 0.3, 0, 0 ], [ s * 0.3, s * 0.45, s * 0.3 ], 'secondary' );
		B.part( j, 'spike', [ 0, - s * 0.45, s * 0.15 ], [ Math.PI - 0.3, 0, 0 ], [ s * 0.12, s * 0.35, s * 0.12 ], 'dark' );

	}

	eyesAt( K, bone, [ s * 0.2, c[ 1 ] + s * 0.3, c[ 2 ] + s * 0.25 ], s * 0.08 );
	K.hornBase = { bone, pos: [ 0, c[ 1 ] + s * 0.35, c[ 2 ] ], w: s * 0.3 };

}, { plans: [ 'arachnid', 'hexapod' ], styles: [ 'bite', 'spit' ] } );

HD( 'skull', 'Skull', [ 'undead', 'bone' ], ( K ) => {

	const { B } = K, { bone, c, s } = K.head;
	B.part( bone, 'sphere', [ c[ 0 ], c[ 1 ] + s * 0.1, c[ 2 ] ], [ 0, 0, 0 ], [ s * 0.95, s * 0.9, s * 1.0 ], 'skin', { shade: 1.1 } );
	B.part( bone, 'box', [ c[ 0 ], c[ 1 ] - s * 0.18, c[ 2 ] + s * 0.25 ], [ 0, 0, 0 ], [ s * 0.6, s * 0.3, s * 0.55 ], 'skin' );
	const j = jaw( K, [ 0, c[ 1 ] - s * 0.3, c[ 2 ] ] );
	B.part( j, 'box', [ 0, - s * 0.05, s * 0.3 ], [ 0, 0, 0 ], [ s * 0.55, s * 0.15, s * 0.5 ], 'skin', { shade: 0.9 } );
	B.part( bone, 'tetra', [ c[ 0 ], c[ 1 ] - s * 0.02, c[ 2 ] + s * 0.5 ], [ 0.5, 0.78, 0 ], [ s * 0.14, s * 0.14, s * 0.1 ], 'dark' );
	eyesAt( K, bone, [ s * 0.2, c[ 1 ] + s * 0.12, c[ 2 ] + s * 0.42 ], s * 0.1 );
	K.eyeSockets = true;
	K.hornBase = { bone, pos: [ 0, c[ 1 ] + s * 0.5, c[ 2 ] ], w: s * 0.42 };

}, { plans: [ 'biped', 'quadruped', 'serpent', 'avian' ], styles: [ 'bite' ] } );

HD( 'maw', 'Gaping maw', [ 'brute', 'chaos' ], ( K ) => {

	const { B } = K, { bone, c, s } = K.head;
	const S = s * 1.25;
	B.part( bone, 'sphere', [ c[ 0 ], c[ 1 ] + S * 0.18, c[ 2 ] - S * 0.05 ], [ 0, 0, 0 ], [ S * 0.95, S * 0.65, S * 0.95 ], 'primary' );
	const j = jaw( K, [ 0, c[ 1 ] - S * 0.05, c[ 2 ] - S * 0.2 ] );
	B.part( j, 'sphere', [ 0, - S * 0.12, S * 0.3 ], [ 0, 0, 0 ], [ S * 0.9, S * 0.45, S * 0.85 ], 'secondary' );
	B.part( j, 'box', [ 0, - S * 0.02, S * 0.3 ], [ 0, 0, 0 ], [ S * 0.65, S * 0.1, S * 0.6 ], 'dark' );
	for ( let k = 0; k < 4; k ++ ) {

		const x = ( k - 1.5 ) * S * 0.18;
		B.part( j, 'spike', [ x, S * 0.08, S * 0.62 ], [ 0, 0, 0 ], [ S * 0.08, S * 0.2, S * 0.08 ], 'skin', { shade: 1.2 } );
		B.part( bone, 'spike', [ x, c[ 1 ] - S * 0.04, c[ 2 ] + S * 0.4 ], [ Math.PI, 0, 0 ], [ S * 0.08, S * 0.18, S * 0.08 ], 'skin', { shade: 1.2 } );

	}

	eyesAt( K, bone, [ S * 0.26, c[ 1 ] + S * 0.38, c[ 2 ] + S * 0.25 ], S * 0.08 );
	K.hornBase = { bone, pos: [ 0, c[ 1 ] + S * 0.48, c[ 2 ] - S * 0.1 ], w: S * 0.4 };

}, { plans: [ 'biped', 'quadruped', 'serpent', 'blob', 'floater' ], styles: [ 'bite', 'roar' ] } );

HD( 'serpent', 'Serpent head', [ 'reptile' ], ( K ) => {

	const { B } = K, { bone, c, s } = K.head;
	B.part( bone, 'octa', [ c[ 0 ], c[ 1 ] + s * 0.08, c[ 2 ] ], [ 0, 0, 0 ], [ s * 0.9, s * 0.5, s * 1.3 ], 'primary' );
	const j = jaw( K, [ 0, c[ 1 ] - s * 0.05, c[ 2 ] - s * 0.35 ] );
	B.part( j, 'wedge', [ 0, - s * 0.05, s * 0.4 ], [ 0, Math.PI, 0 ], [ s * 0.7, s * 0.18, s * 1.0 ], 'secondary' );
	for ( const sx of [ - 1, 1 ] ) B.part( bone, 'spike', [ sx * s * 0.18, c[ 1 ] - s * 0.1, c[ 2 ] + s * 0.4 ], [ Math.PI, 0, 0 ], [ s * 0.07, s * 0.22, s * 0.07 ], 'skin', { shade: 1.25 } );
	eyesAt( K, bone, [ s * 0.3, c[ 1 ] + s * 0.18, c[ 2 ] + s * 0.15 ], s * 0.09 );
	K.hornBase = { bone, pos: [ 0, c[ 1 ] + s * 0.25, c[ 2 ] - s * 0.2 ], w: s * 0.35 };

}, { plans: [ 'serpent', 'quadruped' ], styles: [ 'bite', 'spit' ] } );

HD( 'hooded', 'Cobra hood', [ 'reptile', 'poison' ], ( K ) => {

	get( 'serpent' ).build( K );
	const { B } = K, { bone, c, s } = K.head;
	// the hood: two flat wedges flaring out behind the head
	for ( const sx of [ - 1, 1 ] ) B.part( bone, 'wedge', [ sx * s * 0.55, c[ 1 ] + s * 0.1, c[ 2 ] - s * 0.75 ], [ - 0.1, sx * 0.3, sx * 1.4 ], [ s * 0.9, s * 0.12, s * 1.1 ], 'accent' );

}, { plans: [ 'serpent' ], styles: [ 'spit', 'bite' ] } );

HD( 'eyestalk', 'Eyestalks', [ 'aquatic', 'magic' ], ( K ) => {

	const { B } = K, { bone, c, s } = K.head;
	if ( ! K.head.isBody ) B.part( bone, 'sphere', c, [ 0, 0, 0 ], [ s * 0.9, s * 0.7, s * 0.9 ], 'primary' );
	const j = jaw( K, [ 0, c[ 1 ] - s * 0.2, c[ 2 ] + s * 0.2 ] );
	B.part( j, 'wedge', [ 0, 0, s * 0.2 ], [ 0, Math.PI, 0 ], [ s * 0.6, s * 0.15, s * 0.5 ], 'secondary' );
	// stalks are spring chains: they wobble and lag behind every move
	const n = K.head.isBody ? 4 : 2;
	K.eyes = [];
	for ( let i = 0; i < n; i ++ ) {

		const a = ( i / ( n - 1 || 1 ) - 0.5 ) * 1.6;
		const top = K.head.isBody ? K.head.r * 0.9 : s * 0.3;
		const s0 = B.bone( 'stalk' + i + 'a', bone, [ Math.sin( a ) * s * 0.35, c[ 1 ] + top, c[ 2 ] + Math.cos( a ) * s * 0.1 ], { rot: [ 0.2, 0, - a * 0.5 ] } );
		const s1 = B.bone( 'stalk' + i + 'b', s0, [ 0, s * 0.35, 0 ], { rot: [ 0.2, 0, - a * 0.2 ] } );
		B.segment( s0, 'cyl', [ 0, 0, 0 ], [ 0, s * 0.36, 0 ], s * 0.07, 'secondary' );
		B.segment( s1, 'cyl', [ 0, 0, 0 ], [ 0, s * 0.3, 0 ], s * 0.06, 'secondary' );
		K.eyes.push( { bone: s1, pos: [ 0, s * 0.34, 0.01 ], r: s * 0.13, side: 0, stalk: true } );
		B.chain( 'antenna', [ s0, s1 ], { stiff: 50, damp: 6, swing: 1.4 } );

	}

	K.hornBase = null;

}, { plans: [ 'floater', 'blob', 'hexapod', 'quadruped' ], styles: [ 'cast' ], weight: 0.8 } );

HD( 'cyclops', 'Cyclops', [ 'brute', 'magic' ], ( K ) => {

	const { B } = K, { bone, c, s } = K.head;
	B.part( bone, 'sphere', [ c[ 0 ], c[ 1 ] + s * 0.05, c[ 2 ] ], [ 0, 0, 0 ], [ s * 1.0, s * 1.0, s * 0.95 ], 'skin' );
	const j = jaw( K, [ 0, c[ 1 ] - s * 0.3, c[ 2 ] ] );
	B.part( j, 'box', [ 0, - s * 0.04, s * 0.25 ], [ 0, 0, 0 ], [ s * 0.7, s * 0.2, s * 0.5 ], 'skin', { shade: 0.85 } );
	eyesAt( K, bone, [ 0, c[ 1 ] + s * 0.15, c[ 2 ] + s * 0.4 ], s * 0.25, 1 );
	K.forceEyes = 'cyclops';
	K.hornBase = { bone, pos: [ 0, c[ 1 ] + s * 0.5, c[ 2 ] - s * 0.05 ], w: s * 0.4 };

}, { plans: [ 'biped', 'quadruped' ], styles: [ 'cast', 'roar' ], weight: 0.6 } );

HD( 'crested', 'Crested lizard', [ 'reptile' ], ( K ) => {

	const { B } = K, { bone, c, s } = K.head;
	B.part( bone, 'octa', [ c[ 0 ], c[ 1 ] + s * 0.05, c[ 2 ] + s * 0.1 ], [ 0, 0, 0 ], [ s * 0.8, s * 0.6, s * 1.4 ], 'primary' );
	const j = jaw( K, [ 0, c[ 1 ] - s * 0.12, c[ 2 ] - s * 0.2 ] );
	B.part( j, 'wedge', [ 0, - s * 0.04, s * 0.45 ], [ 0, Math.PI, 0 ], [ s * 0.55, s * 0.16, s * 0.9 ], 'secondary' );
	// crest frill on a spring chain: it flops when the head snaps
	const cr = B.bone( 'crest', bone, [ 0, c[ 1 ] + s * 0.25, c[ 2 ] - s * 0.3 ], { rot: [ - 0.5, 0, 0 ] } );
	B.part( cr, 'wedge', [ 0, s * 0.3, - s * 0.15 ], [ 0, 0, 0 ], [ s * 0.1, s * 0.7, s * 0.8 ], 'accent' );
	B.chain( 'crest', [ cr ], { stiff: 70, damp: 7, swing: 1.2 } );
	eyesAt( K, bone, [ s * 0.28, c[ 1 ] + s * 0.15, c[ 2 ] + s * 0.25 ], s * 0.08 );
	K.hornBase = { bone, pos: [ 0, c[ 1 ] + s * 0.3, c[ 2 ] + s * 0.25 ], w: s * 0.3 };

}, { plans: [ 'quadruped', 'biped', 'serpent', 'avian' ], styles: [ 'bite' ] } );

// --- eyes ------------------------------------------------------------------------------------

const EY = ( id, name, tags, build, extra = {} ) => define( 'bodyPart', { id, name, slot: 'eyes', tags, build, ...extra } );

function eyeList( K ) {

	if ( K.eyes?.length ) return K.eyes;
	const f = K.eyeFace;
	if ( f ) {

		eyesAt( K, f.bone, [ f.s * 0.35, f.c[ 1 ], f.c[ 2 ] - f.s * 0.12 ], f.s * 0.22 );
		return K.eyes;

	}

	return [];

}

EY( 'pair', 'Eyes', [], ( K ) => {

	for ( const e of eyeList( K ) ) {

		K.B.part( e.bone, 'sphere', e.pos, [ 0, 0, 0 ], e.r * 2, K.eyeSockets ? 'dark' : 'glow', { emissive: K.eyeSockets ? 0 : 0.9 } );
		if ( K.eyeSockets ) K.B.part( e.bone, 'sphere', [ e.pos[ 0 ], e.pos[ 1 ], e.pos[ 2 ] + e.r * 0.5 ], [ 0, 0, 0 ], e.r * 0.9, 'glow', { emissive: 1 } );

	}

} );

EY( 'glowing', 'Burning eyes', [ 'fire', 'magic' ], ( K ) => {

	for ( const e of eyeList( K ) ) K.B.part( e.bone, 'octa', e.pos, [ 0, 0, 0 ], [ e.r * 2.6, e.r * 1.4, e.r * 1.6 ], 'glow', { emissive: 1 } );

} );

EY( 'slits', 'Slit eyes', [ 'reptile' ], ( K ) => {

	for ( const e of eyeList( K ) ) {

		K.B.part( e.bone, 'sphere', e.pos, [ 0, 0, 0 ], e.r * 2, 'accent' );
		K.B.part( e.bone, 'box', [ e.pos[ 0 ], e.pos[ 1 ], e.pos[ 2 ] + e.r * 0.8 ], [ 0, 0, 0 ], [ e.r * 0.4, e.r * 1.8, e.r * 0.4 ], 'dark' );

	}

} );

EY( 'many', 'Eye cluster', [ 'spider', 'chaos' ], ( K ) => {

	const base = eyeList( K );
	if ( ! base.length ) return;
	const e0 = base[ 0 ];
	const n = 3 + Math.floor( K.rng.next() * 4 );
	for ( let i = 0; i < n; i ++ ) {

		const sx = i % 2 ? - 1 : 1, row = Math.floor( i / 2 );
		const r = e0.r * ( row === 0 ? 1.1 : 0.75 );
		K.B.part( e0.bone, 'sphere', [ sx * ( Math.abs( e0.pos[ 0 ] ) * ( 0.6 + row * 0.35 ) ), e0.pos[ 1 ] + row * e0.r * 1.6, e0.pos[ 2 ] - row * e0.r * 0.8 ], [ 0, 0, 0 ], r * 2, 'glow', { emissive: 0.9 } );

	}

}, { styles: [ 'spit' ] } );

EY( 'compound', 'Compound eyes', [ 'insect' ], ( K ) => {

	for ( const e of eyeList( K ) ) K.B.part( e.bone, 'octa', [ e.pos[ 0 ] * 1.05, e.pos[ 1 ], e.pos[ 2 ] ], [ 0, 0.4 * e.side, 0 ], [ e.r * 2.4, e.r * 2.8, e.r * 2.4 ], 'glow', { emissive: 0.55, shine: true } );

} );

EY( 'cyclops', 'Great eye', [ 'magic' ], ( K ) => {

	const list = eyeList( K );
	if ( ! list.length ) return;
	// one huge eye centred on the face: white, iris, pupil
	const e = list[ 0 ], r = ( K.head?.isBody ? K.eyeFace.s * 0.55 : e.r * 1.4 );
	const pos = K.head?.isBody ? [ 0, K.eyeFace.c[ 1 ], K.eyeFace.c[ 2 ] - r * 0.4 ] : [ 0, e.pos[ 1 ], e.pos[ 2 ] ];
	K.B.part( e.bone, 'sphere', pos, [ 0, 0, 0 ], r * 2, 'skin', { shade: 1.4 } );
	K.B.part( e.bone, 'disc', [ pos[ 0 ], pos[ 1 ], pos[ 2 ] + r * 0.92 ], [ Math.PI / 2, 0, 0 ], [ r * 1.2, r * 0.4, r * 1.2 ], 'glow', { emissive: 0.8 } );
	K.B.part( e.bone, 'disc', [ pos[ 0 ], pos[ 1 ], pos[ 2 ] + r * 1.0 ], [ Math.PI / 2, 0, 0 ], [ r * 0.5, r * 0.5, r * 0.5 ], 'dark' );
	K.bigEye = true;

}, { styles: [ 'cast' ] } );

// --- horns -----------------------------------------------------------------------------------

const HR = ( id, name, tags, build, extra = {} ) => define( 'bodyPart', { id, name, slot: 'horns', tags, build, ...extra } );

function hornBase( K ) {

	return K.hornBase || ( K.head ? { bone: K.head.bone, pos: [ 0, K.head.c[ 1 ] + K.head.s * 0.45, K.head.c[ 2 ] ], w: K.head.s * 0.4 } : null );

}

HR( 'ram', 'Ram horns', [ 'beast' ], ( K, p ) => {

	const h = hornBase( K );
	if ( ! h ) return;
	const s = K.head.s * ( p.s ?? 1 );
	for ( const sx of [ - 1, 1 ] ) for ( let k = 0; k < 2; k ++ ) {

		const a = k * 1.5;
		K.B.part( h.bone, 'cone', [ sx * ( h.w * 0.6 + Math.sin( a ) * s * 0.28 ), h.pos[ 1 ] - s * 0.05 + Math.cos( a ) * s * 0.18 - s * 0.1, h.pos[ 2 ] - s * 0.1 - Math.sin( a * 0.5 ) * s * 0.15 ], [ - a, 0, sx * ( 0.6 + a * 0.6 ) ], [ s * ( 0.24 - k * 0.05 ), s * 0.4, s * ( 0.24 - k * 0.05 ) ], 'metal', { shade: 1.15 - k * 0.1 } );

	}

}, { styles: [ 'charge' ] } );

HR( 'bull', 'Bull horns', [ 'beast', 'brute' ], ( K, p ) => {

	const h = hornBase( K );
	if ( ! h ) return;
	const s = K.head.s * ( p.s ?? 1 );
	for ( const sx of [ - 1, 1 ] ) {

		K.B.part( h.bone, 'cone', [ sx * ( h.w + s * 0.2 ), h.pos[ 1 ] - s * 0.05, h.pos[ 2 ] ], [ 0, 0, - sx * 1.35 ], [ s * 0.16, s * 0.45, s * 0.16 ], 'skin', { shade: 1.2 } );
		K.B.part( h.bone, 'spike', [ sx * ( h.w + s * 0.42 ), h.pos[ 1 ] + s * 0.15, h.pos[ 2 ] + s * 0.05 ], [ 0.3, 0, - sx * 0.3 ], [ s * 0.12, s * 0.4, s * 0.12 ], 'skin', { shade: 1.3 } );

	}

}, { styles: [ 'charge' ] } );

HR( 'unicorn', 'Lance horn', [ 'magic' ], ( K, p ) => {

	const h = hornBase( K );
	if ( ! h ) return;
	const s = K.head.s * ( p.s ?? 1 );
	K.B.part( h.bone, 'spike', [ 0, h.pos[ 1 ] + s * 0.1, h.pos[ 2 ] + s * 0.3 ], [ 0.9, 0, 0 ], [ s * 0.16, s * 0.9, s * 0.16 ], 'glow', { emissive: 0.35, shine: true } );

}, { styles: [ 'charge' ] } );

HR( 'antlers', 'Antlers', [ 'beast', 'nature' ], ( K, p ) => {

	const h = hornBase( K );
	if ( ! h ) return;
	const s = K.head.s * ( p.s ?? 1 );
	for ( const sx of [ - 1, 1 ] ) {

		K.B.part( h.bone, 'cyl', [ sx * ( h.w * 0.6 + s * 0.15 ), h.pos[ 1 ] + s * 0.3, h.pos[ 2 ] - s * 0.1 ], [ - 0.3, 0, - sx * 0.5 ], [ s * 0.07, s * 0.7, s * 0.07 ], 'secondary', { shade: 1.3 } );
		K.B.part( h.bone, 'cyl', [ sx * ( h.w * 0.6 + s * 0.42 ), h.pos[ 1 ] + s * 0.62, h.pos[ 2 ] - s * 0.15 ], [ 0.3, 0, - sx * 1.1 ], [ s * 0.06, s * 0.45, s * 0.06 ], 'secondary', { shade: 1.3 } );
		K.B.part( h.bone, 'cyl', [ sx * ( h.w * 0.6 + s * 0.2 ), h.pos[ 1 ] + s * 0.75, h.pos[ 2 ] - s * 0.25 ], [ - 0.5, 0, sx * 0.2 ], [ s * 0.06, s * 0.45, s * 0.06 ], 'secondary', { shade: 1.3 } );

	}

}, { plans: [ 'quadruped', 'biped', 'avian' ] } );

HR( 'crown', 'Spike crown', [ 'magic', 'royal' ], ( K, p ) => {

	const h = hornBase( K );
	if ( ! h ) return;
	const s = K.head.s * ( p.s ?? 1 );
	for ( let i = 0; i < 5; i ++ ) {

		const a = ( i / 4 - 0.5 ) * 2.2;
		K.B.part( h.bone, 'spike', [ Math.sin( a ) * h.w * 0.9, h.pos[ 1 ] + s * 0.05, h.pos[ 2 ] + Math.cos( a ) * h.w * 0.5 - s * 0.1 ], [ - 0.2, 0, - a * 0.3 ], [ s * 0.1, s * ( i === 2 ? 0.45 : 0.3 ), s * 0.1 ], i === 2 ? 'glow' : 'metal', { emissive: i === 2 ? 0.8 : 0, shine: true } );

	}

}, { styles: [ 'cast' ] } );

HR( 'devil', 'Devil horns', [ 'fire', 'chaos' ], ( K, p ) => {

	const h = hornBase( K );
	if ( ! h ) return;
	const s = K.head.s * ( p.s ?? 1 );
	for ( const sx of [ - 1, 1 ] ) {

		K.B.part( h.bone, 'cone', [ sx * h.w * 0.55, h.pos[ 1 ] + s * 0.1, h.pos[ 2 ] ], [ - 0.45, 0, - sx * 0.35 ], [ s * 0.15, s * 0.4, s * 0.15 ], 'dark' );
		K.B.part( h.bone, 'spike', [ sx * h.w * 0.65, h.pos[ 1 ] + s * 0.38, h.pos[ 2 ] - s * 0.18 ], [ - 1.0, 0, - sx * 0.1 ], [ s * 0.1, s * 0.3, s * 0.1 ], 'dark' );

	}

} );

HR( 'antennae', 'Antennae', [ 'insect' ], ( K, p ) => {

	const h = hornBase( K );
	if ( ! h ) return;
	const s = K.head.s * ( p.s ?? 1 );
	for ( const sx of [ - 1, 1 ] ) {

		const a0 = K.B.bone( 'ant' + sx + 'a', h.bone, [ sx * h.w * 0.35, h.pos[ 1 ], h.pos[ 2 ] + s * 0.1 ], { rot: [ 0.7, 0, - sx * 0.35 ] } );
		const a1 = K.B.bone( 'ant' + sx + 'b', a0, [ 0, s * 0.55, 0 ], { rot: [ 0.5, 0, 0 ] } );
		K.B.segment( a0, 'cyl', [ 0, 0, 0 ], [ 0, s * 0.56, 0 ], s * 0.04, 'dark' );
		K.B.segment( a1, 'cyl', [ 0, 0, 0 ], [ 0, s * 0.5, 0 ], s * 0.035, 'dark' );
		K.B.part( a1, 'sphere', [ 0, s * 0.52, 0 ], [ 0, 0, 0 ], s * 0.09, 'glow', { emissive: 0.6 } );
		K.B.chain( 'antenna', [ a0, a1 ], { stiff: 45, damp: 5, swing: 1.6 } );

	}

}, { plans: [ 'hexapod', 'arachnid', 'quadruped', 'serpent', 'biped', 'avian' ] } );

// --- back ------------------------------------------------------------------------------------

const BK = ( id, name, tags, build, extra = {} ) => define( 'bodyPart', { id, name, slot: 'back', tags, build, ...extra } );

BK( 'spines', 'Spine ridge', [ 'reptile', 'beast' ], ( K, p ) => {

	const s = p.s ?? 1;
	K.back.forEach( ( pt, i ) => K.B.part( pt.bone, 'spike', [ pt.pos[ 0 ], pt.pos[ 1 ] + pt.w * 0.35 * s, pt.pos[ 2 ] ], [ - 0.5, 0, 0 ], [ pt.w * 0.35, pt.w * ( i % 2 ? 0.8 : 1.1 ) * s, pt.w * 0.35 ], 'accent' ) );

} );

BK( 'plates', 'Dorsal plates', [ 'reptile', 'armored' ], ( K, p ) => {

	const s = p.s ?? 1;
	K.back.forEach( ( pt, i ) => {

		for ( const sx of [ - 1, 1 ] ) K.B.part( pt.bone, 'prism', [ sx * pt.w * 0.18, pt.pos[ 1 ] + pt.w * 0.45 * s, pt.pos[ 2 ] + sx * pt.w * 0.2 ], [ 0, Math.PI / 2, sx * 0.15 ], [ pt.w * 0.9 * s, pt.w * 1.2 * s, pt.w * 0.12 ], i % 2 ? 'accent' : 'secondary' );

	} );

}, { styles: [ 'tail' ] } );

BK( 'sail', 'Sail fin', [ 'reptile', 'aquatic' ], ( K, p ) => {

	const s = p.s ?? 1;
	K.back.forEach( ( pt, i ) => {

		const hgt = pt.w * ( 1.2 + Math.sin( ( i + 0.5 ) / K.back.length * Math.PI ) * 1.2 ) * s;
		K.B.part( pt.bone, 'box', [ pt.pos[ 0 ], pt.pos[ 1 ] + hgt * 0.5, pt.pos[ 2 ] ], [ 0, 0, 0 ], [ pt.w * 0.08, hgt, pt.w * 1.6 ], i % 2 ? 'accent' : 'glow', { emissive: i % 2 ? 0 : 0.25 } );

	} );

} );

BK( 'crystals', 'Crystal shards', [ 'crystal', 'magic', 'cold' ], ( K, p ) => {

	const s = p.s ?? 1;
	K.back.forEach( ( pt, i ) => {

		const a = ( i % 3 - 1 ) * 0.4;
		K.B.part( pt.bone, 'octa', [ pt.pos[ 0 ] + a * pt.w, pt.pos[ 1 ] + pt.w * 0.6 * s, pt.pos[ 2 ] ], [ 0.2 * i, 0, a ], [ pt.w * 0.45 * s, pt.w * 1.6 * s, pt.w * 0.45 * s ], 'glow', { emissive: 0.65, shine: true } );

	} );

}, { styles: [ 'cast' ] } );

BK( 'shell', 'Shell', [ 'armored', 'aquatic' ], ( K, p ) => {

	const seg = K.torso.reduce( ( a, b ) => ( b.s[ 0 ] * b.s[ 2 ] > a.s[ 0 ] * a.s[ 2 ] ? b : a ) );
	const [ w, h, l ] = seg.s, s = p.s ?? 1;
	K.B.part( seg.bone, 'sphere', [ seg.c[ 0 ], seg.c[ 1 ] + h * 0.22, seg.c[ 2 ] ], [ 0, 0, 0 ], [ w * 1.3 * s, h * 0.95, Math.max( l, w ) * 1.25 * s ], 'secondary', { shine: true } );
	K.B.part( seg.bone, 'ring', [ seg.c[ 0 ], seg.c[ 1 ] + h * 0.05, seg.c[ 2 ] ], [ 0, 0, 0 ], [ w * 1.35 * s, h * 0.5, Math.max( l, w ) * 1.3 * s ], 'accent' );

}, { plans: [ 'quadruped', 'hexapod', 'blob', 'biped' ], styles: [ 'charge' ] } );

BK( 'sacs', 'Glow sacs', [ 'poison', 'fire', 'magic' ], ( K, p ) => {

	const s = p.s ?? 1;
	K.back.forEach( ( pt, i ) => {

		if ( i % 2 ) return;
		K.B.part( pt.bone, 'sphere', [ pt.pos[ 0 ] + ( i % 4 ? 1 : - 1 ) * pt.w * 0.2, pt.pos[ 1 ] + pt.w * 0.35, pt.pos[ 2 ] ], [ 0, 0, 0 ], pt.w * 1.1 * s, 'glow', { emissive: 0.8 } );

	} );

}, { styles: [ 'spit', 'breath' ] } );

BK( 'mushrooms', 'Fungal caps', [ 'nature', 'poison' ], ( K, p ) => {

	const s = p.s ?? 1;
	K.back.forEach( ( pt, i ) => {

		if ( i % 2 && K.back.length > 2 ) return;
		K.B.part( pt.bone, 'cyl', [ pt.pos[ 0 ], pt.pos[ 1 ] + pt.w * 0.3 * s, pt.pos[ 2 ] ], [ 0, 0, 0 ], [ pt.w * 0.18, pt.w * 0.6 * s, pt.w * 0.18 ], 'skin' );
		K.B.part( pt.bone, 'cone', [ pt.pos[ 0 ], pt.pos[ 1 ] + pt.w * 0.7 * s, pt.pos[ 2 ] ], [ 0, 0, 0 ], [ pt.w * 1.1 * s, pt.w * 0.45 * s, pt.w * 1.1 * s ], i % 4 ? 'accent' : 'glow', { emissive: i % 4 ? 0 : 0.4 } );

	} );

}, { styles: [ 'spit' ] } );

BK( 'quills', 'Quills', [ 'beast' ], ( K, p ) => {

	const s = p.s ?? 1;
	K.back.forEach( ( pt ) => {

		for ( const sx of [ - 1, 0, 1 ] ) K.B.part( pt.bone, 'spike', [ pt.pos[ 0 ] + sx * pt.w * 0.5, pt.pos[ 1 ] + pt.w * 0.2, pt.pos[ 2 ] - pt.w * 0.2 ], [ - 1.1, 0, - sx * 0.6 ], [ pt.w * 0.12, pt.w * 1.6 * s, pt.w * 0.12 ], sx ? 'secondary' : 'accent' );

	} );

} );

BK( 'vents', 'Fire vents', [ 'fire' ], ( K, p ) => {

	const s = p.s ?? 1;
	K.back.slice( 0, 3 ).forEach( ( pt ) => {

		K.B.part( pt.bone, 'cyl', [ pt.pos[ 0 ], pt.pos[ 1 ] + pt.w * 0.3, pt.pos[ 2 ] ], [ - 0.3, 0, 0 ], [ pt.w * 0.45, pt.w * 0.7 * s, pt.w * 0.45 ], 'dark' );
		K.B.part( pt.bone, 'cone', [ pt.pos[ 0 ], pt.pos[ 1 ] + pt.w * 0.85 * s, pt.pos[ 2 ] - pt.w * 0.15 ], [ - 0.3, 0, 0 ], [ pt.w * 0.35, pt.w * 0.7 * s, pt.w * 0.35 ], 'glow', { emissive: 1 } );

	} );

}, { styles: [ 'breath' ] } );

// --- tails -----------------------------------------------------------------------------------
// A tail part grows its own bone chain from K.tail and registers it as a spring
// chain, so tails lag, swish when turning and whip during 'tail' attacks.

function growTail( K, n, opts = {} ) {

	const t = K.tail;
	if ( ! t ) return null;
	const B = K.B;
	if ( t.tip ) return { bones: [ t.bone ], seg: 0.2, t: t.t, tip: true };
	const len = Math.max( 0.3, t.len ) * ( opts.lenK ?? 1 ), seg = len / n;
	const bones = [];
	let p = t.bone;
	for ( let i = 0; i < n; i ++ ) {

		const rot = [ i === 0 ? t.dir * 0.5 + ( opts.lift ?? 0 ) : ( opts.curl ?? 0.1 ), 0, 0 ];
		p = B.bone( 'tail' + i, p, i === 0 ? t.pos : [ 0, 0, - seg ], { rot } );
		bones.push( p );

	}

	B.roles.tail = bones;
	B.chain( 'tail', bones, { stiff: opts.stiff ?? 40, damp: opts.damp ?? 6, swing: opts.swing ?? 1, wave: opts.wave ?? 0.15 } );
	return { bones, seg, t: t.t };

}

function tailSegments( K, tl, shape = 'cone', color = 'primary', k0 = 1, k1 = 0.35 ) {

	tl.bones.forEach( ( b, i ) => {

		const f = i / Math.max( 1, tl.bones.length - 1 );
		const t = tl.t * ( k0 + ( k1 - k0 ) * f );
		K.B.part( b, shape, [ 0, 0, - tl.seg * 0.5 ], [ - Math.PI / 2, 0, 0 ], [ t * 2, tl.seg * 1.15, t * 2 ], K.g.pattern === 'banded' && i % 2 ? 'accent' : color );

	} );

}

const TL = ( id, name, tags, build, extra = {} ) => define( 'bodyPart', { id, name, slot: 'tail', tags, build, ...extra } );

TL( 'whip', 'Whip tail', [ 'reptile', 'beast' ], ( K ) => {

	const tl = growTail( K, 4 );
	if ( tl && ! tl.tip ) tailSegments( K, tl );

}, { styles: [ 'tail' ] } );

TL( 'club', 'Club tail', [ 'armored', 'reptile' ], ( K ) => {

	const tl = growTail( K, 3, { stiff: 30 } );
	if ( ! tl ) return;
	if ( ! tl.tip ) tailSegments( K, tl, 'cyl', 'primary', 1, 0.6 );
	const end = tl.bones[ tl.bones.length - 1 ], r = tl.t * 3;
	K.B.part( end, 'sphere', [ 0, 0, - ( tl.tip ? r * 0.4 : tl.seg ) ], [ 0, 0, 0 ], r, 'secondary', { shine: true } );
	for ( const sx of [ - 1, 1 ] ) K.B.part( end, 'spike', [ sx * r * 0.45, 0, - ( tl.tip ? r * 0.4 : tl.seg ) ], [ 0, 0, - sx * Math.PI / 2 ], [ r * 0.25, r * 0.6, r * 0.25 ], 'metal' );

}, { styles: [ 'tail' ] } );

TL( 'stinger', 'Stinger', [ 'poison', 'insect' ], ( K ) => {

	// scorpion: the chain curls up and over the back
	const tl = growTail( K, 4, { lift: - 0.9, curl: - 0.55, stiff: 55, lenK: 1.3 } );
	if ( ! tl ) return;
	if ( ! tl.tip ) tailSegments( K, tl, 'sphere', 'primary', 1.1, 0.7 );
	const end = tl.bones[ tl.bones.length - 1 ];
	K.B.part( end, 'spike', [ 0, 0, - tl.seg * ( tl.tip ? 0.4 : 1.1 ) ], [ - 2.2, 0, 0 ], [ tl.t * 1.2, tl.t * 3.2, tl.t * 1.2 ], 'glow', { emissive: 0.7 } );
	K.B.point( 'stinger', end, [ 0, 0, - tl.seg * 1.4 ] );

}, { styles: [ 'tail', 'spit' ] } );

TL( 'fan', 'Feather fan', [ 'bird' ], ( K ) => {

	const tl = growTail( K, 2, { stiff: 60, lenK: 0.6 } );
	if ( ! tl ) return;
	const end = tl.bones[ tl.bones.length - 1 ];
	if ( ! tl.tip ) tailSegments( K, tl, 'cone', 'primary', 1.4, 1 );
	for ( let i = 0; i < 5; i ++ ) {

		const a = ( i / 4 - 0.5 ) * 1.2;
		K.B.part( end, 'blade', [ Math.sin( a ) * 0.12, 0.02, - 0.18 - Math.cos( a ) * 0.12 ], [ - Math.PI / 2 + 0.15, 0, a ], [ 0.12, 0.45, 0.02 ], i % 2 ? 'accent' : 'primary' );

	}

} );

TL( 'spiked', 'Spiked tail', [ 'reptile' ], ( K ) => {

	const tl = growTail( K, 4 );
	if ( ! tl ) return;
	if ( ! tl.tip ) tailSegments( K, tl );
	tl.bones.forEach( ( b, i ) => K.B.part( b, 'spike', [ 0, tl.t * ( 1 - i * 0.2 ), - tl.seg * 0.5 ], [ - 0.6, 0, 0 ], [ tl.t * 0.6, tl.t * 2, tl.t * 0.6 ], 'accent' ) );

}, { styles: [ 'tail' ] } );

TL( 'flame', 'Flame tail', [ 'fire' ], ( K ) => {

	const tl = growTail( K, 3, { wave: 0.3 } );
	if ( ! tl ) return;
	if ( ! tl.tip ) tailSegments( K, tl );
	const end = tl.bones[ tl.bones.length - 1 ];
	K.B.part( end, 'cone', [ 0, 0, - tl.seg * ( tl.tip ? 0.5 : 1.2 ) ], [ - Math.PI / 2, 0, 0 ], [ tl.t * 3, tl.t * 5, tl.t * 3 ], 'glow', { emissive: 1 } );

}, { styles: [ 'breath' ] } );

TL( 'rattle', 'Rattle', [ 'reptile', 'poison' ], ( K ) => {

	const tl = growTail( K, 2 );
	if ( ! tl ) return;
	if ( ! tl.tip ) tailSegments( K, tl );
	const end = tl.bones[ tl.bones.length - 1 ];
	for ( let i = 0; i < 3; i ++ ) K.B.part( end, 'disc', [ 0, 0, - tl.seg * 0.6 - i * tl.t * 0.7 ], [ Math.PI / 2, 0, 0 ], [ tl.t * ( 2.2 - i * 0.4 ), tl.t * 3, tl.t * ( 1.8 - i * 0.3 ) ], 'accent' );

}, { plans: [ 'serpent', 'quadruped' ] } );

// --- wings -----------------------------------------------------------------------------------
// Two bones per wing (shoulder, outer) with roles wingL/wingR/wingL2/wingR2; the
// animator flaps them (fliers) or folds them (walkers, flared in roars and leaps).

function growWings( K, span = 1 ) {

	const w = K.wings;
	if ( ! w ) return null;
	const out = [];
	// span grows with the body, not with heads that ARE the body (floaters, blobs)
	const base = K.head?.isBody ? ( K.floatR ?? 0.3 ) * 0.9 : ( K.head?.s ?? 0.2 );
	const s = ( 0.45 + base ) * span * ( K.g.gait.fly && K.g.plan === 'avian' ? 1.3 : 1 );
	K.B.pair( ( side, S ) => {

		const r = K.B.bone( 'wing' + S, w.bone, [ w.pos[ 0 ] + side * w.w, w.pos[ 1 ], w.pos[ 2 ] ], { role: 'wing' + S } );
		const o = K.B.bone( 'wing' + S + '2', r, [ side * s * 0.5, 0, 0 ], { role: 'wing' + S + '2' } );
		out.push( { root: r, outer: o, side, s } );

	} );
	K.B.meta.wingSpan = s;
	return out;

}

const WG = ( id, name, tags, build, extra = {} ) => define( 'bodyPart', { id, name, slot: 'wings', tags, build, ...extra } );

WG( 'bat', 'Bat wings', [ 'shadow', 'beast' ], ( K ) => {

	for ( const w of growWings( K ) || [] ) {

		const { side, s } = w;
		K.B.segment( w.root, 'cyl', [ 0, 0, 0 ], [ side * s * 0.5, 0, 0 ], s * 0.05, 'dark' );
		K.B.part( w.root, 'wedge', [ side * s * 0.25, 0, - s * 0.18 ], [ 0, 0, 0 ], [ s * 0.5, s * 0.02, s * 0.36 ], 'secondary' );
		// three finger bones fanning backward, membrane between them
		for ( let f = 0; f < 2; f ++ ) {

			const a = 0.2 + f * 0.75;
			K.B.segment( w.outer, 'cyl', [ 0, 0, 0 ], [ side * Math.cos( a ) * s * 0.55, 0, - Math.sin( a ) * s * 0.55 ], s * 0.03, 'dark' );

		}

		K.B.part( w.outer, 'wedge', [ side * s * 0.2, 0, - s * 0.22 ], [ 0, - side * 0.5, 0 ], [ s * 0.45, s * 0.02, s * 0.42 ], 'secondary', { shade: 0.85 } );

	}

}, { styles: [ 'leap' ] } );

WG( 'feather', 'Feathered wings', [ 'bird', 'holy' ], ( K ) => {

	for ( const w of growWings( K ) || [] ) {

		const { side, s } = w;
		K.B.part( w.root, 'box', [ side * s * 0.25, 0, - s * 0.08 ], [ 0, 0, 0 ], [ s * 0.5, s * 0.05, s * 0.28 ], 'primary' );
		for ( let f = 0; f < 4; f ++ ) K.B.part( w.outer, 'blade', [ side * ( s * 0.1 + f * s * 0.11 ), 0, - s * 0.15 - f * s * 0.03 ], [ - Math.PI / 2, 0, side * ( 0.15 + f * 0.1 ) ], [ s * 0.1, s * ( 0.38 + f * 0.04 ), s * 0.02 ], f % 2 ? 'accent' : 'primary', { shade: 0.9 + f * 0.05 } );

	}

}, { styles: [ 'leap' ] } );

WG( 'insect', 'Gossamer wings', [ 'insect' ], ( K ) => {

	for ( const w of growWings( K, 0.9 ) || [] ) {

		const { side, s } = w;
		K.B.part( w.root, 'disc', [ side * s * 0.3, 0, - s * 0.15 ], [ 0, 0, 0 ], [ s * 0.6, s * 0.15, s * 0.3 ], 'glow', { emissive: 0.25 } );
		K.B.part( w.outer, 'disc', [ side * s * 0.15, 0, - s * 0.2 ], [ 0, 0, 0 ], [ s * 0.45, s * 0.15, s * 0.25 ], 'glow', { emissive: 0.2 } );

	}

}, { plans: [ 'hexapod', 'floater', 'arachnid', 'biped' ] } );

WG( 'bonewing', 'Bone wings', [ 'undead', 'bone' ], ( K ) => {

	for ( const w of growWings( K ) || [] ) {

		const { side, s } = w;
		K.B.segment( w.root, 'cyl', [ 0, 0, 0 ], [ side * s * 0.5, s * 0.05, 0 ], s * 0.05, 'skin' );
		for ( let f = 0; f < 3; f ++ ) K.B.segment( w.outer, 'cyl', [ 0, 0, 0 ], [ side * s * ( 0.3 + f * 0.1 ), - s * 0.05, - s * ( 0.15 + f * 0.2 ) ], s * 0.03, 'skin' );
		K.B.part( w.outer, 'tetra', [ side * s * 0.2, - 0.02, - s * 0.25 ], [ 0, 0, 0 ], [ s * 0.4, s * 0.015, s * 0.4 ], 'dark' );

	}

}, { styles: [ 'leap' ] } );

WG( 'fins', 'Fins', [ 'aquatic' ], ( K ) => {

	for ( const w of growWings( K, 0.7 ) || [] ) {

		const { side, s } = w;
		K.B.part( w.root, 'wedge', [ side * s * 0.25, 0, 0 ], [ 0, side * Math.PI / 2, 0 ], [ s * 0.4, s * 0.04, s * 0.5 ], 'accent' );
		K.B.part( w.outer, 'wedge', [ side * s * 0.15, 0, 0 ], [ 0, side * Math.PI / 2, 0 ], [ s * 0.3, s * 0.03, s * 0.35 ], 'accent', { shade: 0.85 } );

	}

}, { plans: [ 'floater', 'serpent', 'blob', 'quadruped' ] } );

// --- extras ------------------------------------------------------------------------------------

const EX = ( id, name, tags, build, extra = {} ) => define( 'bodyPart', { id, name, slot: 'extra', tags, build, ...extra } );

EX( 'mane', 'Mane', [ 'beast' ], ( K ) => {

	const h = K.head;
	if ( ! h || h.isBody ) return;
	const s = h.s;
	for ( let i = 0; i < 5; i ++ ) {

		const a = ( i / 4 - 0.5 ) * 2.6;
		K.B.part( h.bone, 'tetra', [ Math.sin( a ) * s * 0.55, h.c[ 1 ] + Math.cos( a ) * s * 0.35, h.c[ 2 ] - s * 0.55 ], [ - 0.6, 0, - a * 0.6 ], [ s * 0.5, s * 0.7, s * 0.5 ], i % 2 ? 'accent' : 'secondary' );

	}

}, { plans: [ 'quadruped', 'biped', 'avian' ] } );

EX( 'beard', 'Tentacle beard', [ 'aquatic', 'chaos' ], ( K ) => {

	const h = K.head;
	if ( ! h ) return;
	const s = h.s, par = K.B.roles.jaw ?? h.bone;
	for ( let i = 0; i < 3; i ++ ) {

		const x = ( i - 1 ) * s * 0.25;
		const t0 = K.B.bone( 'beard' + i + 'a', par, [ x, h.isBody ? h.c[ 1 ] - s * 0.4 : - s * 0.15, h.isBody ? s * 0.4 : s * 0.35 ], { rot: [ Math.PI, 0, 0 ] } );
		const t1 = K.B.bone( 'beard' + i + 'b', t0, [ 0, s * 0.3, 0 ] );
		K.B.segment( t0, 'cone', [ 0, 0, 0 ], [ 0, s * 0.32, 0 ], s * 0.08, 'secondary' );
		K.B.segment( t1, 'cone', [ 0, 0, 0 ], [ 0, s * 0.3, 0 ], s * 0.05, 'secondary', { shade: 0.85 } );
		K.B.chain( 'tentacle', [ t0, t1 ], { stiff: 30, damp: 4, swing: 1.5, wave: 0.25 } );

	}

} );

EX( 'tentacles', 'Dangling tentacles', [ 'aquatic', 'chaos' ], ( K ) => {

	const pt = K.belly[ 0 ];
	if ( ! pt ) return;
	const n = Math.max( 3, Math.min( 5, Math.round( K.b.limbs ?? 4 ) || 4 ) );
	const r = ( K.floatR ?? 0.3 ) * 0.6, len = 0.14 + ( K.b.tailLen ?? 0.8 ) * 0.12;
	for ( let i = 0; i < n; i ++ ) {

		const a = i / n * Math.PI * 2;
		let p = K.B.bone( 'tent' + i + '_0', pt.bone, [ pt.pos[ 0 ] + Math.sin( a ) * r, pt.pos[ 1 ], pt.pos[ 2 ] + Math.cos( a ) * r ], { rot: [ Math.PI + Math.cos( a ) * 0.3, 0, Math.sin( a ) * 0.3 ] } );
		const chain = [ p ];
		for ( let k = 1; k < 3; k ++ ) {

			// each segment curls a little outward: a tentacle, not a stilt
			p = K.B.bone( 'tent' + i + '_' + k, p, [ 0, len, 0 ], { rot: [ - Math.cos( a ) * 0.35, 0, Math.sin( a ) * 0.35 ] } );
			chain.push( p );

		}

		chain.forEach( ( b, k ) => K.B.segment( b, 'cone', [ 0, 0, 0 ], [ 0, len * 1.05, 0 ], 0.07 * ( 1 - k * 0.28 ) * ( K.b.girth ?? 1 ), k % 2 ? 'secondary' : 'primary' ) );
		K.B.chain( 'tentacle', chain, { stiff: 22, damp: 3.5, swing: 1.6, wave: 0.35 } );

	}

}, { plans: [ 'floater', 'blob', 'biped', 'quadruped' ], styles: [ 'claw' ] } );

EX( 'veins', 'Glowing veins', [ 'magic', 'fire', 'chaos' ], ( K ) => {

	K.torso.forEach( ( seg ) => {

		const [ w, h, l ] = seg.s, c = seg.c;
		K.B.part( seg.bone, 'box', [ c[ 0 ] + w * 0.12, c[ 1 ], c[ 2 ] + ( longY( seg.s ) ? l * 0.47 : 0 ) ], [ 0, 0, 0.5 ], [ w * 0.06, h * 0.8, longY( seg.s ) ? l * 0.1 : l * 0.9 ], 'glow', { emissive: 0.9 } );

	} );

}, { styles: [ 'cast' ] } );

EX( 'armor', 'Armour pieces', [ 'armored', 'metal', 'humanoid' ], ( K ) => {

	for ( const A of K.arms ) K.B.part( A.upper, 'sphere', [ 0, 0.02, 0 ], [ 0, 0, 0 ], [ A.t * 2.6, A.t * 1.6, A.t * 2.4 ], 'metal', { shine: true } );
	const h = K.head;
	if ( h && ! h.isBody && K.g.plan === 'biped' ) K.B.part( h.bone, 'cyl', [ h.c[ 0 ], h.c[ 1 ] + h.s * 0.35, h.c[ 2 ] ], [ 0, 0, 0 ], [ h.s * 1.05, h.s * 0.45, h.s * 1.05 ], 'metal', { shine: true } );
	if ( ! K.arms.length && K.back[ 0 ] ) K.back.slice( 0, 2 ).forEach( ( pt ) => K.B.part( pt.bone, 'box', [ pt.pos[ 0 ], pt.pos[ 1 ], pt.pos[ 2 ] ], [ 0, 0, 0 ], [ pt.w * 2, pt.w * 0.3, pt.w * 1.4 ], 'metal', { shine: true } ) );

}, { plans: [ 'biped', 'quadruped' ] } );

EX( 'orbiters', 'Orbiting motes', [ 'magic' ], ( K ) => {

	// bones with an 'orbit' fx: the animator spins them around the body
	const h = K.torso[ 0 ];
	const r = Math.max( h.s[ 0 ], h.s[ 2 ] ) * 0.9;
	for ( let i = 0; i < 3; i ++ ) {

		const o = K.B.bone( 'orbit' + i, h.bone, [ 0, h.c[ 1 ] + h.s[ 1 ] * 0.2, 0 ], { fx: { type: 'orbit', speed: 1.6 + i * 0.3, phase: i * 2.1, tilt: 0.3 * ( i - 1 ) } } );
		K.B.part( o, 'octa', [ r, 0, 0 ], [ 0, 0, 0 ], 0.09, 'glow', { emissive: 1, flags: PF.NOSCATTER } );

	}

}, { styles: [ 'cast', 'summon' ], weight: 0.6 } );

EX( 'chains', 'Shackles', [ 'undead', 'metal' ], ( K ) => {

	for ( const A of K.arms ) K.B.part( A.fore, 'ring', [ 0, - A.b * 0.7, 0 ], [ 0, 0, 0 ], [ A.t * 2.4, A.t * 3, A.t * 2.4 ], 'metal', { shine: true } );
	for ( const L of K.legs.slice( 0, 2 ) ) K.B.part( L.shin, 'ring', [ 0, - L.b * 0.75, 0 ], [ 0, 0, 0 ], [ L.t * 2.2, L.t * 3, L.t * 2.2 ], 'metal', { shine: true } );

}, { plans: [ 'biped', 'quadruped' ] } );

EX( 'spikes', 'Body spikes', [ 'chaos', 'beast' ], ( K ) => {

	K.torso.forEach( ( seg, i ) => {

		const [ w, h ] = seg.s, c = seg.c;
		for ( const sx of [ - 1, 1 ] ) K.B.part( seg.bone, 'spike', [ c[ 0 ] + sx * w * 0.48, c[ 1 ] + h * 0.1, c[ 2 ] ], [ 0, 0, - sx * 1.2 ], [ w * 0.12, w * ( i % 2 ? 0.35 : 0.5 ), w * 0.12 ], 'accent' );

	} );

}, { plans: [ 'blob', 'floater', 'quadruped', 'serpent', 'hexapod', 'arachnid' ] } );

// lookup helper used by composite parts (hooded = serpent head + hood)
function get( id ) {

	return getDef( 'bodyPart', id );

}

export { D2R };
