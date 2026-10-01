// Level flow: interaction, the exit portal and finishing a level.
//
//   INTERACT  pressing 'interact' near an NPC or an interactable prop emits
//             'interact' { entity: player, target } (the client opens the panel named
//             by target.data.service) and runs target.data.onInteract( world, player )
//             for sim-side interactions (braziers, pylons, shrines, portals).
//             Interactable = alive entity with data.service, data.onInteract or data.portal.
//   EXIT      'exitOpen' { x, z } (the monsters feature emits it when the boss dies)
//             spawns the exit portal. Fallbacks so a level can always be finished:
//               - a boss died but nobody opened the exit within 2.5 s -> open it there
//               - no boss ever appeared, the boss room was visited and no monster is
//                 left alive -> open it at the boss room ("cleared"); a game mode that
//                 runs its own encounters sets world.state.flow.hold = true to skip this
//   COMPLETE  walking into the portal calls game.completeLevel(), sets
//             world.state.complete = true and emits 'levelExit' { depth, time } - the
//             client then offers "next depth" / "town". Best clear times per depth are
//             saved (save.world.best) for speedrunners.

import { define } from '../../core/registry.js';
import { TEAM } from '../../core/tuning.js';
import { makeProp } from './mechanics/kit.js';
import { walkable } from './gen/grid.js';

export const REACH = 2.6;

define( 'saveField', { id: 'world', init: () => ( { best: {}, clears: {} } ) } );

// Remember the latest text of every objective ( id -> event ), so late listeners
// (the UI attaches after the world is built) and agents can read them.
define( 'worldHook', { id: 'world-objectives', order: 1, onWorld( game, world ) {

	world.state.objectives = {};
	world.events.on( 'objective', ( o ) => ( world.state.objectives[ o.id ] = { id: o.id, text: o.text, done: !! o.done } ) );

} } );

define( 'worldHook', { id: 'world-flow', order: 60, onWorld( game, world ) {

	const flow = world.state.flow = { opened: false, portal: null, start: world.time, bossSeen: false, bossDeadAt: null, bossPos: null, visitedBoss: false };
	world.events.on( 'exitOpen', ( e ) => openExit( world, e.x, e.z ) );
	world.events.on( 'spawn', ( s ) => {

		if ( s.entity?.kind === 'boss' ) flow.bossSeen = true;

	} );
	world.events.on( 'death', ( d ) => {

		if ( d.entity.kind !== 'boss' ) return;
		flow.bossDeadAt = world.time;
		flow.bossPos = { x: d.entity.x, z: d.entity.z };

	} );
	for ( const e of world.entities ) if ( e.kind === 'boss' ) flow.bossSeen = true;

} } );

// Treasure chests: opening one is "killing" it - it is an enemy-team prop with
// rarity / lootMult, so the progression feature's reward hook (which listens to
// 'death') drops its loot exactly like a monster's. Hit it or press interact.
define( 'worldHook', { id: 'world-treasure', order: 55, onWorld( game, world ) {

	for ( const p of world.layout.props ) {

		if ( p.data?.mechanic !== 'treasure' ) continue;
		const c = makeProp( world, { name: 'Treasure chest', x: p.x, z: p.z, model: 'chest', team: TEAM.ENEMY, life: 1, radius: 0.6, height: 0.9,
			data: { chest: true, xp: 0, rarity: 'rare', lootMult: 3, interact: 'Open chest', corpseTime: 0.6 } } );
		c.facing = p.rot;
		c.data.onInteract = ( w, player ) => w.kill( c, player );
		world.add( c );

	}

} } );

define( 'system', { id: 'world:interact', order: 16, update( world ) {

	const inp = world.input, p = world.player;
	if ( ! inp || ! p?.alive || ! inp.pressed.has( 'interact' ) ) return;
	const target = nearestInteractable( world, p );
	if ( ! target ) return;
	world.events.emit( 'interact', { entity: p, target, x: target.x, z: target.z } );
	target.data.onInteract?.( world, p, target );

} } );

define( 'system', { id: 'world:flow', order: 96, update( world ) {

	const flow = world.state.flow;
	if ( ! flow || world.kind !== 'level' ) return;
	const p = world.player, L = world.layout;

	if ( ! flow.opened ) {

		const bossRoom = L.rooms.find( ( r ) => r.kind === 'boss' );
		if ( bossRoom && p ) {

			const [ tx, tz ] = L.toTile( p.x, p.z );
			if ( tx >= bossRoom.x && tz >= bossRoom.z && tx < bossRoom.x + bossRoom.w && tz < bossRoom.z + bossRoom.h ) flow.visitedBoss = true;

		}

		if ( flow.bossDeadAt !== null && world.time - flow.bossDeadAt > 2.5 ) openExit( world, flow.bossPos.x, flow.bossPos.z );
		else if ( ! flow.bossSeen && ! flow.hold && ( flow.visitedBoss || ! bossRoom ) && world.time > 4 && world.frame % 30 === 0 ) {

			const left = world.entities.some( ( e ) => e.alive && e.team === TEAM.ENEMY && ( e.kind === 'monster' || e.kind === 'boss' ) );
			if ( ! left ) openExit( world, bossRoom ? bossRoom.cx : L.exit?.x ?? p.x, bossRoom ? bossRoom.cz : L.exit?.z ?? p.z );

		}

	}

	const portal = flow.portal;
	if ( portal && p?.alive && ! world.state.complete && Math.hypot( p.x - portal.x, p.z - portal.z ) < 1.3 ) completeLevel( world );

} } );

export function nearestInteractable( world, p, reach = REACH ) {

	let best = null, bd = Infinity;
	for ( const e of world.spatial.query( p.x, p.z, reach + 1.5, ( o ) => o.alive && o !== p && ( o.data.service || o.data.onInteract || o.data.portal ) ) ) {

		if ( e.data.interact === null && ! e.data.service && ! e.data.portal ) continue; // spent (a lit brazier)
		const d = Math.hypot( e.x - p.x, e.z - p.z ) - e.radius;
		if ( d < reach && d < bd ) {

			bd = d;
			best = e;

		}

	}

	return best;

}

// Spawn the exit portal (once). Snaps to the nearest walkable spot.
export function openExit( world, x, z ) {

	const flow = world.state.flow;
	if ( ! flow || flow.opened ) return null;
	flow.opened = true;
	const L = world.layout;
	if ( ! walkable( L.tileAt( x, z ) ) ) {

		let best = null, bd = Infinity;
		for ( let tz = 0; tz < L.h; tz ++ ) for ( let tx = 0; tx < L.w; tx ++ ) {

			if ( ! walkable( L.get( tx, tz ) ) ) continue;
			const [ wx, wz ] = L.toWorld( tx, tz ), d = Math.hypot( wx - x, wz - z );
			if ( d < bd ) {

				bd = d;
				best = [ wx, wz ];

			}

		}

		if ( best ) [ x, z ] = best;

	}

	const portal = makeProp( world, { name: 'Exit portal', x, z, model: 'portal', radius: 1, height: 3, solid: false, flags: { untargetable: true, inert: true, ghost: true },
		data: { portal: 'exit', interact: 'Leave' } } );
	portal.data.onInteract = ( w ) => completeLevel( w );
	world.add( portal );
	flow.portal = portal;
	flow.openedAt = world.time;
	world.events.emit( 'mechanic', { id: 'exit', event: 'open', x, z, entity: portal } );
	world.events.emit( 'objective', { id: 'exit', text: 'The way onward is open', flash: true } );
	return portal;

}

export function completeLevel( world ) {

	if ( world.state.complete ) return;
	world.state.complete = true;
	const game = world.game, depth = world.spec?.depth ?? game?.save.depth ?? 1;
	const time = world.time - ( world.state.flow?.start ?? 0 );
	if ( game ) {

		// spec.record: key for clears / best times (game modes keep their own);
		// spec.progress === false: finishing it does not unlock the next depth
		const key = world.spec?.record ?? depth;
		const w = game.save.world || ( game.save.world = { best: {}, clears: {} } );
		w.clears[ key ] = ( w.clears[ key ] ?? 0 ) + 1;
		const best = w.best[ key ];
		w.newBest = ! best || time < best;
		if ( w.newBest ) w.best[ key ] = +time.toFixed( 2 );
		if ( world.spec?.progress !== false ) game.completeLevel();

	}

	world.events.emit( 'levelExit', { depth, time } );

}
