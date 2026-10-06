// Binding editor reached from the pause menu. Recording consumes input before
// gameplay sees it; held controller buttons must be released before recording.
import { define } from '../../../core/registry.js';
import { h } from '../../../ui/shell.js';
import { controls, CONTROL_ACTIONS, bindingLabel, validBinding } from './controls.js';

function padSnapshot() {

	try {

		return new Map( [ ...navigator.getGamepads?.() ?? [] ].filter( ( p ) => p?.connected && p.mapping === 'standard' ).map( ( p ) => [ p.index, p.buttons.map( ( b ) => b.pressed || b.value > 0.4 ) ] ) );

	} catch { return new Map(); }

}

define( 'uiPanel', { id: 'controls', order: 86, modal: true, startOpen: false, pauseButton: 'Controls',
	mount( ui ) {

		this.ui = ui;
		this.device = 'keyboard';
		this.capture = null;
		this.status = h( 'p', { class: 'controls-status', role: 'status', 'aria-live': 'polite', text: 'Preferences apply to this device, across all characters.' } );
		this.rows = h( 'div', { class: 'controls-rows' } );
		this.tabButtons = [ 'keyboard', 'gamepad' ].map( ( device ) => h( 'button', { text: device === 'keyboard' ? 'Keyboard & mouse' : 'Gamepad', onclick: () => {

			this.cancelCapture();
			this.device = device;
			this.renderRows();

		} } ) );
		this.cancelButton = h( 'button', { text: 'Cancel recording', class: 'hidden', 'data-controls-cancel': '', onclick: () => this.cancelCapture() } );
		const reset = ( device ) => {

			this.cancelCapture();
			const r = controls.reset( device );
			this.message( `Restored ${device === 'keyboard' ? 'keyboard & mouse' : device === 'gamepad' ? 'gamepad' : 'all'} defaults.`, r );
			this.renderRows();

		};
		const root = h( 'div', { class: 'panel menu controls-menu' },
			h( 'h2', { text: 'Controls' } ),
			h( 'p', { class: 'dim', text: 'Add alternate bindings or remove them with ×. An input can belong to one action per device; assigning it moves it from its previous action. Touch buttons and stick axes keep their default behavior.' } ),
			h( 'div', { class: 'btns' }, ...this.tabButtons ),
			this.status, this.cancelButton, this.rows,
			h( 'div', { class: 'btns' },
				h( 'button', { text: 'Reset this device', onclick: () => reset( this.device ) } ),
				h( 'button', { text: 'Reset all controls', onclick: () => reset() } ),
				h( 'button', { text: 'Back to menu', onclick: () => {

					ui.open( 'controls', false );
					ui.open( 'pause', true );

				} } ), h( 'button', { text: 'Resume', onclick: () => ui.open( 'controls', false ) } ) ) );
		document.head.append( h( 'style', { text: CSS } ) );
		addEventListener( 'keydown', ( e ) => {

			if ( ! this.capture ) return;
			e.preventDefault();
			e.stopImmediatePropagation();
			if ( e.repeat ) return;
			if ( e.code === 'Escape' ) return this.cancelCapture();
			if ( this.device === 'keyboard' ) this.assign( e.code );

		}, true );
		addEventListener( 'pointerdown', ( e ) => {

			if ( ! this.capture || e.pointerType !== 'mouse' || e.target?.closest?.( '[data-controls-cancel]' ) ) return;
			e.preventDefault();
			e.stopImmediatePropagation();
			if ( this.device === 'keyboard' ) this.assign( 'Mouse' + e.button );

		}, true );
		addEventListener( 'blur', () => this.cancelCapture() );
		document.addEventListener( 'visibilitychange', () => document.hidden && this.cancelCapture() );
		this.renderRows();
		return root;

	},
	message( text, result ) {

		this.status.textContent = text + ( result?.persisted === false ? ' Storage is unavailable; this change applies only for this session.' : '' );

	},
	renderRows() {

		this.revision = controls.revision;
		this.tabButtons.forEach( ( el, i ) => {

			const selected = ( i === 0 ? 'keyboard' : 'gamepad' ) === this.device;
			el.classList.toggle( 'on', selected );
			el.setAttribute( 'aria-pressed', String( selected ) );

		} );
		this.rows.replaceChildren( ...CONTROL_ACTIONS.map( ( { id, label } ) => {

			const values = controls.bindings[ this.device ][ id ];
			return h( 'div', { class: 'controls-row' }, h( 'span', { text: label } ),
				h( 'div', { class: 'controls-bindings' }, values.length ? values.map( ( value ) => h( 'button', {
					text: bindingLabel( this.device, value ) + ' ×', title: 'Remove ' + bindingLabel( this.device, value ),
					'aria-label': `Remove ${bindingLabel( this.device, value )} from ${label}`,
					onclick: () => {

						const r = controls.unbind( this.device, id, value );
						this.message( `Removed ${bindingLabel( this.device, value )} from ${label}.`, r );
						this.renderRows();

					}
				} ) ) : h( 'span', { class: 'dim', text: 'Unbound' } ) ),
				h( 'button', { text: 'Add', 'aria-label': 'Add binding for ' + label, disabled: values.length >= 4 ? true : null, onclick: () => this.beginCapture( id ) } ) );

		} ) );

	},
	beginCapture( action ) {

		this.cancelCapture();
		this.ui.game.rc?.input?.releaseAll();
		this.capture = action;
		controls.capturing = true;
		this.padPrevious = padSnapshot();
		this.cancelButton.classList.remove( 'hidden' );
		const label = CONTROL_ACTIONS.find( ( a ) => a.id === action ).label;
		this.message( this.device === 'keyboard' ? `Press a key or mouse button for ${label}. Escape cancels.` : `Press a standard gamepad button for ${label}. Release held buttons first. Escape cancels.` );

	},
	cancelCapture() {

		if ( this.capture ) this.message( 'Recording cancelled.' );
		this.capture = null;
		controls.capturing = false;
		this.cancelButton?.classList.add( 'hidden' );

	},
	assign( value ) {

		if ( ! this.capture ) return;
		if ( ! validBinding( this.device, value ) ) return this.message( 'That input cannot be bound. Choose a regular key, mouse button, or standard gamepad button.' );
		const action = this.capture, device = this.device;
		const r = controls.bind( device, action, value );
		this.cancelCapture();
		const label = CONTROL_ACTIONS.find( ( a ) => a.id === action ).label;
		const conflicts = r.conflicts?.map( ( id ) => CONTROL_ACTIONS.find( ( a ) => a.id === id ).label ).join( ', ' );
		this.message( r.ok ? `${bindingLabel( device, value )} → ${label}.${conflicts ? ' Removed from ' + conflicts + '.' : ''}` : r.reason, r );
		this.renderRows();

	},
	onOpen( ui ) {

		ui.game.rc?.input?.releaseAll();
		this.renderRows();

	},
	onClose() {

		this.cancelCapture();

	},
	update() {

		if ( this.revision !== controls.revision ) this.renderRows();
		if ( ! this.capture || this.device !== 'gamepad' ) return;
		const current = padSnapshot();
		for ( const [ index, buttons ] of current ) {

			const previous = this.padPrevious.get( index );
			if ( ! previous ) continue;
			for ( let i = 0; i < buttons.length; i ++ ) if ( buttons[ i ] && ! previous[ i ] ) {

				this.assign( i );
				return;

			}

		}
		this.padPrevious = current;

	}
} );

const CSS = `
.controls-menu { width: min(660px, 94vw); }
.controls-status { min-height: 2.5em; color: var(--accent); }
.controls-menu button.on { border-color: var(--accent); color: var(--accent); }
.controls-row { display: grid; grid-template-columns: minmax(115px, 1fr) minmax(110px, 2fr) auto; gap: 10px; align-items: center; padding: 6px 0; border-bottom: 1px solid var(--line); }
.controls-bindings { display: flex; flex-wrap: wrap; gap: 4px; }
.controls-bindings button { padding: 4px 8px; font-size: 12px; }
@media (max-width: 440px) { .controls-row { grid-template-columns: 100px 1fr auto; gap: 5px; font-size: 12px; } }
`;
