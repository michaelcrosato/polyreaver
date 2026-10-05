// Unified stress test: original controls operate on both city and plaza scenes.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { launchBrowser } from './browser.mjs';
import { SECTIONS, PRESETS } from '../src/features.js';

const args = process.argv.slice( 2 ), quick = args.includes( '--quick' );
const base = args.includes( '--url' ) ? args[ args.indexOf( '--url' ) + 1 ] : pathToFileURL( resolve( 'city-demo.html' ) ).href;
const browser = await launchBrowser( { args: [ '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPUService', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist' ] } );
const page = await browser.newPage( { viewport: { width: 1280, height: 800 } } ), errors = [];
page.on( 'pageerror', ( e ) => errors.push( e.message ) );
page.on( 'console', ( m ) => { if ( [ 'error', 'warning' ].includes( m.type() ) && ! /experimental on this platform|DevTools|deprecated parameters/.test( m.text() ) ) errors.push( m.text().slice( 0, 1000 ) ); } );
mkdirSync( 'artifacts/unified', { recursive: true } );
await page.addInitScript( () => {

	const groups = new WeakMap(), layouts = new WeakMap(); window.__bindingAudit = [];
	const group = GPUDevice.prototype.createBindGroupLayout, layout = GPUDevice.prototype.createPipelineLayout;
	GPUDevice.prototype.createBindGroupLayout = function ( d ) { const result = group.call( this, d ); groups.set( result, d.entries ); return result; };
	GPUDevice.prototype.createPipelineLayout = function ( d ) {

		const result = layout.call( this, d );
		layouts.set( result, d.bindGroupLayouts.flatMap( ( g ) => groups.get( g ) || [] ).filter( ( e ) => ( e.visibility & 4 ) && [ 'storage', 'read-only-storage' ].includes( e.buffer?.type ) ).length ); return result;

	};
	for ( const method of [ 'createComputePipeline', 'createComputePipelineAsync' ] ) {

		const create = GPUDevice.prototype[ method ];
		GPUDevice.prototype[ method ] = function ( d ) {

			const bindings = layouts.get( d.layout );
			if ( bindings === undefined || bindings > 8 ) throw new Error( `Compute binding ceiling violated: ${d.label}: ${bindings}` );
			window.__bindingAudit.push( { label: d.label, bindings } ); return create.call( this, d );

		};

	}
	const request = GPUAdapter.prototype.requestDevice;
	GPUAdapter.prototype.requestDevice = function ( d ) { return request.call( this, { ...d, requiredLimits: { ...d.requiredLimits, maxStorageBuffersPerShaderStage: 8 } } ); };

} );
async function frames( n = 3 ) {

	const count = await page.evaluate( () => window.app?.frameCount || 0 );
	await page.waitForFunction( ( target ) => window.__fatal || window.app?.frameCount >= target, count + n, { timeout: 120000 } );
	assert.equal( await page.evaluate( () => window.__fatal || window.app?._lastFrameError || null ), null );
	assert.deepEqual( errors.splice( 0 ), [] );

}
async function step( name, fn ) { await fn(); await frames(); console.log( 'PASS ' + name ); }
const apply = ( values ) => page.evaluate( ( values ) => window.app.applyAll( values ), values );
try {

	const url = new URL( base ); url.searchParams.set( 'engine', 'stress' ); url.hash = 'scene=city&count=1500&capacity=65536';
	await page.goto( url.href );
	await page.waitForFunction( () => window.__fatal || window.__boot?.status === 'running', null, { timeout: 180000 } ); await frames();
	const keys = [ 'camera', ...SECTIONS.flatMap( ( s ) => s.items.filter( ( i ) => i.key ).map( ( i ) => i.key ) ) ];
	assert.deepEqual( ( await page.evaluate( () => [ ...window.app.ui.controls.keys() ] ) ).sort(), keys.sort() );
	assert.equal( await page.evaluate( () => !! window.city ), false );
	const baseline = await page.evaluate( () => ( { ...window.app.S } ) );
	await step( 'road cars render, move, and respond to their count control', async () => {

		const start = await page.evaluate( () => {

			const traffic = window.app.world.cityView.traffic;
			return { count: traffic.mesh.count, matrices: [ ...traffic.mesh.instanceMatrix.array.slice( 0, traffic.mesh.count * 16 ) ], geometry: traffic.mesh.geometry.uuid };

		} );
		assert.equal( start.count, baseline.carCount ); await frames( 6 );
		assert.notDeepEqual( await page.evaluate( () => [ ...window.app.world.cityView.traffic.mesh.instanceMatrix.array.slice( 0, window.app.S.carCount * 16 ) ] ), start.matrices );
		await page.getByLabel( 'Cars (city roads)', { exact: true } ).selectOption( '0' );
		await page.waitForFunction( () => window.app.world.cityView.traffic.mesh.count === 0 && ! window.app.renderPreparing );
		await page.getByLabel( 'Cars (city roads)', { exact: true } ).selectOption( '512' );
		await page.waitForFunction( () => window.app.world.cityView.traffic.mesh.count === 512 && ! window.app.renderPreparing );
		assert.equal( await page.evaluate( () => window.app.world.cityView.traffic.mesh.geometry.uuid ), start.geometry );
		await apply( baseline );

	} );
	await step( `all ${keys.length} original and scene controls present in one App`, async () => {

		await page.getByRole( 'button', { name: 'Shading & lighting' } ).click();
		await page.getByLabel( 'Shading model', { exact: true } ).selectOption( 'lambert' );
		await page.waitForFunction( () => window.app.world.cityView.kind === 'lambert' && window.app.crowd.materialKind === 'lambert' );
		await apply( baseline );

	} );
	for ( const id of quick ? [ 'mobile', 'toon', 'physics' ] : Object.keys( PRESETS ) ) await step( 'city preset ' + id, async () => {

		await page.evaluate( ( id ) => window.app.preset( id ), id );
		await page.evaluate( async () => { if ( window.app.physicsStartup ) await window.app.physicsStartup; } );
		await frames(); await apply( baseline );

	} );
	const scenarios = [
		...[ 'direct', 'gpu' ].flatMap( ( path ) => [ 'none', 'procedural', 'keyframe', 'skeletal', 'bat', 'vat' ].map( ( anim ) => ( { path, anim, tier: 3 } ) ) ),
		...[ 'unlit', 'lambert', 'phong', 'standard', 'physical', 'toon', 'celWW', 'celJSR' ].map( ( shading ) => ( { shading } ) ),
		...[ 'off', 'low', 'medium', 'high', 'vsm' ].map( ( shadows ) => ( { shadows, shading: 'standard' } ) ),
		{ sky: 'physical' }, { fog: 'height' }, { props: false, groundDetail: false },
		{ upscaler: 'fsr1', renderScale: .5, aa: 'fxaa' }, { ssgi: true }, { ssr: true, shading: 'standard' },
		{ pointLights: 256, clustered: true, shading: 'lambert' },
		{ physics: true, bodies: 100, crowdMode: 'off' },
		{ physics: true, bodies: 100, crowdMode: 'gpu', proxies: true, propsDynamic: true, physDebug: true },
		{ physics: true, bodies: 100, crowdMode: 'rapier', rapierAgents: 100 }
	];
	for ( const values of quick ? [ { path: 'direct', anim: 'skeletal', tier: 3 }, { path: 'gpu', anim: 'vat', tier: 2 }, { physics: true, bodies: 100, crowdMode: 'gpu', proxies: true }, { physics: true, bodies: 100, crowdMode: 'rapier', rapierAgents: 100 } ] : scenarios ) await step( JSON.stringify( values ), async () => {

		await apply( { ...baseline, ...values } );
		await page.evaluate( async () => { if ( window.app.physicsStartup ) await window.app.physicsStartup; } );

	} );
	await step( 'physics actions and city building colliders', async () => {

		await page.evaluate( () => { const a = window.app; a.action( 'explode' ); a.action( 'wrecking' ); a.action( 'respawn' ); } );
		assert.equal( await page.evaluate( () => window.app.physics.buildingColliders.length === window.app.world.city.buildings.length ), true );

	} );
	await step( 'city count exceeds the former 100K cap', async () => {

		await apply( { ...baseline, count: 150000, capacity: 262144, path: 'gpu' } );
		assert.deepEqual( await page.evaluate( () => [ window.app.crowd.count, window.app.crowd.capacity ] ), [ 150000, 262144 ] );
		await frames(); await apply( baseline );

	} );
	await step( 'count and density repack the city without reallocating buffers', async () => {

		await apply( { ...baseline, count: 60000, density: .05, capacity: 262144, path: 'gpu', behaviour: 5 } ); await frames();
		const positions = () => page.evaluate( async () => {

			const a = window.app, data = new Float32Array( await a.renderer.getArrayBufferAsync( a.crowd.renderBuf.value, null, 0, 60000 * 16 ) );
			return Array.from( { length: 32 }, ( _, i ) => { const n = ( 1000 + i * 1500 ) * 4; return [ data[ n ], data[ n + 2 ] ]; } );

		} );
		const before = await positions();
		await page.evaluate( () => window.app.set( 'count', 150000 ) ); await frames(); const larger = await positions();
		assert.ok( larger.filter( ( p, i ) => Math.hypot( p[ 0 ] - before[ i ][ 0 ], p[ 1 ] - before[ i ][ 1 ] ) > 1 ).length > 10 );
		await page.evaluate( () => window.app.set( 'density', .1 ) ); await frames(); const denser = await positions();
		assert.ok( denser.filter( ( p, i ) => Math.hypot( p[ 0 ] - larger[ i ][ 0 ], p[ 1 ] - larger[ i ][ 1 ] ) > 1 ).length > 10 );
		assert.equal( await page.evaluate( () => window.app.crowd.capacity ), 262144 ); await apply( baseline );

	} );
	await step( 'walkers stay on clear ground in every behavior', async () => {

		for ( const behaviour of [ 0, 1, 2, 3, 4, 5 ] ) {

			await apply( { ...baseline, behaviour, speed: 3, activity: 1 } ); await frames( 5 );
			const invalid = await page.evaluate( async () => {

				const a = window.app, city = a.world.city, data = new Float32Array( await a.renderer.getArrayBufferAsync( a.crowd.renderBuf.value, null, 0, a.crowd.count * 16 ) );
				let invalid = 0;
				for ( let i = 1; i < a.crowd.count; i ++ ) {

					const x = data[ i * 4 ], z = data[ i * 4 + 2 ], cellX = Math.floor( ( x + 1024 ) / 2 ), cellZ = Math.floor( ( z + 1024 ) / 2 );
					if ( ! Number.isFinite( x + z ) || cellX < 0 || cellX >= 1024 || cellZ < 0 || cellZ >= 1024 || city.surface.data[ ( cellZ * 1024 + cellX ) * 4 + 1 ] !== 1 ) invalid ++;

				}
				return invalid;

			} ); assert.equal( invalid, 0, `behavior ${behaviour}` );

		}

	} );
	await step( 'hero cannot cross the canal bank with physics off or on', async () => {

		for ( const physics of [ false, true ] ) {

			await apply( { ...baseline, physics, bodies: 0, physProps: false, proxies: false, crowdMode: 'off' } );
			await page.evaluate( () => window.app.physicsStartup );
			assert.equal( await page.evaluate( () => {

				const a = window.app, city = a.world.city, read = a.input.read, basis = a.rig.groundBasis;
				a.renderer.setAnimationLoop( null );
				try {

					a.hero.pos.set( city.water.x0 - 1, 0, city.zs[ 7 ] ); a.hero.heading = Math.PI / 2;
					if ( a.physics.ready ) a.physics.hero.setTranslation( { x: a.hero.pos.x, y: .9, z: a.hero.pos.z }, true );
					a.input.read = () => ( { x: 1, y: 0, run: true } );
					a.rig.groundBasis = ( f, r ) => { f.set( 0, 0, 1 ); r.set( 1, 0, 0 ); };
					for ( let i = 0; i < 20; i ++ ) a._updateHero( .1 );
					return a.hero.pos.x <= city.water.x0 - .34;

				} finally {

					a.input.read = read; a.rig.groundBasis = basis;
					a.hero.pos.set( city.heroSpawn.x, 0, city.heroSpawn.z );
					if ( a.physics.ready ) a.physics.hero.setTranslation( { x: a.hero.pos.x, y: .9, z: a.hero.pos.z }, true );
					a.renderer.setAnimationLoop( () => a.frame() );

				}

			} ), true );

		}
		await apply( baseline );

	} );
	await step( 'overview and recenter work with perspective post processing', async () => {

		await apply( { ...baseline, camera: 'orbit', aa: 'fxaa' } );
		await page.getByRole( 'button', { name: 'City overview', exact: true } ).click(); await frames();
		assert.equal( await page.evaluate( () => !! window.app.rig.benchRadius && window.app.rig.camera.isOrthographicCamera ), true );
		await page.getByRole( 'button', { name: '◎ Recenter', exact: true } ).click(); await frames();
		assert.equal( await page.evaluate( () => ! window.app.rig.benchRadius && window.app.rig.camera.isPerspectiveCamera ), true );
		await apply( baseline );

	} );
	await step( 'seed regeneration preserves controls and reproduces layout', async () => {

		await apply( { ...baseline, shading: 'toon', tier: 2, count: 2000, anim: 'keyframe', seed: 'shared-options' } );
		const hash = await page.evaluate( () => window.app.world.city.layoutHash );
		await page.getByRole( 'button', { name: 'Regenerate city', exact: true } ).click();
		await page.evaluate( () => window.app.sceneTask );
		assert.deepEqual( await page.evaluate( () => [ window.app.world.city.layoutHash, window.app.S.count, window.app.crowd.materialKind, window.app.crowd.animSystem, window.app.S.tier ] ), [ hash, 2000, 'toon', 'keyframe', 2 ] );

	} );
	await step( 'city/plaza round trip retains the same controls and physics', async () => {

		const keys = await page.evaluate( () => [ ...window.app.ui.controls.keys() ] );
		await page.getByLabel( 'Scene', { exact: true } ).selectOption( 'plaza' ); await page.evaluate( () => window.app.sceneTask );
		assert.deepEqual( await page.evaluate( () => [ window.app.S.scene, !! window.app.world.city, window.app.crowd.count, window.app.crowd.materialKind ] ), [ 'plaza', false, 2000, 'toon' ] );
		await apply( { physics: true, bodies: 20, crowdMode: 'gpu' } ); await page.evaluate( () => window.app.physicsStartup ); await frames();
		await page.getByLabel( 'Scene', { exact: true } ).selectOption( 'city' ); await page.evaluate( () => window.app.sceneTask );
		assert.deepEqual( await page.evaluate( () => [ ...window.app.ui.controls.keys() ] ), keys );
		assert.equal( await page.evaluate( () => window.app.physics.ready && window.app.physics.enabled && window.app.world.city.seed === 'shared-options' ), true );
		await apply( baseline );

	} );
	await step( 'rapid scene changes honor the last choice', async () => {

		await page.evaluate( async () => {

			const a = window.app;
			const first = a.set( 'scene', 'plaza' ), last = a.set( 'scene', 'city' );
			await Promise.all( [ first, last ] );

		} );
		assert.equal( await page.evaluate( () => window.app.S.scene === 'city' && !! window.app.world.city && ! window.app.scenePending ), true );

	} );
	await step( 'standard benchmark cancellation restores scene and options', async () => {

		await page.evaluate( () => { window.__saved = { ...window.app.S }; window.__standard = window.app.bench.standard(); } );
		await frames( 2 ); await page.evaluate( () => window.app.bench.stop() ); await page.evaluate( () => window.__standard );
		assert.equal( await page.evaluate( () => ! window.app.bench.running && JSON.stringify( window.app.S ) === JSON.stringify( window.__saved ) && ! window.app.fixedResolution ), true );

	} );
	if ( ! quick ) await step( 'all four standard benchmark stages complete and restore settings', async () => {

		const report = await page.evaluate( async () => {

			const a = window.app, measure = a.bench._measure, saved = { ...a.S };
			// Real rendering and search, with short samples to validate orchestration.
			// These timings are not performance measurements for hardware comparisons.
			try {

				a.bench._measure = () => measure.call( a.bench, 0, 0, 2 );
				const result = await a.bench.standard();
				return { result, restored: JSON.stringify( saved ) === JSON.stringify( a.S ), running: a.bench.running };

			} finally { a.bench._measure = measure; }

		} );
		assert.equal( report.result?.scene, 'city' ); assert.equal( report.result?.seed, baseline.seed );
		assert.ok( report.result.direct && report.result.boxDirect && report.result.gpuDriven && report.result.looks );
		assert.equal( report.restored, true ); assert.equal( report.running, false );

	} );
	const shared = await page.evaluate( () => window.app.shareLink() );
	assert.equal( new URL( shared ).searchParams.get( 'engine' ), 'stress' );
	assert.equal( new URLSearchParams( new URL( shared ).hash.slice( 1 ) ).get( 'scene' ), 'city' );
	await page.goto( shared ); await page.waitForFunction( () => window.__fatal || window.__boot?.status === 'running', null, { timeout: 180000 } ); await frames();
	await page.screenshot( { path: 'artifacts/unified/city.png' } );
	console.log( 'PASS shared link reload, offline city generation, and eight-binding GPU limit' );
	assert.ok( await page.evaluate( () => window.__bindingAudit.length > 0 && window.__bindingAudit.every( ( p ) => p.bindings <= 8 ) ) );

} finally { await browser.close(); }
