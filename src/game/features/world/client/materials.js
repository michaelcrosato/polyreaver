// Level materials, written in TSL (three.js shading language) - every surface is
// procedural, no textures:
//
//   floor   flagstones / cobbles / plates / bare rock from per-instance pattern
//           parameters (stones per tile, grout, noise, gloss): one shader, every theme
//   wall    brick, rock strata, metal panels, hedge, hex resin, crystal - chosen by the
//           theme; a lighter cap band and a dark foot; plus the CUTAWAY: wall pixels
//           between the camera and the player dissolve (dithered) so you never lose
//           sight of yourself behind a wall
//   lava    flowing fractal noise with a cooling crust, emissive
//   water   dark, glossy, with moving ripple highlights
//   ice     glossy, cracked (Worley cells), with sparkles
//   props   vertex colours + a per-vertex glow weight scaled per instance (flicker,
//           lit / unlit state) - one material for every baked part-list model
//
// Shared uniforms (U) are updated once per frame by the level render system.

import * as THREE from 'three/webgpu';
import {
	Fn, uniform, vec2, vec3, float, positionWorld, normalWorld, attribute, mix, smoothstep, step, fract, floor, abs, sin, max, min,
	clamp, hash, mx_noise_float, mx_fractal_noise_float, mx_worley_noise_float, screenUV, screenCoordinate, positionView,
	interleavedGradientNoise, Discard, If, length, pow, uv, instanceIndex
} from 'three/tsl';

export const U = {
	time: uniform( 0 ),
	focus: uniform( new THREE.Vector3() ), // the player (fog centre, cutaway target)
	playerUV: uniform( new THREE.Vector2( 0.5, 0.5 ) ),
	playerViewZ: uniform( - 30 ),
	aspect: uniform( 1 ),
	cutRadius: uniform( 0.11 ),
	cell: uniform( 2 ),
	origin: uniform( new THREE.Vector2() )
};

// Stable per-cell random in [0, 1).
const cellHash = ( id ) => hash( id.x.add( 1000 ).mul( 0.6180339 ).add( id.y.add( 1000 ).mul( 127.1 ) ).mul( 43.758 ) );

// --- floor ---------------------------------------------------------------------------
// aColor: tile colour (style colour x variation x ambient occlusion)
// aPat:   ( stones per tile edge, grout strength, noise amount, gloss )
export function floorMaterial() {

	const m = new THREE.MeshStandardNodeMaterial( { metalness: 0 } );
	const col = attribute( 'aColor', 'vec3' ), pat = attribute( 'aPat', 'vec4' );
	const P = positionWorld;
	const top = smoothstep( 0.5, 0.85, normalWorld.y );
	const tileUV = P.xz.sub( U.origin ).div( U.cell );
	const stones = max( pat.x, 1 );
	const g = tileUV.mul( stones );
	const row = floor( g.y );
	const gx = g.x.add( row.mod( 2 ).mul( 0.5 ) ); // running bond: odd rows shift half a stone
	const id = vec2( floor( gx ), row );
	const st = vec2( fract( gx ), fract( g.y ) );
	const edge = min( min( st.x, st.y ), min( float( 1 ).sub( st.x ), float( 1 ).sub( st.y ) ) );
	const hasStones = step( 0.5, pat.x );
	const grout = float( 1 ).sub( smoothstep( 0.015, 0.07, edge ) ).mul( pat.y ).mul( hasStones );
	const stoneVar = cellHash( id ).sub( 0.5 ).mul( 0.26 ).mul( hasStones );
	const noise = mx_noise_float( vec3( P.x.mul( 0.45 ), 0, P.z.mul( 0.45 ) ) ).mul( 0.5 ).add( mx_noise_float( vec3( P.x.mul( 1.7 ), 3, P.z.mul( 1.7 ) ) ).mul( 0.25 ) );
	const topCol = col.mul( float( 1 ).add( stoneVar ).add( noise.mul( pat.z ) ) ).mul( float( 1 ).sub( grout.mul( 0.6 ) ) );
	// column sides (seen at pit edges): darker rock strata, fading into the abyss
	const strata = mx_noise_float( vec3( P.x.add( P.z ).mul( 0.8 ), P.y.mul( 3 ), 0 ) ).mul( 0.15 ).add( 0.45 );
	const sideCol = col.mul( strata ).mul( smoothstep( - 5, - 0.2, P.y ).mul( 0.85 ).add( 0.15 ) );
	m.colorNode = mix( sideCol, topCol, top );
	m.roughnessNode = mix( float( 0.92 ), float( 0.32 ), pat.w ).add( grout.mul( 0.1 ) );
	m.metalnessNode = pat.w.mul( 0.08 );
	return m;

}

// --- walls ---------------------------------------------------------------------------
// aColor: side colour, aTop: top colour, aWall: ( pattern amount 0 = plain mass, top height, seed, - )
const WALL_PATTERNS = {
	brick( P, h ) {

		const row = floor( P.y.div( 0.46 ) );
		const u = h.div( 0.92 ).add( row.mod( 2 ).mul( 0.5 ) );
		const e = min( min( fract( u ), float( 1 ).sub( fract( u ) ) ).mul( 0.92 ), min( fract( P.y.div( 0.46 ) ), float( 1 ).sub( fract( P.y.div( 0.46 ) ) ) ).mul( 0.46 ) );
		const mortar = float( 1 ).sub( smoothstep( 0.015, 0.05, e ) );
		const v = cellHash( vec2( floor( u ), row ) ).sub( 0.5 ).mul( 0.22 );
		return float( 1 ).add( v ).sub( mortar.mul( 0.45 ) );

	},
	rock( P, h ) {

		const n = mx_fractal_noise_float( vec3( h.mul( 0.5 ), P.y.mul( 1.6 ), 0.5 ), 3, 2, 0.5 );
		const strata = sin( P.y.mul( 7 ).add( n.mul( 4 ) ) ).mul( 0.06 );
		return float( 0.95 ).add( n.mul( 0.35 ) ).add( strata );

	},
	panel( P, h ) {

		const u = fract( h.div( 1.4 ) ), v = fract( P.y.div( 1.1 ) );
		const seam = float( 1 ).sub( smoothstep( 0.0, 0.03, min( min( u, float( 1 ).sub( u ) ), min( v, float( 1 ).sub( v ) ) ) ) );
		const rivet = float( 1 ).sub( smoothstep( 0.02, 0.05, length( vec2( fract( h.div( 0.35 ) ).sub( 0.5 ), v.sub( 0.12 ).mul( 3 ) ) ).mul( 0.35 ) ) );
		return float( 1 ).sub( seam.mul( 0.5 ) ).add( rivet.mul( 0.25 ) ).add( cellHash( vec2( floor( h.div( 1.4 ) ), floor( P.y.div( 1.1 ) ) ) ).mul( 0.12 ) );

	},
	hedge( P, h ) {

		const n = mx_noise_float( vec3( h.mul( 3.2 ), P.y.mul( 3.2 ), 1 ) ).mul( 0.5 ).add( mx_noise_float( vec3( h.mul( 9 ), P.y.mul( 9 ), 2 ) ).mul( 0.25 ) );
		return float( 0.9 ).add( n.mul( 0.6 ) );

	},
	hex( P, h ) {

		const w = mx_worley_noise_float( vec3( h.mul( 1.3 ), P.y.mul( 1.5 ), 0 ) );
		return float( 0.75 ).add( smoothstep( 0.05, 0.35, w ).mul( 0.4 ) );

	},
	crystal( P, h ) {

		const w = mx_worley_noise_float( vec3( h.mul( 0.9 ), P.y.mul( 0.9 ), 0 ) );
		return float( 0.8 ).add( w.mul( 0.5 ) );

	}
};

export function wallMaterial( pattern = 'rock' ) {

	const m = new THREE.MeshStandardNodeMaterial( { metalness: 0, roughness: 0.9 } );
	const side = attribute( 'aColor', 'vec3' ), topC = attribute( 'aTop', 'vec3' ), w = attribute( 'aWall', 'vec4' );
	const P = positionWorld;
	const isTop = smoothstep( 0.6, 0.9, normalWorld.y );
	const h = P.x.add( P.z ); // a horizontal coordinate that runs along both wall orientations
	const shade = ( WALL_PATTERNS[ pattern ] || WALL_PATTERNS.rock )( P, h );
	const pat = mix( float( 1 ), shade, w.x );
	const cap = smoothstep( w.y.sub( 0.32 ), w.y.sub( 0.2 ), P.y ).mul( w.x ).mul( 0.22 );
	const foot = smoothstep( 0.0, 0.9, P.y ).mul( 0.45 ).add( 0.55 );
	const sideCol = side.mul( pat ).mul( foot ).add( cap );
	const topNoise = mx_noise_float( vec3( P.x.mul( 0.8 ), 7, P.z.mul( 0.8 ) ) ).mul( 0.12 ).add( 1 );
	m.colorNode = Fn( () => {

		// CUTAWAY: dissolve wall pixels in front of the player (closer to the camera,
		// near the player on screen, above ankle height), with a dithered soft edge
		const d = length( screenUV.sub( U.playerUV ).mul( vec2( U.aspect, 1 ) ) );
		const inFront = step( U.playerViewZ.add( 1.2 ), positionView.z );
		const fade = float( 1 ).sub( smoothstep( U.cutRadius.mul( 0.55 ), U.cutRadius, d ) ).mul( inFront ).mul( step( 0.35, P.y ) );
		If( interleavedGradientNoise( screenCoordinate.xy ).lessThan( fade.mul( 1.05 ) ), () => {

			Discard();

		} );

		return mix( sideCol, topC.mul( topNoise ), isTop );

	} )();
	return m;

}

// --- liquids, ice, pits -----------------------------------------------------------------------

export function lavaMaterial( hex ) {

	const m = new THREE.MeshStandardNodeMaterial( { roughness: 0.6, metalness: 0 } );
	const hot = uniform( new THREE.Color( hex ) );
	const P = positionWorld;
	const t = U.time;
	const flow = mx_fractal_noise_float( vec3( P.x.mul( 0.22 ).add( t.mul( 0.05 ) ), P.z.mul( 0.22 ), t.mul( 0.12 ) ), 3, 2, 0.5 );
	const cells = mx_worley_noise_float( vec3( P.x.mul( 0.6 ), P.z.mul( 0.6 ).sub( t.mul( 0.08 ) ), t.mul( 0.05 ) ) );
	const crust = smoothstep( 0.18, 0.42, cells ).mul( smoothstep( - 0.1, 0.35, flow ) );
	const glow = float( 1 ).sub( crust.mul( 0.88 ) );
	// mostly emissive: lit diffuse on top of the glow would wash it out to white
	m.colorNode = mix( hot.mul( 0.15 ), vec3( 0.13, 0.075, 0.055 ), crust ); // crust: dark basalt that still reads under dim light
	// keep it below the tone mapper's shoulder: bright orange turns pale peach under ACES
	m.emissiveNode = hot.mul( glow ).mul( float( 0.55 ).add( sin( t.mul( 1.7 ).add( P.x.mul( 0.3 ) ) ).mul( 0.1 ) ) ).add( vec3( 1, 0.45, 0.1 ).mul( pow( glow, 8 ) ).mul( 0.12 ) )
		.add( hot.mul( crust ).mul( 0.07 ) ); // the crust smoulders: a basin never reads as a hole
	return m;

}

export function waterMaterial( hex ) {

	const m = new THREE.MeshStandardNodeMaterial( { roughness: 0.06, metalness: 0.2 } );
	const base = uniform( new THREE.Color( hex ) );
	const P = positionWorld, t = U.time;
	// two slow noise fields drifting against each other; their thin crossings are the
	// glints of light on a dark surface
	const r1 = mx_noise_float( vec3( P.x.mul( 0.6 ), P.z.mul( 0.6 ), t.mul( 0.25 ) ) );
	const r2 = mx_noise_float( vec3( P.x.mul( 1.4 ).add( t.mul( 0.15 ) ), P.z.mul( 1.4 ), t.mul( 0.4 ) ) );
	const glint = float( 1 ).sub( smoothstep( 0.0, 0.06, abs( r1.add( r2.mul( 0.5 ) ) ) ) );
	m.colorNode = base.mul( float( 0.55 ).add( r1.mul( 0.12 ) ) );
	m.emissiveNode = base.mul( 0.15 ).add( vec3( 0.55, 0.75, 0.85 ).mul( glint.mul( 0.12 ) ) );
	return m;

}

export function iceMaterial( hex ) {

	const m = new THREE.MeshStandardNodeMaterial( { roughness: 0.1, metalness: 0.12 } );
	const base = uniform( new THREE.Color( hex ) );
	const ao = attribute( 'aColor', 'vec3' );
	const P = positionWorld;
	const top = smoothstep( 0.5, 0.85, normalWorld.y );
	const cracks = float( 1 ).sub( smoothstep( 0.02, 0.07, mx_worley_noise_float( vec3( P.x.mul( 0.7 ), 0, P.z.mul( 0.7 ) ) ) ) );
	const deep = mx_noise_float( vec3( P.x.mul( 0.3 ), 5, P.z.mul( 0.3 ) ) ).mul( 0.18 );
	// sparkles: a few cells per square metre blink as the camera / time moves
	const sp = floor( P.xz.mul( 6 ) );
	const spark = step( 0.985, cellHash( sp ) ).mul( sin( U.time.mul( 3 ).add( cellHash( sp.add( 7 ) ).mul( 30 ) ) ).mul( 0.5 ).add( 0.5 ) );
	m.colorNode = mix( base.mul( 0.35 ), base.mul( float( 0.85 ).add( deep ) ).add( cracks.mul( 0.25 ) ).mul( ao ), top );
	m.emissiveNode = vec3( 0.75, 0.9, 1 ).mul( spark.mul( 1.4 ).add( cracks.mul( 0.05 ) ) ).mul( top );
	return m;

}

// The bottom of pits / the void below: a dark gradient (+ stars for the observatory).
export function pitMaterial( hex, stars = 0 ) {

	const m = new THREE.MeshBasicNodeMaterial();
	const base = uniform( new THREE.Color( hex ) );
	const P = positionWorld;
	// stars: one candidate per small cell, drawn as a soft point at a random spot in it
	const g = P.xz.mul( 2.2 );
	const cell = floor( g );
	const off = vec2( cellHash( cell.add( 11 ) ), cellHash( cell.add( 23 ) ) ).mul( 0.6 ).add( 0.2 );
	const d = length( fract( g ).sub( off ) );
	const star = step( 0.975, cellHash( cell ) ).mul( float( 1 ).sub( smoothstep( 0.015, 0.09, d ) ) ).mul( stars ).mul( sin( U.time.mul( 2 ).add( cellHash( cell.add( 3 ) ).mul( 40 ) ) ).mul( 0.4 ).add( 0.6 ) );
	m.colorNode = base.add( vec3( 0.8, 0.85, 1 ).mul( star ) );
	m.fog = false;
	return m;

}

// --- props ------------------------------------------------------------------------------
// Baked part-list geometry carries 'color' and 'glow'; instances carry 'aGlow'
// ( x = glow multiplier, y = flicker amount ). Emissive = colour x glow x state.
export function propMaterial() {

	const m = new THREE.MeshStandardNodeMaterial( { roughness: 0.78, metalness: 0.05 } );
	const c = attribute( 'color', 'vec3' ), g = attribute( 'glow', 'float' ), state = attribute( 'aGlow', 'vec2' );
	const seed = hash( instanceIndex.add( 17 ) ).mul( 50 );
	const flick = float( 1 ).sub( state.y.mul( sin( U.time.mul( 11 ).add( seed ) ).mul( 0.5 ).add( sin( U.time.mul( 23.7 ).add( seed.mul( 1.7 ) ) ).mul( 0.5 ) ).mul( 0.5 ).add( 0.5 ) ) );
	m.colorNode = c;
	m.emissiveNode = c.mul( g ).mul( state.x ).mul( flick ).mul( 2.2 );
	return m;

}

// --- additive glow halos (sell light sources without a bloom pass) ---------------------------
export function haloMaterial() {

	const m = new THREE.SpriteNodeMaterial( { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending } );
	m.fog = false;
	return m;

}

// radial falloff for a halo sprite: 1 at the centre, 0 at the rim
export const halo = () => pow( clamp( float( 1 ).sub( length( uv().sub( 0.5 ) ).mul( 2 ) ), 0, 1 ), 2.2 );
