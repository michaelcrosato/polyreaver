// A tiny CPU particle kit for mechanic feedback (explosions, shards, warps, slams):
// three instanced draws (shards, ground rings, light flashes) with fixed capacity,
// updated in place every frame. The combat feature owns skill VFX; this one only
// makes level mechanics READ: you should see why a pack just died.
//
//   fx.burst( { x, y, z, color, count, speed, life, size, up, gravity } )
//   fx.ring( { x, z, color, radius, life, width } )     expanding ground ring
//   fx.flash( { x, y, z, color, intensity, range, life } )  short-lived point light (pooled)

import * as THREE from 'three/webgpu';
import { attribute, vec3, float, uv, length, smoothstep, mix } from 'three/tsl';

const MAX_P = 1500, MAX_R = 96;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler(), _c = new THREE.Color();

export class MechFX {

	constructor( scene ) {

		// shards: tetrahedra with velocity and spin
		const pm = new THREE.MeshStandardNodeMaterial( { roughness: 0.5 } );
		pm.colorNode = attribute( 'aCol', 'vec3' );
		pm.emissiveNode = attribute( 'aCol', 'vec3' ).mul( attribute( 'aEm', 'float' ) );
		const pg = new THREE.TetrahedronGeometry( 0.5 );
		this.pCol = new THREE.InstancedBufferAttribute( new Float32Array( MAX_P * 3 ), 3 ).setUsage( THREE.DynamicDrawUsage );
		this.pEm = new THREE.InstancedBufferAttribute( new Float32Array( MAX_P ), 1 ).setUsage( THREE.DynamicDrawUsage );
		pg.setAttribute( 'aCol', this.pCol );
		pg.setAttribute( 'aEm', this.pEm );
		this.parts = new THREE.InstancedMesh( pg, pm, MAX_P );
		this.parts.count = 0;
		this.parts.frustumCulled = false;
		this.p = [];

		// rings: flat annuli on the ground, additive
		const rm = new THREE.MeshBasicNodeMaterial( { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending } );
		const r = length( uv().sub( 0.5 ) ).mul( 2 );
		const w = attribute( 'aRing', 'vec2' ); // ( alpha, inner edge )
		rm.colorNode = vec3( attribute( 'aRCol', 'vec3' ) ).mul( smoothstep( w.y, mix( w.y, float( 1 ), 0.5 ), r ).mul( float( 1 ).sub( smoothstep( 0.92, 1, r ) ) ) ).mul( w.x );
		rm.fog = false;
		const rg = new THREE.PlaneGeometry( 1, 1 ).rotateX( - Math.PI / 2 );
		this.rCol = new THREE.InstancedBufferAttribute( new Float32Array( MAX_R * 3 ), 3 ).setUsage( THREE.DynamicDrawUsage );
		this.rW = new THREE.InstancedBufferAttribute( new Float32Array( MAX_R * 2 ), 2 ).setUsage( THREE.DynamicDrawUsage );
		rg.setAttribute( 'aRCol', this.rCol );
		rg.setAttribute( 'aRing', this.rW );
		this.rings = new THREE.InstancedMesh( rg, rm, MAX_R );
		this.rings.count = 0;
		this.rings.frustumCulled = false;
		this.rings.renderOrder = 4;
		this.r = [];
		this.f = [];
		scene.add( this.parts, this.rings );

	}

	clear() {

		this.p.length = 0; this.r.length = 0; this.f.length = 0;

	}

	burst( { x, y = 0.8, z, color = '#ffffff', count = 12, speed = 6, life = 0.8, size = 0.3, up = 4, gravity = 14, emissive = 1 } ) {

		_c.set( color );
		for ( let i = 0; i < count && this.p.length < MAX_P; i ++ ) {

			const a = Math.random() * Math.PI * 2, s = speed * ( 0.4 + Math.random() * 0.8 );
			this.p.push( {
				x, y, z, vx: Math.cos( a ) * s, vz: Math.sin( a ) * s, vy: up * ( 0.5 + Math.random() ), g: gravity,
				life: life * ( 0.6 + Math.random() * 0.6 ), age: 0, size: size * ( 0.6 + Math.random() * 0.8 ), r: _c.r, gg: _c.g, b: _c.b, em: emissive,
				rx: Math.random() * 6, ry: Math.random() * 6, spin: ( Math.random() - 0.5 ) * 20
			} );

		}

	}

	ring( { x, z, color = '#ffffff', radius = 3, life = 0.5, width = 0.75, y = 0.06 } ) {

		if ( this.r.length >= MAX_R ) this.r.shift();
		_c.set( color );
		this.r.push( { x, z, y, radius, life, age: 0, width, r: _c.r, g: _c.g, b: _c.b } );

	}

	flash( { x, y = 1.5, z, color = '#ffffff', intensity = 60, range = 10, life = 0.3 } ) {

		this.f.push( { x, y, z, color: new THREE.Color( color ), intensity, range, life, age: 0 } );

	}

	update( dt, dynLights ) {

		let n = 0;
		for ( const q of this.p ) {

			q.age += dt;
			if ( q.age >= q.life ) continue;
			q.vy -= q.g * dt;
			q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
			if ( q.y < 0.05 ) {

				q.y = 0.05; q.vy *= - 0.3; q.vx *= 0.6; q.vz *= 0.6;

			}

			q.rx += q.spin * dt;
			const k = 1 - q.age / q.life;
			_e.set( q.rx, q.ry + q.rx * 0.5, 0 );
			this.parts.setMatrixAt( n, _m.compose( _p.set( q.x, q.y, q.z ), _q.setFromEuler( _e ), _s.setScalar( q.size * ( 0.3 + 0.7 * k ) ) ) );
			this.pCol.setXYZ( n, q.r, q.gg, q.b );
			this.pEm.setX( n, q.em * k );
			n ++;

		}

		this.p = this.p.filter( ( q ) => q.age < q.life );
		this.parts.count = n;
		if ( n ) {

			this.parts.instanceMatrix.needsUpdate = true;
			this.pCol.needsUpdate = this.pEm.needsUpdate = true;

		}

		let m = 0;
		for ( const r of this.r ) {

			r.age += dt;
			if ( r.age >= r.life ) continue;
			const t = r.age / r.life;
			const rad = r.radius * ( 0.35 + 0.65 * Math.sqrt( t ) ) * 2;
			this.rings.setMatrixAt( m, _m.compose( _p.set( r.x, r.y, r.z ), _q.identity(), _s.set( rad, 1, rad ) ) );
			this.rCol.setXYZ( m, r.r, r.g, r.b );
			this.rW.setXY( m, ( 1 - t ) * 1.6, 1 - r.width );
			m ++;

		}

		this.r = this.r.filter( ( r ) => r.age < r.life );
		this.rings.count = m;
		if ( m ) {

			this.rings.instanceMatrix.needsUpdate = true;
			this.rCol.needsUpdate = this.rW.needsUpdate = true;

		}

		for ( const f of this.f ) {

			f.age += dt;
			const k = 1 - f.age / f.life;
			if ( k > 0 ) dynLights.push( { x: f.x, y: f.y, z: f.z, color: f.color, intensity: f.intensity * k, range: f.range } );

		}

		this.f = this.f.filter( ( f ) => f.age < f.life );

	}

}
