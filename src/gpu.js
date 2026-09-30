// WebGPU device bootstrap. WebGPU only - there is deliberately no WebGL fallback.
//
// three.js normally requests the adapter/device itself using the WebGPU
// "compatibility" feature level and *default* limits. For a stress test we want
// the real hardware limits (bigger storage buffers, storage buffers in the vertex
// stage, timestamp queries...), so we create the device ourselves and hand it to
// WebGPURenderer.

export class WebGPUUnavailableError extends Error {}

// Some Chromium builds shipped an older, object-typed `swizzle` member on
// GPUTextureViewDescriptor, while three.js r186 always passes the new string form
// ('rgba'). An identity swizzle is a no-op, so dropping it is always safe and keeps
// those browsers working.
function installSwizzleShim() {

	if ( typeof GPUTexture === 'undefined' || GPUTexture.prototype.__swizzleShim ) return;
	const createView = GPUTexture.prototype.createView;
	GPUTexture.prototype.createView = function ( descriptor ) {

		if ( descriptor && descriptor.swizzle === 'rgba' ) {

			const { swizzle, ...rest } = descriptor; // eslint-disable-line no-unused-vars
			return createView.call( this, rest );

		}

		return createView.call( this, descriptor );

	};

	GPUTexture.prototype.__swizzleShim = true;

}

const WANTED_LIMITS = [
	'maxBufferSize',
	'maxStorageBufferBindingSize',
	'maxStorageBuffersPerShaderStage',
	'maxStorageBuffersInVertexStage',
	'maxStorageBuffersInFragmentStage',
	'maxComputeWorkgroupsPerDimension',
	'maxComputeInvocationsPerWorkgroup',
	'maxComputeWorkgroupSizeX',
	'maxComputeWorkgroupStorageSize',
	'maxColorAttachmentBytesPerSample',
	'maxTextureDimension2D',
	'maxVertexBuffers',
	'maxVertexAttributes',
	'maxSampledTexturesPerShaderStage',
	'maxUniformBufferBindingSize'
];

// Features we never want: see installSwizzleShim().
const SKIP_FEATURES = new Set( [ 'texture-component-swizzle' ] );

export async function createDevice() {

	if ( ! ( 'gpu' in navigator ) ) {

		throw new WebGPUUnavailableError( window.isSecureContext
			? 'navigator.gpu is missing: this browser/device does not expose WebGPU.'
			: 'WebGPU requires a secure context (https:// or http://localhost). This page was opened over plain http.' );

	}

	installSwizzleShim();

	let adapter = await navigator.gpu.requestAdapter( { powerPreference: 'high-performance' } );
	let featureLevel = 'core';

	if ( adapter === null ) {

		// Some mobile GPUs only expose the "compatibility" subset (OpenGL ES class hardware).
		// That is still WebGPU - just with tighter limits.
		adapter = await navigator.gpu.requestAdapter( { featureLevel: 'compatibility', powerPreference: 'high-performance' } );
		featureLevel = 'compatibility';

	}

	if ( adapter === null ) throw new WebGPUUnavailableError( 'No WebGPU adapter available (GPU blocklisted or WebGPU disabled).' );

	const requiredLimits = {};
	for ( const name of WANTED_LIMITS ) {

		if ( name in adapter.limits ) requiredLimits[ name ] = adapter.limits[ name ];

	}

	const requiredFeatures = [ ...adapter.features ].filter( ( f ) => ! SKIP_FEATURES.has( f ) );

	const device = await adapter.requestDevice( { requiredFeatures, requiredLimits } );

	const info = adapter.info || {};

	return {
		adapter,
		device,
		featureLevel: device.features.has( 'core-features-and-limits' ) ? 'core' : featureLevel,
		info: {
			vendor: info.vendor || '',
			architecture: info.architecture || '',
			device: info.device || '',
			description: info.description || '',
			isFallbackAdapter: !! info.isFallbackAdapter,
			subgroupMinSize: info.subgroupMinSize,
			subgroupMaxSize: info.subgroupMaxSize
		},
		limits: Object.fromEntries( WANTED_LIMITS.filter( ( n ) => n in device.limits ).map( ( n ) => [ n, device.limits[ n ] ] ) ),
		features: [ ...device.features ],
		timestamps: device.features.has( 'timestamp-query' )
	};

}

export function describeAdapter( info ) {

	const parts = [ info.vendor, info.architecture, info.device, info.description ].filter( Boolean );
	const text = parts.length ? parts.join( ' · ' ) : 'Unknown GPU (browser hides adapter details)';
	return info.isFallbackAdapter ? text + ' (software fallback adapter!)' : text;

}
