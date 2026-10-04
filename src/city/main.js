import * as THREE from 'three/webgpu';
import CityWorker from './worker.js?worker&inline';
import layout from '../boot/layouts/city.html?raw';
import { mountLayout } from '../boot/layout.js';
import { Crowd } from '../crowd/crowd.js';
import { CameraRig, CAMERA_MODES } from '../camera.js';
import { Input } from '../input.js';
import { CityWorld } from './render/world.js';
import { CityCrowdProfile } from './gpu/profile.js';
import { CityCollision } from './player.js';
import { CityTraffic } from './traffic.js';
import { cityConfig } from './config.js';
import { generateCityAsync } from './generate.js';
import { validateCity } from './validate.js';
import { initOptions, attachOptions } from './options.js';
import { assignPopulation } from './population.js';
import { referenceRoute } from './navigation.js';

const $ = ( id ) => document.getElementById( id );

class CityApp {

	async init( { gpu, boot } ) {

		mountLayout( layout );
		this.boot = boot;

		this.errors = []; this.generation = 0; this.frameCount = 0; this.samples = []; this.paused = false; this.selected = null; this.readbackPending = false;
		this.gpu = gpu;
		this.gpu.device.addEventListener( 'uncapturederror', ( event ) => this.fail( new Error( `WebGPU: ${event.error.message}` ) ) );
		if ( this.gpu.limits.maxStorageBuffersPerShaderStage < 8 ) throw new Error( 'City navigation requires eight storage bindings per compute stage.' );
		this.renderer = new THREE.WebGPURenderer( { device: this.gpu.device, antialias: false, trackTimestamp: this.gpu.timestamps } );
		await boot.step( 'REN', 'Initializing city renderer', 55, () => this.renderer.init() );
		boot.stop = () => this.renderer.setAnimationLoop( null ); this.renderer.setPixelRatio( 1 ); this.renderer.setSize( innerWidth, innerHeight ); $( 'app' ).appendChild( this.renderer.domElement );
		this.renderer.onDeviceLost = ( info ) => this.fail( new Error( `GPU device lost: ${info.message}` ) );
		this.scene = new THREE.Scene(); this.scene.background = new THREE.Color( 0x9ab1b9 );
		this.rig = new CameraRig( this.renderer.domElement ); this.rig.setAspect( innerWidth / innerHeight );
		this.rig.viewHeight = this.rig.viewHeightTarget = 130;
		this.input = new Input( $( 'joystick' ), $( 'knob' ) );
		this.hero = { pos: new THREE.Vector3(), heading: Math.PI, speed: 0, state: 0 };
		this.tmpForward = new THREE.Vector3(); this.tmpRight = new THREE.Vector3(); this.tmpMove = new THREE.Vector3(); this.raycaster = new THREE.Raycaster();
		this.cameraOrigin = new THREE.Vector3(); this.cameraDirection = new THREE.Vector3(); this.cameraHit = new THREE.Vector3(); this.cameraBox = new THREE.Box3(); this.cameraRay = new THREE.Ray();
		this.labelPoint = new THREE.Vector3(); this.districtLabels = [];
		this.marker = new THREE.Mesh( new THREE.RingGeometry( .5, .8, 12 ).rotateX( - Math.PI / 2 ), new THREE.MeshBasicNodeMaterial( { color: 0xffdc76, depthTest: false } ) ); this.marker.renderOrder = 5; this.scene.add( this.marker );
		this.routeLine = null;
		initOptions( this );
		this.bind();
		const hash = new URLSearchParams( location.hash.slice( 1 ) );
		this.config = cityConfig( { seed: hash.get( 'seed' ) || 'harbor-100k', population: Number( hash.get( 'population' ) || this.S.count ) } );
		this.paused = hash.get( 'paused' ) === '1';
		await boot.step( 'WORLD', 'Generating city and citizens', 70, () => this.regenerate( this.config ), 120000 );
		this.lastFrame = performance.now(); this.lastHud = 0; this.lastTrafficTime = 0;

		window.city = this;
		$( 'loading' ).hidden = true;
		return { frame: () => this.frame(), start: () => this.renderer.setAnimationLoop( () => this.frame() ), stop: () => this.renderer.setAnimationLoop( null ) };

	}

	bind() {

		for ( const tab of [ 'city', 'options' ] ) document.getElementById( tab + '-tab' ).onclick = () => {

			for ( const id of [ 'city', 'options' ] ) {

				document.getElementById( id + '-controls' ).hidden = id !== tab;
				document.getElementById( id + '-tab' ).setAttribute( 'aria-selected', String( id === tab ) );

			}

		};

		for ( const tab of [ 'city', 'options' ] ) document.getElementById( tab + '-tab' ).onkeydown = ( event ) => {

			if ( [ 'ArrowLeft', 'ArrowRight', 'Home', 'End' ].includes( event.key ) ) {

				event.preventDefault();
				const next = event.key === 'Home' ? 'city' : event.key === 'End' ? 'options' : tab === 'city' ? 'options' : 'city';
				const button = document.getElementById( next + '-tab' ); button.click(); button.focus();

			}

		};
		for ( const mode of CAMERA_MODES ) { const option = document.createElement( 'option' ); option.value = mode.id; option.textContent = mode.label; $( 'camera' ).appendChild( option ); }
		$( 'camera' ).onchange = () => this.cameraMode( $( 'camera' ).value );
		$( 'regenerate' ).onclick = () => this.regenerate( { seed: $( 'seed' ).value, population: Number( $( 'population' ).value ) } ).catch( ( e ) => this.fail( e ) );
		$( 'population' ).onchange = () => this.regenerate( { population: Number( $( 'population' ).value ) } ).catch( ( e ) => this.fail( e ) );
		$( 'pause' ).onclick = () => this.pause( ! this.paused );
		$( 'overview' ).onclick = () => this.overview();
		$( 'recenter' ).onclick = () => { this.rig.setBenchView( null ); this.rig.recenter(); this.rig.viewHeightTarget = 130; };
		$( 'quality' ).onchange = () => this.set( 'tier', Number( $( 'quality' ).value ) ).catch( ( e ) => this.ui.setWarnings( [ e.message ] ) );
		$( 'panel-toggle' ).onclick = () => $( 'panel' ).classList.toggle( 'collapsed' );
		$( 'report' ).onclick = async () => {

			const report = JSON.stringify( this.describe(), null, 2 );
			try { await navigator.clipboard.writeText( report ); $( 'status' ).textContent = 'City report copied'; }
			catch { $( 'report-text' ).value = report; $( 'report-text' ).hidden = false; }

		};
		$( 'benchmark' ).onclick = () => this.benchmark().then( ( report ) => { $( 'report-text' ).hidden = false; $( 'report-text' ).value = JSON.stringify( report, null, 2 ); } ).catch( ( e ) => { $( 'status' ).textContent = e.message; this.ui.setWarnings( [ e.message ] ); } );
		this.input.onKey = ( e ) => {

			if ( /^Digit[1-5]$/.test( e.code ) ) this.cameraMode( CAMERA_MODES[ Number( e.code.slice( - 1 ) ) - 1 ].id );
			if ( e.code === 'KeyM' || e.code === 'Tab' ) { e.preventDefault(); this.overview(); }
			if ( e.code === 'KeyC' ) { this.rig.setBenchView( null ); this.rig.recenter(); this.rig.viewHeightTarget = 130; }
			if ( e.code === 'KeyP' ) this.pause( ! this.paused );
			if ( e.code === 'KeyH' ) document.body.classList.toggle( 'hide-ui' );
			if ( e.code === 'KeyQ' ) this.rig.rotateStep( 1 ); if ( e.code === 'KeyE' ) this.rig.rotateStep( - 1 );

		};
		let pointerStart;
		this.renderer.domElement.addEventListener( 'pointerdown', ( e ) => { pointerStart = [ e.clientX, e.clientY ]; } );
		this.renderer.domElement.addEventListener( 'pointerup', ( e ) => {

			if ( ! pointerStart || Math.hypot( e.clientX - pointerStart[ 0 ], e.clientY - pointerStart[ 1 ] ) > 4 || e.button !== 0 || ! this.world ) return;
			this.raycaster.setFromCamera( new THREE.Vector2( e.clientX / innerWidth * 2 - 1, 1 - e.clientY / innerHeight * 2 ), this.rig.camera );
			const hit = this.raycaster.intersectObjects( this.world.buildingMeshes )[ 0 ];
			if ( hit ) this.selectBuilding( hit.object.userData.buildings[ hit.instanceId ].id );

		} );
		window.addEventListener( 'resize', () => { if ( ! this.benchmarking ) this.resize(); } );
		document.addEventListener( 'visibilitychange', () => { this.lastFrame = performance.now(); if ( this.profile ) this.profile.accumulator = 0; } );
		$( 'minimap' ).onclick = () => this.overview();

	}

	async generate( config, id ) {

		this.worker?.terminate();
		this.cancelGeneration?.();
		return new Promise( ( resolve, reject ) => {

			this.cancelGeneration = () => reject( new Error( 'Generation superseded' ) );
			const fallback = () => {

				this.generationMode = 'cooperative main thread';
				generateCityAsync( config, ( step, progress ) => { if ( id === this.generation ) $( 'status' ).textContent = `${step} · ${Math.round( progress * 100 )}%`; }, () => id !== this.generation )
					.then( ( city ) => { this.cancelGeneration = null; resolve( city ); }, reject );

			};
			try {

				const worker = new CityWorker(); this.worker = worker;
				this.generationMode = 'worker';
				worker.onmessage = ( { data } ) => {

					if ( id !== this.generation || data.id !== id ) return;
					if ( data.step ) { $( 'status' ).textContent = `${data.step} · ${Math.round( data.progress * 100 )}%`; return; }
					worker.terminate(); this.worker = null; this.cancelGeneration = null;
					if ( data.error ) reject( new Error( data.error ) ); else resolve( data.city );

				};
				worker.onerror = ( event ) => { event.preventDefault(); worker.terminate(); this.worker = null; fallback(); };
				worker.postMessage( { id, config } );

			} catch {

				// A local-file browser may forbid blob workers. Keep a tested fallback.
				fallback();

			}

		} );

	}

	async regenerate( options = {} ) {

		if ( this.benchmarking ) throw new Error( 'Wait for the benchmark to finish before regenerating the city.' );
		const config = cityConfig( { ...this.config, ...options } ), id = ++ this.generation, start = performance.now();
		$( 'status' ).textContent = 'Generating city…';
		const city = await this.generate( config, id );
		if ( id !== this.generation ) return;
		if ( this.S.capacity !== 'auto' ) city.population = assignPopulation( city, config.population, Math.min( this.maxBufferCapacity, Math.max( Number( this.S.capacity ), city.population.capacity ) ) );
		const staging = new THREE.Scene(), profile = new CityCrowdProfile( city );
		let world, crowd, traffic;
		try {

			world = new CityWorld( city, staging );
			crowd = new Crowd( this.renderer, staging, { profile, capacity: city.population.capacity, count: city.population.count + 1, limits: this.gpu.limits } );
			this.renderer.compute( [ profile.upload, profile.clearGrid ] );
			traffic = new CityTraffic( city, staging );

		} catch ( e ) { crowd?.dispose(); world?.dispose(); traffic?.dispose(); throw e; }
		this.physics?.dispose(); this.physicsStartup = null;
		this.crowd?.dispose(); this.world?.dispose(); this.traffic?.dispose(); this.clearRoute();
		for ( const child of [ ...staging.children ] ) this.scene.add( child ); world.scene = crowd.scene = traffic.scene = this.scene;
		this.data = city; this.world = world; this.profile = profile; this.crowd = crowd; this.traffic = traffic; this.collision = new CityCollision( city ); this.config = config;
		this.hero.pos.set( city.heroSpawn.x, 0, city.heroSpawn.z ); this.rig.focus.copy( this.hero.pos ); this.rig.recenter(); this.rig.setBenchView( null );
		profile.paused = this.paused;
		await attachOptions( this );
		this.generationMs = performance.now() - start;
		$( 'seed' ).value = config.seed; $( 'population' ).value = String( config.population );
		if ( ! [ ...$( 'population' ).options ].some( ( o ) => Number( o.value ) === config.population ) ) {

			const option = document.createElement( 'option' ); option.value = String( config.population ); option.textContent = config.population.toLocaleString(); $( 'population' ).appendChild( option ); $( 'population' ).value = option.value;

		}
		$( 'status' ).textContent = `${city.buildings.length.toLocaleString()} buildings · ${city.districts.length} neighborhoods · ${this.generationMs.toFixed( 0 )} ms`;
		this.pause( this.paused ); this.selected = null; this.drawMap();
		$( 'benchmark' ).disabled = config.population !== 100000;
		$( 'benchmark' ).title = config.population === 100000 ? 'Run the fixed 1080p city benchmark' : 'Select 100,000 citizens to run the city benchmark';
		this.districtLabels = city.districts.map( ( district ) => {

			const label = document.createElement( 'span' ); label.textContent = district.name;
			const x = district.id % 4 * 4, z = Math.floor( district.id / 4 ) * 4;
			return { label, x: ( city.xs[ x ] + city.xs[ x + 4 ] ) / 2, z: ( city.zs[ z ] + city.zs[ z + 4 ] ) / 2 };

		} );
		$( 'district-labels' ).replaceChildren( ...this.districtLabels.map( ( d ) => d.label ) );
		document.title = `Polyreaver City · ${config.population.toLocaleString()} citizens`;
		$( 'selection' ).textContent = 'Click a building to inspect its address and capacities.';
		location.hash = new URL( this.shareLink() ).hash;
		return this.describe();

	}

	cameraMode( id ) { this.rig.setBenchView( null ); this.rig.setMode( id ); $( 'camera' ).value = id; if ( this.S ) this.S.camera = id; if ( this._optionsReady ) this.post.build( this.S, this.rig.camera ); }
	overview() { this.rig.setMode( 'iso' ); this.rig.setBenchView( () => 1450 ); $( 'camera' ).value = 'iso'; }
	pause( value ) { this.paused = !! value; if ( this.profile ) { this.profile.paused = this.paused; this.profile.accumulator = 0; } $( 'pause' ).textContent = this.paused ? 'Resume city' : 'Pause city'; return this.paused; }

	moveHero( dt ) {

		if ( this.benchmarkPath ) {

			const p = this.benchmarkPath, e = this.data.graph.edges[ p.edges[ p.cursor ] ];
			p.distance += dt * 5;
			if ( p.distance >= e.length ) { p.distance -= e.length; p.cursor = ( p.cursor + 1 ) % p.edges.length; }
			const current = this.data.graph.edges[ p.edges[ p.cursor ] ];
			this.hero.pos.set( current.x + current.dx * p.distance, 0, current.z + current.dz * p.distance );
			this.hero.heading = Math.atan2( current.dx, current.dz ); this.hero.speed = 5; this.hero.state = 2;
			this.crowd.u.heroPos.value.set( this.hero.pos.x, this.hero.pos.z ); this.crowd.u.heroHeading.value = this.hero.heading; this.crowd.u.heroState.value = 2; this.crowd.u.heroSpeed.value = 5;
			this.marker.position.set( this.hero.pos.x, .05, this.hero.pos.z );
			return;

		}
		const input = this.input.read();
		if ( this.benchmarking ) { input.x = input.y = 0; }
		this.rig.groundBasis( this.tmpForward, this.tmpRight );
		this.tmpMove.copy( this.tmpRight ).multiplyScalar( input.x ).addScaledVector( this.tmpForward, input.y );
		const magnitude = Math.min( 1, this.tmpMove.length() );
		this.hero.speed = this.paused ? 0 : magnitude * ( input.run ? 5 : 1.8 ); this.hero.state = this.hero.speed > .05 ? input.run ? 2 : 1 : 0;
		if ( this.hero.speed > 0 ) {

			this.rig.setBenchView( null ); this.rig.follow = true;
			this.hero.heading = Math.atan2( this.tmpMove.x, this.tmpMove.z );
			const before = this.hero.pos.clone();
			this.collision.move( this.hero.pos, Math.sin( this.hero.heading ) * this.hero.speed * dt, Math.cos( this.hero.heading ) * this.hero.speed * dt );
			if ( this.physics?.enabled ) { const delta = this.hero.pos.clone().sub( before ); this.hero.pos.copy( before ); this.physics.moveHero( this.hero.pos, delta ); }

		}
		this.crowd.u.heroPos.value.set( this.hero.pos.x, this.hero.pos.z ); this.crowd.u.heroHeading.value = this.hero.heading; this.crowd.u.heroState.value = this.hero.state;
		this.crowd.u.heroSpeed.value = this.hero.speed;
		this.marker.position.set( this.hero.pos.x, .05, this.hero.pos.z );

	}

	frame() {

		try {

			const start = performance.now(), ms = start - this.lastFrame; this.lastFrame = start;
			if ( document.hidden || ! this.crowd ) return;
			const dt = ms / 1000; this.moveHero( Math.min( dt, .1 ) );
			if ( this.benchmarkCamera ) {

				Object.assign( this.rig, this.benchmarkCamera ); this.rig.panOffset.set( 0, 0, 0 );

			}
			this.rig.update( Math.min( dt, .25 ), this.hero.pos, this.hero.heading );
			this.retractCamera();
			this.crowd.update( dt, this.profile.simTime, this.rig.camera, this.renderer.domElement.height );
			const trafficDt = this.profile.simTime - this.lastTrafficTime; this.lastTrafficTime = this.profile.simTime;
			this.traffic.update( Math.max( 0, trafficDt ), this.profile.simTime, this.paused );
			this.physics?.update( Math.min( dt, .1 ), this.hero.pos, this.hero.heading );
			this.environment.update( dt, this.rig.focus, this.rig.camera, this.rig.viewExtent );
			const focus = this.hero.pos.clone().add( new THREE.Vector3( 0, 1.2, 0 ) ).sub( this.rig.camera.position ).dot( this.rig.camera.getWorldDirection( this.tmpForward ) );
			this.post.u.focus.value = focus; this.post.u.focalLength.value = this.rig.isOrtho ? this.rig.viewHeight * .3 : Math.max( 3, focus * .5 );
			this.bench.ballast.update();
			if ( this.post.active ) this.post.render(); else this.renderer.render( this.scene, this.rig.camera );
			this.frameCount ++;
			this.drawDistrictLabels();
			const gpuRenderMs = this.gpu.timestamps ? this.renderer.info.render.timestamp || null : null;
			const gpuComputeMs = this.gpu.timestamps ? this.renderer.info.compute.timestamp || null : null;
			const sample = { frameMs: ms, cpuMs: performance.now() - start, gpuMs: gpuRenderMs !== null && gpuComputeMs !== null ? gpuRenderMs + gpuComputeMs : null, gpuRenderMs, gpuComputeMs };
			this.bench.onFrame( ms, sample.gpuMs || 0, sample.cpuMs );
			this.samples.push( sample ); if ( this.samples.length > 18000 ) this.samples.shift();
			if ( this.gpu.timestamps && this.frameCount % 4 === 0 ) {

				this.renderer.resolveTimestampsAsync( 'render' ).catch( () => {} ); this.renderer.resolveTimestampsAsync( 'compute' ).catch( () => {} );

			}
			if ( start - this.lastHud > 500 ) { this.lastHud = start; this.updateHud(); this.readCounters(); }

		} catch ( e ) { this.fail( e ); }

	}

	retractCamera() {

		if ( this.rig.isOrtho || this.rig.mode === 'eye' ) return;
		const camera = this.rig.camera, origin = this.cameraOrigin.set( this.hero.pos.x, 1.6, this.hero.pos.z );
		const direction = this.cameraDirection.copy( camera.position ).sub( origin );
		let distance = direction.length(); direction.normalize(); this.cameraRay.set( origin, direction );
		for ( const id of this.collision.candidates( origin.x, origin.z, camera.position.x, camera.position.z ) ) {

			if ( id >= this.data.buildings.length ) continue;
			const b = this.data.buildings[ id ]; this.cameraBox.min.set( b.x0, 0, b.z0 ); this.cameraBox.max.set( b.x1, b.height, b.z1 );
			if ( this.cameraRay.intersectBox( this.cameraBox, this.cameraHit ) ) distance = Math.min( distance, Math.max( .5, origin.distanceTo( this.cameraHit ) - .3 ) );

		}
		camera.position.copy( origin ).addScaledVector( direction, distance ); camera.lookAt( origin ); camera.updateMatrixWorld();

	}

	fail( error ) {

		if ( error.message === 'Generation superseded' ) return;
		this.boot.fail( error, 'CITY-ERR' );
		this.errors.push( { message: error.message, frame: this.frameCount } ); console.error( error );
		$( 'error' ).textContent = error.message; $( 'error' ).hidden = false;
		if ( this.errors.length > 30 ) this.renderer?.setAnimationLoop( null );

	}

	async readCounters() {

		if ( this.readbackPending ) return;
		this.readbackPending = true;
		const profile = this.profile;
		try {

			const [ counters, crossings ] = await Promise.all( [ this.renderer.getArrayBufferAsync( profile.counters.value ), this.renderer.getArrayBufferAsync( profile.crossings.value ) ] );
			if ( profile === this.profile ) { this.diagnostics = Array.from( new Uint32Array( counters ) ); this.traffic.presence = new Uint32Array( crossings ); }

		} catch ( e ) { if ( profile === this.profile ) this.fail( e ); }
		finally { this.readbackPending = false; }

	}

	describe() {

		if ( ! this.data ) return { ready: false };
		const stats = this.crowd.stats(), world = this.world.stats( this.rig.camera );
		const memory = this.renderer.info.memory;
		const gpuDataBytes = ( memory.attributesSize || 0 ) + ( memory.indexAttributesSize || 0 ) + ( memory.indirectStorageAttributesSize || 0 ) + ( memory.storageAttributesSize || 0 ) + this.data.surface.data.byteLength;
		return { ready: true, version: this.data.version, seed: this.config.seed, layoutHash: this.data.layoutHash, config: this.config, citizens: this.data.population.count, activeAgents: this.crowd.count, capacity: this.crowd.capacity, buildings: this.data.buildings.length, services: this.data.serviceSites, generationMs: this.generationMs, generationMode: this.generationMode, validation: this.data.validation, ticks: this.profile.ticks, simTime: this.profile.simTime, droppedSimulationSeconds: this.profile.droppedSeconds, paused: this.paused, visibleByTier: stats.visibleByTier, crowdTriangles: stats.tris, staticTriangles: world.triangles, totalStaticTriangles: world.totalTriangles, trafficTriangles: this.traffic.triangles, gpuDataBytes, gpuDataBudgetBytes: this.profile.bytes + stats.cullBytes + this.world.bytes + this.traffic.bytes, rendererMemory: { ...memory }, renderTargetBytesEstimate: this.renderer.domElement.width * this.renderer.domElement.height * 8, draws: this.renderer.info.render.drawCalls, resolution: [ this.renderer.domElement.width, this.renderer.domElement.height ], adapter: this.gpu.info, timestamps: this.gpu.timestamps, frameCount: this.frameCount, errors: this.errors, settings: { ...this.S }, physics: this.physics?.stats(), diagnostics: this.diagnostics || [], hero: { x: this.hero.pos.x, z: this.hero.pos.z }, selected: this.selected };

	}

	updateHud() {

		const s = this.samples.slice( - 20 ), frame = s.reduce( ( sum, v ) => sum + v.frameMs, 0 ) / Math.max( 1, s.length ), cpu = s.reduce( ( sum, v ) => sum + v.cpuMs, 0 ) / Math.max( 1, s.length );
		const d = this.describe();
		const i = Math.max( 0, this.data.xs.findIndex( ( x ) => x > this.hero.pos.x ) - 1 ), j = Math.max( 0, this.data.zs.findIndex( ( z ) => z > this.hero.pos.z ) - 1 );
		const district = this.data.districts[ Math.min( 3, Math.floor( i / 4 ) ) + Math.min( 3, Math.floor( j / 4 ) ) * 4 ].name;
		$( 'fps' ).textContent = `${( 1000 / frame ).toFixed( 0 )} fps`;
		$( 'hud-detail' ).textContent = `${district}\n${d.citizens.toLocaleString()} citizens + player\n${d.visibleByTier.reduce( ( a, b ) => a + b, 0 ).toLocaleString()} visible · ${d.ticks} simulation ticks\n${frame.toFixed( 1 )} ms frame · ${cpu.toFixed( 1 )} ms CPU\n${Math.round( d.crowdTriangles + d.staticTriangles + d.trafficTriangles ).toLocaleString()} triangles · ${d.draws} draws\n${( d.gpuDataBytes / 1048576 ).toFixed( 1 )} MiB GPU data · ${( this.diagnostics?.[ 0 ] || 0 )} bucket overflow`;
		this.drawPlayerMap();
		if ( [ 1, 2 ].includes( this.S.behaviour ) ) {

			let near = Infinity, far = - 1;
			for ( const a of this.data.addresses ) {

				const d = ( a.x - this.hero.pos.x ) ** 2 + ( a.z - this.hero.pos.z ) ** 2;
				if ( d < near ) { near = d; this.profile.heroAddress.value = a.id; }
				if ( d > far ) { far = d; this.profile.fleeAddress.value = a.id; }

			}

		}

	}

	drawDistrictLabels() {

		const overview = !! this.rig.benchRadius;
		$( 'district-labels' ).hidden = ! overview;
		if ( ! overview ) return;
		for ( const d of this.districtLabels ) {

			const p = this.labelPoint.set( d.x, 20, d.z ).project( this.rig.camera );
			d.label.hidden = Math.abs( p.x ) > 1 || Math.abs( p.y ) > 1;
			d.label.style.transform = `translate(${( p.x + 1 ) * innerWidth / 2}px, ${( 1 - p.y ) * innerHeight / 2}px) translate(-50%, -50%)`;

		}

	}

	drawMap() {

		const canvas = $( 'minimap' ), ctx = canvas.getContext( '2d', { willReadFrequently: true } );
		ctx.fillStyle = '#344c43'; ctx.fillRect( 0, 0, 256, 256 );
		const fill = ( r, color ) => { ctx.fillStyle = color; ctx.fillRect( ( r.x0 + 1024 ) / 8, ( r.z0 + 1024 ) / 8, ( r.x1 - r.x0 ) / 8, ( r.z1 - r.z0 ) / 8 ); };
		fill( this.data.water, '#3d7789' );
		for ( const p of this.data.parks ) fill( p, p.zone === 'square' ? '#c4b18b' : '#5c8256' );
		for ( const r of this.data.roads ) fill( r, '#838d8c' );
		for ( const b of this.data.buildings ) fill( b, b.landmark ? '#ecd29a' : b.type === 'downtown' ? '#b0c2c5' : '#9d9e8c' );
		this.mapImage = ctx.getImageData( 0, 0, 256, 256 ); this.drawPlayerMap();

	}

	drawPlayerMap() {

		if ( ! this.mapImage ) return;
		const ctx = $( 'minimap' ).getContext( '2d', { willReadFrequently: true } ); ctx.putImageData( this.mapImage, 0, 0 );
		ctx.fillStyle = '#ffdf81'; ctx.beginPath(); ctx.arc( ( this.hero.pos.x + 1024 ) / 8, ( this.hero.pos.z + 1024 ) / 8, 3, 0, Math.PI * 2 ); ctx.fill();

	}

	selectBuilding( id ) {

		const b = this.data.buildings[ id ]; if ( ! b ) throw new Error( 'Unknown city building' );
		this.selected = id;
		$( 'selection' ).textContent = `${b.name}\n${b.type.replaceAll( '-', ' ' )} · ${this.data.districts[ b.district ].name}\n${b.floors} floors · ${b.homeCapacity} home slots · ${b.jobCapacity} activity slots\nReachable address ${b.address + 1}`;
		this.highlightRoute( b.address ); return b;

	}

	clearRoute() { if ( this.routeLine ) { this.scene.remove( this.routeLine ); this.routeLine.geometry.dispose(); this.routeLine.material.dispose(); this.routeLine = null; } }

	highlightRoute( address ) {

		this.clearRoute();
		let nearest = 0, distance = Infinity;
		for ( const n of this.data.graph.nodes ) { const d = Math.hypot( n.x - this.hero.pos.x, n.z - this.hero.pos.z ); if ( d < distance ) { nearest = n.id; distance = d; } }
		const a = this.data.addresses[ address ], ids = referenceRoute( this.data.graph, this.data.routes, nearest, a.anchor );
		const points = [ new THREE.Vector3( this.data.graph.nodes[ nearest ].x, .08, this.data.graph.nodes[ nearest ].z ) ];
		for ( const id of ids ) { const n = this.data.graph.nodes[ this.data.graph.edges[ id ].b ]; points.push( new THREE.Vector3( n.x, .08, n.z ) ); }
		points.push( new THREE.Vector3( a.x, .08, a.z ) );
		this.routeLine = new THREE.Line( new THREE.BufferGeometry().setFromPoints( points ), new THREE.LineBasicNodeMaterial( { color: 0xffd57d, depthTest: false } ) ); this.routeLine.renderOrder = 4; this.scene.add( this.routeLine );

	}

	async sampleCitizens( ids = [ 1, 17, 999 ] ) {

		if ( ids.length > 256 || ids.some( ( id ) => ! Number.isInteger( id ) || id < 1 || id > this.data.population.count ) ) throw new Error( 'Sample at most 256 valid citizen IDs' );
		return Promise.all( ids.map( async ( id ) => {

			const [ rd, nd ] = await Promise.all( [ this.renderer.getArrayBufferAsync( this.crowd.renderBuf.value, null, id * 16, 16 ), this.renderer.getArrayBufferAsync( this.profile.nav.value, null, id * 16, 16 ) ] );
			const r = new Float32Array( rd ), n = new Uint32Array( nd );
			return { id, x: r[ 0 ], z: r[ 2 ], edge: n[ 0 ], target: n[ 1 ], phase: n[ 2 ], dwelling: n[ 3 ] !== 0, home: this.data.population.identity[ id * 4 ], work: this.data.population.identity[ id * 4 + 1 ], leisure: this.data.population.identity[ id * 4 + 2 ] };

		} ) );

	}

	async stepTicks( count ) {

		if ( ! Number.isInteger( count ) || count < 1 || count > 300 ) throw new Error( 'Explicit validation stepping accepts 1–300 fixed ticks.' );
		const wasPaused = this.paused; this.pause( true );
		try {

			for ( let i = 0; i < count; i ++ ) { this.profile.step( this.crowd ); await this.gpu.device.queue.onSubmittedWorkDone(); }
			return { ticks: this.profile.ticks, simTime: this.profile.simTime };

		} finally { this.pause( wasPaused ); }

	}

	populationBuffers() {

		return [ this.crowd.renderBuf, this.crowd.simBuf, this.crowd.animBuf, this.profile.nav, this.profile.previous, this.profile.occupancy, this.profile.counters, this.profile.crossings ];

	}

	async capturePopulation() {

		await this.gpu.device.queue.onSubmittedWorkDone();
		return Promise.all( this.populationBuffers().map( ( b ) => this.renderer.getArrayBufferAsync( b.value ) ) );

	}

	restorePopulation( data ) {

		for ( const [ i, b ] of this.populationBuffers().entries() ) {

			b.value.array.set( new b.value.array.constructor( data[ i ] ) ); b.value.needsUpdate = true;

		}

	}

	async prepareBridgePressure() {

		this.pause( true );
		const state = await this.capturePopulation();
		const render = new Float32Array( state[ 0 ] ), sim = new Float32Array( state[ 1 ] ), nav = new Uint32Array( state[ 3 ] ), previous = new Float32Array( state[ 4 ] ), occupancy = new Uint32Array( state[ 5 ] );
		const bridge = this.data.graph.edges.find( ( e ) => e.kind === 'bridge' );
		const count = Math.min( 512, this.config.population );
		for ( let i = 1; i <= count; i ++ ) {

			if ( nav[ i * 4 + 3 ] ) occupancy[ nav[ i * 4 + 1 ] ] &= ~ ( 1 << ( nav[ i * 4 + 3 ] - 1 ) );
			const t = 6 + ( i - 1 ) % 64 / 63 * Math.min( 35, bridge.length - 12 );
			const lateral = ( Math.floor( ( i - 1 ) / 64 ) - 3.5 ) * .65;
			const bend = Math.min( 1, t / 8, ( bridge.length - t ) / 8 );
			const x = bridge.x + bridge.dx * t - bridge.dz * lateral * bend, z = bridge.z + bridge.dz * t + bridge.dx * lateral * bend;
			render[ i * 4 ] = x; render[ i * 4 + 2 ] = z;
			sim.set( [ t, lateral, 0, Math.atan2( bridge.dx, bridge.dz ) ], i * 4 );
			nav[ i * 4 ] = bridge.id; nav[ i * 4 + 3 ] = 0; previous.set( [ x, z ], i * 2 );

		}
		this.restorePopulation( state ); this.pause( false );
		return { kind: 'synthetic bridge pressure', concentratedCitizens: count, bridge: bridge.id, populationUnchanged: this.config.population, identityAssignmentsUnchanged: true };

	}

	async validate( { full = false } = {} ) {

		const generated = validateCity( this.data );
		if ( ! full ) return { ...generated, errors: [ ...generated.errors, ...this.errors.map( ( e ) => e.message ) ], ok: generated.ok && this.errors.length === 0 };
		this.profile.validateAll.count = this.crowd.count;
		this.renderer.compute( [ this.profile.resetValidation, this.profile.validateAll ] );
		const counters = Array.from( new Uint32Array( await this.renderer.getArrayBufferAsync( this.profile.validationCounters.value ) ) );
		return { ...generated, errors: [ ...generated.errors, ...this.errors.map( ( e ) => e.message ) ], liveActiveAgents: counters[ 0 ], liveCitizens: counters[ 1 ], bounds: counters[ 2 ], invalidIds: counters[ 3 ], outsideCorridor: counters[ 4 ], water: counters[ 5 ], buildingIntrusions: counters[ 6 ], excessiveDisplacement: counters[ 7 ], ok: generated.ok && counters[ 0 ] === this.crowd.count && counters[ 1 ] === this.data.population.count && counters.slice( 2 ).every( ( n ) => n === 0 ) && this.errors.length === 0 };

	}

	async benchmark( { seconds = 60, warmup = 10 } = {} ) {

		if ( this.benchmarking || this.bench.running ) throw new Error( 'A benchmark is already running' );
		if ( ! Number.isFinite( seconds ) || seconds < 1 || seconds > 300 || ! Number.isFinite( warmup ) || warmup < 0 || warmup > 60 ) throw new Error( 'Benchmark duration must be 1–300 seconds and warmup 0–60 seconds.' );
		if ( this.config.population !== 100000 ) throw new Error( 'Select 100,000 citizens before running the standard city benchmark.' );
		this.cancelBenchmark = false;
		this.benchmarking = true;
		const original = { hero: this.hero.pos.clone(), heading: this.hero.heading, mode: this.rig.mode, height: this.rig.viewHeightTarget, paused: this.paused, width: this.renderer.domElement.width, canvasHeight: this.renderer.domElement.height, tier: this.crowd.tier, simTime: this.profile.simTime, ticks: this.profile.ticks, dropped: this.profile.droppedSeconds };
		const trafficState = this.traffic.states.map( ( s ) => ( { ...s, previous: s.previous.clone(), current: s.current.clone() } ) ), trafficAccumulator = this.traffic.accumulator;
		const signalColors = this.traffic.signalMesh.instanceColor.array.slice();
		this.pause( true );
		const originalPopulation = await this.capturePopulation();
		this.pause( false ); this.renderer.setPixelRatio( 1 ); this.renderer.setSize( 1920, 1080, false ); this.post.onResize(); this.rig.setAspect( 1920 / 1080 );
		this.crowd.set( { tier: 1 } ); $( 'quality' ).value = '0';
		for ( const id of [ 'seed', 'regenerate', 'population', 'quality', 'camera', 'overview', 'recenter', 'pause', 'benchmark' ] ) $( id ).disabled = true;
		const report = { version: 1, adapter: this.gpu.info, hardware: ! this.gpu.info.isFallbackAdapter, resolution: [ 1920, 1080 ], settings: { ...this.S, tier: 0 }, seed: this.config.seed, citizens: 100000, warmupSeconds: warmup, measurementSeconds: seconds, scenarios: [] };
		try {

			for ( const scenario of [ 'square', 'downtown', 'whole-city', 'traversal' ] ) {

				this.benchmarkPath = null;
				let pressure = null;
				if ( scenario === 'whole-city' ) this.overview();
			else if ( scenario === 'square' ) { this.hero.pos.set( this.data.heroSpawn.x, 0, this.data.heroSpawn.z ); this.hero.heading = Math.PI / 2; this.cameraMode( 'eye' ); }
				else if ( scenario === 'downtown' ) {

					const building = this.data.buildings.filter( ( b ) => b.type === 'downtown' ).sort( ( a, b ) => b.height - a.height )[ 0 ], address = this.data.addresses[ building.address ];
					this.hero.pos.set( address.x, 0, address.z ); this.cameraMode( 'iso' ); this.rig.viewHeightTarget = 220;

				} else {

					pressure = await this.prepareBridgePressure();
					const bridge = this.data.graph.edges.find( ( e ) => e.kind === 'bridge' );
					this.benchmarkPath = { edges: [ bridge.id, bridge.reverse ], cursor: 0, distance: 1 };
					this.hero.pos.set( bridge.x + bridge.dx, 0, bridge.z + bridge.dz ); this.cameraMode( 'chase' );

				}
				this.rig.focus.copy( this.hero.pos );
				this.benchmarkCamera = { mode: this.rig.mode, yawTarget: this.rig.mode === 'eye' || this.rig.mode === 'chase' ? this.hero.heading + Math.PI : Math.PI / 4, pitchTarget: this.rig.mode === 'chase' ? .32 : Math.atan( 1 / Math.SQRT2 ), viewHeightTarget: this.rig.viewHeightTarget, lookYaw: 0, lookPitch: 0 };
				$( 'status' ).textContent = `Benchmark ${scenario}: warming up`;
				const prepareFrame = this.frameCount;
				await new Promise( ( resolve, reject ) => {

					const deadline = performance.now() + 30000;
					const poll = () => {

						if ( this.frameCount >= prepareFrame + 2 ) resolve();
						else if ( this.cancelBenchmark ) reject( new Error( 'City benchmark stopped.' ) );
						else if ( performance.now() > deadline || this.errors.length ) reject( new Error( 'City benchmark could not prepare rendered frames.' ) );
						else setTimeout( poll, 50 );

					}; poll();

				} );
				await new Promise( ( resolve ) => setTimeout( resolve, warmup * 1000 ) );
				const startFrame = this.frameCount, startTicks = this.profile.ticks, dropped = this.profile.droppedSeconds, measureStart = performance.now(); this.samples = [];
				$( 'status' ).textContent = `Benchmark ${scenario}: measuring`;
				await new Promise( ( resolve, reject ) => {

					const poll = () => {

						if ( this.cancelBenchmark ) reject( new Error( 'City benchmark stopped.' ) );
						else if ( document.hidden ) reject( new Error( 'Keep the benchmark tab in the foreground.' ) );
						else if ( performance.now() - measureStart >= seconds * 1000 && this.samples.length ) resolve();
						else if ( performance.now() - measureStart > seconds * 1000 + 15000 ) reject( new Error( 'No frames were produced during measurement.' ) );
						else setTimeout( poll, 50 );

					}; poll();

				} );
				const data = this.samples.slice(), sorted = data.map( ( s ) => s.frameMs ).sort( ( a, b ) => a - b );
				if ( ! data.length || document.hidden ) throw new Error( 'Benchmark needs a visible foreground tab producing frames.' );
				const percentile = ( p ) => sorted[ Math.min( sorted.length - 1, Math.floor( sorted.length * p ) ) ] || 0;
				const cpu = data.map( ( s ) => s.cpuMs ).sort( ( a, b ) => a - b );
				report.scenarios.push( { scenario, pressure, measuredSeconds: ( performance.now() - measureStart ) / 1000, frames: this.frameCount - startFrame, simulationTicks: this.profile.ticks - startTicks, medianMs: percentile( .5 ), p95Ms: percentile( .95 ), p99Ms: percentile( .99 ), cpuP95Ms: cpu[ Math.floor( cpu.length * .95 ) ], droppedSeconds: this.profile.droppedSeconds - dropped, state: this.describe(), samples: data } );

			}
			report.performanceClaim = report.hardware && seconds >= 60 && warmup >= 10;
			report.targetMet = report.performanceClaim && report.scenarios.every( ( s ) => s.medianMs <= 16.7 && s.p95Ms <= 20 && s.droppedSeconds < .0334 && s.simulationTicks >= seconds * 30 - 2 && s.state.errors.length === 0 );
			return report;

		} finally {

			this.benchmarkPath = null; this.benchmarkCamera = null; this.benchmarking = false; this.hero.pos.copy( original.hero ); this.hero.heading = original.heading;
			this.pause( true ); this.restorePopulation( originalPopulation );
			this.diagnostics = Array.from( new Uint32Array( originalPopulation[ 6 ] ) ); this.traffic.presence = new Uint32Array( originalPopulation[ 7 ] );
			this.traffic.states = trafficState; this.traffic.accumulator = trafficAccumulator; this.traffic.signalMesh.instanceColor.array.set( signalColors ); this.traffic.signalMesh.instanceColor.needsUpdate = true;
			this.profile.simTime = original.simTime; this.profile.ticks = original.ticks; this.profile.droppedSeconds = original.dropped; this.lastTrafficTime = original.simTime;
			this.cameraMode( original.mode ); this.rig.viewHeightTarget = original.height; this.pause( original.paused );
			this.crowd.set( { tier: original.tier } ); $( 'quality' ).value = String( this.S.tier );
			for ( const id of [ 'seed', 'regenerate', 'population', 'quality', 'camera', 'overview', 'recenter', 'pause', 'benchmark' ] ) $( id ).disabled = false;
			this.resize();
			$( 'status' ).textContent = this.cancelBenchmark ? 'City benchmark stopped' : 'City benchmark finished';

		}

	}

}

export function initialize( context ) {

	return new CityApp().init( context );

}
