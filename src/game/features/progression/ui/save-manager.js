// Character save controls: explicit replacement previews, portable JSON, a
// previous snapshot and original damaged data. A small HUD button keeps saving
// failures visible even when the panel is closed.
import { define } from '../../../core/registry.js';
import { h } from '../../../ui/shell.js';
import { btn, panelHead, dirty, PG } from './common.js';
import { exportCharacter, parseCharacter, MAX_SAVE_BYTES } from '../persistence.js';

const summary = ( save ) => `${save.name} · level ${save.level} · depth ${save.maxDepth} · ${save.gold.toLocaleString()} gold`;

function download( text, name ) {

	const url = URL.createObjectURL( new Blob( [ text ], { type: 'application/json' } ) );
	const link = h( 'a', { href: url, download: name } );
	document.body.append( link ); link.click(); link.remove();
	setTimeout( () => URL.revokeObjectURL( url ), 1000 );

}

define( 'uiPanel', { id: 'save-status', order: 14,
	mount( ui ) {

		this.button = h( 'button', { class: 'pg-btn', 'aria-label': 'Character saves', onclick: () => ui.open( 'save-manager', true ), style: { position: 'absolute', top: '54px', right: '8px', minHeight: '36px', maxWidth: '180px', fontSize: '11px', pointerEvents: 'auto' } }, 'Character saves' );
		return this.button;

	},
	update( ui, game ) {

		const status = game.saves?.status;
		if ( ! status || this.status === status ) return;
		this.status = status;
		const warning = ! [ 'saved', 'ready' ].includes( status.code );
		this.button.textContent = warning ? 'Saves · ' + ( { readonly: 'another tab', conflict: 'conflict', error: 'save failed', unavailable: 'unavailable', recovery: 'recovery', repaired: 'repaired', session: 'fresh session' }[ status.code ] || status.code ) : 'Character saves · saved';
		this.button.style.borderColor = warning ? 'var(--accent)' : '';
		this.button.title = status.message;

	}
} );

define( 'uiPanel', { id: 'save-manager', order: 64, modal: true, startOpen: false, pauseButton: 'Character saves',
	mount( ui ) {

		PG.ui = ui; PG.game = ui.game;
		const game = ui.game;
		this.status = h( 'p', { role: 'status', 'aria-live': 'polite' } );
		this.current = h( 'p' );
		this.message = h( 'p', { role: 'status', 'aria-live': 'polite', style: { whiteSpace: 'pre-wrap' } } );
		this.json = h( 'textarea', { 'aria-label': 'Character JSON', placeholder: 'Paste a character export here, or choose a JSON file.', rows: 7, style: { width: '100%', resize: 'vertical', userSelect: 'text', pointerEvents: 'auto', touchAction: 'auto' } } );
		this.preview = h( 'p' );
		this.apply = btn( 'Use previewed character', () => this.run( async () => {

			if ( ! this.pending ) return;
			const pending = this.pending;
			if ( await game.saves.replace( pending ) ) {

				game.replaceCharacter( pending );
				this.pending = null; this.apply.disabled = true;
				this.preview.textContent = '';
				this.message.textContent = game.saves.mode === 'active' ? 'Character loaded in town. The previous stored character is available below.' : 'Character loaded for this session. Export it before closing this page; the stored character is protected.';
				dirty();

			} else this.message.textContent = game.saves.status.message;

		} ), { disabled: true } );
		const preview = ( save, label ) => {

			this.pending = save;
			this.preview.textContent = `${label}: ${summary( save )}. Using it replaces the current character and returns to town. The stored character becomes the previous save.`;
			this.apply.disabled = false;

		};
		this.previous = h( 'p' );
		this.restore = btn( 'Preview previous save', () => this.run( () => {

			const backup = game.saves.backup();
			if ( ! backup ) throw new Error( 'No usable previous save exists.' );
			preview( backup, 'Previous save' );

		} ) );
		this.recovery = h( 'p' );
		this.exportRecovery = btn( 'Export original recovery data', () => this.run( () => {

			const recovery = game.saves.recovery();
			if ( ! recovery?.raw ) throw new Error( 'No original recovery data exists.' );
			this.exportText( recovery.raw, 'polyreaver-recovery.json' );

		} ) );
		this.repairRecovery = btn( 'Preview repaired recovery', () => this.run( () => {

			const recovery = game.saves.recovery();
			if ( ! recovery?.raw ) throw new Error( 'No original recovery data exists.' );
			preview( parseCharacter( recovery.raw ).save, 'Recovered character' );

		} ) );
		const file = h( 'input', { type: 'file', accept: '.json,application/json', 'aria-label': 'Import character file', onchange: () => this.run( async () => {

			const selected = file.files?.[ 0 ];
			if ( ! selected ) return;
			if ( selected.size > MAX_SAVE_BYTES ) throw new Error( 'Choose a JSON file smaller than 4 MB.' );
			this.json.value = await selected.text();
			preview( parseCharacter( this.json.value, { strict: true } ).save, 'Imported character' );
			file.value = '';

		} ) } );
		return h( 'div', { class: 'pg-panel pg-center', style: { width: 'min(680px, calc(100vw - 16px))', maxHeight: 'calc(100dvh - 24px)', overflowY: 'auto', pointerEvents: 'auto', touchAction: 'pan-y' } },
			panelHead( 'Character saves', 'save-manager' ), this.current, this.status,
			h( 'div', { class: 'pg-row' },
				btn( 'Save now / retry', () => this.run( async () => { await game.saves.save( game.save ); this.message.textContent = game.saves.status.message; } ) ),
				btn( 'Export character', () => this.run( () => this.exportText( exportCharacter( game.save ), 'polyreaver-character.json' ) ) ),
				btn( 'Load latest character', () => this.run( async () => {

					const save = await game.saves.latest();
					if ( ! save ) throw new Error( game.saves.status.message );
					game.replaceCharacter( save ); dirty();
					this.message.textContent = 'Latest stored character loaded in town.';

				} ) ) ),
			h( 'h3', { text: 'Import or replace' } ), file, this.json,
			h( 'div', { class: 'pg-row' },
				btn( 'Validate and preview JSON', () => this.run( () => preview( parseCharacter( this.json.value, { strict: true } ).save, 'Imported character' ) ) ),
				btn( 'Preview this session for saving', () => this.run( () => preview( parseCharacter( exportCharacter( game.save ), { strict: true } ).save, 'This session' ) ) ),
				btn( 'Preview new character', () => this.run( () => preview( game.newSave(), 'New character' ) ) ) ),
			this.preview, this.apply,
			h( 'h3', { text: 'Previous save' } ), this.previous, this.restore,
			h( 'h3', { text: 'Recovery' } ), this.recovery,
			h( 'div', { class: 'pg-row' }, this.exportRecovery, this.repairRecovery ),
			this.message );

	},
	async run( fn ) {

		if ( this.busy ) return;
		this.busy = true;
		try { await fn(); }
		catch ( error ) { this.message.textContent = error.message; }
		finally { this.busy = false; this.apply.disabled = ! this.pending; }

	},
	exportText( text, name ) {

		this.json.value = text;
		this.message.textContent = 'JSON is available below to select and copy, as well as in the download.';
		try { download( text, name ); }
		catch { this.message.textContent = 'Download is unavailable here. Select and copy the JSON below.'; }

	},
	update( ui, game ) {

		const manager = game.saves;
		this.apply.disabled = this.busy || ! this.pending;
		this.current.textContent = summary( game.save );
		this.status.textContent = manager.status.message + ( manager.status.savedAt ? ` Last saved: ${new Date( manager.status.savedAt ).toLocaleTimeString()}.` : '' );
		if ( this.lastStatus === manager.status ) return;
		this.lastStatus = manager.status;
		const backup = manager.backup();
		this.previous.textContent = backup ? summary( backup ) : 'No usable previous snapshot is available yet.';
		this.restore.disabled = ! backup;
		const recovery = manager.recovery();
		this.recovery.textContent = recovery ? recovery.reason : 'No damaged save data has been found.';
		this.exportRecovery.disabled = this.repairRecovery.disabled = ! recovery?.raw;

	}
} );
