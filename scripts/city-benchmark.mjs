// Real-device benchmark runner. Software mode verifies the reporting procedure,
// but never satisfies the hardware 1080p/60 fps gate.
import { launchBrowser } from './browser.mjs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice( 2 );
const option = ( key, fallback ) => args.includes( key ) ? args[ args.indexOf( key ) + 1 ] : fallback;
const software = args.includes( '--software' );
const seconds = Number( option( '--seconds', 60 ) ), warmup = Number( option( '--warmup', 10 ) );
const url = option( '--url', pathToFileURL( resolve( 'city-demo.html' ) ).href );
const output = option( '--out', 'artifacts/city/benchmark.json' ); mkdirSync( resolve( output, '..' ), { recursive: true } );
const flags = [ '--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPUService', '--ignore-gpu-blocklist' ];
if ( software ) flags.push( '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--use-angle=swiftshader' );
const browser = await launchBrowser( { args: flags } );
const page = await browser.newPage( { viewport: { width: 1920, height: 1080 } } );
const errors = [];
page.on( 'pageerror', ( e ) => errors.push( e.message ) );
page.on( 'console', ( message ) => { if ( message.type() === 'error' ) errors.push( message.text().slice( 0, 1000 ) ); } );

try {

	await page.goto( `${url}#population=100000` );
	await page.bringToFront();
	await page.waitForFunction( () => window.city || window.__fatal, null, { timeout: 90000 } );
	const fatal = await page.evaluate( () => window.__fatal || null );
	if ( fatal ) throw new Error( fatal );
	const adapter = await page.evaluate( () => window.city.gpu.info );
	if ( adapter.isFallbackAdapter && ! software ) throw new Error( 'Only a software WebGPU adapter is available. Hardware performance remains unverified. Use Windows Chrome/Edge and the City Benchmark button, or --software to check reporting.' );
	console.log( `City benchmark: ${seconds}s per scenario after ${warmup}s warmup. ${software ? 'Software correctness run; no performance claim.' : 'Hardware adapter run.'}` );
	const polling = setInterval( async () => {

		console.log( await page.locator( '#status' ).innerText().catch( () => 'Benchmark running' ) );

	}, 15000 );
	let report;
	try { report = await page.evaluate( ( options ) => window.city.benchmark( options ), { seconds, warmup } ); }
	finally { clearInterval( polling ); }
	report.commit = execFileSync( 'git', [ 'rev-parse', 'HEAD' ], { encoding: 'utf8' } ).trim();
	report.dirty = execFileSync( 'git', [ 'status', '--porcelain' ], { encoding: 'utf8' } ).trim().length > 0;
	report.errors = errors;
	if ( software ) { report.hardware = false; report.performanceClaim = false; report.targetMet = false; }
	report.liveValidation = await page.evaluate( () => window.city.validate( { full: true } ) );
	writeFileSync( output, JSON.stringify( report, null, 2 ) );
	console.log( `Saved ${output}` );
	for ( const result of report.scenarios ) console.log( `${result.scenario}: median ${result.medianMs.toFixed( 1 )} ms, p95 ${result.p95Ms.toFixed( 1 )} ms, dropped simulation ${result.droppedSeconds.toFixed( 2 )} s` );
	if ( errors.length || ! report.liveValidation.ok ) throw new Error( `Benchmark correctness failed: ${errors.join( '; ' ) || JSON.stringify( report.liveValidation )}` );

} catch ( e ) {

	console.error( e.message ); writeFileSync( output, JSON.stringify( { status: 'unverified', hardware: false, performanceClaim: false, reason: e.message, errors }, null, 2 ) ); process.exitCode = 1;

} finally { await browser.close(); }
