// Prepare the entire active scene before handing control to the player. A first
// frame only prepares objects inside the opening camera/shadow frusta; zooming
// out would otherwise build shaders and upload whole chunks in the frame loop.
export async function prepareRendering( app, progress = () => {} ) {

	const started = performance.now(), culled = [];
	app.renderPreparing = true;
	try {

		app.rig.update( 0, app.hero.pos, app.hero.heading );
		const camera = app.rig.camera;
		app.world.update( 0, app.rig.focus, camera, app.rig.viewExtent );
		// Physics owns initially empty debug lines and zero-count body batches.
		// Populate their render data before compiling, without advancing time.
		app.physics.update( 0, app.hero.pos, app.hero.heading );
		app.scene.traverseVisible( ( object ) => {

			if ( object.isMesh || object.isLine || object.isPoints || object.isSprite ) {

				culled.push( [ object, object.frustumCulled ] );
				object.frustumCulled = false;

			}

		} );
		progress( 'Preparing crowd compute shaders' );
		await app.crowd.prepare();
		progress( 'Preparing scene shaders and buffers' );
		await app.post.prepareScene( camera, ( event ) => progress( `Preparing scene shaders and buffers · ${event.loaded}/${event.total}` ) );
		// Execute the active graph once, including shadow, post and indirect draws.
		// This primes pass-specific resources which scene compilation cannot cover.
		progress( 'Preparing shadows and effects' );
		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
		app.boot.assertActive();
		app.crowd.update( 0, app._startTime ? ( performance.now() - app._startTime ) / 1000 : 0, camera, app.renderer.domElement.height );
		if ( app.post.active ) app.post.render();
		else app.renderer.render( app.scene, camera );
		await app.gpu.device.queue.onSubmittedWorkDone();
		app.boot.assertActive();
		app.renderPreparation = { objects: culled.length, ms: performance.now() - started };

	} finally {

		for ( const [ object, frustumCulled ] of culled ) object.frustumCulled = frustumCulled;
		app.renderPreparing = false;
		app._lastFrame = performance.now();

	}

}
