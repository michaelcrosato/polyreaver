// The "set dressing": ground, a few cheap instanced props, lights, sky, fog,
// environment. Everything here is deliberately cheap - the crowd is the star.

import * as THREE from 'three/webgpu';
import {
	Fn, float, vec2, vec3, uniform, positionWorld, positionWorldDirection, floor, fract, sin, dot, mix,
	smoothstep, min, abs, length, fog, color, max, pow, exponentialHeightFogFactor, clamp, fwidth
} from 'three/tsl';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export const SHADING_KINDS = [ 'unlit', 'lambert', 'phong', 'standard', 'physical', 'toon' ];

export function makeMaterial( kind, params = {} ) {

	const common = { ...params };
	switch ( kind ) {

		case 'lambert': return new THREE.MeshLambertNodeMaterial( common );
		case 'phong': return new THREE.MeshPhongNodeMaterial( { shininess: 30, ...common } );
		case 'standard': return new THREE.MeshStandardNodeMaterial( { roughness: 0.8, metalness: 0, ...common } );
		case 'physical': return new THREE.MeshPhysicalNodeMaterial( { roughness: 0.7, metalness: 0, ...common } );
		case 'toon': return new THREE.MeshToonNodeMaterial( common );
		default: return new THREE.MeshBasicNodeMaterial( common );

	}

}

// Classic float hash for procedural patterns (works for negative coordinates).
const hash2 = ( p ) => fract( sin( dot( p, vec2( 12.9898, 78.233 ) ) ).mul( 43758.5453 ) );

// --- tiny procedural prop geometries (vertex coloured, non-indexed merge) ------
function coloredGeometry( parts ) {

	const positions = [];
	const colors = [];
	for ( const { geometry, color: c, matrix } of parts ) {

		const g = geometry.index ? geometry.toNonIndexed() : geometry;
		if ( matrix ) g.applyMatrix4( matrix );
		const pos = g.getAttribute( 'position' );
		const col = new THREE.Color( c );
		for ( let i = 0; i < pos.count; i ++ ) {

			positions.push( pos.getX( i ), pos.getY( i ), pos.getZ( i ) );
			colors.push( col.r, col.g, col.b );

		}

	}

	const out = new THREE.BufferGeometry();
	out.setAttribute( 'position', new THREE.Float32BufferAttribute( positions, 3 ) );
	out.setAttribute( 'color', new THREE.Float32BufferAttribute( colors, 3 ) );
	out.computeVertexNormals();
	out.userData.triangles = positions.length / 9;
	return out;

}

function treeGeometry() {

	const m = new THREE.Matrix4();
	return coloredGeometry( [
		{ geometry: new THREE.CylinderGeometry( 0.18, 0.25, 2.2, 5, 1 ), color: 0x6b4a2f, matrix: m.clone().makeTranslation( 0, 1.1, 0 ) },
		{ geometry: new THREE.ConeGeometry( 2.0, 3.2, 6, 1 ), color: 0x2f6b35, matrix: m.clone().makeTranslation( 0, 3.4, 0 ) },
		{ geometry: new THREE.ConeGeometry( 1.5, 2.6, 6, 1 ), color: 0x3b7d3f, matrix: m.clone().makeTranslation( 0, 4.8, 0 ) }
	] );

}

function lampGeometry() {

	const m = new THREE.Matrix4();
	return coloredGeometry( [
		{ geometry: new THREE.CylinderGeometry( 0.08, 0.12, 4.2, 4, 1 ), color: 0x2c2f36, matrix: m.clone().makeTranslation( 0, 2.1, 0 ) },
		{ geometry: new THREE.BoxGeometry( 0.9, 0.12, 0.12 ), color: 0x2c2f36, matrix: m.clone().makeTranslation( 0.35, 4.1, 0 ) }
	] );

}

function monumentGeometry() {

	const m = new THREE.Matrix4();
	const stone = 0xc9c2b4, dark = 0x8e877a;
	return coloredGeometry( [
		{ geometry: new THREE.CylinderGeometry( 6.5, 7, 0.4, 8, 1 ), color: dark, matrix: m.clone().makeTranslation( 0, 0.2, 0 ) },
		{ geometry: new THREE.CylinderGeometry( 5.2, 5.5, 0.5, 8, 1 ), color: stone, matrix: m.clone().makeTranslation( 0, 0.65, 0 ) },
		{ geometry: new THREE.CylinderGeometry( 1.0, 1.4, 1.2, 4, 1 ), color: dark, matrix: m.clone().makeTranslation( 0, 1.5, 0 ) },
		{ geometry: new THREE.CylinderGeometry( 0.25, 0.9, 9, 4, 1 ), color: stone, matrix: m.clone().makeTranslation( 0, 6.6, 0 ) },
		{ geometry: new THREE.ConeGeometry( 0.35, 0.8, 4, 1 ), color: 0xd8b84a, matrix: m.clone().makeTranslation( 0, 11.5, 0 ) }
	] );

}

export class World {

	constructor( renderer, scene ) {

		this.renderer = renderer;
		this.scene = scene;
		this.kind = 'unlit';
		this.shadowsOn = false;
		this.propsOn = true;
		this.groundDetail = true;
		this.radius = 60;
		this.maxRadius = 60;

		this.u = {
			bg: uniform( new THREE.Color( 0x9fb3c2 ) ),
			fogNear: uniform( 40 ),
			fogFar: uniform( 160 ),
			fogCenter: uniform( new THREE.Vector3() ),
			fogDensity: uniform( 0.35 ),
			fogHeight: uniform( 3 ),
			groundWet: uniform( 0 )
		};

		// --- lights -------------------------------------------------------------
		this.sunDir = new THREE.Vector3( - 0.45, 0.8, 0.35 ).normalize();
		this.sun = new THREE.DirectionalLight( 0xfff1dc, 2.2 );
		this.sun.name = 'Sun';
		this.sun.shadow.camera.near = 1;
		this.sun.shadow.camera.far = 600;
		this.sun.shadow.bias = - 0.0005;
		this.sun.shadow.normalBias = 0.02;
		scene.add( this.sun, this.sun.target );

		this.hemi = new THREE.HemisphereLight( 0xcfe4ff, 0x5a4a3a, 0.9 );
		scene.add( this.hemi );

		this.pointLights = [];
		this.lampPositions = [];

		// --- ground -------------------------------------------------------------
		this.groundGeometry = new THREE.CircleGeometry( 1, 96 ).rotateX( - Math.PI / 2 );
		this.ground = new THREE.Mesh( this.groundGeometry );
		this.ground.name = 'Ground';
		this.ground.matrixAutoUpdate = false;
		scene.add( this.ground );

		// --- props ----------------------------------------------------------------
		this.treeGeo = treeGeometry();
		this.lampGeo = lampGeometry();
		this.monument = new THREE.Mesh( monumentGeometry() );
		this.monument.name = 'Monument';
		this.monument.position.set( 0, 0, - 14 );
		scene.add( this.monument );

		// --- sky ----------------------------------------------------------------
		this.skyMode = 'flat';
		this.skyMesh = null;
		this.envTexture = null;

		this.setShading( 'unlit' );

	}

	get propTriangles() {

		if ( ! this.propsOn ) return 0;
		return ( this.trees ? this.trees.count * this.treeGeo.userData.triangles : 0 ) +
			( this.lamps ? this.lamps.count * this.lampGeo.userData.triangles : 0 ) +
			this.monument.geometry.userData.triangles;

	}

	// Props are scattered once for the largest world we might need, sorted by
	// distance from the centre, and `count` exposes only those inside the radius.
	ensureCapacity( maxRadius ) {

		if ( maxRadius <= this.maxRadius && this.trees ) return;
		this.maxRadius = Math.max( maxRadius, 60 );

		const place = ( spacing, skip, seed, minR ) => {

			const pts = [];
			const n = Math.ceil( this.maxRadius / spacing );
			let s = seed;
			const rnd = () => ( ( s = ( s * 16807 ) % 2147483647 ) / 2147483647 );
			for ( let gx = - n; gx <= n; gx ++ ) for ( let gz = - n; gz <= n; gz ++ ) {

				const x = ( gx + rnd() * 0.8 - 0.4 ) * spacing;
				const z = ( gz + rnd() * 0.8 - 0.4 ) * spacing;
				const r = Math.hypot( x, z );
				if ( rnd() < skip || r > this.maxRadius || r < minR ) continue;
				pts.push( { x, z, r, rot: rnd() * Math.PI * 2, s: 0.8 + rnd() * 0.5 } );

			}

			pts.sort( ( a, b ) => a.r - b.r );
			return pts;

		};

		this.treePts = place( 26, 0.45, 12345, 18 );
		this.lampPts = place( 34, 0.0, 777, 12 );
		this.lampPositions = this.lampPts.map( ( p ) => new THREE.Vector3( p.x + Math.cos( p.rot ) * 0.7, 4.0, p.z - Math.sin( p.rot ) * 0.7 ) );

		const build = ( old, geometry, pts, name ) => {

			if ( old ) {

				this.scene.remove( old );
				old.dispose();

			}

			const mesh = new THREE.InstancedMesh( geometry, this._propMaterial(), Math.max( 1, pts.length ) );
			const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
			pts.forEach( ( pt, i ) => {

				q.setFromAxisAngle( new THREE.Vector3( 0, 1, 0 ), pt.rot );
				mesh.setMatrixAt( i, m.compose( p.set( pt.x, 0, pt.z ), q, sc.setScalar( pt.s ) ) );

			} );
			mesh.instanceMatrix.needsUpdate = true;
			mesh.name = name;
			mesh.frustumCulled = false;
			this.scene.add( mesh );
			return mesh;

		};

		this.trees = build( this.trees, this.treeGeo, this.treePts, 'Trees' );
		this.lamps = build( this.lamps, this.lampGeo, this.lampPts, 'Lamps' );
		this._applyProps();
		this._applyShadowFlags();

	}

	setRadius( r ) {

		this.radius = r;
		this.ensureCapacity( r );
		const gr = r + 80;
		this.ground.matrix.makeScale( gr, 1, gr );
		this.ground.matrixWorldNeedsUpdate = true;
		this._applyProps();

	}

	_applyProps() {

		if ( ! this.trees ) return;
		const within = ( pts ) => {

			let lo = 0, hi = pts.length;
			while ( lo < hi ) {

				const mid = ( lo + hi ) >> 1;
				if ( pts[ mid ].r < this.radius ) lo = mid + 1; else hi = mid;

			}

			return lo;

		};

		this.trees.count = within( this.treePts );
		this.lamps.count = within( this.lampPts );
		this.trees.visible = this.lamps.visible = this.monument.visible = this.propsOn;

	}

	setProps( on ) {

		this.propsOn = on;
		this._applyProps();

	}

	// --- materials -----------------------------------------------------------
	_groundColorNode() {

		const u = this.u;
		return Fn( () => {

			const p = positionWorld.xz;
			const base = vec3( 0.18, 0.17, 0.15 );
			if ( ! this.groundDetail ) return base;
			const tile = p.div( 2.5 );
			const cell = floor( tile );
			const f = fract( tile );
			// Anti-aliased grout: line width measured in screen pixels via fwidth(),
			// faded out once tiles are only a few pixels wide (avoids moiré).
			const fw = fwidth( tile ).x.max( 1e-4 );
			const edge = min( min( f.x, float( 1 ).sub( f.x ) ), min( f.y, float( 1 ).sub( f.y ) ) );
			const grout = smoothstep( fw.mul( 0.5 ), fw.mul( 1.5 ).add( 0.015 ), edge );
			const groutFade = smoothstep( 0.25, 0.08, fw );
			const n = hash2( cell );
			const stone = mix( vec3( 0.58, 0.55, 0.5 ), vec3( 0.68, 0.64, 0.57 ), n );
			// wide paving rings every 24 m for a plaza feel
			const r = length( p );
			const ringD = abs( fract( r.div( 24 ) ).sub( 0.5 ) ).mul( 24 );
			const ring = smoothstep( 10.6, 11.4, ringD );
			const col = mix( stone, vec3( 0.5, 0.46, 0.42 ), ring.mul( 0.7 ) );
			const withGrout = mix( col, vec3( 0.4, 0.38, 0.35 ), float( 1 ).sub( grout ).mul( groutFade ) );
			// darker when "wet" (used with SSR); authored in sRGB -> linear
			return pow( mix( withGrout, withGrout.mul( 0.5 ), u.groundWet ), vec3( 2.2 ) );

		} )();

	}

	_propMaterial() {

		const mat = makeMaterial( this.kind, { vertexColors: true } );
		mat.name = 'Prop_' + this.kind;
		return mat;

	}

	setShading( kind ) {

		this.kind = kind;
		const gm = makeMaterial( kind );
		gm.colorNode = this._groundColorNode();
		if ( gm.isMeshStandardNodeMaterial ) {

			gm.roughnessNode = mix( float( 0.85 ), float( 0.12 ), this.u.groundWet );
			gm.metalnessNode = mix( float( 0.0 ), float( 0.35 ), this.u.groundWet );

		}

		gm.name = 'Ground_' + kind;
		if ( this.ground.material ) this.ground.material.dispose();
		this.ground.material = gm;

		if ( this.monument.material ) this.monument.material.dispose();
		this.monument.material = this._propMaterial();
		for ( const mesh of [ this.trees, this.lamps ] ) {

			if ( ! mesh ) continue;
			mesh.material.dispose();
			mesh.material = this._propMaterial();

		}

	}

	setGroundDetail( on ) {

		this.groundDetail = on;
		this.setShading( this.kind );

	}

	setWet( on ) {

		this.u.groundWet.value = on ? 1 : 0;

	}

	// --- lights / shadows ----------------------------------------------------
	setHemisphere( on ) {

		this.hemi.visible = on;

	}

	setShadows( mode ) {

		// mode: off | low | medium | high | ultra
		const cfg = {
			off: null,
			low: { size: 1024, type: THREE.BasicShadowMap, radius: 1 },
			medium: { size: 2048, type: THREE.PCFShadowMap, radius: 2 },
			high: { size: 4096, type: THREE.PCFShadowMap, radius: 4 }, // r186 folded PCFSoft into PCF + radius
			vsm: { size: 2048, type: THREE.VSMShadowMap, radius: 6 }
		}[ mode ];

		this.shadowsOn = !! cfg;
		this.renderer.shadowMap.enabled = this.shadowsOn;
		this.sun.castShadow = this.shadowsOn;
		if ( cfg ) {

			this.renderer.shadowMap.type = cfg.type;
			if ( this.sun.shadow.mapSize.x !== cfg.size ) {

				this.sun.shadow.mapSize.set( cfg.size, cfg.size );
				if ( this.sun.shadow.map ) {

					this.sun.shadow.map.dispose();
					this.sun.shadow.map = null;

				}

			}

			this.sun.shadow.radius = cfg.radius;
			this.sun.shadow.blurSamples = 8;

		}

		this._applyShadowFlags();

	}

	// Shadow filter type / map size are baked into the lighting shaders; replacing the
	// light is the simplest way to guarantee every material picks up the change.
	recreateSun() {

		const old = this.sun;
		const sun = new THREE.DirectionalLight( old.color, old.intensity );
		sun.name = 'Sun';
		sun.castShadow = old.castShadow;
		sun.shadow.mapSize.copy( old.shadow.mapSize );
		sun.shadow.radius = old.shadow.radius;
		sun.shadow.blurSamples = old.shadow.blurSamples;
		sun.shadow.bias = old.shadow.bias;
		sun.shadow.normalBias = old.shadow.normalBias;
		sun.shadow.camera.near = 1;
		sun.shadow.camera.far = 600;
		sun.position.copy( old.position );
		sun.target.position.copy( old.target.position );
		this.scene.remove( old, old.target );
		old.dispose();
		this.scene.add( sun, sun.target );
		this.sun = sun;

	}

	_applyShadowFlags() {

		const on = this.shadowsOn;
		this.ground.receiveShadow = on;
		this.monument.castShadow = this.monument.receiveShadow = on;
		for ( const mesh of [ this.trees, this.lamps ] ) {

			if ( mesh ) mesh.castShadow = mesh.receiveShadow = on;

		}

	}

	setPointLights( n ) {

		for ( const l of this.pointLights ) this.scene.remove( l );
		this.pointLights = [];
		const palette = [ 0xffc27a, 0xffb060, 0xffe0a0, 0xff9e6b ];
		for ( let i = 0; i < n; i ++ ) {

			const l = new THREE.PointLight( palette[ i % palette.length ], 60, 16, 2 );
			l.name = 'Lamp light ' + i;
			this.scene.add( l );
			this.pointLights.push( l );

		}

		this._lightTimer = 0;

	}

	// --- sky / environment / fog ----------------------------------------------
	setSky( mode ) {

		this.skyMode = mode;
		const scene = this.scene;
		scene.background = null;
		scene.backgroundNode = null;
		if ( this.skyMesh ) {

			scene.remove( this.skyMesh );
			this.skyMesh.material.dispose();
			this.skyMesh = null;

		}

		if ( mode === 'gradient' ) {

			const d = positionWorldDirection;
			const t = clamp( d.y.mul( 1.4 ).add( 0.1 ), 0, 1 );
			const sunGlow = pow( max( dot( d, vec3( this.sunDir.x, this.sunDir.y, this.sunDir.z ) ), 0 ), 64 ).mul( 1.5 );
			scene.backgroundNode = mix( vec3( 0.78, 0.84, 0.88 ), vec3( 0.25, 0.45, 0.78 ), t ).add( vec3( 1, 0.9, 0.7 ).mul( sunGlow ) );

		} else if ( mode === 'physical' ) {

			const sky = new SkyMesh();
			sky.scale.setScalar( 4500 );
			sky.sunPosition.value.copy( this.sunDir );
			sky.turbidity.value = 4;
			sky.rayleigh.value = 1.2;
			sky.frustumCulled = false;
			scene.add( sky );
			this.skyMesh = sky;
			scene.background = new THREE.Color( 0x9fb3c2 );

		} else {

			scene.background = new THREE.Color( 0x9fb3c2 );

		}

	}

	setEnvironment( on ) {

		if ( on && ! this.envTexture ) {

			const pmrem = new THREE.PMREMGenerator( this.renderer );
			const env = new RoomEnvironment();
			this.envTexture = pmrem.fromScene( env, 0.04 ).texture;
			env.dispose();
			pmrem.dispose();

		}

		this.scene.environment = on ? this.envTexture : null;
		this.scene.environmentIntensity = 0.4;

	}

	setFog( mode ) {

		const u = this.u;
		const fogColor = color( 0xb4c3cf );
		if ( mode === 'distance' ) {

			// Distance from the player/camera focus rather than from the camera itself,
			// so it behaves the same in orthographic (isometric) and perspective views.
			const d = length( positionWorld.sub( u.fogCenter ) );
			this.scene.fogNode = fog( fogColor, smoothstep( u.fogNear, u.fogFar, d ) );

		} else if ( mode === 'height' ) {

			this.scene.fogNode = fog( color( 0xc9d4dc ), exponentialHeightFogFactor( u.fogDensity.mul( 0.2 ), u.fogHeight ) );

		} else {

			this.scene.fogNode = null;

		}

	}

	// --- per frame -----------------------------------------------------------
	update( dt, focus, camera, viewExtent ) {

		// Sun + shadow camera follow the focus point so the shadow map only covers
		// what is on screen (a single directional shadow over a 1 km crowd would be
		// hopelessly blurry).
		const ext = Math.min( Math.max( viewExtent, 12 ), 400 );
		const sc = this.sun.shadow.camera;
		const size = this.sun.shadow.mapSize.x;
		const texel = ( 2 * ext ) / size;
		const snapped = new THREE.Vector3(
			Math.round( focus.x / texel ) * texel, 0, Math.round( focus.z / texel ) * texel );
		this.sun.target.position.copy( snapped );
		this.sun.position.copy( snapped ).addScaledVector( this.sunDir, 250 );
		sc.left = sc.bottom = - ext;
		sc.right = sc.top = ext;
		sc.near = 1;
		sc.far = 600;
		sc.updateProjectionMatrix();

		const u = this.u;
		if ( camera.isPerspectiveCamera ) u.fogCenter.value.copy( camera.position );
		else u.fogCenter.value.copy( focus );
		u.fogNear.value = Math.max( 20, viewExtent * 0.35 );
		u.fogFar.value = Math.max( 60, viewExtent * 1.25 );

		if ( this.skyMesh ) this.skyMesh.position.copy( camera.position );

		// Assign the point-light pool to the lamp posts nearest the focus.
		if ( this.pointLights.length ) {

			this._lightTimer -= dt;
			if ( this._lightTimer <= 0 ) {

				this._lightTimer = 0.3;
				const f = focus;
				const near = this.lampPositions
					.slice( 0, Math.min( this.lampPositions.length, this.lamps ? this.lamps.count : 0 ) )
					.map( ( p ) => ( { p, d: ( p.x - f.x ) ** 2 + ( p.z - f.z ) ** 2 } ) )
					.sort( ( a, b ) => a.d - b.d );
				this.pointLights.forEach( ( l, i ) => {

					if ( i < near.length ) {

						l.position.copy( near[ i ].p );
						l.visible = true;

					} else {

						// not enough lamps: orbit the focus instead
						const a = ( i / this.pointLights.length ) * Math.PI * 2;
						l.position.set( f.x + Math.cos( a ) * 12, 3, f.z + Math.sin( a ) * 12 );

					}

				} );

			}

		}

	}

}
