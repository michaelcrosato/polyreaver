// Inventory panel (I): equipment doll, flask belt, 60-cell bag, currency pouch and
// the auto-pickup filter. Non-modal - the game keeps running while it is open.
// Click an item to equip / unequip it (or sell / stash / craft when a service panel
// is open), drag it anywhere (including onto the world to drop it), hover for the
// tooltip with a comparison against what is equipped.

import { define, all } from '../../../core/registry.js';
import { h } from '../../../ui/shell.js';
import { PG, ItemGrid, inventoryGrid, panelHead, activeService, hideTip, bindCell, renderCell, showTextTip } from './common.js';
import { sortInventory, playerAttributes } from '../inventory.js';
import { EQUIP_SLOTS, SLOT_NAMES } from '../data/bases.js';
import { AUTO_PICKUP } from '../loot.js';
import { currencyIcon } from './icons.js';
import { meetsReq } from '../items.js';

// equipment doll placement (CSS grid: 4 columns x 3 rows)
const DOLL = { weapon: 's-weapon', helm: '', amulet: '', offhand: 's-offhand', chest: '', ring1: '', gloves: '', belt: '', ring2: '', boots: '' };
const DOLL_ORDER = [ 'weapon', 'helm', 'amulet', 'offhand', 'chest', 'ring1', 'gloves', 'belt', 'ring2', 'boots' ];

export function equipmentCells() {

	const cells = {};
	for ( const slot of DOLL_ORDER ) {

		const cell = h( 'div', { class: 'pg-cell ' + DOLL[ slot ] } );
		cell.dataset.loc = JSON.stringify( { where: 'equip', slot } );
		bindCell( cell, () => ( { where: 'equip', slot } ), () => PG.game.save.equipment[ slot ] );
		cells[ slot ] = cell;

	}

	return cells;

}

export function renderEquipment( cells ) {

	const game = PG.game, attrs = playerAttributes( game );
	for ( const slot of EQUIP_SLOTS ) {

		const item = game.save.equipment[ slot ];
		renderCell( cells[ slot ], item, { extraClass: DOLL[ slot ], slotName: SLOT_NAMES[ slot ], bad: item && meetsReq( item, attrs, game.save.level ).length > 0 } );

	}

}

export function flaskGrid() {

	return new ItemGrid( { count: 4, cols: 4, cls: 'pg-flaskrow', loc: ( i ) => ( { where: 'flask', index: i } ), item: ( i ) => PG.game.save.flasks.slots[ i ], slotName: () => 'Flask' } );

}

export function currencyStrip( el, { onPick = null, selected = null } = {} ) {

	const game = PG.game;
	const cur = game.save.currencies;
	const key = JSON.stringify( cur ) + selected;
	if ( el.dataset.key === key ) return;
	el.dataset.key = key;
	el.replaceChildren();
	for ( const def of all( 'currency' ) ) {

		const n = cur[ def.id ] ?? 0;
		if ( ! n && ! onPick ) continue;
		const chip = h( 'div', { class: 'pg-orb' + ( onPick ? ' pg-pick' : '' ) + ( ! n ? ' pg-off' : '' ) + ( selected === def.id ? ' pg-sel' : '' ) },
			h( 'img', { src: currencyIcon( def.id ), alt: '' } ), h( 'span', { text: `${n}` } ) );
		chip.addEventListener( 'pointerenter', ( e ) => e.pointerType !== 'touch' && showTextTip( def.name, [ def.desc, `You have ${n}` ], chip, { cls: 'r-plain', lineClass: 't-prop' } ) );
		chip.addEventListener( 'pointerleave', hideTip );
		if ( onPick ) chip.addEventListener( 'click', () => onPick( def.id ) );
		el.append( chip );

	}

	if ( ! el.children.length ) el.append( h( 'span', { class: 'pg-dim pg-small', text: 'No currency yet - orbs drop from monsters.' } ) );

}

define( 'uiPanel', { id: 'inventory', order: 40, toggle: 'inventory', modal: false,
	mount( ui ) {

		PG.ui = ui; PG.game = ui.game;
		this.gold = h( 'span', { class: 'pg-gold' } );
		this.cells = equipmentCells();
		this.flasks = flaskGrid();
		this.grid = inventoryGrid();
		this.curr = h( 'div', { class: 'pg-curr' } );
		this.attrs = h( 'div', { class: 'pg-dim pg-small', style: { textAlign: 'center', margin: '2px 0 8px' } } );
		const filter = h( 'select', { class: 'pg-select', title: 'Walk-over pickup: the lowest rarity picked up by walking over it', onchange: () => {

			ui.game.save.unlocks.autoPickup = filter.value;

		} }, AUTO_PICKUP.map( ( k ) => h( 'option', { value: k, text: k === 'none' ? 'Nothing' : k === 'normal' ? 'Everything' : `${k[ 0 ].toUpperCase() + k.slice( 1 )}+` } ) ) );
		this.filter = filter;
		return h( 'div', { class: 'pg-panel pg-inv' },
			panelHead( 'Inventory', 'inventory', this.gold ),
			h( 'div', { class: 'pg-doll' }, DOLL_ORDER.map( ( s ) => this.cells[ s ] ) ),
			this.flasks.el, this.attrs, this.grid.el, this.curr,
			h( 'div', { class: 'pg-row', style: { marginTop: '8px' } },
				h( 'button', { class: 'pg-btn', text: 'Sort', onclick: () => sortInventory( ui.game ) } ),
				h( 'label', { class: 'pg-small' }, 'Auto-pickup ', filter ),
				h( 'span', { class: 'pg-grow' } ),
				h( 'button', { class: 'pg-btn', text: 'Character', onclick: () => ui.toggle( 'character' ) } ) ),
			h( 'div', { class: 'pg-dim pg-small', style: { marginTop: '6px' }, text: matchMedia( '(pointer: coarse)' ).matches ? 'Tap an item for its details and actions · drag to move' : 'Click to equip · drag to move · drag onto the world to drop · F picks up nearby items' } ) );

	},
	update( ui, game ) {

		if ( activeService() ) {

			ui.open( 'inventory', false );
			return;

		}

		this.gold.textContent = `${game.save.gold.toLocaleString()} gold`;
		if ( this.v === PG.version && game.frameCount % 20 ) return;
		this.v = PG.version;
		renderEquipment( this.cells );
		this.flasks.render();
		this.grid.render();
		currencyStrip( this.curr );
		this.filter.value = game.save.unlocks.autoPickup ?? 'magic';
		const p = game.world?.player;
		const a = p?.data.progBuild?.attrs;
		if ( a && p ) this.attrs.textContent = `Str ${a.strength} · Dex ${a.dexterity} · Int ${a.intelligence} · Life ${Math.round( p.maxLife )} · Mana ${Math.round( p.maxMana )}${p.stats.get( 'shield' ) > 0 ? ` · ES ${Math.round( p.stats.get( 'shield' ) )}` : ''}`;

	},
	onOpen() {

		this.v = - 1;

	},
	onClose() {

		hideTip();

	}
} );
