import { installSwitcher } from './switcher.js';

// Dependency-free boot protocol. Games supply checks and a deferred engine loader;
// only this module owns the startup state machine and the final loop hand-off.
export class BootLoader {

	constructor( { brand, version, build, modes } ) {

		const earlyFailure = window.__boot?.status === 'failed' ? window.__boot.errors[ 0 ] : null;
		clearTimeout( window.__bootWatchdog );
		this.modes = modes;
		this.state = { protocol: 1, brand, version, build, platform: navigator.userAgent, stage: 'BOOT', progress: 0, status: 'booting', renderer: 'Not initialized', adapter: 'Not available', capabilities: {}, mode: null, stages: [], errors: [] };
		this.started = performance.now();
		this.stop = null;
		this.device = null;
		this.el = ( id ) => document.getElementById( 'boot-' + id );
		this.el( 'title' ).textContent = brand;
		this.el( 'copy' ).onclick = () => this.copy();
		window.__boot = this.state;
		window.__bootFail = ( error ) => this.fail( error );
		window.addEventListener( 'error', ( event ) => {

			if ( event.error || event.message ) this.fail( event.error || new Error( event.message ), 'JS-ERR' );

		} );
		window.addEventListener( 'unhandledrejection', ( event ) => this.fail( event.reason, 'JS-ASYNC' ) );
		this.render();
		if ( earlyFailure ) this.fail( new Error( earlyFailure.message ), earlyFailure.code );

	}

	assertActive() {

		if ( this.state.status === 'failed' ) throw new Error( 'Startup already stopped' );

	}

	render() {

		for ( const key of [ 'version', 'build', 'platform', 'renderer', 'adapter' ] ) this.el( key ).textContent = this.state[ key ];
		this.el( 'stage' ).textContent = `${this.state.stage} / ${this.state.message || 'Starting'} / ${this.state.progress}%`;
		this.el( 'progress' ).value = this.state.progress;
		this.el( 'log' ).replaceChildren( ...this.state.stages.map( ( item ) => {

			const li = document.createElement( 'li' );
			li.textContent = `${item.code.padEnd( 6 )} ${item.status.toUpperCase()} · ${item.label}`;
			return li;

		} ) );

	}

	async step( code, label, progress, run, timeout = 30000 ) {

		this.assertActive();
		const parent = this.activeStage;
		this.activeStage = { code, label, progress };
		Object.assign( this.state, { stage: code, message: label, progress } );
		const entry = { code, label, status: 'pending', at: Math.round( performance.now() - this.started ) };
		this.state.stages.push( entry );
		this.render();
		let timer;
		try {

			// Yield once so the current stage is painted before synchronous engine work.
			await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
			this.assertActive();
			const value = await Promise.race( [ Promise.resolve().then( run ), new Promise( ( _, reject ) => {

				timer = setTimeout( () => reject( Object.assign( new Error( `${label} timed out after ${timeout / 1000}s. Reload to retry.` ), { code: `${code}-TIME` } ) ), timeout );

			} ) ] );
			this.assertActive();
			entry.status = 'ok';
			this.render();
			return value;

		} catch ( error ) {

			entry.status = 'failed';
			this.fail( error, error?.code || `${code}-FAIL` );
			throw error;

		} finally {

			clearTimeout( timer );
			this.activeStage = parent;
			if ( parent && this.state.status !== 'failed' ) {

				Object.assign( this.state, { stage: parent.code, message: parent.label, progress: Math.max( parent.progress, this.state.progress ) } );
				this.render();

			}

		}

	}

	watchDevice( device ) {

		this.device = device;
		device.lost.then( ( info ) => this.fail( new Error( `Graphics device lost: ${info.message || info.reason}. Reload to reconnect.` ), 'GPU-LOST' ) );
		device.addEventListener( 'uncapturederror', ( event ) => this.fail( event.error, 'GPU-ERR' ) );

	}

	fail( error, code = 'BOOT-FAIL' ) {

		if ( this.state.status === 'failed' ) return;
		const record = { code, stage: this.state.stage, message: String( error?.message || error ), stack: String( error?.stack || '' ), at: Math.round( performance.now() - this.started ) };
		this.state.errors.push( record );
		this.state.status = 'failed';
		this.state.message = 'Startup stopped';
		window.__fatal = `${code} at ${record.stage}: ${record.message}`;
		try { this.stop?.(); } catch { /* Preserve the original diagnostic. */ }
		this.device?.destroy();
		document.getElementById( 'boot' ).hidden = false;
		const root = document.getElementById( 'engine-root' );
		if ( root ) root.hidden = true;
		this.el( 'choices' ).hidden = true;
		this.el( 'error' ).hidden = false;
		this.el( 'error' ).textContent = window.__fatal;
		this.el( 'help' ).hidden = false;
		this.el( 'retry' ).hidden = false;
		this.render();
		try { localStorage.setItem( 'polyreaver.boot.lastFailure', JSON.stringify( this.state ) ); } catch { /* Storage is optional. */ }

	}

	async copy() {

		const text = JSON.stringify( this.state, null, 2 );
		// Always make a manual copy possible, including clipboard permission prompts
		// that remain pending indefinitely in embedded browsers.
		this.el( 'report' ).value = text;
		this.el( 'report' ).hidden = false;
		this.el( 'report' ).focus();
		this.el( 'report' ).select();
		try {

			await navigator.clipboard.writeText( text );
			this.el( 'copy' ).textContent = 'Diagnostics copied';

		} catch {

			this.el( 'copy' ).textContent = 'Select and copy report below';

		}

	}

	choose( gpu ) {

		this.assertActive();
		Object.assign( this.state, { status: 'ready', stage: 'READY', progress: 100, message: 'Boot complete · choose an engine' } );
		this.render();
		this.el( 'choices' ).hidden = false;
		for ( const button of this.el( 'choices' ).querySelectorAll( '[data-boot-choice]' ) ) {

			button.onclick = () => this.launch( button.dataset.bootChoice, gpu );

		}

	}

	async launch( id, gpu ) {

		if ( ! [ 'ready', 'booting' ].includes( this.state.status ) || ! this.modes[ id ] ) return;
		this.state.status = 'loading';
		this.state.mode = id;
		this.el( 'choices' ).hidden = true;
		try {

			const engine = await this.step( 'LOAD', `Loading ${this.modes[ id ].label}`, 10, this.modes[ id ].load );
			const lifecycle = await this.step( 'SYS', 'Initializing engine systems', 40, () => engine.initialize( { gpu, boot: this } ), 120000 );
			this.stop = lifecycle.stop;
			await this.step( 'FRAME', 'Validating first frame', 90, async () => {

				await lifecycle.frame();
				await gpu.device.queue.onSubmittedWorkDone();

			}, 120000 );
			this.assertActive();
			lifecycle.start();
			Object.assign( this.state, { stage: 'RUN', progress: 100, status: 'running', message: 'All systems ready' } );
			this.render();
			document.getElementById( 'engine-root' ).hidden = false;
			document.getElementById( 'boot' ).hidden = true;
			installSwitcher( this );

		} catch ( error ) {

			this.fail( error );

		}

	}

}
