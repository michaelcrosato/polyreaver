// Headless smoke test for Polyreaver (the showcase game): boots the single-file
// build in Chromium with the SwiftShader software GPU, visits the town, plays a
// level with the built-in bot (or a trivial fallback), opens every UI panel, builds two
// Workshop galleries, and fails on any page error,
// WebGPU validation error or fatal screen. Proves things run, not how fast.
//
//   npm run build:game && node scripts/game-smoke.mjs [--shots dir/] [--depth 3] [--url ...]

import { launchBrowser } from './browser.mjs';
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const argv = process.argv.slice( 2 );
const opt = ( n, d ) => {

	const i = argv.indexOf( n );
	return i < 0 ? d : argv[ i + 1 ];

};

const shots = opt( '--shots', null );
const depth = + opt( '--depth', 1 );
const seconds = + opt( '--seconds', 25 );
const url = opt( '--url', pathToFileURL( resolve( 'dist-game/game.html' ) ).href ) + '#fresh&seed=smoke';
const FLAGS = [ '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPUService', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist' ];
const NOISE = /Download the|DevTools|experimental on this platform|deprecated parameters for the initialization function|permissions policy violation/;

const browser = await launchBrowser( { args: FLAGS } );
const page = await browser.newPage( { viewport: { width: 960, height: 600 } } );
const errors = [];
page.on( 'console', ( m ) => {

	if ( ( m.type() === 'error' || m.type() === 'warning' ) && ! NOISE.test( m.text() ) ) errors.push( m.type() + ': ' + m.text().slice( 0, 400 ) );

} );
page.on( 'pageerror', ( e ) => errors.push( 'pageerror: ' + e.message ) );
if ( shots ) mkdirSync( shots, { recursive: true } );

const step = async ( name, fn ) => {

	const t = Date.now();
	const before = errors.length;
	let note = '';
	try {

		note = ( await fn() ) || '';

	} catch ( e ) {

		errors.push( `${name}: ${e.message.split( '\n' )[ 0 ]}` );

	}

	const fatal = await page.evaluate( () => window.__fatal || null ).catch( () => null );
	if ( fatal ) errors.push( 'FATAL ' + fatal );
	if ( shots ) await page.screenshot( { path: `${shots}/${name.replace( /\W+/g, '_' )}.png` } ).catch( () => {} );
	const fresh = errors.slice( before );
	console.log( `${fresh.length ? 'FAIL' : 'ok  '} ${name.padEnd( 26 )} ${( ( Date.now() - t ) / 1000 ).toFixed( 1 )}s ${note}${fresh.length ? '\n     ' + fresh.slice( 0, 8 ).join( '\n     ' ) : ''}` );

};

const frames = ( n ) => page.evaluate( ( n ) => new Promise( ( r ) => {

	const start = window.game.frameCount;
	const tick = () => window.game.frameCount >= start + n ? r() : requestAnimationFrame( tick );
	tick();

} ), n );

await step( 'boot + town', async () => {

	await page.goto( url );
	await page.waitForFunction( () => window.__fatal || window.__boot?.status === 'ready' );
	if ( await page.evaluate( () => window.__fatal ) ) throw new Error( await page.evaluate( () => window.__fatal ) );
	await page.locator( '[data-boot-choice="game"]' ).click();
	await page.waitForFunction( () => window.__fatal || window.game?.frameCount >= 5, null, { timeout: 180000 } );
	// post-processing off for the long steps: under SwiftShader the bloom pass stalls the
	// GPU process after ~70 frames (real GPUs are fine); the 'post-processing' step below
	// checks the pipeline separately, briefly
	await page.evaluate( () => window.game.gfx?.set( { post: 'off' } ) );
	// nothing modal may be open when the game starts (a panel without a toggle starts open)
	const modal = await page.evaluate( () => [ ...window.ui.panels ].filter( ( [ , p ] ) => p.open && p.def.modal ).map( ( [ id ] ) => id ) );
	if ( modal.length ) throw new Error( 'modal panel open at boot: ' + modal.join( ', ' ) );
	return JSON.stringify( await page.evaluate( () => window.game.describe().world.entities ) );

} );

await step( `level ${depth} with bot`, async () => {

	await page.evaluate( ( d ) => window.game.enterLevel( d ), depth );
	await frames( 5 );
	// prefer the real bot (tools feature); fall back to a trivial chase-and-swing loop
	const r = await page.evaluate( async ( secs ) => {

		const g = window.game;
		// the real playtest bot (tools feature), stepped live by the link's frame hook
		if ( g.link && g.api ) {

			const bot = g.api( 'bot.create', {} );
			g.link.bot = bot;
			await new Promise( ( res ) => setTimeout( res, secs * 1000 ) );
			g.link.bot = null;
			g.input.held.clear();
			g.input.move.x = g.input.move.z = 0;
			return bot.report();

		}
		const t0 = performance.now();
		while ( performance.now() - t0 < secs * 1000 ) {

			const w = g.world, p = w.player;
			const foes = w.entities.filter( ( e ) => e.alive && e.team === 1 );
			if ( ! foes.length || ! p.alive ) break;
			const f = foes.reduce( ( a, b ) => ( p.distTo( a ) < p.distTo( b ) ? a : b ) );
			const d = p.distTo( f );
			g.input.move.x = d > 2 ? ( f.x - p.x ) / d : 0; g.input.move.z = d > 2 ? ( f.z - p.z ) / d : 0;
			g.input.aim.x = f.x; g.input.aim.z = f.z;
			if ( d < 3 ) g.input.held.add( 'attack' ); else g.input.held.delete( 'attack' );
			await new Promise( ( res ) => setTimeout( res, 50 ) );

		}

		g.input.held.clear();
		g.input.move.x = g.input.move.z = 0;
		return g.world.describe().stats;

	}, seconds );
	return JSON.stringify( r );

} );

await step( 'post-processing', async () => {

	if ( ! await page.evaluate( () => !! window.game.gfx ) ) return 'no gfx module';
	await page.evaluate( () => window.game.gfx.set( { post: 'on' } ) );
	await frames( 8 );
	await page.evaluate( () => window.game.gfx.set( { post: 'off' } ) );
	await frames( 2 );
	return '8 frames with bloom + grade';

} );

await step( 'pause menu + tuning', async () => {

	await page.evaluate( () => {

		window.ui.action( 'pause' );
		window.game.setTuning( { enemyLife: 2, playerDamage: 3 } );
		window.game.resetTuning();
		window.ui.action( 'pause' );

	} );
	await frames( 3 );

} );

await step( 'back to town', async () => {

	await page.evaluate( () => window.game.enterTown() );
	await frames( 5 );

} );

// every registered UI panel opens, draws and closes (inventory, tree, vendor, map ...)
await step( 'every panel', async () => {

	const ids = await page.evaluate( () => [ ...window.ui.panels.keys() ] );
	for ( const id of ids ) {

		await page.evaluate( ( id ) => window.ui.open( id, true ), id );
		await frames( 2 );
		await page.evaluate( ( id ) => window.ui.open( id, false ), id );

	}

	await frames( 2 );
	return `${ids.length} panels`;

} );

await step( 'workshop galleries', async () => {

	const n = await page.evaluate( () => [ window.api( 'lab.monsters', { n: 6 } ).length, window.api( 'lab.actions', {} ).length ] );
	await frames( 3 );
	await page.evaluate( () => window.api( 'lab.clear' ) );
	await frames( 3 );
	return n.join( ' + ' ) + ' lab entities';

} );

// The claude.ai artifact viewer runs the game inside an iframe whose permissions policy
// blocks device APIs (gamepad, fullscreen, camera...). It must still run there: a blocked
// gamepad poll once froze every frame.
await step( 'restricted iframe', async () => {

	if ( ! url.startsWith( 'file:' ) ) return 'skipped (not a local build)';
	const wrap = resolve( 'dist-game/iframe-test.html' );
	writeFileSync( wrap, '<!doctype html><body style="margin:0"><iframe src="game.html#fresh&seed=iframe" allow="gamepad \'none\'; fullscreen \'none\'; camera \'none\'; microphone \'none\'" style="width:900px;height:560px;border:0"></iframe>' );
	try {

		await page.goto( pathToFileURL( wrap ).href );
		let frame = null;
		for ( let i = 0; i < 60 && ! frame; i ++ ) {

			frame = page.frames().find( ( f ) => f.url().includes( 'game.html' ) );
			if ( ! frame ) await page.waitForTimeout( 500 );

		}

		if ( ! frame ) throw new Error( 'iframe did not load' );
		await frame.waitForFunction( () => window.__fatal || window.__boot?.status === 'ready' );
		await frame.locator( '[data-boot-choice="game"]' ).click();
		await frame.waitForFunction( () => window.__fatal || window.game?.frameCount >= 6, null, { timeout: 180000 } );
		const r = await frame.evaluate( () => ( { frames: window.game.frameCount, world: window.game.world?.frame, errors: ( window.game.errors || [] ).map( ( e ) => e.msg ) } ) );
		if ( ! r.world ) throw new Error( 'the simulation did not advance inside the iframe' );
		return `${r.frames} frames, sim frame ${r.world}${r.errors.length ? ' - caught: ' + r.errors.join( '; ' ) : ''}`;

	} finally {

		unlinkSync( wrap );

	}

} );

await browser.close();
const failed = errors.length > 0;
console.log( failed ? `\nFAILED (${errors.length} problems)` : '\nall ok' );
process.exit( failed ? 1 : 0 );
