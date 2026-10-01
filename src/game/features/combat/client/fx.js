// Combat VFX conductor (render system 'combat-fx'). It READS the simulation -
// projectiles, areas, entities, statuses - and LISTENS to its events, then drives
// the batches: GPU particles, ground decals, ribbons (slashes, trails, lightning),
// glow billboards, instanced meshes, damage numbers and the dynamic light pool.
// Monster abilities use the same fx hints, so they get the same treatment.
//
// Feel policy lives here too: the sim proposes 'hitstop' / 'shake' events and this
// file decides how much the player actually feels (throttled, capped, scaled by the
// player's settings) - punchy, never nauseating.

import * as THREE from 'three/webgpu';
import { define, get } from '../../../core/registry.js';
import { TEAM } from '../../../core/tuning.js';
import { Particles } from './particles.js';
import { Decals, STYLE } from './decals.js';
import { Ribbons } from './ribbons.js';
import { Billboards } from './billboards.js';
import { DamageNumbers } from './numbers.js';
import { LightPool } from './lights.js';
import { FxMeshes } from './meshes.js';
import { ELEMENTS, elementOf, dominantType } from './palette.js';
import { settings, isTouchDevice } from './settings.js';

// minion models drawn here (the placeholder renderer skips registered model types)
define( 'modelType', { id: 'combat-blade' } );
define( 'modelType', { id: 'combat-spectral' } );

// this system draws every projectile and area: retire the grey-box version
// (render/placeholder.js) by redefining its id
define( 'renderSystem', { id: 'placeholder-fx', order: 30 } );

const TAU = Math.PI * 2;
const H = 1 / 60;
const ENEMY = new THREE.Color( '#ff3b2f' ), HAZARD = new THREE.Color( '#ff9a2a' ), DUST = new THREE.Color( '#b8a48a' ), DEBRIS = new THREE.Color( '#6a5848' ), WAVE = new THREE.Color( '#ffe6c0' );
const GOLD = new THREE.Color( '#ffd34a' ), STAR = new THREE.Color( '#ffe680' ), WHITE = new THREE.Color( 1, 1, 1 );
const tmpC = new THREE.Color(), tmpC2 = new THREE.Color();
const tmpL = { x: 0, y: 0, z: 0, facing: 0 };
const vA0 = new THREE.Vector3(), vA1 = new THREE.Vector3(), vB0 = new THREE.Vector3(), vB1 = new THREE.Vector3(), vD = new THREE.Vector3(), vS = new THREE.Vector3(), vC = new THREE.Vector3();
const rand = ( a, b ) => a + Math.random() * ( b - a );
const ease = ( t ) => 1 - ( 1 - t ) * ( 1 - t ) * ( 1 - t );

// melee arc looks per fx hint: sweep time, life, inner radius, height
const ARC = {
	slash: { sweep: 0.075, life: 0.26, inner: 0.36 }, cleave: { sweep: 0.1, life: 0.32, inner: 0.32 },
	overhead: { sweep: 0.08, life: 0.3, inner: 0.3 }, thrust: { sweep: 0.05, life: 0.18, inner: 0.15 },
	spin: { sweep: 0.12, life: 0.24, inner: 0.5 }, blade: { sweep: 0.06, life: 0.18, inner: 0.4 }
};

export class CombatFx {

	constructor( rc ) {

		this.rc = rc;
		const low = isTouchDevice();
		this.low = low;
		const scene = rc.scene;
		this.particles = new Particles( rc.renderer, scene, low ? 12288 : 32768 );
		this.particles.budget = low ? 0.6 : 1;
		this.decals = new Decals( scene );
		this.ribbons = new Ribbons( scene );
		this.halos = new Billboards( scene, 2048 );
		this.numbers = new DamageNumbers( scene );
		this.lights = new LightPool( scene, 6 );
		this.applyLightBudget();
		this.meshes = new FxMeshes( scene );
		this.crescents = [];
		this.beams = [];
		this.marks = []; // transient decals { d, style, color, alpha, age, life, wave }
		this.flashes = []; // transient glow billboards
		this.spikes = []; // Glacial Cascade / nova ice spikes
		this.trails = new Map(); // entity id -> weapon tip samples
		this.off = [];
		this.lastStop = - 9;
		this.lastKillStop = - 9;
		this.warm = 2; // frames of invisible draws so every pipeline compiles at load, not mid-fight

	}

	// One invisible instance in every batch: WebGPU builds a pipeline the first time a
	// material draws, which would otherwise hitch on the first fireball of the run.
	warmUp() {

		const M = this.meshes;
		for ( const pool of M.pools ) pool.add( 0, - 200, 0, 0, 0, 0, 0.001, 0.001, 0.001, WHITE );
		this.halos.push( 0, - 200, 0, 0.001, 0, 0, 0, 0 );
		this.decals.shape( { x: 0, z: 0, shape: 'circle', radius: 0.01 }, 0, WHITE, 0, STYLE.glow );
		this.decals.shape( { x: 0, z: 0, shape: 'circle', radius: 0.01 }, 0, WHITE, 0, STYLE.scorch );

	}

	applyLightBudget() {

		const s = settings.lights;
		this.lights.setBudget( s === 'low' ? 2 : s === 'high' ? 6 : this.low ? 3 : 6 );

	}

	// --- world wiring ----------------------------------------------------------------

	attach( world, game ) {

		for ( const off of this.off ) off();
		this.off = [];
		this.crescents.length = this.beams.length = this.marks.length = this.flashes.length = this.spikes.length = 0;
		this.trails.clear();
		this.numbers.list.length = 0;
		this.world = world;
		const on = ( type, fn ) => this.off.push( world.events.on( type, fn ) );
		on( 'hit', ( h ) => this.onHit( h ) );
		on( 'evade', ( e ) => this.text( e.target, 'EVADE', 'evade' ) );
		on( 'block', ( e ) => this.text( e.target, 'BLOCK', 'block' ) );
		on( 'melee', ( m ) => this.onMelee( m ) );
		on( 'projectile', ( { p } ) => this.onProjectile( p ) );
		on( 'projectile:end', ( { p, reason } ) => this.onProjectileEnd( p, reason ) );
		on( 'area:tick', ( { a } ) => a.ticks === 1 && this.onAreaStart( a ) );
		on( 'death', ( d ) => this.onDeath( d ) );
		on( 'dodge', ( d ) => this.onDodge( d ) );
		on( 'status', ( s ) => this.onStatus( s ) );
		on( 'fx', ( f ) => this.onFx( f ) );
		on( 'dot', ( d ) => settings.numbers && this.numbers.add( d.entity.x, ( d.entity.height || 1.6 ) + 0.1, d.entity.z, d.amount, d.element, 'dot', - d.entity.id ) );
		on( 'skill', ( s ) => this.onSkill( s ) );
		on( 'hitstop', ( h ) => this.hitstop( h.time ) );
		on( 'shake', ( s ) => this.shake( s.amount ) );
		if ( ! this.gameHooked ) {

			this.gameHooked = true;
			game.events.on( 'levelup', () => this.onLevelUp() );

		}

	}

	// --- feel ------------------------------------------------------------------------------

	hitstop( t ) {

		if ( ! settings.hitstop ) return;
		const now = this.rc.time;
		// never chain freezes into a stutter: small stops (crits at high attack speed)
		// are rationed harder than the designed heavy ones
		if ( now - this.lastStop < ( t < 0.04 ? 0.35 : 0.12 ) ) return;
		this.lastStop = now;
		this.rc.hitstop = Math.max( this.rc.hitstop, Math.min( 0.11, t ) );

	}

	shake( amount ) {

		this.rc.shake = Math.min( 1, ( this.rc.shake || 0 ) + amount * settings.shake );

	}

	flash( x, y, z, size, color, life = 0.12, alpha = 1 ) {

		if ( this.flashes.length < 256 ) this.flashes.push( { x, y, z, size, color: color.clone(), life, age: 0, alpha } );

	}

	text( e, word, kind ) {

		if ( e && settings.numbers ) this.numbers.add( e.x, ( e.height || 1.6 ) + 0.2, e.z, 0, kind, 'text', 0, word );

	}

	// --- events ------------------------------------------------------------------------------

	onHit( h ) {

		const t = h.target;
		if ( ! t || ! ( h.total > 0 ) ) return;
		const type = dominantType( h.byType );
		const el = elementOf( type );
		const y = Math.min( 1.7, ( t.height || 1.6 ) * 0.62 ) + t.y;
		const dir = Math.atan2( t.anim.hitDirX, t.anim.hitDirZ );
		const P = this.particles;
		const crit = h.crit, n = crit ? 2 : 1;
		switch ( type ) {

			case 'fire':
				P.burst( t.x, y, t.z, 8 * n, { color: el.glow, color2: el.core, hdr: el.hdr, speed: [ 1.5, 5 ], vy: 1.5, gravity: - 3, drag: 2.5, size: [ 0.12, 0.24 ], life: [ 0.3, 0.6 ], dir, cone: 2.2 } );
				break;
			case 'cold':
				P.burst( t.x, y, t.z, 9 * n, { color: el.core, color2: el.glow, hdr: el.hdr * 0.8, speed: [ 3, 7 ], gravity: 16, drag: 1, size: [ 0.06, 0.12 ], life: [ 0.3, 0.55 ], hard: 0.9, dir, cone: 2 } );
				break;
			case 'lightning':
				P.burst( t.x, y, t.z, 9 * n, { color: el.core, color2: el.glow, hdr: el.hdr, speed: [ 8, 15 ], drag: 4, size: [ 0.04, 0.08 ], life: [ 0.08, 0.2 ], streak: 0.07, hard: 0.5 } );
				break;
			case 'chaos':
				P.burst( t.x, y, t.z, 7 * n, { color: el.glow, color2: el.core, hdr: el.hdr * 0.7, speed: [ 1, 3 ], gravity: - 1, drag: 2, size: [ 0.14, 0.26 ], life: [ 0.4, 0.7 ], dir, cone: 2.5 } );
				break;
			default:
				P.burst( t.x, y, t.z, 9 * n, { color: el.core, color2: ELEMENTS.fire.glow, hdr: el.hdr * 1.3, speed: [ 5, 11 ], gravity: 14, drag: 2, size: [ 0.04, 0.08 ], life: [ 0.15, 0.32 ], hard: 0.6, streak: 0.05, dir, cone: 1.7, up: 0.9 } );

		}

		this.flash( t.x, y, t.z, crit ? 2.2 : 1.1, crit ? WHITE : el.glow, crit ? 0.14 : 0.08, crit ? 1 : 0.7 );
		const player = this.world.player;
		if ( settings.numbers ) this.numbers.add( t.x, ( t.height || 1.6 ) + 0.25 + t.y, t.z, h.total, type, t.team === TEAM.PLAYER ? 'hurt' : crit ? 'crit' : 'hit', t.id );
		if ( t === player ) {

			this.shake( Math.min( 0.4, Math.max( 0.06, h.total / Math.max( 1, t.maxLife ) * 1.4 ) ) );
			this.rc.combatHurt = this.rc.time;

		} else if ( h.source === player ) {

			if ( crit ) {

				this.shake( 0.06 );
				this.hitstop( 0.03 );
				this.lights.flash( t.x, y + 0.5, t.z, el.glow, 14, 5, 0.12 );

			}

		}

	}

	onMelee( m ) {

		if ( ! m.range ) return;
		const o = m.owner;
		const enemy = o && o.team === TEAM.ENEMY;
		const fx = ARC[ m.fx ] ? m.fx : m.angle >= 300 ? 'spin' : enemy ? 'slash' : 'slash';
		const el = m.element ? elementOf( m.element ) : enemy ? ELEMENTS.enemy : ELEMENTS.physical;
		const variant = fx === 'overhead' ? 2 : o?.anim.variant ?? 0;
		if ( this.crescents.length > 96 ) this.crescents.shift();
		this.crescents.push( {
			x: m.x, z: m.z, y: ( o?.y ?? 0 ) + ( o?.kind === 'minion' && o.data.minion === 'blade' ? 0.9 : Math.min( 0.9, ( o?.height ?? 1.8 ) * 0.45 ) ),
			dir: m.dir, range: m.range, angle: fx === 'thrust' ? 16 : Math.min( 360, m.angle ), variant, fx, color: el.glow.clone().lerp( el.core, 0.35 ),
			hdr: el.hdr * ( enemy ? 0.55 : 0.75 ), alpha: enemy ? 0.55 : 0.95, age: 0, ...ARC[ fx ]
		} );

	}

	onProjectile( p ) {

		const el = this.projColor( p );
		this.particles.burst( p.x, p.y, p.z, 5, { color: el.glow, color2: el.core, hdr: el.hdr, speed: [ 2, 5 ], drag: 4, size: [ 0.08, 0.16 ], life: [ 0.1, 0.22 ], dir: p.dir, cone: 1.2 } );
		this.flash( p.x, p.y, p.z, 1.2 * p.size, el.glow, 0.1, 0.8 );

	}

	onProjectileEnd( p, reason ) {

		if ( reason === 'returned' ) return;
		const el = this.projColor( p );
		const n = p.fx === 'spark' ? 4 : 8;
		this.particles.burst( p.x, p.y, p.z, n, { color: el.core, color2: el.glow, hdr: el.hdr, speed: [ 2, 7 ], gravity: p.element === 'cold' ? 12 : 4, drag: 2, size: [ 0.05, 0.12 ], life: [ 0.12, 0.3 ], hard: p.element === 'cold' ? 0.8 : 0.3, streak: 0.03 } );
		this.flash( p.x, p.y, p.z, 1.4 * p.size, el.glow, 0.1, 0.7 );
		if ( p.fx === 'frost' || p.fx === 'ball' ) this.lights.flash( p.x, p.y + 0.4, p.z, el.glow, 10, 5, 0.15 );

	}

	projColor( p ) {

		if ( p.element ) return elementOf( p.element );
		if ( p.team === TEAM.ENEMY ) return ELEMENTS.enemy;
		return ELEMENTS.physical;

	}

	areaColor( a ) {

		if ( a.element ) return elementOf( a.element );
		return a.team === TEAM.PLAYER ? ELEMENTS.physical : ELEMENTS.enemy;

	}

	// An area becomes active: its impact visuals.
	onAreaStart( a ) {

		const el = this.areaColor( a );
		const P = this.particles;
		const r = a.shape === 'line' ? a.length / 2 : a.radius;
		const big = Math.min( 2.5, 0.5 + r / 3 );
		const shape = { x: a.x, z: a.z, shape: a.shape, radius: a.radius, inner: a.inner, angle: a.angle, dir: a.dir, length: a.length, width: a.width };
		const wave = ( color, life = 0.35, alpha = 1 ) => this.marks.push( { d: shape, style: STYLE.wave, color: color.clone(), alpha, age: 0, life, wave: true } );
		const scorch = ( life = 4, alpha = 0.8 ) => this.marks.push( { d: { ...shape, radius: a.radius * 0.8 }, style: STYLE.scorch, color: new THREE.Color( 0.05, 0.03, 0.02 ), alpha, age: 0, life } );
		const pool = ( style, color, life, alpha = 1 ) => this.marks.push( { d: shape, style, color: color.clone(), alpha, age: 0, life } );
		const at = ( n, o ) => {

			for ( let i = 0; i < n; i ++ ) {

				const q = randomIn( a );
				P.burst( q.x, 0.15, q.z, 1, o );

			}

		};

		switch ( a.fx ) {

			case 'slam': case 'quake': case 'aftershock': case 'impact': {

				wave( a.fx === 'aftershock' ? ELEMENTS.warcry.glow : WAVE, 0.4, 1.5 );
				pool( STYLE.glow, a.fx === 'aftershock' ? ELEMENTS.warcry.glow : WAVE, 0.18, 0.8 );
				scorch( 3, 0.6 );
				at( 14 * big, { color: DEBRIS, hdr: 0.9, speed: [ 3, 8 ], up: 1.4, gravity: 22, drag: 0.5, size: [ 0.1, 0.22 ], life: [ 0.5, 0.9 ], hard: 1 } );
				at( 10 * big, { color: DUST, hdr: 0.45, speed: [ 1, 3 ], flat: true, drag: 2.5, size: [ 0.5, 1.0 ], life: [ 0.4, 0.8 ] } );
				if ( a.element && a.element !== 'physical' ) at( 10 * big, { color: el.glow, color2: el.core, hdr: el.hdr, speed: [ 2, 6 ], up: 1.2, gravity: 6, size: [ 0.06, 0.14 ], life: [ 0.3, 0.6 ] } );
				this.lights.flash( a.x, 1.2, a.z, a.element && a.element !== 'physical' ? el.glow : DUST, 6, r * 2, 0.2 );
				break;

			}

			case 'nova': case 'icespike': {

				wave( el.glow, 0.32 );
				pool( STYLE.frost, el.glow, a.fx === 'nova' ? 1.4 : 0.9, 0.8 );
				P.burst( a.x, 0.6, a.z, a.fx === 'nova' ? 50 : 14, { color: el.core, color2: el.glow, hdr: el.hdr, speed: a.fx === 'nova' ? [ r * 2.2, r * 3.2 ] : [ 2, 6 ], flat: a.fx === 'nova', up: 1.2, drag: 3, gravity: 3, size: [ 0.08, 0.18 ], life: [ 0.25, 0.5 ], hard: 0.85, streak: 0.03 } );
				if ( a.fx === 'icespike' ) for ( let i = 0; i < 3; i ++ ) this.spikes.push( { x: a.x + rand( - 0.4, 0.4 ) * r, z: a.z + rand( - 0.4, 0.4 ) * r, s: r * rand( 0.7, 1.1 ), yaw: rand( 0, TAU ), tilt: rand( - 0.35, 0.35 ), age: 0, life: 0.7 } );
				else for ( let i = 0; i < 10; i ++ ) {

					const ang = i / 10 * TAU + rand( - 0.2, 0.2 );
					this.spikes.push( { x: a.x + Math.sin( ang ) * r * 0.75, z: a.z + Math.cos( ang ) * r * 0.75, s: rand( 0.5, 0.9 ), yaw: ang, tilt: 0.5, age: 0, life: 0.55 } );

				}

				this.lights.flash( a.x, 1.5, a.z, el.glow, 16, r * 2.5, 0.3 );
				break;

			}

			case 'explosion': case 'meteor': {

				const m = a.fx === 'meteor' ? 2.2 : 1;
				wave( el.glow, 0.3 * m );
				scorch( 5 );
				P.burst( a.x, 0.6, a.z, 40 * m, { color: el.glow, color2: el.core, hdr: el.hdr, speed: [ 2, 7 * m ], up: 1.5, gravity: - 2, drag: 3, size: [ 0.2, 0.45 * m ], life: [ 0.3, 0.7 ], radius: r * 0.3 } );
				P.burst( a.x, 0.6, a.z, 24 * m, { color: el.core, color2: el.glow, hdr: el.hdr * 1.2, speed: [ 6, 14 ], up: 1.3, gravity: 12, drag: 1.5, size: [ 0.04, 0.08 ], life: [ 0.3, 0.7 ], streak: 0.05, hard: 0.6 } );
				if ( m > 1 ) at( 18, { color: DEBRIS, hdr: 1, speed: [ 4, 10 ], up: 1.4, gravity: 22, size: [ 0.12, 0.26 ], life: [ 0.6, 1.1 ], hard: 1 } );
				this.flash( a.x, 1, a.z, r * 2.2, el.core, 0.16, 1 );
				this.lights.flash( a.x, 1.6, a.z, el.glow, 30 * m, r * 3, 0.35 * m );
				break;

			}

			case 'storm': {

				wave( el.glow, 0.3 );
				pool( STYLE.storm, el.glow, 0.5 );
				P.burst( a.x, 0.4, a.z, 30, { color: el.core, color2: el.glow, hdr: el.hdr, speed: [ 5, 12 ], up: 1.2, drag: 3, size: [ 0.04, 0.09 ], life: [ 0.15, 0.4 ], streak: 0.07 } );
				this.lights.flash( a.x, 3, a.z, el.glow, 40, r * 4, 0.25 );
				break;

			}

			case 'warcry': case 'dash':
				break;

			case 'fire': case 'poison': {

				// lasting ground effects draw every frame (drawAreas); an instant one gets a burst
				if ( a.duration > 0 ) break;
				wave( el.glow, 0.3 );
				at( 16 * big, { color: el.glow, color2: el.core, hdr: el.hdr, speed: [ 1, 3 ], vy: 2, gravity: - 2, drag: 2, size: [ 0.15, 0.3 ], life: [ 0.3, 0.6 ] } );
				this.lights.flash( a.x, 1.2, a.z, el.glow, 10, r * 2.5, 0.25 );
				break;

			}

			default: {

				// monster abilities and mechanics without a dedicated look
				wave( el.glow, 0.3 );
				at( 10 * big, { color: el.glow, color2: el.core, hdr: el.hdr, speed: [ 2, 6 ], up: 1.2, gravity: 8, size: [ 0.06, 0.14 ], life: [ 0.25, 0.5 ] } );
				this.lights.flash( a.x, 1.2, a.z, el.glow, 8, r * 2.2, 0.2 );

			}

		}

	}

	onDeath( d ) {

		const e = d.entity;
		const P = this.particles;
		const h = e.height || 1.6;
		if ( e.data.shattered ) {

			const c = ELEMENTS.cold;
			P.burst( e.x, h * 0.5, e.z, 34, { color: c.core, color2: c.glow, hdr: 1.6, speed: [ 3, 9 ], up: 1.3, gravity: 18, drag: 0.8, size: [ 0.1, 0.24 ], life: [ 0.5, 1.0 ], hard: 1, radius: e.radius, height: h * 0.6 } );
			for ( let i = 0; i < 5; i ++ ) this.spikes.push( { x: e.x + rand( - 0.5, 0.5 ), z: e.z + rand( - 0.5, 0.5 ), s: rand( 0.4, 0.8 ) * h * 0.5, yaw: rand( 0, TAU ), tilt: rand( - 0.8, 0.8 ), age: 0, life: 0.45 } );
			this.lights.flash( e.x, 1.2, e.z, c.glow, 14, 6, 0.25 );

		} else if ( e.kind === 'minion' ) {

			P.burst( e.x, 0.9, e.z, 14, { color: ELEMENTS.spectral.glow, color2: ELEMENTS.spectral.core, hdr: 1.6, speed: [ 0.5, 2 ], vy: 1.5, drag: 2, size: [ 0.08, 0.16 ], life: [ 0.4, 0.8 ], radius: 0.3, height: 1 } );

		} else if ( e.team === TEAM.ENEMY ) {

			const el = d.hit?.skill ? elementOf( dominantType( d.hit.damage ? Object.fromEntries( Object.entries( d.hit.damage ).map( ( [ k, v ] ) => [ k, Array.isArray( v ) ? v[ 1 ] : v ] ) ) : {} ) ) : ELEMENTS.enemy;
			P.burst( e.x, h * 0.5, e.z, 16 + e.radius * 10, { color: el.glow, color2: ELEMENTS.enemy.glow, hdr: 1.2, speed: [ 1, 4 ], up: 1.2, gravity: 6, drag: 1.5, size: [ 0.08, 0.18 ], life: [ 0.4, 0.8 ], radius: e.radius, height: h * 0.6 } );
			P.burst( e.x, h * 0.6, e.z, 4, { color: ELEMENTS.spectral.glow, hdr: 0.9, speed: [ 0.2, 0.8 ], vy: 1.6, drag: 0.6, size: [ 0.18, 0.3 ], life: [ 0.9, 1.4 ] } );

		}

		// kill feel: heavy for elites and bosses, a light tick for the rest (throttled)
		const k = d.killer;
		if ( k && ( k.team === TEAM.PLAYER ) && e.team === TEAM.ENEMY ) {

			const elite = e.kind === 'boss' || e.data.rarity === 'rare' || e.data.rarity === 'unique';
			if ( elite ) {

				this.lastStop = - 9;
				this.hitstop( e.kind === 'boss' ? 0.11 : 0.07 );
				this.shake( e.kind === 'boss' ? 0.6 : 0.3 );
				this.lights.flash( e.x, 2, e.z, GOLD, 30, 10, 0.4 );

			} else if ( this.rc.time - this.lastKillStop > 0.3 ) {

				this.lastKillStop = this.rc.time;
				this.hitstop( 0.025 );

			}

		}

	}

	onDodge( d ) {

		const e = d.entity;
		this.particles.burst( e.x, 0.15, e.z, 10, { color: DUST, hdr: 0.5, speed: [ 1, 3 ], flat: true, drag: 3, size: [ 0.3, 0.6 ], life: [ 0.25, 0.45 ] } );
		this.particles.burst( e.x, 0.9, e.z, 8, { color: ELEMENTS.spectral.glow, hdr: 1, speed: [ 0.5, 1.5 ], drag: 3, size: [ 0.15, 0.3 ], life: [ 0.2, 0.35 ], radius: 0.3, height: 0.8 } );

	}

	onStatus( s ) {

		const e = s.entity;
		if ( ! e ) return;
		const h = e.height || 1.6;
		const el = elementOf( s.id );
		if ( s.id === 'freeze' ) {

			this.particles.burst( e.x, h * 0.5, e.z, 16, { color: el.core, color2: el.glow, hdr: 1.4, speed: [ 1, 4 ], gravity: 8, size: [ 0.08, 0.16 ], life: [ 0.3, 0.6 ], hard: 0.9, radius: e.radius } );

		} else if ( [ 'warcry', 'rage', 'haste', 'fortify', 'ice-armour' ].includes( s.id ) ) {

			this.particles.burst( e.x, 0.2, e.z, 18, { color: el.glow, color2: el.core, hdr: 1.4, speed: [ 0.3, 1 ], vy: 2.5, drag: 1.2, size: [ 0.08, 0.16 ], life: [ 0.5, 0.9 ], radius: 0.6 } );

		}

	}

	onSkill( s ) {

		const e = s.entity;
		if ( ! e || ! s.tags || ! s.tags.includes( 'spell' ) ) return;
		const el = elementOf( s.element );
		const fx = Math.sin( e.facing ), fz = Math.cos( e.facing );
		this.particles.burst( e.x + fx * 0.5, 1.3, e.z + fz * 0.5, 10, { color: el.glow, color2: el.core, hdr: el.hdr, speed: [ 0.4, 1.5 ], drag: 2, size: [ 0.08, 0.16 ], life: [ 0.25, 0.45 ], radius: 0.25 } );
		this.lights.flash( e.x + fx * 0.6, 1.5, e.z + fz * 0.6, el.glow, 6, 4, 0.3 );

	}

	onFx( f ) {

		const P = this.particles;
		const el = elementOf( f.element );
		switch ( f.kind ) {

			case 'beam': {

				this.beams.push( { x1: f.x1, y1: f.y1 ?? 1.2, z1: f.z1, x2: f.x2, y2: f.y2 ?? 1, z2: f.z2, color: el.glow.clone().lerp( el.core, 0.3 ), hdr: el.hdr, width: f.width ?? 0.28, age: 0, life: f.time ?? 0.2, pts: null, next: 0 } );
				P.burst( f.x2, f.y2 ?? 1, f.z2, 8, { color: el.core, color2: el.glow, hdr: el.hdr, speed: [ 3, 9 ], drag: 3, size: [ 0.04, 0.08 ], life: [ 0.1, 0.25 ], streak: 0.06 } );
				this.lights.flash( f.x2, ( f.y2 ?? 1 ) + 0.5, f.z2, el.glow, f.width > 0.5 ? 40 : 14, f.width > 0.5 ? 12 : 6, 0.18 );
				break;

			}

			case 'blink': {

				for ( const [ x, z ] of [ [ f.x, f.z ], [ f.x2, f.z2 ] ] ) {

					P.burst( x, 0.1, z, 24, { color: el.glow, color2: el.core, hdr: el.hdr, speed: [ 0.3, 1.2 ], vy: 3, drag: 1.5, size: [ 0.06, 0.14 ], life: [ 0.3, 0.6 ], radius: 0.45, height: 1.6 } );
					this.flash( x, 1, z, 2.6, el.glow, 0.18, 0.9 );

				}

				const n = 14;
				for ( let i = 0; i <= n; i ++ ) {

					const t = i / n;
					P.emit( f.x + ( f.x2 - f.x ) * t, 1, f.z + ( f.z2 - f.z ) * t, 0, 0.5, 0, el.glow.r * 1.5, el.glow.g * 1.5, el.glow.b * 1.5, 0.35, 0.25, 0, 3 );

				}

				this.lights.flash( f.x2, 1.5, f.z2, el.glow, 12, 6, 0.25 );
				break;

			}

			case 'burst':
				P.burst( f.x, 0.8, f.z, 12, { color: el.glow, color2: el.core, hdr: el.hdr, speed: [ 2, 5 ], drag: 3, size: [ 0.06, 0.14 ], life: [ 0.15, 0.35 ] } );
				this.marks.push( { d: { x: f.x, z: f.z, shape: 'circle', radius: f.radius ?? 2 }, style: STYLE.wave, color: el.glow.clone(), alpha: 0.8, age: 0, life: 0.25, wave: true } );
				break;
			case 'impact':
				this.marks.push( { d: { x: f.x, z: f.z, shape: 'circle', radius: f.radius ?? 1.5 }, style: STYLE.wave, color: el.glow.clone(), alpha: 1, age: 0, life: 0.25, wave: true } );
				this.marks.push( { d: { x: f.x, z: f.z, shape: 'circle', radius: ( f.radius ?? 1.5 ) * 0.7 }, style: STYLE.scorch, color: new THREE.Color( 0.05, 0.04, 0.03 ), alpha: 0.5, age: 0, life: 2 } );
				P.burst( f.x, 0.2, f.z, 10, { color: DEBRIS, hdr: 1, speed: [ 2, 5 ], up: 1.4, gravity: 20, size: [ 0.07, 0.15 ], life: [ 0.4, 0.7 ], hard: 1 } );
				P.burst( f.x, 0.2, f.z, 6, { color: DUST, hdr: 0.4, speed: [ 1, 2.5 ], flat: true, drag: 2.5, size: [ 0.4, 0.8 ], life: [ 0.3, 0.6 ] } );
				break;
			case 'shatter':
				P.burst( f.x, 1, f.z, f.small ? 10 : 30, { color: ELEMENTS.cold.core, color2: ELEMENTS.cold.glow, hdr: 1.5, speed: [ 2, 7 ], up: 1, gravity: 16, size: [ 0.06, 0.16 ], life: [ 0.3, 0.7 ], hard: 1 } );
				break;
			case 'ring': {

				const c = elementOf( f.element );
				this.marks.push( { d: { x: f.x, z: f.z, shape: 'circle', radius: f.radius ?? 3 }, style: STYLE.wave, color: c.glow.clone(), alpha: 1.2, age: 0, life: 0.45, wave: true } );
				P.burst( f.x, 0.5, f.z, 30, { color: c.glow, color2: c.core, hdr: c.hdr, speed: [ ( f.radius ?? 3 ) * 2, ( f.radius ?? 3 ) * 3 ], flat: true, drag: 4, size: [ 0.1, 0.2 ], life: [ 0.25, 0.4 ] } );
				this.lights.flash( f.x, 1.5, f.z, c.glow, 12, 8, 0.3 );
				break;

			}

			case 'summon':
				P.burst( f.x, 0.1, f.z, 26, { color: ELEMENTS.spectral.glow, color2: ELEMENTS.spectral.core, hdr: 1.8, speed: [ 0.2, 1 ], vy: 3, drag: 1.2, size: [ 0.06, 0.14 ], life: [ 0.4, 0.8 ], radius: 0.5 } );
				this.flash( f.x, 0.9, f.z, 2.4, ELEMENTS.spectral.glow, 0.25, 0.9 );
				break;

		}

	}

	onLevelUp() {

		const p = this.world?.player;
		if ( ! p ) return;
		this.particles.burst( p.x, 0.1, p.z, 80, { color: GOLD, color2: WHITE, hdr: 2.2, speed: [ 0.3, 1.5 ], vy: 6, drag: 1, size: [ 0.08, 0.18 ], life: [ 0.8, 1.4 ], radius: 0.8 } );
		this.marks.push( { d: { x: p.x, z: p.z, shape: 'circle', radius: 4 }, style: STYLE.wave, color: GOLD.clone(), alpha: 1.4, age: 0, life: 0.6, wave: true } );
		this.lights.flash( p.x, 2, p.z, GOLD, 40, 12, 1 );

	}

	// --- per frame -------------------------------------------------------------------------------

	update( rc, world, alpha, dt ) {

		const fdt = rc.hitstop > 0 ? dt * 0.2 : dt; // during a hitstop the sparks hang in the air
		this.drawProjectiles( rc, world, alpha, fdt );
		this.drawAreas( rc, world, fdt );
		this.drawEntities( rc, world, fdt );
		this.drawMarks( fdt );
		this.drawRibbons( rc, world, fdt );
		this.drawFlashes( fdt );
		this.drawSpikes( fdt );
		this.drawTouchAim( rc, world );
		if ( this.warm > 0 ) this.warmUp();

		this.decals.end();
		this.halos.end();
		this.meshes.end();
		this.numbers.update( fdt, ( rc.camDist ?? 30 ) / 30, this.warm > 0 );
		const f = rc.camTarget || world.player || { x: 0, z: 0 };
		this.lights.update( fdt, f.x, f.z );
		this.particles.update( Math.min( fdt, 1 / 20 ) );
		if ( this.warm > 0 ) this.warm --;

	}

	drawProjectiles( rc, world, alpha, dt ) {

		const M = this.meshes, P = this.particles, B = this.halos;
		this.halos.begin();
		for ( const p of world.projectiles ) {

			// render one step behind the sim, interpolated along the flight direction
			const back = p.speed * H * ( 1 - alpha );
			const fx = Math.sin( p.dir ), fz = Math.cos( p.dir );
			const x = p.x - fx * back, z = p.z - fz * back, y = p.y;
			const el = this.projColor( p );
			const s = p.size ?? 1;
			tmpC.copy( el.core );
			const flick = 0.85 + Math.random() * 0.3;
			switch ( p.fx ) {

				case 'shard':
					M.shard.add( x, y, z, p.dir, 0, rc.time * 9, s, s, s * 1.2, tmpC );
					B.push( x, y, z, 1.4 * s, el.glow.r, el.glow.g, el.glow.b, 0.8 );
					for ( let i = 0; i < 2; i ++ ) P.emit( x - fx * rand( 0, 0.5 ), y, z - fz * rand( 0, 0.5 ), rand( - 0.4, 0.4 ), rand( - 0.2, 0.4 ), rand( - 0.4, 0.4 ), el.core.r * 1.6, el.core.g * 1.6, el.core.b * 1.6, 0.09, 0.3, 4, 1, 0.9 );
					break;
				case 'blade':
					M.blade.add( x, y, z, p.dir, 0, 0, s, s, s, tmpC );
					B.push( x, y, z, 0.7 * s, el.glow.r, el.glow.g, el.glow.b, 0.45 );
					break;
				case 'bolt': case 'arrow':
					M.bolt.add( x, y, z, p.dir, 0, 0, s, s, 1.2 * s, tmpC );
					B.push( x, y, z, 0.6 * s, el.glow.r, el.glow.g, el.glow.b, 0.5 );
					break;
				case 'spark':
					M.orb.add( x, y + rand( - 0.06, 0.06 ), z, 0, 0, 0, 0.3 * s * flick, 0.3 * s * flick, 0.3 * s * flick, tmpC );
					B.push( x, y, z, 1.6 * s * flick, el.glow.r * 1.3, el.glow.g * 1.3, el.glow.b * 1.3, 0.9 );
					if ( Math.random() < 0.5 ) P.emit( x, y, z, rand( - 2, 2 ), rand( - 1, 2 ), rand( - 2, 2 ), el.core.r * 2, el.core.g * 2, el.core.b * 2, 0.05, 0.12, 0, 4, 0.5, 0.06 );
					break;
				case 'ball':
					M.orb.add( x, y, z, rc.time * 3, rc.time * 2, 0, 0.55 * s * flick, 0.55 * s * flick, 0.55 * s * flick, tmpC );
					B.push( x, y, z, 2.4 * s * flick, el.glow.r, el.glow.g, el.glow.b, 0.9 );
					if ( Math.random() < 0.6 ) P.emit( x + rand( - 0.4, 0.4 ), y + rand( - 0.4, 0.4 ), z + rand( - 0.4, 0.4 ), rand( - 3, 3 ), rand( - 3, 3 ), rand( - 3, 3 ), el.core.r * 2.5, el.core.g * 2.5, el.core.b * 2.5, 0.05, 0.12, 0, 5, 0.5, 0.08 );
					this.lights.steady( x, y + 0.3, z, el.glow, 14 * flick, 7 );
					break;
				case 'frost':
					M.orb.add( x, y, z, rc.time * 2, rc.time * 3, 0, 0.6 * s, 0.6 * s, 0.6 * s, tmpC );
					B.push( x, y, z, 2.2 * s, el.glow.r, el.glow.g, el.glow.b, 0.8 );
					P.emit( x + rand( - 0.3, 0.3 ), y + rand( - 0.3, 0.3 ), z + rand( - 0.3, 0.3 ), rand( - 0.5, 0.5 ), - 0.5, rand( - 0.5, 0.5 ), el.glow.r * 1.5, el.glow.g * 1.5, el.glow.b * 1.5, 0.14, 0.5, 2, 1, 0.3 );
					this.lights.steady( x, y + 0.3, z, el.glow, 8, 6 );
					break;
				default: {

					// 'orb' (fireball), 'spit' and anything unknown: a glowing core, a halo and a trail
					const big = p.fx === 'orb' ? 0.42 : 0.28;
					M.orb.add( x, y, z, rc.time * 4, rc.time * 3, 0, big * s * flick, big * s * flick, big * s * flick, tmpC );
					B.push( x, y, z, ( p.fx === 'orb' ? 2.0 : 1.2 ) * s * flick, el.glow.r, el.glow.g, el.glow.b, 0.85 );
					for ( let i = 0; i < ( p.fx === 'orb' ? 3 : 1 ); i ++ ) {

						P.emit( x + rand( - 0.15, 0.15 ), y + rand( - 0.15, 0.15 ), z + rand( - 0.15, 0.15 ), - fx * 1.5 + rand( - 0.6, 0.6 ), rand( 0.2, 1.4 ), - fz * 1.5 + rand( - 0.6, 0.6 ),
							el.glow.r * el.hdr * 0.6, el.glow.g * el.hdr * 0.6, el.glow.b * el.hdr * 0.6, rand( 0.12, 0.26 ) * s, rand( 0.18, 0.32 ), - 2, 3 );

					}

					if ( p.fx === 'orb' || p.team === TEAM.ENEMY ) this.lights.steady( x, y + 0.3, z, el.glow, p.fx === 'orb' ? 16 : 6, 7 );

				}

			}

		}

	}

	drawAreas( rc, world, dt ) {

		const D = this.decals, P = this.particles, M = this.meshes;
		for ( const a of world.areas ) {

			const el = this.areaColor( a );
			const friendly = a.team === TEAM.PLAYER;
			if ( a.age < a.delay ) {

				// TELEGRAPH: fills up until the hit lands - read it, dodge it
				const fill = Math.min( 1, a.age / Math.max( 0.01, a.delay ) );
				if ( friendly ) D.shape( a, fill, el.glow, 0.85, STYLE.target, a.age, a.id );
				else D.shape( a, fill, a.team === TEAM.ENEMY ? ENEMY : HAZARD, 1, STYLE.telegraph, a.age, a.id );
				if ( a.fx === 'meteor' ) {

					// the rock falls along a steep diagonal (toward the camera, so it stays in
					// view) and lands exactly when the delay ends
					const k = Math.pow( 1 - fill, 1.3 );
					const x = a.x + 4 * k, y = 0.4 + 16 * k, z = a.z + 2 * k;
					M.rock.add( x, y, z, rc.time * 2, rc.time * 3, 0, 1.3, 1.3, 1.3, WHITE );
					this.halos.push( x, y, z, 4.5, el.glow.r, el.glow.g, el.glow.b, 0.9 );
					P.burst( x, y, z, 4, { color: el.glow, color2: el.core, hdr: el.hdr, speed: [ 0.5, 2 ], vy: 3, drag: 2, size: [ 0.3, 0.6 ], life: [ 0.3, 0.6 ], radius: 0.5 } );
					this.lights.steady( x, y, z, el.glow, 30, 14 );

				} else if ( a.fx === 'storm' && Math.random() < dt * 20 ) {

					const q = randomIn( a );
					P.emit( q.x, 0.2, q.z, 0, rand( 1, 3 ), 0, el.core.r * 2, el.core.g * 2, el.core.b * 2, 0.06, 0.2, 0, 2, 0.5, 0.08 );

				}

				continue;

			}

			if ( a.duration <= 0 ) continue;
			const left = a.duration - ( a.age - a.delay );
			const fade = Math.min( 1, left / 0.4, ( a.age - a.delay ) / 0.15 );
			const area = a.shape === 'line' ? a.length * a.width : Math.PI * a.radius * a.radius;
			const rate = Math.min( 80, area * 3 ) * dt * this.particles.budget;
			switch ( a.fx ) {

				case 'fire':
					D.shape( a, 1, el.glow, fade, STYLE.fire, 1, a.id );
					for ( let i = 0; i < rate * 1.5; i ++ ) {

						const q = randomIn( a );
						P.emit( q.x, 0.1, q.z, rand( - 0.3, 0.3 ), rand( 1.5, 3.5 ), rand( - 0.3, 0.3 ), el.glow.r * 2.4, el.glow.g * 2.4, el.glow.b * 2.4, rand( 0.15, 0.32 ), rand( 0.35, 0.7 ), - 1.5, 1.5 );

					}

					{

						const c = a.shape === 'line' ? { x: a.x + Math.sin( a.dir ) * a.length / 2, z: a.z + Math.cos( a.dir ) * a.length / 2 } : a;
						this.lights.steady( c.x, 1.2, c.z, el.glow, 12 * fade, Math.min( 12, 3 + Math.sqrt( area ) * 1.5 ) );

					}

					break;
				case 'poison':
					D.shape( a, 1, el.glow, fade * 0.9, STYLE.poison, 1, a.id );
					for ( let i = 0; i < rate * 0.6; i ++ ) {

						const q = randomIn( a );
						P.emit( q.x, rand( 0.1, 1.2 ), q.z, rand( - 0.3, 0.3 ), rand( 0.1, 0.5 ), rand( - 0.3, 0.3 ), el.glow.r * 0.7, el.glow.g * 0.7, el.glow.b * 0.7, rand( 0.5, 0.9 ), rand( 0.8, 1.4 ), - 0.2, 0.8 );

					}

					break;
				case 'storm':
					D.shape( a, 1, el.glow, fade, STYLE.storm, 1, a.id );
					break;
				case 'nova': case 'ice': case 'frost':
					D.shape( a, 1, el.glow, fade, STYLE.frost, 1, a.id );
					break;
				case 'dash': {

					const o = a.follow;
					if ( o ) for ( let i = 0; i < 3; i ++ ) P.emit( o.x + rand( - 0.3, 0.3 ), rand( 0.4, 1.5 ), o.z + rand( - 0.3, 0.3 ), - Math.sin( o.facing ) * 3, 0, - Math.cos( o.facing ) * 3, 1.2, 1.1, 1.0, rand( 0.12, 0.25 ), 0.2, 0, 4, 0, 0.04 );
					break;

				}

				default:
					// persistent monster / mechanic hazards: an enemy-coloured pool so it reads as dangerous
					D.shape( a, 1, friendly ? el.glow : ENEMY, fade * 0.7, STYLE.glow, 1, a.id );

			}

		}

	}

	drawEntities( rc, world, dt ) {

		const P = this.particles, M = this.meshes, B = this.halos;
		const budget = this.particles.budget;
		for ( const e of world.entities ) {

			if ( e.kind === 'minion' ) {

				this.drawMinion( rc, world, e );
				if ( ! e.alive ) continue;

			}

			if ( ! e.alive ) continue;
			const h = e.height || 1.6;
			const flags = e.flags;
			// motion trails: a ghostly streak behind a roll, sparks behind a leap
			if ( e.data.dodging || e.y > 0.3 ) {

				const l = rc.lerp( e, tmpL );
				const c = e.data.dodging ? ELEMENTS.spectral.glow : ELEMENTS.physical.glow;
				for ( let i = 0; i < 2; i ++ ) P.emit( l.x + rand( - 0.2, 0.2 ), l.y + rand( 0.3, h * 0.9 ), l.z + rand( - 0.2, 0.2 ), 0, 0.2, 0, c.r * 0.9, c.g * 0.9, c.b * 0.9, rand( 0.18, 0.32 ), 0.22, 0, 2 );

			}

			if ( e.statuses.size ) {

				const l = rc.lerp( e, tmpL );
				for ( const s of e.statuses.values() ) {

					const chance = dt * budget;
					switch ( s.id ) {

						case 'ignite': if ( Math.random() < chance * 26 ) P.emit( l.x + rand( - 0.3, 0.3 ) * e.radius * 2, rand( 0.2, h ), l.z + rand( - 0.3, 0.3 ) * e.radius * 2, 0, rand( 1.5, 3 ), 0, 3, 1.2, 0.3, rand( 0.12, 0.26 ), rand( 0.3, 0.55 ), - 2, 2 ); break;
						case 'chill': if ( Math.random() < chance * 8 ) P.emit( l.x + rand( - 0.5, 0.5 ), rand( 0.3, h ), l.z + rand( - 0.5, 0.5 ), 0, - 0.3, 0, 0.6, 1.4, 2.2, 0.08, 0.6, 0.5, 0.5, 0.8 ); break;
						case 'shock': if ( Math.random() < chance * 12 ) P.emit( l.x + rand( - 0.4, 0.4 ), rand( 0.3, h ), l.z + rand( - 0.4, 0.4 ), rand( - 4, 4 ), rand( - 2, 4 ), rand( - 4, 4 ), 2.2, 1.6, 3.4, 0.05, 0.12, 0, 4, 0.5, 0.08 ); break;
						case 'poison': if ( Math.random() < chance * ( 4 + s.stacks ) ) P.emit( l.x + rand( - 0.4, 0.4 ), rand( 0.2, h ), l.z + rand( - 0.4, 0.4 ), 0, rand( 0.4, 1 ), 0, 0.5, 1.6, 0.3, rand( 0.08, 0.16 ), 0.6, - 0.5, 1 ); break;
						case 'bleed': if ( Math.random() < chance * 7 ) P.emit( l.x + rand( - 0.3, 0.3 ), rand( 0.5, h ), l.z + rand( - 0.3, 0.3 ), rand( - 0.5, 0.5 ), 0, rand( - 0.5, 0.5 ), 1.0, 0.05, 0.08, rand( 0.06, 0.1 ), 0.6, 12, 0.5, 0.9 ); break;
						case 'warcry': case 'rage': case 'haste': case 'fortify': {

							if ( Math.random() < chance * 6 ) {

								const c = elementOf( s.id ).glow;
								P.emit( l.x + rand( - 0.5, 0.5 ), 0.1, l.z + rand( - 0.5, 0.5 ), 0, rand( 1, 2.2 ), 0, c.r * 1.4, c.g * 1.4, c.b * 1.4, rand( 0.06, 0.12 ), 0.7, 0, 1 );

							}

							break;

						}

						case 'ice-armour': {

							const c = ELEMENTS.cold.core;
							for ( let i = 0; i < 3; i ++ ) {

								const ang = rc.time * 2.2 + i * TAU / 3;
								M.crystal.add( l.x + Math.sin( ang ) * 1.0, 1.1 + Math.sin( rc.time * 3 + i ) * 0.15, l.z + Math.cos( ang ) * 1.0, ang, 0.3, 0, 0.55, 0.55, 0.55, c );

							}

							break;

						}

						case 'blade-vortex': {

							const n = s.stacks, rad = ( s.data.radius ?? 2.4 ) * 0.78;
							const c = ELEMENTS.spectral.core;
							for ( let i = 0; i < n; i ++ ) {

								const ang = rc.time * 6.5 + i * TAU / n;
								const bx = l.x + Math.sin( ang ) * rad, bz = l.z + Math.cos( ang ) * rad;
								M.blade.add( bx, 1.0, bz, ang + Math.PI / 2, 0, 0.5, 1.2, 1.2, 1.2, c );
								B.push( bx, 1.0, bz, 0.9, 0.3, 0.8, 1.0, 0.4 );
								if ( Math.random() < dt * 30 ) P.emit( bx, 1.0, bz, 0, 0, 0, 0.6, 1.4, 1.8, 0.12, 0.18, 0, 2 );

							}

							break;

						}

					}

				}

			}

			if ( flags.frozen ) {

				const l = rc.lerp( e, tmpL );
				const c = ELEMENTS.cold.core;
				for ( let i = 0; i < 5; i ++ ) {

					const ang = e.id * 1.7 + i * TAU / 5;
					const r = e.radius * 0.7;
					M.crystal.add( l.x + Math.sin( ang ) * r, h * 0.45, l.z + Math.cos( ang ) * r, ang, 0.35 * Math.sin( i * 2.3 ), 0.4 * Math.cos( i * 1.7 ), e.radius * 1.3, h * 0.55, e.radius * 1.3, c );

				}

			}

			if ( flags.stunned ) {

				const l = rc.lerp( e, tmpL );
				for ( let i = 0; i < 3; i ++ ) {

					const ang = rc.time * 6 + i * TAU / 3;
					B.push( l.x + Math.sin( ang ) * 0.45, h + 0.25 + l.y, l.z + Math.cos( ang ) * 0.45, 0.35, STAR.r * 2, STAR.g * 2, STAR.b * 2, 1 );

				}

			}

			this.recordTrail( rc, e );

		}

	}

	drawMinion( rc, world, e ) {

		const M = this.meshes, B = this.halos;
		const l = rc.lerp( e, tmpL );
		const born = Math.min( 1, ( world.time - ( e.data.born ?? 0 ) ) / 0.25 );
		const out = e.alive ? 1 : Math.max( 0, 1 - ( world.time - ( e.data.deathTime ?? world.time ) ) / 0.45 );
		const k = born * out;
		if ( k <= 0.01 ) return;
		const el = ELEMENTS.spectral;
		tmpC2.copy( el.glow ).multiplyScalar( 0.6 * k );
		const a = e.anim, act = a.state === 'action';
		if ( e.data.minion === 'blade' ) {

			const y = 1.0 + Math.sin( rc.time * 6 + e.id ) * 0.15;
			const pitch = act && a.phase === 'active' ? - 0.25 : 0.15;
			M.blade.add( l.x, y, l.z, l.facing, pitch, Math.sin( rc.time * 9 + e.id ) * 0.3, 1.5 * k, 1.5 * k, 1.5 * k, el.core );
			B.push( l.x, y, l.z, 1.3 * k, el.glow.r, el.glow.g, el.glow.b, 0.5 );
			if ( Math.random() < 0.4 ) this.particles.emit( l.x, y, l.z, 0, 0, 0, el.glow.r, el.glow.g, el.glow.b, 0.14, 0.2, 0, 3 );
			return;

		}

		// spectral warrior: body, head and a sword that follows the action timeline
		const bob = Math.sin( rc.time * 3 + e.id ) * 0.05;
		M.ghost.add( l.x, 0.95 + bob, l.z, l.facing, 0, 0, k, k, k, tmpC2 );
		M.ghostHead.add( l.x + Math.sin( l.facing ) * 0.05, 1.72 + bob, l.z + Math.cos( l.facing ) * 0.05, l.facing, 0, 0, k, k, k, tmpC2 );
		let swing = - 0.3;
		if ( act ) {

			const w = a.phase === 'windup' ? a.t / 0.42 : a.phase === 'active' ? 1 + ( a.t - 0.42 ) / 0.18 : 2;
			swing = w < 1 ? - 0.3 - w * 1.2 : w < 2 ? - 1.5 + ( w - 1 ) * 2.6 : 1.1 - Math.min( 1, ( a.t - 0.6 ) / 0.4 ) * 1.4;

		}

		const side = a.variant ? - 1 : 1;
		const rx = Math.cos( l.facing ) * - 0.38 * side, rz = - Math.sin( l.facing ) * - 0.38 * side;
		M.ghostBlade.add( l.x + rx, 1.15 + bob, l.z + rz, l.facing + side * swing * 0.6, - 0.9 - swing, 0, k, k, k, el.core );

	}

	// weapon trails from the rig's attachment points (creatures feature publishes rc.attach)
	recordTrail( rc, e ) {

		const att = rc.attach?.get?.( e.id );
		if ( ! att || ! att.weaponTip || ! att.weaponBase ) return;
		const a = e.anim;
		const swinging = a.state === 'action' && ( a.phase === 'active' || ( a.phase === 'windup' && a.t > 0.2 ) );
		let tr = this.trails.get( e.id );
		if ( ! swinging && ! tr ) return;
		if ( ! tr ) this.trails.set( e.id, tr = [] );
		if ( swinging ) tr.push( { b: att.weaponBase.clone(), t: att.weaponTip.clone(), time: rc.time, team: e.team } );
		while ( tr.length && rc.time - tr[ 0 ].time > 0.14 ) tr.shift();
		if ( ! tr.length ) this.trails.delete( e.id );

	}

	drawMarks( dt ) {

		const D = this.decals;
		this.marks = this.marks.filter( ( m ) => ( m.age += dt ) < m.life );
		for ( const m of this.marks ) {

			const k = m.age / m.life;
			if ( m.wave ) D.shape( m.d, ease( k ), m.color, m.alpha, STYLE.wave, 1 );
			else D.shape( m.d, 1, m.color, m.alpha * Math.min( 1, ( 1 - k ) * 3 ), m.style, 1, m.d.x * 7.1 + m.d.z );

		}

	}

	drawFlashes( dt ) {

		this.flashes = this.flashes.filter( ( f ) => ( f.age += dt ) < f.life );
		for ( const f of this.flashes ) {

			const k = 1 - f.age / f.life;
			this.halos.push( f.x, f.y, f.z, f.size * ( 1.2 - k * 0.2 ), f.color.r * 2, f.color.g * 2, f.color.b * 2, k * f.alpha );

		}

	}

	drawSpikes( dt ) {

		const c = ELEMENTS.cold.core;
		this.spikes = this.spikes.filter( ( s ) => ( s.age += dt ) < s.life );
		for ( const s of this.spikes ) {

			const k = s.age / s.life;
			const grow = k < 0.15 ? ease( k / 0.15 ) : 1 - Math.max( 0, ( k - 0.6 ) / 0.4 );
			this.meshes.crystal.add( s.x, s.s * 0.5 * grow, s.z, s.yaw, s.tilt, 0, s.s * 0.6 * grow, s.s * grow, s.s * 0.6 * grow, c );

		}

	}

	drawRibbons( rc, world, dt ) {

		const R = this.ribbons;
		R.begin();
		// --- melee crescents
		this.crescents = this.crescents.filter( ( c ) => ( c.age += dt ) < c.life );
		for ( const c of this.crescents ) this.crescent( R, c );
		// --- weapon trails
		for ( const tr of this.trails.values() ) {

			const col = tr[ 0 ]?.team === TEAM.ENEMY ? ELEMENTS.enemy.glow : ELEMENTS.physical.core;
			for ( let i = 1; i < tr.length; i ++ ) {

				const a0 = tr[ i - 1 ], a1 = tr[ i ];
				const k0 = 1 - ( rc.time - a0.time ) / 0.14, k1 = 1 - ( rc.time - a1.time ) / 0.14;
				R.quad( a0.b, a0.t, a1.b, a1.t, col, k0 * 0.8, col, k1 * 0.8 );

			}

		}

		// --- lightning beams
		const cam = rc.camera.position;
		this.beams = this.beams.filter( ( b ) => ( b.age += dt ) < b.life );
		for ( const b of this.beams ) {

			if ( ! b.pts || b.age >= b.next ) {

				b.next = b.age + 0.045;
				b.pts = jag( b );

			}

			const k = 1 - b.age / b.life;
			tmpC.copy( b.color ).multiplyScalar( b.hdr );
			for ( let i = 1; i < b.pts.length; i ++ ) {

				const p0 = b.pts[ i - 1 ], p1 = b.pts[ i ];
				vD.subVectors( p1, p0 );
				vC.addVectors( p0, p1 ).multiplyScalar( 0.5 );
				vS.subVectors( cam, vC ).cross( vD ).normalize();
				for ( const [ w, a ] of [ [ b.width * 3, 0.35 * k ], [ b.width, k ] ] ) {

					vA0.copy( p0 ).addScaledVector( vS, - w / 2 ); vA1.copy( p0 ).addScaledVector( vS, w / 2 );
					vB0.copy( p1 ).addScaledVector( vS, - w / 2 ); vB1.copy( p1 ).addScaledVector( vS, w / 2 );
					R.quad( vA0, vA1, vB0, vB1, tmpC, a, tmpC, a );

				}

			}

		}

		if ( this.warm > 0 ) for ( let i = 0; i < 3; i ++ ) R.v( 0, - 200, 0, 0, 0, 0, 0, 0, 0 );
		R.end();

	}

	// A melee arc: a band between an inner and outer radius sweeping across the swing,
	// brightest at the leading edge, fading behind it.
	crescent( R, c ) {

		const sweep = ease( Math.min( 1, c.age / c.sweep ) );
		const fade = c.age < c.sweep ? 1 : Math.max( 0, 1 - ( c.age - c.sweep ) / ( c.life - c.sweep ) );
		const segs = c.fx === 'spin' ? 28 : 16;
		const tailLen = c.fx === 'spin' ? 0.9 : 0.75;
		tmpC.copy( c.color ).multiplyScalar( c.hdr );
		const rIn = c.range * c.inner, rOut = c.range * 1.04;
		const half = c.angle * Math.PI / 360;
		const overhead = c.fx === 'overhead';
		const point = ( s, rad, out, up ) => {

			if ( overhead ) {

				// a vertical arc in the forward / up plane, widened sideways
				const th = 1.9 - s * 2.3;
				const fx = Math.sin( c.dir ), fz = Math.cos( c.dir );
				const r = c.range * 0.75;
				const side = ( rad === rIn ? - 1 : 1 ) * 0.28;
				return out.set( c.x + fx * Math.cos( th ) * r + fz * side, c.y + 0.3 + Math.sin( th ) * r * 0.9, c.z + fz * Math.cos( th ) * r - fx * side );

			}

			// variant 0 sweeps right-to-left on screen from the hero's left; variant 1 the other way
			const a = c.variant === 1 ? c.dir - half + s * 2 * half : c.dir + half - s * 2 * half;
			const tilt = ( c.variant === 1 ? 1 : - 1 ) * ( s - 0.5 ) * 0.5;
			return out.set( c.x + Math.sin( a ) * rad, c.y + up + tilt * ( rad / c.range ), c.z + Math.cos( a ) * rad );

		};

		for ( let i = 0; i < segs; i ++ ) {

			const s0 = i / segs;
			if ( s0 > sweep ) break;
			const s1 = Math.min( ( i + 1 ) / segs, sweep );
			const a0 = Math.pow( Math.max( 0, 1 - ( sweep - s0 ) / tailLen ), 1.6 ) * fade * c.alpha;
			const a1 = Math.pow( Math.max( 0, 1 - ( sweep - s1 ) / tailLen ), 1.6 ) * fade * c.alpha;
			point( s0, rIn, vA0, 0.08 ); point( s0, rOut, vA1, - 0.12 );
			point( s1, rIn, vB0, 0.08 ); point( s1, rOut, vB1, - 0.12 );
			R.quad( vA0, vA1, vB0, vB1, tmpC, a0, tmpC, a1, s0, s1, 0.2 );

		}

	}

	// Touch / gamepad skill aiming preview ( game.input.touchAim, set by the input layer)
	drawTouchAim( rc, world ) {

		const t = world.input?.touchAim, p = world.player;
		if ( ! t || ! t.active || ! p ) return;
		const skill = get( 'skill', t.skill );
		const el = elementOf( skill?.element );
		const dx = t.x - p.x, dz = t.z - p.z, d = Math.hypot( dx, dz ) || 1;
		const dir = Math.atan2( dx, dz );
		if ( skill?.range ) {

			const r = Math.min( d, skill.range );
			this.decals.shape( { x: p.x + dx / d * r, z: p.z + dz / d * r, shape: 'circle', radius: 1.6 }, 1, el.glow, 0.9, STYLE.target, 1 );

		}

		this.decals.shape( { x: p.x, z: p.z, shape: 'line', dir, length: Math.min( 12, skill?.range ?? 9 ), width: 0.5 }, 1, el.glow, 0.5, STYLE.target, 1 );

	}

}

// A random point inside an area's shape (particles for burning ground, debris...).
function randomIn( a ) {

	if ( a.shape === 'line' ) {

		const t = Math.random() * a.length, s = ( Math.random() - 0.5 ) * a.width;
		const fx = Math.sin( a.dir ), fz = Math.cos( a.dir );
		return { x: a.x + fx * t + fz * s, z: a.z + fz * t - fx * s };

	}

	const inner = a.shape === 'ring' ? a.inner : 0;
	const r = Math.sqrt( inner * inner / ( a.radius * a.radius ) + Math.random() * ( 1 - inner * inner / ( a.radius * a.radius ) ) ) * a.radius;
	const ang = a.shape === 'cone' ? a.dir + ( Math.random() - 0.5 ) * a.angle * Math.PI / 180 : Math.random() * TAU;
	return { x: a.x + Math.sin( ang ) * r, z: a.z + Math.cos( ang ) * r };

}

// Lightning: a jagged polyline between the beam's ends (re-rolled every few frames).
function jag( b ) {

	const dx = b.x2 - b.x1, dy = b.y2 - b.y1, dz = b.z2 - b.z1;
	const len = Math.hypot( dx, dy, dz );
	const n = Math.max( 3, Math.min( 18, Math.round( len / 0.8 ) ) );
	const amp = Math.min( 0.7, len * 0.08 );
	const pts = [];
	for ( let i = 0; i <= n; i ++ ) {

		const t = i / n, k = Math.sin( t * Math.PI ) * amp;
		pts.push( new THREE.Vector3(
			b.x1 + dx * t + ( i && i < n ? rand( - 1, 1 ) * k : 0 ),
			b.y1 + dy * t + ( i && i < n ? rand( - 1, 1 ) * k : 0 ),
			b.z1 + dz * t + ( i && i < n ? rand( - 1, 1 ) * k : 0 ) ) );

	}

	return pts;

}

define( 'renderSystem', { id: 'combat-fx', order: 40,
	init( rc ) {

		rc.combatFx = new CombatFx( rc );

	},
	onWorld( rc, world, game ) {

		rc.combatFx.attach( world, game );

	},
	update( rc, world, alpha, dt ) {

		rc.combatFx.update( rc, world, alpha, dt );

	}
} );
