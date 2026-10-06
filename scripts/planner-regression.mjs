// Build drafts must be safe to inspect/import during active play. These tests
// exercise independent point/stat expectations and the real combat tooltip path.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/game/sim-entry.js';
import { all, get } from '../src/game/core/registry.js';
import { getTree } from '../src/game/features/progression/tree.js';
import { skillTooltip } from '../src/game/features/combat/skill-core.js';
import { makeItem, makeUnique } from '../src/game/features/progression/items.js';
import { RNG } from '../src/game/core/rng.js';
import { createBuildPlan, validateBuildPlan, evaluateBuildPlan, buildPlanSave, allocatePlannedPath, refundPlannedNode,
	catalogBuildItem, ownedBuildItems, encodeBuildPlan, decodeBuildPlan, MAX_BUILD_CODE } from '../src/game/features/progression/planner.js';

const game = () => new Game( { seed: 'planner-regression', headless: true } );
const clone = ( value ) => structuredClone( value );
const stat = ( report, label ) => report.stats.find( ( row ) => row.label === label );
const approx = ( a, b ) => assert.ok( Math.abs( a - b ) < 1e-8, `${a} differs from ${b}` );
const rawCode = ( value ) => 'PRB1:' + Buffer.from( JSON.stringify( value ) ).toString( 'base64url' );
const rejected = ( original, change, pattern ) => {

	const plan = clone( original ); change( plan );
	assert.equal( validateBuildPlan( plan ).ok, false );
	assert.throws( () => decodeBuildPlan( rawCode( plan ) ), pattern );

};

test( 'creating, planning, previewing and importing leave the live character and source draft unchanged', () => {

	const g = game(); g.enterTown();
	const saveBefore = JSON.stringify( g.save ), statsBefore = g.world.player.stats.version;
	const original = createBuildPlan( g.save ); original.level = 10;
	const beforePlan = clone( original ), node = getTree().nodes.get( 's.might' ).links[ 0 ];
	const draft = allocatePlannedPath( original, node );
	assert.deepEqual( original, beforePlan );
	assert.notStrictEqual( draft.equipment.weapon, g.save.equipment.weapon );
	const imported = decodeBuildPlan( encodeBuildPlan( draft ) );
	const preview = evaluateBuildPlan( g, imported );
	assert.equal( preview.points.spent, 1 );
	assert.equal( JSON.stringify( g.save ), saveBefore );
	assert.equal( g.world.player.stats.version, statsBefore );
	const simulated = buildPlanSave( g.save, imported );
	simulated.equipment.weapon.quality = 20; simulated.tree.allocated.push( 'fake' );
	assert.equal( JSON.stringify( g.save ), saveBefore );
	assert.deepEqual( imported, draft );

} );

test( 'future levels and passive attributes give independently calculated stat and point deltas', () => {

	const g = game(), draft = createBuildPlan( g.save ); draft.level = 10;
	const T = getTree(), root = T.nodes.get( 's.might' );
	const next = root.links.map( ( id ) => T.nodes.get( id ) ).find( ( node ) => node.mods.length === 1 && node.mods[ 0 ].stat === 'strength' );
	assert.ok( next );
	const planned = allocatePlannedPath( draft, next.id ), preview = evaluateBuildPlan( g, planned );
	assert.deepEqual( preview.points, { spent: 1, total: 11, remaining: 10, currentTotal: 0, shortfall: 1, ascSpent: 0, ascTotal: 0 } );
	approx( stat( preview, 'Strength' ).after - stat( preview, 'Strength' ).before, next.mods[ 0 ].value );
	approx( stat( preview, 'Maximum Life' ).after - stat( preview, 'Maximum Life' ).before, 9 * 12 + next.mods[ 0 ].value * 0.5 );
	approx( stat( preview, 'Maximum Mana' ).after - stat( preview, 'Maximum Mana' ).before, 9 * 6 );
	const refunded = refundPlannedNode( planned, next.id );
	assert.deepEqual( refunded.tree.allocated, [ 's.might' ] );
	assert.equal( planned.tree.allocated.length, 2 );
	assert.throws( () => refundPlannedNode( planned, 's.might' ), /start node/ );

} );

test( 'versioned sharing round-trips Unicode names, owned rare rolls, unique gear, passives and supports', () => {

	const g = game(), draft = createBuildPlan( g.save ); draft.level = 75;
	draft.name = '氷の魔術師 — café ⚔';
	draft.equipment.weapon = makeItem( 'rusted-blade', 75, 'rare', new RNG( 'rare-plan' ) );
	draft.equipment.gloves = makeUnique( 'corpsebloom', 75, new RNG( 'unique-plan' ) );
	draft.skills.levels.fireball = 20;
	draft.skills.supports.fireball = [ 'pierce', 'multiple-projectiles' ];
	const asc = all( 'ascendancy' )[ 0 ].id;
	draft.tree.asc = { id: asc, allocated: [ `${asc}:root`, `${asc}:s0`, `${asc}:n0` ] };
	assert.equal( validateBuildPlan( draft ).ok, true, validateBuildPlan( draft ).errors.join( '; ' ) );
	assert.deepEqual( decodeBuildPlan( encodeBuildPlan( draft ) ), draft );
	const code = encodeBuildPlan( draft );
	assert.match( code, /^PRB1:[A-Za-z0-9_-]+$/ );
	assert.deepEqual( decodeBuildPlan( ` \n${code}\n ` ), draft );

} );

test( 'passive tree versions, disconnected nodes, duplicate nodes and point budgets reject invalid imports', () => {

	const draft = createBuildPlan( game().save );
	rejected( draft, ( p ) => { p.version = 2; }, /version/ );
	rejected( draft, ( p ) => { p.tree.version = 'old-tree'; }, /tree version/ );
	rejected( draft, ( p ) => { p.tree.start = '__proto__'; }, /region/ );
	rejected( draft, ( p ) => { p.tree.allocated.push( 's.might' ); }, /unique/ );
	rejected( draft, ( p ) => { p.tree.allocated.push( 'k.chaos-inoculation' ); }, /connected/ );
	rejected( draft, ( p ) => { p.tree.allocated.push( getTree().nodes.get( 's.might' ).links[ 0 ] ); }, /passive points/ );
	rejected( draft, ( p ) => { p.tree.bonus = - 1; }, /bonus/ );
	rejected( draft, ( p ) => { p.tree.asc = { id: all( 'ascendancy' )[ 0 ].id, allocated: [] }; }, /Ascendancy|ascendancy/ );

} );

test( 'equipment import checks identities, known bases and affixes, slot fit, rolls and hand conflicts', () => {

	const draft = createBuildPlan( game().save );
	rejected( draft, ( p ) => { p.equipment.weapon.base = 'missing-base'; }, /base/ );
	rejected( draft, ( p ) => { p.equipment.helm = clone( p.equipment.weapon ); p.equipment.helm.uid = 'helmet'; }, /slot/ );
	rejected( draft, ( p ) => { p.equipment.offhand = clone( p.equipment.weapon ); }, /multiple/ );
	rejected( draft, ( p ) => { p.equipment.weapon.ilvl = 0; }, /item level/ );
	rejected( draft, ( p ) => { p.equipment.weapon.quality = 100; }, /quality/ );
	rejected( draft, ( p ) => { p.equipment.weapon.implicits[ 0 ].value = '100'; }, /implicit/ );
	rejected( draft, ( p ) => { p.equipment.weapon.implicits[ 0 ].stat = 'made_up_stat'; }, /implicit/ );
	rejected( draft, ( p ) => { p.equipment.weapon.implicits[ 0 ].value = 1e8; }, /range/ );
	rejected( draft, ( p ) => { p.equipment.weapon.affixes = [ { id: 'unknown-affix', tier: 0, values: [ 1 ] } ]; }, /affix/ );
	rejected( draft, ( p ) => { p.equipment.weapon = catalogBuildItem( 'bastard-sword', 'weapon' ); p.equipment.offhand = { ...clone( draft.equipment.weapon ), uid: 'other' }; }, /Two-handed/ );
	const quiver = all( 'itemBase' ).find( ( b ) => b.tags.includes( 'quiver' ) );
	rejected( draft, ( p ) => { p.equipment.offhand = catalogBuildItem( quiver.id, 'offhand' ); }, /quiver/ );
	const bowPlan = clone( draft ); bowPlan.equipment.weapon = catalogBuildItem( 'crude-bow', 'weapon' ); bowPlan.equipment.offhand = catalogBuildItem( quiver.id, 'offhand' );
	assert.equal( validateBuildPlan( bowPlan ).ok, true );

} );

test( 'legal crafted corruption remains shareable while impossible item rolls are rejected', () => {

	const g = game(), original = createBuildPlan( g.save ); original.level = 75;
	original.equipment.weapon = makeItem( 'eternal-sword', 75, 'rare', new RNG( 'craft-plan' ) );
	const corrupt = get( 'currency', 'vaal' );
	for ( let i = 0; i < 120; i ++ ) {

		const draft = clone( original );
		draft.equipment.gloves = makeUnique( 'corpsebloom', 75, new RNG( `unique-corruption-${i}` ) );
		corrupt.apply( draft.equipment.weapon, new RNG( `weapon-corruption-${i}` ), get( 'itemBase', draft.equipment.weapon.base ) );
		corrupt.apply( draft.equipment.gloves, new RNG( `gloves-corruption-${i}` ), get( 'itemBase', draft.equipment.gloves.base ) );
		assert.equal( validateBuildPlan( draft ).ok, true, JSON.stringify( validateBuildPlan( draft ).errors ) );
		assert.deepEqual( decodeBuildPlan( encodeBuildPlan( draft ) ), JSON.parse( JSON.stringify( draft ) ) );

	}
	rejected( original, ( p ) => { p.equipment.weapon.affixes[ 0 ].values[ 0 ] = 1e8; }, /range/ );
	rejected( original, ( p ) => { p.equipment.gloves = catalogBuildItem( 'corpsebloom', 'gloves', true ); p.equipment.gloves.uvals[ 0 ] = 1e8; }, /range/ );
	rejected( original, ( p ) => { p.equipment.gloves = catalogBuildItem( 'rawhide-gloves', 'gloves' ); delete p.equipment.gloves.roll.evasion; }, /defence/ );

} );

test( 'skill bar, levels, level locks, support compatibility and socket budgets reject invalid imports', () => {

	const draft = createBuildPlan( game().save );
	rejected( draft, ( p ) => { p.level = 1.5; }, /Target level/ );
	rejected( draft, ( p ) => { p.skills.bar.push( null ); }, /six-slot/ );
	rejected( draft, ( p ) => { p.skills.bar[ 1 ] = p.skills.bar[ 0 ]; }, /multiple/ );
	rejected( draft, ( p ) => { p.skills.bar[ 0 ] = 'missing-skill'; }, /Unknown skill/ );
	rejected( draft, ( p ) => { p.skills.levels.fireball = 2; }, /skill level/ );
	rejected( draft, ( p ) => { p.skills.supports.slash = [ 'multiple-projectiles' ]; }, /incompatible/ );
	rejected( draft, ( p ) => { p.skills.supports.fireball = [ 'pierce', 'pierce' ]; }, /sockets/ );
	rejected( draft, ( p ) => { p.skills.supports.fireball = [ 'pierce', 'chain', 'fork' ]; }, /sockets/ );
	rejected( draft, ( p ) => { p.skills.supports.fireball = [ 'unregistered-support' ]; }, /unknown/ );
	rejected( draft, ( p ) => { p.skills.levels['outside-bar'] = 1; }, /belong/ );
	const locked = all( 'skill' ).find( ( d ) => ( d.levelReq ?? d.level ?? 1 ) > 1 );
	assert.ok( locked );
	rejected( draft, ( p ) => { delete p.skills.levels.slash; delete p.skills.supports.slash; p.skills.bar[ 0 ] = locked.id; p.skills.levels[ locked.id ] = 1; p.skills.supports[ locked.id ] = []; }, /requires level/ );

} );

test( 'support previews use planned modifiers and leave current support modifiers intact', () => {

	const g = game(); g.enterTown();
	g.save.skills.supports.fireball = [ 'multiple-projectiles' ]; g.applyPlayerStats();
	const live = skillTooltip( g, 'fireball' ), sources = clone( [ ...g.world.player.stats.sources ] );
	const draft = createBuildPlan( g.save ); draft.skills.supports.fireball = [];
	const plain = evaluateBuildPlan( g, draft ).skills.find( ( s ) => s?.id === 'fireball' );
	approx( plain.dps, live.dps / 0.75 );
	draft.skills.supports.fireball = [ 'pierce' ];
	const result = evaluateBuildPlan( g, draft ), supported = result.skills.find( ( s ) => s?.id === 'fireball' );
	approx( supported.dps, plain.dps * 1.1 );
	const comparison = result.skillComparisons.find( ( s ) => s?.id === 'fireball' );
	approx( comparison.dpsDelta, supported.dps - live.dps );
	assert.equal( supported.manaCost, 8 );
	assert.ok( result.warnings.some( ( text ) => text.includes( 'Pierce rune' ) ) );
	assert.deepEqual( [ ...g.world.player.stats.sources ], sources );
	assert.deepEqual( g.save.skills.supports.fireball, [ 'multiple-projectiles' ] );

} );

test( 'unmet gear requirements disable the planned item and report acquisition needs without rejecting a future draft', () => {

	const g = game(), draft = createBuildPlan( g.save );
	draft.equipment.weapon = catalogBuildItem( 'eternal-sword', 'weapon' );
	assert.equal( validateBuildPlan( draft ).ok, true );
	const result = evaluateBuildPlan( g, draft );
	assert.ok( result.warnings.some( ( text ) => text.includes( 'Eternal Sword' ) && text.includes( 'disabled' ) ) );
	assert.ok( result.warnings.some( ( text ) => text.includes( 'Eternal Sword' ) && text.includes( 'not owned' ) ) );
	assert.ok( stat( result, 'Attack DPS' ).after < stat( result, 'Attack DPS' ).before );
	assert.equal( g.save.equipment.weapon.base, 'rusted-blade' );
	const owned = ownedBuildItems( g.save ); owned[ 0 ].quality = 99;
	assert.equal( g.save.equipment.weapon.quality, 0 );

} );

test( 'shared foreign gear requires acquisition while owned inventory and stash gear does not', () => {

	const g = game(), draft = createBuildPlan( g.save );
	const foreign = clone( draft ); foreign.equipment.weapon.uid = 'foreign-player-blade';
	const before = JSON.stringify( g.save );
	const imported = decodeBuildPlan( encodeBuildPlan( foreign ) );
	const result = evaluateBuildPlan( g, imported );
	assert.equal( result.warnings.filter( ( text ) => text.includes( 'not owned' ) ).length, 1 );
	assert.ok( result.warnings.some( ( text ) => text.includes( 'Rusted Blade (weapon)' ) && text.includes( 'not owned' ) ) );
	assert.equal( result.warnings.some( ( text ) => text.includes( 'disabled' ) ), false );
	assert.equal( JSON.stringify( g.save ), before );
	assert.equal( evaluateBuildPlan( g, draft ).warnings.some( ( text ) => text.includes( 'not owned' ) ), false );
	const inventoryWeapon = makeItem( 'rusted-blade', 1, 'normal', new RNG( 'owned-inventory' ) );
	const stashWeapon = makeItem( 'rusted-blade', 1, 'normal', new RNG( 'owned-stash' ) );
	g.save.inventory.items[ 0 ] = inventoryWeapon; g.save.stash.tabs[ 0 ].items[ 0 ] = stashWeapon;
	const saveWithGear = JSON.stringify( g.save );
	for ( const item of [ inventoryWeapon, stashWeapon ] ) {

		const planned = clone( draft ); planned.equipment.weapon = clone( item );
		assert.equal( evaluateBuildPlan( g, planned ).warnings.some( ( text ) => text.includes( 'not owned' ) ), false );

	}
	assert.equal( JSON.stringify( g.save ), saveWithGear );

} );

test( 'malformed and oversized codes reject before reaching the character', () => {

	for ( const code of [ null, '', 'PRB2:abc', 'PRB1:!!!', 'PRB1:abc', 'PRB1:' + Buffer.from( [ 0xff ] ).toString( 'base64url' ), 'PRB1:' + 'a'.repeat( MAX_BUILD_CODE ) ] ) assert.throws( () => decodeBuildPlan( code ) );
	assert.throws( () => encodeBuildPlan( { version: 99 } ) );
	const g = game(), before = clone( g.save );
	assert.equal( g.api( 'planner.preview', { code: 'PRB1:broken' } ).ok, false );
	assert.deepEqual( g.save, before );
	assert.deepEqual( g.api( 'planner.create' ), createBuildPlan( g.save ) );

} );
