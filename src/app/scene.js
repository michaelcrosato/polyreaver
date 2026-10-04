// Procedural city as a scene in the original stress-test App. Generation does
// not allocate citizens: the original Crowd owns every agent and all its controls.
import * as THREE from 'three/webgpu';
import CityWorker from '../city/worker.js?worker&inline';
import { generateCityAsync } from '../city/generate.js';
import { CityWorld } from '../city/render/world.js';
import { CityCollision } from '../city/player.js';
import { CityPhysics } from '../city/physics.js';
import { PhysicsDemo } from '../physics.js';
import { buildWalkMap } from '../city/walk-map.js';

export const sceneKey = ( S ) => S.scene === 'city' ? `city|${S.seed}` : 'plaza';

function generate( config, progress ) {

	return new Promise( ( resolve, reject ) => {

		let worker;
		const fallback = () => generateCityAsync( config, progress ).then( resolve, reject );
		try {

			worker = new CityWorker();
			worker.onmessage = ( { data } ) => {

				if ( data.step ) { progress( data.step, data.progress ); return; }
				worker.terminate();
				if ( data.error ) reject( new Error( data.error ) ); else resolve( data.city );

			};
			worker.onerror = ( event ) => { event.preventDefault(); worker.terminate(); fallback(); };
			worker.postMessage( { id: 1, config } );

		} catch { worker?.terminate(); fallback(); }

	} );

}

export function regenerateScene( app ) {

	if ( app.bench.running ) return Promise.reject( new Error( 'Stop the benchmark before regenerating or switching scenes.' ) );
	const requested = { scene: app.S.scene, seed: app.S.seed }, id = app.sceneRequest = ( app.sceneRequest || 0 ) + 1;
	app.scenePending = true;
	const status = document.getElementById( 'scene-status' );
	const run = async () => {

		if ( id !== app.sceneRequest ) return;
		app.sceneLoading = true;
		let view, texture;
		try {

			let city = null;
			if ( requested.scene === 'city' ) {

				status.textContent = 'Generating city…';
				city = await generate( { seed: requested.seed, population: 1 }, ( step, progress ) => { status.textContent = `${step} · ${Math.round( progress * 100 )}%`; } );
				if ( id !== app.sceneRequest ) return;
				const map = buildWalkMap( city.surface );
				texture = new THREE.DataTexture( map.data, map.size, map.size, THREE.RGBAFormat );
				texture.magFilter = texture.minFilter = THREE.NearestFilter; texture.generateMipmaps = false; texture.needsUpdate = true;
				view = new CityWorld( city, app.scene );

			}
			if ( app.physicsStartup ) await app.physicsStartup;
			if ( id !== app.sceneRequest ) { view?.dispose(); texture?.dispose(); return; }
			app.boot.assertActive();
			app.renderPreparing = true;
			app.physics.dispose(); app.physicsStartup = null;
			app.world.setCity( view || null );
			app.collision = city ? new CityCollision( city, { props: false } ) : null;
			app.hero.pos.set( city?.heroSpawn.x || 0, 0, city?.heroSpawn.z || 3 );
			app.overview = false; app.rig.setBenchView( null ); app.rig.focus.copy( app.hero.pos ); app.rig.recenter();
			app.rig.viewHeight = app.rig.viewHeightTarget = city ? 130 : 30;
			app.crowd.setCitySurface( texture || null, city?.heroSpawn );
			app.physics = city ? new CityPhysics( app ) : new PhysicsDemo( app.scene, app.world, app.crowd );
			app.sceneKey = sceneKey( requested ); app._shadingKey = null;
			app._applySettings();
			if ( app.physicsStartup ) await app.physicsStartup;
			// Startup has its own WARM stage; later scene swaps must prepare too.
			if ( app.boot.state.status === 'running' ) await app._prepareRendering();
			status.textContent = city ? `2 km city · ${city.buildings.length.toLocaleString()} buildings · ${city.layoutHash}` : 'Original plaza';

		} catch ( error ) {

			if ( app.world.cityView !== view ) { view?.dispose(); texture?.dispose(); }
			if ( ! app.sceneKey || app.boot.state.status !== 'running' ) throw error;
			app.S.scene = app.world.city ? 'city' : 'plaza';
			app.S.seed = app.world.city?.seed || requested.seed;
			app.ui.sync(); status.textContent = error.message;
			throw error;

		} finally {

			app.renderPreparing = false; app._lastFrame = performance.now();
			app.sceneLoading = false; if ( id === app.sceneRequest ) app.scenePending = false;

		}

	};
	app.sceneTask = ( app.sceneTask || Promise.resolve() ).catch( () => {} ).then( run );
	return app.sceneTask;

}
