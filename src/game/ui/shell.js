// UI shell: DOM overlay above the canvas. Every screen is a registered PANEL:
//
//   define( 'uiPanel', {
//     id: 'inventory', order: 40,
//     toggle: 'inventory',          input action that opens/closes it (I key...)
//     modal: true,                  pauses the simulation while open
//     mount( ui ) -> HTMLElement    build once; appended to #ui
//     update( ui, game, dt )        every frame while visible (keep it cheap)
//     onOpen( ui ), onClose( ui )
//   } )
//
// Built in here: the HUD (life, mana, XP, area name, toasts) and the pause / debug
// menu with the difficulty sliders ( TUNING_SLIDERS ), level select and cheats.

import { define, all } from '../core/registry.js';
import { TUNING_SLIDERS } from '../core/tuning.js';
import { xpToNext } from '../core/tuning.js';

export function h( tag, attrs = {}, ...children ) {

	const el = document.createElement( tag );
	for ( const [ k, v ] of Object.entries( attrs ) ) {

		if ( k === 'class' ) el.className = v;
		else if ( k === 'style' && typeof v === 'object' ) Object.assign( el.style, v );
		else if ( k === 'text' ) el.textContent = v;
		else if ( k === 'html' ) el.innerHTML = v;
		else if ( k.startsWith( 'on' ) ) el.addEventListener( k.slice( 2 ), v );
		else el.setAttribute( k, v );

	}

	for ( const c of children.flat() ) if ( c !== null && c !== undefined && c !== false ) el.append( c instanceof Node ? c : document.createTextNode( c ) );
	return el;

}

export class UI {

	constructor( game, root ) {

		this.game = game;
		this.root = root;
		this.panels = new Map(); // id -> { def, el, open }
		this.toasts = h( 'div', { class: 'toasts' } );
		root.append( this.toasts );
		const css = h( 'style', { text: CSS } );
		document.head.append( css );

	}

	init() {

		for ( const def of all( 'uiPanel' ).sort( ( a, b ) => ( a.order ?? 50 ) - ( b.order ?? 50 ) ) ) {

			const el = def.mount( this );
			if ( ! el ) continue;
			el.dataset.panel = def.id;
			const open = def.startOpen ?? ! def.toggle;
			el.classList.toggle( 'hidden', ! open );
			this.root.append( el );
			this.panels.set( def.id, { def, el, open } );

		}

	}

	isOpen( id ) {

		return this.panels.get( id )?.open ?? false;

	}

	open( id, on = true ) {

		const p = this.panels.get( id );
		if ( ! p || p.open === on ) return;
		if ( on && p.def.modal ) for ( const [ oid, o ] of this.panels ) if ( oid !== id && o.open && o.def.modal ) this.open( oid, false );
		p.open = on;
		p.el.classList.toggle( 'hidden', ! on );
		if ( on ) p.def.onOpen?.( this ); else p.def.onClose?.( this );
		this.game.paused = [ ...this.panels.values() ].some( ( q ) => q.open && q.def.modal );

	}

	toggle( id ) {

		this.open( id, ! this.isOpen( id ) );

	}

	// Input actions that are UI, not gameplay (Esc, I, T, ...).
	action( a ) {

		if ( a === 'pause' ) {

			const modal = [ ...this.panels.entries() ].find( ( [ , p ] ) => p.open && p.def.modal );
			if ( modal ) this.open( modal[ 0 ], false );
			else this.open( 'pause', true );
			return;

		}

		for ( const [ id, p ] of this.panels ) if ( p.def.toggle === a ) this.toggle( id );

	}

	toast( text, kind = '' ) {

		const t = h( 'div', { class: 'toast ' + kind, text } );
		this.toasts.append( t );
		setTimeout( () => t.classList.add( 'out' ), 2200 );
		setTimeout( () => t.remove(), 2800 );
		while ( this.toasts.children.length > 6 ) this.toasts.firstChild.remove();

	}

	update( dt ) {

		for ( const p of this.panels.values() ) if ( p.open ) p.def.update?.( this, this.game, dt );

	}

}

// --- HUD -----------------------------------------------------------------------------

define( 'uiPanel', { id: 'hud', order: 10,
	mount( ui ) {

		const bar = ( cls ) => h( 'div', { class: 'bar ' + cls }, h( 'div', { class: 'fill' } ), h( 'span' ) );
		this.life = bar( 'life' ); this.mana = bar( 'mana' ); this.xp = h( 'div', { class: 'xpbar' }, h( 'div', { class: 'fill' } ) );
		this.area = h( 'div', { class: 'area' } );
		this.info = h( 'div', { class: 'info' } );
		return h( 'div', { class: 'hud' }, this.area, h( 'div', { class: 'bottom' }, this.life, this.info, this.mana ), this.xp );

	},
	update( ui, game ) {

		const w = game.world, p = w?.player;
		if ( ! p ) return;
		const set = ( el, v, max, text ) => {

			el.firstChild.style.width = `${Math.max( 0, Math.min( 1, v / Math.max( 1, max ) ) ) * 100}%`;
			el.lastChild.textContent = text ?? `${Math.ceil( v )} / ${Math.round( max )}`;

		};

		set( this.life, p.life, p.maxLife );
		set( this.mana, p.mana, p.maxMana );
		const s = game.save;
		this.xp.firstChild.style.width = `${Math.min( 100, s.xp / xpToNext( s.level ) * 100 )}%`;
		this.info.textContent = `Lv ${s.level} · ${s.gold.toLocaleString()} gold`;
		const name = w.kind === 'town' ? 'Town' : `${w.spec?.name ?? 'Level'} · depth ${s.depth} · area level ${w.level}`;
		if ( this.area.textContent !== name ) this.area.textContent = name;

	}
} );

// --- pause / debug menu -----------------------------------------------------------------

const toSlider = ( d, v ) => d.log ? Math.log( v / d.min ) / Math.log( d.max / d.min ) * 1000 : ( v - d.min ) / ( d.max - d.min ) * 1000;
const fromSlider = ( d, s ) => {

	const v = d.log ? d.min * Math.pow( d.max / d.min, s / 1000 ) : d.min + ( d.max - d.min ) * s / 1000;
	return Math.round( v / d.step ) * d.step;

};

define( 'uiPanel', { id: 'pause', order: 90, toggle: 'pause-menu', modal: true,
	mount( ui ) {

		const game = ui.game;
		const rows = TUNING_SLIDERS.map( ( d ) => {

			if ( d.type === 'toggle' ) {

				const cb = h( 'input', { type: 'checkbox', onchange: () => {

					game.setTuning( { [ d.key ]: cb.checked } );

				} } );
				return { d, el: h( 'label', { class: 'trow' }, cb, ' ', d.label ), sync: () => ( cb.checked = !! game.tuning[ d.key ] ) };

			}

			const out = h( 'span', { class: 'val' } );
			const range = h( 'input', { type: 'range', min: 0, max: 1000, step: 1, oninput: () => {

				const v = fromSlider( d, + range.value );
				out.textContent = v.toFixed( 2 ) + '×';
				game.setTuning( { [ d.key ]: v } );

			} } );
			return { d, el: h( 'div', { class: 'trow' }, h( 'span', { text: d.label } ), range, out ), sync: () => {

				range.value = toSlider( d, game.tuning[ d.key ] );
				out.textContent = game.tuning[ d.key ].toFixed( 2 ) + '×';

			} };

		} );
		this.rows = rows;
		const depth = h( 'input', { type: 'number', min: 1, max: 9999, value: 1, style: { width: '80px' } } );
		this.depth = depth;
		const btn = ( text, fn ) => h( 'button', { text, onclick: fn } );
		return h( 'div', { class: 'panel menu' },
			h( 'h2', { text: 'Paused' } ),
			h( 'div', { class: 'btns' },
				btn( 'Resume (Esc)', () => ui.open( 'pause', false ) ),
				btn( 'Return to town', () => {

					ui.open( 'pause', false );
					game.enterTown();

				} ),
				btn( 'Restart level', () => {

					ui.open( 'pause', false );
					if ( game.mode === 'level' ) game.enterLevel( game.save.depth );

				} ) ),
			h( 'h3', { text: 'Difficulty & tuning (debug)' } ),
			h( 'div', { class: 'tuning' }, rows.map( ( r ) => r.el ) ),
			h( 'div', { class: 'btns' }, btn( 'Reset tuning', () => {

				game.resetTuning();
				rows.forEach( ( r ) => r.sync() );

			} ) ),
			h( 'h3', { text: 'Debug' } ),
			h( 'div', { class: 'btns' },
				h( 'label', {}, 'Go to depth ', depth ), btn( 'Go', () => {

					ui.open( 'pause', false );
					game.enterLevel( Math.max( 1, + depth.value || 1 ) );

				} ),
				btn( '+1 level', () => game.gainXp( Math.max( 1, xpToNext( game.save.level ) - game.save.xp ) / game.tuning.xpGain ) ),
				btn( '+10,000 gold', () => game.gainGold( 10000 ) ),
				btn( 'Full heal', () => {

					const p = game.world?.player;
					if ( p ) {

						p.life = p.maxLife; p.mana = p.maxMana;

					}

				} ) ),
			h( 'p', { class: 'dim', text: 'Sliders apply immediately to everything already alive. Agents: game.api("tuning.set", {...}).' } ) );

	},
	onOpen() {

		this.rows.forEach( ( r ) => r.sync() );
		this.depth.value = this.depthValue ?? 1;

	}
} );

const CSS = `
.hud { position: absolute; inset: 0; }
.hud .area { position: absolute; top: max(10px, env(safe-area-inset-top)); left: 50%; transform: translateX(-50%); font-weight: 600; text-shadow: 0 1px 3px #000; letter-spacing: 0.04em; }
.hud .bottom { position: absolute; bottom: calc(max(14px, env(safe-area-inset-bottom)) + 10px); left: 50%; transform: translateX(-50%); display: flex; gap: 14px; align-items: center; }
.hud .info { font-weight: 600; text-shadow: 0 1px 3px #000; min-width: 140px; text-align: center; }
.bar { position: relative; width: min(30vw, 260px); height: 22px; background: rgba(0,0,0,0.6); border: 1px solid var(--line); border-radius: 11px; overflow: hidden; }
.bar .fill { position: absolute; inset: 0; width: 100%; transition: width 0.08s linear; }
.bar.life .fill { background: linear-gradient(#ef4a4a, #9c1e1e); }
.bar.mana .fill { background: linear-gradient(#4a8cef, #1e4c9c); }
.bar span { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 600; text-shadow: 0 1px 2px #000; }
.xpbar { position: absolute; left: 0; right: 0; bottom: 0; height: 5px; background: rgba(0,0,0,0.6); }
.xpbar .fill { height: 100%; background: var(--xp); }
.toasts { position: absolute; top: 18%; left: 50%; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; gap: 6px; }
.toast { background: var(--bg2); border: 1px solid var(--line); border-radius: 8px; padding: 6px 14px; font-weight: 600; transition: opacity 0.5s, transform 0.5s; }
.toast.out { opacity: 0; transform: translateY(-10px); }
.toast.levelup { color: var(--accent); font-size: 18px; }
.menu { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: min(560px, 94vw); max-height: 90vh; overflow: auto; }
.menu .btns { display: flex; flex-wrap: wrap; gap: 8px; margin: 6px 0 12px; align-items: center; }
.tuning { display: grid; gap: 4px; margin-bottom: 6px; }
.trow { display: grid; grid-template-columns: 170px 1fr 64px; gap: 8px; align-items: center; font-size: 13px; }
label.trow { display: block; }
.trow .val { text-align: right; font-variant-numeric: tabular-nums; color: var(--accent); }
`;
