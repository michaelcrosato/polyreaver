import test from 'node:test';
import assert from 'node:assert/strict';
import { SpatialHash } from '../src/game/core/spatial.js';
import { RNG } from '../src/game/core/rng.js';
import { GameWorld } from '../src/game/core/world.js';
import { Entity } from '../src/game/core/entity.js';
import { StatBlock } from '../src/game/core/stats.js';
import { Layout, TILE } from '../src/game/core/layout.js';
import { spawnProjectile, updateEffects } from '../src/game/core/effects.js';

test( 'spatial queries match an all-body oracle, including large bosses and negative cells', () => {

	const rng = new RNG( 'spatial-oracle' );
	const entities = Array.from( { length: 400 }, ( _, id ) => ( {
		id, x: rng.range( - 40, 40 ), z: rng.range( - 40, 40 ), radius: rng.range( 0.1, 6 ), alive: id % 7 !== 0, kind: id % 13 === 0 ? 'loot' : 'monster'
	} ) );
	entities.push( { id: 400, x: 4.01, z: 0, radius: 2.7, alive: true, kind: 'boss' } );
	const hash = new SpatialHash();
	hash.rebuild( entities );
	assert.ok( hash.query( 1.4, 0, 0.3 ).some( ( e ) => e.id === 400 ) );
	for ( let i = 0; i < 200; i ++ ) {

		const x = rng.range( - 45, 45 ), z = rng.range( - 45, 45 ), r = rng.range( 0, 8 );
		const filter = ( e ) => e.id % 3 !== 0;
		const expected = entities.filter( ( e ) => ( e.alive || e.kind === 'loot' ) && filter( e ) && Math.hypot( e.x - x, e.z - z ) <= r + e.radius );
		const actual = hash.query( x, z, r, filter );
		assert.deepEqual( actual.map( ( e ) => e.id ).sort( ( a, b ) => a - b ), expected.map( ( e ) => e.id ).sort( ( a, b ) => a - b ) );
		const nearest = expected.sort( ( a, b ) => Math.hypot( a.x - x, a.z - z ) - Math.hypot( b.x - x, b.z - z ) )[ 0 ] || null;
		assert.equal( hash.nearest( x, z, r, filter ), nearest );

	}
	const buckets = new Set( hash.map.values() );
	hash.rebuild( entities );
	assert.ok( [ ...hash.map.values() ].every( ( b ) => buckets.has( b ) ), 'rebuild reuses arrays' );
	hash.rebuild( [] );
	assert.deepEqual( hash.query( 0, 0, 100 ), [] );
	assert.equal( hash.maxRadius, 0 );

} );

test( 'spatial visitors support nested queries and early exit without corrupting results', () => {

	const hash = new SpatialHash();
	hash.rebuild( [ 0, 1, 2 ].map( ( id ) => ( { id, x: id, z: 0, radius: 0.5, alive: true } ) ) );
	const out = [];
	hash.forEach( 0, 0, 5, ( e ) => {

		assert.equal( hash.nearest( e.x, 0, 0 ).id, e.id );
		out.push( e.id );

	} );
	assert.deepEqual( out, [ 0, 1, 2 ] );
	let count = 0;
	hash.forEach( 0, 0, 5, () => {

		count ++;
		return false;

	} );
	assert.equal( count, 1 );
	const append = [ 'sentinel' ];
	assert.equal( hash.query( 0, 0, 0, null, append ), append );
	assert.equal( append[ 0 ], 'sentinel' );

} );

test( 'moving and teleporting large bodies refresh membership across cell boundaries', () => {

	const hash = new SpatialHash(), boss = { x: 4.01, z: 0, radius: 2.7, alive: true };
	hash.rebuild( [ boss ] );
	boss.x = 3.89;
	hash.update( boss );
	assert.deepEqual( hash.query( 0.9, 0, 0.3 ), [ boss ] );
	boss.x = - 100; boss.z = 50; boss.radius = 5;
	hash.refresh( [ boss ] );
	assert.deepEqual( hash.query( - 105.2, 50, 0.3 ), [ boss ] );
	assert.deepEqual( hash.query( 0, 0, 10 ), [] );
	assert.equal( hash.map.size, 1 );
	assert.equal( hash._keys.size, 1 );

} );

test( 'effects see post-movement teleports in the same simulation tick', () => {

	const { world, owner } = arena();
	const boss = target( world, 8, 0, 2.7 );
	world.systems.push( { id: 'test-teleport', order: 55, update: () => { boss.x = 3.89; } } );
	world.systems.sort( ( a, b ) => a.order - b.order );
	bolt( world, owner, { x: 0.9, speed: 0, radius: 0.3 } );
	world.step( 1 / 60 );
	assert.equal( boss.life, 990 );

} );

function arena() {

	const layout = new Layout( 40, 40, 1 );
	layout.tiles.fill( TILE.FLOOR );
	const world = new GameWorld( { layout, seed: 'swept-hits' } );
	const owner = new Entity( { team: 0, kind: 'player', life: 1000, stats: new StatBlock( { life: 1000, damage: 1 } ) } );
	world.add( owner );
	return { world, owner };

}

function target( world, x, z = 0, radius = 0.45 ) {

	const entity = new Entity( { x, z, radius, team: 1, life: 1000, stats: new StatBlock( { life: 1000, damage_taken: 1 } ) } );
	world.add( entity );
	world.spatial.rebuild( world.entities );
	return entity;

}

const hit = { damage: { physical: 10 }, canCrit: false, canEvade: false, canBlock: false, noAilments: true, noLeech: true };
const bolt = ( world, owner, opts = {} ) => spawnProjectile( world, owner, { dir: Math.PI / 2, speed: 51, radius: 0.3, range: 20, hit, ...opts } );

test( 'a fast projectile hits a crossed target that neither endpoint overlaps', () => {

	const { world, owner } = arena();
	const enemy = target( world, 0.425, 0.7 );
	const p = bolt( world, owner );
	updateEffects( world, 1 / 60 );
	assert.equal( enemy.life, 990 );
	assert.equal( p.alive, false );
	assert.ok( p.x > 0 && p.x < 0.85 );

} );

test( 'swept projectile hits match an independent closest-point oracle', () => {

	const rng = new RNG( 'segment-oracle' );
	for ( let i = 0; i < 100; i ++ ) {

		const { world, owner } = arena();
		const x = rng.range( - 1, 6 ), z = rng.range( - 2, 2 ), radius = rng.range( 0.1, 1 );
		const enemy = target( world, x, z, radius );
		const closest = Math.max( 0, Math.min( 5, x ) );
		const expected = Math.hypot( x - closest, z ) <= radius + 0.3;
		bolt( world, owner, { speed: 300 } );
		updateEffects( world, 1 / 60 );
		assert.equal( enemy.life < 1000, expected, `target ${x},${z},r=${radius}` );

	}

} );

test( 'piercing hits are ordered by first contact and stop at the first unpierced body', () => {

	const { world, owner } = arena();
	const far = target( world, 4 ), near = target( world, 1 ), middle = target( world, 2.5 );
	const order = [];
	const p = bolt( world, owner, { speed: 360, pierce: 1, onHit: ( w, projectile, e ) => order.push( e.id ) } );
	updateEffects( world, 1 / 60 );
	assert.deepEqual( order, [ near.id, middle.id ] );
	assert.equal( far.life, 1000 );
	assert.equal( p.alive, false );

} );

test( 'a wall blocks targets behind it while preserving hits before the wall', () => {

	const { world, owner } = arena();
	world.layout.fill( 23, 0, 1, 40, TILE.WALL ); // wall at world x = 3
	const before = target( world, 1.5 ), behind = target( world, 4.5 );
	let reason;
	bolt( world, owner, { speed: 360, pierce: 5, onEnd: ( w, p, why ) => reason = why } );
	updateEffects( world, 1 / 60 );
	assert.equal( before.life, 990 );
	assert.equal( behind.life, 1000 );
	assert.equal( reason, 'wall' );

} );

test( 'range limits, chaining, and a return leg respect swept hit state', () => {

	const { world, owner } = arena();
	const beyond = target( world, 3 );
	const short = bolt( world, owner, { speed: 360, range: 1 } );
	updateEffects( world, 1 / 60 );
	assert.equal( beyond.life, 1000 );
	assert.equal( short.travelled, 1 );
	beyond.alive = false;
	const first = target( world, 1.5 ), second = target( world, 1.5, 3 );
	const chain = bolt( world, owner, { speed: 360, chain: 1 } );
	updateEffects( world, 1 / 60 );
	assert.equal( first.life, 990 );
	assert.equal( second.life, 1000 );
	assert.equal( chain.alive, true );
	assert.ok( chain.x < first.x, 'chain starts at contact' );
	updateEffects( world, 1 / 60 );
	assert.equal( second.life, 990 );
	const boomerang = bolt( world, owner, { speed: 360, range: 2, returns: true, pierce: 10 } );
	updateEffects( world, 1 / 60 );
	assert.equal( boomerang.returning, true );
	assert.equal( boomerang.hitIds.size, 0 );
	const life = first.life;
	updateEffects( world, 1 / 60 );
	assert.equal( first.life, life - 10 );
	assert.equal( boomerang.alive, false );

} );

test( 'a fast returning projectile catches a moved owner before hitting enemies beyond them', () => {

	const { world, owner } = arena();
	let reason;
	const p = bolt( world, owner, { speed: 360, range: 6, returns: true, pierce: 10, onEnd: ( w, pr, why ) => reason = why } );
	updateEffects( world, 1 / 60 );
	assert.equal( p.returning, true );
	assert.equal( p.x, 6 );
	owner.x = 2;
	const before = target( world, 4 ), beyond = target( world, 0 );
	updateEffects( world, 1 / 60 );
	assert.equal( before.life, 990 );
	assert.equal( beyond.life, 1000 );
	assert.equal( p.alive, false );
	assert.equal( reason, 'returned' );
	assert.ok( Math.abs( p.x - 2.8 ) < 1e-9 );
	assert.ok( Math.abs( p.travelled - 3.2 ) < 1e-9 );

} );

test( 'return catches work off-axis and skip enemy contacts when already inside the catch radius', () => {

	const { world, owner } = arena();
	let reason;
	const p = bolt( world, owner, { speed: 360, range: 6, returns: true, pierce: 10, onEnd: ( w, pr, why ) => reason = why } );
	updateEffects( world, 1 / 60 );
	owner.x = 2; owner.z = 2;
	updateEffects( world, 1 / 60 );
	assert.equal( reason, 'returned' );
	assert.ok( Math.abs( Math.hypot( owner.x - p.x, owner.z - p.z ) - 0.8 ) < 1e-9 );
	owner.x = 0; owner.z = 0;
	const close = bolt( world, owner, { speed: 360, range: 6, returns: true, pierce: 10 } );
	updateEffects( world, 1 / 60 );
	owner.x = close.x; owner.z = close.z;
	const enemy = target( world, close.x, close.z );
	updateEffects( world, 1 / 60 );
	assert.equal( close.alive, false );
	assert.equal( enemy.life, 1000 );

} );

test( 'walls and exhausted return range still stop a projectile before an unreachable owner', () => {

	for ( const wall of [ true, false ] ) {

		const { world, owner } = arena();
		let reason;
		const p = bolt( world, owner, { speed: 360, range: 6, returns: true, pierce: 10, onEnd: ( w, pr, why ) => reason = why } );
		updateEffects( world, 1 / 60 );
		if ( wall ) world.layout.fill( 21, 0, 1, 40, TILE.WALL ); // insert a wall at x = 1 behind the outward projectile
		else owner.x = - 10;
		updateEffects( world, 1 / 60 );
		assert.equal( p.alive, false );
		assert.equal( reason, wall ? 'wall' : 'range' );

	}

} );

test( 'a return hit or chain contact before the catch boundary keeps its original termination behavior', () => {

	for ( const chain of [ 0, 1 ] ) {

		const { world, owner } = arena();
		let reason;
		const p = bolt( world, owner, { speed: 360, range: 6, returns: true, chain, onEnd: ( w, pr, why ) => reason = why } );
		updateEffects( world, 1 / 60 );
		owner.x = 2;
		const first = target( world, 4 );
		if ( chain ) target( world, 4, 3 );
		updateEffects( world, 1 / 60 );
		assert.equal( first.life, 990 );
		assert.ok( p.x > 2.8, 'the first hit happens before the catch boundary' );
		assert.equal( p.alive, !! chain );
		assert.equal( reason, chain ? undefined : 'hit' );

	}

} );
