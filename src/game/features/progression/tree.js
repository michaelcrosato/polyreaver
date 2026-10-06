// The passive tree: ~1200 nodes generated DETERMINISTICALLY from a fixed seed and
// the cluster templates in data/clusters.js, so every player (and every save file)
// sees the same tree. Node ids are stable as long as the generator and templates
// do not change; if they do, saves are repaired by validateTree() (unknown nodes
// are refunded, disconnected ones dropped).
//
// LAYOUT (canvas coordinates, y down, origin = centre)
//
//                 Sorcery (INT, 90 deg)
//        ms (STR/INT)            fs (DEX/INT)
//                     [hub ring]
//        Might (STR)              Finesse (DEX)
//                 mf (STR/DEX, 270 deg)
//
//   hub ring r=170 (cross-region travel) - start nodes r=430 - six rings of cluster
//   slots (r=760 ... 2560) - keystones on the rim (r~2950). Clusters link inward to the
//   nearest node of the ring below and sideways to their neighbours, so there are
//   always several routes to anything; attribute "travel" nodes fill the links.
//
// ALLOCATION: a node can be taken when it touches an allocated node; the start node
// of the chosen region is free. Points: 1 per level after the first plus 1 every
// 5 levels. Refunds keep the tree connected (checked with a flood fill); a full
// respec costs gold at the Mystic.

import { define, all, get } from '../../core/registry.js';
import { RNG, hashStr } from '../../core/rng.js';
import { M } from './data/clusters.js';
import './data/keystones.js';
import { ASCENDANCY_LEVEL, ASCENDANCY_MILESTONES } from './data/ascendancy.js';

export const TREE_SEED = 'polyreaver-passive-tree-v1';

export const SECTORS = [
	{ id: 'sorcery', name: 'Sorcery', angle: 90, attrs: [ 'intelligence' ], color: '#5a8ae0' },
	{ id: 'fs', name: 'Finesse-Sorcery', angle: 30, attrs: [ 'dexterity', 'intelligence' ], color: '#40b8b8' },
	{ id: 'finesse', name: 'Finesse', angle: 330, attrs: [ 'dexterity' ], color: '#5fbf6a' },
	{ id: 'mf', name: 'Might-Finesse', angle: 270, attrs: [ 'strength', 'dexterity' ], color: '#c8a040' },
	{ id: 'might', name: 'Might', angle: 210, attrs: [ 'strength' ], color: '#d0584a' },
	{ id: 'ms', name: 'Might-Sorcery', angle: 150, attrs: [ 'strength', 'intelligence' ], color: '#b060c0' }
];
export const START_REGIONS = [ 'might', 'finesse', 'sorcery' ];
export const START_INFO = {
	might: { name: 'Might', attr: 'strength', desc: 'Strength: life, armour, melee and two-handed weapons, fire.' },
	finesse: { name: 'Finesse', attr: 'dexterity', desc: 'Dexterity: evasion, speed, critical strikes, projectiles, cold and poison.' },
	sorcery: { name: 'Sorcery', attr: 'intelligence', desc: 'Intelligence: energy shield, mana, spells, lightning, chaos and minions.' }
};

const RINGS = [ { r: 760, n: 2 }, { r: 1120, n: 3 }, { r: 1480, n: 3 }, { r: 1840, n: 4 }, { r: 2200, n: 4 }, { r: 2560, n: 5 } ];
const ATTR_NAME = { strength: 'Strength', dexterity: 'Dexterity', intelligence: 'Intelligence' };
const D2R = Math.PI / 180;

export function sectorAt( x, y ) {

	const a = ( Math.atan2( - y, x ) / D2R + 360 ) % 360;
	let best = SECTORS[ 0 ], bd = 999;
	for ( const s of SECTORS ) {

		const d = Math.abs( ( ( a - s.angle + 540 ) % 360 ) - 180 );
		if ( d < bd ) {

			bd = d;
			best = s;

		}

	}

	return best;

}

// --- cluster shapes: local layouts (x = tangential, y = outward) --------------------------------
// Each returns { pts: [ { kind, x, y } ], links: [ [ i, j ] ], entry }.

const SHAPES = {
	wheel( n, k ) {

		const pts = [], links = [];
		const R = 105;
		for ( let i = 0; i < n; i ++ ) {

			const t = Math.PI + i / n * Math.PI * 2;
			pts.push( { kind: 'small', x: Math.sin( t ) * R, y: Math.cos( t ) * R } );
			if ( i > 0 ) links.push( [ i - 1, i ] );

		}

		links.push( [ n - 1, 0 ] );
		const far = Math.floor( n / 2 );
		pts.push( { kind: 'notable', x: 0, y: 0 } );
		links.push( [ far, n ] );
		if ( k > 1 ) {

			pts.push( { kind: 'notable', x: 0, y: R + 85 } );
			links.push( [ far, n + 1 ] );

		}

		return { pts, links, entry: 0 };

	},
	chain( n, k ) {

		const pts = [], links = [];
		for ( let i = 0; i < n; i ++ ) {

			pts.push( { kind: 'small', x: ( i % 2 ? 22 : - 22 ), y: - 130 + i * 78 } );
			if ( i > 0 ) links.push( [ i - 1, i ] );

		}

		pts.push( { kind: 'notable', x: 0, y: - 130 + n * 78 + 10 } );
		links.push( [ n - 1, n ] );
		if ( k > 1 ) {

			const mid = Math.floor( n / 2 );
			pts.push( { kind: 'notable', x: 110, y: pts[ mid ].y + 20 } );
			links.push( [ mid, n + 1 ] );

		}

		return { pts, links, entry: 0 };

	},
	fork( n, k ) {

		const pts = [ { kind: 'small', x: 0, y: - 130 } ], links = [];
		const per = Math.max( 1, Math.floor( ( n - 1 ) / 2 ) );
		for ( const side of [ - 1, 1 ] ) {

			let prev = 0;
			for ( let i = 1; i <= per; i ++ ) {

				pts.push( { kind: 'small', x: side * i * 62, y: - 130 + i * 70 } );
				links.push( [ prev, pts.length - 1 ] );
				prev = pts.length - 1;

			}

			if ( k > 1 || side === 1 ) {

				pts.push( { kind: 'notable', x: side * ( per + 1 ) * 62, y: - 130 + ( per + 1 ) * 70 + 10 } );
				links.push( [ prev, pts.length - 1 ] );

			}

		}

		return { pts, links, entry: 0 };

	},
	ring( n, k ) {

		const pts = [], links = [];
		const R = 115;
		for ( let i = 0; i < n; i ++ ) {

			const t = Math.PI + i / n * Math.PI * 2;
			pts.push( { kind: 'small', x: Math.sin( t ) * R, y: Math.cos( t ) * R } );
			if ( i > 0 ) links.push( [ i - 1, i ] );

		}

		links.push( [ n - 1, 0 ] );
		const a = Math.round( n / 3 ), b = Math.round( n * 2 / 3 );
		for ( const [ j, idx ] of [ [ 0, a ], [ 1, b ] ] ) {

			if ( j >= k ) break;
			const p = pts[ idx ], l = Math.hypot( p.x, p.y ) || 1;
			pts.push( { kind: 'notable', x: p.x / l * ( R + 85 ), y: p.y / l * ( R + 85 ) } );
			links.push( [ idx, pts.length - 1 ] );

		}

		return { pts, links, entry: 0 };

	},
	star( n, k ) {

		const pts = [ { kind: 'small', x: 0, y: - 70 } ], links = [];
		const per = Math.max( 1, Math.floor( ( n - 1 ) / 3 ) );
		[ - 55, 0, 55 ].forEach( ( deg, s ) => {

			let prev = 0;
			const dx = Math.sin( deg * D2R ), dy = Math.cos( deg * D2R );
			for ( let i = 1; i <= per; i ++ ) {

				pts.push( { kind: 'small', x: dx * i * 80, y: - 70 + dy * i * 80 } );
				links.push( [ prev, pts.length - 1 ] );
				prev = pts.length - 1;

			}

			if ( s < k ) {

				pts.push( { kind: 'notable', x: dx * ( per + 1 ) * 80, y: - 70 + dy * ( per + 1 ) * 80 + 6 } );
				links.push( [ prev, pts.length - 1 ] );

			}

		} );
		return { pts, links, entry: 0 };

	}
};

// --- generation --------------------------------------------------------------------------------------

let TREE = null;

export function getTree() {

	if ( ! TREE ) TREE = generateTree();
	return TREE;

}

function generateTree() {

	const rng = new RNG( TREE_SEED );
	const nodes = new Map();
	const edges = [];
	let travelSeq = 0;
	const add = ( n ) => {

		n.links = [];
		nodes.set( n.id, n );
		return n;

	};

	const link = ( a, b ) => {

		if ( a === b || a.links.includes( b.id ) ) return;
		a.links.push( b.id );
		b.links.push( a.id );
		edges.push( [ a.id, b.id ] );

	};

	const travelMods = ( x, y, i ) => {

		const s = sectorAt( x, y );
		const attr = s.attrs[ i % s.attrs.length ];
		return { name: ATTR_NAME[ attr ], mods: [ M( attr, 'flat', 10 ) ], sector: s.id, theme: 'attribute' };

	};

	// a path of attribute nodes between two nodes (none when they are close)
	const path = ( a, b, spacing = 100 ) => {

		const d = Math.hypot( b.x - a.x, b.y - a.y );
		const k = Math.max( 0, Math.round( d / spacing ) - 1 );
		let prev = a;
		for ( let i = 1; i <= k; i ++ ) {

			const t = i / ( k + 1 );
			const x = a.x + ( b.x - a.x ) * t, y = a.y + ( b.y - a.y ) * t;
			const tm = travelMods( x, y, travelSeq );
			const n = add( { id: `t${travelSeq ++}`, type: 'travel', x, y, ...tm } );
			link( prev, n );
			prev = n;

		}

		link( prev, b );

	};

	// 1. hub ring and starts
	const hub = SECTORS.map( ( s, i ) => add( { id: `h${i}`, type: 'travel', name: 'Nexus', theme: 'attribute', sector: s.id,
		x: Math.cos( s.angle * D2R ) * 170, y: - Math.sin( s.angle * D2R ) * 170, mods: [ M( 'strength', 'flat', 4 ), M( 'dexterity', 'flat', 4 ), M( 'intelligence', 'flat', 4 ) ] } ) );
	hub.forEach( ( h, i ) => link( h, hub[ ( i + 1 ) % hub.length ] ) );
	const starts = {};
	for ( const s of SECTORS ) {

		if ( ! START_INFO[ s.id ] ) continue;
		const info = START_INFO[ s.id ];
		const n = add( { id: `s.${s.id}`, type: 'start', start: s.id, name: info.name, theme: 'start', sector: s.id,
			x: Math.cos( s.angle * D2R ) * 430, y: - Math.sin( s.angle * D2R ) * 430,
			mods: [ M( info.attr, 'flat', 20 ) ] } );
		starts[ s.id ] = n;
		path( hub[ SECTORS.indexOf( s ) ], n );

	}

	// 2. clusters
	const templates = all( 'treeCluster' );
	const uses = new Map(), usedNotables = new Map();
	const clusters = [];
	RINGS.forEach( ( ring, ri ) => {

		for ( const s of SECTORS ) {

			for ( let j = 0; j < ring.n; j ++ ) {

				const spread = 60 / ring.n;
				const ang = s.angle + ( j - ( ring.n - 1 ) / 2 ) * spread + rng.range( - spread * 0.12, spread * 0.12 );
				const r = ring.r + rng.range( - 40, 40 );
				const t = rng.weighted( templates.filter( ( c ) => ( c.regions[ s.id ] ?? 0 ) > 0 && ri >= c.rings[ 0 ] && ri <= c.rings[ 1 ] ),
					( c ) => c.regions[ s.id ] * ( c.weight ?? 1 ) * Math.pow( 0.32, uses.get( c.id ) ?? 0 ) );
				uses.set( t.id, ( uses.get( t.id ) ?? 0 ) + 1 );
				clusters.push( buildCluster( t, clusters.length, ri, ang, r, s ) );

			}

		}

	} );

	function buildCluster( t, ci, ri, ang, r, sector ) {

		const smalls = ri === 0 ? rng.int( 4, 5 ) : ri < 3 ? rng.int( 5, 6 ) : rng.int( 6, 8 );
		const shape = rng.pick( t.shapes );
		const k = shape === 'fork' ? 2 : shape === 'star' ? ( ri >= 4 ? 3 : 2 ) : ri === 0 ? 1 : ri >= 4 ? 2 : rng.int( 1, 2 );
		const L = SHAPES[ shape ]( smalls, k );
		const cx = Math.cos( ang * D2R ) * r, cy = - Math.sin( ang * D2R ) * r;
		const ox = Math.cos( ang * D2R ), oy = - Math.sin( ang * D2R ); // outward
		const tx = - oy, ty = ox; // tangential
		const list = L.pts.map( ( p, i ) => {

			const base = { id: `c${ci}.${i}`, x: cx + tx * p.x + ox * p.y, y: cy + ty * p.x + oy * p.y, cluster: ci, clusterName: t.name, theme: t.theme, sector: sector.id, ring: ri, template: t.id };
			if ( p.kind === 'small' ) return add( { ...base, type: 'small', name: t.small.name, mods: t.small.mods.map( ( m ) => ( { ...m } ) ) } );
			const nb = pickNotable( t );
			return add( { ...base, type: 'notable', name: nb.name, mods: nb.mods.map( ( m ) => ( { ...m } ) ) } );

		} );
		for ( const [ a, b ] of L.links ) link( list[ a ], list[ b ] );
		return { id: ci, ring: ri, angle: ang, sector: sector.id, nodes: list, entry: list[ L.entry ], template: t.id };

	}

	// Each notable name appears once; when a template runs out, the reused notable
	// becomes a stronger numbered variant ("Thick Skin II": +20% values per step).
	function pickNotable( t ) {

		const fresh = t.notables.filter( ( n ) => ! usedNotables.has( n.name ) );
		const nb = fresh.length ? rng.pick( fresh ) : t.notables.reduce( ( a, b ) => ( usedNotables.get( a.name ) <= usedNotables.get( b.name ) ? a : b ) );
		const n = ( usedNotables.get( nb.name ) ?? 0 ) + 1;
		usedNotables.set( nb.name, n );
		if ( n === 1 ) return nb;
		const k = 1 + 0.2 * ( n - 1 );
		return { name: `${nb.name} ${[ '', 'I', 'II', 'III', 'IV', 'V' ][ n ] || n}`, mods: nb.mods.map( ( m ) => ( { ...m, value: m.type === 'override' ? m.value : Math.round( m.value * k * 10 ) / 10 } ) ) };

	}

	separateClusters( clusters );

	const linkable = ( n ) => n.type === 'small' || n.type === 'travel';
	const nearestPair = ( A, B ) => {

		let best = null, bd = Infinity;
		for ( const a of A ) for ( const b of B ) {

			if ( ! linkable( b ) ) continue;
			const d = Math.hypot( a.x - b.x, a.y - b.y );
			if ( d < bd ) {

				bd = d;
				best = [ a, b ];

			}

		}

		return best;

	};

	// 3. inward links (every cluster reaches the starts), plus extra routes
	for ( const c of clusters ) {

		if ( c.ring === 0 ) {

			const pure = starts[ c.sector ];
			const cand = pure ? [ pure ] : Object.values( starts ).sort( ( a, b ) => Math.hypot( a.x - c.entry.x, a.y - c.entry.y ) - Math.hypot( b.x - c.entry.x, b.y - c.entry.y ) ).slice( 0, rng.chance( 0.5 ) ? 2 : 1 );
			for ( const s of cand ) path( s, c.entry );
			continue;

		}

		const inner = clusters.filter( ( o ) => o.ring === c.ring - 1 ).map( ( o ) => ( { o, d: Math.min( ...o.nodes.map( ( n ) => Math.hypot( n.x - c.entry.x, n.y - c.entry.y ) ) ) } ) ).sort( ( a, b ) => a.d - b.d );
		const p0 = nearestPair( [ c.entry ], inner[ 0 ].o.nodes );
		path( p0[ 1 ], p0[ 0 ] );
		if ( inner[ 1 ] && rng.chance( 0.3 ) ) {

			const p1 = nearestPair( c.nodes.filter( linkable ), inner[ 1 ].o.nodes );
			if ( p1 ) path( p1[ 1 ], p1[ 0 ] );

		}

	}

	// 4. lateral links between neighbours on the same ring
	RINGS.forEach( ( ring, ri ) => {

		const row = clusters.filter( ( c ) => c.ring === ri ).sort( ( a, b ) => ( ( a.angle % 360 ) + 360 ) % 360 - ( ( ( b.angle % 360 ) + 360 ) % 360 ) );
		for ( let i = 0; i < row.length; i ++ ) {

			const a = row[ i ], b = row[ ( i + 1 ) % row.length ];
			if ( ! rng.chance( ri === RINGS.length - 1 ? 0.7 : 0.5 ) ) continue;
			const p = nearestPair( a.nodes.filter( linkable ), b.nodes );
			if ( p ) path( p[ 0 ], p[ 1 ] );

		}

	} );

	// 5. keystones on the rim of their region
	const outer = clusters.filter( ( c ) => c.ring >= RINGS.length - 2 );
	for ( const s of SECTORS ) {

		const ks = all( 'keystone' ).filter( ( k ) => k.region === s.id );
		ks.forEach( ( kd, i ) => {

			// spread along the rim, alternating two radii so neighbours do not crowd
			const ang = s.angle + ( i - ( ks.length - 1 ) / 2 ) * ( 54 / Math.max( 1, ks.length ) );
			const r = 2960 + ( i % 2 ) * 220;
			const kn = add( { id: `k.${kd.id}`, type: 'keystone', keystone: kd.id, name: kd.name, theme: 'keystone', sector: s.id,
				x: Math.cos( ang * D2R ) * r, y: - Math.sin( ang * D2R ) * r, mods: ( kd.mods || [] ).map( ( m ) => ( { ...m } ) ), lines: kd.lines } );
			const p = nearestPair( [ kn ], outer.flatMap( ( c ) => c.nodes ) );
			path( p[ 1 ], kn, 110 );

		} );

	}

	relax( nodes );

	// register every node for registry queries ( query( 'treeNode', { tags: [ 'fire' ] } ) )
	for ( const n of nodes.values() ) define( 'treeNode', { ...n, tags: [ n.type, n.theme, n.sector ].filter( Boolean ) } );

	let minX = 0, minY = 0, maxX = 0, maxY = 0;
	for ( const n of nodes.values() ) {

		minX = Math.min( minX, n.x ); maxX = Math.max( maxX, n.x );
		minY = Math.min( minY, n.y ); maxY = Math.max( maxY, n.y );

	}

	const sig = [ ...nodes.values() ].map( ( n ) => n.id + n.type + n.links.length + ( n.mods || [] ).map( ( m ) => m.stat + m.value ).join() ).join( '|' );
	const tree = { nodes, edges, starts, clusters: clusters.map( ( c ) => ( { id: c.id, ring: c.ring, sector: c.sector, template: c.template, nodes: c.nodes.map( ( n ) => n.id ) } ) ), bounds: { minX, minY, maxX, maxY }, version: hashStr( sig ).toString( 36 ) };
	tree.asc = buildAscendancies();
	return tree;

}

// Travel paths are straight lines, so they can cross clusters. A few relaxation
// passes push travel nodes away from any node closer than MIN_GAP and pull them
// back toward the midpoint of their two neighbours (keeps paths smooth).
const MIN_GAP = 62;

function relax( nodes ) {

	const list = [ ...nodes.values() ];
	const cell = 80;
	for ( let iter = 0; iter < 24; iter ++ ) {

		const grid = new Map();
		for ( const n of list ) {

			const k = Math.floor( n.x / cell ) + ',' + Math.floor( n.y / cell );
			if ( ! grid.has( k ) ) grid.set( k, [] );
			grid.get( k ).push( n );

		}

		for ( const n of list ) {

			if ( n.type !== 'travel' || n.id.startsWith( 'h' ) ) continue;
			let fx = 0, fy = 0;
			const cx = Math.floor( n.x / cell ), cy = Math.floor( n.y / cell );
			for ( let gy = cy - 1; gy <= cy + 1; gy ++ ) for ( let gx = cx - 1; gx <= cx + 1; gx ++ ) {

				for ( const o of grid.get( gx + ',' + gy ) || [] ) {

					if ( o === n ) continue;
					const dx = n.x - o.x, dy = n.y - o.y, d = Math.hypot( dx, dy ) || 0.01;
					if ( d < MIN_GAP ) {

						fx += dx / d * ( MIN_GAP - d ) * 0.5;
						fy += dy / d * ( MIN_GAP - d ) * 0.5;

					}

				}

			}

			if ( n.links.length === 2 ) {

				const a = nodes.get( n.links[ 0 ] ), b = nodes.get( n.links[ 1 ] );
				fx += ( ( a.x + b.x ) / 2 - n.x ) * 0.15;
				fy += ( ( a.y + b.y ) / 2 - n.y ) * 0.15;

			}

			n.x += fx; n.y += fy;

		}

	}

}

// Neighbouring clusters can overlap where a big outer shape meets the next ring;
// treat each cluster as a rigid body and push overlapping pairs apart.
function separateClusters( clusters ) {

	for ( let iter = 0; iter < 12; iter ++ ) {

		let moved = false;
		for ( let i = 0; i < clusters.length; i ++ ) for ( let j = i + 1; j < clusters.length; j ++ ) {

			const A = clusters[ i ].nodes, B = clusters[ j ].nodes;
			if ( Math.hypot( A[ 0 ].x - B[ 0 ].x, A[ 0 ].y - B[ 0 ].y ) > 700 ) continue;
			let md = Infinity, dx = 0, dy = 0;
			for ( const a of A ) for ( const b of B ) {

				const d = Math.hypot( a.x - b.x, a.y - b.y );
				if ( d < md ) {

					md = d;
					dx = a.x - b.x; dy = a.y - b.y;

				}

			}

			if ( md >= MIN_GAP + 10 ) continue;
			const l = Math.hypot( dx, dy ) || 1, push = ( MIN_GAP + 12 - md ) / 2;
			for ( const a of A ) {

				a.x += dx / l * push; a.y += dy / l * push;

			}

			for ( const b of B ) {

				b.x -= dx / l * push; b.y -= dy / l * push;

			}

			moved = true;

		}

		if ( ! moved ) break;

	}

}

// Ascendancy trees: six branches (minor -> notable) around a root.
function buildAscendancies() {

	const out = {};
	for ( const a of all( 'ascendancy' ) ) {

		const nodes = new Map();
		for ( const n of a.nodes ) {

			const ang = ( - 90 + n.branch * 60 ) * D2R;
			const r = n.type === 'start' ? 0 : n.type === 'small' ? 105 : 205;
			nodes.set( n.id, { ...n, asc: a.id, x: Math.cos( ang ) * r, y: Math.sin( ang ) * r, links: [] } );

		}

		for ( const n of nodes.values() ) {

			if ( n.type === 'small' ) {

				n.links.push( `${a.id}:root`, `${a.id}:n${n.branch}` );
				nodes.get( `${a.id}:root` ).links.push( n.id );
				nodes.get( `${a.id}:n${n.branch}` ).links.push( n.id );

			}

		}

		out[ a.id ] = { def: a, nodes };

	}

	return out;

}

// --- save state ----------------------------------------------------------------------------------------

export function newTreeSave() {

	return { start: 'might', allocated: [ 's.might' ], respecs: 0, version: null, asc: { id: null, allocated: [] }, bonus: 0 };

}

export function treeState( save ) {

	if ( ! save.tree ) save.tree = newTreeSave();
	const t = save.tree;
	t.allocated ||= [ `s.${t.start || 'might'}` ];
	t.asc ||= { id: null, allocated: [] };
	return t;

}

export function pointsTotal( level, bonus = 0 ) {

	return Math.max( 0, level - 1 ) + Math.floor( level / 5 ) + bonus;

}

export function pointsLeft( save ) {

	const t = treeState( save );
	return pointsTotal( save.level, t.bonus ?? 0 ) - ( t.allocated.length - 1 );

}

export function ascPointsTotal( level ) {

	return ASCENDANCY_MILESTONES.filter( ( l ) => level >= l ).length * 2;

}

export function ascPointsLeft( save ) {

	const t = treeState( save );
	// the root node is free, like the main tree's start node
	return t.asc.id ? ascPointsTotal( save.level ) - ( t.asc.allocated.length - 1 ) : 0;

}

// Inspect loaded saves even when their version matches: malformed content can
// claim the current version. Keep connected nodes within the character's budget;
// removed allocations automatically become unspent points again.
export function validateTree( save ) {

	const T = getTree(), t = treeState( save );
	const before = t.allocated.length;
	const root = `s.${t.start}`;
	const set = new Set( t.allocated.filter( ( id ) => T.nodes.has( id ) ) );
	set.add( root );
	const keep = new Set( [ ...reachable( T, set, root ) ].slice( 0, pointsTotal( save.level, t.bonus ?? 0 ) + 1 ) );
	t.allocated = [ ...new Set( t.allocated.filter( ( id ) => keep.has( id ) ) ) ];
	if ( ! t.allocated.includes( root ) ) t.allocated.unshift( root );
	t.version = T.version;
	const A = Object.hasOwn( T.asc, t.asc.id ) ? T.asc[ t.asc.id ] : null;
	if ( ! A || save.level < ASCENDANCY_LEVEL ) t.asc = { id: null, allocated: [] };
	else {

		const ascRoot = `${t.asc.id}:root`, ascSet = new Set( t.asc.allocated.filter( ( id ) => A.nodes.has( id ) ) );
		ascSet.add( ascRoot );
		const ascKeep = new Set( [ ...reachable( A, ascSet, ascRoot ) ].slice( 0, ascPointsTotal( save.level ) + 1 ) );
		t.asc.allocated = [ ...new Set( t.asc.allocated.filter( ( id ) => ascKeep.has( id ) ) ) ];
		if ( ! t.asc.allocated.includes( ascRoot ) ) t.asc.allocated.unshift( ascRoot );

	}
	return before - t.allocated.length;

}

// Portable imports must identify real content before any migration mutates it.
// Older tree versions may migrate, but invented ids never become valid imports.
export function validateTreeSave( save ) {

	const T = getTree(), t = save.tree;
	if ( ! t || typeof t !== 'object' || Array.isArray( t ) || typeof t.start !== 'string' || ! Object.hasOwn( START_INFO, t.start ) ) throw new Error( 'Unknown passive starting region.' );
	if ( ! Number.isSafeInteger( t.bonus ) || t.bonus < 0 || t.bonus > 10000 ) throw new Error( 'Invalid bonus passive points.' );
	const valid = ( nodes, ids, root ) => Array.isArray( ids ) && ids.every( ( id ) => typeof id === 'string' && nodes.has( id ) ) &&
		new Set( ids ).size === ids.length && ids.includes( root ) && reachable( { nodes }, new Set( ids ), root ).size === ids.length;
	if ( ! valid( T.nodes, t.allocated, `s.${t.start}` ) ) throw new Error( 'Passive nodes must be known, unique and connected to the start.' );
	if ( t.allocated.length - 1 > pointsTotal( save.level, t.bonus ) ) throw new Error( 'Character has more passive allocations than available points.' );
	const a = t.asc;
	if ( ! a || typeof a !== 'object' || Array.isArray( a ) || ! Array.isArray( a.allocated ) ) throw new Error( 'Invalid ascendancy data.' );
	if ( a.id === null ) {

		if ( a.allocated.length ) throw new Error( 'Ascendancy nodes require an ascendancy.' );

	} else {

		if ( typeof a.id !== 'string' || ! Object.hasOwn( T.asc, a.id ) ) throw new Error( 'Unknown ascendancy.' );
		if ( save.level < ASCENDANCY_LEVEL ) throw new Error( `Ascendancy requires level ${ASCENDANCY_LEVEL}.` );
		// Full respecs leave an empty branch until the next loaded-save repair.
		if ( a.allocated.length && ! valid( T.asc[ a.id ].nodes, a.allocated, `${a.id}:root` ) ) throw new Error( 'Ascendancy nodes must be known, unique and connected to their ascendancy.' );
		if ( a.allocated.length - 1 > ascPointsTotal( save.level ) ) throw new Error( 'Character has more ascendancy allocations than available points.' );

	}

}

function reachable( T, set, root ) {

	const seen = new Set( [ root ] ), stack = [ root ];
	while ( stack.length ) {

		const id = stack.pop();
		for ( const nb of T.nodes.get( id )?.links || [] ) if ( set.has( nb ) && ! seen.has( nb ) ) {

			seen.add( nb );
			stack.push( nb );

		}

	}

	return seen;

}

export function isAllocated( save, id ) {

	return treeState( save ).allocated.includes( id );

}

// Why `id` cannot be allocated right now (null = it can).
export function canAllocate( save, id ) {

	const T = getTree(), t = treeState( save );
	const n = T.nodes.get( id );
	if ( ! n ) return 'Unknown node';
	if ( t.allocated.includes( id ) ) return 'Already allocated';
	if ( pointsLeft( save ) <= 0 ) return 'No passive points left';
	if ( ! n.links.some( ( l ) => t.allocated.includes( l ) ) ) return 'Not connected to your tree';
	return null;

}

export function allocate( save, id ) {

	const why = canAllocate( save, id );
	if ( why ) return { ok: false, reason: why };
	treeState( save ).allocated.push( id );
	return { ok: true };

}

// Shortest chain of unallocated nodes that connects `id` to the tree (breadth-first
// search outward from every allocated node). [] when already allocated, null when unreachable.
export function pathTo( save, id ) {

	const T = getTree(), t = treeState( save );
	if ( ! T.nodes.has( id ) ) return null;
	const alloc = new Set( t.allocated );
	if ( alloc.has( id ) ) return [];
	const prev = new Map();
	const queue = [];
	for ( const a of alloc ) for ( const nb of T.nodes.get( a )?.links || [] ) if ( ! alloc.has( nb ) && ! prev.has( nb ) ) {

		prev.set( nb, null );
		queue.push( nb );

	}

	for ( let qi = 0; qi < queue.length; qi ++ ) {

		const cur = queue[ qi ];
		if ( cur === id ) break;
		for ( const nb of T.nodes.get( cur ).links ) if ( ! alloc.has( nb ) && ! prev.has( nb ) ) {

			prev.set( nb, cur );
			queue.push( nb );

		}

	}

	if ( ! prev.has( id ) ) return null;
	const out = [];
	for ( let c = id; c !== null; c = prev.get( c ) ) out.unshift( c );
	return out;

}

// Allocate the whole shortest path to `id` if there are enough points.
export function allocatePath( save, id ) {

	const p = pathTo( save, id );
	if ( p === null ) return { ok: false, reason: 'Unreachable', path: [] };
	if ( ! p.length ) return { ok: false, reason: 'Already allocated', path: [] };
	if ( p.length > pointsLeft( save ) ) return { ok: false, reason: `Needs ${p.length} points (${pointsLeft( save )} left)`, path: p, cost: p.length };
	treeState( save ).allocated.push( ...p );
	return { ok: true, path: p, cost: p.length };

}

export function canRefund( save, id ) {

	const T = getTree(), t = treeState( save );
	if ( ! t.allocated.includes( id ) ) return 'Not allocated';
	if ( id === `s.${t.start}` ) return 'The start node cannot be refunded';
	const set = new Set( t.allocated );
	set.delete( id );
	if ( reachable( T, set, `s.${t.start}` ).size !== set.size ) return 'Other passives depend on this one';
	return null;

}

export function refund( save, id ) {

	const why = canRefund( save, id );
	if ( why ) return { ok: false, reason: why };
	const t = treeState( save );
	t.allocated = t.allocated.filter( ( x ) => x !== id );
	return { ok: true };

}

// Gold costs at the Mystic.
export function refundCost( level ) {

	return Math.round( 20 + level * level * 0.6 );

}

export function respecCost( save ) {

	const t = treeState( save );
	return Math.round( ( 50 + Math.pow( save.level, 1.6 ) * 6 ) * ( 1 + ( t.respecs ?? 0 ) * 0.25 ) );

}

// Full reset (optionally moving to another start region).
export function respec( save, start = null ) {

	const t = treeState( save );
	if ( start && START_INFO[ start ] ) t.start = start;
	t.allocated = [ `s.${t.start}` ];
	t.asc.allocated = [];
	t.respecs = ( t.respecs ?? 0 ) + 1;

}

// --- ascendancy ---------------------------------------------------------------------------------------

export function chooseAscendancy( save, id ) {

	const t = treeState( save );
	if ( save.level < ASCENDANCY_LEVEL ) return { ok: false, reason: `Requires level ${ASCENDANCY_LEVEL}` };
	if ( ! getTree().asc[ id ] ) return { ok: false, reason: 'Unknown ascendancy' };
	if ( t.asc.id && t.asc.allocated.length ) return { ok: false, reason: 'Respec first to change ascendancy' };
	t.asc.id = id;
	t.asc.allocated = [ `${id}:root` ];
	return { ok: true };

}

export function ascAllocate( save, nodeId ) {

	const t = treeState( save );
	const A = getTree().asc[ t.asc.id ];
	if ( ! A ) return { ok: false, reason: 'Choose an ascendancy first' };
	const n = A.nodes.get( nodeId );
	if ( ! n ) return { ok: false, reason: 'Unknown node' };
	if ( t.asc.allocated.includes( nodeId ) ) return { ok: false, reason: 'Already allocated' };
	if ( t.asc.allocated.length - 1 >= ascPointsTotal( save.level ) ) return { ok: false, reason: 'No ascendancy points left' };
	if ( ! n.links.some( ( l ) => t.asc.allocated.includes( l ) ) ) return { ok: false, reason: 'Not connected' };
	t.asc.allocated.push( nodeId );
	return { ok: true };

}

// --- what the tree gives -----------------------------------------------------------------------------

// Every allocated node (main tree + ascendancy) as objects.
export function allocatedNodes( save ) {

	const T = getTree(), t = treeState( save );
	const out = [];
	for ( const id of t.allocated ) {

		const n = T.nodes.get( id );
		if ( n ) out.push( n );

	}

	const A = T.asc[ t.asc.id ];
	if ( A ) for ( const id of t.asc.allocated ) {

		const n = A.nodes.get( id );
		if ( n ) out.push( n );

	}

	return out;

}

// Stat mods from the tree, tagged with the node name for breakdowns.
export function treeMods( save ) {

	const out = [];
	for ( const n of allocatedNodes( save ) ) for ( const m of n.mods || [] ) out.push( { ...m, from: n.name } );
	return out;

}

// Hook providers from the tree: keystones and ascendancy notables with hooks / derive / grants.
export function treeProviders( save ) {

	const out = [];
	for ( const n of allocatedNodes( save ) ) {

		if ( n.keystone ) out.push( get( 'keystone', n.keystone ) );
		else if ( n.hooks || n.derive || n.grants ) out.push( n );

	}

	return out.filter( Boolean );

}

// Totals of every allocated stat, merged by stat/type/tags/when (character sheet,
// tree panel summary, agent tools).
export function summarizeMods( mods ) {

	const map = new Map();
	for ( const m of mods ) {

		if ( m.type === 'override' ) continue;
		const key = [ m.stat, m.type, ( m.tags || [] ).join( ',' ), m.when || '' ].join( '|' );
		const e = map.get( key );
		if ( e ) e.value += m.value;
		else map.set( key, { stat: m.stat, type: m.type, value: m.value, tags: m.tags, when: m.when } );

	}

	return [ ...map.values() ].map( ( m ) => ( { ...m, value: Math.round( m.value * 100 ) / 100 } ) );

}

export function treeSummary( save ) {

	const T = getTree(), t = treeState( save );
	const nodes = allocatedNodes( save );
	return {
		version: T.version, nodes: T.nodes.size, start: t.start, allocated: t.allocated.length, pointsLeft: pointsLeft( save ),
		pointsTotal: pointsTotal( save.level, t.bonus ?? 0 ), respecs: t.respecs ?? 0,
		notables: nodes.filter( ( n ) => n.type === 'notable' ).map( ( n ) => n.name ),
		keystones: nodes.filter( ( n ) => n.type === 'keystone' ).map( ( n ) => n.name ),
		ascendancy: t.asc.id ? { id: t.asc.id, allocated: t.asc.allocated.length - 1, pointsLeft: ascPointsLeft( save ) } : null,
		stats: summarizeMods( treeMods( save ) )
	};

}

// Tree-wide counts (for tests, docs and the agent API).
export function treeStats() {

	const T = getTree();
	const by = {};
	for ( const n of T.nodes.values() ) by[ n.type ] = ( by[ n.type ] ?? 0 ) + 1;
	return { nodes: T.nodes.size, edges: T.edges.length, byType: by, clusters: T.clusters.length, version: T.version, ascendancies: Object.keys( T.asc ).length };

}
