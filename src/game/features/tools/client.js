// Agent tools - presentation side: the in-game inspector (` key) with hitbox /
// area overlay, the Workshop (lab galleries, loot roller, in-browser balance sim),
// browser-only API commands (screenshot, perf) and the Claude link.

import './sim.js';
import './inspector.js';
import './link.js';
import './workshop.js';
import { define } from '../../core/registry.js';

define( 'apiCommand', { id: 'perf', desc: 'Renderer statistics for the last frame (browser only).', run( game ) {

	const info = game.rc.renderer.info;
	return { drawCalls: info.render.drawCalls, triangles: info.render.triangles, geometries: info.memory?.geometries, textures: info.memory?.textures, canvas: `${game.rc.renderer.domElement.width}x${game.rc.renderer.domElement.height}`, frame: game.frameCount };

} } );

define( 'bootHook', { id: 'tools-window', order: 1, boot( { game } ) {

	// console convenience: api( 'level.ascii' ) etc.
	window.api = ( id, args ) => game.api( id, args );

} } );
