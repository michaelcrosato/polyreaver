// Levels: which level is depth N.
//
//   1-12   the designed campaign - one mechanic each, the level is NAMED after it
//   13-20  hand-designed combinations ("Powder Ice", "Dark Conduits" ... "The Gauntlet")
//   21+    endless: 1-3 mechanics (compatible, preferring good pairs) x a theme x a
//          palette shift x monster family tags x a procedural boss; names are
//          generated from the mechanics' words. Depth N is the same level for
//          everyone (seeded by the depth), so "depth 137" can be shared.
//
// Campaign levels are 'level' defs; two 'levelProvider' defs turn depth -> spec:
//
//   spec = { id, depth, name, level (area level), theme, palette?, mechanics: [ids],
//            intensity: { id: n }, generator, families: [tags], boss, bossName, bossTags,
//            seed, size, kind: 'campaign' | 'combo' | 'endless', desc }
//
// The monsters feature reads `families` (tags) and `boss` (an id; unknown ids -
// and 'procedural' - are composed from bossTags + seed).

import { define, get, all } from '../../core/registry.js';
import { RNG, hashStr } from '../../core/rng.js';
import { intensityAt } from './mechanics/index.js';
import { campaignThemes } from './themes.js';

// Area level for a depth: two levels per depth through the campaign, then a
// gentler climb (monster scaling is exponential, so this still ramps forever).
export function areaLevel( depth ) {

	return depth <= 20 ? depth * 2 - 1 : Math.round( 39 + ( depth - 20 ) * 1.5 );

}

const L = ( depth, id, name, theme, mechanics, generator, families, boss, bossName, desc, extra = {} ) =>
	define( 'level', { id, depth, name, theme, mechanics, generator, families, boss, bossName, desc, kind: depth > 12 ? 'combo' : 'campaign', tags: [ ...mechanics ], ...extra } );

L( 1, 'powder-keg', 'Powder Keg', 'ember-quarry', [ 'powder-keg' ], 'caves', [ 'fire', 'beast', 'miner' ], 'quarry-tyrant', 'Grakka, Quarry Tyrant', 'An ember quarry stacked with blasting powder.' );
L( 2, 'spike-field', 'Spike Field', 'sunken-crypt', [ 'spike-field' ], 'dungeon', [ 'undead', 'skeleton', 'drowned' ], 'drowned-king', 'The Drowned King', 'Flooded tombs, trapped floors.' );
L( 3, 'lightless', 'Lightless', 'gloom-catacombs', [ 'lightless' ], 'dungeon', [ 'undead', 'shadow', 'ghoul' ], 'lantern-eater', 'The Lantern Eater', 'Catacombs where the dark has teeth.' );
L( 4, 'black-ice', 'Black Ice', 'frostfang-pass', [ 'black-ice' ], 'caves', [ 'cold', 'beast', 'yeti' ], 'frostfang-alpha', 'Frostfang Alpha', 'A frozen mountain pass. Every step slides.' );
L( 5, 'conduits', 'Conduits', 'storm-foundry', [ 'conduits' ], 'dungeon', [ 'lightning', 'construct', 'golem' ], 'foundry-colossus', 'The Foundry Colossus', 'A foundry still humming with stored storms.' );
L( 6, 'rift-gates', 'Rift Gates', 'shattered-observatory', [ 'rift-gates' ], 'dungeon', [ 'arcane', 'void', 'construct' ], 'star-warden', 'The Star Warden', 'An observatory broken open to the void.' );
L( 7, 'magma-tide', 'Magma Tide', 'cinder-caldera', [ 'magma-tide' ], 'caves', [ 'fire', 'elemental', 'salamander' ], 'cinder-wyrm', 'The Cinder Wyrm', 'A caldera that breathes magma.' );
L( 8, 'gravity-wells', 'Gravity Wells', 'hollow-moon', [ 'gravity-wells' ], 'caves', [ 'void', 'insect', 'alien' ], 'void-maw', 'The Void Maw', 'The hollow inside a dead moon.' );
L( 9, 'echoes', 'Echoes', 'mirror-halls', [ 'echoes' ], 'dungeon', [ 'arcane', 'spirit', 'construct' ], 'mirror-knight', 'The Mirror Knight', 'Halls that remember what you did.' );
L( 10, 'swarm', 'The Swarm', 'ashen-hive', [ 'swarm' ], 'caves', [ 'insect', 'fire', 'brood' ], 'hive-queen', 'The Ash Queen', 'A hive of burning ash. Thousands of them.' );
L( 11, 'chrono-fields', 'Chrono Fields', 'clockwork-ruins', [ 'chrono-fields' ], 'dungeon', [ 'construct', 'metal', 'automaton' ], 'clockwork-titan', 'The Clockwork Titan', 'Ruins where time runs at different speeds.' );
L( 12, 'miasma', 'Miasma', 'blightmarsh', [ 'miasma' ], 'caves', [ 'poison', 'swamp', 'plant' ], 'blight-mother', 'The Blight Mother', 'A marsh exhaling poison.' );

// combinations: the mechanics meet, in themes that suit both
L( 13, 'powder-ice', 'Powder Ice', 'frostfang-pass', [ 'powder-keg', 'black-ice' ], 'caves', [ 'cold', 'beast', 'miner' ], 'frostfang-alpha', 'Frostfang Matriarch', 'Kegs on ice: one good hit and they skate into the pack.', { palette: { hue: - 0.04, sat: 1.1, light: 0.95 } } );
L( 14, 'dark-conduits', 'Dark Conduits', 'storm-foundry', [ 'lightless', 'conduits' ], 'dungeon', [ 'lightning', 'shadow', 'construct' ], 'foundry-colossus', 'The Dark Dynamo', 'The foundry\'s lights are out - only the beams remain.', { palette: { hue: 0.06, sat: 0.9, light: 0.85 } } );
L( 15, 'echo-tide', 'Echo Tide', 'cinder-caldera', [ 'echoes', 'magma-tide' ], 'caves', [ 'fire', 'spirit', 'elemental' ], 'cinder-wyrm', 'The Twice-Burned Wyrm', 'Your echo walks where the magma will rise.', { palette: { hue: 0.05, sat: 1, light: 1.05 } } );
L( 16, 'gravity-kegs', 'Gravity Kegs', 'hollow-moon', [ 'gravity-wells', 'powder-keg' ], 'caves', [ 'void', 'insect', 'miner' ], 'void-maw', 'The Hungering Maw', 'Wells drag the kegs into the crowd. You light them.', { palette: { hue: - 0.08, sat: 1.15, light: 1 } } );
L( 17, 'rift-swarm', 'Rift Swarm', 'ashen-hive', [ 'rift-gates', 'swarm' ], 'caves', [ 'insect', 'void', 'brood' ], 'hive-queen', 'The Rift Queen', 'The swarm pours through folds in space.', { palette: { hue: 0.7, sat: 0.9, light: 1 } } );
L( 18, 'chrono-miasma', 'Chrono Miasma', 'blightmarsh', [ 'chrono-fields', 'miasma' ], 'caves', [ 'poison', 'construct', 'plant' ], 'blight-mother', 'The Timeless Rot', 'Fog that ages in fast and slow time.', { palette: { hue: 0.08, sat: 1, light: 1 } } );
L( 19, 'lightless-spikes', 'Lightless Spikes', 'gloom-catacombs', [ 'lightless', 'spike-field' ], 'dungeon', [ 'undead', 'shadow', 'skeleton' ], 'lantern-eater', 'The Impaler in the Dark', 'You hear the spikes before you see them.', { palette: { hue: - 0.05, sat: 1.1, light: 0.9 } } );
L( 20, 'the-gauntlet', 'The Gauntlet', 'clockwork-ruins', [ 'spike-field', 'conduits', 'powder-keg' ], 'dungeon', [ 'construct', 'automaton', 'lightning' ], 'clockwork-titan', 'The Gauntlet Engine', 'Spikes, beams and powder. Everything you learned, at once.', { palette: { hue: - 0.06, sat: 1.1, light: 0.95 } } );

// --- providers ----------------------------------------------------------------------

export function campaignSpec( depth ) {

	const def = all( 'level' ).find( ( l ) => l.depth === depth );
	if ( ! def ) return null;
	return finishSpec( {
		id: def.id, depth, name: def.name, theme: def.theme, palette: def.palette || null, mechanics: [ ...def.mechanics ],
		generator: def.generator, families: [ ...def.families ], boss: def.boss, bossName: def.bossName,
		bossTags: [ ...def.families.slice( 0, 2 ), ...def.mechanics ], kind: def.kind, desc: def.desc
	} );

}

function finishSpec( s ) {

	s.level = areaLevel( s.depth );
	s.seed = s.seed ?? hashStr( 'level:' + s.id + ':' + s.depth );
	s.intensity = {};
	for ( const m of s.mechanics ) s.intensity[ m ] = +intensityAt( m, s.depth ).toFixed( 2 );
	s.size = s.size ?? ( s.depth > 20 ? Math.min( 1.25, 1 + ( s.depth - 20 ) * 0.004 ) : 1 );
	return s;

}

// Mechanics that can share a level with every one already picked.
function compatible( def, picked ) {

	return picked.every( ( p ) => p.id !== def.id && ! ( def.conflicts || [] ).includes( p.id ) && ! ( p.conflicts || [] ).includes( def.id ) );

}

export function endlessSpec( depth ) {

	const rng = new RNG( 'endless:' + depth );
	const mechs = all( 'mechanic' );
	const count = depth % 10 === 0 ? 3 : rng.weighted( [ { n: 1, weight: 2 }, { n: 2, weight: 5 }, { n: 3, weight: 2 } ] ).n;
	const picked = [ rng.pick( mechs ) ];
	while ( picked.length < count ) {

		const cands = mechs.filter( ( m ) => compatible( m, picked ) );
		if ( ! cands.length ) break;
		// good pairs are 4x as likely: combinations should feel designed
		const next = rng.weighted( cands, ( m ) => picked.some( ( p ) => ( p.combinesWith || [] ).includes( m.id ) || ( m.combinesWith || [] ).includes( p.id ) ) ? 4 : 1 );
		picked.push( next );

	}

	const themes = campaignThemes();
	const home = get( 'theme', picked[ 0 ].theme );
	const theme = home && rng.chance( 0.5 ) ? home : rng.pick( themes );
	const trial = depth % 10 === 0;
	const generator = trial ? 'arena' : rng.chance( 0.75 ) ? theme.generator : rng.pick( [ 'dungeon', 'caves' ] );
	const extraTags = [ 'beast', 'undead', 'construct', 'insect', 'void', 'fire', 'cold', 'lightning', 'poison', 'arcane', 'spirit', 'elemental' ];
	const families = [ ...new Set( [ ...( theme.families || [] ).slice( 0, 2 ), rng.pick( extraTags ) ] ) ];
	const name = trial ? `Trial of ${noun( rng, picked[ picked.length - 1 ] )}` : levelName( rng, picked, theme );
	return finishSpec( {
		id: 'endless-' + depth, depth, name, theme: theme.id, mechanics: picked.map( ( m ) => m.id ), generator, families,
		palette: { hue: rng.range( - 0.14, 0.14 ), sat: rng.range( 0.85, 1.2 ), light: rng.range( 0.88, 1.12 ) },
		boss: 'procedural', bossName: bossName( rng, picked, theme ), bossTags: [ ...families, ...picked.map( ( m ) => m.id ) ], bossSeed: rng.int( 1, 2 ** 31 - 1 ),
		kind: trial ? 'trial' : 'endless', seed: hashStr( 'endless:' + depth ),
		desc: picked.map( ( m ) => m.name ).join( ' + ' ) + ' in a ' + theme.name.toLowerCase() + '.'
	} );

}

const adj = ( rng, m ) => rng.pick( m.words?.adj || [ m.name ] );
const noun = ( rng, m, avoid = '' ) => {

	// never "Charged Charges": skip nouns sharing a stem with the adjective before them
	const list = ( m.words?.noun || [ m.name ] ).filter( ( n ) => ! avoid || n.slice( 0, 4 ).toLowerCase() !== avoid.slice( 0, 4 ).toLowerCase() );
	return rng.pick( list.length ? list : [ m.name ] );

};
const PLACES = [ 'Depths', 'Halls', 'Hollows', 'Reaches', 'Pits', 'Vaults', 'Warrens', 'Deeps', 'Galleries', 'Sumps' ];

// "Molten Kegs", "Frozen Rift Swarm", "Spiked Hollows"
export function levelName( rng, mechs, theme ) {

	if ( mechs.length === 1 ) return `${adj( rng, mechs[ 0 ] )} ${rng.pick( PLACES )}`;
	const a = adj( rng, mechs[ 0 ] );
	if ( mechs.length === 2 ) return `${a} ${noun( rng, mechs[ 1 ], a )}`;
	const b = adj( rng, mechs[ 1 ] );
	return `${a} ${b} ${noun( rng, mechs[ 2 ], b )}`;

}

const TITLES = [ 'Warden', 'Tyrant', 'Matron', 'Engine', 'Herald', 'Sovereign', 'Devourer', 'Colossus', 'Abbot', 'Brute' ];

function bossName( rng, mechs, theme ) {

	return `The ${adj( rng, mechs[ 0 ] )} ${rng.pick( TITLES )}`;

}

define( 'levelProvider', { id: 'campaign', order: 10, spec: ( game, depth ) => campaignSpec( depth ) } );
define( 'levelProvider', { id: 'endless', order: 20, spec: ( game, depth ) => depth > 20 ? endlessSpec( depth ) : null } );

// Every depth 1..n as specs (waypoint panel, agents, docs).
export function campaign( n = 20 ) {

	return Array.from( { length: n }, ( _, i ) => campaignSpec( i + 1 ) ).filter( Boolean );

}
