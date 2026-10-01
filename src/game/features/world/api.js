// World API - plain functions the tools feature (and any script) can call to make,
// inspect and "see" levels without a browser. All return plain JSON / strings.
//
//   levelSpec( depth )                 the spec of depth N (campaign / combination / endless)
//   generateLevel( specOrDepth, seed ) a Layout (deterministic per spec + seed)
//   levelAscii( layout, opts )         text map with rooms, spawns and mechanic objects marked
//   describeLevel( specOrDepth )       spec + layout stats + ASCII in one object
//   describeMechanic( id ), listMechanics(), listThemes(), campaign( n )
//   describeWorld( world )             live state of every active mechanic + flow
//
// Registered as apiCommands too ( game.api( 'level.ascii', { depth: 7 } ) ) so agents
// reach them through the same door as every other command (docs/GAME.md §10).

import { define, get, all } from '../../core/registry.js';
import { RNG } from '../../core/rng.js';
import { TILE } from '../../core/layout.js';
import { campaignSpec, endlessSpec, campaign } from './levels.js';
import { describeMechanics } from './mechanics/index.js';
import { walkable, bfs } from './gen/grid.js';

export { campaign };

export function levelSpec( depth ) {

	return campaignSpec( depth ) || endlessSpec( depth );

}

export function generateLevel( specOrDepth, seed = null ) {

	const spec = typeof specOrDepth === 'object' ? specOrDepth : levelSpec( specOrDepth );
	const gen = get( 'levelGenerator', spec.generator ) || get( 'levelGenerator', 'dungeon' );
	return gen.generate( null, spec, new RNG( seed ?? spec.seed ?? spec.id ) );

}

// Legend on top of Layout.toAscii(): S start, E exit, B boss room centre, m spawn,
// k keg, b brazier, p pylon, o rift, w well, h hive, v vent, + shrine, x spikes,
// _ magma basin, c chrono field centre.
const MARK = { keg: 'k', brazier: 'b', pylon: 'p', rift: 'o', well: 'w', hive: 'h', vent: 'v', shrine: '+' };

export function levelAscii( L, { spawns = true, mechanics = true, regions = true } = {} ) {

	const marks = [];
	if ( regions ) {

		for ( const r of L.regions ) {

			if ( r.kind === 'chrono' ) marks.push( { x: r.data.x, z: r.data.z, char: 'c' } );
			if ( r.kind !== 'spikes' && r.kind !== 'basin' ) continue;
			for ( const k of r.tiles ) {

				const [ x, z ] = L.toWorld( k % L.w, ( k / L.w ) | 0 );
				marks.push( { x, z, char: r.kind === 'spikes' ? 'x' : '_' } );

			}

		}

	}

	if ( spawns ) for ( const s of L.spawns ) marks.push( { x: s.x, z: s.z, char: s.tags.includes( 'boss' ) ? 'B' : 'm' } );
	if ( mechanics ) for ( const p of L.props ) if ( MARK[ p.type ] ) marks.push( { x: p.x, z: p.z, char: MARK[ p.type ] } );
	return L.toAscii( { marks } );

}

// Spec + layout statistics + the ASCII picture, with a connectivity check.
export function describeLevel( specOrDepth, seed = null ) {

	const spec = typeof specOrDepth === 'object' ? specOrDepth : levelSpec( specOrDepth );
	const L = generateLevel( spec, seed );
	const counts = {};
	for ( const t of L.tiles ) counts[ t ] = ( counts[ t ] || 0 ) + 1;
	const [ sx, sz ] = L.toTile( L.start.x, L.start.z );
	const dist = bfs( L, [ { x: sx, z: sz } ] );
	const unreachable = L.rooms.filter( ( r ) => dist[ L.idx( r.ax, r.az ) ] < 0 ).map( ( r ) => r.id );
	const props = {};
	for ( const p of L.props ) props[ p.type ] = ( props[ p.type ] || 0 ) + 1;
	let floor = 0;
	for ( const t of L.tiles ) if ( walkable( t ) ) floor ++;
	return {
		spec, size: [ L.w, L.h ], cell: L.cell, floorTiles: floor,
		tiles: Object.fromEntries( Object.entries( TILE ).map( ( [ k, v ] ) => [ k.toLowerCase(), counts[ v ] || 0 ] ) ),
		rooms: L.rooms.map( ( r ) => ( { id: r.id, kind: r.kind, template: r.template, depth: r.depth, tiles: r.tiles, tags: r.tags } ) ),
		spawns: L.spawns.length, budget: L.spawns.reduce( ( a, s ) => a + s.budget, 0 ), props, lights: L.lights.length,
		regions: L.regions.map( ( r ) => ( { id: r.id, kind: r.kind, tiles: r.tiles.length } ) ),
		connected: unreachable.length === 0, unreachable, ascii: levelAscii( L )
	};

}

export function describeMechanic( id ) {

	const m = get( 'mechanic', id );
	if ( ! m ) return null;
	return { id: m.id, name: m.name, desc: m.desc, tip: m.tip, tags: m.tags, theme: m.theme, depth: m.depth, combinesWith: m.combinesWith || [], conflicts: m.conflicts || [] };

}

export function listMechanics() {

	return all( 'mechanic' ).sort( ( a, b ) => ( a.depth ?? 99 ) - ( b.depth ?? 99 ) ).map( ( m ) => describeMechanic( m.id ) );

}

export function listThemes() {

	return all( 'theme' ).map( ( t ) => ( { id: t.id, name: t.name, tags: t.tags, generator: t.generator, families: t.families } ) );

}

export function describeWorld( world ) {

	const f = world.state.flow || {};
	return {
		kind: world.kind, spec: world.spec ? { id: world.spec.id, name: world.spec.name, depth: world.spec.depth, mechanics: world.spec.mechanics } : null,
		mechanics: describeMechanics( world ), exitOpen: !! f.opened, complete: !! world.state.complete, time: +( world.time - ( f.start ?? 0 ) ).toFixed( 1 )
	};

}

// --- agent commands ----------------------------------------------------------------------
const cmd = ( id, desc, args, run ) => define( 'apiCommand', { id, desc, args, run } );

cmd( 'level.spec', 'Spec of a depth (campaign 1-12, combinations 13-20, endless 21+)', { depth: 'number' }, ( game, a ) => levelSpec( + a.depth || 1 ) );
cmd( 'level.ascii', 'ASCII map of a depth (or of the current world when no depth is given)', { depth: 'number?', seed: 'string?' },
	( game, a ) => a.depth ? levelAscii( generateLevel( + a.depth, a.seed ?? null ) ) : game.world ? levelAscii( game.world.layout ) : '' );
cmd( 'level.describe', 'Spec, layout stats, connectivity and ASCII of a depth', { depth: 'number', seed: 'string?' }, ( game, a ) => describeLevel( + a.depth || 1, a.seed ?? null ) );
cmd( 'level.campaign', 'The 20 designed depths', {}, () => campaign( 20 ).map( ( s ) => ( { depth: s.depth, name: s.name, theme: s.theme, mechanics: s.mechanics, level: s.level, boss: s.bossName } ) ) );
cmd( 'mechanic.list', 'Every level mechanic with description, tip and combination rules', {}, () => listMechanics() );
cmd( 'mechanic.describe', 'One mechanic', { id: 'string' }, ( game, a ) => describeMechanic( a.id ) );
cmd( 'theme.list', 'Every level theme', {}, () => listThemes() );
cmd( 'world.state', 'Live mechanic state, exit and timer of the current world', {}, ( game ) => game.world ? describeWorld( game.world ) : null );
