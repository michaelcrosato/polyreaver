// Persistence and identity regressions use the real save manager and simulation.
// In-memory storage and Web Lock shims isolate browser ownership semantics;
// fresh Node subprocesses exercise identity across actual module reloads.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { Game } from '../src/game/sim-entry.js';
import { RNG } from '../src/game/core/rng.js';
import { all, get } from '../src/game/core/registry.js';
import { newUid, makeItem, makeUnique, computeItem } from '../src/game/features/progression/items.js';
import { ensureSave, validateSave } from '../src/game/features/progression/save.js';
import { activeProviders } from '../src/game/features/progression/stats.js';
import { SaveManager, SAVE_KEY, BACKUP_KEY, RECOVERY_KEY, parseCharacter, exportCharacter } from '../src/game/features/progression/persistence.js';

function storage( raw = null ) {

	const data = new Map( raw === null ? [] : [ [ SAVE_KEY, raw ] ] );
	return { getItem: ( key ) => data.get( key ) ?? null, setItem: ( key, value ) => data.set( key, String( value ) ), removeItem: ( key ) => data.delete( key ) };

}

const character = () => new Game( { headless: true, seed: 'save-regression' } ).save;
const storageLocks = new WeakMap();
const manager = ( store, options = {} ) => {

	if ( ! storageLocks.has( store ) ) storageLocks.set( store, locks() );
	return new SaveManager( { storage: store, locks: storageLocks.get( store ), events: null, ...options } );

};
const stored = ( store ) => parseCharacter( store.getItem( SAVE_KEY ) ).save;

function locks() {

	const held = new Set();
	return { async request( name, options, fn ) {

		if ( held.has( name ) ) return fn( null );
		held.add( name );
		try { return await fn( { name } ); }
		finally { held.delete( name ); }

	} };

}

function delayedLocks() {

	const service = locks(), pending = [];
	let delayed = false;
	return { get pending() { return pending.length; }, pause() { delayed = true; },
		request( ...args ) {

			if ( ! delayed ) return service.request( ...args );
			return new Promise( ( resolve, reject ) => pending.push( () => service.request( ...args ).then( resolve, reject ) ) );

		},
		async flush() {

			delayed = false;
			for ( const run of pending.splice( 0 ) ) run();
			await new Promise( setImmediate );

		} };

}

async function staleFollower() {

	const initial = character(); initial.gold = 100;
	const store = storage( JSON.stringify( initial ) ), lockService = delayedLocks();
	const owner = manager( store, { locks: lockService } ), follower = manager( store, { locks: lockService } );
	const current = await owner.load(), stale = await follower.load();
	current.gold = 200; await owner.save( current );
	owner.dispose(); await owner.lockRequest;
	lockService.pause();
	return { store, lockService, follower, stale };

}

test( 'stale tabs cannot overwrite a newer character, including after the owner closes', async () => {

	const initial = character(); initial.gold = 100;
	const store = storage( JSON.stringify( initial ) );
	const a = manager( store, { id: 'tab-a' } ), b = manager( store, { id: 'tab-b' } );
	const saveA = await a.load(), saveB = await b.load();
	assert.equal( a.writer, true ); assert.equal( b.writer, false );
	saveA.gold = 200;
	assert.equal( await a.save( saveA ), true );
	saveB.gold = 110;
	assert.equal( await b.save( saveB ), false );
	assert.equal( stored( store ).gold, 200 );
	a.dispose(); await a.lockRequest;
	assert.equal( await b.save( saveB ), false );
	assert.equal( b.status.code, 'conflict' );
	assert.equal( stored( store ).gold, 200 );
	const latest = await b.latest();
	assert.equal( latest.gold, 200 );
	latest.gold = 250;
	assert.equal( await b.save( latest ), true );
	b.dispose();

} );

test( 'Web Locks allow only one writer and release cleanly', async () => {

	const store = storage( JSON.stringify( character() ) ), lockService = locks();
	const a = manager( store, { locks: lockService } ), b = manager( store, { locks: lockService } );
	await Promise.all( [ a.load(), b.load() ] );
	assert.equal( Number( a.writer ) + Number( b.writer ), 1 );
	const owner = a.writer ? a : b, follower = a.writer ? b : a;
	owner.dispose(); await owner.lockRequest;
	assert.equal( await follower.claim(), true );
	follower.dispose(); await follower.lockRequest;

} );

test( 'loading the latest character cancels pending autosaves and suspends autosaves/lifecycle flushes during ownership acquisition', async () => {

	const { store, lockService, follower, stale } = await staleFollower();
	const pendingSave = follower.save( stale );
	const loading = follower.latest();
	assert.equal( await follower.save( stale ), false );
	assert.equal( follower.write( stale ), false );
	await new Promise( setImmediate );
	assert.equal( lockService.pending, 1, 'Autosave and explicit load must share one pending lock decision.' );
	assert.equal( await follower.save( stale ), false );
	await lockService.flush();
	assert.equal( await pendingSave, false );
	const latest = await loading;
	assert.equal( latest.gold, 200 );
	assert.equal( stored( store ).gold, 200 );
	assert.equal( follower.status.code, 'ready' );
	latest.gold = 250;
	assert.equal( await follower.save( latest ), true );
	assert.equal( stored( store ).gold, 250 );
	follower.dispose();

} );

test( 'explicit replacement cancels old pending autosaves and rejects old live state submitted while the replacement awaits a lock', async () => {

	const { store, lockService, follower, stale } = await staleFollower();
	const pendingSave = follower.save( stale ), imported = character(); imported.gold = 300;
	const replacing = follower.replace( imported );
	assert.equal( await follower.save( stale ), false );
	assert.equal( follower.write( stale ), false );
	await new Promise( setImmediate );
	assert.equal( lockService.pending, 1 );
	assert.equal( await follower.save( stale ), false );
	await lockService.flush();
	assert.equal( await pendingSave, false );
	assert.equal( await replacing, true );
	assert.equal( stored( store ).gold, 300 );
	assert.equal( follower.backup().gold, 200 );
	assert.equal( follower.status.code, 'saved' );
	assert.equal( await follower.save( imported ), true );
	follower.dispose();

} );

test( 'queued explicit operations survive a failed replacement rollback without clobbering their revisions or backups', async () => {

	const initial = character(); initial.gold = 500;
	const store = storage( JSON.stringify( initial ) ), saves = manager( store );
	await saves.load( { fresh: true } );
	const set = store.setItem;
	let rejectOnce = true;
	store.setItem = ( key, value ) => {

		if ( key === BACKUP_KEY && rejectOnce ) { rejectOnce = false; throw new Error( 'Backup quota exceeded' ); }
		set( key, value );

	};
	const first = character(), second = character(); first.gold = 100; second.gold = 200;
	const failed = saves.replace( first ), replaced = saves.replace( second ), loaded = saves.latest();
	assert.equal( await saves.save( initial ), false );
	assert.equal( await failed, false );
	assert.equal( await replaced, true );
	assert.equal( ( await loaded ).gold, 200 );
	assert.equal( stored( store ).gold, 200 );
	assert.equal( saves.backup().gold, 500 );
	assert.equal( saves.revision, 1 );
	assert.equal( saves.mode, 'active' );
	assert.equal( saves.writer, true );
	assert.equal( await saves.save( second ), true );
	saves.dispose();

} );

test( 'release or disposal invalidates ownership requests still waiting for their browser callback', async () => {

	for ( const method of [ 'release', 'dispose' ] ) {

		const lockService = delayedLocks(), store = storage( JSON.stringify( character() ) );
		const saves = manager( store, { locks: lockService } );
		lockService.pause();
		const loading = saves.load();
		await new Promise( setImmediate );
		assert.equal( lockService.pending, 1 );
		saves[ method ]();
		await lockService.flush(); await loading;
		assert.equal( saves.writer, false );
		assert.equal( saves.releaseLock, null );
		await saves.lockRequest;
		const next = manager( store, { locks: lockService } );
		await next.load();
		assert.equal( next.writer, true );
		next.dispose(); saves.dispose();

	}

} );

test( 'simultaneous autosaves share ownership acquisition and skip an already superseded expected revision', async () => {

	const lockService = delayedLocks(), store = storage( JSON.stringify( character() ) );
	const saves = manager( store, { locks: lockService } ), save = await saves.load();
	saves.release(); await saves.lockRequest; lockService.pause();
	save.gold = 100;
	const a = saves.save( save ), b = saves.save( save );
	await new Promise( setImmediate );
	assert.equal( lockService.pending, 1 );
	await lockService.flush();
	assert.deepEqual( await Promise.all( [ a, b ] ), [ true, false ] );
	assert.equal( stored( store ).gold, 100 );
	assert.equal( saves.status.code, 'saved' );
	saves.dispose();

} );

test( 'queued older storage events do not revoke ownership after loading the latest revision', async () => {

	const store = storage(), saves = manager( store );
	await saves.load();
	const save = character(); save.gold = 100;
	await saves.save( save );
	const olderEventValue = store.getItem( SAVE_KEY );
	save.gold = 200; await saves.save( save );
	const latest = await saves.latest();
	saves.onStorage( { key: SAVE_KEY, newValue: olderEventValue } );
	assert.equal( saves.writer, true );
	assert.equal( saves.mode, 'active' );
	latest.gold = 300;
	assert.equal( await saves.save( latest ), true );
	assert.equal( stored( store ).gold, 300 );
	// A real current revision change still stops saving, even if its notification
	// carries a different/older value. Clearing storage has the same protection.
	store.setItem( SAVE_KEY, JSON.stringify( { ...character(), gold: 400 } ) );
	saves.onStorage( { key: SAVE_KEY, newValue: olderEventValue } );
	assert.equal( saves.status.code, 'conflict' );
	assert.equal( await saves.save( latest ), false );
	assert.equal( stored( store ).gold, 400 );
	saves.dispose();

} );

test( 'revoked Web Lock permissions leave the game playable and exportable', async () => {

	const store = storage( JSON.stringify( character() ) );
	const saves = manager( store, { locks: { request() { throw new Error( 'Permission denied' ); } } } );
	const save = await saves.load();
	assert.equal( save.version, 1 );
	assert.equal( saves.writer, false );
	assert.equal( saves.status.code, 'error' );
	assert.equal( parseCharacter( exportCharacter( save ), { strict: true } ).save.version, 1 );
	saves.dispose();

} );

test( 'storage denial permits session imports and exports without persistence', async () => {

	const saves = manager( { getItem() { throw new Error( 'Denied' ); } } );
	assert.equal( await saves.load(), null );
	const save = character();
	assert.equal( await saves.save( save ), false );
	assert.equal( await saves.replace( save ), true );
	assert.equal( parseCharacter( exportCharacter( save ), { strict: true } ).save.name, save.name );
	assert.equal( saves.status.code, 'unavailable' );
	saves.dispose();

} );

test( 'storage-positive browsers without Web Locks protect the stored character and allow session imports', async () => {

	const initial = character(); initial.gold = 500;
	const raw = JSON.stringify( initial ), store = storage( raw ), saves = manager( store, { locks: null } );
	const save = await saves.load();
	assert.equal( save.gold, 500 );
	assert.equal( saves.writer, false );
	assert.equal( saves.status.code, 'unavailable' );
	save.gold = 600;
	assert.equal( await saves.save( save ), false );
	const imported = character(); imported.gold = 100;
	assert.equal( await saves.replace( imported ), true );
	assert.equal( saves.mode, 'session' );
	assert.equal( await saves.save( imported ), false );
	assert.equal( store.getItem( SAVE_KEY ), raw );
	assert.equal( parseCharacter( exportCharacter( imported ), { strict: true } ).save.gold, 100 );
	saves.dispose();

} );

test( 'failed storage writes keep the last good save and report a visible error', async () => {

	const store = storage(), saves = manager( store );
	await saves.load();
	const save = character();
	assert.equal( await saves.save( save ), true );
	const before = store.getItem( SAVE_KEY ), savedAt = save.savedAt;
	const set = store.setItem;
	store.setItem = ( key, value ) => { if ( key === SAVE_KEY ) throw new Error( 'Quota exceeded' ); set( key, value ); };
	save.gold = 123;
	assert.equal( await saves.save( save ), false );
	assert.equal( store.getItem( SAVE_KEY ), before );
	assert.equal( save.savedAt, savedAt );
	assert.equal( saves.status.code, 'error' );
	store.setItem = set;
	assert.equal( await saves.save( save ), true );
	assert.equal( stored( store ).gold, 123 );
	saves.dispose();

} );

test( 'nested damaged saves repair before entering the real town and retain original bytes', async () => {

	for ( const mutate of [
		( save ) => { save.inventory = {}; },
		( save ) => { save.flasks = {}; },
		( save ) => { save.stash.tabs[ 0 ].items = null; },
		( save ) => { save.skills = { bar: {}, known: 4 }; save.tree = { allocated: null, asc: 2 }; save.lifetime = 'bad'; }
	] ) {

		const initial = character(); mutate( initial );
		const raw = JSON.stringify( initial ), store = storage( raw ), saves = manager( store );
		const save = await saves.load();
		const game = new Game( { save, headless: true } );
		assert.doesNotThrow( () => game.enterTown() );
		assert.equal( save.inventory.items.length, 60 );
		assert.equal( save.flasks.slots.length, 4 );
		assert.equal( await saves.save( save ), true );
		assert.equal( JSON.parse( store.getItem( RECOVERY_KEY ) ).raw, raw );
		saves.dispose();

	}

} );

test( 'invalid JSON and future saves remain untouched until explicit recovery', async () => {

	for ( const raw of [ '{invalid json', JSON.stringify( { ...character(), version: 99 } ), JSON.stringify( { ...character(), progression: { version: 999 } } ) ] ) {

		const store = storage( raw ), saves = manager( store );
		assert.equal( await saves.load(), null );
		assert.equal( await saves.save( character() ), false );
		assert.equal( store.getItem( SAVE_KEY ), raw );
		assert.equal( saves.recovery().raw, raw );
		assert.equal( await saves.replace( character() ), true );
		assert.equal( JSON.parse( store.getItem( RECOVERY_KEY ) ).raw, raw );
		saves.dispose();

	}

} );

test( 'fresh sessions protect the existing save until an explicit replacement', async () => {

	const initial = character(); initial.gold = 500;
	const raw = JSON.stringify( initial ), store = storage( raw ), saves = manager( store );
	assert.equal( await saves.load( { fresh: true } ), null );
	const fresh = character();
	assert.equal( await saves.save( fresh ), false );
	assert.equal( store.getItem( SAVE_KEY ), raw );
	assert.equal( await saves.replace( fresh ), true );
	assert.equal( saves.backup().gold, 500 );
	saves.dispose();

} );

test( 'imports retain an undo snapshot across unchanged autosaves and town transitions', async () => {

	const initial = character(); initial.gold = 500;
	const store = storage( JSON.stringify( initial ) ), saves = manager( store );
	await saves.load();
	const imported = parseCharacter( exportCharacter( character() ), { strict: true } ).save;
	assert.equal( await saves.replace( imported ), true );
	const previous = store.getItem( BACKUP_KEY ), revision = saves.revision;
	assert.equal( await saves.save( imported ), true );
	assert.equal( saves.revision, revision );
	const game = new Game( { save: imported, headless: true } ); game.enterTown();
	assert.equal( await saves.save( game.save ), true );
	assert.equal( store.getItem( BACKUP_KEY ), previous );
	assert.equal( saves.backup().gold, 500 );
	assert.equal( await saves.replace( saves.backup() ), true );
	assert.equal( stored( store ).gold, 500 );
	assert.equal( saves.backup().gold, 0 );
	saves.dispose();

} );

test( 'failed replacement cannot activate autosaving a fresh session over the stored character', async () => {

	const initial = character(); initial.gold = 500;
	const store = storage( JSON.stringify( initial ) ), saves = manager( store );
	await saves.load( { fresh: true } );
	const set = store.setItem;
	store.setItem = ( key, value ) => { if ( key === BACKUP_KEY ) throw new Error( 'Backup quota exceeded' ); set( key, value ); };
	const imported = character(); imported.gold = 100;
	assert.equal( await saves.replace( imported ), false );
	assert.equal( saves.mode, 'session' );
	assert.equal( saves.writer, false );
	store.setItem = set;
	assert.equal( await saves.save( character() ), false );
	assert.equal( stored( store ).gold, 500 );
	assert.equal( await saves.replace( imported ), true );
	assert.equal( stored( store ).gold, 100 );
	assert.equal( saves.backup().gold, 500 );
	saves.dispose();

} );

test( 'strict imports reject malformed modifiers, unknown items, and unsupported files', () => {

	for ( const mutation of [
		( save ) => { save.equipment.weapon.affixes = [ { id: 'local-phys-inc', tier: 0, values: [] } ]; },
		( save ) => { save.equipment.weapon.affixes = [ { id: 'local-phys-inc', tier: 0, values: [ 10, 20 ] } ]; },
		( save ) => { save.equipment.weapon.affixes = [ { id: 'local-phys-inc', tier: 'length', values: [ 10 ] } ]; },
		( save ) => { save.progression.version = 'bad'; },
		( save ) => { save.progression.version = - 1.5; },
		( save ) => { save.equipment.weapon.roll = { armor: 'invalid' }; },
		( save ) => { save.level = 1e308; },
		( save ) => { save.depth = 1e308; },
		( save ) => { save.equipment.weapon.affixes = [ { id: 'local-phys-inc', tier: 0, values: [ 1e308 ] } ]; },
		( save ) => { save.equipment.weapon.implicits[ 0 ].value = 1e308; },
		( save ) => { save.equipment.weapon.implicits = [ { stat: 'damage', type: 'oops', value: 10 } ]; },
		( save ) => { save.equipment.weapon.implicits = [ { stat: 'damage', type: 'flat', value: 10, tags: {} } ]; },
		( save ) => { save.inventory.items[ 0 ] = { base: 'unknown', rarity: 'rare' }; },
		( save ) => { save.stash.tabs[ 0 ].items = null; }
	] ) {

		const save = character(); mutation( save );
		assert.throws( () => parseCharacter( JSON.stringify( save ), { strict: true } ) );

	}
	assert.throws( () => parseCharacter( JSON.stringify( { format: 'other-game', formatVersion: 1, save: character() } ), { strict: true } ) );

} );

test( 'real generated rare, unique and corrupted items remain valid portable characters', () => {

	const save = character(), vaal = get( 'currency', 'vaal' ), outcomes = new Set();
	for ( const base of all( 'itemBase' ) ) for ( const rarity of [ 'normal', 'rare' ] ) {

		if ( rarity === 'rare' && base.flask ) continue;
		const item = makeItem( base.id, 100, rarity, new RNG( `valid:${base.id}:${rarity}` ) );
		save.inventory.items[ 0 ] = item;
		assert.doesNotThrow( () => validateSave( save ), `${base.id}:${rarity}` );
		for ( let n = 0; n < 6; n ++ ) {

			const corrupted = structuredClone( item );
			vaal.apply( corrupted, new RNG( `corruption:${base.id}:${rarity}:${n}` ), base );
			outcomes.add( corrupted.corruptOutcome );
			save.inventory.items[ 0 ] = corrupted;
			assert.doesNotThrow( () => validateSave( save ), `${base.id}:${rarity}:${corrupted.corruptOutcome}` );

		}

	}
	for ( const unique of all( 'unique' ) ) {

		const item = makeUnique( unique.id, 100, new RNG( `valid:${unique.id}` ) );
		for ( let n = 0; n < 6; n ++ ) {

			const corrupted = structuredClone( item );
			vaal.apply( corrupted, new RNG( `corruption:${unique.id}:${n}` ), get( 'itemBase', item.base ) );
			save.inventory.items[ 0 ] = corrupted;
			assert.doesNotThrow( () => validateSave( save ), `${unique.id}:${corrupted.corruptOutcome}` );

		}

	}
	for ( const outcome of [ 'empowered', 'bricked', 'implicit', 'rerolled', 'unchanged' ] ) assert.ok( outcomes.has( outcome ), `Real ${outcome} crafting is covered` );

} );

test( 'pathological local numeric saves repair safely and retain their original payload', async () => {

	const initial = character();
	initial.level = 1e308;
	initial.equipment.weapon.affixes = [ { id: 'local-phys-inc', tier: 0, values: [ 1e308 ] } ];
	const raw = JSON.stringify( initial ), store = storage( raw ), saves = manager( store );
	const save = await saves.load();
	const game = new Game( { save, headless: true } ); game.enterTown();
	assert.ok( Number.isFinite( game.world.player.maxLife ) );
	assert.ok( Number.isFinite( computeItem( save.equipment.weapon ).weapon.dps ) );
	assert.equal( await saves.save( save ), true );
	assert.equal( JSON.parse( store.getItem( RECOVERY_KEY ) ).raw, raw );
	saves.dispose();

} );

test( 'stored malformed affixes are repaired into finite item stats', () => {

	const save = character();
	save.equipment.weapon.affixes = [ { id: 'local-phys-inc', tier: 0, values: [] } ];
	ensureSave( save );
	assert.equal( save.equipment.weapon.affixes.length, 0 );
	assert.ok( Number.isFinite( computeItem( save.equipment.weapon ).weapon.dps ) );
	const badVersion = character(); badVersion.progression.version = 'bad';
	badVersion.flasks = {};
	assert.doesNotThrow( () => ensureSave( badVersion ) );
	assert.equal( badVersion.flasks.slots.length, 4 );

} );

test( 'duplicate identities are repaired across inventory, equipment, stash and vendor', () => {

	const save = character(), ring = makeUnique( 'midas-loop', 24, new RNG( 'identity' ) );
	save.equipment.ring1 = ring;
	save.equipment.ring2 = structuredClone( ring );
	save.inventory.items[ 0 ] = structuredClone( ring );
	save.stash.tabs[ 0 ].items[ 0 ] = structuredClone( ring );
	save.vendor.buyback = [ { item: structuredClone( ring ), price: 10 } ];
	ensureSave( save );
	const items = [ save.equipment.ring1, save.equipment.ring2, save.inventory.items[ 0 ], save.stash.tabs[ 0 ].items[ 0 ], save.vendor.buyback[ 0 ].item ];
	assert.equal( new Set( items.map( ( item ) => item.uid ) ).size, items.length );
	assert.equal( activeProviders( save ).filter( ( provider ) => provider.key.startsWith( 'u:' ) ).length, 2 );

} );

test( 'reloaded modules mint different identities while seeded item values stay identical', () => {

	const code = `import './src/game/sim-entry.js'; import { makeItem } from './src/game/features/progression/items.js'; import { RNG } from './src/game/core/rng.js'; console.log(JSON.stringify(makeItem('rusted-blade', 40, 'rare', new RNG('reload-values'))));`;
	const run = () => {

		const child = spawnSync( process.execPath, [ '--input-type=module', '-e', code ], { cwd: new URL( '..', import.meta.url ), encoding: 'utf8' } );
		assert.equal( child.status, 0, child.stderr );
		return JSON.parse( child.stdout );

	};
	const a = run(), b = run();
	assert.notEqual( a.uid, b.uid );
	delete a.uid; delete b.uid;
	assert.deepEqual( a, b );
	const r1 = new RNG( 'draws' ), r2 = new RNG( 'draws' );
	newUid( r1 );
	r2.next();
	assert.equal( r1.next(), r2.next(), 'New identities still consume exactly the historical identity draw' );

} );
