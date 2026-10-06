// Progression HUD:
//   * flask belt above the life/mana bars (charges, active glow, click / tap to drink)
//   * active buffs (Onslaught, Momentum stacks, ...) and an "unspent passive points" pill
//   * menu buttons (bag, character, skills, tree) - the only way in on a phone
//   * on-ground LOOT LABELS projected with game.rc.camera every frame: rarity colours,
//     overlap-avoiding, hover = item tooltip, click = pick up
//   * a pickup feed (bottom right) and toasts for rare finds, level-ups, skill levels
//   * the SERVICE listener: world 'interact' events whose target has data.service open
//     the matching panel ( vendor / gamble / craft / stash / tree (Mystic) / skills / ... )

import * as THREE from 'three/webgpu';
import { define } from '../../../core/registry.js';
import { h } from '../../../ui/shell.js';
import { PG, dirty, toast, hideTip, showItemTip } from './common.js';
import { flaskSlots, drinkFlask } from '../flasks.js';
import { computeItem, itemName } from '../items.js';
import { runtime } from '../mechanics.js';
import { lootEntities, pickupLoot, dropLabel } from '../loot.js';
import { pointsLeft, pointsTotal, ascPointsLeft, treeState } from '../tree.js';
import { injectCss } from './style.js';
import { get } from '../../../core/registry.js';
import { controlLabel, controls } from '../../combat/client/controls.js';

const FLASK_COLORS = { life: '#d83030', mana: '#3060e0', hybrid: '#a040c0', utility: '#c8ccd4' };

const FLASK_ACTIONS = [ 'potion', 'flask2', 'flask3', 'flask4' ];

define( 'uiPanel', { id: 'prog-hud', order: 12,
	mount( ui ) {

		injectCss();
		PG.ui = ui; PG.game = ui.game;
		this.flasks = [ 0, 1, 2, 3 ].map( ( i ) => {

			const el = h( 'div', { class: 'pg-flask', title: `Flask ${i + 1}` }, h( 'i' ), h( 'span', { text: controlLabel( FLASK_ACTIONS[ i ] ) } ) );
			el.addEventListener( 'click', () => {

				const r = drinkFlask( ui.game, i );
				if ( ! r.ok ) toast( r.reason );

			} );
			return el;

		} );
		this.buffs = h( 'div', { class: 'pg-buffs' } );
		this.pointsEl = h( 'div', { class: 'pg-points hidden', onclick: () => ui.open( 'tree', true ) } );
		this.menuButtons = [];
		const menuBtn = ( label, action ) => {

			const el = h( 'button', { title: label, onclick: () => ui.action( action ) }, label, h( 'span', { class: 'k', text: controlLabel( action ) } ) );
			this.menuButtons.push( { el, action, label } );
			return el;

		};
		return h( 'div', { class: 'hud-prog' },
			h( 'div', { class: 'pg-hud-flasks' }, this.buffs, this.pointsEl, ...this.flasks ),
			h( 'div', { class: 'pg-menu' }, menuBtn( 'Bag', 'inventory' ), menuBtn( 'Char', 'character' ), menuBtn( 'Skill', 'skills' ), menuBtn( 'Tree', 'tree' ), menuBtn( 'Menu', 'pause' ) ) );

	},
	update( ui, game ) {

		const w = game.world;
		if ( ! w ) return;
		const device = game.input.device;
		const bindingDevice = device === 'gamepad' ? 'gamepad' : 'keyboard';
		if ( this.bindingRevision !== controls.revision || this.bindingDevice !== device ) {

			this.bindingRevision = controls.revision;
			this.bindingDevice = device;
			for ( const { el, action, label } of this.menuButtons ) {

				const key = device === 'touch' ? '' : controlLabel( action, bindingDevice );
				el.lastChild.textContent = key;
				el.title = label + ( key ? ` (${key})` : '' );

			}
			this.flasks.forEach( ( el, i ) => el.lastChild.textContent = device === 'touch' ? '' : controlLabel( FLASK_ACTIONS[ i ], bindingDevice ) );

		}
		const rt = runtime( w );
		const slots = flaskSlots( game.save );
		slots.forEach( ( item, i ) => {

			const el = this.flasks[ i ];
			if ( ! item ) {

				el.className = 'pg-flask pg-empty';
				el.firstChild.style.height = '0%';
				return;

			}

			const f = computeItem( item ).flask;
			const frac = Math.min( 1, ( item.charges ?? 0 ) / f.max );
			el.firstChild.style.height = `${frac * 100}%`;
			el.firstChild.style.background = FLASK_COLORS[ f.kind ];
			const active = rt?.flasks.some( ( x ) => x.slot === i );
			el.className = 'pg-flask' + ( ( item.charges ?? 0 ) >= f.use ? ' pg-ready' : '' ) + ( active ? ' pg-active' : '' );
			el.title = `${computeItem( item ).name}: ${Math.floor( item.charges ?? 0 )}/${f.max} charges (${f.use} per use)`;

		} );
		if ( game.frameCount % 10 === 0 ) {

			const pts = pointsLeft( game.save ), asc = ascPointsLeft( game.save );
			this.pointsEl.classList.toggle( 'hidden', ! pts && ! asc );
			const treeKey = device === 'touch' ? '' : ` (${controlLabel( 'tree', bindingDevice )})`;
			this.pointsEl.textContent = ( pts ? `+${pts} passive point${pts > 1 ? 's' : ''}` : `+${asc} ascendancy` ) + treeKey;
			const list = rt ? [ ...rt.buffs.values() ] : [];
			this.buffs.replaceChildren( ...list.slice( 0, 8 ).map( ( b ) => {

				const left = Math.max( 0, b.until - w.time );
				const label = ( b.label || b.name || b.key ).split( ' ' ).map( ( s ) => s[ 0 ] ).join( '' ).slice( 0, 3 ).toUpperCase();
				return h( 'div', { class: 'pg-buff', title: `${b.name || b.key}${b.stacks ? ` (${b.stacks})` : ''}` }, b.stacks ? `${label}${b.stacks}` : label,
					b.total < 999 ? h( 'i', { style: { width: `${left / b.total * 100}%` } } ) : null );

			} ) );

		}

	}
} );

// --- loot labels -------------------------------------------------------------------------------------

const V = new THREE.Vector3();
const LOOK = { x: 0, y: 0, z: 0, facing: 0 };
const MAX_LABELS = 70;

function labelClass( d ) {

	if ( d.type === 'gold' ) return 'l-gold';
	if ( d.type === 'currency' ) return 'l-currency';
	if ( d.type === 'rune' ) return 'l-rune';
	return 'l-' + d.item.rarity;

}

define( 'uiPanel', { id: 'prog-labels', order: 11,
	mount( ui ) {

		injectCss();
		this.pool = new Map(); // entity id -> { el, w, h }
		this.feed = h( 'div', { class: 'pg-feed' } );
		this.layer = h( 'div', { class: 'pg-labels' } );
		return h( 'div', { class: 'pg-labels-root' }, this.layer, this.feed );

	},
	label( e ) {

		let L = this.pool.get( e.id );
		if ( L ) return L;
		const d = e.data.loot;
		const el = h( 'div', { class: 'pg-label ' + labelClass( d ), text: dropLabel( d ) } );
		el.addEventListener( 'pointerdown', ( ev ) => ev.stopPropagation() );
		el.addEventListener( 'click', () => {

			const game = PG.game, p = game.world?.player;
			if ( ! p || ! e.alive ) return;
			if ( Math.hypot( e.x - p.x, e.z - p.z ) > 12 ) return toast( 'Too far away' );
			const r = pickupLoot( game, e );
			if ( ! r.ok ) toast( r.reason, 'error' );
			hideTip();

		} );
		if ( d.type === 'item' ) {

			el.addEventListener( 'pointerenter', ( ev ) => ev.pointerType === 'mouse' && showItemTip( d.item, el, { hint: 'Click to pick up' } ) );
			el.addEventListener( 'pointerleave', hideTip );

		}

		this.layer.append( el );
		L = { el, w: 0, h: 0 };
		this.pool.set( e.id, L );
		return L;

	},
	update( ui, game ) {

		const w = game.world, rc = game.rc, p = w?.player;
		if ( ! w || ! rc || ! p ) return;
		const cam = rc.camera;
		const W = innerWidth, H = innerHeight;
		const seen = new Set();
		const items = [];
		const modal = [ ...ui.panels.values() ].some( ( q ) => q.open && q.def.modal );
		if ( ! modal ) for ( const e of lootEntities( w ) ) {

			if ( Math.hypot( e.x - p.x, e.z - p.z ) > 30 ) continue;
			const l = rc.lerp( e, LOOK );
			V.set( l.x, l.y + 0.5, l.z ).project( cam );
			if ( V.z > 1 || V.x < - 1.1 || V.x > 1.1 || V.y < - 1.1 || V.y > 1.1 ) continue;
			items.push( { e, x: ( V.x + 1 ) / 2 * W, y: ( 1 - V.y ) / 2 * H } );
			if ( items.length >= MAX_LABELS ) break;

		}

		// place labels from the bottom of the screen up, nudging overlaps upward
		items.sort( ( a, b ) => b.y - a.y );
		const placed = [];
		for ( const it of items ) {

			const L = this.label( it.e );
			if ( ! L.w ) {

				L.w = L.el.offsetWidth || 80;
				L.h = L.el.offsetHeight || 18;

			}

			let y = it.y;
			for ( let k = 0; k < 10; k ++ ) {

				const hit = placed.find( ( r ) => Math.abs( r.x - it.x ) < ( r.w + L.w ) / 2 + 2 && Math.abs( r.y - y ) < ( r.h + L.h ) / 2 + 1 );
				if ( ! hit ) break;
				y = hit.y - ( hit.h + L.h ) / 2 - 2;

			}

			placed.push( { x: it.x, y, w: L.w, h: L.h } );
			L.el.style.transform = `translate(${Math.round( it.x - L.w / 2 )}px, ${Math.round( y - L.h )}px)`;
			L.el.style.display = '';
			seen.add( it.e.id );

		}

		for ( const [ id, L ] of this.pool ) {

			if ( seen.has( id ) ) continue;
			const e = w.byId.get( id );
			if ( ! e || ! e.alive ) {

				L.el.remove();
				this.pool.delete( id );

			} else L.el.style.display = 'none';

		}

		// pickup feed fades
		const now = performance.now();
		for ( const el of [ ...this.feed.children ] ) {

			const age = now - + el.dataset.t;
			if ( age > 4000 ) el.remove();
			else if ( age > 3000 ) el.style.opacity = '0';

		}

	},
	onWorld() {

		for ( const L of this.pool.values() ) L.el.remove();
		this.pool.clear();

	},
	pushFeed( text, color ) {

		const el = h( 'div', { text, style: { color } } );
		el.dataset.t = performance.now();
		this.feed.append( el );
		while ( this.feed.children.length > 7 ) this.feed.firstChild.remove();

	}
} );

// --- events -> panels, toasts, feed ----------------------------------------------------------------------

const SERVICES = { vendor: 'vendor', gamble: 'vendor', craft: 'craft', stash: 'stash', tree: 'tree', skills: 'skills', inventory: 'inventory', character: 'character' };

export function openService( ui, service ) {

	const id = SERVICES[ service ];
	if ( ! id ) return false;
	if ( id === 'tree' ) ui.panels.get( 'tree' ).def.mystic = true;
	if ( service === 'gamble' ) ui.panels.get( 'vendor' ).def.openTab = 'gamble';
	if ( service === 'vendor' ) ui.panels.get( 'vendor' ).def.openTab = 'buy';
	ui.open( id, true );
	return true;

}

define( 'bootHook', { id: 'progression-ui', order: 40, boot( { game, ui } ) {

	PG.ui = ui; PG.game = game;
	const labels = ui.panels.get( 'prog-labels' )?.def;
	const attach = ( world ) => {

		labels?.onWorld();
		dirty();
		world.events.on( 'interact', ( ev ) => {

			if ( ev.entity && ev.entity !== world.player ) return;
			const s = ev.target?.data?.service;
			if ( s ) openService( ui, s );

		} );
		world.events.on( 'pickup', ( ev ) => {

			if ( ev.gold ) labels?.pushFeed( `+${ev.gold} gold`, '#ffd34d' );
			else if ( ev.currency ) labels?.pushFeed( `+ ${get( 'currency', ev.currency )?.name}`, '#f0dfa8' );
			else if ( ev.rune ) labels?.pushFeed( `+ ${get( 'support', ev.rune )?.name ?? ev.rune} Rune`, '#6fe0c8' );
			else if ( ev.item ) {

				const r = ev.item.rarity;
				labels?.pushFeed( `+ ${itemName( ev.item )}`, { normal: '#e8e8e8', magic: '#8fb0ff', rare: '#ffe066', unique: '#ff9a3c' }[ r ] );
				if ( r === 'unique' || r === 'rare' ) ui.toast( `${r === 'unique' ? 'Unique' : 'Rare'} found: ${itemName( ev.item )}`, r );

			}

		} );

	};

	game.events.on( 'world', ( { world } ) => attach( world ) );
	if ( game.world ) attach( game.world );
	game.events.on( 'inventory', dirty );
	game.events.on( 'levelup', ( { level, gained } ) => {

		dirty();
		// 1 point per level + 1 bonus every 5th level ( tree.js pointsTotal )
		const got = pointsTotal( level ) - pointsTotal( level - gained );
		const treeHint = () => game.input.device === 'touch' ? '' : ` (${controlLabel( 'tree', game.input.device === 'gamepad' ? 'gamepad' : 'keyboard' )})`;
		setTimeout( () => ui.toast( `+${got} passive point${got > 1 ? 's' : ''} - ${pointsLeft( game.save )} unspent${treeHint()}` ), 600 );
		if ( level === 30 && ! treeState( game.save ).asc.id ) setTimeout( () => ui.toast( `Ascendancy unlocked! Open the tree${treeHint()} and choose a class.`, 'levelup' ), 1800 );

	} );
	game.events.on( 'skillLevel', ( { skill, level } ) => ui.toast( `${get( 'skill', skill )?.name ?? skill} reached level ${level}` ) );
	game.events.on( 'inventoryFull', () => ui.toast( 'Inventory is full', 'error' ) );

} } );
