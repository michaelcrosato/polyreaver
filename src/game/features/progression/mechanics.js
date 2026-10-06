// The mechanics runtime: what makes uniques, keystones and ascendancy notables DO
// things. One instance lives in each world ( world.state.prog ). It
//
//   * keeps the list of active PROVIDERS (defs with `hooks`) in sync with the save,
//   * turns world events into hook calls:
//       hit / crit       your hits (procs excluded, so effects never loop)
//       struck           you were hit           kill     an enemy died to you
//       dodge evade block action flask pickup   manaSpent( amount )    tick( dt )
//   * sets the CONDITION FLAGS that `when` modifiers read (see FLAGS below),
//   * runs timed BUFFS (stat sources 'prog-buff:<key>') and delayed callbacks,
//   * applies generic stats that need events: thorns, life / mana on kill.
//
// Hooks receive a ctx (one per provider per world) with helpers - see makeCtx().

import { define } from '../../core/registry.js';
import { TEAM } from '../../core/tuning.js';
import { activeProviders } from './stats.js';
import { ensureSave } from './save.js';

// condition flags -> how they are decided (docs for `when` mods; text in text.js)
export const FLAGS = {
	moving: 'ground speed above 0.5 m/s', stationary: 'not moving', low_life: 'life below 35% (keystones can raise it)',
	full_life: 'life at maximum', low_mana: 'mana below 35%', full_shield: 'energy shield at maximum (and above 0)',
	killed_recently: 'killed an enemy in the last 4 s', crit_recently: 'dealt a critical strike in the last 4 s',
	hit_recently: 'took a hit in the last 4 s', not_hit_recently: 'no hit taken for 4 s', dodged_recently: 'dodge-rolled in the last 2 s',
	blocked_recently: 'blocked in the last 4 s', flask_active: 'any flask effect running', near_enemy: 'an enemy within 5 m',
	no_enemy_near: 'no enemy within 5 m', in_town: 'in the town hub'
};

const RECENT = 4;

// Level-scaled proc damage: what "ctx.dmg( 1 )" is worth at character level L.
export function procBase( level ) {

	return ( 6 + level * 2.5 ) * Math.pow( 1.035, level );

}

export function runtime( world ) {

	return world.state.prog;

}

export function installMechanics( game, world ) {

	const rt = {
		game, world, providers: [], stamp: '', ctx: new Map(), states: new Map(), buffs: new Map(), later: [],
		lastKill: - 99, lastCrit: - 99, lastDodge: - 99, lastBlock: - 99, nearCheck: 0, near: false, flasks: []
	};
	world.state.prog = rt;
	const E = world.events;
	const isPlayer = ( e ) => e && e === world.player;

	E.on( 'hit', ( ev ) => {

		const p = world.player;
		if ( ! p ) return;
		if ( ev.source === p ) {

			if ( ( ev.tags || [] ).includes( 'proc' ) ) return;
			if ( ev.total > ( game.save.lifetime?.highestHit ?? 0 ) && game.save.lifetime ) game.save.lifetime.highestHit = Math.round( ev.total );
			dispatch( rt, 'hit', ev );
			if ( ev.crit ) {

				rt.lastCrit = world.time;
				dispatch( rt, 'crit', ev );

			}

		} else if ( ev.target === p && ev.total > 0 ) {

			dispatch( rt, 'struck', ev );
			const thorns = p.stats.get( 'thorns' );
			if ( thorns > 0 && ev.source?.alive && ( ev.tags || [] ).includes( 'melee' ) ) strike( rt, null, ev.source, thorns, 'physical' );

		}

	} );

	E.on( 'death', ( ev ) => {

		const p = world.player, e = ev.entity;
		if ( ! p || e.team !== TEAM.ENEMY || ! killedByPlayer( ev, p ) ) return;
		rt.lastKill = world.time;
		const S = p.stats;
		if ( p.alive ) {

			p.life = Math.min( p.maxLife, p.life + S.get( 'life_on_kill' ) );
			p.mana = Math.min( p.maxMana, p.mana + S.get( 'mana_on_kill' ) );

		}

		dispatch( rt, 'kill', ev );

	} );

	E.on( 'status', ( ev ) => {

		// remember when ailments were applied: world.kill() clears statuses before
		// 'death' fires, so "ignited enemies explode on death" needs this memory
		const e = ev.entity;
		if ( e && e.team === TEAM.ENEMY ) ( e.data.progAil ||= {} )[ ev.id ] = world.time;

	} );

	E.on( 'dodge', ( ev ) => {

		if ( ! isPlayer( ev.entity ) ) return;
		rt.lastDodge = world.time;
		dispatch( rt, 'dodge', ev );

	} );
	E.on( 'evade', ( ev ) => isPlayer( ev.target ) && dispatch( rt, 'evade', ev ) );
	E.on( 'block', ( ev ) => {

		if ( ! isPlayer( ev.target ) ) return;
		rt.lastBlock = world.time;
		dispatch( rt, 'block', ev );

	} );
	E.on( 'action', ( ev ) => isPlayer( ev.entity ) && dispatch( rt, 'action', ev ) );
	E.on( 'manaSpent', ( ev ) => {

		if ( ! isPlayer( ev.entity ) || ! ( ev.amount > 0 ) ) return;
		refreshProviders( rt );
		dispatch( rt, 'manaSpent', ev.amount );

	} );
	E.on( 'flask', ( ev ) => isPlayer( ev.entity ) && dispatch( rt, 'flask', ev ) );
	E.on( 'pickup', ( ev ) => dispatch( rt, 'pickup', ev ) );
	refreshProviders( rt );
	return rt;

}

export function killedByPlayer( ev, p ) {

	const k = ev.killer;
	return k === p || k?.data?.owner === p || k?.team === TEAM.PLAYER || ev.entity.data.lastHitBy === p.id;

}

// Re-read the providers when gear or the tree changed (cheap signature check).
export function refreshProviders( rt ) {

	const save = ensureSave( rt.game.save );
	const eq = save.equipment;
	const stamp = Object.values( eq ).map( ( i ) => i ? i.uid + ':' + i.rev : '-' ).join( ',' ) + '|' + save.tree.allocated.length + '|' + save.tree.allocated.at( - 1 ) + '|' + save.tree.asc.allocated.length + '|' + save.level;
	if ( stamp === rt.stamp ) return;
	rt.stamp = stamp;
	const disabled = rt.world.player?.data.progBuild?.disabled ?? new Set();
	const next = activeProviders( save, eq, disabled ).filter( ( p ) => p.def.hooks );
	const keys = new Set( next.map( ( p ) => p.key ) );
	for ( const old of rt.providers ) if ( ! keys.has( old.key ) ) {

		old.def.hooks.end?.( rt.ctx.get( old.key ) );
		rt.ctx.delete( old.key );

	}

	for ( const p of next ) if ( ! rt.ctx.has( p.key ) ) {

		if ( ! rt.states.has( p.key ) ) rt.states.set( p.key, {} );
		rt.ctx.set( p.key, makeCtx( rt, p ) );
		p.def.hooks.start?.( rt.ctx.get( p.key ) );

	}

	rt.providers = next;

}

function dispatch( rt, name, ev ) {

	for ( const p of rt.providers ) {

		const fn = p.def.hooks[ name ];
		if ( ! fn ) continue;
		try {

			fn( rt.ctx.get( p.key ), ev );

		} catch ( e ) {

			console.error( `progression hook ${p.key}.${name}:`, e );

		}

	}

}

// Damage after mitigation, straight to life (echoes, reflected damage, executions).
function strike( rt, def, target, amount, type ) {

	const w = rt.world, p = w.player;
	if ( ! target?.alive || ! ( amount > 0 ) || target.flags.invulnerable ) return;
	let toLife = amount;
	if ( target.shield > 0 ) {

		const a = Math.min( target.shield, amount );
		target.shield -= a;
		toLife -= a;

	}

	target.life -= toLife;
	target.anim.hitTime = w.time;
	if ( p ) target.data.lastHitBy = p.id;
	const killed = target.life <= 0;
	w.events.emit( 'hit', { source: p, target, total: amount, byType: { [ type ]: amount }, crit: false, killed, x: target.x, z: target.z, skill: def?.id ?? 'thorns', tags: [ 'proc', type ] } );
	if ( killed ) w.kill( target, p, { tags: [ 'proc' ] } );

}

function procHit( rt, def, damage, o, tags ) {

	const dmg = {};
	for ( const k in damage ) dmg[ k ] = [ damage[ k ] * 0.9, damage[ k ] * 1.1 ];
	return {
		damage: dmg, tags: [ 'proc', ...tags, ...( o.tags || [] ) ], addFlat: false, canCrit: false, noLeech: true, canEvade: false, canBlock: false,
		knockback: o.knockback ?? 0, ailments: o.ailments, skill: def.id
	};

}

// The helper object every hook receives.
function makeCtx( rt, prov ) {

	const w = rt.world, def = prov.def;
	const ctx = {
		game: rt.game, world: w, def, source: prov.source, key: prov.key, state: rt.states.get( prov.key ),
		get player() {

			return w.player;

		},
		// level-scaled damage number for procs ("deals 2x" -> ctx.dmg( 2 ))
		dmg: ( mult = 1 ) => mult * procBase( rt.game.save.level ),
		nova( x, z, radius, damage, o = {} ) {

			return w.area( w.player, { x, z, radius, delay: o.delay ?? 0, duration: o.duration ?? 0, interval: o.interval ?? 0.5,
				hit: procHit( rt, def, damage, o, [ 'area' ] ), fx: o.fx || 'nova', color: o.color, element: o.element } );

		},
		wave( x, z, dir, length, width, damage, o = {} ) {

			return w.area( w.player, { x, z, dir, shape: 'line', length, width, radius: length, delay: o.delay ?? 0, duration: o.duration ?? 0,
				hit: procHit( rt, def, damage, o, [ 'area' ] ), fx: o.fx || 'wave', color: o.color, element: o.element } );

		},
		bolt( x, z, dir, damage, o = {} ) {

			const raw = o.raw;
			return w.projectile( w.player, { x, z, dir, speed: o.speed ?? 24, range: o.range ?? 14, radius: o.radius ?? 0.35, chain: o.chain ?? 0,
				pierce: o.pierce ?? 0, homing: o.homing ?? 0, fx: o.fx || 'bolt', color: o.color, element: o.element,
				hit: raw ? null : procHit( rt, def, damage, o, [ 'projectile' ] ),
				onHit: raw ? ( world, pr, target ) => strike( rt, def, target, Object.values( damage ).reduce( ( a, b ) => a + b, 0 ), Object.keys( damage )[ 0 ] ) : null } );

		},
		strike: ( target, amount, type = 'physical' ) => strike( rt, def, target, amount, type ),
		heal( n ) {

			const p = w.player;
			if ( p?.alive && n > 0 ) p.life = Math.min( p.maxLife, p.life + n );

		},
		restoreMana( n ) {

			const p = w.player;
			if ( p?.alive && n > 0 ) p.mana = Math.min( p.maxMana, p.mana + n );

		},
		enemies: ( x, z, r ) => w.enemiesOf( w.player, x, z, r ),
		nearestEnemy: ( x, z, r, exclude = null ) => w.spatial.nearest( x, z, r, ( e ) => e !== exclude && e.alive && e.team === TEAM.ENEMY && ! e.flags.untargetable ),
		ailing: ( e, id, window = RECENT ) => !! e && ( e.statuses?.has( id ) || w.time - ( e.data.progAil?.[ id ] ?? - 99 ) < window ),
		cooldown( key, seconds ) {

			const k = '_cd_' + key;
			if ( w.time < ( ctx.state[ k ] ?? - 1 ) ) return false;
			ctx.state[ k ] = w.time + seconds;
			return true;

		},
		counter( key, n ) {

			const k = '_n_' + key;
			ctx.state[ k ] = ( ctx.state[ k ] ?? 0 ) + 1;
			if ( ctx.state[ k ] < n ) return false;
			ctx.state[ k ] = 0;
			return true;

		},
		buff: ( key, seconds, mods, opts = {} ) => setBuff( rt, key, seconds, mods, { ...opts, name: opts.name || def.name } ),
		later( delay, fn ) {

			rt.later.push( { t: w.time + delay, fn } );

		},
		fx( id, data = {} ) {

			w.events.emit( 'mechanic', { id, source: def.id, ...data } );

		}
	};
	return ctx;

}

// Timed stat buffs. Re-applying refreshes the duration and replaces the mods.
export function setBuff( rt, key, seconds, mods, opts = {} ) {

	const p = rt.world.player;
	if ( ! p ) return;
	const prev = rt.buffs.get( key );
	if ( ! mods || ! mods.length ) {

		if ( prev ) endBuff( rt, key );
		return;

	}

	rt.buffs.set( key, { key, until: rt.world.time + seconds, total: seconds, mods, ...opts } );
	p.stats.setSource( 'prog-buff:' + key, mods.map( ( m ) => ( { ...m, from: opts.name || key } ) ) );
	if ( opts.ghost ) p.flags.ghost = true;

}

function endBuff( rt, key ) {

	const b = rt.buffs.get( key );
	rt.buffs.delete( key );
	const p = rt.world.player;
	if ( p ) {

		p.stats.setSource( 'prog-buff:' + key, null );
		if ( b?.ghost && ! [ ...rt.buffs.values() ].some( ( x ) => x.ghost ) ) p.flags.ghost = false;

	}

	b?.onEnd?.();

}

// --- the per-step system ---------------------------------------------------------------------------------

function updateMechanics( world, dt ) {

	const rt = world.state.prog, p = world.player;
	if ( ! rt || ! p ) return;
	const t = world.time;
	if ( world.frame % 15 === 0 ) refreshProviders( rt );

	// lifetime clock
	const life = rt.game.save.lifetime;
	if ( life ) life.playTime = ( life.playTime ?? 0 ) + dt;

	if ( ! p.alive ) return;

	// condition flags for `when` modifiers
	const S = p.stats;
	const speed = Math.hypot( p.vx, p.vz );
	if ( world.frame % 6 === 0 ) rt.near = !! world.spatial.nearest( p.x, p.z, 5, ( e ) => e.alive && e.team === TEAM.ENEMY && ! e.flags.untargetable );
	const maxL = p.maxLife, maxM = p.maxMana, maxS = S.get( 'shield' );
	S.setFlag( 'moving', speed > 0.5 );
	S.setFlag( 'stationary', speed <= 0.5 );
	S.setFlag( 'low_life', p.life < maxL * ( p.data.lowLifeAt ?? 0.35 ) );
	S.setFlag( 'full_life', p.life >= maxL - 0.5 );
	S.setFlag( 'low_mana', p.mana < maxM * 0.35 );
	S.setFlag( 'full_shield', maxS > 0 && p.shield >= maxS - 0.5 );
	S.setFlag( 'killed_recently', t - rt.lastKill < RECENT );
	S.setFlag( 'crit_recently', t - rt.lastCrit < RECENT );
	const hit = t - ( p.data.lastHitTime ?? - 99 ) < RECENT;
	S.setFlag( 'hit_recently', hit );
	S.setFlag( 'not_hit_recently', ! hit );
	S.setFlag( 'dodged_recently', t - rt.lastDodge < 2 );
	S.setFlag( 'blocked_recently', t - rt.lastBlock < RECENT );
	S.setFlag( 'flask_active', rt.flasks.length > 0 );
	S.setFlag( 'near_enemy', rt.near );
	S.setFlag( 'no_enemy_near', ! rt.near );
	S.setFlag( 'in_town', world.kind === 'town' );

	// buffs and delayed callbacks
	for ( const b of [ ...rt.buffs.values() ] ) if ( t >= b.until ) endBuff( rt, b.key );
	if ( rt.later.length ) {

		const due = rt.later.filter( ( l ) => t >= l.t );
		rt.later = rt.later.filter( ( l ) => t < l.t );
		for ( const l of due ) l.fn();

	}

	for ( const prov of rt.providers ) {

		const fn = prov.def.hooks.tick;
		if ( fn ) fn( rt.ctx.get( prov.key ), dt );

	}

}

define( 'system', { id: 'prog-mechanics', order: 45, update: updateMechanics } );
