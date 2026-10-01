// Procedural icons for skills, statuses and the potion: a canvas per (glyph, colour),
// drawn once with a few vector primitives and cached as a data URL. No image assets.
//
//   iconURL( 'fireball', '#ff6a1a' )   -> 'data:image/png;base64,...'
// The glyph names are the `icon` fields of skill / status / support defs.

const cache = new Map();
const S = 64;

function line( g, pts, w = 4 ) {

	g.lineWidth = w;
	g.beginPath();
	pts.forEach( ( [ x, y ], i ) => ( i ? g.lineTo( x, y ) : g.moveTo( x, y ) ) );
	g.stroke();

}

function poly( g, pts ) {

	g.beginPath();
	pts.forEach( ( [ x, y ], i ) => ( i ? g.lineTo( x, y ) : g.moveTo( x, y ) ) );
	g.closePath();
	g.fill();

}

function circle( g, x, y, r, fill = true, w = 3 ) {

	g.beginPath();
	g.arc( x, y, r, 0, Math.PI * 2 );
	if ( fill ) g.fill();
	else {

		g.lineWidth = w;
		g.stroke();

	}

}

function arc( g, x, y, r, a0, a1, w = 5 ) {

	g.lineWidth = w;
	g.beginPath();
	g.arc( x, y, r, a0, a1 );
	g.stroke();

}

// a blade from (x, y) pointing along angle a
function blade( g, x, y, a, len, w = 5 ) {

	const c = Math.cos( a ), s = Math.sin( a ), nx = - s * w / 2, ny = c * w / 2;
	poly( g, [ [ x + nx, y + ny ], [ x + c * len * 0.82 + nx, y + s * len * 0.82 + ny ], [ x + c * len, y + s * len ], [ x + c * len * 0.82 - nx, y + s * len * 0.82 - ny ], [ x - nx, y - ny ] ] );
	g.fillRect( x - c * 7 - 1.5, y - s * 7 - 1.5, 3, 3 );
	line( g, [ [ x - nx * 1.8, y - ny * 1.8 ], [ x + nx * 1.8, y + ny * 1.8 ] ], 3 );

}

function flame( g, x, y, h ) {

	g.beginPath();
	g.moveTo( x, y - h );
	g.bezierCurveTo( x + h * 0.55, y - h * 0.45, x + h * 0.5, y + h * 0.1, x, y + h * 0.35 );
	g.bezierCurveTo( x - h * 0.5, y + h * 0.1, x - h * 0.45, y - h * 0.35, x, y - h );
	g.fill();

}

function bolt( g, x, y, h ) {

	poly( g, [ [ x + h * 0.15, y - h * 0.5 ], [ x - h * 0.2, y + h * 0.05 ], [ x + h * 0.02, y + h * 0.05 ], [ x - h * 0.15, y + h * 0.5 ], [ x + h * 0.25, y - h * 0.08 ], [ x + h * 0.03, y - h * 0.08 ] ] );

}

function snow( g, x, y, r, w = 3 ) {

	for ( let i = 0; i < 6; i ++ ) {

		const a = i * Math.PI / 3, c = Math.cos( a ), s = Math.sin( a );
		line( g, [ [ x, y ], [ x + c * r, y + s * r ] ], w );
		line( g, [ [ x + c * r * 0.6, y + s * r * 0.6 ], [ x + Math.cos( a + 0.6 ) * r * 0.85, y + Math.sin( a + 0.6 ) * r * 0.85 ] ], w * 0.7 );

	}

}

function star( g, x, y, r, n = 5, inner = 0.45 ) {

	const pts = [];
	for ( let i = 0; i < n * 2; i ++ ) {

		const a = i * Math.PI / n - Math.PI / 2, rr = i % 2 ? r * inner : r;
		pts.push( [ x + Math.cos( a ) * rr, y + Math.sin( a ) * rr ] );

	}

	poly( g, pts );

}

const GLYPHS = {
	slash: ( g ) => {

		arc( g, 30, 38, 20, - 2.6, - 0.2, 6 );
		blade( g, 20, 48, - 0.9, 34, 6 );

	},
	cleave: ( g ) => arc( g, 32, 44, 24, - 3.0, - 0.15, 7 ),
	hammer: ( g ) => {

		line( g, [ [ 18, 50 ], [ 40, 22 ] ], 5 );
		g.save(); g.translate( 42, 20 ); g.rotate( - 0.9 ); g.fillRect( - 12, - 7, 24, 14 ); g.restore();

	},
	double: ( g ) => {

		blade( g, 14, 46, - 0.6, 36, 5 );
		blade( g, 22, 54, - 0.6, 36, 5 );

	},
	whirl: ( g ) => {

		for ( let i = 0; i < 3; i ++ ) arc( g, 32, 32, 8 + i * 7, i * 2.1, i * 2.1 + 2.6, 4 );

	},
	leap: ( g ) => {

		arc( g, 32, 46, 20, Math.PI * 1.1, Math.PI * 1.9, 4 );
		poly( g, [ [ 48, 34 ], [ 54, 46 ], [ 42, 44 ] ] );
		line( g, [ [ 14, 54 ], [ 50, 54 ] ], 3 );

	},
	slam: ( g ) => {

		poly( g, [ [ 24, 10 ], [ 40, 10 ], [ 40, 28 ], [ 48, 28 ], [ 32, 44 ], [ 16, 28 ], [ 24, 28 ] ] );
		line( g, [ [ 8, 52 ], [ 22, 48 ], [ 32, 54 ], [ 44, 48 ], [ 56, 52 ] ], 3 );

	},
	quake: ( g ) => {

		line( g, [ [ 10, 20 ], [ 22, 30 ], [ 16, 38 ], [ 30, 46 ], [ 26, 56 ] ], 4 );
		line( g, [ [ 54, 16 ], [ 42, 28 ], [ 48, 36 ], [ 36, 46 ] ], 4 );

	},
	dash: ( g ) => {

		poly( g, [ [ 34, 18 ], [ 56, 32 ], [ 34, 46 ] ] );
		for ( let i = 0; i < 3; i ++ ) line( g, [ [ 8 + i * 4, 22 + i * 10 ], [ 30, 22 + i * 10 ] ], 3 );

	},
	lacerate: ( g ) => {

		line( g, [ [ 12, 14 ], [ 52, 50 ] ], 5 );
		line( g, [ [ 52, 14 ], [ 12, 50 ] ], 5 );

	},
	reave: ( g ) => {

		for ( let i = - 1; i <= 1; i ++ ) blade( g, 32, 54, - Math.PI / 2 + i * 0.45, 40, 5 );

	},
	flicker: ( g ) => {

		g.globalAlpha = 0.45;
		blade( g, 10, 50, - 0.7, 30, 5 );
		g.globalAlpha = 1;
		blade( g, 26, 52, - 0.7, 34, 6 );
		bolt( g, 46, 20, 18 );

	},
	infernal: ( g ) => {

		flame( g, 32, 36, 22 );
		blade( g, 18, 54, - 0.75, 30, 4 );

	},
	fireball: ( g ) => {

		circle( g, 38, 26, 12 );
		poly( g, [ [ 28, 20 ], [ 8, 50 ], [ 34, 34 ] ] );

	},
	spear: ( g ) => poly( g, [ [ 54, 10 ], [ 40, 30 ], [ 12, 54 ], [ 34, 24 ] ] ),
	spark: ( g ) => {

		star( g, 30, 32, 14, 6, 0.35 );
		star( g, 48, 18, 6, 5, 0.4 );
		star( g, 46, 46, 5, 5, 0.4 );

	},
	arc: ( g ) => {

		line( g, [ [ 10, 50 ], [ 22, 30 ], [ 28, 38 ], [ 40, 18 ], [ 46, 26 ], [ 56, 12 ] ], 4 );
		circle( g, 10, 50, 4 ); circle( g, 56, 12, 4 );

	},
	knives: ( g ) => {

		for ( let i = - 1; i <= 1; i ++ ) blade( g, 14, 50, - 0.8 + i * 0.35, 40, 4 );

	},
	vortex: ( g ) => {

		circle( g, 32, 32, 18, false, 2 );
		for ( let i = 0; i < 3; i ++ ) {

			const a = i * 2.1;
			blade( g, 32 + Math.cos( a ) * 18, 32 + Math.sin( a ) * 18, a + 1.6, 14, 4 );

		}

	},
	frostbolt: ( g ) => {

		circle( g, 32, 32, 9 );
		snow( g, 32, 32, 20, 3 );

	},
	ball: ( g ) => {

		circle( g, 32, 32, 12 );
		bolt( g, 14, 16, 14 ); bolt( g, 52, 46, 14 ); bolt( g, 50, 16, 12 );

	},
	nova: ( g ) => {

		circle( g, 32, 32, 18, false, 4 );
		for ( let i = 0; i < 8; i ++ ) {

			const a = i * Math.PI / 4;
			line( g, [ [ 32 + Math.cos( a ) * 20, 32 + Math.sin( a ) * 20 ], [ 32 + Math.cos( a ) * 29, 32 + Math.sin( a ) * 29 ] ], 4 );

		}

	},
	wall: ( g ) => {

		for ( let i = 0; i < 4; i ++ ) flame( g, 12 + i * 13, 40, 14 + ( i % 2 ) * 5 );
		g.fillRect( 6, 46, 52, 4 );

	},
	meteor: ( g ) => {

		circle( g, 40, 40, 12 );
		poly( g, [ [ 32, 32 ], [ 8, 8 ], [ 44, 30 ] ] );

	},
	storm: ( g ) => {

		circle( g, 22, 22, 10 ); circle( g, 36, 18, 12 ); circle( g, 46, 24, 9 );
		g.fillRect( 14, 22, 40, 10 );
		bolt( g, 32, 46, 22 );

	},
	cloud: ( g ) => {

		circle( g, 22, 34, 12 ); circle( g, 38, 28, 14 ); circle( g, 46, 40, 10 ); circle( g, 30, 44, 10 );

	},
	cascade: ( g ) => {

		for ( let i = 0; i < 4; i ++ ) poly( g, [ [ 8 + i * 13, 54 ], [ 14 + i * 13, 50 - i * 9 ], [ 20 + i * 13, 54 ] ] );

	},
	blink: ( g ) => {

		circle( g, 14, 46, 7, false, 3 );
		circle( g, 50, 18, 9 );
		g.setLineDash( [ 4, 4 ] );
		line( g, [ [ 20, 40 ], [ 42, 24 ] ], 3 );
		g.setLineDash( [] );

	},
	shout: ( g ) => {

		poly( g, [ [ 10, 24 ], [ 22, 24 ], [ 34, 12 ], [ 34, 52 ], [ 22, 40 ], [ 10, 40 ] ] );
		arc( g, 34, 32, 12, - 0.8, 0.8, 3 );
		arc( g, 34, 32, 20, - 0.8, 0.8, 3 );

	},
	rage: ( g ) => {

		flame( g, 32, 38, 24 );
		g.globalCompositeOperation = 'destination-out';
		poly( g, [ [ 22, 30 ], [ 30, 34 ], [ 22, 36 ] ] ); poly( g, [ [ 42, 30 ], [ 34, 34 ], [ 42, 36 ] ] );
		g.globalCompositeOperation = 'source-over';

	},
	haste: ( g ) => {

		for ( let i = 0; i < 3; i ++ ) line( g, [ [ 14 + i * 12, 16 ], [ 26 + i * 12, 32 ], [ 14 + i * 12, 48 ] ], 5 );

	},
	armour: ( g ) => {

		poly( g, [ [ 32, 8 ], [ 52, 16 ], [ 48, 40 ], [ 32, 56 ], [ 16, 40 ], [ 12, 16 ] ] );
		g.globalCompositeOperation = 'destination-out';
		snow( g, 32, 30, 11, 2.5 );
		g.globalCompositeOperation = 'source-over';

	},
	shield: ( g ) => poly( g, [ [ 32, 8 ], [ 52, 16 ], [ 48, 40 ], [ 32, 56 ], [ 16, 40 ], [ 12, 16 ] ] ),
	blades: ( g ) => {

		g.globalAlpha = 0.8;
		blade( g, 12, 52, - 0.8, 42, 5 );
		blade( g, 52, 52, - 2.35, 42, 5 );
		g.globalAlpha = 1;

	},
	warriors: ( g ) => {

		poly( g, [ [ 16, 50 ], [ 16, 26 ], [ 32, 10 ], [ 48, 26 ], [ 48, 50 ] ] );
		g.globalCompositeOperation = 'destination-out';
		g.fillRect( 22, 30, 20, 5 ); g.fillRect( 29, 30, 6, 16 );
		g.globalCompositeOperation = 'source-over';

	},
	potion: ( g ) => {

		g.fillRect( 27, 8, 10, 12 );
		circle( g, 32, 38, 16 );

	},
	flame: ( g ) => flame( g, 32, 36, 24 ),
	snow: ( g ) => snow( g, 32, 32, 22, 4 ),
	crystal: ( g ) => poly( g, [ [ 32, 6 ], [ 46, 32 ], [ 32, 58 ], [ 18, 32 ] ] ),
	bolt: ( g ) => bolt( g, 32, 32, 46 ),
	drop: ( g ) => {

		poly( g, [ [ 32, 8 ], [ 46, 34 ], [ 18, 34 ] ] );
		circle( g, 32, 38, 14 );

	},
	blood: ( g ) => {

		poly( g, [ [ 26, 8 ], [ 36, 28 ], [ 16, 28 ] ] );
		circle( g, 26, 32, 10 ); circle( g, 44, 46, 7 );

	},
	stars: ( g ) => {

		star( g, 20, 26, 10 ); star( g, 44, 22, 8 ); star( g, 34, 46, 9 );

	},
	snail: ( g ) => {

		circle( g, 34, 32, 14, false, 5 );
		g.fillRect( 10, 44, 44, 6 );

	},
	root: ( g ) => {

		line( g, [ [ 32, 8 ], [ 32, 40 ], [ 16, 56 ] ], 5 ); line( g, [ [ 32, 40 ], [ 48, 56 ] ], 5 ); line( g, [ [ 32, 30 ], [ 18, 22 ] ], 4 );

	},
	crack: ( g ) => line( g, [ [ 20, 8 ], [ 34, 24 ], [ 24, 36 ], [ 40, 56 ] ], 6 ),
	down: ( g ) => poly( g, [ [ 20, 10 ], [ 44, 10 ], [ 44, 32 ], [ 54, 32 ], [ 32, 56 ], [ 10, 32 ], [ 20, 32 ] ] ),
	wing: ( g ) => {

		for ( let i = 0; i < 4; i ++ ) poly( g, [ [ 12 + i * 4, 48 - i * 10 ], [ 52, 20 + i * 3 ], [ 18 + i * 4, 52 - i * 10 ] ] );

	},
	ghost: ( g ) => {

		circle( g, 32, 26, 14 );
		poly( g, [ [ 18, 26 ], [ 46, 26 ], [ 46, 54 ], [ 39, 48 ], [ 32, 54 ], [ 25, 48 ], [ 18, 54 ] ] );

	},
	gem: ( g ) => poly( g, [ [ 20, 14 ], [ 44, 14 ], [ 54, 26 ], [ 32, 54 ], [ 10, 26 ] ] ),
	hand: ( g ) => {

		g.fillRect( 18, 30, 28, 22 );
		for ( let i = 0; i < 4; i ++ ) g.fillRect( 18 + i * 7.3, 12 + Math.abs( 1.5 - i ) * 3, 5.5, 22 );
		line( g, [ [ 46, 40 ], [ 54, 28 ] ], 6 );

	}
};

export function iconURL( name, color = '#cfd8e6', { size = S, frame = true } = {} ) {

	const key = name + '|' + color + '|' + size + frame;
	const hit = cache.get( key );
	if ( hit ) return hit;
	const cv = document.createElement( 'canvas' );
	cv.width = cv.height = size;
	const g = cv.getContext( '2d' );
	g.scale( size / S, size / S );
	if ( frame ) {

		// dark tinted plate with a soft element-coloured glow
		const grad = g.createRadialGradient( 32, 28, 4, 32, 32, 44 );
		grad.addColorStop( 0, color + '66' );
		grad.addColorStop( 0.6, '#151a24' );
		grad.addColorStop( 1, '#07090d' );
		g.fillStyle = grad;
		g.fillRect( 0, 0, S, S );

	}

	// the glyph on its own layer: drawn white with an element glow, then tinted
	// top-to-bottom (white -> element colour) without touching the plate
	const gc = document.createElement( 'canvas' );
	gc.width = gc.height = size;
	const q = gc.getContext( '2d' );
	q.scale( size / S, size / S );
	q.fillStyle = q.strokeStyle = '#fff6e6';
	q.lineCap = q.lineJoin = 'round';
	( GLYPHS[ name ] || GLYPHS.gem )( q );
	q.globalCompositeOperation = 'source-atop';
	const tint = q.createLinearGradient( 0, 0, 0, S );
	tint.addColorStop( 0, '#ffffff' );
	tint.addColorStop( 1, color );
	q.fillStyle = tint;
	q.globalAlpha = 0.6;
	q.fillRect( 0, 0, S, S );
	g.setTransform( 1, 0, 0, 1, 0, 0 );
	g.shadowColor = color;
	g.shadowBlur = size * 0.16;
	g.drawImage( gc, 0, 0 );
	g.shadowBlur = 0;
	const url = cv.toDataURL();
	cache.set( key, url );
	return url;

}
