// Settings appliers: push the current settings (app.S) into the crowd, world,
// camera, post-processing and physics. App keeps `_applyX()` methods that call these.

import * as THREE from 'three/webgpu';
import { ClusteredLighting } from 'three/addons/lighting/ClusteredLighting.js';
import { needsPost } from '../post.js';
import { TONE } from './config.js';

export function applyCrowd( app ) {

	const S = app.S, crowd = app.crowd;
	// GPU-driven culling and GPU collisions bind up to 8 storage buffers per shader.
	if ( app.storageLimit < 8 && S.path === 'gpu' ) {

		S.path = 'direct';
		app.ui.controls.get( 'path' )?.set( 'direct' );
		app.ui.setWarnings( [ `This GPU allows only ${app.storageLimit} storage buffers per shader - GPU-driven rendering needs 8, using direct.` ] );

	}

	const cap = app.resolveCapacity();
	if ( cap !== crowd.capacity ) crowd.setCapacity( cap );
	const u = crowd.u;
	u.density.value = S.density;
	u.activity.value = S.activity;
	u.speedScale.value = S.speed;
	u.behaviour.value = Number( S.behaviour );
	const shadowsOn = S.shadows !== 'off';
	crowd.set( {
		tier: Number( S.tier ), path: S.path, animSystem: S.anim, animBlend: S.animBlend, outlines: S.outlines, rim: S.rim,
		blobShadows: S.blobShadows, lodEnabled: S.lod, materialKind: S.shading,
		castShadow: shadowsOn && S.crowdShadows, receiveShadow: shadowsOn
	} );
	u.outline.value = S.outlineWidth;
	crowd.setCount( S.count );
	app.world.setRadius( crowd.radius );

}

export function applyShading( app ) {

	const S = app.S, renderer = app.renderer, world = app.world;
	const wantClustered = S.clustered;
	const isClustered = renderer.lighting !== app.defaultLighting;
	if ( wantClustered !== isClustered ) renderer.lighting = wantClustered ? new ClusteredLighting( 1024 ) : app.defaultLighting;

	const key = `${S.shading}|${S.shadows}|${S.clustered}`;
	if ( key !== app._shadingKey ) {

		const shadowChanged = ! app._shadingKey || app._shadingKey.split( '|' )[ 1 ] !== S.shadows;
		app._shadingKey = key;
		world.setShadows( S.shadows );
		if ( shadowChanged ) world.recreateSun();
		world.setShading( S.shading );
		app.physics.setShading( S.shading );
		app.physics.setShadows( S.shadows !== 'off' );
		app.crowd.materialKind = null; // force the crowd to rebuild its materials
	}

	world.setHemisphere( S.hemi );
	world.setEnvironment( S.env );
	if ( Number( S.pointLights ) !== world.pointLights.length ) world.setPointLights( Number( S.pointLights ) );

}

export function applyWorld( app ) {

	const S = app.S, world = app.world;
	if ( world.skyMode !== S.sky ) world.setSky( S.sky );
	world.setFog( S.fog );
	world.setProps( S.props );
	if ( world.groundDetail !== S.groundDetail ) world.setGroundDetail( S.groundDetail );

}

export function applyCamera( app, rebuildPost = true ) {

	if ( app.rig.mode !== app.S.camera ) app.rig.setMode( app.S.camera );
	app.resize();
	if ( rebuildPost ) app._applyPost();

}

export function applyPost( app ) {

	const S = app.S, renderer = app.renderer;
	renderer.toneMapping = TONE[ S.toneMapping ] ?? THREE.NoToneMapping;
	renderer.toneMappingExposure = S.exposure;
	// MSAA for the direct (no post) path lives on the renderer / canvas.
	renderer._samples = ( S.aa === 'msaa' && ! needsPost( S ) ) ? 4 : 0;
	app.world.setWet( S.ssr );
	const warnings = app.post.build( S, app.rig.camera );
	if ( S.ssr && ( S.shading !== 'standard' && S.shading !== 'physical' ) ) warnings.push( 'SSR needs Standard or Physical shading to reflect anything' );
	if ( ( S.shading === 'unlit' ) && ( S.shadows !== 'off' || S.pointLights > 0 || S.env ) ) warnings.push( 'Unlit shading ignores lights, shadows and environment - pick a lit shading model' );
	app.ui.setWarnings( warnings );

}

export function applyPhysics( app ) {

	const S = app.S, physics = app.physics;
	if ( app.storageLimit < 8 && S.crowdMode !== 'off' ) {

		S.crowdMode = 'off';
		app.ui.controls.get( 'crowdMode' )?.set( 'off' );
		app.ui.setWarnings( [ `This GPU allows only ${app.storageLimit} storage buffers per shader - GPU crowd collisions need 8, so they are off.` ] );

	}

	physics.configure( {
		bodies: Number( S.bodies ), shape: S.shape, sizeVar: S.sizeVar, spawn: S.spawn, restitution: S.restitution,
		friction: S.friction, gravity: S.gravity, hz: Number( S.hz ), iterations: Number( S.iterations ), ccd: S.ccd,
		sleep: S.sleep, recycle: S.recycle, props: S.physProps, propsDynamic: S.propsDynamic, crowdMode: S.crowdMode, rapierAgents: Number( S.rapierAgents ),
		proxies: S.proxies, proxyCount: Number( S.proxyCount ), agentRadius: S.agentRadius, knockdown: S.knockdown, debug: S.physDebug
	} );
	if ( S.physics && ! physics.enabled ) {

		physics.heroHeading = app.hero.heading;
		physics.enable( app.hero.pos ).then( () => physics.setShadows( S.shadows !== 'off' ) ).catch( ( e ) => {

			console.error( e );
			app.ui.setWarnings( [ 'Rapier failed to load: ' + e.message ] );

		} );

	} else if ( ! S.physics && physics.enabled ) physics.disable();

}
