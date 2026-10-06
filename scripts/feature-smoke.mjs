// Real browser coverage for character saves, isolated planning and device
// preferences. Serves the production build over HTTP when --url is omitted.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { launchBrowser } from './browser.mjs';
import { serveBuild } from './http-build.mjs';

const option = ( name, fallback ) => {

	const i = process.argv.indexOf( name );
	return i < 0 ? fallback : process.argv[ i + 1 ];

};
const shots = option( '--shots', null );
if ( shots ) mkdirSync( shots, { recursive: true } );
let server;
let url = option( '--url', null );
if ( ! url ) {

	server = await serveBuild();
	url = server.origin + '/dist/game.html';

}
if ( ! /^https?:/.test( url ) ) throw new Error( 'Use an HTTP URL for browser feature tests.' );
const origin = new URL( url ).origin;
const gpuFlags = process.argv.includes( '--hardware' ) ? [ '--enable-unsafe-webgpu' ] : [ '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPUService', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist' ];
const browser = await launchBrowser( { args: gpuFlags } );
const context = await browser.newContext( { viewport: { width: 1100, height: 780 }, acceptDownloads: true } );
const page = await context.newPage();
page.setDefaultTimeout( 30000 );
const errors = [];
page.on( 'pageerror', ( e ) => errors.push( e.message ) );
page.on( 'console', ( m ) => { if ( m.type() === 'error' && ! /favicon|permissions policy/i.test( m.text() ) ) errors.push( m.text() ); } );
async function step( name, fn ) {

	const start = Date.now();
	await fn();
	if ( ! page.isClosed() ) {

		assert.equal( await page.evaluate( () => window.__fatal || null ), null );
		assert.deepEqual( await page.evaluate( () => window.game?.errors || [] ), [] );
		if ( shots ) await page.screenshot( { path: resolve( shots, name.replace( /\W+/g, '-' ) + '.png' ) } );

	}
	console.log( `ok ${name} (${( ( Date.now() - start ) / 1000 ).toFixed( 1 )}s)` );

}
const panel = ( id ) => page.locator( `[data-panel="${id}"]` );
const open = ( id ) => page.evaluate( ( id ) => window.ui.open( id, true ), id );
let character;
let buildCode;
try {

	await step( 'boot and closed feature panels', async () => {

		await page.goto( url + '#seed=features' );
		await page.waitForFunction( () => window.__fatal || window.__boot?.status === 'ready' );
		await page.locator( '[data-boot-choice="game"]' ).click();
		await page.waitForFunction( () => window.__fatal || window.game?.frameCount >= 2, null, { timeout: 180000 } );
		await page.evaluate( () => { window.game.gfx.set( { post: 'off' } ); window.ui.open( 'pause', true ); } );
		for ( const text of [ 'Character saves', 'Build Planner', 'Controls', 'Graphics' ] ) await panel( 'pause' ).getByRole( 'button', { name: text, exact: true } ).waitFor();
		assert.equal( await page.evaluate( () => [ 'planner', 'controls', 'save-manager', 'graphics' ].some( ( id ) => window.ui.isOpen( id ) ) ), false );

	} );
	await step( 'save export import undo and invalid JSON', async () => {

		const result = await page.evaluate( async () => {

			const g = window.game;
			g.save.gold = 100; await g.saves.save( g.save );
			g.save.gold = 200; await g.saves.save( g.save );
			return { code: g.saves.status.code, backup: g.saves.backup().gold };

		} );
		assert.deepEqual( result, { code: 'saved', backup: 100 } );
		await open( 'save-manager' );
		await panel( 'save-manager' ).getByRole( 'button', { name: 'Export character', exact: true } ).click();
		character = await panel( 'save-manager' ).getByLabel( 'Character JSON' ).inputValue();
		const imported = JSON.parse( character );
		assert.equal( imported.save.gold, 200 );
		imported.save.gold = 123;
		await panel( 'save-manager' ).getByLabel( 'Character JSON' ).fill( JSON.stringify( imported ) );
		await panel( 'save-manager' ).getByRole( 'button', { name: 'Validate and preview JSON', exact: true } ).click();
		await panel( 'save-manager' ).getByRole( 'button', { name: 'Use previewed character', exact: true } ).click();
		await page.waitForFunction( () => window.game.save.gold === 123 );
		assert.equal( await page.evaluate( () => window.game.saves.backup().gold ), 200 );
		await panel( 'save-manager' ).getByRole( 'button', { name: 'Preview previous save', exact: true } ).click();
		await panel( 'save-manager' ).getByRole( 'button', { name: 'Use previewed character', exact: true } ).click();
		await page.waitForFunction( () => window.game.save.gold === 200 );
		await panel( 'save-manager' ).getByLabel( 'Character JSON' ).fill( '{broken' );
		await panel( 'save-manager' ).getByRole( 'button', { name: 'Validate and preview JSON', exact: true } ).click();
		assert.equal( await page.evaluate( () => window.game.save.gold ), 200 );
		assert.equal( await panel( 'save-manager' ).getByRole( 'button', { name: 'Use previewed character', exact: true } ).isDisabled(), true );
		const unchanged = await page.evaluate( () => JSON.stringify( { ...window.game.save, savedAt: null } ) );
		for ( const corrupt of [
			( save ) => save.tree.allocated.push( 'missing-passive' ),
			( save ) => { save.tree.asc = { id: 'missing-ascendancy', allocated: [ 'missing:root' ] }; },
			( save ) => { save.skills.supports.fireball = [ 'missing-support' ]; }
		] ) {

			const invalid = JSON.parse( character ); corrupt( invalid.save );
			await panel( 'save-manager' ).getByLabel( 'Character JSON' ).fill( JSON.stringify( invalid ) );
			await panel( 'save-manager' ).getByRole( 'button', { name: 'Validate and preview JSON', exact: true } ).click();
			assert.equal( await panel( 'save-manager' ).getByRole( 'button', { name: 'Use previewed character', exact: true } ).isDisabled(), true );
			assert.equal( await page.evaluate( () => JSON.stringify( { ...window.game.save, savedAt: null } ) ), unchanged );

		}

	} );
	await step( 'planner future build tabs share and isolation', async () => {

		await open( 'planner' );
		await panel( 'planner' ).getByRole( 'button', { name: 'Reset to character', exact: true } ).click();
		const before = await page.evaluate( () => JSON.stringify( { ...window.game.save, savedAt: null } ) );
		await panel( 'planner' ).getByLabel( 'Target character level' ).fill( '30' );
		await panel( 'planner' ).getByLabel( 'Build name' ).fill( 'Future test build' );
		await panel( 'planner' ).getByLabel( 'Build name' ).press( 'Tab' );
		await panel( 'planner' ).getByRole( 'button', { name: /^Plan path/ } ).first().click();
		await panel( 'planner' ).getByRole( 'button', { name: 'Equipment', exact: true } ).click();
		const weapon = panel( 'planner' ).getByLabel( 'Main Hand', { exact: true } );
		const base = await weapon.locator( 'option' ).evaluateAll( ( options ) => options.find( ( o ) => o.value.startsWith( 'base:' ) ).value );
		await weapon.selectOption( base );
		assert.equal( await weapon.inputValue(), 'owned:0' ); // Catalog item becomes the selected draft snapshot.
		await panel( 'planner' ).getByRole( 'button', { name: 'Skills & supports', exact: true } ).click();
		await panel( 'planner' ).getByLabel( 'Skill LMB', { exact: true } ).selectOption( 'fireball' );
		await panel( 'planner' ).getByRole( 'checkbox', { name: /^Fireball:/ } ).first().check();
		assert.equal( await panel( 'planner' ).getByRole( 'checkbox', { name: /^Fireball:/ } ).first().isChecked(), true );
		for ( const tab of [ 'Stat comparison', 'Share / import' ] ) await panel( 'planner' ).getByRole( 'button', { name: tab, exact: true } ).click();
		buildCode = await panel( 'planner' ).getByLabel( 'Build code', { exact: true } ).inputValue();
		assert.ok( buildCode.startsWith( 'PRB1:' ) );
		await panel( 'planner' ).getByRole( 'button', { name: 'Reset to character', exact: true } ).click();
		await panel( 'planner' ).getByLabel( 'Build code', { exact: true } ).fill( buildCode );
		await panel( 'planner' ).getByRole( 'button', { name: 'Import to draft', exact: true } ).click();
		assert.equal( await panel( 'planner' ).getByLabel( 'Target character level' ).inputValue(), '30' );
		assert.equal( await panel( 'planner' ).getByLabel( 'Build name' ).inputValue(), 'Future test build' );
		assert.equal( await page.evaluate( () => JSON.stringify( { ...window.game.save, savedAt: null } ) ), before );
		await panel( 'planner' ).getByLabel( 'Build code', { exact: true } ).fill( 'PRB9:broken' );
		await panel( 'planner' ).getByRole( 'button', { name: 'Import to draft', exact: true } ).click();
		assert.equal( await panel( 'planner' ).getByLabel( 'Target character level' ).inputValue(), '30' );

	} );
	await step( 'keyboard binding recording conflict and live input', async () => {

		await open( 'controls' );
		await panel( 'controls' ).getByRole( 'button', { name: 'Add binding for Attack / skill 0', exact: true } ).click();
		await page.keyboard.press( 'KeyJ' );
		await panel( 'controls' ).getByRole( 'button', { name: 'Remove J from Attack / skill 0', exact: true } ).waitFor();
		await panel( 'controls' ).getByRole( 'button', { name: 'Add binding for Dodge', exact: true } ).click();
		await page.keyboard.press( 'KeyJ' );
		await panel( 'controls' ).getByRole( 'button', { name: 'Remove J from Dodge', exact: true } ).waitFor();
		assert.equal( await panel( 'controls' ).getByRole( 'button', { name: 'Remove J from Attack / skill 0', exact: true } ).count(), 0 );
		assert.match( await panel( 'controls' ).locator( '.controls-status' ).textContent(), /Removed from Attack/ );
		await panel( 'controls' ).getByRole( 'button', { name: 'Resume', exact: true } ).click();
		await page.keyboard.down( 'KeyJ' );
		assert.equal( await page.evaluate( () => window.game.input.held.has( 'dodge' ) ), true );
		await page.keyboard.up( 'KeyJ' );
		assert.equal( await page.evaluate( () => window.game.input.held.has( 'dodge' ) ), false );
		await open( 'controls' );
		await panel( 'controls' ).getByRole( 'button', { name: 'Gamepad', exact: true } ).click();
		await panel( 'controls' ).getByRole( 'button', { name: 'Reset this device', exact: true } ).click();
		const bindings = await page.evaluate( () => JSON.parse( localStorage.getItem( 'polyreaver.controls.v1' ) ).bindings );
		assert.ok( bindings.keyboard.dodge.includes( 'KeyJ' ) );
		assert.deepEqual( bindings.gamepad.attack, [ 0 ] );

	} );
	await step( 'adaptive quality UI manual override and device settings', async () => {

		await open( 'graphics' );
		await page.locator( '#gfx-quality' ).selectOption( 'adaptive30' );
		assert.equal( await page.evaluate( () => window.game.gfx.get().quality ), 'adaptive30' );
		await page.locator( '#gfx-scale' ).selectOption( '0.75' );
		assert.equal( await page.evaluate( () => window.game.gfx.get().quality ), 'manual' );
		await page.locator( '#gfx-quality' ).selectOption( 'adaptive60' );
		assert.match( await page.locator( '#gfx-quality-status' ).textContent(), /60/ );
		assert.equal( await page.evaluate( () => window.game.gfx.get().currentScale ), 0.75 );
		assert.equal( await page.evaluate( () => JSON.parse( localStorage.getItem( 'polyreaver.gfx' ) ).quality ), 'adaptive60' );
		assert.equal( await page.evaluate( () => window.game.paused ), true );

	} );
	await step( 'preferences and planner survive page reload', async () => {

		await page.reload();
		await page.waitForFunction( () => window.__boot?.status === 'ready' || window.__fatal );
		await page.locator( '[data-boot-choice="game"]' ).click();
		await page.waitForFunction( () => window.game?.frameCount >= 2 || window.__fatal, null, { timeout: 180000 } );
		await page.evaluate( () => window.game.gfx.set( { post: 'off' } ) );
		assert.equal( await page.evaluate( () => window.game.save.gold ), 200 );
		assert.equal( await page.evaluate( () => window.game.gfx.get().quality ), 'adaptive60' );
		await open( 'controls' );
		await panel( 'controls' ).getByRole( 'button', { name: 'Remove J from Dodge', exact: true } ).waitFor();
		await open( 'planner' );
		assert.equal( await panel( 'planner' ).getByLabel( 'Target character level' ).inputValue(), '30' );
		assert.equal( await panel( 'planner' ).getByLabel( 'Build name' ).inputValue(), 'Future test build' );

	} );
	await step( 'a second tab cannot overwrite the active character', async () => {

		await context.route( '**/__features_tab.html', ( route ) => route.fulfill( { contentType: 'text/html', body: '<!doctype html><title>Persistence fixture</title>' } ) );
		const tab = await context.newPage();
		await tab.goto( origin + '/__features_tab.html' );
		const readOnly = await tab.evaluate( async () => {

			await import( '/src/game/sim-entry.js' );
			const { SaveManager } = await import( '/src/game/features/progression/persistence.js' );
			window.manager = new SaveManager();
			const save = await window.manager.load();
			save.gold = 50;
			return { written: await window.manager.save( save ), writer: window.manager.writer, code: window.manager.status.code, gold: JSON.parse( localStorage.getItem( 'polyreaver.save.v1' ) ).save.gold };

		} );
		assert.equal( readOnly.written, false );
		assert.equal( readOnly.writer, false );
		assert.equal( readOnly.gold, 200 );
		await page.close();
		await tab.waitForFunction( async () => {

			const save = await window.manager.latest();
			return save && window.manager.writer;

		} );
		const takeover = await tab.evaluate( async () => {

			const save = await window.manager.latest();
			save.gold = 300;
			return { saved: await window.manager.save( save ), gold: JSON.parse( localStorage.getItem( 'polyreaver.save.v1' ) ).save.gold };

		} );
		assert.deepEqual( takeover, { saved: true, gold: 300 } );
		// Preserve and recover malformed data without booting another GPU renderer.
		const recovered = await tab.evaluate( async () => {

			const { SaveManager } = await import( '/src/game/features/progression/persistence.js' );
			window.manager.dispose();
			const original = '{broken-character';
			localStorage.setItem( 'polyreaver.save.v1', original );
			const manager = new SaveManager();
			const loaded = await manager.load();
			const outcome = { loaded, code: manager.status.code, original: manager.recovery().raw, stored: localStorage.getItem( 'polyreaver.save.v1' ) };
			manager.dispose();
			return outcome;

		} );
		assert.deepEqual( recovered, { loaded: null, code: 'recovery', original: '{broken-character', stored: '{broken-character' } );
		await tab.close();

	} );
	assert.deepEqual( errors, [] );
	console.log( 'All 7 browser feature flows passed.' );

} finally {

	await browser.close();
	if ( server ) await server.close();

}
