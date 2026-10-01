// Nameplates: name, affixes and a life bar floating over rare and unique monsters
// (and illusions of them - the Mirror Image affix copies the plate, on purpose).
// DOM elements positioned every frame by projecting the head position with the
// game camera; a small pool keyed by entity id, so a level with a dozen elites
// costs a dozen absolutely positioned divs and nothing else.

import * as THREE from 'three/webgpu';
import { define, get } from '../../../core/registry.js';
import { h } from '../../../ui/shell.js';

const SHOWN = new Set( [ 'rare', 'unique' ] );
const v = new THREE.Vector3();
const L = { x: 0, y: 0, z: 0, facing: 0 };

define( 'uiPanel', { id: 'monster-plates', order: 14,
	mount() {

		document.head.append( h( 'style', { text: CSS } ) );
		this.el = h( 'div', { class: 'mplates' } );
		this.pool = new Map(); // entity id -> { el, name, aff, life, shield, key }
		return this.el;

	},
	update( ui, game ) {

		const w = game.world, rc = game.rc;
		const seen = new Set();
		if ( w && rc && w.kind === 'level' ) {

			const cam = rc.camera, W = innerWidth, H = innerHeight;
			for ( const e of w.entities ) {

				if ( ! e.alive || e.data.hidden || ! SHOWN.has( e.model?.rarity ) ) continue;
				const l = rc.lerp( e, L );
				v.set( l.x, l.y + e.height * 1.1 + 0.35, l.z ).project( cam );
				if ( v.z > 1 || v.x < - 1.1 || v.x > 1.1 || v.y < - 1.1 || v.y > 1.1 ) continue;
				seen.add( e.id );
				const p = this.plate( e );
				p.el.style.transform = `translate3d(${( ( v.x + 1 ) / 2 * W ).toFixed( 1 )}px, ${( ( 1 - v.y ) / 2 * H ).toFixed( 1 )}px, 0) translate(-50%, -100%)`;
				const max = Math.max( 1, e.maxLife );
				p.life.style.transform = `scaleX(${Math.max( 0, e.life / max ).toFixed( 3 )})`;
				p.shield.style.transform = `scaleX(${Math.min( 1, e.shield / max ).toFixed( 3 )})`;

			}

		}

		for ( const [ id, p ] of this.pool ) if ( ! seen.has( id ) ) {

			p.el.remove();
			this.pool.delete( id );

		}

	},
	plate( e ) {

		let p = this.pool.get( e.id );
		if ( p ) return p;
		const life = h( 'i' ), shield = h( 'b' );
		const affixes = ( e.data.affixes || [] ).map( ( id ) => get( 'monsterAffix', id )?.name ).filter( Boolean ).join( ' · ' );
		const el = h( 'div', { class: 'mplate ' + e.model.rarity },
			h( 'div', { class: 'nm', text: e.name } ),
			affixes ? h( 'div', { class: 'af', text: affixes } ) : null,
			h( 'div', { class: 'lb' }, life, shield ) );
		this.el.append( el );
		p = { el, life, shield };
		this.pool.set( e.id, p );
		return p;

	}
} );

const CSS = `
.mplates { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
.mplate { position: absolute; left: 0; top: 0; text-align: center; white-space: nowrap; font-size: 12px; font-weight: 700; line-height: 1.15;
	text-shadow: 0 1px 2px #000, 0 0 5px #000; will-change: transform; }
.mplate .af { font-size: 10px; font-weight: 500; color: #d8dce6; opacity: 0.9; }
.mplate .lb { position: relative; width: 86px; height: 6px; margin: 3px auto 0; background: rgba(0, 0, 0, 0.7); border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 3px; overflow: hidden; }
.mplate .lb i, .mplate .lb b { position: absolute; inset: 0; transform-origin: left center; }
.mplate .lb i { background: linear-gradient(#ea4a4a, #8c1c1c); }
.mplate .lb b { background: rgba(150, 200, 255, 0.6); }
.mplate.rare .nm { color: var(--rare); }
.mplate.unique .nm { color: var(--unique); }
.mplate.unique .lb { width: 110px; }
`;
