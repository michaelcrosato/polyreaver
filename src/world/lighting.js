// Lights, shadows, sky, environment and fog. Each function takes the World, which
// owns all the state; World's setShadows() / setSky() / update() etc. call these.

import * as THREE from 'three/webgpu';
import {
	vec3, positionWorld, positionWorldDirection, dot, mix, smoothstep, length, fog, color, max, pow, exponentialHeightFogFactor, clamp
} from 'three/tsl';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// --- lights / shadows ----------------------------------------------------
export function applyShadowMode( world, mode ) {

	// mode: off | low | medium | high | ultra
	const cfg = {
		off: null,
		low: { size: 1024, type: THREE.BasicShadowMap, radius: 1 },
		medium: { size: 2048, type: THREE.PCFShadowMap, radius: 2 },
		high: { size: 4096, type: THREE.PCFShadowMap, radius: 4 }, // r186 folded PCFSoft into PCF + radius
		vsm: { size: 2048, type: THREE.VSMShadowMap, radius: 6 }
	}[ mode ];

	world.shadowsOn = !! cfg;
	world.renderer.shadowMap.enabled = world.shadowsOn;
	world.sun.castShadow = world.shadowsOn;
	if ( cfg ) {

		world.renderer.shadowMap.type = cfg.type;
		if ( world.sun.shadow.mapSize.x !== cfg.size ) {

			world.sun.shadow.mapSize.set( cfg.size, cfg.size );
			if ( world.sun.shadow.map ) {

				world.sun.shadow.map.dispose();
				world.sun.shadow.map = null;

			}

		}

		world.sun.shadow.radius = cfg.radius;
		world.sun.shadow.blurSamples = 8;

	}

	world._applyShadowFlags();

}

// Shadow filter type / map size are baked into the lighting shaders; replacing the
// light is the simplest way to guarantee every material picks up the change.
export function replaceSun( world ) {

	const old = world.sun;
	const sun = new THREE.DirectionalLight( old.color, old.intensity );
	sun.name = 'Sun';
	sun.castShadow = old.castShadow;
	sun.shadow.mapSize.copy( old.shadow.mapSize );
	sun.shadow.radius = old.shadow.radius;
	sun.shadow.blurSamples = old.shadow.blurSamples;
	sun.shadow.bias = old.shadow.bias;
	sun.shadow.normalBias = old.shadow.normalBias;
	sun.shadow.camera.near = 1;
	sun.shadow.camera.far = 600;
	sun.position.copy( old.position );
	sun.target.position.copy( old.target.position );
	world.scene.remove( old, old.target );
	old.dispose();
	world.scene.add( sun, sun.target );
	world.sun = sun;

}

export function rebuildPointLights( world, n ) {

	for ( const l of world.pointLights ) world.scene.remove( l );
	world.pointLights = [];
	const palette = [ 0xffc27a, 0xffb060, 0xffe0a0, 0xff9e6b ];
	for ( let i = 0; i < n; i ++ ) {

		const l = new THREE.PointLight( palette[ i % palette.length ], 60, 16, 2 );
		l.name = 'Lamp light ' + i;
		world.scene.add( l );
		world.pointLights.push( l );

	}

	world._lightTimer = 0;

}

// --- sky / environment / fog ----------------------------------------------
export function applySky( world, mode ) {

	world.skyMode = mode;
	const scene = world.scene;
	scene.background = null;
	scene.backgroundNode = null;
	if ( world.skyMesh ) {

		scene.remove( world.skyMesh );
		world.skyMesh.material.dispose();
		world.skyMesh = null;

	}

	if ( mode === 'gradient' ) {

		const d = positionWorldDirection;
		const t = clamp( d.y.mul( 1.4 ).add( 0.1 ), 0, 1 );
		const sunGlow = pow( max( dot( d, vec3( world.sunDir.x, world.sunDir.y, world.sunDir.z ) ), 0 ), 64 ).mul( 1.5 );
		scene.backgroundNode = mix( vec3( 0.78, 0.84, 0.88 ), vec3( 0.25, 0.45, 0.78 ), t ).add( vec3( 1, 0.9, 0.7 ).mul( sunGlow ) );

	} else if ( mode === 'physical' ) {

		const sky = new SkyMesh();
		sky.scale.setScalar( 4500 );
		sky.sunPosition.value.copy( world.sunDir );
		sky.turbidity.value = 4;
		sky.rayleigh.value = 1.2;
		sky.frustumCulled = false;
		scene.add( sky );
		world.skyMesh = sky;
		scene.background = new THREE.Color( 0x9fb3c2 );

	} else {

		scene.background = new THREE.Color( 0x9fb3c2 );

	}

}

export function applyEnvironment( world, on ) {

	if ( on && ! world.envTexture ) {

		const pmrem = new THREE.PMREMGenerator( world.renderer );
		const env = new RoomEnvironment();
		world.envTexture = pmrem.fromScene( env, 0.04 ).texture;
		env.dispose();
		pmrem.dispose();

	}

	world.scene.environment = on ? world.envTexture : null;
	world.scene.environmentIntensity = 0.4;

}

export function applyFog( world, mode ) {

	const u = world.u;
	const fogColor = color( 0xb4c3cf );
	if ( mode === 'distance' ) {

		// Distance from the player/camera focus rather than from the camera itself,
		// so it behaves the same in orthographic (isometric) and perspective views.
		const d = length( positionWorld.sub( u.fogCenter ) );
		world.scene.fogNode = fog( fogColor, smoothstep( u.fogNear, u.fogFar, d ) );

	} else if ( mode === 'height' ) {

		world.scene.fogNode = fog( color( 0xc9d4dc ), exponentialHeightFogFactor( u.fogDensity.mul( 0.2 ), u.fogHeight ) );

	} else {

		world.scene.fogNode = null;

	}

}

// --- per frame -----------------------------------------------------------
export function updateSun( world, focus, viewExtent ) {

	// Sun + shadow camera follow the focus point so the shadow map only covers
	// what is on screen (a single directional shadow over a 1 km crowd would be
	// hopelessly blurry).
	const ext = Math.min( Math.max( viewExtent, 12 ), 400 );
	const sc = world.sun.shadow.camera;
	const size = world.sun.shadow.mapSize.x;
	const texel = ( 2 * ext ) / size;
	const snapped = new THREE.Vector3(
		Math.round( focus.x / texel ) * texel, 0, Math.round( focus.z / texel ) * texel );
	world.sun.target.position.copy( snapped );
	world.sun.position.copy( snapped ).addScaledVector( world.sunDir, 250 );
	sc.left = sc.bottom = - ext;
	sc.right = sc.top = ext;
	sc.near = 1;
	sc.far = 600;
	sc.updateProjectionMatrix();

}

export function updatePointLights( world, dt, focus ) {

	// Assign the point-light pool to the lamp posts nearest the focus.
	if ( world.pointLights.length ) {

		world._lightTimer -= dt;
		if ( world._lightTimer <= 0 ) {

			world._lightTimer = 0.3;
			const f = focus;
			const near = world.lampPositions
				.slice( 0, Math.min( world.lampPositions.length, world.lamps ? world.lamps.count : 0 ) )
				.map( ( p ) => ( { p, d: ( p.x - f.x ) ** 2 + ( p.z - f.z ) ** 2 } ) )
				.sort( ( a, b ) => a.d - b.d );
			world.pointLights.forEach( ( l, i ) => {

				if ( i < near.length ) {

					l.position.copy( near[ i ].p );
					l.visible = true;

				} else {

					// not enough lamps: orbit the focus instead
					const a = ( i / world.pointLights.length ) * Math.PI * 2;
					l.position.set( f.x + Math.cos( a ) * 12, 3, f.z + Math.sin( a ) * 12 );

				}

			} );

		}

	}

}
