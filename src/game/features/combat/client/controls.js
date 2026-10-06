// Device bindings are preferences, independent of character saves. Store physical
// inputs per action so alternate keys can be removed without removing the action.
export const CONTROL_ACTIONS = [
	[ 'up', 'Move forward' ], [ 'down', 'Move backward' ], [ 'left', 'Move left' ], [ 'right', 'Move right' ],
	[ 'attack', 'Attack / skill 0' ], [ 'skill1', 'Skill 1' ], [ 'skill2', 'Skill 2' ], [ 'skill3', 'Skill 3' ], [ 'skill4', 'Skill 4' ], [ 'skill5', 'Skill 5' ],
	[ 'dodge', 'Dodge' ], [ 'potion', 'Best potion' ], [ 'flask2', 'Flask 2' ], [ 'flask3', 'Flask 3' ], [ 'flask4', 'Flask 4' ],
	[ 'interact', 'Interact' ], [ 'camera', 'Camera mode' ], [ 'pause', 'Pause / close menu' ],
	[ 'inventory', 'Inventory' ], [ 'tree', 'Passive tree' ], [ 'skills', 'Skills' ], [ 'character', 'Character' ], [ 'map', 'Map' ], [ 'debug', 'Debug' ]
].map( ( [ id, label ] ) => ( { id, label } ) );

export const DEFAULT_BINDINGS = {
	keyboard: {
		up: [ 'KeyW', 'ArrowUp' ], down: [ 'KeyS', 'ArrowDown' ], left: [ 'KeyA', 'ArrowLeft' ], right: [ 'KeyD', 'ArrowRight' ],
		attack: [ 'Mouse0' ], skill1: [ 'Mouse2' ], skill2: [ 'Digit1' ], skill3: [ 'Digit2' ], skill4: [ 'Digit3' ], skill5: [ 'Digit4' ],
		dodge: [ 'Space', 'ShiftLeft', 'ShiftRight' ], potion: [ 'KeyQ' ], flask2: [ 'KeyR' ], flask3: [ 'KeyZ' ], flask4: [ 'KeyX' ],
		interact: [ 'KeyF', 'KeyE' ], camera: [ 'KeyV' ], pause: [ 'Escape', 'KeyP' ], inventory: [ 'KeyI' ], tree: [ 'KeyT' ],
		skills: [ 'KeyK' ], character: [ 'KeyC' ], map: [ 'KeyM', 'Tab' ], debug: [ 'Backquote' ]
	},
	gamepad: {
		up: [], down: [], left: [], right: [], attack: [ 0 ], skill1: [ 2 ], skill2: [ 3 ], skill3: [ 5 ], skill4: [ 7 ], skill5: [ 4 ],
		dodge: [ 1, 11 ], potion: [ 6, 12 ], flask2: [], flask3: [], flask4: [], interact: [ 13 ], camera: [ 15 ], pause: [ 9 ],
		inventory: [ 8 ], tree: [], skills: [], character: [], map: [], debug: []
	}
};

export const CONTROLS_KEY = 'polyreaver.controls.v1';
const actions = new Set( CONTROL_ACTIONS.map( ( a ) => a.id ) );
const devices = [ 'keyboard', 'gamepad' ];
const codes = new Set( [
	...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split( '' ).map( ( c ) => 'Key' + c ),
	...Array.from( { length: 10 }, ( _, i ) => 'Digit' + i ),
	...Array.from( { length: 24 }, ( _, i ) => 'F' + ( i + 1 ) ),
	...Array.from( { length: 10 }, ( _, i ) => 'Numpad' + i ),
	...Array.from( { length: 5 }, ( _, i ) => 'Mouse' + i ),
	'Space', 'Escape', 'Tab', 'Enter', 'Backspace', 'Delete', 'Insert', 'Home', 'End', 'PageUp', 'PageDown',
	'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight',
	'CapsLock', 'NumLock', 'ScrollLock', 'Pause', 'PrintScreen', 'ContextMenu',
	'Backquote', 'Minus', 'Equal', 'BracketLeft', 'BracketRight', 'Backslash', 'Semicolon', 'Quote', 'Comma', 'Period', 'Slash',
	'NumpadAdd', 'NumpadSubtract', 'NumpadMultiply', 'NumpadDivide', 'NumpadDecimal', 'NumpadEnter', 'NumpadEqual', 'IntlBackslash', 'IntlRo', 'IntlYen'
] );
const PAD_NAMES = [ 'A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Back', 'Start', 'L3', 'R3', 'D-pad ↑', 'D-pad ↓', 'D-pad ←', 'D-pad →', 'Home' ];
const KEY_NAMES = { Mouse0: 'LMB', Mouse1: 'MMB', Mouse2: 'RMB', Mouse3: 'Mouse 4', Mouse4: 'Mouse 5', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Escape: 'Esc', Backquote: '`', Space: 'Space' };
const listeners = new Set();

export function validBinding( device, value ) {

	return device === 'keyboard' ? typeof value === 'string' && codes.has( value ) : device === 'gamepad' && Number.isInteger( value ) && value >= 0 && value < PAD_NAMES.length;

}

// Invalid individual entries fall back; an explicit empty array means unbound.
// Resolve conflicting stored bindings once, in action order, to keep lookup unique.
export function normalizeBindings( data ) {

	const out = {};
	for ( const device of devices ) {

		out[ device ] = {};
		const used = new Set();
		for ( const { id } of CONTROL_ACTIONS ) {

			const raw = data && Object.hasOwn( data, device ) && data[ device ] && Object.hasOwn( data[ device ], id ) ? data[ device ][ id ] : undefined;
			const source = Array.isArray( raw ) && raw.every( ( v ) => validBinding( device, v ) ) ? raw : DEFAULT_BINDINGS[ device ][ id ];
			out[ device ][ id ] = [ ...new Set( source ) ].slice( 0, 4 ).filter( ( v ) => {

				if ( used.has( v ) ) return false;
				used.add( v );
				return true;

			} );

		}

	}
	return out;

}

function load() {

	try {

		const data = JSON.parse( localStorage.getItem( CONTROLS_KEY ) || 'null' );
		return normalizeBindings( data?.version === 1 ? data.bindings : null );

	} catch { return normalizeBindings( null ); }

}

function changed() {

	controls.revision ++;
	try {

		localStorage.setItem( CONTROLS_KEY, JSON.stringify( { version: 1, bindings: controls.bindings } ) );
		controls.saved = true;

	} catch { controls.saved = false; }
	for ( const fn of listeners ) fn();
	return controls.saved;

}

export const controls = {
	bindings: load(), revision: 0, saved: true, capturing: false,
	bind( device, action, value ) {

		if ( ! devices.includes( device ) || ! actions.has( action ) || ! validBinding( device, value ) ) return { ok: false, reason: 'Unsupported input.' };
		const target = this.bindings[ device ][ action ];
		if ( target.includes( value ) ) return { ok: true, conflicts: [], persisted: this.saved };
		if ( target.length >= 4 ) return { ok: false, reason: 'Remove a binding first (maximum four per action).' };
		const conflicts = [];
		for ( const { id } of CONTROL_ACTIONS ) {

			const list = this.bindings[ device ][ id ];
			if ( id !== action && list.includes( value ) ) {

				conflicts.push( id );
				this.bindings[ device ][ id ] = list.filter( ( v ) => v !== value );

			}

		}
		target.push( value );
		return { ok: true, conflicts, persisted: changed() };

	},
	unbind( device, action, value ) {

		if ( ! devices.includes( device ) || ! actions.has( action ) || ! validBinding( device, value ) ) return { ok: false, reason: 'Unsupported input.' };
		this.bindings[ device ][ action ] = this.bindings[ device ][ action ].filter( ( v ) => v !== value );
		return { ok: true, persisted: changed() };

	},
	reset( device ) {

		if ( device !== undefined && ! devices.includes( device ) ) return { ok: false, reason: 'Unsupported device.' };
		const defaults = normalizeBindings( null );
		if ( device ) this.bindings[ device ] = defaults[ device ]; else this.bindings = defaults;
		return { ok: true, persisted: changed() };

	}
};

export function actionFor( device, value ) {

	if ( ! validBinding( device, value ) ) return null;
	return CONTROL_ACTIONS.find( ( a ) => controls.bindings[ device ][ a.id ].includes( value ) )?.id ?? null;

}

export function bindingLabel( device, value ) {

	if ( ! validBinding( device, value ) ) return '—';
	if ( device === 'gamepad' ) return PAD_NAMES[ value ];
	return KEY_NAMES[ value ] ?? value.replace( /^Key|^Digit/, '' ).replace( /Left$/, ' L' ).replace( /Right$/, ' R' );

}

export function controlLabel( action, device = 'keyboard', all = false ) {

	const list = controls.bindings[ device ]?.[ action ];
	return list?.length ? ( all ? list : list.slice( 0, 1 ) ).map( ( v ) => bindingLabel( device, v ) ).join( ' / ' ) : '—';

}

export function onControls( fn ) {

	listeners.add( fn );
	return () => listeners.delete( fn );

}
