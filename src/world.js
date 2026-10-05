// The "set dressing": ground, a few cheap instanced props, lights, sky, fog,
// environment. Everything here is deliberately cheap - the crowd is the star.

import * as THREE from 'three/webgpu';
import { float, uniform, mix } from 'three/tsl';
import { makeMaterial, groundColorNode, propMaterial } from './world/materials.js';
import { treeGeometry, lampGeometry, monumentGeometry } from './world/geometry.js';
import {
	applyShadowMode, replaceSun, rebuildPointLights, applySky, applyEnvironment, applyFog, updateSun, updatePointLights
} from './world/lighting.js';

// Re-exported so existing importers (e.g. physics.js) keep importing from './world.js'.
export { SHADING_KINDS, makeMaterial } from './world/materials.js';

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

		if ( this.cityView ) return this.cityView.traffic.triangles + this.cityView.meshes.filter( ( mesh ) => mesh.visible && ! mesh.userData.cityCars ).reduce( ( sum, mesh ) => sum + ( mesh.geometry.index?.count || mesh.geometry.attributes.position.count ) / 3 * ( mesh.isInstancedMesh ? mesh.count : 1 ), 0 );
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

		if ( this.cityView ) { this.radius = 1450; return; }
		this.radius = r;
		this.ensureCapacity( r );
		const gr = r + 80;
		this.ground.matrix.makeScale( gr, 1, gr );
		this.ground.matrixWorldNeedsUpdate = true;
		this._applyProps();

	}

	_applyProps() {

		if ( this.cityView ) { this.cityView.setProps( this.propsOn ); return; }
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

	// Put every tree / lamp back where it was generated (after physics knocked them over).
	resetPropMatrices() {

		const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
		const up = new THREE.Vector3( 0, 1, 0 );
		for ( const [ mesh, pts ] of [ [ this.trees, this.treePts ], [ this.lamps, this.lampPts ] ] ) {

			if ( ! mesh ) continue;
			pts.forEach( ( pt, i ) => mesh.setMatrixAt( i, m.compose( p.set( pt.x, 0, pt.z ), q.setFromAxisAngle( up, pt.rot ), sc.setScalar( pt.s ) ) ) );
			mesh.instanceMatrix.needsUpdate = true;

		}

	}

	setProps( on ) {

		this.propsOn = on;
		this._applyProps();

	}

	// --- materials -----------------------------------------------------------
	_groundColorNode() {

		return groundColorNode( this );

	}

	_propMaterial() {

		return propMaterial( this.kind );

	}

	setShading( kind ) {

		this.kind = kind;
		if ( this.cityView ) { this.cityView.setShading( kind ); return; }
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
		if ( this.cityView ) this.cityView.setGroundDetail( on );
		else this.setShading( this.kind );

	}

	setWet( on ) {

		this.u.groundWet.value = on ? 1 : 0;
		this.cityView?.setWet( on );

	}

	// --- lights / shadows ----------------------------------------------------
	setHemisphere( on ) {

		this.hemi.visible = on;

	}

	setShadows( mode ) {

		applyShadowMode( this, mode );

	}

	recreateSun() {

		replaceSun( this );

	}

	_applyShadowFlags() {

		const on = this.shadowsOn;
		if ( this.cityView ) {

			for ( const mesh of this.cityView.meshes ) {

				mesh.receiveShadow = on;
				mesh.castShadow = on && ( mesh.isInstancedMesh || mesh.userData.cityCars || mesh.name.startsWith( 'City props' ) );

			}
			return;

		}
		this.ground.receiveShadow = on;
		this.monument.castShadow = this.monument.receiveShadow = on;
		for ( const mesh of [ this.trees, this.lamps ] ) {

			if ( mesh ) mesh.castShadow = mesh.receiveShadow = on;

		}

	}

	setPointLights( n ) {

		rebuildPointLights( this, n );

	}

	// Swap only scene geometry. Lighting, fog and all engine controls stay shared.
	setCity( view ) {

		if ( this.cityView ) {

			this.cityView.dispose();
			Object.assign( this, this.plazaProps );

		}
		this.cityView = view;
		this.city = view?.city || null;
		this.createPhysicsGround = null;
		this.plazaProps = { trees: this.trees, lamps: this.lamps, treePts: this.treePts, lampPts: this.lampPts, lampPositions: this.lampPositions };
		for ( const mesh of [ this.ground, this.monument, this.trees, this.lamps ] ) if ( mesh ) mesh.visible = ! view;
		if ( view ) {

			for ( const key of [ 'trees', 'lamps', 'treePts', 'lampPts' ] ) this[ key ] = view[ key ];
			this.lampPositions = this.lampPts.map( ( p ) => new THREE.Vector3( p.x, 4, p.z ) );
			this.radius = 1450;
			view.setShading( this.kind ); view.setProps( this.propsOn ); view.setGroundDetail( this.groundDetail ); view.setWet( this.u.groundWet.value > 0 );

		} else {

			this.setShading( this.kind );
			this._applyProps();

		}
		this._applyShadowFlags();
		this._lightTimer = 0;

	}

	// --- sky / environment / fog ----------------------------------------------
	setSky( mode ) {

		applySky( this, mode );

	}

	setEnvironment( on ) {

		applyEnvironment( this, on );

	}

	setFog( mode ) {

		applyFog( this, mode );

	}

	// --- per frame -----------------------------------------------------------
	update( dt, focus, camera, viewExtent ) {

		this.cityView?.update( dt, camera );
		updateSun( this, focus, viewExtent );

		const u = this.u;
		if ( camera.isPerspectiveCamera ) u.fogCenter.value.copy( camera.position );
		else u.fogCenter.value.copy( focus );
		u.fogNear.value = Math.max( 20, viewExtent * 0.35 );
		u.fogFar.value = Math.max( 60, viewExtent * 1.25 );

		if ( this.skyMesh ) this.skyMesh.position.copy( camera.position );

		updatePointLights( this, dt, focus );

	}

}
