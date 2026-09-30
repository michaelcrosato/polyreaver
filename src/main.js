// WebGPU crowd stress test - application wiring.

import * as THREE from 'three/webgpu';
import { ClusteredLighting } from 'three/addons/lighting/ClusteredLighting.js';
import { createDevice, describeAdapter } from './gpu.js';
import { Crowd } from './crowd/crowd.js';
import { World } from './world.js';
import { CameraRig } from './camera.js';
import { Input } from './input.js';
import { PostFX, needsPost } from './post.js';
import { PhysicsDemo } from './physics.js';
import { isCel, makeCelMaterial } from './cel.js';
import { defaults, PRESETS, CAPACITIES, findItem, formatCount } from './features.js';
import { UI, Graph } from './ui.js';
import { Bench } from './bench.js';

const TONE = {
	none: THREE.NoToneMapping, linear: THREE.LinearToneMapping, reinhard: THREE.ReinhardToneMapping,
	cineon: THREE.CineonToneMapping, aces: THREE.ACESFilmicToneMapping, agx: THREE.AgXToneMapping, neutral: THREE.NeutralToneMapping
};

const IS_MOBILE = matchMedia( '(pointer: coarse)' ).matches || /Android|iPhone|iPad/i.test( navigator.userAgent );
const DPR = window.devicePixelRatio || 1;

const CROWD_KEYS = new Set( [ 'count', 'capacity', 'tier', 'path', 'lod', 'anim', 'animBlend', 'behaviour', 'density', 'activity', 'speed', 'outlines', 'outlineWidth', 'rim', 'blobShadows', 'crowdShadows' ] );
const SHADING_KEYS = new Set( [ 'shading', 'hemi', 'env', 'shadows', 'pointLights', 'clustered' ] );
const WORLD_KEYS = new Set( [ 'sky', 'fog', 'props', 'groundDetail' ] );
const RES_KEYS = new Set( [ 'maxDpr', 'renderScale', 'upscaler' ] );
const POST_KEYS = new Set( [ 'aa', 'toneMapping', 'exposure', 'ao', 'bloom', 'dof', 'motionBlur', 'ssr', 'ssgi', 'grading', 'vignette', 'grain', 'chromatic', 'sharpen', 'stylize' ] );
const PHYS_KEYS = new Set( [ 'physics', 'crowdMode', 'rapierAgents', 'agentRadius', 'proxies', 'proxyCount', 'knockdown', 'physProps', 'propsDynamic', 'bodies', 'shape', 'sizeVar', 'spawn', 'restitution', 'friction', 'gravity', 'hz', 'iterations', 'ccd', 'sleep', 'recycle', 'physDebug' ] );

function fatal( title, detail ) {

	const el = document.getElementById( 'fatal' );
	el.querySelector( 'h2' ).textContent = title;
	el.querySelector( '.detail' ).textContent = detail;
	el.style.display = 'flex';
	document.title = 'DONE';
	window.__fatal = title + ': ' + detail;

}

function readHash() {

	const out = {};
	const params = new URLSearchParams( location.hash.slice( 1 ) );
	const base = defaults();
	for ( const [ k, raw ] of params ) {

		if ( k === 'preset' && PRESETS[ raw ] ) {

			Object.assign( out, PRESETS[ raw ].values );
			continue;

		}

		if ( ! ( k in base ) ) continue;
		const d = base[ k ];
		out[ k ] = typeof d === 'number' ? Number( raw ) : typeof d === 'boolean' ? raw === '1' || raw === 'true' : raw;

	}

	return out;

}

class App {

	async init() {

		let gpu;
		try {

			gpu = await createDevice();

		} catch ( e ) {

			fatal( 'WebGPU is not available', e.message + '\n\nThis demo is WebGPU-only on purpose (no WebGL fallback). Try Chrome/Edge 113+, Safari 26+ (iOS 26 / macOS Tahoe), Firefox 141+ (Windows) or Chrome for Android 121+, over https:// or localhost.' );
			return;

		}

		this.gpu = gpu;
		this.S = { ...defaults(), ...readHash() };
		this.frameCount = 0;

		const renderer = new THREE.WebGPURenderer( { device: gpu.device, antialias: false, trackTimestamp: gpu.timestamps } );
		this.renderer = renderer;
		renderer.setPixelRatio( 1 );
		renderer.setSize( innerWidth, innerHeight );
		document.getElementById( 'app' ).appendChild( renderer.domElement );
		await renderer.init();
		renderer.onDeviceLost = ( info ) => fatal( 'GPU device lost', `${info.message}\n\nThe GPU driver reset or ran out of memory (common when pushing huge crowds on phones). Reload the page and use a smaller crowd / capacity.` );
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
			onChange: ( k, v ) => this.set( k, v ),
			onPreset: ( id ) => this.preset( id ),
			onAction: ( a ) => this.action( a )
		} );
		this.bench = new Bench( this );
		this.graph = new Graph( document.getElementById( 'graph' ) );

		if ( IS_MOBILE ) document.body.classList.add( 'touch' );
		this._bindButtons();
		this.input.onKey = ( e ) => this._hotkey( e );
		this.rig.onUserInput = () => {};

		this.applyAll( this.S );
		window.addEventListener( 'resize', () => this.resize() );

		this.stats = { frames: 0, acc: 0, cpu: 0, last: performance.now(), fps: 0, frameMs: 0, cpuMs: 0, gpuRender: 0, gpuCompute: 0 };
		this._lastFrame = performance.now();
		this._startTime = performance.now();
		renderer.setAnimationLoop( () => this.frame() );
		window.app = this;

	}

	// --- settings ------------------------------------------------------------
	resolveCapacity() {

		const S = this.S;
		const maxBinding = this.gpu.limits.maxStorageBufferBindingSize || 134217728;
		const hardMax = Math.min( 4194304, Math.floor( maxBinding / 16 ) );
		let cap = S.capacity === 'auto' ? ( IS_MOBILE ? 262144 : 1048576 ) : Number( S.capacity );
		while ( cap < S.count && cap < hardMax ) cap = CAPACITIES.find( ( c ) => c > cap ) || hardMax;
		return Math.min( cap, hardMax );

	}

	get maxCapacity() {

		return this.crowd.capacity;

	}

	set( key, value ) {

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

	}

	applyAll( values ) {

		Object.assign( this.S, values );
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
		for ( const k of [ 'count', 'capacity', 'camera', 'physics', 'bodies', 'shape', 'behaviour', 'density', 'crowdMode' ] ) if ( ! ( k in preset ) ) values[ k ] = this.S[ k ];
		this.applyAll( values );

	}

	get storageLimit() {

		return this.gpu.limits.maxStorageBuffersPerShaderStage ?? 8;

	}

	_applyCrowd() {

		const S = this.S, crowd = this.crowd;
		// GPU-driven culling and GPU collisions bind up to 8 storage buffers per shader.
		if ( this.storageLimit < 8 && S.path === 'gpu' ) {

			S.path = 'direct';
			this.ui.controls.get( 'path' )?.set( 'direct' );
			this.ui.setWarnings( [ `This GPU allows only ${this.storageLimit} storage buffers per shader - GPU-driven rendering needs 8, using direct.` ] );

		}

		const cap = this.resolveCapacity();
		if ( cap !== crowd.capacity ) crowd.setCapacity( cap );
		const u = crowd.u;
		u.density.value = S.density;
		u.activity.value = S.activity;
		u.speedScale.value = S.speed;
		u.behaviour.value = Number( S.behaviour );
		const shadowsOn = S.shadows !== 'off';
		crowd.set( {
			tier: Number( S.tier ), path: S.path, animSystem: S.anim, animBlend: S.animBlend, outlines: S.outlines, rim: S.rim,
			blobShadows: S.blobShadows, lodEnabled: S.lod, materialKind: S.shading,
			castShadow: shadowsOn && S.crowdShadows, receiveShadow: shadowsOn
		} );
		u.outline.value = S.outlineWidth;
		crowd.setCount( S.count );
		this.world.setRadius( crowd.radius );

	}

	_applyShading() {

		const S = this.S, renderer = this.renderer, world = this.world;
		const wantClustered = S.clustered;
		const isClustered = renderer.lighting !== this.defaultLighting;
		if ( wantClustered !== isClustered ) renderer.lighting = wantClustered ? new ClusteredLighting( 1024 ) : this.defaultLighting;

		const key = `${S.shading}|${S.shadows}|${S.clustered}`;
		if ( key !== this._shadingKey ) {

			const shadowChanged = ! this._shadingKey || this._shadingKey.split( '|' )[ 1 ] !== S.shadows;
			this._shadingKey = key;
			world.setShadows( S.shadows );
			if ( shadowChanged ) world.recreateSun();
			world.setShading( S.shading );
			this.physics.setShading( S.shading );
			this.physics.setShadows( S.shadows !== 'off' );
			this.crowd.materialKind = null; // force the crowd to rebuild its materials
		}

		world.setHemisphere( S.hemi );
		world.setEnvironment( S.env );
		if ( Number( S.pointLights ) !== world.pointLights.length ) world.setPointLights( Number( S.pointLights ) );

	}

	_applyWorld() {

		const S = this.S, world = this.world;
		if ( world.skyMode !== S.sky ) world.setSky( S.sky );
		world.setFog( S.fog );
		world.setProps( S.props );
		if ( world.groundDetail !== S.groundDetail ) world.setGroundDetail( S.groundDetail );

	}

	_applyCamera( rebuildPost = true ) {

		if ( this.rig.mode !== this.S.camera ) this.rig.setMode( this.S.camera );
		this.resize();
		if ( rebuildPost ) this._applyPost();

	}

	_applyPost() {

		const S = this.S, renderer = this.renderer;
		renderer.toneMapping = TONE[ S.toneMapping ] ?? THREE.NoToneMapping;
		renderer.toneMappingExposure = S.exposure;
		// MSAA for the direct (no post) path lives on the renderer / canvas.
		renderer._samples = ( S.aa === 'msaa' && ! needsPost( S ) ) ? 4 : 0;
		this.world.setWet( S.ssr );
		const warnings = this.post.build( S, this.rig.camera );
		if ( S.ssr && ( S.shading !== 'standard' && S.shading !== 'physical' ) ) warnings.push( 'SSR needs Standard or Physical shading to reflect anything' );
		if ( ( S.shading === 'unlit' ) && ( S.shadows !== 'off' || S.pointLights > 0 || S.env ) ) warnings.push( 'Unlit shading ignores lights, shadows and environment - pick a lit shading model' );
		this.ui.setWarnings( warnings );

	}

	_applyPhysics() {

		const S = this.S, physics = this.physics;
		if ( this.storageLimit < 8 && S.crowdMode !== 'off' ) {

			S.crowdMode = 'off';
			this.ui.controls.get( 'crowdMode' )?.set( 'off' );
			this.ui.setWarnings( [ `This GPU allows only ${this.storageLimit} storage buffers per shader - GPU crowd collisions need 8, so they are off.` ] );

		}

		physics.configure( {
			bodies: Number( S.bodies ), shape: S.shape, sizeVar: S.sizeVar, spawn: S.spawn, restitution: S.restitution,
			friction: S.friction, gravity: S.gravity, hz: Number( S.hz ), iterations: Number( S.iterations ), ccd: S.ccd,
			sleep: S.sleep, recycle: S.recycle, props: S.physProps, propsDynamic: S.propsDynamic, crowdMode: S.crowdMode, rapierAgents: Number( S.rapierAgents ),
			proxies: S.proxies, proxyCount: Number( S.proxyCount ), agentRadius: S.agentRadius, knockdown: S.knockdown, debug: S.physDebug
		} );
		if ( S.physics && ! physics.enabled ) {

			physics.heroHeading = this.hero.heading;
			physics.enable( this.hero.pos ).then( () => physics.setShadows( S.shadows !== 'off' ) ).catch( ( e ) => {

				console.error( e );
				this.ui.setWarnings( [ 'Rapier failed to load: ' + e.message ] );

			} );

		} else if ( ! S.physics && physics.enabled ) physics.disable();

	}

	resize() {

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

		for ( const btn of document.querySelectorAll( '[data-action]' ) ) {

			const a = btn.dataset.action;
			if ( a === 'run' ) {

				btn.addEventListener( 'click', () => {

					this.input.run = ! this.input.run;
					btn.classList.toggle( 'on', this.input.run );

				} );

			} else if ( [ 'wave', 'cheer', 'dance' ].includes( a ) ) {

				const on = ( e ) => {

					e.preventDefault();
					this.input.action = a;

				};

				const off = () => ( this.input.action = null );
				btn.addEventListener( 'pointerdown', on );
				btn.addEventListener( 'pointerup', off );
				btn.addEventListener( 'pointerleave', off );
				btn.addEventListener( 'pointercancel', off );

			} else {

				btn.addEventListener( 'click', () => this.action( a ) );

			}

		}

	}

	_hotkey( e ) {

		const map = { KeyQ: 'rotL', KeyE: 'rotR', KeyC: 'recenter', KeyH: 'hideUI', KeyP: 'panel', Equal: 'zoomIn', Minus: 'zoomOut', KeyX: 'explode' };
		if ( map[ e.code ] ) this.action( map[ e.code ] );
		const modes = [ 'iso', 'top', 'orbit', 'chase', 'eye' ];
		const n = parseInt( e.key );
		if ( n >= 1 && n <= 5 ) this.set( 'camera', modes[ n - 1 ] );

	}

	action( a ) {

		const rig = this.rig;
		switch ( a ) {

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
			case 'benchCrowd': this.bench.findMaxCrowd( Number( this.ui.benchTarget.value ) ); break;
			case 'benchFx': this.bench.measureEffects(); break;
			case 'benchStop': this.bench.stop(); break;
			case 'report': this._copy( this.report(), 'Report copied to clipboard' ); break;
			case 'share': this._copy( this.shareLink(), 'Settings link copied' ); break;

		}

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

		return location.href.split( '#' )[ 0 ] + '#' + params.toString();

	}

	report() {

		const g = this.gpu, s = this.stats, S = this.S;
		const base = defaults();
		const changed = Object.entries( S ).filter( ( [ k, v ] ) => base[ k ] !== v ).map( ( [ k, v ] ) => `  ${findItem( k )?.label || k}: ${v}` );
		const lines = [
			'WebGPU Crowd Stress Test - report',
			new Date().toISOString(),
			'',
			'GPU: ' + describeAdapter( g.info ),
			`WebGPU feature level: ${g.featureLevel} · timestamps: ${g.timestamps ? 'yes' : 'no'} · three.js r${THREE.REVISION}`,
			`Limits: maxStorageBufferBindingSize ${( g.limits.maxStorageBufferBindingSize / 1048576 ).toFixed( 0 )} MB, storage buffers in vertex stage ${g.limits.maxStorageBuffersInVertexStage ?? 'n/a'}`,
			'Browser: ' + navigator.userAgent,
			`Screen: ${innerWidth}x${innerHeight} CSS px @ DPR ${DPR} -> rendering ${this.renderer.domElement.width}x${this.renderer.domElement.height}`,
			'',
			`Now: ${s.fps.toFixed( 1 )} fps · frame ${s.frameMs.toFixed( 2 )} ms · CPU ${s.cpuMs.toFixed( 2 )} ms` + ( g.timestamps ? ` · GPU ${( s.gpuRender + s.gpuCompute ).toFixed( 2 )} ms` : '' ),
			`Agents: ${S.count} · model ${this.crowd.models[ S.tier ].id} (${this.crowd.models[ S.tier ].triangles} tris) · path ${S.path}`,
			`Triangles/frame (all passes): ${formatCount( this._tris || 0 )}`,
			'',
			'Settings changed from default:',
			...( changed.length ? changed : [ '  (none - bare baseline)' ] )
		];
		const r = this.bench.results;
		if ( r.crowd ) {

			lines.push( '', `Max crowd @ ${r.crowd.targetFps} fps: ${r.crowd.maxAgents} agents (~${formatCount( r.crowd.trianglesPerFrame )} crowd tris), model ${r.crowd.model}, path ${r.crowd.path}` );
			lines.push( ...r.crowd.log.map( ( l ) => '  ' + l ) );

		}

		if ( r.fx ) {

			lines.push( '', 'Effect costs (GPU ms delta where available, else frame ms delta):' );
			for ( const row of [ ...r.fx ].sort( ( a, b ) => ( b.gpuDelta ?? b.frameDelta ) - ( a.gpuDelta ?? a.frameDelta ) ) ) {

				const d = row.gpuDelta ?? row.frameDelta;
				lines.push( `  ${row.label.padEnd( 34 )} ${( d >= 0 ? '+' : '' ) + d.toFixed( 2 )} ms  (${row.fps.toFixed( 0 )} fps)` );

			}

		}

		lines.push( '', 'Settings link: ' + this.shareLink() );
		return lines.join( '\n' );

	}

	// --- frame -----------------------------------------------------------------
	_updateHero( dt ) {

		const hero = this.hero;
		const inp = this.input.read();
		const fwd = new THREE.Vector3(), right = new THREE.Vector3();
		this.rig.groundBasis( fwd, right );
		const move = right.multiplyScalar( inp.x ).add( fwd.multiplyScalar( inp.y ) );
		const mag = Math.min( move.length(), 1 );
		if ( mag > 0.08 ) {

			const target = Math.atan2( move.x, move.z );
			let d = target - hero.heading;
			d = Math.atan2( Math.sin( d ), Math.cos( d ) );
			hero.heading += d * Math.min( 1, dt * 12 );
			hero.speed = ( inp.run ? 4.5 : 1.7 ) * mag;
			hero.state = inp.run ? 2 : 1;
			const delta = { x: Math.sin( hero.heading ) * hero.speed * dt, z: Math.cos( hero.heading ) * hero.speed * dt };
			// With physics on, the hero is a Rapier character controller: it slides
			// along trees / the monument and shoves bodies instead of passing through.
			if ( ! this.physics.moveHero( hero.pos, delta ) ) {

				hero.pos.x += delta.x;
				hero.pos.z += delta.z;

			}
			const r = Math.hypot( hero.pos.x, hero.pos.z ), maxR = this.world.radius + 40;
			if ( r > maxR ) hero.pos.multiplyScalar( maxR / r );
			this.rig.follow = true;
			this.rig.panOffset.multiplyScalar( Math.max( 0, 1 - dt * 3 ) );

		} else {

			hero.speed = 0;
			hero.state = inp.action === 'wave' ? 3 : inp.action === 'cheer' ? 4 : inp.action === 'dance' ? 5 : 0;

		}

		const u = this.crowd.u;
		u.heroPos.value.set( hero.pos.x, hero.pos.z );
		u.heroHeading.value = ( ( hero.heading % ( Math.PI * 2 ) ) + Math.PI * 2 ) % ( Math.PI * 2 );
		u.heroState.value = hero.state;
		u.heroSpeed.value = hero.speed;
		this.heroRing.position.set( hero.pos.x, 0.04, hero.pos.z );

	}

	// One bad frame (e.g. a shader that fails to compile on this GPU) must not freeze
	// the app: report it in the warning bar and keep going.
	frame() {

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

		if ( this.post.active ) this.post.render();
		else this.renderer.render( this.scene, cam );

		const cpuMs = performance.now() - now;

		if ( this.gpu.timestamps && this.frameCount % 2 === 0 ) {

			this.renderer.resolveTimestampsAsync( 'render' ).catch( () => {} );
			this.renderer.resolveTimestampsAsync( 'compute' ).catch( () => {} );

		}

		this.frameCount ++;
		const s = this.stats;
		const gpuMs = this.gpu.timestamps ? ( this.renderer.info.render.timestamp || 0 ) + ( this.renderer.info.compute.timestamp || 0 ) : 0;
		this.bench.onFrame( frameMs, gpuMs );
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

		const s = this.stats, S = this.S, g = this.gpu;
		const cs = this.crowd.stats();
		const shadowsOn = S.shadows !== 'off';
		const castTris = shadowsOn && S.crowdShadows ? cs.instances * this.crowd.models[ S.tier ].triangles : 0;
		const propTris = this.world.propTriangles * ( shadowsOn ? 2 : 1 );
		const physTris = this.physics.triangles * ( shadowsOn ? 2 : 1 );
		const tris = cs.tris + castTris + propTris + physTris;
		this._tris = tris;
		const info = this.renderer.info;
		const w = this.renderer.domElement.width, hgt = this.renderer.domElement.height;
		const fpsClass = s.fps >= 55 ? 'good' : s.fps >= 28 ? 'ok' : 'bad';
		const gpuLine = g.timestamps
			? `GPU <b>${( s.gpuRender + s.gpuCompute ).toFixed( 2 )}</b> ms <span class="dim">(render ${s.gpuRender.toFixed( 2 )} + compute ${s.gpuCompute.toFixed( 2 )})</span>`
			: '<span class="dim">GPU timing unavailable (no timestamp-query)</span>';
		const vis = S.path === 'gpu' ? ` · visible <b>${formatCount( cs.instances )}</b> <span class="dim">[${cs.visibleByTier.slice( 0, Number( S.tier ) + 1 ).map( formatCount ).join( '/' )}]</span>` : '';
		let phys = '';
		if ( this.physics.enabled && this.physics.ready ) {

			const ps = this.physics.stats();
			const crowdLine = S.crowdMode === 'gpu'
				? `GPU crowd collisions${S.proxies ? ` · ${ps.proxies} proxies` : ''}`
				: S.crowdMode === 'rapier' ? `${formatCount( ps.agents )} Rapier agents` : 'crowd collisions off';
			phys = `<div>Rapier ${this.physics.version}: <b>${formatCount( ps.bodies )}</b> bodies · <b>${formatCount( ps.colliders )}</b> colliders · step <b>${ps.stepMs.toFixed( 2 )}</b> ms (${ps.steps}×) · sync ${ps.syncMs.toFixed( 2 )} ms</div>` +
				`<div class="x">${crowdLine}${ps.readbackMs ? ` · GPU→CPU readback ${ps.readbackMs.toFixed( 1 )} ms` : ''}</div>`;

		}

		const animBytes = cs.animBytes ? ` · ${( cs.animBytes / 1048576 ).toFixed( cs.animBytes > 1048576 ? 0 : 2 )} MB` : '';
		const animLine = `<div class="x">animation <b>${S.anim}</b>${animBytes}${S.anim === 'skeletal' && this.crowd.animSystem !== 'skeletal' ? ' (unsupported here, using keyframe)' : ''}${this.crowd.skeletalLimit < S.count ? ` · bones for first ${formatCount( this.crowd.skeletalLimit )}` : ''}</div>`;
		this.ui.setHud(
			`<div class="fps ${fpsClass}">${s.fps.toFixed( 0 )}<small> fps</small></div>` +
			`<div>frame <b>${s.frameMs.toFixed( 1 )}</b> ms · CPU <b>${s.cpuMs.toFixed( 2 )}</b> ms</div>` +
			`<div>${gpuLine}</div>` +
			`<div>agents <b>${formatCount( S.count )}</b>${vis}</div>` +
			`<div>triangles/frame <b>${formatCount( Math.round( tris ) )}</b> <span class="dim">(crowd ${formatCount( cs.tris + castTris )})</span></div>` +
			`<div class="x">draw calls <b>${info.render.drawCalls}</b> · passes ${this.post.active ? this.post.passes : 1}${shadowsOn ? ' + shadow' : ''}</div>` +
			`<div class="dim x">${w}×${hgt} px (${this.pixelRatio.toFixed( 2 )}x)</div>` +
			animLine + phys +
			`<div class="dim more">${describeAdapter( g.info )}<br>feature level ${g.featureLevel} · three r${THREE.REVISION} · capacity ${formatCount( this.crowd.capacity )}</div>` );

	}

}

new App().init().catch( ( e ) => {

	console.error( e );
	fatal( 'Startup failed', e.stack || String( e ) );

} );
