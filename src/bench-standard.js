// Standard benchmark: the same tests under the same conditions on every device,
// so the numbers can be compared between devices and between runs.
//
// What it pins down, and why:
//   * render size 1920x1080, letterboxed into the window, whatever the window
//     size or pixel ratio. More pixels is more work: two runs on one PC measured
//     2554x1708 and 1924x1960 because the window had been resized.
//   * a fixed camera framing the whole crowd. The player's zoom changes what is
//     drawn - zoomed in on 1M agents the GPU-driven path drew ~1,100 of them, so
//     "max crowd" was measuring the simulation rather than rendering.
//   * default settings, except what each test changes.
//
// Tests:
//   1. Crowd, direct path, Tetra model: most agents that fit the 60 fps budget.
//   2. Crowd, GPU-driven path, Box-man model with LOD: the same.
//   3. Looks: the Console preset (PBR, shadows, SSAO, bloom, SMAA...) with 50,000
//      agents: frame / GPU / CPU time.
// The headline score is test 1 in thousands of agents.

import { defaults, formatCount } from './features.js';
import { describeAdapter } from './gpu.js';

export const STANDARD = { version: 1, width: 1920, height: 1080, targetFps: 60, looksPreset: 'console', looksAgents: 50000 };

const r1 = ( v ) => v ? Number( v.toFixed( 1 ) ) : v;

export async function runStandard( bench ) {

	if ( bench.running ) return null;
	bench.running = true;
	const app = bench.app;
	const original = { ...app.S };
	const done = [];
	const head = `<b>Standard benchmark</b> <span class="dim">(${STANDARD.width}×${STANDARD.height}, whole crowd in view, ${STANDARD.targetFps} fps budget)</span><br>`;
	const show = ( step, html = '' ) => app.ui.setBenchOutput( head + done.join( '<br>' ) + ( step ? `<br><i>${step}</i><br>${html}` : html ) );

	app.setFixedResolution( STANDARD );
	app.rig.setBenchView( () => app.crowd.radius );
	let result = null;

	try {

		const base = defaults();

		app.applyAll( { ...base, count: 5000 } );
		const direct = await bench.searchCrowd( STANDARD.targetFps, ( h ) => show( '1/3 Crowd: direct path, Tetra', h ) );
		done.push( `1. Direct path, Tetra: <b>${formatCount( direct.maxAgents )}</b> agents${direct.hitCapacity ? ' (buffer limit)' : ''}` );

		app.applyAll( { ...base, path: 'gpu', tier: 2, count: 5000 } );
		const gpu = await bench.searchCrowd( STANDARD.targetFps, ( h ) => show( '2/3 Crowd: GPU-driven path, Box-man + LOD', h ) );
		done.push( `2. GPU-driven, Box-man + LOD: <b>${formatCount( gpu.maxAgents )}</b> agents${gpu.hitCapacity ? ' (buffer limit)' : ''}` );

		app.applyAll( { ...base, count: STANDARD.looksAgents } );
		app.preset( STANDARD.looksPreset );
		show( `3/3 Looks: ${STANDARD.looksPreset} preset, ${formatCount( STANDARD.looksAgents )} agents`, 'measuring…' );
		const m = await bench._measure( 1500, 3000 );
		const s = [ ...bench.samples ].sort( ( a, b ) => a - b );
		const p99 = s[ Math.min( s.length - 1, Math.floor( 0.99 * s.length ) ) ];
		const looks = { preset: STANDARD.looksPreset, agents: STANDARD.looksAgents, fps: r1( m.fps ), frameMs: r1( m.frame ), p99Ms: r1( p99 ), gpuMs: r1( m.gpu ), cpuMs: r1( m.cpu ) };
		done.push( `3. Console look, ${formatCount( STANDARD.looksAgents )} agents: <b>${looks.fps} fps</b>` + ( m.gpu ? ` · GPU ${looks.gpuMs} ms` : '' ) + ` · CPU ${looks.cpuMs} ms · worst 1 % ${looks.p99Ms} ms` );

		result = {
			version: STANDARD.version,
			score: Math.round( direct.maxAgents / 1000 ),
			resolution: `${STANDARD.width}x${STANDARD.height}`,
			targetFps: STANDARD.targetFps,
			gpu: describeAdapter( app.gpu.info ),
			judgedBy: direct.judgedBy,
			direct: { agents: direct.maxAgents, hitCapacity: direct.hitCapacity, triangles: direct.trianglesPerFrame },
			gpuDriven: { agents: gpu.maxAgents, hitCapacity: gpu.hitCapacity },
			looks
		};
		bench.results.standard = result;
		bench.onResult?.( 'standard', result );
		show( null, `<br><b>Score: ${result.score}</b> <span class="dim">(thousands of Tetra agents at ${STANDARD.targetFps} fps, test 1${direct.judgedBy === 'frame time' ? '; no GPU timestamps here, so judged by frame time - capped by the display refresh rate' : ''})</span>` );

	} catch {

		show( null, '<br>stopped.' );

	}

	app.rig.setBenchView( null );
	app.setFixedResolution( null );
	app.applyAll( original );
	bench.running = false;
	return result;

}
