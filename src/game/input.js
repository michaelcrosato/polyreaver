// Baseline input: keyboard + mouse into game.input (the INPUT STATE contract in
// game.js). The combat subsystem replaces this module's install() with full
// gamepad / touch / rebinding support; the contract stays the same.
//
// Default bindings: WASD / arrows move, mouse aims, left mouse = attack,
// right mouse = skill1, Q W E R (when not moving with W...) -> skills 2-5 are on
// 1-5 instead to keep WASD free, Space / Shift = dodge, F = interact, Esc = pause.

import * as THREE from 'three/webgpu';

export const DEFAULT_BINDINGS = {
	KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
	Space: 'dodge', ShiftLeft: 'dodge', KeyF: 'interact', KeyE: 'interact',
	Digit1: 'skill2', Digit2: 'skill3', Digit3: 'skill4', Digit4: 'skill5', Digit5: 'skill6', KeyQ: 'potion',
	Escape: 'pause', KeyP: 'pause', KeyI: 'inventory', KeyT: 'tree', KeyK: 'skills', KeyC: 'character', KeyM: 'map', Tab: 'map', Backquote: 'debug'
};

export function installInput( game, rc, dom, onUiAction ) {

	const inp = game.input;
	const keys = new Set();
	const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane( new THREE.Vector3( 0, 1, 0 ), 0 ), hit = new THREE.Vector3();
	let mouseX = innerWidth / 2, mouseY = innerHeight / 2, mouseInside = false;

	const press = ( a ) => {

		if ( ! inp.held.has( a ) ) inp.pressed.add( a );
		inp.held.add( a );

	};

	const release = ( a ) => inp.held.delete( a );

	addEventListener( 'keydown', ( e ) => {

		if ( e.target instanceof HTMLInputElement ) return;
		const a = DEFAULT_BINDINGS[ e.code ];
		if ( ! a ) return;
		if ( a === 'map' ) e.preventDefault();
		if ( [ 'pause', 'inventory', 'tree', 'skills', 'character', 'map', 'debug' ].includes( a ) ) {

			if ( ! e.repeat ) onUiAction?.( a );
			return;

		}

		keys.add( a );
		press( a );
		inp.device = 'keyboard';

	} );

	addEventListener( 'keyup', ( e ) => {

		const a = DEFAULT_BINDINGS[ e.code ];
		if ( ! a ) return;
		keys.delete( a );
		release( a );

	} );

	dom.addEventListener( 'pointermove', ( e ) => {

		mouseX = e.clientX; mouseY = e.clientY; mouseInside = true;

	} );

	dom.addEventListener( 'pointerdown', ( e ) => {

		mouseX = e.clientX; mouseY = e.clientY;
		press( e.button === 2 ? 'skill1' : 'attack' );

	} );

	addEventListener( 'pointerup', ( e ) => release( e.button === 2 ? 'skill1' : 'attack' ) );
	dom.addEventListener( 'contextmenu', ( e ) => e.preventDefault() );
	addEventListener( 'blur', () => {

		keys.clear();
		inp.held.clear();

	} );

	// called every frame: turn keys into a move vector and the cursor into a ground point
	return function poll() {

		let x = 0, z = 0;
		if ( keys.has( 'left' ) ) x -= 1;
		if ( keys.has( 'right' ) ) x += 1;
		if ( keys.has( 'up' ) ) z -= 1;
		if ( keys.has( 'down' ) ) z += 1;
		// camera-relative: the camera looks down -z, so screen-up is world -z
		const l = Math.hypot( x, z ) || 1;
		inp.move.x = x / l; inp.move.z = z / l;
		if ( mouseInside ) {

			ndc.set( mouseX / innerWidth * 2 - 1, - mouseY / innerHeight * 2 + 1 );
			ray.setFromCamera( ndc, rc.camera );
			if ( ray.ray.intersectPlane( plane, hit ) ) {

				inp.aim.x = hit.x; inp.aim.z = hit.z; inp.aimValid = true;

			}

		}

	};

}
