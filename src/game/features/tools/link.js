// Claude link for the game: when polyreaver.html runs as a claude.ai artifact, an
// AI agent can drive it on the player's real device through the artifact's small
// database - queue `commands/<id>` documents, read `results/<id>`. Same protocol
// as the engine benchmark's link (src/bridge.js), with game commands:
//
//   { cmd: 'ping' }                                device + game summary
//   { cmd: 'api', args: { id, args } }             any game.api command (see 'help')
//   { cmd: 'play', args: { seconds, depth? } }     the playtest bot plays LIVE; returns its
//                                                  report + real frame-time statistics
//   { cmd: 'perf', args: { seconds } }             frame times of whatever is on screen
//   { cmd: 'screenshot' }                          the current frame as an artifact asset
//   { cmd: 'sequence', args: { steps: [...] } }
//
// Only a fixed set of commands exists and nothing from the database is evaluated
// as code; outside claude.ai there is no window.claude and this does nothing.

import { define } from '../../core/registry.js';
import { createBot } from './bot.js';
import { describeAdapter } from '../../../gpu.js';

const LEASE_MS = 10 * 60 * 1000;
const rid = () => Date.now().toString( 36 ) + Math.random().toString( 36 ).slice( 2, 8 );

function deviceId() {

	try {

		let id = localStorage.getItem( 'polyreaverDevice' );
		if ( ! id ) localStorage.setItem( 'polyreaverDevice', id = rid() );
		return id;

	} catch {

		return rid();

	}

}

const wait = ( ms ) => new Promise( ( r ) => setTimeout( r, ms ) );
const pct = ( s, q ) => s.length ? s[ Math.min( s.length - 1, Math.floor( q * s.length ) ) ] : 0;

class GameLink {

	constructor( ctx ) {

		Object.assign( this, ctx );
		this.device = deviceId();
		this.kind = matchMedia( '(pointer: coarse)' ).matches ? 'mobile' : 'desktop';
		this.seen = new Set();
		this.queue = Promise.resolve();
		this.frameTimes = null;
		this.capture = null;
		// per-frame hooks: frame-time sampling, live bot input, screenshots after render
		const rc = ctx.rc, frame = rc.frame.bind( rc );
		rc.frame = ( alpha, dt ) => {

			if ( this.frameTimes ) this.frameTimes.push( dt * 1000 );
			this.bot?.step( dt );
			frame( alpha, dt );
			if ( this.capture ) {

				const done = this.capture;
				this.capture = null;
				rc.renderer.domElement.toBlob( done, 'image/png' );

			}

		};

	}

	async start() {

		const use = window.claude?.use;
		if ( typeof use !== 'function' ) return;
		const db = await use( 'db' ).catch( () => null );
		if ( ! db ) return;
		this.db = db;
		this.assets = await use( 'assets' ).catch( () => null );
		try {

			await db.doc( 'devices/' + this.device ).set( this.info() );

		} catch {

			this.db = null; // view-only visitor
			return;

		}

		this.ui.toast( 'Claude link connected' );
		db.collection( 'commands' ).where( 'status', '==', 'running' ).where( 'device', '==', this.device ).get()
			.then( ( s ) => s.docs.forEach( ( d ) => db.doc( 'commands/' + d.id ).update( { status: 'interrupted' } ).catch( () => {} ) ) ).catch( () => {} );
		db.collection( 'commands' ).where( 'status', '==', 'pending' ).onSnapshot( ( snap ) => {

			for ( const doc of snap.docs ) {

				if ( this.seen.has( doc.id ) ) continue;
				const body = doc.data();
				if ( body.device && body.device !== this.device ) continue;
				if ( body.target && body.target !== this.kind ) continue;
				this.seen.add( doc.id );
				this.queue = this.queue.then( () => this.claim( doc.id, body ) );

			}

		}, () => {} );

	}

	info() {

		return { gpu: describeAdapter( this.gpu.info ), kind: this.kind, timestamps: !! this.gpu.timestamps, userAgent: navigator.userAgent, screen: `${innerWidth}x${innerHeight}@${devicePixelRatio}`, connectedAt: new Date().toISOString() };

	}

	async claim( id, body ) {

		const ref = this.db.doc( 'commands/' + id );
		const lease = await ref.acquire( { holder: this.device, ttlMs: LEASE_MS } ).catch( () => ( { acquired: false } ) );
		if ( ! lease.acquired ) return;
		const fresh = await ref.get().catch( () => null );
		if ( ! fresh?.exists || fresh.data().status !== 'pending' ) return;
		await ref.update( { status: 'running', device: this.device } ).catch( () => {} );
		const startedAt = new Date().toISOString();
		let out;
		try {

			out = { ok: true, result: await this.run( body.cmd, body.args || {} ) };

		} catch ( e ) {

			out = { ok: false, error: String( e?.message || e ) };

		}

		const doc = JSON.parse( JSON.stringify( { cmd: body.cmd, args: body.args || {}, device: this.device, startedAt, finishedAt: new Date().toISOString(), ...out } ) );
		await this.db.doc( 'results/' + id ).set( doc ).catch( ( e ) => console.warn( 'result not saved', e ) );
		await ref.update( { status: out.ok ? 'done' : 'error' } ).catch( () => {} );

	}

	async run( cmd, args ) {

		const game = this.game;
		switch ( cmd ) {

			case 'ping': return { device: this.info(), game: game.describe(), visible: document.visibilityState };
			case 'api': return game.api( args.id, args.args || {} );
			case 'perf': return this.perf( args.seconds ?? 5 );
			case 'play': return this.play( args );
			case 'screenshot': return this.screenshot();
			case 'sequence': {

				const results = [];
				for ( const s of ( args.steps || [] ).slice( 0, 50 ) ) {

					if ( s?.cmd === 'sequence' ) throw new Error( 'nested sequence' );
					try {

						results.push( { cmd: s.cmd, ok: true, result: await this.run( s.cmd, s.args || {} ) } );

					} catch ( e ) {

						results.push( { cmd: s?.cmd, ok: false, error: String( e?.message || e ) } );
						if ( ! args.continueOnError ) break;

					}

				}

				return { steps: results };

			}

			default: throw new Error( 'unknown command ' + cmd );

		}

	}

	async perf( seconds ) {

		this.frameTimes = [];
		await wait( Math.min( 60, seconds ) * 1000 );
		const s = this.frameTimes.sort( ( a, b ) => a - b );
		this.frameTimes = null;
		const info = this.rc.renderer.info;
		return { frames: s.length, fps: +( 1000 / ( pct( s, 0.5 ) || 1 ) ).toFixed( 1 ), p50Ms: +pct( s, 0.5 ).toFixed( 2 ), p95Ms: +pct( s, 0.95 ).toFixed( 2 ), p99Ms: +pct( s, 0.99 ).toFixed( 2 ), worstMs: +( s[ s.length - 1 ] || 0 ).toFixed( 2 ), drawCalls: info.render.drawCalls, triangles: info.render.triangles, entities: this.game.world?.entities.length, canvas: `${this.rc.renderer.domElement.width}x${this.rc.renderer.domElement.height}` };

	}

	async play( { seconds = 60, depth = null, ...opts } ) {

		const game = this.game;
		if ( depth ) game.enterLevel( + depth );
		await wait( 300 );
		const bot = createBot( game, opts );
		this.bot = bot;
		this.frameTimes = [];
		const t0 = performance.now();
		while ( performance.now() - t0 < Math.min( 600, seconds ) * 1000 ) {

			await wait( 250 );
			if ( ! game.world.player?.alive || game.world.state.complete ) break;

		}

		this.bot = null;
		game.input.held.clear();
		game.input.move.x = game.input.move.z = 0;
		const s = this.frameTimes.sort( ( a, b ) => a - b );
		this.frameTimes = null;
		return { bot: bot.report(), perf: { frames: s.length, fps: +( 1000 / ( pct( s, 0.5 ) || 1 ) ).toFixed( 1 ), p95Ms: +pct( s, 0.95 ).toFixed( 2 ), p99Ms: +pct( s, 0.99 ).toFixed( 2 ), worstMs: +( s[ s.length - 1 ] || 0 ).toFixed( 2 ) } };

	}

	async screenshot() {

		if ( ! this.assets ) throw new Error( 'screenshots need edit access to the artifact' );
		const blob = await new Promise( ( resolve, reject ) => {

			this.capture = resolve;
			setTimeout( () => reject( new Error( 'no frame within 10 s (tab in background?)' ) ), 10000 );

		} );
		const up = await this.assets.upload( blob, { type: 'image/png' } );
		return { asset: up.id, bytes: up.sizeBytes };

	}

}

define( 'bootHook', { id: 'tools-claude-link', order: 80, boot( ctx ) {

	const link = new GameLink( ctx );
	ctx.game.link = link;
	link.start().catch( ( e ) => console.warn( 'Claude link unavailable', e ) );

} } );
