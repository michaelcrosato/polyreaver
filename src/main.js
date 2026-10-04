// WebGPU crowd stress test - application wiring.

import * as THREE from 'three/webgpu';
import layout from './boot/layouts/stress.html?raw';
import { mountLayout } from './boot/layout.js';
import { Crowd } from './crowd/crowd.js';
import { World } from './world.js';
import { CameraRig } from './camera.js';
import { Input } from './input.js';
import { PostFX, needsPost } from './post.js';
import { PhysicsDemo } from './physics.js';
import { isCel, makeCelMaterial } from './cel.js';
import { defaults, PRESETS, CAPACITIES } from './features.js';
import { UI, Graph } from './ui.js';
import { Bench } from './bench.js';
import { ClaudeLink } from './bridge.js';
import { IS_MOBILE, DPR, CROWD_KEYS, SHADING_KEYS, WORLD_KEYS, RES_KEYS, POST_KEYS, PHYS_KEYS, readHash } from './app/config.js';
import { applyCrowd, applyShading, applyWorld, applyCamera, applyPost, applyPhysics } from './app/apply.js';
import { updateHero } from './app/hero.js';
import { updateHud, buildReport } from './app/hud.js';
import { bindButtons, hotkey } from './app/controls.js';
import { regenerateScene, sceneKey } from './app/scene.js';
import { prepareRendering } from './app/prepare.js';

class App {

	async init( { gpu, boot } ) {

		mountLayout( layout );
		this.boot = boot;

		this.gpu = gpu;
		const params = new URLSearchParams( location.hash.slice( 1 ) );
		this.S = { ...defaults(), ...( boot.initialScene ? { scene: boot.initialScene } : {} ), ...readHash() };
		// Older city links called the crowd size "population".
		if ( params.has( 'population' ) && ! params.has( 'count' ) ) this.S.count = Number( params.get( 'population' ) );
		this.frameCount = 0;

		const renderer = new THREE.WebGPURenderer( { device: gpu.device, antialias: false, trackTimestamp: gpu.timestamps } );
		this.renderer = renderer;
		renderer.setPixelRatio( 1 );
		renderer.setSize( innerWidth, innerHeight );
		document.getElementById( 'app' ).appendChild( renderer.domElement );
		await boot.step( 'REN', 'Initializing stress-test renderer', 55, () => renderer.init() );
		boot.stop = () => renderer.setAnimationLoop( null );
		renderer.onDeviceLost = ( info ) => boot.fail( new Error( info.message ), 'GPU-LOST' );
		this.defaultLighting = renderer.lighting;

		this.scene = new THREE.Scene();
		this.world = new World( renderer, this.scene );
		this.rig = new CameraRig( renderer.domElement );
		this.crowd = new Crowd( renderer, this.scene, { capacity: this.resolveCapacity(), count: this.S.count, limits: gpu.limits } );
		this.crowd.materialFactory = ( kind ) => ( isCel( kind ) ? makeCelMaterial( kind ) : null );
		this.post = new PostFX( renderer, this.scene );
		this.physics = new PhysicsDemo( this.scene, this.world, this.crowd );
		this.input = new Input( document.getElementById( 'joystick' ), document.getElementById( 'knob' ) );
		this.hero = { pos: new THREE.Vector3( 0, 0, 3 ), heading: Math.PI, speed: 0, state: 0 };

		// hero marker ring
		const ring = new THREE.Mesh( new THREE.RingGeometry( 0.55, 0.75, 32 ).rotateX( - Math.PI / 2 ), new THREE.MeshBasicNodeMaterial( { color: 0xffd23f, transparent: true, opacity: 0.9, depthWrite: false } ) );
		ring.renderOrder = 2;
		ring.name = 'Hero marker';
		this.scene.add( ring );
		this.heroRing = ring;

		this.ui = new UI( this.S, {
			onChange: ( k, v ) => this._uiAction( () => this.set( k, v ) ),
			onPreset: ( id ) => this._uiAction( () => this.preset( id ) ),
			onAction: ( a ) => this._uiAction( () => this.action( a ) )
		} );
		this.bench = new Bench( this );
		this.graph = new Graph( document.getElementById( 'graph' ) );

		if ( IS_MOBILE ) document.body.classList.add( 'touch' );
		this._bindButtons();
		this.input.onKey = ( e ) => this._hotkey( e );
		this.rig.onUserInput = () => this._leaveOverview();

		await boot.step( 'WORLD', 'Preparing stress-test scene', 70, () => this.applyAll( this.S ), 120000 );
		if ( this.physicsStartup ) await this.physicsStartup;
		boot.assertActive();
		await boot.step( 'WARM', 'Preparing all scene views', 82, () => prepareRendering( this, ( message ) => {

			boot.state.message = message;
			boot.render();

		} ), 120000 );
		window.addEventListener( 'resize', () => this.resize() );

		this.stats = { frames: 0, acc: 0, cpu: 0, last: performance.now(), fps: 0, frameMs: 0, cpuMs: 0, gpuRender: 0, gpuCompute: 0, worstFrameMs: 0, worstCpuMs: 0, framesOver50: 0 };
		this._lastFrame = performance.now();
		this._startTime = performance.now();
		this.link = new ClaudeLink( this );

		window.app = this;
		return {
			frame: () => this.frame(),
			start: () => {

				// The GPU wait for FRAME belongs to loading, not the first play frame.
				this._lastFrame = this.stats.last = performance.now();
				this.stats.frames = this.stats.acc = this.stats.cpu = 0;
				renderer.setAnimationLoop( () => this.frame() );
				this.link.start().catch( ( e ) => console.warn( 'Claude link unavailable', e ) );

			},
			stop: () => renderer.setAnimationLoop( null )
		};

	}

	// --- settings ------------------------------------------------------------
	resolveCapacity() {

		const S = this.S;
		const hardMax = this.hardMaxCapacity;
		let cap = S.capacity === 'auto' ? ( IS_MOBILE ? 262144 : 1048576 ) : Number( S.capacity );
		while ( cap < S.count && cap < hardMax ) cap = CAPACITIES.find( ( c ) => c > cap ) || hardMax;
		return Math.min( cap, hardMax );

	}

	// Largest crowd buffer this GPU allows (one vec4 per agent in one storage binding).
	get hardMaxCapacity() {

		const maxBinding = this.gpu.limits.maxStorageBufferBindingSize || 134217728;
		return Math.min( 4194304, Math.floor( maxBinding / 16 ) );

	}

	set( key, value ) {

		if ( this.renderTask ) return this._afterRendering( key, value, () => this.set( key, value ) );
		const meshes = this.crowd.meshes, trees = this.world.trees, lamps = this.world.lamps;
		if ( key === 'camera' ) this._leaveOverview();
		if ( key === 'scene' || key === 'seed' ) {

			if ( this.bench.running ) return Promise.reject( new Error( 'Stop the benchmark before changing scenes.' ) );
			if ( key === 'scene' && ! [ 'city', 'plaza' ].includes( value ) ) return Promise.reject( new Error( 'Unknown scene.' ) );
			this.S[ key ] = key === 'seed' ? String( value ).slice( 0, 128 ) : value;
			this.ui.sync();
			if ( this.scenePending || this.sceneKey !== sceneKey( this.S ) ) return regenerateScene( this );
			return;

		}
		if ( key === 'count' && value > this.crowd.capacity && this.S.capacity !== 'auto' ) {

			// growing past a fixed capacity: switch to the next size up
			this.S.capacity = CAPACITIES.find( ( c ) => c >= value ) || CAPACITIES[ CAPACITIES.length - 1 ];

		}

		this.S[ key ] = value;
		if ( key === 'camera' ) this._applyCamera();
		else if ( CROWD_KEYS.has( key ) ) this._applyCrowd();
		else if ( SHADING_KEYS.has( key ) ) {

			this._applyShading();
			this._applyCrowd();

		} else if ( WORLD_KEYS.has( key ) ) this._applyWorld();
		else if ( RES_KEYS.has( key ) ) {

			this.resize();
			this._applyPost();

		} else if ( POST_KEYS.has( key ) ) this._applyPost();
		else if ( PHYS_KEYS.has( key ) ) this._applyPhysics();

		const c = this.ui.controls.get( key );
		if ( c ) c.set( this.S[ key ] );
		if ( key === 'count' || key === 'capacity' ) this.ui.controls.get( 'capacity' )?.set( this.S.capacity );
		if ( key === 'camera' || SHADING_KEYS.has( key ) || WORLD_KEYS.has( key ) || RES_KEYS.has( key ) || POST_KEYS.has( key ) || PHYS_KEYS.has( key ) ||
			meshes !== this.crowd.meshes || trees !== this.world.trees || lamps !== this.world.lamps ) return this._prepareRendering();

	}

	applyAll( values ) {

		if ( this.renderTask ) return this._afterRendering( 'applyAll', values, () => this.applyAll( values ) );
		const next = { ...this.S, ...values };
		if ( this.bench.running && this.sceneKey !== sceneKey( next ) ) return Promise.reject( new Error( 'Stop the benchmark before changing scenes.' ) );
		Object.assign( this.S, values );
		if ( this.scenePending || this.sceneKey !== sceneKey( this.S ) ) return regenerateScene( this );
		this._applySettings();
		return this._prepareRendering();

	}

	_afterRendering( key, value, run ) {

		// Keep the last slider/preset value received while compiling. Replaying
		// every intermediate value would turn a quick drag into a long work queue.
		const pending = this.pendingRenderChanges || ( this.pendingRenderChanges = new Map() );
		const request = { value, run };
		pending.set( key, request );
		return this.renderTask.then( () => {

			if ( pending.get( key ) !== request ) return;
			pending.delete( key );
			return run();

		} );

	}

	_prepareRendering() {

		if ( this.boot.state.status !== 'running' ) return;
		if ( this.renderTask ) return this.renderTask;
		const status = document.getElementById( 'scene-status' ), label = status.textContent;
		this.renderPreparing = true;
		this.renderTask = Promise.resolve().then( async () => {

			if ( this.physicsStartup ) await this.physicsStartup;
			await prepareRendering( this, ( message ) => { status.textContent = message; } );

		} ).finally( () => {

			this.renderTask = null; this.renderPreparing = false;
			this._lastFrame = performance.now(); status.textContent = label;

		} );
		return this.renderTask;

	}

	_applySettings() {

		this._applyShading();
		this._applyCrowd();
		this._applyWorld();
		this._applyCamera( false );
		this.resize();
		this._applyPost();
		this._applyPhysics();
		this.ui.sync();

	}

	preset( id ) {

		const preset = PRESETS[ id ].values;
		const values = { ...defaults(), ...preset };
		// keep crowd size / camera / physics choices unless the preset sets them
		for ( const k of [ 'scene', 'seed', 'count', 'capacity', 'camera', 'physics', 'bodies', 'shape', 'behaviour', 'density', 'crowdMode' ] ) if ( ! ( k in preset ) ) values[ k ] = this.S[ k ];
		return this.applyAll( values );

	}

	get storageLimit() {

		return this.gpu.limits.maxStorageBuffersPerShaderStage ?? 8;

	}

	_applyCrowd() {

		applyCrowd( this );

	}

	_applyShading() {

		applyShading( this );

	}

	_applyWorld() {

		applyWorld( this );

	}

	_applyCamera( rebuildPost = true ) {

		applyCamera( this, rebuildPost );

	}

	_applyPost() {

		applyPost( this );

	}

	_applyPhysics() {

		applyPhysics( this );

	}

	// Standard benchmark: render exactly width x height pixels whatever the window
	// size or pixel ratio, letterboxed into the window. null restores normal sizing.
	setFixedResolution( res ) {

		this.fixedResolution = res ? { width: res.width, height: res.height } : null;
		this.resize();

	}

	resize() {

		const st = this.renderer.domElement.style;
		const fixed = this.fixedResolution;
		if ( fixed ) {

			const scale = Math.min( innerWidth / fixed.width, innerHeight / fixed.height );
			this.renderer.setPixelRatio( 1 );
			this.renderer.setSize( fixed.width, fixed.height, false );
			Object.assign( st, { position: 'absolute', width: `${ fixed.width * scale }px`, height: `${ fixed.height * scale }px`, left: `${ ( innerWidth - fixed.width * scale ) / 2 }px`, top: `${ ( innerHeight - fixed.height * scale ) / 2 }px` } );
			this.rig.setAspect( fixed.width / fixed.height );
			this.pixelRatio = 1;
			this.post.onResize();
			return;

		}

		Object.assign( st, { position: '', left: '', top: '' } );
		const S = this.S;
		const cap = S.maxDpr === 'native' ? DPR : Math.min( DPR, Number( S.maxDpr ) );
		const fsr = S.upscaler === 'fsr1' && S.renderScale < 1 && needsPost( S );
		const pr = cap * ( fsr ? 1 : S.renderScale );
		this.renderer.setPixelRatio( pr );
		this.renderer.setSize( innerWidth, innerHeight );
		this.rig.setAspect( innerWidth / innerHeight );
		this.pixelRatio = pr;
		this.post.onResize();

	}

	// --- input -----------------------------------------------------------------
	_bindButtons() {

		bindButtons( this );

	}

	_hotkey( e ) {

		hotkey( this, e );

	}

	action( a ) {

		if ( this.renderTask && [ 'regenerateCity', 'cityOverview', 'benchCrowd', 'benchFx', 'benchStandard' ].includes( a ) ) return this.renderTask.then( () => this.action( a ) );
		if ( this.scenePending && [ 'benchCrowd', 'benchFx', 'benchStandard' ].includes( a ) ) return Promise.reject( new Error( 'Wait for city generation before starting a benchmark.' ) );
		if ( [ 'rotL', 'rotR', 'recenter', 'zoomIn', 'zoomOut' ].includes( a ) ) this._leaveOverview();
		const rig = this.rig;
		switch ( a ) {

			case 'regenerateCity': if ( this.bench.running ) return Promise.reject( new Error( 'Stop the benchmark before regenerating.' ) ); this.S.scene = 'city'; return regenerateScene( this );
			case 'cityOverview': if ( this.world.city && ! this.bench.running ) { this.overview = true; this.rig.setBenchView( () => 1450 ); this._applyPost(); return this._prepareRendering(); } break;
			case 'rotL': rig.rotateStep( 1 ); break;
			case 'rotR': rig.rotateStep( - 1 ); break;
			case 'recenter': rig.recenter(); break;
			case 'zoomIn': rig.zoomBy( 0.75 ); break;
			case 'zoomOut': rig.zoomBy( 1.33 ); break;
			case 'hideUI': document.body.classList.toggle( 'hide-ui' ); break;
			case 'panel': this.ui.togglePanel(); break;
			case 'explode': this._needPhysics() && this.physics.explode( this.hero.pos ); break;
			case 'wrecking': this._needPhysics() && this.physics.dropWreckingBall( this.hero.pos, this.hero.heading ); break;
			case 'respawn': this._needPhysics() && this.physics.respawn(); break;
			case 'benchCrowd': return this.bench.findMaxCrowd( Number( this.ui.benchTarget.value ) );
			case 'benchFx': return this.bench.measureEffects();
			case 'benchStandard': return this.bench.standard();
			case 'benchStop': this.bench.stop(); break;
			case 'report': this._copy( this.report(), 'Report copied to clipboard' ); break;
			case 'share': this._copy( this.shareLink(), 'Settings link copied' ); break;

		}

	}

	_uiAction( run ) {

		Promise.resolve().then( run ).catch( ( error ) => this.ui.setWarnings( [ error.message ] ) );

	}

	_leaveOverview() {

		if ( ! this.overview || this.bench.running ) return;
		if ( this.renderTask ) {

			this.renderTask.then( () => this._leaveOverview() ).catch( ( error ) => this.ui.setWarnings( [ error.message ] ) );
			return;

		}
		this.overview = false;
		this.rig.setBenchView( null );
		this._applyPost();
		this._prepareRendering()?.catch( ( error ) => this.ui.setWarnings( [ error.message ] ) );

	}

	// Physics actions turn physics on first if needed.
	_needPhysics() {

		if ( this.S.physics && this.physics.ready ) return true;
		if ( ! this.S.physics ) this.set( 'physics', true );
		this.ui.setWarnings( [ 'Physics was off - turned it on. Press the button again once the bodies appear.' ] );
		return false;

	}

	async _copy( text, okMsg ) {

		try {

			await navigator.clipboard.writeText( text );
			this.ui.setBenchOutput( `<b>${okMsg}.</b><pre>${text.replace( /</g, '&lt;' )}</pre>` );

		} catch {

			this.ui.setBenchOutput( `<b>Copy this:</b><textarea readonly>${text.replace( /</g, '&lt;' )}</textarea>` );

		}

	}

	shareLink() {

		const base = defaults();
		const params = new URLSearchParams();
		for ( const [ k, v ] of Object.entries( this.S ) ) {

			if ( base[ k ] === v ) continue;
			params.set( k, typeof v === 'boolean' ? ( v ? '1' : '0' ) : String( v ) );

		}

		// Scene must be explicit when opening a shared link through a legacy alias.
		params.set( 'scene', this.S.scene );
		const url = new URL( location.href ); url.searchParams.set( 'engine', 'stress' ); url.hash = params.toString();
		return url.href;

	}

	report() {

		return buildReport( this );

	}

	// --- frame -----------------------------------------------------------------
	_updateHero( dt ) {

		updateHero( this, dt );

	}

	// One bad frame (e.g. a shader that fails to compile on this GPU) must not freeze
	// the app: report it in the warning bar and keep going.
	frame() {

		// Async preparation owns renderer state until every active chunk is ready.
		if ( this.renderPreparing ) return;
		try {

			this._frame();

		} catch ( e ) {

			console.error( e );
			const msg = 'Frame error: ' + ( e.message || e );
			if ( msg !== this._lastFrameError ) {

				this._lastFrameError = msg;
				this.ui.setWarnings( [ msg.slice( 0, 240 ) ] );

			}

		}

	}

	_frame() {

		const now = performance.now();
		const frameMs = now - this._lastFrame;
		this._lastFrame = now;
		const dt = Math.min( frameMs / 1000, 0.1 );
		const t = ( now - this._startTime ) / 1000;

		this._updateHero( dt );
		this.rig.update( dt, this.hero.pos, this.hero.heading );
		const cam = this.rig.camera;
		this.world.update( dt, this.rig.focus, cam, this.rig.viewExtent );
		this.crowd.update( dt, t, cam, this.renderer.domElement.height );
		this.physics.update( dt, this.hero.pos, this.hero.heading );
		// DOF focuses on the hero: distance along the view direction, and a focal range
		// that scales with zoom so the effect looks the same at every zoom level.
		const viewDir = cam.getWorldDirection( this._tmpV || ( this._tmpV = new THREE.Vector3() ) );
		const heroHead = ( this._tmpH || ( this._tmpH = new THREE.Vector3() ) ).set( this.hero.pos.x, 1.2, this.hero.pos.z );
		const focus = heroHead.sub( cam.position ).dot( viewDir );
		this.post.u.focus.value = focus;
		this.post.u.focalLength.value = this.rig.isOrtho ? this.rig.viewHeight * 0.3 : Math.max( 3, focus * 0.5 );

		this.bench.ballast.update(); // benchmark-only dummy GPU load, normally off
		if ( this.post.active ) this.post.render();
		else this.renderer.render( this.scene, cam );
		this.link.afterRender();

		const cpuMs = performance.now() - now;

		if ( this.gpu.timestamps && this.frameCount % 2 === 0 ) {

			this.renderer.resolveTimestampsAsync( 'render' ).catch( () => {} );
			this.renderer.resolveTimestampsAsync( 'compute' ).catch( () => {} );

		}

		this.frameCount ++;
		const s = this.stats;
		// Keep spikes after the smoothed FPS has recovered. Loading/preparation is
		// excluded, and frameMs stays unclamped even though simulation dt is capped.
		if ( this.boot.state.status === 'running' && document.visibilityState === 'visible' ) {

			s.worstFrameMs = Math.max( s.worstFrameMs, frameMs );
			s.worstCpuMs = Math.max( s.worstCpuMs, cpuMs );
			if ( frameMs > 50 ) s.framesOver50 ++;

		}
		const gpuMs = this.gpu.timestamps ? ( this.renderer.info.render.timestamp || 0 ) + ( this.renderer.info.compute.timestamp || 0 ) : 0;
		this.bench.onFrame( frameMs, gpuMs, cpuMs );
		this.graph.push( frameMs, gpuMs );
		s.frames ++;
		s.acc += frameMs;
		s.cpu += cpuMs;
		if ( now - s.last > 400 ) {

			s.fps = ( s.frames * 1000 ) / ( now - s.last );
			s.frameMs = s.acc / s.frames;
			s.cpuMs = s.cpu / s.frames;
			s.gpuRender = this.renderer.info.render.timestamp || 0;
			s.gpuCompute = this.renderer.info.compute.timestamp || 0;
			s.frames = 0;
			s.acc = s.cpu = 0;
			s.last = now;
			this._updateHud();
			this.graph.draw();

		}

	}

	_updateHud() {

		updateHud( this );

	}

}

export function initialize( context ) {

	return new App().init( context );

}
