// Portable imports reject invented progression content before replacement;
// local repairs keep real allocations/runes and the exact original recovery file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game/sim-entry.js';
import { all } from '../src/game/core/registry.js';
import { ensureSave, validateSave } from '../src/game/features/progression/save.js';
import { getTree, chooseAscendancy, ascAllocate, respec } from '../src/game/features/progression/tree.js';
import { learnSkill, assignSkill, addRune, socketSupport } from '../src/game/features/progression/skills.js';
import { createBuildPlan, evaluateBuildPlan, validateBuildPlan } from '../src/game/features/progression/planner.js';
import { SaveManager, SAVE_KEY, RECOVERY_KEY, parseCharacter, exportCharacter } from '../src/game/features/progression/persistence.js';

const character = () => ensureSave( new Game( { seed: 'save-content', headless: true } ).save );
const clone = ( value ) => structuredClone( value );
const T = getTree();
const ascendancy = all( 'ascendancy' )[ 0 ].id;

function locks() {

	return { async request( name, options, callback ) { return callback( { name } ); } };

}

function storage( raw ) {

	const values = new Map( [ [ SAVE_KEY, raw ] ] );
	return { getItem: ( key ) => values.get( key ) ?? null, setItem: ( key, value ) => values.set( key, String( value ) ) };

}

const invalidContent = [
	[ 'current passive id', ( s ) => s.tree.allocated.push( 'missing-passive' ), /Passive nodes/ ],
	[ 'old passive id', ( s ) => { s.tree.version = 'older-tree'; s.tree.allocated.push( 'missing-passive' ); }, /Passive nodes/ ],
	[ 'ascendancy id', ( s ) => { s.level = 30; s.tree.asc = { id: 'missing-ascendancy', allocated: [ 'missing-ascendancy:root' ] }; }, /Unknown ascendancy/ ],
	[ 'ascendancy prototype id', ( s ) => { s.level = 30; s.tree.asc = { id: 'constructor', allocated: [ 'constructor:root' ] }; }, /Unknown ascendancy/ ],
	[ 'ascendancy node', ( s ) => { s.level = 30; s.tree.asc = { id: ascendancy, allocated: [ `${ascendancy}:root`, 'missing-asc-node' ] }; }, /Ascendancy nodes/ ],
	[ 'foreign ascendancy node', ( s ) => { s.level = 30; s.tree.asc = { id: ascendancy, allocated: [ `${ascendancy}:root`, `${all( 'ascendancy' )[ 1 ].id}:s0` ] }; }, /Ascendancy nodes/ ],
	[ 'known skill', ( s ) => s.skills.known.push( 'missing-skill' ), /Known skills/ ],
	[ 'bar skill', ( s ) => { s.skills.bar[ 0 ] = 'missing-skill'; }, /Skill bar/ ],
	[ 'support id', ( s ) => { s.skills.supports.fireball = [ 'missing-support' ]; }, /support/i ],
	[ 'support skill key', ( s ) => { s.skills.supports[ 'missing-skill' ] = [ 'pierce' ]; }, /Unknown skill/ ],
	[ 'rune id', ( s ) => { s.skills.runes[ 'missing-support' ] = 1; }, /Unknown support rune/ ],
	[ 'level skill key', ( s ) => { s.skills.levels[ 'missing-skill' ] = 1; }, /Unknown skill/ ],
	[ 'experience skill key', ( s ) => { s.skills.xp[ 'missing-skill' ] = 1; }, /Unknown skill/ ]
];

test( 'strict portable imports reject unknown registry content without mutating the character', () => {

	for ( const [ name, change, pattern ] of invalidContent ) {

		const save = character(); change( save );
		const before = JSON.stringify( save );
		assert.throws( () => validateSave( save ), pattern, name );
		assert.equal( JSON.stringify( save ), before, `${name}: strict validation is read-only` );
		assert.throws( () => parseCharacter( before, { strict: true } ), pattern, name );
		assert.throws( () => exportCharacter( save ), pattern, name );

	}

} );

test( 'invalid direct replacements preserve the stored character, revision and ownership', async () => {

	const original = character(), raw = JSON.stringify( original ), store = storage( raw );
	const manager = new SaveManager( { storage: store, locks: locks(), events: null } );
	await manager.load();
	try {

		for ( const [ name, change, pattern ] of invalidContent ) {

			const invalid = clone( original ); change( invalid );
			await assert.rejects( manager.replace( invalid ), pattern, name );
			assert.equal( store.getItem( SAVE_KEY ), raw, name );
			assert.equal( manager.revision, 0, name );
			assert.equal( manager.writer, true, name );

		}

	} finally { manager.dispose(); }

} );

test( 'current-version local corruption repairs every content field before opening the planner', () => {

	for ( const [ name, change ] of invalidContent ) {

		const initial = character(); change( initial );
		const parsed = parseCharacter( JSON.stringify( initial ) );
		assert.equal( parsed.repaired, true, name );
		assert.doesNotThrow( () => validateSave( parsed.save ), name );
		const game = new Game( { save: parsed.save, headless: true } ), plan = createBuildPlan( game.save );
		assert.equal( validateBuildPlan( plan ).ok, true, name );
		assert.doesNotThrow( () => evaluateBuildPlan( game, plan ), name );

	}

} );

test( 'defensive passive and ascendancy repair keeps connected content within available points', () => {

	const save = character(); save.level = 30;
	const neighbor = T.nodes.get( 's.might' ).links[ 0 ];
	save.tree.allocated.push( neighbor, 'k.chaos-inoculation', 'missing-passive', neighbor );
	save.tree.asc = { id: ascendancy, allocated: [ `${ascendancy}:root`, `${ascendancy}:s0`, `${ascendancy}:n0`, `${ascendancy}:s1`, 'missing-asc-node' ] };
	const repaired = parseCharacter( JSON.stringify( save ) ).save;
	assert.deepEqual( repaired.tree.allocated, [ 's.might', neighbor ] );
	assert.deepEqual( repaired.tree.asc.allocated, [ `${ascendancy}:root`, `${ascendancy}:s0`, `${ascendancy}:s1` ] );
	assert.doesNotThrow( () => validateSave( repaired ) );
	const overspent = character(); overspent.tree.allocated.push( neighbor );
	assert.throws( () => validateSave( overspent ), /passive allocations/ );
	assert.deepEqual( parseCharacter( JSON.stringify( overspent ) ).save.tree.allocated, [ 's.might' ] );

} );

test( 'support repair returns known incompatible, duplicate and excess socketed runes', () => {

	const save = character();
	save.skills.supports.fireball = [ 'pierce', 'pierce', 'faster-attacks', 'missing-support', 'added-fire', 'multiple-projectiles' ];
	save.skills.supports[ 'missing-skill' ] = [ 'chain' ];
	save.skills.runes.pierce = 2;
	save.skills.runes[ 'missing-support' ] = 20;
	assert.throws( () => validateSave( save ), /support/i );
	const repaired = parseCharacter( JSON.stringify( save ) ).save;
	assert.deepEqual( repaired.skills.supports.fireball, [ 'pierce', 'added-fire' ] );
	assert.deepEqual( repaired.skills.runes, { pierce: 3, 'faster-attacks': 1, 'multiple-projectiles': 1, chain: 1 } );
	assert.equal( Object.hasOwn( repaired.skills.supports, 'missing-skill' ), false );
	assert.doesNotThrow( () => evaluateBuildPlan( new Game( { save: repaired, headless: true } ), createBuildPlan( repaired ) ) );

} );

test( 'invalid skill levels and duplicate/locked bars repair into a valid planner loadout', () => {

	const save = character();
	save.skills.levels.fireball = 1e308;
	save.skills.bar[ 1 ] = save.skills.bar[ 0 ];
	save.skills.bar[ 2 ] = 'meteor';
	save.skills.known.push( 'meteor' );
	assert.throws( () => validateSave( save ), /Known skills/ );
	const repaired = parseCharacter( JSON.stringify( save ) ).save;
	assert.equal( repaired.skills.levels.fireball, 1 );
	assert.equal( repaired.skills.known.includes( 'meteor' ), false );
	assert.equal( new Set( repaired.skills.bar.filter( Boolean ) ).size, repaired.skills.bar.filter( Boolean ).length );
	assert.doesNotThrow( () => evaluateBuildPlan( new Game( { save: repaired, headless: true } ), createBuildPlan( repaired ) ) );

} );

test( 'repairing loaded registry corruption preserves the exact original raw save in Recovery', async () => {

	const initial = character(); initial.gold = 371;
	initial.tree.allocated.push( 'missing-passive' );
	initial.tree.asc = { id: 'missing-ascendancy', allocated: [ 'missing-asc-node' ] };
	initial.skills.supports.fireball = [ 'missing-support', 'pierce' ];
	const raw = JSON.stringify( initial, null, 2 ), store = storage( raw );
	const manager = new SaveManager( { storage: store, locks: locks(), events: null } );
	try {

		const repaired = await manager.load();
		assert.equal( manager.status.code, 'repaired' );
		assert.equal( manager.recovery().raw, raw );
		assert.equal( store.getItem( SAVE_KEY ), raw, 'Loading leaves the original record untouched' );
		assert.equal( repaired.gold, 371 );
		assert.deepEqual( repaired.equipment, initial.equipment );
		assert.equal( await manager.save( repaired ), true );
		assert.equal( JSON.parse( store.getItem( RECOVERY_KEY ) ).raw, raw );
		assert.doesNotThrow( () => parseCharacter( store.getItem( SAVE_KEY ), { strict: true } ) );

	} finally { manager.dispose(); }

} );

test( 'real starter, kit, learned, socketed and respecced characters remain valid portable saves', () => {

	for ( const level of [ 1, 30, 75, 100 ] ) {

		const game = new Game( { seed: `content-kit:${level}`, headless: true } );
		game.enterTown();
		game.api( 'player.kit', { level, seed: 'portable-content' } );
		if ( level >= 30 ) {

			assert.equal( learnSkill( game.save, 'meteor' ).ok, true );
			assert.equal( assignSkill( game.save, 5, 'meteor' ).ok, true );
			assert.equal( chooseAscendancy( game.save, ascendancy ).ok, true );
			assert.equal( ascAllocate( game.save, `${ascendancy}:s0` ).ok, true );
			assert.equal( ascAllocate( game.save, `${ascendancy}:n0` ).ok, true );

		}
		addRune( game.save, 'pierce', 1 );
		assert.equal( socketSupport( game.save, 'fireball', 'pierce' ).ok, true );
		assert.doesNotThrow( () => validateSave( game.save ), `Kit level ${level}` );
		const portable = parseCharacter( exportCharacter( game.save ), { strict: true } ).save;
		assert.equal( portable.level, level );
		assert.deepEqual( portable.tree, game.save.tree );
		assert.deepEqual( portable.skills, game.save.skills );
		assert.doesNotThrow( () => evaluateBuildPlan( game, createBuildPlan( portable ) ), `Kit planner level ${level}` );
		if ( level >= 30 ) {

			respec( game.save );
			assert.doesNotThrow( () => validateSave( game.save ), 'Respec is a real empty ascendancy branch' );
			const respecced = parseCharacter( exportCharacter( game.save ), { strict: true } ).save;
			assert.deepEqual( respecced.tree.asc.allocated, [ `${ascendancy}:root` ] );
			assert.doesNotThrow( () => evaluateBuildPlan( game, createBuildPlan( respecced ) ) );

		}

	}

} );
