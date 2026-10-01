// Procedural item icons: no image assets, every icon is a few canvas paths drawn
// once and cached as a data URL ( icon kind + colours = cache key ). Weapons are drawn
// upright and rotated 45 degrees, the classic inventory pose.

import { get } from '../../../core/registry.js';

const cache = new Map();
const SIZE = 64;

const shade = ( hex, k ) => {

	const n = parseInt( hex.slice( 1 ), 16 );
	const c = ( v ) => Math.max( 0, Math.min( 255, Math.round( v * k ) ) );
	return `rgb(${c( n >> 16 )}, ${c( ( n >> 8 ) & 255 )}, ${c( n & 255 )})`;

};

function poly( g, pts, fill, stroke = '#0a0c10' ) {

	g.beginPath();
	pts.forEach( ( [ x, y ], i ) => i ? g.lineTo( x, y ) : g.moveTo( x, y ) );
	g.closePath();
	g.fillStyle = fill;
	g.fill();
	g.lineWidth = 2;
	g.strokeStyle = stroke;
	g.stroke();

}

function circle( g, x, y, r, fill, stroke = '#0a0c10' ) {

	g.beginPath();
	g.arc( x, y, r, 0, Math.PI * 2 );
	g.fillStyle = fill;
	g.fill();
	if ( stroke ) {

		g.lineWidth = 2;
		g.strokeStyle = stroke;
		g.stroke();

	}

}

function rect( g, x, y, w, h, fill ) {

	poly( g, [ [ x, y ], [ x + w, y ], [ x + w, y + h ], [ x, y + h ] ], fill );

}

const WOOD = '#7a5434', LEATHER = '#6b4a30', GRIP = '#3b2a1e';

// weapons are drawn upright around x = 32, from y = 4 (tip) to y = 60 (pommel)
const DRAW = {
	sword( g, c, a ) {

		poly( g, [ [ 32, 4 ], [ 37, 12 ], [ 37, 42 ], [ 27, 42 ], [ 27, 12 ] ], c );
		poly( g, [ [ 32, 6 ], [ 34, 12 ], [ 34, 41 ], [ 32, 41 ] ], shade( c.startsWith( '#' ) ? c : '#cccccc', 1.25 ), 'transparent' );
		rect( g, 20, 42, 24, 5, a );
		rect( g, 29, 47, 6, 10, GRIP );
		circle( g, 32, 59, 3.5, a );

	},
	greatsword( g, c, a ) {

		poly( g, [ [ 32, 2 ], [ 39, 10 ], [ 39, 40 ], [ 25, 40 ], [ 25, 10 ] ], c );
		rect( g, 16, 40, 32, 6, a );
		rect( g, 29, 46, 6, 13, GRIP );
		circle( g, 32, 60, 3, a );

	},
	axe( g, c, a ) {

		rect( g, 30, 8, 5, 52, WOOD );
		poly( g, [ [ 33, 10 ], [ 50, 6 ], [ 54, 18 ], [ 50, 30 ], [ 33, 26 ] ], c );
		rect( g, 29, 9, 7, 6, a );

	},
	greataxe( g, c, a ) {

		rect( g, 30, 4, 5, 58, WOOD );
		poly( g, [ [ 33, 8 ], [ 52, 2 ], [ 57, 18 ], [ 52, 34 ], [ 33, 28 ] ], c );
		poly( g, [ [ 32, 8 ], [ 13, 2 ], [ 8, 18 ], [ 13, 34 ], [ 32, 28 ] ], c );
		rect( g, 28, 14, 9, 8, a );

	},
	mace( g, c, a ) {

		rect( g, 30, 20, 5, 40, WOOD );
		for ( let i = 0; i < 8; i ++ ) {

			const t = i / 8 * Math.PI * 2;
			poly( g, [ [ 32 + Math.cos( t ) * 9, 14 + Math.sin( t ) * 9 ], [ 32 + Math.cos( t + 0.25 ) * 16, 14 + Math.sin( t + 0.25 ) * 16 ], [ 32 + Math.cos( t + 0.5 ) * 9, 14 + Math.sin( t + 0.5 ) * 9 ] ], a );

		}

		circle( g, 32, 14, 10, c );

	},
	maul( g, c, a ) {

		rect( g, 30, 18, 5, 44, WOOD );
		rect( g, 14, 4, 36, 18, c );
		rect( g, 14, 10, 36, 4, a );

	},
	dagger( g, c, a ) {

		poly( g, [ [ 32, 12 ], [ 37, 22 ], [ 36, 42 ], [ 28, 42 ], [ 27, 22 ] ], c );
		rect( g, 23, 42, 18, 4, a );
		rect( g, 29, 46, 6, 10, GRIP );
		circle( g, 32, 58, 3, a );

	},
	spear( g, c, a ) {

		rect( g, 30, 18, 4, 44, WOOD );
		poly( g, [ [ 32, 2 ], [ 38, 14 ], [ 32, 22 ], [ 26, 14 ] ], c );
		rect( g, 28, 20, 8, 4, a );

	},
	wand( g, c, a ) {

		rect( g, 30, 16, 5, 42, WOOD );
		circle( g, 32, 12, 7, a );
		circle( g, 30, 10, 2.5, 'rgba(255,255,255,0.8)', null );

	},
	staff( g, c, a ) {

		rect( g, 30, 12, 5, 50, WOOD );
		poly( g, [ [ 32, 2 ], [ 42, 10 ], [ 32, 20 ], [ 22, 10 ] ], a );
		circle( g, 32, 10, 3, 'rgba(255,255,255,0.85)', null );

	},
	bow( g, c, a ) {

		g.lineWidth = 6;
		g.strokeStyle = '#0a0c10';
		g.beginPath();
		g.arc( 14, 32, 30, - 1.1, 1.1 );
		g.stroke();
		g.lineWidth = 4;
		g.strokeStyle = WOOD;
		g.stroke();
		g.lineWidth = 1.5;
		g.strokeStyle = '#e8e0c8';
		g.beginPath();
		g.moveTo( 14 + Math.cos( - 1.1 ) * 30, 32 + Math.sin( - 1.1 ) * 30 );
		g.lineTo( 14 + Math.cos( 1.1 ) * 30, 32 + Math.sin( 1.1 ) * 30 );
		g.stroke();
		rect( g, 41, 28, 5, 8, a );

	}
};

const ARMOUR = {
	helm( g, c, a ) {

		poly( g, [ [ 12, 40 ], [ 14, 20 ], [ 32, 8 ], [ 50, 20 ], [ 52, 40 ], [ 44, 46 ], [ 40, 30 ], [ 24, 30 ], [ 20, 46 ] ], c );
		rect( g, 30, 8, 4, 24, a );

	},
	chest( g, c, a ) {

		poly( g, [ [ 18, 8 ], [ 26, 12 ], [ 38, 12 ], [ 46, 8 ], [ 58, 18 ], [ 50, 28 ], [ 46, 24 ], [ 46, 56 ], [ 18, 56 ], [ 18, 24 ], [ 14, 28 ], [ 6, 18 ] ], c );
		rect( g, 30, 14, 4, 40, a );

	},
	gloves( g, c, a ) {

		poly( g, [ [ 18, 56 ], [ 18, 30 ], [ 14, 22 ], [ 18, 18 ], [ 24, 26 ], [ 24, 10 ], [ 29, 10 ], [ 30, 24 ], [ 32, 8 ], [ 37, 8 ], [ 37, 24 ], [ 40, 10 ], [ 45, 11 ], [ 44, 26 ], [ 47, 16 ], [ 51, 18 ], [ 46, 38 ], [ 44, 56 ] ], c );
		rect( g, 17, 46, 28, 6, a );

	},
	boots( g, c, a ) {

		poly( g, [ [ 16, 6 ], [ 34, 6 ], [ 34, 40 ], [ 52, 46 ], [ 54, 56 ], [ 14, 56 ] ], c );
		rect( g, 16, 12, 18, 5, a );

	},
	belt( g, c, a ) {

		rect( g, 4, 26, 56, 12, c );
		rect( g, 26, 22, 12, 20, a );
		rect( g, 30, 26, 4, 12, '#0a0c10' );

	},
	amulet( g, c, a ) {

		g.lineWidth = 3;
		g.strokeStyle = '#c9a227';
		g.beginPath();
		g.arc( 32, 22, 18, Math.PI * 0.1, Math.PI * 0.9, true );
		g.stroke();
		poly( g, [ [ 32, 34 ], [ 42, 44 ], [ 32, 58 ], [ 22, 44 ] ], a );
		circle( g, 30, 42, 2.5, 'rgba(255,255,255,0.8)', null );

	},
	ring( g, c, a ) {

		g.lineWidth = 9;
		g.strokeStyle = '#0a0c10';
		g.beginPath();
		g.arc( 32, 38, 15, 0, Math.PI * 2 );
		g.stroke();
		g.lineWidth = 6;
		g.strokeStyle = '#c9a227';
		g.stroke();
		poly( g, [ [ 32, 12 ], [ 40, 20 ], [ 32, 28 ], [ 24, 20 ] ], a );

	},
	shield( g, c, a ) {

		poly( g, [ [ 10, 8 ], [ 54, 8 ], [ 52, 34 ], [ 32, 58 ], [ 12, 34 ] ], c );
		poly( g, [ [ 32, 12 ], [ 48, 14 ], [ 46, 32 ], [ 32, 50 ], [ 18, 32 ], [ 16, 14 ] ], shade( c, 0.75 ), 'transparent' );
		circle( g, 32, 28, 6, a );

	},
	quiver( g, c, a ) {

		for ( let i = 0; i < 3; i ++ ) {

			rect( g, 24 + i * 6, 4, 2, 16, '#d8d0b8' );
			poly( g, [ [ 22 + i * 6, 4 ], [ 25 + i * 6, 0 ], [ 28 + i * 6, 4 ] ], a );

		}

		poly( g, [ [ 18, 16 ], [ 46, 16 ], [ 42, 60 ], [ 22, 60 ] ], LEATHER );
		rect( g, 20, 24, 24, 4, a );

	},
	focus( g, c, a ) {

		poly( g, [ [ 22, 56 ], [ 42, 56 ], [ 38, 42 ], [ 26, 42 ] ], '#6a5a4a' );
		circle( g, 32, 26, 16, a );
		circle( g, 27, 21, 4, 'rgba(255,255,255,0.75)', null );

	}
};

function flask( g, liquid ) {

	poly( g, [ [ 26, 4 ], [ 38, 4 ], [ 38, 18 ], [ 50, 34 ], [ 48, 58 ], [ 16, 58 ], [ 14, 34 ], [ 26, 18 ] ], 'rgba(200, 220, 240, 0.18)', '#cfd8e6' );
	poly( g, [ [ 16, 36 ], [ 48, 36 ], [ 47, 56 ], [ 17, 56 ] ], liquid, 'transparent' );
	rect( g, 24, 0, 16, 6, WOOD );
	circle( g, 22, 42, 2.5, 'rgba(255,255,255,0.6)', null );

}

function orb( g, color ) {

	const grd = g.createRadialGradient( 26, 24, 2, 32, 32, 24 );
	grd.addColorStop( 0, '#ffffff' );
	grd.addColorStop( 0.35, color );
	grd.addColorStop( 1, shade( color, 0.35 ) );
	circle( g, 32, 32, 22, grd );

}

function rune( g, color ) {

	const pts = [];
	for ( let i = 0; i < 6; i ++ ) pts.push( [ 32 + Math.cos( i / 6 * Math.PI * 2 + Math.PI / 6 ) * 24, 32 + Math.sin( i / 6 * Math.PI * 2 + Math.PI / 6 ) * 24 ] );
	poly( g, pts, '#2a3340', color );
	g.lineWidth = 3;
	g.strokeStyle = color;
	g.beginPath();
	g.moveTo( 32, 16 ); g.lineTo( 32, 48 ); g.moveTo( 22, 24 ); g.lineTo( 42, 40 ); g.moveTo( 42, 24 ); g.lineTo( 22, 40 );
	g.stroke();

}

function coins( g ) {

	for ( const [ x, y ] of [ [ 22, 40 ], [ 40, 42 ], [ 31, 28 ] ] ) {

		circle( g, x, y, 12, '#e8b830' );
		circle( g, x, y, 7, '#ffd34d', null );

	}

}

function draw( kind, color, accent, liquid ) {

	const cv = document.createElement( 'canvas' );
	cv.width = cv.height = SIZE;
	const g = cv.getContext( '2d' );
	g.lineJoin = 'round';
	if ( DRAW[ kind ] ) {

		g.translate( 32, 32 );
		g.rotate( kind === 'bow' ? 0 : Math.PI / 4 );
		g.scale( 0.92, 0.92 );
		g.translate( - 32, - 32 );
		DRAW[ kind ]( g, color, accent );

	} else if ( ARMOUR[ kind ] ) ARMOUR[ kind ]( g, color, accent );
	else if ( kind.startsWith( 'flask' ) ) flask( g, liquid || color );
	else if ( kind === 'orb' ) orb( g, color );
	else if ( kind === 'rune' ) rune( g, color );
	else if ( kind === 'coins' ) coins( g );
	else circle( g, 32, 32, 20, color );
	return cv.toDataURL();

}

export function iconURL( kind, color = '#c0c4cc', accent = '#c9a227', liquid = null ) {

	const key = kind + color + accent + liquid;
	let u = cache.get( key );
	if ( ! u ) {

		u = draw( kind, color, accent, liquid );
		cache.set( key, u );

	}

	return u;

}

const RARITY_ACCENT = { normal: '#9aa0aa', magic: '#6f95ff', rare: '#ffd84d', unique: '#ff8a2a' };
const FLASK_LIQUID = { 'flask-life': '#d83030', 'flask-mana': '#3060e0', 'flask-hybrid': '#a040c0' };

export function itemIcon( item ) {

	const base = get( 'itemBase', item.base );
	if ( ! base ) return iconURL( 'orb', '#888888' );
	const accent = item.unique ? get( 'unique', item.unique )?.color ?? RARITY_ACCENT.unique : RARITY_ACCENT[ item.rarity ];
	const kind = base.icon || base.weaponClass || base.slot;
	const color = base.model?.color && ! base.weaponClass ? base.model.color : base.model?.color ?? '#c0c4cc';
	return iconURL( kind, color, accent, FLASK_LIQUID[ kind ] || ( kind === 'flask-utility' ? base.model?.color : null ) );

}

export function currencyIcon( id ) {

	return iconURL( 'orb', get( 'currency', id )?.color ?? '#e0cf9f' );

}

export function runeIcon() {

	return iconURL( 'rune', '#6fe0c8' );

}
