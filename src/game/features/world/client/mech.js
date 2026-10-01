// Render system 'world-mech': everything level-mechanic that moves or changes.
//
//   1. MECH OBJECTS - entities with model { type: 'mech', id } (kegs, braziers,
//      pylons, rifts, wells, shrines, vents, hives, the exit portal, the waypoint,
//      the stash, the training dummy). One instanced draw per id, baked from the
//      'mech-<id>' part list; each instance's glow follows the object's state
//      (a lit fuse blinks faster as it burns down, a brazier flares when lit).
//   2. MECHANIC VIEWS - per active mechanic, built on world start from its
//      sim state ( world.state.mech[ id ].state ) and updated every frame: spikes,
//      beams, rift swirls, magma, chrono dials, miasma fog... ( views.js )
//   3. FEEDBACK - 'mechanic' events become bursts, rings and light flashes (fx.js).
//
// It only READS the simulation (the golden rule): states come from entity data and
// mechanic ctx.state, never the other way round.

import * as THREE from 'three/webgpu';
import { define, get } from '../../../core/registry.js';
import { bakeModel } from './bake.js';
import { propMaterial } from './materials.js';
import { setGlow, cachedMaterial } from './level.js';
import { MechFX } from './fx.js';
import { buildViews } from './views.js';

define( 'modelType', { id: 'mech' } );

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler();
const pose = { x: 0, y: 0, z: 0, facing: 0 }; // interpolated entity pose (reused)

// Per object id: glow ( 0..~1.5 ), extra lift / wobble, and an optional light.
const LOOK = {
	keg( e, t ) {

		if ( ! e.data.lit ) return { glow: 0.15 };
		const left = Math.max( 0, e.data.fuse );
		const blink = Math.sin( t * ( 10 + ( 1.6 - left ) * 30 ) ) > 0 ? 1.6 : 0.4;
		return { glow: blink, wobble: 0.12, light: { color: '#ffb040', intensity: 14 * blink, range: 5, y: 1.3 } };

	},
	brazier: ( e ) => e.data.lit ? { glow: 1.4, light: { color: '#ffa040', intensity: 46, range: e.data.radius ?? 10, y: 1.8, flicker: 0.3 }, flame: 1 } : { glow: 0.1 },
	pylon: ( e, t, ctx ) => {

		const on = ctx?.state.beams?.some( ( b ) => b.on && ( b.a === e || b.b === e ) );
		return { glow: on ? 1.3 + Math.sin( t * 30 ) * 0.3 : 0.25, light: on ? { color: '#8ad8ff', intensity: 16, range: 7, y: 2.8 } : null };

	},
	rift: ( e ) => ( { glow: 1, light: { color: e.data.color, intensity: 18, range: 7, y: 1.4 } } ),
	well: ( e, t ) => ( { glow: e.data.stage === 'pull' ? 1.6 : 0.6 + Math.sin( t * 2 ) * 0.2, spin: e.data.stage === 'pull' ? 6 : 1, light: { color: '#a070ff', intensity: e.data.stage === 'pull' ? 30 : 10, range: 8, y: 1.6 } } ),
	shrine: ( e, t ) => {

		const ready = ( e.data.readyAt ?? 0 ) <= ( e._worldTime ?? 0 );
		return { glow: ready ? 1 + Math.sin( t * 3 ) * 0.2 : 0.15, light: ready ? { color: '#c8ffe8', intensity: 18, range: 8, y: 2.3 } : null };

	},
	vent: ( e, t ) => ( { glow: 0.7 + Math.sin( t * 2.3 + e.id ) * 0.3 } ),
	hive: ( e, t ) => ( { glow: e.alive ? 0.7 + Math.sin( t * 4 + e.id ) * 0.3 : 0, shrink: e.alive ? 0 : Math.min( 1, ( e._worldTime - ( e.data.deathTime ?? 0 ) ) / 0.8 ) } ),
	portal: ( e, t ) => ( { glow: 1.2 + Math.sin( t * 3 ) * 0.2, light: { color: '#8fd0ff', intensity: 40, range: 10, y: 1.6 } } ),
	waypoint: ( e, t ) => ( { glow: 1 + Math.sin( t * 1.5 ) * 0.15 } ),
	stash: () => ( { glow: 0.6 } ),
	chest: () => ( { glow: 0.8 } ),
	dummy: ( e, t ) => ( { glow: 0, wobble: Math.max( 0, 0.35 - ( e._worldTime - e.anim.hitTime ) ) * 0.6 } )
};

define( 'renderSystem', { id: 'world-mech', order: 22,

	init( rc ) {

		this.groups = new Map(); // id -> { mesh, glow, cap }
		this.root = new THREE.Group();
		this.root.name = 'Mechanics';
		rc.scene.add( this.root );
		this.fx = new MechFX( rc.scene );
		rc.mechFx = this.fx;
		this.views = [];

	},

	onWorld( rc, world ) {

		for ( const g of this.groups.values() ) this.root.remove( g.mesh );

		this.groups.clear();
		for ( const v of this.views ) v.dispose?.();
		this.views = buildViews( rc, world, this.root );
		this.fx.clear();
		const fx = this.fx;
		// mechanic events -> visible feedback
		world.events.on( 'mechanic', ( m ) => onMechanicEvent( fx, m, rc ) );
		world.events.on( 'death', ( d ) => {

			if ( d.entity.model?.id === 'hive' ) {

				fx.burst( { x: d.x, z: d.z, color: '#ff8a20', count: 40, speed: 9, size: 0.45, up: 7 } );
				fx.ring( { x: d.x, z: d.z, color: '#ff8a20', radius: 5, life: 0.7 } );

			}

		} );

	},

	update( rc, world, alpha, dt ) {

		const t = world.time;
		const theme = rc.theme;
		const counts = new Map();
		for ( const e of world.entities ) {

			if ( e.model?.type !== 'mech' ) continue;
			if ( ! e.alive && e.model.id !== 'hive' ) continue;
			if ( ! e.alive && t - ( e.data.deathTime ?? t ) > 0.8 ) continue;
			e._worldTime = t;
			const id = e.model.id;
			let g = this.groups.get( id );
			const n = counts.get( id ) ?? 0;
			if ( ! g || n >= g.cap ) g = this.grow( id, g, theme, Math.max( 16, ( g?.cap ?? 8 ) * 2 ) );
			if ( ! g ) continue;
			const ctx = id === 'pylon' ? world.state.mech?.conduits : null;
			const look = ( LOOK[ id ] || ( () => ( { glow: 1 } ) ) )( e, t, ctx );
			rc.lerp( e, pose );
			const wob = look.wobble ? Math.sin( t * 40 + e.id ) * look.wobble : 0;
			const shrink = 1 - ( look.shrink ?? 0 );
			_e.set( wob, ( id === 'well' ? t * ( look.spin ?? 1 ) : pose.facing ), wob * 0.7 );
			g.mesh.setMatrixAt( n, _m.compose( _p.set( pose.x, pose.y, pose.z ), _q.setFromEuler( _e ), _s.setScalar( Math.max( 0.001, shrink ) ) ) );
			g.glow.setX( n, look.glow );
			counts.set( id, n + 1 );
			if ( look.light ) rc.dynLights.push( { x: pose.x, y: look.light.y ?? 1.5, z: pose.z, color: look.light.color, intensity: look.light.intensity, range: look.light.range, flicker: look.light.flicker } );

		}

		for ( const [ id, g ] of this.groups ) {

			g.mesh.count = counts.get( id ) ?? 0;
			g.mesh.instanceMatrix.needsUpdate = true;
			g.glow.needsUpdate = true;

		}

		for ( const v of this.views ) v.update?.( rc, world, alpha, dt );
		this.fx.update( dt, rc.dynLights );

	},

	grow( id, old, theme, cap ) {

		const def = get( 'model', 'mech-' + id );
		if ( ! def ) return null;
		if ( old ) this.root.remove( old.mesh );

		const geo = bakeModel( def, theme?.palette, 'mech' );
		const mesh = new THREE.InstancedMesh( geo, cachedMaterial( 'prop', propMaterial ), cap );
		const glow = setGlow( mesh, cap, 0, id === 'brazier' || id === 'keg' ? 0.3 : 0.05 );
		mesh.castShadow = id !== 'portal' && id !== 'rift';
		mesh.receiveShadow = true;
		mesh.frustumCulled = false;
		mesh.count = 0;
		this.root.add( mesh );
		const g = { mesh, glow, cap };
		this.groups.set( id, g );
		return g;

	}
} );

// What each mechanic event looks like. Purely cosmetic; ignores unknown events.
function onMechanicEvent( fx, m, rc ) {

	switch ( m.id + ':' + m.event ) {

		case 'powder-keg:explode':
			fx.burst( { x: m.x, z: m.z, color: '#ff8a2a', count: 26, speed: 10, size: 0.4, up: 8 } );
			fx.burst( { x: m.x, z: m.z, color: '#3a2a20', count: 10, speed: 6, size: 0.5, up: 6, emissive: 0 } );
			fx.ring( { x: m.x, z: m.z, color: '#ffb050', radius: 4, life: 0.45 } );
			fx.flash( { x: m.x, z: m.z, color: '#ffa040', intensity: 140, range: 14, life: 0.35 } );
			break;
		case 'lightless:ignite':
			fx.burst( { x: m.x, y: 1.3, z: m.z, color: '#ffb050', count: 18, speed: 4, size: 0.25, up: 6 } );
			fx.ring( { x: m.x, z: m.z, color: '#ffa040', radius: 4, life: 0.6 } );
			break;
		case 'spike-field:impale':
			fx.burst( { x: m.x, y: 0.5, z: m.z, color: '#c8c8d0', count: 6, speed: 3, size: 0.18, up: 5, emissive: 0.2 } );
			break;
		case 'black-ice:slam':
			fx.burst( { x: m.x, y: 0.6, z: m.z, color: '#cfefff', count: 10, speed: 5, size: 0.22, up: 4, emissive: 0.4 } );
			break;
		case 'black-ice:shatter':
			fx.burst( { x: m.x, y: 0.9, z: m.z, color: '#bfefff', count: 30, speed: 11, size: 0.35, up: 5, emissive: 0.6 } );
			fx.ring( { x: m.x, z: m.z, color: '#9fe3ff', radius: 4, life: 0.4 } );
			break;
		case 'conduits:zap':
			fx.burst( { x: m.x, y: 1, z: m.z, color: '#9fe3ff', count: 6, speed: 6, size: 0.15, up: 3 } );
			fx.flash( { x: m.x, z: m.z, color: '#8ad8ff', intensity: 40, range: 6, life: 0.12 } );
			break;
		case 'conduits:surge':
			fx.flash( { x: m.x, z: m.z, color: '#8ad8ff', intensity: 80, range: 14, life: 0.5 } );
			break;
		case 'conduits:arc':
			fx.burst( { x: m.tx, y: 1, z: m.tz, color: '#bff0ff', count: 8, speed: 5, size: 0.2, up: 3 } );
			break;
		case 'rift-gates:warp':
			fx.ring( { x: m.x, z: m.z, color: '#c8a0ff', radius: 2, life: 0.35 } );
			fx.ring( { x: m.tx, z: m.tz, color: '#c8a0ff', radius: 2, life: 0.35 } );
			break;
		case 'gravity-wells:collapse':
			fx.burst( { x: m.x, y: 1.2, z: m.z, color: '#b080ff', count: 22, speed: 8, size: 0.3, up: 3 } );
			fx.ring( { x: m.x, z: m.z, color: '#b080ff', radius: m.radius ?? 3, life: 0.5 } );
			fx.flash( { x: m.x, z: m.z, color: '#a070ff', intensity: 90, range: 12, life: 0.4 } );
			break;
		case 'swarm:kills':
			for ( let i = 0; i < m.positions.length && i < 60; i += 2 ) fx.burst( { x: m.positions[ i ], y: 0.5, z: m.positions[ i + 1 ], color: '#ff9a3a', count: 2, speed: 3, size: 0.14, up: 3, life: 0.5 } );
			break;
		case 'miasma:purge':
			fx.ring( { x: m.x, z: m.z, color: '#c8ffe0', radius: m.radius, life: 0.9, width: 0.3 } );
			fx.flash( { x: m.x, z: m.z, color: '#c8ffe8', intensity: 90, range: 16, life: 0.6 } );
			break;
		case 'chrono-fields:flip':
			fx.ring( { x: m.x, z: m.z, color: m.slow ? '#5ab8ff' : '#ffcf5a', radius: 4.5, life: 0.5, width: 0.25 } );
			break;
		case 'exit:open':
			fx.burst( { x: m.x, y: 1.5, z: m.z, color: '#9fe0ff', count: 40, speed: 6, size: 0.3, up: 8 } );
			fx.ring( { x: m.x, z: m.z, color: '#9fe0ff', radius: 6, life: 1 } );
			fx.flash( { x: m.x, z: m.z, color: '#9fe0ff', intensity: 120, range: 18, life: 1 } );
			break;
		case 'echoes:replay':
			fx.ring( { x: m.x, z: m.z, color: '#7af0ff', radius: 1.4, life: 0.3, width: 0.3 } );
			break;
		default:

	}

}
