// Boss UI: the life bar across the top (phase markers at each threshold, a
// delayed "damage trail", shield overlay, enrage state) and the intro name card.
// Both are driven by data the boss brain keeps on the entity ( data.introAt,
// data.phase, data.phaseName, data.enraged ) - no event wiring, so switching
// worlds can never leave a stale listener behind.

import { define, get } from '../../../core/registry.js';
import { h } from '../../../ui/shell.js';

define( 'uiPanel', { id: 'boss-bar', order: 16,
	mount() {

		document.head.append( h( 'style', { text: CSS } ) );
		this.name = h( 'span', { class: 'bn' } );
		this.title = h( 'span', { class: 'bt' } );
		this.fill = h( 'div', { class: 'fill' } );
		this.lag = h( 'div', { class: 'lag' } );
		this.shield = h( 'div', { class: 'sh' } );
		this.marks = h( 'div', { class: 'mks' } );
		this.phase = h( 'div', { class: 'ph' } );
		this.bar = h( 'div', { class: 'bossbar hidden' }, h( 'div', {}, this.name, this.title ), h( 'div', { class: 'bar' }, this.lag, this.fill, this.shield, this.marks ), this.phase );
		this.cardName = h( 'div', { class: 'n' } );
		this.cardTitle = h( 'div', { class: 't' } );
		this.cardText = h( 'div', { class: 'x' } );
		this.card = h( 'div', { class: 'bosscard' }, this.cardName, this.cardTitle, this.cardText );
		this.boss = null;
		return h( 'div', { class: 'bossui' }, this.bar, this.card );

	},
	update( ui, game ) {

		const w = game.world;
		const b = w?.state.bossActive || ( this.boss && this.boss.data.deathTime && w?.time - this.boss.data.deathTime < 3 && w.entities.includes( this.boss ) ? this.boss : null );
		if ( b !== this.boss ) this.bind( b );
		if ( ! b ) return;

		// intro card: fade in, hold, fade out over the intro; then phase names flash the same way
		const since = w.time - ( b.data.introAt ?? - 99 );
		const introLen = b.data.introSeconds ?? 2.4;
		if ( b.data.phase !== this.lastPhase && b.data.phase > 0 ) {

			this.lastPhase = b.data.phase;
			this.flash = { at: w.time, text: b.data.phaseName };

		}

		let show = since >= 0 && since < introLen + 0.8;
		if ( show ) {

			this.cardName.textContent = b.name;
			this.cardTitle.textContent = b.data.title || '';
			this.cardText.textContent = this.introText || '';

		} else if ( this.flash && w.time - this.flash.at < 1.8 ) {

			show = true;
			this.cardName.textContent = this.flash.text;
			this.cardTitle.textContent = b.name;
			this.cardText.textContent = '';

		}

		this.card.classList.toggle( 'show', show );
		this.bar.classList.toggle( 'hidden', since < introLen * 0.5 && b.alive );
		const max = Math.max( 1, b.maxLife );
		const frac = Math.max( 0, b.life / max );
		this.fill.style.transform = `scaleX(${frac.toFixed( 4 )})`;
		this.lag.style.transform = `scaleX(${frac.toFixed( 4 )})`;
		this.shield.style.transform = `scaleX(${Math.min( 1, b.shield / max ).toFixed( 4 )})`;
		const phaseText = b.alive ? `${b.data.phaseName ?? ''}${b.data.enraged ? ' · ENRAGED' : ''}${b.flags.invulnerable ? ' · invulnerable' : ''}` : 'Defeated';
		if ( this.phase.textContent !== phaseText ) this.phase.textContent = phaseText;
		this.bar.classList.toggle( 'enraged', !! b.data.enraged );
		this.bar.classList.toggle( 'dead', ! b.alive );

	},
	bind( b ) {

		this.boss = b;
		this.lastPhase = 0;
		this.flash = null;
		this.marks.textContent = '';
		this.bar.classList.toggle( 'hidden', ! b );
		this.card.classList.remove( 'show' );
		if ( ! b ) return;
		this.name.textContent = b.name;
		this.title.textContent = b.data.title || '';
		const def = get( 'boss', b.data.bossId );
		this.introText = def?.intro?.text || '';
		for ( const p of def?.phases || [] ) if ( p.at < 1 ) this.marks.append( h( 'i', { style: { left: `${p.at * 100}%` } } ) );

	}
} );

const CSS = `
.bossbar { position: absolute; top: calc(max(10px, env(safe-area-inset-top)) + 28px); left: 50%; transform: translateX(-50%); width: min(560px, 86vw); text-align: center; }
.bossbar .bn { font-weight: 800; font-size: 16px; letter-spacing: 0.08em; text-transform: uppercase; color: #ffdbe2; text-shadow: 0 1px 3px #000, 0 0 10px rgba(255, 60, 90, 0.4); }
.bossbar .bt { font-size: 12px; color: #c9a8b0; margin-left: 8px; font-style: italic; text-shadow: 0 1px 2px #000; }
.bossbar .bar { position: relative; height: 14px; margin-top: 4px; background: rgba(0, 0, 0, 0.72); border: 1px solid rgba(255, 255, 255, 0.22); border-radius: 7px; overflow: hidden; }
.bossbar .fill, .bossbar .lag, .bossbar .sh { position: absolute; inset: 0; transform-origin: left center; }
.bossbar .fill { background: linear-gradient(#e0405a, #7a1024); transition: transform 0.08s linear; }
.bossbar .lag { background: #f2c46a; transition: transform 0.7s ease-out 0.35s; }
.bossbar .sh { background: rgba(150, 200, 255, 0.55); }
.bossbar .mks i { position: absolute; top: 0; bottom: 0; width: 2px; margin-left: -1px; background: rgba(255, 255, 255, 0.85); box-shadow: 0 0 3px #000; }
.bossbar .ph { font-size: 11px; color: #d8c8cc; margin-top: 3px; letter-spacing: 0.06em; text-shadow: 0 1px 2px #000; min-height: 13px; }
.bossbar.enraged .fill { background: linear-gradient(#ff6a2a, #a01800); animation: bossrage 0.6s ease-in-out infinite alternate; }
.bossbar.dead { opacity: 0.6; }
@keyframes bossrage { from { filter: brightness(1); } to { filter: brightness(1.5); } }
.bosscard { position: absolute; top: 30%; left: 50%; transform: translate(-50%, -50%) scale(0.96); text-align: center; opacity: 0; transition: opacity 0.45s, transform 0.6s; pointer-events: none; width: 92vw; }
.bosscard.show { opacity: 1; transform: translate(-50%, -50%) scale(1); }
.bosscard .n { font-size: clamp(28px, 6vw, 56px); font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: #fff0f3; text-shadow: 0 2px 14px #000, 0 0 34px rgba(255, 60, 90, 0.55); }
.bosscard .t { font-size: clamp(14px, 2.4vw, 21px); color: #ffb3c2; font-style: italic; text-shadow: 0 1px 6px #000; }
.bosscard .x { margin-top: 10px; font-size: 14px; color: #d0d4de; text-shadow: 0 1px 4px #000; }
`;
