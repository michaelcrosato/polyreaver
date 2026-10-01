// Support gems: modifiers socketed into one active skill (game.save.skills.supports).
//
//   define( 'support', {
//     id, name, tags,      skill tags it can support (ANY of them), excludes: tags it never fits
//     manaMult,            multiplies the skill's mana cost
//     mods( level ),       stat modifiers applied ONLY to the supported skill (they get its
//                          'sk:<id>' tag in skill-core.js supportMods) - or a plain array
//     transform( ctx ),    behaviour changes on the skill context (fork, echo, conversion...)
//     desc, icon, color    UI
//   } )
//
// Level scaling uses the supported skill's level, so a support never goes stale.

import { define } from '../../core/registry.js';
import { spellScale } from './skill-core.js';

const sup = ( def ) => define( 'support', { manaMult: 1, icon: 'gem', color: '#9fd2ff', ...def } );

// --- projectiles ----------------------------------------------------------------------

sup( { id: 'multiple-projectiles', name: 'Multiple Projectiles', tags: [ 'projectile' ], manaMult: 1.4, color: '#7fe0a0',
	desc: '+2 projectiles, 25% less damage.',
	mods: [ { stat: 'projectile_count', type: 'flat', value: 2 }, { stat: 'damage', type: 'more', value: - 25 } ] } );

sup( { id: 'pierce', name: 'Pierce', tags: [ 'projectile' ], manaMult: 1.15, color: '#7fe0a0',
	desc: 'Projectiles pierce 2 more enemies. 10% more projectile damage.',
	mods: [ { stat: 'pierce', type: 'flat', value: 2 }, { stat: 'damage', type: 'more', value: 10 } ] } );

sup( { id: 'chain', name: 'Chain', tags: [ 'projectile', 'chain' ], manaMult: 1.3, color: '#7fe0a0',
	desc: 'Projectiles chain to 2 more enemies. 20% less damage.',
	mods: [ { stat: 'chain', type: 'flat', value: 2 }, { stat: 'damage', type: 'more', value: - 20 } ] } );

sup( { id: 'fork', name: 'Fork', tags: [ 'projectile' ], manaMult: 1.2, color: '#7fe0a0',
	desc: 'Projectiles split in two on their first hit. 10% less damage.',
	mods: [ { stat: 'damage', type: 'more', value: - 10 } ],
	transform: ( ctx ) => ( ctx.fork += 1 ) } );

sup( { id: 'faster-projectiles', name: 'Faster Projectiles', tags: [ 'projectile' ], manaMult: 1.1, color: '#7fe0a0',
	desc: '50% increased projectile speed, 15% increased damage.',
	mods: [ { stat: 'projectile_speed', type: 'inc', value: 50 }, { stat: 'damage', type: 'inc', value: 15 } ] } );

// --- areas --------------------------------------------------------------------------------

sup( { id: 'increased-area', name: 'Increased Area', tags: [ 'area' ], manaMult: 1.3, color: '#ffd27f',
	desc: '45% increased area of effect.',
	mods: ( lv ) => [ { stat: 'area', type: 'inc', value: 40 + lv } ] } );

sup( { id: 'concentrated-effect', name: 'Concentrated Effect', tags: [ 'area' ], manaMult: 1.3, color: '#ffd27f',
	desc: '30% reduced area, 40% more area damage.',
	mods: ( lv ) => [ { stat: 'area', type: 'inc', value: - 30 }, { stat: 'damage', type: 'more', value: 38 + lv * 0.5 } ] } );

// --- speed ----------------------------------------------------------------------------------

sup( { id: 'faster-attacks', name: 'Faster Attacks', tags: [ 'attack' ], manaMult: 1.15, color: '#ff9f7f',
	desc: '30% increased attack speed.',
	mods: ( lv ) => [ { stat: 'attack_speed', type: 'inc', value: 28 + lv * 0.5 } ] } );

sup( { id: 'faster-casting', name: 'Faster Casting', tags: [ 'spell' ], excludes: [ 'minion' ], manaMult: 1.2, color: '#9f9fff',
	desc: '30% increased cast speed.',
	mods: ( lv ) => [ { stat: 'cast_speed', type: 'inc', value: 28 + lv * 0.5 } ] } );

// --- added damage and conversion -------------------------------------------------------------

const added = ( id, name, type, ail, color, lo, hi ) => sup( { id, name, tags: [ 'attack', 'spell' ], excludes: [ 'minion', 'buff' ], manaMult: 1.25, color,
	desc: `Adds ${type} damage that grows with the skill's level; ${ail} chance.`,
	mods: ( lv ) => [
		{ stat: `added_${type}_min`, type: 'flat', value: lo * spellScale( lv ) },
		{ stat: `added_${type}_max`, type: 'flat', value: hi * spellScale( lv ) },
		{ stat: `${ail}_chance`, type: 'flat', value: 10 }
	] } );

added( 'added-fire', 'Added Fire Damage', 'fire', 'ignite', '#ff8a4a', 3, 6 );
added( 'added-cold', 'Added Cold Damage', 'cold', 'freeze', '#8fd8ff', 3, 5 );
added( 'added-lightning', 'Added Lightning Damage', 'lightning', 'shock', '#d0b0ff', 1, 9 );

const conversion = ( id, name, to, color ) => sup( { id, name, tags: [ 'attack', 'spell' ], excludes: [ 'minion', 'buff' ], manaMult: 1.2, color,
	desc: `Converts 60% of physical damage to ${to}. 10% more ${to} damage.`,
	mods: [ { stat: 'damage', type: 'more', value: 10, tags: [ to ] } ],
	transform: ( ctx ) => ctx.conversions.push( { from: 'physical', to, pct: 0.6 } ) } );

conversion( 'fire-conversion', 'Searing Edge', 'fire', '#ff8a4a' );
conversion( 'cold-conversion', 'Frozen Edge', 'cold', '#8fd8ff' );
conversion( 'lightning-conversion', 'Storm Edge', 'lightning', '#d0b0ff' );

// --- behaviour --------------------------------------------------------------------------------

sup( { id: 'ruthless', name: 'Ruthless', tags: [ 'melee' ], excludes: [ 'channel' ], manaMult: 1.2, color: '#ff7f7f',
	desc: 'Every third use is a ruthless blow: double damage and a long stun.',
	transform: ( ctx ) => ( ctx.ruthless = true ) } );

sup( { id: 'spell-echo', name: 'Spell Echo', tags: [ 'spell' ], excludes: [ 'channel', 'movement', 'minion', 'buff' ], manaMult: 1.4, color: '#9f9fff',
	desc: 'The spell repeats once. 10% less damage, 20% more cast speed.',
	mods: [ { stat: 'damage', type: 'more', value: - 10 }, { stat: 'cast_speed', type: 'more', value: 20 } ],
	transform: ( ctx ) => ( ctx.repeats += 1 ) } );

sup( { id: 'knockback', name: 'Knockback', tags: [ 'attack', 'spell' ], excludes: [ 'minion', 'buff' ], manaMult: 1.1, color: '#c0c0c0',
	desc: 'Hits knock enemies back much further.',
	mods: [ { stat: 'knockback', type: 'inc', value: 60 } ],
	transform: ( ctx ) => ( ctx.knockback += 6 ) } );

sup( { id: 'life-leech', name: 'Life Leech', tags: [ 'attack', 'spell' ], excludes: [ 'minion', 'buff' ], manaMult: 1.1, color: '#ff6060',
	desc: '2% of damage dealt is leeched as life.',
	mods: [ { stat: 'life_leech', type: 'flat', value: 2 } ] } );

sup( { id: 'increased-crit', name: 'Increased Critical Strikes', tags: [ 'attack', 'spell' ], excludes: [ 'buff' ], manaMult: 1.15, color: '#ffe066',
	desc: '+1% base critical strike chance, 80% increased critical strike chance, +20% critical multiplier.',
	mods: ( lv ) => [
		{ stat: 'crit_chance', type: 'flat', value: 1 },
		{ stat: 'crit_chance', type: 'inc', value: 78 + lv },
		{ stat: 'crit_multi', type: 'flat', value: 20 }
	] } );

sup( { id: 'cooldown-recovery', name: 'Cooldown Recovery', tags: [ 'movement', 'buff', 'minion', 'area', 'melee', 'projectile' ], manaMult: 1.1, color: '#a0ffd0',
	desc: '40% faster cooldown recovery.',
	mods: [ { stat: 'cooldown_recovery', type: 'inc', value: 40 } ] } );

sup( { id: 'elemental-proliferation', name: 'Elemental Proliferation', tags: [ 'fire', 'cold', 'lightning' ], excludes: [ 'buff', 'minion' ], manaMult: 1.3, color: '#ffb0ff',
	desc: 'Ignite, chill and shock spread to enemies within 3 m. 10% less damage, +10% to elemental ailment chances.',
	mods: [
		{ stat: 'damage', type: 'more', value: - 10 }, { stat: 'ignite_chance', type: 'flat', value: 10 },
		{ stat: 'chill_chance', type: 'flat', value: 10 }, { stat: 'shock_chance', type: 'flat', value: 10 }
	],
	transform( ctx ) {

		ctx.prolif = 3;
		ctx.onHit.push( ( world, src, tgt, r, hit ) => {

			for ( const id of [ 'ignite', 'chill', 'shock' ] ) {

				const s = tgt.statuses.get( id );
				// only ailments this very hit refreshed (s.data.hit is the template)
				if ( ! s || ( s.data.hit && s.data.hit !== hit ) ) continue;
				for ( const o of world.enemiesOf( src, tgt.x, tgt.z, ctx.prolif ) ) {

					if ( o !== tgt ) world.applyStatus( o, id, { ...s.data, hit: null, source: src } );

				}

			}

		} );

	} } );

sup( { id: 'melee-splash', name: 'Melee Splash', tags: [ 'melee' ], excludes: [ 'channel' ], manaMult: 1.3, color: '#ff9f7f',
	desc: 'The first enemy hit by each swing splashes 60% of the damage to enemies around it.',
	transform: ( ctx ) => ( ctx.splash = 0.6 ) } );

sup( { id: 'culling-strike', name: 'Culling Strike', tags: [ 'attack', 'spell' ], excludes: [ 'buff', 'minion' ], manaMult: 1.1, color: '#c0a0ff',
	desc: 'Enemies left below 10% life by a hit are killed outright.',
	transform( ctx ) {

		ctx.cull = 0.1;
		ctx.onHit.push( ( world, src, tgt ) => {

			if ( tgt.alive && tgt.kind !== 'boss' && tgt.life < tgt.maxLife * ctx.cull ) world.kill( tgt, src );

		} );

	} } );

sup( { id: 'controlled-destruction', name: 'Controlled Destruction', tags: [ 'spell' ], excludes: [ 'buff', 'minion' ], manaMult: 1.3, color: '#9f9fff',
	desc: '35% more spell damage, 100% reduced critical strike chance.',
	mods: ( lv ) => [ { stat: 'damage', type: 'more', value: 33 + lv * 0.5 }, { stat: 'crit_chance', type: 'inc', value: - 100 } ] } );

sup( { id: 'brutality', name: 'Brutality', tags: [ 'attack', 'spell' ], excludes: [ 'buff', 'minion' ], manaMult: 1.3, color: '#d0d0d0',
	desc: '45% more physical damage; the skill deals no elemental damage.',
	mods: ( lv ) => [
		{ stat: 'damage', type: 'more', value: 43 + lv * 0.5, tags: [ 'physical' ] },
		{ stat: 'damage', type: 'more', value: - 100, tags: [ 'fire' ] },
		{ stat: 'damage', type: 'more', value: - 100, tags: [ 'cold' ] },
		{ stat: 'damage', type: 'more', value: - 100, tags: [ 'lightning' ] }
	] } );

sup( { id: 'minion-damage', name: 'Minion Damage', tags: [ 'minion' ], manaMult: 1.3, color: '#b0ffb0',
	desc: 'Minions deal 40% more damage.',
	mods: ( lv ) => [ { stat: 'minion_damage', type: 'more', value: 38 + lv * 0.5 } ] } );

sup( { id: 'longer-duration', name: 'Increased Duration', tags: [ 'buff', 'minion', 'area' ], manaMult: 1.2, color: '#a0d0ff',
	desc: '50% increased skill effect duration.',
	mods: [ { stat: 'duration', type: 'inc', value: 50 } ] } );
