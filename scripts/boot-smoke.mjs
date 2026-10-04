import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchBrowser } from './browser.mjs';

const args = process.argv.slice( 2 );
const external = args.includes( '--url' ) ? args[ args.indexOf( '--url' ) + 1 ] : null;
const server = external ? null : createServer( ( req, res ) => {

	try {

		const path = resolve( 'dist', '.' + ( req.url === '/' ? '/index.html' : req.url.split( '?' )[ 0 ] ) );
		if ( ! path.startsWith( resolve( 'dist' ) + '/' ) ) throw new Error( 'Invalid path' );
		res.setHeader( 'Content-Type', extname( path ) === '.js' ? 'text/javascript' : 'text/html' );
		res.end( readFileSync( path ) );

	} catch { res.writeHead( 404 ); res.end(); }

} );
if ( server ) await new Promise( ( done ) => server.listen( 0, '127.0.0.1', done ) );
const url = external || `http://127.0.0.1:${server.address().port}/`;
const browser = await launchBrowser( { args: [ '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPUService', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist' ] } );
mkdirSync( 'artifacts/boot', { recursive: true } );
const ready = ( page ) => page.waitForFunction( () => [ 'ready', 'failed' ].includes( window.__boot?.status ), null, { timeout: 40000 } );
const fail = ( page ) => page.waitForFunction( () => window.__boot?.status === 'failed', null, { timeout: 40000 } );
async function cityReady( page ) {

	await page.waitForFunction( () => window.__fatal || window.__boot?.status === 'running' && window.app?.frameCount > 2, null, { timeout: 180000 } );
	assert.equal( await page.evaluate( () => window.__fatal || window.__boot.mode ), 'stress' );
	const state = await page.evaluate( () => ( { scene: window.app.S.scene, count: window.app.crowd.count, buildings: window.app.world.city?.buildings.length, separate: !! window.city } ) );
	assert.equal( state.scene, 'city' ); assert.equal( state.count, 20000 ); assert.ok( state.buildings > 3000 ); assert.equal( state.separate, false );
	assert.equal( await page.getByLabel( 'Scene', { exact: true } ).isEnabled(), true );

}
async function check( name, fn, options = {} ) {

	const context = await browser.newContext( { viewport: { width: 960, height: 720 }, ...options } );
	const page = await context.newPage();
	try { await fn( page, context ); console.log( `PASS ${name}` ); }
	finally { await context.close(); }

}

try {

	await check( 'boot completes before UI, engine requests, or loop; keyboard chooser', async ( page ) => {

		const requests = [];
		page.on( 'request', ( req ) => requests.push( req.url() ) );
		await page.goto( url ); await ready( page );
		assert.equal( await page.evaluate( () => window.__boot.status ), 'ready' );
		assert.equal( requests.filter( ( x ) => x.includes( '/engines/' ) ).length, 0 );
		assert.equal( await page.evaluate( () => !! ( window.game || window.app || window.city || document.getElementById( 'engine-root' ) ) ), false );
		assert.deepEqual( await page.evaluate( () => window.__boot.stages.map( ( x ) => x.code ) ), [ 'PLAT', 'GPU', 'CHECK' ] );
		await page.keyboard.press( 'Tab' );
		assert.equal( await page.evaluate( () => document.activeElement.dataset.bootChoice ), 'game' );
		await page.screenshot( { path: 'artifacts/boot/desktop.png', fullPage: true } );
		await page.locator( '#boot-copy' ).click();
		assert.ok( await page.evaluate( () => document.getElementById( 'boot-copy' ).textContent.includes( 'copied' ) || ! document.getElementById( 'boot-report' ).hidden ) );

	} );
	await check( 'phone layout and both touch targets', async ( page ) => {

		await page.goto( url ); await ready( page );
		assert.equal( await page.evaluate( () => window.__boot.status ), 'ready' );
		for ( const id of [ 'game', 'stress' ] ) {

			const box = await page.locator( `[data-boot-choice="${id}"]` ).boundingBox();
			assert.ok( box.width >= 44 && box.height >= 44 && box.x >= 0 && box.x + box.width <= 390 );

		}
		await page.screenshot( { path: 'artifacts/boot/phone.png', fullPage: true } );

	}, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } );
	for ( const mode of [ 'game', 'stress' ] ) await check( `hosted ${mode} first frame and running loop`, async ( page ) => {

		await page.addInitScript( () => {

			const request = GPUAdapter.prototype.requestDevice;
			GPUAdapter.prototype.requestDevice = async function ( options ) { window.__device = await request.call( this, options ); return window.__device; };

		} );
		const errors = [], requests = [];
		page.on( 'pageerror', ( error ) => errors.push( error.message ) );
		page.on( 'request', ( req ) => requests.push( req.url() ) );
		await page.goto( url + '#fresh' ); await ready( page );
		await page.locator( `[data-boot-choice="${mode}"]` ).click();
		await page.waitForFunction( () => [ 'running', 'failed' ].includes( window.__boot?.status ), null, { timeout: 180000 } );
		assert.equal( await page.evaluate( () => window.__fatal || window.__boot.status ), 'running' );
		await page.waitForFunction( ( mode ) => ( mode === 'game' ? window.game : window.app ).frameCount > 2, mode );
		if ( mode === 'stress' ) {

			await cityReady( page );
			await page.getByRole( 'button', { name: 'City overview', exact: true } ).click();

		}
		assert.equal( await page.locator( '#boot' ).isVisible(), false );
		// Exercise actual pointer input: a programmatic rig zoom does not click the
		// canvas, whose Three.js data-engine metadata used to trigger navigation.
		const beforeURL = page.url();
		assert.equal( await page.locator( 'canvas[data-engine]' ).evaluate( ( canvas ) => canvas.onclick ), null );
		await page.mouse.click( 300, 300 );
		await page.mouse.move( 300, 300 ); await page.mouse.down();
		const home = await page.locator( '#engine-home' ).boundingBox();
		await page.mouse.move( home.x + home.width / 2, home.y + home.height / 2, { steps: 8 } );
		await page.mouse.up();
		await page.mouse.move( 300, 300 ); await page.mouse.wheel( 0, 600 ); await page.mouse.wheel( 0, -600 );
		await page.waitForTimeout( 100 );
		assert.equal( page.url(), beforeURL, 'map gestures must not navigate back to the chooser' );
		assert.equal( await page.evaluate( () => window.__fatal || window.__boot.status ), 'running' );
		assert.equal( await page.locator( '#boot' ).isVisible(), false );
		assert.equal( requests.filter( ( x ) => x.includes( '/engines/' ) ).length, 1 );
		assert.ok( requests.some( ( x ) => x.includes( `/engines/${mode === 'stress' ? 'stress' : 'game'}-` ) ) );
		assert.deepEqual( errors, [] );
		await page.screenshot( { path: `artifacts/boot/hosted-${mode}.png` } );
		await page.evaluate( () => window.__device.destroy() ); await fail( page );
		const loss = await page.evaluate( () => window.__boot.errors[ 0 ] );
		assert.ok( loss.code === 'GPU-LOST', JSON.stringify( loss ) );
		const frames = await page.evaluate( ( mode ) => ( mode === 'game' ? window.game : window.app ).frameCount, mode );
		await page.waitForTimeout( 100 );
		assert.equal( await page.evaluate( ( mode ) => ( mode === 'game' ? window.game : window.app ).frameCount, mode ), frames );

	} );
	if ( ! external ) await check( 'standalone unified stress test works offline; scene round trip', async ( page ) => {

		assert.deepEqual( readFileSync( 'polyreaver.html' ), readFileSync( 'webgpu-crowd-stress.html' ) );
		const html = readFileSync( 'webgpu-crowd-stress.html', 'utf8' );
		assert.equal( ( html.match( /id="boot-engine-/g ) || [] ).length, 2 );
		await page.route( /^https?:/, ( route ) => route.abort() );
		await page.goto( pathToFileURL( resolve( 'webgpu-crowd-stress.html' ) ).href ); await ready( page );
		await page.locator( '[data-boot-choice="stress"]' ).click(); await cityReady( page );
		await page.getByLabel( 'Scene', { exact: true } ).selectOption( 'plaza' ); await page.evaluate( () => window.app.sceneTask );
		assert.equal( await page.evaluate( () => window.app.world.city ), null );
		await page.getByLabel( 'Scene', { exact: true } ).selectOption( 'city' ); await page.evaluate( () => window.app.sceneTask ); await cityReady( page );

	} );
	await check( 'legacy classic route starts the unified engine with the plaza', async ( page ) => {

		await page.goto( new URL( 'classic-crowd.html#count=100', url ).href );
		await page.waitForFunction( () => window.__fatal || window.__boot?.status === 'running' && window.app?.frameCount > 2, null, { timeout: 180000 } );
		assert.equal( await page.evaluate( () => window.__fatal || window.__boot.mode ), 'stress' );
		assert.equal( await page.evaluate( () => window.app.S.scene ), 'plaza' );
		assert.equal( await page.getByLabel( 'Scene', { exact: true } ).inputValue(), 'plaza' );

	} );
	// Fault injection proves that failure screens retain the original stage and
	// that a timed-out asynchronous operation cannot later start the game loop.
	for ( const [ name, setup, code ] of [
		[ 'missing WebGPU', () => Object.defineProperty( navigator, 'gpu', { value: undefined } ), 'GPU-FAIL' ],
		[ 'no adapter', () => { navigator.gpu.requestAdapter = async () => null; }, 'GPU-FAIL' ],
		[ 'device rejected', () => { GPUAdapter.prototype.requestDevice = async () => { throw new Error( 'Injected device rejection' ); }; }, 'GPU-FAIL' ],
		[ 'missing WebAssembly', () => { window.WebAssembly = undefined; }, 'PLAT-FAIL' ],
		[ 'adapter timeout', () => {

			const timer = window.setTimeout;
			window.setTimeout = ( fn, ms, ...rest ) => timer( fn, ms === 30000 ? 100 : ms, ...rest );
			navigator.gpu.requestAdapter = () => new Promise( () => {} );

		}, 'GPU-TIME' ]
	] ) await check( name, async ( page ) => {

		await page.addInitScript( setup ); await page.goto( url ); await fail( page );
		const state = await page.evaluate( () => window.__boot );
		assert.equal( state.errors[ 0 ].code, code );
		assert.ok( state.build && state.platform && state.errors[ 0 ].stage );
		assert.equal( await page.locator( '#boot-error' ).isVisible(), true );
		assert.equal( await page.locator( '#boot-retry' ).isVisible(), true );
		assert.equal( await page.evaluate( () => !! ( window.app || window.game ) ), false );
		await page.screenshot( { path: `artifacts/boot/${name.replaceAll( ' ', '-' )}.png`, fullPage: true } );

	} );
	await check( 'storage denied still reaches chooser and reports saving unavailable', async ( page ) => {

		await page.addInitScript( () => { Storage.prototype.setItem = () => { throw new Error( 'Storage denied' ); }; } );
		await page.goto( url ); await ready( page );
		assert.equal( await page.evaluate( () => window.__boot.status ), 'ready' );
		assert.equal( await page.evaluate( () => window.__boot.capabilities.storage ), false );
		assert.match( await page.locator( '#boot-help' ).innerText(), /Saving unavailable/ );

	} );
	await check( 'compatibility adapter retry', async ( page ) => {

		await page.addInitScript( () => {

			const request = navigator.gpu.requestAdapter.bind( navigator.gpu );
			window.__adapterAttempts = [];
			navigator.gpu.requestAdapter = async ( options ) => {

				window.__adapterAttempts.push( options.featureLevel || 'core' );
				return options.featureLevel === 'compatibility' ? request( options ) : null;

			};

		} );
		await page.goto( url ); await ready( page );
		assert.equal( await page.evaluate( () => window.__boot.status ), 'ready' );
		assert.deepEqual( await page.evaluate( () => window.__adapterAttempts ), [ 'core', 'compatibility' ] );

	} );
	await check( 'device loss on chooser', async ( page ) => {

		await page.addInitScript( () => {

			const request = GPUAdapter.prototype.requestDevice;
			GPUAdapter.prototype.requestDevice = async function ( options ) { window.__device = await request.call( this, options ); return window.__device; };

		} );
		await page.goto( url ); await ready( page ); await page.evaluate( () => window.__device.destroy() ); await fail( page );
		assert.equal( await page.evaluate( () => window.__boot.errors[ 0 ].code ), 'GPU-LOST' );

	} );
	for ( const [ name, source, code ] of [
		[ 'module error', 'throw new Error("Injected module error");', 'LOAD-FAIL' ],
		[ 'system error', 'export function initialize() { throw new Error("Injected initialization error"); }', 'SYS-FAIL' ],
		[ 'system error after renderer', 'export async function initialize({boot}) { await boot.step("REN", "Test renderer", 55, () => {}); throw new Error("Injected system error after renderer"); }', 'SYS-FAIL' ],
		[ 'first frame error', 'export function initialize() { return { frame() { throw new Error("Injected first frame error"); }, start() { window.__started = true; }, stop() {} }; }', 'FRAME-FAIL' ],
		[ 'late initialization', 'export async function initialize() { await new Promise(r => setTimeout(r, 1000)); return { frame() {}, start() { window.__started = true; }, stop() {} }; }', 'SYS-TIME' ]
	] ) await check( name, async ( page ) => {

		await page.addInitScript( () => {

			const timer = window.setTimeout;
			window.setTimeout = ( fn, ms, ...rest ) => timer( fn, ms === 120000 ? 100 : ms, ...rest );

		} );
		await page.route( '**/engines/*.js', ( route ) => route.fulfill( { contentType: 'text/javascript', body: source } ) );
		await page.goto( url ); await ready( page ); await page.locator( '[data-boot-choice="game"]' ).click(); await fail( page );
		assert.equal( await page.evaluate( () => window.__boot.errors[ 0 ].code ), code );
		assert.equal( await page.evaluate( () => window.__boot.errors[ 0 ].stage ), code.split( '-' )[ 0 ] );
		if ( name === 'late initialization' ) await page.waitForTimeout( 1200 );
		assert.equal( await page.evaluate( () => !! window.__started ), false );
		assert.equal( await page.locator( '#boot' ).isVisible(), true );

	} );
	for ( const [ name, replacement, code ] of [
		[ 'startup syntax failure', '<script type="module">invalid syntax {</script>', 'BOOT-JS' ],
		[ 'missing startup module', '', 'BOOT-TIME' ],
		[ 'late startup module', null, 'BOOT-TIME' ]
	] ) await check( name, async ( page ) => {

		await page.addInitScript( () => {

			const timer = window.setTimeout;
			window.setTimeout = ( fn, ms, ...rest ) => timer( fn, ms === 20000 ? 80 : ms, ...rest );

		} );
		await page.route( url, async ( route ) => {

			const response = await route.fetch();
			const html = await response.text();
			const body = html.replace( /<script type="module"[^>]*>[\s\S]*?<\/script>/, ( script ) => replacement ?? script.replace( /(<script[^>]*>)/, '$1await new Promise(r => setTimeout(r, 250));' ) );
			await route.fulfill( { response, body } );

		} );
		await page.goto( url ); await fail( page );
		if ( name === 'late startup module' ) await page.waitForTimeout( 400 );
		assert.equal( await page.evaluate( () => window.__boot.errors[ 0 ].code ), code );
		assert.equal( await page.locator( '#boot-error' ).isVisible(), true );
		assert.equal( await page.locator( '#boot-retry' ).isVisible(), true );

	} );
	await check( 'no JavaScript still shows a useful startup screen', async ( page ) => {

		await page.goto( url );
		assert.match( await page.locator( 'noscript' ).innerText(), /JS-OFF/ );
		assert.ok( await page.locator( '#boot-build' ).innerText() );

	}, { javaScriptEnabled: false } );
	console.log( 'All boot checks passed.' );

} finally {

	await browser.close();
	server?.close();

}
