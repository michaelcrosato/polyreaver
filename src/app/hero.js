// The player-controlled hero: joystick / keyboard movement relative to the camera,
// then hand its position and state to the crowd shaders and the marker ring.

import * as THREE from 'three/webgpu';

export function updateHero( app, dt ) {

	const hero = app.hero;
	const inp = app.input.read();
	const fwd = new THREE.Vector3(), right = new THREE.Vector3();
	app.rig.groundBasis( fwd, right );
	const move = right.multiplyScalar( inp.x ).add( fwd.multiplyScalar( inp.y ) );
	const mag = Math.min( move.length(), 1 );
	if ( mag > 0.08 ) {

		const target = Math.atan2( move.x, move.z );
		let d = target - hero.heading;
		d = Math.atan2( Math.sin( d ), Math.cos( d ) );
		hero.heading += d * Math.min( 1, dt * 12 );
		hero.speed = ( inp.run ? 4.5 : 1.7 ) * mag;
		hero.state = inp.run ? 2 : 1;
		const delta = { x: Math.sin( hero.heading ) * hero.speed * dt, z: Math.cos( hero.heading ) * hero.speed * dt };
		// With physics on, the hero is a Rapier character controller: it slides
		// along trees / the monument and shoves bodies instead of passing through.
		if ( ! app.physics.moveHero( hero.pos, delta ) ) {

			hero.pos.x += delta.x;
			hero.pos.z += delta.z;

		}
		const r = Math.hypot( hero.pos.x, hero.pos.z ), maxR = app.world.radius + 40;
		if ( r > maxR ) hero.pos.multiplyScalar( maxR / r );
		app.rig.follow = true;
		app.rig.panOffset.multiplyScalar( Math.max( 0, 1 - dt * 3 ) );

	} else {

		hero.speed = 0;
		hero.state = inp.action === 'wave' ? 3 : inp.action === 'cheer' ? 4 : inp.action === 'dance' ? 5 : 0;

	}

	const u = app.crowd.u;
	u.heroPos.value.set( hero.pos.x, hero.pos.z );
	u.heroHeading.value = ( ( hero.heading % ( Math.PI * 2 ) ) + Math.PI * 2 ) % ( Math.PI * 2 );
	u.heroState.value = hero.state;
	u.heroSpeed.value = hero.speed;
	app.heroRing.position.set( hero.pos.x, 0.04, hero.pos.z );

}
