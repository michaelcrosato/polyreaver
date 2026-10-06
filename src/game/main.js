// Polyreaver - browser entry. Boots WebGPU through the engine's device helper,
// wires the simulation (Game) to the presentation (RenderContext, UI, input) and
// runs the frame loop. Everything gameplay-related is registered by the feature
// modules imported below; this file only connects the pieces.
//
// URL options (hash):  #depth=5  start in a level   #seed=abc  run seed
//                      #fresh    ignore the saved character   #lab=creature  open a Workshop lab

import * as THREE from 'three/webgpu';
import layout from '../boot/layouts/game.html?raw';
import { mountLayout } from '../boot/layout.js';
import './sim-entry.js';
import './render/placeholder.js';
import './render/post.js';
import './features/creatures/client.js';
import './features/combat/client.js';
import './features/monsters/client.js';
import './features/progression/client.js';
import './features/world/client.js';
import './features/tools/client.js';
import './features/examples/client.js';
import { Game } from './game.js';
import { RenderContext } from './render/context.js';
import { UI } from './ui/shell.js';
import { installInput } from './input.js';
import { all, get } from './core/registry.js';
import { SaveManager } from './features/progression/persistence.js';

function readHash() {

	const out = {};
	for ( const part of location.hash.replace( /^#/, '' ).split( '&' ) ) {

		if ( ! part ) continue;
		const [ k, v = '1' ] = part.split( '=' );
		out[ decodeURIComponent( k ) ] = decodeURIComponent( v );

	}

	return out;

}

export function writeSave( game ) {

	return game.saves?.save( game.save );

}

export async function initialize( { gpu, boot } ) {

	mountLayout( layout );
	const opts = readHash();
	const saves = new SaveManager();
	boot.stop = () => saves.dispose();
	const saved = await saves.load( { fresh: !! opts.fresh } );

	const renderer = new THREE.WebGPURenderer( { device: gpu.device, antialias: true, trackTimestamp: gpu.timestamps } );
	renderer.setPixelRatio( Math.min( devicePixelRatio, opts.dpr ? + opts.dpr : 2 ) );
	renderer.setSize( innerWidth, innerHeight );
	renderer.shadowMap.enabled = true;
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.toneMappingExposure = 1.05;
	document.getElementById( 'game' ).append( renderer.domElement );
	await boot.step( 'REN', 'Initializing game renderer', 55, () => renderer.init() );
	boot.stop = () => { renderer.setAnimationLoop( null ); saves.dispose(); };
	renderer.onDeviceLost = ( info ) => boot.fail( new Error( info.message ), 'GPU-LOST' );

	const game = new Game( { seed: opts.seed || 'polyreaver', save: saved } );
	if ( saved ) game.upgradeSave( game.save );
	game.saves = saves;
	const rc = new RenderContext( renderer, gpu );
	rc.init( game );
	const ui = new UI( game, document.getElementById( 'ui' ) );
	ui.init();
	game.ui = ui; game.rc = rc;
	game.replaceCharacter = ( save ) => {

		game.save = save;
		rc.input?.releaseAll();
		game.input.held.clear(); game.input.pressed.clear();
		game.input.move.x = game.input.move.z = 0;
		game.enterTown();
		game.events.emit( 'inventory', { save } );

	};
	const saveCurrent = () => boot.state.status === 'running' && writeSave( game );
	let saveTimer;
	let lastSaveNotice = '';
	saves.onStatus( ( status ) => {

		if ( [ 'error', 'conflict', 'unavailable' ].includes( status.code ) && status.message !== lastSaveNotice ) {

			lastSaveNotice = status.message;
			ui.toast( status.message, 'error' );

		}

	} );
	// the combat feature can replace the baseline input with define( 'inputProvider', { id: 'default', install } )
	const install = get( 'inputProvider', 'default' )?.install ?? installInput;
	const poll = install( game, rc, renderer.domElement, ( a ) => ui.action( a ) );

	game.events.on( 'world', ( { world } ) => {

		rc.setWorld( world );
		saveCurrent();

	} );
	game.events.on( 'levelup', ( { level } ) => ui.toast( `Level ${level}!`, 'levelup' ) );
	game.events.on( 'playerDeath', () => {

		ui.toast( 'You died - returning to town', 'death' );
		setTimeout( () => game.enterTown(), 2500 );

	} );
	const flushSave = () => {

		if ( boot.state.status === 'running' && saves.writer && saves.mode === 'active' ) saves.write( game.save );

	};
	addEventListener( 'beforeunload', flushSave );
	addEventListener( 'pagehide', () => { flushSave(); saves.release(); } );
	addEventListener( 'pageshow', ( event ) => event.persisted && saveCurrent() );
	document.addEventListener( 'visibilitychange', () => document.hidden && saveCurrent() );
	addEventListener( 'resize', () => rc.resize() );

	// features that need the live game (agent API, debug hooks, labs) register 'boot' hooks
	for ( const b of all( 'bootHook' ).sort( ( a, b2 ) => ( a.order ?? 50 ) - ( b2.order ?? 50 ) ) ) await b.boot?.( { game, rc, ui, renderer, gpu, opts } );

	if ( ! game.world ) {

		if ( opts.depth ) game.enterLevel( Math.max( 1, + opts.depth ) );
		else game.enterTown();

	}

	window.game = game;
	window.rc = rc;
	window.ui = ui;
	let last = performance.now();
	game.frameCount = 0;
	// recent errors (api 'errors' / the Claude link reads them); the first one is shown once
	game.errors = [];
	const guard = ( stage, fn ) => {

		try {

			fn();

		} catch ( e ) {

			if ( boot.state.status !== 'running' ) throw e;
			const msg = `${stage}: ${e?.message || e}`;
			if ( game.errors.length < 50 && ! game.errors.some( ( x ) => x.msg === msg ) ) {

				console.error( e );
				game.errors.push( { msg, at: game.frameCount, stack: String( e?.stack || '' ).split( '\n' ).slice( 0, 4 ).join( ' | ' ) } );

			}

			if ( ! game._errShown ) {

				game._errShown = true;
				ui.toast( 'Error: ' + e.message, 'error' );

			}

		}

	};
	const frame = () => {

		const now = performance.now();
		const dt = Math.min( 0.1, ( now - last ) / 1000 );
		last = now;
		// three stages, each guarded on its own: a failing input device must never stop
		// the simulation or the picture (an embedding page may block the gamepad API...)
		guard( 'input', () => poll?.( dt ) );
		guard( 'frame', () => {

			const alpha = game.update( rc.hitstop > 0 ? 0 : dt );
			rc.hitstop = Math.max( 0, rc.hitstop - dt );
			rc.frame( alpha, dt );

		} );
		guard( 'ui', () => ui.update( dt ) );
		game.frameCount ++;

	};

	return { frame, start: () => {

		renderer.setAnimationLoop( frame );
		saveTimer = setInterval( saveCurrent, 15000 );
		// BootLoader reveals the running state immediately after start() returns.
		queueMicrotask( saveCurrent );

	}, stop: () => { renderer.setAnimationLoop( null ); clearInterval( saveTimer ); saves.dispose(); } };

}
