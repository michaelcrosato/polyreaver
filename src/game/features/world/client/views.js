// Mechanic views: how each level mechanic LOOKS. A view is built when a world
// starts (from the mechanic's sim state, world.state.mech[ id ].state) and updated
// every frame; most of the animation runs on the GPU from the same formulas the
// sim uses (spikes, tides), so the picture never disagrees with the rules.
//
//   VIEWS[ mechanicId ]( rc, world, ctx, root ) -> { update( rc, world, alpha, dt ), dispose() }
//
// Plus views that are not tied to one mechanic: swirling portal discs (rifts, the
// exit, the waypoint) and the echo's ghost shell.

import * as THREE from 'three/webgpu';
import {
	uniform, attribute, vec2, vec3, float, positionLocal, positionWorld, uv, mix, smoothstep, step, fract, sin, abs, length, atan,
	max, mx_noise_float, mx_worley_noise_float, texture
} from 'three/tsl';
import { U, lavaMaterial } from './materials.js';
import { bakeModel } from './bake.js';
import { SPIKE } from '../mechanics/spike-field.js';
import { beamState } from '../mechanics/conduits.js';
import { swarmView } from './swarm.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color(), _e = new THREE.Euler();
const UP = new THREE.Vector3( 0, 1, 0 );

export function buildViews( rc, world, root ) {

	const views = [];
	for ( const ctx of world.state.mechanics || [] ) {

		const make = VIEWS[ ctx.id ];
		if ( ! make ) continue;
		const v = make( rc, world, ctx, root );
		if ( v ) views.push( v );

	}

	views.push( swirlView( rc, world, root ), echoView( rc, world, root ) );
	return views.filter( Boolean );

}

// A sub-group that removes and disposes itself.
function holder( root, name ) {

	const g = new THREE.Group();
	g.name = name;
	root.add( g );
	g.userData.dispose = () => {

		root.remove( g );
		g.traverse( ( o ) => {

			o.geometry?.dispose();
			o.material?.dispose?.();

		} );

	};

	return g;

}

const additive = ( opts = {} ) => {

	const m = new THREE.MeshBasicNodeMaterial( { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, ...opts } );
	m.fog = false;
	return m;

};

const VIEWS = {

	// --- spikes: a cluster of blades per plate, raised on the GPU by the cycle formula ---------
	'spike-field'( rc, world, ctx ) {

		const st = ctx.state, L = world.layout, n = st.tiles.length;
		if ( ! n ) return null;
		const g = holder( rc.scene, 'spikes' );
		const period = uniform( st.period );
		const off = new Float32Array( n );
		const spikes = bakeModel( SPIKES, null, 'spikes' );
		const sGeo = new THREE.BufferGeometry();
		for ( const k in spikes.attributes ) sGeo.setAttribute( k, spikes.attributes[ k ] );
		sGeo.setAttribute( 'aOff', new THREE.InstancedBufferAttribute( off, 1 ) );
		const plateGeo = new THREE.BoxGeometry( L.cell * 0.94, 0.05, L.cell * 0.94 );
		plateGeo.setAttribute( 'aOff', new THREE.InstancedBufferAttribute( off, 1 ) );
		const phase = () => fract( U.time.add( attribute( 'aOff', 'float' ) ).div( period ) );

		const sm = new THREE.MeshStandardNodeMaterial( { roughness: 0.35, metalness: 0.7 } );
		const p = phase();
		const up = smoothstep( SPIKE.UP - 0.025, SPIKE.UP, p ).mul( float( 1 ).sub( smoothstep( SPIKE.DOWN, SPIKE.DOWN + 0.05, p ) ) );
		const rattle = step( SPIKE.RATTLE, p ).mul( step( p, SPIKE.UP ) );
		const lift = mix( float( - 1.05 ), float( 0 ), up ).add( rattle.mul( float( 0.18 ).add( sin( U.time.mul( 70 ) ).mul( 0.04 ) ) ) );
		sm.positionNode = positionLocal.add( vec3( 0, lift, 0 ) );
		sm.colorNode = attribute( 'color', 'vec3' );
		sm.emissiveNode = vec3( 0.9, 0.15, 0.05 ).mul( up.mul( 0.25 ) );

		const pm = new THREE.MeshStandardNodeMaterial( { roughness: 0.5, metalness: 0.6 } );
		const pp = phase();
		const warn = step( SPIKE.RATTLE, pp ).mul( step( pp, SPIKE.DOWN ) );
		const P = positionWorld.xz.sub( U.origin ).div( U.cell );
		const holes = float( 1 ).sub( smoothstep( 0.06, 0.1, length( fract( P.mul( 3 ) ).sub( 0.5 ) ) ) );
		pm.colorNode = vec3( 0.2, 0.2, 0.22 ).mul( float( 1 ).sub( holes.mul( 0.8 ) ) );
		pm.emissiveNode = vec3( 1, 0.2, 0.05 ).mul( warn.mul( holes ).mul( sin( U.time.mul( 30 ) ).mul( 0.3 ).add( 0.7 ) ) );

		const sMesh = new THREE.InstancedMesh( sGeo, sm, n ), pMesh = new THREE.InstancedMesh( plateGeo, pm, n );
		st.tiles.forEach( ( k, i ) => {

			const [ x, z ] = L.toWorld( k % L.w, ( k / L.w ) | 0 );
			const y = L.elev?.[ k ] === - 1 ? - 0.16 : 0;
			off[ i ] = st.offset[ k ];
			_m.compose( _p.set( x, y, z ), _q.setFromAxisAngle( UP, ( k % 4 ) * Math.PI / 2 ), _s.set( 1, 1, 1 ) );
			sMesh.setMatrixAt( i, _m );
			pMesh.setMatrixAt( i, _m.makeTranslation( x, y + 0.012, z ) );

		} );
		sMesh.castShadow = true;
		pMesh.receiveShadow = true;
		sMesh.frustumCulled = pMesh.frustumCulled = false;
		g.add( sMesh, pMesh );
		return { dispose: g.userData.dispose };

	},

	// --- conduit beams: crossed ribbons with a wandering lightning core ----------------------------
	conduits( rc, world, ctx ) {

		const st = ctx.state, n = st.beams.length;
		if ( ! n ) return null;
		const g = holder( rc.scene, 'beams' );
		const a = new THREE.PlaneGeometry( 0.9, 1 ).rotateX( - Math.PI / 2 ).translate( 0, 0, 0.5 );
		const b = a.clone().rotateZ( Math.PI / 2 );
		const geo = new THREE.BufferGeometry();
		const merged = [ a, b ];
		const pos = [], uvs = [], idx = [];
		let base = 0;
		for ( const m of merged ) {

			pos.push( ...m.attributes.position.array );
			uvs.push( ...m.attributes.uv.array );
			idx.push( ...Array.from( m.index.array, ( i ) => i + base ) );
			base += m.attributes.position.count;

		}

		geo.setAttribute( 'position', new THREE.Float32BufferAttribute( pos, 3 ) );
		geo.setAttribute( 'uv', new THREE.Float32BufferAttribute( uvs, 2 ) );
		geo.setIndex( idx );
		const state = new THREE.InstancedBufferAttribute( new Float32Array( n * 2 ), 2 ).setUsage( THREE.DynamicDrawUsage );
		geo.setAttribute( 'aBeam', state );
		const mat = additive();
		const s = attribute( 'aBeam', 'vec2' ); // ( intensity, length )
		const along = uv().y.mul( s.y );
		const wiggle = mx_noise_float( vec3( along.mul( 1.3 ), U.time.mul( 18 ), 0 ) ).mul( 0.22 ).add( mx_noise_float( vec3( along.mul( 4 ), U.time.mul( 31 ), 4 ) ).mul( 0.08 ) );
		const d = abs( uv().x.sub( 0.5 ).sub( wiggle ) );
		const core = float( 1 ).sub( smoothstep( 0.0, 0.05, d ) ), glow = float( 1 ).sub( smoothstep( 0.0, 0.42, d ) ).mul( 0.35 );
		mat.colorNode = vec3( 0.55, 0.85, 1 ).mul( core.mul( 2.2 ).add( glow ) ).mul( s.x );
		const mesh = new THREE.InstancedMesh( geo, mat, n );
		mesh.frustumCulled = false;
		g.add( mesh );
		return {
			dispose: g.userData.dispose,
			update( rc2, w ) {

				let lights = 0;
				st.beams.forEach( ( beam, i ) => {

					const ax = beam.a.x, az = beam.a.z, bx = beam.b.x, bz = beam.b.z;
					const len = Math.hypot( bx - ax, bz - az );
					const net = st.nets[ beam.net ];
					const warn = net && beamState( w.time, net.offset, st.period ) === 'warn';
					const k = beam.on ? ( beam.surging ? 1.8 : 1 ) : warn ? ( Math.sin( w.time * 40 ) > 0.3 ? 0.35 : 0 ) : 0;
					mesh.setMatrixAt( i, _m.compose( _p.set( ax, 2.75, az ), _q.setFromAxisAngle( UP, Math.atan2( bx - ax, bz - az ) ), _s.set( 1, 1, len ) ) );
					state.setXY( i, k, len );
					if ( beam.on && lights < 4 ) {

						rc2.dynLights.push( { x: ( ax + bx ) / 2, y: 2.4, z: ( az + bz ) / 2, color: '#8ad8ff', intensity: 26, range: 8, flicker: 0.5 } );
						lights ++;

					}

				} );
				mesh.instanceMatrix.needsUpdate = true;
				state.needsUpdate = true;

			}
		};

	},

	// --- magma: lava sheets over the basins, risen by the tide level ---------------------------
	'magma-tide'( rc, world, ctx ) {

		const st = ctx.state, L = world.layout;
		const tiles = [];
		for ( let i = 0; i < st.basin.length; i ++ ) if ( st.basin[ i ] ) tiles.push( i );
		if ( ! tiles.length ) return null;
		const g = holder( rc.scene, 'magma' );
		const level = uniform( 0 ), heat = uniform( 0 );
		const plane = new THREE.PlaneGeometry( L.cell, L.cell ).rotateX( - Math.PI / 2 );
		const lava = lavaMaterial( rc.theme?.liquid?.lava ?? '#ff4a08' );
		lava.positionNode = positionLocal.add( vec3( 0, mix( float( - 0.5 ), float( - 0.04 ), level ), 0 ) );
		const crack = additive( { side: THREE.FrontSide } );
		const w = mx_worley_noise_float( vec3( positionWorld.x.mul( 0.9 ), 0, positionWorld.z.mul( 0.9 ) ) );
		crack.colorNode = vec3( 1, 0.3, 0.05 ).mul( float( 1 ).sub( smoothstep( 0.03, 0.1, w ) ) ).mul( heat );
		const lavaMesh = new THREE.InstancedMesh( plane, lava, tiles.length ), crackMesh = new THREE.InstancedMesh( plane, crack, tiles.length );
		tiles.forEach( ( k, i ) => {

			const [ x, z ] = L.toWorld( k % L.w, ( k / L.w ) | 0 );
			lavaMesh.setMatrixAt( i, _m.makeTranslation( x, 0, z ) );
			crackMesh.setMatrixAt( i, _m.makeTranslation( x, - 0.15, z ) );

		} );
		lavaMesh.frustumCulled = crackMesh.frustumCulled = false;
		g.add( lavaMesh, crackMesh );
		return {
			dispose: g.userData.dispose,
			update( rc2, wld ) {

				level.value = st.level;
				const pulse = 0.5 + 0.5 * Math.sin( wld.time * 7 );
				heat.value = st.stage === 'warn' ? 0.5 + pulse * 0.9 : st.stage === 'calm' ? 0.12 : 0.3;
				if ( st.level > 0.3 && wld.player ) {

					// the flood lights the room around you
					rc2.dynLights.push( { x: wld.player.x + 3, y: 1.5, z: wld.player.z - 2, color: '#ff5a10', intensity: 22 * st.level, range: 16 } );

				}

			}
		};

	},

	// --- gravity wells: debris spiralling in, a rim ring that brightens during the pull ----------
	'gravity-wells'( rc, world, ctx ) {

		const wells = ctx.state.wells;
		if ( ! wells.length ) return null;
		const g = holder( rc.scene, 'wells' );
		const PER = 22, n = wells.length * PER;
		const dm = new THREE.MeshStandardNodeMaterial( { roughness: 0.6 } );
		dm.colorNode = vec3( 0.35, 0.3, 0.45 );
		dm.emissiveNode = vec3( 0.5, 0.3, 1 ).mul( 0.4 );
		const debris = new THREE.InstancedMesh( new THREE.OctahedronGeometry( 0.18 ), dm, n );
		const rim = additive( { side: THREE.FrontSide } );
		const r = length( uv().sub( 0.5 ) ).mul( 2 );
		const k = attribute( 'aRim', 'float' );
		rim.colorNode = vec3( 0.55, 0.35, 1 ).mul( smoothstep( 0.9, 0.97, r ).mul( float( 1 ).sub( smoothstep( 0.97, 1, r ) ) ).add( float( 1 ).sub( r ).mul( 0.08 ) ) ).mul( k );
		const rimGeo = new THREE.PlaneGeometry( 1, 1 ).rotateX( - Math.PI / 2 );
		const rimK = new THREE.InstancedBufferAttribute( new Float32Array( wells.length ), 1 ).setUsage( THREE.DynamicDrawUsage );
		rimGeo.setAttribute( 'aRim', rimK );
		const rims = new THREE.InstancedMesh( rimGeo, rim, wells.length );
		debris.frustumCulled = rims.frustumCulled = false;
		g.add( debris, rims );
		return {
			dispose: g.userData.dispose,
			update( rc2, w ) {

				let i = 0;
				wells.forEach( ( well, wi ) => {

					const pull = well.data.stage === 'pull';
					const R = well.data.radius;
					rims.setMatrixAt( wi, _m.compose( _p.set( well.x, 0.05, well.z ), _q.identity(), _s.set( R * 2, 1, R * 2 ) ) );
					rimK.setX( wi, pull ? 1.4 : 0.35 );
					for ( let k2 = 0; k2 < PER; k2 ++ ) {

						const seed = k2 * 1.618 + wi;
						const speed = pull ? 2.6 : 0.6;
						const t = ( w.time * speed * 0.15 + seed ) % 1;
						const rad = pull ? R * ( 1 - t ) : 1.2 + ( seed % 1 ) * 1.6;
						const ang = seed * 2.4 + w.time * ( pull ? 3 + 6 * ( 1 - rad / R ) : 0.8 );
						const y = pull ? 0.4 + ( 1 - rad / R ) * 1.2 : 1.5 + Math.sin( w.time * 2 + seed ) * 0.4;
						_e.set( w.time * 2 + seed, seed, 0 );
						debris.setMatrixAt( i ++, _m.compose( _p.set( well.x + Math.cos( ang ) * rad, y, well.z + Math.sin( ang ) * rad ), _q.setFromEuler( _e ), _s.setScalar( 0.6 + ( seed * 7 % 1 ) ) ) );

					}

				} );
				debris.instanceMatrix.needsUpdate = rims.instanceMatrix.needsUpdate = true;
				rimK.needsUpdate = true;

			}
		};

	},

	// --- chrono fields: clock faces on the floor, blue (slow) / gold (haste), ticking hand ----------
	'chrono-fields'( rc, world, ctx ) {

		const fields = ctx.state.fields;
		if ( ! fields.length ) return null;
		const g = holder( rc.scene, 'chrono' );
		const geo = new THREE.PlaneGeometry( 2, 2 ).rotateX( - Math.PI / 2 );
		const dial = new THREE.InstancedBufferAttribute( new Float32Array( fields.length * 4 ), 4 ).setUsage( THREE.DynamicDrawUsage );
		geo.setAttribute( 'aDial', dial );
		const mat = additive( { side: THREE.FrontSide } );
		const D = attribute( 'aDial', 'vec4' ); // ( slow, hand 0..1, warn, - )
		const q = uv().sub( 0.5 ).mul( 2 );
		const r = length( q );
		const ang = atan( q.x, q.y.negate() ); // 0 at "12 o'clock", clockwise
		const turn = fract( ang.div( Math.PI * 2 ).add( 1 ) );
		const rimLine = smoothstep( 0.9, 0.95, r ).mul( float( 1 ).sub( smoothstep( 0.97, 1, r ) ) );
		const ticks = step( 0.78, r ).mul( step( r, 0.9 ) ).mul( step( 0.96, abs( sin( turn.mul( Math.PI * 12 ) ) ) ) );
		const handTurn = fract( turn.sub( D.y ).add( 0.5 ) ).sub( 0.5 );
		const hand = step( abs( handTurn ), float( 0.012 ).div( max( r, 0.05 ) ) ).mul( step( r, 0.85 ) );
		const fill = float( 1 ).sub( r ).mul( 0.12 ).mul( step( r, 1 ) );
		const tint = mix( vec3( 1, 0.72, 0.2 ), vec3( 0.25, 0.6, 1 ), D.x );
		const flash = D.z.mul( step( 0.5, fract( U.time.mul( 4 ) ) ) ).mul( 0.6 ).add( 1 );
		mat.colorNode = tint.mul( rimLine.add( ticks.mul( 0.8 ) ).add( hand.mul( 1.4 ) ).add( fill ) ).mul( flash ).mul( step( r, 1 ) );
		const mesh = new THREE.InstancedMesh( geo, mat, fields.length );
		fields.forEach( ( f, i ) => mesh.setMatrixAt( i, _m.compose( _p.set( f.x, 0.05, f.z ), _q.identity(), _s.set( f.r, 1, f.r ) ) ) );
		mesh.frustumCulled = false;
		g.add( mesh );
		return {
			dispose: g.userData.dispose,
			update() {

				fields.forEach( ( f, i ) => dial.setXYZW( i, f.isSlow ? 1 : 0, f.hand ?? 0, f.warn ? 1 : 0, 0 ) );
				dial.needsUpdate = true;

			}
		};

	},

	// --- miasma: the density field uploaded as a texture, drawn as two drifting fog layers -------
	miasma( rc, world, ctx ) {

		const st = ctx.state, L = world.layout;
		const g = holder( rc.scene, 'miasma' );
		const data = new Uint8Array( L.w * L.h * 4 );
		const tex = new THREE.DataTexture( data, L.w, L.h, THREE.RGBAFormat, THREE.UnsignedByteType );
		tex.magFilter = tex.minFilter = THREE.LinearFilter;
		tex.needsUpdate = true;
		const layer = ( y, speed, alpha ) => {

			const m = new THREE.MeshBasicNodeMaterial( { transparent: true, depthWrite: false } );
			const P = positionWorld;
			const tuv = P.xz.sub( U.origin ).div( vec2( L.w * L.cell, L.h * L.cell ) );
			const dens = texture( tex, tuv ).r;
			const n = mx_noise_float( vec3( P.x.mul( 0.22 ).add( U.time.mul( speed ) ), P.z.mul( 0.22 ), U.time.mul( 0.07 ) ) ).mul( 0.5 ).add( 0.5 );
			const a = smoothstep( 0.12, 0.6, dens ).mul( n.mul( 0.6 ).add( 0.4 ) ).mul( alpha );
			m.colorNode = mix( vec3( 0.05, 0.1, 0.02 ), vec3( 0.22, 0.45, 0.07 ), n );
			m.opacityNode = a;
			m.fog = false;
			const mesh = new THREE.Mesh( new THREE.PlaneGeometry( L.w * L.cell, L.h * L.cell ).rotateX( - Math.PI / 2 ), m );
			mesh.position.set( L.ox + L.w * L.cell / 2, y, L.oz + L.h * L.cell / 2 );
			mesh.renderOrder = 6;
			return mesh;

		};

		g.add( layer( 0.5, 0.05, 0.42 ), layer( 1.4, - 0.03, 0.26 ) );
		let version = - 1, timer = 0;
		return {
			dispose: () => {

				g.userData.dispose();
				tex.dispose();

			},
			update( rc2, w, alpha, dt ) {

				timer -= dt;
				if ( st.version === version || timer > 0 ) return;
				timer = 0.15;
				version = st.version;
				const d = st.density;
				for ( let i = 0; i < d.length; i ++ ) data[ i * 4 ] = Math.min( 255, d[ i ] * 255 );
				tex.needsUpdate = true;

			}
		};

	},

	swarm: swarmView
};

// The spike cluster for one plate (five blades), authored for a 2 m tile.
const SPIKES = { id: 'spike-cluster', parts: [
	{ shape: 'spike', pos: [ 0, 0.45, 0 ], scale: [ 0.26, 0.9, 0.26 ], color: '#c4c8d2' },
	{ shape: 'spike', pos: [ 0.5, 0.4, 0.5 ], scale: [ 0.22, 0.8, 0.22 ], color: '#b4b8c2' }, { shape: 'spike', pos: [ - 0.5, 0.4, 0.5 ], scale: [ 0.22, 0.8, 0.22 ], color: '#b4b8c2' },
	{ shape: 'spike', pos: [ 0.5, 0.4, - 0.5 ], scale: [ 0.22, 0.8, 0.22 ], color: '#b4b8c2' }, { shape: 'spike', pos: [ - 0.5, 0.4, - 0.5 ], scale: [ 0.22, 0.8, 0.22 ], color: '#b4b8c2' }
] };

// --- swirling discs: rift gates (pair colour), the exit portal, the town waypoint -----------------
function swirlView( rc, world, root ) {

	const g = holder( rc.scene, 'swirls' );
	const MAX = 32;
	const geo = new THREE.CircleGeometry( 1, 40 );
	const col = new THREE.InstancedBufferAttribute( new Float32Array( MAX * 3 ), 3 ).setUsage( THREE.DynamicDrawUsage );
	geo.setAttribute( 'aCol', col );
	const mat = additive( { side: THREE.DoubleSide } );
	const q = uv().sub( 0.5 ).mul( 2 );
	const r = length( q );
	const a = atan( q.y, q.x );
	const swirl = sin( a.mul( 3 ).add( r.mul( 9 ) ).sub( U.time.mul( 4 ) ) ).mul( 0.5 ).add( 0.5 );
	const core = float( 1 ).sub( r ).mul( 0.6 );
	mat.colorNode = vec3( attribute( 'aCol', 'vec3' ) ).mul( swirl.mul( 0.8 ).add( core ) ).mul( float( 1 ).sub( smoothstep( 0.85, 1, r ) ) );
	const mesh = new THREE.InstancedMesh( geo, mat, MAX );
	mesh.frustumCulled = false;
	mesh.count = 0;
	g.add( mesh );
	const SPEC = { rift: { y: 1.3, s: 1.05 }, portal: { y: 1.5, s: 1.25 }, waypoint: { y: 2.4, s: 1.1 } };
	return {
		dispose: g.userData.dispose,
		update( rc2, w ) {

			let n = 0;
			for ( const e of w.entities ) {

				const sp = SPEC[ e.model?.id ];
				if ( ! sp || e.model.type !== 'mech' || n >= MAX ) continue;
				const flat = e.model.id === 'waypoint';
				_e.set( flat ? - Math.PI / 2 : 0, 0, 0 );
				mesh.setMatrixAt( n, _m.compose( _p.set( e.x, sp.y, e.z ), _q.setFromEuler( _e ), _s.setScalar( sp.s ) ) );
				_c.set( e.data.color || ( e.model.id === 'portal' ? '#7ad0ff' : '#5a9aff' ) );
				col.setXYZ( n, _c.r, _c.g, _c.b );
				n ++;

			}

			mesh.count = n;
			mesh.instanceMatrix.needsUpdate = true;
			col.needsUpdate = true;

		}
	};

}

// --- echoes: a cyan ghost shell and a ground ring around every echo ------------------------------
function echoView( rc, world, root ) {

	const echoes = world.entities.filter( ( e ) => e.kind === 'echo' );
	if ( ! echoes.length ) return null;
	const g = holder( rc.scene, 'echo-shells' );
	const mat = additive( { side: THREE.FrontSide } );
	const fres = float( 1 ).sub( abs( uv().x.sub( 0.5 ) ).mul( 2 ) );
	mat.colorNode = vec3( 0.3, 0.85, 1 ).mul( fres.mul( 0.25 ).add( sin( positionWorld.y.mul( 14 ).sub( U.time.mul( 6 ) ) ).mul( 0.5 ).add( 0.5 ).mul( 0.12 ) ) );
	const shells = new THREE.InstancedMesh( new THREE.CapsuleGeometry( 0.48, 1.1, 4, 12 ), mat, echoes.length );
	const ringMat = additive( { side: THREE.FrontSide } );
	const rr = length( uv().sub( 0.5 ) ).mul( 2 );
	ringMat.colorNode = vec3( 0.3, 0.9, 1 ).mul( smoothstep( 0.7, 0.9, rr ).mul( float( 1 ).sub( smoothstep( 0.92, 1, rr ) ) ) ).mul( 0.9 );
	const rings = new THREE.InstancedMesh( new THREE.PlaneGeometry( 1.6, 1.6 ).rotateX( - Math.PI / 2 ), ringMat, echoes.length );
	shells.frustumCulled = rings.frustumCulled = false;
	g.add( shells, rings );
	const l = { x: 0, y: 0, z: 0, facing: 0 };
	return {
		dispose: g.userData.dispose,
		update( rc2 ) {

			echoes.forEach( ( e, i ) => {

				rc2.lerp( e, l );
				shells.setMatrixAt( i, _m.makeTranslation( l.x, l.y + 0.95, l.z ) );
				rings.setMatrixAt( i, _m.makeTranslation( l.x, 0.06, l.z ) );

			} );
			shells.instanceMatrix.needsUpdate = rings.instanceMatrix.needsUpdate = true;

		}
	};

}
