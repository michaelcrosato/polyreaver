// First-use work must finish before RUN, including objects outside the opening
// view. Software WebGPU verifies that invariant; --hardware measures a real GPU.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchBrowser } from './browser.mjs';

const args = process.argv.slice( 2 );
const option = ( key, fallback ) => args.includes( key ) ? args[ args.indexOf( key ) + 1 ] : fallback;
const hardware = args.includes( '--hardware' );
const base = option( '--url', pathToFileURL( resolve( 'city-demo.html' ) ).href );
const output = option( '--out', 'artifacts/rendering/zoom.json' );
const flags = [ '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPUService', '--ignore-gpu-blocklist' ];
if ( ! hardware ) flags.push( '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--use-angle=swiftshader' );
const browser = await launchBrowser( { args: flags } );
const report = { hardware, performanceClaim: false, cases: [] };
mkdirSync( resolve( output, '..' ), { recursive: true } );

async function inspectZoom( page, name ) {

	const result = await page.evaluate( async () => {

		const a = window.app, audit = window.__zoomAudit;
		const before = a.renderer.info.memory.geometries;
		const start = audit.events.length;
		const frame = a.frame.bind( a ), samples = [];
		let last = performance.now();
		a.frame = () => {

			const now = performance.now(); frame();
			samples.push( { frame: now - last, cpu: performance.now() - now } ); last = now;

		};
		const frames = async ( n ) => {

			const target = a.frameCount + n;
			while ( a.frameCount < target && ! window.__fatal ) await new Promise( ( done ) => requestAnimationFrame( done ) );

		};
		try {

			// Use the same camera controls as the wheel, sampling each transition.
			for ( let i = 0; i < 12; i ++ ) { a.rig.zoomBy( 1.33 ); await frames( 2 ); }
			await frames( 8 );
			a.rig.rotateStep( 1 ); await frames( 12 );
			for ( let i = 0; i < 12; i ++ ) { a.rig.zoomBy( 1 / 1.33 ); await frames( 2 ); }
			await frames( 8 );

		} finally { a.frame = frame; }
		const summary = ( key ) => {

			const times = samples.map( ( s ) => s[ key ] ).sort( ( x, y ) => x - y );
			const pct = ( p ) => times[ Math.min( times.length - 1, Math.floor( times.length * p ) ) ] || 0;
			return { p50: pct( .5 ), p95: pct( .95 ), p99: pct( .99 ), worst: times.at( - 1 ) || 0 };

		};
		const events = audit.events.slice( start );
		return {
			prepared: a.renderPreparation, geometriesBefore: before, geometriesAfter: a.renderer.info.memory.geometries,
			pipelines: events.filter( ( e ) => e.method.includes( 'Pipeline' ) ),
			shaders: events.filter( ( e ) => e.method === 'createShaderModule' ),
			geometryBuffers: events.filter( ( e ) => e.method === 'createBuffer' && ( e.usage & ( 16 | 32 ) ) ),
			frames: samples.length, frameMs: summary( 'frame' ), cpuMs: summary( 'cpu' ),
			culled: a.world.cityView.buildingMeshes.every( ( m ) => m.frustumCulled ),
			error: window.__fatal || a._lastFrameError || null
		};

	} );
	report.cases.push( { name, ...result } );
	assert.equal( result.error, null );
	assert.ok( result.frames >= 70 );
	assert.equal( result.culled, true, 'building culling must be restored' );
	assert.equal( result.geometriesAfter, result.geometriesBefore, 'zoom must not upload new geometries' );
	assert.deepEqual( result.pipelines, [], 'zoom must reuse prepared render and compute pipelines' );
	assert.deepEqual( result.shaders, [], 'zoom must not build new shaders' );
	assert.deepEqual( result.geometryBuffers, [], 'zoom must not allocate vertex/index buffers' );
	console.log( `PASS ${name}: ${result.frames} frames; no new pipelines, shaders or geometry buffers; CPU worst ${result.cpuMs.worst.toFixed( 1 )} ms${hardware ? '' : ' (software; not a hardware performance result)'}` );

}

try {

	const scenarios = [
		{ name: 'direct city', settings: {} },
		{ name: 'shadowed city', settings: { shading: 'standard', shadows: 'low', crowdShadows: 1 } },
		{ name: 'GPU LOD and MRT post', settings: { path: 'gpu', tier: 3, aa: 'fxaa', ao: 'gtao', shading: 'lambert', shadows: 'low', crowdShadows: 1 } },
		{ name: 'physics debug geometry', settings: { physics: 1, bodies: 100, physDebug: 1, physProps: 0, proxies: 0, crowdMode: 'off' } }
	];
	for ( const { name, settings } of scenarios ) {

		const page = await browser.newPage( { viewport: { width: 640, height: 400 } } ), errors = [];
		page.on( 'pageerror', ( e ) => errors.push( e.message ) );
		page.on( 'console', ( m ) => { if ( m.type() === 'error' ) errors.push( m.text().slice( 0, 1000 ) ); } );
		await page.addInitScript( () => {

			window.__zoomAudit = { events: [] };
			for ( const method of [ 'createRenderPipeline', 'createRenderPipelineAsync', 'createComputePipeline', 'createComputePipelineAsync', 'createShaderModule', 'createBuffer' ] ) {

				const original = globalThis.GPUDevice.prototype[ method ];
				globalThis.GPUDevice.prototype[ method ] = function ( descriptor ) {

					window.__zoomAudit.events.push( { method, label: descriptor.label || '', usage: descriptor.usage || 0, stage: window.__boot?.stage } );
					return original.call( this, descriptor );

				};

			}

		} );
		const url = new URL( base ); url.searchParams.set( 'engine', 'stress' );
		url.hash = new URLSearchParams( { scene: 'city', count: 1500, capacity: 65536, ...settings } ).toString();
		await page.goto( url.href );
		await page.waitForFunction( () => window.__fatal || window.__boot?.status === 'running' && window.app?.frameCount > 3, null, { timeout: 180000 } );
		const fatal = await page.evaluate( () => window.__fatal || null );
		if ( fatal ) {

			report.boot = await page.evaluate( () => window.__boot ); report.errors = errors;
			throw new Error( fatal );

		}
		const adapter = await page.evaluate( () => window.app.gpu.info ); report.adapter = adapter;
		if ( hardware && ( adapter.isFallbackAdapter || /swiftshader|llvmpipe|lavapipe|software/i.test( [ adapter.vendor, adapter.architecture, adapter.device, adapter.description ].join( ' ' ) ) ) ) throw new Error( 'Software adapter available; hardware performance remains unverified.' );
		assert.equal( await page.evaluate( () => window.__boot.stages.find( ( s ) => s.code === 'WARM' )?.status ), 'ok' );
		await inspectZoom( page, name );
		if ( name === 'direct city' ) {

			await page.evaluate( () => window.app.preset( 'mobile' ) );
			await inspectZoom( page, 'preset change' );
			await page.evaluate( () => window.app.preset( 'bare' ) );
			await page.evaluate( async () => {

				const a = window.app;
				await Promise.all( [ a.set( 'shading', 'lambert' ), a.set( 'shading', 'phong' ), a.applyAll( { shading: 'toon' } ), a.set( 'shading', 'phong' ) ] );

			} );
			assert.equal( await page.evaluate( () => window.app.world.cityView.kind ), 'phong' );
			await page.evaluate( () => window.app.set( 'shading', 'unlit' ) );
			await page.evaluate( () => window.app.set( 'seed', 'zoom-regeneration' ) );
			await inspectZoom( page, 'regenerated city' );

		}
		await page.screenshot( { path: resolve( output, '..', name.replaceAll( ' ', '-' ) + '.png' ) } );
		assert.deepEqual( errors, [] );
		await page.close();

	}
	report.status = 'passed';

} catch ( error ) {

	report.status = 'failed'; report.error = error.stack; process.exitCode = 1;
	console.error( error );

} finally {

	writeFileSync( output, JSON.stringify( report, null, 2 ) );
	await browser.close();

}
