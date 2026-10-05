// Production GPU traffic check: all 512K slots, real readback, road footprints,
// GPU visibility lists, CPU fallback and scene disposal. SwiftShader correctness.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { launchBrowser } from './browser.mjs';
import { MAX_CARS, CAR_WIDTH, CAR_LENGTH } from '../src/city/traffic-sim.js';

const args = process.argv.slice( 2 ), external = args.includes( '--url' ) ? args[ args.indexOf( '--url' ) + 1 ] : null;
const server = external ? null : createServer( ( req, res ) => {

	try {

		const path = resolve( 'dist', '.' + req.url.split( '?' )[ 0 ] );
		if ( ! path.startsWith( resolve( 'dist' ) + '/' ) ) throw new Error( 'Invalid path' );
		res.setHeader( 'Content-Type', extname( path ) === '.js' ? 'text/javascript' : 'text/html' ); res.end( readFileSync( path ) );

	} catch { res.writeHead( 404 ); res.end(); }

} );
if ( server ) await new Promise( ( done ) => server.listen( 0, '127.0.0.1', done ) );
const url = new URL( external || `http://127.0.0.1:${server.address().port}/city.html` );
url.searchParams.set( 'engine', 'stress' ); url.hash = 'scene=city&count=100&capacity=65536&carCount=1024';
const browser = await launchBrowser( { args: [ '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPUService', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist' ] } );
const page = await browser.newPage( { viewport: { width: 960, height: 600 } } ), errors = [];
page.on( 'pageerror', ( e ) => errors.push( e.message ) );
page.on( 'console', ( m ) => { if ( m.type() === 'error' ) errors.push( m.text().slice( 0, 1500 ) ); } );
await page.addInitScript( () => {

	const groups = new WeakMap(), layouts = new WeakMap(); window.__carBindings = [];
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
			if ( bindings === undefined || bindings > 8 ) throw new Error( `Storage binding ceiling: ${d.label}: ${bindings}` );
			window.__carBindings.push( bindings ); return create.call( this, d );

		};

	}

} );

try {

	await page.goto( url.href );
	await page.waitForFunction( () => [ 'running', 'failed' ].includes( window.__boot?.status ), null, { timeout: 180000 } );
	assert.equal( await page.evaluate( () => window.__fatal || window.__boot.status ), 'running', JSON.stringify( await page.evaluate( () => window.__boot.errors ) ) );
	await page.waitForFunction( () => window.app.frameCount > 3, null, { timeout: 90000 } );
	assert.equal( await page.evaluate( () => window.app.world.cityView.traffic.gpu.count ), 1024 );
	console.log( 'PASS GPU traffic starts and renders at 1K' );
	await page.evaluate( () => window.app.set( 'shading', 'lambert' ) );
	assert.equal( await page.evaluate( () => window.app.world.cityView.traffic.gpu.meshes.every( ( mesh ) => mesh.material.isMeshLambertNodeMaterial && !! mesh.material.positionNode && !! mesh.material.normalNode ) ), true );
	await page.evaluate( () => window.app.renderer.setAnimationLoop( null ) );
	await page.getByLabel( 'Cars (city roads)', { exact: true } ).selectOption( String( MAX_CARS ) );
	await page.waitForFunction( () => window.app.S.carCount === 524288 && ! window.app.renderPreparing, null, { timeout: 180000 } );
	const audit = await page.evaluate( async ( { maximum, width, length } ) => {

		const a = window.app, traffic = a.world.cityView.traffic, gpu = traffic.gpu, city = a.world.city;
		if ( gpu.count !== maximum || traffic.sim.states.length ) throw new Error( 'Maximum fleet was clamped or allocated CPU agents' );
		for ( let i = 0; i < 16; i ++ ) traffic.update( .1, a.rig.camera );
		await a.gpu.device.queue.onSubmittedWorkDone();
		const poses = new Float32Array( await a.renderer.getArrayBufferAsync( gpu.poses.value ) );
		const state = new Float32Array( await a.renderer.getArrayBufferAsync( gpu.state.value ) );
		traffic.update( .1, a.rig.camera );
		const moved = new Float32Array( await a.renderer.getArrayBufferAsync( gpu.poses.value ) );
		const roads = city.roads.filter( ( r ) => r.kind !== 'alley' ), cells = new Map();
		for ( const r of roads ) for ( let z = Math.floor( r.z0 / 32 ); z <= Math.floor( r.z1 / 32 ); z ++ ) for ( let x = Math.floor( r.x0 / 32 ); x <= Math.floor( r.x1 / 32 ); x ++ ) {

			const key = `${x},${z}`; if ( ! cells.has( key ) ) cells.set( key, [] ); cells.get( key ).push( r );

		}
		let checked = 0, turns = 0;
		for ( let i = 0; i < maximum; i ++ ) {

			const row = i * 4, x = poses[ row ], z = poses[ row + 1 ], heading = poses[ row + 2 ];
			if ( ! Number.isFinite( x + z + heading ) || poses[ row + 3 ] !== i ) throw new Error( `Uninitialized GPU car ${i}` );
			if ( Math.hypot( moved[ row ] - x, moved[ row + 1 ] - z ) > 2 ) throw new Error( `GPU car ${i} jumped across a junction` );
			if ( state[ row + 3 ] >= 0 ) turns ++;
			if ( i % 97 && state[ row + 3 ] < 0 && i !== maximum - 1 ) continue;
			for ( const dx of [ - width / 2, 0, width / 2 ] ) for ( const dz of [ - length / 2, 0, length / 2 ] ) {

				const px = x + dx * Math.cos( heading ) + dz * Math.sin( heading ), pz = z - dx * Math.sin( heading ) + dz * Math.cos( heading );
				if ( ! ( cells.get( `${Math.floor( px / 32 )},${Math.floor( pz / 32 )}` ) || [] ).some( ( r ) => px >= r.x0 && px <= r.x1 && pz >= r.z0 && pz <= r.z1 ) ) throw new Error( `GPU car ${i} left road at ${px},${pz}` );
				checked ++;

			}

		}
		return { initialized: maximum, checked, turns, visible: await gpu.readback(), bytes: gpu.bytes, bindings: window.__carBindings };

	}, { maximum: MAX_CARS, width: CAR_WIDTH, length: CAR_LENGTH } );
	assert.equal( audit.initialized, MAX_CARS ); assert.ok( audit.checked > 10000 && audit.turns > 0 );
	assert.ok( audit.visible.reduce( ( sum, n ) => sum + n, 0 ) > 0 );
	assert.ok( audit.visible.reduce( ( sum, n ) => sum + n, 0 ) < MAX_CARS );
	assert.ok( audit.bindings.length > 0 && audit.bindings.every( ( n ) => n <= 8 ) );
	assert.equal( new URLSearchParams( new URL( await page.evaluate( () => window.app.shareLink() ) ).hash.slice( 1 ) ).get( 'carCount' ), String( MAX_CARS ) );
	console.log( `PASS ${audit.initialized} GPU cars; ${audit.checked} road footprint probes; ${audit.turns} turning; visible ${audit.visible.join( '/' )}; ${audit.bytes} bytes` );
	await page.evaluate( () => { window.__oldCarGpu = window.app.world.cityView.traffic.gpu; return window.app.set( 'scene', 'plaza' ); } );
	assert.equal( await page.evaluate( () => window.__oldCarGpu.disposed && ! window.app.world.cityView ), true );
	await page.evaluate( () => window.app.set( 'scene', 'city' ) );
	assert.equal( await page.evaluate( () => window.app.world.cityView.traffic.gpu.count ), MAX_CARS );
	await page.evaluate( () => window.app.set( 'carCount', 128 ) );
	assert.deepEqual( await page.evaluate( () => [ window.app.world.cityView.traffic.mesh.count, window.app.world.cityView.traffic.gpu.count ] ), [ 128, 0 ] );
	await page.evaluate( () => window.app.set( 'carCount', 0 ) );
	assert.equal( await page.evaluate( () => window.app.world.cityView.traffic.carMeshes.every( ( m ) => ! m.visible ) ), true );
	assert.equal( await page.evaluate( () => window.app._lastFrameError || window.__fatal || null ), null ); assert.deepEqual( errors, [] );
	console.log( 'PASS 512K count retained across scene changes; GPU buffers released; small fleet and Off restored' );

} finally { await browser.close(); server?.close(); }
