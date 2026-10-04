// Claude link: lets Claude run benchmarks on YOUR device and read the results.
//
// When this page is opened as a claude.ai artifact, the artifact has a small
// shared database. Claude writes commands into `commands/<id>` (for example
// "apply the Ultra preset, then measure for 5 s, then take a screenshot"); the
// page picks them up, runs them, and writes the answer to `results/<id>`.
// Benchmarks you run yourself from the panel are recorded in `runs/` too, so
// Claude can see them without you copy-pasting a report.
//
// Anywhere else (vite dev server, the single HTML file opened from disk) there is
// no `window.claude`, and this module does nothing.
//
// Only a fixed list of commands exists; nothing from the database is evaluated
// as code, and settings keys/values are checked against the feature list.

import { defaults, PRESETS } from './features.js';
import { describeAdapter } from './gpu.js';
import { IS_MOBILE } from './app/config.js';
import { renderRuns } from './results.js';

const LEASE_MS = 10 * 60 * 1000;

function randomId() {

	return Date.now().toString( 36 ) + Math.random().toString( 36 ).slice( 2, 8 );

}

function deviceId() {

	try {

		let id = localStorage.getItem( 'claudeLinkDevice' );
		if ( ! id ) localStorage.setItem( 'claudeLinkDevice', id = randomId() );
		return id;

	} catch {

		return randomId();

	}

}

function round( v, d = 2 ) {

	return typeof v === 'number' && isFinite( v ) ? Number( v.toFixed( d ) ) : v ?? null;

}

export class ClaudeLink {

	constructor( app ) {

		this.app = app;
		this.db = null;
		this.assets = null;
		this.device = deviceId();
		this._kind = IS_MOBILE ? 'mobile' : 'desktop';
		this.seen = new Set();
		this.queue = Promise.resolve();
		this._capture = null;
		this.badge = null;

	}

	async start() {

		const use = window.claude?.use;
		if ( typeof use !== 'function' ) return;
		const db = await use( 'db' ).catch( () => null );
		if ( ! db ) return;
		this.db = db;
		this.assets = await use( 'assets' ).catch( () => null );
		this._badge( 'linked' );

		try {

			await db.doc( 'devices/' + this.device ).set( this._deviceInfo() );

		} catch ( e ) {

			// view-only visitors cannot write: stay passive
			this._badge( null );
			this.db = null;
			return;

		}

		this.app.bench.onResult = ( kind, data ) => this._record( kind, data );

		// A command this device was running when its tab closed never finishes; mark
		// it so it does not look as if it is still going.
		db.collection( 'commands' ).where( 'status', '==', 'running' ).where( 'device', '==', this.device ).get()
			.then( ( snap ) => snap.docs.forEach( ( d ) => db.doc( 'commands/' + d.id ).update( { status: 'interrupted' } ).catch( () => {} ) ) )
			.catch( () => {} );

		// every device's saved benchmarks, newest first, for the comparison panel
		this.runs = [];
		this.devices = {};
		const showRuns = () => this.app.ui.setResults( renderRuns( this.runs, this.device, this.devices ) );
		this.unsubscribeRuns = db.collection( 'runs' ).orderBy( 'at', 'desc' ).limit( 60 ).onSnapshot(
			( snap ) => {

				this.runs = snap.docs.map( ( d ) => d.data() );
				showRuns();

			},
			() => this.app.ui.setResults( null )
		);
		this.unsubscribeDevices = db.collection( 'devices' ).onSnapshot(
			( snap ) => {

				this.devices = Object.fromEntries( snap.docs.map( ( d ) => [ d.id, d.data() ] ) );
				showRuns();

			},
			() => {}
		);

		this.unsubscribe = db.collection( 'commands' ).where( 'status', '==', 'pending' ).onSnapshot(
			( snap ) => {

				for ( const doc of snap.docs ) {

					if ( this.seen.has( doc.id ) ) continue;
					const body = doc.data();
					if ( body.device && body.device !== this.device ) continue;
					// `target` picks a kind of device: a command queued for "mobile" waits
					// until a phone or tablet opens the page
					if ( body.target && body.target !== this._kind ) continue;
					this.seen.add( doc.id );
					this.queue = this.queue.then( () => this._claimAndRun( doc.id, body ) );

				}

			},
			() => this._badge( 'offline' )
		);

	}

	// Called by the app right after a frame is rendered; screenshots must be taken
	// in the same task as the render, before the WebGPU canvas is presented.
	afterRender() {

		if ( ! this._capture ) return;
		const done = this._capture;
		this._capture = null;
		this.app.renderer.domElement.toBlob( done, 'image/png' );

	}

	_deviceInfo() {

		const g = this.app.gpu;
		return {
			gpu: describeAdapter( g.info ),
			kind: this._kind,
			vendor: g.info?.vendor || '',
			architecture: g.info?.architecture || '',
			featureLevel: g.featureLevel,
			timestamps: !! g.timestamps,
			userAgent: navigator.userAgent,
			screen: `${innerWidth}x${innerHeight}@${devicePixelRatio}`,
			connectedAt: new Date().toISOString()
		};

	}

	async _claimAndRun( id, body ) {

		const ref = this.db.doc( 'commands/' + id );
		// Several devices may have the page open; a lease makes exactly one run it.
		const lease = await ref.acquire( { holder: this.device, ttlMs: LEASE_MS } ).catch( () => ( { acquired: false } ) );
		if ( ! lease.acquired ) return;
		const fresh = await ref.get().catch( () => null );
		if ( ! fresh?.exists || fresh.data().status !== 'pending' ) return;

		await ref.update( { status: 'running', device: this.device } ).catch( () => {} );
		this._badge( 'running ' + body.cmd );
		const startedAt = new Date().toISOString();
		let out;
		try {

			out = { ok: true, result: await this._run( body.cmd, body.args || {} ) };

		} catch ( e ) {

			out = { ok: false, error: String( e?.message || e ) };

		}

		const result = { cmd: body.cmd, args: body.args || {}, device: this.device, startedAt, finishedAt: new Date().toISOString(), ...out };
		await this.db.doc( 'results/' + id ).set( result ).catch( ( e ) => console.warn( 'Claude link: result not saved', e ) );
		await ref.update( { status: out.ok ? 'done' : 'error' } ).catch( () => {} );
		this._badge( 'linked' );

	}

	async _run( cmd, args ) {

		const app = this.app;
		switch ( cmd ) {

			case 'ping': return { device: this._deviceInfo(), settings: this._changedSettings(), visible: document.visibilityState };
			case 'report': return { text: app.report() };
			case 'settings': return { settings: { ...app.S }, changed: this._changedSettings() };

			case 'preset': {

				if ( ! PRESETS[ args.id ] ) throw new Error( 'unknown preset ' + args.id + ' (have: ' + Object.keys( PRESETS ).join( ', ' ) + ')' );
				await app.preset( args.id );
				return { changed: this._changedSettings() };

			}

			case 'reset': {

				await app.applyAll( { ...defaults(), scene: app.S.scene, seed: app.S.seed, count: args.keepCount ? app.S.count : defaults().count } );
				return { changed: this._changedSettings() };

			}

			case 'set': {

				await app.applyAll( this._validated( args.values ) );
				return { changed: this._changedSettings() };

			}

			case 'measure': return this._measure( args );
			case 'maxCrowd': return this._maxCrowd( args );
			case 'effects': return this._effects();
			case 'standard': return this._standard();
			case 'screenshot': return this._screenshot();

			case 'sequence': {

				const steps = Array.isArray( args.steps ) ? args.steps.slice( 0, 50 ) : [];
				const results = [];
				for ( const step of steps ) {

					if ( step?.cmd === 'sequence' ) throw new Error( 'nested sequence' );
					try {

						results.push( { cmd: step.cmd, ok: true, result: await this._run( step.cmd, step.args || {} ) } );

					} catch ( e ) {

						results.push( { cmd: step?.cmd, ok: false, error: String( e?.message || e ) } );
						if ( ! args.continueOnError ) break;

					}

				}

				return { steps: results };

			}

			default: throw new Error( 'unknown command ' + cmd );

		}

	}

	// Only known settings, with the same type as their default.
	_validated( values ) {

		if ( ! values || typeof values !== 'object' ) throw new Error( 'args.values must be an object' );
		const base = defaults();
		const out = {};
		for ( const [ k, v ] of Object.entries( values ) ) {

			if ( ! ( k in base ) ) throw new Error( 'unknown setting ' + k );
			if ( typeof v !== typeof base[ k ] ) throw new Error( `setting ${k} expects a ${typeof base[ k ]}` );
			out[ k ] = v;

		}

		return out;

	}

	_changedSettings() {

		const base = defaults();
		return Object.fromEntries( Object.entries( this.app.S ).filter( ( [ k, v ] ) => base[ k ] !== v ) );

	}

	_snapshot() {

		const app = this.app, s = app.stats, c = app.crowd.stats();
		return {
			count: app.S.count,
			tris: app._tris || 0,
			crowdTris: c.tris,
			draws: c.draws,
			canvas: `${app.renderer.domElement.width}x${app.renderer.domElement.height}`,
			cpuMs: round( s.cpuMs ),
			gpuRenderMs: round( s.gpuRender ),
			gpuComputeMs: round( s.gpuCompute ),
			physics: app.physics?.enabled ? app.physics.stats() : null
		};

	}

	async _measure( args ) {

		const ms = Math.min( Math.max( Number( args.seconds ) || 3, 1 ), 30 ) * 1000;
		const m = await this.app.bench.sample( ms );
		return {
			fps: round( m.fps, 1 ), frameMs: round( m.frame ), p95Ms: round( m.p95 ), p99Ms: round( m.p99 ), worstMs: round( m.worst ),
			gpuMs: round( m.gpu ), frames: m.n, visible: document.visibilityState, ...this._snapshot()
		};

	}

	async _maxCrowd( args ) {

		if ( this.app.bench.running ) throw new Error( 'a benchmark is already running' );
		this.app.bench.results.crowd = null;
		await this.app.bench.findMaxCrowd( Number( args.targetFps ) || 60 );
		const r = this.app.bench.results.crowd;
		if ( ! r ) throw new Error( 'max-crowd run was stopped' );
		return r;

	}

	async _effects() {

		if ( this.app.bench.running ) throw new Error( 'a benchmark is already running' );
		this.app.bench.results.fx = null;
		await this.app.bench.measureEffects();
		const r = this.app.bench.results.fx;
		if ( ! r ) throw new Error( 'effects run was stopped' );
		return { warmLoadMs: round( this.app.bench.warmLoad ), rows: r.map( ( row ) => ( { label: row.label, fps: round( row.fps, 1 ), frameDelta: round( row.frameDelta ), gpuDelta: round( row.gpuDelta ), cpuDelta: round( row.cpuDelta ) } ) ) };

	}

	async _standard() {

		if ( this.app.bench.running ) throw new Error( 'a benchmark is already running' );
		const r = await this.app.bench.standard();
		if ( ! r ) throw new Error( 'standard benchmark was stopped' );
		return r;

	}

	async _screenshot() {

		if ( ! this.assets ) throw new Error( 'screenshots need edit access to the artifact' );
		const blob = await new Promise( ( resolve, reject ) => {

			this._capture = resolve;
			setTimeout( () => reject( new Error( 'no frame rendered within 10 s (is the tab in the background?)' ) ), 10000 );

		} );
		if ( ! blob ) throw new Error( 'canvas capture failed' );
		const up = await this.assets.upload( blob, { type: 'image/png' } );
		return { asset: up.id, bytes: up.sizeBytes, canvas: `${this.app.renderer.domElement.width}x${this.app.renderer.domElement.height}` };

	}

	// Benchmarks started from the panel are kept too (one document per run).
	_record( kind, data ) {

		if ( ! this.db ) return;
		const doc = { kind, device: this.device, gpu: describeAdapter( this.app.gpu.info ), deviceKind: this._kind, at: new Date().toISOString(), data, settings: this._changedSettings() };
		this.db.doc( 'runs/' + randomId() ).set( JSON.parse( JSON.stringify( doc ) ) ).catch( () => {} );

	}

	_badge( text ) {

		if ( ! this.badge ) {

			this.badge = document.createElement( 'div' );
			this.badge.id = 'claude-link';
			this.badge.title = 'Claude can run benchmarks on this device through the artifact database';
			document.body.appendChild( this.badge );

		}

		this.badge.textContent = text ? 'Claude link: ' + text : '';
		this.badge.style.display = text ? '' : 'none';

	}

}
