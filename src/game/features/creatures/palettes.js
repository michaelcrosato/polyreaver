// Palettes: named colour sets every model reads through seven KEYS -
//   primary    main body colour            secondary  belly, under-side, cloth
//   accent     stripes, crests, trims      skin       exposed flesh, faces, hands
//   metal      armour, claws, weapons      glow       eyes, sacs, runes (emissive)
//   dark       mouths, joints, shadows
// Part lists use the keys ( color: 'primary' ), so ONE monster design reads as
// fire, frost, venom or void just by swapping the palette.
//
// Named palettes are registry defs ( define( 'palette', { id, tags, ...keys } ) ) so
// monster families and themes can ask for them by tag ( query( 'palette', { any:
// [ 'fire' ] } ) ). harmonyPalette() generates new ones from colour theory
// (analogous, complementary, triadic, split-complementary, monochrome) - that is
// where the endless variety comes from. Genomes store the RESOLVED colours (plain
// hex strings) so they stay valid JSON even if a palette def changes later.

import { define, all } from '../../core/registry.js';
import { hsl, hexToHsl } from './math.js';
import { RNG } from '../../core/rng.js';

const P = ( id, name, tags, primary, secondary, accent, skin, metal, glow, dark ) => define( 'palette', { id, name, tags, primary, secondary, accent, skin, metal, glow, dark } );

P( 'ember', 'Ember', [ 'fire', 'warm' ], '#8a3b2e', '#3b2a24', '#f2a541', '#c97b5a', '#7d7f86', '#ff6a2b', '#1c1512' );
P( 'magma', 'Magma', [ 'fire', 'warm', 'earth' ], '#2b2220', '#4a2a1e', '#ff8c1a', '#7a3a24', '#5e5452', '#ff4d12', '#120c0a' );
P( 'frost', 'Frost', [ 'cold' ], '#2e6b8a', '#1f3240', '#9fe3ff', '#6aa3b8', '#a8b3bd', '#5ad1ff', '#0f1820' );
P( 'glacier', 'Glacier', [ 'cold', 'light' ], '#d6e6f2', '#7fa2bf', '#3d7fd9', '#b8cfe0', '#c4d0db', '#7fe7ff', '#1d2a38' );
P( 'venom', 'Venom', [ 'poison', 'nature' ], '#4f7a2e', '#2c3b1f', '#d6f25a', '#8bb35a', '#6f7468', '#9cff3a', '#141a0f' );
P( 'bog', 'Bog', [ 'poison', 'nature', 'earth' ], '#5a5a32', '#3a3424', '#a8c94a', '#7a7048', '#6a6656', '#c6ff5a', '#17150e' );
P( 'void', 'Void', [ 'chaos', 'shadow' ], '#6b2e8a', '#2f1f40', '#ff7ae0', '#a36ab8', '#9a8fb3', '#d65aff', '#170f20' );
P( 'abyss', 'Abyss', [ 'chaos', 'shadow', 'cold' ], '#1d2236', '#2c1f3e', '#5ef0d2', '#4a4f6e', '#646a85', '#3dffd5', '#07080f' );
P( 'bone', 'Bone', [ 'undead', 'light' ], '#d8cfb8', '#8a8170', '#6e1f1f', '#e8dfc8', '#8f8a80', '#7fffd4', '#22201b' );
P( 'grave', 'Grave', [ 'undead', 'shadow' ], '#5d6660', '#33392f', '#a9c7a0', '#8a9a8a', '#6c726b', '#88ffb0', '#131612' );
P( 'storm', 'Storm', [ 'lightning', 'cold' ], '#3a4560', '#232a3d', '#ffe45a', '#7c8bb0', '#aab4c8', '#7ad7ff', '#0d1120' );
P( 'blood', 'Blood', [ 'physical', 'warm' ], '#7a1420', '#3a0d14', '#e8d6b0', '#b85a5a', '#6e6266', '#ff3040', '#160608' );
P( 'rust', 'Rust', [ 'physical', 'earth', 'warm' ], '#8a5a2e', '#4a3420', '#d9b45a', '#b88a5a', '#7a5e48', '#ffb040', '#1a120a' );
P( 'moss', 'Moss', [ 'nature', 'earth' ], '#3f5a34', '#5e4a32', '#c8a24a', '#9a8a62', '#6a6a5a', '#b4ff6a', '#141810' );
P( 'sand', 'Sand', [ 'earth', 'warm', 'light' ], '#c9a66b', '#8a6a42', '#4a8aa0', '#e0c49a', '#a09070', '#ffd27a', '#2a2014' );
P( 'coral', 'Coral', [ 'water', 'warm' ], '#e07a6a', '#3a6a8a', '#f2e0a0', '#f0a090', '#90a0b0', '#7affea', '#1a1a2a' );
P( 'amethyst', 'Amethyst', [ 'chaos', 'crystal' ], '#4a2e6b', '#8a6ab8', '#e0c8ff', '#9a80c0', '#b0a8c8', '#c08aff', '#120a1e' );
P( 'jade', 'Jade', [ 'nature', 'crystal' ], '#2e8a6a', '#1f4038', '#f2d080', '#7ac0a0', '#a0b8a8', '#6affc0', '#0c1a14' );
P( 'gold', 'Gilded', [ 'holy', 'light' ], '#c9a227', '#6a4a1a', '#fff2b0', '#e0c080', '#e8c860', '#fff07a', '#20180a' );
P( 'ash', 'Ash', [ 'fire', 'shadow', 'undead' ], '#4a4848', '#2a2828', '#ff5a2a', '#7a7070', '#5a5858', '#ff7a3a', '#0e0d0d' );
P( 'ink', 'Ink', [ 'shadow', 'water' ], '#1e2a3a', '#0f151f', '#e05a7a', '#3a4a5e', '#56606e', '#ff6a9a', '#05070a' );
P( 'tiger', 'Tiger', [ 'physical', 'warm', 'nature' ], '#d9822b', '#f2e6d0', '#1a1a1a', '#e0a070', '#8a7a6a', '#ffcf5a', '#141008' );

// Generate a palette from a base hue with a colour-harmony rule. rng: RNG.
//   analogous      neighbours on the wheel: calm, natural creatures
//   complementary  opposite accent: loud, readable silhouettes (bosses)
//   triadic        three evenly spaced hues: alien, toxic, playful
//   split          base + the two neighbours of its complement
//   mono           one hue, many values: ghosts, golems, crystal beings
export const HARMONIES = [ 'analogous', 'complementary', 'triadic', 'split', 'mono' ];

export function harmonyPalette( rng, { harmony = null, hue = null, sat = null, dark = null, id = null } = {} ) {

	const r = rng instanceof RNG ? rng : new RNG( rng );
	const hm = harmony || r.pick( HARMONIES );
	const h = hue ?? r.next();
	const s = sat ?? r.range( 0.35, 0.8 );
	const lv = dark ?? r.range( 0.22, 0.5 ); // body lightness: monsters read best mid-dark
	const off = {
		analogous: [ 0.07, - 0.07 ], complementary: [ 0.5, 0.04 ], triadic: [ 1 / 3, 2 / 3 ],
		split: [ 0.42, 0.58 ], mono: [ 0, 0.02 ]
	}[ hm ];
	return {
		id: id || `${hm}-${Math.round( h * 360 )}`,
		harmony: hm,
		primary: hsl( h, s, lv ),
		secondary: hsl( h + off[ 0 ] * 0.5, s * 0.7, lv * 0.62 ),
		accent: hsl( h + off[ 0 ], Math.min( 1, s + 0.2 ), Math.min( 0.75, lv + 0.3 ) ),
		skin: hsl( h + off[ 1 ] * 0.3, s * 0.5, Math.min( 0.72, lv + 0.2 ) ),
		metal: hsl( h + 0.6, 0.08, 0.55 ),
		glow: hsl( h + off[ 1 ], 1, 0.6 ),
		dark: hsl( h, s * 0.5, 0.07 )
	};

}

// Pick a palette for a genome: a named one (optionally by tags) or a generated one.
export function pickPalette( rng, { tags = [], palette = null } = {} ) {

	if ( palette && typeof palette === 'object' ) return { ...palette };
	if ( typeof palette === 'string' ) {

		const d = all( 'palette' ).find( ( p ) => p.id === palette );
		if ( d ) return resolved( d );

	}

	const named = all( 'palette' ).filter( ( p ) => ! tags.length || tags.some( ( t ) => p.tags.includes( t ) ) );
	if ( named.length && ( tags.length ? rng.chance( 0.75 ) : rng.chance( 0.45 ) ) ) return resolved( rng.pick( named ) );
	return harmonyPalette( rng );

}

function resolved( d ) {

	return { id: d.id, primary: d.primary, secondary: d.secondary, accent: d.accent, skin: d.skin, metal: d.metal, glow: d.glow, dark: d.dark };

}

// Nudge every colour's hue / lightness a little (mutation) - keeps the harmony.
export function shiftPalette( p, rng, amount = 0.1 ) {

	const dh = rng.range( - amount, amount ) * 0.5, dl = rng.range( - amount, amount ) * 0.4;
	const out = { id: p.id + '~' };
	for ( const k of [ 'primary', 'secondary', 'accent', 'skin', 'metal', 'glow', 'dark' ] ) {

		const [ h, s, l ] = hexToHsl( p[ k ] );
		out[ k ] = hsl( h + dh, s, k === 'glow' || k === 'dark' ? l : l + dl );

	}

	return out;

}

// Breeding: each key from either parent (keeps related colours together in pairs).
export function crossPalettes( a, b, rng ) {

	const out = { id: `${a.id}x${b.id}`.slice( 0, 40 ) };
	const groups = [ [ 'primary', 'secondary' ], [ 'accent', 'glow' ], [ 'skin', 'dark' ], [ 'metal' ] ];
	for ( const g of groups ) {

		const src = rng.chance( 0.5 ) ? a : b;
		for ( const k of g ) out[ k ] = src[ k ];

	}

	return out;

}
