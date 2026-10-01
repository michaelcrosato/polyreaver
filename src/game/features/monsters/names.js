// Name generator for monsters, rares, uniques, procedural families and bosses.
// Names are assembled from small word banks keyed by ELEMENT (what it feels like)
// and BODY PLAN / ROLE (what it is), so a generated "Rime Skitterer" or "Vorzhul,
// the Ashen Tyrant" always matches the creature you see. Seeded: the same rng
// state gives the same name in the browser, in Node and in agent tools.

const FLAVOR = {
	fire: { adj: [ 'Ashen', 'Cinder', 'Molten', 'Scorched', 'Ember', 'Smoldering', 'Brimstone', 'Slag' ], noun: [ 'brand', 'pyre', 'coal', 'blaze', 'scorch', 'cinder', 'flare', 'ash' ] },
	cold: { adj: [ 'Rime', 'Frost', 'Hoar', 'Glacial', 'Bitter', 'Pale', 'Frozen', 'Sleet' ], noun: [ 'fang', 'shard', 'gale', 'rime', 'chill', 'sleet', 'frost', 'hoar' ] },
	lightning: { adj: [ 'Storm', 'Static', 'Thunder', 'Volt', 'Arc', 'Crackling', 'Galvanic', 'Tempest' ], noun: [ 'bolt', 'spark', 'coil', 'surge', 'flash', 'arc', 'volt', 'storm' ] },
	chaos: { adj: [ 'Blight', 'Rot', 'Venom', 'Void', 'Plague', 'Gloom', 'Hollow', 'Bile' ], noun: [ 'maw', 'spore', 'bile', 'husk', 'rot', 'gloom', 'blight', 'void' ] },
	physical: { adj: [ 'Iron', 'Bone', 'Grim', 'Stone', 'Rust', 'Blood', 'Gore', 'Crag' ], noun: [ 'jaw', 'claw', 'skull', 'hide', 'tusk', 'bone', 'gore', 'crag' ] }
};

const PLAN_NOUN = {
	biped: [ 'Stalker', 'Brute', 'Husk', 'Fiend', 'Ghoul', 'Reaver', 'Revenant', 'Hulk' ],
	quadruped: [ 'Hound', 'Prowler', 'Beast', 'Boar', 'Mauler', 'Wolf' ],
	hexapod: [ 'Crawler', 'Mantis', 'Scuttler', 'Beetle', 'Drone', 'Tick' ],
	serpent: [ 'Wyrm', 'Serpent', 'Eel', 'Coil', 'Lurker', 'Worm' ],
	floater: [ 'Wisp', 'Eye', 'Drifter', 'Jelly', 'Shade', 'Lantern' ],
	blob: [ 'Ooze', 'Slime', 'Bloat', 'Mass', 'Gob', 'Sludge' ],
	arachnid: [ 'Spider', 'Weaver', 'Skitterer', 'Broodling', 'Lurker' ],
	avian: [ 'Harpy', 'Shrike', 'Raptor', 'Screecher', 'Wing' ]
};

// Archetype role words, used when a family fields several archetypes so the
// player can tell the spitter from the brawler by name.
export const ROLE_WORD = {
	brawler: '', brute: 'Brute', charger: 'Charger', skirmisher: 'Raider', kiter: 'Spitter', caster: 'Seer',
	summoner: 'Broodcaller', exploder: 'Bloater', tank: 'Bulwark', assassin: 'Stalker', swarmer: 'Swarmling',
	support: 'Mender', turret: 'Totem', burrower: 'Burrower'
};

const EPITHET = [ 'Hungry', 'Relentless', 'Defiler', 'Unbroken', 'Cruel', 'Wretched', 'Flayer', 'Devourer', 'Butcher',
	'Ravager', 'Unseen', 'Shrieker', 'Mauler', 'Tormentor', 'Vile', 'Unyielding', 'Bloodied', 'Gnasher', 'Hollow-Eyed', 'Fleshrender' ];

const ONSET = [ 'ka', 'vor', 'zul', 'mor', 'gra', 'thra', 'ske', 'vex', 'dru', 'nar', 'ul', 'az', 'bel', 'cor', 'gor', 'kra', 'mal', 'ny', 'or', 'py', 'rha', 'sol', 'tor', 'ur', 'xa', 'yl', 'zer', 'sha', 'bra', 'vel' ];
const MID = [ 'ra', 'go', 'ma', 'li', 'the', 'ze', 'va', 'do', 'ri', 'xa', 'ka', 'mo', 'nu', 'zha', 'ru' ];
const CODA = [ 'th', 'x', 'gul', 'rak', 'mor', 'zar', 'nok', 'ra', 'ys', 'oth', 'ix', 'ul', 'ane', 'esh', 'orn', 'agg', 'iel', 'us' ];

const TITLE_NOUN = {
	biped: [ 'Tyrant', 'Warlord', 'Sovereign', 'Executioner', 'Colossus', 'Hierophant' ],
	quadruped: [ 'Alpha', 'Devourer', 'Great Beast', 'Packlord' ],
	hexapod: [ 'Hive Lord', 'Carapace King', 'Swarm Tyrant' ],
	serpent: [ 'Wyrm', 'Constrictor', 'Leviathan' ],
	floater: [ 'Oracle', 'Watcher', 'Specter', 'Lantern King' ],
	blob: [ 'Matriarch', 'Glutton', 'Bloated King' ],
	arachnid: [ 'Broodmother', 'Weaver Queen', 'Silk Tyrant' ],
	avian: [ 'Sky Tyrant', 'Storm Wing', 'Carrion Queen' ]
};

const cap = ( s ) => s.charAt( 0 ).toUpperCase() + s.slice( 1 );
const flavor = ( element ) => FLAVOR[ element ] || FLAVOR.physical;

// A pronounceable made-up word: "Vorzhul", "Krathe", "Zermorix".
export function properName( rng, syllables = rng.int( 2, 3 ) ) {

	let s = rng.pick( ONSET );
	for ( let i = 2; i < syllables; i ++ ) s += rng.pick( MID );
	s += rng.pick( CODA );
	if ( s.length > 4 && rng.chance( 0.15 ) ) s = s.slice( 0, 3 ) + '\'' + s.slice( 3 );
	return cap( s );

}

// Procedural family: "Cinder Prowler", "Rime Skitterer".
export function familyName( rng, { element = 'physical', plan = 'biped' } = {} ) {

	return `${rng.pick( flavor( element ).adj )} ${rng.pick( PLAN_NOUN[ plan ] || PLAN_NOUN.biped )}`;

}

// Name for one member of a family: the family name plus its role word when the
// family mixes archetypes ("Cinder Prowler Spitter" reads badly, so role words
// replace the body noun when there is one).
export function memberName( family, archetype ) {

	const word = family.memberNames?.[ archetype ] ?? ROLE_WORD[ archetype ];
	if ( ! word || ( family.archetypeList?.length ?? 1 ) < 2 ) return family.name;
	const parts = family.name.split( ' ' );
	return parts.length > 1 ? `${parts.slice( 0, - 1 ).join( ' ' )} ${word}` : `${family.name} ${word}`;

}

// Rare monster: "Ashjaw the Relentless" (Diablo-style two-part rare names).
export function rareName( rng, element = 'physical' ) {

	const f = flavor( element );
	return `${rng.pick( f.adj ).split( ' ' )[ 0 ]}${rng.pick( f.noun )} the ${rng.pick( EPITHET )}`;

}

// Unique monster: a proper name with an element-flavoured title.
export function uniqueName( rng, element = 'physical', plan = 'biped' ) {

	return `${properName( rng )}, ${rng.pick( flavor( element ).adj )} ${rng.pick( TITLE_NOUN[ plan ] || TITLE_NOUN.biped )}`;

}

// Boss: { name: 'Vorzhul', title: 'the Ashen Tyrant' }.
export function bossName( rng, { element = 'physical', plan = 'biped' } = {} ) {

	const noun = rng.pick( TITLE_NOUN[ plan ] || TITLE_NOUN.biped );
	const adj = rng.pick( flavor( element ).adj );
	const title = rng.chance( 0.5 ) ? `the ${adj} ${noun}` : `${noun} of ${cap( rng.pick( flavor( element ).noun ) )}`;
	return { name: properName( rng, rng.int( 2, 3 ) ), title };

}
