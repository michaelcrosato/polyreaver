// The level renderer (render system 'level', replaces the grey-box placeholder).
// Turns a Layout + theme into a handful of instanced draws:
//
//   floor     one box column per walkable tile (top at the floor height, 3 m deep so
//             pit edges show rock faces); per-instance colour, pattern and AO
//   ice       the same columns with the glossy ice material
//   liquid    lava / water planes over sunken basins; magma-tide basins sit lower
//   walls     edge walls (patterned, capped, cutaway) + "rock mass" blocks behind
//             them that fade the level into the dark
//   bridges   plank decks baked from a part list
//   props     every decor model of the theme, one instanced draw per model
//   halos     additive glow sprites on every light source
//   pit       one dark (or starry) plane far below everything
//   lighting  theme hemi + sun (+ shadows following the player), fog, background,
//             a light around the player, and the pooled point lights (lights.js)
//
// Mechanic objects, the swarm, the exit portal etc. are drawn by mech.js; this
// file only draws what never moves.

import * as THREE from 'three/webgpu';
import { fog, color, mix, smoothstep, positionWorld, uniform, vec3, screenUV, instancedBufferAttribute, float, hash, floor as tslFloor } from 'three/tsl';
import { define, get } from '../../../core/registry.js';
import { TILE } from '../../../core/layout.js';
import { themeFor } from '../themes.js';
import { walkable } from '../gen/grid.js';
import { bakeModel } from './bake.js';
import { U, floorMaterial, wallMaterial, lavaMaterial, waterMaterial, iceMaterial, pitMaterial, propMaterial, haloMaterial, halo } from './materials.js';
import { LightPool } from './lights.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color(), _v = new THREE.Vector3();
const SCORCH = new THREE.Color( 0.32, 0.12, 0.06 ); // basin floors lean toward it (Color.lerp needs a Color: a Vector3 gives NaN = black)
const UP = new THREE.Vector3( 0, 1, 0 );
const GAP = ( t ) => t === TILE.PIT || t === TILE.WATER || t === TILE.LAVA;

// Materials are cached by what makes them different (pattern, colour): a new level
// reuses compiled pipelines instead of building 30 shaders on every level change.
const MATERIALS = new Map();
export function cachedMaterial( key, make ) {

	let m = MATERIALS.get( key );
	if ( ! m ) {

		m = make();
		m.userData.cached = true;
		MATERIALS.set( key, m );

	}

	return m;

}

// per-tile deterministic random (stable across rebuilds)
const rnd = ( x, z, k = 0 ) => {

	const n = Math.sin( x * 127.1 + z * 311.7 + k * 74.7 ) * 43758.5453;
	return n - Math.floor( n );

};

export function poolSize() {

	const h = typeof location !== 'undefined' ? location.hash : '';
	const m = /lights=(\d+)/.exec( h );
	if ( m ) return Math.max( 0, Math.min( 64, + m[ 1 ] ) );
	if ( /clustered/.test( h ) ) return 48;
	const phone = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0 && Math.min( innerWidth, innerHeight ) < 820;
	return phone ? 6 : 12;

}

define( 'renderSystem', { id: 'level', order: 10,

	init( rc ) {

		rc.dynLights = [];
		this.fogColor = uniform( new THREE.Color( 0x000000 ) );
		this.fogNear = uniform( 20 );
		this.fogFar = uniform( 50 );
		this.skyTop = uniform( new THREE.Color( 0x000000 ) );
		this.skyBottom = uniform( new THREE.Color( 0x000000 ) );
		// fog by horizontal distance from the player: the level fades into its own
		// darkness around you, the same in every camera angle
		const d = positionWorld.xz.sub( U.focus.xz ).length();
		rc.scene.fogNode = fog( this.fogColor, smoothstep( this.fogNear, this.fogFar, d ) );
		rc.scene.background = null;
		rc.scene.backgroundNode = mix( this.skyBottom, this.skyTop, screenUV.y.oneMinus() );
		this.pool = new LightPool( rc.scene, poolSize() );
		this.playerLight = new THREE.PointLight( 0xffffff, 0, 9, 2 );
		this.playerLight.name = 'player-light';
		rc.scene.add( this.playerLight );
		this.sunDir = new THREE.Vector3( 0.4, 1, 0.3 ).normalize();
		this.focus = { x: 0, y: 0, z: 0, facing: 0 };

	},

	onWorld( rc, world ) {

		if ( rc.levelGroup ) {

			rc.scene.remove( rc.levelGroup );
			rc.levelGroup.traverse( ( o ) => {

				if ( o.userData.ownGeometry ) o.geometry?.dispose();
				if ( o.material && ! o.material.userData.cached ) o.material.dispose();

			} );

		}

		const L = world.layout;
		const theme = world.kind === 'town' ? get( 'theme', 'town' ) : themeFor( world.spec || { theme: L.theme } );
		rc.theme = theme;
		const group = new THREE.Group();
		group.name = 'Level';
		rc.levelGroup = group;
		U.cell.value = L.cell;
		U.origin.value.set( L.ox, L.oz );
		this.build( group, L, theme, world );
		rc.scene.add( group );
		this.applyLighting( rc, L, theme, world );

	},

	build( group, L, theme, world ) {

		const cell = L.cell;
		const solidTiles = new Set();
		for ( const p of L.props ) {

			if ( ! p.data?.solid ) continue;
			if ( p.data.footprint ) {

				const [ fx, fz, fw, fh ] = p.data.footprint;
				for ( let z = fz; z < fz + fh; z ++ ) for ( let x = fx; x < fx + fw; x ++ ) solidTiles.add( L.idx( x, z ) );

			} else {

				const [ tx, tz ] = L.toTile( p.x, p.z );
				solidTiles.add( L.idx( tx, tz ) );

			}

		}

		// --- floor columns ---------------------------------------------------------------
		const floors = [], ices = [], bases = [], lavas = [], waters = [], bridges = [];
		for ( let tz = 0; tz < L.h; tz ++ ) for ( let tx = 0; tx < L.w; tx ++ ) {

			const i = L.idx( tx, tz ), t = L.tiles[ i ];
			const low = L.elev?.[ i ] === - 1;
			// solid props (pillars, statues, houses) stand on floor, not on a hole
			if ( t === TILE.FLOOR || t === TILE.DOOR || ( t === TILE.WALL && solidTiles.has( i ) ) ) floors.push( [ tx, tz, low ? - 0.16 : 0 ] );
			else if ( t === TILE.ICE ) ices.push( [ tx, tz, low ? - 0.16 : 0 ] );
			else if ( t === TILE.LAVA ) {

				bases.push( [ tx, tz, - 0.7 ] );
				lavas.push( [ tx, tz ] );

			} else if ( t === TILE.WATER ) {

				bases.push( [ tx, tz, - 0.95 ] );
				waters.push( [ tx, tz ] );

			} else if ( t === TILE.BRIDGE ) {

				bridges.push( [ tx, tz ] );
				// keep the liquid flowing under a bridge
				let under = null;
				for ( const [ dx, dz ] of [ [ 1, 0 ], [ - 1, 0 ], [ 0, 1 ], [ 0, - 1 ] ] ) {

					const n = L.get( tx + dx, tz + dz );
					if ( n === TILE.LAVA || n === TILE.WATER ) under = n;

				}

				if ( under === TILE.LAVA ) {

					bases.push( [ tx, tz, - 0.7 ] );
					lavas.push( [ tx, tz ] );

				} else if ( under === TILE.WATER ) {

					bases.push( [ tx, tz, - 0.95 ] );
					waters.push( [ tx, tz ] );

				}

			}

		}

		const columnGeo = new THREE.BoxGeometry( cell, 3, cell );
		const styleOf = ( i ) => theme.floor[ L.style?.[ i ] ?? 0 ] || theme.floor[ 0 ];
		const columns = ( list, material, colorOf, patOf ) => {

			const n = list.length;
			if ( ! n ) return null;
			const mesh = new THREE.InstancedMesh( columnGeo, material, n );
			const col = new Float32Array( n * 3 ), pat = new Float32Array( n * 4 );
			list.forEach( ( [ tx, tz, top ], k ) => {

				const [ x, z ] = L.toWorld( tx, tz );
				const jitter = 0;
				mesh.setMatrixAt( k, _m.makeTranslation( x, top + jitter - 1.5, z ) );
				colorOf( tx, tz, _c );
				col.set( [ _c.r, _c.g, _c.b ], k * 3 );
				pat.set( patOf( tx, tz ), k * 4 );

			} );
			mesh.geometry = columnGeo.clone();
			mesh.geometry.setAttribute( 'aColor', new THREE.InstancedBufferAttribute( col, 3 ) );
			mesh.geometry.setAttribute( 'aPat', new THREE.InstancedBufferAttribute( pat, 4 ) );
			mesh.userData.ownGeometry = true;
			mesh.receiveShadow = true;
			group.add( mesh );
			return mesh;

		};

		const aoOf = ( tx, tz ) => 1 - ( L.ao?.[ L.idx( tx, tz ) ] ?? 0 ) / 255 * 0.4;
		columns( floors, cachedMaterial( 'floor', floorMaterial ), ( tx, tz, out ) => {

			const s = styleOf( L.idx( tx, tz ) );
			out.set( s.color ).multiplyScalar( ( ( s.tiles ?? 1 ) ? 0.94 + rnd( tx, tz, 2 ) * 0.12 : 0.98 + rnd( tx, tz, 2 ) * 0.04 ) * aoOf( tx, tz ) );
			if ( L.elev?.[ L.idx( tx, tz ) ] === - 1 ) out.multiplyScalar( 0.8 ).lerp( SCORCH, 0.18 ); // scorched basins

		}, ( tx, tz ) => {

			const s = styleOf( L.idx( tx, tz ) );
			return [ s.tiles ?? 1, s.grout ?? 0.5, s.noise ?? 0.3, s.gloss ?? 0.1 ];

		} );
		columns( ices, cachedMaterial( 'ice' + theme.liquid?.ice, () => iceMaterial( theme.liquid?.ice ?? '#a8c8e0' ) ), ( tx, tz, out ) => out.setScalar( aoOf( tx, tz ) * ( L.elev?.[ L.idx( tx, tz ) ] === - 1 ? 0.7 : 1 ) ), () => [ 0, 0, 0, 1 ] );
		const baseCol = new THREE.Color( theme.wall.mass ).multiplyScalar( 1.4 );
		columns( bases, cachedMaterial( 'floor', floorMaterial ), ( tx, tz, out ) => out.copy( baseCol ), () => [ 0, 0, 0.5, 0 ] );

		// --- liquid surfaces ------------------------------------------------------------------
		const plane = new THREE.PlaneGeometry( cell, cell ).rotateX( - Math.PI / 2 );
		const surface = ( list, material, y ) => {

			if ( ! list.length ) return;
			const mesh = new THREE.InstancedMesh( plane, material, list.length );
			list.forEach( ( [ tx, tz ], k ) => {

				const [ x, z ] = L.toWorld( tx, tz );
				mesh.setMatrixAt( k, _m.makeTranslation( x, y, z ) );

			} );
			mesh.receiveShadow = true;
			group.add( mesh );

		};

		surface( lavas, cachedMaterial( 'lava' + theme.liquid?.lava, () => lavaMaterial( theme.liquid?.lava ?? '#ff5a10' ) ), - 0.22 );
		surface( waters, cachedMaterial( 'water' + theme.liquid?.water, () => waterMaterial( theme.liquid?.water ?? '#204050' ) ), - 0.34 );

		// --- bridges ----------------------------------------------------------------------------
		if ( bridges.length ) {

			const geo = bakeModel( BRIDGE, null, 'bridge' );
			const mesh = new THREE.InstancedMesh( geo, cachedMaterial( 'prop', propMaterial ), bridges.length );
			bridges.forEach( ( [ tx, tz ], k ) => {

				const [ x, z ] = L.toWorld( tx, tz );
				// planks run across the gap: find which axis the gap runs along
				const alongX = GAP( L.get( tx, tz - 1 ) ) || GAP( L.get( tx, tz + 1 ) ) || ( walkable( L.get( tx - 1, tz ) ) && walkable( L.get( tx + 1, tz ) ) );
				mesh.setMatrixAt( k, _m.compose( _p.set( x, 0, z ), _q.setFromAxisAngle( UP, alongX ? Math.PI / 2 : 0 ), _s.set( 1, 1, 1 ) ) );

			} );
			setGlow( mesh, bridges.length, 0, 0 );
			mesh.castShadow = mesh.receiveShadow = true;
			group.add( mesh );

		}

		// --- walls and rock mass -------------------------------------------------------------------
		const wt = theme.wall;
		const walls = [];
		const near = ( tx, tz, r ) => {

			for ( let z = tz - r; z <= tz + r; z ++ ) for ( let x = tx - r; x <= tx + r; x ++ ) if ( L.get( x, z ) === TILE.WALL && ! solidTiles.has( L.idx( x, z ) ) ) return true;
			return false;

		};

		for ( let tz = - 2; tz < L.h + 2; tz ++ ) for ( let tx = - 2; tx < L.w + 2; tx ++ ) {

			const inside = L.inside( tx, tz );
			const t = inside ? L.tiles[ L.idx( tx, tz ) ] : TILE.VOID;
			if ( t === TILE.WALL && ! solidTiles.has( L.idx( tx, tz ) ) ) walls.push( [ tx, tz, 1 ] );
			else if ( t === TILE.VOID && near( tx, tz, 2 ) ) walls.push( [ tx, tz, 0 ] );

		}

		// Walls that stand between the camera (+z) and the floor are kept low - the
		// classic isometric "cut" - so rooms read clearly; the rest keep full height
		// and dissolve near the player instead (cutaway in the wall material).
		const front = ( tx, tz ) => {

			for ( let k = 1; k <= 3; k ++ ) if ( walkable( L.get( tx, tz - k ) ) || L.get( tx, tz - k ) === TILE.PIT ) return true;
			return false;

		};

		// Natural walls (rock, hedge, resin, crystal) are piles of overlapping boulders
		// with random turns - craggy instead of stair-stepped; built ones are blocks.
		const organic = wt.pattern !== 'brick' && wt.pattern !== 'panel';
		if ( walls.length ) {

			const geo = organic ? new THREE.DodecahedronGeometry( 1, 0 ) : new THREE.BoxGeometry( cell, 1, cell ).translate( 0, 0.5, 0 );
			const mesh = new THREE.InstancedMesh( geo, cachedMaterial( 'wall:' + wt.pattern, () => wallMaterial( wt.pattern ) ), walls.length );
			const side = new Float32Array( walls.length * 3 ), top = new Float32Array( walls.length * 3 ), info = new Float32Array( walls.length * 4 );
			const cSide = new THREE.Color( wt.color ), cTop = new THREE.Color( wt.top ), cMass = new THREE.Color( wt.mass );
			walls.forEach( ( [ tx, tz, edge ], k ) => {

				const [ x, z ] = L.toWorld( tx, tz );
				const jag = ( wt.jag ?? 0 ) * ( rnd( tx, tz, 3 ) - 0.3 );
				let h = Math.max( 0.6, wt.height * ( 1 + jag * 0.45 ) + ( edge ? 0 : 0.25 + rnd( tx, tz, 4 ) * ( wt.jag ?? 0 ) * 0.8 ) );
				if ( front( tx, tz ) ) h = Math.max( 0.5, h * 0.42 );
				if ( organic ) {

					const r = cell * ( 0.62 + rnd( tx, tz, 7 ) * 0.2 );
					_q.setFromEuler( new THREE.Euler( rnd( tx, tz, 8 ) * 6.28, rnd( tx, tz, 9 ) * 6.28, rnd( tx, tz, 10 ) * 6.28 ) );
					mesh.setMatrixAt( k, _m.compose( _p.set( x + ( rnd( tx, tz, 11 ) - 0.5 ) * 0.5, h * 0.42, z + ( rnd( tx, tz, 12 ) - 0.5 ) * 0.5 ), _q, _s.set( r, h * 0.62, r ) ) );

				} else {

					mesh.setMatrixAt( k, _m.compose( _p.set( x, 0, z ), _q.identity(), _s.set( 1, h, 1 ) ) );

				}

				const v = 0.9 + rnd( tx, tz, 5 ) * 0.2;
				_c.copy( edge ? cSide : cMass ).multiplyScalar( v );
				side.set( [ _c.r, _c.g, _c.b ], k * 3 );
				_c.copy( edge ? cTop : cMass ).multiplyScalar( edge ? v : v * 1.25 );
				top.set( [ _c.r, _c.g, _c.b ], k * 3 );
				info.set( [ edge, organic ? 99 : h, rnd( tx, tz, 6 ), 0 ], k * 4 );

			} );
			mesh.geometry = geo;
			geo.setAttribute( 'aColor', new THREE.InstancedBufferAttribute( side, 3 ) );
			geo.setAttribute( 'aTop', new THREE.InstancedBufferAttribute( top, 3 ) );
			geo.setAttribute( 'aWall', new THREE.InstancedBufferAttribute( info, 4 ) );
			mesh.userData.ownGeometry = true;
			mesh.castShadow = mesh.receiveShadow = true;
			group.add( mesh );

		}

		// --- the pit / the void below -------------------------------------------------------------------
		const span = Math.max( L.w, L.h ) * cell + 200;
		const pit = new THREE.Mesh( new THREE.PlaneGeometry( span, span ).rotateX( - Math.PI / 2 ), cachedMaterial( 'pit' + theme.liquid?.pit + theme.sky?.stars, () => pitMaterial( theme.liquid?.pit ?? '#050505', theme.sky?.stars ?? 0 ) ) );
		pit.position.y = world.kind === 'town' ? - 0.05 : - 6;
		pit.userData.ownGeometry = true;
		if ( world.kind === 'town' ) {

			// the town sits in a wide meadow, not in a void
			pit.material = new THREE.MeshStandardNodeMaterial( { roughness: 1 } );
			pit.material.colorNode = color( '#2c4220' );
			pit.receiveShadow = true;

		}

		group.add( pit );

		// --- props -------------------------------------------------------------------------------------
		const groups = new Map();
		for ( const p of L.props ) {

			if ( p.data?.mechanic ) continue; // entity-backed: drawn by mech.js
			const key = p.type + '|' + ( p.data?.roof ?? '' ) + ( p.data?.canopy ?? '' );
			if ( ! groups.has( key ) ) groups.set( key, [] );
			groups.get( key ).push( p );

		}

		for ( const [ key, list ] of groups ) {

			const def = get( 'model', list[ 0 ].type );
			if ( ! def ) continue;
			const pal = { ...theme.palette, roof: list[ 0 ].data?.roof, canopy: list[ 0 ].data?.canopy };
			const geo = bakeModel( def, pal, theme.id + ( theme.shift ? JSON.stringify( theme.shift ) : '' ) + key );
			const mesh = new THREE.InstancedMesh( geo, cachedMaterial( 'prop', propMaterial ), list.length );
			const isLight = def.tags?.includes( 'light' );
			list.forEach( ( p, k ) => {

				let sx = p.scale ?? 1, sz = sx, sy = sx;
				if ( def.footprint && p.data?.footprint ) {

					const [ , , fw, fh ] = p.data.footprint;
					const quarter = Math.abs( Math.sin( p.rot || 0 ) ) > 0.7;
					const size = def.size || [ 6, 6 ];
					sx = ( quarter ? fh : fw ) * cell / size[ 0 ];
					sz = ( quarter ? fw : fh ) * cell / size[ 1 ];
					sy = 1;

				}

				mesh.setMatrixAt( k, _m.compose( _p.set( p.x, 0, p.z ), _q.setFromAxisAngle( UP, p.rot || 0 ), _s.set( sx, sy, sz ) ) );

			} );
			setGlow( mesh, list.length, 1, isLight ? 0.35 : 0.08 );
			mesh.castShadow = ! isLight;
			mesh.receiveShadow = true;
			group.add( mesh );

		}

		// --- halos on light sources -----------------------------------------------------------------------
		const lights = L.lights;
		if ( lights.length ) {

			const pos = new Float32Array( lights.length * 3 ), col = new Float32Array( lights.length * 3 ), size = new Float32Array( lights.length );
			lights.forEach( ( l, k ) => {

				const y = l.kind === 'glow' ? 0.6 : l.y + ( l.kind === 'torch' ? 0.35 : l.kind === 'brazier' ? 0.1 : 0 );
				pos.set( [ l.x, y, l.z ], k * 3 );
				_c.set( l.color ).multiplyScalar( l.kind === 'glow' ? 0.25 : 0.55 );
				col.set( [ _c.r, _c.g, _c.b ], k * 3 );
				size[ k ] = l.kind === 'glow' ? 4 : l.kind === 'beacon' || l.kind === 'forge' ? 5 : l.kind === 'window' ? 1.6 : 2.4;

			} );
			group.add( haloSprites( pos, col, size ) );

		}

	},

	applyLighting( rc, L, theme, world ) {

		const lt = theme.lighting;
		const dark = !! L.meta?.dark;
		rc.hemi.color.set( lt.sky );
		rc.hemi.groundColor.set( lt.ground );
		rc.hemi.intensity = lt.hemi * ( dark ? 0.2 : 1 );
		rc.sun.color.set( lt.sunColor );
		rc.sun.intensity = lt.sun * ( dark ? 0.06 : 1 );
		this.sunDir.set( ...lt.sunDir ).normalize();
		rc.renderer.toneMappingExposure = lt.exposure ?? 1;
		this.fogColor.value.set( dark ? '#000000' : theme.fog.color );
		this.fogNear.value = dark ? 7 : theme.fog.near;
		this.fogFar.value = dark ? 21 : theme.fog.far;
		this.skyTop.value.set( dark ? '#000000' : theme.sky.top );
		this.skyBottom.value.set( dark ? '#000000' : theme.fog.color );
		const pl = lt.player || {};
		this.playerLight.color.set( pl.color ?? '#ffffff' );
		this.playerLight.intensity = dark ? 48 : pl.intensity ?? 4;
		this.playerLight.distance = dark ? 16 : pl.range ?? 8;
		this.sources = L.lights.map( ( l ) => ( { ...l, color: new THREE.Color( l.color ) } ) );
		rc.worldLight = { dark, theme: theme.id };

	},

	update( rc, world, alpha ) {

		const p = world.player;
		const f = p ? rc.lerp( p, this.focus ) : this.focus;
		U.time.value = world.time + alpha / 60;
		U.focus.value.set( f.x, 0, f.z );
		U.aspect.value = rc.camera.aspect;
		// cutaway target: the player's chest, in screen space and view depth
		_v.set( f.x, 1.1, f.z ).applyMatrix4( rc.camera.matrixWorldInverse );
		U.playerViewZ.value = _v.z;
		_v.set( f.x, 1.1, f.z ).project( rc.camera );
		U.playerUV.value.set( _v.x * 0.5 + 0.5, 0.5 - _v.y * 0.5 );
		U.cutRadius.value = 0.1;

		// the sun (and its shadow camera) follows the player
		const sun = rc.sun;
		sun.position.set( f.x + this.sunDir.x * 40, this.sunDir.y * 40, f.z + this.sunDir.z * 40 );
		sun.target.position.set( f.x, 0, f.z );
		sun.target.updateMatrixWorld();

		this.playerLight.position.set( f.x, 2.4, f.z );

	}
} );

// Assigns the light pool after every other system had the chance to add dynamic lights.
define( 'renderSystem', { id: 'world-lights', order: 45,
	update( rc, world ) {

		const lvl = get( 'renderSystem', 'level' );
		if ( ! lvl?.pool ) return;
		const f = lvl.focus;
		const all = rc.dynLights.length ? lvl.sources.concat( rc.dynLights.map( ( l ) => ( { ...l, color: l.color?.isColor ? l.color : new THREE.Color( l.color ?? 0xffffff ) } ) ) ) : lvl.sources;
		lvl.pool.update( all || [], f.x, f.z, world.time );
		// consumed: systems running before this one add this frame's lights, later ones
		// (order > 45) land in the next frame's assignment
		rc.dynLights.length = 0;

	}
} );

// Instance attribute for propMaterial: ( glow multiplier, flicker amount ). Baked
// geometry is cached and shared, so each mesh gets a light wrapper geometry that
// reuses the baked vertex buffers and adds its own per-instance attribute.
export function setGlow( mesh, n, g = 1, flicker = 0 ) {

	const a = new Float32Array( n * 2 );
	for ( let i = 0; i < n; i ++ ) {

		a[ i * 2 ] = g; a[ i * 2 + 1 ] = flicker;

	}

	const attr = new THREE.InstancedBufferAttribute( a, 2 );
	attr.setUsage( THREE.DynamicDrawUsage );
	const base = mesh.geometry, wrap = new THREE.BufferGeometry();
	for ( const k in base.attributes ) if ( k !== 'aGlow' ) wrap.setAttribute( k, base.attributes[ k ] );
	wrap.boundingSphere = base.boundingSphere;
	wrap.setAttribute( 'aGlow', attr );
	mesh.geometry = wrap;
	return attr;

}

// Additive glow sprites: one instanced draw for every halo in the level.
export function haloSprites( pos, col, size ) {

	const n = size.length;
	const mat = haloMaterial();
	const p = instancedBufferAttribute( new THREE.InstancedBufferAttribute( pos, 3 ) );
	mat.positionNode = p;
	mat.scaleNode = instancedBufferAttribute( new THREE.InstancedBufferAttribute( size, 1 ) );
	const seed = hash( tslFloor( p.x.mul( 7 ).add( p.z.mul( 13 ) ) ) ).mul( 40 );
	const flick = float( 0.85 ).add( U.time.mul( 9 ).add( seed ).sin().mul( 0.15 ) );
	mat.colorNode = vec3( instancedBufferAttribute( new THREE.InstancedBufferAttribute( col, 3 ) ) ).mul( halo() ).mul( flick );
	const sprite = new THREE.Sprite( mat );
	sprite.count = n;
	sprite.frustumCulled = false;
	sprite.renderOrder = 5;
	return sprite;

}

// Plank bridge deck (planks across, two side beams along), authored for one tile.
const BRIDGE = { id: 'tile-bridge', parts: [
	{ shape: 'box', pos: [ 0, - 0.08, - 0.75 ], scale: [ 2, 0.12, 0.42 ], color: '#6a4a2c' }, { shape: 'box', pos: [ 0, - 0.08, - 0.25 ], scale: [ 2, 0.12, 0.42 ], color: '#5e4228' },
	{ shape: 'box', pos: [ 0, - 0.08, 0.25 ], scale: [ 2, 0.12, 0.42 ], color: '#6a4a2c' }, { shape: 'box', pos: [ 0, - 0.08, 0.75 ], scale: [ 2, 0.12, 0.42 ], color: '#5e4228' },
	{ shape: 'box', pos: [ - 0.95, 0.1, 0 ], scale: [ 0.12, 0.2, 2 ], color: '#4a3020' }, { shape: 'box', pos: [ 0.95, 0.1, 0 ], scale: [ 0.12, 0.2, 2 ], color: '#4a3020' },
	{ shape: 'box', pos: [ 0, - 0.3, 0 ], scale: [ 1.6, 0.3, 0.2 ], color: '#3a2618' }
] };

// '#clustered': switch the renderer to Forward+ clustered lighting (three's
// ClusteredLighting) - the light pool grows to 48 and the lamp-lit town shows off.
define( 'bootHook', { id: 'world-lighting', order: 5, async boot( { renderer } ) {

	if ( typeof location === 'undefined' || ! /clustered/.test( location.hash ) ) return;
	const { ClusteredLighting } = await import( 'three/addons/lighting/ClusteredLighting.js' );
	renderer.lighting = new ClusteredLighting( 64 );

} } );
