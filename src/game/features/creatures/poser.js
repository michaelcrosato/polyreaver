// Poser: role-based write access to a pose array ( rig.js layout ). Animation code
// never touches bone indices directly - it says "pitch the chest forward 0.3" and
// the Poser finds the chest of whatever rig it is bound to (or ignores the call if
// the rig has no chest). That is what lets one 'roar' drive a biped, a spider and a
// jellyfish.
//
// Rotations are Euler YXZ offsets in radians added on top of the rest pose:
//   x  + pitch forward / an arm swings BACK / a head nods down
//   y  + yaw toward +X (the creature's left)
//   z  + roll: the top tips toward -X;  a LEFT arm hanging down swings out ( + )
//   (a RIGHT arm swings out with - z: use poser.armOut( side ) helpers)

export const ROLE_LIST = [ 'root', 'body', 'pelvis', 'spine', 'chest', 'neck', 'head', 'jaw', 'jawL', 'jawR', 'abdomen',
	'upperArmL', 'foreArmL', 'handL', 'upperArmR', 'foreArmR', 'handR', 'weapon', 'offhand', 'wingL', 'wingR', 'wingL2', 'wingR2' ];

// Role table for a template: single roles -> bone index (-1 missing), chains -> arrays,
// and leg indices by side/front for foot targets.
export function roleTable( T ) {

	if ( T.R ) return T.R;
	const R = {};
	for ( const r of ROLE_LIST ) {

		const v = T.roles[ r ];
		R[ r ] = typeof v === 'number' ? v : Array.isArray( v ) ? v[ 0 ] : - 1;

	}

	R.root = 0;
	if ( R.body < 0 ) R.body = R.pelvis >= 0 ? R.pelvis : 0;
	if ( R.pelvis < 0 ) R.pelvis = R.body;
	if ( R.chest < 0 ) R.chest = R.body;
	const arr = ( k ) => ( Array.isArray( T.roles[ k ] ) ? T.roles[ k ] : typeof T.roles[ k ] === 'number' ? [ T.roles[ k ] ] : [] );
	R.spineChain = arr( 'spine' );
	R.neckChain = arr( 'neck' );
	R.tail = arr( 'tail' );
	R.front = arr( 'front' );
	R.back = arr( 'back' );
	if ( R.spine < 0 && R.spineChain.length ) R.spine = R.spineChain[ 0 ];
	if ( R.neck < 0 && R.neckChain.length ) R.neck = R.neckChain[ 0 ];
	R.legsL = []; R.legsR = []; R.frontLegs = []; R.hindLegs = [];
	T.legs.forEach( ( l, i ) => {

		( l.side > 0 ? R.legsL : R.legsR ).push( i );
		( l.front ? R.frontLegs : R.hindLegs ).push( i );

	} );
	// "the" left / right foot: the front-most leg on each side (bipeds: the only one)
	const pick = ( list ) => list.find( ( i ) => T.legs[ i ].front ) ?? list[ 0 ] ?? - 1;
	R.footL = pick( R.legsL ); R.footR = pick( R.legsR );
	R.hindL = R.legsL.find( ( i ) => ! T.legs[ i ].front ) ?? - 1;
	R.hindR = R.legsR.find( ( i ) => ! T.legs[ i ].front ) ?? - 1;
	R.hasArms = R.upperArmL >= 0 && R.upperArmR >= 0;
	R.humanoid = R.hasArms && T.legs.length === 2;
	T.R = R;
	return R;

}

export class Poser {

	constructor() {

		this.P = null; this.nb = 0; this.R = null; this.T = null;

	}

	bind( T, P ) {

		this.T = T; this.P = P; this.nb = T.nb; this.R = roleTable( T );
		return this;

	}

	// rotation offset (radians) on a bone index; -1 is ignored
	rot( b, x, y = 0, z = 0 ) {

		if ( b < 0 ) return;
		const P = this.P, i = b * 3;
		P[ i ] += x; P[ i + 1 ] += y; P[ i + 2 ] += z;

	}

	off( b, x, y = 0, z = 0 ) {

		if ( b < 0 ) return;
		const P = this.P, i = this.nb * 3 + b * 3;
		P[ i ] += x; P[ i + 1 ] += y; P[ i + 2 ] += z;

	}

	scl( b, x, y = x, z = x ) {

		if ( b < 0 ) return;
		const P = this.P, i = this.nb * 6 + b * 3;
		P[ i ] *= x; P[ i + 1 ] *= y; P[ i + 2 ] *= z;

	}

	foot( l, x, y = 0, z = 0 ) {

		if ( l < 0 || l === undefined ) return;
		const P = this.P, i = this.nb * 9 + l * 3;
		P[ i ] += x; P[ i + 1 ] += y; P[ i + 2 ] += z;

	}

	// role shorthands
	r( role, x, y = 0, z = 0 ) {

		this.rot( this.R[ role ] ?? - 1, x, y, z );

	}

	o( role, x, y = 0, z = 0 ) {

		this.off( this.R[ role ] ?? - 1, x, y, z );

	}

	// spread a rotation over a chain (spine, neck, tail): each bone gets value / n * weight curve
	chain( list, x, y = 0, z = 0, grow = 0 ) {

		const n = list.length;
		if ( ! n ) return;
		for ( let i = 0; i < n; i ++ ) {

			const k = ( 1 + grow * ( i / Math.max( 1, n - 1 ) - 0.5 ) ) / n;
			this.rot( list[ i ], x * k, y * k, z * k );

		}

	}

	// Rotate the whole rig about a pivot point (root space, unscaled): rolls, falls,
	// flips. Applies rotation (x pitch, z roll) to the root and the translation that
	// keeps the pivot fixed.
	pivot( px, py, pz, rx, rz ) {

		const cx = Math.cos( rx ), sx = Math.sin( rx ), cz = Math.cos( rz ), sz = Math.sin( rz );
		// R = Rx * Rz (YXZ with y = 0): v' = Rx( Rz( v ) )
		let x = px * cz - py * sz, y = px * sz + py * cz, z = pz;
		const y2 = y * cx - z * sx, z2 = y * sx + z * cx;
		y = y2; z = z2;
		this.rot( 0, rx, 0, rz );
		this.off( 0, px - x, py - y, pz - z );

	}

	// Apply a compiled key pose ( compileKey ) scaled by w.
	key( K, w ) {

		if ( ! K || w === 0 ) return;
		const P = this.P, nb9 = this.nb * 9;
		for ( let i = 0; i < K.rot.length; i += 4 ) {

			const o = K.rot[ i ];
			P[ o ] += K.rot[ i + 1 ] * w; P[ o + 1 ] += K.rot[ i + 2 ] * w; P[ o + 2 ] += K.rot[ i + 3 ] * w;

		}

		for ( let i = 0; i < K.off.length; i += 4 ) {

			const o = K.off[ i ];
			P[ o ] += K.off[ i + 1 ] * w; P[ o + 1 ] += K.off[ i + 2 ] * w; P[ o + 2 ] += K.off[ i + 3 ] * w;

		}

		for ( let i = 0; i < K.feet.length; i += 4 ) {

			const o = nb9 + K.feet[ i ] * 3;
			P[ o ] += K.feet[ i + 1 ] * w; P[ o + 1 ] += K.feet[ i + 2 ] * w; P[ o + 2 ] += K.feet[ i + 3 ] * w;

		}

	}

}

// KEY POSES are authored as plain objects keyed by role:
//   { chest: [ x, y, z ], upperArmR: [ ... ], pelvisO: [ dx, dy, dz ] (offset), footL: [ dx, dy, dz ] }
// Any role name ending in 'O' is a translation offset; footL/footR/hindL/hindR move IK
// foot targets. compileKey() resolves the roles of one template once (cached), so
// applying a key every frame is a tight loop over numbers.
export function compileKey( T, key ) {

	if ( ! key ) return null;
	let cache = T.keyCache;
	if ( ! cache ) cache = T.keyCache = new Map();
	let K = cache.get( key );
	if ( K ) return K;
	const R = roleTable( T );
	const rot = [], off = [], feet = [];
	for ( const [ name, v ] of Object.entries( key ) ) {

		if ( name === 'footL' || name === 'footR' || name === 'hindL' || name === 'hindR' ) {

			const l = R[ name ];
			if ( l >= 0 ) feet.push( l, v[ 0 ], v[ 1 ], v[ 2 ] );
			continue;

		}

		const isOff = name.endsWith( 'O' );
		const role = isOff ? name.slice( 0, - 1 ) : name;
		const b = role === 'root' ? 0 : R[ role ] ?? - 1;
		if ( b < 0 ) continue;
		( isOff ? off : rot ).push( isOff ? T.nb * 3 + b * 3 : b * 3, v[ 0 ], v[ 1 ] ?? 0, v[ 2 ] ?? 0 );

	}

	K = { rot, off, feet };
	cache.set( key, K );
	return K;

}

// Mirror a key pose left <-> right (combo steps, left-handed variants).
export function mirrorKey( key ) {

	const out = {};
	const swap = ( n ) => n.replace( /L$|L(?=O$)/, '#' ).replace( /R$|R(?=O$)/, 'L' ).replace( '#', 'R' );
	for ( const [ name, v ] of Object.entries( key ) ) {

		const isOff = name.endsWith( 'O' );
		const m = swap( name );
		out[ m ] = isOff || name.startsWith( 'foot' ) || name.startsWith( 'hind' ) ? [ - v[ 0 ], v[ 1 ], v[ 2 ] ] : [ v[ 0 ], - ( v[ 1 ] ?? 0 ), - ( v[ 2 ] ?? 0 ) ];

	}

	return out;

}
