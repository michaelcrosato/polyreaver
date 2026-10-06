// World UI: everything the world feature shows in the DOM overlay.
//
//   'world-prompt'   "F  Blacksmith" floating over the nearest interactable, speech bubbles
//   'world-banner'   level title card (name, mechanics, desc, tip), mechanic chips, optional
//                    objectives and the speedrun timer (with your best time for the depth)
//   'waypoint'       level select: the 20 designed depths (locked past your deepest),
//                    any endless depth, "continue deeper"            (modal; service 'waypoint')
//   'level-exit'     after the exit portal: next depth / town / stay   (modal)
//   'dummy'          the training dummy's DPS meter                     (service 'dummy')
//
// The bootHook wires the sim's events to the UI: 'interact' opens the panel named by
// target.data.service (progression owns vendor / craft / stash / tree / skills; a
// missing panel just shows a toast), 'levelExit' opens 'level-exit', 'speech' shows a
// bubble, 'objective' updates the objective list.

import * as THREE from 'three/webgpu';
import { define, get } from '../../../core/registry.js';
import { h } from '../../../ui/shell.js';
import { nearestInteractable } from '../flow.js';
import { levelSpec, campaign } from '../api.js';
import { dummyStats } from '../town.js';

const _v = new THREE.Vector3();
const fmt = ( s ) => s === undefined || s === null ? '-' : `${Math.floor( s / 60 )}:${( s % 60 ).toFixed( 1 ).padStart( 4, '0' )}`;
const mechName = ( id ) => get( 'mechanic', id )?.name ?? id;

function project( rc, x, y, z ) {

	_v.set( x, y, z ).project( rc.camera );
	return { x: ( _v.x * 0.5 + 0.5 ) * innerWidth, y: ( 0.5 - _v.y * 0.5 ) * innerHeight, visible: _v.z < 1 && Math.abs( _v.x ) < 1.2 && Math.abs( _v.y ) < 1.2 };

}

// --- wiring ---------------------------------------------------------------------------
define( 'bootHook', { id: 'world-ui', order: 60, boot( { game, ui } ) {

	game.ui = ui;
	const attach = ( world ) => {

		world.events.on( 'interact', ( { target } ) => {

			const svc = target.data.service;
			if ( target.data.portal === 'exit' && world.state.complete ) ui.open( 'level-exit', true );
			if ( ! svc ) return;
			if ( ui.panels.has( svc ) ) ui.open( svc, svc === 'dummy' ? ! ui.isOpen( 'dummy' ) : true );
			else ui.toast( `${target.data.title || target.name}: not open for business yet`, '' );

		} );
		world.events.on( 'speech', ( s ) => speech( s.entity, s.text ) );
		world.events.on( 'objective', ( o ) => objective( ui, o ) );
		world.events.on( 'levelExit', () => setTimeout( () => ui.open( 'level-exit', true ), 250 ) );

	};

	game.events.on( 'world', ( { world } ) => {

		objectives.clear();
		attach( world );
		// objectives announced while the world was being built (before we listened)
		for ( const o of Object.values( world.state.objectives || {} ) ) objective( ui, { ...o, flash: false } );
		const banner = ui.panels.get( 'world-banner' );
		if ( banner ) banner.def.show( ui, game, world );
		if ( ui.isOpen( 'level-exit' ) ) ui.open( 'level-exit', false );
		if ( ui.isOpen( 'dummy' ) && world.kind !== 'town' ) ui.open( 'dummy', false );

	} );
	if ( game.world ) attach( game.world );

} } );

// --- floating prompt + speech bubbles ---------------------------------------------------------
const bubbles = [];
let bubbleLayer = null;

function speech( entity, text ) {

	if ( ! bubbleLayer ) return;
	const el = h( 'div', { class: 'w-bubble', text } );
	bubbleLayer.append( el );
	bubbles.push( { entity, el, until: performance.now() + 4200 } );
	while ( bubbles.length > 4 ) bubbles.shift().el.remove();

}

define( 'uiPanel', { id: 'world-prompt', order: 12, startOpen: true,
	mount() {

		this.el = h( 'div', { class: 'w-prompt hidden' }, h( 'b', { text: 'F' } ), h( 'span' ) );
		bubbleLayer = h( 'div', { class: 'w-bubbles' } );
		return h( 'div', { class: 'w-layer' }, this.el, bubbleLayer );

	},
	update( ui, game ) {

		const w = game.world, p = w?.player, rc = game.rc;
		if ( ! p || ! rc ) return;
		const t = p.alive ? nearestInteractable( w, p ) : null;
		const label = t ? ( t.data.interact || t.data.title || t.name ) : null;
		if ( ! label ) {

			this.el.classList.add( 'hidden' );

		} else {

			const s = project( rc, t.x, ( t.height ?? 1.8 ) + 0.6, t.z );
			this.el.classList.toggle( 'hidden', ! s.visible );
			this.el.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -100%)`;
			if ( this.el.lastChild.textContent !== label ) this.el.lastChild.textContent = label;

		}

		const now = performance.now();
		for ( let i = bubbles.length - 1; i >= 0; i -- ) {

			const b = bubbles[ i ];
			if ( now > b.until || ! b.entity.alive ) {

				b.el.remove();
				bubbles.splice( i, 1 );
				continue;

			}

			const s = project( rc, b.entity.x, ( b.entity.height ?? 1.8 ) + 1.1, b.entity.z );
			b.el.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -100%)`;
			b.el.style.opacity = Math.min( 1, ( b.until - now ) / 500 );

		}

	}
} );

// --- banner: title card, chips, objectives, timer ------------------------------------------------
const objectives = new Map();

function objective( ui, o ) {

	objectives.set( o.id, { text: o.text, done: o.done, at: performance.now(), flash: o.flash } );
	if ( o.flash ) ui.toast( o.text, 'objective' );
	ui.panels.get( 'world-banner' )?.def.renderObjectives?.();

}

define( 'uiPanel', { id: 'world-banner', order: 14, startOpen: true,
	mount() {

		this.card = h( 'div', { class: 'w-card hidden' } );
		this.chips = h( 'div', { class: 'w-chips' } );
		this.obj = h( 'div', { class: 'w-objectives' } );
		this.timer = h( 'div', { class: 'w-timer' } );
		return h( 'div', { class: 'w-layer' }, this.card, this.chips, this.obj, this.timer );

	},
	show( ui, game, world ) {

		this.cardUntil = 0;
		this.chips.replaceChildren();
		this.timer.textContent = '';
		if ( world.kind !== 'level' || ! world.spec ) {

			this.card.classList.add( 'hidden' );
			return;

		}

		const s = world.spec;
		const mechs = ( s.mechanics || [] ).map( ( id ) => get( 'mechanic', id ) ).filter( Boolean );
		const kind = s.kind === 'combo' ? 'Combination' : s.kind === 'endless' ? 'Endless' : s.kind === 'trial' ? 'Trial' : 'Depth ' + s.depth;
		this.card.replaceChildren(
			h( 'div', { class: 'w-kicker', text: `${kind} · depth ${s.depth} · area level ${s.level}` } ),
			h( 'h1', { text: s.name } ),
			h( 'div', { class: 'w-sub', text: ( get( 'theme', s.theme )?.name ?? '' ) + ( s.bossName ? ` · ${s.bossName} awaits` : '' ) } ),
			...mechs.map( ( m ) => h( 'div', { class: 'w-mech' }, h( 'b', { text: m.name } ), h( 'span', { text: m.desc } ), h( 'em', { text: m.tip } ) ) )
		);
		this.card.classList.remove( 'hidden', 'out' );
		this.cardUntil = performance.now() + 7000;
		for ( const m of mechs ) this.chips.append( h( 'span', { class: 'w-chip', title: m.desc + '\n\n' + m.tip, text: m.name } ) );
		this.best = game.save.world?.best?.[ s.depth ];
		this.renderObjectives();

	},
	renderObjectives() {

		this.obj.replaceChildren( ...[ ...objectives.values() ].slice( - 4 ).map( ( o ) => h( 'div', { class: 'w-obj' + ( o.done ? ' done' : '' ), text: o.text } ) ) );

	},
	update( ui, game ) {

		const w = game.world;
		if ( this.cardUntil && performance.now() > this.cardUntil ) {

			this.card.classList.add( 'out' );
			if ( performance.now() > this.cardUntil + 700 ) {

				this.card.classList.add( 'hidden' );
				this.cardUntil = 0;

			}

		}

		if ( w?.kind === 'level' && w.state.flow ) {

			const t = w.time - w.state.flow.start;
			const txt = `${fmt( t )}${this.best ? `  ·  best ${fmt( this.best )}` : ''}`;
			if ( this.timer.textContent !== txt ) this.timer.textContent = txt;

		}

	}
} );

// --- waypoint: level select -------------------------------------------------------------------------
define( 'uiPanel', { id: 'waypoint', order: 70, modal: true, startOpen: false,
	mount( ui ) {

		this.list = h( 'div', { class: 'w-levels' } );
		this.depth = h( 'input', { type: 'number', min: 21, value: 21, style: { width: '90px' }, oninput: () => this.preview() } );
		this.prev = h( 'div', { class: 'dim w-preview' } );
		this.cont = h( 'button', { class: 'w-go', onclick: () => go( ui, ui.game.save.maxDepth ) } );
		return h( 'div', { class: 'panel menu w-waypoint' },
			h( 'h2', { text: 'Waypoint' } ),
			h( 'p', { class: 'dim', text: 'Each depth is built around one mechanic - fight through it, or bend it to your will. Deeper levels combine them.' } ),
			h( 'div', { class: 'btns' }, this.cont, h( 'button', { text: 'Close', onclick: () => ui.open( 'waypoint', false ) } ) ),
			this.list,
			h( 'h3', { text: 'Endless depths' } ),
			h( 'div', { class: 'btns' }, h( 'label', {}, 'Depth ', this.depth ), h( 'button', { text: 'Descend', onclick: () => go( ui, Math.max( 1, + this.depth.value || 21 ) ) } ) ),
			this.prev );

	},
	onOpen( ui ) {

		const save = ui.game.save, max = save.maxDepth ?? 1;
		const unlockAll = /unlock/.test( location.hash );
		this.cont.textContent = `Continue deeper - depth ${max}: ${levelSpec( max ).name}`;
		this.list.replaceChildren( ...campaign( 20 ).map( ( s ) => {

			const locked = s.depth > max && ! unlockAll;
			const best = save.world?.best?.[ s.depth ];
			const attrs = { class: 'w-level' + ( locked ? ' locked' : '' ) + ( s.depth > 12 ? ' combo' : '' ), onclick: () => go( ui, s.depth ) };
			if ( locked ) attrs.disabled = 'disabled';
			return h( 'button', attrs,
				h( 'span', { class: 'w-num', text: s.depth } ),
				h( 'span', { class: 'w-name', text: locked ? 'Locked' : s.name } ),
				h( 'span', { class: 'w-mechs', text: locked ? '' : s.mechanics.map( mechName ).join( ' + ' ) } ),
				h( 'span', { class: 'w-best', text: best ? fmt( best ) : '' } ) );

		} ) );
		this.depth.max = Math.max( 21, max );
		this.depth.value = Math.max( 21, Math.min( max, + this.depth.value || 21 ) );
		this.preview();

	},
	preview() {

		const d = Math.max( 1, + this.depth.value || 21 );
		const s = levelSpec( d );
		this.prev.textContent = `${s.name} - ${s.mechanics.map( mechName ).join( ' + ' )} · ${get( 'theme', s.theme )?.name} · area level ${s.level}`;

	}
} );

function go( ui, depth ) {

	ui.open( 'waypoint', false );
	ui.open( 'level-exit', false );
	ui.game.enterLevel( depth );

}

// --- level exit ------------------------------------------------------------------------------------
define( 'uiPanel', { id: 'level-exit', order: 72, modal: true, startOpen: false,
	mount( ui ) {

		this.title = h( 'h2' );
		this.info = h( 'p', { class: 'dim' } );
		this.next = h( 'button', { class: 'w-go', onclick: () => go( ui, ( ui.game.world?.spec?.depth ?? ui.game.save.depth ) + 1 ) } );
		return h( 'div', { class: 'panel menu w-exit' }, this.title, this.info,
			h( 'div', { class: 'btns' }, this.next,
				h( 'button', { text: 'Return to town', onclick: () => {

					ui.open( 'level-exit', false );
					ui.game.enterTown();

				} } ),
				h( 'button', { text: 'Stay', onclick: () => ui.open( 'level-exit', false ) } ) ) );

	},
	onOpen( ui ) {

		const w = ui.game.world, s = w?.spec;
		const depth = s?.depth ?? ui.game.save.depth;
		const t = w ? w.time - ( w.state.flow?.start ?? 0 ) : 0;
		const best = ui.game.save.world?.best?.[ depth ];
		this.title.textContent = `${s?.name ?? 'Level'} cleared`;
		this.info.textContent = `Depth ${depth} in ${fmt( t )}${ui.game.save.world?.newBest ? ' - a new best!' : best ? ` (best ${fmt( best )})` : ''} · ${w?.stats.kills ?? 0} kills`;
		const next = levelSpec( depth + 1 );
		this.next.textContent = `Descend: depth ${depth + 1} - ${next.name} (${next.mechanics.map( mechName ).join( ' + ' )})`;

	}
} );

// --- training dummy DPS meter ---------------------------------------------------------------------------
define( 'uiPanel', { id: 'dummy', order: 30, startOpen: false,
	mount() {

		this.v = h( 'div', { class: 'w-dps-v' } );
		this.d = h( 'div', { class: 'dim' } );
		return h( 'div', { class: 'panel w-dps' }, h( 'div', { class: 'w-kicker', text: 'Training dummy' } ), this.v, this.d );

	},
	update( ui, game ) {

		const w = game.world;
		const dummy = w?.entities.find( ( e ) => e.data?.service === 'dummy' );
		if ( ! dummy ) return;
		const s = dummyStats( w, dummy );
		this.v.textContent = `${Math.round( s.dps5 ).toLocaleString()} DPS`;
		this.d.textContent = s.active ? `session ${Math.round( s.session ).toLocaleString()} DPS · total ${Math.round( s.total ).toLocaleString()} · biggest hit ${Math.round( s.max ).toLocaleString()}` : 'Hit the dummy to start measuring';

	}
} );

const CSS = `
.w-layer { position: absolute; inset: 0; pointer-events: none; }
.w-prompt { position: absolute; left: 0; top: 0; display: flex; gap: 6px; align-items: center; background: rgba(10,12,18,0.82); border: 1px solid var(--line); border-radius: 8px; padding: 3px 9px 3px 4px; font-size: 13px; font-weight: 600; white-space: nowrap; }
.w-prompt b { background: var(--accent); color: #1a1408; border-radius: 5px; padding: 1px 6px; font-size: 12px; }
.w-bubble { position: absolute; left: 0; top: 0; max-width: 240px; background: rgba(245,240,228,0.95); color: #221c14; border-radius: 10px; padding: 6px 10px; font-size: 13px; line-height: 1.3; box-shadow: 0 2px 10px rgba(0,0,0,0.4); }
.w-card { position: absolute; top: 12%; left: 50%; transform: translateX(-50%); width: min(560px, 92vw); text-align: center; text-shadow: 0 2px 6px #000; transition: opacity 0.6s, transform 0.6s; }
.w-card.out { opacity: 0; transform: translate(-50%, -14px); }
.w-card h1 { margin: 2px 0 2px; font-size: clamp(28px, 6vw, 46px); letter-spacing: 0.06em; text-transform: uppercase; color: #fff4dc; }
.w-kicker { font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--accent); }
.w-sub { color: var(--dim); margin-bottom: 10px; }
.w-mech { background: rgba(10,12,18,0.72); border: 1px solid var(--line); border-radius: 10px; padding: 8px 12px; margin: 6px auto; text-align: left; text-shadow: none; }
.w-mech b { display: block; color: var(--accent); font-size: 15px; }
.w-mech span { display: block; font-size: 13px; margin: 2px 0; }
.w-mech em { display: block; font-size: 12px; color: var(--good); font-style: normal; }
.w-chips { position: absolute; top: calc(max(10px, env(safe-area-inset-top)) + 24px); left: 50%; transform: translateX(-50%); display: flex; gap: 6px; }
@media (max-width: 600px) { .w-chips { left: max(10px, env(safe-area-inset-left)); transform: none; top: calc(max(8px, env(safe-area-inset-top)) + 26px); } }
.w-chip { pointer-events: auto; background: rgba(10,12,18,0.7); border: 1px solid var(--line); border-radius: 999px; padding: 1px 10px; font-size: 12px; color: var(--accent); cursor: help; }
.w-objectives { position: absolute; top: 272px; right: 14px; display: flex; flex-direction: column; gap: 4px; align-items: flex-end; }
.w-obj { background: rgba(10,12,18,0.7); border-left: 3px solid var(--accent); padding: 3px 10px; font-size: 12px; border-radius: 4px; }
.w-obj.done { border-color: var(--good); color: var(--good); }
.w-timer { position: absolute; top: 252px; right: 14px; font-variant-numeric: tabular-nums; font-size: 12px; color: var(--dim); text-shadow: 0 1px 2px #000; }
.toast.objective { color: var(--accent); }
.w-waypoint { width: min(760px, 96vw); }
.w-levels { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 6px; margin: 8px 0 12px; }
.w-level { display: grid; grid-template-columns: 30px 1fr; grid-template-rows: auto auto; text-align: left; padding: 6px 8px; gap: 0 6px; }
.w-level .w-num { grid-row: span 2; font-size: 20px; font-weight: 700; color: var(--accent); align-self: center; }
.w-level .w-name { font-weight: 600; }
.w-level .w-mechs { font-size: 11px; color: var(--dim); }
.w-level .w-best { position: absolute; }
.w-level.combo { border-color: #6a4a8a; }
.w-level.locked { opacity: 0.45; cursor: not-allowed; }
.w-go { border-color: var(--accent); color: var(--accent); font-weight: 600; }
.w-preview { margin-top: 4px; font-size: 13px; }
.w-dps { position: absolute; right: 14px; bottom: 90px; min-width: 220px; text-align: right; }
.w-dps-v { font-size: 26px; font-weight: 700; color: var(--accent); font-variant-numeric: tabular-nums; }
`;
document.head.append( h( 'style', { text: CSS } ) );
