// Procedural combat audio: every sound is synthesised with WebAudio from two
// primitives - filtered NOISE bursts (whooshes, impacts, fire, thunder) and swept
// TONES (thumps, pings, zaps, chimes) - so the game ships no audio files.
//
// Recipes are short lists of those primitives. play( id, { x, z, vol, pitch } )
// pans by screen position, attenuates with distance from the camera focus, adds a
// little random pitch so repeated hits do not sound machine-gunned, throttles each
// recipe and caps the voice count. The context starts on the first user gesture
// (browsers block audio before that). Other features can trigger recipes with the
// world event 'sfx' { id, x, z, volume }.

import { define } from '../../../core/registry.js';
import { TEAM } from '../../../core/tuning.js';
import { settings, onSetting } from './settings.js';
import { dominantType } from './palette.js';

const N = ( o ) => ( { k: 'noise', ...o } ), T = ( o ) => ( { k: 'tone', ...o } );

// noise: f0 -> f1 filter sweep, type lowpass | highpass | bandpass; tone: osc type, f0 -> f1
export const RECIPES = {
	swing: [ N( { type: 'bandpass', f0: 900, f1: 2600, q: 1.2, dur: 0.13, gain: 0.32, attack: 0.025 } ) ],
	swingHeavy: [ N( { type: 'bandpass', f0: 380, f1: 1300, q: 1, dur: 0.22, gain: 0.42, attack: 0.04 } ), T( { type: 'sine', f0: 130, f1: 70, dur: 0.16, gain: 0.15 } ) ],
	whirl: [ N( { type: 'bandpass', f0: 600, f1: 1500, q: 1.4, dur: 0.24, gain: 0.22, attack: 0.05 } ) ],
	bite: [ N( { type: 'bandpass', f0: 500, f1: 900, q: 1.5, dur: 0.1, gain: 0.2 } ) ],
	hit_physical: [ T( { type: 'sine', f0: 190, f1: 55, dur: 0.1, gain: 0.5 } ), N( { type: 'highpass', f0: 2200, dur: 0.035, gain: 0.3 } ), N( { type: 'lowpass', f0: 900, dur: 0.07, gain: 0.3 } ) ],
	hit_fire: [ N( { type: 'lowpass', f0: 2000, f1: 350, dur: 0.24, gain: 0.38 } ), N( { type: 'bandpass', f0: 3200, q: 3, dur: 0.18, gain: 0.16, crackle: true } ), T( { type: 'sine', f0: 120, f1: 60, dur: 0.1, gain: 0.25 } ) ],
	hit_cold: [ T( { type: 'triangle', f0: 1900, f1: 1350, dur: 0.12, gain: 0.14 } ), T( { type: 'sine', f0: 2900, dur: 0.22, gain: 0.06 } ), N( { type: 'highpass', f0: 4200, dur: 0.07, gain: 0.22 } ), T( { type: 'sine', f0: 150, f1: 70, dur: 0.08, gain: 0.25 } ) ],
	hit_lightning: [ T( { type: 'square', f0: 95, f1: 55, dur: 0.12, gain: 0.08 } ), N( { type: 'bandpass', f0: 2600, q: 0.7, dur: 0.1, gain: 0.34, crackle: true } ) ],
	hit_chaos: [ T( { type: 'sine', f0: 230, f1: 100, dur: 0.17, gain: 0.25, wobble: 18 } ), N( { type: 'lowpass', f0: 650, dur: 0.15, gain: 0.25 } ) ],
	crit: [ T( { type: 'sine', f0: 1250, dur: 0.26, gain: 0.1 } ), T( { type: 'sine', f0: 1870, dur: 0.32, gain: 0.07 } ), T( { type: 'sine', f0: 140, f1: 45, dur: 0.16, gain: 0.45 } ) ],
	hurt: [ T( { type: 'sawtooth', f0: 150, f1: 70, dur: 0.13, gain: 0.12, lp: 900 } ), N( { type: 'lowpass', f0: 800, dur: 0.11, gain: 0.42 } ) ],
	cast_fire: [ N( { type: 'bandpass', f0: 280, f1: 1600, q: 0.9, dur: 0.32, gain: 0.3, attack: 0.06 } ), T( { type: 'sine', f0: 200, f1: 520, dur: 0.2, gain: 0.07 } ) ],
	cast_cold: [ T( { type: 'triangle', f0: 1200, f1: 2400, dur: 0.24, gain: 0.07 } ), T( { type: 'sine', f0: 1800, f1: 3600, dur: 0.2, gain: 0.04 } ), N( { type: 'highpass', f0: 5000, dur: 0.22, gain: 0.12, attack: 0.05 } ) ],
	cast_lightning: [ T( { type: 'sawtooth', f0: 900, f1: 180, dur: 0.16, gain: 0.05, lp: 3000 } ), N( { type: 'bandpass', f0: 3000, q: 1, dur: 0.13, gain: 0.24, crackle: true } ) ],
	cast: [ T( { type: 'sine', f0: 300, f1: 720, dur: 0.2, gain: 0.08 } ), N( { type: 'bandpass', f0: 1000, f1: 2200, q: 1, dur: 0.2, gain: 0.14, attack: 0.05 } ) ],
	explosion: [ N( { type: 'lowpass', f0: 3200, f1: 140, dur: 0.75, gain: 0.7, attack: 0.005 } ), T( { type: 'sine', f0: 85, f1: 30, dur: 0.5, gain: 0.6 } ) ],
	slam: [ T( { type: 'sine', f0: 95, f1: 32, dur: 0.38, gain: 0.7 } ), N( { type: 'lowpass', f0: 1400, f1: 90, dur: 0.42, gain: 0.5 } ) ],
	zap: [ N( { type: 'bandpass', f0: 4200, q: 2, dur: 0.1, gain: 0.26, crackle: true } ), T( { type: 'square', f0: 62, dur: 0.1, gain: 0.05 } ) ],
	thunder: [ N( { type: 'highpass', f0: 2500, dur: 0.06, gain: 0.5 } ), N( { type: 'lowpass', f0: 2200, f1: 70, dur: 1.1, gain: 0.65, attack: 0.01 } ) ],
	dodge: [ N( { type: 'bandpass', f0: 450, f1: 1400, q: 1.1, dur: 0.2, gain: 0.24, attack: 0.03 } ) ],
	blink: [ T( { type: 'sine', f0: 380, f1: 1700, dur: 0.18, gain: 0.1 } ), N( { type: 'highpass', f0: 1500, f1: 6000, dur: 0.18, gain: 0.12 } ) ],
	shout: [ T( { type: 'sawtooth', f0: 118, f1: 96, dur: 0.5, gain: 0.2, lp: 800, wobble: 7 } ), N( { type: 'lowpass', f0: 700, dur: 0.45, gain: 0.26, attack: 0.04 } ) ],
	buff: [ T( { type: 'triangle', f0: 523, dur: 0.12, gain: 0.08 } ), T( { type: 'triangle', f0: 659, dur: 0.12, gain: 0.08, at: 0.07 } ), T( { type: 'triangle', f0: 784, dur: 0.2, gain: 0.08, at: 0.14 } ) ],
	step: [ N( { type: 'lowpass', f0: 380, dur: 0.05, gain: 0.1 } ) ],
	pickup: [ T( { type: 'sine', f0: 880, f1: 1320, dur: 0.09, gain: 0.14 } ) ],
	gold: [ T( { type: 'sine', f0: 2093, dur: 0.08, gain: 0.08 } ), T( { type: 'sine', f0: 3136, dur: 0.12, gain: 0.06, at: 0.04 } ) ],
	levelup: [ T( { type: 'triangle', f0: 523, dur: 0.3, gain: 0.13 } ), T( { type: 'triangle', f0: 659, dur: 0.3, gain: 0.13, at: 0.09 } ), T( { type: 'triangle', f0: 784, dur: 0.3, gain: 0.13, at: 0.18 } ), T( { type: 'triangle', f0: 1047, dur: 0.6, gain: 0.15, at: 0.27 } ), N( { type: 'highpass', f0: 6000, dur: 0.8, gain: 0.08, at: 0.27, attack: 0.1 } ) ],
	ui: [ T( { type: 'sine', f0: 1250, dur: 0.035, gain: 0.07 } ) ],
	nomana: [ T( { type: 'square', f0: 220, f1: 170, dur: 0.15, gain: 0.05, lp: 1200 } ) ],
	death: [ N( { type: 'lowpass', f0: 900, f1: 180, dur: 0.32, gain: 0.32 } ), T( { type: 'sine', f0: 170, f1: 55, dur: 0.26, gain: 0.18 } ) ],
	shatter: [ N( { type: 'highpass', f0: 3000, dur: 0.28, gain: 0.34 } ), T( { type: 'sine', f0: 3400, dur: 0.12, gain: 0.05 } ), T( { type: 'sine', f0: 2600, dur: 0.14, gain: 0.05, at: 0.03 } ), T( { type: 'sine', f0: 4300, dur: 0.1, gain: 0.04, at: 0.06 } ) ],
	freeze: [ T( { type: 'triangle', f0: 2600, f1: 1700, dur: 0.22, gain: 0.05 } ), N( { type: 'highpass', f0: 6000, dur: 0.26, gain: 0.16 } ) ],
	potion: [ N( { type: 'bandpass', f0: 500, f1: 300, q: 4, dur: 0.12, gain: 0.25 } ), T( { type: 'sine', f0: 320, f1: 520, dur: 0.14, gain: 0.08, at: 0.1 } ) ],
	summon: [ T( { type: 'sine', f0: 600, f1: 1250, dur: 0.32, gain: 0.07 } ), N( { type: 'bandpass', f0: 1500, f1: 3500, q: 2, dur: 0.3, gain: 0.1, attack: 0.1 } ) ]
};

const SWING = { slash: 'swing', thrust: 'swing', overhead: 'swingHeavy', slam: 'swingHeavy', leap: 'swingHeavy', spin: 'whirl', dash: 'dodge', bite: 'bite', claw: 'bite', charge: 'swingHeavy', stomp: 'swingHeavy' };

class Sfx {

	constructor() {

		this.ctx = null;
		this.last = new Map();
		this.voices = 0;
		this.listener = { x: 0, z: 0, yaw: Math.PI };

	}

	start() {

		if ( this.ctx ) {

			if ( this.ctx.state === 'suspended' ) this.ctx.resume();
			return;

		}

		const AC = window.AudioContext || window.webkitAudioContext;
		if ( ! AC ) return;
		const ctx = this.ctx = new AC();
		this.comp = ctx.createDynamicsCompressor();
		this.comp.threshold.value = - 14;
		this.comp.ratio.value = 6;
		this.master = ctx.createGain();
		this.sfx = ctx.createGain();
		this.sfx.connect( this.master ).connect( this.comp ).connect( ctx.destination );
		this.applyVolume();
		const len = ctx.sampleRate;
		this.noise = ctx.createBuffer( 1, len, ctx.sampleRate );
		const d = this.noise.getChannelData( 0 );
		for ( let i = 0; i < len; i ++ ) d[ i ] = Math.random() * 2 - 1;

	}

	applyVolume() {

		if ( ! this.ctx ) return;
		this.master.gain.value = settings.master;
		this.sfx.gain.value = settings.sfx;

	}

	play( id, { x, z, vol = 1, pitch = 1, minGap = 0.03 } = {} ) {

		const ctx = this.ctx, recipe = RECIPES[ id ];
		if ( ! ctx || ctx.state !== 'running' || ! recipe || settings.master <= 0 ) return;
		const now = ctx.currentTime;
		if ( now - ( this.last.get( id ) ?? - 1 ) < minGap ) return;
		if ( this.voices > 28 ) return;
		this.last.set( id, now );

		// position: pan by the side of the screen, quieter far from the camera focus
		let pan = 0, att = 1;
		if ( x !== undefined ) {

			const L = this.listener;
			const dx = x - L.x, dz = z - L.z;
			const right = dx * - Math.cos( L.yaw ) + dz * Math.sin( L.yaw );
			pan = Math.max( - 0.8, Math.min( 0.8, right / 14 ) );
			att = 1 / ( 1 + Math.hypot( dx, dz ) / 16 );

		}

		const out = ctx.createGain();
		out.gain.value = vol * att;
		const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
		if ( panner ) {

			panner.pan.value = pan;
			out.connect( panner ).connect( this.sfx );

		} else out.connect( this.sfx );

		const p = pitch * ( 0.93 + Math.random() * 0.14 );
		let end = 0;
		for ( const v of recipe ) end = Math.max( end, v.k === 'noise' ? this.noiseVoice( v, out, now, p ) : this.toneVoice( v, out, now, p ) );
		this.voices ++;
		setTimeout( () => {

			this.voices --;
			out.disconnect();

		}, ( end - now ) * 1000 + 60 );

	}

	env( g, t0, v, dur ) {

		const a = Math.min( v.attack ?? 0.005, dur * 0.5 );
		g.gain.setValueAtTime( 0.0001, t0 );
		g.gain.linearRampToValueAtTime( v.gain, t0 + a );
		g.gain.exponentialRampToValueAtTime( 0.0001, t0 + dur );

	}

	noiseVoice( v, out, now, p ) {

		const ctx = this.ctx, t0 = now + ( v.at ?? 0 ), dur = v.dur;
		const src = ctx.createBufferSource();
		src.buffer = this.noise;
		src.playbackRate.value = p;
		const f = ctx.createBiquadFilter();
		f.type = v.type;
		f.Q.value = v.q ?? 0.8;
		f.frequency.setValueAtTime( v.f0 * p, t0 );
		if ( v.f1 ) f.frequency.exponentialRampToValueAtTime( v.f1 * p, t0 + dur );
		const g = ctx.createGain();
		this.env( g, t0, v, dur );
		if ( v.crackle ) {

			// amplitude chatter: fire crackle, electric buzz
			const lfo = ctx.createOscillator(), lg = ctx.createGain();
			lfo.type = 'square';
			lfo.frequency.value = 35 + Math.random() * 40;
			lg.gain.value = v.gain * 0.6;
			lfo.connect( lg ).connect( g.gain );
			lfo.start( t0 );
			lfo.stop( t0 + dur );

		}

		src.connect( f ).connect( g ).connect( out );
		src.start( t0, Math.random() * 0.5 );
		src.stop( t0 + dur + 0.02 );
		return t0 + dur;

	}

	toneVoice( v, out, now, p ) {

		const ctx = this.ctx, t0 = now + ( v.at ?? 0 ), dur = v.dur;
		const o = ctx.createOscillator();
		o.type = v.type;
		o.frequency.setValueAtTime( v.f0 * p, t0 );
		if ( v.f1 ) o.frequency.exponentialRampToValueAtTime( v.f1 * p, t0 + dur );
		if ( v.wobble ) {

			const lfo = ctx.createOscillator(), lg = ctx.createGain();
			lfo.frequency.value = v.wobble;
			lg.gain.value = v.f0 * 0.06;
			lfo.connect( lg ).connect( o.frequency );
			lfo.start( t0 );
			lfo.stop( t0 + dur );

		}

		const g = ctx.createGain();
		this.env( g, t0, v, dur );
		let node = o;
		if ( v.lp ) {

			const f = ctx.createBiquadFilter();
			f.type = 'lowpass';
			f.frequency.value = v.lp;
			node = node.connect( f );

		}

		node.connect( g ).connect( out );
		o.start( t0 );
		o.stop( t0 + dur + 0.02 );
		return t0 + dur;

	}

}

export const sfx = new Sfx();
const startAudio = () => sfx.start();
for ( const ev of [ 'pointerdown', 'keydown', 'touchstart' ] ) addEventListener( ev, startAudio, { capture: true } );
onSetting( ( k ) => ( k === 'master' || k === 'sfx' ) && sfx.applyVolume() );

// UI clicks anywhere in the overlay
addEventListener( 'click', ( e ) => e.target instanceof HTMLButtonElement && sfx.play( 'ui', { minGap: 0.01 } ), { capture: true } );

define( 'renderSystem', { id: 'combat-audio', order: 90,
	onWorld( rc, world, game ) {

		for ( const off of this.off || [] ) off();
		const on = ( t, fn ) => this.off.push( world.events.on( t, fn ) );
		this.off = [];
		const near = ( e, r = 30 ) => ! e || ! world.player || Math.hypot( e.x - world.player.x, e.z - world.player.z ) < r;
		on( 'action', ( a ) => {

			const e = a.entity, id = SWING[ a.action ];
			if ( ! id || ! near( e ) ) return;
			sfx.play( id, { x: e.x, z: e.z, vol: e === world.player ? 1 : 0.45, minGap: 0.04 } );

		} );
		on( 'skill', ( s ) => {

			const e = s.entity, tags = s.tags || [];
			const pos = { x: e.x, z: e.z };
			if ( tags.includes( 'warcry' ) ) sfx.play( 'shout', pos );
			else if ( tags.includes( 'buff' ) ) sfx.play( 'buff', pos );
			else if ( tags.includes( 'minion' ) ) sfx.play( 'summon', pos );
			else if ( tags.includes( 'spell' ) ) sfx.play( RECIPES[ 'cast_' + s.element ] ? 'cast_' + s.element : 'cast', pos );

		} );
		on( 'hit', ( h ) => {

			if ( ! ( h.total > 0 ) || ! near( h.target ) ) return;
			const pos = { x: h.target.x, z: h.target.z };
			if ( h.target === world.player ) return sfx.play( 'hurt', { ...pos, minGap: 0.08 } );
			const type = dominantType( h.byType );
			const mine = h.source === world.player || h.source?.team === TEAM.PLAYER;
			sfx.play( 'hit_' + type, { ...pos, vol: mine ? 0.9 : 0.5, minGap: 0.035 } );
			if ( h.crit && mine ) sfx.play( 'crit', { ...pos, minGap: 0.06 } );

		} );
		on( 'death', ( d ) => {

			const e = d.entity;
			if ( e.kind === 'minion' || ! near( e ) ) return;
			sfx.play( e.data.shattered ? 'shatter' : 'death', { x: e.x, z: e.z, minGap: 0.05 } );

		} );
		on( 'area:tick', ( { a } ) => {

			if ( a.ticks !== 1 ) return;
			const pos = { x: a.x, z: a.z };
			const id = { slam: 'slam', quake: 'slam', aftershock: 'slam', impact: 'slam', explosion: 'explosion', meteor: 'explosion', storm: 'thunder', nova: 'freeze', icespike: 'freeze' }[ a.fx ];
			if ( id ) sfx.play( id, { ...pos, vol: a.fx === 'meteor' ? 1.3 : 1, minGap: 0.05 } );
			else if ( a.team === TEAM.ENEMY && a.delay > 0 ) sfx.play( 'slam', { ...pos, vol: 0.6 } );

		} );
		on( 'fx', ( f ) => {

			if ( f.kind === 'beam' ) sfx.play( 'zap', { x: f.x2, z: f.z2, minGap: 0.05 } );
			else if ( f.kind === 'blink' ) sfx.play( 'blink', { x: f.x2, z: f.z2 } );
			else if ( f.kind === 'shatter' && ! f.small ) sfx.play( 'shatter', { x: f.x, z: f.z } );

		} );
		on( 'dodge', ( d ) => sfx.play( 'dodge', { x: d.x, z: d.z } ) );
		on( 'status', ( s ) => s.id === 'freeze' && sfx.play( 'freeze', { x: s.x, z: s.z, minGap: 0.08 } ) );
		on( 'skillFail', ( f ) => f.reason === 'mana' && sfx.play( 'nomana', { minGap: 0.3 } ) );
		on( 'potion', () => sfx.play( 'potion' ) );
		on( 'pickup', () => sfx.play( 'pickup' ) );
		on( 'sfx', ( s ) => sfx.play( RECIPES[ s.id ] ? s.id : 'ui', { x: s.x, z: s.z, vol: s.volume ?? 1 } ) );
		if ( ! this.gameHooked ) {

			this.gameHooked = true;
			game.events.on( 'levelup', () => sfx.play( 'levelup' ) );
			game.events.on( 'gold', () => sfx.play( 'gold', { minGap: 0.06 } ) );

		}

		this.stepAt = 0;

	},
	update( rc, world, alpha, dt ) {

		const p = world.player;
		const L = sfx.listener;
		L.x = rc.camTarget?.x ?? 0; L.z = rc.camTarget?.z ?? 0; L.yaw = rc.camYaw ?? Math.PI;
		// soft footsteps, paced by ground speed
		if ( p && p.alive && p.anim.state === 'move' && p.anim.speed > 1.5 ) {

			this.stepAt -= dt * p.anim.speed;
			if ( this.stepAt <= 0 ) {

				this.stepAt = 2.1;
				sfx.play( 'step', { x: p.x, z: p.z, vol: 0.7, minGap: 0.1 } );

			}

		}

	}
} );
