// Software-WebGPU correctness and eight-binding portability checks. Timings in
// this script are test duration, never a hardware performance claim.
import assert from 'node:assert/strict';
import { launchBrowser } from './browser.mjs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { advanceSingleEdge, citizenWalkSpeed, citizenRandom } from '../src/city/reference.js';

const args = process.argv.slice( 2 );
const option = ( key, fallback ) => args.includes( key ) ? args[ args.indexOf( key ) + 1 ] : fallback;
const url = option( '--url', pathToFileURL( resolve( 'city-demo.html' ) ).href );
const shots = option( '--shots', 'artifacts/city' ); mkdirSync( shots, { recursive: true } );
const flags = [ '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPUService', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist' ];
const browser = await launchBrowser( { args: flags } );
const page = await browser.newPage( { viewport: { width: 960, height: 640 } } );
const errors = [], steps = [];
page.on( 'pageerror', ( error ) => errors.push( error.message ) );
page.on( 'console', ( message ) => {

	if ( [ 'error', 'warning' ].includes( message.type() ) && ! /experimental on this platform|DevTools/.test( message.text() ) ) errors.push( message.text().slice( 0, 500 ) );

} );
await page.addInitScript( () => {

	const groups = new WeakMap(), layouts = new WeakMap();
	window.__cityBindingAudit = [];
	const group = GPUDevice.prototype.createBindGroupLayout;
	GPUDevice.prototype.createBindGroupLayout = function ( descriptor ) {

		const result = group.call( this, descriptor ); groups.set( result, descriptor.entries ); return result;

	};
	const layout = GPUDevice.prototype.createPipelineLayout;
	GPUDevice.prototype.createPipelineLayout = function ( descriptor ) {

		const result = layout.call( this, descriptor );
		layouts.set( result, descriptor.bindGroupLayouts.flatMap( ( g ) => groups.get( g ) || [] ).filter( ( e ) => ( e.visibility & 4 ) && [ 'storage', 'read-only-storage' ].includes( e.buffer?.type ) ).length );
		return result;

	};
	for ( const method of [ 'createComputePipeline', 'createComputePipelineAsync' ] ) {

		const create = GPUDevice.prototype[ method ];
		GPUDevice.prototype[ method ] = function ( descriptor ) {

			const bindings = layouts.get( descriptor.layout );
			if ( bindings === undefined || bindings > 8 ) throw new Error( `Eight-binding compute ceiling violated: ${descriptor.label}: ${bindings}` );
			window.__cityBindingAudit.push( { label: descriptor.label, bindings } );
			return create.call( this, descriptor );

		};

	}
	const request = GPUAdapter.prototype.requestDevice;
	GPUAdapter.prototype.requestDevice = function ( descriptor ) {

		return request.call( this, { ...descriptor, requiredLimits: { ...descriptor.requiredLimits, maxStorageBuffersPerShaderStage: 8 } } );

	};

} );

async function step( name, fn ) {

	const before = errors.length, start = Date.now();
	const result = await fn();
	assert.equal( errors.length, before, `${name}: ${errors.slice( before ).join( '\n' )}` );
	const entry = { name, seconds: ( Date.now() - start ) / 1000, result }; steps.push( entry );
	console.log( `PASS ${name} (${entry.seconds.toFixed( 1 )} s)` );
	return result;

}

const frames = ( count = 2 ) => page.evaluate( ( count ) => new Promise( ( resolve ) => {

	const start = window.city.frameCount;
	const check = () => window.city.frameCount >= start + count ? resolve() : setTimeout( check, 30 ); check();

} ), count );

async function injectCitizen( data ) {

	return page.evaluate( ( data ) => {

		const app = window.city, p = app.profile, e = app.data.graph.edges[ data.edge ], id = 1;
		const bend = Math.min( 1, data.t / 8, ( e.length - data.t ) / 8 ), lateral = data.lateral || 0;
		const x = e.x + e.dx * data.t - e.dz * lateral * bend, z = e.z + e.dz * data.t + e.dx * lateral * bend;
		app.crowd.renderBuf.value.array.set( [ x, 0, z, 1 + 2048 * 2 ], id * 4 );
		app.crowd.simBuf.value.array.set( [ data.t, lateral, data.timer || 0, Math.atan2( e.dx, e.dz ) ], id * 4 );
		app.crowd.animBuf.value.array.set( [ 1, 1, 0, id ], id * 4 );
		p.previous.value.array.set( [ x, z ], id * 2 ); p.nav.value.array.set( [ e.id, data.target, 0, data.mode || 0 ], id * 4 );
		p.occupancy.value.array.fill( 0 ); if ( data.mode ) p.occupancy.value.array[ data.target ] = 1 << ( data.mode - 1 );
		for ( const buffer of [ app.crowd.renderBuf, app.crowd.simBuf, app.crowd.animBuf, p.previous, p.nav, p.occupancy ] ) buffer.value.needsUpdate = true;
		p.simTime = data.time || 0;
		return { x, z, edge: e };

	}, data );

}

async function citizenState() {

	return page.evaluate( async () => {

		const a = window.city, citizen = ( await a.sampleCitizens( [ 1 ] ) )[ 0 ];
		const sim = new Float32Array( await a.renderer.getArrayBufferAsync( a.crowd.simBuf.value, null, 16, 16 ) );
		return { ...citizen, t: sim[ 0 ], lateral: sim[ 1 ], timer: sim[ 2 ] };

	} );

}

try {

	await step( 'offline standalone bootstrap and enforced eight-binding pipeline ceiling', async () => {

		await page.route( /^https?:/, ( route ) => url.startsWith( 'file:' ) ? route.abort() : route.continue() );
		await page.goto( `${url}#population=1000&paused=1` );
		await page.waitForFunction( () => window.city || window.__fatal, null, { timeout: 90000 } );
		assert.equal( await page.evaluate( () => window.__fatal || null ), null );
		const state = await page.evaluate( () => ( { description: window.city.describe(), limit: window.city.gpu.device.limits.maxStorageBuffersPerShaderStage } ) );
		// Some browser versions grant a newer default of 10 even when 8 is requested.
		// Pipeline creation above still rejects any compute stage using more than 8.
		assert.ok( state.limit >= 8 ); assert.equal( state.description.citizens, 1000 );
		assert.ok( state.description.totalStaticTriangles <= 250000 );
		return { grantedLimit: state.limit, enforcedCeiling: 8, buildings: state.description.buildings, gpuBytes: state.description.gpuDataBytes };

	} );

	await step( 'GPU routes advance persistent citizens while off camera', async () => {

		const before = await page.evaluate( () => window.city.sampleCitizens( [ 1, 17, 999 ] ) );
		await page.evaluate( () => window.city.stepTicks( 30 ) );
		const after = await page.evaluate( () => window.city.sampleCitizens( [ 1, 17, 999 ] ) );
		for ( let i = 0; i < before.length; i ++ ) {

			assert.equal( before[ i ].home, after[ i ].home ); assert.equal( before[ i ].work, after[ i ].work );
			assert.ok( Math.hypot( before[ i ].x - after[ i ].x, before[ i ].z - after[ i ].z ) > .1 );

		}
		const validation = await page.evaluate( () => window.city.validate( { full: true } ) ); assert.ok( validation.ok, JSON.stringify( validation ) );
		return validation;

	} );

	await step( 'all cameras, map and building selection render', async () => {

		for ( const mode of [ 'iso', 'top', 'orbit', 'chase', 'eye' ] ) {

			await page.evaluate( ( mode ) => window.city.cameraMode( mode ), mode ); await frames();
			await page.screenshot( { path: `${shots}/camera-${mode}.png` } );

		}
		await page.evaluate( () => { window.city.overview(); window.city.selectBuilding( window.city.data.serviceSites[ 0 ].building ); } ); await frames();
		assert.ok( ( await page.locator( '#selection' ).innerText() ).includes( 'Reachable address' ) );
		await page.screenshot( { path: `${shots}/overview.png` } );
		return { selected: await page.evaluate( () => window.city.selected ) };

	} );

	await step( 'analytical GPU travel, crossing phases, bridge and address arrival/departure', async () => {

		await page.evaluate( () => window.city.regenerate( { population: 1 } ) ); await frames();
		const fixture = await page.evaluate( () => {

			const data = window.city.data;
			const crossing = data.graph.edges.find( ( e ) => e.kind === 'crossing' && data.addresses.some( ( a ) => a.anchor === e.b ) && data.graph.nodes[ e.a ].out.some( ( id ) => data.graph.edges[ id ].kind === 'sidewalk' ) );
			const incoming = data.graph.edges[ data.graph.edges[ data.graph.nodes[ crossing.a ].out.find( ( id ) => data.graph.edges[ id ].kind === 'sidewalk' ) ].reverse ];
			return { crossing, incoming, crossingTarget: data.addresses.find( ( a ) => a.anchor === crossing.b ).id, signalOffset: data.signals[ crossing.signal ].offset, address: data.addresses[ 0 ], bridge: data.graph.edges.find( ( e ) => e.kind === 'bridge' ), ordinary: data.graph.edges.find( ( e ) => e.kind === 'sidewalk' && e.id !== data.addresses[ 0 ].edge ) };

		} );
		const lateral = ( citizenRandom( 1, 23 ) - .5 ) * 2.4;
		const origin = await injectCitizen( { edge: fixture.ordinary.id, t: 20, lateral, target: 0 } );
		await page.evaluate( () => window.city.stepTicks( 1 ) );
		const travelled = await citizenState(), expected = advanceSingleEdge( origin.edge, 20, lateral, 1 / 30, citizenWalkSpeed( 1 ) );
		assert.ok( Math.hypot( travelled.x - expected.x, travelled.z - expected.z ) < .002, JSON.stringify( { travelled, expected } ) );
		await injectCitizen( { edge: fixture.incoming.id, t: fixture.incoming.length - .01, target: fixture.crossingTarget, time: 40 - fixture.signalOffset } );
		await page.evaluate( () => window.city.stepTicks( 3 ) );
		const red = await citizenState(); assert.equal( red.edge, fixture.incoming.id ); assert.ok( Math.abs( red.t - fixture.incoming.length ) < .001 );
		await injectCitizen( { edge: fixture.incoming.id, t: fixture.incoming.length - .01, target: fixture.crossingTarget, time: 1 - fixture.signalOffset } );
		await page.evaluate( () => window.city.stepTicks( 1 ) );
		const green = await citizenState(); assert.equal( green.edge, fixture.crossing.id );
		await injectCitizen( { edge: fixture.crossing.id, t: fixture.crossing.length / 2, target: fixture.crossingTarget, time: 40 - fixture.signalOffset } );
		await page.evaluate( () => window.city.stepTicks( 1 ) );
		const clearance = await citizenState(); assert.ok( clearance.t > fixture.crossing.length / 2 );
		await injectCitizen( { edge: fixture.bridge.id, t: fixture.bridge.length / 2, target: 0 } );
		await page.evaluate( () => window.city.stepTicks( 2 ) );
		const bridgeValidation = await page.evaluate( () => window.city.validate( { full: true } ) ); assert.ok( bridgeValidation.ok, JSON.stringify( bridgeValidation ) );
		await injectCitizen( { edge: fixture.address.edge, t: fixture.address.t - .01, target: 0 } );
		await page.evaluate( () => window.city.stepTicks( 1 ) );
		const arrived = await citizenState(); assert.ok( arrived.dwelling );
		await page.evaluate( () => window.city.stepTicks( 60 ) );
		const dwelling = await citizenState(); assert.ok( dwelling.dwelling ); assert.ok( Math.abs( dwelling.lateral ) > 1 );
		await page.evaluate( async () => {

			const a = window.city, sim = new Float32Array( await a.renderer.getArrayBufferAsync( a.crowd.simBuf.value, null, 16, 16 ) );
			const nav = new Uint32Array( await a.renderer.getArrayBufferAsync( a.profile.nav.value, null, 16, 16 ) );
			sim[ 2 ] = .001; a.crowd.simBuf.value.array.set( sim, 4 ); a.crowd.simBuf.value.needsUpdate = true;
			a.profile.nav.value.array.set( nav, 4 ); a.profile.nav.value.needsUpdate = true;
			a.profile.identity.value.array[ 5 ] = 1; a.profile.identity.value.needsUpdate = true;

		} );
		await page.evaluate( () => window.city.stepTicks( 1 ) );
		const departed = await citizenState(); assert.ok( ! departed.dwelling ); assert.equal( departed.phase, 1 ); assert.equal( departed.target, 1 );
		const occupancy = await page.evaluate( async () => Array.from( new Uint32Array( await window.city.renderer.getArrayBufferAsync( window.city.profile.occupancy.value, null, 0, 4 ) ) ) );
		assert.equal( occupancy[ 0 ], 0 );
		const validation = await page.evaluate( () => window.city.validate( { full: true } ) ); assert.ok( validation.ok, JSON.stringify( validation ) );
		return { analyticError: Math.hypot( travelled.x - expected.x, travelled.z - expected.z ), red, green, clearance, arrived, departed, validation };

	} );

	await step( 'regeneration and population changes preserve bounded resource counts', async () => {

		const states = [];
		for ( let i = 0; i < 3; i ++ ) {

			await page.evaluate( ( i ) => window.city.regenerate( { seed: `smoke-regen-${i}`, population: i === 1 ? 25000 : 1000 } ), i ); await frames();
			const result = await page.evaluate( () => ( { state: window.city.describe(), memory: { ...window.city.renderer.info.memory } } ) );
			assert.equal( result.state.errors.length, 0 ); states.push( result );

		}
		assert.ok( states[ 2 ].memory.geometries <= states[ 0 ].memory.geometries + 4, JSON.stringify( states.map( ( s ) => s.memory ) ) );
		assert.ok( states[ 2 ].memory.textures <= states[ 0 ].memory.textures + 1 );
		return states.map( ( s ) => ( { citizens: s.state.citizens, memory: s.memory, gpuBytes: s.state.gpuDataBytes } ) );

	} );

	await step( 'dense public-space queue reports overflow and keeps legal finite movement', async () => {

		await page.evaluate( () => window.city.regenerate( { population: 200 } ) ); await frames();
		await page.evaluate( () => {

			const a = window.city, p = a.profile, e = a.data.graph.edges.find( ( e ) => e.kind === 'park' );
			for ( let i = 1; i <= 200; i ++ ) {

				const t = 8 + ( i - 1 ) % 20 * .55, lateral = ( Math.floor( ( i - 1 ) / 20 ) - 4.5 ) * .4;
				const x = e.x + e.dx * t - e.dz * lateral, z = e.z + e.dz * t + e.dx * lateral;
				a.crowd.renderBuf.value.array.set( [ x, 0, z, 1 + ( i % 4095 + 1 ) * 2048 ], i * 4 );
				a.crowd.simBuf.value.array.set( [ t, lateral, 0, Math.atan2( e.dx, e.dz ) ], i * 4 );
				p.previous.value.array.set( [ x, z ], i * 2 ); p.nav.value.array.set( [ e.id, 0, 0, 0 ], i * 4 );

			}
			for ( const b of [ a.crowd.renderBuf, a.crowd.simBuf, p.previous, p.nav ] ) b.value.needsUpdate = true;

		} );
		const before = await page.evaluate( () => window.city.sampleCitizens( [ 1, 30, 90, 170 ] ) );
		await page.evaluate( () => window.city.stepTicks( 10 ) );
		const after = await page.evaluate( () => window.city.sampleCitizens( [ 1, 30, 90, 170 ] ) );
		assert.ok( after.some( ( p, i ) => Math.hypot( p.x - before[ i ].x, p.z - before[ i ].z ) > .05 ) );
		const counters = await page.evaluate( async () => Array.from( new Uint32Array( await window.city.renderer.getArrayBufferAsync( window.city.profile.counters.value ) ) ) );
		assert.ok( counters[ 0 ] > 0 && counters[ 1 ] > 0, JSON.stringify( counters ) );
		const validation = await page.evaluate( () => window.city.validate( { full: true } ) ); assert.ok( validation.ok, JSON.stringify( validation ) );
		return { overflow: counters[ 0 ], overlapSamples: counters[ 1 ], validation };

	} );

	await step( 'latest generation wins and failed requests preserve the live city', async () => {

		const results = await page.evaluate( async () => {

			const first = window.city.regenerate( { seed: 'superseded-city', population: 1000 } );
			const second = window.city.regenerate( { seed: 'retained-city', population: 1000 } );
			const settled = await Promise.allSettled( [ first, second ] );
			let rejected = false;
			try { await window.city.regenerate( { population: 100001 } ); } catch { rejected = true; }
			return { firstRejected: settled[ 0 ].status === 'rejected', secondFinished: settled[ 1 ].status === 'fulfilled', invalidRejected: rejected, current: window.city.describe() };

		} );
		assert.ok( results.firstRejected && results.secondFinished && results.invalidRejected ); assert.equal( results.current.seed, 'retained-city' );
		assert.equal( results.current.errors.length, 0 ); return { currentSeed: results.current.seed, canceled: true, oldCityRetainedOnInvalidRequest: true };

	} );

	await step( '100001 active agents allocate, simulate and pass all-agent GPU validation', async () => {

		await page.evaluate( () => window.city.regenerate( { seed: 'harbor-100k', population: 100000 } ) );
		await page.evaluate( () => window.city.stepTicks( 30 ) );
		await page.evaluate( () => window.city.overview() ); await frames( 3 );
		const validation = await page.evaluate( () => window.city.validate( { full: true } ) );
		assert.equal( validation.liveCitizens, 100000 ); assert.equal( validation.liveActiveAgents, 100001 ); assert.ok( validation.ok, JSON.stringify( validation ) );
		const state = await page.evaluate( () => window.city.describe() );
		assert.equal( state.capacity, 131072 ); assert.ok( state.gpuDataBytes <= 96 * 1048576 );
		assert.equal( state.visibleByTier.reduce( ( a, b ) => a + b, 0 ), 100001 );
		await page.screenshot( { path: `${shots}/100k-city.png` } );
		return { validation, gpuBytes: state.gpuDataBytes, triangles: state.crowdTriangles + state.staticTriangles + state.trafficTriangles, visible: state.visibleByTier };

	} );

	await step( 'worker-disabled standalone uses the cooperative fallback', async () => {

		await page.evaluate( () => window.city.renderer.setAnimationLoop( null ) );
		const fallback = await browser.newPage( { viewport: { width: 800, height: 600 } } );
		fallback.on( 'pageerror', ( e ) => errors.push( e.message ) );
		await fallback.addInitScript( () => { window.Worker = class { constructor() { throw new Error( 'Worker unavailable in this fixture' ); } }; } );
		await fallback.goto( `${url}#population=1000&paused=1` );
		await fallback.waitForFunction( () => window.city || window.__fatal, null, { timeout: 90000 } );
		assert.equal( await fallback.evaluate( () => window.__fatal || null ), null );
		const state = await fallback.evaluate( () => window.city.describe() ); assert.equal( state.generationMode, 'cooperative main thread' );
		const validation = await fallback.evaluate( () => window.city.validate( { full: true } ) ); assert.ok( validation.ok, JSON.stringify( validation ) );
		await fallback.close(); return { mode: state.generationMode, validation };

	} );

	assert.equal( errors.length, 0, errors.join( '\n' ) );
	const bindingAudit = await page.evaluate( () => window.__cityBindingAudit );
	assert.ok( bindingAudit.length > 5 ); assert.ok( bindingAudit.every( ( p ) => p.bindings <= 8 ) );
	writeFileSync( `${shots}/smoke-results.json`, JSON.stringify( { softwareGPU: true, performanceClaim: false, steps, bindingAudit, errors }, null, 2 ) );
	console.log( `City smoke passed. Evidence: ${shots}/smoke-results.json` );

} catch ( error ) {

	console.error( error );
	writeFileSync( `${shots}/smoke-failure.json`, JSON.stringify( { steps, errors, failure: error.message }, null, 2 ) );
	await page.screenshot( { path: `${shots}/failure.png` } ).catch( () => {} ); process.exitCode = 1;

} finally { await browser.close(); }
