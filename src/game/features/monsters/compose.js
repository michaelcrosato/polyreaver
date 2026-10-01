// Procedural composition - why the game never runs out of monsters.
//
// Designed families and bosses are DATA in a fixed shape; the composer produces
// the same shape from a seed and a depth, the way Spore assembles a creature from
// parts: pick an element and a body plan, give the body behaviours its plan can
// support, give the behaviours verbs that suit the element, paint it, name it.
// Because every system downstream (factory, brain, director, renderer, agent
// tools) only ever reads the shape, depth 500 needs no new code.
//
//   composeFamily( seed, depth, { element?, plan?, mechanics? } ) -> monsterFamily def (registered)
//   composeBoss( seed, depth, { family?, mechanics? } )           -> boss def (registered)
//   remixBoss( baseBoss, seed, depth )                             -> a designed boss, ascended
//
// Same seed + depth -> same result, in the browser, in Node and in agent tools.

import { define, get, all } from '../../core/registry.js';
import { RNG, hash2 } from '../../core/rng.js';
import { familyName, bossName, ROLE_WORD } from './names.js';
import { rollAffixes, resolveFamily } from './factory.js';
import { patternsFor } from './patterns.js';

export const ELEMENT_LIST = [ 'physical', 'fire', 'cold', 'lightning', 'chaos' ];
const ELEMENT_TAGS = [ 'fire', 'cold', 'lightning', 'chaos' ];

// Which behaviours a body plan can carry (a blob makes a poor assassin).
export const PLAN_ARCHETYPES = {
	biped: [ 'brawler', 'brute', 'charger', 'skirmisher', 'kiter', 'caster', 'summoner', 'tank', 'assassin', 'support' ],
	quadruped: [ 'brawler', 'charger', 'skirmisher', 'brute', 'kiter' ],
	hexapod: [ 'brawler', 'charger', 'tank', 'burrower', 'swarmer', 'kiter' ],
	serpent: [ 'brawler', 'burrower', 'kiter', 'caster' ],
	floater: [ 'caster', 'kiter', 'turret', 'summoner', 'support', 'swarmer' ],
	blob: [ 'brute', 'exploder', 'summoner', 'brawler' ],
	arachnid: [ 'assassin', 'swarmer', 'brawler', 'burrower', 'kiter' ],
	avian: [ 'skirmisher', 'swarmer', 'charger', 'kiter' ]
};

const HEAVY_CORE = new Set( [ 'charger', 'brute', 'assassin', 'exploder' ] );
const PLAN_SIZE = { biped: [ 0.9, 1.15 ], quadruped: [ 0.85, 1.1 ], hexapod: [ 0.8, 1.1 ], serpent: [ 0.9, 1.2 ], floater: [ 0.75, 1 ], blob: [ 0.75, 1.1 ], arachnid: [ 0.7, 1.05 ], avian: [ 0.7, 1 ] };
const PLAN_PARTS = {
	biped: [ 'horns', 'armored', 'helm', 'claws', 'tusks', 'bones', 'robes', 'mask' ], quadruped: [ 'horns', 'spikes', 'fur', 'tail', 'tusks', 'scales' ],
	hexapod: [ 'shell', 'mandibles', 'stinger', 'spikes', 'wings' ], serpent: [ 'scales', 'fins', 'fangs', 'horns', 'segments' ],
	floater: [ 'eyes', 'tendrils', 'rings', 'crystal', 'eye' ], blob: [ 'mouth', 'eyes', 'warts', 'sac', 'teeth', 'drips' ],
	arachnid: [ 'eyes', 'fangs', 'crystal', 'shell', 'spikes' ], avian: [ 'wings', 'beak', 'crest', 'talons', 'tail' ]
};
const ELEMENT_PARTS = { fire: [ 'glow', 'horns' ], cold: [ 'crystal', 'fur' ], lightning: [ 'coil', 'glow', 'metal' ], chaos: [ 'eyes', 'tendrils' ], physical: [ 'armored', 'bones' ] };
const ELEMENT_HUE = { fire: [ 5, 35 ], cold: [ 185, 215 ], lightning: [ 250, 290 ], chaos: [ 85, 130 ], physical: [ 20, 50 ] };

// --- colour ---------------------------------------------------------------------------

function hsl( h, s, l ) {

	h = ( ( h % 360 ) + 360 ) % 360; s /= 100; l /= 100;
	const k = ( n ) => ( n + h / 30 ) % 12, a = s * Math.min( l, 1 - l );
	const f = ( n ) => Math.round( 255 * ( l - a * Math.max( - 1, Math.min( k( n ) - 3, 9 - k( n ), 1 ) ) ) );
	return '#' + [ f( 0 ), f( 8 ), f( 4 ) ].map( ( v ) => v.toString( 16 ).padStart( 2, '0' ) ).join( '' );

}

// A palette in the creature palette shape, keyed off the element's hue band.
export function composePalette( rng, element ) {

	const [ h0, h1 ] = ELEMENT_HUE[ element ] || ELEMENT_HUE.physical;
	const h = rng.range( h0, h1 ), sat = element === 'physical' ? rng.range( 10, 30 ) : rng.range( 35, 70 );
	const comp = h + 180 + rng.range( - 30, 30 );
	return {
		primary: hsl( h, sat, rng.range( 28, 45 ) ), secondary: hsl( h + rng.range( - 20, 20 ), sat * 0.7, rng.range( 14, 24 ) ),
		accent: hsl( comp, 70, 62 ), skin: hsl( h + 10, sat * 0.8, rng.range( 45, 60 ) ), metal: hsl( h, 8, rng.range( 45, 62 ) ),
		glow: hsl( element === 'physical' ? comp : h, 95, 62 ), dark: hsl( h, 25, 7 )
	};

}

// Abilities suited to an archetype and an element ( element-tagged verbs only for that element ).
function verbsFor( arch, element ) {

	return all( 'monsterAbility' ).filter( ( a ) => a.roles.some( ( r ) => arch.roles.includes( r ) ) &&
		! ( arch.core || [] ).includes( a.id ) && ! [ 'fuse', 'burrow' ].includes( a.id ) &&
		! a.tags.some( ( t ) => ELEMENT_TAGS.includes( t ) && t !== element ) );

}

// --- families ---------------------------------------------------------------------------------

export function composeFamily( seed, depth = 1, { element = null, plan = null, mechanics = [], idPrefix = 'proc' } = {} ) {

	const id = `${idPrefix}-${hash2( seed, depth ).toString( 36 )}`;
	const existing = get( 'monsterFamily', id );
	if ( existing ) return existing;
	const rng = new RNG( `family:${seed}:${depth}` );
	element = element || rng.pick( ELEMENT_LIST );
	plan = plan || rng.pick( Object.keys( PLAN_ARCHETYPES ) );

	// 1-3 behaviours this body can carry; deeper families field more of them
	const options = PLAN_ARCHETYPES[ plan ].filter( ( a ) => get( 'archetype', a ) );
	const nArch = Math.min( options.length, 1 + ( rng.chance( 0.65 ) ? 1 : 0 ) + ( depth > 30 && rng.chance( 0.4 ) ? 1 : 0 ) );
	const picks = rng.shuffle( options.slice() ).slice( 0, nArch );
	// archetypes whose core verb is a heavy (charge, slam, blink strike, detonate) are
	// spice, never the bulk: like the designed Slag Hounds (brawler 3 : charger 1),
	// a composed family always leads with a plain behaviour
	if ( HEAVY_CORE.has( picks[ 0 ] ) ) {

		const plain = options.find( ( a ) => ! HEAVY_CORE.has( a ) && ! picks.includes( a ) ) || options.find( ( a ) => ! HEAVY_CORE.has( a ) );
		if ( plain ) {

			if ( picks.includes( plain ) ) picks.splice( picks.indexOf( plain ), 1 );
			picks.unshift( plain );

		}

	}

	const archetypes = {};
	picks.forEach( ( a, i ) => {

		archetypes[ a ] = i === 0 ? 3 : HEAVY_CORE.has( a ) ? 1 : rng.int( 1, 2 );

	} );

	// verbs: per archetype, 1-2 (+1 past depth 20, +1 past 60) suited to the element
	const extra = 1 + ( depth > 20 ? 1 : 0 ) + ( depth > 60 ? 1 : 0 );
	const abilities = new Set();
	for ( const a of picks ) {

		const pool = verbsFor( get( 'archetype', a ), element );
		rng.shuffle( pool );
		for ( const ab of pool.slice( 0, rng.int( 1, extra ) ) ) abilities.add( ab.id );

	}

	const [ s0, s1 ] = PLAN_SIZE[ plan ];
	const swarmOnly = picks.length === 1 && picks[ 0 ] === 'swarmer';
	const tagsPool = rng.shuffle( [ ...( PLAN_PARTS[ plan ] || [] ), ...( ELEMENT_PARTS[ element ] || [] ) ] );
	const name = familyName( rng, { element, plan } );
	const affixPool = rollAffixes( rng, 2, { level: depth, family: { element } } );
	const def = define( 'monsterFamily', {
		id, name, element, procedural: true, level: 1, depths: [ depth ], seed, mechanics,
		tags: [ 'procedural', element, plan ], desc: `A ${name.toLowerCase()} brood from depth ${depth}.`,
		genome: { plans: [ plan ], size: swarmOnly ? [ s0 * 0.6, s1 * 0.6 ] : [ s0, s1 ], tags: tagsPool.slice( 0, rng.int( 2, 4 ) ) },
		palette: composePalette( rng, element ), archetypes, archetypeList: picks, abilities: [ ...abilities ], affixPool,
		stats: { life: rng.range( 0.9, 1.15 ), damage: rng.range( 0.92, 1.12 ), speed: rng.range( 0.92, 1.12 ) },
		pack: swarmOnly ? [ 6, 10 ] : [ 3, 5 ], weight: 1,
		memberNames: Object.fromEntries( picks.map( ( a ) => [ a, ROLE_WORD[ a ] || name.split( ' ' ).pop() ] ) )
	} );
	return def;

}

// --- bosses -----------------------------------------------------------------------------------

const INTRO = [
	( n ) => `${n} has waited down here longer than the stairs.`,
	( n ) => `The deep made ${n}. Now ${n} makes the deep.`,
	( n ) => `Nothing that reached ${n} ever climbed back up.`,
	( n ) => `${n} remembers every hero. None of them fondly.`,
	( n ) => `They sealed ${n} in. You opened the door.`
];

// Patterns that fit a body/element: tags of the element, the plan and the
// archetypes, plus generic ones; signature patterns only when the level's
// mechanic matches. Each phase keeps 1-2 patterns and learns 1-2 new ones, so a
// procedural fight escalates the way a designed one does.
export function composeBoss( seed, depth = 13, { family = null, mechanics = [] } = {} ) {

	const id = `proc-boss-${hash2( seed, depth ).toString( 36 )}`;
	const existing = get( 'boss', id );
	if ( existing ) return existing;
	const rng = new RNG( `boss:${seed}:${depth}` );
	const fam = family ? resolveFamily( family ) : composeFamily( `${seed}:boss`, depth, { mechanics } );
	const plan = rng.pick( fam.genome?.plans || [ 'biped' ] );
	const element = fam.element || 'physical';
	const archTags = Object.keys( fam.archetypes || {} ).flatMap( ( a ) => get( 'archetype', a )?.tags || [] );
	const pool = patternsFor( { tags: [ element, plan, ...archTags ], mechanics } );
	const signature = pool.filter( ( p ) => p.tags.includes( 'signature' ) );
	const generic = rng.shuffle( pool.filter( ( p ) => ! p.tags.includes( 'signature' ) ) );
	const nPhases = Math.min( 4, 2 + ( depth >= 25 ? 1 : 0 ) + ( depth >= 60 ? 1 : 0 ) );
	const phases = [];
	let known = [];
	const take = () => ( signature.length && rng.chance( 0.5 ) ? signature.shift() : generic.shift() ) || generic[ 0 ] || pool[ 0 ];
	for ( let i = 0; i < nPhases; i ++ ) {

		const learn = i === 0 ? 3 : rng.int( 1, 2 );
		const fresh = [];
		for ( let k = 0; k < learn; k ++ ) {

			const p = take();
			if ( p && ! fresh.includes( p.id ) ) fresh.push( p.id );

		}

		known = [ ...rng.shuffle( known ).slice( 0, i === 0 ? 0 : 2 ), ...fresh ];
		const patterns = known.map( ( pid ) => ELEMENTAL.has( pid ) ? { id: pid, element } : pid );
		const at = i === 0 ? 1 : +( 1 - i / nPhases ).toFixed( 2 );
		const adds = i > 0 && rng.chance( 0.6 ) ? { family: fam.id, count: 2 + i, every: i === nPhases - 1 ? 16 + rng.int( 0, 6 ) : 0 } : null;
		if ( adds && ! adds.every ) delete adds.every;
		phases.push( { at, name: PHASE_NAMES[ Math.min( PHASE_NAMES.length - 1, i ) ][ rng.int( 0, 2 ) ], patterns, adds } );

	}

	const { name, title } = bossName( rng, { element, plan } );
	const affixes = rollAffixes( rng, 1 + ( depth >= 30 ? 1 : 0 ) + ( depth >= 80 ? 1 : 0 ), { level: depth, family: fam, boss: true } );
	const melee = [ 'slam', 'strike', 'bite', 'claw', 'stomp', 'cleave', 'tail-sweep' ].filter( ( a ) => ( fam.abilities || [] ).includes( a ) );
	const def = define( 'boss', {
		id, name, title, depth, level: depth, procedural: true, seed, mechanic: mechanics[ 0 ] || null, tags: [ 'procedural', element, plan, ...mechanics ],
		desc: `A procedural ${plan} tyrant of ${element}, composed for depth ${depth}.`,
		element, minion: fam.id, archetype: 'brute', range: [ 0, 4 ], gap: [ 1.0, 1.7 ], enrage: 170,
		genome: { plan, size: +rng.range( 2.5, 4 ).toFixed( 2 ), tags: [ ...( fam.genome?.tags || [] ), 'crown' ], palette: fam.palette },
		stats: { life: 30 + Math.min( 30, depth * 0.3 ), damage: 1.5 + Math.min( 0.6, depth * 0.005 ), speed: rng.range( 0.9, 1.05 ) },
		abilities: melee.length ? melee.slice( 0, 2 ) : [ 'strike' ], affixes, phases,
		intro: { text: rng.pick( INTRO )( name ) }
	} );
	return def;

}

const ELEMENTAL = new Set( [ 'bullet-spiral', 'bullet-nova', 'eruptions', 'meteor-rain', 'breath-cone', 'shard-fan', 'mortar-barrage' ] );
const PHASE_NAMES = [ [ 'Awakening', 'Stirring', 'Wrath' ], [ 'Fury', 'Unbound', 'Frenzy' ], [ 'Cataclysm', 'Desperation', 'Ruin' ], [ 'Oblivion', 'Endgame', 'Last Breath' ] ];

// Depth 13-20 combination levels reuse a designed boss, ascended: stronger, an
// affix or two, one more phase built from its own patterns plus a new one.
export function remixBoss( base, seed, depth ) {

	const b = typeof base === 'string' ? get( 'boss', base ) : base;
	if ( ! b ) return null;
	const id = `remix-${b.id}-${depth}`;
	const existing = get( 'boss', id );
	if ( existing ) return existing;
	const rng = new RNG( `remix:${seed}:${depth}:${b.id}` );
	const pool = patternsFor( { tags: [ b.element, b.genome?.plan ] } ).map( ( p ) => p.id );
	const last = b.phases[ b.phases.length - 1 ];
	const phases = b.phases.map( ( p ) => ( { ...p, at: p.at === 1 ? 1 : +( p.at * 0.85 + 0.1 ).toFixed( 2 ) } ) );
	phases.push( { at: 0.2, name: 'Ascended', patterns: [ ...last.patterns.slice( 0, 2 ), rng.pick( pool ) ], adds: last.adds } );
	return define( 'boss', {
		...b, id, title: `${b.title}, Ascended`, depth, level: depth, remix: b.id, phases,
		stats: { ...b.stats, life: ( b.stats?.life ?? 30 ) * 1.15, damage: ( b.stats?.damage ?? 1.5 ) * 1.1 },
		affixes: [ ...( b.affixes || [] ), ...rollAffixes( rng, 1 + ( depth >= 17 ? 1 : 0 ), { level: depth, family: { element: b.element }, boss: true } ) ]
	} );

}
