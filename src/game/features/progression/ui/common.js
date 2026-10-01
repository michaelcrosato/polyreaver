// Shared UI pieces for the progression panels:
//   * item TOOLTIPS (PoE layout: rarity header, properties, requirements, implicit,
//     explicit mods with tier tags, unique mechanic, comparison to what is equipped)
//   * ItemGrid - a grid of item cells bound to save locations
//   * drag & drop between any cells (and onto the game canvas to drop on the ground)
//   * click / tap ACTIONS: one list per (location, open service) - a mouse click runs
//     the first action, a tap on a touch screen pins the tooltip with every action
//
// Panels re-render when game event 'inventory' fires (any item change) - see dirty().

import { h } from '../../../ui/shell.js';
import { get } from '../../../core/registry.js';
import { describeItem, computeItem, itemValue } from '../items.js';
import { simulateStats, compareStats } from '../stats.js';
import { getAt, moveItem, equipFrom, unequip, sellItem, buyItem, stashItem, removeAt, canEquip, slotFor, buyPrice, playerAttributes } from '../inventory.js';
import { meetsReq } from '../items.js';
import { spawnLoot } from '../loot.js';
import { itemIcon } from './icons.js';
import { RARITY_COLORS, fmt } from '../text.js';

export const PG = { ui: null, game: null, craftSel: null, stashTab: 0, version: 0 };

export function dirty() {

	PG.version ++;

}

export function toast( text, kind = '' ) {

	PG.ui?.toast( text, kind );

}

export const SERVICE_PANELS = [ 'vendor', 'stash', 'craft' ];

export function activeService() {

	for ( const id of SERVICE_PANELS ) if ( PG.ui?.isOpen( id ) ) return id;
	return null;

}

// A button; `disabled` is set as a property (the shell's h() would turn a null
// attribute value into the string "null", which still disables).
export function btn( label, fn, { disabled = false, cls = '', title = '' } = {} ) {

	const b = h( 'button', { class: 'pg-btn' + ( cls ? ' ' + cls : '' ), onclick: fn }, label );
	if ( title ) b.title = title;
	b.disabled = !! disabled;
	return b;

}

// Header row with a title, optional extra elements and a close button.
export function panelHead( title, id, ...extra ) {

	return h( 'div', { class: 'pg-head' }, h( 'h2', { text: title } ), h( 'span', { class: 'pg-grow' } ), ...extra,
		h( 'button', { class: 'pg-btn pg-x', title: 'Close', 'aria-label': 'Close', onclick: () => PG.ui.open( id, false ) }, '✕' ) );

}

// --- tooltips ----------------------------------------------------------------------------------------

let tipEl = null, tipFor = null;

function tipBox() {

	if ( ! tipEl ) {

		tipEl = h( 'div', { class: 'pg-tip hidden' } );
		document.body.append( tipEl );
		addEventListener( 'pointerdown', ( e ) => {

			if ( tipEl.classList.contains( 'pg-pinned' ) && ! tipEl.contains( e.target ) && ! e.target.closest?.( '[data-loc]' ) ) hideTip();

		}, true );

	}

	return tipEl;

}

export function hideTip() {

	if ( ! tipEl ) return;
	tipEl.classList.add( 'hidden' );
	tipEl.classList.remove( 'pg-pinned' );
	tipFor = null;

}

function place( el, at ) {

	const r = at instanceof Element ? at.getBoundingClientRect() : { left: at.x, right: at.x, top: at.y, bottom: at.y };
	el.style.left = '0px'; el.style.top = '0px';
	const w = el.offsetWidth, hgt = el.offsetHeight;
	let x = r.right + 12, y = r.top;
	if ( x + w > innerWidth - 6 ) x = r.left - w - 12;
	if ( x < 6 ) x = Math.max( 6, Math.min( innerWidth - w - 6, ( r.left + r.right ) / 2 - w / 2 ) );
	if ( y + hgt > innerHeight - 6 ) y = innerHeight - hgt - 6;
	if ( x < r.right && x + w > r.left && y < r.bottom && y + hgt > r.top ) y = r.bottom + 8 + hgt < innerHeight ? r.bottom + 8 : Math.max( 6, r.top - hgt - 8 );
	el.style.left = Math.round( x ) + 'px';
	el.style.top = Math.round( Math.max( 6, y ) ) + 'px';

}

const CLASS_NAMES = { sword: 'One Hand Sword', axe: 'One Hand Axe', mace: 'One Hand Mace', dagger: 'Dagger', spear: 'Spear', wand: 'Wand', greatsword: 'Two Hand Sword', greataxe: 'Two Hand Axe', maul: 'Two Hand Mace', staff: 'Staff', bow: 'Bow' };

function itemTipBody( item, opts ) {

	const game = PG.game;
	const d = describeItem( item );
	const c = computeItem( item );
	const base = c.base;
	const body = [];
	const kind = base.weaponClass ? CLASS_NAMES[ base.weaponClass ] : base.tags.includes( 'shield' ) ? 'Shield' : base.tags.includes( 'quiver' ) ? 'Quiver' : base.tags.includes( 'focus' ) ? 'Focus' : base.slot === 'flask' ? 'Flask' : d.slotName;
	body.push( h( 'div', { class: 't-prop' }, kind ) );
	for ( const [ k, v ] of d.properties ) body.push( h( 'div', { class: 't-prop' }, `${k}: `, h( 'b', { text: v } ) ) );
	if ( base.slot === 'flask' ) body.push( h( 'div', { class: 't-prop' }, 'Charges: ', h( 'b', { text: `${Math.floor( item.charges ?? 0 )} / ${c.flask.max}` } ) ) );

	// requirements (failed parts in red)
	const r = d.req;
	const fail = meetsReq( item, playerAttributes( game ), game.save.level );
	const parts = [];
	const part = ( key, text ) => parts.push( fail.includes( key ) ? h( 'span', { class: 'bad', text } ) : text );
	if ( r.level > 1 ) part( 'level', `Level ${r.level}` );
	if ( r.str ) part( 'str', `${r.str} Str` );
	if ( r.dex ) part( 'dex', `${r.dex} Dex` );
	if ( r.int ) part( 'int', `${r.int} Int` );
	if ( parts.length ) body.push( h( 'div', { class: 't-req' }, 'Requires ', ...parts.flatMap( ( p, i ) => i ? [ ', ', p ] : [ p ] ) ) );

	if ( d.implicits.length ) {

		body.push( h( 'div', { class: 't-sep' } ) );
		for ( const l of d.implicits ) body.push( h( 'div', { class: 't-imp', text: l } ) );

	}

	if ( d.affixes.length || d.flask?.buff.length ) {

		body.push( h( 'div', { class: 't-sep' } ) );
		for ( const a of d.affixes ) {

			const tag = a.kind === 'prefix' || a.kind === 'suffix' ? h( 'span', { class: 't-tier', text: `${a.kind === 'prefix' ? 'P' : 'S'}·T${a.tier}`, title: `${a.tierName ?? ''} - tier ${a.tier} of ${a.tiers}` } ) : null;
			body.push( h( 'div', { class: 't-mod' }, h( 'span', { text: a.text } ), tag ) );

		}

		if ( d.flask?.kind === 'utility' ) for ( const l of d.flask.buff ) body.push( h( 'div', { class: 't-mod', text: l } ) );

	}

	if ( d.mechanic ) body.push( h( 'div', { class: 't-sep' } ), h( 'div', { class: 't-mech', text: d.mechanic } ) );
	if ( d.flavour ) body.push( h( 'div', { class: 't-flav', text: d.flavour } ) );
	if ( d.corrupted ) body.push( h( 'div', { class: 't-corrupt', text: 'Corrupted' } ) );
	body.push( h( 'div', { class: 't-foot', text: `Item Level ${d.ilvl} · sells for ${d.value} gold` } ) );
	if ( opts.price ) body.push( h( 'div', { class: 'pg-gold', text: `Price: ${opts.price.toLocaleString()} gold` } ) );

	// comparison with the equipped item in the same slot
	if ( opts.compare !== false && game.world?.player && opts.loc?.where !== 'equip' && opts.loc?.where !== 'flask' && base.slot !== 'flask' ) {

		const slot = slotFor( game, item );
		const eq = { ...game.save.equipment };
		const old = eq[ slot ];
		eq[ slot ] = item;
		if ( slot === 'weapon' && base.hands === 2 && eq.offhand && ! ( base.weaponClass === 'bow' && get( 'itemBase', eq.offhand.base )?.tags.includes( 'quiver' ) ) ) eq.offhand = null;
		const why = canEquip( game, item, slot );
		const diff = compareStats( simulateStats( game ), simulateStats( game, { equipment: eq, ignoreReq: slot } ) ).slice( 0, 9 );
		const lines = diff.map( ( x ) => h( 'div', { class: x.delta > 0 ? 'up' : 'down', text: `${x.delta > 0 ? '+' : ''}${fmt( x.delta )}${x.unit} ${x.label}` } ) );
		body.push( h( 'div', { class: 't-sep' } ), h( 'div', { class: 't-cmp' },
			why ? h( 'div', { class: 'down', text: `Cannot equip yet: ${why}` } ) : null,
			h( 'div', { class: 'pg-dim', text: old ? `If equipped (replacing ${computeItem( old ).name}):` : 'If equipped (empty slot):' } ),
			...( lines.length ? lines : [ h( 'div', { class: 'pg-dim', text: 'No change to key stats' } ) ] ) ) );

	}

	if ( opts.hint ) body.push( h( 'div', { class: 't-foot', text: opts.hint } ) );
	const head = h( 'div', { class: 't-head' }, d.name, d.name !== d.baseName ? h( 'span', { class: 't-base', text: d.baseName } ) : null );
	return { head, body: h( 'div', { class: 't-body' }, body ), rarity: item.rarity };

}

// Show an item tooltip at an element or point. opts: { loc, price, compare, hint, actions: [ { label, fn, primary } ] }
export function showItemTip( item, at, opts = {} ) {

	const el = tipBox();
	const key = item.uid + ':' + item.rev + ':' + ( opts.actions ? 'p' : '' ) + PG.version;
	if ( tipFor !== key ) {

		const t = itemTipBody( item, opts );
		el.className = 'pg-tip r-' + t.rarity;
		el.replaceChildren( t.head, t.body );
		if ( opts.actions?.length ) {

			el.append( h( 'div', { class: 't-actions' }, opts.actions.map( ( a ) => h( 'button', { class: 'pg-btn' + ( a.primary ? ' pg-primary' : '' ), text: a.label, onclick: ( e ) => {

				e.stopPropagation();
				hideTip();
				a.fn();

			} } ) ) ) );
			el.classList.add( 'pg-pinned' );

		}

		tipFor = key;

	}

	el.classList.remove( 'hidden' );
	place( el, at );

}

// Plain tooltip: title + lines (strings or elements). opts.cls adds a rarity colour class.
export function showTextTip( title, lines, at, opts = {} ) {

	const el = tipBox();
	el.className = 'pg-tip ' + ( opts.cls || 'r-plain' ) + ( opts.actions ? ' pg-pinned' : '' );
	el.replaceChildren( h( 'div', { class: 't-head' }, title, opts.sub ? h( 'span', { class: 't-base', text: opts.sub } ) : null ),
		h( 'div', { class: 't-body' + ( opts.left ? ' t-left' : '' ) }, lines.map( ( l ) => typeof l === 'string' ? h( 'div', { class: opts.lineClass || 't-mod', text: l } ) : l ) ) );
	if ( opts.actions ) el.append( h( 'div', { class: 't-actions' }, opts.actions.map( ( a ) => h( 'button', { class: 'pg-btn' + ( a.primary ? ' pg-primary' : '' ), text: a.label, onclick: ( e ) => {

		e.stopPropagation();
		hideTip();
		a.fn();

	} } ) ) ) );
	tipFor = null;
	el.classList.remove( 'hidden' );
	place( el, at );

}

// --- actions -----------------------------------------------------------------------------------------

function run( r, okText ) {

	if ( ! r?.ok ) toast( r?.reason || 'Not possible', 'error' );
	else if ( okText ) toast( okText );
	dirty();
	return r;

}

// Every action available for the item at `loc`, given which service panel is open.
export function actionsFor( loc, item ) {

	const game = PG.game, mode = activeService();
	const base = get( 'itemBase', item.base );
	const acts = [];
	if ( loc.where === 'vendor' ) return [ { label: `Buy (${buyPrice( item ).toLocaleString()} gold)`, primary: true, fn: () => run( buyItem( game, loc.index ) ) } ];
	if ( loc.where === 'buyback' ) return [ { label: 'Buy back', primary: true, fn: () => run( buyItem( game, loc.index, true ) ) } ];
	if ( mode === 'craft' ) acts.push( { label: 'Select for crafting', primary: true, fn: () => {

		PG.craftSel = loc;
		dirty();

	} } );
	if ( mode === 'vendor' ) acts.push( { label: `Sell (+${itemValue( item ).toLocaleString()} gold)`, primary: true, fn: () => run( sellItem( game, loc ) ) } );
	if ( mode === 'stash' && loc.where === 'stash' ) acts.push( { label: 'Take', primary: true, fn: () => run( unequip( game, loc ) ) } );
	if ( mode === 'stash' && loc.where !== 'stash' ) acts.push( { label: 'Stash', primary: true, fn: () => run( stashItem( game, loc, PG.stashTab ) ) } );
	if ( loc.where === 'inv' || loc.where === 'stash' ) acts.push( { label: base.slot === 'flask' ? 'Put on belt' : 'Equip', fn: () => run( equipFrom( game, loc ) ) } );
	if ( loc.where === 'equip' || loc.where === 'flask' ) acts.push( { label: 'Unequip', fn: () => run( unequip( game, loc ) ) } );
	if ( loc.where !== 'stash' ) acts.push( { label: 'Drop', fn: () => dropToGround( loc ) } );
	return acts;

}

export function dropToGround( loc ) {

	const game = PG.game, p = game.world?.player;
	if ( ! p ) return;
	const item = removeAt( game, loc );
	if ( item ) spawnLoot( game.world, { type: 'item', item }, p.x, p.z );
	dirty();

}

export function itemClick( loc, item, ev, at ) {

	const acts = actionsFor( loc, item );
	if ( ev.pointerType === 'touch' || ev.pointerType === 'pen' ) {

		showItemTip( item, at, { loc, actions: acts, price: loc.where === 'vendor' ? buyPrice( item ) : null } );
		return;

	}

	hideTip();
	acts[ 0 ]?.fn();

}

function hintFor( loc, item ) {

	const acts = actionsFor( loc, item );
	return acts.length ? `Click: ${acts[ 0 ].label.toLowerCase()} · drag to move${loc.where !== 'vendor' && loc.where !== 'stash' ? ' · drag onto the world to drop' : ''}` : '';

}

// --- item cells, grids, drag & drop ------------------------------------------------------------------------

let drag = null;

function locOf( el ) {

	const c = el?.closest?.( '[data-loc]' );
	return c ? JSON.parse( c.dataset.loc ) : null;

}

function endDrag( e ) {

	const d = drag;
	drag = null;
	removeEventListener( 'pointermove', onDragMove );
	removeEventListener( 'pointerup', endDrag );
	removeEventListener( 'pointercancel', endDrag );
	if ( ! d ) return;
	d.cell.classList.remove( 'pg-drop' );
	if ( ! d.active ) {

		if ( e.type === 'pointerup' ) itemClick( d.loc, d.item, e, d.cell );
		return;

	}

	d.ghost.remove();
	document.querySelectorAll( '.pg-drop' ).forEach( ( x ) => x.classList.remove( 'pg-drop' ) );
	const target = document.elementFromPoint( e.clientX, e.clientY );
	const to = locOf( target );
	if ( to ) {

		if ( to.where === 'sell' ) run( sellItem( PG.game, d.loc ) );
		else if ( d.loc.where === 'vendor' ) run( buyItem( PG.game, d.loc.index ) );
		else run( moveItem( PG.game, d.loc, to ) );

	} else if ( target?.tagName === 'CANVAS' && target.closest( '#game' ) && d.loc.where !== 'vendor' && d.loc.where !== 'buyback' ) dropToGround( d.loc );

}

function onDragMove( e ) {

	const d = drag;
	if ( ! d ) return;
	if ( ! d.active && Math.hypot( e.clientX - d.x, e.clientY - d.y ) > 7 ) {

		d.active = true;
		hideTip();
		d.ghost = h( 'img', { class: 'pg-ghost', src: itemIcon( d.item ) } );
		document.body.append( d.ghost );

	}

	if ( ! d.active ) return;
	d.ghost.style.left = e.clientX + 'px';
	d.ghost.style.top = e.clientY + 'px';
	document.querySelectorAll( '.pg-drop' ).forEach( ( x ) => x.classList.remove( 'pg-drop' ) );
	document.elementFromPoint( e.clientX, e.clientY )?.closest?.( '[data-loc]' )?.classList.add( 'pg-drop' );

}

// Wire one cell: hover tooltip, click / tap actions, drag source + drop target.
export function bindCell( cell, getLoc, getItem, opts = {} ) {

	cell.addEventListener( 'pointerenter', ( e ) => {

		if ( drag || e.pointerType === 'touch' ) return;
		const item = getItem();
		if ( item ) {

			const loc = getLoc();
			showItemTip( item, cell, { loc, price: loc.where === 'vendor' ? buyPrice( item ) : opts.price?.( item ), hint: hintFor( loc, item ) } );

		}

	} );
	cell.addEventListener( 'pointerleave', () => {

		if ( ! tipEl?.classList.contains( 'pg-pinned' ) ) hideTip();

	} );
	cell.addEventListener( 'pointerdown', ( e ) => {

		const item = getItem();
		if ( ! item || e.button > 0 ) return;
		e.preventDefault();
		drag = { loc: getLoc(), item, cell, x: e.clientX, y: e.clientY, active: false };
		addEventListener( 'pointermove', onDragMove );
		addEventListener( 'pointerup', endDrag );
		addEventListener( 'pointercancel', endDrag );

	} );
	cell.addEventListener( 'contextmenu', ( e ) => e.preventDefault() );

}

// Render one cell from an item (cheap: only touches the DOM when the item changed).
export function renderCell( cell, item, opts = {} ) {

	const key = item ? `${item.uid}:${item.rev}:${Math.floor( item.charges ?? - 1 )}:${opts.bad ? 1 : 0}:${opts.badge ?? ''}` : 'empty:' + ( opts.slotName ?? '' );
	if ( cell.dataset.key === key ) return;
	cell.dataset.key = key;
	cell.className = 'pg-cell' + ( opts.extraClass ? ' ' + opts.extraClass : '' ) + ( item ? ` pg-has r-${item.rarity}` : '' ) + ( opts.bad ? ' pg-bad' : '' );
	cell.replaceChildren();
	if ( ! item ) {

		if ( opts.slotName ) cell.append( h( 'span', { class: 'pg-slotname', text: opts.slotName } ) );
		return;

	}

	cell.append( h( 'img', { src: itemIcon( item ), alt: '' } ) );
	const base = get( 'itemBase', item.base );
	if ( base?.flask ) {

		const max = computeItem( item ).flask.max;
		cell.append( h( 'div', { class: 'pg-charge' }, h( 'i', { style: { width: `${Math.min( 100, ( item.charges ?? 0 ) / max * 100 )}%`, background: RARITY_COLORS.normal } } ) ) );

	}

	const badge = opts.badge ?? ( item.quality ? `${item.quality}%` : '' );
	if ( badge ) cell.append( h( 'span', { class: 'pg-badge', text: badge } ) );

}

// A grid of cells over `count` locations.
//   opts: { cols, count, loc( i ), item( i ), badge?( item, i ), slotName?( i ), cls? }
export class ItemGrid {

	constructor( opts ) {

		this.opts = opts;
		this.el = h( 'div', { class: 'pg-grid' + ( opts.cls ? ' ' + opts.cls : '' ) } );
		if ( opts.cols ) this.el.style.gridTemplateColumns = `repeat(${opts.cols}, minmax(0, 1fr))`;
		this.cells = [];
		this.resize( opts.count );

	}

	resize( n ) {

		while ( this.cells.length < n ) {

			const i = this.cells.length;
			const cell = h( 'div', { class: 'pg-cell' } );
			cell.dataset.loc = JSON.stringify( this.opts.loc( i ) );
			bindCell( cell, () => this.opts.loc( i ), () => this.opts.item( i ) );
			this.cells.push( cell );
			this.el.append( cell );

		}

		while ( this.cells.length > n ) this.cells.pop().remove();

	}

	render() {

		const game = PG.game;
		const attrs = playerAttributes( game );
		this.cells.forEach( ( cell, i ) => {

			cell.dataset.loc = JSON.stringify( this.opts.loc( i ) );
			const item = this.opts.item( i );
			const bad = item && base( item ) && base( item ).slot !== 'flask' && meetsReq( item, attrs, game.save.level ).length > 0;
			renderCell( cell, item, { bad, badge: item ? this.opts.badge?.( item, i ) : null, slotName: this.opts.slotName?.( i ) } );

		} );

	}

}

const base = ( item ) => get( 'itemBase', item.base );

// The player's inventory as a grid (used by the inventory panel and every service panel).
export function inventoryGrid() {

	return new ItemGrid( { count: 60, cols: 10, loc: ( i ) => ( { where: 'inv', index: i } ), item: ( i ) => PG.game.save.inventory.items[ i ] } );

}

// "Sell here" drop zone for the vendor panel.
export function sellZone() {

	const el = h( 'div', { class: 'pg-li', style: { justifyContent: 'center', borderStyle: 'dashed', minHeight: '40px' } }, 'Drop items here to sell' );
	el.dataset.loc = JSON.stringify( { where: 'sell' } );
	return el;

}

export { getAt };
