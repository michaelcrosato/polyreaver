// Pooled dynamic point lights for spells and explosions - the dynamic lighting
// showcase with a HARD budget. A fixed number of PointLights is created once and
// never added or removed (changing the light count recompiles every lit material);
// each frame the brightest requests near the camera focus get a light, the rest
// get none, and unused lights sit at intensity 0.
//
//   flash( x, y, z, color, intensity, range, life )   explosions, impacts (fades out)
//   steady( x, y, z, color, intensity, range )        this frame only: projectiles in flight

import * as THREE from 'three/webgpu';

export class LightPool {

	constructor( scene, count = 6 ) {

		this.lights = [];
		for ( let i = 0; i < count; i ++ ) {

			const l = new THREE.PointLight( 0xffffff, 0, 8, 2 );
			l.castShadow = false;
			l.position.set( 0, - 50, 0 );
			scene.add( l );
			this.lights.push( l );

		}

		this.flashes = [];
		this.frameReq = [];
		this.active = count;

	}

	setBudget( n ) {

		this.active = Math.max( 0, Math.min( this.lights.length, n ) );

	}

	flash( x, y, z, color, intensity, range = 8, life = 0.3 ) {

		if ( this.flashes.length > 48 ) this.flashes.shift();
		this.flashes.push( { x, y, z, color, intensity, range, life, age: 0 } );

	}

	steady( x, y, z, color, intensity, range = 6 ) {

		if ( this.frameReq.length < 64 ) this.frameReq.push( { x, y, z, color, intensity, range } );

	}

	update( dt, fx, fz ) {

		const req = this.frameReq;
		this.flashes = this.flashes.filter( ( f ) => ( f.age += dt ) < f.life );
		for ( const f of this.flashes ) {

			const k = 1 - f.age / f.life;
			req.push( { x: f.x, y: f.y, z: f.z, color: f.color, intensity: f.intensity * k * k, range: f.range } );

		}

		// importance: brightness, attenuated by distance from what the camera looks at
		for ( const r of req ) r.score = r.intensity / ( 1 + ( ( r.x - fx ) ** 2 + ( r.z - fz ) ** 2 ) / 300 );
		req.sort( ( a, b ) => b.score - a.score );
		for ( let i = 0; i < this.lights.length; i ++ ) {

			const l = this.lights[ i ], r = i < this.active ? req[ i ] : null;
			if ( r ) {

				l.position.set( r.x, r.y, r.z );
				l.color.copy( r.color );
				l.intensity = r.intensity;
				l.distance = r.range;

			} else l.intensity = 0;

		}

		this.frameReq = [];

	}

}
