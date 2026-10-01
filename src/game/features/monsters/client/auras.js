// Elite tells on the ground: a ring under every magic / rare / unique monster and
// boss in its rarity colour, small pips orbiting its head in its affix colours, and
// a dust ring over burrowed / vanished monsters so you can track what is coming
// (an unseen threat must still be readable). Two instanced draws for the whole
// level; the creature renderer adds glow / tint on the body from model.glow / tint.

import * as THREE from 'three/webgpu';
import { define } from '../../../core/registry.js';
import { RARITY_COLOR } from '../util.js';

const MAX = 512, PIPS = 1024;
const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
const L = { x: 0, y: 0, z: 0, facing: 0 };
const DUST = '#a0805a';

define( 'renderSystem', { id: 'monster-auras', order: 26,
	init( rc ) {

		const mat = new THREE.MeshBasicNodeMaterial( { transparent: true, opacity: 0.85, depthWrite: false } );
		this.ring = new THREE.InstancedMesh( new THREE.RingGeometry( 0.82, 1, 40 ).rotateX( - Math.PI / 2 ), mat, MAX );
		this.pips = new THREE.InstancedMesh( new THREE.OctahedronGeometry( 0.11, 0 ), new THREE.MeshBasicNodeMaterial(), PIPS );
		for ( const m of [ this.ring, this.pips ] ) {

			// create the per-instance colour attribute now: a node material compiled
			// before instanceColor exists would ignore it for good
			m.setColorAt( 0, c.set( '#ffffff' ) );
			m.frustumCulled = false;
			m.count = 0;
			m.renderOrder = 2;
			rc.scene.add( m );

		}

	},
	update( rc, world ) {

		let n = 0, k = 0;
		const t = rc.time;
		for ( const e of world.entities ) {

			if ( ! e.alive || ( e.kind !== 'monster' && e.kind !== 'boss' ) ) continue;
			const hidden = e.data.hidden;
			const rarity = e.model?.rarity;
			if ( ! hidden && ( ! rarity || rarity === 'normal' ) ) continue;
			if ( n >= MAX ) break;
			const l = rc.lerp( e, L );
			if ( hidden ) {

				// burrowed: a churning dust ring where it is
				const r = e.radius * ( 1.1 + 0.12 * Math.sin( t * 9 + e.id ) );
				this.ring.setMatrixAt( n, m4.compose( p.set( l.x, 0.04, l.z ), q.identity(), s.set( r, 1, r ) ) );
				this.ring.setColorAt( n ++, c.set( DUST ) );
				continue;

			}

			const pulse = 0.75 + 0.25 * Math.sin( t * ( rarity === 'boss' ? 2 : 3 ) + e.id );
			const r = e.radius + 0.3;
			this.ring.setMatrixAt( n, m4.compose( p.set( l.x, 0.05, l.z ), q.identity(), s.set( r, 1, r ) ) );
			this.ring.setColorAt( n ++, c.set( e.data.enraged ? '#ff3020' : RARITY_COLOR[ rarity ] || '#ffffff' ).multiplyScalar( pulse ) );
			const aff = e.model.affixes || [];
			for ( let i = 0; i < aff.length && k < PIPS; i ++ ) {

				const a = t * 1.6 + i * Math.PI * 2 / aff.length + e.id;
				const pr = e.radius * 0.8 + 0.25;
				this.pips.setMatrixAt( k, m4.compose( p.set( l.x + Math.sin( a ) * pr, l.y + e.height + 0.35 + 0.08 * Math.sin( t * 4 + i ), l.z + Math.cos( a ) * pr ), q.identity(), s.set( 1, 1, 1 ) ) );
				this.pips.setColorAt( k ++, c.set( aff[ i ].color || '#ffffff' ) );

			}

		}

		this.ring.count = n;
		this.pips.count = k;
		for ( const m of [ this.ring, this.pips ] ) {

			m.instanceMatrix.needsUpdate = true;
			if ( m.instanceColor ) m.instanceColor.needsUpdate = true;

		}

	}
} );
