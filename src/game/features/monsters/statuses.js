// Monster-side statuses. Ailments ( ignite chill freeze shock poison bleed stun )
// belong to the combat feature and are applied by id from hit templates; these are
// the buffs and states only monsters use, namespaced 'm-' so they never collide.

import { define } from '../../core/registry.js';

// War cry / support buff: faster, harder hits. Visible as a red pulse (status event).
define( 'status', { id: 'm-frenzy', name: 'Frenzy', tags: [ 'buff', 'monster' ], duration: 6, stack: 'refresh',
	mods: () => [
		{ stat: 'attack_speed', type: 'inc', value: 30 }, { stat: 'cast_speed', type: 'inc', value: 30 },
		{ stat: 'move_speed', type: 'inc', value: 20 }, { stat: 'damage', type: 'more', value: 15 }
	] } );

// A temporary shield (absorbs non-chaos damage before life). The ability sets the
// amount; when the ward ends any excess over the monster's own shield fades.
define( 'status', { id: 'm-ward', name: 'Warded', tags: [ 'buff', 'monster' ], duration: 6, stack: 'refresh',
	onExpire( world, e ) {

		e.shield = Math.min( e.shield, e.stats.get( 'shield' ) );

	} } );

// Time distortion (Chrono Fields boss, chrono affix): everything inside slows down.
define( 'status', { id: 'm-slow', name: 'Slowed Time', tags: [ 'debuff', 'time' ], duration: 1, stack: 'refresh',
	mods: () => [
		{ stat: 'move_speed', type: 'more', value: - 40 }, { stat: 'attack_speed', type: 'more', value: - 30 },
		{ stat: 'cast_speed', type: 'more', value: - 30 }
	] } );

define( 'status', { id: 'm-haste', name: 'Hastened', tags: [ 'buff', 'time' ], duration: 4, stack: 'refresh',
	mods: () => [
		{ stat: 'move_speed', type: 'more', value: 35 }, { stat: 'attack_speed', type: 'more', value: 30 },
		{ stat: 'cast_speed', type: 'more', value: 30 }
	] } );

// Boss enrage (timer ran out) and the Berserker affix's low-life rage.
define( 'status', { id: 'm-enraged', name: 'Enraged', tags: [ 'buff', 'monster' ], duration: 9999, stack: 'refresh',
	mods: () => [
		{ stat: 'damage', type: 'more', value: 40 }, { stat: 'attack_speed', type: 'more', value: 25 },
		{ stat: 'cast_speed', type: 'more', value: 25 }, { stat: 'move_speed', type: 'more', value: 20 }
	] } );

// Takes more damage (Lightless boss caught in light, broken guard, crashed charger).
define( 'status', { id: 'm-exposed', name: 'Exposed', tags: [ 'debuff', 'monster' ], duration: 2, stack: 'refresh',
	mods: () => [ { stat: 'damage_taken', type: 'inc', value: 50 } ] } );

// Short root (webs, grasping roots): telegraphed by a slow projectile.
define( 'status', { id: 'm-root', name: 'Rooted', tags: [ 'debuff', 'cc' ], duration: 0.8, stack: 'refresh', flags: [ 'rooted' ] } );

// Underground / vanished: cannot be hit or collided with; the renderer hides the
// body ( model.hidden ) and draws dust or shadow instead ( 'burrow' / 'emerge' events ).
for ( const id of [ 'm-burrowed', 'm-vanished' ] ) {

	define( 'status', { id, name: id === 'm-burrowed' ? 'Burrowed' : 'Vanished', tags: [ 'state', 'monster' ], duration: 3, stack: 'refresh', flags: [ 'untargetable', 'ghost' ],
		onApply( world, e ) {

			e.data.hidden = true;
			if ( e.model ) e.model.hidden = true;
			world.events.emit( id === 'm-burrowed' ? 'burrow' : 'vanish', { entity: e, x: e.x, z: e.z } );

		},
		onExpire( world, e ) {

			e.data.hidden = false;
			if ( e.model ) e.model.hidden = false;
			world.events.emit( 'emerge', { entity: e, x: e.x, z: e.z } );

		} } );

}
