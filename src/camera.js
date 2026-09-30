// Camera rig: one set of controls driving an orthographic camera (isometric /
// top-down) and a perspective camera (orbit / chase / eye level).
//
// Isometric = orthographic projection, 45° yaw, 35.264° pitch (atan(1/sqrt(2))),
// which makes the X, Y and Z axes foreshorten equally. Rotating in 90° steps keeps
// it a true isometric view.

import * as THREE from 'three/webgpu';

export const CAMERA_MODES = [
	{ id: 'iso', label: 'Isometric (follow hero)' },
	{ id: 'top', label: 'Top-down (orthographic)' },
	{ id: 'orbit', label: 'Perspective orbit' },
	{ id: 'chase', label: 'Third-person chase' },
	{ id: 'eye', label: 'Eye level (inside the crowd)' }
];

const ISO_PITCH = Math.atan( 1 / Math.SQRT2 );

const damp = ( a, b, lambda, dt ) => THREE.MathUtils.lerp( a, b, 1 - Math.exp( - lambda * dt ) );

function dampAngle( a, b, lambda, dt ) {

	let d = ( b - a ) % ( Math.PI * 2 );
	if ( d > Math.PI ) d -= Math.PI * 2;
	if ( d < - Math.PI ) d += Math.PI * 2;
	return a + d * ( 1 - Math.exp( - lambda * dt ) );

}

export class CameraRig {

	constructor( dom ) {

		this.dom = dom;
		this.mode = 'iso';
		this.ortho = new THREE.OrthographicCamera( - 1, 1, 1, - 1, 1, 8000 );
		this.persp = new THREE.PerspectiveCamera( 55, 1, 0.1, 3000 );
		this.aspect = 1;

		this.focus = new THREE.Vector3(); // smoothed look-at point
		this.panOffset = new THREE.Vector3(); // user pan away from the hero (iso/top/orbit)
		this.follow = true;

		this.yaw = Math.PI / 4; // current
		this.yawTarget = Math.PI / 4;
		this.pitch = ISO_PITCH;
		this.pitchTarget = ISO_PITCH;
		this.viewHeight = 30; // ortho: world units visible vertically
		this.viewHeightTarget = 30;
		this.distance = 30; // perspective orbit distance
		this.distanceTarget = 30;
		this.lookYaw = 0; // eye / chase free-look offset
		this.lookPitch = 0;

		this._pointers = new Map();
		this._pinch = null;
		this.onUserInput = null;
		this._bind();

	}

	get camera() {

		return ( this.mode === 'iso' || this.mode === 'top' ) ? this.ortho : this.persp;

	}

	get isOrtho() {

		return this.camera === this.ortho;

	}

	setMode( mode ) {

		this.mode = mode;
		this.panOffset.set( 0, 0, 0 );
		this.follow = true;
		this.lookYaw = this.lookPitch = 0;
		if ( mode === 'iso' ) {

			this.yawTarget = Math.round( ( this.yaw - Math.PI / 4 ) / ( Math.PI / 2 ) ) * ( Math.PI / 2 ) + Math.PI / 4;
			this.pitchTarget = ISO_PITCH;

		} else if ( mode === 'top' ) {

			this.pitchTarget = Math.PI / 2 - 0.001;

		} else if ( mode === 'orbit' ) {

			this.pitchTarget = 0.5;
			this.distanceTarget = 35;

		}

	}

	setAspect( aspect ) {

		this.aspect = aspect;
		this.persp.aspect = aspect;
		this.persp.updateProjectionMatrix();

	}

	rotateStep( dir ) {

		this.yawTarget += dir * Math.PI / 2;

	}

	zoomBy( factor ) {

		if ( this.isOrtho ) this.viewHeightTarget = THREE.MathUtils.clamp( this.viewHeightTarget * factor, 4, 2500 );
		else if ( this.mode === 'orbit' ) this.distanceTarget = THREE.MathUtils.clamp( this.distanceTarget * factor, 3, 1500 );
		else if ( this.mode === 'chase' ) this.distanceTarget = THREE.MathUtils.clamp( this.distanceTarget * factor, 3, 40 );
		else if ( this.mode === 'eye' ) this.persp.fov = THREE.MathUtils.clamp( this.persp.fov * factor, 20, 100 );

	}

	recenter() {

		this.panOffset.set( 0, 0, 0 );
		this.follow = true;

	}

	// Camera-relative movement basis on the ground plane.
	groundBasis( forward, right ) {

		const yaw = ( this.mode === 'eye' || this.mode === 'chase' ) ? this.yaw + this.lookYaw : this.yaw;
		// camera looks from (sin yaw, *, cos yaw) toward the focus => forward is the opposite
		forward.set( - Math.sin( yaw ), 0, - Math.cos( yaw ) );
		right.set( Math.cos( yaw ), 0, - Math.sin( yaw ) );

	}

	// Visible half-extent on the ground (used for shadow / fog / LOD sizing).
	get viewExtent() {

		if ( this.isOrtho ) return this.viewHeight * Math.max( 1, this.aspect ) * 0.75;
		if ( this.mode === 'eye' ) return 120;
		return Math.min( 400, this.distance * 2.2 );

	}

	update( dt, heroPos, heroHeading ) {

		// Target point: hero + optional pan offset.
		const target = new THREE.Vector3( heroPos.x, 0, heroPos.z ).add( this.panOffset );
		const k = this.follow ? 10 : 20;
		this.focus.x = damp( this.focus.x, target.x, k, dt );
		this.focus.z = damp( this.focus.z, target.z, k, dt );
		this.focus.y = 0;

		if ( this.mode === 'chase' ) {

			this.yawTarget = heroHeading + Math.PI;
			this.pitchTarget = 0.32;
			if ( this.distanceTarget > 40 ) this.distanceTarget = 9;

		}

		if ( this.mode === 'eye' ) this.yawTarget = heroHeading + Math.PI;

		this.yaw = dampAngle( this.yaw, this.yawTarget, this.mode === 'eye' ? 14 : 8, dt );
		this.pitch = damp( this.pitch, this.pitchTarget, 8, dt );
		this.viewHeight = damp( this.viewHeight, this.viewHeightTarget, 10, dt );
		this.distance = damp( this.distance, this.distanceTarget, 10, dt );

		const cam = this.camera;
		const cp = Math.cos( this.pitch ), sp = Math.sin( this.pitch );

		if ( this.isOrtho ) {

			const h = this.viewHeight / 2;
			cam.left = - h * this.aspect;
			cam.right = h * this.aspect;
			cam.top = h;
			cam.bottom = - h;
			const D = 2000;
			cam.position.set(
				this.focus.x + D * cp * Math.sin( this.yaw ),
				D * sp,
				this.focus.z + D * cp * Math.cos( this.yaw ) );
			cam.near = 1;
			cam.far = D * 2 + 500;
			cam.up.set( 0, 1, 0 );
			if ( this.mode === 'top' ) cam.up.set( - Math.sin( this.yaw ), 0, - Math.cos( this.yaw ) );
			cam.lookAt( this.focus.x, 0, this.focus.z );
			cam.updateProjectionMatrix();

		} else if ( this.mode === 'eye' ) {

			const yaw = this.yaw + this.lookYaw;
			const pitch = THREE.MathUtils.clamp( this.lookPitch, - 1.2, 1.2 );
			const eye = new THREE.Vector3( heroPos.x, 1.65, heroPos.z );
			eye.x += Math.sin( heroHeading ) * 0.25;
			eye.z += Math.cos( heroHeading ) * 0.25;
			cam.position.copy( eye );
			cam.lookAt( eye.x - Math.sin( yaw ) * Math.cos( pitch ), eye.y + Math.sin( pitch ), eye.z - Math.cos( yaw ) * Math.cos( pitch ) );
			cam.near = 0.1;
			cam.far = 3000;
			cam.updateProjectionMatrix();

		} else {

			const yaw = this.yaw + ( this.mode === 'chase' ? this.lookYaw : 0 );
			const pitch = THREE.MathUtils.clamp( this.pitch + ( this.mode === 'chase' ? this.lookPitch : 0 ), 0.05, 1.5 );
			const lookY = this.mode === 'chase' ? 1.5 : 0.8;
			const d = this.distance;
			cam.position.set(
				this.focus.x + d * Math.cos( pitch ) * Math.sin( yaw ),
				lookY + d * Math.sin( pitch ),
				this.focus.z + d * Math.cos( pitch ) * Math.cos( yaw ) );
			cam.lookAt( this.focus.x, lookY, this.focus.z );
			cam.near = 0.1;
			cam.far = Math.max( 3000, d * 10 );
			cam.updateProjectionMatrix();

		}

		cam.updateMatrixWorld();

	}

	// --- input -----------------------------------------------------------------
	_bind() {

		const el = this.dom;
		el.style.touchAction = 'none';

		el.addEventListener( 'contextmenu', ( e ) => e.preventDefault() );

		el.addEventListener( 'wheel', ( e ) => {

			e.preventDefault();
			this.zoomBy( Math.exp( e.deltaY * 0.0012 ) );
			this.onUserInput?.();

		}, { passive: false } );

		el.addEventListener( 'pointerdown', ( e ) => {

			el.setPointerCapture( e.pointerId );
			this._pointers.set( e.pointerId, { x: e.clientX, y: e.clientY, button: e.button } );
			if ( this._pointers.size === 2 ) this._pinch = this._pinchState();

		} );

		el.addEventListener( 'pointermove', ( e ) => {

			const p = this._pointers.get( e.pointerId );
			if ( ! p ) return;
			const dx = e.clientX - p.x, dy = e.clientY - p.y;
			p.x = e.clientX;
			p.y = e.clientY;

			if ( this._pointers.size >= 2 ) {

				const s = this._pinchState();
				if ( this._pinch ) {

					this.zoomBy( this._pinch.dist / Math.max( s.dist, 1 ) );
					let da = s.angle - this._pinch.angle;
					if ( da > Math.PI ) da -= Math.PI * 2;
					if ( da < - Math.PI ) da += Math.PI * 2;
					if ( this.mode !== 'iso' ) this.yawTarget -= da;
					else this._isoTwist = ( this._isoTwist || 0 ) + da;

				}

				this._pinch = s;
				this.onUserInput?.();
				return;

			}

			const rotateDrag = p.button === 2 || e.shiftKey;
			this._drag( dx, dy, rotateDrag );
			this.onUserInput?.();

		} );

		const up = ( e ) => {

			this._pointers.delete( e.pointerId );
			if ( this._pointers.size < 2 ) {

				// A two-finger twist in iso mode snaps to the next 90° step.
				if ( this._isoTwist && Math.abs( this._isoTwist ) > 0.35 ) this.rotateStep( - Math.sign( this._isoTwist ) );
				this._isoTwist = 0;
				this._pinch = null;

			}

		};

		el.addEventListener( 'pointerup', up );
		el.addEventListener( 'pointercancel', up );

	}

	_pinchState() {

		const [ a, b ] = [ ...this._pointers.values() ];
		return { dist: Math.hypot( a.x - b.x, a.y - b.y ), angle: Math.atan2( b.y - a.y, b.x - a.x ) };

	}

	_drag( dx, dy, rotate ) {

		const h = this.dom.clientHeight || 1;
		if ( this.mode === 'eye' || this.mode === 'chase' ) {

			this.lookYaw -= dx * 0.005;
			this.lookPitch -= dy * 0.004;
			this.lookPitch = THREE.MathUtils.clamp( this.lookPitch, - 1.2, 1.2 );
			return;

		}

		if ( this.mode === 'orbit' && ! rotate ) {

			this.yawTarget -= dx * 0.006;
			this.pitchTarget = THREE.MathUtils.clamp( this.pitchTarget + dy * 0.005, 0.05, 1.5 );
			return;

		}

		if ( rotate ) {

			if ( this.mode === 'iso' ) this._isoRotAccum = ( this._isoRotAccum || 0 ) + dx;
			else this.yawTarget -= dx * 0.006;
			if ( this.mode === 'iso' && Math.abs( this._isoRotAccum ) > 120 ) {

				this.rotateStep( - Math.sign( this._isoRotAccum ) );
				this._isoRotAccum = 0;

			}

			return;

		}

		// Pan on the ground plane (screen drag -> world units).
		const worldPerPx = this.isOrtho ? this.viewHeight / h : this.distance * 1.2 / h;
		const fwd = new THREE.Vector3(), right = new THREE.Vector3();
		this.groundBasis( fwd, right );
		const pitchScale = this.isOrtho ? 1 / Math.max( Math.sin( this.pitch ), 0.2 ) : 1;
		this.panOffset.addScaledVector( right, - dx * worldPerPx );
		this.panOffset.addScaledVector( fwd, dy * worldPerPx * pitchScale );
		this.follow = false;

	}

}
