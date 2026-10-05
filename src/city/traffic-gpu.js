// Large fleets use GPU road traversal and two compact visible lists. Each pass
// binds at most four storage buffers, below the phone's eight-buffer ceiling.
import * as THREE from 'three/webgpu';
import {
	Fn, If, Return, uint, float, vec2, vec3, vec4, uniform, instancedArray, storage, instanceIndex,
	hash, floor, select, length, min, max, sin, cos, atan, dot, step, normalLocal, positionLocal,
	transformNormalToView, atomicAdd, atomicStore
} from 'three/tsl';
import { MAX_CARS, LANE, JUNCTION, packTrafficRoads } from './traffic-sim.js';
import { boxGeometry, mergedGeometry } from './render/geometry.js';

const random = ( id, salt ) => hash( id.mul( 7919 ).add( uint( salt ) ) );
const rotate = ( p, heading ) => vec3( p.x.mul( cos( heading ) ).add( p.z.mul( sin( heading ) ) ), p.y, p.z.mul( cos( heading ) ).sub( p.x.mul( sin( heading ) ) ) );

export class GpuTraffic {

	constructor( city, renderer, detailedGeometry ) {

		this.renderer = renderer; this.count = 0; this.frame = 0; this.disposed = false; this.visibleCounts = [ 0, 0 ];
		const network = packTrafficRoads( city ); this.network = network;
		this.roads = storage( new THREE.StorageBufferAttribute( network.data, 4 ), 'vec4', network.data.length / 4 ).toReadOnly();
		this.state = instancedArray( MAX_CARS, 'vec4' ); this.poses = instancedArray( MAX_CARS, 'vec4' );
		this.lists = [ instancedArray( MAX_CARS, 'vec4' ), instancedArray( MAX_CARS, 'vec4' ) ];
		this.u = { count: uniform( 0, 'uint' ), dt: uniform( 0 ), time: uniform( 0 ), frame: uniform( 0, 'uint' ),
			planes: Array.from( { length: 6 }, () => uniform( new THREE.Vector4( 0, 0, 0, 1e9 ) ) ),
			camera: uniform( new THREE.Vector3() ), ortho: uniform( 1 ), pixels: uniform( 1 ) };
		const box = boxGeometry();
		const distant = mergedGeometry( [ { geometry: box, x: 0, y: .3, z: 0, sx: 1.7, sy: .6, sz: 3.6 }, { geometry: box, x: 0, y: .9, z: -.15, sx: 1.35, sy: .55, sz: 1.85, color: 0x718d9c } ] ); box.dispose();
		const models = [ detailedGeometry, distant ];
		const args = new Uint32Array( 10 ); models.forEach( ( g, k ) => { args[ k * 5 ] = g.attributes.position.count; } );
		this.drawArgs = new THREE.IndirectStorageBufferAttribute( args, 1 );
		this.meshes = models.map( ( source, k ) => {

			const geo = new THREE.BufferGeometry();
			for ( const name of Object.keys( source.attributes ) ) geo.setAttribute( name, source.attributes[ name ] );
			geo.setIndex( Array.from( { length: source.attributes.position.count }, ( _, i ) => i ) );
			geo.setIndirect( this.drawArgs, k * 20 ); geo.userData.triangles = source.userData.triangles;
			const material = new THREE.MeshBasicNodeMaterial( { vertexColors: true } );
			const pose = this.lists[ k ].toAttribute(), heading = pose.z;
			material.positionNode = rotate( positionLocal, heading ).add( vec3( pose.x, .04, pose.y ) );
			material.normalNode = transformNormalToView( rotate( normalLocal, heading ) );
			material.colorNode = vec3( 1, .7, .42 ).mul( random( uint( pose.w ), 15 ).mul( .3 ).add( .7 ) );
			const mesh = new THREE.Mesh( geo, material ); mesh.count = 2; mesh.frustumCulled = false; mesh.visible = false;
			mesh.name = `City GPU cars ${k}`; mesh.userData.cityCars = true;
			return mesh;

		} );
		this.frustum = new THREE.Frustum(); this.projection = new THREE.Matrix4();
		this.buildComputes();

	}

	buildComputes() {

		const { roads, state, poses, u } = this;
		const successor = ( index, salt ) => {

			const meta = roads.element( index.mul( 3 ).add( 1 ) ), exits = roads.element( index.mul( 3 ).add( 2 ) );
			const slot = floor( random( instanceIndex, salt ).mul( meta.y ) );
			return select( slot.lessThan( 1 ), exits.x, select( slot.lessThan( 2 ), exits.y, exits.z ) );

		};
		this.init = Fn( () => {

			const i = instanceIndex; If( i.greaterThanEqual( u.count ), () => Return() );
			const edge = uint( random( i, 1 ).mul( this.network.edges.length ) ), meta = roads.element( edge.mul( 3 ).add( 1 ) );
			state.element( i ).assign( vec4( float( edge ), float( JUNCTION + 6 ).add( random( i, 2 ).mul( meta.x.sub( JUNCTION * 2 + 12 ) ) ), successor( edge, 3 ), - 1 ) );

		} )().compute( MAX_CARS ).setName( 'Cars Init' );
		this.simulate = Fn( () => {

			const i = instanceIndex; If( i.greaterThanEqual( u.count ), () => Return() );
			const s = state.element( i ).toVar(), speed = random( i, 5 ).mul( 4 ).add( 7 );
			const edge = uint( s.x ).toVar(), origin = roads.element( edge.mul( 3 ) ).toVar(), meta = roads.element( edge.mul( 3 ).add( 1 ) ).toVar();
			const next = uint( s.z ).toVar(), target = roads.element( next.mul( 3 ) );
			const node = origin.xy.add( origin.zw.mul( meta.x ) );
			const start = node.sub( origin.zw.mul( JUNCTION ) ).add( vec2( origin.w.negate(), origin.z ).mul( LANE ) );
			const end = node.add( target.zw.mul( JUNCTION ) ).add( vec2( target.w.negate(), target.z ).mul( LANE ) );
			const straight = dot( origin.zw, target.zw ).greaterThan( .5 );
			const control = node.add( vec2( origin.w.negate(), origin.z ).mul( LANE ) ).add( select( straight, vec2( 0 ), vec2( target.w.negate(), target.z ).mul( LANE ) ) );
			const pathLength = length( end.sub( start ) ).add( length( control.sub( start ) ) ).add( length( end.sub( control ) ) ).mul( .5 );
			If( s.w.greaterThanEqual( 0 ), () => {

				s.w.addAssign( speed.mul( u.dt ).div( max( pathLength, .01 ) ) );
				If( s.w.greaterThanEqual( 1 ), () => {

					s.x.assign( s.z ); s.y.assign( JUNCTION ); s.z.assign( successor( next, u.frame.add( 7 ) ) ); s.w.assign( - 1 );
					edge.assign( next ); origin.assign( roads.element( edge.mul( 3 ) ) ); meta.assign( roads.element( edge.mul( 3 ).add( 1 ) ) );

				} );

			} ).Else( () => {

				s.y.assign( min( meta.x.sub( JUNCTION ), s.y.add( speed.mul( u.dt ) ) ) );
				const phase = u.time.add( meta.z ).mod( 28 );
				const green = meta.w.lessThan( .5 ).or( select( origin.z.abs().greaterThan( .5 ), phase.lessThan( 12 ), phase.greaterThanEqual( 14 ).and( phase.lessThan( 26 ) ) ) );
				If( s.y.greaterThanEqual( meta.x.sub( JUNCTION ) ).and( green ), () => { s.w.assign( 0 ); } );

			} );
			const point = origin.xy.add( origin.zw.mul( s.y ) ).add( vec2( origin.w.negate(), origin.z ).mul( LANE ) ).toVar();
			const direction = origin.zw.toVar();
			If( s.w.greaterThanEqual( 0 ), () => {

				const t = s.w, v = float( 1 ).sub( t );
				point.assign( start.mul( v.mul( v ) ).add( control.mul( v.mul( t ).mul( 2 ) ) ).add( end.mul( t.mul( t ) ) ) );
				direction.assign( control.sub( start ).mul( v ).add( end.sub( control ).mul( t ) ) );

			} );
			state.element( i ).assign( s ); poses.element( i ).assign( vec4( point.x, point.y, atan( direction.x, direction.y ), float( i ) ) );

		} )().compute( MAX_CARS ).setName( 'Cars Road Simulation' );
		const draw = storage( this.drawArgs, 'uint', 10 ).toAtomic();
		this.reset = Fn( () => { atomicStore( draw.element( instanceIndex.mul( 5 ).add( 1 ) ), uint( 0 ) ); } )().compute( 2 ).setName( 'Cars Reset Draws' );
		this.cull = Fn( () => {

			const i = instanceIndex; If( i.greaterThanEqual( u.count ), () => Return() );
			const pose = poses.element( i ).toVar(), point = vec3( pose.x, .8, pose.y ), visible = float( 1 ).toVar();
			for ( const plane of u.planes ) visible.mulAssign( step( - 2.2, dot( plane.xyz, point ).add( plane.w ) ) );
			If( visible.greaterThan( .5 ), () => {

				const pixels = select( u.ortho.greaterThan( .5 ), u.pixels, u.pixels.div( max( length( point.sub( u.camera ) ), .5 ) ) ).mul( 3.6 );
				for ( let k = 0; k < 2; k ++ ) If( k === 0 ? pixels.greaterThan( 20 ) : pixels.lessThanEqual( 20 ), () => {

					const slot = atomicAdd( draw.element( k * 5 + 1 ), uint( 1 ) ).toVar();
					this.lists[ k ].element( slot ).assign( pose );

				} );

			} );

		} )().compute( MAX_CARS ).setName( 'Cars Cull + LOD' );

	}

	setCount( count ) {

		if ( count !== this.count ) this.needsInit = true;
		this.count = count; this.u.count.value = count;
		for ( const mesh of this.meshes ) mesh.visible = count > 0;

	}

	update( dt, time, camera ) {

		if ( ! this.count || ! camera ) return;
		const u = this.u; u.dt.value = Math.max( 0, Math.min( dt, .1 ) ); u.time.value = time; u.frame.value ++;
		this.frustum.setFromProjectionMatrix( this.projection.multiplyMatrices( camera.projectionMatrix, camera.matrixWorldInverse ), THREE.WebGPUCoordinateSystem );
		this.frustum.planes.forEach( ( p, k ) => u.planes[ k ].value.set( p.normal.x, p.normal.y, p.normal.z, p.constant ) );
		camera.getWorldPosition( u.camera.value ); u.ortho.value = camera.isOrthographicCamera ? 1 : 0;
		const height = this.renderer.domElement.height;
		u.pixels.value = camera.isOrthographicCamera ? height / ( ( camera.top - camera.bottom ) / camera.zoom ) : height / ( 2 * Math.tan( THREE.MathUtils.degToRad( camera.fov ) / 2 ) );
		const computes = []; this.uploaded = true;
		if ( this.needsInit ) { this.init.count = this.count; computes.push( this.init ); }
		this.simulate.count = this.cull.count = this.count;
		computes.push( this.simulate, this.reset, this.cull ); this.renderer.compute( computes ); this.needsInit = false;
		if ( ++ this.frame % 30 === 0 && ! this.reading ) this.readback();

	}

	async readback() {

		this.reading = true;
		try {

			const data = new Uint32Array( await this.renderer.getArrayBufferAsync( this.drawArgs ) );
			if ( ! this.disposed ) this.visibleCounts = [ data[ 1 ], data[ 6 ] ];
			return this.visibleCounts;

		} catch { return this.visibleCounts; } finally { this.reading = false; }

	}

	get triangles() { return this.visibleCounts.reduce( ( total, n, k ) => total + n * this.meshes[ k ].geometry.userData.triangles, 0 ); }
	get bytes() { return this.uploaded ? MAX_CARS * 16 * 4 + this.network.data.byteLength + 40 : 0; }

	dispose() {

		this.disposed = true;
		for ( const attribute of [ this.roads.value, this.state.value, this.poses.value, ...this.lists.map( ( list ) => list.value ), this.drawArgs ] ) {

			try { this.renderer._attributes?.delete( attribute ); } catch { /* not uploaded */ }

		}

	}

}
