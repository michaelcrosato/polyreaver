// Keyboard + on-screen touch controls for the hero.

export class Input {

	constructor( joystickEl, knobEl ) {

		this.keys = new Set();
		this.move = { x: 0, y: 0 }; // joystick, -1..1 (y up = forward)
		this.run = false; // sticky run toggle (touch)
		this.action = null; // 'wave' | 'cheer' | 'dance' held from a button
		this.onKey = null;

		window.addEventListener( 'keydown', ( e ) => {

			if ( e.target && ( e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' ) ) return;
			this.keys.add( e.code );
			this.onKey?.( e );

		} );
		window.addEventListener( 'keyup', ( e ) => this.keys.delete( e.code ) );
		window.addEventListener( 'blur', () => this.keys.clear() );

		if ( joystickEl ) this._bindJoystick( joystickEl, knobEl );

	}

	_bindJoystick( el, knob ) {

		let id = null;
		const radius = 48;
		const centre = { x: 0, y: 0 };
		const set = ( x, y ) => {

			let dx = x - centre.x, dy = y - centre.y;
			const len = Math.hypot( dx, dy );
			if ( len > radius ) {

				dx *= radius / len;
				dy *= radius / len;

			}

			knob.style.transform = `translate(${dx}px, ${dy}px)`;
			this.move.x = dx / radius;
			this.move.y = - dy / radius;

		};

		el.addEventListener( 'pointerdown', ( e ) => {

			e.preventDefault();
			e.stopPropagation();
			id = e.pointerId;
			el.setPointerCapture( id );
			const r = el.getBoundingClientRect();
			centre.x = r.left + r.width / 2;
			centre.y = r.top + r.height / 2;
			set( e.clientX, e.clientY );

		} );
		el.addEventListener( 'pointermove', ( e ) => {

			if ( e.pointerId === id ) set( e.clientX, e.clientY );

		} );
		const end = ( e ) => {

			if ( e.pointerId !== id ) return;
			id = null;
			this.move.x = this.move.y = 0;
			knob.style.transform = '';

		};

		el.addEventListener( 'pointerup', end );
		el.addEventListener( 'pointercancel', end );

	}

	// Returns { x, y } in -1..1 combining keyboard and joystick, plus run/action flags.
	read() {

		const k = this.keys;
		let x = this.move.x, y = this.move.y;
		if ( k.has( 'KeyW' ) || k.has( 'ArrowUp' ) ) y += 1;
		if ( k.has( 'KeyS' ) || k.has( 'ArrowDown' ) ) y -= 1;
		if ( k.has( 'KeyA' ) || k.has( 'ArrowLeft' ) ) x -= 1;
		if ( k.has( 'KeyD' ) || k.has( 'ArrowRight' ) ) x += 1;
		const len = Math.hypot( x, y );
		if ( len > 1 ) {

			x /= len;
			y /= len;

		}

		let action = this.action;
		if ( k.has( 'KeyR' ) ) action = 'wave';
		if ( k.has( 'Space' ) ) action = 'cheer';
		if ( k.has( 'KeyF' ) ) action = 'dance';

		return {
			x, y,
			run: this.run || k.has( 'ShiftLeft' ) || k.has( 'ShiftRight' ) || Math.hypot( this.move.x, this.move.y ) > 0.95,
			action
		};

	}

}
