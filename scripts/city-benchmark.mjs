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

	const target = new URL( url ); target.searchParams.set( 'engine', 'stress' ); target.hash = 'scene=city&count=100000';
	await page.goto( target.href );
	await page.bringToFront();
	await page.waitForFunction( () => window.app?.frameCount > 2 || window.__fatal, null, { timeout: 90000 } );
	const fatal = await page.evaluate( () => window.__fatal || null );
	if ( fatal ) throw new Error( fatal );
	const adapter = await page.evaluate( () => window.app.gpu.info );
	if ( adapter.isFallbackAdapter && ! software ) throw new Error( 'Only a software WebGPU adapter is available. Hardware performance remains unverified. Use Windows Chrome/Edge and the Standard benchmark button, or --software to check reporting.' );
	console.log( `Unified city standard benchmark, fixed 1080p. ${software ? 'Software correctness run; no performance claim.' : 'Hardware adapter run.'}` );
	const polling = setInterval( async () => {

		console.log( await page.locator( '.bench-out' ).first().innerText().catch( () => 'Benchmark running' ) );

	}, 15000 );
	let report;
	try {

		report = await page.evaluate( () => window.app.bench.standard() );
		if ( ! report ) throw new Error( 'Benchmark stopped before completion.' );

	}
	finally { clearInterval( polling ); }
	report.commit = execFileSync( 'git', [ 'rev-parse', 'HEAD' ], { encoding: 'utf8' } ).trim();
	report.dirty = execFileSync( 'git', [ 'status', '--porcelain' ], { encoding: 'utf8' } ).trim().length > 0;
	report.errors = errors;
	if ( software ) { report.hardware = false; report.performanceClaim = false; report.targetMet = false; }
	writeFileSync( output, JSON.stringify( report, null, 2 ) );
	console.log( `Saved ${output}; scene ${report.scene}; score ${report.score}; direct ${report.direct.agents} agents.` );
	if ( errors.length ) throw new Error( `Benchmark correctness failed: ${errors.join( '; ' )}` );

} catch ( e ) {

	console.error( e.message ); writeFileSync( output, JSON.stringify( { status: 'unverified', hardware: false, performanceClaim: false, reason: e.message, errors }, null, 2 ) ); process.exitCode = 1;

} finally { await browser.close(); }
