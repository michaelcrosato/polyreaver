// Merchant panel (service 'vendor', also 'gamble'): buy from a stock that refreshes
// every town visit, sell by clicking / dragging your items, buy back recent sales,
// gamble gold on unidentified items of a chosen slot, and buy basic currency.

import { define, get } from '../../../core/registry.js';
import { h } from '../../../ui/shell.js';
import { PG, ItemGrid, inventoryGrid, panelHead, hideTip, dirty, sellZone, toast, showItemTip, btn } from './common.js';
import { vendorStock, buyCurrency, currencyPrice, CURRENCY_SHOP, gamble, gamblePrice, GAMBLE_SLOTS } from '../inventory.js';
import { currencyIcon } from './icons.js';
import { itemName } from '../items.js';

const TABS = [ [ 'buy', 'Buy' ], [ 'buyback', 'Buyback' ], [ 'gamble', 'Gamble' ], [ 'currency', 'Currency' ] ];

define( 'uiPanel', { id: 'vendor', order: 60, modal: true, startOpen: false,
	mount( ui ) {

		PG.ui = ui; PG.game = ui.game;
		this.tab = 'buy';
		this.gold = h( 'span', { class: 'pg-gold' } );
		this.tabs = h( 'div', { class: 'pg-tabs' }, TABS.map( ( [ id, label ] ) => h( 'button', { class: 'pg-btn', 'data-tab': id, text: label, onclick: () => this.show( id ) } ) ) );
		this.stock = new ItemGrid( { count: 20, cols: 8, loc: ( i ) => ( { where: 'vendor', index: i } ), item: ( i ) => ui.game.save.vendor.stock[ i ]?.item ?? null,
			badge: ( item, i ) => short( ui.game.save.vendor.stock[ i ]?.price ) } );
		this.buyback = new ItemGrid( { count: 12, cols: 8, loc: ( i ) => ( { where: 'buyback', index: i } ), item: ( i ) => ui.game.save.vendor.buyback[ i ]?.item ?? null,
			badge: ( item, i ) => short( ui.game.save.vendor.buyback[ i ]?.price ) } );
		this.gambleEl = h( 'div' );
		this.currEl = h( 'div', { class: 'pg-list' } );
		this.body = h( 'div' );
		this.inv = inventoryGrid();
		this.note = h( 'div', { class: 'pg-dim pg-small', style: { margin: '6px 0' } } );
		return h( 'div', { class: 'pg-panel pg-center' },
			panelHead( 'Merchant', 'vendor', this.gold ),
			h( 'div', { class: 'pg-cols' },
				h( 'div', {}, this.tabs, this.body, this.note ),
				h( 'div', {}, h( 'h3', { text: 'Your items - click to sell' } ), this.inv.el, h( 'div', { style: { marginTop: '6px' } }, sellZone() ) ) ) );

	},
	show( tab ) {

		this.tab = tab;
		hideTip();
		for ( const b of this.tabs.children ) b.classList.toggle( 'pg-on', b.dataset.tab === tab );
		const el = { buy: this.stock.el, buyback: this.buyback.el, gamble: this.gambleEl, currency: this.currEl }[ tab ];
		this.body.replaceChildren( el );
		this.note.textContent = {
			buy: `Stock refreshes every time you return to town. ${matchMedia( '(pointer: coarse)' ).matches ? 'Tap an item for details and Buy.' : 'Hover for details, click to buy.'}`,
			buyback: 'Items you sold recently, at the price you sold them for.',
			gamble: 'Pay for an unidentified item of the chosen kind: 70% magic, 26% rare, 4% unique.',
			currency: 'Basic crafting orbs. Rarer orbs only drop from monsters.'
		}[ tab ];
		this.v = - 1;

	},
	renderGamble() {

		const game = PG.game, price = gamblePrice( game.save.level );
		this.gambleEl.replaceChildren( h( 'div', { class: 'pg-list', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))' } }, GAMBLE_SLOTS.map( ( [ slot, label ] ) => {

			const b = btn( [ h( 'div', { text: label } ), h( 'div', { class: 'pg-gold pg-small', text: `${price.toLocaleString()} gold` } ) ], () => {

				const r = gamble( game, slot );
				if ( ! r.ok ) toast( r.reason, 'error' );
				else {

					toast( `Gambled: ${itemName( r.item )}`, r.item.rarity === 'unique' || r.item.rarity === 'rare' ? r.item.rarity : '' );
					showItemTip( r.item, b, { compare: true } );

				}

				dirty();

			}, { disabled: game.save.gold < price } );
			return b;

		} ) ) );

	},
	renderCurrency() {

		const game = PG.game;
		this.currEl.replaceChildren( ...Object.keys( CURRENCY_SHOP ).map( ( id ) => {

			const def = get( 'currency', id ), price = currencyPrice( id, game.save.level );
			const buy = ( n ) => {

				const r = buyCurrency( game, id, n );
				if ( ! r.ok ) toast( r.reason, 'error' );
				dirty();

			};

			return h( 'div', { class: 'pg-li' }, h( 'img', { src: currencyIcon( id ), width: 28, height: 28, alt: '' } ),
				h( 'div', { class: 'pg-grow' }, h( 'div', { text: `${def.name} (you have ${game.save.currencies[ id ] ?? 0})` } ), h( 'div', { class: 'pg-dim pg-small', text: def.desc } ) ),
				h( 'span', { class: 'pg-gold pg-small', text: `${price.toLocaleString()}` } ),
				btn( 'Buy', () => buy( 1 ), { disabled: game.save.gold < price } ),
				btn( '×10', () => buy( 10 ), { disabled: game.save.gold < price * 10 } ) );

		} ) );

	},
	update( ui, game ) {

		this.gold.textContent = `${game.save.gold.toLocaleString()} gold`;
		if ( this.v === PG.version ) return;
		this.v = PG.version;
		vendorStock( game );
		this.stock.resize( Math.max( 16, game.save.vendor.stock.length ) );
		this.stock.render();
		this.buyback.render();
		this.inv.render();
		if ( this.tab === 'gamble' ) this.renderGamble();
		if ( this.tab === 'currency' ) this.renderCurrency();

	},
	onOpen() {

		this.show( this.openTab || 'buy' );
		this.openTab = null;

	},
	onClose() {

		hideTip();

	}
} );

function short( n ) {

	if ( n === undefined ) return '';
	return n >= 10000 ? Math.round( n / 1000 ) + 'k' : n >= 1000 ? ( n / 1000 ).toFixed( 1 ) + 'k' : String( n );

}

// The world feature's town client opens panels by service id; the Merchant's 'gamble'
// service is the vendor panel's Gamble tab, so this alias forwards it.
define( 'uiPanel', { id: 'gamble', order: 63, startOpen: false,
	mount: () => h( 'div', { class: 'hidden' } ),
	onOpen( ui ) {

		ui.open( 'gamble', false );
		ui.panels.get( 'vendor' ).def.openTab = 'gamble';
		ui.open( 'vendor', true );

	}
} );
