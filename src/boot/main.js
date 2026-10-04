import { BootLoader } from './loader.js';
import { createDevice, describeAdapter } from '../gpu.js';

const paths = import.meta.env.DEV
	? { game: '/src/game/main.js', stress: '/src/main.js', city: '/src/city/main.js' }
	: __ENGINE_PATHS__;

async function loadEngine( id ) {

	const embedded = document.getElementById( 'boot-engine-' + id );
	let url = paths[ id ];
	if ( embedded ) {

		const bytes = Uint8Array.from( atob( embedded.textContent.trim() ), ( c ) => c.charCodeAt( 0 ) );
		url = URL.createObjectURL( new Blob( [ bytes ], { type: 'text/javascript' } ) );

	}
	try { return await import( /* @vite-ignore */ url ); }
	finally { if ( embedded ) URL.revokeObjectURL( url ); }

}

const boot = new BootLoader( {
	brand: 'POLYREAVER', version: __BOOT_VERSION__, build: __BOOT_BUILD__,
	modes: {
		game: { label: 'hack and slash', load: () => loadEngine( 'game' ) },
		stress: { label: 'procedural city stress test', load: () => loadEngine( 'city' ) },
		classic: { label: 'classic crowd test', load: () => loadEngine( 'stress' ) }
	}
} );

try {

	await boot.step( 'PLAT', 'Checking platform capabilities', 20, () => {

		const caps = boot.state.capabilities;
		caps.secureContext = isSecureContext;
		caps.webgpu = !! navigator.gpu;
		caps.webAssembly = typeof WebAssembly === 'object';
		caps.worker = typeof Worker === 'function';
		caps.storage = false;
		try { const key = 'polyreaver.boot.check'; localStorage.setItem( key, '1' ); localStorage.removeItem( key ); caps.storage = true; } catch { /* Gameplay can run without saving. */ }
		if ( ! caps.webAssembly ) throw new Error( 'WebAssembly is required by the engine. Enable it or try a current browser.' );
		if ( ! caps.storage ) boot.state.storageNotice = 'Saving unavailable; this run will not be kept.';

	} );
	const gpu = await boot.step( 'GPU', 'Initializing WebGPU device', 55, async () => {

		try {

			const result = await createDevice();
			// A timed-out request must never leak a late device or start an engine.
			if ( boot.state.status === 'failed' ) { result.device.destroy(); boot.assertActive(); }
			boot.watchDevice( result.device );
			boot.state.renderer = `WebGPU (${result.featureLevel})`;
			boot.state.adapter = describeAdapter( result.info );
			boot.state.capabilities.limits = result.limits;
			boot.state.capabilities.features = result.features;
			return result;

		} catch ( error ) {

			const canvas = document.createElement( 'canvas' );
			const gl = canvas.getContext( 'webgl2' );
			boot.state.capabilities.webgl2 = !! gl;
			gl?.getExtension( 'WEBGL_lose_context' )?.loseContext();
			throw new Error( `${error.message}\n${gl ? 'WebGL2 is available, but' : 'No compatible fallback is available;'} these engines require WebGPU compute and storage buffers. Use a WebGPU-capable browser/device over HTTPS or localhost.`, { cause: error } );

		}

	} );
	await boot.step( 'CHECK', 'Verifying engine requirements', 85, () => {

		if ( gpu.limits.maxStorageBuffersPerShaderStage < 8 ) throw new Error( 'The engines require at least 8 storage buffers per shader stage.' );
		if ( ! document.createElement( 'canvas' ).getContext( 'webgpu' ) ) throw new Error( 'A WebGPU canvas cannot be created on this platform.' );
		if ( boot.state.storageNotice ) {

			boot.el( 'help' ).textContent = boot.state.storageNotice;
			boot.el( 'help' ).hidden = false;

		}

	} );
	const requested = new URLSearchParams( location.search ).get( 'engine' );
	const mode = requested || ( document.body.dataset.bootMode === 'city' ? 'stress' : document.body.dataset.bootMode );
	if ( [ 'game', 'stress', 'classic' ].includes( mode ) ) await boot.launch( mode, gpu );
	else boot.choose( gpu );

} catch ( error ) {

	boot.fail( error );

}
