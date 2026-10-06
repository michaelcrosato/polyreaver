// Deterministic gameplay contracts for damage routing, immunity and skill costs.
// Real keystones / ascendancy nodes are allocated through the normal tree APIs;
// fixed combat stats isolate the rule being tested from unrelated build bonuses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game/sim-entry.js';
import { Entity } from '../src/game/core/entity.js';
import { RNG } from '../src/game/core/rng.js';
import { TEAM } from '../src/game/core/tuning.js';
import { allocatePath, chooseAscendancy, ascAllocate, getTree } from '../src/game/features/progression/tree.js';
import { refreshProviders } from '../src/game/features/progression/mechanics.js';
import { makeUnique } from '../src/game/features/progression/items.js';
import { castSkill, skillTooltip, skillCost } from '../src/game/features/combat/skill-core.js';

function fixture( ...keystones ) {

	const game = new Game( { seed: 'combat-regression:' + keystones.join( ',' ), headless: true } );
	game.save.level = 100;
	const world = game.enterTown(), player = world.player;
	for ( const id of keystones ) assert.equal( allocatePath( game.save, 'k.' + id ).ok, true );
	game.applyPlayerStats();
	refreshProviders( world.state.prog );
	const fixed = { mana: 100, shield: 100, armor: 0, evade_chance: 0, block_chance: 0,
		damage_taken: 1, life_regen: 0, life_regen_pct: 0, mana_regen: 0, mana_regen_pct: 0 };
	if ( ! keystones.includes( 'chaos-inoculation' ) ) fixed.life = 100;
	player.stats.setSource( 'test-fixture', Object.entries( fixed ).map( ( [ stat, value ] ) => ( { stat, type: 'override', value } ) ) );
	player.life = player.maxLife; player.mana = 100; player.shield = 0;
	player.data.lastHitTime = 1e6; // no automatic shield recharge during a cost test
	return { game, world, player };

}

function ascend( game, name ) {

	assert.equal( chooseAscendancy( game.save, 'stormweaver' ).ok, true );
	const A = getTree().asc.stormweaver;
	const node = [ ...A.nodes.values() ].find( ( n ) => n.name === name );
	const minor = node.links.find( ( id ) => id !== 'stormweaver:root' );
	assert.equal( ascAllocate( game.save, minor ).ok, true );
	assert.equal( ascAllocate( game.save, node.id ).ok, true );
	game.applyPlayerStats();
	refreshProviders( game.world.state.prog );
	return node;

}

function hit( world, player, damage, extra = {} ) {

	return world.dealDamage( null, player, { damage, addFlat: false, canCrit: false, canBlock: false,
		canEvade: false, noAilments: true, tags: [ 'attack' ], ...extra } );

}

const cast = ( world, player, opts = {} ) => castSkill( world, player, 'fireball', { aimX: player.x + 6, aimZ: player.z, ...opts } );
const near = ( actual, expected ) => assert.ok( Math.abs( actual - expected ) < 1e-9, `${actual} != ${expected}` );

test( 'Mind over Matter prevents a lethal hit before hit/death events', () => {

	const { world, player } = fixture( 'mind-over-matter' );
	let deaths = 0, observed;
	world.events.on( 'death', () => deaths ++ );
	world.events.on( 'hit', ( ev ) => ( observed = { life: player.life, killed: ev.killed } ) );
	const result = hit( world, player, { physical: 110 } );
	assert.deepEqual( observed, { life: 23, killed: false } );
	assert.equal( deaths, 0 );
	assert.equal( player.alive, true );
	assert.equal( player.mana, 67 );
	assert.equal( result.total, 110 ); // leech and ailments still read the full mitigated hit
	assert.equal( result.lifeDamage, 77 );
	assert.equal( result.manaDamage, 33 );

} );

test( 'Mind over Matter routes nonlethal damage without healing or overspending', () => {

	const { world, player } = fixture( 'mind-over-matter' );
	hit( world, player, { physical: 50 } );
	assert.equal( player.life, 65 );
	assert.equal( player.mana, 85 );
	player.life = 100; player.mana = 5;
	hit( world, player, { physical: 50 } );
	assert.equal( player.life, 55 );
	assert.equal( player.mana, 0 );

} );

test( 'a lethal hit still kills when mana cannot cover its redirected share', () => {

	const { world, player } = fixture( 'mind-over-matter' );
	player.life = 20; player.mana = 5;
	const result = hit( world, player, { physical: 30 } );
	assert.equal( result.killed, true );
	assert.equal( player.alive, false );
	assert.equal( player.mana, 0 );

} );

test( 'shield-only hits neither spend mana nor heal Mind over Matter', () => {

	const { world, player } = fixture( 'mind-over-matter' );
	player.life = 50; player.shield = 100;
	const result = hit( world, player, { physical: 50 } );
	assert.equal( player.life, 50 );
	assert.equal( player.mana, 100 );
	assert.equal( player.shield, 50 );
	assert.equal( result.lifeDamage, 0 );
	assert.equal( result.manaDamage, 0 );

} );

test( 'mixed physical/chaos hits route only damage left after shield absorption', () => {

	const { world, player } = fixture( 'mind-over-matter' );
	player.shield = 25;
	const result = hit( world, player, { physical: 50, chaos: 40 } );
	assert.equal( player.shield, 0 );
	near( player.life, 54.5 );
	near( player.mana, 80.5 );
	assert.deepEqual( result.byType, { physical: 50, chaos: 40 } );
	assert.equal( result.total, 90 );
	assert.equal( result.shieldDamage, 25 );

} );

test( 'damage-over-time deliveries do not trigger mana protection', () => {

	const { world, player } = fixture( 'mind-over-matter' );
	hit( world, player, { chaos: 40 }, { tags: [ 'dot' ] } );
	assert.equal( player.life, 60 );
	assert.equal( player.mana, 100 );
	world.applyStatus( player, 'poison', { dps: 6 } );
	world.step( 1 / 60 );
	near( player.life, 59.9 );
	assert.equal( player.mana, 100 );

} );

test( 'Stormweaver Mana Shield uses the same lethal and shield-only routing', () => {

	const { game, world, player } = fixture();
	ascend( game, 'Mana Shield' );
	hit( world, player, { physical: 120 } );
	assert.equal( player.alive, true );
	assert.equal( player.life, 22 );
	assert.equal( player.mana, 58 );
	player.shield = 100;
	hit( world, player, { physical: 10 } );
	assert.equal( player.life, 22 );
	assert.equal( player.mana, 58 );

} );

test( 'mana protection bonuses compose and never route over 100% of a hit', () => {

	const { game, world, player } = fixture( 'mind-over-matter' );
	ascend( game, 'Mana Shield' );
	hit( world, player, { physical: 100 } );
	assert.equal( player.life, 65 );
	assert.equal( player.mana, 35 );
	player.stats.setSource( 'extra-protection', [ { stat: 'damage_to_mana', type: 'flat', value: 100 } ] );
	player.mana = 100;
	hit( world, player, { physical: 10 } );
	assert.equal( player.life, 65 );
	assert.equal( player.mana, 90 );

} );

test( 'Chaos Inoculation protects against direct chaos, including penetration', () => {

	const { world, player } = fixture( 'chaos-inoculation' );
	assert.equal( player.maxLife, 1 );
	const source = new Entity( { team: TEAM.ENEMY } );
	source.stats.setBase( 'damage', 1 ); source.stats.setBase( 'pen_chaos', 100 );
	const result = world.dealDamage( source, player, { damage: { chaos: 100 }, addFlat: false, canCrit: false, noAilments: true } );
	assert.equal( result.total, 0 );
	assert.equal( player.life, 1 );
	assert.equal( player.alive, true );

} );

test( 'Chaos Inoculation survives physical-hit poison and explicit chaos DOT', () => {

	const { world, player } = fixture( 'chaos-inoculation' );
	player.shield = 100;
	const source = new Entity( { team: TEAM.ENEMY } );
	source.stats.setBase( 'damage', 1 );
	world.dealDamage( source, player, { damage: { physical: 10 }, addFlat: false, canCrit: false,
		ailments: { poison: 100 }, tags: [ 'attack' ] } );
	assert.ok( player.statuses.has( 'poison' ) );
	let dots = 0;
	world.events.on( 'dot', () => dots ++ );
	for ( let i = 0; i < 60; i ++ ) world.step( 1 / 60 );
	assert.equal( player.life, 1 );
	assert.equal( player.alive, true );
	assert.equal( player.shield, 90 );
	assert.equal( dots, 0 );
	world.removeStatus( player, 'poison' );
	world.applyStatus( player, 'poison', { dps: 100 });
	world.step( 1 / 60 );
	assert.equal( player.life, 1 );

} );

test( 'chaos immunity does not grant immunity to other damage types', () => {

	const { world, player } = fixture( 'chaos-inoculation' );
	hit( world, player, { physical: 2 } );
	assert.equal( player.alive, false );

} );

test( 'ordinary poison still bypasses shield and damages life', () => {

	const { world, player } = fixture();
	player.shield = 100;
	world.applyStatus( player, 'poison', { dps: 6 } );
	world.step( 1 / 60 );
	near( player.life, 99.9 );
	assert.equal( player.shield, 100 );

} );

test( 'Eldritch Battery casts with empty mana and pays shield immediately once', () => {

	const { game, world, player } = fixture( 'eldritch-battery' );
	const amount = skillTooltip( game, 'fireball' ).manaCost;
	player.mana = 0; player.shield = 100;
	assert.equal( cast( world, player ), 'ok' );
	assert.equal( player.mana, 0 );
	assert.equal( player.shield, 100 - amount );
	world.step( 1 / 60 );
	assert.equal( player.mana, 0 );
	assert.equal( player.shield, 100 - amount );

} );

test( 'Eldritch Battery splits costs and rejects insufficient total resources atomically', () => {

	const { game, world, player } = fixture( 'eldritch-battery' );
	const amount = skillTooltip( game, 'fireball' ).manaCost;
	player.mana = amount - 2; player.shield = 2;
	assert.equal( cast( world, player ), 'ok' );
	assert.equal( player.mana, 0 );
	assert.equal( player.shield, 0 );
	player.action = null; player.mana = amount - 3; player.shield = 2;
	assert.equal( cast( world, player ), 'mana' );
	assert.equal( player.mana, amount - 3 );
	assert.equal( player.shield, 2 );
	assert.equal( player.action, null );

} );

test( 'busy, free and invalid casts cannot debit resources', () => {

	const { world, player } = fixture( 'eldritch-battery' );
	player.shield = 100;
	assert.equal( cast( world, player, { free: true } ), 'ok' );
	assert.equal( player.shield, 100 );
	assert.equal( player.mana, 100 );
	assert.equal( cast( world, player ), 'busy' );
	assert.equal( player.shield, 100 );
	assert.equal( castSkill( world, player, 'unknown-skill' ), 'invalid' );
	assert.equal( player.shield, 100 );

} );

test( 'Blood Magic pays life, preserves full mana and takes priority over Eldritch Battery', () => {

	const { game, world, player } = fixture( 'blood-magic', 'eldritch-battery' );
	const amount = skillTooltip( game, 'fireball' ).manaCost;
	player.mana = 0; player.shield = 100;
	assert.equal( cast( world, player ), 'ok' );
	assert.equal( player.life, 100 - amount );
	assert.equal( player.mana, 100 );
	assert.equal( player.shield, 100 );
	world.step( 1 / 60 );
	assert.equal( player.life, 100 - amount );
	assert.equal( player.mana, 100 );
	assert.equal( player.shield, 100 );
	assert.ok( skillTooltip( game, 'fireball' ).lines.includes( `Life cost: ${amount}` ) );

} );

test( 'Blood Magic cannot cast a paid skill without enough life to stay alive', () => {

	const { game, world, player } = fixture( 'blood-magic' );
	const amount = skillTooltip( game, 'fireball' ).manaCost;
	player.life = amount;
	assert.equal( cast( world, player ), 'mana' );
	assert.equal( player.life, amount );
	assert.equal( player.action, null );
	player.life = amount + 1;
	assert.equal( cast( world, player ), 'ok' );
	assert.equal( player.life, 1 );
	assert.equal( player.alive, true );

} );

test( 'ordinary skills consume mana only, while free basic attacks work at one life', () => {

	const { game, world, player } = fixture();
	const amount = skillTooltip( game, 'fireball' ).manaCost;
	player.mana = amount + 1; player.shield = 100;
	assert.equal( cast( world, player ), 'ok' );
	assert.equal( player.mana, 1 );
	assert.equal( player.life, 100 );
	assert.equal( player.shield, 100 );
	const blood = fixture( 'blood-magic' );
	blood.player.life = 1; blood.player.mana = 0;
	assert.equal( castSkill( blood.world, blood.player, 'slash' ), 'ok' );
	assert.equal( blood.player.life, 1 );
	assert.equal( blood.player.mana, 100 );

} );

test( 'mana-spending refund hooks receive exact costs once, even across recovery', () => {

	const { game, world, player } = fixture();
	game.save.equipment.ring1 = makeUnique( 'ouroboros', 100, new RNG( 'refund-regression' ) );
	game.applyPlayerStats();
	const amount = skillTooltip( game, 'fireball' ).manaCost;
	const spending = [];
	world.events.on( 'manaSpent', ( ev ) => spending.push( ev.amount ) );
	assert.equal( cast( world, player ), 'ok' );
	assert.equal( player.mana, 100 ); // real Ouroboros refunds the first cost
	assert.equal( cast( world, player, { force: true } ), 'ok' );
	assert.equal( player.mana, 100 - amount ); // its cooldown prevents a second refund
	player.mana = 100; // same-step flask/leech recovery cannot erase either payment
	world.step( 1 / 60 );
	assert.deepEqual( spending, [ amount, amount ] );
	assert.equal( player.mana, 100 );

} );

test( 'Arcane Surge counts actual mana costs, excluding shield/life costs and damage', () => {

	const { game, world, player } = fixture( 'eldritch-battery', 'mind-over-matter' );
	const node = ascend( game, 'Arcane Surge' );
	const amount = skillTooltip( game, 'fireball' ).manaCost;
	const state = () => world.state.prog.states.get( 'a:' + node.id );
	player.shield = 100;
	assert.equal( cast( world, player ), 'ok' );
	assert.equal( state().spent, undefined );
	player.shield = 2;
	assert.equal( cast( world, player, { force: true } ), 'ok' );
	assert.equal( state().spent, amount - 2 );
	hit( world, player, { physical: 20 } );
	world.step( 1 / 60 );
	assert.equal( state().spent, amount - 2 );
	assert.equal( world.state.prog.buffs.has( 'arcane-surge' ), false );
	const blood = fixture( 'blood-magic' );
	const bloodNode = ascend( blood.game, 'Arcane Surge' );
	assert.equal( cast( blood.world, blood.player ), 'ok' );
	assert.equal( blood.world.state.prog.states.get( 'a:' + bloodNode.id ).spent, undefined );

} );

test( 'affordability previews match resource payments and do not mutate resources', () => {

	const { game, player } = fixture( 'eldritch-battery' );
	const amount = skillTooltip( game, 'fireball' ).manaCost;
	player.mana = 0; player.shield = amount;
	assert.deepEqual( skillCost( player, amount ), { life: 0, mana: 0, shield: amount, affordable: true } );
	assert.equal( player.shield, amount );
	assert.equal( player.mana, 0 );
	assert.ok( skillTooltip( game, 'fireball' ).lines.includes( `Cost: ${amount} (Energy Shield before Mana)` ) );

} );
