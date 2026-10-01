// Loot presentation: a glowing ring under every drop (rarity colour), a light BEAM
// above rare / unique items and valuable orbs, and a real point light on uniques
// (a small pool, nearest drops first) so they light up the floor around them.
// Everything is instanced: two draw calls no matter how much loot is on the ground.
// The drop's own model ( model.type 'loot' ) is drawn by the creatures feature.

import * as THREE from 'three/webgpu';
import { uv, float } from 'three/tsl';
import { define } from '../../../core/registry.js';
import { lootEntities } from '../loot.js';

const MAX = 512;
const LIGHTS = 3; // lights stay in the scene (toggling visibility would recompile materials)
const RING_COLORS = { normal: 0x8a8f99, magic: 0x4f7cff, rare: 0xffd84d, unique: 0xff8a2a, gold: 0xffc830, currency: 0xe8d8a0, rune: 0x50e0c0 };
const BEAM_CURRENCY = new Set( [ 'exalt', 'divine', 'chaos', 'vaal', 'regal', 'annul' ] );
const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), pos = new THREE.Vector3(), col = new THREE.Color();
const L = { x: 0, y: 0, z: 0, facing: 0 };

function kindOf( d ) {

	if ( d.type === 'item' ) return d.item.rarity;
	return d.type === 'gold' ? 'gold' : d.type;

}

define( 'renderSystem', { id: 'prog-loot-beams', order: 35,
	init( rc ) {

		const beamMat = new THREE.MeshBasicNodeMaterial( { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide } );
		// CylinderGeometry's uv.y runs 0 (bottom) -> 1 (top): bright at the floor, fading upward
		beamMat.opacityNode = float( 1 ).sub( uv().y ).pow( 1.6 ).mul( 0.55 );
		const beam = new THREE.InstancedMesh( new THREE.CylinderGeometry( 0.12, 0.2, 1, 10, 1, true ).translate( 0, 0.5, 0 ), beamMat, MAX );
		const ringMat = new THREE.MeshBasicNodeMaterial( { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending } );
		ringMat.opacityNode = float( 0.75 );
		const ring = new THREE.InstancedMesh( new THREE.RingGeometry( 0.32, 0.46, 24 ).rotateX( - Math.PI / 2 ), ringMat, MAX );
		for ( const mesh of [ beam, ring ] ) {

			mesh.frustumCulled = false;
			mesh.setColorAt( 0, col.setHex( 0xffffff ) ); // create instanceColor before the material compiles
			mesh.count = 0;
			mesh.renderOrder = 5;
			rc.scene.add( mesh );

		}

		this.beam = beam; this.ring = ring;
		this.lights = [];
		for ( let i = 0; i < LIGHTS; i ++ ) {

			const l = new THREE.PointLight( 0xff8a2a, 0, 7, 2 );
			rc.scene.add( l );
			this.lights.push( l );

		}

	},
	update( rc, world ) {

		const t = rc.time;
		let nb = 0, nr = 0;
		const uniques = [];
		const p = world.player;
		for ( const e of lootEntities( world ) ) {

			if ( nr >= MAX ) break;
			const d = e.data.loot;
			const k = kindOf( d );
			rc.lerp( e, L );
			const pulse = 1 + Math.sin( t * 4 + e.id ) * 0.08;
			col.setHex( RING_COLORS[ k ] ?? 0xffffff );
			this.ring.setMatrixAt( nr, m.compose( pos.set( L.x, 0.04, L.z ), q.identity(), s.set( pulse, 1, pulse ) ) );
			this.ring.setColorAt( nr, col );
			nr ++;
			const tall = k === 'unique' ? 7 : k === 'rare' ? 4.5 : d.type === 'currency' && BEAM_CURRENCY.has( d.currency ) ? 3.5 : d.type === 'rune' ? 3 : 0;
			if ( tall && nb < MAX ) {

				const grow = Math.min( 1, ( world.time - ( e.data.dropTime ?? 0 ) ) * 2.5 );
				this.beam.setMatrixAt( nb, m.compose( pos.set( L.x, 0, L.z ), q.identity(), s.set( 1, tall * grow, 1 ) ) );
				this.beam.setColorAt( nb, col.multiplyScalar( k === 'unique' ? 1.4 : 1 ) );
				nb ++;

			}

			if ( k === 'unique' ) uniques.push( { e, x: L.x, z: L.z, d: p ? Math.hypot( L.x - p.x, L.z - p.z ) : 0 } );

		}

		this.ring.count = nr; this.beam.count = nb;
		for ( const mesh of [ this.ring, this.beam ] ) {

			mesh.instanceMatrix.needsUpdate = true;
			if ( mesh.instanceColor ) mesh.instanceColor.needsUpdate = true;

		}

		uniques.sort( ( a, b ) => a.d - b.d );
		this.lights.forEach( ( l, i ) => {

			const u = uniques[ i ];
			if ( ! u ) {

				l.intensity = 0;
				return;

			}

			l.position.set( u.x, 1.2, u.z );
			l.intensity = 6 + Math.sin( t * 3 + i ) * 1.5;

		} );

	}
} );
