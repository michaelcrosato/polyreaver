// Examples - presentation side: a small start panel per example mode, opened from the
// pause menu ( uiPanel pauseButton ). Loaded only in the browser, after every sim.js.

import { define } from '../../core/registry.js';
import { h } from '../../ui/shell.js';

define( 'uiPanel', { id: 'horde', order: 86, modal: true, startOpen: false, pauseButton: 'Horde mode',
	mount( ui ) {

		const waves = h( 'input', { type: 'number', min: 1, max: 50, value: 10, style: { width: '70px' } } );
		const start = () => {

			ui.open( 'horde', false );
			const r = ui.game.api( 'mode.horde', { waves: Math.max( 1, + waves.value || 10 ) } );
			ui.toast( `Horde: ${r.waves} waves of ${r.families.length} families`, 'objective' );

		};

		return h( 'div', { class: 'panel menu' },
			h( 'h2', { text: 'Horde' } ),
			h( 'p', { text: 'Wave survival in an arena at your level, then a champion. Loot and XP as usual; it does not unlock depths. An example game mode built in one small file (features/examples/horde.js).' } ),
			h( 'div', { class: 'btns' }, h( 'label', {}, 'Waves ', waves ), h( 'button', { text: 'Start', onclick: start } ), h( 'button', { text: 'Cancel', onclick: () => ui.open( 'horde', false ) } ) ) );

	}
} );
