// Character sheet (C): every important number with its explanation. Hovering (or
// tapping) a row shows StatBlock.breakdown(): base + flat, increased, more, overrides,
// and each contributing modifier with where it came from (item, passive, keystone,
// attribute, buff, difficulty slider).

import { define } from '../../../core/registry.js';
import { h } from '../../../ui/shell.js';
import { PG, panelHead, hideTip, showTextTip } from './common.js';
import { estimateAttack, SOURCE_NAMES } from '../stats.js';
import { modLine, fmt, cap } from '../text.js';
import { runtime } from '../mechanics.js';
import { get } from '../../../core/registry.js';
import { xpToNext } from '../../../core/tuning.js';
import { pointsLeft } from '../tree.js';

const pct = ( v ) => fmt( v ) + '%';
const num = ( v ) => fmt( Math.abs( v ) >= 10 ? Math.round( v ) : Math.round( v * 10 ) / 10 );

// [ label, stat, tags, format, extra( S, p ) ]
const SECTIONS = [
	[ 'Attributes', [
		[ 'Strength', 'strength', [], num, ( v ) => `+${fmt( v * 0.5 )} life, +${fmt( v * 0.2 )}% melee physical damage` ],
		[ 'Dexterity', 'dexterity', [], num, ( v ) => `+${fmt( v * 0.2 )}% evasion, +${fmt( v * 0.08 )}% attack speed` ],
		[ 'Intelligence', 'intelligence', [], num, ( v ) => `+${fmt( v * 0.5 )} mana, +${fmt( v * 0.2 )}% spell damage and energy shield` ]
	] ],
	[ 'Life, Mana, Energy Shield', [
		[ 'Maximum Life', 'life', [], num ], [ 'Life Regeneration /s', 'life_regen', [], num ], [ 'Life Regeneration % /s', 'life_regen_pct', [], pct ],
		[ 'Maximum Mana', 'mana', [], num ], [ 'Mana Regeneration /s', 'mana_regen', [], num ], [ 'Energy Shield', 'shield', [], num ]
	] ],
	[ 'Defence', [
		[ 'Armour', 'armor', [], num ], [ 'Evade Chance (attacks)', 'evade_chance', [ 'attack' ], pct ], [ 'Block Chance', 'block_chance', [ 'attack' ], pct ],
		[ 'Fire Resistance', 'res_fire', [], pct, 'res' ], [ 'Cold Resistance', 'res_cold', [], pct, 'res' ], [ 'Lightning Resistance', 'res_lightning', [], pct, 'res' ], [ 'Chaos Resistance', 'res_chaos', [], pct, 'res' ],
		[ 'Stun Threshold', 'stun_threshold', [], ( v ) => pct( v * 100 ) ], [ 'Thorns', 'thorns', [], num ]
	] ],
	[ 'Offence', [
		[ 'Attack Speed', 'attack_speed', [ 'attack' ], ( v ) => pct( v * 100 ) ], [ 'Cast Speed', 'cast_speed', [ 'spell' ], ( v ) => pct( v * 100 ) ],
		[ 'Critical Strike Multiplier', 'crit_multi', [], pct ], [ 'Melee Damage multiplier', 'damage', [ 'attack', 'melee', 'physical' ], ( v ) => pct( v * 100 ) ],
		[ 'Spell Fire Damage multiplier', 'damage', [ 'spell', 'fire' ], ( v ) => pct( v * 100 ) ], [ 'Spell Cold Damage multiplier', 'damage', [ 'spell', 'cold' ], ( v ) => pct( v * 100 ) ],
		[ 'Spell Lightning Damage multiplier', 'damage', [ 'spell', 'lightning' ], ( v ) => pct( v * 100 ) ], [ 'Life Leech (attacks)', 'life_leech', [ 'attack' ], pct ],
		[ 'Life on Hit (attacks)', 'life_on_hit', [ 'attack' ], num ], [ 'Area of Effect', 'area', [], ( v ) => pct( v * 100 ) ], [ 'Projectile Speed', 'projectile_speed', [], ( v ) => pct( v * 100 ) ],
		[ 'Skill Duration', 'duration', [], ( v ) => pct( v * 100 ) ], [ 'Cooldown Recovery', 'cooldown_recovery', [], ( v ) => pct( v * 100 ) ]
	] ],
	[ 'Utility', [
		[ 'Movement Speed', 'move_speed', [], ( v ) => fmt( v ) + ' m/s' ], [ 'Dodge Cooldown', 'dodge_cooldown', [], ( v ) => fmt( v ) + ' s' ], [ 'Dodge Distance', 'dodge_distance', [], ( v ) => fmt( v ) + ' m' ],
		[ 'Pickup Radius', 'pickup_radius', [], ( v ) => fmt( v ) + ' m' ], [ 'Item Rarity', 'item_rarity', [], pct ], [ 'Item Quantity', 'item_quantity', [], pct ],
		[ 'Gold Find', 'gold_find', [], pct ], [ 'Experience Gain', 'xp_gain', [], pct ]
	] ]
];

function sourceName( src ) {

	if ( SOURCE_NAMES[ src ] ) return SOURCE_NAMES[ src ];
	if ( src.startsWith( 'prog-buff:' ) ) return 'Buff: ' + cap( src.slice( 10 ).replace( /-/g, ' ' ) );
	if ( src.startsWith( 'status:' ) ) return 'Status: ' + ( get( 'status', src.slice( 7 ) )?.name ?? src.slice( 7 ) );
	if ( src.startsWith( 'src:' ) ) return cap( src.slice( 4 ).replace( /[-_]/g, ' ' ) );
	return cap( src );

}

// Lines explaining one stat (used by the character sheet and agent tools).
export function breakdownLines( S, stat, tags = [] ) {

	const b = S.breakdown( stat, tags );
	const out = [ h( 'div', { class: 't-prop', text: `Base ${fmt( b.base )} · flat ${b.flat >= 0 ? '+' : ''}${fmt( b.flat )} · ${fmt( b.inc )}% increased · ×${fmt( Math.round( b.more * 1000 ) / 1000 )} more` } ) ];
	if ( b.override !== null ) out.push( h( 'div', { class: 't-corrupt', text: `Overridden: ${fmt( b.override )}` } ) );
	const groups = new Map();
	for ( const m of b.mods ) {

		const k = sourceName( m.source );
		if ( ! groups.has( k ) ) groups.set( k, [] );
		groups.get( k ).push( m );

	}

	for ( const [ k, mods ] of groups ) {

		out.push( h( 'div', { class: 't-sep' } ), h( 'div', { style: { color: '#ffe08a', fontWeight: 700 }, text: k } ) );
		for ( const m of mods.slice( 0, 14 ) ) out.push( h( 'div', { class: 't-mod', style: { justifyContent: 'space-between' } }, h( 'span', { text: modLine( m ) } ), m.from ? h( 'span', { class: 't-tier', text: m.from } ) : null ) );
		if ( mods.length > 14 ) out.push( h( 'div', { class: 'pg-dim', text: `... and ${mods.length - 14} more` } ) );

	}

	if ( ! b.mods.length ) out.push( h( 'div', { class: 'pg-dim', text: 'No modifiers - this is the base value.' } ) );
	return out;

}

define( 'uiPanel', { id: 'character', order: 45, toggle: 'character', modal: false,
	mount( ui ) {

		PG.ui = ui; PG.game = ui.game;
		this.head = h( 'div', { class: 'pg-dim', style: { marginBottom: '6px' } } );
		this.attack = h( 'div' );
		this.body = h( 'div' );
		this.extra = h( 'div' );
		return h( 'div', { class: 'pg-panel pg-char' }, panelHead( 'Character', 'character' ), this.head, this.attack, this.body, this.extra );

	},
	render( game ) {

		const p = game.world?.player;
		if ( ! p ) return;
		const S = p.stats, save = game.save;
		this.head.textContent = `${save.name} · level ${save.level} · ${Math.floor( save.xp ).toLocaleString()} / ${xpToNext( save.level ).toLocaleString()} XP · ${pointsLeft( save )} passive points unspent`;
		const a = estimateAttack( S );
		const by = Object.entries( a.byType ).map( ( [ k, v ] ) => `${cap( k )} ${fmt( Math.round( v ) )}` ).join( ' · ' ) || 'none';
		this.attack.replaceChildren( h( 'h3', { text: 'Attack estimate (per hit, before enemy defences)' } ),
			h( 'div', { class: 'pg-stat' }, h( 'span', { text: 'Average hit' } ), h( 'b', { text: fmt( Math.round( a.hit ) ) } ) ),
			h( 'div', { class: 'pg-dim pg-small', text: by } ),
			h( 'div', { class: 'pg-stat' }, h( 'span', { text: 'Critical chance / multiplier' } ), h( 'b', { text: `${fmt( a.crit )}% / ${fmt( a.multi )}%` } ) ),
			h( 'div', { class: 'pg-stat' }, h( 'span', { text: 'Damage per second (1 attack/s base)' } ), h( 'b', { text: fmt( Math.round( a.dps ) ) } ) ) );
		const els = [];
		for ( const [ title, rows ] of SECTIONS ) {

			els.push( h( 'h3', { text: title } ) );
			for ( const [ label, stat, tags, f, extra ] of rows ) {

				const v = S.get( stat, tags );
				let valueEl;
				if ( extra === 'res' ) {

					const capV = S.get( 'max_' + stat );
					valueEl = h( 'b', { class: v >= capV ? 'pg-capped' : v < 0 ? 'pg-uncap' : '', text: `${fmt( Math.min( v, capV ) )}%${v > capV ? ` (${fmt( v )})` : ''} / ${fmt( capV )}%` } );

				} else valueEl = h( 'b', { text: f( v ) } );
				const row = h( 'div', { class: 'pg-stat' }, h( 'span', { text: label } ), valueEl );
				const show = () => showTextTip( label, [ ...( typeof extra === 'function' ? [ h( 'div', { class: 't-prop', text: extra( v ) } ) ] : [] ), ...breakdownLines( S, stat, tags ) ], row, { left: true } );
				row.addEventListener( 'pointerenter', ( e ) => e.pointerType !== 'touch' && show() );
				row.addEventListener( 'pointerleave', hideTip );
				row.addEventListener( 'click', show );
				els.push( row );

			}

		}

		this.body.replaceChildren( ...els );

		// active rule-changers and lifetime record
		const rt = game.world ? runtime( game.world ) : null;
		const provs = rt?.providers ?? [];
		const L = save.lifetime;
		const kills = Object.values( L.kills || {} ).reduce( ( x, y ) => x + y, 0 );
		const buffs = rt ? [ ...rt.buffs.values() ].map( ( b ) => `${b.name || b.key}${b.stacks ? ` (${b.stacks})` : ''}` ) : [];
		this.extra.replaceChildren(
			h( 'h3', { text: 'Mechanics' } ),
			provs.length ? h( 'div', {}, provs.map( ( pr ) => h( 'div', { class: 'pg-small' }, h( 'b', { style: { color: pr.def.kind === 'unique' ? '#ff9a3c' : '#ffe08a' }, text: pr.def.name } ), ' - ', pr.def.mechanic || ( pr.def.lines || [] ).join( '; ' ) ) ) ) : h( 'div', { class: 'pg-dim pg-small', text: 'No keystones or unique mechanics active.' } ),
			buffs.length ? h( 'div', { class: 'pg-small', style: { marginTop: '4px' }, text: 'Active buffs: ' + buffs.join( ', ' ) } ) : null,
			h( 'h3', { text: 'Lifetime' } ),
			h( 'div', { class: 'pg-small pg-dim', text: `${kills.toLocaleString()} kills (${L.kills?.rare ?? 0} rare, ${( L.kills?.unique ?? 0 ) + ( L.kills?.boss ?? 0 )} unique/boss) · ${( L.gold ?? 0 ).toLocaleString()} gold looted · ${( L.uniques || [] ).length} uniques found · ${L.items?.rare ?? 0} rares · ${L.deaths ?? 0} deaths · highest hit ${( L.highestHit ?? 0 ).toLocaleString()} · ${Math.round( ( L.playTime ?? 0 ) / 60 )} min played` } ) );

	},
	update( ui, game ) {

		if ( this.v === PG.version && game.frameCount % 30 ) return;
		this.v = PG.version;
		this.render( game );

	},
	onOpen() {

		this.v = - 1;

	},
	onClose() {

		hideTip();

	}
} );
