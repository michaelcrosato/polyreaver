// Text output: the on-screen HUD (refreshed a few times a second) and the plain-text
// report that the "Copy report" button puts on the clipboard.

import * as THREE from 'three/webgpu';
import { describeAdapter } from '../gpu.js';
import { defaults, findItem, formatCount } from '../features.js';
import { DPR } from './config.js';

export function buildReport( app ) {

	const g = app.gpu, s = app.stats, S = app.S;
	const base = defaults();
	const changed = Object.entries( S ).filter( ( [ k, v ] ) => base[ k ] !== v ).map( ( [ k, v ] ) => `  ${findItem( k )?.label || k}: ${v}` );
	const lines = [
		'WebGPU Crowd Stress Test - report',
		new Date().toISOString(),
		'',
		'GPU: ' + describeAdapter( g.info ),
		`WebGPU feature level: ${g.featureLevel} · timestamps: ${g.timestamps ? 'yes' : 'no'} · three.js r${THREE.REVISION}`,
		`Limits: maxStorageBufferBindingSize ${( g.limits.maxStorageBufferBindingSize / 1048576 ).toFixed( 0 )} MB, storage buffers in vertex stage ${g.limits.maxStorageBuffersInVertexStage ?? 'n/a'}`,
		'Browser: ' + navigator.userAgent,
		`Screen: ${innerWidth}x${innerHeight} CSS px @ DPR ${DPR} -> rendering ${app.renderer.domElement.width}x${app.renderer.domElement.height}`,
		'',
		`Now: ${s.fps.toFixed( 1 )} fps · frame ${s.frameMs.toFixed( 2 )} ms · CPU ${s.cpuMs.toFixed( 2 )} ms` + ( g.timestamps ? ` · GPU ${( s.gpuRender + s.gpuCompute ).toFixed( 2 )} ms` : '' ),
		`Agents: ${S.count} · model ${app.crowd.models[ S.tier ].id} (${app.crowd.models[ S.tier ].triangles} tris) · path ${S.path}`,
		`Triangles/frame (all passes): ${formatCount( app._tris || 0 )}`,
		'',
		'Settings changed from default:',
		...( changed.length ? changed : [ '  (none - bare baseline)' ] )
	];
	const r = app.bench.results;
	if ( r.standard ) {

		const st = r.standard;
		lines.push( '', `Standard benchmark v${st.version} (${st.resolution}, whole crowd in view, ${st.targetFps} fps budget, judged by ${st.judgedBy}): score ${st.score}`,
			`  1. direct path, Tetra: ${st.direct.agents} agents${st.direct.hitCapacity ? ' (buffer limit)' : ''}`,
			`  2. direct path, Box-man: ${st.boxDirect.agents} agents${st.boxDirect.hitCapacity ? ' (buffer limit)' : ''}`,
			`  3. GPU-driven, Box-man + LOD: ${st.gpuDriven.agents} agents${st.gpuDriven.hitCapacity ? ' (buffer limit)' : ''}`,
			`  4. ${st.looks.preset} look, ${st.looks.agents} agents: ${st.looks.fps} fps, frame ${st.looks.frameMs} ms, GPU ${st.looks.gpuMs ?? 'n/a'} ms, CPU ${st.looks.cpuMs} ms, worst 1% ${st.looks.p99Ms} ms` );

	}

	if ( r.crowd ) {

		lines.push( '', `Max crowd @ ${r.crowd.targetFps} fps: ${r.crowd.maxAgents} agents (~${formatCount( r.crowd.trianglesPerFrame )} crowd tris), model ${r.crowd.model}, path ${r.crowd.path}` );
		lines.push( ...r.crowd.log.map( ( l ) => '  ' + l ) );

	}

	if ( r.fx ) {

		lines.push( '', 'Effect costs (GPU ms delta where available, else frame ms delta; CPU ms delta):' );
		const sign = ( d ) => ( d >= 0 ? '+' : '' ) + d.toFixed( 2 );
		for ( const row of [ ...r.fx ].sort( ( a, b ) => ( b.gpuDelta ?? b.frameDelta ) - ( a.gpuDelta ?? a.frameDelta ) ) ) {

			lines.push( `  ${row.label.padEnd( 34 )} GPU ${sign( row.gpuDelta ?? row.frameDelta )} ms  CPU ${sign( row.cpuDelta ?? 0 )} ms  (${row.fps.toFixed( 0 )} fps)` );

		}

	}

	lines.push( '', 'Settings link: ' + app.shareLink() );
	return lines.join( '\n' );

}

export function updateHud( app ) {

	const s = app.stats, S = app.S, g = app.gpu;
	const cs = app.crowd.stats();
	const shadowsOn = S.shadows !== 'off';
	const castTris = cs.shadowTris; // the crowd as drawn into the sun's shadow map
	const propTris = app.world.propTriangles * ( shadowsOn ? 2 : 1 );
	const physTris = app.physics.triangles * ( shadowsOn ? 2 : 1 );
	const tris = cs.tris + castTris + propTris + physTris;
	app._tris = tris;
	const info = app.renderer.info;
	const w = app.renderer.domElement.width, hgt = app.renderer.domElement.height;
	const fpsClass = s.fps >= 55 ? 'good' : s.fps >= 28 ? 'ok' : 'bad';
	// A GPU that is busy for well under half the frame drops to power-saving clocks,
	// and its timings then swing by several ms between identical frames. Say so,
	// rather than let the number be read as a cost.
	const gpuMs = s.gpuRender + s.gpuCompute;
	const idle = gpuMs > 0 && s.frameMs > 0 && gpuMs < s.frameMs * 0.25;
	const gpuLine = g.timestamps
		? `GPU <b>${gpuMs.toFixed( 2 )}</b> ms <span class="dim">(render ${s.gpuRender.toFixed( 2 )} + compute ${s.gpuCompute.toFixed( 2 )})</span>` +
			( idle ? '<div class="dim x">GPU mostly idle: clocks drop, so this number jumps around. Compare costs under load (Effect costs does this for you).</div>' : '' )
		: '<span class="dim">GPU timing unavailable (no timestamp-query)</span>';
	const vis = S.path === 'gpu' ? ` · visible <b>${formatCount( cs.instances )}</b> <span class="dim">[${cs.visibleByTier.slice( 0, Number( S.tier ) + 1 ).map( formatCount ).join( '/' )}]</span>` +
		( cs.shadowDraws ? ` · casting <b>${formatCount( cs.casters )}</b>` : '' ) : '';
	let phys = '';
	if ( app.physics.enabled && app.physics.ready ) {

		const ps = app.physics.stats();
		const crowdLine = S.crowdMode === 'gpu'
			? `GPU crowd collisions${S.proxies ? ` · ${ps.proxies} proxies` : ''}`
			: S.crowdMode === 'rapier' ? `${formatCount( ps.agents )} Rapier agents` : 'crowd collisions off';
		phys = `<div>Rapier ${app.physics.version}: <b>${formatCount( ps.bodies )}</b> bodies · <b>${formatCount( ps.colliders )}</b> colliders · step <b>${ps.stepMs.toFixed( 2 )}</b> ms (${ps.steps}×) · sync ${ps.syncMs.toFixed( 2 )} ms</div>` +
			`<div class="x">${crowdLine}${ps.readbackMs ? ` · GPU→CPU readback ${ps.readbackMs.toFixed( 1 )} ms` : ''}</div>`;

	}

	const animBytes = cs.animBytes ? ` · ${( cs.animBytes / 1048576 ).toFixed( cs.animBytes > 1048576 ? 0 : 2 )} MB` : '';
	const animLine = `<div class="x">animation <b>${S.anim}</b>${animBytes}${S.anim === 'skeletal' && app.crowd.animSystem !== 'skeletal' ? ' (unsupported here, using keyframe)' : ''}${app.crowd.skeletalLimit < S.count ? ` · bones for first ${formatCount( app.crowd.skeletalLimit )}` : ''}</div>`;
	app.ui.setHud(
		`<div class="fps ${fpsClass}">${s.fps.toFixed( 0 )}<small> fps</small></div>` +
		`<div>frame <b>${s.frameMs.toFixed( 1 )}</b> ms · CPU <b>${s.cpuMs.toFixed( 2 )}</b> ms</div>` +
		`<div>${gpuLine}</div>` +
		`<div>agents <b>${formatCount( S.count )}</b>${vis}</div>` +
		`<div>triangles/frame <b>${formatCount( Math.round( tris ) )}</b> <span class="dim">(crowd ${formatCount( cs.tris + castTris )})</span></div>` +
		`<div class="x">draw calls <b>${info.render.drawCalls}</b> · passes ${app.post.active ? app.post.passes : 1}${shadowsOn ? ' + shadow' : ''}</div>` +
		`<div class="dim x">${w}×${hgt} px (${app.pixelRatio.toFixed( 2 )}x)</div>` +
		animLine + phys +
		`<div class="dim more">${describeAdapter( g.info )}<br>feature level ${g.featureLevel} · three r${THREE.REVISION} · capacity ${formatCount( app.crowd.capacity )}${S.path === 'gpu' ? ` · cull lists ${( cs.cullBytes / 1048576 ).toFixed( 0 )} MB` : ''}</div>` );

}
