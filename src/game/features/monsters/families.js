// Monster families: the designed bestiary of the twelve campaign levels.
//
// A family is Spore-style CONSTRAINTS, not a model: which body plans, what size,
// which part tags and palette the genome generator may use, which archetypes
// (behaviours) its members take and which abilities they draw from. Every member
// is generated - two Slag Hounds are never quite the same body - but they read
// as one species. Procedural families ( compose.js ) are this exact shape, so
// anything that works for a designed family works at depth 500.
//
//   element     physical | fire | cold | lightning | chaos (damage split, resistances, fx)
//   genome      { plans, size: [ min, max ], tags }  ->  generateGenome( rng, { plan, size, tags, palette } )
//   palette     primary secondary accent skin metal glow dark
//   archetypes  { archetypeId: weight }; abilities: ids it may slot ( by role, see factory.loadoutFor )
//   loadouts    optional exact ability lists per archetype
//   depths / themes / mechanics   where it lives in the campaign ( director fallbacks )
//   pack        [ min, max ] group size;  minion: family its summoners call
//   memberNames { archetype: word } replaces the body noun ( "Bone Archer" / "Bone Priest" )
//   affixPool   affixes this family favours when it rolls elites

import { define } from '../../core/registry.js';

const family = ( def ) => define( 'monsterFamily', { weight: 1, pack: [ 3, 5 ], stats: {}, ...def, archetypeList: Object.keys( def.archetypes ) } );

const PAL = {
	ember: { primary: '#7a3a24', secondary: '#3a2620', accent: '#ffb347', skin: '#b8653f', metal: '#6e6a66', glow: '#ff6a1a', dark: '#1a1210' },
	crypt: { primary: '#4a6a6e', secondary: '#24343a', accent: '#a8d8d0', skin: '#8aa8a0', metal: '#7d8a8c', glow: '#7fffe0', dark: '#0e1618' },
	gloom: { primary: '#3a3046', secondary: '#1e1828', accent: '#b07aff', skin: '#6a5a7a', metal: '#5a5866', glow: '#c45aff', dark: '#0a080e' },
	frost: { primary: '#cfe6f2', secondary: '#5a7a90', accent: '#ffffff', skin: '#a8c8dc', metal: '#9ab0c0', glow: '#7fd8ff', dark: '#1a2834' },
	storm: { primary: '#3e4a5a', secondary: '#22282e', accent: '#ffd84a', skin: '#6a7a8a', metal: '#9aa4ae', glow: '#a8c8ff', dark: '#101418' },
	astral: { primary: '#2a2e5a', secondary: '#14162e', accent: '#e8d8ff', skin: '#5a5a9a', metal: '#b0b0d0', glow: '#c8b0ff', dark: '#08081a' },
	caldera: { primary: '#3a1e14', secondary: '#1a0e0a', accent: '#ff8a2b', skin: '#5a2a1a', metal: '#4a3a34', glow: '#ff4a1a', dark: '#0e0604' },
	moon: { primary: '#9a96a8', secondary: '#4a4658', accent: '#e8e4ff', skin: '#b8b4c8', metal: '#7a7688', glow: '#8a5aff', dark: '#14121c' },
	mirror: { primary: '#d8e8f0', secondary: '#7a8a98', accent: '#ffffff', skin: '#b8d0e0', metal: '#c8d8e8', glow: '#bfe8ff', dark: '#2a3440' },
	hive: { primary: '#5a4a2a', secondary: '#2a2214', accent: '#ffcf3a', skin: '#8a7a4a', metal: '#4a4234', glow: '#ff9a2a', dark: '#14100a' },
	clock: { primary: '#8a6a3a', secondary: '#3a2e20', accent: '#e8c87a', skin: '#a88a5a', metal: '#b89a5a', glow: '#ffe07a', dark: '#1a140c' },
	blight: { primary: '#4a5a2a', secondary: '#22281a', accent: '#c8ff5a', skin: '#6a7a3a', metal: '#5a5a4a', glow: '#9cff3a', dark: '#0e120a' }
};

const tint = ( p, over ) => ( { ...p, ...over } );

// --- 1 · Ember Quarry · Powder Keg -----------------------------------------------------------
const EMBER = { depths: [ 1 ], themes: [ 'ember-quarry' ], mechanics: [ 'powder-keg' ], level: 1 };

family( { ...EMBER, id: 'cinder-imp', name: 'Cinder Imp', element: 'fire', tags: [ 'fire', 'demon', 'small' ],
	desc: 'Quarry imps that pelt you with embers from the ledges and dart in when you turn away.',
	genome: { plans: [ 'biped' ], size: [ 0.68, 0.82 ], tags: [ 'horns', 'tail', 'glow' ] }, palette: PAL.ember,
	archetypes: { kiter: 3, skirmisher: 1 }, abilities: [ 'bolt', 'claw', 'blink' ], memberNames: { kiter: 'Imp', skirmisher: 'Imp Raider' }, pack: [ 3, 5 ] } );

family( { ...EMBER, id: 'slag-hound', name: 'Slag Hound', element: 'fire', tags: [ 'fire', 'beast' ],
	desc: 'Molten-backed hounds that hunt in packs; the big ones charge.',
	genome: { plans: [ 'quadruped' ], size: [ 0.85, 1.1 ], tags: [ 'spikes', 'glow', 'tail' ] }, palette: tint( PAL.ember, { primary: '#5a2a1a' } ),
	archetypes: { brawler: 3, charger: 1 }, abilities: [ 'bite', 'charge' ], memberNames: { charger: 'Ram' }, pack: [ 3, 6 ], affixPool: [ 'molten-trail', 'hasted' ] } );

family( { ...EMBER, id: 'quarry-brute', name: 'Quarry Brute', element: 'physical', tags: [ 'giant', 'miner' ], weight: 0.6,
	desc: 'Ogre miners with pick-hammers. Slow, armoured, and every slam is shown on the ground first.',
	genome: { plans: [ 'biped' ], size: [ 1.15, 1.3 ], tags: [ 'armored', 'horns', 'tusks' ] }, palette: tint( PAL.ember, { primary: '#6a5a4a', skin: '#8a6a50' } ),
	archetypes: { brute: 2, tank: 1 }, abilities: [ 'slam', 'stomp', 'shield-bash', 'war-cry' ], memberNames: { brute: 'Brute', tank: 'Foreman' }, pack: [ 1, 2 ], affixPool: [ 'armoured', 'juggernaut' ] } );

family( { ...EMBER, id: 'blastling', name: 'Blastling', element: 'fire', tags: [ 'fire', 'explosive', 'small' ], weight: 0.7,
	desc: 'Powder-bellied blobs that waddle at you and burst. Pop them early - or lure them into their friends.',
	genome: { plans: [ 'blob' ], size: [ 0.6, 0.75 ], tags: [ 'glow', 'fuse' ] }, palette: tint( PAL.ember, { primary: '#c8501e', glow: '#ffe07a' } ),
	archetypes: { exploder: 1 }, abilities: [], pack: [ 3, 6 ] } );

// --- 2 · Sunken Crypt · Spike Field ----------------------------------------------------------
const CRYPT = { depths: [ 2 ], themes: [ 'sunken-crypt' ], mechanics: [ 'spike-field' ], level: 2 };

family( { ...CRYPT, id: 'drowned', name: 'Drowned Thrall', element: 'cold', tags: [ 'undead', 'cold', 'water' ],
	desc: 'Waterlogged dead. Some still carry their tower shields.',
	genome: { plans: [ 'biped' ], size: [ 0.95, 1.1 ], tags: [ 'rags', 'bones', 'barnacles' ] }, palette: PAL.crypt,
	archetypes: { brawler: 3, tank: 1 }, abilities: [ 'slash', 'claw', 'shield-bash' ], memberNames: { tank: 'Shieldbearer' }, pack: [ 3, 5 ], affixPool: [ 'cold-enchanted', 'regenerating' ] } );

family( { ...CRYPT, id: 'crypt-crawler', name: 'Crypt Crawler', element: 'chaos', tags: [ 'spider', 'chaos', 'vermin' ],
	desc: 'Pale spiders that boil out of the walls and dig under the flagstones.',
	genome: { plans: [ 'arachnid' ], size: [ 0.55, 0.85 ], tags: [ 'fangs', 'eyes' ] }, palette: tint( PAL.crypt, { primary: '#b8c0a8', glow: '#9cff3a' } ),
	archetypes: { swarmer: 3, burrower: 1 }, abilities: [ 'bite', 'web', 'sting' ], memberNames: { swarmer: 'Crawler', burrower: 'Tunneler' }, pack: [ 5, 9 ] } );

family( { ...CRYPT, id: 'bone-archer', name: 'Bone Archer', element: 'physical', tags: [ 'undead', 'skeleton' ],
	desc: 'Skeletal bowmen and the priests that ward them.',
	genome: { plans: [ 'biped' ], size: [ 0.9, 1.05 ], tags: [ 'bones', 'skull', 'bow' ] }, palette: tint( PAL.crypt, { primary: '#d8d0b8', skin: '#e8e0c8' } ),
	archetypes: { kiter: 3, support: 1 }, abilities: [ 'arrow', 'volley', 'ward' ], memberNames: { kiter: 'Archer', support: 'Priest' }, pack: [ 2, 4 ] } );

// --- 3 · Gloom Catacombs · Lightless ---------------------------------------------------------
const GLOOM = { depths: [ 3 ], themes: [ 'gloom-catacombs' ], mechanics: [ 'lightless' ], level: 3 };

family( { ...GLOOM, id: 'gloom-stalker', name: 'Gloom Stalker', element: 'chaos', tags: [ 'shadow', 'chaos' ],
	desc: 'Long-limbed things that live where the light does not reach and strike from behind.',
	genome: { plans: [ 'biped' ], size: [ 0.95, 1.15 ], tags: [ 'claws', 'eyes', 'thin' ] }, palette: PAL.gloom,
	archetypes: { assassin: 2, skirmisher: 1 }, abilities: [ 'blink-strike', 'claw' ], pack: [ 2, 4 ], affixPool: [ 'teleporter', 'ghostly' ] } );

family( { ...GLOOM, id: 'lantern-wisp', name: 'Lantern Wisp', element: 'chaos', tags: [ 'spirit', 'chaos', 'light' ],
	desc: 'Drifting lights that drain the warmth out of you.',
	genome: { plans: [ 'floater' ], size: [ 0.7, 0.9 ], tags: [ 'glow', 'tendrils' ] }, palette: tint( PAL.gloom, { glow: '#ffd27a', accent: '#ffe8a8' } ),
	archetypes: { caster: 2, kiter: 1 }, abilities: [ 'bolt', 'poison-cloud', 'drain', 'blink' ], memberNames: { caster: 'Wisp', kiter: 'Flicker' }, pack: [ 2, 4 ] } );

family( { ...GLOOM, id: 'grave-warden', name: 'Grave Warden', element: 'physical', tags: [ 'undead', 'guardian' ], weight: 0.7,
	desc: 'Armoured tomb guards; their gravecallers raise the dead you leave behind.',
	genome: { plans: [ 'biped' ], size: [ 1.1, 1.25 ], tags: [ 'armored', 'helm', 'bones' ] }, palette: tint( PAL.gloom, { primary: '#5a5466', metal: '#8a8696' } ),
	archetypes: { tank: 2, summoner: 1 }, abilities: [ 'shield-bash', 'cleave', 'raise-dead' ], loadouts: { summoner: [ 'raise-dead', 'summon', 'bolt' ] },
	memberNames: { tank: 'Warden', summoner: 'Gravecaller' }, minion: 'crypt-crawler', pack: [ 2, 3 ] } );

// --- 4 · Frostfang Pass · Black Ice -----------------------------------------------------------
const FROST = { depths: [ 4 ], themes: [ 'frostfang-pass' ], mechanics: [ 'black-ice' ], level: 4 };

family( { ...FROST, id: 'frostfang-wolf', name: 'Frostfang Wolf', element: 'cold', tags: [ 'beast', 'cold', 'wolf' ],
	desc: 'Pack wolves of the pass. They circle, then pounce.',
	genome: { plans: [ 'quadruped' ], size: [ 0.85, 1.05 ], tags: [ 'fur', 'fangs', 'tail' ] }, palette: PAL.frost,
	archetypes: { brawler: 3, charger: 1 }, abilities: [ 'bite', 'leap', 'charge' ], memberNames: { charger: 'Alpha' }, pack: [ 4, 6 ], affixPool: [ 'hasted', 'frost-aura' ] } );

family( { ...FROST, id: 'rime-yeti', name: 'Rime Yeti', element: 'cold', tags: [ 'giant', 'cold', 'beast' ], weight: 0.6,
	desc: 'Hulking snow apes that hurl ice boulders and shake the ground.',
	genome: { plans: [ 'biped' ], size: [ 1.2, 1.4 ], tags: [ 'fur', 'tusks', 'horns' ] }, palette: tint( PAL.frost, { primary: '#e8f0f4', skin: '#8aa0b0' } ),
	archetypes: { brute: 1 }, abilities: [ 'slam', 'stomp', 'frost-nova', 'mortar' ], pack: [ 1, 2 ] } );

family( { ...FROST, id: 'ice-wraith', name: 'Ice Wraith', element: 'cold', tags: [ 'spirit', 'cold' ],
	desc: 'Frozen ghosts that fling shard fans and blink away when cornered.',
	genome: { plans: [ 'floater' ], size: [ 0.85, 1 ], tags: [ 'tendrils', 'crystal', 'glow' ] }, palette: tint( PAL.frost, { primary: '#9fd8ff', glow: '#e0f6ff' } ),
	archetypes: { caster: 2, kiter: 1 }, abilities: [ 'shard-nova', 'fan', 'frost-nova', 'blink' ], memberNames: { caster: 'Wraith', kiter: 'Shardthrower' }, pack: [ 2, 3 ] } );

// --- 5 · Storm Foundry · Conduits -----------------------------------------------------------
const STORM = { depths: [ 5 ], themes: [ 'storm-foundry' ], mechanics: [ 'conduits' ], level: 5 };

family( { ...STORM, id: 'spark-drone', name: 'Spark Drone', element: 'lightning', tags: [ 'construct', 'lightning', 'small' ],
	desc: 'Buzzing foundry drones. Alone they sting; in swarms they arc.',
	genome: { plans: [ 'floater' ], size: [ 0.55, 0.7 ], tags: [ 'metal', 'coil', 'glow' ] }, palette: PAL.storm,
	archetypes: { swarmer: 2, kiter: 1 }, abilities: [ 'chain-bolt' ], memberNames: { swarmer: 'Drone', kiter: 'Arcer' }, pack: [ 4, 7 ] } );

family( { ...STORM, id: 'forge-golem', name: 'Forge Golem', element: 'lightning', tags: [ 'construct', 'giant', 'lightning' ], weight: 0.7,
	desc: 'Riveted foundry golems. Their quakes come in rings - stand in the gaps.',
	genome: { plans: [ 'biped' ], size: [ 1.2, 1.35 ], tags: [ 'metal', 'armored', 'pipes' ] }, palette: tint( PAL.storm, { primary: '#5a5048' } ),
	archetypes: { brute: 1, tank: 1 }, abilities: [ 'slam', 'quake', 'shield-bash' ], memberNames: { brute: 'Golem', tank: 'Bulwark' }, pack: [ 1, 2 ], affixPool: [ 'armoured', 'storm-touched' ] } );

family( { ...STORM, id: 'coil-sentry', name: 'Coil Sentry', element: 'lightning', tags: [ 'construct', 'turret', 'lightning' ], weight: 0.6,
	desc: 'Bolted-down tesla coils. Their beam lanes light up before they fire.',
	genome: { plans: [ 'floater' ], size: [ 0.9, 1.05 ], tags: [ 'metal', 'coil', 'pylon' ] }, palette: tint( PAL.storm, { glow: '#ffe84a' } ),
	archetypes: { turret: 1 }, abilities: [ 'beam', 'chain-bolt', 'lightning-strike' ], pack: [ 1, 2 ] } );

// --- 6 · Shattered Observatory · Rift Gates ----------------------------------------------------
const ASTRAL = { depths: [ 6 ], themes: [ 'shattered-observatory' ], mechanics: [ 'rift-gates' ], level: 6 };

family( { ...ASTRAL, id: 'star-weaver', name: 'Star Weaver', element: 'lightning', tags: [ 'arcane', 'spirit' ],
	desc: 'Astral casters that draw lines of starlight across the floor.',
	genome: { plans: [ 'floater' ], size: [ 0.9, 1.1 ], tags: [ 'rings', 'eyes', 'glow' ] }, palette: PAL.astral,
	archetypes: { caster: 2, support: 1 }, abilities: [ 'beam', 'lightning-strike', 'ward', 'blink' ], memberNames: { caster: 'Weaver', support: 'Warder' }, pack: [ 2, 3 ] } );

family( { ...ASTRAL, id: 'rift-stalker', name: 'Rift Stalker', element: 'chaos', tags: [ 'arcane', 'spider' ],
	desc: 'Spiders that walk between rifts. They are always closer than they look.',
	genome: { plans: [ 'arachnid' ], size: [ 0.9, 1.1 ], tags: [ 'crystal', 'eyes', 'fangs' ] }, palette: tint( PAL.astral, { primary: '#4a2e6a' } ),
	archetypes: { assassin: 2, brawler: 1 }, abilities: [ 'blink-strike', 'bite', 'web' ], pack: [ 2, 4 ], affixPool: [ 'teleporter' ] } );

// --- 7 · Cinder Caldera · Magma Tide -------------------------------------------------------------
const CALDERA = { depths: [ 7 ], themes: [ 'cinder-caldera' ], mechanics: [ 'magma-tide' ], level: 7 };

family( { ...CALDERA, id: 'magma-crab', name: 'Magma Crab', element: 'fire', tags: [ 'beast', 'fire', 'shell' ],
	desc: 'Basalt-shelled crabs that swim through rock and surface under your feet.',
	genome: { plans: [ 'hexapod' ], size: [ 0.95, 1.15 ], tags: [ 'shell', 'claws', 'glow' ] }, palette: PAL.caldera,
	archetypes: { burrower: 2, tank: 1 }, abilities: [ 'claw', 'burrow', 'shield-bash', 'stomp' ], memberNames: { burrower: 'Crab', tank: 'Shellback' }, pack: [ 2, 4 ], affixPool: [ 'molten-trail', 'armoured' ] } );

family( { ...CALDERA, id: 'ember-drake', name: 'Ember Drake', element: 'fire', tags: [ 'dragon', 'fire', 'flying' ], weight: 0.7,
	desc: 'Young drakes: pounce, breathe fire, call meteors.',
	genome: { plans: [ 'avian' ], size: [ 1.0, 1.2 ], tags: [ 'wings', 'horns', 'scales' ] }, palette: tint( PAL.caldera, { primary: '#8a2a14', accent: '#ffcf3a' } ),
	archetypes: { charger: 1, caster: 1, skirmisher: 1 }, abilities: [ 'breath', 'leap', 'meteor', 'claw' ], memberNames: { charger: 'Drake', caster: 'Flamecaller', skirmisher: 'Drakeling' }, pack: [ 1, 3 ] } );

family( { ...CALDERA, id: 'lava-spawn', name: 'Lava Spawn', element: 'fire', tags: [ 'elemental', 'fire', 'small' ],
	desc: 'Blobs of living magma. They pop when they reach you.',
	genome: { plans: [ 'blob' ], size: [ 0.55, 0.75 ], tags: [ 'glow', 'drips' ] }, palette: tint( PAL.caldera, { primary: '#ff6a1a', glow: '#ffd27a' } ),
	archetypes: { exploder: 2, brawler: 1 }, abilities: [ 'strike' ], pack: [ 3, 6 ] } );

// --- 8 · Hollow Moon · Gravity Wells -------------------------------------------------------------
const MOON = { depths: [ 8 ], themes: [ 'hollow-moon' ], mechanics: [ 'gravity-wells' ], level: 8 };

family( { ...MOON, id: 'void-maw', name: 'Void Maw', element: 'chaos', tags: [ 'void', 'aberration' ], weight: 0.7,
	desc: 'Hungry holes with teeth. They pull you in and spit out mites.',
	genome: { plans: [ 'blob' ], size: [ 1.1, 1.3 ], tags: [ 'mouth', 'teeth', 'eyes' ] }, palette: PAL.moon,
	archetypes: { summoner: 1, brute: 1 }, abilities: [ 'summon', 'gravity-pull', 'slam', 'bite' ], minion: 'moon-mite', memberNames: { summoner: 'Brood Maw', brute: 'Maw' }, pack: [ 1, 2 ] } );

family( { ...MOON, id: 'moon-mite', name: 'Moon Mite', element: 'chaos', tags: [ 'void', 'vermin', 'small' ],
	desc: 'Skittering lunar ticks.',
	genome: { plans: [ 'hexapod' ], size: [ 0.5, 0.65 ], tags: [ 'shell', 'eyes' ] }, palette: tint( PAL.moon, { primary: '#5a5670' } ),
	archetypes: { swarmer: 1 }, abilities: [], pack: [ 6, 10 ] } );

family( { ...MOON, id: 'watcher-eye', name: 'Watcher Eye', element: 'chaos', tags: [ 'void', 'eye' ],
	desc: 'Floating eyes that bend gravity and stare in burning lines.',
	genome: { plans: [ 'floater' ], size: [ 0.9, 1.1 ], tags: [ 'eye', 'tendrils' ] }, palette: tint( PAL.moon, { glow: '#ff5ad0' } ),
	archetypes: { caster: 1, turret: 1 }, abilities: [ 'gravity-pull', 'beam', 'bolt' ], memberNames: { caster: 'Eye', turret: 'Gazer' }, pack: [ 1, 3 ], affixPool: [ 'gravity' ] } );

// --- 9 · Mirror Halls · Echoes ---------------------------------------------------------------------
const MIRROR = { depths: [ 9 ], themes: [ 'mirror-halls' ], mechanics: [ 'echoes' ], level: 9 };

family( { ...MIRROR, id: 'glass-sentinel', name: 'Glass Sentinel', element: 'cold', tags: [ 'construct', 'glass' ],
	desc: 'Mirror-plated guards. Their shields reflect; their shards fan out.',
	genome: { plans: [ 'biped' ], size: [ 1.05, 1.2 ], tags: [ 'crystal', 'armored', 'helm' ] }, palette: PAL.mirror,
	archetypes: { tank: 2, turret: 1 }, abilities: [ 'shield-bash', 'fan', 'shard-nova' ], memberNames: { tank: 'Sentinel', turret: 'Prism' }, pack: [ 2, 3 ], affixPool: [ 'thorns', 'mirror-image' ] } );

family( { ...MIRROR, id: 'mirror-shade', name: 'Mirror Shade', element: 'lightning', tags: [ 'spirit', 'glass' ],
	desc: 'Reflections that stepped out of the glass. They are where you are not looking.',
	genome: { plans: [ 'biped' ], size: [ 0.95, 1.05 ], tags: [ 'thin', 'crystal', 'glow' ] }, palette: tint( PAL.mirror, { primary: '#a8c8ff', glow: '#e8f0ff' } ),
	archetypes: { assassin: 2, caster: 1 }, abilities: [ 'blink-strike', 'slash', 'beam' ], memberNames: { assassin: 'Shade', caster: 'Glimmer' }, pack: [ 2, 4 ], affixPool: [ 'mirror-image', 'teleporter' ] } );

// --- 10 · Ashen Hive · The Swarm ---------------------------------------------------------------------
const HIVE = { depths: [ 10 ], themes: [ 'ashen-hive' ], mechanics: [ 'swarm', 'the-swarm' ], level: 10 };

family( { ...HIVE, id: 'ash-drone', name: 'Ash Drone', element: 'fire', tags: [ 'insect', 'swarm', 'small' ],
	desc: 'Cinder wasps. Never alone.',
	genome: { plans: [ 'avian', 'hexapod' ], size: [ 0.45, 0.6 ], tags: [ 'wings', 'stinger' ] }, palette: PAL.hive,
	archetypes: { swarmer: 1 }, abilities: [], pack: [ 8, 14 ] } );

family( { ...HIVE, id: 'hive-warrior', name: 'Hive Warrior', element: 'chaos', tags: [ 'insect', 'warrior' ],
	desc: 'Mandibled soldier caste. The big ones charge.',
	genome: { plans: [ 'hexapod' ], size: [ 0.95, 1.15 ], tags: [ 'shell', 'mandibles', 'stinger' ] }, palette: tint( PAL.hive, { primary: '#3a2e1a' } ),
	archetypes: { brawler: 2, charger: 1 }, abilities: [ 'claw', 'sting', 'charge' ], pack: [ 3, 5 ] } );

family( { ...HIVE, id: 'hive-spitter', name: 'Hive Spitter', element: 'chaos', tags: [ 'insect', 'artillery' ],
	desc: 'Bloated acid-sacs that lob globs and birth drones.',
	genome: { plans: [ 'hexapod' ], size: [ 0.9, 1.05 ], tags: [ 'sac', 'glow' ] }, palette: tint( PAL.hive, { glow: '#c8ff3a' } ),
	archetypes: { kiter: 2, summoner: 1 }, abilities: [ 'spit', 'mortar', 'summon' ], minion: 'ash-drone', memberNames: { kiter: 'Spitter', summoner: 'Broodsac' }, pack: [ 2, 3 ] } );

// --- 11 · Clockwork Ruins · Chrono Fields -----------------------------------------------------------
const CLOCK = { depths: [ 11 ], themes: [ 'clockwork-ruins' ], mechanics: [ 'chrono-fields' ], level: 11 };

family( { ...CLOCK, id: 'clock-sentry', name: 'Clock Sentry', element: 'lightning', tags: [ 'construct', 'clockwork' ],
	desc: 'Brass sentries that volley bolts on the tick.',
	genome: { plans: [ 'biped' ], size: [ 0.95, 1.1 ], tags: [ 'metal', 'gears', 'helm' ] }, palette: PAL.clock,
	archetypes: { turret: 1, kiter: 1 }, abilities: [ 'volley', 'beam', 'arrow' ], memberNames: { turret: 'Turret', kiter: 'Sentry' }, pack: [ 2, 3 ], affixPool: [ 'time-warp' ] } );

family( { ...CLOCK, id: 'gear-knight', name: 'Gear Knight', element: 'physical', tags: [ 'construct', 'clockwork', 'knight' ],
	desc: 'Wind-up knights: lance charges, spinning blades, a shield that turns too slowly.',
	genome: { plans: [ 'biped' ], size: [ 1.05, 1.25 ], tags: [ 'metal', 'gears', 'armored', 'lance' ] }, palette: tint( PAL.clock, { primary: '#6a5a4a', metal: '#c8a868' } ),
	archetypes: { charger: 1, tank: 1, brute: 1 }, abilities: [ 'charge', 'thrust', 'shield-bash', 'whirl' ], memberNames: { charger: 'Lancer', tank: 'Knight', brute: 'Juggernaut' }, pack: [ 1, 3 ], affixPool: [ 'juggernaut', 'armoured' ] } );

family( { ...CLOCK, id: 'cog-spider', name: 'Cog Spider', element: 'physical', tags: [ 'construct', 'clockwork', 'small' ],
	desc: 'Clockwork crawlers. The ones with a lit fuse are bombs.',
	genome: { plans: [ 'arachnid' ], size: [ 0.55, 0.7 ], tags: [ 'metal', 'gears' ] }, palette: tint( PAL.clock, { primary: '#a88a5a' } ),
	archetypes: { swarmer: 2, exploder: 1 }, abilities: [ 'bite' ], memberNames: { swarmer: 'Spider', exploder: 'Bomb' }, pack: [ 4, 8 ] } );

// --- 12 · Blightmarsh · Miasma -----------------------------------------------------------------------
const BLIGHT = { depths: [ 12 ], themes: [ 'blightmarsh' ], mechanics: [ 'miasma' ], level: 12 };

family( { ...BLIGHT, id: 'bog-lurker', name: 'Bog Lurker', element: 'chaos', tags: [ 'beast', 'serpent', 'water' ],
	desc: 'Marsh serpents that dive into the muck and surface beneath you.',
	genome: { plans: [ 'serpent' ], size: [ 1.0, 1.25 ], tags: [ 'scales', 'fangs', 'fins' ] }, palette: PAL.blight,
	archetypes: { burrower: 2, brawler: 1 }, abilities: [ 'bite', 'burrow', 'spit', 'tail-sweep' ], memberNames: { burrower: 'Lurker', brawler: 'Snapper' }, pack: [ 2, 3 ] } );

family( { ...BLIGHT, id: 'plague-toad', name: 'Plague Toad', element: 'chaos', tags: [ 'beast', 'amphibian' ],
	desc: 'Swollen toads: spit, leap, and some of them burst.',
	genome: { plans: [ 'quadruped', 'blob' ], size: [ 0.8, 1.0 ], tags: [ 'warts', 'sac' ] }, palette: tint( PAL.blight, { primary: '#6a7a2a' } ),
	archetypes: { kiter: 2, exploder: 1 }, abilities: [ 'spit', 'poison-cloud', 'leap' ], memberNames: { exploder: 'Bloater' }, pack: [ 2, 4 ], affixPool: [ 'plagued', 'venomous' ] } );

family( { ...BLIGHT, id: 'rot-shaman', name: 'Rot Shaman', element: 'chaos', tags: [ 'humanoid', 'shaman' ], weight: 0.7,
	desc: 'Marsh witch-doctors: they mend their kin and grow grubs from the dead.',
	genome: { plans: [ 'biped' ], size: [ 0.9, 1.0 ], tags: [ 'mask', 'feathers', 'staff' ] }, palette: tint( PAL.blight, { primary: '#5a4a2a' } ),
	archetypes: { support: 1, summoner: 1 }, abilities: [ 'heal', 'poison-cloud', 'summon', 'raise-dead' ], minion: 'rot-grub', memberNames: { support: 'Mender', summoner: 'Grubcaller' }, pack: [ 1, 2 ] } );

family( { ...BLIGHT, id: 'rot-grub', name: 'Rot Grub', element: 'chaos', tags: [ 'vermin', 'small' ],
	desc: 'Fat white grubs. Disgusting, fast, everywhere.',
	genome: { plans: [ 'serpent' ], size: [ 0.45, 0.6 ], tags: [ 'segments' ] }, palette: tint( PAL.blight, { primary: '#d8d0a8' } ),
	archetypes: { swarmer: 1 }, abilities: [], pack: [ 5, 9 ] } );

export { PAL as FAMILY_PALETTES };
