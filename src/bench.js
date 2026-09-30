// Benchmarks: "how many agents can this device draw at N fps?" and
// "how many milliseconds does each effect add?".
//
// Frame time comes from requestAnimationFrame deltas (what the player feels).
// When the GPU exposes timestamp queries we also record GPU time, which is not
// capped by vsync and therefore a better measure of an effect's own cost.

import { formatCount } from './features.js';

const median = ( arr ) => {

	if ( ! arr.length ) return 0;
	const s = [ ...arr ].sort( ( a, b ) => a - b );
	return s[ Math.floor( s.length / 2 ) ];

};

export const FX_TESTS = [
	{ label: 'Lambert shading', set: { shading: 'lambert' } },
	{ label: 'Standard PBR shading', set: { shading: 'standard' } },
	{ label: 'Physical PBR shading', set: { shading: 'physical' } },
	{ label: 'Toon shading', set: { shading: 'toon' } },
	{ label: 'Environment IBL (PBR)', set: { shading: 'standard', env: true }, base: { shading: 'standard' } },
	{ label: 'Shadows medium (crowd casts)', set: { shadows: 'medium', crowdShadows: true } },
	{ label: 'Shadows medium (props only)', set: { shadows: 'medium', crowdShadows: false } },
	{ label: 'Shadows high 4096', set: { shadows: 'high', crowdShadows: true } },
	{ label: 'Blob shadows', set: { blobShadows: true } },
	{ label: '16 point lights (forward)', set: { shading: 'lambert', pointLights: 16 }, base: { shading: 'lambert' } },
	{ label: '64 point lights (forward)', set: { shading: 'lambert', pointLights: 64 }, base: { shading: 'lambert' } },
	{ label: '64 point lights (clustered)', set: { shading: 'lambert', pointLights: 64, clustered: true }, base: { shading: 'lambert' } },
	{ label: 'Rim light', set: { rim: true } },
	{ label: 'Toon outlines (inverted hull)', set: { outlines: true } },
	{ label: 'Distance fog', set: { fog: 'distance' } },
	{ label: 'MSAA 4x', set: { aa: 'msaa' } },
	{ label: 'FXAA', set: { aa: 'fxaa' } },
	{ label: 'SMAA', set: { aa: 'smaa' } },
	{ label: 'TRAA', set: { aa: 'traa' } },
	{ label: 'SSAO', set: { ao: 'ssao' } },
	{ label: 'GTAO', set: { ao: 'gtao' } },
	{ label: 'Bloom', set: { bloom: true } },
	{ label: 'Tilt-shift DOF', set: { dof: 'tiltshift' } },
	{ label: 'Bokeh DOF', set: { dof: 'bokeh' } },
	{ label: 'Motion blur', set: { motionBlur: true } },
	{ label: 'SSR', set: { ssr: true, shading: 'standard' }, base: { shading: 'standard' } },
	{ label: 'SSGI', set: { ssgi: true } },
	{ label: 'Ink edges (Sobel)', set: { stylize: 'ink' } },
	{ label: 'Film grain + vignette + CA', set: { grain: true, vignette: true, chromatic: true } },
	{ label: 'Anim: none (static)', set: { anim: 'none' }, base: { anim: 'procedural' } },
	{ label: 'Anim: keyframe + blend', set: { anim: 'keyframe' }, base: { anim: 'procedural' } },
	{ label: 'Anim: skeletal skinning', set: { anim: 'skeletal' }, base: { anim: 'procedural' } },
	{ label: 'Anim: baked VAT', set: { anim: 'vat' }, base: { anim: 'procedural' } },
	{ label: 'Cel shading (Wind Waker)', set: { shading: 'celWW' } },
	{ label: 'Cel + outlines (Jet Set Radio)', set: { shading: 'celJSR', outlines: true, outlineWidth: 0.09 } },
	{ label: 'Pixel: PICO-8 palette', set: { stylize: 'pico8' } },
	{ label: 'Pixel: CRT arcade', set: { stylize: 'crt' } },
	{ label: 'Physics: GPU crowd collisions', set: { physics: true, bodies: 0, crowdMode: 'gpu', proxies: false } },
	{ label: 'Physics: 1,000 bodies + GPU crowd', set: { physics: true, bodies: 1000, crowdMode: 'gpu', proxies: true } },
	{ label: 'Physics: 2,000 Rapier agents', set: { physics: true, bodies: 250, crowdMode: 'rapier', rapierAgents: 2000 } },
	{ label: 'Model: Box-man (168 tris)', set: { tier: 2 }, base: { tier: 0 } },
	{ label: 'Model: Hi (436 tris)', set: { tier: 3 }, base: { tier: 0 } },
	{ label: 'Render scale 0.5 (saves)', set: { renderScale: 0.5 }, base: { renderScale: 1 } }
];

export class Bench {

	constructor( app ) {

		this.app = app;
		this.running = false;
		this.samples = [];
		this.gpuSamples = [];
		this.results = { crowd: null, fx: null };
		this.onResult = null; // ( kind, data ) => {} - set by the Claude link

	}

	onFrame( frameMs, gpuMs ) {

		if ( ! this.running || ! this._collect ) return;
		this.samples.push( frameMs );
		if ( gpuMs > 0 ) this.gpuSamples.push( gpuMs );

	}

	stop() {

		this.running = false;

	}

	// Warm up (skips shader-compile hitches after a settings change), then sample.
	// Both phases need a minimum number of FRAMES as well as time, so slow devices
	// (1-5 fps) still get meaningful numbers.
	async _measure( warmupMs = 700, sampleMs = 1400, minFrames = 12 ) {

		this._collect = false;
		await this._waitFrames( 4, warmupMs );
		this.samples = [];
		this.gpuSamples = [];
		this._collect = true;
		const t0 = performance.now();
		while ( ( performance.now() - t0 < sampleMs || this.samples.length < minFrames ) && performance.now() - t0 < 20000 ) {

			await this._wait( 50 );
			if ( ! this.running ) throw new Error( 'stopped' );

		}

		this._collect = false;
		const frame = median( this.samples ) || 1000;
		return { frame, fps: 1000 / frame, gpu: median( this.gpuSamples ), n: this.samples.length };

	}

	async _waitFrames( frames, ms ) {

		const start = this.app.frameCount;
		const t0 = performance.now();
		while ( ( this.app.frameCount - start < frames || performance.now() - t0 < ms ) && performance.now() - t0 < 30000 ) {

			await this._wait( 30 );
			if ( ! this.running ) throw new Error( 'stopped' );

		}

	}

	_wait( ms ) {

		return new Promise( ( r ) => setTimeout( r, ms ) );

	}

	// One steady-state measurement of the current settings, with frame-time
	// percentiles (p95/p99 show hitches that a median hides).
	async sample( sampleMs = 3000 ) {

		if ( this.running ) throw new Error( 'a benchmark is already running' );
		this.running = true;
		try {

			const m = await this._measure( 800, sampleMs );
			const s = [ ...this.samples ].sort( ( a, b ) => a - b );
			const pct = ( q ) => s[ Math.min( s.length - 1, Math.floor( q * s.length ) ) ];
			return { ...m, p95: pct( 0.95 ), p99: pct( 0.99 ), worst: s[ s.length - 1 ] };

		} finally {

			this.running = false;

		}

	}

	async findMaxCrowd( targetFps ) {

		if ( this.running ) return;
		this.running = true;
		const app = this.app;
		const original = app.S.count;
		const budget = 1000 / targetFps;
		const log = [];
		const out = ( extra = '' ) => app.ui.setBenchOutput( `<b>Max crowd @ ${targetFps} fps</b><br>${log.join( '<br>' )}${extra}` );

		// A frame counts as "on target" within 8 % tolerance (rAF jitter).
		const ok = ( m ) => m.frame <= budget * 1.08;
		let good = 0, bad = 0, n = Math.max( 1000, Math.min( original, 5000 ) );
		try {

			while ( true ) {

				n = Math.min( n, app.maxCapacity );
				app.set( 'count', n );
				out( `<br>testing ${formatCount( n )}…` );
				const m = await this._measure();
				log.push( `${formatCount( n )} agents: ${m.fps.toFixed( 1 )} fps (${m.frame.toFixed( 1 )} ms${m.gpu ? `, GPU ${m.gpu.toFixed( 1 )} ms` : ''})` );
				if ( ok( m ) ) {

					good = n;
					if ( n >= app.maxCapacity ) break;
					n = Math.round( n * 1.6 );

				} else {

					bad = n;
					break;

				}

			}

			// refine between good and bad
			for ( let k = 0; k < 4 && bad && bad - good > Math.max( 1000, good * 0.06 ); k ++ ) {

				const mid = Math.round( ( good + bad ) / 2 );
				app.set( 'count', mid );
				out( `<br>refining ${formatCount( mid )}…` );
				const m = await this._measure();
				log.push( `${formatCount( mid )} agents: ${m.fps.toFixed( 1 )} fps` );
				if ( ok( m ) ) good = mid; else bad = mid;

			}

			const tris = good * app.crowd.models[ app.S.tier ].triangles;
			this.results.crowd = { targetFps, maxAgents: good, trianglesPerFrame: tris, model: app.crowd.models[ app.S.tier ].id, path: app.S.path, log: log.slice() };
			this.onResult?.( 'maxCrowd', this.results.crowd );
			app.set( 'count', good || original );
			out( `<br><b>Result: ${formatCount( good )} agents</b> (~${formatCount( tris )} crowd triangles) hold ${targetFps} fps${good >= app.maxCapacity ? ' (hit the buffer capacity - raise "Max crowd")' : ''}.` );

		} catch {

			app.set( 'count', original );
			out( '<br>stopped.' );

		}

		this.running = false;

	}

	async measureEffects() {

		if ( this.running ) return;
		this.running = true;
		const app = this.app;
		const original = { ...app.S };
		const rows = [];
		const render = ( extra = '' ) => {

			const useGpu = rows.some( ( r ) => r.gpuDelta !== null );
			const sorted = [ ...rows ].sort( ( a, b ) => ( b.gpuDelta ?? b.frameDelta ) - ( a.gpuDelta ?? a.frameDelta ) );
			app.ui.setBenchOutput( `<b>Effect cost on top of current settings</b> (${formatCount( app.S.count )} agents)<br>` +
				`<table><tr><th>Effect</th><th>${useGpu ? 'GPU +ms' : 'frame +ms'}</th><th>fps</th></tr>` +
				sorted.map( ( r ) => `<tr><td>${r.label}</td><td>${fmtDelta( useGpu ? r.gpuDelta : r.frameDelta )}</td><td>${r.fps.toFixed( 0 )}</td></tr>` ).join( '' ) +
				'</table>' + extra );

		};

		const fmtDelta = ( d ) => d === null ? '–' : ( d >= 0 ? '+' : '' ) + d.toFixed( 2 );

		try {

			for ( const test of FX_TESTS ) {

				// skip tests that are already on
				if ( Object.entries( test.set ).every( ( [ k, v ] ) => original[ k ] === v ) ) continue;
				app.applyAll( { ...original, ...( test.base || {} ) } );
				render( `<br>measuring baseline for ${test.label}…` );
				const base = await this._measure( 900, 1100 );
				app.applyAll( { ...original, ...( test.base || {} ), ...test.set } );
				render( `<br>measuring ${test.label}…` );
				const m = await this._measure( 1200, 1300 );
				rows.push( {
					label: test.label,
					fps: m.fps,
					frameDelta: m.frame - base.frame,
					gpuDelta: m.gpu && base.gpu ? m.gpu - base.gpu : null
				} );
				render();

			}

			this.results.fx = rows.map( ( r ) => ( { ...r } ) );
			this.onResult?.( 'effects', { agents: app.S.count, rows: this.results.fx } );
			render( '<br>done. Deltas are noisy on vsync-limited frames; GPU timestamps (when available) are more reliable.' );

		} catch {

			render( '<br>stopped.' );

		}

		app.applyAll( original );
		this.running = false;

	}

}
