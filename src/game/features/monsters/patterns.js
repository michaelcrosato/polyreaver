// Boss patterns: reusable multi-second attack scripts. A pattern is a def whose
// build( world, boss, opts, brain ) returns an action timeline (util.timeline, in
// SECONDS). Boss defs list patterns per phase, with options ( { id: 'meteor-rain',
// count: 14 } ); the procedural boss composer picks them by tags.
//
//   tags   delivery ( melee area ranged summon movement ), element ( fire cold ... ),
//          'generic' (any boss), 'signature' + a mechanic id (designed for one level)
//   range  [ min, max ] edge distance the boss walks into before starting it
//
// Every pattern follows the readability contract: each damaging shape is a ground
// telegraph ( area delay ≥ 0.5 s ) or a visible projectile with gaps to slip
// through; bullet patterns rotate slowly enough to walk with; nothing lands on the
// first frame it appears.

import { define, all } from '../../core/registry.js';
import { Entity } from '../../core/entity.js';
import { TEAM } from '../../core/tuning.js';
import { hitOf, telegraph, timeline, colorOf, fxOf, elementOf, ringPoint, clampWalk, teleport, tickHit, pull, inLine, isHostile, aiRng, MOVE_BLOCKERS, cancelArea, clamp, laneKnock } from './util.js';
import { spawnMonster, hooks } from './factory.js';

const pattern = ( def ) => define( 'bossPattern', { range: [ 0, 16 ], weight: 1, ...def } );
const bh = ( b, mult, o = {} ) => hitOf( b, mult, { tags: [ 'spell', 'area' ], skill: b.action?.def.id ?? 'boss', ...o } );
const tgt = ( world, b ) => b.data.bossBrain?.target || world.player || b;
const phaseOf = ( b ) => Math.max( 0, b.data.bossBrain?.phase ?? 0 );
const hard = ( b ) => b.data.enraged ? 1.25 : 1;
// Adds of this boss still alive (summon patterns stop while the arena is full).
export const liveAdds = ( world, b, tag ) => {

	let n = 0;
	for ( const e of world.entities ) if ( e.alive && e.data.summoner === b && ( ! tag || e.tags.has( tag ) ) ) n ++;
	return n;

};
const keep = ( b, a ) => {

	b.data.persist.push( a );
	b.data.persist = b.data.persist.filter( ( x ) => x.alive );
	return a;

};

// A straight lane from the boss toward `dir`, stopped by walls (and whether it was).
export function lane( world, b, dir, max = 18 ) {

	const x1 = b.x + Math.sin( dir ) * max, z1 = b.z + Math.cos( dir ) * max;
	const end = clampWalk( world, b.x, b.z, x1, z1, b.radius );
	return { dir, len: Math.max( 1.5, Math.hypot( end.x - b.x, end.z - b.z ) ), wall: world.layout.raycast( b.x, b.z, x1, z1, MOVE_BLOCKERS ) < 1 };

}

// Rush down a lane with a contact hit; onArrive( world, boss ) at the end.
export function rush( world, b, L, speed, mult, onArrive ) {

	const time = L.len / speed;
	b.facing = L.dir;
	b.flags.ghost = true;
	b.forced = { vx: Math.sin( L.dir ) * speed, vz: Math.cos( L.dir ) * speed, time, onEnd: ( w, e ) => {

		e.flags.ghost = false;
		onArrive?.( w, e );

	} };
	return world.area( b, { follow: b, radius: b.radius + 0.5, duration: time, interval: 0.05, hitOnce: true, fx: 'charge',
		hit: bh( b, mult, { tags: [ 'attack', 'melee' ], split: 0.5 } ), onHit: ( w, a, t ) => laneKnock( t, L.dir, b.x, b.z, 16 ) } );

}

// Crash: stunned and exposed - the reward for baiting a charge into a wall.
export function crash( world, b, seconds = 1.8 ) {

	b.forced = null;
	b.flags.ghost = false;
	world.events.emit( 'shake', { amount: 0.45, x: b.x, z: b.z } );
	world.events.emit( 'sfx', { id: 'crash', x: b.x, z: b.z, volume: 1 } );
	world.applyStatus( b, 'stun', { duration: seconds } );
	world.applyStatus( b, 'm-exposed', { duration: seconds + 1 } );

}

export function arenaPoint( world, b, rng = aiRng( world ), inner = 0.1, outer = 0.9 ) {

	const A = b.data.arena;
	return ringPoint( world, rng, A.x, A.z, A.r * inner, A.r * outer ) || { x: b.x, z: b.z };

}

// =================================================================================================
// GENERIC
// =================================================================================================

pattern( { id: 'slam-ring', name: 'Shockwave Slam', tags: [ 'generic', 'melee', 'area', 'physical' ], range: [ 0, 5 ],
	build: ( world, b ) => timeline( { id: 'slam-ring', anim: 'slam', seconds: 2.6, steps: [ [ 0, ( w ) => {

		const r = b.radius + 2.6;
		telegraph( w, b, null, { x: b.x, z: b.z, radius: r, delay: 0.9, fx: 'slam', hit: bh( b, 1.6, { split: 0.5, knockback: 10 } ) } );
		for ( let i = 1; i <= 2; i ++ ) telegraph( w, b, null, { x: b.x, z: b.z, shape: 'ring', inner: r + ( i - 1 ) * 2.6 + 1.2, radius: r + i * 2.6, delay: 0.9 + 0.45 * i, fx: 'quake', hit: bh( b, 1.1, { split: 0.5, knockback: 6 } ) } );

	} ], [ 0.9, ( w ) => w.events.emit( 'shake', { amount: 0.4 } ) ] ] } ) } );

pattern( { id: 'bullet-spiral', name: 'Spiral', tags: [ 'generic', 'ranged', 'arcane' ], range: [ 0, 10 ],
	build( world, b, o = {} ) {

		const arms = o.arms ?? 3 + ( phaseOf( b ) > 1 ? 1 : 0 ), spin = ( o.spin ?? 1.1 ) * aiRng( world ).sign(), steps = [];
		const el = elementOf( b, o.element );
		const base = Math.atan2( tgt( world, b ).x - b.x, tgt( world, b ).z - b.z );
		for ( let t = 0.7; t < 3.2; t += 0.14 ) steps.push( [ t, ( w ) => {

			for ( let k = 0; k < arms; k ++ ) w.projectile( b, { dir: base + spin * t + k * Math.PI * 2 / arms, speed: o.speed ?? 8, range: 22, radius: 0.4, fx: fxOf( el, 'bolt' ), color: colorOf( el ), element: el,
				hit: bh( b, 0.32 * hard( b ), { element: o.element, tags: [ 'spell', 'projectile' ] } ) } );

		} ] );
		return timeline( { id: 'bullet-spiral', anim: 'channel', seconds: 3.5, steps: [ [ 0, ( w ) => w.area( b, { follow: b, radius: b.radius + 1, delay: 0.7, fx: 'telegraph' } ) ], ...steps ] } );

	} } );

pattern( { id: 'bullet-nova', name: 'Nova Burst', tags: [ 'generic', 'ranged' ], range: [ 0, 10 ],
	build( world, b, o = {} ) {

		const n = o.count ?? 14 + phaseOf( b ) * 2, el = elementOf( b, o.element );
		const wave = ( off ) => ( w ) => {

			for ( let k = 0; k < n; k ++ ) w.projectile( b, { dir: ( k + off ) * Math.PI * 2 / n, speed: 9, range: 20, radius: 0.45, fx: fxOf( el, 'bolt' ), color: colorOf( el ), element: el, hit: bh( b, 0.45 * hard( b ), { element: o.element, tags: [ 'spell', 'projectile' ] } ) } );

		};

		return timeline( { id: 'bullet-nova', anim: 'cast_aoe', seconds: 2.6, steps: [
			[ 0, ( w ) => w.area( b, { follow: b, radius: b.radius + 1.2, delay: 0.7, fx: 'telegraph' } ) ],
			[ 0.7, wave( 0 ) ], [ 1.25, wave( 0.5 ) ], [ 1.8, wave( 0.25 ) ] ] } );

	} } );

pattern( { id: 'charge-chain', name: 'Rampage', tags: [ 'generic', 'melee', 'movement' ], range: [ 3, 18 ],
	build( world, b, o = {} ) {

		const n = o.count ?? 2 + Math.min( 2, phaseOf( b ) );
		const steps = [];
		for ( let i = 0; i < n; i ++ ) {

			const t0 = i * 1.35;
			steps.push( [ t0, ( w, e, act ) => {

				const t = tgt( w, b );
				act.ctx.lane = lane( w, b, Math.atan2( t.x - b.x, t.z - b.z ), 16 );
				telegraph( w, b, act, { x: b.x, z: b.z, shape: 'line', dir: act.ctx.lane.dir, length: act.ctx.lane.len + b.radius, width: b.radius * 2 + 1, delay: 0.65 } );

			} ], [ t0 + 0.65, ( w, e, act ) => rush( w, b, act.ctx.lane, 20, 1.6 * hard( b ) ) ] );

		}

		return timeline( { id: 'charge-chain', anim: 'charge', seconds: n * 1.35 + 0.5, steps } );

	} } );

pattern( { id: 'summon-adds', name: 'Call the Brood', tags: [ 'generic', 'summon' ], range: [ 0, 99 ], los: false,
	ready: ( world, b ) => liveAdds( world, b ) < 5 + 2 * phaseOf( b ),
	build: ( world, b, o = {} ) => timeline( { id: 'summon-adds', anim: 'summon', seconds: 1.8, steps: [ [ 0.6, ( w ) => {

		b.data.bossBrain?.spawnAdds( w, b, { family: o.family || b.data.minionFamily, count: o.count ?? 3, perPhase: 1, archetype: o.archetype, rarity: o.rarity } );

	} ] ] } ) } );

pattern( { id: 'eruptions', name: 'Eruptions', tags: [ 'generic', 'area', 'fire', 'physical' ], range: [ 0, 14 ],
	build: ( world, b, o = {} ) => timeline( { id: 'eruptions', anim: 'slam', seconds: 2.8, steps: [ [ 0.35, ( w ) => {

		const t = tgt( w, b ), rng = aiRng( w ), el = elementOf( b, o.element );
		const n = o.count ?? 7 + phaseOf( b ) * 2;
		telegraph( w, b, null, { x: t.x, z: t.z, radius: 2, delay: 0.9, fx: 'erupt', element: el, hit: bh( b, 1.4 * hard( b ), { element: o.element, knockback: 6 } ) } );
		for ( let i = 0; i < n; i ++ ) {

			const p = ringPoint( w, rng, t.x, t.z, 2.5, 8 );
			if ( p ) telegraph( w, b, null, { ...p, radius: 1.8, delay: 0.9 + rng.next() * 0.9, fx: 'erupt', element: el, hit: bh( b, 1.2 * hard( b ), { element: o.element, knockback: 5 } ) } );

		}

	} ] ] } ) } );

// Beam sweep: a cone shows the arc it will sweep, then the beam crosses it.
pattern( { id: 'beam-sweep', name: 'Sweeping Beam', tags: [ 'generic', 'area', 'lightning', 'arcane' ], range: [ 0, 12 ],
	build( world, b, o = {} ) {

		const arc = ( o.arc ?? 140 ) * Math.PI / 180, len = o.length ?? 16, el = elementOf( b, o.element );
		return timeline( { id: 'beam-sweep', anim: 'breath', seconds: 3.8, steps: [
			[ 0, ( w, e, act ) => {

				const t = tgt( w, b ), mid = Math.atan2( t.x - b.x, t.z - b.z );
				act.ctx.from = mid - arc / 2 * ( act.ctx.sign = aiRng( w ).sign() );
				telegraph( w, b, act, { x: b.x, z: b.z, shape: 'cone', dir: mid, angle: arc * 180 / Math.PI, radius: len, delay: 0.9 } );

			} ],
			[ 0.9, ( w, e, act ) => {

				const t0 = w.time, sweep = 2.4;
				act.ctx.beam = w.area( b, { follow: b, shape: 'line', dir: act.ctx.from, length: len, width: 1.3, duration: sweep, interval: 0.03, fx: 'beam', color: colorOf( el ), element: el,
					onTick( ww, a ) {

						a.dir = act.ctx.from + act.ctx.sign * arc * clamp( ( ww.time - t0 ) / sweep, 0, 1 );
						for ( const o2 of ww.query( a.x, a.z, len, ( x ) => isHostile( b, x ) ) ) {

							if ( inLine( o2.x, o2.z, a.x, a.z, a.dir, len, 1.3, o2.radius ) ) tickHit( ww, b, o2, bh( b, 0.7 * hard( b ), { element: o.element } ), 'beam' + b.id, 0.45 );

						}

					} } );

			} ] ],
		onCancel: ( w, e, act ) => act.ctx.beam && cancelArea( w, act.ctx.beam ) } );

	} } );

pattern( { id: 'leap-slam', name: 'Crushing Leap', tags: [ 'generic', 'melee', 'movement', 'physical' ], range: [ 3, 14 ],
	build: ( world, b ) => timeline( { id: 'leap-slam', anim: 'leap', seconds: 2.2, steps: [
		[ 0, ( w, e, act ) => {

			const t = tgt( w, b );
			act.ctx.land = clampWalk( w, b.x, b.z, t.x, t.z, b.radius );
			const { x, z } = act.ctx.land;
			telegraph( w, b, null, { x, z, radius: b.radius + 2.2, delay: 1.25, fx: 'slam', hit: bh( b, 2 * hard( b ), { split: 0.5, knockback: 12 } ) } );
			telegraph( w, b, null, { x, z, shape: 'ring', inner: b.radius + 2.6, radius: b.radius + 5, delay: 1.6, fx: 'quake', hit: bh( b, 0.9, { split: 0.5, knockback: 6 } ) } );

		} ],
		[ 0.6, ( w, e, act ) => {

			const T = 0.65, L = act.ctx.land;
			b.forced = { vx: ( L.x - b.x ) / T, vz: ( L.z - b.z ) / T, time: T };
			b.vy = 15 * T;
			b.y = 0.01;

		} ],
		[ 1.25, ( w ) => w.events.emit( 'shake', { amount: 0.5 } ) ] ] } ) } );

pattern( { id: 'teleport-nova', name: 'Blink Nova', tags: [ 'generic', 'area', 'movement', 'arcane' ], range: [ 0, 99 ], los: false,
	build: ( world, b ) => timeline( { id: 'teleport-nova', anim: 'cast', seconds: 2.3, steps: [
		[ 0, ( w, e, act ) => {

			const t = tgt( w, b );
			act.ctx.to = ringPoint( w, aiRng( w ), t.x, t.z, 3, 5 ) || { x: b.x, z: b.z };
			telegraph( w, b, null, { ...act.ctx.to, radius: b.radius + 0.5, delay: 0.7, fx: 'rift' } );

		} ],
		[ 0.7, ( w, e, act ) => {

			w.events.emit( 'blink', { entity: b, x: b.x, z: b.z, tx: act.ctx.to.x, tz: act.ctx.to.z } );
			teleport( b, act.ctx.to.x, act.ctx.to.z );
			telegraph( w, b, null, { x: b.x, z: b.z, radius: b.radius + 4, delay: 0.75, fx: fxOf( elementOf( b ) ), hit: bh( b, 1.5 * hard( b ), { knockback: 9 } ) } );

		} ] ] } ) } );

pattern( { id: 'meteor-rain', name: 'Rain of Ruin', tags: [ 'generic', 'area', 'fire', 'cold', 'lightning', 'chaos' ], range: [ 0, 99 ], los: false,
	build: ( world, b, o = {} ) => timeline( { id: 'meteor-rain', anim: 'cast_aoe', seconds: 3.8, steps: [ [ 0.5, ( w ) => {

		const rng = aiRng( w ), el = elementOf( b, o.element ), n = o.count ?? 10 + phaseOf( b ) * 3;
		for ( let i = 0; i < n; i ++ ) {

			const t = tgt( w, b );
			const p = i % 4 === 0 ? { x: t.x + t.vx * 0.6, z: t.z + t.vz * 0.6 } : arenaPoint( w, b, rng );
			telegraph( w, b, null, { ...p, radius: 2.1, delay: 1.0 + i * ( 1.8 / n ), fx: el === 'fire' ? 'meteor' : fxOf( el ), element: el,
				hit: bh( b, 1.3 * hard( b ), { element: o.element, knockback: 5 } ) } );

		}

	} ] ] } ) } );

pattern( { id: 'breath-cone', name: 'Breath', tags: [ 'generic', 'area', 'fire', 'cold', 'chaos' ], range: [ 0, 7 ],
	build( world, b, o = {} ) {

		const el = elementOf( b, o.element ), r = b.radius + ( o.reach ?? 8 );
		return timeline( { id: 'breath-cone', anim: 'breath', seconds: 2.6, steps: [
			[ 0, ( w, e, act ) => {

				const t = tgt( w, b );
				act.ctx.dir = b.facing = Math.atan2( t.x - b.x, t.z - b.z );
				telegraph( w, b, act, { follow: b, shape: 'cone', dir: act.ctx.dir, angle: 80, radius: r, delay: 0.8 } );

			} ],
			[ 0.8, ( w, e, act ) => {

				act.ctx.gout = w.area( b, { follow: b, shape: 'cone', dir: act.ctx.dir, angle: 80, radius: r, duration: 1.5, interval: 0.25, hitOnce: false, fx: fxOf( el ), color: colorOf( el ), element: el,
					hit: bh( b, 0.45 * hard( b ), { element: o.element } ) } );

			} ] ],
		onCancel: ( w, e, act ) => act.ctx.gout && cancelArea( w, act.ctx.gout ) } );

	} } );

pattern( { id: 'shard-fan', name: 'Shard Volleys', tags: [ 'generic', 'ranged', 'cold', 'physical' ], range: [ 2, 14 ],
	build( world, b, o = {} ) {

		const n = o.count ?? 7, el = elementOf( b, o.element );
		const volley = ( w ) => {

			const t = tgt( w, b ), base = Math.atan2( t.x - b.x, t.z - b.z );
			for ( let k = 0; k < n; k ++ ) w.projectile( b, { dir: base + ( k / ( n - 1 ) - 0.5 ) * 1.25, speed: 13, range: 20, radius: 0.4, fx: 'shard', color: colorOf( el ), element: el,
				hit: bh( b, 0.5 * hard( b ), { element: o.element, tags: [ 'attack', 'projectile' ] } ) } );

		};

		return timeline( { id: 'shard-fan', anim: 'throw', seconds: 2.6, steps: [ [ 0.6, volley ], [ 1.2, volley ], [ 1.8, volley ] ] } );

	} } );

pattern( { id: 'gravity-well', name: 'Gravity Well', tags: [ 'generic', 'area', 'chaos', 'arcane', 'gravity-wells' ], range: [ 0, 99 ], los: false,
	build: ( world, b, o = {} ) => timeline( { id: 'gravity-well', anim: 'cast_aoe', seconds: 1.4, steps: [ [ 0.4, ( w ) => {

		const t = tgt( w, b ), x = t.x, z = t.z, life = o.seconds ?? 3.2;
		// the well: pulls for `life` seconds, then implodes (the implosion is telegraphed by the well itself)
		keep( b, w.area( b, { x, z, radius: o.radius ?? 7, delay: 0.5, duration: life, interval: 0.05, fx: 'void', color: colorOf( 'chaos' ), element: 'chaos',
			onTick( ww ) {

				for ( const v of ww.query( x, z, o.radius ?? 7, ( q ) => isHostile( b, q ) ) ) {

					pull( v, x, z, 0.55 );
					if ( Math.hypot( v.x - x, v.z - z ) < 1.6 + v.radius ) tickHit( ww, b, v, bh( b, 0.5, { element: 'chaos' } ), 'well' + b.id, 0.5 );

				}

			} } ) );
		telegraph( w, b, null, { x, z, radius: 3.2, delay: 0.5 + life, fx: 'void', element: 'chaos', hit: bh( b, 1.6 * hard( b ), { element: 'chaos', knockback: 10 } ) } );

	} ] ] } ) } );

// Rows of eruptions sweeping across the arena, each with one safe gap.
function waveRows( world, b, { rows = 8, spacing = 1.9, width = 1.5, half = 9, gap = 2.6, element, fx, mult = 1.3, start = 0.7, step = 0.22, leaveFor = 0, linger } ) {

	const t = tgt( world, b ), rng = aiRng( world );
	const dir = Math.atan2( t.x - b.x, t.z - b.z ), across = dir + Math.PI / 2;
	const fx0 = Math.sin( dir ), fz0 = Math.cos( dir ), ax = Math.sin( across ), az = Math.cos( across );
	let g = ( rng.next() - 0.5 ) * half;
	for ( let i = 0; i < rows; i ++ ) {

		g = clamp( g + ( rng.next() - 0.5 ) * 4, - half + gap, half - gap );
		const cx = b.x + fx0 * ( b.radius + 1.5 + i * spacing ), cz = b.z + fz0 * ( b.radius + 1.5 + i * spacing );
		const delay = start + i * step;
		// left part: from -half to the gap; right part: from the gap to +half (line areas start at x,z and run along dir)
		for ( const [ a0, a1 ] of [ [ - half, g - gap / 2 ], [ g + gap / 2, half ] ] ) {

			if ( a1 - a0 < 0.5 ) continue;
			telegraph( world, b, null, { x: cx + ax * a0, z: cz + az * a0, shape: 'line', dir: across, length: a1 - a0, width, delay, fx, element,
				duration: leaveFor, interval: 0.5, hitOnce: ! leaveFor, hit: bh( b, mult * hard( b ), { element, knockback: 4 } ), data: { linger } } );

		}

	}

}

pattern( { id: 'quake-lines', name: 'Rolling Quake', tags: [ 'generic', 'area', 'physical' ], range: [ 0, 8 ],
	build: ( world, b, o = {} ) => timeline( { id: 'quake-lines', anim: 'slam', seconds: 3, steps: [ [ 0.3, ( w ) => waveRows( w, b, { element: elementOf( b, o.element ), fx: 'quake', rows: o.rows ?? 8 } ) ] ] } ) } );

pattern( { id: 'mortar-barrage', name: 'Barrage', tags: [ 'generic', 'ranged', 'area' ], range: [ 3, 99 ], los: false,
	build: ( world, b, o = {} ) => timeline( { id: 'mortar-barrage', anim: 'throw', seconds: 3, steps: [ 0.5, 0.9, 1.3, 1.7, 2.1 ].map( ( t0 ) => [ t0, ( w ) => {

		const t = tgt( w, b ), rng = aiRng( w ), el = elementOf( b, o.element );
		const p = { x: t.x + t.vx * 0.7 + ( rng.next() - 0.5 ) * 3, z: t.z + t.vz * 0.7 + ( rng.next() - 0.5 ) * 3 };
		telegraph( w, b, null, { ...p, radius: 2, delay: 1.1, fx: fxOf( el ), element: el, hit: bh( b, 1.2 * hard( b ), { element: o.element, knockback: 5 } ) } );
		const d = Math.hypot( p.x - b.x, p.z - b.z );
		w.projectile( b, { tx: p.x, tz: p.z, speed: Math.max( 4, d / 1.1 ), range: d, radius: 0.05, pierce: 999, fx: 'lob', color: colorOf( el ), element: el, data: { arc: 5 } } );

	} ] ) } ) } );

// =================================================================================================
// SIGNATURE (one per campaign mechanic; the composer uses them when the level has that mechanic)
// =================================================================================================

// --- Powder Keg: lobbed kegs with a visible fuse. Hit a keg yourself and it is YOUR
// explosion (it hurts monsters and the boss, not you); let the fuse run out and it
// hurts everyone nearby - including the boss, if you lure him next to it.
export function spawnKeg( world, owner, x, z, fuse = 3 ) {

	const k = new Entity( { kind: 'prop', team: TEAM.NEUTRAL, level: owner.level, x, z, radius: 0.45, height: 0.9, mass: 3 } );
	k.name = 'Powder Keg';
	k.model = { type: 'prop', id: 'barrel', glow: '#ff9a3c' };
	k.stats.base.life = 1;
	k.stats.base.damage = 1;
	k.data.damage = owner.data.damage;
	k.data.element = 'fire';
	k.data.keg = { owner, fuse };
	k.data.corpseTime = 0.1;
	k.tags.add( 'explosive' );
	world.add( k );
	k.life = 1;
	k.data.keg.area = keep( owner, world.area( k, { x, z, radius: 3.2, delay: fuse, fx: 'explosion', color: colorOf( 'fire' ), element: 'fire', data: { telegraph: true },
		hit: kegHit( k ), onHit: kegBonus, onEnd: ( w ) => {

			if ( k.alive ) {

				k.data.keg.done = true;
				w.kill( k, null );

			}

			chainKegs( w, k );

		} } ) );
	return k;

}

const kegHit = ( k ) => ( { damage: { physical: [ k.data.damage[ 0 ] * 1.2, k.data.damage[ 1 ] * 1.2 ], fire: [ k.data.damage[ 0 ] * 1.2, k.data.damage[ 1 ] * 1.2 ] }, tags: [ 'area', 'explosion' ], addFlat: false, knockback: 12, skill: 'powder-keg' } );

// Kegs hurt monsters by a share of their life - blowing up packs and bosses is the point.
function kegBonus( world, a, t ) {

	if ( ! t.alive || t.team === TEAM.PLAYER ) return;
	const share = t.kind === 'boss' ? 0.05 : 0.35;
	world.dealDamage( a.owner, t, { damage: { fire: t.maxLife * share }, tags: [ 'area', 'explosion' ], addFlat: false, canCrit: false, noAilments: true, noLeech: true, skill: 'powder-keg' } );

}

function chainKegs( world, k ) {

	for ( const o of world.query( k.x, k.z, 3.4, ( q ) => q.alive && q.data.keg && q !== k ) ) {

		o.data.detonatedBy = o.data.detonatedBy || k.data.detonatedBy;
		world.kill( o, null );

	}

}

// A keg that dies early (hit by anyone) blows after a 0.25 s flash. Its owner is
// whoever set it off: the player gets credit (and immunity) for kegs they pop.
export function detonateKeg( world, k ) {

	const K = k.data.keg;
	if ( ! K || K.done ) return;
	K.done = true;
	cancelArea( world, K.area );
	const by = k.data.detonatedBy;
	const owner = by && by.alive ? by : k;
	world.area( owner, { x: k.x, z: k.z, radius: 3.2, delay: 0.25, fx: 'explosion', color: colorOf( 'fire' ), element: 'fire', data: { telegraph: true },
		hit: kegHit( k ), onHit: kegBonus, onEnd: ( w ) => chainKegs( w, k ) } );
	world.events.emit( 'explode', { entity: k, x: k.x, z: k.z, radius: 3.2 } );

}

pattern( { id: 'keg-toss', name: 'Keg Toss', tags: [ 'signature', 'powder-keg', 'fire', 'ranged' ], range: [ 2, 14 ],
	build: ( world, b, o = {} ) => timeline( { id: 'keg-toss', anim: 'throw', seconds: 2.4, steps: [ 0.5, 1.0, 1.5 ].slice( 0, o.count ?? 3 ).map( ( t0 ) => [ t0, ( w ) => {

		const t = tgt( w, b ), rng = aiRng( w );
		const p = ringPoint( w, rng, t.x, t.z, 1.5, 4 ) || { x: t.x, z: t.z };
		const d = Math.hypot( p.x - b.x, p.z - b.z );
		w.projectile( b, { tx: p.x, tz: p.z, speed: Math.max( 5, d / 0.7 ), range: d, radius: 0.05, pierce: 999, fx: 'barrel', color: '#a0703a', data: { arc: 4 },
			onEnd: ( ww, pr ) => spawnKeg( ww, b, pr.x, pr.z, o.fuse ?? 3 ) } );

	} ] ) } ) } );

// --- Spike Field: rows of spikes ripple out across the crypt floor, one safe gap per row.
pattern( { id: 'spike-lines', name: 'Spike Wave', tags: [ 'signature', 'spike-field', 'physical', 'area' ], range: [ 0, 10 ],
	build: ( world, b, o = {} ) => timeline( { id: 'spike-lines', anim: 'slam', seconds: 3.2, steps: [ [ 0.3, ( w ) => waveRows( w, b, { element: 'physical', fx: 'spikes', rows: o.rows ?? 9, gap: 2.4, width: 1.4, step: 0.2 } ) ] ] } ) } );

// --- Lightless: the boss vanishes into the dark and strikes from it.
pattern( { id: 'vanish-ambush', name: 'From the Dark', tags: [ 'signature', 'lightless', 'chaos', 'movement' ], range: [ 0, 99 ], los: false,
	build: ( world, b ) => timeline( { id: 'vanish-ambush', anim: 'roar', seconds: 3.6, steps: [
		[ 0.3, ( w ) => w.applyStatus( b, 'm-vanished', { duration: 3.4 } ) ],
		[ 1.9, ( w, e, act ) => {

			const t = tgt( w, b );
			act.ctx.spot = { x: t.x, z: t.z };
			telegraph( w, b, null, { x: t.x, z: t.z, radius: 2.6, delay: 1.0, fx: 'slash', element: 'chaos', hit: bh( b, 2.0 * hard( b ), { split: 0.5, knockback: 8 } ) } );

		} ],
		[ 2.75, ( w, e, act ) => {

			const s = act.ctx.spot, p = ringPoint( w, aiRng( w ), s.x, s.z, 1.2, 2.4 ) || s;
			teleport( b, p.x, p.z );

		} ],
		[ 2.9, ( w ) => w.removeStatus( b, 'm-vanished' ) ] ] } ) } );

// --- Black Ice: long momentum slides wall to wall, leaving ice; the last one crashes.
pattern( { id: 'ice-slide', name: 'Black Ice Slide', tags: [ 'signature', 'black-ice', 'cold', 'movement' ], range: [ 2, 99 ], los: false,
	build( world, b, o = {} ) {

		const n = o.count ?? 3, steps = [];
		for ( let i = 0; i < n; i ++ ) {

			const t0 = i * 1.45, last = i === n - 1;
			steps.push( [ t0, ( w, e, act ) => {

				const t = tgt( w, b );
				act.ctx.lane = lane( w, b, Math.atan2( t.x - b.x, t.z - b.z ) + ( aiRng( w ).next() - 0.5 ) * 0.3, 30 );
				telegraph( w, b, act, { x: b.x, z: b.z, shape: 'line', dir: act.ctx.lane.dir, length: act.ctx.lane.len + b.radius, width: b.radius * 2 + 1, delay: 0.6 } );

			} ], [ t0 + 0.6, ( w, e, act ) => {

				const L = act.ctx.lane, x0 = b.x, z0 = b.z;
				rush( w, b, L, 22, 1.5 * hard( b ), ( ww ) => {

					// the trail of black ice: a lingering chilling lane
					keep( b, ww.area( b, { x: x0, z: z0, shape: 'line', dir: L.dir, length: L.len, width: 2.2, duration: 5, interval: 0.5, hitOnce: false, fx: 'ice', color: colorOf( 'cold' ), element: 'cold',
						hit: bh( b, 0.12, { element: 'cold', ailments: { chill: 100 } } ) } ) );
					if ( last && L.wall ) crash( ww, b, 2.2 );

				} );

			} ] );

		}

		return timeline( { id: 'ice-slide', anim: 'charge', seconds: n * 1.45 + 0.6, steps } );

	} } );

// --- Conduits: pylons rise around the arena, linked by lightning. While two or
// more stand the boss is shielded (takes 40% less damage). Break them.
pattern( { id: 'conduit-pylons', name: 'Raise Conduits', tags: [ 'signature', 'conduits', 'lightning', 'summon' ], range: [ 0, 99 ], los: false,
	ready: ( world, b ) => liveAdds( world, b, 'pylon' ) === 0,
	build: ( world, b, o = {} ) => timeline( { id: 'conduit-pylons', anim: 'cast_aoe', seconds: 2, steps: [ [ 0.7, ( w ) => {

		const n = o.count ?? 3, pylons = [];
		const A = b.data.arena, rng = aiRng( w ), a0 = rng.next() * Math.PI * 2;
		for ( let i = 0; i < n; i ++ ) {

			const a = a0 + i * Math.PI * 2 / n;
			let p = { x: A.x + Math.sin( a ) * A.r * 0.55, z: A.z + Math.cos( a ) * A.r * 0.55 };
			if ( ! w.layout.isWalkable( p.x, p.z ) ) p = arenaPoint( w, b, rng, 0.3, 0.7 );
			const m = spawnMonster( w, { family: o.family || 'coil-sentry', archetype: 'turret', level: b.level, x: p.x, z: p.z, summoned: true, minions: 0, lifeMult: 0.9, abilities: [] } );
			if ( ! m ) continue;
			m.name = 'Conduit';
			m.tags.add( 'pylon' );
			m.data.summoner = b;
			m.data.spawnUntil = w.time + 0.6;
			pylons.push( m );

		}

		b.data.pylons = pylons;
		// while two or more conduits stand, the boss takes 40% less damage
		b.stats.setSource( 'conduits', [ { stat: 'damage_taken', type: 'more', value: - 40, when: 'charged' } ] );
		keep( b, w.area( b, { follow: b, radius: b.radius + 0.6, duration: 120, interval: 0.25, fx: 'conduit-shield', color: colorOf( 'lightning' ),
			onTick( ww, a ) {

				const up = pylons.filter( ( m ) => m.alive ).length >= 2;
				b.stats.setFlag( 'charged', up );
				if ( ! up ) cancelArea( ww, a );

			} } ) );
		for ( let i = 0; i < pylons.length; i ++ ) {

			const p = pylons[ i ], q = pylons[ ( i + 1 ) % pylons.length ];
			if ( p === q ) continue;
			keep( b, w.area( b, { x: p.x, z: p.z, shape: 'line', dir: Math.atan2( q.x - p.x, q.z - p.z ), length: Math.hypot( q.x - p.x, q.z - p.z ), width: 0.9,
				delay: 1.2, duration: 60, interval: 0.05, fx: 'beam', color: colorOf( 'lightning' ), element: 'lightning', data: { link: [ p, q ] },
				onTick( ww, a ) {

					if ( ! p.alive || ! q.alive ) return cancelArea( ww, a );
					for ( const v of ww.query( p.x, p.z, a.length + 1, ( x ) => isHostile( b, x ) || ( x.team === b.team && x.kind === 'monster' && ! x.tags.has( 'pylon' ) ) ) ) {

						if ( inLine( v.x, v.z, a.x, a.z, a.dir, a.length, 0.9, v.radius ) ) tickHit( ww, b, v, bh( b, 0.8, { element: 'lightning', ailments: { shock: 50 } } ), 'conduit', 0.5 );

					}

				} } ) );

		}

	} ] ] } ) } );

// --- Rift Gates: the boss steps through a rift next to you; bolts pour out of others.
pattern( { id: 'rift-volley', name: 'Rift Volley', tags: [ 'signature', 'rift-gates', 'arcane', 'ranged' ], range: [ 0, 99 ], los: false,
	build: ( world, b, o = {} ) => timeline( { id: 'rift-volley', anim: 'cast', seconds: 2.8, steps: [ [ 0, ( w, e, act ) => {

		const t = tgt( w, b ), n = o.count ?? 4 + phaseOf( b ), a0 = aiRng( w ).next() * Math.PI * 2;
		act.ctx.rifts = [];
		for ( let i = 0; i < n; i ++ ) {

			const a = a0 + i * Math.PI * 2 / n, p = { x: t.x + Math.sin( a ) * 7, z: t.z + Math.cos( a ) * 7 };
			act.ctx.rifts.push( p );
			w.area( b, { ...p, radius: 0.9, delay: 0.9 + i * 0.25, fx: 'rift', color: colorOf( 'lightning' ) } );

		}

	} ], ...[ 0, 1, 2, 3, 4, 5, 6 ].map( ( i ) => [ 0.9 + i * 0.25, ( w, e, act ) => {

		const p = act.ctx.rifts?.[ i ];
		if ( ! p ) return;
		const t = tgt( w, b );
		w.projectile( b, { x: p.x, z: p.z, tx: t.x, tz: t.z, dir: Math.atan2( t.x - p.x, t.z - p.z ), speed: 11, range: 16, radius: 0.45, fx: 'bolt', color: colorOf( 'lightning' ), element: 'lightning',
			hit: bh( b, 0.7 * hard( b ), { element: 'lightning', tags: [ 'spell', 'projectile' ] } ) } );

	} ] ) ] } ) } );

// --- Magma Tide: lava waves roll across the arena, leaving burning rows for a moment.
pattern( { id: 'magma-wave', name: 'Magma Tide', tags: [ 'signature', 'magma-tide', 'fire', 'area' ], range: [ 0, 10 ],
	build: ( world, b, o = {} ) => timeline( { id: 'magma-wave', anim: 'slam', seconds: 3.6, steps: [ [ 0.3, ( w ) => waveRows( w, b, { element: 'fire', fx: 'lava', rows: o.rows ?? 8, gap: 3, width: 1.8, spacing: 2, step: 0.28, leaveFor: 1.5, mult: 0.65 } ) ] ] } ) } );

// --- Echoes: everywhere you stood in the last few seconds erupts. Keep moving.
pattern( { id: 'echo-strike', name: 'Echoes of You', tags: [ 'signature', 'echoes', 'arcane', 'area' ], range: [ 0, 99 ], los: false,
	build: ( world, b ) => timeline( { id: 'echo-strike', anim: 'cast_aoe', seconds: 2.6, steps: [ [ 0.4, ( w ) => {

		const trail = b.data.trail || [];
		const pts = trail.filter( ( p, i ) => i % 2 === 0 ).slice( - 12 );
		pts.forEach( ( p, i ) => telegraph( w, b, null, { x: p.x, z: p.z, radius: 1.7, delay: 0.7 + i * 0.12, fx: 'echo', element: elementOf( b ), hit: bh( b, 1.1 * hard( b ), { knockback: 4 } ) } ) );

	} ] ] } ) } );

// Mirror images of the boss stand around you and copy its next pattern (damage only).
pattern( { id: 'mirror-images', name: 'Hall of Mirrors', tags: [ 'signature', 'echoes', 'summon' ], range: [ 0, 99 ], los: false,
	ready: ( world, b ) => liveAdds( world, b, 'illusion' ) === 0,
	build: ( world, b, o = {} ) => timeline( { id: 'mirror-images', anim: 'cast', seconds: 1.8, steps: [ [ 0.6, ( w ) => {

		const t = tgt( w, b ), n = o.count ?? 2 + Math.min( 2, phaseOf( b ) );
		for ( let i = 0; i < n; i ++ ) {

			const a = i * Math.PI * 2 / n + Math.atan2( b.x - t.x, b.z - t.z );
			const p = { x: t.x + Math.sin( a ) * 7, z: t.z + Math.cos( a ) * 7 };
			if ( ! w.layout.isWalkable( p.x, p.z ) ) continue;
			const m = spawnMonster( w, { family: o.family || 'mirror-shade', archetype: 'caster', level: b.level, x: p.x, z: p.z, summoned: true, minions: 0, lifeMult: 0.6,
				genome: { ...b.model.genome, size: b.model.genome.size * 0.5 }, abilities: [ 'fan', 'beam' ], tint: '#bfe8ff', name: 'Reflection' } );
			if ( ! m ) continue;
			m.tags.add( 'illusion' );
			m.data.summoner = b;
			m.data.xp = 0; m.data.lootMult = 0;
			telegraph( w, b, null, { ...p, radius: 1.2, delay: 0.6, fx: 'summon' } );
			m.data.spawnUntil = w.time + 0.6;

		}

	} ] ] } ) } );

// --- The Swarm: the hive answers. Many weak swarmers from the arena's edges.
pattern( { id: 'swarm-call', name: 'The Swarm Answers', tags: [ 'signature', 'swarm', 'the-swarm', 'summon' ], range: [ 0, 99 ], los: false,
	ready: ( world, b ) => liveAdds( world, b ) < 12 + 4 * phaseOf( b ),
	build: ( world, b, o = {} ) => timeline( { id: 'swarm-call', anim: 'roar', seconds: 2, steps: [ [ 0.6, ( w ) => {

		b.data.bossBrain?.spawnAdds( w, b, { family: o.family || 'ash-drone', archetype: 'swarmer', count: o.count ?? 6, perPhase: 2 } );

	} ] ] } ) } );

// --- Chrono Fields: slow fields around you, haste for the boss.
pattern( { id: 'chrono-zones', name: 'Time Fracture', tags: [ 'signature', 'chrono-fields', 'arcane', 'area' ], range: [ 0, 99 ], los: false,
	build: ( world, b, o = {} ) => timeline( { id: 'chrono-zones', anim: 'cast_aoe', seconds: 2.2, steps: [ [ 0.5, ( w ) => {

		const t = tgt( w, b ), rng = aiRng( w ), n = o.count ?? 3;
		for ( let i = 0; i < n; i ++ ) {

			const p = i === 0 ? { x: t.x, z: t.z } : ringPoint( w, rng, t.x, t.z, 3, 6 );
			if ( ! p ) continue;
			keep( b, w.area( b, { ...p, radius: 3.2, delay: 0.7, duration: 6, interval: 0.25, hitOnce: false, fx: 'time', color: '#e8d27a', data: { endsWithPhase: true },
				onTick( ww, a ) {

					for ( const v of ww.query( a.x, a.z, a.radius, ( x ) => isHostile( b, x ) ) ) ww.applyStatus( v, 'm-slow', { duration: 0.4, source: b } );

				} } ) );

		}

		w.applyStatus( b, 'm-haste', { duration: 5, source: b } );

	} ] ] } ) } );

// Clock hands: two beams rotating around the boss at different speeds.
pattern( { id: 'clock-hands', name: 'Clock Hands', tags: [ 'signature', 'chrono-fields', 'arcane', 'area' ], range: [ 0, 8 ],
	build( world, b, o = {} ) {

		const len = o.length ?? 15, seconds = 4.6;
		return timeline( { id: 'clock-hands', anim: 'channel', seconds: seconds + 0.6, steps: [
			[ 0, ( w, e, act ) => {

				const t = tgt( w, b ), base = Math.atan2( t.x - b.x, t.z - b.z ) + Math.PI / 2;
				act.ctx.base = base;
				for ( const k of [ 0, Math.PI ] ) telegraph( w, b, act, { x: b.x, z: b.z, shape: 'line', dir: base + k, length: len, width: 1.2, delay: 1.0 } );

			} ],
			[ 1.0, ( w, e, act ) => {

				act.ctx.hands = [ [ 0, 0.55 ], [ Math.PI, 1.25 ] ].map( ( [ off, speed ] ) => {

					const t0 = w.time;
					return w.area( b, { follow: b, shape: 'line', dir: act.ctx.base + off, length: len, width: 1.2, duration: seconds - 1, interval: 0.03, fx: 'beam', color: '#ffe07a', element: 'lightning',
						onTick( ww, a ) {

							a.dir = act.ctx.base + off + ( ww.time - t0 ) * speed;
							for ( const v of ww.query( a.x, a.z, len, ( x ) => isHostile( b, x ) ) ) {

								if ( inLine( v.x, v.z, a.x, a.z, a.dir, len, 1.2, v.radius ) ) tickHit( ww, b, v, bh( b, 0.75 * hard( b ), { element: 'lightning' } ), 'hand' + b.id, 0.5 );

							}

						} } );

				} );

			} ] ],
		onCancel: ( w, e, act ) => act.ctx.hands?.forEach( ( a ) => cancelArea( w, a ) ) } );

	} } );

// --- Miasma: clouds that swell, and a spit spiral of bile.
pattern( { id: 'miasma-burst', name: 'Miasma', tags: [ 'signature', 'miasma', 'chaos', 'area' ], range: [ 0, 99 ], los: false,
	build: ( world, b, o = {} ) => timeline( { id: 'miasma-burst', anim: 'cast_aoe', seconds: 2.2, steps: [ [ 0.5, ( w ) => {

		const t = tgt( w, b ), rng = aiRng( w ), n = o.count ?? 4 + phaseOf( b );
		for ( let i = 0; i < n; i ++ ) {

			const p = ringPoint( w, rng, t.x, t.z, i ? 2.5 : 0, i ? 7 : 0.5 );
			if ( ! p ) continue;
			const born = w.time;
			keep( b, w.area( b, { ...p, radius: 1.2, delay: 0.8, duration: 7, interval: 0.5, hitOnce: false, fx: 'poison', color: colorOf( 'chaos' ), element: 'chaos', data: { grows: true },
				hit: bh( b, 0.22, { element: 'chaos', ailments: { poison: 40 } } ),
				onTick( ww, a ) {

					a.radius = Math.min( 3.6, 1.2 + ( ww.time - born ) * 0.45 );

				} } ) );

		}

	} ] ] } ) } );

// --- Burrowing bosses (wyrms, serpents): dive, erupt under you three times.
pattern( { id: 'burrow-strike', name: 'Undermine', tags: [ 'generic', 'movement', 'area', 'serpent' ], range: [ 0, 99 ], los: false,
	build: ( world, b ) => timeline( { id: 'burrow-strike', anim: 'burrow', seconds: 4.4, steps: [
		[ 0.5, ( w ) => w.applyStatus( b, 'm-burrowed', { duration: 3.9 } ) ],
		...[ 1.3, 2.3, 3.2 ].map( ( t0, i ) => [ t0, ( w ) => {

			const t = tgt( w, b );
			const el = elementOf( b );
			telegraph( w, b, null, { x: t.x, z: t.z, radius: b.radius + 1.6, delay: 0.75, fx: 'erupt', element: el, hit: bh( b, 1.4 * hard( b ), { split: 0.5, knockback: 10 } ) } );
			if ( i === 2 ) teleport( b, t.x, t.z );

		} ] ),
		[ 4.0, ( w ) => w.removeStatus( b, 'm-burrowed' ) ] ] } ) } );

// --- hooks: keg detonation credit, keg deaths ---------------------------------------------------

hooks.hit.push( ( world, h ) => {

	if ( h.target.data.keg && h.source?.team === TEAM.PLAYER ) h.target.data.detonatedBy = h.source;

} );

hooks.death.push( ( world, d ) => {

	if ( d.entity.data.keg ) detonateKeg( world, d.entity );

} );

export function patternsFor( { tags = [], mechanics = [], none = [] } = {} ) {

	return all( 'bossPattern' ).filter( ( p ) => ! none.some( ( t ) => p.tags.includes( t ) ) &&
		( p.tags.includes( 'signature' ) ? mechanics.some( ( m ) => p.tags.includes( m ) ) : p.tags.some( ( t ) => t === 'generic' || tags.includes( t ) ) ) );

}
