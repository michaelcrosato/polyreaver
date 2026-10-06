// Real input provider with small browser event shims: no renderer/GPU required.
import assert from 'node:assert/strict';
import { test, beforeEach } from 'node:test';

const storage = new Map();
globalThis.localStorage = {
	getItem: ( key ) => storage.get( key ) ?? null,
	setItem: ( key, value ) => storage.set( key, value )
};
globalThis.innerWidth = 1000;
globalThis.innerHeight = 800;
globalThis.HTMLInputElement = class {};
globalThis.HTMLTextAreaElement = class {};
globalThis.HTMLSelectElement = class {};

const { controls, DEFAULT_BINDINGS, CONTROLS_KEY, normalizeBindings, validBinding, actionFor, controlLabel } = await import( '../src/game/features/combat/client/controls.js' );
const { InputLayer } = await import( '../src/game/features/combat/client/input.js' );

function event( target, type, values = {} ) {

	const e = new Event( type, { cancelable: true } );
	Object.assign( e, values );
	target.dispatchEvent( e );
	return e;

}

function fixture() {

	const win = new EventTarget(), doc = new EventTarget(), dom = new EventTarget();
	doc.hidden = false;
	globalThis.document = doc;
	globalThis.addEventListener = win.addEventListener.bind( win );
	let pads = [];
	Object.defineProperty( globalThis, 'navigator', { configurable: true, value: { getGamepads: () => pads } } );
	const input = { held: new Set(), pressed: new Set(), move: { x: 0, z: 0 }, aim: { x: 0, z: 0 }, device: 'keyboard' };
	const ui = [];
	const game = { input, paused: false, save: {} };
	const rc = { camYaw: Math.PI, cameraControl: { cycle: () => ui.push( 'camera' ) } };
	const layer = new InputLayer( game, rc, dom, ( a ) => ui.push( a ) );
	return { win, doc, dom, input, game, rc, layer, ui,
		pads: ( value ) => { pads = value; },
		key: ( code, on = true, props = {} ) => event( win, on ? 'keydown' : 'keyup', { code, repeat: false, ...props } ),
		mouse: ( button, on = true ) => event( on ? dom : win, on ? 'pointerdown' : 'pointerup', { pointerType: 'mouse', button, clientX: 20, clientY: 20 } )
	};

}

function pad( index = 0, held = [], axes = [ 0, 0, 0, 0 ] ) {

	return { index, id: 'fixture-' + index, mapping: 'standard', connected: true, axes,
		buttons: Array.from( { length: 17 }, ( _, i ) => ( { pressed: held.includes( i ), value: held.includes( i ) ? 1 : 0 } ) ) };

}

beforeEach( () => {

	globalThis.localStorage.setItem = ( key, value ) => storage.set( key, value );
	controls.capturing = false;
	controls.reset();

} );

test( 'all default bindings round-trip and retain alternate keys', () => {

	assert.deepEqual( normalizeBindings( JSON.parse( JSON.stringify( DEFAULT_BINDINGS ) ) ), DEFAULT_BINDINGS );
	assert.equal( controlLabel( 'attack' ), 'LMB' );
	assert.equal( controlLabel( 'dodge', 'gamepad', true ), 'B / R3' );

} );

test( 'assignment moves a conflicting key without removing other alternate keys', () => {

	const result = controls.bind( 'keyboard', 'attack', 'KeyW' );
	assert.deepEqual( result.conflicts, [ 'up' ] );
	assert.equal( actionFor( 'keyboard', 'KeyW' ), 'attack' );
	assert.deepEqual( controls.bindings.keyboard.up, [ 'ArrowUp' ] );
	assert.equal( actionFor( 'keyboard', 'Mouse0' ), 'attack' );

} );

test( 'invalid device, action and physical inputs cannot corrupt bindings', () => {

	const initial = JSON.stringify( controls.bindings );
	for ( const value of [ '__proto__', 'UnknownKey', '', 'MetaLeft', 0, null ] ) assert.equal( controls.bind( 'keyboard', 'attack', value ).ok, false );
	for ( const value of [ - 1, 17, 1.5, '0', NaN, null ] ) assert.equal( controls.bind( 'gamepad', 'attack', value ).ok, false );
	assert.equal( controls.bind( 'touch', 'attack', 0 ).ok, false );
	assert.equal( controls.bind( 'keyboard', '__proto__', 'KeyA' ).ok, false );
	assert.equal( controls.unbind( 'keyboard', 'attack', '__proto__' ).ok, false );
	assert.equal( controls.reset( '__proto__' ).ok, false );
	assert.equal( validBinding( 'keyboard', 'NumpadEnter' ), true );
	assert.equal( JSON.stringify( controls.bindings ), initial );

} );

test( 'removing the last binding remains unbound after persistence and normalization', async () => {

	controls.unbind( 'keyboard', 'potion', 'KeyQ' );
	assert.equal( controlLabel( 'potion' ), '—' );
	const saved = JSON.parse( storage.get( CONTROLS_KEY ) );
	assert.deepEqual( normalizeBindings( saved.bindings ).keyboard.potion, [] );
	const reloaded = await import( '../src/game/features/combat/client/controls.js?reload-unbound' );
	assert.deepEqual( reloaded.controls.bindings.keyboard.potion, [] );

} );

test( 'malformed preference entries fall back and stored conflicts resolve once', () => {

	const fixed = normalizeBindings( { keyboard: { up: null, attack: [ 'KeyW', 'KeyW' ], potion: [], skill1: [ 'not-a-key' ] }, gamepad: [] } );
	assert.deepEqual( fixed.keyboard.up, [ 'KeyW', 'ArrowUp' ] );
	assert.deepEqual( fixed.keyboard.attack, [] );
	assert.deepEqual( fixed.keyboard.potion, [] );
	assert.deepEqual( fixed.keyboard.skill1, [ 'Mouse2' ] );
	assert.deepEqual( fixed.gamepad, DEFAULT_BINDINGS.gamepad );

} );

test( 'device reset preserves bindings on the other device and never writes a character save', () => {

	storage.set( 'polyreaver.save', 'untouched-character-data' );
	controls.bind( 'keyboard', 'attack', 'KeyH' );
	controls.bind( 'gamepad', 'attack', 3 );
	controls.reset( 'gamepad' );
	assert.equal( actionFor( 'keyboard', 'KeyH' ), 'attack' );
	assert.deepEqual( controls.bindings.gamepad, DEFAULT_BINDINGS.gamepad );
	assert.equal( storage.get( 'polyreaver.save' ), 'untouched-character-data' );

} );

test( 'binding capacity rejects an addition before stealing a key from another action', () => {

	controls.bind( 'keyboard', 'attack', 'KeyH' );
	controls.bind( 'keyboard', 'attack', 'KeyJ' );
	controls.bind( 'keyboard', 'attack', 'KeyU' );
	assert.equal( controls.bind( 'keyboard', 'attack', 'KeyW' ).ok, false );
	assert.equal( actionFor( 'keyboard', 'KeyW' ), 'up' );

} );

test( 'blocked storage still applies controls to the current session', () => {

	globalThis.localStorage.setItem = () => { throw new Error( 'blocked' ); };
	const result = controls.bind( 'keyboard', 'attack', 'KeyH' );
	assert.equal( result.ok, true );
	assert.equal( result.persisted, false );
	assert.equal( actionFor( 'keyboard', 'KeyH' ), 'attack' );

} );

test( 'alternate movement keys retain movement until every physical key is released', () => {

	const f = fixture();
	f.key( 'KeyW' ); f.key( 'ArrowUp' );
	f.key( 'KeyW', false );
	f.layer.poll( 1 / 60 );
	assert.equal( f.layer.keys.has( 'up' ), true );
	assert.equal( f.input.move.z, - 1 );
	f.key( 'ArrowUp', false );
	f.layer.poll( 1 / 60 );
	assert.equal( f.input.move.z, 0 );

} );

test( 'alternate dodge keys retain the action and create one press edge', () => {

	const f = fixture();
	f.key( 'Space' );
	f.input.pressed.clear();
	f.key( 'ShiftLeft' );
	assert.equal( f.input.pressed.size, 0 );
	f.key( 'Space', false );
	assert.equal( f.input.held.has( 'dodge' ), true );
	f.key( 'ShiftLeft', false );
	assert.equal( f.input.held.has( 'dodge' ), false );

} );

test( 'touch pointers and a mouse own the same action independently, including cancellation', () => {

	const f = fixture();
	const button = new EventTarget();
	const classes = new Set();
	button.classList = { add: ( key ) => classes.add( key ), remove: ( key ) => classes.delete( key ) };
	f.layer.bindButton( button, 'attack' );
	f.mouse( 0 );
	event( button, 'pointerdown', { pointerType: 'touch', pointerId: 1, clientX: 100, clientY: 100 } );
	event( button, 'pointerdown', { pointerType: 'touch', pointerId: 2, clientX: 100, clientY: 100 } );
	f.mouse( 0, false );
	event( button, 'pointercancel', { pointerType: 'touch', pointerId: 1 } );
	assert.equal( f.input.held.has( 'attack' ), true );
	event( button, 'pointerup', { pointerType: 'touch', pointerId: 2 } );
	assert.equal( f.input.held.has( 'attack' ), false );
	assert.equal( f.layer.btn.size, 0 );

} );

test( 'blur clears touch visuals, pinch state and pointer ownership', () => {

	const f = fixture();
	const button = new EventTarget();
	const classes = new Set();
	button.classList = { add: ( key ) => classes.add( key ), remove: ( key ) => classes.delete( key ) };
	f.layer.bindButton( button, 'attack' );
	event( button, 'pointerdown', { pointerType: 'touch', pointerId: 1, clientX: 100, clientY: 100 } );
	f.layer.touches.set( 2, { x: 200, y: 100 } );
	f.layer.stick = { id: 3 };
	f.input.touchAim.active = true;
	event( f.win, 'blur' );
	assert.equal( f.input.held.size, 0 );
	assert.equal( f.layer.btn.size, 0 );
	assert.equal( f.layer.touches.size, 0 );
	assert.equal( f.layer.stick, null );
	assert.equal( f.input.touchAim.active, false );
	assert.equal( classes.has( 'down' ), false );

} );

test( 'multiple gamepad buttons mapped to one action own it independently', () => {

	const f = fixture();
	f.pads( [ pad( 0, [ 1, 11 ] ) ] ); f.layer.pollGamepad( 1 / 60 );
	f.pads( [ pad( 0, [ 11 ] ) ] ); f.layer.pollGamepad( 1 / 60 );
	assert.equal( f.input.held.has( 'dodge' ), true );
	f.pads( [ pad() ] ); f.layer.pollGamepad( 1 / 60 );
	assert.equal( f.input.held.has( 'dodge' ), false );

} );

test( 'polling a disconnected pad releases only controller-owned actions', () => {

	const f = fixture();
	f.mouse( 0 );
	f.pads( [ pad( 0, [ 0, 1 ] ) ] ); f.layer.pollGamepad( 1 / 60 );
	f.pads( [] ); f.layer.pollGamepad( 1 / 60 );
	assert.equal( f.input.held.has( 'attack' ), true );
	assert.equal( f.input.held.has( 'dodge' ), false );
	f.mouse( 0, false );
	assert.equal( f.input.held.size, 0 );

} );

test( 'disconnect event releases the active pad immediately but ignores another pad', () => {

	const f = fixture();
	f.pads( [ pad( 0, [ 0 ] ) ] ); f.layer.pollGamepad( 1 / 60 );
	event( f.win, 'gamepaddisconnected', { gamepad: { index: 1 } } );
	assert.equal( f.input.held.has( 'attack' ), true );
	event( f.win, 'gamepaddisconnected', { gamepad: { index: 0 } } );
	assert.equal( f.input.held.has( 'attack' ), false );
	assert.equal( f.input.pressed.has( 'attack' ), false );

} );

test( 'switching controllers releases old actions and processes the new button state', () => {

	const f = fixture();
	f.pads( [ pad( 0, [ 0 ] ) ] ); f.layer.pollGamepad( 1 / 60 );
	f.pads( [ pad( 1, [ 2 ] ) ] ); f.layer.pollGamepad( 1 / 60 );
	assert.equal( f.input.held.has( 'attack' ), false );
	assert.equal( f.input.held.has( 'skill1' ), true );
	assert.equal( f.input.pressed.has( 'skill1' ), true );

} );

test( 'blur suspends polling and focus resumes held gameplay without a new press or menu toggle', () => {

	const f = fixture();
	f.pads( [ pad( 0, [ 0, 9 ] ) ] ); f.layer.pollGamepad( 1 / 60 );
	assert.deepEqual( f.ui, [ 'pause' ] );
	f.layer.moveOwned = true;
	f.input.move.z = - 1;
	event( f.win, 'blur' );
	assert.equal( f.input.held.size, 0 );
	assert.equal( f.input.pressed.size, 0 );
	assert.equal( f.input.move.z, 0 );
	f.layer.pollGamepad( 1 / 60 );
	assert.equal( f.input.held.size, 0 );
	event( f.win, 'focus' );
	f.layer.pollGamepad( 1 / 60 );
	assert.equal( f.input.held.has( 'attack' ), true );
	assert.equal( f.input.pressed.size, 0 );
	assert.deepEqual( f.ui, [ 'pause' ] );
	f.pads( [ pad() ] ); f.layer.pollGamepad( 1 / 60 );
	f.pads( [ pad( 0, [ 0 ] ) ] ); f.layer.pollGamepad( 1 / 60 );
	assert.equal( f.input.pressed.has( 'attack' ), true );

} );

test( 'visibility loss releases player input and preserves unrelated bot actions', () => {

	const f = fixture();
	f.input.held.add( 'skill3' );
	f.input.pressed.add( 'skill3' );
	f.key( 'Space' );
	f.doc.hidden = true; event( f.doc, 'visibilitychange' );
	assert.deepEqual( [ ...f.input.held ], [ 'skill3' ] );
	assert.deepEqual( [ ...f.input.pressed ], [ 'skill3' ] );
	f.doc.hidden = false; event( f.doc, 'visibilitychange' );
	f.key( 'Space' );
	assert.equal( f.input.held.has( 'dodge' ), true );

} );

test( 'gamepad permission failure safely releases already-held controller input', () => {

	const f = fixture();
	f.pads( [ pad( 0, [ 0 ] ) ] ); f.layer.pollGamepad( 1 / 60 );
	navigator.getGamepads = () => { throw new Error( 'Permissions policy' ); };
	assert.doesNotThrow( () => f.layer.pollGamepad( 1 / 60 ) );
	assert.equal( f.input.held.size, 0 );
	assert.equal( f.layer.noPads, true );

} );

test( 'nonstandard controllers are ignored and cannot hold an old controller action', () => {

	const f = fixture();
	f.pads( [ pad( 0, [ 0 ] ) ] ); f.layer.pollGamepad( 1 / 60 );
	f.pads( [ { ...pad( 0, [ 0 ] ), mapping: '' } ] ); f.layer.pollGamepad( 1 / 60 );
	assert.equal( f.input.held.size, 0 );

} );

test( 'rebinding an already-held key releases its previous action without latching', () => {

	const f = fixture();
	f.key( 'Space' );
	controls.bind( 'keyboard', 'attack', 'Space' );
	assert.equal( f.input.held.has( 'dodge' ), false );
	f.key( 'Space', false );
	f.key( 'Space' );
	assert.equal( f.input.held.has( 'attack' ), true );
	f.key( 'Space', false );
	assert.equal( f.input.held.size, 0 );

} );

test( 'unbound mouse buttons do not attack and rebound mouse buttons use the chosen action', () => {

	const f = fixture();
	f.mouse( 1 );
	assert.equal( f.input.held.size, 0 );
	controls.bind( 'keyboard', 'dodge', 'Mouse1' );
	f.mouse( 1 );
	assert.equal( f.input.held.has( 'dodge' ), true );
	f.mouse( 1, false );
	assert.equal( f.input.held.size, 0 );

} );

test( 'recording input suspends gameplay and editable targets do not activate controls', () => {

	const f = fixture();
	controls.capturing = true;
	f.key( 'Space' ); f.mouse( 0 );
	f.pads( [ pad( 0, [ 0 ] ) ] ); f.layer.pollGamepad( 1 / 60 );
	assert.equal( f.input.held.size, 0 );
	controls.capturing = false;
	const e = new Event( 'keydown', { cancelable: true } );
	Object.defineProperty( e, 'target', { value: { isContentEditable: true } } );
	Object.assign( e, { code: 'Space', repeat: false } );
	f.win.dispatchEvent( e );
	assert.equal( f.input.held.size, 0 );

} );

test( 'rebound browser navigation keys prevent their default action', () => {

	const f = fixture();
	controls.bind( 'keyboard', 'attack', 'Tab' );
	const e = f.key( 'Tab' );
	assert.equal( e.defaultPrevented, true );
	assert.equal( f.input.held.has( 'attack' ), true );

} );
