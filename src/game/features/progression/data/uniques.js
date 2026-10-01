// UNIQUE items: fixed names, fixed modifier lines (values roll inside ranges) and a
// SIGNATURE MECHANIC that changes how you play. Mechanics use the same hook API as
// keystones ( see keystones.js and mechanics.js ): an event handler gets a ctx with
// helpers - ctx.nova( x, z, r, { fire: n } ), ctx.bolt(), ctx.wave(), ctx.strike(),
// ctx.buff( key, seconds, mods ), ctx.heal(), ctx.counter( key, n ), ctx.cooldown( key, s ),
// ctx.later( s, fn ), ctx.ailing( entity, 'ignite' ), ctx.dmg( mult ) (level-scaled damage).
//
//   define( 'unique', { id, name, base, level, mods: [ { stat, type, range | value, tags?, when?, text? } ],
//     mechanic: 'text', hooks?: { kill, hit, crit, struck, dodge, block, action, flask, pickup, manaSpent, tick },
//     grants?: [ keystoneId ], flavour, color } )

import { define } from '../../../core/registry.js';

const R = ( stat, type, lo, hi, tags = null, when = null ) => {

	const m = { stat, type, range: [ lo, hi ] };
	if ( tags ) m.tags = tags;
	if ( when ) m.when = when;
	return m;

};

function U( def ) {

	define( 'unique', { weight: 1, tags: [ 'unique' ], ...def } );

}

const isAttack = ( e ) => !! e.action?.def?.tags?.includes( 'attack' );
const isSpell = ( e ) => !! e.action?.def?.tags?.includes( 'spell' );

// --- gloves ----------------------------------------------------------------------------------
U( { id: 'corpsebloom', name: 'Corpsebloom', base: 'rawhide-gloves', level: 6, color: '#ff6a2a',
	mods: [ R( 'life', 'flat', 30, 45 ), R( 'damage', 'inc', 15, 25, [ 'fire' ] ), R( 'res_fire', 'flat', 20, 30 ) ],
	mechanic: 'Enemies you kill explode, dealing 10% of their maximum Life as Fire Damage to nearby enemies',
	flavour: 'Every death a seed. Every seed a fire.',
	hooks: {
		kill( ctx, ev ) {

			ctx.nova( ev.x, ev.z, 3.2, { fire: ev.entity.maxLife * 0.1 }, { fx: 'explosion', element: 'fire', color: '#ff6a2a' } );

		}
	} } );
U( { id: 'glaciers-grip', name: "Glacier's Grip", base: 'wool-gloves', level: 18, color: '#9ad7ff',
	mods: [ R( 'damage', 'inc', 20, 30, [ 'cold' ] ), R( 'chill_chance', 'flat', 10, 15 ), R( 'shield', 'flat', 20, 35 ) ],
	mechanic: 'Chilled or Frozen enemies you kill shatter into 6 Ice Shards',
	flavour: 'The cold remembers every shape it ever held.',
	hooks: {
		kill( ctx, ev ) {

			if ( ! ctx.ailing( ev.entity, 'chill' ) && ! ctx.ailing( ev.entity, 'freeze' ) ) return;
			for ( let i = 0; i < 6; i ++ ) ctx.bolt( ev.x, ev.z, i / 6 * Math.PI * 2, { cold: ctx.dmg( 0.5 ) }, { fx: 'shard', element: 'cold', color: '#bfe8ff', range: 9, speed: 22 } );

		}
	} } );

// --- boots -------------------------------------------------------------------------------------
const trail = ( type, color, ailments ) => ( {
	dodge( ctx ) {

		ctx.state.until = ctx.world.time + 0.45;

	},
	tick( ctx ) {

		const s = ctx.state, p = ctx.player;
		if ( ! s.until || ctx.world.time > s.until ) return;
		if ( ! ctx.cooldown( 'drop', 0.07 ) ) return;
		ctx.nova( p.x, p.z, 1.4, { [ type ]: ctx.dmg( 0.18 ) }, { duration: 2.5, interval: 0.4, fx: type === 'cold' ? 'ice' : 'fire', element: type, color, ailments } );

	}
} );
U( { id: 'rimewake', name: 'Rimewake', base: 'rawhide-boots', level: 10, color: '#9ad7ff',
	mods: [ R( 'move_speed', 'inc', 20, 25 ), R( 'res_cold', 'flat', 20, 30 ), R( 'evade_chance', 'flat', 2, 4 ) ],
	mechanic: 'Dodging leaves a trail of frost that deals Cold Damage and Chills enemies',
	flavour: 'Run, and let winter follow.',
	hooks: trail( 'cold', '#9ad7ff', { chill: 100 } ) } );
U( { id: 'cinderstride', name: 'Cinderstride', base: 'iron-greaves', level: 14, color: '#ff8a3a',
	mods: [ R( 'move_speed', 'inc', 15, 20 ), R( 'life', 'flat', 40, 60 ), R( 'res_fire', 'flat', 25, 35 ) ],
	mechanic: 'Dodging leaves a trail of Burning Ground that Ignites enemies',
	flavour: 'The road behind you is always on fire.',
	hooks: trail( 'fire', '#ff8a3a', { ignite: 50 } ) } );
U( { id: 'thunderstep', name: 'Thunderstep', base: 'eelskin-boots', level: 30, color: '#ffe95a',
	mods: [ R( 'move_speed', 'inc', 20, 25 ), R( 'res_lightning', 'flat', 20, 30 ), R( 'shock_chance', 'flat', 10, 15 ) ],
	mechanic: 'Every 25 metres you travel releases a Lightning Nova around you',
	flavour: 'Each step a spark; each spark a storm.',
	hooks: {
		tick( ctx, dt ) {

			const p = ctx.player;
			ctx.state.dist = ( ctx.state.dist ?? 0 ) + Math.hypot( p.vx, p.vz ) * dt;
			if ( ctx.state.dist < 25 ) return;
			ctx.state.dist = 0;
			ctx.nova( p.x, p.z, 5, { lightning: ctx.dmg( 1.2 ) }, { fx: 'nova', element: 'lightning', color: '#ffe95a', ailments: { shock: 50 } } );

		}
	} } );
U( { id: 'wanderlust', name: 'Wanderlust', base: 'wool-shoes', level: 4, color: '#c8e0ff',
	mods: [ R( 'move_speed', 'inc', 20, 25 ), R( 'pickup_radius', 'inc', 20, 30 ), R( 'dexterity', 'flat', 10, 20 ) ],
	mechanic: 'Grants the Momentum keystone', grants: [ 'momentum' ],
	flavour: 'The horizon is a promise, not a place.' } );

// --- body armour ------------------------------------------------------------------------------------
U( { id: 'bramble-mantle', name: 'Bramble Mantle', base: 'plate-vest', level: 10, color: '#7a9a4a',
	mods: [ R( 'local_armor_inc', 'flat', 60, 90 ), R( 'life', 'flat', 30, 40 ), R( 'thorns', 'flat', 20, 40 ) ],
	mechanic: 'Reflects 40% of Melee Damage taken back to the attacker',
	flavour: 'Touch me and bleed.',
	hooks: {
		struck( ctx, ev ) {

			const src = ev.source;
			if ( ! src || ! src.alive || ! ( ev.tags || [] ).includes( 'melee' ) ) return;
			ctx.strike( src, ev.total * 0.4, 'physical' );

		}
	} } );
U( { id: 'stormweave', name: 'Stormweave', base: 'silk-robe', level: 30, color: '#9ab8ff',
	mods: [ R( 'local_shield', 'flat', 50, 80 ), R( 'damage', 'inc', 20, 30, [ 'lightning' ] ), R( 'cast_speed', 'inc', 8, 12 ) ],
	mechanic: 'Every 3 seconds, a Lightning Nova pulses from you if an enemy is within 7 metres',
	flavour: 'Woven from the moment before thunder.',
	hooks: {
		tick( ctx ) {

			const p = ctx.player;
			if ( ! ctx.nearestEnemy( p.x, p.z, 7 ) || ! ctx.cooldown( 'pulse', 3 ) ) return;
			ctx.nova( p.x, p.z, 7, { lightning: ctx.dmg( 1.0 ) }, { fx: 'nova', element: 'lightning', color: '#9ab8ff', ailments: { shock: 30 } } );

		}
	} } );
U( { id: 'bloodgorged-mantle', name: 'Bloodgorged Mantle', base: 'chainmail-vest', level: 22, color: '#c0303a',
	mods: [ R( 'life', 'flat', 40, 60 ), R( 'life_leech', 'flat', 0.8, 1.2, [ 'attack' ] ), R( 'local_defence_inc', 'flat', 40, 60 ) ],
	mechanic: 'Life Leech while on Full Life is stored as Energy Shield (up to 30% of maximum Life)',
	flavour: 'A full cup still thirsts.',
	hooks: {
		hit( ctx, ev ) {

			const p = ctx.player;
			if ( p.life < p.maxLife - 0.5 ) return;
			const leech = ev.total * p.stats.get( 'life_leech', ev.tags || [] ) / 100;
			const cap = Math.max( p.stats.get( 'shield' ), p.maxLife * 0.3 );
			p.shield = Math.min( cap, p.shield + leech );

		}
	} } );

// --- helmets -------------------------------------------------------------------------------------------
U( { id: 'stormcrown', name: 'Stormcrown', base: 'leather-cap', level: 22, color: '#ffe95a',
	mods: [ R( 'crit_chance', 'inc', 20, 30 ), R( 'res_lightning', 'flat', 20, 30 ), R( 'dexterity', 'flat', 15, 25 ) ],
	mechanic: 'Critical Strikes call down a Lightning Bolt on the target (0.5 s cooldown)',
	flavour: 'The sky keeps score.',
	hooks: {
		crit( ctx, ev ) {

			if ( ! ctx.cooldown( 'bolt', 0.5 ) ) return;
			ctx.nova( ev.target.x, ev.target.z, 1.8, { lightning: ctx.dmg( 1.1 ) }, { fx: 'lightning', element: 'lightning', color: '#ffe95a', ailments: { shock: 50 } } );

		}
	} } );
U( { id: 'gravity-lens', name: 'Gravity Lens', base: 'mage-circlet', level: 34, color: '#b48aff',
	mods: [ R( 'local_shield', 'flat', 40, 60 ), R( 'area', 'inc', 10, 15 ), R( 'damage', 'inc', 15, 25, [ 'area' ] ) ],
	mechanic: 'Every 8 seconds, pulls all enemies within 9 metres toward you',
	flavour: 'Everything falls toward something.',
	hooks: {
		tick( ctx ) {

			const p = ctx.player;
			if ( ! ctx.nearestEnemy( p.x, p.z, 9 ) || ! ctx.cooldown( 'pull', 8 ) ) return;
			for ( const e of ctx.enemies( p.x, p.z, 9 ) ) {

				if ( e.flags.unstoppable ) continue;
				const dx = p.x - e.x, dz = p.z - e.z, d = Math.hypot( dx, dz ) || 1;
				e.impulse.x += dx / d * Math.min( 18, d * 2.2 ) / Math.max( 0.5, e.mass );
				e.impulse.z += dz / d * Math.min( 18, d * 2.2 ) / Math.max( 0.5, e.mass );

			}

			ctx.fx( 'pull', { x: p.x, z: p.z, radius: 9, color: '#b48aff' } );

		}
	} } );

// --- weapons --------------------------------------------------------------------------------------------
U( { id: 'skyfall', name: 'Skyfall', base: 'spiked-mace', level: 18, color: '#ff7a2a',
	mods: [ R( 'local_phys_inc', 'flat', 80, 120 ), R( 'added_fire_min', 'flat', 6, 10, [ 'attack' ] ), R( 'added_fire_max', 'flat', 14, 20, [ 'attack' ] ), R( 'area', 'inc', 10, 15 ) ],
	mechanic: 'Every 5th Attack calls down a Meteor at the target location',
	flavour: 'Ask the sky for help. It always answers.',
	hooks: {
		action( ctx, ev ) {

			if ( ! isAttack( ev.entity ) || ! ctx.counter( 'meteor', 5 ) ) return;
			const a = ev.entity.anim;
			ctx.nova( a.aimX, a.aimZ, 3.5, { fire: ctx.dmg( 2.5 ), physical: ctx.dmg( 0.8 ) }, { delay: 0.6, fx: 'meteor', element: 'fire', color: '#ff7a2a', knockback: 6, ailments: { ignite: 30 } } );

		}
	} } );
U( { id: 'chainsong', name: 'Chainsong', base: 'recurve-bow', level: 16, color: '#9affc8',
	mods: [ R( 'local_phys_inc', 'flat', 60, 90 ), R( 'chain', 'flat', 1, 1, [ 'projectile' ] ), R( 'attack_speed', 'inc', 10, 15 ) ],
	mechanic: 'Projectiles Chain +1 times; chained hits refund 2 Mana',
	flavour: 'Every arrow sings to the next.',
	hooks: {
		hit( ctx, ev ) {

			if ( ( ev.tags || [] ).includes( 'projectile' ) ) ctx.restoreMana( 2 );

		}
	} } );
U( { id: 'echoing-edge', name: 'Echoing Edge', base: 'sabre', level: 28, color: '#d8e0ff',
	mods: [ R( 'local_phys_inc', 'flat', 100, 140 ), R( 'local_aps_inc', 'flat', 10, 15 ), R( 'crit_multi', 'flat', 15, 25 ) ],
	mechanic: 'Every third Hit is echoed 0.25 seconds later for 50% of its damage',
	flavour: 'Strike once. It will remember to strike again.',
	hooks: {
		hit( ctx, ev ) {

			if ( ! ctx.counter( 'echo', 3 ) ) return;
			const t = ev.target, amount = ev.total * 0.5;
			ctx.later( 0.25, () => {

				if ( t.alive ) {

					ctx.fx( 'echo', { x: t.x, z: t.z } );
					ctx.strike( t, amount, 'physical' );

				}

			} );

		}
	} } );
U( { id: 'gravemaw', name: 'Gravemaw', base: 'bearded-axe', level: 16, color: '#8a5a3a',
	mods: [ R( 'local_phys_inc', 'flat', 70, 100 ), R( 'life_on_kill', 'flat', 10, 20 ), R( 'strength', 'flat', 15, 25 ) ],
	mechanic: 'Kills grant Onslaught for 3 seconds: 20% increased Attack, Cast and Movement Speed',
	flavour: 'Hunger is a kind of speed.',
	hooks: {
		kill( ctx ) {

			ctx.buff( 'onslaught', 3, [ { stat: 'attack_speed', type: 'inc', value: 20 }, { stat: 'cast_speed', type: 'inc', value: 20 }, { stat: 'move_speed', type: 'inc', value: 20 } ] );

		}
	} } );
U( { id: 'siphoning-fang', name: 'Siphoning Fang', base: 'kris', level: 15, color: '#7aff6a',
	mods: [ R( 'local_crit_inc', 'flat', 20, 30 ), R( 'poison_chance', 'flat', 20, 30 ), R( 'damage', 'inc', 20, 30, [ 'chaos' ] ) ],
	mechanic: 'Hits against Poisoned enemies Leech 3% of their damage as Life and restore 4 Mana',
	flavour: 'Venom first. Then the feast.',
	hooks: {
		hit( ctx, ev ) {

			if ( ! ctx.ailing( ev.target, 'poison' ) ) return;
			ctx.heal( ev.total * 0.03 );
			ctx.restoreMana( 4 );

		}
	} } );
U( { id: 'dawnbreaker', name: 'Dawnbreaker', base: 'great-mallet', level: 28, color: '#ffd97a',
	mods: [ R( 'local_phys_inc', 'flat', 120, 160 ), R( 'stun_threshold', 'inc', 20, 30 ), R( 'life', 'flat', 40, 60 ) ],
	mechanic: 'Your first Hit after Dodging deals 100% more Damage and Stuns',
	flavour: 'Step aside. Then end it.',
	hooks: {
		dodge( ctx ) {

			ctx.state.primed = true;

		},
		hit( ctx, ev ) {

			if ( ! ctx.state.primed ) return;
			ctx.state.primed = false;
			ctx.fx( 'dawn', { x: ev.target.x, z: ev.target.z, color: '#ffd97a' } );
			ctx.strike( ev.target, ev.total, 'physical' );
			if ( ev.target.alive ) ctx.world.applyStatus( ev.target, 'stun', { source: ctx.player, duration: 1 } );

		}
	} } );
U( { id: 'conduit-hammer', name: 'Conduit Hammer', base: 'flanged-mace', level: 32, color: '#ffe95a',
	mods: [ R( 'local_phys_inc', 'flat', 60, 90 ), R( 'added_lightning_min', 'flat', 2, 5, [ 'attack' ] ), R( 'added_lightning_max', 'flat', 50, 70, [ 'attack' ] ), R( 'shock_chance', 'flat', 10, 15 ) ],
	mechanic: 'Melee Hits have a 25% chance to release Chain Lightning that arcs between 4 enemies',
	flavour: 'Strike the anvil, and the storm answers.',
	hooks: {
		hit( ctx, ev ) {

			if ( ! ( ev.tags || [] ).includes( 'melee' ) || ctx.world.rng.next() > 0.25 ) return;
			const next = ctx.nearestEnemy( ev.target.x, ev.target.z, 9, ev.target );
			if ( ! next ) return;
			ctx.bolt( ev.target.x, ev.target.z, Math.atan2( next.x - ev.target.x, next.z - ev.target.z ), { lightning: ctx.dmg( 0.8 ) }, { chain: 4, fx: 'arc', element: 'lightning', color: '#ffe95a', speed: 40, range: 12 } );

		}
	} } );
U( { id: 'embercoil', name: 'Embercoil', base: 'bone-wand', level: 18, color: '#ff5a2a',
	mods: [ R( 'added_fire_min', 'flat', 5, 9, [ 'spell' ] ), R( 'added_fire_max', 'flat', 12, 18, [ 'spell' ] ), R( 'ignite_chance', 'flat', 20, 30 ), R( 'cast_speed', 'inc', 8, 12 ) ],
	mechanic: 'Ignited enemies take 20% more Damage from your Hits',
	flavour: 'Fire does not forgive. It only remembers.',
	hooks: {
		hit( ctx, ev ) {

			if ( ev.target.alive && ctx.ailing( ev.target, 'ignite' ) ) ctx.strike( ev.target, ev.total * 0.2, 'fire' );

		}
	} } );
U( { id: 'tidecaller', name: 'Tidecaller', base: 'barbed-spear', level: 20, color: '#4ab0ff',
	mods: [ R( 'local_phys_inc', 'flat', 60, 90 ), R( 'knockback', 'inc', 20, 30 ), R( 'added_cold_min', 'flat', 4, 7, [ 'attack' ] ), R( 'added_cold_max', 'flat', 10, 15, [ 'attack' ] ) ],
	mechanic: 'Every 4th Attack sends a Tidal Wave rolling forward',
	flavour: 'The sea does not ask permission.',
	hooks: {
		action( ctx, ev ) {

			if ( ! isAttack( ev.entity ) || ! ctx.counter( 'wave', 4 ) ) return;
			const p = ctx.player;
			ctx.wave( p.x, p.z, p.facing, 9, 2.6, { cold: ctx.dmg( 1.4 ) }, { fx: 'wave', element: 'cold', color: '#4ab0ff', knockback: 9, ailments: { chill: 60 } } );

		}
	} } );
U( { id: 'starforge', name: 'Starforge', base: 'quarterstaff', level: 22, color: '#c8b0ff',
	mods: [ R( 'damage', 'inc', 40, 60, [ 'spell' ] ), R( 'cast_speed', 'inc', 10, 15 ), R( 'mana', 'flat', 40, 60 ) ],
	mechanic: 'Every 5th Spell you cast fires 5 Starfall bolts at nearby enemies',
	flavour: 'Forged where light goes to die.',
	hooks: {
		action( ctx, ev ) {

			if ( ! isSpell( ev.entity ) || ! ctx.counter( 'stars', 5 ) ) return;
			const p = ctx.player;
			const foes = ctx.enemies( p.x, p.z, 14 );
			for ( let i = 0; i < 5; i ++ ) {

				const t = foes.length ? foes[ i % foes.length ] : null;
				const dir = t ? Math.atan2( t.x - p.x, t.z - p.z ) : p.facing + ( i - 2 ) * 0.3;
				ctx.bolt( p.x, p.z, dir, { cold: ctx.dmg( 0.35 ), lightning: ctx.dmg( 0.35 ) }, { homing: 4, fx: 'star', color: '#c8b0ff', speed: 20, range: 16 } );

			}

		}
	} } );
U( { id: 'executioners-oath', name: "Executioner's Oath", base: 'executioner-blade', level: 26, color: '#c03030',
	mods: [ R( 'local_phys_inc', 'flat', 120, 160 ), R( 'crit_multi', 'flat', 20, 30 ), R( 'life_leech', 'flat', 0.6, 1, [ 'attack' ] ) ],
	mechanic: 'Grants the Cull the Weak keystone', grants: [ 'cull-the-weak' ],
	flavour: 'Mercy is a swift end.' } );

// --- off-hands ----------------------------------------------------------------------------------------------
U( { id: 'witchfire-focus', name: 'Witchfire Focus', base: 'twig-focus', level: 12, color: '#ff8a3a',
	mods: [ R( 'damage', 'inc', 20, 30, [ 'fire' ] ), R( 'ignite_chance', 'flat', 10, 15 ), R( 'mana', 'flat', 20, 40 ) ],
	mechanic: 'Ignited enemies spread Ignite to enemies within 4 metres when they die',
	flavour: 'One witch burns. The coven follows.',
	hooks: {
		kill( ctx, ev ) {

			if ( ! ctx.ailing( ev.entity, 'ignite' ) ) return;
			ctx.nova( ev.x, ev.z, 4, { fire: ctx.dmg( 0.3 ) }, { fx: 'fire', element: 'fire', color: '#ff8a3a', ailments: { ignite: 100 } } );

		}
	} } );
U( { id: 'mirrorshard', name: 'Mirrorshard', base: 'spiked-buckler', level: 30, color: '#e0f0ff',
	mods: [ R( 'local_block', 'flat', 4, 6 ), R( 'local_evasion_inc', 'flat', 60, 90 ), R( 'res_cold', 'flat', 15, 25 ) ],
	mechanic: 'Blocked Hits fire a Mirror Shard back at the attacker',
	flavour: 'See yourself as I see you.',
	hooks: {
		block( ctx, ev ) {

			const src = ev.source, p = ctx.player;
			if ( ! src || ! src.alive ) return;
			ctx.bolt( p.x, p.z, Math.atan2( src.x - p.x, src.z - p.z ), { physical: ctx.dmg( 1.0 ), cold: ctx.dmg( 0.4 ) }, { fx: 'shard', color: '#e0f0ff', speed: 30, range: 14 } );

		}
	} } );
U( { id: 'quillstorm', name: 'Quillstorm', base: 'feathered-quiver', level: 20, color: '#c8ff8a',
	mods: [ R( 'damage', 'inc', 20, 30, [ 'projectile' ] ), R( 'attack_speed', 'inc', 10, 15 ), R( 'projectile_speed', 'inc', 15, 25 ) ],
	mechanic: 'Projectile Hits split into 2 Quills that seek other enemies',
	flavour: 'One becomes many. Many become none.',
	hooks: {
		hit( ctx, ev ) {

			if ( ! ( ev.tags || [] ).includes( 'projectile' ) || ! ctx.cooldown( 'split', 0.08 ) ) return;
			const t = ev.target;
			const others = ctx.enemies( t.x, t.z, 10 ).filter( ( e ) => e !== t ).slice( 0, 2 );
			for ( const o of others ) ctx.bolt( t.x, t.z, Math.atan2( o.x - t.x, o.z - t.z ), { physical: ev.total * 0.25 }, { homing: 3, fx: 'arrow', color: '#c8ff8a', speed: 26, range: 12, raw: true } );

		}
	} } );

// --- jewellery -----------------------------------------------------------------------------------------------
U( { id: 'crimson-tithe', name: 'Crimson Tithe', base: 'coral-ring', level: 20, color: '#e03040',
	mods: [ R( 'life', 'flat', 20, 30 ), R( 'life_leech', 'flat', 0.6, 1, [ 'attack' ] ), R( 'damage', 'inc', 10, 20, [ 'physical' ] ) ],
	mechanic: 'Life Leech also applies to your Damage over Time (Ignite, Poison, Bleed)',
	flavour: 'Every drop is owed.',
	hooks: {
		hit( ctx, ev ) {

			const tags = ev.tags || [];
			if ( ! tags.includes( 'dot' ) && ! [ 'ignite', 'poison', 'bleed' ].includes( ev.skill ) ) return;
			ctx.heal( ev.total * ( ctx.player.stats.get( 'life_leech', [ 'attack' ] ) + ctx.player.stats.get( 'life_leech' ) ) / 100 );

		}
	} } );
U( { id: 'hollow-idol', name: 'Hollow Idol', base: 'lapis-amulet', level: 24, color: '#b02030',
	mods: [ R( 'damage', 'inc', 30, 40, [ 'spell' ] ), R( 'life', 'flat', 30, 50 ), R( 'cast_speed', 'inc', 6, 10 ) ],
	mechanic: 'Grants the Blood Magic keystone', grants: [ 'blood-magic' ],
	flavour: 'It was empty. Now it is full of you.' } );
U( { id: 'phoenix-ember', name: 'Phoenix Ember', base: 'coral-amulet', level: 32, color: '#ff9a3c',
	mods: [ R( 'res_fire', 'flat', 30, 40 ), R( 'life_regen_pct', 'flat', 1, 2 ), R( 'damage', 'inc', 15, 25, [ 'fire' ] ) ],
	mechanic: 'When a Hit leaves you on Low Life, recover 40% of your Life and explode in flame (20 s cooldown)',
	flavour: 'Ashes are only a pause.',
	hooks: {
		struck( ctx ) {

			const p = ctx.player;
			if ( ! p.alive || p.life / p.maxLife >= 0.35 || ! ctx.cooldown( 'rebirth', 20 ) ) return;
			ctx.heal( p.maxLife * 0.4 );
			ctx.nova( p.x, p.z, 6, { fire: ctx.dmg( 2 ) }, { fx: 'explosion', element: 'fire', color: '#ff9a3c', knockback: 10, ailments: { ignite: 100 } } );

		}
	} } );
U( { id: 'the-ninth-coil', name: 'The Ninth Coil', base: 'turquoise-amulet', level: 38, color: '#8aff4a',
	mods: [ R( 'dexterity', 'flat', 20, 30 ), R( 'intelligence', 'flat', 20, 30 ), R( 'damage', 'inc', 20, 30, [ 'chaos' ] ) ],
	mechanic: 'Every 9th Hit releases a Coil of Chaos that Poisons everything around the target',
	flavour: 'Nine times it bites. The ninth time it swallows.',
	hooks: {
		hit( ctx, ev ) {

			if ( ! ctx.counter( 'coil', 9 ) ) return;
			ctx.nova( ev.target.x, ev.target.z, 4.5, { chaos: ctx.dmg( 3 ) }, { fx: 'poison', element: 'chaos', color: '#8aff4a', ailments: { poison: 100 } } );

		}
	} } );
U( { id: 'voidheart', name: 'Voidheart', base: 'onyx-amulet', level: 40, color: '#5a3a8a',
	mods: [ R( 'shield', 'inc', 20, 30 ), R( 'res_chaos', 'flat', 15, 25 ), R( 'strength', 'flat', 10, 16 ), R( 'dexterity', 'flat', 10, 16 ), R( 'intelligence', 'flat', 10, 16 ) ],
	mechanic: 'Grants the Chaos Inoculation keystone', grants: [ 'chaos-inoculation' ],
	flavour: 'Where the heart was, a door.' } );
U( { id: 'midas-loop', name: 'Midas Loop', base: 'gold-ring', level: 24, color: '#ffd34d',
	mods: [ R( 'item_rarity', 'flat', 15, 25 ), R( 'gold_find', 'flat', 30, 50 ), R( 'pickup_radius', 'inc', 50, 80 ) ],
	mechanic: 'Picking up Gold grants 2% increased Damage per 100 Gold picked up in the last 8 seconds (max 40%)',
	flavour: 'Wealth is a weapon, if you hold it right.',
	hooks: {
		pickup( ctx, ev ) {

			if ( ! ev.gold ) return;
			const s = ctx.state;
			const now = ctx.world.time;
			s.log = ( s.log || [] ).filter( ( g ) => now - g.t < 8 );
			s.log.push( { t: now, n: ev.gold } );
			const total = s.log.reduce( ( a, g ) => a + g.n, 0 );
			ctx.buff( 'midas', 8, [ { stat: 'damage', type: 'inc', value: Math.min( 40, Math.floor( total / 100 ) * 2 ) } ] );

		}
	} } );
U( { id: 'ouroboros', name: 'Ouroboros', base: 'moonstone-ring', level: 28, color: '#6ad0c0',
	mods: [ R( 'shield', 'flat', 20, 30 ), R( 'mana_regen', 'inc', 20, 30 ), R( 'cooldown_recovery', 'inc', 8, 12 ) ],
	mechanic: 'Once every 8 seconds, the Mana cost of a Skill is refunded',
	flavour: 'What is spent returns.',
	hooks: {
		manaSpent( ctx, amount ) {

			if ( amount > 1 && ctx.cooldown( 'refund', 8 ) ) ctx.restoreMana( amount );

		}
	} } );
U( { id: 'kaleidoscope', name: 'Kaleidoscope', base: 'prismatic-ring', level: 50, color: '#ff8af0',
	mods: [ R( 'res_fire', 'flat', 8, 12 ), R( 'res_cold', 'flat', 8, 12 ), R( 'res_lightning', 'flat', 8, 12 ), R( 'crit_chance', 'inc', 15, 25 ) ],
	mechanic: 'Every 6 seconds, gain 40% more Damage of the next Element: Fire, then Cold, then Lightning',
	flavour: 'Turn it, and the world changes colour.',
	hooks: {
		tick( ctx ) {

			const phase = Math.floor( ctx.world.time / 6 ) % 3;
			if ( ctx.state.phase === phase ) return;
			ctx.state.phase = phase;
			const el = [ 'fire', 'cold', 'lightning' ][ phase ];
			ctx.buff( 'kaleidoscope', 6.1, [ { stat: 'damage', type: 'more', value: 40, tags: [ el ] } ], { label: el } );

		}
	} } );
U( { id: 'soul-feast', name: 'Soul Feast', base: 'leather-belt', level: 30, color: '#9a7aff',
	mods: [ R( 'life', 'flat', 40, 60 ), R( 'damage', 'inc', 10, 20 ), R( 'res_chaos', 'flat', 10, 20 ) ],
	mechanic: 'Killing a Magic, Rare or Unique monster grants a Soul for 20 seconds (max 5): 10% increased Damage and 5% increased Movement Speed per Soul',
	flavour: 'The strong feed the stronger.',
	hooks: {
		kill( ctx, ev ) {

			const r = ev.entity.data.rarity;
			if ( ! r || r === 'normal' ) return;
			const s = ctx.state;
			s.souls = Math.min( 5, ( s.souls ?? 0 ) + 1 );
			ctx.buff( 'soul-feast', 20, [ { stat: 'damage', type: 'inc', value: 10 * s.souls }, { stat: 'move_speed', type: 'inc', value: 5 * s.souls } ], { stacks: s.souls, onEnd: () => ( s.souls = 0 ) } );

		}
	} } );
U( { id: 'featherfall', name: 'Featherfall', base: 'chain-belt', level: 20, color: '#e8f0ff',
	mods: [ R( 'flask_charges_gained', 'inc', 15, 25 ), R( 'flask_effect', 'inc', 10, 15 ), R( 'shield', 'flat', 20, 30 ) ],
	mechanic: 'Drinking a Flask grants Phasing (move through enemies) and 30% increased Movement Speed for 3 seconds',
	flavour: 'Lighter than fear.',
	hooks: {
		flask( ctx ) {

			ctx.buff( 'featherfall', 3, [ { stat: 'move_speed', type: 'inc', value: 30 } ], { ghost: true } );

		}
	} } );
