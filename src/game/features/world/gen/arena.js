// 'arena' generator: a short gauntlet into a big round boss arena - used for
// endless "trial" depths (every 10th) and as the fallback when a spec names no
// generator. Replaces the baseline one-rectangle arena (same id).
//
//   [start] == corridor == [antechamber] == [ ARENA ] - [exit vault]

import { define, get } from '../../../core/registry.js';
import { Layout, TILE } from '../../../core/layout.js';
import { carveCorridor, roomCenter, ensureConnected } from './grid.js';
import { makeRoom, labelRooms } from './rooms.js';
import { finishLayout } from './finish.js';

export function generateArena( game, spec, rng ) {

	const W = 50, H = 64;
	const L = new Layout( W, H, 2 );
	L.fill( 0, 0, W, H, TILE.WALL );
	L.meta = { generator: 'arena' };
	const tpl = ( id ) => get( 'roomTemplate', id );
	const rooms = [
		makeRoom( 0, tpl( 'camp' ), 21, 52, 8, 8, 'start' ),
		makeRoom( 1, tpl( rng.pick( [ 'octagon', 'pillared', 'round' ] ) ), 18, 34, 14, 13, 'combat' ),
		makeRoom( 2, tpl( 'arena' ), 14, 10, 22, 22, 'boss' ),
		makeRoom( 3, tpl( 'vault' ), 22, 2, 6, 6, 'exit' )
	];
	for ( let i = 0; i < 3; i ++ ) {

		rooms[ i ].links.push( i + 1 );
		rooms[ i + 1 ].links.push( i );
		carveCorridor( L, roomCenter( rooms[ i ] ), roomCenter( rooms[ i + 1 ] ), i === 1 ? 3 : 2, rng );

	}

	for ( const r of rooms ) get( 'roomTemplate', r.template ).carve( L, r, rng );
	ensureConnected( L, rooms.map( roomCenter ) );
	labelRooms( rooms, rooms[ 0 ], rooms[ 2 ], rooms[ 3 ], rng );
	L.rooms = rooms;
	return finishLayout( L, spec, rng );

}

define( 'levelGenerator', { id: 'arena', name: 'Arena', tags: [ 'boss', 'short' ], generate: generateArena } );
