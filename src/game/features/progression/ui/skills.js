// Skills panel (K, also the Mystic's 'skills' service): the six-slot action bar
// (LMB, RMB, 1-4), every skill the combat feature registered (learnable at its
// level requirement), skill levels and XP, and support-rune sockets.
//
// Tooltips: if the combat feature gives a skill def a `tooltip( level, stats, game )`
// (string, lines array or element) it is used; otherwise a generic one is built
// from the def's name, tags, cost, cooldown and desc.

import { define, all, get } from '../../../core/registry.js';
import { h } from '../../../ui/shell.js';
import { PG, panelHead, hideTip, dirty, toast, btn, showTextTip } from './common.js';
import { assignSkill, learnSkill, canLearn, socketSupport, unsocketSupport, supportSlots, supportFits, skillXpToNext, maxSkillLevel, skillLevel } from '../skills.js';
import { runeIcon } from './icons.js';
import { fmt, modLine } from '../text.js';
import { SLOT_ACTIONS } from '../../combat/skill-core.js';
import { controlLabel, controls } from '../../combat/client/controls.js';

const ELEMENT_COLORS = { fire: '#ff7043', cold: '#64b5f6', lightning: '#ffe95a', chaos: '#b07ae0', physical: '#d8c8a8' };

function skillColor( def ) {

	for ( const t of def.tags ) if ( ELEMENT_COLORS[ t ] ) return ELEMENT_COLORS[ t ];
	return def.tags.includes( 'spell' ) ? '#9ab8ff' : '#e0d0b0';

}

const levelReq = ( d ) => d.levelReq ?? d.level ?? 1;

// game event 'loadout' { skills } tells the combat feature the bar / supports changed
function loadoutChanged() {

	PG.game.events.emit( 'loadout', { skills: PG.game.save.skills } );
	dirty();

}

// Tooltip lines for a skill: the combat feature's own tooltip when it has one.
export function skillTooltipLines( game, def ) {

	const lvl = skillLevel( game, def.id );
	const stats = game.world?.player?.stats;
	try {

		// the combat feature's tooltip (same code path as casting), found through the registry
		const api = get( 'apiCommand', 'combat.tooltip' );
		const t = def.tooltip?.( lvl, stats, game ) ?? api?.run( game, { id: def.id } );
		if ( typeof t === 'string' ) return t.split( '\n' );
		if ( Array.isArray( t ) ) return t;
		if ( t instanceof Element ) return [ t ];
		if ( t?.lines ) return [ ...( t.desc ? [ t.desc ] : [] ), ...t.lines.map( ( l ) => h( 'div', { class: 'pg-dim pg-small', text: l } ) ) ];

	} catch ( e ) {

		console.warn( 'skill tooltip failed', def.id, e );

	}

	const out = [];
	out.push( h( 'div', {}, def.tags.map( ( t ) => h( 'span', { class: 'pg-tag', text: t } ) ) ) );
	if ( def.desc ) out.push( def.desc );
	const facts = [];
	if ( def.manaCost !== undefined ) facts.push( `Mana cost ${typeof def.manaCost === 'function' ? def.manaCost( lvl ) : def.manaCost}` );
	if ( def.cooldown ) facts.push( `Cooldown ${fmt( typeof def.cooldown === 'function' ? def.cooldown( lvl ) : def.cooldown )} s` );
	if ( def.weapon?.length ) facts.push( `Requires ${def.weapon.join( ' / ' )}` );
	facts.push( `Level ${lvl} (requires character level ${levelReq( def )})` );
	for ( const f of facts ) out.push( h( 'div', { class: 't-prop', text: f } ) );
	return out;

}

define( 'uiPanel', { id: 'skills', order: 52, toggle: 'skills', modal: true,
	mount( ui ) {

		PG.ui = ui; PG.game = ui.game;
		this.slot = 0;
		this.sel = null;
		this.bar = h( 'div', { class: 'pg-bar' } );
		this.list = h( 'div', { class: 'pg-list', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))' } } );
		this.detail = h( 'div' );
		this.runes = h( 'div' );
		return h( 'div', { class: 'pg-panel pg-center' },
			panelHead( 'Skills', 'skills' ),
			h( 'div', { class: 'pg-dim pg-small', style: { marginBottom: '6px' }, text: 'Choose a bar slot, then a skill. Skills on the bar gain experience with you; support runes drop from monsters.' } ),
			this.bar,
			h( 'div', { class: 'pg-cols', style: { marginTop: '10px' } }, h( 'div', {}, h( 'h3', { text: 'Skills' } ), this.list ), h( 'div', {}, this.detail, this.runes ) ) );

	},
	renderBar( game ) {

		const s = game.save.skills;
		this.bar.replaceChildren( ...this.bindingLabels.map( ( label, i ) => {

			const def = s.bar[ i ] ? get( 'skill', s.bar[ i ] ) : null;
			const el = h( 'div', { class: 'pg-skill' + ( this.slot === i ? ' pg-sel' : '' ), style: def ? { color: skillColor( def ), borderColor: skillColor( def ) } : {} },
				h( 'span', { class: 'k', text: label } ), def ? def.name : h( 'span', { class: 'pg-dim', text: 'empty' } ),
				def ? h( 'span', { class: 'lv', text: `Lv ${skillLevel( game, def.id )}` } ) : null );
			el.addEventListener( 'click', () => {

				this.slot = i;
				if ( def ) this.sel = def.id;
				dirty();

			} );
			return el;

		} ) );

	},
	renderList( game ) {

		const s = game.save.skills;
		const skills = all( 'skill' ).sort( ( a, b ) => levelReq( a ) - levelReq( b ) || a.name.localeCompare( b.name ) );
		if ( ! skills.length ) {

			this.list.replaceChildren( h( 'div', { class: 'pg-li pg-dim', text: 'No skills are registered yet - the combat feature defines them. Your loadout will fill in automatically.' } ) );
			return;

		}

		this.list.replaceChildren( ...skills.map( ( def ) => {

			const known = s.known.includes( def.id );
			const locked = game.save.level < levelReq( def );
			const lvl = s.levels[ def.id ] ?? 1;
			const xp = s.xp[ def.id ] ?? 0;
			const row = h( 'div', { class: 'pg-li pg-click' + ( this.sel === def.id ? ' pg-sel' : '' ), style: { opacity: locked ? 0.5 : 1 } },
				h( 'div', { style: { width: '10px', height: '28px', borderRadius: '3px', background: skillColor( def ), flex: 'none' } } ),
				h( 'div', { class: 'pg-grow' },
					h( 'div', { style: { fontWeight: 700 } }, def.name, s.bar.includes( def.id ) ? h( 'span', { class: 'pg-dim pg-small', text: `  [${this.bindingLabels[ s.bar.indexOf( def.id ) ]}]` } ) : null ),
					h( 'div', { class: 'pg-dim pg-small', text: locked ? `Unlocks at level ${levelReq( def )}` : known ? `Level ${lvl}${lvl < maxSkillLevel( game.save.level ) ? '' : ' (max for your level)'}` : 'Learnable' } ),
					known ? h( 'div', { class: 'pg-xp' }, h( 'i', { style: { width: `${Math.min( 100, xp / skillXpToNext( lvl ) * 100 )}%` } } ) ) : null ) );
			row.addEventListener( 'click', () => {

				this.sel = def.id;
				dirty();

			} );
			row.addEventListener( 'dblclick', () => this.assign( def.id ) );
			return row;

		} ) );

	},
	assign( id ) {

		const r = assignSkill( PG.game.save, this.slot, id );
		if ( ! r.ok ) toast( r.reason, 'error' );
		loadoutChanged();

	},
	renderDetail( game ) {

		const def = this.sel ? get( 'skill', this.sel ) : null;
		if ( ! def ) {

			this.detail.replaceChildren( h( 'div', { class: 'pg-dim', text: 'Select a skill to see its details.' } ) );
			this.runes.replaceChildren();
			return;

		}

		const s = game.save.skills;
		const known = s.known.includes( def.id );
		const why = known ? null : canLearn( game.save, def.id );
		const lines = skillTooltipLines( game, def );
		this.detail.replaceChildren(
			h( 'h3', { text: def.name } ),
			h( 'div', {}, lines.map( ( l ) => typeof l === 'string' ? h( 'div', { text: l } ) : l ) ),
			h( 'div', { class: 'pg-row', style: { marginTop: '8px' } },
				known ? null : btn( 'Learn', () => {

					const r = learnSkill( game.save, def.id );
					if ( ! r.ok ) toast( r.reason, 'error' );
					loadoutChanged();

				}, { disabled: !! why, title: why || '' } ),
				btn( `Put on ${this.bindingLabels[ this.slot ]}`, () => this.assign( def.id ), { disabled: !! why, cls: 'pg-primary' } ),
				s.bar.includes( def.id ) ? btn( 'Remove from bar', () => {

					assignSkill( game.save, s.bar.indexOf( def.id ), null );
					loadoutChanged();

				} ) : null ) );

		// support sockets
		const socks = s.supports[ def.id ] || [];
		const n = supportSlots( game.save );
		const sockEls = [];
		for ( let i = 0; i < n; i ++ ) {

			const sp = socks[ i ] ? get( 'support', socks[ i ] ) : null;
			const el = h( 'span', { class: 'pg-sock' + ( sp ? ' pg-full' : '' ), title: sp ? 'Click to remove (the rune returns to you)' : 'Empty support socket' }, sp ? sp.name : 'empty' );
			if ( sp ) el.addEventListener( 'click', () => {

				unsocketSupport( game.save, def.id, sp.id );
				loadoutChanged();

			} );
			sockEls.push( el );

		}

		const owned = all( 'support' ).filter( ( sp ) => ( s.runes[ sp.id ] ?? 0 ) > 0 );
		this.runes.replaceChildren(
			h( 'h3', { text: `Support sockets (${socks.length}/${n})` } ), h( 'div', { class: 'pg-row' }, sockEls ),
			h( 'div', { class: 'pg-dim pg-small', style: { margin: '4px 0 6px' }, text: 'More sockets at levels 15, 30 and 45.' } ),
			h( 'h3', { text: 'Your support runes' } ),
			owned.length ? h( 'div', { class: 'pg-list' }, owned.map( ( sp ) => {

				const fits = supportFits( def, sp );
				const row = h( 'div', { class: 'pg-li' + ( fits ? ' pg-click' : '' ), style: { opacity: fits ? 1 : 0.5 } },
					h( 'img', { src: runeIcon(), width: 24, height: 24, alt: '' } ),
					h( 'div', { class: 'pg-grow' }, h( 'div', { text: `${sp.name} ×${s.runes[ sp.id ]}` } ), h( 'div', { class: 'pg-dim pg-small', text: fits ? sp.desc || ( sp.tags.length ? `Supports ${sp.tags.join( ', ' )} skills` : 'Supports any skill' ) : `Cannot support ${def.name}` } ) ) );
				if ( fits ) row.addEventListener( 'click', () => {

					const r = socketSupport( game.save, def.id, sp.id );
					if ( ! r.ok ) toast( r.reason, 'error' );
					loadoutChanged();

				} );
				const mods = typeof sp.mods === 'function' ? sp.mods( 1 ) : sp.mods || [];
				row.addEventListener( 'pointerenter', ( e ) => e.pointerType !== 'touch' && showTextTip( sp.name, [ sp.desc, ...mods.map( ( m ) => modLine( m ) ), sp.manaMult && sp.manaMult !== 1 ? `Mana multiplier ${Math.round( sp.manaMult * 100 )}%` : '' ].filter( Boolean ), row ) );
				row.addEventListener( 'pointerleave', hideTip );
				return row;

			} ) ) : h( 'div', { class: 'pg-dim pg-small', text: 'No support runes yet - they drop from magic, rare and unique monsters.' } ) );

	},
	update( ui, game ) {

		const device = game.input.device;
		if ( this.v === PG.version && this.bindingRevision === controls.revision && this.bindingDevice === device ) return;
		this.v = PG.version;
		this.bindingRevision = controls.revision;
		this.bindingDevice = device;
		this.bindingLabels = SLOT_ACTIONS.map( ( action, i ) => {

			const label = controlLabel( action, device === 'gamepad' ? 'gamepad' : 'keyboard' );
			return device === 'touch' || label === '—' ? `Slot ${i + 1}` : label;

		} );
		this.renderBar( game );
		this.renderList( game );
		this.renderDetail( game );

	},
	onOpen() {

		this.v = - 1;
		this.sel ??= PG.game.save.skills.bar[ this.slot ] ?? null;

	},
	onClose() {

		hideTip();
		PG.game.applyPlayerStats();

	}
} );
