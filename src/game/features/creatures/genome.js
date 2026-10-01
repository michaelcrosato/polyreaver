// Creature genome - Spore-style monster DNA (sim-safe: plain data, no three.js).
// STUB API: the creatures feature replaces the internals; the function signatures
// and the metrics shape are the contract other features build on (docs/GAME.md §5).

import { RNG } from '../../core/rng.js';

export const BODY_PLANS = [ 'biped', 'quadruped', 'hexapod', 'serpent', 'floater', 'blob', 'arachnid', 'avian' ];

const PALETTES = [
	{ primary: '#8a3b2e', secondary: '#3b2a24', accent: '#f2a541', skin: '#c97b5a', metal: '#7d7f86', glow: '#ff6a2b', dark: '#1c1512' },
	{ primary: '#2e6b8a', secondary: '#1f3240', accent: '#9fe3ff', skin: '#6aa3b8', metal: '#a8b3bd', glow: '#5ad1ff', dark: '#0f1820' },
	{ primary: '#4f7a2e', secondary: '#2c3b1f', accent: '#d6f25a', skin: '#8bb35a', metal: '#6f7468', glow: '#9cff3a', dark: '#141a0f' },
	{ primary: '#6b2e8a', secondary: '#2f1f40', accent: '#ff7ae0', skin: '#a36ab8', metal: '#9a8fb3', glow: '#d65aff', dark: '#170f20' }
];

export function generateGenome( rng = new RNG( 1 ), { plan = null, size = 1, tags = [], palette = null, level = 1 } = {} ) {

	const r = rng instanceof RNG ? rng : new RNG( rng );
	return {
		seed: r.int( 1, 2 ** 31 - 1 ),
		plan: plan || r.pick( BODY_PLANS ),
		size,
		palette: palette || r.pick( PALETTES ),
		tags: [ ...tags ],
		level
	};

}

export function mutateGenome( g, rng, amount = 0.2 ) {

	const r = rng instanceof RNG ? rng : new RNG( rng );
	return { ...g, seed: r.int( 1, 2 ** 31 - 1 ), size: Math.max( 0.4, g.size * ( 1 + r.range( - amount, amount ) ) ) };

}

export function crossGenomes( a, b, rng ) {

	const r = rng instanceof RNG ? rng : new RNG( rng );
	return { ...a, plan: r.chance( 0.5 ) ? a.plan : b.plan, palette: r.chance( 0.5 ) ? a.palette : b.palette, size: ( a.size + b.size ) / 2, seed: r.int( 1, 2 ** 31 - 1 ) };

}

// What the simulation needs to know about a body: collision, reach, speed, styles.
export function genomeMetrics( g ) {

	const s = g.size ?? 1;
	const flying = g.plan === 'floater' || g.plan === 'avian';
	const long = g.plan === 'serpent' || g.plan === 'quadruped' || g.plan === 'hexapod' || g.plan === 'arachnid';
	return {
		radius: ( long ? 0.55 : 0.45 ) * s,
		height: ( g.plan === 'blob' ? 1.1 : g.plan === 'serpent' ? 0.9 : 1.7 ) * s,
		mass: Math.pow( s, 2.2 ) * ( g.plan === 'blob' ? 1.4 : 1 ),
		reach: ( 1.1 + ( long ? 0.4 : 0 ) ) * s,
		speedMul: ( g.plan === 'quadruped' || g.plan === 'arachnid' ? 1.25 : g.plan === 'blob' ? 0.7 : 1 ) / Math.sqrt( s ),
		flying,
		attackStyles: g.plan === 'biped' ? [ 'claw', 'slam' ] : g.plan === 'serpent' ? [ 'bite', 'spit' ] : g.plan === 'floater' ? [ 'cast', 'spit' ] : [ 'bite', 'charge' ]
	};

}
