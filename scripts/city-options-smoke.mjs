import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { launchBrowser } from './browser.mjs';
import { SECTIONS, PRESETS } from '../src/features.js';

const args = process.argv.slice( 2 );
const quick = args.includes( '--quick' );
const base = args.includes( '--url' ) ? args[ args.indexOf( '--url' ) + 1 ] : pathToFileURL( resolve( 'city-demo.html' ) ).href;
const browser = await launchBrowser( { args: [ '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPUService', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist' ] } );
const page = await browser.newPage( { viewport: { width: 1280, height: 800 } } );
const errors = [];
page.on( 'pageerror', ( e ) => errors.push( e.message ) );
page.on( 'console', ( m ) => { if ( [ 'error', 'warning' ].includes( m.type() ) && ! /experimental on this platform|DevTools|deprecated parameters/.test( m.text() ) ) errors.push( m.text().slice( 0, 1000 ) ); } );
mkdirSync( 'artifacts/boot/options', { recursive: true } );
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
const frames = async ( n = 3 ) => {

	const count = await page.evaluate( () => window.city?.frameCount || 0 );
	await page.waitForFunction( ( target ) => window.__fatal || window.city?.frameCount >= target, count + n, { timeout: 120000 } );
	assert.equal( await page.evaluate( () => window.__fatal || null ), null );
	assert.deepEqual( errors.splice( 0 ), [] );

};
async function step( name, fn ) {

	await fn(); await frames(); console.log( 'PASS ' + name );

}
try {

	await page.goto( base + '?engine=stress#population=1000' );
	await page.waitForFunction( () => window.__fatal || window.__boot?.status === 'running', null, { timeout: 120000 } );
	await frames();
	const keys = SECTIONS.flatMap( ( s ) => s.items.filter( ( i ) => i.key ).map( ( i ) => i.key ) );
	assert.deepEqual( ( await page.evaluate( () => [ ...window.city.ui.controls.keys() ] ) ).sort(), keys.sort() );
	console.log( `PASS all ${keys.length} original setting controls are present` );
	const baseline = await page.evaluate( () => ( { ...window.city.S } ) );
	await step( 'visible options tab changes the real city material', async () => {

		await page.getByRole( 'tab', { name: 'Engine options', exact: true } ).click();
		await page.getByRole( 'button', { name: 'Shading & lighting' } ).click();
		await page.getByLabel( 'Shading model', { exact: true } ).selectOption( 'lambert' );
		await page.waitForFunction( () => window.city.S.shading === 'lambert' && window.city.world.kind === 'lambert' && window.city.crowd.materialKind === 'lambert' );
		await page.getByRole( 'tab', { name: 'City', exact: true } ).click();
		await page.evaluate( ( baseline ) => window.city.applyAll( baseline ), baseline );

	} );
	for ( const id of quick ? [ 'mobile', 'toon', 'physics' ] : Object.keys( PRESETS ) ) await step( 'preset ' + id, async () => {

		await page.evaluate( ( id ) => window.city.preset( id ), id );
		await frames( 2 );
		await page.evaluate( ( baseline ) => window.city.applyAll( baseline ), baseline );

	} );
	const scenarios = [
		...[ 'direct', 'gpu' ].flatMap( ( path ) => [ 'none', 'procedural', 'keyframe', 'skeletal', 'bat', 'vat' ].map( ( anim ) => ( { path, anim, tier: 3 } ) ) ),
		...[ 'off', 'low', 'medium', 'high', 'vsm' ].map( ( shadows ) => ( { shadows, shading: 'standard', crowdShadows: true } ) ),
		...[ 'flat', 'gradient', 'physical' ].map( ( sky ) => ( { sky } ) ),
		...[ 'off', 'distance', 'height' ].map( ( fog ) => ( { fog } ) ),
		...[ 'none', 'msaa', 'fxaa', 'smaa', 'traa' ].map( ( aa ) => ( { aa } ) ),
		{ upscaler: 'fsr1', renderScale: .5, aa: 'fxaa' }, { renderScale: .5 },
		...[ 'ssao', 'gtao' ].map( ( ao ) => ( { ao } ) ),
		...[ 'tiltshift', 'bokeh' ].map( ( dof ) => ( { dof } ) ),
		...[ 'camera', 'root', 'full' ].map( ( motionVectors ) => ( { motionVectors, motionBlur: true, anim: 'keyframe' } ) ),
		{ ssgi: true }, { ssr: true, shading: 'standard' }, { pointLights: 256, clustered: true, shading: 'lambert' },
		...[ 'ink', 'pixel', 'pico8', 'gameboy', 'snes', 'crt', 'retro' ].map( ( stylize ) => ( { stylize } ) ),
		{ physics: true, bodies: 100, crowdMode: 'off' },
		{ physics: true, bodies: 100, crowdMode: 'gpu', proxies: true, propsDynamic: true, physDebug: true },
		{ physics: true, bodies: 100, crowdMode: 'rapier', rapierAgents: 500 }
	];
	for ( const values of quick ? [ { path: 'direct', anim: 'skeletal', tier: 3 }, { path: 'gpu', anim: 'vat', tier: 2 }, { physics: true, bodies: 100, crowdMode: 'gpu', proxies: true }, { physics: true, bodies: 100, crowdMode: 'rapier', rapierAgents: 500 } ] : scenarios ) await step( JSON.stringify( values ), async () => {

		await page.evaluate( ( values ) => window.city.applyAll( values ), { ...baseline, ...values } );

	} );
	await step( 'physics actions', async () => {

		await page.evaluate( () => window.city.action( 'explode' ) );
		await page.evaluate( () => window.city.action( 'wrecking' ) );
		await page.evaluate( () => window.city.action( 'respawn' ) );

	} );
	await step( 'settings survive population and capacity changes', async () => {

		await page.evaluate( ( baseline ) => window.city.applyAll( { ...baseline, shading: 'toon', tier: 2, count: 2000, capacity: 65536 } ), baseline );
		assert.deepEqual( await page.evaluate( () => [ window.city.crowd.count, window.city.crowd.capacity, window.city.S.shading, window.city.crowd.materialKind ] ), [ 2001, 65536, 'toon', 'toon' ] );
		await page.locator( '#seed' ).fill( 'shared-options' ); await page.locator( '#regenerate' ).click();
		await page.waitForFunction( () => window.city.config.seed === 'shared-options' );
		assert.equal( await page.evaluate( () => window.city.crowd.materialKind ), 'toon' );

	} );
	await page.locator( '#options-tab' ).click();
	await page.screenshot( { path: 'artifacts/boot/options/city.png' } );
	await step( 'street-safe behaviors and speed', async () => {

		for ( const behaviour of [ 1, 2, 3, 4, 5, 0 ] ) {

			await page.evaluate( ( behaviour ) => window.city.set( 'behaviour', behaviour ), behaviour ); await frames( 4 );
			const result = await page.evaluate( () => window.city.validate( { full: true } ) );
			assert.equal( result.ok, true, JSON.stringify( result ) );

		}

	} );
	await step( 'effect benchmark cancellation restores settings', async () => {

		await page.evaluate( () => { window.__fx = window.city.bench.measureEffects(); } ); await frames( 4 );
		await page.evaluate( () => window.city.action( 'benchStop' ) );
		await page.evaluate( () => window.__fx );
		assert.equal( await page.evaluate( () => window.city.bench.running ), false );

	} );
	await page.selectOption( '#engine-select', 'classic' );
	await page.waitForFunction( () => window.__fatal || window.__boot?.status === 'running' && window.app?.frameCount > 2, null, { timeout: 180000 } );
	assert.equal( await page.evaluate( () => window.__boot.mode ), 'classic' );
	await page.selectOption( '#engine-select', 'stress' );
	await page.waitForFunction( () => window.__fatal || window.__boot?.status === 'running' && window.city?.frameCount > 2, null, { timeout: 180000 } );
	assert.deepEqual( await page.evaluate( () => [ window.city.config.seed, window.city.config.population, window.city.S.shading ] ), [ 'shared-options', 2000, 'toon' ] );
	console.log( 'PASS visible switcher round trip restores city options' );
	console.log( 'All city options checks passed (eight-binding compute audit enabled).' );

} finally { await browser.close(); }
