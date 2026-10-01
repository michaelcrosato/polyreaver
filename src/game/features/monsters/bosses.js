// Boss framework. A boss is a big genome plus a SCRIPT made of data:
//
//   define( 'boss', {
//     id, name, title, depth, theme, mechanic, tags, level,
//     element, archetype (filler movement / ability pause), abilities: [ filler monsterAbility ids ],
//     genome: { plan, size (2.5-4), tags, palette },
//     stats: { life: × a normal monster, damage, speed, armor },
//     intro: { text, seconds },  enrage: seconds,  range: [ min, max ] preferred distance,
//     gap: [ min, max ] seconds between patterns,  affixes: [ ids ],  minion: family id,
//     phases: [ { at: life fraction, name, patterns: [ id | { id, ...opts } ], gap?, mods?,
//                 adds?: { family, count, every?, archetype?, rarity? }, onEnter?( world, boss, phase ) } ],
//     onSpawn?( world, boss ), update?( world, boss, dt, brain )     signature mechanics
//   } )
//
// The BossBrain runs it:  dormant → intro (name card, roar, invulnerable) → fight.
// In the fight a SEQUENCER plays the phase's patterns ( bossPattern defs ) in a
// shuffled order without immediate repeats, separated by gaps in which the boss
// repositions or uses filler abilities. Life thresholds trigger PHASE TRANSITIONS
// (roar, 'bossPhase' event, adds, new patterns); an ENRAGE timer makes long fights
// end. Bosses are unstoppable (no stun, no knockback) but their own patterns can
// leave them exposed - crashing into walls, standing in their own barrels.

import { define, get } from '../../core/registry.js';
import { Entity } from '../../core/entity.js';
import { TEAM, monsterScaling } from '../../core/tuning.js';
import { RNG } from '../../core/rng.js';
import { MONSTER_BASE } from '../../game.js';
import { generateGenome } from '../creatures/genome.js';
import { BASE_HIT, RARITY, applyAffixes, installHooks, spawnRng, spawnMonster, hooks, metricsOf } from './factory.js';
import { runAffixes, chooseAbility, useAbility, engage } from './brain.js';
import { moveTo, stop, retreatFrom } from './nav.js';
import { aiRng, ringPoint, edgeDist, RARITY_COLOR, cancelArea, telegraph, salt } from './util.js';

export function resolveBoss( boss ) {

	if ( boss && typeof boss === 'object' ) return boss;
	return boss ? get( 'boss', boss ) : null;

}

// --- spawning -------------------------------------------------------------------------

export function spawnBoss( world, bossDef, { x = 0, z = 0, level = world.level ?? 1, arena = null, dormant = true, rng = null } = {} ) {

	const def = resolveBoss( bossDef );
	if ( ! def ) return null;
	const r = rng || new RNG( spawnRng( world ).int( 1, 2 ** 31 - 1 ) );
	const g = def.genome || {};
	const genome = def.genomeData || generateGenome( r, { plan: g.plan || r.pick( g.plans || [ 'biped' ] ), size: g.size ?? 2.8, tags: [ ...( g.tags || [] ), 'boss', def.element ].filter( Boolean ), palette: g.palette, level } );
	const M = metricsOf( genome );
	const e = new Entity( { kind: 'boss', team: TEAM.ENEMY, level, x, z, radius: M.radius, height: M.height, mass: M.mass * 4 } );
	e.name = def.name;
	e.facing = Math.PI;

	const sc = monsterScaling( level );
	const St = def.stats || {};
	const S = e.stats;
	for ( const k in MONSTER_BASE ) S.base[ k ] = MONSTER_BASE[ k ];
	S.base.life = MONSTER_BASE.life * sc.life * ( St.life ?? 30 );
	S.base.armor = sc.armor * ( St.armor ?? 1.5 );
	S.base.move_speed = MONSTER_BASE.move_speed * ( St.speed ?? 1 ) * Math.max( 0.75, Math.min( 1.1, M.speedMul * 1.6 ) );
	S.base.damage_taken = 1;
	S.base.stun_threshold = 99;
	for ( const t of [ 'fire', 'cold', 'lightning', 'chaos' ] ) S.base[ 'res_' + t ] = sc.res + ( t === def.element ? 35 : 10 );
	const hit = ( St.damage ?? 1.5 ) * sc.damage;
	e.flags.unstoppable = true;
	e.tags.add( 'boss' );
	for ( const t of def.tags || [] ) e.tags.add( t );

	Object.assign( e.data, {
		damage: [ BASE_HIT[ 0 ] * hit, BASE_HIT[ 1 ] * hit ], bossId: def.id, title: def.title, rarity: 'boss', element: def.element || 'physical',
		plan: genome.plan, reach: M.reach, flying: M.flying, family: null, minionFamily: def.minion, archetype: def.archetype || 'brute',
		xp: 12 * sc.xp * ( St.xp ?? RARITY.boss.xp ), lootMult: RARITY.boss.loot * ( St.loot ?? 1 ),
		accel: 22, turnRate: 6, corpseTime: 8, abilities: [ ...( def.abilities || [ 'strike' ] ) ], affixes: [], affixState: {},
		arena: arena || { x, z, r: 12 }, persist: [], home: { x, z }, salt: r.int( 0, 65535 )
	} );
	e.model = { type: 'creature', genome, rarity: 'boss', glow: def.glow || RARITY_COLOR.boss, tint: def.tint || null, affixes: [], boss: true };
	applyAffixes( world, e, def.affixes || [] );
	e.controller = new BossBrain( world, e, def, dormant );
	installHooks( world );
	world.add( e );
	e.life = e.maxLife;
	def.onSpawn?.( world, e );
	return e;

}

// --- the brain -------------------------------------------------------------------------------

export class BossBrain {

	constructor( world, e, def, dormant ) {

		this.e = e;
		this.def = def;
		e.data.bossBrain = this;
		e.data.brain = this; // abilities / affixes look for data.brain.target
		this.arch = get( 'archetype', def.archetype || 'brute' ) || get( 'archetype', 'brute' );
		this.state = dormant ? 'dormant' : 'intro-pending';
		this.phase = - 1;
		this.phaseDef = null;
		this.queue = [];
		this.last = null;
		this.nextPattern = 0;
		this.nextAttack = 0;
		this.approachSince = 0;
		this.target = null;
		this.los = true;
		this.startedAt = 0;
		this.enraged = false;
		this.nextAdds = Infinity;
		this.abilities = null;
		this.strafeDir = 1;

	}

	update( world, e, dt ) {

		runAffixes( world, e, dt );
		if ( ! e.alive ) return;
		this.def.update?.( world, e, dt, this );
		const p = world.player;
		this.target = p && p.alive && ! p.flags.untargetable ? p : null;
		// the player's recent path (echo patterns replay it)
		if ( p && world.time - ( this.trailAt ?? - 1 ) > 0.25 ) {

			this.trailAt = world.time;
			const tr = e.data.trail || ( e.data.trail = [] );
			tr.push( { x: p.x, z: p.z, t: world.time } );
			if ( tr.length > 16 ) tr.shift();

		}
		switch ( this.state ) {

			case 'dormant': return this.dormant( world, e );
			case 'intro-pending': return this.beginIntro( world, e );
			case 'intro':
			case 'transition':
				stop( e );
				if ( ! e.action ) {

					e.flags.invulnerable = false;
					if ( this.state === 'intro' ) this.enterPhase( world, e, 0 );
					this.state = 'fight';

				}

				return;
			default: return this.fight( world, e, dt );

		}

	}

	dormant( world, e ) {

		stop( e );
		const p = this.target;
		if ( ! p ) return;
		const d = Math.hypot( p.x - e.x, p.z - e.z );
		if ( d < ( this.def.introRadius ?? 15 ) && world.layout.hasLineOfSight( e.x, e.z, p.x, p.z ) ) this.beginIntro( world, e );
		else if ( world.time - ( e.data.lastHitTime ?? - 99 ) < 0.2 ) this.beginIntro( world, e );

	}

	// The intro: name card ( 'bossIntro' event; the client shows it ), a roar, and
	// a moment of invulnerability so the player can read the arena before it starts.
	beginIntro( world, e ) {

		const intro = this.def.intro || {};
		const seconds = intro.seconds ?? 2.4;
		this.state = 'intro';
		e.flags.invulnerable = true;
		e.data.introAt = world.time;
		e.data.introSeconds = seconds;
		world.state.bossActive = e;
		world.act( e, { id: 'boss-intro', anim: intro.anim || 'roar', duration: seconds, speedStat: null, windup: 0.3, active: 0.8, cancelAt: 1, moveMult: 0, unstoppable: true }, { force: true, aimX: this.target?.x ?? e.x, aimZ: this.target?.z ?? e.z + 1 } );
		world.events.emit( 'bossIntro', { boss: e, name: e.name, title: e.data.title, text: intro.text || '', duration: seconds, x: e.x, z: e.z } );
		world.events.emit( 'objective', { text: `Defeat ${e.name}` } );
		world.events.emit( 'sfx', { id: 'boss-roar', x: e.x, z: e.z, volume: 1 } );
		world.events.emit( 'shake', { amount: 0.3 } );
		this.startedAt = world.time + seconds;

	}

	enterPhase( world, e, index ) {

		const phases = this.def.phases || [];
		const ph = phases[ index ];
		if ( ! ph ) return;
		this.phase = index;
		this.phaseDef = ph;
		e.data.phase = index;
		e.data.phaseName = ph.name || `Phase ${index + 1}`;
		this.queue = [];
		e.stats.setSource( 'boss-phase', ph.mods || ( index ? [ { stat: 'damage', type: 'more', value: 8 * index }, { stat: 'move_speed', type: 'more', value: 5 * index } ] : null ) );
		world.events.emit( 'bossPhase', { boss: e, phase: index, index, name: e.data.phaseName, total: phases.length, x: e.x, z: e.z } );
		if ( ph.adds ) {

			this.spawnAdds( world, e, ph.adds );
			this.nextAdds = ph.adds.every ? world.time + ph.adds.every : Infinity;

		} else this.nextAdds = Infinity;

		ph.onEnter?.( world, e, ph, this );
		this.nextPattern = world.time + ( index ? 1.0 : 0.6 );

	}

	// Phase transition: the boss roars (invulnerable, 1.6 s), sheds its current
	// pattern and comes back with the next phase's moves.
	transition( world, e, index ) {

		for ( const a of e.data.persist ) if ( a.alive && a.data?.endsWithPhase ) cancelArea( world, a );
		this.state = 'transition';
		e.forced = null;
		e.flags.invulnerable = true;
		world.act( e, { id: 'boss-phase', anim: 'roar', duration: 1.6, speedStat: null, windup: 0.3, active: 0.8, cancelAt: 1, moveMult: 0, unstoppable: true }, { force: true, aimX: this.target?.x ?? e.x, aimZ: this.target?.z ?? e.z } );
		world.events.emit( 'shake', { amount: 0.35 } );
		world.area( e, { x: e.x, z: e.z, radius: e.radius + 3, fx: 'shout', color: RARITY_COLOR.boss } );
		this.enterPhase( world, e, index );
		this.nextPattern = world.time + 2.2;

	}

	fight( world, e, dt ) {

		const t = this.target;
		const phases = this.def.phases || [];
		// phase thresholds (several at once if a huge hit skips one)
		let next = this.phase;
		while ( phases[ next + 1 ] && e.lifeFrac <= phases[ next + 1 ].at ) next ++;
		if ( next !== this.phase ) return this.transition( world, e, next );

		// enrage: long fights end
		const enrage = this.def.enrage ?? 180;
		if ( ! this.enraged && world.time - this.startedAt > enrage ) {

			this.enraged = true;
			e.data.enraged = true;
			world.applyStatus( e, 'm-enraged', { duration: 9999, source: e } );
			if ( e.model ) e.model.glow = '#ff2020';
			world.events.emit( 'bossEnrage', { boss: e, x: e.x, z: e.z } );
			world.events.emit( 'objective', { text: `${e.name} is enraged!` } );

		}

		// timed add waves
		if ( world.time >= this.nextAdds && this.phaseDef?.adds ) {

			this.spawnAdds( world, e, this.phaseDef.adds );
			this.nextAdds = world.time + this.phaseDef.adds.every;

		}

		if ( ! t || e.flags.stunned || e.flags.frozen ) return stop( e );
		e.anim.aimX = t.x; e.anim.aimZ = t.z;
		if ( e.action ) {

			if ( e.action.def.chase ) moveTo( world, e, t.x, t.z, 1, true );
			else if ( ! e.forced ) stop( e );
			return;

		}

		if ( e.forced ) return;
		if ( world.frame % 12 === salt( e ) % 12 ) this.los = world.layout.hasLineOfSight( e.x, e.z, t.x, t.z );
		const d = edgeDist( e, t );

		// the sequencer: next pattern when its gap has passed (walk into range first)
		if ( world.time >= this.nextPattern ) {

			const pick = this.peek( world );
			const pat = pick && get( 'bossPattern', pick.id );
			if ( pat ) {

				const [ lo, hi ] = pat.range || [ 0, 99 ];
				const inRange = d >= lo && d <= hi && ( this.los || pat.los === false );
				if ( ! this.approachSince ) this.approachSince = world.time;
				if ( inRange || world.time - this.approachSince > 2.5 ) {

					this.approachSince = 0;
					return this.play( world, e, pat, pick );

				}

				if ( d > hi || ! this.los ) return moveTo( world, e, t.x, t.z, 1, true );
				return retreatFrom( world, e, t, 0.8, this.strafeDir );

			}

		}

		// between patterns: filler abilities and positioning
		if ( world.time >= this.nextAttack ) {

			const ab = chooseAbility( world, e, this, t, d );
			if ( ab && useAbility( world, e, this, ab, t ) ) {

				this.nextPattern = Math.max( this.nextPattern, world.time + ( e.action?.duration ?? 0.8 ) + 0.3 );
				return;

			}

		}

		const [ r0, r1 ] = this.def.range || [ 0, 3 ];
		if ( d > r1 ) moveTo( world, e, t.x, t.z, 0.9, true );
		else if ( d < r0 ) retreatFrom( world, e, t, 0.7, this.strafeDir );
		else stop( e );

	}

	// Shuffled bag per phase, no immediate repeats. Patterns with a ready() gate
	// (summons while the arena is already full, pylons while pylons stand) wait
	// at the back of the bag.
	peek( world ) {

		if ( ! this.queue.length ) {

			const list = ( this.phaseDef?.patterns || [] ).map( ( p ) => typeof p === 'string' ? { id: p } : p );
			this.queue = aiRng( world ).shuffle( list.slice() );
			if ( this.queue.length > 1 && this.queue[ 0 ].id === this.last ) this.queue.push( this.queue.shift() );

		}

		for ( let i = 0; i < this.queue.length; i ++ ) {

			const pick = this.queue[ 0 ];
			const pat = get( 'bossPattern', pick.id );
			if ( ! pat?.ready || pat.ready( world, this.e, pick, this ) ) return pick;
			this.queue.push( this.queue.shift() );

		}

		return null;

	}

	play( world, e, pat, opts ) {

		this.queue.shift();
		this.last = pat.id;
		const def = pat.build( world, e, opts, this );
		const act = def && world.act( e, def, { force: true, target: this.target, aimX: this.target?.x, aimZ: this.target?.z } );
		const [ g0, g1 ] = this.phaseDef?.gap || this.def.gap || [ 1.1, 1.9 ];
		const gap = ( g0 + aiRng( world ).next() * ( g1 - g0 ) ) * ( this.enraged ? 0.6 : 1 );
		this.nextPattern = world.time + ( act?.duration ?? 1 ) + gap;
		this.nextAttack = world.time + ( act?.duration ?? 1 ) + gap * 0.4;
		world.events.emit( 'bossPattern', { boss: e, pattern: pat.id, name: pat.name, x: e.x, z: e.z } );

	}

	// Adds come in at the arena's edge with a spawn telegraph, already hunting you.
	spawnAdds( world, e, adds ) {

		const count = Math.min( 12, ( adds.count ?? 3 ) + ( adds.perPhase ?? 0 ) * this.phase );
		const fam = adds.family || this.def.minion;
		if ( ! fam ) return [];
		const A = e.data.arena, rng = aiRng( world );
		const out = [];
		for ( let i = 0; i < count; i ++ ) {

			const p = ringPoint( world, rng, A.x, A.z, A.r * 0.55, A.r * 0.95 ) || ringPoint( world, rng, e.x, e.z, 3, 7 );
			if ( ! p ) continue;
			telegraph( world, e, null, { x: p.x, z: p.z, radius: 1, delay: 0.6, fx: 'summon' } );
			const m = spawnMonster( world, { family: fam, archetype: adds.archetype, level: e.level, rarity: adds.rarity || 'normal', x: p.x, z: p.z, summoned: true, minions: 0 } );
			if ( ! m ) continue;
			m.tags.add( 'boss-add' );
			m.data.summoner = e;
			m.data.spawnUntil = world.time + 0.6;
			if ( this.target && m.data.brain ) engage( world, m, m.data.brain, this.target, false );
			out.push( m );

		}

		if ( out.length ) world.events.emit( 'summon', { entity: e, minions: out, x: e.x, z: e.z } );
		return out;

	}

}

define( 'controller', { id: 'boss', create: ( game, e ) => e.data.bossBrain || null } );

// Boss death: lingering boss effects end, adds crumble, the arena calms down.
hooks.death.push( ( world, d ) => {

	const e = d.entity;
	if ( e.kind !== 'boss' ) return;
	for ( const a of e.data.persist || [] ) cancelArea( world, a );
	for ( const m of world.entities ) if ( m.alive && m.data.summoner === e ) world.kill( m, null );
	if ( world.state.bossActive === e ) world.state.bossActive = null;
	world.events.emit( 'shake', { amount: 0.5 } );
	world.events.emit( 'objective', { text: `${e.name} has fallen` } );

} );

// Plain summary for the agent API and the boss bar.
export function describeBoss( def ) {

	const b = resolveBoss( def );
	if ( ! b ) return null;
	return {
		id: b.id, name: b.name, title: b.title, depth: b.depth, theme: b.theme, mechanic: b.mechanic, element: b.element, procedural: !! b.procedural,
		genome: { plan: b.genome?.plan, size: b.genome?.size, tags: b.genome?.tags }, stats: b.stats, enrage: b.enrage, affixes: b.affixes || [],
		phases: ( b.phases || [] ).map( ( p ) => ( { at: p.at, name: p.name, patterns: p.patterns.map( ( x ) => typeof x === 'string' ? x : x.id ), adds: p.adds ? { family: p.adds.family || b.minion, count: p.adds.count, every: p.adds.every } : null } ) ),
		desc: b.desc
	};

}
