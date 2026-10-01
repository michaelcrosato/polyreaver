// GPU particles: sparks, embers, frost motes, debris, smoke-free magic dust - every
// short-lived speck of combat VFX - simulated by TSL compute shaders and drawn in
// ONE instanced sprite draw. The CPU only describes NEW particles:
//
//   emit()/burst() write 4 vec4s per particle into a STAGING ring (Float32Array)
//   update():  1. upload only the written part of the staging buffer (updateRanges)
//              2. SPAWN kernel: thread i copies staging[i] into ring slot (cursor + i)
//              3. UPDATE kernel: every live particle integrates gravity, drag and a
//                 bouncy ground plane, and ages; dead ones (life <= 0) draw at size 0
//
// Lives are capped at MAX_LIFE, so only the slots written during the last MAX_LIFE
// seconds of particle time can still be alive: the update kernel is dispatched over
// that window of the ring only (zero threads when nothing is burning).
//
// The particle state never comes back to the CPU, so 30k particles cost the same
// CPU time as 30. Storage buffers: spawn kernel 5, update kernel 3, the sprite
// material reads the buffers as instanced vertex attributes (toAttribute()), which
// keeps it under the 8-storage-buffers-per-stage phone limit with room to spare.
//
// Per-particle layout (vec4 each):
//   pos  xyz position, w life left (s)        vel  xyz velocity, w drag (1/s)
//   col  rgb colour (HDR, additive), w size   ext  x max life, y gravity, z hardness 0..1, w streak

import * as THREE from 'three/webgpu';
import { Fn, If, Return, instancedArray, instanceIndex, uniform, uint, float, vec2, vec4, uv, length, smoothstep, exp, abs, atan, max, mix, select, cameraViewMatrix } from 'three/tsl';

const MAX_SPAWN = 4096; // new particles per frame
const MAX_LIFE = 2.5; // seconds

export class Particles {

	constructor( renderer, scene, capacity = 32768 ) {

		this.renderer = renderer;
		this.cap = capacity;
		this.cursor = 0;
		this.count = 0;
		this.budget = 1; // emission scale (lower on phones)

		this.pos = instancedArray( capacity, 'vec4' ).setName( 'fxPos' );
		this.vel = instancedArray( capacity, 'vec4' ).setName( 'fxVel' );
		this.col = instancedArray( capacity, 'vec4' ).setName( 'fxCol' );
		this.ext = instancedArray( capacity, 'vec4' ).setName( 'fxExt' );
		this.staging = instancedArray( MAX_SPAWN * 4, 'vec4' ).setName( 'fxSpawn' );
		this.stage = this.staging.value.array;
		this.uDt = uniform( 0 );
		this.uCount = uniform( 0, 'uint' );
		this.uCursor = uniform( 0, 'uint' );
		this.uStart = uniform( 0, 'uint' ); // first ring slot of the live window
		this.uSpan = uniform( 0, 'uint' );
		this.clock = 0; // particle time (slows down with hitstop)
		this.batches = []; // { clock, count } spawned per frame, for the live window

		const { pos, vel, col, ext, staging } = this;
		this.spawnNode = Fn( () => {

			const i = instanceIndex;
			If( i.lessThan( this.uCount ), () => {

				const j = i.add( this.uCursor ).mod( uint( capacity ) );
				const b = i.mul( 4 );
				pos.element( j ).assign( staging.element( b ) );
				vel.element( j ).assign( staging.element( b.add( 1 ) ) );
				col.element( j ).assign( staging.element( b.add( 2 ) ) );
				ext.element( j ).assign( staging.element( b.add( 3 ) ) );

			} );

		} )().compute( MAX_SPAWN ).setName( 'FX Spawn' );

		this.updateNode = Fn( () => {

			If( instanceIndex.greaterThanEqual( this.uSpan ), () => {

				Return();

			} );
			const j = instanceIndex.add( this.uStart ).mod( uint( capacity ) );
			const p = pos.element( j );
			If( p.w.greaterThan( 0 ), () => {

				const v = vel.element( j );
				const x = ext.element( j );
				const dt = this.uDt;
				const nv = v.xyz.toVar();
				nv.y.subAssign( x.y.mul( dt ) );
				nv.mulAssign( exp( v.w.negate().mul( dt ) ) ); // exponential drag
				const np = p.xyz.add( nv.mul( dt ) ).toVar();
				If( np.y.lessThan( 0.03 ).and( x.y.greaterThan( 0 ) ), () => {

					// falling particles bounce once or twice and skid to a stop
					np.y.assign( 0.03 );
					nv.y.assign( abs( nv.y ).mul( 0.3 ) );
					nv.x.mulAssign( 0.6 );
					nv.z.mulAssign( 0.6 );

				} );
				v.assign( vec4( nv, v.w ) );
				p.assign( vec4( np, p.w.sub( dt ) ) );

			} );

		} )().compute( capacity ).setName( 'FX Update' );

		// --- the sprite ----------------------------------------------------------------
		const P = pos.toAttribute(), V = vel.toAttribute(), C = col.toAttribute(), X = ext.toAttribute();
		const k = P.w.div( max( X.x, 0.001 ) ).clamp( 0, 1 ); // 1 at birth -> 0 at death
		const alive = P.w.greaterThan( 0 );
		// streaks stretch along their on-screen velocity
		const vv = cameraViewMatrix.mul( vec4( V.xyz, 0 ) ).xy;
		const stretch = float( 1 ).add( length( vv ).mul( X.w ) ).min( 6 );
		const size = C.w.mul( mix( 0.35, 1, k ) ).mul( select( alive, 1, 0 ) );
		const mat = new THREE.SpriteNodeMaterial( { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending } );
		mat.positionNode = P.xyz;
		mat.scaleNode = vec2( size.mul( stretch ), size );
		mat.rotationNode = atan( vv.y, vv.x );
		const d = length( uv().sub( 0.5 ) ).mul( 2 );
		const shape = float( 1 ).sub( smoothstep( X.z.mul( 0.85 ), 1, d ) ); // hardness: soft glow .. crisp dot
		mat.colorNode = C.rgb;
		mat.opacityNode = shape.mul( smoothstep( 0, 0.3, k ) );
		mat.fog = true;
		this.sprite = new THREE.Sprite( mat );
		this.sprite.count = capacity;
		this.sprite.frustumCulled = false;
		this.sprite.renderOrder = 5;
		scene.add( this.sprite );

	}

	// One particle. Colour is linear RGB (HDR allowed: additive, tone-mapped later).
	emit( x, y, z, vx, vy, vz, r, g, b, size, life, gravity = 0, drag = 0, hard = 0, streak = 0 ) {

		if ( this.count >= MAX_SPAWN ) return;
		const a = this.stage, o = this.count * 16;
		a[ o ] = x; a[ o + 1 ] = y; a[ o + 2 ] = z; a[ o + 3 ] = life;
		a[ o + 4 ] = vx; a[ o + 5 ] = vy; a[ o + 6 ] = vz; a[ o + 7 ] = drag;
		a[ o + 8 ] = r; a[ o + 9 ] = g; a[ o + 10 ] = b; a[ o + 11 ] = size;
		a[ o + 12 ] = life; a[ o + 13 ] = gravity; a[ o + 14 ] = hard; a[ o + 15 ] = streak;
		if ( life > MAX_LIFE ) a[ o + 3 ] = a[ o + 12 ] = MAX_LIFE;
		this.count ++;

	}

	// A burst of n particles from (x, y, z):
	//   speed [min, max] m/s, up (vertical bias), dir/cone (radians) for directional sprays,
	//   radius (spawn disc), color (THREE.Color), hdr (brightness), color2 (lerp target),
	//   size [min, max], life [min, max], gravity, drag, hard, streak
	burst( x, y, z, n, o ) {

		n = Math.round( n * this.budget );
		const sp = o.speed ?? [ 2, 6 ], sz = o.size ?? [ 0.08, 0.16 ], lf = o.life ?? [ 0.3, 0.6 ];
		const c = o.color, c2 = o.color2 || c, hdr = o.hdr ?? 1;
		for ( let i = 0; i < n; i ++ ) {

			// direction: azimuth a, elevation el (radians above the ground plane)
			let a, el;
			if ( o.dir !== undefined ) {

				a = o.dir + ( Math.random() - 0.5 ) * ( o.cone ?? 1 );
				el = ( Math.random() - 0.3 ) * ( o.up ?? 0.6 );

			} else {

				a = Math.random() * Math.PI * 2;
				el = o.flat ? 0 : ( o.up ?? 0.5 ) * Math.random() * 1.3;

			}

			const s = sp[ 0 ] + Math.random() * ( sp[ 1 ] - sp[ 0 ] );
			const h = Math.cos( el );
			const vx = Math.sin( a ) * s * h, vz = Math.cos( a ) * s * h, vy = s * Math.sin( el ) + ( o.vy ?? 0 );
			const r = o.radius ? Math.sqrt( Math.random() ) * o.radius : 0, ra = Math.random() * Math.PI * 2;
			const t = Math.random();
			this.emit(
				x + Math.sin( ra ) * r, y + ( o.height ? Math.random() * o.height : 0 ), z + Math.cos( ra ) * r,
				vx, vy, vz,
				( c.r + ( c2.r - c.r ) * t ) * hdr, ( c.g + ( c2.g - c.g ) * t ) * hdr, ( c.b + ( c2.b - c.b ) * t ) * hdr,
				sz[ 0 ] + Math.random() * ( sz[ 1 ] - sz[ 0 ] ), lf[ 0 ] + Math.random() * ( lf[ 1 ] - lf[ 0 ] ),
				o.gravity ?? 0, o.drag ?? 1.5, o.hard ?? 0, o.streak ?? 0
			);

		}

	}

	update( dt ) {

		const r = this.renderer;
		if ( this.count > 0 ) {

			const attr = this.staging.value;
			attr.clearUpdateRanges();
			attr.addUpdateRange( 0, this.count * 16 );
			attr.needsUpdate = true;
			this.uCount.value = this.count;
			this.uCursor.value = this.cursor;
			r.compute( this.spawnNode, this.count );
			this.cursor = ( this.cursor + this.count ) % this.cap;
			this.batches.push( { clock: this.clock, count: this.count } );
			this.count = 0;

		}

		// the live window: everything spawned within the last MAX_LIFE of particle time
		this.clock += dt;
		while ( this.batches.length && this.clock - this.batches[ 0 ].clock > MAX_LIFE + 0.05 ) this.batches.shift();
		let span = 0;
		for ( const b of this.batches ) span += b.count;
		span = Math.min( this.cap, span );
		if ( span === 0 ) return;
		this.uSpan.value = span;
		this.uStart.value = ( this.cursor - span + this.cap ) % this.cap;
		this.uDt.value = dt;
		r.compute( this.updateNode, span );

	}

}
