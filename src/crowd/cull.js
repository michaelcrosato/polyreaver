// GPU-driven render path: compute passes frustum-cull every agent, pick a LOD tier
// from its projected size and append it to that tier's instance buffers, counting
// instances into drawArgs; each tier is then drawn with one drawIndexedIndirect.

import * as THREE from 'three/webgpu';
import {
	Fn, If, float, int, uint, vec3, instancedArray, storage, instanceIndex, max, min, select, length,
	step, atomicAdd, atomicStore, dot
} from 'three/tsl';

export function ensureLodBuffers( crowd ) {

	if ( crowd.lodBufs ) return;

	const cap = crowd.capacity;
	crowd.lodBufs = [ 0, 1, 2, 3 ].map( ( k ) => instancedArray( cap, 'vec4' ).setName( 'crowdLod' + k ) );
	crowd.lodAnimBufs = [ 0, 1, 2, 3 ].map( ( k ) => instancedArray( cap, 'vec4' ).setName( 'crowdLodAnim' + k ) );

	const args = new Uint32Array( 20 );
	crowd.models.forEach( ( m, k ) => {

		args[ k * 5 ] = m.geometry.index.count;

	} );
	crowd.drawArgs = new THREE.IndirectStorageBufferAttribute( args, 1 );

	// One geometry per LOD tier sharing the model's vertex buffers but with its own
	// indirect-args offset. Never disposed: disposing a geometry in three.js also
	// destroys the storage buffers its materials read.
	crowd.lodGeos = crowd.models.map( ( m, k ) => {

		const src = m.geometry;
		const g = new THREE.BufferGeometry();
		for ( const name of Object.keys( src.attributes ) ) g.setAttribute( name, src.getAttribute( name ) );
		g.setIndex( src.index );
		g.setIndirect( crowd.drawArgs, k * 5 * 4 );
		g.boundingSphere = src.boundingSphere;
		g.name = src.name;
		return g;

	} );

	buildCull( crowd );

}

export function buildCull( crowd ) {

	const draw = storage( crowd.drawArgs, 'uint', 20 ).toAtomic();
	crowd.resetCompute = Fn( () => {

		atomicStore( draw.element( instanceIndex.mul( 5 ).add( 1 ) ), uint( 0 ) );

	} )().compute( 4 ).setName( 'Crowd Reset Args' );

	const u = crowd.u;
	const renderBuf = crowd.renderBuf, animBuf = crowd.animBuf;
	const lodBufs = crowd.lodBufs, lodAnim = crowd.lodAnimBufs;

	// The cull is split into passes that each own two LOD tiers, so no pass binds
	// more than 7 storage buffers (8 is the default limit per shader stage and the
	// real limit on many phones). Each pass re-tests visibility (cheap) and only
	// appends agents whose tier it owns.
	const makePass = ( tiers ) => Fn( () => {

		const i = instanceIndex;
		const rd = renderBuf.element( i ).toVar();
		const c = vec3( rd.x, 0.9, rd.z );
		const visible = float( 1 ).toVar();
		for ( const p of u.planes ) visible.mulAssign( step( - 1.3, dot( p.xyz, c ).add( p.w ) ) );

		If( visible.greaterThan( 0.5 ), () => {

			const dist = length( c.sub( u.camPos ) );
			const px = select( u.isOrtho.greaterThan( 0.5 ), u.pxScale, u.pxScale.div( max( dist, 0.5 ) ) ).mul( 1.8 );
			const t = u.lodThresholds;
			const lodTier = select( px.greaterThan( t.x ), float( 3 ), select( px.greaterThan( t.y ), float( 2 ), select( px.greaterThan( t.z ), float( 1 ), float( 0 ) ) ) );
			const tier = int( select( u.lodOn.greaterThan( 0.5 ), min( lodTier, u.maxTier ), u.maxTier ) ).toVar();
			for ( const k of tiers ) {

				If( tier.equal( k ), () => {

					const slot = atomicAdd( draw.element( k * 5 + 1 ), uint( 1 ) ).toVar();
					lodBufs[ k ].element( slot ).assign( rd );
					lodAnim[ k ].element( slot ).assign( animBuf.element( i ) );

				} );

			}

		} );

	} )().compute( crowd.capacity ).setName( `Crowd Cull + LOD ${tiers.join( '/' )}` );

	crowd.cullPasses = [ makePass( [ 0, 1 ] ), makePass( [ 2, 3 ] ) ];

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

}

export function maybeReadback( crowd ) {

	const now = performance.now();
	if ( crowd._readbackPending || now - crowd._lastReadback < 400 ) return;
	crowd._readbackPending = true;
	crowd._lastReadback = now;
	crowd.renderer.getArrayBufferAsync( crowd.drawArgs ).then( ( buf ) => {

		const a = new Uint32Array( buf );
		for ( let k = 0; k < 4; k ++ ) crowd.visibleByTier[ k ] = a[ k * 5 + 1 ];
		crowd._readbackPending = false;

	} ).catch( () => {

		crowd._readbackPending = false;

	} );

}
