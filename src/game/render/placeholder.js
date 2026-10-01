// Placeholder renderers: grey-box versions of the level, entities, effects and
// camera, so the game is playable before (and without) the real presentation
// systems. A real renderer takes over by registering the same render-system id
// ('camera', 'level') or, for entities, a 'modelType' def for the model.type it
// draws ( define( 'modelType', { id: 'creature' } ) ) - the placeholder then skips
// those entities.

import * as THREE from 'three/webgpu';
import { define, get } from '../core/registry.js';
import { TILE } from '../core/layout.js';
import { TEAM } from '../core/tuning.js';

const MAX = 4096;
const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3(), tmpC = new THREE.Color();
const UP = new THREE.Vector3( 0, 1, 0 );

define( 'renderSystem', { id: 'camera', order: 5,
	init( rc ) {

		rc.camTarget = new THREE.Vector3();

	},
	update( rc, world, alpha, dt ) {

		const p = world.player;
		if ( ! p ) return;
		const l = rc.lerp( p );
		const k = 1 - Math.exp( - 10 * dt );
		rc.camTarget.x += ( l.x - rc.camTarget.x ) * k;
		rc.camTarget.z += ( l.z - rc.camTarget.z ) * k;
		rc.camera.position.set( rc.camTarget.x, 24, rc.camTarget.z + 17 );
		rc.camera.lookAt( rc.camTarget.x, 0, rc.camTarget.z );
		rc.sun.position.set( rc.camTarget.x + 12, 30, rc.camTarget.z + 8 );
		rc.sun.target.position.set( rc.camTarget.x, 0, rc.camTarget.z );

	}
} );

define( 'renderSystem', { id: 'level', order: 10,
	onWorld( rc, world ) {

		if ( rc.levelGroup ) {

			rc.scene.remove( rc.levelGroup );
			rc.levelGroup.traverse( ( o ) => o.geometry?.dispose() );

		}

		const L = world.layout, g = new THREE.Group();
		const floors = [], walls = [];
		for ( let tz = 0; tz < L.h; tz ++ ) for ( let tx = 0; tx < L.w; tx ++ ) {

			const t = L.get( tx, tz );
			if ( t === TILE.WALL ) walls.push( [ tx, tz, t ] );
			else if ( t !== TILE.VOID && t !== TILE.PIT ) floors.push( [ tx, tz, t ] );

		}

		const mk = ( list, h, y, colorOf ) => {

			const mesh = new THREE.InstancedMesh( new THREE.BoxGeometry( L.cell, h, L.cell ), new THREE.MeshStandardNodeMaterial( { roughness: 0.9 } ), Math.max( 1, list.length ) );
			list.forEach( ( [ tx, tz, t ], i ) => {

				const [ x, z ] = L.toWorld( tx, tz );
				mesh.setMatrixAt( i, tmpM.makeTranslation( x, y, z ) );
				mesh.setColorAt( i, tmpC.set( colorOf( t, tx, tz ) ) );

			} );
			mesh.count = list.length;
			mesh.receiveShadow = true;
			mesh.castShadow = h > 1;
			g.add( mesh );

		};

		const FLOOR = { [ TILE.FLOOR ]: 0x4a4740, [ TILE.WATER ]: 0x24486a, [ TILE.LAVA ]: 0xd2501e, [ TILE.ICE ]: 0x9cc9e6, [ TILE.BRIDGE ]: 0x6b4a2e, [ TILE.DOOR ]: 0x5a4632 };
		mk( floors, 0.2, - 0.1, ( t, tx, tz ) => ( FLOOR[ t ] ?? 0x4a4740 ) + ( ( tx + tz ) % 2 ? 0x050505 : 0 ) );
		mk( walls, 3, 1.5, () => 0x5b5f6b );
		rc.scene.add( g );
		rc.levelGroup = g;

	}
} );

define( 'renderSystem', { id: 'placeholder-entities', order: 20,
	init( rc ) {

		const geo = new THREE.CylinderGeometry( 0.5, 0.5, 1, 10 ).translate( 0, 0.5, 0 );
		const mesh = new THREE.InstancedMesh( geo, new THREE.MeshStandardNodeMaterial( { roughness: 0.6 } ), MAX );
		mesh.castShadow = true;
		mesh.frustumCulled = false;
		mesh.count = 0;
		rc.scene.add( mesh );
		const nose = new THREE.InstancedMesh( new THREE.ConeGeometry( 0.2, 0.5, 6 ).rotateX( Math.PI / 2 ), new THREE.MeshStandardNodeMaterial( { color: 0xffffff } ), MAX );
		nose.frustumCulled = false;
		nose.count = 0;
		rc.scene.add( nose );
		this.mesh = mesh; this.nose = nose;
		this.l = { x: 0, y: 0, z: 0, facing: 0 };

	},
	update( rc, world ) {

		let n = 0;
		for ( const e of world.entities ) {

			if ( e.model && get( 'modelType', e.model.type ) ) continue;
			if ( n >= MAX ) break;
			const l = rc.lerp( e, this.l );
			const dead = ! e.alive;
			const h = dead ? 0.15 : e.height;
			tmpQ.setFromAxisAngle( UP, l.facing );
			this.mesh.setMatrixAt( n, tmpM.compose( tmpP.set( l.x, l.y, l.z ), tmpQ, tmpS.set( e.radius * 2, h, e.radius * 2 ) ) );
			const col = e.kind === 'player' ? 0xffd23f : e.kind === 'npc' ? 0x7ad0ff : e.kind === 'loot' ? 0xffffff : e.kind === 'prop' ? 0x8a6a48 : e.team === TEAM.ENEMY ? ( e.kind === 'boss' ? 0xb02bd8 : 0xc0392b ) : 0x9aa0a6;
			const flash = world.time - e.anim.hitTime < 0.08 ? 0.6 : 0;
			this.mesh.setColorAt( n, tmpC.set( col ).lerp( new THREE.Color( 1, 1, 1 ), flash ) );
			this.nose.setMatrixAt( n, tmpM.compose( tmpP.set( l.x + Math.sin( l.facing ) * e.radius, l.y + h * 0.75, l.z + Math.cos( l.facing ) * e.radius ), tmpQ, tmpS.set( 1, 1, 1 ) ) );
			n ++;

		}

		this.mesh.count = n; this.nose.count = n;
		this.mesh.instanceMatrix.needsUpdate = true;
		if ( this.mesh.instanceColor ) this.mesh.instanceColor.needsUpdate = true;
		this.nose.instanceMatrix.needsUpdate = true;

	}
} );

define( 'renderSystem', { id: 'placeholder-fx', order: 30,
	init( rc ) {

		const ball = new THREE.InstancedMesh( new THREE.IcosahedronGeometry( 0.25, 0 ), new THREE.MeshBasicNodeMaterial(), 1024 );
		const ring = new THREE.InstancedMesh( new THREE.RingGeometry( 0.9, 1, 32 ).rotateX( - Math.PI / 2 ), new THREE.MeshBasicNodeMaterial( { transparent: true, opacity: 0.5, depthWrite: false } ), 512 );
		for ( const m of [ ball, ring ] ) {

			m.frustumCulled = false;
			m.count = 0;
			rc.scene.add( m );

		}

		this.ball = ball; this.ring = ring;

	},
	update( rc, world ) {

		let n = 0;
		for ( const p of world.projectiles ) {

			if ( n >= 1024 ) break;
			this.ball.setMatrixAt( n, tmpM.compose( tmpP.set( p.x, p.y, p.z ), tmpQ.identity(), tmpS.setScalar( p.size * p.radius * 3 ) ) );
			this.ball.setColorAt( n, tmpC.set( p.color ?? ( p.team === TEAM.PLAYER ? 0x8fe3ff : 0xff7a3a ) ) );
			n ++;

		}

		this.ball.count = n;
		let m = 0;
		for ( const a of world.areas ) {

			if ( m >= 512 ) break;
			const telegraph = a.age < a.delay;
			const r = a.shape === 'line' ? a.length / 2 : a.radius;
			this.ring.setMatrixAt( m, tmpM.compose( tmpP.set( a.x, 0.05, a.z ), tmpQ.identity(), tmpS.set( r, 1, r ) ) );
			this.ring.setColorAt( m, tmpC.set( telegraph ? 0xff3030 : a.color ?? ( a.team === TEAM.PLAYER ? 0x9ad7ff : 0xffa040 ) ) );
			m ++;

		}

		this.ring.count = m;
		for ( const mesh of [ this.ball, this.ring ] ) {

			mesh.instanceMatrix.needsUpdate = true;
			if ( mesh.instanceColor ) mesh.instanceColor.needsUpdate = true;

		}

	}
} );
