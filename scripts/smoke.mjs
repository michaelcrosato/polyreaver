// Headless smoke test: loads the built page in Chromium with the SwiftShader
// software GPU, walks through every preset / animation system / stylize mode /
// physics action, and fails on any page error, WebGPU validation error or fatal
// screen. It also exercises the Claude link against an in-memory fake database.
//
// It proves things RUN, not how fast: SwiftShader is a CPU rasteriser, so the
// frame rates it reports mean nothing. Real numbers come from real devices.
//
//   npm run build && npm run smoke            (all scenarios, ~5-10 min on a laptop CPU)
//   node scripts/smoke.mjs --quick            (baseline + a few, ~1-2 min)
//   node scripts/smoke.mjs --shots out/       (also save a screenshot per scenario)
//   node scripts/smoke.mjs --url http://localhost:5173/

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PRESETS, findItem } from '../src/features.js';

const argv = process.argv.slice( 2 );
const opt = ( name, def ) => {

	const i = argv.indexOf( name );
	return i < 0 ? def : argv[ i + 1 ];

};

const quick = argv.includes( '--quick' );
const shots = opt( '--shots', null );
const url = opt( '--url', pathToFileURL( resolve( 'dist/index.html' ) ).href ) + '#count=1500';
const FRAMES = 6;

const scenarios = [ { name: 'baseline', set: {} } ];
const options = ( key ) => findItem( key ).options.map( ( o ) => o[ 0 ] );
if ( quick ) {

	scenarios.push( { name: 'preset ultra', preset: 'ultra' }, { name: 'anim skeletal gpu', set: { anim: 'skeletal', path: 'gpu' } }, { name: 'physics', set: { physics: true }, frames: 30 } );

} else {

	for ( const id of Object.keys( PRESETS ) ) scenarios.push( { name: 'preset ' + id, preset: id } );
	for ( const path of options( 'path' ) ) for ( const anim of options( 'anim' ) ) scenarios.push( { name: `anim ${anim} ${path}`, set: { anim, path } } );
	for ( const stylize of options( 'stylize' ) ) scenarios.push( { name: 'stylize ' + stylize, set: { stylize } } );
	for ( const tier of [ 0, 1, 2, 3 ] ) scenarios.push( { name: 'tier ' + tier, set: { tier, outlines: true } } );
	scenarios.push(
		{ name: 'physics', set: { physics: true }, frames: 40 },
		{ name: 'physics explode', keep: true, action: 'explode', frames: 20 },
		{ name: 'physics wrecking ball', keep: true, action: 'wrecking', frames: 20 },
		{ name: 'physics respawn', keep: true, action: 'respawn', frames: 20 },
		{ name: 'physics rapier agents', keep: true, set: { crowdMode: 'rapier' }, frames: 30 },
		{ name: 'physics gpu + proxies', keep: true, set: { crowdMode: 'gpu', proxies: true }, frames: 30 }
	);

}

const FLAGS = [ '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPUService', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist' ];
const NOISE = /Download the|DevTools|\[vite\]|experimental on this platform|deprecated parameters for the initialization function/;

// In-memory stand-in for the claude.ai artifact database (`window.claude.use('db')`).
function fakeClaude() {

	const store = { docs: new Map(), listeners: [], uploads: [] };
	window.__fakeDb = store;
	const clone = ( v ) => JSON.parse( JSON.stringify( v ) );
	const notify = () => setTimeout( () => store.listeners.forEach( ( l ) => l() ), 0 );
	const snap = ( path, d ) => ( { id: path.split( '/' ).pop(), exists: !! d, data: () => d && clone( d ) } );
	const doc = ( path ) => ( {
		id: path.split( '/' ).pop(), path,
		get: async () => snap( path, store.docs.get( path ) ),
		set: async ( v ) => ( store.docs.set( path, clone( v ) ), notify() ),
		update: async ( v ) => {

			if ( ! store.docs.has( path ) ) throw { code: 'invalid_argument' };
			store.docs.set( path, { ...store.docs.get( path ), ...clone( v ) } );
			notify();

		},
		acquire: async ( { holder } ) => ( { acquired: true, holder } )
	} );
	const collection = ( path, filters = [] ) => ( {
		path,
		doc: ( id ) => doc( path + '/' + id ),
		where: ( f, op, v ) => collection( path, [ ...filters, [ f, v ] ] ),
		onSnapshot: ( next ) => {

			const depth = path.split( '/' ).length + 1;
			const run = () => {

				const docs = [ ...store.docs ].filter( ( [ p, d ] ) => p.startsWith( path + '/' ) && p.split( '/' ).length === depth && filters.every( ( [ f, v ] ) => d[ f ] === v ) ).map( ( [ p, d ] ) => snap( p, d ) );
				next( { docs, size: docs.length, empty: ! docs.length } );

			};

			store.listeners.push( run );
			setTimeout( run, 0 );
			return () => {};

		}
	} );
	store.command = ( id, body ) => ( store.docs.set( 'commands/' + id, { status: 'pending', ...body } ), notify() );
	window.claude = { use: async ( name ) => name === 'db' ? { doc, collection } : name === 'assets' ? {
		upload: async ( blob ) => ( store.uploads.push( blob.size ), { id: 'f'.repeat( 32 ), url: '', sizeBytes: blob.size, contentType: blob.type } )
	} : null };

}

const browser = await chromium.launch( { args: FLAGS } );
const page = await browser.newPage( { viewport: { width: 900, height: 560 } } );
await page.addInitScript( fakeClaude );
let logs = [];
page.on( 'console', ( m ) => {

	const t = m.text();
	if ( ( m.type() === 'error' || m.type() === 'warning' ) && ! NOISE.test( t ) ) logs.push( m.type() + ': ' + t.slice( 0, 400 ) );

} );
page.on( 'pageerror', ( e ) => logs.push( 'pageerror: ' + e.message ) );

const failures = [];
const t0 = Date.now();
console.log( 'loading ' + url );
await page.goto( url );
await page.waitForFunction( () => window.__fatal || window.app?.frameCount >= 3, null, { timeout: 180000 } );
const fatalAtLoad = await page.evaluate( () => window.__fatal || null );
if ( fatalAtLoad ) {

	console.log( 'FATAL at load: ' + fatalAtLoad );
	process.exit( 1 );

}

const base = await page.evaluate( () => JSON.stringify( window.app.S ) );
if ( shots ) mkdirSync( shots, { recursive: true } );

for ( const [ i, sc ] of scenarios.entries() ) {

	logs = [];
	const t = Date.now();
	try {

		await page.evaluate( ( [ b, s ] ) => {

			const app = window.app;
			if ( s.preset ) app.preset( s.preset );
			else if ( s.keep ) app.applyAll( { ...app.S, ...( s.set || {} ) } );
			else app.applyAll( { ...JSON.parse( b ), ...( s.set || {} ) } );
			if ( s.action ) app.action( s.action );

		}, [ base, sc ] );
		const start = await page.evaluate( () => window.app.frameCount );
		await page.waitForFunction( ( n ) => window.__fatal || window.app.frameCount >= n, start + ( sc.frames || FRAMES ), { timeout: 240000 } );

	} catch ( e ) {

		logs.push( 'ERR ' + e.message.split( '\n' )[ 0 ] );

	}

	const info = await page.evaluate( () => ( { fatal: window.__fatal || null, warn: document.getElementById( 'warnings' )?.innerText || '' } ) );
	if ( /error/i.test( info.warn ) ) logs.push( 'UI warning: ' + info.warn.slice( 0, 300 ) );
	if ( info.fatal ) logs.push( 'FATAL ' + info.fatal );
	if ( shots ) await page.screenshot( { path: `${shots}/${String( i ).padStart( 2, '0' )}_${sc.name.replace( /\W+/g, '_' )}.png` } );
	const status = logs.length ? 'FAIL' : 'ok';
	console.log( `${status.padEnd( 4 )} ${sc.name.padEnd( 28 )} ${( ( Date.now() - t ) / 1000 ).toFixed( 1 )}s${logs.length ? '\n     ' + logs.slice( 0, 6 ).join( '\n     ' ) : ''}` );
	if ( logs.length ) failures.push( sc.name );
	if ( info.fatal ) break;

}

// Claude link round trip against the fake database.
{

	logs = [];
	const t = Date.now();
	await page.evaluate( ( b ) => window.app.applyAll( JSON.parse( b ) ), base );
	await page.evaluate( () => {

		const db = window.__fakeDb;
		db.command( 'c1', { cmd: 'ping' } );
		db.command( 'c2', { cmd: 'sequence', args: { steps: [ { cmd: 'set', args: { values: { tier: 2, bloom: true } } }, { cmd: 'measure', args: { seconds: 1 } }, { cmd: 'screenshot' } ] } } );
		db.command( 'c3', { cmd: 'set', args: { values: { notASetting: 1 } } } );
		db.command( 'c4', { cmd: 'ping', device: 'some-other-device' } );

	} );
	const res = await page.waitForFunction( () => {

		const d = window.__fakeDb.docs;
		return d.has( 'results/c1' ) && d.has( 'results/c2' ) && d.has( 'results/c3' ) && [ 'c1', 'c2', 'c3', 'c4' ].map( ( id ) => ( { id, cmd: d.get( 'commands/' + id ), res: d.get( 'results/' + id ) } ) );

	}, null, { timeout: 120000 } ).then( ( h ) => h.jsonValue() ).catch( ( e ) => ( logs.push( 'ERR ' + e.message.split( '\n' )[ 0 ] ), null ) );
	if ( res ) {

		const [ c1, c2, c3, c4 ] = res;
		const steps = c2.res?.result?.steps || [];
		if ( ! c1.res.ok || ! c1.res.result.device?.gpu ) logs.push( 'ping failed: ' + JSON.stringify( c1.res ) );
		if ( ! c2.res.ok || steps.length !== 3 || ! steps.every( ( s ) => s.ok ) ) logs.push( 'sequence failed: ' + JSON.stringify( c2.res ).slice( 0, 400 ) );
		else if ( ! ( steps[ 1 ].result.frames > 0 ) ) logs.push( 'measure returned no frames' );
		else if ( ! ( steps[ 2 ].result.bytes > 20000 ) ) logs.push( 'screenshot looks blank: ' + steps[ 2 ].result.bytes + ' bytes' );
		if ( c3.res.ok || c3.cmd.status !== 'error' ) logs.push( 'bad setting was not rejected' );
		if ( c4.res || c4.cmd.status !== 'pending' ) logs.push( 'command for another device was run' );
		const runs = await page.evaluate( () => [ ...window.__fakeDb.docs.keys() ].filter( ( k ) => k.startsWith( 'devices/' ) ).length );
		if ( runs !== 1 ) logs.push( 'device document missing' );

	}

	console.log( `${( logs.length ? 'FAIL' : 'ok' ).padEnd( 4 )} ${'claude link (fake db)'.padEnd( 28 )} ${( ( Date.now() - t ) / 1000 ).toFixed( 1 )}s${logs.length ? '\n     ' + logs.join( '\n     ' ) : ''}` );
	if ( logs.length ) failures.push( 'claude link' );

}

await browser.close();
console.log( `\n${scenarios.length + 1 - failures.length}/${scenarios.length + 1} passed in ${( ( Date.now() - t0 ) / 1000 ).toFixed( 0 )}s` + ( failures.length ? ' - failed: ' + failures.join( ', ' ) : '' ) );
process.exit( failures.length ? 1 : 0 );
