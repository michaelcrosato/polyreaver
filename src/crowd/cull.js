// GPU-driven render path: compute passes frustum-cull every agent, pick a LOD tier
// from its projected size and append it to that tier's instance buffers, counting
// instances into drawArgs; each tier is then drawn with one drawIndexedIndirect.
//
// Shadow casters get a second, separate cull. The shadow map has to contain every
// agent whose shadow can land on screen, not just the agents on screen: one just
// past the edge still throws its shadow into view (a long way with a low sun). So
// while the crowd casts shadows, extra passes test every agent against the sun's
// orthographic shadow camera (and the view swept toward the sun, see
// updateShadowPlanes) and fill a second set of per-tier lists. Those are drawn by
// caster-only meshes on SHADOW_LAYER, a layer the main camera does not render but
// the shadow camera does; the on-screen meshes stop casting.

import * as THREE from 'three/webgpu';
import {
	Fn, If, float, int, uint, vec3, instancedArray, storage, instanceIndex, max, min, select, length,
	step, atomicAdd, atomicStore, dot, mix
} from 'three/tsl';

// Object layer only the sun's shadow camera renders. three.js r186's ShadowNode
// renders with shadow.camera.layers as-is when it has any bit besides layer 0 set
// (with only layer 0 it copies the main camera's mask instead), so enabling this
// layer on the shadow camera keeps layer 0 (props, ground) and adds the casters.
// The main camera keeps the default mask (layer 0) and never sees them.
export const SHADOW_LAYER = 3;

// drawArgs holds 8 drawIndexedIndirect records of 5 uints: tiers 0-3 for the
// on-screen lists, then tiers 0-3 for the shadow-caster lists.
const CASTER_ARGS = 4;

export function ensureLodBuffers( crowd ) {

	if ( crowd.lodBufs ) return;

	const cap = crowd.capacity;
	crowd.lodBufs = [ 0, 1, 2, 3 ].map( ( k ) => instancedArray( cap, 'vec4' ).setName( 'crowdLod' + k ) );
	crowd.lodAnimBufs = [ 0, 1, 2, 3 ].map( ( k ) => instancedArray( cap, 'vec4' ).setName( 'crowdLodAnim' + k ) );

	const args = new Uint32Array( 40 );
	crowd.models.forEach( ( m, k ) => {

		args[ k * 5 ] = args[ ( CASTER_ARGS + k ) * 5 ] = m.geometry.index.count;

	} );
	crowd.drawArgs = new THREE.IndirectStorageBufferAttribute( args, 1 );

	// One geometry per LOD tier sharing the model's vertex buffers but with its own
	// indirect-args offset (a second set reads the shadow-caster records). Never
	// disposed only when their owned storage is freed: three.js also destroys the
	// storage buffers their materials read when the wrappers are disposed.
	const tierGeometry = ( m, record ) => {

		const src = m.geometry;
		const g = new THREE.BufferGeometry();
		for ( const name of Object.keys( src.attributes ) ) g.setAttribute( name, src.getAttribute( name ) );
		g.setIndex( src.index );
		g.setIndirect( crowd.drawArgs, record * 5 * 4 );
		g.boundingSphere = src.boundingSphere;
		g.name = src.name;
		return g;

	};

	crowd.lodGeos = crowd.models.map( ( m, k ) => tierGeometry( m, k ) );
	crowd.casterGeos = crowd.models.map( ( m, k ) => tierGeometry( m, CASTER_ARGS + k ) );

	buildCull( crowd );

}

// One cull + LOD kernel: appends every agent inside `planes` to the list of its LOD
// tier, for the tiers in `tiers` only. Used for both the on-screen lists (main
// camera planes) and the shadow-caster lists (sun planes).
function makeCullPass( crowd, draw, { tiers, planes, record, bufs, animBufs, name } ) {

	const u = crowd.u;
	const renderBuf = crowd.renderBuf, animBuf = crowd.animBuf;

	return Fn( () => {

		const i = instanceIndex;
		const rd = renderBuf.element( i ).toVar();
		if ( crowd.profile?.previous ) {

			const previous = crowd.profile.previous.element( i );
			rd.x.assign( mix( previous.x, rd.x, crowd.profile.alpha ) );
			rd.z.assign( mix( previous.y, rd.z, crowd.profile.alpha ) );

		}
		const c = vec3( rd.x, 0.9, rd.z );
		const visible = float( 1 ).toVar();
		for ( const p of planes ) visible.mulAssign( step( - 1.3, dot( p.xyz, c ).add( p.w ) ) );

		If( visible.greaterThan( 0.5 ), () => {

			// The tier always comes from the agent's height on SCREEN (main camera),
			// for casters too, so a visible agent's caster is exactly the model that
			// is drawn and it shadows itself correctly. A shadow can't hold more detail
			// than its texels, so picking caster tiers from the shadow map's resolution
			// would be cheaper, but a coarser caster than the body it belongs to pokes
			// through that body and speckles it with self-shadow.
			const dist = length( c.sub( u.camPos ) );
			const px = select( u.isOrtho.greaterThan( 0.5 ), u.pxScale, u.pxScale.div( max( dist, 0.5 ) ) ).mul( 1.8 );
			const t = u.lodThresholds;
			const lodTier = select( px.greaterThan( t.x ), float( 3 ), select( px.greaterThan( t.y ), float( 2 ), select( px.greaterThan( t.z ), float( 1 ), float( 0 ) ) ) );
			const tier = int( select( u.lodOn.greaterThan( 0.5 ), min( lodTier, u.maxTier ), u.maxTier ) ).toVar();
			if ( crowd.profile ) If( i.equal( 0 ), () => { tier.assign( max( tier, min( u.maxTier, 1 ) ) ); } );
			for ( const k of tiers ) {

				If( tier.equal( k ), () => {

					const slot = atomicAdd( draw.element( ( record + k ) * 5 + 1 ), uint( 1 ) ).toVar();
					bufs[ k ].element( slot ).assign( rd );
					animBufs[ k ].element( slot ).assign( animBuf.element( i ) );

				} );

			}

		} );

	} )().compute( crowd.capacity ).setName( `${name} ${tiers.join( '/' )}` );

}

export function buildCull( crowd ) {

	crowd.resetCompute?.dispose();
	for ( const compute of crowd.cullPasses || [] ) compute.dispose();
	const draw = storage( crowd.drawArgs, 'uint', 40 ).toAtomic();
	crowd.resetCompute = Fn( () => {

		atomicStore( draw.element( instanceIndex.mul( 5 ).add( 1 ) ), uint( 0 ) );

	} )().compute( 8 ).setName( 'Crowd Reset Args' );

	// The cull is split into passes that each own two LOD tiers, so no pass binds
	// more than 7 storage buffers (8 is the default limit per shader stage and the
	// real limit on many phones). Each pass re-tests visibility (cheap) and only
	// appends agents whose tier it owns.
	const pass = ( tiers ) => makeCullPass( crowd, draw, {
		tiers, planes: crowd.u.planes, record: 0, bufs: crowd.lodBufs, animBufs: crowd.lodAnimBufs, name: 'Crowd Cull + LOD'
	} );
	crowd.cullPasses = [ pass( [ 0, 1 ] ), pass( [ 2, 3 ] ) ];

}

// Shadow-caster lists, allocated on first use and only for the tiers the crowd can
// draw (0..crowd.tier): 2 vec4 = 32 bytes per agent of capacity per tier, so
// 32 B/agent with Tetra up to 128 B/agent with Hi (32 MB-128 MB at 1M capacity).
// Freed with the other crowd buffers when the capacity changes.
export function ensureCasters( crowd ) {

	ensureLodBuffers( crowd );
	if ( ! crowd.casterBufs ) {

		crowd.casterBufs = [];
		crowd.casterAnimBufs = [];

	}

	const cap = crowd.capacity;
	let added = false;
	for ( let k = 0; k <= crowd.tier; k ++ ) {

		if ( crowd.casterBufs[ k ] ) continue;
		crowd.casterBufs[ k ] = instancedArray( cap, 'vec4' ).setName( 'crowdCaster' + k );
		crowd.casterAnimBufs[ k ] = instancedArray( cap, 'vec4' ).setName( 'crowdCasterAnim' + k );
		added = true;

	}

	if ( added ) buildCasterCull( crowd );

}

// Same kernel against the 12 caster planes (updateShadowPlanes), writing the caster
// lists. Same split as the on-screen cull (at most two tiers = 7 storage buffers
// per pass: renderBuf, animBuf, drawArgs + 2 lists per tier); the planes are
// uniforms, not storage. These passes only run while the crowd casts shadows in
// the GPU-driven path.
function buildCasterCull( crowd ) {

	for ( const compute of crowd.casterPasses || [] ) compute.dispose();
	const draw = storage( crowd.drawArgs, 'uint', 40 ).toAtomic();
	crowd.casterPasses = [ [ 0, 1 ], [ 2, 3 ] ]
		.map( ( pair ) => pair.filter( ( k ) => crowd.casterBufs[ k ] ) )
		.filter( ( tiers ) => tiers.length )
		.map( ( tiers ) => makeCullPass( crowd, draw, {
			tiers, planes: crowd.u.shadowPlanes, record: CASTER_ARGS, bufs: crowd.casterBufs, animBufs: crowd.casterAnimBufs, name: 'Crowd Shadow Cull + LOD'
		} ) );

}

// Bytes held by the GPU-driven lists: 4 on-screen tiers x 2 vec4 (128 B/agent of
// capacity) plus 32 B/agent per allocated caster tier, plus the indirect args.
export function cullMemory( crowd ) {

	if ( ! crowd.lodBufs ) return 0;
	const lists = crowd.lodBufs.length + ( crowd.casterBufs ? crowd.casterBufs.length : 0 );
	return lists * 2 * 16 * crowd.capacity + 40 * 4;

}

export function updateCullUniforms( crowd, camera, viewportHeight ) {

	const u = crowd.u;
	const m = new THREE.Matrix4().multiplyMatrices( camera.projectionMatrix, camera.matrixWorldInverse );
	const frustum = new THREE.Frustum().setFromProjectionMatrix( m, camera.coordinateSystem );
	frustum.planes.forEach( ( p, k ) => u.planes[ k ].value.set( p.normal.x, p.normal.y, p.normal.z, p.constant ) );
	camera.getWorldPosition( u.camPos.value );
	if ( camera.isOrthographicCamera ) {

		u.isOrtho.value = 1;
		u.pxScale.value = viewportHeight / ( ( camera.top - camera.bottom ) / camera.zoom );

	} else {

		u.isOrtho.value = 0;
		u.pxScale.value = viewportHeight / ( 2 * Math.tan( THREE.MathUtils.degToRad( camera.fov ) / 2 ) );

	}

	u.maxTier.value = crowd.tier;
	u.lodOn.value = crowd.lodEnabled ? 1 : 0;
	if ( crowd.castShadow && crowd.casterBufs ) updateShadowPlanes( crowd );

}

const _lightPos = new THREE.Vector3();
const _lightDir = new THREE.Vector3();

// Caster planes: 6 from the sun's shadow camera, then the 6 view planes swept toward the sun.
function updateShadowPlanes( crowd ) {

	const u = crowd.u, light = crowd.shadowLight;
	if ( ! light || ! light.shadow ) {

		// no light to cull against: cast from what is on screen (the old behaviour)
		u.shadowPlanes.forEach( ( p, k ) => p.value.copy( u.planes[ k % 6 ].value ) );
		return;

	}

	// 1. The sun's frustum: anything outside it never reaches the shadow map. The
	// world moves the sun with the camera focus every frame, but three.js only
	// refreshes the shadow camera when it renders the shadow map, which happens
	// after this compute. Bring it up to date now (the same call three.js makes).
	light.updateMatrixWorld();
	light.target.updateMatrixWorld();
	light.shadow.updateMatrices( light );
	light.shadow.camera.layers.enable( SHADOW_LAYER );
	light.shadow.getFrustum().planes.forEach( ( p, k ) => u.shadowPlanes[ k ].value.set( p.normal.x, p.normal.y, p.normal.z, p.constant ) );

	// 2. The view, swept toward the sun. The sun's box is fitted loosely around the
	// view and gets very long with a low sun, so most agents in it shadow ground that
	// is off screen. An agent's shadow can only reach the view if its bounding sphere,
	// swept along the light until it reaches the ground (nothing that receives
	// shadows is lower), touches the view frustum. For each view plane that is just
	// the plane pushed back toward the sun by how far the sweep reaches across it,
	// so it costs the same as a plain plane test and never drops a visible shadow.
	_lightPos.setFromMatrixPosition( light.matrixWorld );
	_lightDir.setFromMatrixPosition( light.target.matrixWorld ).sub( _lightPos ).normalize(); // direction the light travels
	const reach = 2.2 / Math.max( - _lightDir.y, 0.05 ); // sphere top (0.9 + 1.3 m) down to the ground
	for ( let k = 0; k < 6; k ++ ) {

		const p = u.planes[ k ].value;
		const push = Math.max( 0, reach * ( p.x * _lightDir.x + p.y * _lightDir.y + p.z * _lightDir.z ) );
		u.shadowPlanes[ 6 + k ].value.set( p.x, p.y, p.z, p.w + push );

	}

}

export function maybeReadback( crowd ) {

	const now = performance.now();
	if ( crowd._readbackPending || now - crowd._lastReadback < 400 ) return;
	crowd._readbackPending = true;
	crowd._lastReadback = now;
	const generation = crowd.storageGeneration;
	crowd.renderer.getArrayBufferAsync( crowd.drawArgs ).then( ( buf ) => {

		if ( crowd.disposed || generation !== crowd.storageGeneration ) { crowd._readbackPending = false; return; }
		const a = new Uint32Array( buf );
		for ( let k = 0; k < 4; k ++ ) {

			crowd.visibleByTier[ k ] = a[ k * 5 + 1 ];
			crowd.castersByTier[ k ] = a[ ( CASTER_ARGS + k ) * 5 + 1 ];

		}

		crowd._readbackPending = false;

	} ).catch( () => {

		crowd._readbackPending = false;

	} );

}
