// Creature genome - Spore-style monster DNA (sim-safe: plain data, no three.js).
//
// A GENOME is plain JSON (save files, agent tools, network) that fully determines a
// creature's body, colours, gait and temperament:
//
//   {
//     v: 1, seed, plan: 'quadruped', size: 1, level: 1, tags: [ 'fire' ],
//     body:   { length, girth, legLen, legThick, armLen, neckLen, headSize, tailLen, hunch, taper, ... }
//             skeleton params; which keys exist and their ranges come from the bodyPlan def
//     parts:  { torso: { id, s, v }, legs, arms, head, eyes, horns, back, tail, wings, extra: [ ... ] }
//             one bodyPart per slot ( s = size 0.6..1.5, v = free variant 0..1 ), null = none
//     palette:{ id, primary, secondary, accent, skin, metal, glow, dark }   resolved hex colours
//     pattern:'solid' | 'banded' | 'spotted' | 'striped' | 'gradient'
//     gait:   { style, stride, cadence, bounce, posture, digi, fly }
//     personality: { fidget, aggression, twitch, idle }
//   }
//
// Everything is deterministic from the RNG you pass (or the seed): the same seed
// always grows the same monster, in the browser and in Node. mutateGenome() and
// crossGenomes() (breeding) always return VALID genomes: params are clamped to the
// plan's ranges and parts that do not fit the plan are re-rolled.
//
// genomeMetrics() builds the actual rig ( body.js ) and measures it, so collision
// radius, height and reach always match what the renderer draws.
//
// Extending: define( 'bodyPlan', ... ) in plans.js style, define( 'bodyPart', ... )
// in parts.js style, define( 'palette', ... ) - generation picks them up by tags.

import { RNG } from '../../core/rng.js';
import { all, get, query } from '../../core/registry.js';
import { pickPalette, shiftPalette, crossPalettes } from './palettes.js';
import './plans.js';
import './parts.js';
import { buildBody } from './body.js';

export const BODY_PLANS = [ 'biped', 'quadruped', 'hexapod', 'serpent', 'floater', 'blob', 'arachnid', 'avian' ];
export const SLOTS = [ 'torso', 'legs', 'arms', 'head', 'eyes', 'horns', 'back', 'tail', 'wings', 'extra' ];
export const PATTERNS = [ 'solid', 'solid', 'banded', 'spotted', 'striped', 'gradient' ];
export const IDLES = [ 'sway', 'sniff', 'shuffle', 'still', 'twitchy' ];

const toRng = ( rng ) => ( rng instanceof RNG ? rng : new RNG( rng ?? 1 ) );
const r3 = ( v ) => Math.round( v * 1000 ) / 1000;

// Parts that may fill `slot` on `plan`, weighted toward the genome's tags.
export function partChoices( plan, slot, tags = [] ) {

	return query( 'bodyPart', { filter: ( d ) => d.slot === slot && ( ! d.plans || d.plans.includes( plan ) ) } )
		.map( ( d ) => ( { d, w: ( d.weight ?? 1 ) * ( 1 + 2.5 * d.tags.filter( ( t ) => tags.includes( t ) ).length ) } ) );

}

function rollPart( r, plan, slot, tags ) {

	const c = partChoices( plan, slot, tags );
	const pick = r.weighted( c, ( x ) => x.w );
	return pick ? { id: pick.d.id, s: r3( r.range( 0.75, 1.3 ) ), v: r3( r.next() ) } : null;

}

// Torso styles that read well per plan (others are allowed but rarer).
const TORSO_PREF = {
	biped: [ 'muscled', 'barrel', 'plated', 'furred', 'skeletal', 'crystal', 'rocky', 'scaled', 'chitin' ],
	quadruped: [ 'muscled', 'furred', 'plated', 'scaled', 'barrel', 'skeletal', 'rocky', 'chitin', 'crystal' ],
	hexapod: [ 'chitin', 'plated', 'crystal' ], arachnid: [ 'chitin', 'crystal' ],
	serpent: [ 'scaled', 'muscled', 'plated', 'chitin', 'skeletal', 'crystal' ],
	floater: [ 'orb', 'jelly', 'skullbody', 'rocky', 'crystal' ], blob: [ 'jelly', 'slime', 'orb', 'rocky', 'crystal' ],
	avian: [ 'feathered', 'muscled', 'skeletal', 'crystal' ]
};

export function generateGenome( rng = new RNG( 1 ), { plan = null, size = 1, tags = [], palette = null, level = 1, parts = null, body = null, gait = null } = {} ) {

	const r = toRng( rng );
	const seed = r.int( 1, 2 ** 31 - 1 );
	const g = new RNG( seed ); // everything below derives from the genome's own seed
	const planDef = plan ? get( 'bodyPlan', plan ) : g.weighted( all( 'bodyPlan' ), ( p ) => ( p.weight ?? 1 ) * ( 1 + 2 * p.tags.filter( ( t ) => tags.includes( t ) ).length ) );
	if ( ! planDef ) throw new Error( `generateGenome: unknown body plan '${plan}'` );
	const out = { v: 1, seed, plan: planDef.id, size, level, tags: [ ...tags ] };

	out.body = {};
	for ( const [ k, [ a, b ] ] of Object.entries( planDef.params ) ) out.body[ k ] = r3( g.range( a, b ) );
	if ( body ) Object.assign( out.body, body );

	const gs = planDef.gait;
	out.gait = {
		style: g.pick( gs.styles ), stride: r3( g.range( 0.85, 1.2 ) ), cadence: r3( g.range( 0.85, 1.2 ) ), bounce: r3( g.range( 0.5, 1.5 ) ),
		posture: r3( g.range( - 0.15, 0.35 ) ),
		digi: planDef.id === 'biped' && g.chance( 0.25 ),
		fly: planDef.id === 'floater' || ( planDef.id === 'avian' && g.chance( 0.6 ) )
	};
	if ( gait ) Object.assign( out.gait, gait );

	out.parts = {};
	for ( const slot of SLOTS ) {

		const ch = planDef.slots[ slot ] ?? 0;
		if ( slot === 'extra' ) {

			out.parts.extra = [];
			if ( g.chance( ch ) ) out.parts.extra.push( rollPart( g, planDef.id, 'extra', tags ) );
			if ( g.chance( ch * 0.35 ) ) out.parts.extra.push( rollPart( g, planDef.id, 'extra', tags ) );
			out.parts.extra = out.parts.extra.filter( ( p, i, a ) => p && a.findIndex( ( q ) => q?.id === p.id ) === i );
			continue;

		}

		if ( slot === 'torso' ) {

			const pref = TORSO_PREF[ planDef.id ] || [];
			const c = partChoices( planDef.id, 'torso', tags ).map( ( x ) => ( { ...x, w: x.w * ( pref.indexOf( x.d.id ) >= 0 ? 3 / ( 1 + pref.indexOf( x.d.id ) * 0.3 ) : 0.3 ) } ) );
			const pick = g.weighted( c, ( x ) => x.w );
			out.parts.torso = pick ? { id: pick.d.id, s: 1, v: r3( g.next() ) } : null;
			continue;

		}

		out.parts[ slot ] = ch >= 1 || g.chance( ch ) ? rollPart( g, planDef.id, slot, tags ) : null;

	}

	if ( parts ) Object.assign( out.parts, parts );
	if ( out.plan === 'avian' && ! out.parts.wings ) out.parts.wings = rollPart( g, 'avian', 'wings', tags );
	out.palette = pickPalette( g, { tags, palette } );
	out.pattern = g.pick( PATTERNS );
	out.personality = { fidget: r3( g.next() ), aggression: r3( g.next() ), twitch: r3( g.next() ), idle: g.pick( IDLES ) };
	return validateGenome( out );

}

// Make any genome-like object valid: known plan, params inside the plan ranges,
// parts that exist and fit the plan, a complete palette. Returns a NEW object.
export function validateGenome( src ) {

	const g = JSON.parse( JSON.stringify( src || {} ) );
	const planDef = get( 'bodyPlan', g.plan ) || get( 'bodyPlan', 'biped' );
	g.v = 1;
	g.plan = planDef.id;
	g.seed = ( g.seed >>> 0 ) || 1;
	g.size = Math.max( 0.3, Math.min( 8, + g.size || 1 ) );
	g.level = g.level ?? 1;
	g.tags = Array.isArray( g.tags ) ? g.tags : [];
	const r = new RNG( g.seed ^ 0x5bd1e995 );
	g.body = g.body || {};
	for ( const [ k, [ a, b ] ] of Object.entries( planDef.params ) ) {

		const v = + g.body[ k ];
		g.body[ k ] = Number.isFinite( v ) ? Math.max( a, Math.min( b, v ) ) : r3( ( a + b ) / 2 );

	}

	for ( const k of Object.keys( g.body ) ) if ( ! planDef.params[ k ] ) delete g.body[ k ];
	g.gait = { style: planDef.gait.styles[ 0 ], stride: 1, cadence: 1, bounce: 1, posture: 0, digi: false, fly: planDef.id === 'floater', ...( g.gait || {} ) };
	if ( ! planDef.gait.styles.includes( g.gait.style ) ) g.gait.style = planDef.gait.styles[ 0 ];
	if ( planDef.id === 'floater' ) g.gait.fly = true;
	if ( planDef.id !== 'avian' && planDef.id !== 'floater' ) g.gait.fly = false;
	if ( planDef.id !== 'biped' ) g.gait.digi = false;
	g.parts = g.parts || {};
	for ( const slot of SLOTS ) {

		const fits = ( p ) => {

			const d = p && get( 'bodyPart', p.id );
			return d && d.slot === slot && ( ! d.plans || d.plans.includes( planDef.id ) ) && ( planDef.slots[ slot ] ?? 0 ) > 0;

		};

		if ( slot === 'extra' ) {

			g.parts.extra = ( Array.isArray( g.parts.extra ) ? g.parts.extra : [] ).filter( fits ).slice( 0, 3 );
			continue;

		}

		const p = g.parts[ slot ];
		if ( p && ! fits( p ) ) g.parts[ slot ] = ( planDef.slots[ slot ] ?? 0 ) >= 1 ? rollPart( r, planDef.id, slot, g.tags ) : null;
		if ( g.parts[ slot ] ) g.parts[ slot ] = { id: g.parts[ slot ].id, s: Math.max( 0.5, Math.min( 1.6, + g.parts[ slot ].s || 1 ) ), v: + g.parts[ slot ].v || 0 };
		// required slots fall back to the plan default
		if ( ! g.parts[ slot ] && ( planDef.slots[ slot ] ?? 0 ) >= 1 && planDef.defaults[ slot ] ) g.parts[ slot ] = { id: planDef.defaults[ slot ], s: 1, v: 0 };

	}

	if ( planDef.id === 'avian' && g.gait.fly && ! g.parts.wings ) g.parts.wings = { id: 'feather', s: 1, v: 0 };
	const P = g.palette && typeof g.palette === 'object' ? g.palette : pickPalette( r, { tags: g.tags } );
	const base = pickPalette( new RNG( g.seed ), {} );
	g.palette = {};
	for ( const k of [ 'primary', 'secondary', 'accent', 'skin', 'metal', 'glow', 'dark' ] ) g.palette[ k ] = /^#[0-9a-f]{6}$/i.test( P[ k ] ) ? P[ k ] : base[ k ];
	g.palette.id = P.id || base.id;
	if ( ! PATTERNS.includes( g.pattern ) ) g.pattern = 'solid';
	g.personality = { fidget: 0.5, aggression: 0.5, twitch: 0.3, idle: 'sway', ...( g.personality || {} ) };
	return g;

}

// Small random changes: params drift, a part may swap, colours shift a little.
// amount 0..1 (0.2 = a sibling, 0.6 = a cousin). Always returns a valid genome.
export function mutateGenome( g, rng, amount = 0.2 ) {

	const r = toRng( rng );
	const src = validateGenome( g );
	const planDef = get( 'bodyPlan', src.plan );
	const out = JSON.parse( JSON.stringify( src ) );
	out.seed = r.int( 1, 2 ** 31 - 1 );
	for ( const [ k, [ a, b ] ] of Object.entries( planDef.params ) ) out.body[ k ] = r3( src.body[ k ] + ( b - a ) * r.range( - amount, amount ) );
	for ( const slot of SLOTS ) {

		if ( ! r.chance( amount * 0.6 ) ) continue;
		if ( slot === 'extra' ) {

			out.parts.extra = r.chance( 0.5 ) && out.parts.extra.length ? out.parts.extra.slice( 1 ) : [ ...out.parts.extra, rollPart( r, src.plan, 'extra', src.tags ) ];
			continue;

		}

		const ch = planDef.slots[ slot ] ?? 0;
		if ( ch <= 0 ) continue;
		out.parts[ slot ] = ch < 1 && r.chance( 0.3 ) ? null : rollPart( r, src.plan, slot, src.tags );

	}

	for ( const slot of SLOTS ) if ( out.parts[ slot ] && ! Array.isArray( out.parts[ slot ] ) ) out.parts[ slot ].s = r3( out.parts[ slot ].s * ( 1 + r.range( - amount, amount ) * 0.5 ) );
	out.palette = shiftPalette( src.palette, r, amount );
	if ( r.chance( amount * 0.3 ) ) out.pattern = r.pick( PATTERNS );
	out.gait.stride = r3( src.gait.stride * ( 1 + r.range( - amount, amount ) * 0.3 ) );
	out.gait.cadence = r3( src.gait.cadence * ( 1 + r.range( - amount, amount ) * 0.3 ) );
	out.size = r3( src.size * ( 1 + r.range( - amount, amount ) * 0.15 ) );
	for ( const k of [ 'fidget', 'aggression', 'twitch' ] ) out.personality[ k ] = r3( Math.max( 0, Math.min( 1, src.personality[ k ] + r.range( - amount, amount ) ) ) );
	return validateGenome( out );

}

// Breeding: the child takes its plan from one parent, blends the skeleton params
// both share, inherits each part slot from either parent (re-rolled if it does not
// fit the child's plan), mixes palettes by colour group, averages size and gait.
export function crossGenomes( a, b, rng ) {

	const r = toRng( rng );
	const A = validateGenome( a ), Bg = validateGenome( b );
	const main = r.chance( 0.5 ) ? A : Bg, other = main === A ? Bg : A;
	const planDef = get( 'bodyPlan', main.plan );
	const out = JSON.parse( JSON.stringify( main ) );
	out.seed = r.int( 1, 2 ** 31 - 1 );
	out.tags = [ ...new Set( [ ...A.tags, ...Bg.tags ] ) ];
	for ( const k of Object.keys( planDef.params ) ) {

		const v2 = other.body[ k ];
		if ( v2 !== undefined ) out.body[ k ] = r3( main.body[ k ] + ( v2 - main.body[ k ] ) * r.range( 0.2, 0.8 ) );

	}

	for ( const slot of SLOTS ) {

		if ( slot === 'extra' ) {

			out.parts.extra = [ ...main.parts.extra, ...other.parts.extra ].filter( () => r.chance( 0.6 ) ).slice( 0, 2 );
			continue;

		}

		if ( r.chance( 0.5 ) ) out.parts[ slot ] = other.parts[ slot ] ? { ...other.parts[ slot ] } : ( ( planDef.slots[ slot ] ?? 0 ) >= 1 ? out.parts[ slot ] : null );

	}

	out.palette = crossPalettes( A.palette, Bg.palette, r );
	out.pattern = r.chance( 0.5 ) ? A.pattern : Bg.pattern;
	out.size = r3( ( A.size + Bg.size ) / 2 );
	out.level = Math.max( A.level ?? 1, Bg.level ?? 1 );
	for ( const k of [ 'stride', 'cadence', 'bounce', 'posture' ] ) out.gait[ k ] = r3( ( A.gait[ k ] + Bg.gait[ k ] ) / 2 );
	for ( const k of [ 'fidget', 'aggression', 'twitch' ] ) out.personality[ k ] = r3( ( A.personality[ k ] + Bg.personality[ k ] ) / 2 );
	out.personality.idle = r.chance( 0.5 ) ? A.personality.idle : Bg.personality.idle;
	return validateGenome( out );

}

// --- metrics -----------------------------------------------------------------------------

const metricsCache = new WeakMap();

// What the simulation needs to know about a body: collision, reach, speed, styles.
// Measured from the built rig (rest pose), scaled by g.size. Results (and built rigs)
// are cached per genome OBJECT: treat genomes as immutable values - mutate / cross
// return new ones.
export function genomeMetrics( g ) {

	if ( g && typeof g === 'object' && metricsCache.has( g ) ) return metricsCache.get( g );
	const T = buildBody( g );
	const v = T.meta.genome;
	const planDef = get( 'bodyPlan', v.plan );
	const s = v.size, d = T.dims, b = v.body;
	const armReach = T.meta.armReach || 0;
	const styles = new Set( planDef.styles );
	for ( const slot of SLOTS ) {

		const list = slot === 'extra' ? v.parts.extra : v.parts[ slot ] ? [ v.parts[ slot ] ] : [];
		for ( const p of list ) for ( const st of get( 'bodyPart', p.id )?.styles || [] ) styles.add( st );

	}

	if ( ( b.legLen ?? 0 ) > 1.15 && T.legs.length ) styles.add( 'leap' );
	if ( ( b.headSize ?? 1 ) > 1.2 || s >= 2 ) styles.add( 'roar' );
	if ( s >= 2 && T.legs.length ) styles.add( 'stomp' );
	const flying = !! v.gait.fly;
	const m = {
		radius: + ( Math.max( 0.28, 0.5 * Math.max( d.width * 0.72, d.length * 0.62 ) ) * s ).toFixed( 3 ),
		height: + ( d.height * s ).toFixed( 3 ),
		mass: + ( Math.max( 0.35, Math.min( 4, d.volume / 0.07 ) ) * ( planDef.density ?? 1 ) * Math.pow( s, 2.5 ) ).toFixed( 3 ),
		reach: + ( ( Math.max( d.front * 0.85, armReach ) + 0.4 ) * s ).toFixed( 3 ),
		speedMul: + ( Math.max( 0.45, Math.min( 1.7, ( planDef.speed ?? 1 ) * ( 0.78 + 0.22 * ( b.legLen ?? 1 ) ) * ( 0.9 + 0.1 * v.gait.stride ) ) ) / Math.sqrt( s ) ).toFixed( 3 ),
		flying,
		attackStyles: [ ...styles ],
		hover: + ( ( T.meta.hover || 0 ) * s ).toFixed( 3 ),
		legs: T.legs.length, parts: T.np, bones: T.nb
	};
	if ( g && typeof g === 'object' ) metricsCache.set( g, m );
	return m;

}

// Give an entity a genome's body: model + collision radius, height, mass, flight.
// Monster spawners call this so the sim and the renderer agree on the body.
export function applyGenome( e, genome, extra = {} ) {

	const m = genomeMetrics( genome );
	e.model = { type: 'creature', genome, ...extra };
	e.radius = m.radius;
	e.height = m.height;
	e.mass = m.mass;
	e.data.flying = m.flying;
	e.data.reach = m.reach;
	return m;

}

// Short human label: "ember snout quadruped (ram, whip)" - contact sheets and inspectors.
export function describeGenome( g ) {

	const v = validateGenome( g );
	const p = v.parts;
	const bits = [ p.horns?.id, p.tail?.id, p.wings?.id, p.back?.id, ...( p.extra || [] ).map( ( e ) => e.id ) ].filter( Boolean );
	return `${v.palette.id.split( /[-~x]/ )[ 0 ]} ${p.head?.id ?? p.torso?.id ?? ''} ${v.plan}${bits.length ? ' (' + bits.join( ', ' ) + ')' : ''}`;

}
