// Combat presentation settings (camera mode, volumes, shake, numbers, aim assist,
// touch controls). Per-device conveniences, so they live in localStorage - never
// in the character save. Reads and writes are wrapped: private windows and blocked
// storage simply fall back to the defaults.

const KEY = 'polyreaver.combat.v1';

export const DEFAULTS = {
	camera: 'iso', // 'iso' | 'chase' | 'top'
	zoom: 1, // 0.55 .. 1.6 (wheel / pinch)
	master: 0.8,
	sfx: 0.9,
	shake: 1, // 0 .. 1.5 camera shake scale
	hitstop: true,
	numbers: true, // floating damage numbers
	touch: 'auto', // 'auto' | 'on' | 'off' - on-screen twin-stick controls
	lights: 'auto' // 'auto' | 'high' | 'low' dynamic light budget
};

export const settings = { ...DEFAULTS };
const listeners = new Set();

try {

	Object.assign( settings, JSON.parse( localStorage.getItem( KEY ) || '{}' ) );

} catch { /* defaults */ }

export function setSetting( key, value ) {

	settings[ key ] = value;
	try {

		localStorage.setItem( KEY, JSON.stringify( settings ) );

	} catch { /* not persisted - still applies this session */ }

	for ( const fn of listeners ) fn( key, value );

}

export function onSetting( fn ) {

	listeners.add( fn );
	return () => listeners.delete( fn );

}

// Is this a phone / tablet? Coarse pointer and no hover is the robust signal.
export const isTouchDevice = () => typeof matchMedia === 'function' && matchMedia( '(pointer: coarse)' ).matches && ! matchMedia( '(hover: hover)' ).matches;
