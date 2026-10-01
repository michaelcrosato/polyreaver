// Statuses: ailments (ignite, chill, freeze, shock, poison, bleed, stun), crowd
// control (slow, root) and buffs (warcry, rage, haste, fortify, ice armour...).
// They are DATA: anything - a skill, a monster ability, a level mechanic, a unique
// item - applies them with world.applyStatus( e, id, opts ), and the opts carry the
// magnitude so one def serves every source:
//
//   world.applyStatus( e, 'ignite', { source, damage } )   // from a hit: burns for 90% of it
//   world.applyStatus( e, 'ignite', { source, dps: 12 } )  // a fire trap: explicit damage/s
//   world.applyStatus( e, 'chill', { pct: 40, duration: 3 } )
//   world.applyStatus( e, 'warcry', { pct: 30, duration: 6 } )
//
// core/combat.js applies the ailments automatically when a hit carries the matching
// damage type ( fire -> ignite, cold -> chill/freeze, lightning -> shock, chaos /
// physical -> poison, physical -> bleed ) with { source, damage, hit }.
//
// Stacking (core/world.js applyStatus): 'refresh' keeps the first data and resets
// the timer, 'add' counts stacks, 'max' calls merge( data, opts ) so the def decides
// (stronger ignite wins, every poison is its own instance...).
//
// Presentation hints on each def: icon (HUD glyph), color, kind 'buff' | 'debuff'.

import { define } from '../../core/registry.js';
import { TEAM } from '../../core/tuning.js';
import { schedule } from './timers.js';

// --- helpers -------------------------------------------------------------------------

// Stats that combat.js reads as multipliers with a `|| 1` fallback (damage_taken) need
// a real base of 1, otherwise an "increased" modifier multiplies zero and is ignored.
export function ensureBase( e, stat, value = 1 ) {

	if ( e.stats.base[ stat ] === undefined ) e.stats.setBase( stat, value );

}

const frac = ( e, dmg ) => Math.max( 0, ( dmg ?? 0 ) / Math.max( 1, e.maxLife ) );
const clamp = ( v, a, b ) => Math.max( a, Math.min( b, v ) );

// Damage over time bypasses hit resolution (no crits, no evasion, no new ailments):
// the magnitude was already mitigated when the ailment was inflicted. Ticks are
// summed and reported every 0.4 s as a 'dot' event for damage numbers.
export function dotDamage( world, e, s, amount, type ) {

	if ( amount <= 0 || ! e.alive ) return;
	if ( e.team === TEAM.PLAYER && world.tuning.godMode ) return;
	if ( e.flags.invulnerable && ! e.data.dodging ) return;
	amount *= Math.max( 0, e.stats.get( 'damage_taken', [ type ] ) || 1 );
	let toLife = amount;
	if ( e.shield > 0 && type !== 'chaos' ) {

		const absorbed = Math.min( e.shield, amount );
		e.shield -= absorbed;
		toLife -= absorbed;

	}

	e.life -= toLife;
	const src = s.data.source ?? s.source;
	if ( src?.team === TEAM.PLAYER && e.team !== TEAM.PLAYER ) world.stats.damageDealt += amount;
	if ( e.team === TEAM.PLAYER ) world.stats.damageTaken += amount;
	s.data.acc = ( s.data.acc ?? 0 ) + amount;
	if ( world.time >= ( s.data.nextReport ?? 0 ) ) {

		world.events.emit( 'dot', { entity: e, amount: s.data.acc, element: type, status: s.id, x: e.x, z: e.z } );
		s.data.acc = 0;
		s.data.nextReport = world.time + 0.4;

	}

	if ( e.life <= 0 ) world.kill( e, src || null, { skill: s.id, tags: [ 'dot', type ] } );

}

// Interrupt whatever the entity is doing (stun / freeze), unless it is unstoppable.
function interrupt( world, e ) {

	if ( e.action && ! e.action.def.unstoppable ) {

		const act = e.action;
		e.action = null;
		e.anim.phase = null;
		act.def.onCancel?.( world, e, act, 'stun' );

	}

}

// --- ailments ------------------------------------------------------------------------

const igniteDps = ( o ) => o.dps ?? ( o.damage ?? 0 ) * 0.9 / 3;

define( 'status', { id: 'ignite', name: 'Ignited', tags: [ 'debuff', 'ailment', 'fire', 'dot' ], kind: 'debuff', icon: 'flame', color: '#ff7a2a',
	duration: 3, stack: 'max', immuneFlag: 'immuneIgnite',
	init: ( world, e, o ) => ( { source: o.source, dps: igniteDps( o ) } ),
	// a stronger ignite replaces a weaker one (they do not stack)
	merge( data, o ) {

		const dps = igniteDps( o );
		if ( dps > data.dps ) {

			data.dps = dps;
			data.source = o.source ?? data.source;

		}

		return data;

	},
	onTick( world, e, s, dt ) {

		dotDamage( world, e, s, s.data.dps * dt, 'fire' );

	} } );

define( 'status', { id: 'chill', name: 'Chilled', tags: [ 'debuff', 'ailment', 'cold' ], kind: 'debuff', icon: 'snow', color: '#8fd8ff',
	duration: 2, stack: 'max', immuneFlag: 'immuneChill',
	// the bigger the hit relative to max life, the stronger the slow (15..40%)
	init: ( world, e, o ) => ( { pct: o.pct ?? clamp( 15 + 150 * frac( e, o.damage ), 15, 40 ) } ),
	merge( data, o ) {

		data.pct = Math.max( data.pct, o.pct ?? 15 );
		return data;

	},
	mods: ( s ) => [
		{ stat: 'move_speed', type: 'more', value: - s.data.pct },
		{ stat: 'attack_speed', type: 'more', value: - s.data.pct * 0.6 },
		{ stat: 'cast_speed', type: 'more', value: - s.data.pct * 0.6 }
	] } );

define( 'status', { id: 'freeze', name: 'Frozen', tags: [ 'debuff', 'ailment', 'cold', 'cc' ], kind: 'debuff', icon: 'crystal', color: '#bfefff',
	duration: 0.6, stack: 'refresh', flags: [ 'frozen' ], immuneFlag: 'immuneFreeze',
	onApply( world, e, s ) {

		// duration from the hit size (0.3..1.4 s); bosses thaw three times faster
		if ( s.data.duration === undefined && s.data.damage !== undefined ) {

			s.time = s.total = clamp( 0.3 + 5 * frac( e, s.data.damage ), 0.3, 1.4 ) * ( e.kind === 'boss' ? 0.35 : 1 );

		}

		interrupt( world, e );
		e.forced = null;

	},
	onExpire( world, e ) {

		if ( e.alive ) world.applyStatus( e, 'chill', { pct: 25, duration: 1 } );

	} } );

define( 'status', { id: 'shock', name: 'Shocked', tags: [ 'debuff', 'ailment', 'lightning' ], kind: 'debuff', icon: 'bolt', color: '#c9a6ff',
	duration: 2.5, stack: 'max', immuneFlag: 'immuneShock',
	init( world, e, o ) {

		ensureBase( e, 'damage_taken' );
		return { pct: o.pct ?? clamp( 10 + 250 * frac( e, o.damage ), 10, 50 ) };

	},
	merge( data, o ) {

		data.pct = Math.max( data.pct, o.pct ?? 10 );
		return data;

	},
	mods: ( s ) => [ { stat: 'damage_taken', type: 'inc', value: s.data.pct } ] } );

// Every poison is its own instance with its own timer (like Path of Exile), so a fast
// attacker builds up a big stack. s.stacks mirrors the instance count for the HUD.
define( 'status', { id: 'poison', name: 'Poisoned', tags: [ 'debuff', 'ailment', 'chaos', 'dot' ], kind: 'debuff', icon: 'drop', color: '#7ee04a',
	duration: 2, stack: 'max', maxStacks: 40, immuneFlag: 'immunePoison',
	init: ( world, e, o ) => ( { source: o.source, list: [ { dps: o.dps ?? ( o.damage ?? 0 ) * 0.3, time: o.duration ?? 2 } ] } ),
	merge( data, o ) {

		if ( data.list.length < 40 ) data.list.push( { dps: o.dps ?? ( o.damage ?? 0 ) * 0.3, time: o.duration ?? 2 } );
		data.source = o.source ?? data.source;
		return data;

	},
	onTick( world, e, s, dt ) {

		let dps = 0, left = 0;
		for ( const p of s.data.list ) {

			p.time -= dt;
			if ( p.time > 0 ) {

				dps += p.dps;
				left = Math.max( left, p.time );

			}

		}

		s.data.list = s.data.list.filter( ( p ) => p.time > 0 );
		s.stacks = s.data.list.length;
		s.time = left + dt;
		dotDamage( world, e, s, dps * dt, 'chaos' );

	} } );

// Bleeding hurts more while the victim moves: chasing a bleeding monster is a choice.
define( 'status', { id: 'bleed', name: 'Bleeding', tags: [ 'debuff', 'ailment', 'physical', 'dot' ], kind: 'debuff', icon: 'blood', color: '#e0303a',
	duration: 4, stack: 'max', immuneFlag: 'immuneBleed',
	init: ( world, e, o ) => ( { source: o.source, dps: o.dps ?? ( o.damage ?? 0 ) * 0.2 } ),
	merge( data, o ) {

		const dps = o.dps ?? ( o.damage ?? 0 ) * 0.2;
		if ( dps > data.dps ) data.dps = dps;
		return data;

	},
	onTick( world, e, s, dt ) {

		const moving = e.anim.speed > 0.6 ? 2.5 : 1;
		dotDamage( world, e, s, s.data.dps * moving * dt, 'physical' );

	} } );

// Stun (refines the baseline): interrupts, then grants a short immunity so nothing
// - player or monster - can be stun-locked by a stream of heavy hits.
define( 'status', { id: 'stun', name: 'Stunned', tags: [ 'debuff', 'cc' ], kind: 'debuff', icon: 'stars', color: '#ffe066',
	duration: 0.3, stack: 'refresh', flags: [ 'stunned' ], immuneFlag: 'stunImmune',
	onApply( world, e ) {

		interrupt( world, e );

	},
	onExpire( world, e, s ) {

		e.flags.stunImmune = true;
		schedule( world, Math.min( 0.6, 0.15 + s.total * 0.8 ), () => ( e.flags.stunImmune = false ) );

	} } );

// --- generic crowd control (monsters, mechanics) -------------------------------------

define( 'status', { id: 'slow', name: 'Slowed', tags: [ 'debuff', 'cc' ], kind: 'debuff', icon: 'snail', color: '#9aa7b8',
	duration: 2, stack: 'max',
	init: ( world, e, o ) => ( { pct: o.pct ?? 30 } ),
	merge( data, o ) {

		data.pct = Math.max( data.pct, o.pct ?? 30 );
		return data;

	},
	mods: ( s ) => [ { stat: 'move_speed', type: 'more', value: - s.data.pct } ] } );

define( 'status', { id: 'root', name: 'Rooted', tags: [ 'debuff', 'cc' ], kind: 'debuff', icon: 'root', color: '#8a6a48',
	duration: 1.5, stack: 'refresh', flags: [ 'rooted' ] } );

define( 'status', { id: 'vulnerable', name: 'Vulnerable', tags: [ 'debuff', 'curse' ], kind: 'debuff', icon: 'crack', color: '#ff9a9a',
	duration: 4, stack: 'max',
	init( world, e, o ) {

		ensureBase( e, 'damage_taken' );
		return { pct: o.pct ?? 20 };

	},
	merge( data, o ) {

		data.pct = Math.max( data.pct, o.pct ?? 20 );
		return data;

	},
	mods: ( s ) => [ { stat: 'damage_taken', type: 'inc', value: s.data.pct } ] } );

define( 'status', { id: 'weaken', name: 'Weakened', tags: [ 'debuff', 'curse' ], kind: 'debuff', icon: 'down', color: '#b0a0c0',
	duration: 4, stack: 'max',
	init: ( world, e, o ) => ( { pct: o.pct ?? 20 } ),
	merge( data, o ) {

		data.pct = Math.max( data.pct, o.pct ?? 20 );
		return data;

	},
	mods: ( s ) => [ { stat: 'damage', type: 'more', value: - s.data.pct } ] } );

// --- buffs -------------------------------------------------------------------------------

const buff = ( id, name, icon, color, duration, mods, extra = {} ) => define( 'status', {
	id, name, tags: [ 'buff' ], kind: 'buff', icon, color, duration, stack: 'max',
	init: ( world, e, o ) => ( { pct: o.pct ?? extra.pct ?? 20, ...o } ),
	merge( data, o ) {

		data.pct = Math.max( data.pct, o.pct ?? extra.pct ?? 20 );
		return data;

	},
	mods, ...extra
} );

buff( 'warcry', 'War Cry', 'shout', '#ff9a3c', 6, ( s ) => [
	{ stat: 'damage', type: 'inc', value: s.data.pct },
	{ stat: 'move_speed', type: 'inc', value: 10 },
	{ stat: 'stun_threshold', type: 'inc', value: 50 }
] );

buff( 'rage', 'Battle Rage', 'rage', '#ff4a3a', 8, ( s ) => [
	{ stat: 'attack_speed', type: 'inc', value: s.data.pct },
	{ stat: 'move_speed', type: 'inc', value: 10 },
	{ stat: 'life_leech', type: 'flat', value: 1, tags: [ 'attack' ] }
], { pct: 25 } );

buff( 'haste', 'Haste', 'wing', '#ffe066', 6, ( s ) => [
	{ stat: 'attack_speed', type: 'inc', value: s.data.pct },
	{ stat: 'cast_speed', type: 'inc', value: s.data.pct },
	{ stat: 'move_speed', type: 'inc', value: s.data.pct }
] );

buff( 'fortify', 'Fortified', 'shield', '#d9c27a', 5, ( s ) => [
	{ stat: 'damage_taken', type: 'more', value: - s.data.pct },
	{ stat: 'stun_threshold', type: 'inc', value: 100 }
], {
	pct: 20,
	onApply: ( world, e ) => ensureBase( e, 'damage_taken' )
} );

// Ice Armour: armour and cold resistance plus a frozen barrier (energy shield that
// recharges while the buff lasts; the shield clamp in sim.js trims it when it ends).
buff( 'ice-armour', 'Ice Armour', 'armour', '#9fe3ff', 8, ( s ) => [
	{ stat: 'armor', type: 'flat', value: s.data.armor ?? 30 },
	{ stat: 'res_cold', type: 'flat', value: 25 },
	{ stat: 'shield', type: 'flat', value: s.data.barrier ?? 20 }
], {
	onApply: ( world, e, s ) => ( e.shield = Math.max( e.shield, s.data.barrier ?? 20 ) )
} );

// Reave: each hit that connects grows the area of the next swings.
define( 'status', { id: 'reave', name: 'Reave', tags: [ 'buff' ], kind: 'buff', icon: 'reave', color: '#ffd0a0',
	duration: 3, stack: 'add', maxStacks: 8,
	mods: ( s ) => [ { stat: 'area', type: 'inc', value: 8 * s.stacks, tags: [ 'sk:reave' ] } ] } );

// Blade Vortex: orbiting blades. Each cast adds a blade (max 6) and refreshes the
// timer; every 0.3 s every blade hits the enemies inside the orbit. The hit template
// comes from the skill context (supports included) through opts.hit.
define( 'status', { id: 'blade-vortex', name: 'Blade Vortex', tags: [ 'buff' ], kind: 'buff', icon: 'vortex', color: '#d8e4ff',
	duration: 5, stack: 'add', maxStacks: 6,
	init: ( world, e, o ) => ( { hit: o.hit, radius: o.radius ?? 2.4, next: 0 } ),
	onTick( world, e, s, dt ) {

		const d = s.data;
		if ( ! d.hit ) return;
		d.next -= dt;
		if ( d.next > 0 ) return;
		d.next = 0.3;
		const hit = { ...d.hit, effectiveness: s.stacks };
		for ( const o of world.enemiesOf( e, e.x, e.z, d.radius ) ) world.dealDamage( e, o, hit );

	} } );

// Brief invulnerability (blink, phase skills).
define( 'status', { id: 'phased', name: 'Phased', tags: [ 'buff' ], kind: 'buff', icon: 'ghost', color: '#c0e0ff',
	duration: 0.25, stack: 'refresh', flags: [ 'invulnerable' ], hidden: true } );
