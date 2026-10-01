// Floating damage numbers: pooled, drawn as glyph quads from a canvas atlas in one
// draw (billboards.js). Crits are bigger, yellow-tinged and punch in; colour follows
// the dominant damage type; damage taken by the player is red; damage over time is
// small and dim. Rapid hits on one target merge into one rising number instead of
// a wall of digits (whirlwind, blade vortex, poison stacks).

import * as THREE from 'three/webgpu';
import { Billboards } from './billboards.js';
import { elementOf } from './palette.js';

const GLYPHS = '0123456789.kMB+!' + 'EVADLOCKIUNSHTR ';
const COLS = 16, ROWS = 2, CELL = 64;
const index = new Map( [ ...GLYPHS ].map( ( c, i ) => [ c, i ] ) );

function makeAtlas() {

	const cv = document.createElement( 'canvas' );
	cv.width = COLS * CELL; cv.height = ROWS * CELL;
	const g = cv.getContext( '2d' );
	g.font = `900 ${CELL * 0.78}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
	g.textAlign = 'center';
	g.textBaseline = 'middle';
	g.lineJoin = 'round';
	[ ...GLYPHS ].forEach( ( c, i ) => {

		const x = ( i % COLS + 0.5 ) * CELL, y = ( Math.floor( i / COLS ) + 0.54 ) * CELL;
		g.lineWidth = CELL * 0.16;
		g.strokeStyle = 'rgba(0,0,0,0.9)';
		g.strokeText( c, x, y );
		g.fillStyle = '#fff';
		g.fillText( c, x, y );

	} );
	const tex = new THREE.CanvasTexture( cv );
	tex.colorSpace = THREE.SRGBColorSpace;
	tex.generateMipmaps = true;
	tex.minFilter = THREE.LinearMipmapLinearFilter;
	return tex;

}

export function formatNumber( v ) {

	if ( v < 10 && v > 0 && v % 1 !== 0 && v < 1 ) return v.toFixed( 1 );
	if ( v < 1000 ) return String( Math.round( v ) );
	if ( v < 1e6 ) return ( v / 1e3 ).toFixed( v < 1e4 ? 1 : 0 ) + 'k';
	if ( v < 1e9 ) return ( v / 1e6 ).toFixed( v < 1e7 ? 1 : 0 ) + 'M';
	return ( v / 1e9 ).toFixed( 1 ) + 'B';

}

const tmpC = new THREE.Color();
const WHITE = new THREE.Color( 1, 1, 1 ), CRIT = new THREE.Color( '#ffe45a' ), HURT = new THREE.Color( '#ff4040' );

export class DamageNumbers {

	constructor( scene, max = 160 ) {

		this.max = max;
		this.list = [];
		this.quads = new Billboards( scene, max * 8, { blending: THREE.NormalBlending, atlas: makeAtlas(), cols: COLS, rows: ROWS, depthTest: false, renderOrder: 30 } );
		this.scale = 1;

	}

	// kind: 'hit' | 'crit' | 'dot' | 'hurt' | 'text'
	add( x, y, z, value, element, kind = 'hit', entityId = 0, text = null ) {

		if ( kind !== 'text' && value < 0.5 ) return;
		// merge rapid small hits on one target
		if ( kind === 'hit' || kind === 'dot' ) {

			for ( const n of this.list ) {

				if ( n.entityId === entityId && n.kind === kind && n.age < ( kind === 'dot' ? 0.5 : 0.14 ) && entityId ) {

					n.value += value;
					n.text = formatNumber( n.value );
					n.age = Math.min( n.age, 0.05 );
					n.punch = 0.25;
					return;

				}

			}

		}

		if ( this.list.length >= this.max ) this.list.shift();
		const el = elementOf( element );
		const col = new THREE.Color( el.text );
		if ( kind === 'crit' ) col.lerp( CRIT, 0.55 );
		if ( kind === 'hurt' ) col.copy( HURT );
		if ( kind === 'dot' ) col.multiplyScalar( 0.85 );
		if ( kind === 'text' ) col.set( element === 'evade' ? '#bfe6ff' : '#e0e0e0' );
		const side = ( Math.random() - 0.5 ) * 1.6;
		this.list.push( {
			x, y, z, vx: side, vy: kind === 'dot' ? 1.2 : 5.2 + Math.random(), vz: 0,
			age: 0, life: kind === 'crit' ? 1.15 : kind === 'dot' ? 0.8 : 0.9,
			value, text: text ?? formatNumber( value ) + ( kind === 'crit' ? '!' : '' ), color: col, kind, entityId,
			size: kind === 'crit' ? 0.95 : kind === 'dot' ? 0.4 : kind === 'hurt' ? 0.6 : kind === 'text' ? 0.45 : 0.56, punch: kind === 'crit' ? 0.9 : 0.4
		} );

	}

	update( dt, camScale, warm = false ) {

		const q = this.quads;
		q.begin();
		this.list = this.list.filter( ( n ) => ( n.age += dt ) < n.life );
		for ( const n of this.list ) {

			// pop up, decelerate, drift sideways a little
			n.vy -= 11 * dt;
			if ( n.vy < 0.4 ) n.vy = 0.4;
			n.x += n.vx * dt; n.y += n.vy * dt; n.z += n.vz * dt;
			n.vx *= Math.exp( - 3 * dt );
			n.punch = Math.max( 0, n.punch - dt * 5 );
			const k = n.age / n.life;
			const a = k < 0.7 ? 1 : 1 - ( k - 0.7 ) / 0.3;
			const s = n.size * ( 1 + n.punch ) * camScale * this.scale;
			const len = n.text.length;
			tmpC.copy( n.color ).lerp( WHITE, n.punch * 0.5 );
			for ( let i = 0; i < len; i ++ ) {

				const g = index.get( n.text[ i ] );
				if ( g === undefined || n.text[ i ] === ' ' ) continue;
				q.push( n.x, n.y, n.z, s, tmpC.r, tmpC.g, tmpC.b, a, g, 0, 1, ( i - ( len - 1 ) / 2 ) * 0.56 );

			}

		}

		if ( warm ) q.push( 0, - 200, 0, 0.001, 0, 0, 0, 0 ); // compile the pipeline at load
		q.end();

	}

}
