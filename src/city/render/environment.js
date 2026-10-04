// The city's lighting uses the same implementation and settings as the plaza.
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { applyShadowMode, replaceSun, rebuildPointLights, applySky, applyEnvironment, applyFog, updateSun, updatePointLights } from '../../world/lighting.js';

export class CityEnvironment {

	constructor( renderer, scene ) {

		this.renderer = renderer; this.scene = scene;
		this.sunDir = new THREE.Vector3( -.45, .8, .35 ).normalize();
		this.sun = new THREE.DirectionalLight( 0xfff1dc, 2.2 );
		this.sun.shadow.bias = -.0005; this.sun.shadow.normalBias = .02;
		this.hemi = new THREE.HemisphereLight( 0xcfe4ff, 0x5a4a3a, .9 );
		scene.add( this.sun, this.sun.target, this.hemi );
		this.pointLights = []; this.lampPositions = []; this.lamps = { count: 0 };
		this.u = { fogCenter: uniform( new THREE.Vector3() ), fogNear: uniform( 40 ), fogFar: uniform( 160 ), fogDensity: uniform( .35 ), fogHeight: uniform( 3 ) };
		this.skyMode = 'flat'; this.envTexture = null; this.skyMesh = null; this.shadowsOn = false;

	}

	attach( world, traffic ) {

		this.world = world; this.traffic = traffic;
		this.lampPositions = world.city.props.filter( ( p ) => p.type === 'lamp' ).map( ( p ) => new THREE.Vector3( p.x, 4, p.z ) );
		this.lamps.count = this.lampPositions.length;
		this._applyShadowFlags();

	}

	_applyShadowFlags() {

		for ( const mesh of this.world?.meshes || [] ) {

			mesh.receiveShadow = this.shadowsOn;
			mesh.castShadow = this.shadowsOn && ( mesh.isInstancedMesh || mesh.name.startsWith( 'City props' ) );

		}
		if ( this.traffic ) this.traffic.mesh.castShadow = this.traffic.mesh.receiveShadow = this.shadowsOn;

	}

	setShadows( mode ) { applyShadowMode( this, mode ); replaceSun( this ); }
	setPointLights( count ) { if ( count !== this.pointLights.length ) rebuildPointLights( this, count ); }
	setSky( mode ) { if ( this.skyMode !== mode ) applySky( this, mode ); }
	setEnvironment( on ) { applyEnvironment( this, on ); }
	setFog( mode ) { applyFog( this, mode ); }

	update( dt, focus, camera, extent ) {

		updateSun( this, focus, extent );
		this.u.fogCenter.value.copy( camera.isPerspectiveCamera ? camera.position : focus );
		this.u.fogNear.value = Math.max( 20, extent * .35 );
		this.u.fogFar.value = Math.max( 60, extent * 1.25 );
		if ( this.skyMesh ) this.skyMesh.position.copy( camera.position );
		updatePointLights( this, dt, focus );

	}

}
