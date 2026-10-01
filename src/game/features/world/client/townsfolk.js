// Ambient townsfolk: the engine's GPU crowd (src/crowd/crowd.js - the same system
// that runs a million agents in the stress test) wandering the town plaza. Their
// whole life - choosing where to stroll, chatting, waving, cheering, walking and
// animating - happens in compute and vertex shaders; the CPU only sets a few
// uniforms. They are scenery (not entities): the simulation never sees them.
//
// The crowd lives in its own space centred on the plaza (crowd.group is moved
// there). Agent 0 is the crowd's "hero" slot in the stress test; parking it far
// outside the view keeps it out of town.

import { define } from '../../../core/registry.js';
import { Crowd } from '../../../../crowd/crowd.js';

define( 'renderSystem', { id: 'townsfolk', order: 24,

	onWorld( rc, world ) {

		const spot = world.layout.meta?.town?.crowd;
		if ( this.crowd ) this.crowd.group.visible = false;
		if ( world.kind !== 'town' || ! spot || /nocrowd/.test( location.hash ) ) return;
		try {

			if ( ! this.crowd ) {

				this.crowd = new Crowd( rc.renderer, rc.scene, { capacity: 128, count: spot.count, limits: rc.gpu?.limits } );
				this.crowd.set( { tier: 3, path: 'direct', materialKind: 'standard', castShadow: true, receiveShadow: true, animSystem: 'procedural' } );
				const u = this.crowd.u;
				u.density.value = spot.count / ( Math.PI * Math.pow( spot.radius - 3.5, 2 ) );
				u.wander.value = 3.5;
				u.activity.value = 0.55;
				u.speedScale.value = 0.8;
				u.heroPos.value.set( 1e5, 1e5 );

			}

			this.crowd.setCount( spot.count );
			this.crowd.group.position.set( spot.x, 0, spot.z );
			this.crowd.group.visible = true;

		} catch ( e ) {

			console.warn( 'townsfolk crowd unavailable:', e.message );
			this.crowd = null;

		}

	},

	update( rc, world, alpha, dt ) {

		if ( ! this.crowd?.group.visible || world.kind !== 'town' ) return;
		this.time = ( this.time ?? 0 ) + dt;
		this.crowd.u.heroPos.value.set( 1e5, 1e5 );
		this.crowd.update( dt, this.time, rc.camera, rc.renderer.domElement.height );

	}
} );
