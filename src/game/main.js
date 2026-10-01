// Polyreaver - browser entry. Boots WebGPU through the engine's device helper,
// wires the simulation (Game) to the presentation (RenderContext, UI, input) and
// runs the frame loop. Everything gameplay-related is registered by the feature
// modules imported below; this file only connects the pieces.
//
// URL options (hash):  #depth=5  start in a level   #seed=abc  run seed
//                      #fresh    ignore the saved character   #lab=creature  open a Workshop lab

import * as THREE from 'three/webgpu';
import { createDevice } from '../gpu.js';
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

const SAVE_KEY = 'polyreaver.save.v1';

function fatal( title, detail ) {

	const el = document.getElementById( 'fatal' );
	el.querySelector( 'h2' ).textContent = title;
	el.querySelector( '.detail' ).textContent = detail;
	el.style.display = 'flex';
	window.__fatal = title + ': ' + detail;

}

function readHash() {

	const out = {};
	for ( const part of location.hash.replace( /^#/, '' ).split( '&' ) ) {

		if ( ! part ) continue;
		const [ k, v = '1' ] = part.split( '=' );
		out[ decodeURIComponent( k ) ] = decodeURIComponent( v );

	}

	return out;

}

export function loadSave() {

	try {

		const s = JSON.parse( localStorage.getItem( SAVE_KEY ) || 'null' );
		return s && s.version === 1 ? s : null;

	} catch {

		return null;

	}

}

export function writeSave( game ) {

	try {

		game.save.savedAt = Date.now();
		localStorage.setItem( SAVE_KEY, JSON.stringify( game.save ) );

	} catch { /* private mode / quota: the run still works, it just is not kept */ }

}

async function boot() {

	const opts = readHash();
	let gpu;
	try {

		gpu = await createDevice();

	} catch ( e ) {

		fatal( 'WebGPU is not available', e.message + '\n\nPolyreaver runs on WebGPU only. Try Chrome / Edge 113+, Safari 26+, Firefox 141+ (Windows) or Chrome for Android 121+.' );
		return;

	}

	const renderer = new THREE.WebGPURenderer( { device: gpu.device, antialias: true, trackTimestamp: gpu.timestamps } );
	renderer.setPixelRatio( Math.min( devicePixelRatio, opts.dpr ? + opts.dpr : 2 ) );
	renderer.setSize( innerWidth, innerHeight );
	renderer.shadowMap.enabled = true;
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.toneMappingExposure = 1.05;
	document.getElementById( 'game' ).append( renderer.domElement );
	await renderer.init();
	renderer.onDeviceLost = ( info ) => fatal( 'GPU device lost', info.message );

	const saved = opts.fresh ? null : loadSave();
	const game = new Game( { seed: opts.seed || 'polyreaver', save: saved } );
	if ( saved ) game.upgradeSave( game.save );
	const rc = new RenderContext( renderer, gpu );
	rc.init( game );
	const ui = new UI( game, document.getElementById( 'ui' ) );
	ui.init();
	game.ui = ui; game.rc = rc;
	// the combat feature can replace the baseline input with define( 'inputProvider', { id: 'default', install } )
	const install = get( 'inputProvider', 'default' )?.install ?? installInput;
	const poll = install( game, rc, renderer.domElement, ( a ) => ui.action( a ) );

	game.events.on( 'world', ( { world } ) => {

		rc.setWorld( world );
		writeSave( game );

	} );
	game.events.on( 'levelup', ( { level } ) => ui.toast( `Level ${level}!`, 'levelup' ) );
	game.events.on( 'playerDeath', () => {

		ui.toast( 'You died - returning to town', 'death' );
		setTimeout( () => game.enterTown(), 2500 );

	} );
	setInterval( () => writeSave( game ), 15000 );
	addEventListener( 'beforeunload', () => writeSave( game ) );
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
	renderer.setAnimationLoop( () => {

		const now = performance.now();
		const dt = Math.min( 0.1, ( now - last ) / 1000 );
		last = now;
		try {

			poll?.( dt );
			const alpha = game.update( rc.hitstop > 0 ? 0 : dt );
			rc.hitstop = Math.max( 0, rc.hitstop - dt );
			rc.frame( alpha, dt );
			ui.update( dt );
			game.frameCount ++;

		} catch ( e ) {

			console.error( e );
			if ( ! game._errShown ) {

				game._errShown = true;
				ui.toast( 'Error: ' + e.message, 'error' );

			}

		}

	} );

}

boot();
