// Render context: the three.js side of the game. Owns the WebGPU renderer, the
// scene, the camera, the base lights, and runs RENDER SYSTEMS - the presentation
// counterpart of simulation systems:
//
//   define( 'renderSystem', {
//     id: 'rigs', order: 20,
//     init( rc )                      once, after the renderer exists
//     onWorld( rc, world, game )      a new world started (town / level): build meshes
//     update( rc, world, alpha, dt )  every frame; alpha interpolates sim steps
//     dispose?( rc )
//   } )
//
// Render systems READ the simulation (entities, anim contract, projectiles,
// areas, layout, events) and never change it. `rc.lerp( e )` gives an entity's
// interpolated position for this frame.

import * as THREE from 'three/webgpu';
import { all } from '../core/registry.js';

export class RenderContext {

	constructor( renderer, gpu ) {

		this.renderer = renderer;
		this.gpu = gpu;
		this.scene = new THREE.Scene();
		this.scene.background = new THREE.Color( 0x0b0d12 );
		this.camera = new THREE.PerspectiveCamera( 40, innerWidth / innerHeight, 0.3, 600 );
		this.camera.position.set( 0, 22, 18 );
		this.camera.lookAt( 0, 0, 0 );
		this.systems = [];
		this.world = null;
		this.game = null;
		this.alpha = 0;
		this.time = 0;
		this.shake = 0; // camera shake amplitude (render systems add to it)
		this.hitstop = 0; // seconds the presentation freezes on heavy hits
		this.layers = { world: 0, ui: 1 };

		// base lighting; themes (level render system) replace colours and intensities
		this.hemi = new THREE.HemisphereLight( 0xbfd4ff, 0x3a2e24, 1.2 );
		this.sun = new THREE.DirectionalLight( 0xfff1d6, 2.2 );
		this.sun.position.set( 12, 30, 8 );
		this.sun.castShadow = true;
		this.sun.shadow.mapSize.set( 2048, 2048 );
		const sc = this.sun.shadow.camera;
		sc.left = - 30; sc.right = 30; sc.top = 30; sc.bottom = - 30; sc.near = 1; sc.far = 120;
		this.sun.shadow.bias = - 0.0005;
		this.scene.add( this.hemi, this.sun, this.sun.target );

	}

	init( game ) {

		this.game = game;
		this.systems = all( 'renderSystem' ).sort( ( a, b ) => ( a.order ?? 50 ) - ( b.order ?? 50 ) );
		for ( const s of this.systems ) s.init?.( this );

	}

	setWorld( world ) {

		this.world = world;
		for ( const s of this.systems ) s.onWorld?.( this, world, this.game );

	}

	// Interpolated position/facing of an entity for this frame.
	lerp( e, out = { x: 0, y: 0, z: 0, facing: 0 } ) {

		const a = this.alpha;
		const px = e.px ?? e.x, pz = e.pz ?? e.z, py = e.py ?? e.y, pf = e.pf ?? e.facing;
		out.x = px + ( e.x - px ) * a;
		out.z = pz + ( e.z - pz ) * a;
		out.y = py + ( e.y - py ) * a;
		const df = Math.atan2( Math.sin( e.facing - pf ), Math.cos( e.facing - pf ) );
		out.facing = pf + df * a;
		return out;

	}

	resize() {

		this.renderer.setSize( innerWidth, innerHeight );
		this.camera.aspect = innerWidth / innerHeight;
		this.camera.updateProjectionMatrix();
		for ( const s of this.systems ) s.resize?.( this );

	}

	frame( alpha, dt ) {

		this.alpha = alpha;
		this.time += dt;
		if ( this.world ) for ( const s of this.systems ) s.update?.( this, this.world, alpha, dt );
		if ( this.post ) this.post.render();
		else this.renderer.render( this.scene, this.camera );

	}

}
