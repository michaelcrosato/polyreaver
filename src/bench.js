// Benchmarks: "how many agents can this device draw at N fps?" and
// "how many milliseconds does each effect add?".
//
// Frame time comes from requestAnimationFrame deltas (what the player feels).
// When the GPU exposes timestamp queries we also record GPU time, which is not
// capped by vsync and therefore a better measure of an effect's own cost.

import { formatCount } from './features.js';
import { Ballast } from './ballast.js';

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
	{ label: 'Anim: baked bone texture', set: { anim: 'bat' }, base: { anim: 'procedural' } },
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
		this.cpuSamples = [];
		this.results = { crowd: null, fx: null };
		this.onResult = null; // ( kind, data ) => {} - set by the Claude link
		this.ballast = new Ballast( app.renderer );
		this.warmLoad = 0; // GPU ms of the current ballast + scene, for the report

	}

	onFrame( frameMs, gpuMs, cpuMs = 0 ) {

		if ( ! this.running || ! this._collect ) return;
		this.samples.push( frameMs );
		this.cpuSamples.push( cpuMs );
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
		this.cpuSamples = [];
		this._collect = true;
		const t0 = performance.now();
		while ( ( performance.now() - t0 < sampleMs || this.samples.length < minFrames ) && performance.now() - t0 < 20000 ) {

			await this._wait( 50 );
			if ( ! this.running ) throw new Error( 'stopped' );

		}

		this._collect = false;
		const frame = median( this.samples ) || 1000;
		return { frame, fps: 1000 / frame, gpu: median( this.gpuSamples ), cpu: median( this.cpuSamples ), n: this.samples.length };

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
		const maxN = app.hardMaxCapacity;
		const log = [];
		// The display caps the frame rate (vsync), so on a fast GPU every crowd size
		// "holds 60 fps" and the frame time says nothing. With GPU timestamps we judge
		// the work itself: GPU and CPU time must both fit in 90 % of the frame budget,
		// which also allows targets above the monitor's refresh rate.
		const byWork = !! app.gpu.timestamps;
		const ok = byWork
			? ( m ) => m.gpu > 0 && Math.max( m.gpu, m.cpu ) <= budget * 0.9
			// without timestamps: a frame counts as "on target" within 8 % (rAF jitter)
			: ( m ) => m.frame <= budget * 1.08;
		const out = ( extra = '' ) => app.ui.setBenchOutput( `<b>Max crowd @ ${targetFps} fps</b> <span class="dim">(judged by ${byWork ? 'GPU/CPU time' : 'frame time'})</span><br>${log.join( '<br>' )}${extra}` );
		let good = 0, bad = 0, n = Math.max( 1000, Math.min( original, 5000 ) );
		try {

			while ( true ) {

				n = Math.min( n, maxN );
				app.set( 'count', n );
				out( `<br>testing ${formatCount( n )}…` );
				const m = await this._measure();
				log.push( `${formatCount( n )} agents: ${m.fps.toFixed( 1 )} fps (frame ${m.frame.toFixed( 1 )} ms${m.gpu ? `, GPU ${m.gpu.toFixed( 1 )} ms` : ''}, CPU ${m.cpu.toFixed( 1 )} ms)` );
				if ( ok( m ) ) {

					good = n;
					if ( n >= maxN ) break;
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
				log.push( `${formatCount( mid )} agents: ${m.fps.toFixed( 1 )} fps${m.gpu ? ` (GPU ${m.gpu.toFixed( 1 )} ms)` : ''}` );
				if ( ok( m ) ) good = mid; else bad = mid;

			}

			const tris = good * app.crowd.models[ app.S.tier ].triangles;
			this.results.crowd = { targetFps, maxAgents: good, trianglesPerFrame: tris, model: app.crowd.models[ app.S.tier ].id, path: app.S.path, judgedBy: byWork ? 'gpu+cpu time' : 'frame time', hitCapacity: good >= maxN, log: log.slice() };
			this.onResult?.( 'maxCrowd', this.results.crowd );
			app.set( 'count', good || original );
			out( `<br><b>Result: ${formatCount( good )} agents</b> (~${formatCount( tris )} crowd triangles) hold ${targetFps} fps${good >= maxN ? ' - that is the largest crowd buffer this GPU allows, so the real limit is higher (try a heavier model or a higher fps target)' : ''}.` );

		} catch {

			app.set( 'count', original );
			out( '<br>stopped.' );

		}

		this.running = false;

	}

	// Keep the GPU at full clock speed for the effect benchmark: if the scene alone
	// uses less than ~35 % of the frame, add ballast (doubling it) until it uses
	// ~40 %. Needs GPU timestamps; without them frame times are all we have.
	async _warmUp( report ) {

		this.warmLoad = 0;
		if ( ! this.app.gpu.timestamps ) return;
		let m = await this._measure( 300, 600 );
		const budget = m.frame;
		if ( m.gpu >= budget * 0.35 ) return;
		for ( let it = 2048; it <= 16777216; it *= 2 ) {

			this.ballast.set( it );
			report( `<br>warming up the GPU (ballast ${formatCount( it )} iterations, GPU ${m.gpu.toFixed( 1 )} ms)…` );
			m = await this._measure( 300, 500 );
			if ( m.gpu >= budget * 0.4 ) break;

		}

		this.warmLoad = m.gpu;

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
			app.ui.setBenchOutput( `<b>Effect cost on top of current settings</b> (${formatCount( app.S.count )} agents)` +
				( this.ballast.active ? ` <span class="dim">· GPU kept busy at ${this.warmLoad.toFixed( 1 )} ms for stable clocks</span>` : '' ) + '<br>' +
				`<table><tr><th>Effect</th><th>${useGpu ? 'GPU +ms' : 'frame +ms'}</th><th>fps</th></tr>` +
				sorted.map( ( r ) => `<tr><td>${r.label}</td><td>${fmtDelta( useGpu ? r.gpuDelta : r.frameDelta )}</td><td>${r.fps.toFixed( 0 )}</td></tr>` ).join( '' ) +
				'</table>' + extra );

		};

		const fmtDelta = ( d ) => d === null ? '–' : ( d >= 0 ? '+' : '' ) + d.toFixed( 2 );

		try {

			await this._warmUp( render );
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
			this.onResult?.( 'effects', { agents: app.S.count, warmLoadMs: this.ballast.active ? this.warmLoad : 0, rows: this.results.fx } );
			render( app.gpu.timestamps ? '<br>done.' : '<br>done. No GPU timestamps on this device, so these are frame-time deltas: anything under the vsync limit shows as ~0.' );

		} catch {

			render( '<br>stopped.' );

		}

		this.ballast.set( 0 );
		app.applyAll( original );
		this.running = false;

	}

}
