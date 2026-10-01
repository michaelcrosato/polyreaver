// Elite affixes: modifiers rolled onto magic (1-2), rare (3-4) and unique (3)
// monsters and on procedural bosses. Each affix is a small bundle of:
//
//   mods          stat modifiers ( array, or ( e ) => array for level-scaled values )
//   flags         entity flags ( 'unstoppable', 'ghost' )
//   abilities     extra monsterAbility ids
//   apply / update( world, e, st, dt ) / onDeath( world, e, st, killer ) /
//   onHurt( world, e, st, hit ) / onHitDealt( world, e, st, hit )   behaviour hooks
//   color, tint   the TELL: glow / tint the rig renderer shows, plus 'affix' events
//                 ( { entity, id, kind, x, z } ) the VFX layer turns into flashes
//   excludes, elements (affinity), archetypes / notArchetypes, boss: false, level
//
// Rule for behaviour affixes: anything that hurts is telegraphed like an ability.

import { define } from '../../core/registry.js';
import { hitOf, telegraph, cancelArea, alliesNear, healFrac, pull, ringPoint, aiRng, teleport, colorOf, isHostile, tickHit } from './util.js';
import { spawnMonster } from './factory.js';
import { summonMinions, liveMinions } from './abilities.js';

const affix = ( def ) => define( 'monsterAffix', { weight: 1, level: 1, ...def } );
const tell = ( world, e, id, kind = 'proc' ) => world.events.emit( 'affix', { entity: e, id, kind, x: e.x, z: e.z } );
const fighting = ( e ) => e.data.brain?.state === 'combat' || e.data.bossBrain?.state === 'fight';
const targetOf = ( world, e ) => e.data.brain?.target || ( e.kind === 'boss' ? world.player : null );
const every = ( world, st, key, seconds ) => {

	if ( ( st[ key ] ?? 0 ) > world.time ) return false;
	st[ key ] = world.time + seconds;
	return true;

};

// --- stat affixes -----------------------------------------------------------------------

affix( { id: 'hasted', name: 'Hasted', tags: [ 'speed' ], color: '#c8ff5a', excludes: [ 'juggernaut' ],
	mods: [ { stat: 'move_speed', type: 'more', value: 35 }, { stat: 'attack_speed', type: 'more', value: 25 }, { stat: 'cast_speed', type: 'more', value: 25 } ] } );

affix( { id: 'armoured', name: 'Armoured', tags: [ 'defence' ], color: '#b0b8c8', tint: '#8f96a3',
	mods: [ { stat: 'armor', type: 'inc', value: 150 }, { stat: 'life', type: 'inc', value: 20 }, { stat: 'damage_taken', type: 'more', value: - 25, tags: [ 'physical' ] } ] } );

affix( { id: 'resolute', name: 'Resolute', tags: [ 'defence' ], color: '#e0d6c0',
	mods: [ 'fire', 'cold', 'lightning', 'chaos' ].map( ( t ) => ( { stat: 'res_' + t, type: 'flat', value: 30 } ) ) } );

affix( { id: 'juggernaut', name: 'Juggernaut', tags: [ 'defence' ], color: '#a0703a', tint: '#6b4a2e', flags: [ 'unstoppable' ], excludes: [ 'hasted' ],
	mods: [ { stat: 'life', type: 'more', value: 40 }, { stat: 'move_speed', type: 'more', value: - 15 } ] } );

affix( { id: 'overcharged', name: 'Overcharged', tags: [ 'offence', 'lightning' ], color: '#ffe85a', level: 3,
	mods: [ { stat: 'damage', type: 'more', value: 40 }, { stat: 'damage_taken', type: 'more', value: 20 }, { stat: 'attack_speed', type: 'inc', value: 10 } ] } );

affix( { id: 'ghostly', name: 'Ghostly', tags: [ 'defence' ], color: '#cfe6ff', tint: '#a8c8e8', flags: [ 'ghost' ],
	mods: [ { stat: 'evade_chance', type: 'flat', value: 30 } ] } );

// Elemental enchantments: flat added damage scaled from the monster's own hit.
for ( const [ id, name, el, ail, color ] of [
	[ 'fire-enchanted', 'Fire Enchanted', 'fire', 'ignite', '#ff6a2b' ],
	[ 'cold-enchanted', 'Cold Enchanted', 'cold', 'chill', '#8fdcff' ],
	[ 'venomous', 'Venomous', 'chaos', 'poison', '#7dff5a' ]
] ) {

	affix( { id, name, tags: [ 'offence', el ], color, tint: color, elements: [ el, 'physical' ],
		mods: ( e ) => [
			{ stat: `added_${el}_min`, type: 'flat', value: e.data.damage[ 0 ] * 0.45 }, { stat: `added_${el}_max`, type: 'flat', value: e.data.damage[ 1 ] * 0.45 },
			{ stat: `${ail}_chance`, type: 'flat', value: 30 }, { stat: `res_${el}`, type: 'flat', value: 40 }
		] } );

}

// --- on-hit / on-hurt -------------------------------------------------------------------------

affix( { id: 'vampiric', name: 'Vampiric', tags: [ 'offence', 'sustain' ], color: '#d0203a',
	mods: [ { stat: 'life_leech', type: 'flat', value: 30 } ],
	onHitDealt( world, e, st, h ) {

		if ( h.total > 0 && every( world, st, 'fx', 0.5 ) ) tell( world, e, 'vampiric', 'leech' );

	} } );

// Thorns hurt melee attackers by a share of the MONSTER's own hit (not of the hit it
// took: reflecting the attacker's damage would grow faster than the attacker's
// life as both scale with depth). At most every 0.3 s per attacker.
affix( { id: 'thorns', name: 'Thorns', tags: [ 'defence' ], color: '#c8a050', tint: '#8a6a30',
	onHurt( world, e, st, h ) {

		const src = h.source;
		if ( ! src || ! src.alive || ! h.tags?.includes( 'melee' ) || h.tags.includes( 'thorns' ) || h.total <= 0 || ! isHostile( e, src ) ) return;
		const [ lo, hi ] = e.data.damage;
		tickHit( world, e, src, { damage: { physical: [ lo * 0.3, hi * 0.3 ] }, tags: [ 'thorns' ], addFlat: false, noAilments: true, noLeech: true, canBlock: false, canEvade: false, canCrit: false, skill: 'thorns' }, 'thorns' + e.id, 0.3 );
		if ( every( world, st, 'fx', 0.3 ) ) tell( world, e, 'thorns' );

	} } );

// --- auras and periodic behaviours ---------------------------------------------------------------

affix( { id: 'frost-aura', name: 'Frost Aura', tags: [ 'aura', 'cold' ], color: '#8fdcff', tint: '#bfeaff', level: 2, elements: [ 'cold', 'physical', 'lightning' ],
	update( world, e, st ) {

		if ( st.aura?.alive || ! e.alive ) return;
		st.aura = world.area( e, { follow: e, radius: e.radius + 3.5, duration: 1e6, interval: 0.5, hitOnce: false, fx: 'frost-aura', color: colorOf( 'cold' ), element: 'cold', data: { aura: true },
			hit: hitOf( e, 0.1, { element: 'cold', tags: [ 'spell', 'area', 'aura' ], ailments: { chill: 100 }, skill: 'frost-aura' } ) } );

	},
	onDeath( world, e, st ) {

		if ( st.aura ) cancelArea( world, st.aura );

	} } );

affix( { id: 'time-warp', name: 'Time Warp', tags: [ 'aura', 'time' ], color: '#e8d27a', level: 6,
	update( world, e, st ) {

		if ( ! fighting( e ) || ! every( world, st, 'tick', 0.25 ) ) return;
		for ( const o of world.query( e.x, e.z, e.radius + 4, ( o ) => isHostile( e, o ) ) ) world.applyStatus( o, 'm-slow', { duration: 0.5, source: e } );

	} } );

affix( { id: 'rallying', name: 'Rallying', tags: [ 'aura', 'support' ], color: '#ff7a5a', level: 4, boss: false,
	update( world, e, st ) {

		if ( ! fighting( e ) || ! every( world, st, 'tick', 1 ) ) return;
		for ( const o of alliesNear( world, e, 7 ) ) world.applyStatus( o, 'm-frenzy', { duration: 1.6, source: e } );

	} } );

affix( { id: 'regenerating', name: 'Regenerating', tags: [ 'sustain' ], color: '#5aff8a',
	update( world, e, st, dt ) {

		if ( world.time - ( e.data.lastHitTime ?? - 99 ) > 2 && e.life < e.maxLife ) {

			e.life = Math.min( e.maxLife, e.life + e.maxLife * 0.06 * dt );
			if ( every( world, st, 'fx', 1 ) ) tell( world, e, 'regenerating', 'heal' );

		}

	} } );

affix( { id: 'arcane-buffer', name: 'Arcane Buffer', tags: [ 'defence' ], color: '#9a7aff', level: 3,
	mods: ( e ) => [ { stat: 'shield', type: 'flat', value: e.stats.get( 'life' ) * 0.6 } ],
	apply( world, e ) {

		e.shield = e.stats.get( 'shield' );

	} } );

affix( { id: 'shielding', name: 'Shielding', tags: [ 'support' ], color: '#9fd8ff', level: 4,
	update( world, e, st ) {

		if ( ! fighting( e ) || ! every( world, st, 'cast', 7 ) ) return;
		const allies = alliesNear( world, e, 8, true );
		for ( const o of allies ) {

			o.shield = Math.max( o.shield, o.maxLife * 0.25 );
			world.applyStatus( o, 'm-ward', { duration: 5, source: e } );

		}

		world.area( e, { x: e.x, z: e.z, radius: 8, fx: 'ward', color: '#9fd8ff' } );
		tell( world, e, 'shielding' );

	} } );

affix( { id: 'berserker', name: 'Berserker', tags: [ 'offence' ], color: '#ff3a3a', level: 2,
	update( world, e, st ) {

		if ( st.raging || e.lifeFrac > 0.5 ) return;
		st.raging = true;
		world.applyStatus( e, 'm-enraged', { duration: 9999, source: e } );
		if ( e.model ) e.model.glow = '#ff2a2a';
		tell( world, e, 'berserker', 'rage' );
		world.events.emit( 'sfx', { id: 'roar', x: e.x, z: e.z, volume: 0.8 } );

	} } );

affix( { id: 'molten-trail', name: 'Molten Trail', tags: [ 'hazard', 'fire' ], color: '#ff8a2b', tint: '#d0602a', level: 3, elements: [ 'fire', 'physical' ],
	update( world, e, st ) {

		if ( ! fighting( e ) || Math.hypot( e.vx, e.vz ) < 1 || ! every( world, st, 'drop', 0.45 ) ) return;
		world.area( e, { x: e.x, z: e.z, radius: 1.1, delay: 0.3, duration: 3, interval: 0.5, hitOnce: false, fx: 'fire', color: colorOf( 'fire' ), element: 'fire',
			hit: hitOf( e, 0.12, { element: 'fire', tags: [ 'spell', 'area', 'dot' ], skill: 'molten-trail' } ) } );

	} } );

affix( { id: 'storm-touched', name: 'Storm-touched', tags: [ 'hazard', 'lightning' ], color: '#c8b0ff', level: 4, elements: [ 'lightning', 'physical', 'cold' ],
	mods: ( e ) => [ { stat: 'added_lightning_min', type: 'flat', value: e.data.damage[ 0 ] * 0.2 }, { stat: 'added_lightning_max', type: 'flat', value: e.data.damage[ 1 ] * 0.4 } ],
	update( world, e, st ) {

		if ( ! fighting( e ) || ! every( world, st, 'storm', 4 ) ) return;
		const rng = aiRng( world );
		for ( let i = 0; i < 3; i ++ ) {

			const p = ringPoint( world, rng, e.x, e.z, 1.5, 6 );
			if ( p ) telegraph( world, e, null, { ...p, radius: 1.4, delay: 0.9, fx: 'lightning', element: 'lightning', hit: hitOf( e, 0.8, { element: 'lightning', tags: [ 'spell', 'area' ], skill: 'storm-touched' } ) } );

		}

		tell( world, e, 'storm-touched' );

	} } );

affix( { id: 'teleporter', name: 'Teleporter', tags: [ 'mobility' ], color: '#c45aff', level: 2, notArchetypes: [ 'turret' ],
	update( world, e, st ) {

		const t = targetOf( world, e );
		if ( st.jump ) {

			if ( world.time < st.jump.at ) return;
			const p = st.jump;
			st.jump = null;
			if ( e.flags.stunned || e.flags.frozen || e.action ) return;
			world.events.emit( 'blink', { entity: e, x: e.x, z: e.z, tx: p.x, tz: p.z } );
			teleport( e, p.x, p.z );
			tell( world, e, 'teleporter' );
			return;

		}

		if ( ! t || ! fighting( e ) || e.action || Math.hypot( t.x - e.x, t.z - e.z ) < 5 || ! every( world, st, 'cd', 5.5 ) ) return;
		const p = ringPoint( world, aiRng( world ), t.x, t.z, 2.5, 4.5 );
		if ( ! p ) return;
		st.jump = { ...p, at: world.time + 0.5 };
		telegraph( world, e, null, { ...p, radius: e.radius + 0.4, delay: 0.5 } );

	} } );

affix( { id: 'gravity', name: 'Gravity Well', tags: [ 'control' ], color: '#7a5aff', level: 5,
	update( world, e, st ) {

		const t = targetOf( world, e );
		if ( ! t || ! fighting( e ) || Math.hypot( t.x - e.x, t.z - e.z ) > 9 || ! every( world, st, 'cd', 7 ) ) return;
		telegraph( world, e, null, { x: e.x, z: e.z, shape: 'ring', inner: 1.5, radius: 9, delay: 0.85, fx: 'void', element: 'chaos',
			hit: { damage: {}, tags: [ 'spell' ] }, onHit: ( w, a, o ) => pull( o, e.x, e.z, 24 ) } );
		tell( world, e, 'gravity' );

	} } );

affix( { id: 'summoner', name: 'Summoner', tags: [ 'summon' ], color: '#b07aff', level: 3, boss: false, notArchetypes: [ 'summoner', 'swarmer' ],
	update( world, e, st ) {

		if ( ! fighting( e ) || ! every( world, st, 'cd', 9 ) || liveMinions( e ) >= 4 ) return;
		summonMinions( world, e, 2 );
		tell( world, e, 'summoner' );

	} } );

affix( { id: 'mirror-image', name: 'Mirror Image', tags: [ 'trick' ], color: '#bfe8ff', level: 5, boss: false,
	update( world, e, st ) {

		if ( st.done || e.lifeFrac > 0.6 ) return;
		st.done = true;
		const rng = aiRng( world );
		for ( let i = 0; i < 2; i ++ ) {

			const p = ringPoint( world, rng, e.x, e.z, 1.5, 3 ) || e;
			const m = spawnMonster( world, { family: e.data.family, archetype: e.data.archetype, genome: e.model.genome, level: e.level, rarity: 'normal', x: p.x, z: p.z,
				summoned: true, lifeMult: 0.15, name: e.name, minions: 0, tint: '#bfe8ff' } );
			if ( ! m ) continue;
			m.tags.add( 'illusion' );
			m.data.xp = 0; m.data.lootMult = 0;
			m.stats.setSource( 'illusion', [ { stat: 'damage', type: 'more', value: - 65 } ] );
			m.model.glow = e.model.glow;
			m.model.rarity = e.model.rarity;

		}

		// the real one swaps places with an image so you lose track of it
		const p = ringPoint( world, rng, e.x, e.z, 2, 3.5 );
		if ( p ) teleport( e, p.x, p.z );
		tell( world, e, 'mirror-image' );

	} } );

// --- on death -------------------------------------------------------------------------------------

affix( { id: 'volatile', name: 'Volatile', tags: [ 'death', 'fire' ], color: '#ffb02b', level: 2, elements: [ 'fire', 'physical', 'lightning' ],
	onDeath( world, e ) {

		telegraph( world, e, null, { x: e.x, z: e.z, radius: 2.8 + e.radius, delay: 1.0, fx: 'explosion', element: 'fire',
			hit: hitOf( e, 2.4, { element: 'fire', split: 0.7, tags: [ 'spell', 'area' ], knockback: 10, skill: 'volatile' } ) } );
		tell( world, e, 'volatile', 'fuse' );

	} } );

affix( { id: 'plagued', name: 'Plagued', tags: [ 'death', 'chaos' ], color: '#9cff3a', level: 3, elements: [ 'chaos', 'physical' ],
	onDeath( world, e ) {

		world.area( e, { x: e.x, z: e.z, radius: 3, delay: 0.6, duration: 5, interval: 0.5, hitOnce: false, fx: 'poison', color: colorOf( 'chaos' ), element: 'chaos',
			hit: hitOf( e, 0.2, { element: 'chaos', tags: [ 'spell', 'area', 'dot' ], ailments: { poison: 30 }, skill: 'plagued' } ) } );

	} } );

affix( { id: 'splitter', name: 'Splitter', tags: [ 'death' ], color: '#ffd0f0', level: 4, boss: false, notArchetypes: [ 'swarmer', 'exploder', 'turret' ],
	onDeath( world, e ) {

		if ( ( e.data.splitGen ?? 0 ) >= 1 || e.tags.has( 'illusion' ) ) return;
		const rng = aiRng( world );
		for ( let i = 0; i < 2; i ++ ) {

			const p = ringPoint( world, rng, e.x, e.z, 0.6, 1.6 ) || e;
			const m = spawnMonster( world, { family: e.data.family, archetype: e.data.archetype, level: e.level, rarity: 'normal', x: p.x, z: p.z,
				summoned: true, size: 0.65, lifeMult: 0.45, minions: 0 } );
			if ( m ) {

				m.data.splitGen = 1;
				m.data.spawnUntil = world.time + 0.4;

			}

		}

		tell( world, e, 'splitter' );

	} } );

// Healing pulse on death: kill these away from their friends.
affix( { id: 'martyr', name: 'Martyr', tags: [ 'death', 'support' ], color: '#ffe0a0', level: 6, boss: false,
	onDeath( world, e ) {

		world.area( e, { x: e.x, z: e.z, radius: 7, fx: 'heal', color: '#ffe0a0', onTick: ( w ) => {

			for ( const o of alliesNear( w, e, 7 ) ) healFrac( w, o, 0.3 );

		} } );

	} } );
