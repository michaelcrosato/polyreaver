// Hit resolution: one function turns a HIT TEMPLATE into damage, so every source
// (player skills, monster attacks, traps, explosions, mechanics) obeys the same
// rules and every stat, affix and slider takes effect everywhere at once.
//
// HIT TEMPLATE
//   damage        { physical: [min, max] | number, fire: ..., cold, lightning, chaos }
//   tags          [ 'attack' | 'spell' | 'trap' | ..., 'melee' | 'projectile' | 'area', ... ]
//   effectiveness multiplier on base AND added damage (skill "damage effectiveness"), default 1
//   addFlat       false: ignore the attacker's flat added damage (traps, environment)
//   critChance    base crit % (attacks: from the weapon, spells: from the skill); default from stats
//   knockback     m/s pushed away from the source (or from hit.originX/Z)
//   stun          seconds of stun on top of the automatic heavy-hit flinch
//   ailments      { ignite: 25, chill: 100, ... } extra % chances
//   skill         skill / ability id (events, stats, tooltips)
//   noAilments, noLeech, canBlock (default true), canEvade (attacks only, default true)
//
// STATS USED (all optional; see docs/GAME.md for the full list)
//   attacker: added_<type>_min/max, damage (multiplier, base 1), crit_chance, crit_multi,
//             pen_<type>, life_leech, mana_leech, life_on_hit, <ailment>_chance, accuracy
//   target:   armor, evade_chance, block_chance, res_<type>, max_res_<type>, damage_taken,
//             stun_threshold
// Every hit emits 'hit' (or 'evade' / 'block'); deaths go through world.kill().

import { DAMAGE_TYPES } from './stats.js';
import { TEAM } from './tuning.js';

const AILMENT_BY_TYPE = { fire: [ 'ignite' ], cold: [ 'chill', 'freeze' ], lightning: [ 'shock' ], chaos: [ 'poison' ], physical: [ 'bleed', 'poison' ] };

function roll( rng, v ) {

	if ( v === undefined || v === null ) return 0;
	if ( typeof v === 'number' ) return v;
	return v[ 0 ] + rng.next() * ( v[ 1 ] - v[ 0 ] );

}

export function resolveHit( world, src, tgt, hit ) {

	if ( ! tgt || ! tgt.alive || tgt.flags.invulnerable || tgt.flags.untargetable ) return null;
	const rng = world.rng;
	const tags = hit.tags || [];
	const S = src ? src.stats : null;
	const T = tgt.stats;
	const ox = hit.originX ?? src?.x ?? tgt.x, oz = hit.originZ ?? src?.z ?? tgt.z;

	// --- avoidance -----------------------------------------------------------
	const isAttack = tags.includes( 'attack' );
	if ( isAttack && hit.canEvade !== false && rng.next() * 100 < T.get( 'evade_chance', tags ) ) {

		world.events.emit( 'evade', { source: src, target: tgt, x: tgt.x, z: tgt.z } );
		return { evaded: true, total: 0 };

	}

	if ( hit.canBlock !== false && ( isAttack || tags.includes( 'projectile' ) ) && rng.next() * 100 < T.get( 'block_chance', tags ) ) {

		world.events.emit( 'block', { source: src, target: tgt, x: tgt.x, z: tgt.z } );
		return { blocked: true, total: 0 };

	}

	// --- base + added, scaled --------------------------------------------------
	const eff = hit.effectiveness ?? 1;
	const byType = {};
	let raw = 0;
	for ( const type of DAMAGE_TYPES ) {

		let base = roll( rng, hit.damage?.[ type ] );
		if ( S && hit.addFlat !== false ) {

			const lo = S.get( `added_${type}_min`, tags ), hi = S.get( `added_${type}_max`, tags );
			if ( hi > 0 ) base += lo + rng.next() * Math.max( 0, hi - lo );

		}

		base *= eff;
		if ( base <= 0 ) continue;
		const tt = tags.concat( type );
		byType[ type ] = base * ( S ? S.get( 'damage', tt ) : 1 );
		raw += byType[ type ];

	}

	if ( raw <= 0 && ! hit.allowZero ) return null;

	// --- crit ----------------------------------------------------------------
	let crit = false;
	if ( hit.canCrit !== false && S ) {

		// a skill / weapon base crit replaces the attacker's own base; increased and
		// more crit chance from the tree and gear scale whichever base is used
		const c = S.breakdown( 'crit_chance', tags, false );
		const baseCrit = hit.critChance ?? ( c.base + c.flat );
		const chance = c.override ?? baseCrit * Math.max( 0, 1 + c.inc / 100 ) * c.more;
		if ( rng.next() * 100 < chance ) {

			crit = true;
			const mult = S.get( 'crit_multi', tags ) / 100;
			for ( const k in byType ) byType[ k ] *= mult;

		}

	}

	// --- mitigation ----------------------------------------------------------
	let total = 0;
	for ( const type in byType ) {

		let d = byType[ type ];
		if ( type === 'physical' ) {

			const armor = Math.max( 0, T.get( 'armor' ) - ( S ? S.get( 'pen_armor', tags ) : 0 ) );
			d *= 1 - Math.min( 0.9, armor / ( armor + 5 * d + 1e-6 ) );

		} else {

			const cap = T.get( `max_res_${type}` ) || 75;
			const res = Math.max( - 100, Math.min( cap, T.get( `res_${type}` ) - ( S ? S.get( `pen_${type}`, tags ) : 0 ) ) );
			d *= 1 - res / 100;

		}

		d *= Math.max( 0, T.get( 'damage_taken', [ type ] ) || 1 );
		byType[ type ] = d;
		total += d;

	}

	// --- difficulty sliders ----------------------------------------------------
	const tune = world.tuning;
	if ( src && src.team === TEAM.ENEMY ) total *= tune.enemyDamage;
	if ( src && src.team === TEAM.PLAYER ) total *= tune.playerDamage;
	if ( tgt.team === TEAM.PLAYER && tune.godMode ) total = 0;
	if ( tgt.team === TEAM.ENEMY && src?.team === TEAM.PLAYER && tune.oneShot ) total = tgt.life + tgt.shield + 1;
	const scale = raw > 0 ? total / Math.max( 1e-9, Object.values( byType ).reduce( ( a, b ) => a + b, 0 ) ) : 0;
	for ( const k in byType ) byType[ k ] *= scale;

	// --- apply -----------------------------------------------------------------
	let toLife = total;
	if ( tgt.shield > 0 ) {

		const absorbed = Math.min( tgt.shield, total - ( byType.chaos || 0 ) );
		tgt.shield -= absorbed;
		toLife -= absorbed;

	}

	tgt.life -= toLife;
	tgt.data.lastHitBy = src?.id;
	tgt.data.lastHitTime = world.time;
	const dx = tgt.x - ox, dz = tgt.z - oz, dl = Math.hypot( dx, dz ) || 1;
	tgt.anim.hitDirX = dx / dl; tgt.anim.hitDirZ = dz / dl; tgt.anim.hitTime = world.time;

	if ( src && ! hit.noLeech && total > 0 ) {

		const leech = S.get( 'life_leech', tags ) / 100 * total + S.get( 'life_on_hit', tags );
		if ( leech > 0 ) src.life = Math.min( src.maxLife, src.life + leech );
		const mleech = S.get( 'mana_leech', tags ) / 100 * total;
		if ( mleech > 0 ) src.mana = Math.min( src.maxMana, src.mana + mleech );

	}

	// knockback (lighter targets fly further), stun on heavy hits
	const kb = ( hit.knockback ?? 0 ) * ( S ? S.get( 'knockback', tags ) || 1 : 1 );
	if ( kb > 0 && ! tgt.flags.unstoppable ) {

		tgt.impulse.x += dx / dl * kb / Math.max( 0.3, tgt.mass );
		tgt.impulse.z += dz / dl * kb / Math.max( 0.3, tgt.mass );

	}

	const heavy = total > tgt.maxLife * ( T.get( 'stun_threshold' ) || 0.15 );
	if ( ( hit.stun || heavy ) && ! tgt.flags.unstoppable && tgt.life > 0 ) world.applyStatus( tgt, 'stun', { source: src, duration: hit.stun || 0.25 } );

	// ailments: each damage type present can inflict its ailments
	if ( ! hit.noAilments && src ) {

		for ( const type in byType ) for ( const ail of AILMENT_BY_TYPE[ type ] || [] ) {

			const chance = ( hit.ailments?.[ ail ] ?? 0 ) + S.get( `${ail}_chance`, tags );
			if ( chance > 0 && rng.next() * 100 < chance ) world.applyStatus( tgt, ail, { source: src, damage: byType[ type ], hit } );

		}

	}

	const killed = tgt.life <= 0;
	const result = { source: src, target: tgt, total, byType, crit, killed, x: tgt.x, z: tgt.z, skill: hit.skill, tags };
	world.events.emit( 'hit', result );
	hit.onHit?.( world, src, tgt, result );
	if ( killed ) world.kill( tgt, src, hit );
	return result;

}
