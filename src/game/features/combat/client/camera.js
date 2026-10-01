// Game camera (render system 'camera', replaces the placeholder). Three
// perspectives, switchable with V or from the pause menu:
//
//   iso    the default: a high Diablo-like angle, fixed orientation (screen-up = -z)
//   chase  over the shoulder, close and low; the yaw turns (mouse with pointer lock,
//          right stick, swipe) and movement becomes camera-relative ( rc.camYaw )
//   top    almost straight down - tactical
//
// Feel: the focus follows the hero tightly (no floaty lag) while a separately
// smoothed LOOK-AHEAD leans toward the aim and the movement; during fights the view
// eases out a little and drifts toward the pack (dynamic framing). Shake uses a
// trauma model - rc.shake in 0..1, displacement grows with trauma squared and decays
// fast - with smooth sine noise instead of random jitter, which reads as impact
// rather than nausea. The sun and its shadow camera follow the focus.
//
// Published for other systems: rc.camTarget (focus), rc.camYaw (look direction on
// the ground, 0 = +z), rc.camDist (distance, for screen-constant sizes), rc.camMode,
// rc.cameraControl { setMode, cycle, addYaw, addPitch, zoomBy }.

import * as THREE from 'three/webgpu';
import { define } from '../../../core/registry.js';
import { TEAM } from '../../../core/tuning.js';
import { settings, setSetting } from './settings.js';

export const CAMERA_MODES = [ 'iso', 'chase', 'top' ];
const MODE = {
	iso: { pitch: 52 * Math.PI / 180, dist: 25, fov: 40 },
	top: { pitch: 76 * Math.PI / 180, dist: 31, fov: 40 },
	chase: { pitch: 17 * Math.PI / 180, dist: 7.2, fov: 55 }
};

const tmpL = { x: 0, y: 0, z: 0, facing: 0 };
const want = new THREE.Vector3(), wantLook = new THREE.Vector3();

define( 'renderSystem', { id: 'camera', order: 5,
	init( rc ) {

		const st = this.st = {
			focus: new THREE.Vector3(), lead: new THREE.Vector3(), look: new THREE.Vector3(), pos: new THREE.Vector3(),
			from: new THREE.Vector3(), fromLook: new THREE.Vector3(), blend: 1, zoom: settings.zoom, zoomTarget: settings.zoom,
			yaw: Math.PI, pitchAdj: 0, manualAt: - 9, combat: 0, bias: new THREE.Vector3(), scanAt: 0, snap: true, fov: 40
		};
		rc.camTarget = st.focus;
		rc.camYaw = Math.PI;
		rc.camMode = CAMERA_MODES.includes( settings.camera ) ? settings.camera : 'iso';
		rc.camDist = 30;
		rc.shake = 0;
		let saveTimer = 0;
		rc.cameraControl = {
			setMode( mode ) {

				if ( ! CAMERA_MODES.includes( mode ) || mode === rc.camMode ) return;
				st.from.copy( rc.camera.position );
				st.fromLook.copy( st.look );
				st.blend = 0;
				if ( mode === 'chase' ) st.yaw = rc.world?.player ? rc.world.player.facing : Math.PI;
				rc.camMode = mode;
				setSetting( 'camera', mode );
				if ( mode !== 'chase' && document.pointerLockElement ) document.exitPointerLock?.();

			},
			cycle() {

				this.setMode( CAMERA_MODES[ ( CAMERA_MODES.indexOf( rc.camMode ) + 1 ) % CAMERA_MODES.length ] );

			},
			addYaw( d ) {

				st.yaw += d;
				st.manualAt = rc.time;

			},
			addPitch( d ) {

				st.pitchAdj = Math.max( - 0.12, Math.min( 0.45, st.pitchAdj + d ) );

			},
			zoomBy( f ) {

				st.zoomTarget = Math.max( 0.55, Math.min( 1.6, st.zoomTarget * f ) );
				clearTimeout( saveTimer );
				saveTimer = setTimeout( () => setSetting( 'zoom', st.zoomTarget ), 400 );

			}
		};

	},
	onWorld() {

		this.st.snap = true;

	},
	update( rc, world, alpha, dt ) {

		const st = this.st, p = world.player;
		if ( ! p ) return;
		const l = rc.lerp( p, tmpL );
		const mode = rc.camMode, M = MODE[ mode ];
		const inp = world.input;

		// --- focus + look-ahead ---------------------------------------------------------
		st.focus.set( l.x, l.y, l.z );
		let ax = 0, az = 0;
		if ( inp && mode !== 'chase' ) {

			const dx = inp.aim.x - l.x, dz = inp.aim.z - l.z, d = Math.hypot( dx, dz );
			const k = Math.min( d, 7 ) / Math.max( d, 1e-3 );
			ax = dx * k * 0.2 + p.vx * 0.16;
			az = dz * k * 0.2 + p.vz * 0.16;

		}

		const kl = 1 - Math.exp( - 4 * dt );
		st.lead.x += ( ax - st.lead.x ) * kl;
		st.lead.z += ( az - st.lead.z ) * kl;

		// --- dynamic framing: ease out and lean toward nearby enemies in a fight ---------
		if ( rc.time >= st.scanAt ) {

			st.scanAt = rc.time + 0.25;
			let n = 0, cx = 0, cz = 0;
			for ( const e of world.spatial.query( p.x, p.z, 14, ( o ) => o.alive && o.team === TEAM.ENEMY ) ) {

				n ++;
				cx += e.x; cz += e.z;

			}

			st.combatWant = Math.min( 1, n / 8 );
			st.biasWant = n ? { x: ( cx / n - p.x ) * 0.07, z: ( cz / n - p.z ) * 0.07 } : { x: 0, z: 0 };

		}

		const kc = 1 - Math.exp( - 1.5 * dt );
		st.combat += ( ( st.combatWant ?? 0 ) - st.combat ) * kc;
		st.bias.x += ( ( st.biasWant?.x ?? 0 ) - st.bias.x ) * kc;
		st.bias.z += ( ( st.biasWant?.z ?? 0 ) - st.bias.z ) * kc;
		st.zoom += ( st.zoomTarget - st.zoom ) * ( 1 - Math.exp( - 10 * dt ) );

		// portrait screens see less sideways: back off so the fight still fits
		const aspect = rc.camera.aspect;
		const portrait = aspect < 1 ? 1 + ( 1 - aspect ) * 0.6 : 1;
		const dist = M.dist * st.zoom * ( 1 + st.combat * ( mode === 'chase' ? 0.15 : 0.1 ) ) * ( mode === 'chase' ? 1 : portrait );

		// --- desired camera for this mode ---------------------------------------------
		if ( mode === 'chase' ) {

			// auto-follow when the player is not steering the camera: swing behind the
			// movement, or (more gently) behind the way the hero faces while fighting
			if ( rc.time - st.manualAt > 1.5 && ! document.pointerLockElement ) {

				const moving = Math.hypot( p.vx, p.vz ) > 1;
				if ( moving || p.action ) {

					const behind = moving ? Math.atan2( p.vx, p.vz ) : p.facing;
					const d = Math.atan2( Math.sin( behind - st.yaw ), Math.cos( behind - st.yaw ) );
					st.yaw += d * ( 1 - Math.exp( - ( moving ? 1.2 : 0.8 ) * dt ) );

				}

			}

			const pitch = M.pitch + st.pitchAdj;
			const fx = Math.sin( st.yaw ), fz = Math.cos( st.yaw );
			const rx = - fz, rz = fx; // screen-right on the ground
			let back = Math.cos( pitch ) * dist;
			// pull in when a wall is between the hero and the camera
			const clear = world.layout.raycast( l.x, l.z, l.x - fx * back, l.z - fz * back );
			back = Math.max( 2.2, back * clear - ( clear < 1 ? 0.4 : 0 ) );
			const shoulder = 0.75;
			want.set( l.x - fx * back + rx * shoulder, l.y + 1.6 + Math.sin( pitch ) * dist, l.z - fz * back + rz * shoulder );
			wantLook.set( l.x + fx * 5 + rx * shoulder * 0.5, l.y + 1.3, l.z + fz * 5 + rz * shoulder * 0.5 );
			rc.camYaw = st.yaw;

		} else {

			const tx = l.x + st.lead.x + st.bias.x * ( 1 + st.combat ), tz = l.z + st.lead.z + st.bias.z * ( 1 + st.combat );
			wantLook.set( tx, l.y * 0.5, tz );
			want.set( tx, Math.sin( M.pitch ) * dist + l.y * 0.5, tz + Math.cos( M.pitch ) * dist );
			rc.camYaw = Math.PI;

		}

		// --- mode transitions: ease from where the camera was ------------------------------
		if ( st.snap ) {

			st.snap = false;
			st.blend = 1;
			st.lead.set( 0, 0, 0 );

		}

		if ( st.blend < 1 ) {

			st.blend = Math.min( 1, st.blend + dt / 0.45 );
			const k = st.blend * st.blend * ( 3 - 2 * st.blend );
			want.lerpVectors( st.from, want, k );
			wantLook.lerpVectors( st.fromLook, wantLook, k );

		}

		st.pos.copy( want );
		st.look.copy( wantLook );

		// --- shake: trauma^2, smooth multi-sine noise, fast decay --------------------------
		const trauma = Math.min( 1, rc.shake || 0 );
		rc.shake = Math.max( 0, trauma - dt * 1.9 );
		const cam = rc.camera;
		cam.position.copy( st.pos );
		if ( trauma > 0.001 ) {

			const s = trauma * trauma * ( mode === 'chase' ? 0.18 : 0.5 ) * ( dist / 29 ) * ( mode === 'chase' ? 1 : 1 );
			const t = rc.time * 38;
			cam.position.x += ( Math.sin( t * 1.1 ) + Math.sin( t * 2.3 + 1.7 ) * 0.5 ) * s;
			cam.position.y += ( Math.sin( t * 1.37 + 0.4 ) + Math.sin( t * 2.9 + 2.1 ) * 0.5 ) * s * 0.6;
			cam.position.z += ( Math.sin( t * 0.93 + 3.1 ) + Math.sin( t * 2.1 + 0.3 ) * 0.5 ) * s;

		}

		cam.lookAt( st.look );
		if ( trauma > 0.001 ) cam.rotateZ( Math.sin( rc.time * 31 ) * trauma * trauma * 0.02 );
		const fov = M.fov;
		if ( Math.abs( cam.fov - fov ) > 0.01 ) {

			cam.fov += ( fov - cam.fov ) * Math.min( 1, dt * 8 );
			if ( Math.abs( cam.fov - fov ) < 0.05 ) cam.fov = fov;
			cam.updateProjectionMatrix();

		}

		rc.camDist = cam.position.distanceTo( st.look );

		// --- the sun (and its shadow frustum) follows what we look at -------------------
		const f = mode === 'chase' ? wantLook : st.focus;
		rc.sun.position.set( f.x + 12, 30, f.z + 8 );
		rc.sun.target.position.set( f.x, 0, f.z );

	}
} );

// agents (tools feature's game.api / Claude link) can switch the view too
define( 'apiCommand', { id: 'combat.camera', desc: 'Set the camera perspective (iso | chase | top) and zoom (0.55..1.6)', args: { mode: 'iso|chase|top', zoom: 'number' },
	run( game, { mode, zoom } = {} ) {

		const cc = game.rc?.cameraControl;
		if ( ! cc ) return { error: 'no camera (headless)' };
		if ( mode ) cc.setMode( mode );
		if ( zoom ) cc.zoomBy( zoom / ( settings.zoom || 1 ) );
		return { mode: game.rc.camMode, zoom: settings.zoom };

	} } );
