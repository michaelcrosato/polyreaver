// Combat HUD (uiPanel 'skillbar'): the six skill slots + potion + dodge with
// procedural icons, key labels for the active device, cooldown sweeps, a blue tint
// when mana is short, a flash on use and a shake on failure; the player's buffs and
// debuffs; the touch twin-stick overlay; a chase-camera crosshair and a red hurt
// vignette. It also adds a "Combat, camera & audio" section to the pause menu.
//
// Everything here READS game state; actions go through the input layer.

import { define, get } from '../../../core/registry.js';
import { h } from '../../../ui/shell.js';
import { SLOT_ACTIONS, readLoadout, makeContext, skillLevel, supportList, skillTooltip } from '../skill-core.js';
import { iconURL } from './icons.js';
import { elementOf } from './palette.js';
import { touchUI } from './touch-ui.js';
import { settings, setSetting, onSetting } from './settings.js';
import { PAD_LABELS, KEY_LABELS } from './input.js';
import { CAMERA_MODES } from './camera.js';

const SLOTS = [ ...SLOT_ACTIONS, 'potion', 'dodge' ];

function makeSlot( action, cls ) {

	const icon = h( 'img', { class: 'ic', draggable: 'false', alt: '' } );
	const cd = h( 'div', { class: 'cd' } );
	const cdt = h( 'span', { class: 'cdt' } );
	const key = h( 'span', { class: 'key' } );
	const cost = h( 'span', { class: 'cost' } );
	const el = h( 'div', { class: 'pr-slot ' + cls }, icon, cd, cdt, key, cost );
	return { el, icon, cd, cdt, key, cost, action, skill: undefined, label: '', lastCd: - 1, lastText: '' };

}

define( 'uiPanel', { id: 'skillbar', order: 30,
	mount( ui ) {

		document.head.append( h( 'style', { text: CSS } ) );
		this.game = ui.game;
		// --- desktop bar ---------------------------------------------------------------
		this.slots = SLOTS.map( ( a ) => makeSlot( a, a === 'dodge' ? 'small' : a === 'potion' ? 'potion' : '' ) );
		const S = Object.fromEntries( this.slots.map( ( s ) => [ s.action, s ] ) );
		this.buffs = h( 'div', { class: 'pr-buffs' } );
		this.bar = h( 'div', { class: 'pr-bar' },
			S.dodge.el, h( 'div', { class: 'gap' } ),
			...SLOT_ACTIONS.map( ( a ) => S[ a ].el ),
			h( 'div', { class: 'gap' } ), S.potion.el );

		// --- touch overlay ------------------------------------------------------------------
		this.tslots = [ ...SLOTS, 'interact' ].map( ( a ) => makeSlot( a, 'touch ' + ( a === 'attack' ? 'big' : a ) ) );
		const T = Object.fromEntries( this.tslots.map( ( s ) => [ s.action, s ] ) );
		touchUI.stickBase = h( 'div', { class: 'pr-stick-base' } );
		touchUI.stickKnob = h( 'div', { class: 'pr-stick-knob' } );
		const cluster = h( 'div', { class: 'pr-cluster' }, ...this.tslots.map( ( s ) => s.el ) );
		touchUI.root = h( 'div', { class: 'pr-touch hidden' }, touchUI.stickBase, touchUI.stickKnob, cluster );
		touchUI.buttons = this.tslots.map( ( s ) => ( { el: s.el, action: s.action } ) );
		// buttons sit on two arcs around the big attack button, all within reach of the
		// right thumb: the inner ring (skill 1, dodge, skill 2) is one short slide away
		const place = { skill1: [ 180, 114 ], dodge: [ 135, 114 ], skill2: [ 90, 114 ], skill3: [ 166, 194 ], skill4: [ 129, 194 ], skill5: [ 93, 194 ], potion: [ 95, 280 ], interact: [ 122, 282 ] };
		for ( const [ a, [ deg, r ] ] of Object.entries( place ) ) {

			const w = a === 'potion' || a === 'interact' ? 48 : a === 'dodge' ? 66 : 62, ang = deg * Math.PI / 180;
			T[ a ].el.style.right = `${46 - Math.cos( ang ) * r - w / 2}px`;
			T[ a ].el.style.bottom = `${46 + Math.sin( ang ) * r - w / 2}px`;

		}

		this.cross = h( 'div', { class: 'pr-cross hidden' } );
		this.hurt = h( 'div', { class: 'pr-hurt' } );
		this.root = h( 'div', { class: 'pr-hud' }, this.hurt, this.cross, this.buffs, this.bar, touchUI.root );
		this.optionsDone = false; // the pause panel mounts after this one: inject on the first update
		this.costAt = 0;
		this.flashes = new Map();
		return this.root;

	},

	// --- pause menu section ---------------------------------------------------------------
	injectOptions( ui ) {

		const pause = ui.panels.get( 'pause' );
		const game = ui.game;
		const row = ( label, input ) => h( 'div', { class: 'trow' }, h( 'span', { text: label } ), input, h( 'span', { class: 'val' } ) );
		const slider = ( key, min, max, fmt ) => {

			const r = h( 'input', { type: 'range', min: 0, max: 100, step: 1 } );
			const set = () => ( r.value = ( settings[ key ] - min ) / ( max - min ) * 100 );
			r.addEventListener( 'input', () => {

				const v = min + ( max - min ) * r.value / 100;
				setSetting( key, v );
				r.parentElement.lastChild.textContent = fmt( v );

			} );
			const el = row( key === 'master' ? 'Master volume' : key === 'sfx' ? 'Effects volume' : 'Screen shake', r );
			el.sync = () => {

				set();
				el.lastChild.textContent = fmt( settings[ key ] );

			};

			return el;

		};

		const toggle = ( key, label ) => {

			const cb = h( 'input', { type: 'checkbox', onchange: () => setSetting( key, cb.checked ) } );
			const el = h( 'label', { class: 'trow' }, cb, ' ', label );
			el.sync = () => ( cb.checked = !! settings[ key ] );
			return el;

		};

		const select = ( key, label, opts ) => {

			const s = h( 'select', { onchange: () => setSetting( key, s.value ) }, ...opts.map( ( [ v, t ] ) => h( 'option', { value: v, text: t } ) ) );
			const el = row( label, s );
			el.sync = () => ( s.value = settings[ key ] );
			return el;

		};

		const camBtns = CAMERA_MODES.map( ( m ) => h( 'button', { text: { iso: 'Isometric', chase: 'Over the shoulder', top: 'Top-down' }[ m ], onclick: () => {

			game.rc?.cameraControl?.setMode( m );
			sync();

		} } ) );
		const pct = ( v ) => Math.round( v * 100 ) + '%';
		const rows = [
			slider( 'master', 0, 1, pct ), slider( 'sfx', 0, 1, pct ), slider( 'shake', 0, 1.5, pct ),
			toggle( 'hitstop', 'Hit-stop on heavy hits' ), toggle( 'numbers', 'Damage numbers' ),
			select( 'touch', 'Touch controls', [ [ 'auto', 'Automatic' ], [ 'on', 'Always' ], [ 'off', 'Never' ] ] ),
			select( 'lights', 'Dynamic lights', [ [ 'auto', 'Automatic' ], [ 'high', 'High (6)' ], [ 'low', 'Low (2)' ] ] )
		];
		const sync = () => {

			for ( const r of rows ) r.sync();
			const mode = game.rc?.camMode ?? settings.camera;
			camBtns.forEach( ( b, i ) => b.classList.toggle( 'on', CAMERA_MODES[ i ] === mode ) );

		};

		this.syncOptions = sync;
		const help = h( 'p', { class: 'dim', html: '<b>Keyboard</b>: WASD move · mouse aim · LMB attack · RMB / 1-4 skills · Space dodge · Q potion · F interact · V camera · wheel zoom<br>' +
			'<b>Gamepad</b>: sticks move / aim · A attack · X Y RB RT LB skills · B dodge · LT potion · d-pad ↓ interact, → camera<br>' +
			'<b>Touch</b>: left thumb moves · tap a skill to auto-aim, drag it to aim · pinch to zoom' } );
		const section = h( 'div', { class: 'pr-options' },
			h( 'h3', { text: 'Combat, camera & audio' } ),
			h( 'div', { class: 'btns' }, h( 'span', { text: 'Camera (V):' } ), ...camBtns ),
			h( 'div', { class: 'tuning' }, rows ), help );
		// players look for camera and volume before the debug sliders: above the first h3
		if ( pause ) pause.el.insertBefore( section, pause.el.querySelector( 'h3' ) );
		onSetting( ( k ) => {

			if ( k === 'lights' ) game.rc?.combatFx?.applyLightBudget();

		} );
		sync();

	},

	update( ui, game, dt ) {

		if ( ! this.optionsDone ) {

			this.optionsDone = true;
			this.injectOptions( ui );

		}

		const w = game.world, p = w?.player;
		if ( ! p ) return;
		const pauseOpen = ui.isOpen( 'pause' );
		if ( pauseOpen && ! this.wasPause ) this.syncOptions?.();
		this.wasPause = pauseOpen;

		const touch = touchUI.visible;
		this.bar.classList.toggle( 'hidden', touch );
		const slots = touch ? this.tslots : this.slots;
		const lo = readLoadout( game.save );
		const device = game.input.device;
		const labels = device === 'gamepad' ? PAD_LABELS : KEY_LABELS;

		// mana costs refresh a few times a second (they depend on stats and supports)
		this.costAt -= dt;
		if ( this.costAt <= 0 ) {

			this.costAt = 0.25;
			this.costs = lo.bar.map( ( id ) => {

				const sk = id && get( 'skill', id );
				return sk ? makeContext( w, p, sk, skillLevel( lo, id, p ), supportList( lo, id ), { preview: true } ).manaCost : 0;

			} );

		}

		for ( const s of slots ) {

			const i = SLOT_ACTIONS.indexOf( s.action );
			let cdKey = s.action;
			if ( i >= 0 ) {

				const id = lo.bar[ i ];
				cdKey = id;
				if ( s.skill !== id ) {

					s.skill = id;
					const sk = id && get( 'skill', id );
					if ( sk ) s.icon.src = iconURL( sk.icon, elementOf( sk.element ).text );
					else s.icon.removeAttribute( 'src' ); // an empty src would re-request the page
					s.icon.style.visibility = sk ? 'visible' : 'hidden';
					s.el.title = sk ? skillTooltip( game, id )?.lines.join( '\n' ) ?? sk.name : 'Empty slot';
					s.el.classList.toggle( 'empty', ! sk );

				}

				const cost = this.costs?.[ i ] ?? 0;
				s.el.classList.toggle( 'nomana', !! id && p.mana < cost );
				const ct = cost ? String( cost ) : '';
				if ( s.cost.textContent !== ct ) s.cost.textContent = ct;

			} else if ( ! s.icon.src ) {

				const look = { potion: [ 'potion', '#ff5a5a' ], dodge: [ 'dash', '#cfd8e6' ], interact: [ 'hand', '#ffd27a' ] }[ s.action ];
				s.icon.src = iconURL( look[ 0 ], look[ 1 ] );

			}

			const label = touch ? '' : labels[ s.action ] ?? '';
			if ( s.label !== label ) s.key.textContent = s.label = label;

			// cooldown sweep: a conic mask that unwinds clockwise
			const ready = cdKey ? p.cooldowns.get( cdKey ) ?? 0 : 0;
			const left = Math.max( 0, ready - w.time );
			const total = p.data.cdTotal?.[ cdKey ] ?? Math.max( left, 1 );
			const f = left > 0 ? Math.min( 1, left / total ) : 0;
			if ( Math.abs( f - s.lastCd ) > 0.004 ) {

				s.lastCd = f;
				s.cd.style.background = f > 0 ? `conic-gradient(rgba(5,8,14,0.78) ${f * 360}deg, transparent 0)` : 'none';

			}

			const txt = left > 0.95 ? left.toFixed( 0 ) : left > 0 ? left.toFixed( 1 ) : '';
			if ( s.lastText !== txt ) s.cdt.textContent = s.lastText = txt;

		}

		// use / fail flashes from sim events (wired once per world)
		if ( this.world !== w ) {

			this.world = w;
			w.events.on( 'skill', ( e ) => e.entity === w.player && this.flash( e.slot, 'used' ) );
			w.events.on( 'skillFail', ( e ) => e.entity === w.player && this.flash( e.slot, 'fail' ) );
			w.events.on( 'dodge', ( e ) => e.entity === w.player && this.flash( - 2, 'used' ) );

		}

		for ( const [ el, t ] of this.flashes ) {

			if ( performance.now() > t ) {

				el.classList.remove( 'used', 'fail' );
				this.flashes.delete( el );

			}

		}

		this.updateBuffs( p, w );
		const rc = game.rc;
		this.cross.classList.toggle( 'hidden', rc?.camMode !== 'chase' );
		const hurtK = rc?.combatHurt !== undefined ? Math.max( 0, 1 - ( rc.time - rc.combatHurt ) / 0.4 ) : 0;
		const low = p.alive && p.lifeFrac < 0.3 ? ( 0.5 + 0.5 * Math.sin( performance.now() / 160 ) ) * ( 0.3 - p.lifeFrac ) * 2 : 0;
		const o = Math.min( 0.85, hurtK * 0.6 + low );
		if ( Math.abs( o - ( this.hurtO ?? - 1 ) ) > 0.01 ) {

			this.hurtO = o;
			this.hurt.style.opacity = o.toFixed( 3 );

		}

	},

	flash( slot, cls ) {

		const list = touchUI.visible ? this.tslots : this.slots;
		const s = slot === - 2 ? list.find( ( q ) => q.action === 'dodge' ) : list.find( ( q ) => q.action === SLOT_ACTIONS[ slot ] );
		if ( ! s ) return;
		s.el.classList.remove( 'used', 'fail' );
		void s.el.offsetWidth; // restart the CSS animation
		s.el.classList.add( cls );
		this.flashes.set( s.el, performance.now() + 350 );

	},

	updateBuffs( p, w ) {

		const list = [ ...p.statuses.values() ].filter( ( s ) => ! s.def.hidden );
		const key = list.map( ( s ) => s.id + ':' + s.stacks ).join( '|' );
		if ( key !== this.buffKey ) {

			this.buffKey = key;
			this.buffs.replaceChildren( ...list.map( ( s ) => {

				const d = s.def;
				const el = h( 'div', { class: 'pr-buff ' + ( d.kind === 'buff' ? 'good' : 'bad' ), title: d.name },
					h( 'img', { src: iconURL( d.icon ?? 'gem', d.color ?? '#cfd8e6', { size: 48 } ), alt: '' } ),
					h( 'div', { class: 'cd' } ), s.stacks > 1 ? h( 'span', { class: 'stk', text: String( s.stacks ) } ) : null );
				el.dataset.id = s.id;
				return el;

			} ) );

		}

		for ( const el of this.buffs.children ) {

			const s = p.statuses.get( el.dataset.id );
			if ( ! s ) continue;
			const f = 1 - Math.max( 0, Math.min( 1, s.time / Math.max( 0.01, s.total ) ) );
			el.children[ 1 ].style.background = `conic-gradient(rgba(5,8,14,0.7) ${f * 360}deg, transparent 0)`;

		}

	}
} );

const CSS = `
.pr-hud { position: absolute; inset: 0; pointer-events: none; }
.pr-bar { position: absolute; left: 50%; transform: translateX(-50%); bottom: calc(max(14px, env(safe-area-inset-bottom)) + 44px); display: flex; gap: 6px; align-items: flex-end; }
.pr-bar .gap { width: 8px; }
.pr-slot { position: relative; width: 52px; height: 52px; border-radius: 9px; border: 1px solid rgba(255,255,255,0.22); background: #0b0e14; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.6); transition: transform 0.08s, filter 0.15s; }
.pr-slot.small { width: 38px; height: 38px; border-radius: 50%; }
.pr-slot.potion { border-color: rgba(255,120,120,0.45); }
.pr-slot .ic { position: absolute; inset: 0; width: 100%; height: 100%; }
.pr-slot .cd { position: absolute; inset: 0; }
.pr-slot .cdt { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 17px; text-shadow: 0 1px 3px #000; }
.pr-slot .key { position: absolute; left: 3px; top: 1px; font-size: 10px; font-weight: 700; color: #e8ecf4; text-shadow: 0 1px 2px #000; }
.pr-slot .cost { position: absolute; right: 3px; bottom: 1px; font-size: 10px; font-weight: 700; color: #8fb6ff; text-shadow: 0 1px 2px #000; }
.pr-slot.small .key { left: 0; right: 0; text-align: center; top: auto; bottom: 1px; font-size: 9px; }
.pr-slot.empty { opacity: 0.45; }
.pr-slot.nomana .ic { filter: grayscale(0.6) brightness(0.55) sepia(1) hue-rotate(180deg) saturate(3); }
.pr-slot.used { animation: pr-pop 0.22s ease-out; border-color: #ffe9a8; }
.pr-slot.fail { animation: pr-shake 0.3s; border-color: #6fa0ff; }
@keyframes pr-pop { 0% { transform: scale(0.88); filter: brightness(2); } 100% { transform: scale(1); filter: brightness(1); } }
@keyframes pr-shake { 0%,100% { transform: translateX(0); } 25% { transform: translateX(-4px); } 75% { transform: translateX(4px); } }
.pr-buffs { position: absolute; left: 50%; transform: translateX(-50%); bottom: calc(max(14px, env(safe-area-inset-bottom)) + 104px); display: flex; gap: 4px; }
.pr-buff { position: relative; width: 30px; height: 30px; border-radius: 6px; overflow: hidden; border: 2px solid #4caf50; background: #0b0e14; }
.pr-buff.bad { border-color: #e04848; }
.pr-buff img { width: 100%; height: 100%; display: block; }
.pr-buff .cd { position: absolute; inset: 0; }
.pr-buff .stk { position: absolute; right: 1px; bottom: -1px; font-size: 11px; font-weight: 800; text-shadow: 0 1px 2px #000; }
.pr-cross { position: absolute; left: 50%; top: 50%; width: 18px; height: 18px; margin: -9px; border: 2px solid rgba(255,255,255,0.75); border-radius: 50%; box-shadow: 0 0 4px #000; }
.pr-hurt { position: absolute; inset: 0; opacity: 0; background: radial-gradient(ellipse at center, transparent 55%, rgba(200,0,0,0.75) 100%); }
.pr-options { border-bottom: 1px solid var(--line); margin-bottom: 10px; padding-bottom: 6px; }
.pr-options button.on { border-color: var(--accent); color: var(--accent); }
.pr-options .trow input[type=range] { width: 100%; }
/* touch: twin-stick overlay */
.pr-touch { position: absolute; inset: 0; }
.pr-stick-base, .pr-stick-knob { position: absolute; left: 0; top: 0; display: none; border-radius: 50%; pointer-events: none; }
.pr-stick-base { width: 120px; height: 120px; border: 2px solid rgba(255,255,255,0.3); background: rgba(255,255,255,0.06); }
.pr-stick-knob { width: 56px; height: 56px; background: rgba(255,255,255,0.35); border: 2px solid rgba(255,255,255,0.6); }
.pr-cluster { position: absolute; right: max(12px, env(safe-area-inset-right)); bottom: max(12px, env(safe-area-inset-bottom)); width: 1px; height: 1px; }
.pr-slot.touch { position: absolute; width: 62px; height: 62px; border-radius: 50%; pointer-events: auto; touch-action: none; border-width: 2px; }
.pr-slot.touch.big { width: 92px; height: 92px; right: 0; bottom: 0; }
.pr-slot.touch.dodge { width: 66px; height: 66px; border-color: rgba(160,220,255,0.6); }
.pr-slot.touch.potion { width: 48px; height: 48px; border-color: rgba(255,120,120,0.6); }
.pr-slot.touch.interact { width: 48px; height: 48px; border-color: rgba(255,210,120,0.6); }
.pr-slot.touch.down { transform: scale(0.9); filter: brightness(1.4); }
.pr-slot.touch .cost { right: 0; left: 0; text-align: center; }
body.pr-touch-mode .hud .bottom { left: max(10px, env(safe-area-inset-left)); transform: none; top: calc(max(8px, env(safe-area-inset-top)) + 54px); bottom: auto; flex-direction: column; align-items: flex-start; gap: 4px; }
body.pr-touch-mode .hud .bar { width: min(42vw, 210px); height: 16px; }
body.pr-touch-mode .hud .info { min-width: 0; text-align: left; font-size: 12px; }
body.pr-touch-mode .pr-buffs { left: max(10px, env(safe-area-inset-left)); transform: none; top: calc(max(8px, env(safe-area-inset-top)) + 124px); bottom: auto; }
`;
