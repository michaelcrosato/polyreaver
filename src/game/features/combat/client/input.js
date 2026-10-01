// Input provider ( define( 'inputProvider', { id: 'default' } ), installed by main.js ):
// keyboard + mouse, gamepad and touch all write the same INPUT STATE ( game.input,
// docs/GAME.md §3 ), so the controller, bots and the agent API never care which
// device is in use. input.device ('keyboard' | 'gamepad' | 'touch') only changes
// the HUD labels and how generous aim assist is.
//
// Movement is CAMERA-RELATIVE: the stick / WASD vector is rotated by rc.camYaw, so
// "up" is always "away from the camera" (iso: -z; chase: wherever the camera looks).
//
//  keyboard/mouse  WASD/arrows move, cursor aims (ground point under it), LMB attack,
//                  RMB skill 1, 1-4 skills 2-5, Space/Shift dodge, Q potion, R/Z/X flasks 2-4, F/E interact,
//                  V camera mode, wheel zoom; chase camera: click locks the pointer and
//                  the mouse turns the view (Esc releases it)
//  gamepad         left stick move, right stick aim (auto-aim when idle; turns the camera
//                  in chase mode), A attack, X / Y / RB / RT / LB skills, B or R3 dodge,
//                  LT or d-pad up potion, d-pad down interact, d-pad right camera, Start pause
//  touch           twin-stick: a floating stick on the left half moves; right-hand buttons
//                  attack, cast (tap = auto-aim, drag = aim then release to cast), dodge,
//                  potion; two-finger pinch zooms, a swipe on empty space turns the chase camera
//
// Bots and the agent API write game.input directly: this layer only overwrites
// move/aim while a real device is driving them.

import * as THREE from 'three/webgpu';
import { define, get } from '../../../core/registry.js';
import { readLoadout, SLOT_ACTIONS } from '../skill-core.js';
import { touchUI } from './touch-ui.js';
import { settings, isTouchDevice } from './settings.js';

const KEYS = {
	KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
	Space: 'dodge', ShiftLeft: 'dodge', ShiftRight: 'dodge', KeyF: 'interact', KeyE: 'interact', KeyQ: 'potion',
	Digit1: 'skill2', Digit2: 'skill3', Digit3: 'skill4', Digit4: 'skill5',
	KeyR: 'flask2', KeyZ: 'flask3', KeyX: 'flask4', // flask belt slots 2-4 (Q drinks the best flask)
	KeyV: 'camera', Escape: 'pause', KeyP: 'pause', KeyI: 'inventory', KeyT: 'tree', KeyK: 'skills', KeyC: 'character',
	KeyM: 'map', Tab: 'map', Backquote: 'debug'
};
const UI_ACTIONS = new Set( [ 'pause', 'inventory', 'tree', 'skills', 'character', 'map', 'debug' ] );
const MOVE = new Set( [ 'up', 'down', 'left', 'right' ] );

// standard gamepad mapping (Xbox names)
const PAD = { 0: 'attack', 2: 'skill1', 3: 'skill2', 5: 'skill3', 7: 'skill4', 4: 'skill5', 1: 'dodge', 11: 'dodge', 6: 'potion', 12: 'potion', 13: 'interact' };
export const PAD_LABELS = { attack: 'A', skill1: 'X', skill2: 'Y', skill3: 'RB', skill4: 'RT', skill5: 'LB', dodge: 'B', potion: 'LT' };
export const KEY_LABELS = { attack: 'LMB', skill1: 'RMB', skill2: '1', skill3: '2', skill4: '3', skill5: '4', dodge: 'Space', potion: 'Q' };

const DEAD = 0.18; // radial stick dead zone
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), ground = new THREE.Plane( new THREE.Vector3( 0, 1, 0 ), 0 ), hitP = new THREE.Vector3();

function deadzone( x, y ) {

	const l = Math.hypot( x, y );
	if ( l < DEAD ) return [ 0, 0 ];
	const k = Math.min( 1, ( l - DEAD ) / ( 1 - DEAD ) ) / l; // rescale so motion starts at 0 past the dead zone
	return [ x * k, y * k ];

}

class InputLayer {

	constructor( game, rc, dom, onUiAction ) {

		this.game = game; this.rc = rc; this.dom = dom; this.onUi = onUiAction;
		this.keys = new Set();
		this.mouse = { x: innerWidth / 2, y: innerHeight / 2, inside: false };
		this.moveOwned = false; // did a device write the move vector last frame?
		this.aimHold = 0; // frames during which a touch / pad cast keeps its aim
		this.pad = { prev: [], index: - 1, aiming: false };
		this.stick = null; // { id, x0, y0, x, y }
		this.touches = new Map(); // free touches (pinch / swipe)
		this.btn = new Map(); // pointerId -> skill button state
		this.inp = game.input;
		this.inp.touchAim = { active: false, x: 0, z: 0, skill: null };
		// phones and tablets start with the touch controls showing
		if ( isTouchDevice() ) this.inp.device = 'touch';
		this.bindKeyboard();
		this.bindMouse();
		this.bindTouch();
		addEventListener( 'blur', () => this.releaseAll() );
		document.addEventListener( 'visibilitychange', () => document.hidden && this.releaseAll() );

	}

	press( a ) {

		if ( this.game.paused ) return;
		const inp = this.inp;
		if ( ! inp.held.has( a ) ) inp.pressed.add( a );
		inp.held.add( a );

	}

	release( a ) {

		this.inp.held.delete( a );

	}

	releaseAll() {

		this.keys.clear();
		this.inp.held.clear();
		this.stick = null;
		this.btn.clear();
		this.inp.touchAim.active = false;

	}

	device( d ) {

		if ( this.inp.device !== d ) this.inp.device = d;

	}

	// --- keyboard + mouse -------------------------------------------------------------------

	bindKeyboard() {

		addEventListener( 'keydown', ( e ) => {

			if ( e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement ) return;
			const a = KEYS[ e.code ];
			if ( ! a ) return;
			if ( a === 'map' || a === 'dodge' ) e.preventDefault();
			this.device( 'keyboard' );
			if ( e.repeat ) return;
			if ( UI_ACTIONS.has( a ) ) return this.onUi?.( a );
			if ( a === 'camera' ) return this.rc.cameraControl?.cycle();
			if ( MOVE.has( a ) ) this.keys.add( a );
			else this.press( a );

		} );
		addEventListener( 'keyup', ( e ) => {

			const a = KEYS[ e.code ];
			if ( ! a ) return;
			this.keys.delete( a );
			if ( ! MOVE.has( a ) ) this.release( a );

		} );

	}

	bindMouse() {

		const dom = this.dom;
		dom.addEventListener( 'pointermove', ( e ) => {

			if ( e.pointerType !== 'mouse' ) return;
			this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.inside = true;
			if ( document.pointerLockElement === dom ) {

				this.rc.cameraControl?.addYaw( - e.movementX * 0.0035 );
				this.rc.cameraControl?.addPitch( e.movementY * 0.002 );

			}

			this.device( 'keyboard' );

		} );
		dom.addEventListener( 'pointerleave', ( e ) => e.pointerType === 'mouse' && ( this.mouse.inside = false ) );
		dom.addEventListener( 'pointerdown', ( e ) => {

			if ( e.pointerType !== 'mouse' ) return;
			this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.inside = true;
			this.device( 'keyboard' );
			if ( this.rc.camMode === 'chase' && document.pointerLockElement !== dom && dom.requestPointerLock ) {

				try {

					dom.requestPointerLock()?.catch?.( () => {} );

				} catch { /* not allowed here: the cursor keeps aiming */ }

			}

			this.press( e.button === 2 ? 'skill1' : 'attack' );

		} );
		addEventListener( 'pointerup', ( e ) => e.pointerType === 'mouse' && this.release( e.button === 2 ? 'skill1' : 'attack' ) );
		dom.addEventListener( 'contextmenu', ( e ) => e.preventDefault() );
		dom.addEventListener( 'wheel', ( e ) => {

			e.preventDefault();
			this.rc.cameraControl?.zoomBy( Math.exp( Math.sign( e.deltaY ) * Math.min( 100, Math.abs( e.deltaY ) ) * 0.0015 ) );

		}, { passive: false } );

	}

	// --- touch ----------------------------------------------------------------------------------

	bindTouch() {

		const dom = this.dom;
		// the canvas: left half = floating move stick, elsewhere = pinch / camera swipe
		dom.addEventListener( 'pointerdown', ( e ) => {

			if ( e.pointerType === 'mouse' ) return;
			this.device( 'touch' );
			if ( ! this.stick && e.clientX < innerWidth * 0.45 ) {

				this.stick = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY };
				this.showStick( true );

			} else this.touches.set( e.pointerId, { x: e.clientX, y: e.clientY } );

			dom.setPointerCapture?.( e.pointerId );

		} );
		dom.addEventListener( 'pointermove', ( e ) => {

			if ( e.pointerType === 'mouse' ) return;
			if ( this.stick && e.pointerId === this.stick.id ) {

				this.stick.x = e.clientX; this.stick.y = e.clientY;
				// the base follows a thumb that drifts too far (no "dead" stick at the rim)
				const R = 70, dx = this.stick.x - this.stick.x0, dy = this.stick.y - this.stick.y0, d = Math.hypot( dx, dy );
				if ( d > R ) {

					this.stick.x0 = this.stick.x - dx / d * R;
					this.stick.y0 = this.stick.y - dy / d * R;

				}

				return;

			}

			const t = this.touches.get( e.pointerId );
			if ( ! t ) return;
			if ( this.touches.size >= 2 ) {

				const [ a, b ] = [ ...this.touches.values() ];
				const before = Math.hypot( a.x - b.x, a.y - b.y );
				t.x = e.clientX; t.y = e.clientY;
				const after = Math.hypot( a.x - b.x, a.y - b.y );
				if ( before > 10 && after > 10 ) this.rc.cameraControl?.zoomBy( before / after );

			} else {

				if ( this.rc.camMode === 'chase' ) this.rc.cameraControl?.addYaw( - ( e.clientX - t.x ) * 0.008 );
				t.x = e.clientX; t.y = e.clientY;

			}

		} );
		const end = ( e ) => {

			if ( e.pointerType === 'mouse' ) return;
			if ( this.stick && e.pointerId === this.stick.id ) {

				this.stick = null;
				this.showStick( false );

			}

			this.touches.delete( e.pointerId );

		};

		dom.addEventListener( 'pointerup', end );
		dom.addEventListener( 'pointercancel', end );

		// on-screen buttons built by the HUD
		for ( const { el, action } of touchUI.buttons ) this.bindButton( el, action );

	}

	bindButton( el, action ) {

		el.addEventListener( 'pointerdown', ( e ) => {

			e.preventDefault();
			e.stopPropagation();
			el.setPointerCapture?.( e.pointerId );
			this.device( 'touch' );
			el.classList.add( 'down' );
			const slot = SLOT_ACTIONS.indexOf( action );
			const id = slot >= 0 ? readLoadout( this.game.save ).bar[ slot ] : null;
			const skill = id ? get( 'skill', id ) : null;
			// attack, channels, dodge and potion act on touch-down; other skills wait to see
			// whether the thumb drags (aim) or lifts (tap = auto-aim)
			const instant = ! skill || slot === 0 || skill.tags.includes( 'channel' );
			const st = { action, slot, skill, x0: e.clientX, y0: e.clientY, drag: false, instant, t0: performance.now(), holding: false };
			this.btn.set( e.pointerId, st );
			if ( instant ) {

				this.autoAim();
				this.press( action );

			}

		} );
		el.addEventListener( 'pointermove', ( e ) => {

			const st = this.btn.get( e.pointerId );
			if ( ! st || ! st.skill ) return;
			const dx = e.clientX - st.x0, dy = e.clientY - st.y0, d = Math.hypot( dx, dy );
			if ( d > 16 ) st.drag = true;
			if ( ! st.drag ) return;
			// drag direction on screen -> a ground direction relative to the camera
			const p = this.game.world?.player;
			if ( ! p ) return;
			const yaw = this.rc.camYaw ?? Math.PI;
			const fx = Math.sin( yaw ), fz = Math.cos( yaw ), rx = - fz, rz = fx;
			const wx = rx * dx - fx * dy, wz = rz * dx - fz * dy, wl = Math.hypot( wx, wz ) || 1;
			const range = st.skill.range ?? 9;
			const dist = Math.max( 2, Math.min( range, d / 110 * range ) );
			const ta = this.inp.touchAim;
			ta.active = true; ta.skill = st.skill.id;
			ta.x = p.x + wx / wl * dist; ta.z = p.z + wz / wl * dist;
			this.inp.aim.x = ta.x; this.inp.aim.z = ta.z;
			this.aimHold = 2;

		} );
		const up = ( e ) => {

			const st = this.btn.get( e.pointerId );
			el.classList.remove( 'down' );
			if ( ! st ) return;
			this.btn.delete( e.pointerId );
			const ta = this.inp.touchAim;
			if ( st.instant || st.holding ) {

				this.release( st.action );

			} else if ( e.type !== 'pointercancel' ) {

				// tap: auto-aim; drag: cast at the previewed point
				if ( st.drag && ta.active ) {

					this.inp.aim.x = ta.x; this.inp.aim.z = ta.z;

				} else this.autoAim( st.skill?.range ?? 12 );

				this.aimHold = 3;
				this.press( st.action );
				this.release( st.action );

			}

			ta.active = false;

		};

		el.addEventListener( 'pointerup', up );
		el.addEventListener( 'pointercancel', up );

	}

	showStick( on ) {

		const base = touchUI.stickBase, knob = touchUI.stickKnob;
		if ( ! base ) return;
		base.style.display = knob.style.display = on ? 'block' : 'none';

	}

	// --- aim helpers ------------------------------------------------------------------------------

	// Soft target selection for pads and touch: the best enemy in front (facing / move
	// direction), else a point straight ahead.
	autoAim( range = 12 ) {

		const w = this.game.world, p = w?.player;
		if ( ! p ) return;
		const mv = this.inp.move;
		const dir = Math.hypot( mv.x, mv.z ) > 0.3 ? Math.atan2( mv.x, mv.z ) : p.facing;
		const fx = Math.sin( dir ), fz = Math.cos( dir );
		let best = null, bs = Infinity;
		for ( const o of w.enemiesOf( p, p.x, p.z, range ) ) {

			const dx = o.x - p.x, dz = o.z - p.z, d = Math.hypot( dx, dz ) || 1;
			const cos = ( dx * fx + dz * fz ) / d;
			if ( cos < - 0.2 && d > 3 ) continue;
			const score = d * ( 1.6 - cos );
			if ( score < bs && w.layout.hasLineOfSight( p.x, p.z, o.x, o.z ) ) {

				bs = score;
				best = o;

			}

		}

		this.inp.aim.x = best ? best.x : p.x + fx * 5;
		this.inp.aim.z = best ? best.z : p.z + fz * 5;

	}

	// --- per frame -------------------------------------------------------------------------------

	poll( dt ) {

		const inp = this.inp, rc = this.rc;
		this.pollGamepad( dt );
		this.syncTouchVisibility();
		const yaw = rc.camYaw ?? Math.PI;
		const fx = Math.sin( yaw ), fz = Math.cos( yaw ), rx = - fz, rz = fx;

		// move: keyboard, else the touch stick, else the pad (written in pollGamepad)
		let mx = 0, my = 0, src = null;
		if ( this.keys.size ) {

			if ( this.keys.has( 'left' ) ) mx -= 1;
			if ( this.keys.has( 'right' ) ) mx += 1;
			if ( this.keys.has( 'up' ) ) my += 1;
			if ( this.keys.has( 'down' ) ) my -= 1;
			const l = Math.hypot( mx, my ) || 1;
			mx /= l; my /= l;
			src = 'keys';

		} else if ( this.stick ) {

			const R = 70;
			[ mx, my ] = deadzone( ( this.stick.x - this.stick.x0 ) / R, - ( this.stick.y - this.stick.y0 ) / R );
			const l = Math.hypot( mx, my );
			if ( l > 1 ) {

				mx /= l; my /= l;

			}

			src = 'stick';
			this.drawStick();

		} else if ( this.padMove ) {

			[ mx, my ] = this.padMove;
			src = 'pad';

		}

		if ( src || this.moveOwned ) {

			inp.move.x = rx * mx + fx * my;
			inp.move.z = rz * mx + fz * my;
			this.moveOwned = !! src && ( mx !== 0 || my !== 0 );

		}

		// aim
		if ( this.aimHold > 0 ) {

			this.aimHold --;
			return;

		}

		const p = this.game.world?.player;
		if ( inp.device === 'keyboard' ) {

			if ( rc.camMode === 'chase' && document.pointerLockElement === this.dom && p ) {

				inp.aim.x = p.x + fx * 10; inp.aim.z = p.z + fz * 10;
				inp.aimValid = true;

			} else if ( this.mouse.inside ) {

				ndc.set( this.mouse.x / innerWidth * 2 - 1, - this.mouse.y / innerHeight * 2 + 1 );
				ray.setFromCamera( ndc, rc.camera );
				if ( ray.ray.intersectPlane( ground, hitP ) && ( ! p || hitP.distanceTo( rc.camera.position ) < 80 ) ) {

					inp.aim.x = hitP.x; inp.aim.z = hitP.z;
					inp.aimValid = true;

				} else if ( p ) {

					// cursor above the horizon (chase view): aim along the ray's ground direction
					const d = ray.ray.direction, l = Math.hypot( d.x, d.z ) || 1;
					inp.aim.x = p.x + d.x / l * 12; inp.aim.z = p.z + d.z / l * 12;

				}

			}

		} else if ( inp.device === 'touch' ) {

			// a skill button held still for a moment starts repeating (auto-aimed)
			for ( const st of this.btn.values() ) {

				if ( st.instant || st.drag || st.holding || performance.now() - st.t0 < 350 ) continue;
				st.holding = true;
				this.autoAim( st.skill?.range ?? 12 );
				this.press( st.action );

			}

			// held touch buttons keep re-targeting (the pack moves)
			if ( this.btn.size && ! inp.touchAim.active ) this.autoAim();

		}

	}

	pollGamepad( dt ) {

		this.padMove = null;
		const pads = navigator.getGamepads ? navigator.getGamepads() : [];
		let gp = null;
		for ( const g of pads ) if ( g && g.connected && g.mapping === 'standard' ) {

			gp = g;
			break;

		}

		if ( ! gp ) return;
		const prev = this.pad.prev;
		const btn = ( i ) => {

			const b = gp.buttons[ i ];
			return b ? b.pressed || b.value > 0.4 : false;

		};

		let any = false;
		for ( let i = 0; i < gp.buttons.length; i ++ ) {

			const on = btn( i ), was = !! prev[ i ];
			if ( on ) any = true;
			if ( on === was ) continue;
			prev[ i ] = on;
			if ( on ) {

				this.device( 'gamepad' );
				if ( i === 9 ) this.onUi?.( 'pause' );
				else if ( i === 8 ) this.onUi?.( 'inventory' );
				else if ( i === 15 ) this.rc.cameraControl?.cycle();
				else if ( PAD[ i ] ) {

					if ( this.inp.device === 'gamepad' && ! this.pad.aiming ) this.autoAim();
					this.press( PAD[ i ] );

				}

			} else if ( PAD[ i ] ) this.release( PAD[ i ] );

		}

		const [ lx, ly ] = deadzone( gp.axes[ 0 ] ?? 0, gp.axes[ 1 ] ?? 0 );
		const [ rx, ry ] = deadzone( gp.axes[ 2 ] ?? 0, gp.axes[ 3 ] ?? 0 );
		if ( lx || ly || rx || ry ) any = true;
		if ( any ) this.device( 'gamepad' );
		if ( this.inp.device !== 'gamepad' ) return;
		this.padMove = [ lx, - ly ];
		const p = this.game.world?.player;
		if ( ! p ) return;
		const rc = this.rc;
		if ( rc.camMode === 'chase' ) {

			// right stick turns the camera; aiming is the camera's forward + auto-aim
			if ( rx || ry ) {

				rc.cameraControl?.addYaw( - rx * 2.6 * dt );
				rc.cameraControl?.addPitch( ry * 1.2 * dt );

			}

			this.pad.aiming = false;
			this.autoAimForward();
			return;

		}

		if ( rx || ry ) {

			const yaw = rc.camYaw ?? Math.PI;
			const fx = Math.sin( yaw ), fz = Math.cos( yaw ), sx = - fz, sz = fx;
			const wx = sx * rx - fx * ry, wz = sz * rx - fz * ry, l = Math.hypot( wx, wz ) || 1;
			this.inp.aim.x = p.x + wx / l * 7; this.inp.aim.z = p.z + wz / l * 7;
			this.pad.aiming = true;

		} else {

			this.pad.aiming = false;
			if ( this.inp.held.size ) this.autoAim();

		}

	}

	// chase camera + pad: aim where the camera looks, snapping to an enemy in front
	autoAimForward() {

		const yaw = this.rc.camYaw ?? Math.PI;
		const save = { x: this.inp.move.x, z: this.inp.move.z };
		this.inp.move.x = Math.sin( yaw ); this.inp.move.z = Math.cos( yaw );
		this.autoAim( 14 );
		this.inp.move.x = save.x; this.inp.move.z = save.z;

	}

	syncTouchVisibility() {

		const want = settings.touch === 'on' || ( settings.touch === 'auto' && this.inp.device === 'touch' );
		if ( want !== touchUI.visible && touchUI.root ) {

			touchUI.visible = want;
			touchUI.root.classList.toggle( 'hidden', ! want );
			document.body.classList.toggle( 'pr-touch-mode', want );

		}

	}

	drawStick() {

		const base = touchUI.stickBase, knob = touchUI.stickKnob, s = this.stick;
		if ( ! base || ! s ) return;
		base.style.transform = `translate(${s.x0 - 60}px, ${s.y0 - 60}px)`;
		const dx = s.x - s.x0, dy = s.y - s.y0, d = Math.hypot( dx, dy ), k = d > 70 ? 70 / d : 1;
		knob.style.transform = `translate(${s.x0 + dx * k - 28}px, ${s.y0 + dy * k - 28}px)`;

	}

}

define( 'inputProvider', { id: 'default',
	install( game, rc, dom, onUiAction ) {

		const layer = new InputLayer( game, rc, dom, onUiAction );
		rc.input = layer;
		return ( dt ) => layer.poll( dt );

	} } );
