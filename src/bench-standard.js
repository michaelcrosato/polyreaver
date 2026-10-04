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
//   1. Crowd, direct path, Tetra model (24 triangles): most agents that fit the
//      60 fps budget. Many tiny instances.
//   2. Crowd, direct path, Box-man (168 triangles): the same with 7x the vertex work.
//   3. Crowd, GPU-driven path, Box-man with LOD. With the whole crowd in view almost
//      everyone is a few pixels tall, so LOD draws them as Tetras: compare with
//      test 2 for what LOD buys, and with test 1 for what the cull pass costs (on
//      a Snapdragon 8 Elite tests 1 and 3 landed on the same number).
//   4. Looks: the Console preset (PBR, shadows, SSAO, bloom, SMAA...) with 50,000
//      agents: frame / GPU / CPU time.
// The headline score is test 1 in thousands of agents. Phones slow down as they
// warm up (the same phone scored 295, then 263 twenty minutes later), so compare
// runs started cool.

import { defaults, formatCount } from './features.js';
import { describeAdapter } from './gpu.js';

export const STANDARD = { version: 2, width: 1920, height: 1080, targetFps: 60, looksPreset: 'console', looksAgents: 50000 };

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

		const crowdTest = async ( n, label, settings ) => {

			await app.applyAll( { ...base, ...settings, count: 5000 } );
			const r = await bench.searchCrowd( STANDARD.targetFps, ( h ) => show( `${n}/4 Crowd: ${label}`, h ) );
			done.push( `${n}. ${label}: <b>${formatCount( r.maxAgents )}</b> agents${r.hitCapacity ? ' (buffer limit)' : ''}` );
			return r;

		};

		const direct = await crowdTest( 1, 'direct path, Tetra', {} );
		const boxDirect = await crowdTest( 2, 'direct path, Box-man', { tier: 2 } );
		const gpu = await crowdTest( 3, 'GPU-driven, Box-man + LOD', { path: 'gpu', tier: 2 } );

		await app.applyAll( { ...base, count: STANDARD.looksAgents } );
		await app.preset( STANDARD.looksPreset );
		show( `4/4 Looks: ${STANDARD.looksPreset} preset, ${formatCount( STANDARD.looksAgents )} agents`, 'measuring…' );
		const m = await bench._measure( 1500, 3000 );
		const s = [ ...bench.samples ].sort( ( a, b ) => a - b );
		const p99 = s[ Math.min( s.length - 1, Math.floor( 0.99 * s.length ) ) ];
		const looks = { preset: STANDARD.looksPreset, agents: STANDARD.looksAgents, fps: r1( m.fps ), frameMs: r1( m.frame ), p99Ms: r1( p99 ), gpuMs: r1( m.gpu ), cpuMs: r1( m.cpu ) };
		done.push( `4. Console look, ${formatCount( STANDARD.looksAgents )} agents: <b>${looks.fps} fps</b>` + ( m.gpu ? ` · GPU ${looks.gpuMs} ms` : '' ) + ` · CPU ${looks.cpuMs} ms · worst 1 % ${looks.p99Ms} ms` );

		result = {
			version: STANDARD.version,
			score: Math.round( direct.maxAgents / 1000 ),
			resolution: `${STANDARD.width}x${STANDARD.height}`,
			targetFps: STANDARD.targetFps,
			gpu: describeAdapter( app.gpu.info ),
			judgedBy: direct.judgedBy,
			direct: { agents: direct.maxAgents, hitCapacity: direct.hitCapacity, triangles: direct.trianglesPerFrame },
			boxDirect: { agents: boxDirect.maxAgents, hitCapacity: boxDirect.hitCapacity, triangles: boxDirect.trianglesPerFrame },
			gpuDriven: { agents: gpu.maxAgents, hitCapacity: gpu.hitCapacity },
			looks,
			// each search's steps, so an odd result can be explained afterwards
			logs: { direct: direct.log, boxDirect: boxDirect.log, gpuDriven: gpu.log }
		};
		bench.results.standard = result;
		bench.onResult?.( 'standard', result );
		show( null, `<br><b>Score: ${result.score}</b> <span class="dim">(v${STANDARD.version}: thousands of Tetra agents at ${STANDARD.targetFps} fps, test 1${direct.judgedBy === 'frame time' ? '; no GPU timestamps here, so judged by frame time - capped by the display refresh rate' : ''})</span>` );

	} catch {

		show( null, '<br>stopped.' );

	}

	app.rig.setBenchView( null );
	app.setFixedResolution( null );
	await app.applyAll( original );
	bench.running = false;
	return result;

}
