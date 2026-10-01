// Stash panel (service 'stash'): tabs of 60 cells shared by the character, more tabs
// for gold. Click moves items between stash and inventory, drag to place exactly.

import { define } from '../../../core/registry.js';
import { h } from '../../../ui/shell.js';
import { PG, ItemGrid, inventoryGrid, panelHead, hideTip, dirty, toast } from './common.js';
import { buyStashTab, stashTabCost, stashItem } from '../inventory.js';
import { MAX_STASH_TABS } from '../save.js';

define( 'uiPanel', { id: 'stash', order: 61, modal: true, startOpen: false,
	mount( ui ) {

		PG.ui = ui; PG.game = ui.game;
		this.gold = h( 'span', { class: 'pg-gold' } );
		this.tabs = h( 'div', { class: 'pg-tabs' } );
		this.grid = new ItemGrid( { count: 60, cols: 10, loc: ( i ) => ( { where: 'stash', tab: PG.stashTab, index: i } ), item: ( i ) => ui.game.save.stash.tabs[ PG.stashTab ]?.items[ i ] ?? null } );
		this.inv = inventoryGrid();
		return h( 'div', { class: 'pg-panel pg-center' },
			panelHead( 'Stash', 'stash', this.gold ),
			h( 'div', { class: 'pg-cols' },
				h( 'div', {}, this.tabs, this.grid.el ),
				h( 'div', {}, h( 'h3', { text: 'Inventory - click to stash' } ), this.inv.el,
					h( 'div', { class: 'pg-row', style: { marginTop: '8px' } }, h( 'button', { class: 'pg-btn', text: 'Deposit all', onclick: () => {

						const items = ui.game.save.inventory.items;
						let n = 0;
						for ( let i = 0; i < items.length; i ++ ) if ( items[ i ] && stashItem( ui.game, { where: 'inv', index: i }, PG.stashTab ).ok ) n ++;
						toast( n ? `Stashed ${n} items` : 'Nothing stashed (tab full?)' );
						dirty();

					} } ) ) ) ) );

	},
	renderTabs() {

		const save = PG.game.save;
		const tabs = save.stash.tabs.map( ( t, i ) => h( 'button', { class: 'pg-btn' + ( i === PG.stashTab ? ' pg-on' : '' ), text: t.name, onclick: () => {

			PG.stashTab = i;
			hideTip();
			dirty();

		} } ) );
		if ( save.stash.tabs.length < MAX_STASH_TABS ) tabs.push( h( 'button', { class: 'pg-btn', title: 'Buy another stash tab', onclick: () => {

			const r = buyStashTab( PG.game );
			if ( ! r.ok ) toast( r.reason, 'error' );
			dirty();

		} }, `+ Tab (${stashTabCost( save ).toLocaleString()} gold)` ) );
		this.tabs.replaceChildren( ...tabs );

	},
	update( ui, game ) {

		this.gold.textContent = `${game.save.gold.toLocaleString()} gold`;
		if ( this.v === PG.version ) return;
		this.v = PG.version;
		PG.stashTab = Math.min( PG.stashTab, game.save.stash.tabs.length - 1 );
		this.renderTabs();
		this.grid.render();
		this.inv.render();

	},
	onOpen() {

		this.v = - 1;

	},
	onClose() {

		hideTip();

	}
} );
