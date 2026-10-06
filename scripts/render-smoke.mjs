// Real WebGPU regression suite. Run against the dev server or an HTTP-served
// build: node scripts/render-smoke.mjs --url http://127.0.0.1:5173/index.html
// Add --hardware to use the browser's default adapter instead of forcing SwiftShader.
import assert from 'node:assert/strict';
import { launchBrowser } from './browser.mjs';
import { serveBuild } from './http-build.mjs';

const args = process.argv.slice( 2 ), at = args.indexOf( '--url' ), hardware = args.includes( '--hardware' );
const server = at < 0 ? await serveBuild() : null;
const url = new URL( at >= 0 ? args[ at + 1 ] : server.origin + '/dist/index.html' );
assert.ok( [ 'http:', 'https:' ].includes( url.protocol ), 'Use --url with an HTTP-served build or dev server.' );
url.searchParams.set( 'engine', 'stress' );
url.hash = 'scene=plaza&count=128&capacity=65536&behaviour=5&anim=none&props=0&maxDpr=1';
const browser = await launchBrowser( { args: [ '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', ...hardware ? [] :
	[ '--enable-features=Vulkan,WebGPUService', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--use-angle=swiftshader' ] ] } );
const page = await browser.newPage( { viewport: { width: 640, height: 360 } } ), errors = [];
page.setDefaultTimeout( 120000 );
page.on( 'pageerror', ( error ) => errors.push( error.message ) );
page.on( 'console', ( message ) => {

	if ( [ 'error', 'warning' ].includes( message.type() ) && ! /experimental on this platform|DevTools|deprecated parameters/.test( message.text() ) ) errors.push( message.text() );

} );

await page.addInitScript( () => {

	window.__renderBindings = []; window.__renderGPUerrors = [];
	const groups = new WeakMap(), layouts = new WeakMap();
	const makeGroup = GPUDevice.prototype.createBindGroupLayout, makeLayout = GPUDevice.prototype.createPipelineLayout;
	GPUDevice.prototype.createBindGroupLayout = function ( descriptor ) {

		const group = makeGroup.call( this, descriptor ); groups.set( group, descriptor.entries ); return group;

	};
	GPUDevice.prototype.createPipelineLayout = function ( descriptor ) {

		const layout = makeLayout.call( this, descriptor );
		layouts.set( layout, descriptor.bindGroupLayouts.flatMap( ( group ) => groups.get( group ) || [] )
			.filter( ( entry ) => ( entry.visibility & 4 ) && [ 'storage', 'read-only-storage' ].includes( entry.buffer?.type ) ).length );
		return layout;

	};
	for ( const method of [ 'createComputePipeline', 'createComputePipelineAsync' ] ) {

		const make = GPUDevice.prototype[ method ];
		GPUDevice.prototype[ method ] = function ( descriptor ) {

			const count = layouts.get( descriptor.layout );
			if ( count === undefined || count > 8 ) throw new Error( `Compute storage binding limit violated: ${descriptor.label}: ${count}` );
			window.__renderBindings.push( { label: descriptor.label || '', count } ); return make.call( this, descriptor );

		};

	}
	const makeBuffer = GPUDevice.prototype.createBuffer;
	GPUDevice.prototype.createBuffer = function ( descriptor ) {

		if ( descriptor.size > this.limits.maxBufferSize || ( descriptor.usage & GPUBufferUsage.STORAGE ) && descriptor.size > this.limits.maxStorageBufferBindingSize ) {

			throw new Error( `Buffer limit violated: ${descriptor.label}: ${descriptor.size}` );

		}
		return makeBuffer.call( this, descriptor );

	};
	const request = GPUAdapter.prototype.requestDevice;
	GPUAdapter.prototype.requestDevice = async function ( descriptor ) {

		const requiredLimits = { ...descriptor.requiredLimits,
			maxStorageBuffersPerShaderStage: 8, maxStorageBufferBindingSize: Math.min( this.limits.maxStorageBufferBindingSize, 134217728 ) };
		for ( const stage of [ 'maxStorageBuffersInVertexStage', 'maxStorageBuffersInFragmentStage' ] ) {

			if ( stage in this.limits ) requiredLimits[ stage ] = Math.min( this.limits[ stage ], 8 );

		}
		const device = await request.call( this, { ...descriptor, requiredLimits } );
		device.addEventListener( 'uncapturederror', ( event ) => window.__renderGPUerrors.push( event.error.message ) );
		return device;

	};

} );

async function healthy() {

	const state = await page.evaluate( () => ( { fatal: window.__fatal || null, frame: window.app?._lastFrameError || null, gpu: window.__renderGPUerrors.splice( 0 ) } ) );
	assert.equal( state.fatal, null ); assert.equal( state.frame, null );
	assert.deepEqual( [ ...state.gpu, ...errors.splice( 0 ) ], [] );

}

async function frames( count = 1 ) {

	await page.evaluate( async ( count ) => {

		const app = window.app;
		for ( let i = 0; i < count; i ++ ) {

			app._lastFrame = performance.now() - 16;
			app.frame(); await app.gpu.device.queue.onSubmittedWorkDone();
			await new Promise( ( done ) => setTimeout( done, 0 ) );

		}

	}, count );
	await healthy();

}

const apply = ( values ) => page.evaluate( ( values ) => window.app.applyAll( values ), values );
const setting = ( key, value ) => page.evaluate( ( [ key, value ] ) => window.app.set( key, value ), [ key, value ] );
async function step( label, run ) { await run(); await healthy(); console.log( 'PASS ' + label ); }

try {

	await page.goto( url.href );
	await page.waitForFunction( () => window.__fatal || window.__boot?.status === 'running', null, { timeout: 180000 } );
	await healthy();
	await page.evaluate( () => {

		const app = window.app; app.renderer.setAnimationLoop( null ); window.__renderInit = [];
		const compute = app.renderer.compute.bind( app.renderer );
		app.renderer.compute = ( nodes, dispatch ) => {

			for ( const node of Array.isArray( nodes ) ? nodes : [ nodes ] ) if ( node === app.crowd.initCompute ) {

				window.__renderInit.push( { offset: app.crowd.u.initOffset.value, count: node.count } );

			}
			return compute( nodes, dispatch );

		};

	} );
	const baseline = await page.evaluate( () => ( { ...window.app.S, scene: 'plaza', count: 128, capacity: 65536,
		physics: false, path: 'direct', anim: 'none', tier: 0, behaviour: 5, props: false, shadows: 'off', shading: 'unlit',
		aa: 'none', ao: 'off', bloom: false, dof: 'off', ssgi: false, ssr: false, motionBlur: false } ) );
	await apply( baseline ); await frames();

	await step( 'active initialization and deterministic inactive-agent growth on the real GPU', async () => {

		await page.evaluate( () => { window.__renderInit = []; } );
		await setting( 'capacity', 262144 ); await frames();
		const before = await page.evaluate( async () => Array.from( new Float32Array( await window.app.renderer.getArrayBufferAsync( window.app.crowd.renderBuf.value, null, 16, 127 * 16 ) ) ) );
		await setting( 'count', 256 ); await frames();
		const after = await page.evaluate( async () => Array.from( new Float32Array( await window.app.renderer.getArrayBufferAsync( window.app.crowd.renderBuf.value, null, 16, 127 * 16 ) ) ) );
		assert.deepEqual( after, before, 'Growing the plaza crowd must preserve existing frozen agent state.' );
		await setting( 'count', 64 ); await frames();
		await setting( 'count', 192 ); await frames();
		await setting( 'count', 300 ); await frames();
		assert.deepEqual( await page.evaluate( () => window.__renderInit ), [ { offset: 0, count: 128 }, { offset: 128, count: 128 }, { offset: 256, count: 44 } ] );
		const indices = await page.evaluate( async () => {

			const app = window.app, data = new Float32Array( await app.renderer.getArrayBufferAsync( app.crowd.animBuf.value, null, 256 * 16, 44 * 16 ) );
			return Array.from( { length: 44 }, ( _, i ) => data[ i * 4 + 3 ] );

		} );
		assert.deepEqual( indices, Array.from( { length: 44 }, ( _, i ) => i + 256 ) );
		console.log( 'INIT ' + JSON.stringify( await page.evaluate( () => window.__renderInit ) ) );
		await apply( baseline );

	} );

	await step( 'radius boundary agent/obstacle collisions execute correctly in the GPU kernel', async () => {

		const result = await page.evaluate( async () => {

			const app = window.app, crowd = new app.crowd.constructor( app.renderer, app.scene, { capacity: 64, count: 3, limits: app.gpu.limits } );
			try {

				crowd.set( { collide: true, animSystem: 'none' } ); crowd.u.behaviour.value = 5; crowd.u.heroPos.value.set( 10000, 10000 );
				crowd.collider.u.radius.value = .6; crowd.initialize();
				const attribute = crowd.renderBuf.value;
				attribute.array.set( [ 10000, 0, 10000, 0, .99, 0, .5, 2048, 2, 0, .5, 4096 ] ); attribute.needsUpdate = true;
				crowd.update( 0, 0, app.rig.camera, app.renderer.domElement.height );
				const agents = new Float32Array( await app.renderer.getArrayBufferAsync( attribute, null, 0, 3 * 16 ) );
				crowd.setCount( 2 ); attribute.array[ 4 ] = .99; attribute.array[ 6 ] = .5; attribute.needsUpdate = true;
				crowd.collider.u.radius.value = .28;
				crowd.collider.obs.value.array.set( [ 2, 0, .5, .81, 0, 0, 0, 0 ] ); crowd.collider.upload( 1 );
				crowd.update( 0, 0, app.rig.camera, app.renderer.domElement.height );
				const obstacle = new Float32Array( await app.renderer.getArrayBufferAsync( attribute, null, 0, 2 * 16 ) );
				return { agentA: agents[ 4 ], agentB: agents[ 8 ], obstacleX: obstacle[ 4 ], range: crowd.collider.u.searchRadius.value };

			} finally { crowd.dispose(); }

		} );
		assert.ok( result.agentA < .95 && result.agentB > 2.04, JSON.stringify( result ) );
		assert.ok( result.agentB - result.agentA >= 1.199, JSON.stringify( result ) );
		assert.ok( result.obstacleX <= .911, JSON.stringify( result ) );
		assert.equal( result.range, 2 );

	} );

	await step( 'occupied proxy budgets shrink and growing Rapier fleets retain finite physical state', async () => {

		await apply( { ...baseline, physics: true, crowdMode: 'gpu', proxies: true, proxyCount: 1024, count: 1200, density: 3, bodies: 1 } );
		await frames( 2 );
		await page.waitForFunction( () => window.app.physics.activeProxies > 0 );
		await setting( 'proxyCount', 256 ); await frames( 2 );
		const proxies = await page.evaluate( () => {

			const physics = window.app.physics;
			return { length: physics.proxyBodies.length, active: physics.proxyMap.size,
				valid: [ ...physics.proxyMap ].every( ( [ agent, slot ] ) => physics.proxyBodies[ slot ]?.agent === agent ) };

		} );
		assert.equal( proxies.length, 256 ); assert.ok( proxies.active <= 256 ); assert.equal( proxies.valid, true );
		await apply( { ...baseline, physics: true, crowdMode: 'rapier', rapierAgents: 500, count: 1200, bodies: 1 } );
		await page.waitForFunction( () => window.app.physics.agentBodies.length === 500 ); await frames( 2 );
		await setting( 'rapierAgents', 1000 );
		await page.waitForFunction( () => window.app.physics.agentBodies.length === 1000 ); await frames( 2 );
		assert.equal( await page.evaluate( () => window.app.physics.agentBodies.every( ( agent ) =>
			[ ...Object.values( agent.body.translation() ), ...Object.values( agent.body.linvel() ) ].every( Number.isFinite ) ) ), true );
		await apply( baseline ); await frames();

	} );

	await step( 'capacity and scene changes repack only the active city population', async () => {

		await apply( { ...baseline, scene: 'city', seed: 'render-regression' } ); await frames();
		await page.evaluate( () => { window.__renderInit = []; } );
		await setting( 'count', 256 ); await frames();
		await setting( 'density', .7 ); await frames();
		await setting( 'count', 128 ); await frames();
		assert.deepEqual( await page.evaluate( () => window.__renderInit ), [ { offset: 0, count: 256 }, { offset: 0, count: 256 }, { offset: 0, count: 128 } ] );
		await apply( baseline ); await frames();

	} );

	await step( 'direct/GPU, skinning, shadows and collision capacity limits remain valid on an eight-binding device', async () => {

		await apply( { ...baseline, path: 'gpu', anim: 'skeletal', tier: 2, shading: 'standard', shadows: 'low', crowdShadows: true } ); await frames();
		await apply( { ...baseline, path: 'gpu', anim: 'procedural', tier: 3, capacity: 262144 } ); await frames();
		await apply( baseline ); await frames();
		const limits = await page.evaluate( () => {

			const app = window.app, previous = { physics: app.S.physics, crowdMode: app.S.crowdMode };
			app.S.physics = false; const direct = app.hardMaxCapacity;
			app.S.physics = true; app.S.crowdMode = 'gpu'; const collide = app.hardMaxCapacity;
			Object.assign( app.S, previous );
			return { direct, collide, bindingLimit: app.gpu.limits.maxStorageBuffersPerShaderStage, pipelines: window.__renderBindings };

		} );
		assert.equal( limits.bindingLimit, 8 ); assert.equal( limits.direct, 4194304 ); assert.equal( limits.collide, 2097152 );
		assert.ok( limits.pipelines.length > 0 ); assert.ok( limits.pipelines.every( ( pipeline ) => pipeline.count <= 8 ) );
		assert.ok( limits.pipelines.some( ( pipeline ) => /Crowd Simulate/.test( pipeline.label ) && pipeline.count === 8 ), 'The eight-storage-buffer physics simulation must actually compile.' );

	} );

	await step( 'repeated live GPU reconfiguration stabilizes ownership counters', async () => {

		const cycle = async () => {

			await apply( { ...baseline, path: 'gpu', anim: 'skeletal', tier: 3 } ); await frames();
			await apply( { ...baseline, path: 'gpu', anim: 'procedural', tier: 3, capacity: 262144 } ); await frames();
			await apply( baseline ); await frames();

		};
		const snapshot = () => page.evaluate( async () => {

			const app = window.app;
			await Promise.all( [ app.gpu.device.queue.onSubmittedWorkDone(), new Promise( ( done ) => setTimeout( done, 20 ) ) ] );
			const memory = app.renderer.info.memory;
			return Object.fromEntries( [ 'storageAttributes', 'storageAttributesSize', 'uniformBuffers', 'uniformBuffersSize', 'programs', 'geometries', 'textures', 'texturesSize' ]
				.map( ( key ) => [ key, memory[ key ] ] ).concat( [ [ 'pipelines', app.renderer._pipelines.caches.size ] ] ) );

		} );
		await cycle(); const settled = await snapshot();
		for ( let iteration = 0; iteration < 2; iteration ++ ) {

			await cycle(); assert.deepEqual( await snapshot(), settled, `GPU ownership grew during cycle ${iteration + 2}.` );

		}
		console.log( 'MEMORY ' + JSON.stringify( settled ) );

	} );
	await step( 'isolated seeded initialization reports queue-fence and available GPU timestamp measurements', async () => {

		const measurement = await page.evaluate( async ( hardware ) => {

			const app = window.app, active = 2048, capacity = 262144, renderer = app.renderer;
			const crowd = new app.crowd.constructor( renderer, app.scene, { capacity, count: active, limits: app.gpu.limits } );
			const timestamps = app.gpu.timestamps && renderer.backend.trackTimestamp;
			const drain = async () => { if ( timestamps ) await renderer.resolveTimestampsAsync( 'compute' ); };
			try {

				crowd.u.behaviour.value = 5; crowd.u.time.value = 0; crowd.u.dt.value = 0;
				crowd.initialize(); await app.gpu.device.queue.onSubmittedWorkDone(); await drain();
				const run = async ( count ) => {

					crowd.u.initOffset.value = 0; crowd.initCompute.count = count;
					const start = performance.now(); renderer.compute( crowd.initCompute );
					await app.gpu.device.queue.onSubmittedWorkDone();
					const queueFenceMs = performance.now() - start;
					const gpuTimestampMs = timestamps ? await renderer.resolveTimestampsAsync( 'compute' ) : null;
					return { count, offset: 0, queueFenceMs, gpuTimestampMs };

				};
				// Both paths use the same allocated buffers, compiled kernel, density,
				// seed/index, active count and frozen uniforms. Only dispatch count changes.
				await run( active ); await run( capacity );
				const samples = { active: [], capacity: [] };
				for ( let iteration = 0; iteration < 5; iteration ++ ) {

					for ( const name of iteration % 2 ? [ 'capacity', 'active' ] : [ 'active', 'capacity' ] ) {

						samples[ name ].push( await run( name === 'active' ? active : capacity ) );

					}

				}
				await run( active );
				const activeState = Array.from( new Float32Array( await renderer.getArrayBufferAsync( crowd.renderBuf.value, null, 0, active * 16 ) ) );
				await run( capacity );
				const capacityState = Array.from( new Float32Array( await renderer.getArrayBufferAsync( crowd.renderBuf.value, null, 0, active * 16 ) ) );
				const median = ( values ) => values.toSorted( ( a, b ) => a - b )[ Math.floor( values.length / 2 ) ];
				return { scope: 'Initialization kernel only; allocation/upload excluded; no overall startup speedup claim.',
					mode: hardware ? 'hardware requested' : 'SwiftShader software only', adapter: app.gpu.info, active, capacity, timestamps,
					identicalActiveState: activeState.every( ( value, index ) => value === capacityState[ index ] ), samples,
					medians: Object.fromEntries( Object.entries( samples ).map( ( [ name, values ] ) => [ name, {
						queueFenceMs: median( values.map( ( value ) => value.queueFenceMs ) ),
						gpuTimestampMs: timestamps ? median( values.map( ( value ) => value.gpuTimestampMs ) ) : null
					} ] ) ) };

			} finally { crowd.dispose(); }

		}, hardware );
		assert.equal( measurement.identicalActiveState, true );
		for ( const [ name, values ] of Object.entries( measurement.samples ) ) for ( const sample of values ) {

			assert.equal( sample.count, measurement[ name ] ); assert.equal( sample.offset, 0 );
			assert.ok( Number.isFinite( sample.queueFenceMs ) && sample.queueFenceMs >= 0 );
			if ( measurement.timestamps ) assert.ok( Number.isFinite( sample.gpuTimestampMs ) && sample.gpuTimestampMs >= 0 );

		}
		console.log( 'INIT_TIMING ' + JSON.stringify( measurement ) );

	} );
	console.log( 'PASS render smoke: seven integration checks' );

} finally {

	await browser.close();
	if ( server ) await server.close();

}
