// The twelve campaign bosses - one per level, each built around its level's
// mechanic so the fight is the final exam for what the level taught:
//
//   1 Powder Keg      Gorrak Blastjaw     hurls kegs; pop them on him
//   2 Spike Field     Morvane             spike waves with one safe gap per row
//   3 Lightless       Umbra               vanishes in the dark; light exposes her
//   4 Black Ice       Hrimgar             slides wall to wall; the last slide crashes
//   5 Conduits        Foreman Voltrix     raises pylons that shield him; break them
//   6 Rift Gates      Astrarch Nyx        steps through rifts, fires bolts out of others
//   7 Magma Tide      Pyrrhox             lava waves, dives under the crust
//   8 Gravity Wells   The Hollow Maw      wells that pull you in, then implode
//   9 Echoes          Vitreus             erupts wherever you stood; mirror images
//  10 The Swarm       Queen Cindrel       the hive answers her call
//  11 Chrono Fields   The Grand Horologist slow fields and sweeping clock hands
//  12 Miasma          Mother Rot          swelling plague clouds, bile spirals
//
// Phase thresholds are life fractions; patterns are bossPattern ids with options.
// stats.life is "× a normal monster of the same level" (a boss is a long fight,
// not a damage sponge: phases, adds and punish windows keep it moving).

import { define } from '../../core/registry.js';
import { FAMILY_PALETTES as PAL } from './families.js';
import { salt } from './util.js';

const boss = ( def ) => define( 'boss', { range: [ 0, 3 ], enrage: 165, gap: [ 1.1, 1.8 ], abilities: [ 'strike' ], archetype: 'brute', ...def } );

boss( {
	id: 'gorrak-blastjaw', name: 'Gorrak Blastjaw', title: 'the Powder King', depth: 1, level: 1, theme: 'ember-quarry', mechanic: 'powder-keg', tags: [ 'fire', 'giant', 'powder-keg' ],
	desc: 'The quarry boss. Throws lit kegs - hit one near him and it is your bomb.',
	element: 'fire', minion: 'blastling',
	genome: { plan: 'biped', size: 2.8, tags: [ 'tusks', 'armored', 'belly', 'barrels' ], palette: { ...PAL.ember, primary: '#6a3a24', metal: '#8a7a6a' } },
	stats: { life: 26, damage: 1.35, speed: 0.95 }, abilities: [ 'slam', 'strike' ],
	intro: { text: 'Every keg in this quarry is his. So is every grave.' },
	phases: [
		{ at: 1, name: 'Lit Fuse', patterns: [ 'keg-toss', 'slam-ring', { id: 'charge-chain', count: 2 } ] },
		{ at: 0.6, name: 'Short Fuse', patterns: [ { id: 'keg-toss', fuse: 2.6 }, 'charge-chain', 'eruptions', { id: 'summon-adds', count: 3 } ] },
		{ at: 0.3, name: 'Powder Storm', patterns: [ { id: 'keg-toss', fuse: 2.4 }, { id: 'meteor-rain', count: 8 }, { id: 'charge-chain', count: 3 }, 'slam-ring' ],
			adds: { family: 'blastling', count: 2, every: 15 } }
	]
} );

boss( {
	id: 'morvane', name: 'Morvane', title: 'the Drowned Warden', depth: 2, level: 2, theme: 'sunken-crypt', mechanic: 'spike-field', tags: [ 'cold', 'undead', 'spike-field' ],
	desc: 'Keeper of the sunken gate. Raises the crypt floor in rows of spikes.',
	element: 'cold', minion: 'drowned',
	genome: { plan: 'biped', size: 3, tags: [ 'crown', 'barnacles', 'trident', 'bones' ], palette: { ...PAL.crypt, glow: '#9fffe8' } },
	stats: { life: 28, damage: 1.4 }, abilities: [ 'slam', 'thrust' ],
	intro: { text: 'The tide went out three hundred years ago. He is still on watch.' },
	phases: [
		{ at: 1, name: 'Low Tide', patterns: [ 'spike-lines', 'slam-ring', 'shard-fan' ] },
		{ at: 0.6, name: 'Bone Tide', patterns: [ { id: 'spike-lines', rows: 11 }, 'bullet-nova', { id: 'summon-adds', count: 3 }, 'shard-fan' ],
			adds: { family: 'drowned', count: 2, every: 18 } },
		{ at: 0.3, name: 'High Water', patterns: [ { id: 'spike-lines', rows: 12 }, 'eruptions', 'bullet-nova', 'leap-slam' ] }
	]
} );

// Lightless: in the light she is exposed (+50% damage taken) and cannot stay hidden.
// Braziers are layout.lights entries ( { x, z, range, lit } ) - the world feature lights them.
function inLight( world, e ) {

	for ( const l of world.layout.lights || [] ) {

		if ( l.lit === false || l.data?.lit === false ) continue;
		const r = ( l.range ?? 6 ) * 0.8;
		if ( Math.hypot( l.x - e.x, l.z - e.z ) < r ) return true;

	}

	return false;

}

boss( {
	id: 'umbra', name: 'Umbra', title: 'the Lightless Matron', depth: 3, level: 3, theme: 'gloom-catacombs', mechanic: 'lightless', tags: [ 'chaos', 'spider', 'lightless' ],
	desc: 'A great shadow-spider. She hunts from the dark - fight her by the braziers.',
	element: 'chaos', minion: 'crypt-crawler', archetype: 'assassin', range: [ 0, 4 ],
	genome: { plan: 'arachnid', size: 3, tags: [ 'eyes', 'fangs', 'thin', 'shadow' ], palette: { ...PAL.gloom, glow: '#d080ff' } },
	stats: { life: 30, damage: 1.45, speed: 1.05 }, abilities: [ 'bite', 'web' ],
	intro: { text: 'Light a fire. She hates that.' },
	update( world, e ) {

		if ( ( world.frame + salt( e ) ) % 15 ) return;
		if ( inLight( world, e ) ) {

			world.applyStatus( e, 'm-exposed', { duration: 0.6 } );
			if ( e.statuses.has( 'm-vanished' ) ) world.removeStatus( e, 'm-vanished' );

		}

	},
	phases: [
		{ at: 1, name: 'Silk', patterns: [ 'vanish-ambush', 'shard-fan', { id: 'summon-adds', count: 4 } ] },
		{ at: 0.6, name: 'Shadow', patterns: [ 'vanish-ambush', { id: 'bullet-spiral', arms: 3 }, 'charge-chain', { id: 'summon-adds', family: 'gloom-stalker', count: 2 } ] },
		{ at: 0.3, name: 'Lightless', patterns: [ 'vanish-ambush', 'vanish-ambush', 'bullet-nova', 'eruptions' ], adds: { family: 'crypt-crawler', count: 4, every: 16 } }
	]
} );

boss( {
	id: 'hrimgar', name: 'Hrimgar', title: 'the Black Ice Tyrant', depth: 4, level: 4, theme: 'frostfang-pass', mechanic: 'black-ice', tags: [ 'cold', 'beast', 'black-ice' ],
	desc: 'A tusked behemoth that slides across the ice wall to wall. Make the last slide end in a wall.',
	element: 'cold', minion: 'frostfang-wolf', range: [ 0, 4 ],
	genome: { plan: 'quadruped', size: 3.2, tags: [ 'tusks', 'fur', 'crystal', 'horns' ], palette: { ...PAL.frost, primary: '#3a4a5a', skin: '#9ab8cc' } },
	stats: { life: 32, damage: 1.45, speed: 0.95 }, abilities: [ 'bite', 'stomp' ],
	intro: { text: 'The pass is his. The ice is his. Mind your footing.' },
	phases: [
		{ at: 1, name: 'Thin Ice', patterns: [ 'ice-slide', { id: 'breath-cone', element: 'cold' }, 'slam-ring' ] },
		{ at: 0.6, name: 'Whiteout', patterns: [ 'ice-slide', { id: 'meteor-rain', element: 'cold' }, { id: 'breath-cone', element: 'cold' } ], adds: { family: 'frostfang-wolf', count: 3, every: 20 } },
		{ at: 0.3, name: 'Black Ice', patterns: [ { id: 'ice-slide', count: 4 }, 'shard-fan', 'slam-ring', { id: 'meteor-rain', element: 'cold', count: 14 } ] }
	]
} );

boss( {
	id: 'voltrix', name: 'Foreman Voltrix', title: 'the Coil Tyrant', depth: 5, level: 5, theme: 'storm-foundry', mechanic: 'conduits', tags: [ 'lightning', 'construct', 'conduits' ],
	desc: 'The foundry\'s iron overseer. His conduits shield him - smash them first.',
	element: 'lightning', minion: 'spark-drone',
	genome: { plan: 'biped', size: 3, tags: [ 'metal', 'coil', 'pipes', 'armored' ], palette: { ...PAL.storm, glow: '#ffe84a' } },
	stats: { life: 32, damage: 1.5, armor: 2 }, abilities: [ 'slam', 'chain-bolt' ],
	intro: { text: 'Shift is not over until he says it is.' },
	phases: [
		{ at: 1, name: 'First Shift', patterns: [ 'conduit-pylons', 'beam-sweep', 'charge-chain', { id: 'bullet-nova', element: 'lightning' } ] },
		{ at: 0.6, name: 'Overtime', patterns: [ 'conduit-pylons', { id: 'eruptions', element: 'lightning' }, 'beam-sweep', 'charge-chain' ], adds: { family: 'spark-drone', count: 3, every: 16 } },
		{ at: 0.3, name: 'Meltdown', patterns: [ { id: 'conduit-pylons', count: 4 }, { id: 'meteor-rain', element: 'lightning' }, 'beam-sweep', 'slam-ring' ] }
	]
} );

boss( {
	id: 'nyx', name: 'Astrarch Nyx', title: 'the Rift Seer', depth: 6, level: 6, theme: 'shattered-observatory', mechanic: 'rift-gates', tags: [ 'arcane', 'lightning', 'rift-gates' ],
	desc: 'An astronomer who looked too long. Steps through rifts; bolts pour out of others.',
	element: 'lightning', minion: 'star-weaver', archetype: 'caster', range: [ 4, 9 ], abilities: [ 'bolt', 'blink' ],
	genome: { plan: 'floater', size: 2.8, tags: [ 'rings', 'eyes', 'robes', 'glow' ], palette: PAL.astral },
	stats: { life: 30, damage: 1.5, speed: 1 },
	intro: { text: 'She has seen how this ends. She would rather you did not.' },
	phases: [
		{ at: 1, name: 'Conjunction', patterns: [ 'rift-volley', 'teleport-nova', { id: 'bullet-spiral', arms: 3 } ] },
		{ at: 0.6, name: 'Eclipse', patterns: [ 'rift-volley', 'beam-sweep', 'teleport-nova', { id: 'summon-adds', count: 2 } ] },
		{ at: 0.3, name: 'Starfall', patterns: [ { id: 'rift-volley', count: 6 }, { id: 'bullet-spiral', arms: 4 }, { id: 'meteor-rain', element: 'lightning' }, 'teleport-nova' ] }
	]
} );

boss( {
	id: 'pyrrhox', name: 'Pyrrhox', title: 'the Caldera Wyrm', depth: 7, level: 7, theme: 'cinder-caldera', mechanic: 'magma-tide', tags: [ 'fire', 'serpent', 'magma-tide' ],
	desc: 'A wyrm that swims through magma. Waves of lava roll out of the crater - find the gaps.',
	element: 'fire', minion: 'lava-spawn', range: [ 0, 5 ],
	genome: { plan: 'serpent', size: 3.4, tags: [ 'scales', 'horns', 'glow', 'fins' ], palette: { ...PAL.caldera, glow: '#ffb02b' } },
	stats: { life: 34, damage: 1.55 }, abilities: [ 'bite', 'tail-sweep' ],
	intro: { text: 'The caldera breathes. That was him.' },
	phases: [
		{ at: 1, name: 'Simmer', patterns: [ 'magma-wave', 'breath-cone', 'burrow-strike' ] },
		{ at: 0.6, name: 'Boil', patterns: [ 'magma-wave', 'burrow-strike', 'meteor-rain', 'breath-cone' ], adds: { family: 'lava-spawn', count: 3, every: 15 } },
		{ at: 0.3, name: 'Eruption', patterns: [ { id: 'magma-wave', rows: 10 }, { id: 'meteor-rain', count: 16 }, 'burrow-strike', 'eruptions' ] }
	]
} );

boss( {
	id: 'hollow-maw', name: 'The Hollow Maw', title: 'Hunger of the Moon', depth: 8, level: 8, theme: 'hollow-moon', mechanic: 'gravity-wells', tags: [ 'chaos', 'void', 'gravity-wells' ],
	desc: 'A mouth the size of a moon crater. It pulls everything in.',
	element: 'chaos', minion: 'moon-mite', range: [ 0, 6 ],
	genome: { plan: 'blob', size: 3.4, tags: [ 'mouth', 'teeth', 'eyes', 'tendrils' ], palette: { ...PAL.moon, glow: '#b07aff' } },
	stats: { life: 36, damage: 1.55, speed: 0.85 }, abilities: [ 'bite', 'gravity-pull' ],
	intro: { text: 'It is not hungry. It is hunger.' },
	phases: [
		{ at: 1, name: 'Pull', patterns: [ 'gravity-well', { id: 'bullet-nova', element: 'chaos' }, 'slam-ring' ] },
		{ at: 0.6, name: 'Devour', patterns: [ 'gravity-well', { id: 'summon-adds', count: 5 }, { id: 'bullet-spiral', element: 'chaos' }, 'slam-ring' ] },
		{ at: 0.3, name: 'Collapse', patterns: [ { id: 'gravity-well', radius: 9 }, { id: 'bullet-spiral', arms: 4 }, 'eruptions', 'bullet-nova' ], adds: { family: 'moon-mite', count: 4, every: 14 } }
	]
} );

boss( {
	id: 'vitreus', name: 'Vitreus', title: 'the Echo Sovereign', depth: 9, level: 9, theme: 'mirror-halls', mechanic: 'echoes', tags: [ 'cold', 'glass', 'echoes' ],
	desc: 'A king of mirrors. Wherever you stood a moment ago is where he strikes.',
	element: 'cold', minion: 'mirror-shade', archetype: 'caster', range: [ 3, 8 ], abilities: [ 'fan', 'slash' ],
	genome: { plan: 'biped', size: 2.8, tags: [ 'crystal', 'crown', 'thin', 'glow' ], palette: PAL.mirror },
	stats: { life: 34, damage: 1.55 },
	intro: { text: 'Every move you make, he has already seen.' },
	phases: [
		{ at: 1, name: 'Reflection', patterns: [ 'echo-strike', 'shard-fan', 'teleport-nova' ] },
		{ at: 0.6, name: 'Refraction', patterns: [ 'echo-strike', 'mirror-images', { id: 'bullet-spiral', arms: 3 }, 'shard-fan' ] },
		{ at: 0.3, name: 'Shatter', patterns: [ 'echo-strike', { id: 'mirror-images', count: 3 }, 'bullet-nova', 'teleport-nova' ] }
	]
} );

boss( {
	id: 'cindrel', name: 'Queen Cindrel', title: 'Mother of the Ash Hive', depth: 10, level: 10, theme: 'ashen-hive', mechanic: 'swarm', tags: [ 'chaos', 'insect', 'swarm', 'the-swarm' ],
	desc: 'The hive queen. Every few breaths, the swarm answers.',
	element: 'chaos', minion: 'ash-drone', range: [ 0, 5 ],
	genome: { plan: 'hexapod', size: 3.4, tags: [ 'wings', 'crown', 'sac', 'stinger' ], palette: { ...PAL.hive, glow: '#ffcf3a' } },
	stats: { life: 36, damage: 1.6 }, abilities: [ 'sting', 'claw' ],
	intro: { text: 'You are in her house. All of it is her.' },
	phases: [
		{ at: 1, name: 'Brood', patterns: [ 'swarm-call', 'mortar-barrage', 'charge-chain' ] },
		{ at: 0.6, name: 'Swarm', patterns: [ { id: 'swarm-call', count: 8 }, { id: 'breath-cone', element: 'chaos' }, 'mortar-barrage', 'leap-slam' ], adds: { family: 'hive-warrior', count: 2, every: 20 } },
		{ at: 0.3, name: 'Hive Mind', patterns: [ { id: 'swarm-call', count: 10 }, 'leap-slam', { id: 'bullet-spiral', element: 'chaos' }, 'charge-chain' ] }
	]
} );

boss( {
	id: 'horologist', name: 'The Grand Horologist', title: 'Keeper of Hours', depth: 11, level: 11, theme: 'clockwork-ruins', mechanic: 'chrono-fields', tags: [ 'lightning', 'construct', 'chrono-fields' ],
	desc: 'A clockwork spider of brass and hours. Its hands sweep the room; its fields slow you down.',
	element: 'lightning', minion: 'cog-spider', range: [ 0, 5 ],
	genome: { plan: 'arachnid', size: 3, tags: [ 'metal', 'gears', 'dial', 'glow' ], palette: { ...PAL.clock, glow: '#ffe07a' } },
	stats: { life: 38, damage: 1.6, armor: 2 }, abilities: [ 'thrust', 'chain-bolt' ],
	intro: { text: 'You are late.' },
	phases: [
		{ at: 1, name: 'Tick', patterns: [ 'clock-hands', 'chrono-zones', 'charge-chain' ] },
		{ at: 0.6, name: 'Tock', patterns: [ 'clock-hands', 'chrono-zones', 'mortar-barrage', { id: 'summon-adds', count: 4 } ] },
		{ at: 0.3, name: 'Midnight', patterns: [ 'clock-hands', 'chrono-zones', { id: 'bullet-spiral', arms: 4, element: 'lightning' }, 'charge-chain' ], adds: { family: 'cog-spider', count: 3, every: 16 } }
	]
} );

boss( {
	id: 'mother-rot', name: 'Mother Rot', title: 'the Blight Matriarch', depth: 12, level: 12, theme: 'blightmarsh', mechanic: 'miasma', tags: [ 'chaos', 'blob', 'miasma' ],
	desc: 'The marsh made flesh. Her clouds swell; her children never stop coming.',
	element: 'chaos', minion: 'rot-grub', range: [ 0, 6 ], enrage: 180,
	genome: { plan: 'blob', size: 3.6, tags: [ 'sac', 'warts', 'tendrils', 'mouth' ], palette: { ...PAL.blight, glow: '#c8ff5a' } },
	stats: { life: 40, damage: 1.65, speed: 0.85 }, abilities: [ 'slam', 'spit' ],
	intro: { text: 'Breathe shallow.' },
	phases: [
		{ at: 1, name: 'Fester', patterns: [ 'miasma-burst', { id: 'bullet-spiral', element: 'chaos' }, { id: 'summon-adds', count: 5 } ] },
		{ at: 0.6, name: 'Spread', patterns: [ 'miasma-burst', 'burrow-strike', { id: 'eruptions', element: 'chaos' }, 'bullet-nova' ], adds: { family: 'bog-lurker', count: 1, every: 22 } },
		{ at: 0.3, name: 'Bloom', patterns: [ { id: 'miasma-burst', count: 7 }, { id: 'bullet-spiral', arms: 4, element: 'chaos' }, { id: 'meteor-rain', element: 'chaos' }, 'slam-ring' ],
			adds: { family: 'rot-grub', count: 5, every: 14 } }
	]
} );
