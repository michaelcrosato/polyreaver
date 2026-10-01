// The rig renderer: draws every hero, creature, NPC, prop and loot entity from
// parts. ONE InstancedMesh per primitive shape (13 draw calls, plus shadows, for the
// whole cast), rebuilt each frame from the posed skeletons:
//
//   for each visible entity:  template ( models.js ) -> animateRig ( animate.js ) ->
//     for each part:  world = boneWorld * partLocal  ->  the shape batch's next slot
//
// Per-instance data: the matrix, a colour (linear, tinted for elites) and `instGlow`
// = emissive rgb + shine (lower roughness: metal, chitin). Hit flash, casting glow
// and the death dissolve are applied here. Everything is typed arrays; nothing is
// allocated per frame. Budget: ~300 rigs x ~30 parts at 60 fps on a mid phone.
//
// Publishes rc.attach = Map( entity id -> { weaponBase, weaponTip, handL, handR,
// head, chest } THREE.Vector3 ) every frame (VFX: weapon trails, cast origins).

import * as THREE from 'three/webgpu';
import { attribute, float } from 'three/tsl';
import { define } from '../../../core/registry.js';
import { SHAPES, PF } from '../rig.js';
import { makeShapeGeometry } from './shapes.js';
import { RigInstance, animateRig, attachKeys } from '../animate.js';
import { templateFor, creatureGenome } from '../models.js';
import { hash01, hexToRgb } from '../math.js';

export const RIG_TYPES = [ 'hero', 'creature', 'npc', 'prop', 'loot' ];
for ( const id of RIG_TYPES ) define( 'modelType', { id } );

const toLin = ( c ) => ( c <= 0.04045 ? c / 12.92 : Math.pow( ( c + 0.055 ) / 1.055, 2.4 ) );

// One shared material: flat-shaded standard PBR, emissive + shine from instGlow.
let material = null;
function rigMaterial() {

	if ( material ) return material;
	material = new THREE.MeshStandardNodeMaterial( { roughness: 0.8, metalness: 0 } );
	const g = attribute( 'instGlow', 'vec4' );
	material.emissiveNode = g.xyz;
	material.roughnessNode = float( 0.82 ).sub( g.w.mul( 0.47 ) );
	material.metalnessNode = g.w.mul( 0.3 );
	return material;

}

class ShapeBatch {

	constructor( scene, shape, capacity ) {

		this.scene = scene;
		this.shape = shape;
		this.base = makeShapeGeometry( shape );
		this.mesh = null;
		this.count = 0;
		this.want = capacity;
		this.alloc( capacity );

	}

	alloc( cap ) {

		if ( this.mesh ) {

			this.scene.remove( this.mesh );
			this.mesh.geometry.dispose();
			this.mesh.dispose();

		}

		const geo = this.base.clone();
		this.glow = new Float32Array( cap * 4 );
		const ga = new THREE.InstancedBufferAttribute( this.glow, 4 );
		ga.setUsage( THREE.DynamicDrawUsage );
		geo.setAttribute( 'instGlow', ga );
		const mesh = new THREE.InstancedMesh( geo, rigMaterial(), cap );
		mesh.instanceMatrix.setUsage( THREE.DynamicDrawUsage );
		mesh.instanceColor = new THREE.InstancedBufferAttribute( new Float32Array( cap * 3 ), 3 );
		mesh.instanceColor.setUsage( THREE.DynamicDrawUsage );
		mesh.castShadow = true;
		mesh.receiveShadow = true;
		mesh.frustumCulled = false;
		mesh.count = 0;
		mesh.name = 'rig-' + this.shape;
		this.mesh = mesh;
		this.cap = cap;
		this.mat = mesh.instanceMatrix.array;
		this.col = mesh.instanceColor.array;
		this.glowAttr = ga;
		this.scene.add( mesh );

	}

	finish() {

		const m = this.mesh, n = Math.min( this.count, this.cap );
		m.count = n;
		if ( n > 0 ) {

			m.instanceMatrix.clearUpdateRanges();
			m.instanceMatrix.addUpdateRange( 0, n * 16 );
			m.instanceMatrix.needsUpdate = true;
			m.instanceColor.clearUpdateRanges();
			m.instanceColor.addUpdateRange( 0, n * 3 );
			m.instanceColor.needsUpdate = true;
			this.glowAttr.clearUpdateRanges();
			this.glowAttr.addUpdateRange( 0, n * 4 );
			this.glowAttr.needsUpdate = true;

		}

		// grow (rarely) when a frame needed more slots than we had
		if ( this.count > this.cap ) this.alloc( Math.ceil( this.count * 1.5 / 256 ) * 256 );
		this.count = 0;

	}

}

// Linear colours of a template, cached on it.
function linearColors( T ) {

	if ( T.lin ) return T.lin;
	const L = new Float32Array( T.pColor.length );
	for ( let i = 0; i < L.length; i ++ ) L[ i ] = toLin( T.pColor[ i ] );
	T.lin = L;
	return L;

}

const _sphere = new THREE.Sphere(), _frustum = new THREE.Frustum(), _pm = new THREE.Matrix4();
const _tint = [ 0, 0, 0 ], _glowC = [ 0, 0, 0 ];
const ATT = attachKeys();

export class RigRenderer {

	constructor( rc ) {

		this.rc = rc;
		this.batches = SHAPES.map( ( s ) => new ShapeBatch( rc.scene, s, s === 'box' || s === 'cyl' || s === 'sphere' ? 4096 : 2048 ) );
		this.insts = new Map();
		this.frame = 0;
		this.time = 0;
		this.ctx = { dt: 0, time: 0, worldTime: 0, x: 0, y: 0, z: 0, facing: 0, size: 1, kind: '', boss: false, player: null, emote: null };
		this.l = { x: 0, y: 0, z: 0, facing: 0 };
		this.playerPos = { x: 0, z: 0 };
		this.stats = { rigs: 0, parts: 0, culled: 0, ms: 0 };
		this.errors = new Set();
		this.crowded = false;
		this.crowdLimit = 140; // visible rigs above which detail parts are dropped
		rc.attach = new Map();
		// the hero marker: the stress test's yellow ring under the player
		const ring = new THREE.Mesh( new THREE.RingGeometry( 0.55, 0.75, 32 ).rotateX( - Math.PI / 2 ), new THREE.MeshBasicNodeMaterial( { color: 0xffd23f, transparent: true, opacity: 0.9, depthWrite: false } ) );
		ring.renderOrder = 2;
		ring.name = 'Hero marker';
		ring.visible = false;
		rc.scene.add( ring );
		this.ring = ring;

	}

	clear() {

		this.insts.clear();
		this.rc.attach.clear();

	}

	// (Re)build the rig instance when the entity's look changed.
	instFor( e ) {

		const m = e.model;
		let inst = this.insts.get( e.id );
		if ( inst && inst.modelRef === m && inst.wRef === m.weapon && inst.gRef === m.gear && inst.genRef === m.genome && inst.idRef === m.id ) return inst;
		let res = null;
		try {

			res = templateFor( m );

		} catch ( err ) {

			const k = m.type + ':' + m.id;
			if ( ! this.errors.has( k ) ) {

				this.errors.add( k );
				console.warn( 'rigs: could not build model', k, err );

			}

		}

		if ( ! res ) res = templateFor( { type: 'prop', id: 'crate' } );
		if ( ! inst || inst.T !== res.T ) {

			const prev = inst;
			inst = new RigInstance( res.T, e.id * 7919 + 13 );
			if ( prev ) {

				inst.phase = prev.phase;
				inst.key = prev.key;

			}

			const v = {};
			for ( const k of ATT ) v[ k ] = new THREE.Vector3();
			inst.attachV = v;
			this.insts.set( e.id, inst );

		}

		inst.modelRef = m; inst.wRef = m.weapon; inst.gRef = m.gear; inst.genRef = m.genome; inst.idRef = m.id;
		inst.emote = m.emote ?? res.emote;
		const g = m.type === 'creature' ? creatureGenome( m ) : null;
		inst.size = ( g ? g.size : 1 ) * ( m.scale ?? 1 );
		inst.tintRef = null;
		return inst;

	}

	update( world, alpha, dt ) {

		const t0 = performance.now();
		const rc = this.rc;
		this.time += dt;
		this.frame ++;
		rc.camera.updateMatrixWorld();
		_pm.multiplyMatrices( rc.camera.projectionMatrix, rc.camera.matrixWorldInverse );
		_frustum.setFromProjectionMatrix( _pm, rc.camera.coordinateSystem );
		const ctx = this.ctx;
		ctx.dt = dt; ctx.time = this.time; ctx.worldTime = world.time;
		const pl = world.player;
		if ( pl ) {

			const l = rc.lerp( pl, this.l );
			this.playerPos.x = l.x; this.playerPos.z = l.z;
			ctx.player = this.playerPos;

		} else ctx.player = null;

		let rigs = 0, parts = 0, culled = 0;
		const seen = this.frame;
		for ( const e of world.entities ) {

			const m = e.model;
			if ( ! m || RIG_TYPES.indexOf( m.type ) < 0 ) continue;
			const inst = this.instFor( e );
			inst.seen = seen;
			const l = rc.lerp( e, this.l );
			const T = inst.T, s = inst.size;
			// cull: skip rigs well outside the view (with a margin for their shadows)
			const d = T.dims;
			_sphere.center.set( l.x, l.y + d.height * 0.5 * s, l.z );
			_sphere.radius = ( Math.max( d.height, d.width, d.length ) * 0.6 + 2.5 ) * s;
			if ( ! _frustum.intersectsSphere( _sphere ) && e !== pl ) {

				culled ++;
				continue;

			}

			ctx.x = l.x; ctx.y = l.y; ctx.z = l.z; ctx.facing = l.facing; ctx.size = s;
			ctx.kind = e.kind; ctx.boss = e.kind === 'boss' || s >= 2; ctx.emote = inst.emote;
			// animation LOD: on crowded screens each rig re-poses every other frame; in
			// between, last frame's skeleton is slid to the new position (cheap, and at
			// 30 Hz per rig the difference is invisible in a horde)
			if ( ! this.crowded || e === pl || ( ( this.frame + e.id ) & 1 ) === 0 || inst.lastX === undefined || inst.dissolve > 0 ) {

				ctx.dt = dt * ( this.crowded && e !== pl && inst.lastX !== undefined ? 2 : 1 );
				animateRig( inst, e, ctx );
				ctx.dt = dt;

			} else {

				const dx = l.x - inst.lastX, dy = l.y - inst.lastY, dz = l.z - inst.lastZ;
				if ( dx !== 0 || dy !== 0 || dz !== 0 ) {

					const W = inst.W, A = inst.attach;
					for ( let b = 0; b < T.nb; b ++ ) {

						W[ b * 12 + 9 ] += dx; W[ b * 12 + 10 ] += dy; W[ b * 12 + 11 ] += dz;

					}

					for ( let i = 0; i < 6; i ++ ) {

						A[ i * 3 ] += dx; A[ i * 3 + 1 ] += dy; A[ i * 3 + 2 ] += dz;

					}

				}

			}

			inst.lastX = l.x; inst.lastY = l.y; inst.lastZ = l.z;
			// detail LOD: crowded screens and far rigs drop their tiny decorations
			const camD = rc.camera.position.distanceTo( _sphere.center );
			parts += this.write( inst, e, world, this.crowded || camD > 34 * s );
			rigs ++;
			const v = inst.attachV, A = inst.attach;
			for ( let i = 0; i < 6; i ++ ) v[ ATT[ i ] ].set( A[ i * 3 ], A[ i * 3 + 1 ], A[ i * 3 + 2 ] );
			if ( rc.attach.get( e.id ) !== v ) rc.attach.set( e.id, v );

		}

		for ( const [ id, inst ] of this.insts ) if ( inst.seen !== seen ) {

			if ( ! world.byId.has( id ) ) {

				this.insts.delete( id );
				rc.attach.delete( id );

			}

		}

		for ( const b of this.batches ) b.finish();
		// hero marker ring
		if ( pl && pl.model ) {

			const l = rc.lerp( pl, this.l );
			this.ring.visible = true;
			this.ring.position.set( l.x, 0.03, l.z );
			this.ring.scale.setScalar( Math.max( 0.8, pl.radius / 0.42 ) );

		} else this.ring.visible = false;

		this.stats.rigs = rigs; this.stats.parts = parts; this.stats.culled = culled;
		this.crowded = rigs > this.crowdLimit;
		this.stats.ms = this.stats.ms * 0.9 + ( performance.now() - t0 ) * 0.1;

	}

	// Parts of one posed rig -> shape batches. Returns the number of parts written.
	write( inst, e, world, lod = false ) {

		const T = inst.T, W = inst.W, L = T.pLocal, np = T.np;
		const lin = linearColors( T );
		const batches = this.batches;
		const m = e.model;
		// elite / rarity hooks: model.tint mixes the colours, model.glow adds a pulsing aura
		let tintK = 0, glowK = 0;
		// ghosts (the Echoes mechanic's replay of the hero): the shared opaque
		// materials cannot fade per instance, so a ghost reads as a strong cyan tint
		const tint = m.tint ?? ( m.ghost ? '#6fe8ff' : null );
		if ( tint ) {

			hexToRgb( tint, _tint );
			for ( let k = 0; k < 3; k ++ ) _tint[ k ] = toLin( _tint[ k ] );
			tintK = m.tintAmount ?? ( m.ghost ? 0.75 : 0.35 );

		}

		if ( m.glow ) {

			const gc = typeof m.glow === 'object' ? m.glow.color : m.glow;
			hexToRgb( gc, _glowC );
			glowK = ( typeof m.glow === 'object' ? m.glow.intensity ?? 0.35 : 0.35 ) * ( 0.7 + 0.3 * Math.sin( this.time * 4 + e.id ) );

		}

		const hitAge = world.time - ( e.anim?.hitTime ?? - 99 );
		const flash = hitAge >= 0 && hitAge < 0.12 ? ( 1 - hitAge / 0.12 ) * 0.9 : 0;
		const glowBoost = inst.glow;
		const dis = inst.dissolve, s = inst.size * inst.extraScale;
		let sc = 1, spread = 0, lift = 0, drop = 0;
		if ( dis > 0 ) {

			const f = dis;
			sc = Math.max( 0, 1 - f * f );
			spread = inst.scatter * s * ( 1 - ( 1 - f ) * ( 1 - f ) );
			lift = inst.scatter > 1.5 ? 1.6 * s * f : 0.15 * s * f;
			drop = ( inst.scatter > 1.5 ? 3.5 : 0.8 ) * s * f * f;
			if ( sc <= 0.001 ) return 0;

		}

		let written = 0;
		for ( let i = 0; i < np; i ++ ) {

			if ( lod && T.pFlags[ i ] & PF.DETAIL ) continue;
			const batch = batches[ T.pShape[ i ] ];
			const k = batch.count ++;
			if ( k >= batch.cap ) continue;
			const b = T.pBone[ i ] * 12, l = i * 12;
			const M = batch.mat, o = k * 16;
			// world = W[ bone ] * local (3x4 * 3x4), written as a column-major 4x4
			const a0 = W[ b ], a1 = W[ b + 1 ], a2 = W[ b + 2 ], a3 = W[ b + 3 ], a4 = W[ b + 4 ], a5 = W[ b + 5 ];
			const a6 = W[ b + 6 ], a7 = W[ b + 7 ], a8 = W[ b + 8 ];
			for ( let c = 0; c < 3; c ++ ) {

				const x = L[ l + c * 3 ], y = L[ l + c * 3 + 1 ], z = L[ l + c * 3 + 2 ];
				M[ o + c * 4 ] = ( a0 * x + a3 * y + a6 * z ) * sc;
				M[ o + c * 4 + 1 ] = ( a1 * x + a4 * y + a7 * z ) * sc;
				M[ o + c * 4 + 2 ] = ( a2 * x + a5 * y + a8 * z ) * sc;
				M[ o + c * 4 + 3 ] = 0;

			}

			const x = L[ l + 9 ], y = L[ l + 10 ], z = L[ l + 11 ];
			let tx = a0 * x + a3 * y + a6 * z + W[ b + 9 ];
			let ty = a1 * x + a4 * y + a7 * z + W[ b + 10 ];
			let tz = a2 * x + a5 * y + a8 * z + W[ b + 11 ];
			if ( dis > 0 ) {

				// each part flies along its own random direction, arcs and falls
				const h = e.id * 131 + i;
				tx += ( hash01( h, 1 ) * 2 - 1 ) * spread;
				tz += ( hash01( h, 3 ) * 2 - 1 ) * spread;
				ty += hash01( h, 2 ) * lift - drop;

			}

			M[ o + 12 ] = tx; M[ o + 13 ] = ty; M[ o + 14 ] = tz; M[ o + 15 ] = 1;
			// colour
			const C = batch.col, co = k * 3, ci = i * 3;
			let r = lin[ ci ], g = lin[ ci + 1 ], bl = lin[ ci + 2 ];
			const flags = T.pFlags[ i ];
			if ( tintK > 0 && ! ( flags & PF.NOTINT ) ) {

				r += ( _tint[ 0 ] - r ) * tintK; g += ( _tint[ 1 ] - g ) * tintK; bl += ( _tint[ 2 ] - bl ) * tintK;

			}

			C[ co ] = r; C[ co + 1 ] = g; C[ co + 2 ] = bl;
			// emissive: own glow (boosted while casting), hit flash, elite aura
			const G = batch.glow, go = k * 4;
			let em = T.pEmis[ i ];
			if ( em > 0 ) em *= 2.2 * ( 1 + glowBoost * 1.5 );
			let er = r * em + flash, eg = g * em + flash, eb = bl * em + flash;
			if ( glowK > 0 ) {

				er += _glowC[ 0 ] * glowK * 0.25; eg += _glowC[ 1 ] * glowK * 0.25; eb += _glowC[ 2 ] * glowK * 0.25;
				if ( em > 0 ) {

					er += _glowC[ 0 ] * glowK; eg += _glowC[ 1 ] * glowK; eb += _glowC[ 2 ] * glowK;

				}

			}

			if ( dis > 0 ) {

				// dissolving parts burn out in their glow colour
				const burn = dis * 1.2;
				er += r * burn; eg += g * burn; eb += bl * burn;

			}

			G[ go ] = er; G[ go + 1 ] = eg; G[ go + 2 ] = eb; G[ go + 3 ] = flags & PF.SHINE ? 1 : 0;
			written ++;

		}

		return written;

	}

}

define( 'renderSystem', { id: 'rigs', order: 20,
	init( rc ) {

		rc.rigs = new RigRenderer( rc );

	},
	onWorld( rc ) {

		rc.rigs.clear();

	},
	update( rc, world, alpha, dt ) {

		rc.rigs.update( world, alpha, dt );

	}
} );
