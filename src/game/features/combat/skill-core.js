// Skill system core: the loadout, the SKILL CONTEXT (one cast with its supports
// applied), the damage math shared by casting and tooltips, and small helpers the
// skill content uses to build action timelines.
//
// How supports reach a skill without special cases: every skill's hits and action
// carry a private tag 'sk:<skillId>'. A statSource ('combat-supports' in sim.js)
// turns each socketed support into ordinary stat modifiers tagged with that skill
// tag, e.g. Faster Attacks on Cleave = { stat: 'attack_speed', type: 'inc', value: 30,
// tags: [ 'sk:cleave' ] }. The stat engine only applies a tagged modifier to queries
// that carry all of its tags, so the bonus reaches Cleave's hits, Cleave's swing speed
// and Cleave's area - and nothing else. Behavioural supports (fork, echo, conversion,
// proliferation...) use transform( ctx ) on the context instead.
//
// A SKILL def (registry kind 'skill', docs/GAME.md §6):
//   id, name, tags [ 'attack'|'spell', 'melee'|'projectile'|'area'|'movement'|'buff'|'minion', element, 'channel'? ]
//   element      'physical' | 'fire' | 'cold' | 'lightning' | 'chaos' (VFX colour, icon)
//   icon         glyph id for the procedural HUD icon
//   manaCost     base cost at level 1 (scaled by level), or ( level ) => cost
//   cooldown     seconds (0 = none);   levelReq;   weapon?: [ weapon classes ]
//   time         base action duration (seconds at 100% attack / cast speed) - tooltips use it
//   reach        melee reach (aim assist + lunge), range: max target distance for ground targets
//   combo        n: the skill cycles variants 0..n-1 while chained (basic attack)
//   hits         { name: ( level, ctx ) => HIT SPEC } - damage the skill deals (tooltips list them)
//   action( level, ctx ) -> action def (core/actions.js) - built per cast
//   canCast?( world, e, ctx ) -> false to refuse (no target...) before mana is spent
//   desc, info?( level, ctx ) -> [ extra tooltip lines ]
//
// HIT SPEC: { physical|fire|cold|lightning|chaos: [ min, max ], eff (damage effectiveness),
//   crit (spell base crit %), addedEff (share of flat added damage, default 1 for attacks,
//   0.5 for spells), added: false (ignore added damage), knockback, stun, ailments, label }

import { get, all } from '../../core/registry.js';
import { DAMAGE_TYPES } from '../../core/stats.js';
import { Entity } from '../../core/entity.js';
import { TEAM } from '../../core/tuning.js';
import { schedule } from './timers.js';

// Bar slot i is driven by input action SLOT_ACTIONS[ i ] (LMB, RMB, 1-4).
export const SLOT_ACTIONS = [ 'attack', 'skill1', 'skill2', 'skill3', 'skill4', 'skill5' ];

// Used when the save has no (or a malformed) skills field: progression owns the real one.
export const DEFAULT_LOADOUT = {
	known: [ 'slash', 'ground-slam', 'fireball', 'leap-slam', 'frost-nova', 'war-cry', 'cleave', 'ice-spear', 'arc', 'blink' ],
	bar: [ 'slash', 'ground-slam', 'fireball', 'leap-slam', 'frost-nova', 'war-cry' ],
	supports: {},
	levels: {}
};

const COMBO_GRACE = 0.45; // seconds after a combo step ends during which the next step continues the chain
const ASSIST_EXTRA = 2.4; // metres beyond reach that melee aim assist (and the lunge) will close

// --- level scaling (1..20 for the campaign, unbounded for endless depths) ---------------

// spells: ~11x at level 20, ~130x at 40 - in step with monster life (core/tuning.js)
export const spellScale = ( lv ) => Math.pow( 1.12, lv - 1 ) * ( 1 + 0.015 * ( lv - 1 ) );
// attacks scale the weapon: a gentle effectiveness ramp, the weapon tiers do the rest
export const attackScale = ( lv ) => 1 + 0.035 * ( lv - 1 );
export const costScale = ( lv ) => 1 + 0.07 * ( lv - 1 );

// --- loadout -----------------------------------------------------------------------------

// Read game.save.skills defensively: any missing or malformed part falls back to the
// default, unknown skill ids become empty slots.
export function readLoadout( save ) {

	const s = save && typeof save.skills === 'object' && save.skills ? save.skills : null;
	const bar = s && Array.isArray( s.bar ) ? s.bar : DEFAULT_LOADOUT.bar;
	return {
		known: s && Array.isArray( s.known ) ? s.known : DEFAULT_LOADOUT.known,
		bar: [ 0, 1, 2, 3, 4, 5 ].map( ( i ) => ( typeof bar[ i ] === 'string' && get( 'skill', bar[ i ] ) ? bar[ i ] : null ) ),
		supports: s && s.supports && typeof s.supports === 'object' ? s.supports : {},
		levels: s && s.levels && typeof s.levels === 'object' ? s.levels : {}
	};

}

export function skillLevel( loadout, id, e = null ) {

	const base = Math.max( 1, Math.floor( + loadout.levels[ id ] || 1 ) );
	const skill = get( 'skill', id );
	// '+N to level of <tag> skills' gear: flat 'skill_level' mods, optionally tagged
	const bonus = e && skill ? Math.floor( e.stats.get( 'skill_level', skill.tags ) ) : 0;
	return base + Math.max( 0, bonus );

}

export function supportList( loadout, id ) {

	const list = loadout.supports[ id ];
	return Array.isArray( list ) ? list.filter( ( s ) => typeof s === 'string' ) : [];

}

// A support fits a skill when the skill has ANY of the support's tags (plus the skill's
// own `supports` extra tags) and NONE of its `excludes`.
export function compatible( support, skill ) {

	if ( ! support || ! skill ) return false;
	const tags = skill.supports ? skill.tags.concat( skill.supports ) : skill.tags;
	if ( support.excludes && support.excludes.some( ( t ) => tags.includes( t ) ) ) return false;
	return support.tags.some( ( t ) => tags.includes( t ) );

}

// Supports that can go on a skill (the progression UI lists these).
export function supportsFor( skillId ) {

	const skill = get( 'skill', skillId );
	return all( 'support' ).filter( ( s ) => compatible( s, skill ) );

}

// Stat modifiers from every socketed support, tagged with their skill's private tag.
export function supportMods( loadout ) {

	const out = [];
	for ( const skillId of Object.keys( loadout.supports ) ) {

		const skill = get( 'skill', skillId );
		if ( ! skill ) continue;
		const lv = skillLevel( loadout, skillId, null );
		for ( const sid of supportList( loadout, skillId ) ) {

			const sup = get( 'support', sid );
			if ( ! compatible( sup, skill ) ) continue;
			const mods = typeof sup.mods === 'function' ? sup.mods( lv, skill ) : sup.mods || [];
			for ( const m of mods ) out.push( { ...m, tags: [ 'sk:' + skillId, ...( m.tags || [] ) ], text: m.text } );

		}

	}

	return out;

}

// --- skill context -------------------------------------------------------------------

// One cast (or one tooltip preview) of a skill: level, supports, the numbers the
// action builder needs (radius multiplier, projectile count...) and hit builders.
export function makeContext( world, e, skill, level, supportIds = [], { preview = false } = {} ) {

	const S = e.stats;
	const tags = skill.tags.concat( 'sk:' + skill.id );
	const supports = supportIds.map( ( id ) => get( 'support', id ) ).filter( ( s ) => compatible( s, skill ) );
	const area = Math.max( 0.1, S.get( 'area', tags ) || 1 );
	const ctx = {
		world, e, skill, id: skill.id, level, tags, supports, stats: S, preview,
		isAttack: skill.tags.includes( 'attack' ),
		element: skill.element ?? 'physical',
		area, radius: Math.sqrt( area ), // area is a multiplier on AREA, so radii grow with its square root
		projectiles: ( skill.projectiles ?? 1 ) + Math.round( S.get( 'projectile_count', tags ) ),
		pierce: Math.round( S.get( 'pierce', tags ) ),
		chain: Math.round( S.get( 'chain', tags ) ),
		projSpeed: S.get( 'projectile_speed', tags ) || 1,
		duration: S.get( 'duration', tags ) || 1,
		knockback: 0, stun: 0, fork: 0, repeats: 0, prolif: 0, splash: 0, cull: 0, ruthless: false, heavy: false,
		conversions: skill.convert ? [ { ...skill.convert } ] : [], ailments: {}, onHit: [],
		dmgMult: 1, manaMult: 1, variant: 0, target: null, gap: 0
	};
	for ( const sup of supports ) {

		ctx.manaMult *= sup.manaMult ?? 1;
		sup.transform?.( ctx );

	}

	// a conversion of half or more changes the visual element too
	for ( const c of ctx.conversions ) if ( c.from === ctx.element && c.pct >= 0.5 ) ctx.element = c.to;

	const base = typeof skill.manaCost === 'function' ? skill.manaCost( level ) : ( skill.manaCost ?? 0 ) * costScale( level );
	const mc = S.breakdown( 'mana_cost', tags, false );
	ctx.manaCost = Math.max( 0, Math.round( ( base * ctx.manaMult + mc.flat ) * Math.max( 0, 1 + mc.inc / 100 ) * mc.more ) );
	ctx.cooldown = ( skill.cooldown ?? 0 ) / Math.max( 0.1, S.get( 'cooldown_recovery', tags ) || 1 );
	// melee root motion: the full `base` step when swinging at air; with an assisted
	// target, exactly the gap to the ideal distance plus a small step of weight - so a
	// 3x attack speed build does not bulldoze forward through its target
	ctx.lungeDist = ( base ) => ( ctx.target ? Math.min( base, 0.2 ) + ctx.gap : base );
	ctx.hit = ( name, extra ) => buildHit( ctx, name, extra );
	ctx.ranges = ( name ) => damageRanges( ctx, specOf( ctx, name ) );
	return ctx;

}

function specOf( ctx, name = 'main' ) {

	const fn = ctx.skill.hits?.[ name ];
	return fn ? fn( ctx.level, ctx ) : {};

}

// Pre-mitigation damage ranges per type for one hit spec: base + flat added damage
// (attacks: all of it - weapon damage is flat added physical; spells: gear and tree
// additions only, not the unarmed base) x effectiveness, then conversions.
export function damageRanges( ctx, spec ) {

	const S = ctx.stats, out = {};
	const eff = ( spec.eff ?? 1 ) * ( ctx.isAttack ? attackScale( ctx.level ) : 1 ) * ctx.dmgMult;
	const addEff = spec.addedEff ?? ( ctx.isAttack ? 1 : 0.5 );
	for ( const type of DAMAGE_TYPES ) {

		const b = spec[ type ];
		let lo = Array.isArray( b ) ? b[ 0 ] : b ?? 0;
		let hi = Array.isArray( b ) ? b[ 1 ] : b ?? 0;
		if ( spec.added !== false ) {

			let amin = S.get( `added_${type}_min`, ctx.tags ), amax = S.get( `added_${type}_max`, ctx.tags );
			if ( ! ctx.isAttack ) {

				amin -= S.base[ `added_${type}_min` ] ?? 0;
				amax -= S.base[ `added_${type}_max` ] ?? 0;

			}

			lo += Math.max( 0, amin ) * addEff;
			hi += Math.max( 0, amax ) * addEff;

		}

		if ( hi > 0 ) out[ type ] = [ lo * eff, Math.max( lo, hi ) * eff ];

	}

	for ( const c of ctx.conversions ) {

		const src = out[ c.from ];
		if ( ! src ) continue;
		const dst = out[ c.to ] || ( out[ c.to ] = [ 0, 0 ] );
		for ( let k = 0; k < 2; k ++ ) {

			const moved = src[ k ] * c.pct;
			src[ k ] -= moved;
			dst[ k ] += moved;

		}

		if ( src[ 1 ] <= 1e-6 ) delete out[ c.from ];

	}

	return out;

}

// A HIT TEMPLATE (core/combat.js) for one of the skill's hit specs, with the context's
// supports folded in. Flat added damage is already inside `damage`, so addFlat is off.
function buildHit( ctx, name = 'main', extra = {} ) {

	const spec = specOf( ctx, name );
	const ailments = { ...spec.ailments };
	for ( const k in ctx.ailments ) ailments[ k ] = ( ailments[ k ] ?? 0 ) + ctx.ailments[ k ];
	const hooks = ctx.onHit.concat( spec.onHit || [], extra.onHit || [] );
	const hit = {
		damage: damageRanges( ctx, spec ),
		tags: extra.tags ? ctx.tags.concat( extra.tags ) : ctx.tags,
		addFlat: false, skill: ctx.id, critChance: spec.crit,
		knockback: ( spec.knockback ?? 0 ) + ctx.knockback,
		stun: ( spec.stun ?? 0 ) + ctx.stun || undefined,
		ailments, allowZero: spec.allowZero
	};
	if ( extra.effectiveness ) hit.effectiveness = extra.effectiveness;
	if ( hooks.length ) hit.onHit = ( world, src, tgt, r ) => {

		for ( const fn of hooks ) fn( world, src, tgt, r, hit, ctx );

	};

	return hit;

}

// --- casting -------------------------------------------------------------------------

// Plan a skill's final cost without changing resources. Life costs take precedence
// over shield-first costs and must leave the caster alive. The HUD uses the same
// affordability check as casting, including split shield / mana payments.
export function skillCost( e, amount, tags = [] ) {

	const cost = { life: 0, mana: 0, shield: 0, affordable: false };
	if ( e.stats.get( 'skill_cost_life', tags ) > 0 ) {

		cost.life = amount;
		cost.affordable = e.alive && e.life > amount;

	} else {

		cost.shield = e.stats.get( 'skill_cost_shield_first', tags ) > 0 ? Math.min( Math.max( 0, e.shield ), amount ) : 0;
		cost.mana = amount - cost.shield;
		cost.affordable = e.alive && e.mana >= cost.mana;

	}

	return cost;

}

// The single entry point that turns "use skill X now" into an action: the player
// controller, minions with skills, bots and the agent API all call it.
//   -> 'ok' | 'cooldown' | 'mana' | 'busy' | 'invalid'
export function castSkill( world, e, id, opts = {} ) {

	const skill = get( 'skill', id );
	if ( ! skill || ! e.alive ) return 'invalid';
	if ( ( e.cooldowns.get( id ) ?? 0 ) > world.time ) return 'cooldown';
	// the save's loadout (levels, supports) belongs to the player; anything else casting a
	// player skill (a unique's proc, a mechanic, a monster) gets no supports and a level
	// from its own level unless the caller says otherwise
	const mine = e.kind === 'player';
	const lo = mine ? readLoadout( world.game?.save ) : null;
	const level = opts.level ?? ( mine ? skillLevel( lo, id, e ) : Math.max( 1, Math.round( ( e.level ?? 1 ) / 2 ) ) );
	const ctx = makeContext( world, e, skill, level, opts.supports ?? ( mine ? supportList( lo, id ) : [] ) );
	const cost = skillCost( e, opts.free ? 0 : ctx.manaCost, ctx.tags );
	if ( ! opts.free && ! cost.affordable ) return 'mana'; // the existing resource-shortage result

	// aim: a point on the ground; too close to the body means "the way I face"
	let aimX = opts.aimX ?? e.anim.aimX, aimZ = opts.aimZ ?? e.anim.aimZ;
	if ( Math.hypot( aimX - e.x, aimZ - e.z ) < 0.6 ) {

		aimX = e.x + Math.sin( e.facing ) * 3;
		aimZ = e.z + Math.cos( e.facing ) * 3;

	}

	// melee aim assist: snap to the best enemy inside the aim cone and let the lunge
	// close the remaining gap - the swing goes where the player meant, not where the
	// cursor happened to be
	if ( skill.tags.includes( 'melee' ) && opts.assist !== false && ! skill.noAssist ) {

		const reach = ( skill.reach ?? 2.6 ) * ( skill.tags.includes( 'area' ) ? ctx.radius : 1 );
		const t = assistTarget( world, e, aimX, aimZ, reach + ASSIST_EXTRA, opts.cone ?? 45 );
		if ( t ) {

			aimX = t.x; aimZ = t.z;
			ctx.target = t;
			ctx.gap = Math.min( ASSIST_EXTRA, Math.max( 0, e.distTo( t ) - t.radius - e.radius - reach * 0.45 ) );

		}

	}

	ctx.aimX = aimX; ctx.aimZ = aimZ;
	if ( skill.combo ) {

		const c = e.data.combo;
		ctx.variant = c && c.id === id && world.time <= c.until ? ( c.step + 1 ) % skill.combo : 0;

	} else if ( skill.alternate ) {

		e.data.alt = e.data.alt || {};
		ctx.variant = e.data.alt[ id ] = ( ( e.data.alt[ id ] ?? 1 ) + 1 ) % skill.alternate;

	}

	if ( ctx.ruthless ) {

		e.data.ruthless = e.data.ruthless || {};
		const n = e.data.ruthless[ id ] = ( e.data.ruthless[ id ] ?? 0 ) + 1;
		if ( n % 3 === 0 ) {

			ctx.dmgMult *= 2;
			ctx.stun += 0.6;
			ctx.heavy = true;

		}

	}

	if ( skill.canCast && ! skill.canCast( world, e, ctx ) ) return 'invalid';
	const def = skill.action( level, ctx );
	const act = world.act( e, def, { aimX, aimZ, target: ctx.target, ctx, force: opts.force } );
	if ( ! act ) return 'busy';
	if ( ! opts.free ) {

		e.life -= cost.life;
		e.shield -= cost.shield;
		e.mana -= cost.mana;
		if ( e.stats.get( 'skill_cost_life', ctx.tags ) > 0 ) e.mana = e.maxMana;
		// Exact spending survives same-step leech, flasks and refunds. Shield damage,
		// life costs and mana lost to damage protection never count as mana spent.
		if ( cost.mana > 0 ) world.events.emit( 'manaSpent', { entity: e, amount: cost.mana, skill: id } );

	}
	if ( ctx.cooldown > 0 ) {

		e.cooldowns.set( id, world.time + ctx.cooldown );
		( e.data.cdTotal || ( e.data.cdTotal = {} ) )[ id ] = ctx.cooldown;

	}

	if ( skill.combo ) e.data.combo = { id, step: ctx.variant, until: world.time + act.duration + COMBO_GRACE };
	world.events.emit( 'skill', { entity: e, skill: id, slot: opts.slot ?? - 1, element: ctx.element, tags: skill.tags, x: e.x, z: e.z, variant: ctx.variant } );
	return 'ok';

}

// Best enemy for a melee swing aimed at ( aimX, aimZ ): inside `cone` degrees of the
// aim direction and within `reach`; prefers small angles, then short distances.
export function assistTarget( world, e, aimX, aimZ, reach, cone = 45 ) {

	const dir = Math.atan2( aimX - e.x, aimZ - e.z );
	const half = cone * Math.PI / 180;
	let best = null, bestScore = Infinity;
	for ( const o of world.enemiesOf( e, e.x, e.z, reach ) ) {

		const dx = o.x - e.x, dz = o.z - e.z, d = Math.hypot( dx, dz );
		const da = d < 0.5 ? 0 : Math.abs( Math.atan2( Math.sin( Math.atan2( dx, dz ) - dir ), Math.cos( Math.atan2( dx, dz ) - dir ) ) );
		if ( da > half ) continue;
		if ( ! world.layout.hasLineOfSight( e.x, e.z, o.x, o.z ) ) continue;
		const score = da / half + d / reach * 0.6;
		if ( score < bestScore ) {

			bestScore = score;
			best = o;

		}

	}

	return best;

}

// --- helpers for skill content ---------------------------------------------------------

// The action def every skill returns gets the skill tags (so attack/cast speed mods
// tagged for the skill apply) and the right speed stat.
export function skillAction( ctx, def ) {

	def.id = def.id ?? ctx.id;
	def.tags = ctx.tags;
	// speedStat: null means "not affected by attack or cast speed" (warcries, buffs)
	if ( ! ( 'speedStat' in def ) ) def.speedStat = ctx.isAttack ? 'attack_speed' : 'cast_speed';
	def.skill = ctx.id;
	def.duration = def.duration ?? ctx.skill.time ?? 0.5;
	// chainAt: when holding / re-pressing the SAME skill may start its next use. Later
	// than cancelAt (where a dodge, a move or another skill may cut in), so holding a
	// button plays most of each swing while weaving skills stays snappy.
	def.chainAt = def.chainAt ?? Math.max( def.cancelAt ?? 0, 0.88 );
	return def;

}

// Root motion that covers `dist` metres between two timeline fractions whatever the
// attack speed: the speed is computed from the real (sped-up) duration at start.
export function lunge( def, from, to, dist ) {

	def.lunge = { from, to, speed: 0 };
	const prev = def.onStart;
	def.onStart = ( world, e, act ) => {

		def.lunge.speed = dist / Math.max( 1 / 60, ( to - from ) * act.duration );
		prev?.( world, e, act );

	};

	return def;

}

// Presentation cues from the sim: 'hitstop' freezes the frame for a few ms on heavy
// impacts, 'shake' adds camera trauma. The client caps and scales both.
export function feel( world, e, { hitstop = 0, shake = 0 } = {}, connected = true ) {

	if ( hitstop > 0 && connected ) world.events.emit( 'hitstop', { time: hitstop, source: e } );
	if ( shake > 0 ) world.events.emit( 'shake', { amount: shake, x: e.x, z: e.z, source: e } );

}

// A melee swing: arc hit + support extras (melee splash) + feel.
export function strike( world, e, ctx, { range, angle = 140, hit, fx = 'slash', maxTargets, dir, x, z, hitstop = 0, shake = 0 } ) {

	const hits = world.melee( e, { range, angle, hit, fx, element: ctx.element, maxTargets, dir, x, z } );
	if ( ctx.splash && hits.length ) {

		const first = hits[ 0 ].target, done = new Set( hits.map( ( h ) => h.target.id ) );
		const splashHit = { ...hit, effectiveness: ( hit.effectiveness ?? 1 ) * ctx.splash, onHit: undefined };
		for ( const o of world.enemiesOf( e, first.x, first.z, 2.2 ) ) if ( ! done.has( o.id ) ) world.dealDamage( e, o, splashHit );
		world.events.emit( 'fx', { kind: 'burst', x: first.x, z: first.z, radius: 2.2, element: ctx.element } );

	}

	const crit = hits.some( ( h ) => h.crit );
	feel( world, e, { hitstop: hitstop + ( ctx.heavy ? 0.04 : 0 ) + ( crit && hitstop ? 0.02 : 0 ), shake: shake + ( ctx.heavy ? 0.2 : 0 ) }, hits.length > 0 );
	return hits;

}

// A fan of projectiles toward the aim point, honouring projectile count, speed,
// pierce, chain and fork from the context.
export function volley( world, e, ctx, opts ) {

	const n = Math.max( 1, Math.round( opts.count ?? ctx.projectiles ) );
	const dir0 = opts.dir ?? Math.atan2( ( opts.aimX ?? ctx.aimX ) - e.x, ( opts.aimZ ?? ctx.aimZ ) - e.z );
	const step = Math.min( ( opts.spread ?? 12 ) * Math.PI / 180, ( opts.maxFan ?? 150 ) * Math.PI / 180 / Math.max( 1, n - 1 ) );
	const out = [];
	for ( let i = 0; i < n; i ++ ) {

		const dir = dir0 + ( i - ( n - 1 ) / 2 ) * step;
		out.push( fireOne( world, e, ctx, { ...opts, dir }, ctx.fork ) );

	}

	return out;

}

function fireOne( world, e, ctx, opts, forks ) {

	const ox = opts.x ?? e.x + Math.sin( opts.dir ) * ( e.radius + 0.3 );
	const oz = opts.z ?? e.z + Math.cos( opts.dir ) * ( e.radius + 0.3 );
	const userHit = opts.onHit;
	const p = world.projectile( e, {
		...opts, x: ox, z: oz,
		speed: ( opts.speed ?? 18 ) * ctx.projSpeed,
		pierce: ( opts.pierce ?? 0 ) + ctx.pierce,
		chain: ( opts.chain ?? 0 ) + ctx.chain,
		element: opts.element ?? ctx.element,
		data: { ...opts.data, skill: ctx.id, forks },
		onHit( w, pr, tgt, r ) {

			userHit?.( w, pr, tgt, r );
			// Fork: the first hit splits the projectile into two that skip the target
			if ( pr.data.forks > 0 && ! pr.data.forked ) {

				pr.data.forked = true;
				for ( const s of [ - 1, 1 ] ) {

					const child = fireOne( w, e, ctx, { ...opts, x: tgt.x, z: tgt.z, dir: pr.dir + s * 0.5, range: ( opts.range ?? 20 ) * 0.6 }, pr.data.forks - 1 );
					child.hitIds.add( tgt.id );
					child.data.forked = true;

				}

			}

		}
	} );
	return p;

}

// Spell Echo and friends: run the delivery now and again `ctx.repeats` times.
export function repeat( world, e, ctx, fn, gap = 0.14 ) {

	fn( world, e, 0 );
	for ( let r = 1; r <= ctx.repeats; r ++ ) schedule( world, gap * r, ( w ) => e.alive && fn( w, e, r ) );

}

// Clamp a ground target to [ minR, maxR ] metres from the caster and pull it back out
// of walls along the line of sight; `walkable` also steps it back off pits and water
// (where a leap or a blink may not end).
export function groundTarget( world, e, x, z, maxR, minR = 0, walkable = false ) {

	let dx = x - e.x, dz = z - e.z;
	const d = Math.hypot( dx, dz ) || 1;
	const r = Math.max( minR, Math.min( maxR, d ) );
	dx /= d; dz /= d;
	const L = world.layout;
	const clear = L.raycast( e.x, e.z, e.x + dx * r, e.z + dz * r );
	let rr = Math.max( 0, r * clear - ( clear < 1 ? 0.6 : 0 ) );
	if ( walkable ) while ( rr > 0 && ! L.isWalkable( e.x + dx * rr, e.z + dz * rr ) ) rr = Math.max( 0, rr - 0.5 );
	return { x: e.x + dx * rr, z: e.z + dz * rr, dir: Math.atan2( dx, dz ), dist: rr };

}

// Can `e` hurt `o`? (the same rule as world.enemiesOf, for a single entity)
export function isFoe( e, o ) {

	return o.alive && o.team !== e.team && o.team !== TEAM.NEUTRAL && o.kind !== 'loot' && o.kind !== 'npc' && ! o.flags.untargetable;

}

// --- tooltips (progression's skill UI calls this) -------------------------------------------

// Numbers for a skill's tooltip from the player's CURRENT stats - the same code path
// as casting, so the tooltip can never disagree with the game.
//   skillTooltip( game, 'fireball', { level?, supports?, entity? } ) ->
//   { id, name, level, tags, element, icon, manaCost, cooldown, castTime, critChance, critMulti,
//     hits: [ { name, label, byType: { fire: [ min, max ] }, min, max } ], damage: [ min, max ],
//     dps, supports: [ ids ], desc, lines: [ strings ] }
export function skillTooltip( game, id, { level, supports, entity } = {} ) {

	const skill = get( 'skill', id );
	if ( ! skill ) return null;
	const lo = readLoadout( game?.save );
	const e = entity ?? game?.world?.player ?? tempPlayer( game );
	const lv = level ?? skillLevel( lo, id, e );
	const sup = supports ?? supportList( lo, id );
	const ctx = makeContext( game?.world ?? null, e, skill, lv, sup, { preview: true } );
	const S = e.stats;
	const hits = Object.keys( skill.hits || {} ).map( ( name ) => {

		const spec = specOf( ctx, name );
		const r = damageRanges( ctx, spec );
		const byType = {};
		let min = 0, max = 0;
		for ( const type in r ) {

			const m = S.get( 'damage', ctx.tags.concat( type ) );
			byType[ type ] = [ r[ type ][ 0 ] * m, r[ type ][ 1 ] * m ];
			min += byType[ type ][ 0 ];
			max += byType[ type ][ 1 ];

		}

		return { name, label: spec.label ?? ( name === 'main' ? 'Damage' : name ), byType, min, max, perSecond: !! spec.perSecond };

	} );
	const speed = Math.max( 0.1, S.get( ctx.isAttack ? 'attack_speed' : 'cast_speed', ctx.tags ) );
	const castTime = ( skill.time ?? 0.5 ) / speed;
	const c = S.breakdown( 'crit_chance', ctx.tags, false );
	const mainSpec = specOf( ctx, Object.keys( skill.hits || {} )[ 0 ] );
	const baseCrit = mainSpec.crit ?? ( c.base + c.flat );
	const critChance = Math.min( 100, c.override ?? baseCrit * Math.max( 0, 1 + c.inc / 100 ) * c.more );
	const critMulti = S.get( 'crit_multi', ctx.tags );
	const main = hits[ 0 ] || { min: 0, max: 0 };
	const avg = ( main.min + main.max ) / 2 * ( 1 + critChance / 100 * ( critMulti / 100 - 1 ) ) * ( skill.hitsPerCast ?? 1 );
	const dps = main.perSecond ? avg : avg / Math.max( castTime, ctx.cooldown || 0 );
	const fmt = ( v ) => v >= 100 ? Math.round( v ).toLocaleString() : v.toFixed( 1 );
	const lines = [
		skill.tags.filter( ( t ) => ! t.startsWith( 'sk:' ) ).join( ', ' ),
		`Level ${lv}`,
		ctx.manaCost ? e.stats.get( 'skill_cost_life', ctx.tags ) > 0 ? `Life cost: ${ctx.manaCost}` :
			e.stats.get( 'skill_cost_shield_first', ctx.tags ) > 0 ? `Cost: ${ctx.manaCost} (Energy Shield before Mana)` : `Mana cost: ${ctx.manaCost}` : 'No resource cost',
		ctx.cooldown ? `Cooldown: ${ctx.cooldown.toFixed( 2 )} s` : null,
		`${ctx.isAttack ? 'Attack' : 'Cast'} time: ${castTime.toFixed( 2 )} s`,
		`Critical strike chance: ${critChance.toFixed( 1 )}%`,
		...hits.filter( ( h ) => h.max > 0 ).map( ( h ) => `${h.label}: ${fmt( h.min )}–${fmt( h.max )}${h.perSecond ? ' per second' : ''} (${Object.keys( h.byType ).join( ' + ' )})` ),
		...( skill.info ? skill.info( lv, ctx ) : [] ),
		...ctx.supports.map( ( s ) => `Supported by ${s.name}` )
	].filter( Boolean );
	return {
		id, name: skill.name, level: lv, tags: skill.tags, element: ctx.element, icon: skill.icon, manaCost: ctx.manaCost,
		cooldown: ctx.cooldown, castTime, critChance, critMulti, hits, damage: [ main.min, main.max ], dps,
		supports: ctx.supports.map( ( s ) => s.id ), desc: skill.desc, lines
	};

}

// Tooltips before a world exists (character select, tests): a throwaway player with
// the same stat sources as the real one.
function tempPlayer( game ) {

	const p = new Entity( { kind: 'player', team: TEAM.PLAYER } );
	game?.applyPlayerStats?.( p );
	return p;

}
