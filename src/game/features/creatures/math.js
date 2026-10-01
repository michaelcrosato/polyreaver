// Rig math without three.js: 3x4 affine matrices in flat Float32Arrays, Euler
// rotations, two-bone IK, easing curves. Sim-safe (Node can build and pose rigs
// for tests and agent tools), allocation-free in the hot paths.
//
// MATRIX LAYOUT (12 floats, column-major 3x4 - the upper part of a 4x4):
//   [ 0  1  2 ]  X axis column      p' = X * p.x + Y * p.y + Z * p.z + T
//   [ 3  4  5 ]  Y axis column
//   [ 6  7  8 ]  Z axis column
//   [ 9 10 11 ]  translation T
// Every matrix lives at an offset `o` inside a bigger array (one array per rig),
// so a 30-bone skeleton is one Float32Array( 360 ) - no objects per bone.
//
// AXES (models and rigs): +Y up, +Z forward (where the creature faces), +X is the
// creature's LEFT. Entity facing f maps local +Z to world ( sin f, 0, cos f ).

export const TAU = Math.PI * 2;

export function clamp( v, a, b ) {

	return v < a ? a : v > b ? b : v;

}

export function lerp( a, b, t ) {

	return a + ( b - a ) * t;

}

export function smooth( t ) {

	t = clamp( t, 0, 1 );
	return t * t * ( 3 - 2 * t );

}

export const easeOut = ( t ) => 1 - ( 1 - t ) * ( 1 - t );
export const easeIn = ( t ) => t * t;
export const easeOutCubic = ( t ) => 1 - Math.pow( 1 - t, 3 );
export const easeInOut = ( t ) => ( t < 0.5 ? 2 * t * t : 1 - Math.pow( - 2 * t + 2, 2 ) / 2 );
// fast start, long settle: the "snap" of an attack's active frames
export const easeOutExpo = ( t ) => ( t >= 1 ? 1 : 1 - Math.pow( 2, - 10 * t ) );
// overshoot then settle: recovery poses use it so limbs swing past and come back
export function easeOutBack( t, s = 1.7 ) {

	const u = t - 1;
	return 1 + ( s + 1 ) * u * u * u + s * u * u;

}

// 0 -> 1 -> 0 bump (sin), handy for lifts and pulses
export const bump = ( t ) => Math.sin( clamp( t, 0, 1 ) * Math.PI );

// deterministic per-index noise in [0, 1) (part scatter directions, fidget timing)
export function hash01( a, b = 0 ) {

	let h = Math.imul( a ^ 0x9e3779b9, 0x85ebca6b ) ^ Math.imul( b + 0x632be5ab, 0xc2b2ae35 );
	h ^= h >>> 15; h = Math.imul( h, 0x2c1b3c6d ); h ^= h >>> 12; h = Math.imul( h, 0x297a2d39 ); h ^= h >>> 15;
	return ( h >>> 0 ) / 4294967296;

}

// smooth 1D value noise (cheap fidgets and idle sway)
export function noise1( x, seed = 0 ) {

	const i = Math.floor( x ), f = x - i;
	const a = hash01( i, seed ), b = hash01( i + 1, seed );
	return lerp( a, b, f * f * ( 3 - 2 * f ) ) * 2 - 1;

}

export function wrapAngle( a ) {

	return Math.atan2( Math.sin( a ), Math.cos( a ) );

}

// --- 3x4 matrices -------------------------------------------------------------------

export function setIdentity( m, o ) {

	m[ o ] = 1; m[ o + 1 ] = 0; m[ o + 2 ] = 0;
	m[ o + 3 ] = 0; m[ o + 4 ] = 1; m[ o + 5 ] = 0;
	m[ o + 6 ] = 0; m[ o + 7 ] = 0; m[ o + 8 ] = 1;
	m[ o + 9 ] = 0; m[ o + 10 ] = 0; m[ o + 11 ] = 0;

}

// out = a * b (all 3x4, may not alias out with a or b)
export function mul( out, oo, a, ao, b, bo ) {

	const a0 = a[ ao ], a1 = a[ ao + 1 ], a2 = a[ ao + 2 ], a3 = a[ ao + 3 ], a4 = a[ ao + 4 ], a5 = a[ ao + 5 ];
	const a6 = a[ ao + 6 ], a7 = a[ ao + 7 ], a8 = a[ ao + 8 ], a9 = a[ ao + 9 ], a10 = a[ ao + 10 ], a11 = a[ ao + 11 ];
	for ( let c = 0; c < 4; c ++ ) {

		const x = b[ bo + c * 3 ], y = b[ bo + c * 3 + 1 ], z = b[ bo + c * 3 + 2 ];
		out[ oo + c * 3 ] = a0 * x + a3 * y + a6 * z;
		out[ oo + c * 3 + 1 ] = a1 * x + a4 * y + a7 * z;
		out[ oo + c * 3 + 2 ] = a2 * x + a5 * y + a8 * z;

	}

	out[ oo + 9 ] += a9; out[ oo + 10 ] += a10; out[ oo + 11 ] += a11;

}

// Local transform T( t ) * R( euler YXZ ) * S( s ). YXZ = yaw first (outermost),
// then pitch, then roll - the natural order for heads, spines and limbs:
//   x  pitch: + tips +Y toward +Z (a spine leans forward, a hanging arm swings BACK, a head nods down)
//   y  yaw:   + turns +Z toward +X (turn left)
//   z  roll:  + tips +Y toward -X (a left arm hanging down swings OUT to the left)
export function composeYXZ( m, o, tx, ty, tz, rx, ry, rz, sx, sy, sz ) {

	const a = Math.cos( rx ), b = Math.sin( rx ), c = Math.cos( ry ), d = Math.sin( ry ), e = Math.cos( rz ), f = Math.sin( rz );
	const ce = c * e, cf = c * f, de = d * e, df = d * f;
	m[ o ] = ( ce + df * b ) * sx; m[ o + 1 ] = a * f * sx; m[ o + 2 ] = ( cf * b - de ) * sx;
	m[ o + 3 ] = ( de * b - cf ) * sy; m[ o + 4 ] = a * e * sy; m[ o + 5 ] = ( df + ce * b ) * sy;
	m[ o + 6 ] = a * d * sz; m[ o + 7 ] = - b * sz; m[ o + 8 ] = a * c * sz;
	m[ o + 9 ] = tx; m[ o + 10 ] = ty; m[ o + 11 ] = tz;

}

// Same with three.js' default Euler order (XYZ) - used for part-list `rot`, so a
// part list reads exactly like `mesh.rotation.set( x, y, z )` would.
export function composeXYZ( m, o, tx, ty, tz, rx, ry, rz, sx, sy, sz ) {

	const a = Math.cos( rx ), b = Math.sin( rx ), c = Math.cos( ry ), d = Math.sin( ry ), e = Math.cos( rz ), f = Math.sin( rz );
	const ae = a * e, af = a * f, be = b * e, bf = b * f;
	m[ o ] = c * e * sx; m[ o + 1 ] = ( af + be * d ) * sx; m[ o + 2 ] = ( bf - ae * d ) * sx;
	m[ o + 3 ] = - c * f * sy; m[ o + 4 ] = ( ae - bf * d ) * sy; m[ o + 5 ] = ( be + af * d ) * sy;
	m[ o + 6 ] = d * sz; m[ o + 7 ] = - b * c * sz; m[ o + 8 ] = a * c * sz;
	m[ o + 9 ] = tx; m[ o + 10 ] = ty; m[ o + 11 ] = tz;

}

// Basis from a direction: local -Y runs along `dir` (a limb segment hangs from its
// joint), local +Z points toward `pole` (the way the knee / elbow bends), scaled by s.
// This is how IK bones get their world matrix: rest-pose parts authored "hanging
// straight down" follow the solved segment exactly.
export function basisFromDir( m, o, dx, dy, dz, px, py, pz, s, tx, ty, tz ) {

	// y axis = -dir
	let yx = - dx, yy = - dy, yz = - dz;
	let l = Math.hypot( yx, yy, yz ) || 1;
	yx /= l; yy /= l; yz /= l;
	// z = pole minus its component along y
	const pd = px * yx + py * yy + pz * yz;
	let zx = px - yx * pd, zy = py - yy * pd, zz = pz - yz * pd;
	l = Math.hypot( zx, zy, zz );
	if ( l < 1e-5 ) {

		// pole parallel to the segment: pick any perpendicular
		zx = yy; zy = - yx; zz = 0;
		l = Math.hypot( zx, zy, zz ) || 1;

	}

	zx /= l; zy /= l; zz /= l;
	// x = y cross z
	const xx = yy * zz - yz * zy, xy = yz * zx - yx * zz, xz = yx * zy - yy * zx;
	m[ o ] = xx * s; m[ o + 1 ] = xy * s; m[ o + 2 ] = xz * s;
	m[ o + 3 ] = yx * s; m[ o + 4 ] = yy * s; m[ o + 5 ] = yz * s;
	m[ o + 6 ] = zx * s; m[ o + 7 ] = zy * s; m[ o + 8 ] = zz * s;
	m[ o + 9 ] = tx; m[ o + 10 ] = ty; m[ o + 11 ] = tz;

}

// Transform point (x, y, z) by matrix m@o into out[ oo.. oo+2 ].
export function xformPoint( out, oo, m, o, x, y, z ) {

	out[ oo ] = m[ o ] * x + m[ o + 3 ] * y + m[ o + 6 ] * z + m[ o + 9 ];
	out[ oo + 1 ] = m[ o + 1 ] * x + m[ o + 4 ] * y + m[ o + 7 ] * z + m[ o + 10 ];
	out[ oo + 2 ] = m[ o + 2 ] * x + m[ o + 5 ] * y + m[ o + 8 ] * z + m[ o + 11 ];

}

// Rotate direction (no translation).
export function xformDir( out, oo, m, o, x, y, z ) {

	out[ oo ] = m[ o ] * x + m[ o + 3 ] * y + m[ o + 6 ] * z;
	out[ oo + 1 ] = m[ o + 1 ] * x + m[ o + 4 ] * y + m[ o + 7 ] * z;
	out[ oo + 2 ] = m[ o + 2 ] * x + m[ o + 5 ] * y + m[ o + 8 ] * z;

}

// --- two-bone IK ----------------------------------------------------------------------
// Hip H, target T, segment lengths a (thigh) and b (shin), pole P (direction the
// knee should point). Writes the knee position into out[ 0..2 ] and the reachable
// foot position into out[ 3..5 ]. Law of cosines in the plane spanned by H->T and P.
export function solveTwoBone( out, hx, hy, hz, tx, ty, tz, a, b, px, py, pz ) {

	let dx = tx - hx, dy = ty - hy, dz = tz - hz;
	let d = Math.hypot( dx, dy, dz );
	if ( d < 1e-6 ) {

		dx = 0; dy = - 1; dz = 0; d = 1e-6;

	}

	dx /= d; dy /= d; dz /= d;
	const dist = clamp( d, Math.abs( a - b ) + 1e-4, ( a + b ) * 0.9995 );
	const cosA = clamp( ( a * a + dist * dist - b * b ) / ( 2 * a * dist ), - 1, 1 );
	const sinA = Math.sqrt( 1 - cosA * cosA );
	// bend direction: pole projected perpendicular to the hip->target line
	const pd = px * dx + py * dy + pz * dz;
	let bx = px - dx * pd, by = py - dy * pd, bz = pz - dz * pd;
	const bl = Math.hypot( bx, by, bz );
	if ( bl < 1e-5 ) {

		bx = 0; by = 0; bz = 1;

	} else {

		bx /= bl; by /= bl; bz /= bl;

	}

	out[ 0 ] = hx + ( dx * cosA + bx * sinA ) * a;
	out[ 1 ] = hy + ( dy * cosA + by * sinA ) * a;
	out[ 2 ] = hz + ( dz * cosA + bz * sinA ) * a;
	out[ 3 ] = hx + dx * dist;
	out[ 4 ] = hy + dy * dist;
	out[ 5 ] = hz + dz * dist;

}

// Critically-damped-ish spring step for secondary motion: state[i] = value,
// state[i+1] = velocity. Returns the new value.
export function spring( state, i, target, stiffness, damping, dt ) {

	const v = state[ i + 1 ] + ( ( target - state[ i ] ) * stiffness - state[ i + 1 ] * damping ) * dt;
	state[ i + 1 ] = v;
	state[ i ] += v * dt;
	return state[ i ];

}

// --- colours --------------------------------------------------------------------------

export function hexToRgb( hex, out = [ 0, 0, 0 ], o = 0 ) {

	const n = typeof hex === 'number' ? hex : parseInt( String( hex ).replace( '#', '' ), 16 );
	out[ o ] = ( ( n >> 16 ) & 255 ) / 255;
	out[ o + 1 ] = ( ( n >> 8 ) & 255 ) / 255;
	out[ o + 2 ] = ( n & 255 ) / 255;
	return out;

}

export function rgbToHex( r, g, b ) {

	const c = ( v ) => Math.round( clamp( v, 0, 1 ) * 255 ).toString( 16 ).padStart( 2, '0' );
	return '#' + c( r ) + c( g ) + c( b );

}

// h, s, l in 0..1 -> '#rrggbb'
export function hsl( h, s, l ) {

	h = ( ( h % 1 ) + 1 ) % 1;
	s = clamp( s, 0, 1 ); l = clamp( l, 0, 1 );
	const k = ( n ) => ( n + h * 12 ) % 12;
	const a = s * Math.min( l, 1 - l );
	const f = ( n ) => l - a * Math.max( - 1, Math.min( k( n ) - 3, 9 - k( n ), 1 ) );
	return rgbToHex( f( 0 ), f( 8 ), f( 4 ) );

}

export function hexToHsl( hex ) {

	const [ r, g, b ] = hexToRgb( hex );
	const max = Math.max( r, g, b ), min = Math.min( r, g, b ), l = ( max + min ) / 2;
	if ( max === min ) return [ 0, 0, l ];
	const d = max - min;
	const s = l > 0.5 ? d / ( 2 - max - min ) : d / ( max + min );
	let h;
	if ( max === r ) h = ( g - b ) / d + ( g < b ? 6 : 0 );
	else if ( max === g ) h = ( b - r ) / d + 2;
	else h = ( r - g ) / d + 4;
	return [ h / 6, s, l ];

}

export function mixHex( a, b, t ) {

	const A = hexToRgb( a ), B = hexToRgb( b );
	return rgbToHex( lerp( A[ 0 ], B[ 0 ], t ), lerp( A[ 1 ], B[ 1 ], t ), lerp( A[ 2 ], B[ 2 ], t ) );

}
