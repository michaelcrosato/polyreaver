// Damage delivery shapes shared by skills, monster abilities, traps and level
// mechanics: instant melee arcs, projectiles and ground areas. They are plain
// objects in world.projectiles / world.areas (not entities) - cheap enough for
// hundreds at once. The render layer draws them from their `fx` hint and listens
// to 'projectile' / 'area' events for spawn flashes and telegraphs.

import { resolveHit } from './combat.js';

let nextFx = 1;

const isFoe = ( a, b ) => a.team !== b.team && b.alive && ! b.flags.untargetable && b.kind !== 'loot' && b.kind !== 'npc' && ! b.flags.inert;

// Everything in front of `owner` within `range` metres and `angle` degrees.
// opts: { range, angle, hit, x, z, dir (radians), maxTargets, filter }
export function meleeArc( world, owner, opts ) {

	const range = opts.range ?? 2.2, half = ( opts.angle ?? 120 ) * Math.PI / 360;
	const x = opts.x ?? owner.x, z = opts.z ?? owner.z, dir = opts.dir ?? owner.facing;
	const fx = Math.sin( dir ), fz = Math.cos( dir );
	const hits = [];
	const cands = world.spatial.query( x, z, range, ( e ) => isFoe( owner, e ) && ( ! opts.filter || opts.filter( e ) ) );
	cands.sort( ( a, b ) => Math.hypot( a.x - x, a.z - z ) - Math.hypot( b.x - x, b.z - z ) );
	for ( const e of cands ) {

		const dx = e.x - x, dz = e.z - z, d = Math.hypot( dx, dz );
		if ( d > 0.3 && ( dx * fx + dz * fz ) / d < Math.cos( half ) ) continue; // outside the arc
		if ( ! world.layout.hasLineOfSight( x, z, e.x, e.z ) ) continue;
		const r = resolveHit( world, owner, e, { ...opts.hit, originX: x, originZ: z } );
		if ( r ) hits.push( r );
		if ( opts.maxTargets && hits.length >= opts.maxTargets ) break;

	}

	world.events.emit( 'melee', { owner, x, z, dir, range, angle: opts.angle ?? 120, hits: hits.length, fx: opts.fx, element: opts.element } );
	return hits;

}

// PROJECTILE opts:
//   x, z, dir (radians) | tx, tz,  speed (m/s), range (m), radius (m)
//   hit (template), pierce (count), chain (count), chainRange, fork, homing (rad/s),
//   returns (boomerang), gravity arc { height } (cosmetic), onHit( world, p, target, result ), onEnd( world, p, reason )
//   fx: render hint ( 'bolt' | 'arrow' | 'orb' | 'spit' | 'shard' | ... ), color, element, size
export function spawnProjectile( world, owner, opts ) {

	const dir = opts.dir ?? Math.atan2( ( opts.tx ?? owner.x ) - owner.x, ( opts.tz ?? owner.z + 1 ) - owner.z );
	const p = {
		id: nextFx ++, owner, team: owner.team,
		x: opts.x ?? owner.x, z: opts.z ?? owner.z, y: opts.y ?? 1.1,
		dir, speed: opts.speed ?? 18, range: opts.range ?? 20, travelled: 0, radius: opts.radius ?? 0.3,
		pierce: opts.pierce ?? 0, chain: opts.chain ?? 0, chainRange: opts.chainRange ?? 8, homing: opts.homing ?? 0,
		returns: opts.returns ?? false, returning: false, hitIds: new Set(), hit: opts.hit, alive: true, age: 0,
		onHit: opts.onHit, onEnd: opts.onEnd, fx: opts.fx || 'bolt', color: opts.color, element: opts.element, size: opts.size ?? 1,
		data: opts.data || {}
	};
	world.projectiles.push( p );
	world.events.emit( 'projectile', { p, x: p.x, z: p.z } );
	return p;

}

// AREA opts:
//   x, z, radius,  shape 'circle' | 'ring' (inner) | 'cone' (dir, angle) | 'line' (dir, length, width)
//   delay      telegraph time before the first hit (enemy attacks: give players time to dodge)
//   duration   lifetime after the delay (0 = a single hit),  interval: seconds between ticks
//   hit (template), hitOnce (each target at most once), follow (entity to stick to)
//   onTick( world, area ), onHit( world, area, target, result ), onEnd
//   fx: render hint ( 'slam' | 'nova' | 'fire' | 'ice' | 'poison' | 'telegraph' | ... ), color, element
export function spawnArea( world, owner, opts ) {

	const a = {
		id: nextFx ++, owner, team: owner ? owner.team : - 1,
		x: opts.x ?? owner.x, z: opts.z ?? owner.z, radius: opts.radius ?? 3,
		shape: opts.shape || 'circle', inner: opts.inner ?? 0, dir: opts.dir ?? owner?.facing ?? 0, angle: opts.angle ?? 90,
		length: opts.length ?? 8, width: opts.width ?? 2,
		delay: opts.delay ?? 0, duration: opts.duration ?? 0, interval: opts.interval ?? 0.5,
		age: 0, nextTick: 0, ticks: 0, hit: opts.hit, hitOnce: opts.hitOnce ?? ( ( opts.duration ?? 0 ) === 0 ), hitIds: new Set(),
		follow: opts.follow || null, onTick: opts.onTick, onHit: opts.onHit, onEnd: opts.onEnd, alive: true,
		fx: opts.fx || 'nova', color: opts.color, element: opts.element, friendly: opts.friendly ?? false, data: opts.data || {}
	};
	world.areas.push( a );
	world.events.emit( 'area', { a, x: a.x, z: a.z } );
	return a;

}

function inArea( a, e ) {

	const dx = e.x - a.x, dz = e.z - a.z, d = Math.hypot( dx, dz );
	switch ( a.shape ) {

		case 'ring': return d <= a.radius + e.radius && d >= a.inner - e.radius;
		case 'cone': {

			if ( d > a.radius + e.radius ) return false;
			if ( d < 0.5 ) return true;
			const ang = Math.atan2( dx, dz ) - a.dir;
			const wrapped = Math.atan2( Math.sin( ang ), Math.cos( ang ) );
			return Math.abs( wrapped ) <= a.angle * Math.PI / 360;

		}

		case 'line': {

			const fx = Math.sin( a.dir ), fz = Math.cos( a.dir );
			const along = dx * fx + dz * fz, across = Math.abs( - dx * fz + dz * fx );
			return along >= - e.radius && along <= a.length + e.radius && across <= a.width / 2 + e.radius;

		}

		default: return d <= a.radius + e.radius;

	}

}

function retarget( world, p, from ) {

	const next = world.spatial.nearest( from.x, from.z, p.chainRange, ( e ) => isFoe( p, e ) && ! p.hitIds.has( e.id ) );
	if ( ! next ) return false;
	p.dir = Math.atan2( next.x - p.x, next.z - p.z );
	p.travelled = Math.max( 0, p.travelled - p.chainRange );
	return true;

}

export function updateEffects( world, dt ) {

	const L = world.layout;

	for ( const p of world.projectiles ) {

		if ( ! p.alive ) continue;
		p.age += dt;
		if ( p.homing > 0 ) {

			const t = world.spatial.nearest( p.x, p.z, 12, ( e ) => isFoe( p, e ) && ! p.hitIds.has( e.id ) );
			if ( t ) {

				const want = Math.atan2( t.x - p.x, t.z - p.z );
				const diff = Math.atan2( Math.sin( want - p.dir ), Math.cos( want - p.dir ) );
				p.dir += Math.max( - p.homing * dt, Math.min( p.homing * dt, diff ) );

			}

		}

		if ( p.returning && p.owner ) p.dir = Math.atan2( p.owner.x - p.x, p.owner.z - p.z );
		const step = p.speed * dt;
		const nx = p.x + Math.sin( p.dir ) * step, nz = p.z + Math.cos( p.dir ) * step;
		const clear = L.raycast( p.x, p.z, nx, nz );
		p.x += ( nx - p.x ) * clear; p.z += ( nz - p.z ) * clear;
		p.travelled += step * clear;
		if ( clear < 1 ) {

			end( world, p, 'wall' );
			continue;

		}

		for ( const e of world.spatial.query( p.x, p.z, p.radius, ( e ) => isFoe( p, e ) && ! p.hitIds.has( e.id ) ) ) {

			p.hitIds.add( e.id );
			const r = resolveHit( world, p.owner, e, { ...p.hit, originX: p.x - Math.sin( p.dir ), originZ: p.z - Math.cos( p.dir ) } );
			p.onHit?.( world, p, e, r );
			if ( p.chain > 0 ) {

				p.chain --;
				if ( retarget( world, p, e ) ) break;

			}

			if ( p.pierce > 0 ) {

				p.pierce --;
				continue;

			}

			end( world, p, 'hit' );
			break;

		}

		if ( p.alive && p.travelled >= p.range ) {

			if ( p.returns && ! p.returning ) {

				p.returning = true;
				p.travelled = 0;
				p.hitIds.clear();

			} else end( world, p, 'range' );

		}

		if ( p.alive && p.returning && p.owner && Math.hypot( p.owner.x - p.x, p.owner.z - p.z ) < 0.8 ) end( world, p, 'returned' );

	}

	for ( const a of world.areas ) {

		if ( ! a.alive ) continue;
		a.age += dt;
		if ( a.follow ) {

			a.x = a.follow.x; a.z = a.follow.z;

		}

		if ( a.age < a.delay ) continue;
		const live = a.age - a.delay;
		if ( live >= a.nextTick ) {

			a.nextTick = live + a.interval;
			a.ticks ++;
			a.onTick?.( world, a );
			if ( a.hit ) {

				const filter = a.friendly ? ( e ) => e.team === a.team && e.alive : ( e ) => ( a.owner ? isFoe( a, e ) : e.alive && e.kind !== 'loot' && e.kind !== 'npc' );
				for ( const e of world.spatial.query( a.x, a.z, a.radius + ( a.shape === 'line' ? a.length : 0 ), filter ) ) {

					if ( a.hitOnce && a.hitIds.has( e.id ) ) continue;
					if ( ! inArea( a, e ) ) continue;
					a.hitIds.add( e.id );
					const r = resolveHit( world, a.owner, e, { ...a.hit, originX: a.x, originZ: a.z } );
					a.onHit?.( world, a, e, r );

				}

			}

			world.events.emit( 'area:tick', { a, x: a.x, z: a.z } );

		}

		if ( live >= a.duration ) {

			a.alive = false;
			a.onEnd?.( world, a );
			world.events.emit( 'area:end', { a } );

		}

	}

	world.projectiles = world.projectiles.filter( ( p ) => p.alive );
	world.areas = world.areas.filter( ( a ) => a.alive );

}

function end( world, p, reason ) {

	p.alive = false;
	p.onEnd?.( world, p, reason );
	world.events.emit( 'projectile:end', { p, x: p.x, z: p.z, reason } );

}
