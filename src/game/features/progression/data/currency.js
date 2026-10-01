// CURRENCY: crafting orbs. They drop from monsters, stack in the currency pouch
// ( save.currencies ) and are applied to items at the Blacksmith ( craft panel ).
// Each orb is a def with a guard and an effect, so a new crafting rule is one define():
//
//   define( 'currency', { id, name, desc, weight (drop), level (min area level), color,
//     can( item, base ) -> null | 'why not', apply( item, rng ) } )
//
// The PoE ladder: Transmute (white -> blue), Alteration (reroll blue), Augment (add to
// blue), Regal (blue -> yellow), Alchemy (white -> yellow), Chaos (reroll yellow),
// Exalted (add to yellow), Annulment (remove one), Scouring (back to white), Divine
// (reroll numbers), Chance (gamble a white), Vaal (corrupt: unpredictable, final).

import { define, all } from '../../../core/registry.js';
import { addAffix, fillAffixes, openSlots, rerollValues, touch, rareName, makeUnique } from '../items.js';

const notCorrupted = ( item ) => item.corrupted ? 'Corrupted items cannot be modified' : null;
const needRarity = ( item, ...r ) => r.includes( item.rarity ) ? null : `Requires a ${r.join( ' or ' )} item`;
const noFlask = ( base, ...r ) => base.slot === 'flask' && r.includes( 'rare' ) ? 'Flasks cannot be rare' : null;

function C( def ) {

	define( 'currency', { tags: [ 'currency' ], weight: 1, level: 1, ...def } );

}

C( { id: 'transmute', name: 'Orb of Transmutation', short: 'Transmute', color: '#9fc4ff', weight: 400,
	desc: 'Upgrades a normal item to a magic item',
	can: ( item ) => notCorrupted( item ) || needRarity( item, 'normal' ),
	apply( item, rng ) {

		item.rarity = 'magic';
		fillAffixes( item, rng );

	} } );
C( { id: 'alteration', name: 'Orb of Alteration', short: 'Alteration', color: '#7aa7ff', weight: 300,
	desc: 'Rerolls the modifiers of a magic item',
	can: ( item ) => notCorrupted( item ) || needRarity( item, 'magic' ),
	apply( item, rng ) {

		fillAffixes( item, rng );

	} } );
C( { id: 'augment', name: 'Orb of Augmentation', short: 'Augment', color: '#5a8cff', weight: 200,
	desc: 'Adds a random modifier to a magic item with an open slot',
	can: ( item ) => notCorrupted( item ) || needRarity( item, 'magic' ) || ( item.affixes.length >= 2 ? 'The item has no open modifier slot' : null ),
	apply( item, rng ) {

		const kind = openSlots( item, 'prefix' ) ? 'prefix' : 'suffix';
		addAffix( item, kind, rng );
		touch( item );

	} } );
C( { id: 'regal', name: 'Regal Orb', short: 'Regal', color: '#ffd84d', weight: 40, level: 8,
	desc: 'Upgrades a magic item to a rare item, adding a modifier',
	can: ( item, base ) => notCorrupted( item ) || needRarity( item, 'magic' ) || noFlask( base, 'rare' ),
	apply( item, rng ) {

		item.rarity = 'rare';
		item.name = rareName( item, rng );
		const kinds = [ 'prefix', 'suffix' ].filter( ( k ) => openSlots( item, k ) > 0 );
		addAffix( item, rng.pick( kinds ), rng );
		touch( item );

	} } );
C( { id: 'alchemy', name: 'Orb of Alchemy', short: 'Alchemy', color: '#ffe066', weight: 60, level: 5,
	desc: 'Upgrades a normal item to a rare item',
	can: ( item, base ) => notCorrupted( item ) || needRarity( item, 'normal' ) || noFlask( base, 'rare' ),
	apply( item, rng ) {

		item.rarity = 'rare';
		fillAffixes( item, rng );

	} } );
C( { id: 'chaos', name: 'Chaos Orb', short: 'Chaos', color: '#d0a040', weight: 40, level: 12,
	desc: 'Rerolls a rare item with new random modifiers',
	can: ( item ) => notCorrupted( item ) || needRarity( item, 'rare' ),
	apply( item, rng ) {

		fillAffixes( item, rng );

	} } );
C( { id: 'exalt', name: 'Exalted Orb', short: 'Exalt', color: '#fff2b0', weight: 8, level: 30,
	desc: 'Adds a random modifier to a rare item',
	can: ( item ) => notCorrupted( item ) || needRarity( item, 'rare' ) || ( item.affixes.length >= 6 ? 'The item already has 6 modifiers' : null ),
	apply( item, rng ) {

		const kinds = [ 'prefix', 'suffix' ].filter( ( k ) => openSlots( item, k ) > 0 );
		addAffix( item, rng.pick( kinds ), rng );
		touch( item );

	} } );
C( { id: 'annul', name: 'Orb of Annulment', short: 'Annul', color: '#e8e8ff', weight: 12, level: 20,
	desc: 'Removes a random modifier from a magic or rare item',
	can: ( item ) => notCorrupted( item ) || needRarity( item, 'magic', 'rare' ) || ( item.affixes.length ? null : 'The item has no modifiers' ),
	apply( item, rng ) {

		item.affixes.splice( rng.int( 0, item.affixes.length - 1 ), 1 );
		touch( item );

	} } );
C( { id: 'scour', name: 'Orb of Scouring', short: 'Scour', color: '#c8c8c8', weight: 60, level: 3,
	desc: 'Removes all modifiers, turning a magic or rare item normal',
	can: ( item ) => notCorrupted( item ) || needRarity( item, 'magic', 'rare' ),
	apply( item ) {

		item.rarity = 'normal';
		item.affixes = [];
		delete item.name;
		touch( item );

	} } );
C( { id: 'divine', name: 'Divine Orb', short: 'Divine', color: '#ffffff', weight: 6, level: 25,
	desc: 'Rerolls the numeric values of every modifier (uniques included)',
	can: ( item ) => notCorrupted( item ) || needRarity( item, 'magic', 'rare', 'unique' ),
	apply( item, rng ) {

		rerollValues( item, rng );

	} } );
C( { id: 'chance', name: 'Orb of Chance', short: 'Chance', color: '#c0a0ff', weight: 50, level: 4,
	desc: 'Upgrades a normal item to a random rarity - sometimes even unique',
	can: ( item ) => notCorrupted( item ) || needRarity( item, 'normal' ),
	apply( item, rng ) {

		const roll = rng.next();
		if ( roll < 0.04 ) {

			// only uniques on this exact base qualify
			const same = rng.weighted( all( 'unique' ).filter( ( u ) => u.base === item.base ), ( u ) => u.weight ?? 1 );
			if ( same ) {

				Object.assign( item, makeUnique( same.id, item.ilvl, rng ), { uid: item.uid } );
				return;

			}

		}

		item.rarity = roll < 0.3 ? 'rare' : 'magic';
		fillAffixes( item, rng );

	} } );

// --- corruption ---------------------------------------------------------------------------------
// Outcomes: nothing (25%), a corrupted implicit (30%), reroll as a 6-mod rare (20%),
// one modifier empowered 25% past its range (15%), brick: modifiers gone / unique
// values cut by 20% (10%).
export const CORRUPT_IMPLICITS = [
	{ stat: 'skill_level', type: 'flat', value: 1, slots: [ 'amulet', 'weapon', 'helm' ] },
	{ stat: 'max_res_fire', type: 'flat', value: 1, slots: [ 'chest', 'offhand' ] },
	{ stat: 'max_res_cold', type: 'flat', value: 1, slots: [ 'chest', 'offhand' ] },
	{ stat: 'max_res_lightning', type: 'flat', value: 1, slots: [ 'chest', 'offhand' ] },
	{ stat: 'move_speed', type: 'inc', range: [ 10, 15 ], slots: [ 'boots' ] },
	{ stat: 'crit_chance', type: 'inc', range: [ 20, 30 ], slots: [ 'weapon', 'amulet', 'ring', 'gloves' ] },
	{ stat: 'life', type: 'inc', range: [ 4, 8 ], slots: [ 'chest', 'belt', 'amulet', 'ring' ] },
	{ stat: 'area', type: 'inc', range: [ 10, 15 ], slots: [ 'helm', 'amulet', 'weapon' ] },
	{ stat: 'projectile_count', type: 'flat', value: 1, slots: [ 'weapon', 'offhand' ] },
	{ stat: 'damage', type: 'inc', range: [ 10, 20 ], slots: [ 'weapon', 'gloves', 'ring', 'amulet', 'offhand' ] },
	{ stat: 'attack_speed', type: 'inc', range: [ 6, 10 ], slots: [ 'gloves', 'weapon', 'ring' ] },
	{ stat: 'cast_speed', type: 'inc', range: [ 6, 10 ], slots: [ 'weapon', 'amulet', 'ring', 'offhand' ] },
	{ stat: 'res_chaos', type: 'flat', range: [ 15, 25 ], slots: [ 'helm', 'chest', 'gloves', 'boots', 'belt', 'ring', 'amulet', 'offhand' ] },
	{ stat: 'dodge_cooldown', type: 'inc', range: [ - 15, - 10 ], slots: [ 'boots', 'belt' ] },
	{ stat: 'life_leech', type: 'flat', range: [ 0.5, 1 ], tags: [ 'attack' ], slots: [ 'gloves', 'weapon', 'ring' ] }
];

C( { id: 'vaal', name: 'Vaal Orb', short: 'Vaal', color: '#d04040', weight: 10, level: 15,
	desc: 'Corrupts an item with an unpredictable outcome. Corrupted items cannot be modified further',
	can: ( item ) => notCorrupted( item ),
	apply( item, rng, base ) {

		item.corrupted = true;
		const r = rng.next();
		const slot = base.slot === 'ring' ? 'ring' : base.slot;
		if ( r < 0.25 ) {

			item.corruptOutcome = 'unchanged';

		} else if ( r < 0.55 ) {

			const pool = CORRUPT_IMPLICITS.filter( ( c ) => c.slots.includes( slot ) );
			const c = rng.pick( pool.length ? pool : CORRUPT_IMPLICITS );
			const v = c.range ? ( Number.isInteger( c.range[ 0 ] ) ? rng.int( c.range[ 0 ], c.range[ 1 ] ) : Math.round( rng.range( c.range[ 0 ], c.range[ 1 ] ) * 10 ) / 10 ) : c.value;
			item.implicits = [ { stat: c.stat, type: c.type, value: v, tags: c.tags, corrupt: true } ];
			item.corruptOutcome = 'implicit';

		} else if ( r < 0.75 && item.rarity !== 'unique' && base.slot !== 'flask' ) {

			item.rarity = 'rare';
			item.name = rareName( item, rng );
			item.affixes = [];
			for ( let i = 0; i < 6; i ++ ) addAffix( item, i % 2 ? 'suffix' : 'prefix', rng );
			item.corruptOutcome = 'rerolled';

		} else if ( r < 0.9 && item.affixes.length ) {

			// one modifier is pushed 25% past its tier's range
			const x = rng.pick( item.affixes );
			x.values = x.values.map( ( v ) => Number.isInteger( v ) ? Math.round( v * 1.25 ) : Math.round( v * 125 ) / 100 );
			item.corruptOutcome = 'empowered';

		} else {

			if ( item.rarity !== 'unique' ) {

				item.affixes = [];
				item.rarity = 'normal';
				delete item.name;

			} else item.uvals = item.uvals?.map( ( v ) => Number.isInteger( v ) ? Math.round( v * 0.8 ) : Math.round( v * 80 ) / 100 );
			item.corruptOutcome = 'bricked';

		}

		touch( item );

	} } );
