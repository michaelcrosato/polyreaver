// Blacksmith panel (service 'craft'): pick an item (inventory or equipped), pick a
// currency orb, apply. Each orb explains why it cannot be used on the selected item.
// The previous version of the item stays visible after a craft, so the outcome of a
// Chaos Orb or a Vaal corruption can be compared line by line. Quality (+5% per
// step, max 20%) costs gold.

import { define, all, get } from '../../../core/registry.js';
import { h } from '../../../ui/shell.js';
import { PG, inventoryGrid, panelHead, hideTip, dirty, toast, getAt, btn, showTextTip } from './common.js';
import { applyCurrency, canApplyCurrency, improveQuality, canImproveQuality, qualityCost } from '../inventory.js';
import { equipmentCells, renderEquipment } from './inventory.js';
import { describeItem } from '../items.js';
import { currencyIcon } from './icons.js';

function itemCard( item, title ) {

	if ( ! item ) return h( 'div', { class: 'pg-li pg-dim', style: { minHeight: '80px', justifyContent: 'center' } }, 'Select an item from your inventory or equipment.' );
	const d = describeItem( item );
	const color = { normal: '#e8e8e8', magic: '#8fb0ff', rare: '#ffe066', unique: '#ff9a3c' }[ item.rarity ];
	return h( 'div', { class: 'pg-li', style: { display: 'block' } },
		title ? h( 'div', { class: 'pg-dim pg-small', text: title } ) : null,
		h( 'div', { style: { color, fontWeight: 700, fontSize: '15px' }, text: d.name } ),
		d.name !== d.baseName ? h( 'div', { style: { color }, text: d.baseName } ) : null,
		h( 'div', { class: 'pg-dim pg-small', text: `Item level ${d.ilvl}${d.quality ? ` · ${d.quality}% quality` : ''}${d.corrupted ? ' · ' : ''}` }, d.corrupted ? h( 'span', { style: { color: '#ff5050' }, text: 'Corrupted' } ) : null ),
		...d.implicits.map( ( l ) => h( 'div', { style: { color: '#b9c7ff' }, text: l } ) ),
		...d.affixes.map( ( a ) => h( 'div', { style: { color: '#8fb0ff' } }, a.text, a.tier ? h( 'span', { class: 'pg-dim pg-small', text: `  ${a.kind === 'prefix' ? 'P' : 'S'}·T${a.tier}` } ) : null ) ),
		d.mechanic ? h( 'div', { style: { color: '#ffb35a' }, text: d.mechanic } ) : null );

}

define( 'uiPanel', { id: 'craft', order: 62, modal: true, startOpen: false,
	mount( ui ) {

		PG.ui = ui; PG.game = ui.game;
		this.gold = h( 'span', { class: 'pg-gold' } );
		this.card = h( 'div' );
		this.before = h( 'div' );
		this.orbs = h( 'div', { class: 'pg-list', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' } } );
		this.quality = h( 'div', { class: 'pg-row', style: { marginTop: '8px' } } );
		this.cells = equipmentCells();
		this.inv = inventoryGrid();
		return h( 'div', { class: 'pg-panel pg-center' },
			panelHead( 'Blacksmith', 'craft', this.gold ),
			h( 'div', { class: 'pg-cols' },
				h( 'div', {}, h( 'h3', { text: 'Item' } ), this.card, this.before, h( 'h3', { text: 'Currency' } ), this.orbs, this.quality ),
				h( 'div', {}, h( 'h3', { text: 'Equipped - click to select' } ), h( 'div', { class: 'pg-doll' }, [ 'weapon', 'helm', 'amulet', 'offhand', 'chest', 'ring1', 'gloves', 'belt', 'ring2', 'boots' ].map( ( s ) => this.cells[ s ] ) ),
					h( 'h3', { text: 'Inventory - click to select' } ), this.inv.el ) ) );

	},
	apply( id ) {

		const game = PG.game;
		const r = applyCurrency( game, id, PG.craftSel );
		if ( ! r.ok ) toast( r.reason, 'error' );
		else {

			this.prev = r.before;
			const out = r.item.corruptOutcome ? ` (${r.item.corruptOutcome})` : '';
			toast( `${get( 'currency', id ).name} applied${out}`, r.item.rarity === 'unique' ? 'unique' : r.item.rarity === 'rare' ? 'rare' : '' );

		}

		dirty();

	},
	update( ui, game ) {

		this.gold.textContent = `${game.save.gold.toLocaleString()} gold`;
		if ( this.v === PG.version ) return;
		this.v = PG.version;
		const loc = PG.craftSel;
		const item = loc ? getAt( game.save, loc ) : null;
		if ( loc && ! item ) PG.craftSel = null;
		this.card.replaceChildren( itemCard( item ) );
		this.before.replaceChildren( this.prev && item && this.prev.uid === item.uid ? h( 'div', { style: { marginTop: '6px', opacity: 0.75 } }, itemCard( this.prev, 'Before the last craft:' ) ) : '' );
		this.orbs.replaceChildren( ...all( 'currency' ).map( ( def ) => {

			const n = game.save.currencies[ def.id ] ?? 0;
			const why = item ? canApplyCurrency( game, def.id, loc ) : 'Select an item first';
			const row = h( 'div', { class: 'pg-li' + ( why ? '' : ' pg-click' ), style: { opacity: why ? 0.5 : 1 } },
				h( 'img', { src: currencyIcon( def.id ), width: 26, height: 26, alt: '' } ),
				h( 'div', { class: 'pg-grow' }, h( 'div', { class: 'pg-small', text: def.short || def.name } ), h( 'div', { class: 'pg-dim pg-small', text: `× ${n}` } ) ) );
			row.addEventListener( 'pointerenter', ( e ) => e.pointerType !== 'touch' && showTextTip( def.name, [ def.desc, why ? `Cannot use: ${why}` : 'Click to apply' ], row, { lineClass: 't-prop' } ) );
			row.addEventListener( 'pointerleave', hideTip );
			row.addEventListener( 'click', () => {

				hideTip();
				if ( why ) toast( why, 'error' ); else this.apply( def.id );

			} );
			return row;

		} ) );
		const qWhy = item ? canImproveQuality( game, loc ) : 'Select an item first';
		this.quality.replaceChildren(
			btn( item ? `Improve quality +5% (${qualityCost( item ).toLocaleString()} gold)` : 'Improve quality', () => {

				const r = improveQuality( game, loc );
				if ( ! r.ok ) toast( r.reason, 'error' );
				dirty();

			}, { disabled: !! qWhy, title: qWhy || 'Quality increases physical damage (weapons), defences (armour) or flask effect' } ),
			h( 'span', { class: 'pg-dim pg-small', text: qWhy && item ? qWhy : '' } ) );
		renderEquipment( this.cells );
		for ( const [ slot, cell ] of Object.entries( this.cells ) ) cell.classList.toggle( 'pg-sel', loc?.where === 'equip' && loc.slot === slot );
		this.inv.render();
		this.inv.cells.forEach( ( c, i ) => c.classList.toggle( 'pg-sel', loc?.where === 'inv' && loc.index === i ) );

	},
	onOpen() {

		this.v = - 1;
		this.prev = null;

	},
	onClose() {

		hideTip();

	}
} );
