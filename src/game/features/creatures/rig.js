// Rig templates: the compiled form of every model the game draws (monsters from
// genomes, the hero, NPCs, props, loot). Sim-safe: no three.js, so Node can build
// a body to measure it ( genomeMetrics ) and agents can inspect part counts.
//
// A TEMPLATE is a skeleton plus a part list:
//
//   bones   a tree; each bone has a parent, a rest OFFSET from its parent (metres,
//           unscaled - the entity's size scales the whole rig at the root) and an
//           optional rest rotation (Euler YXZ, see math.js for the sign rules).
//           Bones carry ROLES ( 'pelvis', 'head', 'jaw', 'upperArmR', 'tail0'... ) -
//           the animator only talks to roles, never to plan-specific indices, so one
//           'bite' works for a wolf, a centipede and a beholder.
//   legs    IK legs: thigh + shin (+ foot) bones, rest foot position on the ground,
//           pole (knee direction), gait phase offset. Their bones are posed by the
//           two-bone IK solver, not by FK - so never parent other BONES to them
//           (parts are fine: claws, hooves, knee spikes).
//   chains  spring chains (tails, antennae, tentacles, ears, crests, capes): the
//           animator adds lagging secondary motion to these bones.
//   parts   the part list ( docs/GAME.md §5 ): one primitive each, attached to a
//           bone, with a local transform, a colour and an emissive amount.
//
// Builders ( RigBuilder ) are used by the body plans, the humanoid builder and the
// model library; build() compiles everything into flat typed arrays the animator
// and the instanced renderer walk every frame without allocating.

import { composeXYZ, composeYXZ, mul, setIdentity, hexToRgb, clamp, xformPoint, xformDir, solveTwoBone, basisFromDir } from './math.js';

// Primitive shapes. All fit the unit cube centred on the origin with Y as the long
// axis (so `scale` is the part's size in metres), except: ring = torus in the XZ
// plane (outer diameter 1, tube 0.14 thick), disc = flat octagonal coin (diameter
// 1, 0.12 thick). spike = 4-sided pyramid, cone = 6-sided, cyl = hexagonal prism,
// prism = triangular prism, wedge = ramp (high at -Z, thin edge at +Z), blade =
// flat diamond-section sword blade (tip at +Y), capsule = pill, sphere = faceted ball.
export const SHAPES = [ 'box', 'wedge', 'cyl', 'cone', 'sphere', 'tetra', 'prism', 'spike', 'blade', 'ring', 'disc', 'capsule', 'octa' ];
export const SHAPE_INDEX = Object.fromEntries( SHAPES.map( ( s, i ) => [ s, i ] ) );

export const PALETTE_KEYS = [ 'primary', 'secondary', 'accent', 'skin', 'metal', 'glow', 'dark' ];

// part flags (bit field)
// DETAIL is set automatically (compile): tiny, non-glowing decoration the renderer
// may drop under load or at distance (claws, teeth, rivets).
export const PF = { GLOW: 1, SHINE: 2, WEAPON: 4, NOTINT: 8, MARKER: 16, NOSCATTER: 32, DETAIL: 64 };

export const DEFAULT_PALETTE = { primary: '#8a8f99', secondary: '#4a4f59', accent: '#e0b040', skin: '#c9a78a', metal: '#9aa3ad', glow: '#ffb347', dark: '#1d1f24' };

export class RigBuilder {

	constructor( kind = 'creature', name = '' ) {

		this.kind = kind;
		this.name = name;
		this.bones = [];
		this.byName = new Map();
		this.roles = {};
		this.legs = [];
		this.chains = [];
		this.parts = [];
		this.attach = {};
		this.meta = {};
		this.bone( 'root', - 1, [ 0, 0, 0 ], { role: 'root' } );

	}

	// Add a bone. parent: name or index. opts: { rot: [x,y,z] YXZ rest rotation, role, ik, fx }
	bone( name, parent, pos = [ 0, 0, 0 ], opts = {} ) {

		if ( this.byName.has( name ) ) name = name + '_' + this.bones.length;
		const p = typeof parent === 'string' ? this.idx( parent ) : parent;
		const i = this.bones.length;
		this.bones.push( { name, parent: p, pos: [ ...pos ], rot: opts.rot ? [ ...opts.rot ] : [ 0, 0, 0 ], ik: !! opts.ik, fx: opts.fx || null } );
		this.byName.set( name, i );
		if ( opts.role ) this.roles[ opts.role ] = i;
		return i;

	}

	idx( b ) {

		if ( typeof b === 'number' ) return b;
		if ( b === undefined || b === null ) return 0;
		const i = this.byName.get( b );
		if ( i === undefined ) throw new Error( `rig '${this.name}': unknown bone '${b}'` );
		return i;

	}

	role( name, bone ) {

		this.roles[ name ] = this.idx( bone );

	}

	// Rest-pose position of a bone's origin in root space (FK of rest offsets and
	// rest rotations; IK legs are not solved here - their joints hang from the hip).
	restPos( b ) {

		const W = this.restWorld();
		const o = this.idx( b ) * 12;
		return [ W[ o + 9 ], W[ o + 10 ], W[ o + 11 ] ];

	}

	restWorld() {

		const n = this.bones.length, W = new Float32Array( n * 12 ), L = new Float32Array( 12 );
		for ( let i = 0; i < n; i ++ ) {

			const b = this.bones[ i ];
			composeYXZ( L, 0, b.pos[ 0 ], b.pos[ 1 ], b.pos[ 2 ], b.rot[ 0 ], b.rot[ 1 ], b.rot[ 2 ], 1, 1, 1 );
			if ( b.parent < 0 ) W.set( L, 0 );
			else mul( W, i * 12, W, b.parent * 12, L, 0 );

		}

		return W;

	}

	// One primitive. color: '#rrggbb' or a palette key; opts: { emissive, shade, flags, shine }
	part( bone, shape, pos = [ 0, 0, 0 ], rot = [ 0, 0, 0 ], scale = [ 1, 1, 1 ], color = 'primary', opts = {} ) {

		if ( SHAPE_INDEX[ shape ] === undefined ) throw new Error( `unknown shape '${shape}'` );
		const p = { bone: this.idx( bone ), shape, pos, rot, scale: typeof scale === 'number' ? [ scale, scale, scale ] : scale, color, emissive: opts.emissive || 0, shade: opts.shade ?? 1, flags: opts.flags || 0 };
		if ( opts.shine ) p.flags |= PF.SHINE;
		if ( p.emissive > 0 && color === 'glow' ) p.flags |= PF.GLOW;
		this.parts.push( p );
		return p;

	}

	// Mirrored pair helper: calls fn( side ) for side = +1 (left, +X) and -1 (right).
	pair( fn ) {

		fn( 1, 'L' );
		fn( - 1, 'R' );

	}

	// Segment part between two points in a bone's space (limb segments, spines).
	// The segment runs from a to b; thickness t (or [tx, tz]).
	segment( bone, shape, a, b, t, color, opts = {} ) {

		const dx = b[ 0 ] - a[ 0 ], dy = b[ 1 ] - a[ 1 ], dz = b[ 2 ] - a[ 2 ];
		const len = Math.hypot( dx, dy, dz ) || 1e-4;
		// rotation taking +Y onto (dx, dy, dz) as an XYZ Euler with y = 0:
		// the Y column of Rx * Rz is ( -sin z, cos x cos z, sin x cos z )
		const pitch = Math.atan2( dz, dy );
		const roll = - Math.atan2( dx, Math.hypot( dy, dz ) );
		const tx = Array.isArray( t ) ? t[ 0 ] : t, tz = Array.isArray( t ) ? t[ 1 ] : t;
		return this.part( bone, shape, [ ( a[ 0 ] + b[ 0 ] ) / 2, ( a[ 1 ] + b[ 1 ] ) / 2, ( a[ 2 ] + b[ 2 ] ) / 2 ], [ pitch, 0, roll ], [ tx, len * ( opts.overlap ?? 1 ), tz ], color, opts );

	}

	// IK leg. thigh/shin/foot: bone names/indices (thigh and shin are flagged ik).
	// rest: foot rest position on the ground in root space (unscaled); a, b: segment
	// lengths; pole: knee direction in root space; phase: gait offset 0..1;
	// side: +1 left / -1 right; group: tripod / diagonal grouping (informational).
	leg( { thigh, shin, foot = null, rest, a, b, pole = [ 0, 0, 1 ], phase = 0, side = 1, lift = 0.25, ankle = 0.06, front = false, tuck = null } ) {

		const t = this.idx( thigh ), s = this.idx( shin ), f = foot === null ? - 1 : this.idx( foot );
		this.bones[ t ].ik = true; this.bones[ s ].ik = true;
		if ( f >= 0 ) this.bones[ f ].ik = true;
		this.legs.push( { thigh: t, shin: s, foot: f, rest: [ ...rest ], a, b, pole: [ ...pole ], phase, side, lift, ankle, front, tuck } );
		return this.legs.length - 1;

	}

	// Spring chain (secondary motion). kind: 'tail' | 'antenna' | 'tentacle' | 'ear' |
	// 'crest' | 'cape' | 'wing' ...; stiff/damp tune the spring; swing scales motion.
	chain( kind, bones, { stiff = 60, damp = 9, swing = 1, wave = 0, axis = 'x' } = {} ) {

		this.chains.push( { kind, bones: bones.map( ( b ) => this.idx( b ) ), stiff, damp, swing, wave, axis } );

	}

	// Named attachment point for VFX ( rc.attach ): bone + local offset.
	point( name, bone, pos = [ 0, 0, 0 ] ) {

		this.attach[ name ] = { bone: this.idx( bone ), pos: [ ...pos ] };

	}

	build( palette = DEFAULT_PALETTE ) {

		return compile( this, palette );

	}

}

// Resolve a part colour (hex or palette key) to linear-ish sRGB floats.
function resolveColor( c, palette, out, o, shade ) {

	let hex = c;
	if ( typeof c === 'string' && c[ 0 ] !== '#' ) hex = palette[ c ] ?? DEFAULT_PALETTE[ c ] ?? '#ff00ff';
	hexToRgb( hex, out, o );
	if ( shade !== 1 ) {

		for ( let k = 0; k < 3; k ++ ) out[ o + k ] = clamp( shade > 1 ? out[ o + k ] + ( 1 - out[ o + k ] ) * ( shade - 1 ) : out[ o + k ] * shade, 0, 1 );

	}

}

export function compile( B, palette ) {

	const nb = B.bones.length, np = B.parts.length;
	const T = {
		kind: B.kind, name: B.name, meta: B.meta,
		nb, boneNames: B.bones.map( ( b ) => b.name ),
		parent: new Int16Array( nb ), restPos: new Float32Array( nb * 3 ), restRot: new Float32Array( nb * 3 ), ik: new Uint8Array( nb ), ikKind: new Uint8Array( nb ),
		fx: B.bones.map( ( b ) => b.fx ),
		roles: { ...B.roles },
		legs: B.legs.map( ( l ) => ( { ...l, rest: Float32Array.from( l.rest ), pole: Float32Array.from( l.pole ) } ) ),
		chains: B.chains,
		np, pBone: new Int16Array( np ), pShape: new Uint8Array( np ), pLocal: new Float32Array( np * 12 ),
		pColor: new Float32Array( np * 3 ), pEmis: new Float32Array( np ), pFlags: new Uint8Array( np ),
		attach: B.attach, palette,
		shapeCounts: new Uint16Array( SHAPES.length )
	};
	for ( let i = 0; i < nb; i ++ ) {

		const b = B.bones[ i ];
		T.parent[ i ] = b.parent;
		T.restPos.set( b.pos, i * 3 );
		T.restRot.set( b.rot, i * 3 );
		T.ik[ i ] = b.ik ? 1 : 0;

	}

	// ikKind: 1 = hip (FK position only), 2 = solved entirely by the IK pass
	for ( const L of B.legs ) {

		T.ikKind[ L.thigh ] = 1; T.ikKind[ L.shin ] = 2;
		if ( L.foot >= 0 ) T.ikKind[ L.foot ] = 2;

	}

	for ( let i = 0; i < np; i ++ ) {

		const p = B.parts[ i ];
		T.pBone[ i ] = p.bone;
		T.pShape[ i ] = SHAPE_INDEX[ p.shape ];
		T.shapeCounts[ T.pShape[ i ] ] ++;
		const r = p.rot || [ 0, 0, 0 ], s = p.scale || [ 1, 1, 1 ], q = p.pos || [ 0, 0, 0 ];
		composeXYZ( T.pLocal, i * 12, q[ 0 ], q[ 1 ], q[ 2 ], r[ 0 ], r[ 1 ], r[ 2 ], s[ 0 ], s[ 1 ], s[ 2 ] );
		resolveColor( p.color, palette, T.pColor, i * 3, p.shade ?? 1 );
		T.pEmis[ i ] = p.emissive || 0;
		T.pFlags[ i ] = p.flags || 0;

	}

	T.poseSize = nb * 9 + T.legs.length * 3;
	T.dims = measure( T );
	// level of detail: parts smaller than ~6% of the body that do not glow
	const big = Math.max( T.dims.height, T.dims.length, T.dims.width );
	T.detailCount = 0;
	for ( let i = 0; i < np; i ++ ) {

		const p = B.parts[ i ], sc = p.scale || [ 1, 1, 1 ];
		const m = Math.max( Math.abs( sc[ 0 ] ), Math.abs( sc[ 1 ] ), Math.abs( sc[ 2 ] ) );
		if ( m < big * 0.065 && ! p.emissive && ! ( T.pFlags[ i ] & ( PF.WEAPON | PF.MARKER ) ) && B.kind === 'creature' ) {

			T.pFlags[ i ] |= PF.DETAIL;
			T.detailCount ++;

		}

	}

	return T;

}

// --- pose solving ----------------------------------------------------------------------
// A POSE is one Float32Array per rig instance (layout below). Animation writes it,
// blending lerps it, solveSkeleton() turns it into bone world matrices:
//   [ 0, nb*3 )        bone rotation offsets (Euler YXZ, added to the rest rotation)
//   [ nb*3, nb*6 )     bone translation offsets (added to the rest offset)
//   [ nb*6, nb*9 )     bone scale (1 = rest)
//   [ nb*9, +legs*3 )  IK foot target offsets from the leg's rest foot (root space)

export function restPose( T, out = new Float32Array( T.poseSize ) ) {

	out.fill( 0 );
	out.fill( 1, T.nb * 6, T.nb * 9 );
	return out;

}

const _L = new Float32Array( 12 ), _ik = new Float32Array( 6 ), _v = new Float32Array( 6 );

// pose -> world matrices W ( nb * 12 ). root: 3x4 matrix placing the rig in the world
// (position, facing, size). IK legs are solved after FK of their parents.
export function solveSkeleton( T, pose, root, W ) {

	const nb = T.nb, R = T.restPos, RR = T.restRot, par = T.parent, ikk = T.ikKind;
	const OFF = nb * 3, SCL = nb * 6;
	for ( let i = 0; i < nb; i ++ ) {

		const k = ikk[ i ];
		if ( k === 2 ) continue; // shins and feet: written by the IK pass below
		const i3 = i * 3, p = par[ i ];
		const tx = R[ i3 ] + pose[ OFF + i3 ], ty = R[ i3 + 1 ] + pose[ OFF + i3 + 1 ], tz = R[ i3 + 2 ] + pose[ OFF + i3 + 2 ];
		if ( k === 1 ) {

			// hips: only the joint position matters (IK overwrites the rotation)
			xformPoint( W, i * 12 + 9, W, p * 12, tx, ty, tz );
			continue;

		}

		const rx = RR[ i3 ] + pose[ i3 ], ry = RR[ i3 + 1 ] + pose[ i3 + 1 ], rz = RR[ i3 + 2 ] + pose[ i3 + 2 ];
		const sx = pose[ SCL + i3 ], sy = pose[ SCL + i3 + 1 ], sz = pose[ SCL + i3 + 2 ];
		if ( rx === 0 && ry === 0 && rz === 0 ) {

			// unrotated bones (many feet, hands, props) skip the trig
			_L[ 0 ] = sx; _L[ 1 ] = 0; _L[ 2 ] = 0; _L[ 3 ] = 0; _L[ 4 ] = sy; _L[ 5 ] = 0; _L[ 6 ] = 0; _L[ 7 ] = 0; _L[ 8 ] = sz;
			_L[ 9 ] = tx; _L[ 10 ] = ty; _L[ 11 ] = tz;

		} else composeYXZ( _L, 0, tx, ty, tz, rx, ry, rz, sx, sy, sz );
		if ( p < 0 ) mul( W, i * 12, root, 0, _L, 0 );
		else mul( W, i * 12, W, p * 12, _L, 0 );

	}

	// IK legs: thigh origin (the hip) comes from FK above; everything below is solved
	const legs = T.legs, FOOT = nb * 9;
	if ( ! legs.length ) return W;
	const s = Math.hypot( root[ 0 ], root[ 1 ], root[ 2 ] ); // uniform size of the rig
	for ( let l = 0; l < legs.length; l ++ ) {

		const L = legs[ l ], t = L.thigh * 12, sh = L.shin * 12;
		const hx = W[ t + 9 ], hy = W[ t + 10 ], hz = W[ t + 11 ];
		// foot target and pole from root-bone space (bone 0) to world
		const fx = L.rest[ 0 ] + pose[ FOOT + l * 3 ], fy = L.rest[ 1 ] + pose[ FOOT + l * 3 + 1 ], fz = L.rest[ 2 ] + pose[ FOOT + l * 3 + 2 ];
		xformPoint( _v, 0, W, 0, fx, fy, fz );
		xformDir( _v, 3, W, 0, L.pole[ 0 ], L.pole[ 1 ], L.pole[ 2 ] );
		solveTwoBone( _ik, hx, hy, hz, _v[ 0 ], _v[ 1 ], _v[ 2 ], L.a * s, L.b * s, _v[ 3 ], _v[ 4 ], _v[ 5 ] );
		basisFromDir( W, t, _ik[ 0 ] - hx, _ik[ 1 ] - hy, _ik[ 2 ] - hz, _v[ 3 ], _v[ 4 ], _v[ 5 ], s, hx, hy, hz );
		basisFromDir( W, sh, _ik[ 3 ] - _ik[ 0 ], _ik[ 4 ] - _ik[ 1 ], _ik[ 5 ] - _ik[ 2 ], _v[ 3 ], _v[ 4 ], _v[ 5 ], s, _ik[ 0 ], _ik[ 1 ], _ik[ 2 ] );
		if ( L.foot >= 0 ) {

			// feet stay level with the root (planted soles), plus their own pose rotation
			const f = L.foot, f3 = f * 3;
			composeYXZ( _L, 0, 0, 0, 0, pose[ f3 ], pose[ f3 + 1 ], pose[ f3 + 2 ], 1, 1, 1 );
			mul( W, f * 12, W, 0, _L, 0 );
			W[ f * 12 + 9 ] = _ik[ 3 ]; W[ f * 12 + 10 ] = _ik[ 4 ]; W[ f * 12 + 11 ] = _ik[ 5 ];

		}

	}

	return W;

}

// Arm IK (after solveSkeleton): pull the hand of an FK arm onto a point given in
// another bone's space (the off hand onto a two-handed haft). w blends from the FK
// hand position to the target. The elbow bends down and out (away from the body).
const _ik2 = new Float32Array( 6 ), _t = new Float32Array( 6 );
export function solveArmIK( T, W, up, fore, hand, targetBone, targetPos, w, s ) {

	const u = up * 12, f = fore * 12, h = hand * 12;
	const a = Math.hypot( T.restPos[ fore * 3 ], T.restPos[ fore * 3 + 1 ], T.restPos[ fore * 3 + 2 ] ) * s;
	const b = Math.hypot( T.restPos[ hand * 3 ], T.restPos[ hand * 3 + 1 ], T.restPos[ hand * 3 + 2 ] ) * s;
	xformPoint( _t, 0, W, targetBone * 12, targetPos[ 0 ], targetPos[ 1 ], targetPos[ 2 ] );
	const tx = W[ h + 9 ] + ( _t[ 0 ] - W[ h + 9 ] ) * w, ty = W[ h + 10 ] + ( _t[ 1 ] - W[ h + 10 ] ) * w, tz = W[ h + 11 ] + ( _t[ 2 ] - W[ h + 11 ] ) * w;
	const sx = W[ u + 9 ], sy = W[ u + 10 ], sz = W[ u + 11 ];
	// pole: the upper arm's current "out and down" direction (its -Y plus its local X)
	const side = T.restPos[ up * 3 ] >= 0 ? 1 : - 1;
	const px = - W[ u + 3 ] + W[ u ] * side * 0.6 - W[ u + 6 ] * 0.3, py = - W[ u + 4 ] + W[ u + 1 ] * side * 0.6 - W[ u + 7 ] * 0.3, pz = - W[ u + 5 ] + W[ u + 2 ] * side * 0.6 - W[ u + 8 ] * 0.3;
	solveTwoBone( _ik2, sx, sy, sz, tx, ty, tz, a, b, px, py, pz );
	// the hand takes the forearm's orientation and sits at the solved wrist
	basisFromDir( W, u, _ik2[ 0 ] - sx, _ik2[ 1 ] - sy, _ik2[ 2 ] - sz, px, py, pz, s, sx, sy, sz );
	basisFromDir( W, f, _ik2[ 3 ] - _ik2[ 0 ], _ik2[ 4 ] - _ik2[ 1 ], _ik2[ 5 ] - _ik2[ 2 ], px, py, pz, s, _ik2[ 0 ], _ik2[ 1 ], _ik2[ 2 ] );
	for ( let k = 0; k < 9; k ++ ) W[ h + k ] = W[ f + k ];
	W[ h + 9 ] = _ik2[ 3 ]; W[ h + 10 ] = _ik2[ 4 ]; W[ h + 11 ] = _ik2[ 5 ];

}

// Rest-pose bounds of the drawn body (root space, unscaled): the numbers
// genomeMetrics() reports, so collision and reach match what the player sees.
export function measure( T ) {

	const root = new Float32Array( 12 );
	setIdentity( root, 0 );
	const W = solveSkeleton( T, restPose( T ), root, new Float32Array( T.nb * 12 ) );
	const P = new Float32Array( 12 );
	let x0 = Infinity, x1 = - Infinity, y0 = Infinity, y1 = - Infinity, z0 = Infinity, z1 = - Infinity, vol = 0;
	for ( let i = 0; i < T.np; i ++ ) {

		if ( T.pFlags[ i ] & PF.MARKER ) continue;
		mul( P, 0, W, T.pBone[ i ] * 12, T.pLocal, i * 12 );
		for ( let c = 0; c < 8; c ++ ) {

			const cx = c & 1 ? 0.5 : - 0.5, cy = c & 2 ? 0.5 : - 0.5, cz = c & 4 ? 0.5 : - 0.5;
			const x = P[ 0 ] * cx + P[ 3 ] * cy + P[ 6 ] * cz + P[ 9 ];
			const y = P[ 1 ] * cx + P[ 4 ] * cy + P[ 7 ] * cz + P[ 10 ];
			const z = P[ 2 ] * cx + P[ 5 ] * cy + P[ 8 ] * cz + P[ 11 ];
			if ( x < x0 ) x0 = x; if ( x > x1 ) x1 = x;
			if ( y < y0 ) y0 = y; if ( y > y1 ) y1 = y;
			if ( z < z0 ) z0 = z; if ( z > z1 ) z1 = z;

		}

		// |det| of the part's 3x3 = its box volume; shapes fill roughly half of it
		const det = P[ 0 ] * ( P[ 4 ] * P[ 8 ] - P[ 5 ] * P[ 7 ] ) - P[ 3 ] * ( P[ 1 ] * P[ 8 ] - P[ 2 ] * P[ 7 ] ) + P[ 6 ] * ( P[ 1 ] * P[ 5 ] - P[ 2 ] * P[ 4 ] );
		vol += Math.abs( det ) * 0.5;

	}

	if ( x0 === Infinity ) {

		x0 = y0 = z0 = - 0.5; x1 = y1 = z1 = 0.5;

	}

	return { minX: x0, maxX: x1, minY: Math.max( 0, y0 ), maxY: y1, minZ: z0, maxZ: z1, width: x1 - x0, height: y1, length: z1 - z0, front: z1, back: - z0, volume: vol };

}

// Turn a plain part list ( docs/GAME.md §5 ) into a builder: used by the model
// library and by any feature that registers its own `model` defs.
//   { bones?: [ { name, parent?, pos?, rot?, fx? } ], parts: [ { shape, bone?, pos, rot, scale, color, emissive?, shade? } ] }
export function builderFromPartList( def, kind = 'prop' ) {

	const B = new RigBuilder( kind, def.id || '' );
	for ( const b of def.bones || [] ) B.bone( b.name, b.parent ?? 'root', b.pos || [ 0, 0, 0 ], { rot: b.rot, fx: b.fx || null, role: b.role } );
	for ( const p of def.parts || [] ) B.part( p.bone ?? 'root', p.shape, p.pos, p.rot, p.scale, p.color ?? 'primary', { emissive: p.emissive, shade: p.shade, flags: p.flags, shine: p.shine } );
	for ( const [ k, v ] of Object.entries( def.attach || {} ) ) B.point( k, v.bone ?? 'root', v.pos );
	return B;

}
