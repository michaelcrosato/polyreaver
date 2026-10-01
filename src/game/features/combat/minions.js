// Minions: summoned allies on the player's team (Phantom Blades, Spectral Warriors).
// They are ordinary entities ( kind 'minion' ) with a small controller: hunt the
// nearest enemy close to the owner, otherwise follow in formation, expire on a timer.
// They cannot be targeted (monsters keep fighting the player), and their kills
// count for the player (rewards check the killer's team).
//
// Their hits come from the summoning skill's context (supports included); the
// owner's minion_damage modifiers become the minion's own `damage` multiplier.
// Models: { type: 'combat-blade' | 'combat-spectral' } - drawn by the combat client.

import { define, get } from '../../core/registry.js';
import { Entity } from '../../core/entity.js';
import { canAct } from '../../core/actions.js';
import { isFoe } from './skill-core.js';

const KINDS = {
	blade: { name: 'Phantom Blade', radius: 0.3, height: 0.6, speed: 12.5, solid: false, reach: 0.9 },
	warrior: { name: 'Spectral Warrior', radius: 0.42, height: 1.75, speed: 7.8, solid: true, reach: 1.2 }
};

export function summonMinions( world, owner, ctx, { kind, count, max, life } ) {

	const K = KINDS[ kind ];
	const mine = world.entities
		.filter( ( m ) => m.kind === 'minion' && m.alive && m.data.owner === owner.id && m.data.skill === ctx.id )
		.sort( ( a, b ) => a.data.born - b.data.born );
	const md = ctx.stats.breakdown( 'minion_damage', ctx.tags, false );
	const dmgMult = Math.max( 0, 1 + md.inc / 100 ) * md.more;
	const hit = ctx.hit();
	for ( let i = 0; i < count; i ++ ) {

		if ( mine.length >= max ) world.kill( mine.shift(), null );
		const ang = owner.facing + Math.PI + ( i - ( count - 1 ) / 2 ) * 0.9;
		let x = owner.x + Math.sin( ang ) * 1.5, z = owner.z + Math.cos( ang ) * 1.5;
		if ( ! world.layout.isWalkable( x, z ) ) {

			x = owner.x;
			z = owner.z;

		}

		const m = new Entity( { kind: 'minion', name: K.name, team: owner.team, level: owner.level, x, z, radius: K.radius, height: K.height, mass: 0.6, solid: K.solid } );
		const base = {
			life: 100, move_speed: K.speed, attack_speed: Math.max( 0.5, owner.stats.get( 'attack_speed' ) ), cast_speed: 1, damage: dmgMult,
			crit_chance: 5, crit_multi: 150, area: 1, knockback: 1, duration: 1, cooldown_recovery: 1, projectile_speed: 1
		};
		for ( const k in base ) m.stats.setBase( k, base[ k ] );
		m.life = m.maxLife;
		m.facing = owner.facing;
		m.flags.untargetable = true;
		m.flags.invulnerable = true;
		Object.assign( m.data, {
			owner: owner.id, skill: ctx.id, born: world.time, expires: world.time + life * ctx.duration, hit, minion: kind,
			slot: mine.length, accel: 60, turnRate: 22, corpseTime: 0.5, flying: kind === 'blade', element: ctx.element
		} );
		m.model = { type: kind === 'blade' ? 'combat-blade' : 'combat-spectral', element: ctx.element };
		m.controller = get( 'controller', 'minion' ).create( world.game, m );
		m.anim.state = 'spawn';
		world.add( m );
		mine.push( m );
		world.events.emit( 'fx', { kind: 'summon', x: m.x, z: m.z, element: 'spectral' } );

	}

}

function attackDef( m ) {

	const hit = m.data.hit;
	if ( m.data.minion === 'blade' ) {

		// a darting cut: the blade lunges through its target
		return {
			id: 'minion-blade', anim: 'dash', duration: 0.42, windup: 0.4, active: 0.62, cancelAt: 0.7, moveMult: 0, turn: true, speedStat: 'attack_speed', tags: hit.tags,
			lunge: { from: 0.36, to: 0.56, speed: 13 },
			events: [ { at: 0.46, fn: ( world, e ) => world.melee( e, { range: 1.7, angle: 140, hit, fx: 'blade', element: e.data.element } ) } ]
		};

	}

	return {
		id: 'minion-slash', anim: 'slash', duration: 0.62, windup: 0.42, active: 0.6, cancelAt: 0.66, moveMult: 0.2, turn: true, speedStat: 'attack_speed', tags: hit.tags,
		lunge: { from: 0.2, to: 0.42, speed: 3 },
		events: [ { at: 0.44, fn: ( world, e ) => world.melee( e, { range: 2.4, angle: 140, hit, fx: 'slash', element: e.data.element } ) } ]
	};

}

define( 'controller', { id: 'minion', create: () => ( {
	target: null, retarget: 0, swing: 0,
	update( world, m, dt ) {

		const owner = world.byId.get( m.data.owner );
		if ( ! owner || ! owner.alive || world.time >= m.data.expires ) {

			world.kill( m, null );
			return;

		}

		// re-pick a target a few times a second: the nearest enemy on the owner's leash
		this.retarget -= dt;
		if ( ! this.target || ! isFoe( m, this.target ) || this.retarget <= 0 ) {

			this.retarget = 0.35;
			const leash = ( o ) => isFoe( m, o ) && Math.hypot( o.x - owner.x, o.z - owner.z ) < 11 && world.layout.hasLineOfSight( m.x, m.z, o.x, o.z );
			this.target = world.spatial.nearest( m.x, m.z, 8, leash ) || world.spatial.nearest( owner.x, owner.z, 10, leash );

		}

		const K = KINDS[ m.data.minion ];
		const t = this.target;
		if ( t ) {

			const d = m.distTo( t ), reach = m.radius + t.radius + K.reach;
			m.anim.aimX = t.x; m.anim.aimZ = t.z;
			if ( d > reach ) {

				m.moveIntent.x = ( t.x - m.x ) / d;
				m.moveIntent.z = ( t.z - m.z ) / d;

			} else {

				m.moveIntent.x = m.moveIntent.z = 0;
				if ( canAct( m ) ) {

					this.swing ++;
					world.act( m, attackDef( m ), { target: t, aimX: t.x, aimZ: t.z, ctx: { variant: this.swing % 2 } } );

				}

			}

			return;

		}

		// no enemy: hold formation behind the owner, arriving smoothly
		const ang = owner.facing + Math.PI + ( ( m.data.slot % 4 ) - 1.5 ) * 0.7;
		const ring = m.data.minion === 'blade' ? 1.6 : 2.4;
		const gx = owner.x + Math.sin( ang ) * ring, gz = owner.z + Math.cos( ang ) * ring;
		const dx = gx - m.x, dz = gz - m.z, d = Math.hypot( dx, dz );
		const k = d < 0.4 ? 0 : Math.min( 1, d / 2.5 );
		m.moveIntent.x = d > 0 ? dx / d * k : 0;
		m.moveIntent.z = d > 0 ? dz / d * k : 0;
		m.anim.aimX = owner.anim.aimX; m.anim.aimZ = owner.anim.aimZ;

	}
} ) } );
