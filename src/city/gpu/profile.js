// Domain profile around the original Crowd renderer. GPU simulation is supplied
// by simulation.js; the original stress-test profile and materials are untouched.
import * as THREE from 'three/webgpu';
import { instancedArray, uniform, Fn, attribute, vec3, floor, mx_hsvtorgb, pow } from 'three/tsl';
import { getModels } from '../../crowd/models.js';
import { hashF } from '../../crowd/sim.js';
import { packCity } from '../packing.js';
import { buildCityKernels } from './simulation.js';
import { buildCityDiagnostics } from './diagnostics.js';

export class CityCrowdProfile {

	constructor( city ) {

		this.city = city; this.packed = packCity( city ); this.path = 'gpu'; this.tier = 1;
		const quad = new THREE.PlaneGeometry( 1, 1 ); quad.setIndex( [ 0, 2, 1, 2, 3, 1 ] );
		this.models = [ { id: 'city-marker', geometry: quad, triangles: 2 }, ...getModels().slice( 0, 3 ) ];
		this.alpha = uniform( 1 );
		this.cameraRight = uniform( new THREE.Vector3( 1, 0, 0 ) ); this.cameraUp = uniform( new THREE.Vector3( 0, 1, 0 ) );
		this.ticks = 0; this.accumulator = 0; this.droppedSeconds = 0; this.paused = false; this.simTime = 0;

	}

	allocate( crowd ) {

		const p = this.city.population;
		crowd.renderBuf.value.array.set( p.render ); crowd.simBuf.value.array.set( p.sim ); crowd.animBuf.value.array.set( p.anim );
		this.nav = instancedArray( p.nav.slice(), 'uvec4' ).setName( 'CityNavigation' );
		this.identity = instancedArray( p.identity, 'uvec4' ).setName( 'CityIdentity' ).toReadOnly();
		const previous = new Float32Array( crowd.capacity * 2 );
		for ( let i = 0; i < crowd.capacity; i ++ ) { previous[ i * 2 ] = p.render[ i * 4 ]; previous[ i * 2 + 1 ] = p.render[ i * 4 + 2 ]; }
		this.previous = instancedArray( previous, 'vec2' ).setName( 'CityPreviousPosition' );
		this.map = instancedArray( this.packed.map, 'uvec4' ).setName( 'CityStaticMap' ).toReadOnly();
		this.routes = instancedArray( this.packed.routes, 'uint' ).setName( 'CityRoutes' ).toReadOnly();
		this.occupancy = instancedArray( this.city.addresses.length, 'uint' ).setName( 'CityDoorOccupancy' ).toAtomic();
		this.gridSize = Math.max( 16384, crowd.capacity * 2 );
		this.grid = instancedArray( this.gridSize * 9, 'uint' ).setName( 'CitySeparationGrid' ).toAtomic();
		this.counters = instancedArray( 8, 'uint' ).setName( 'CityDiagnostics' ).toAtomic();
		this.crossings = instancedArray( this.city.signals.length, 'uint' ).setName( 'CityCrossingPresence' ).toAtomic();
		this.validationCounters = instancedArray( 8, 'uint' ).setName( 'CityValidationCounters' ).toAtomic();
		this.buffers = [ this.nav, this.identity, this.previous, this.map, this.routes, this.occupancy, this.grid, this.counters, this.crossings, this.validationCounters ];
		this.bytes = crowd.capacity * 48 + this.buffers.reduce( ( sum, b ) => sum + b.value.array.byteLength, 0 );
		crowd.u.lodThresholds.value.set( 48, 24, 6 );

	}

	buildComputes( crowd ) {

		buildCityKernels( crowd, this );
		buildCityDiagnostics( crowd, this );

	}

	material( crowd, inst, anim, tier ) {

		if ( tier !== 0 ) return null;
		const m = new THREE.MeshBasicNodeMaterial();
		m.positionNode = Fn( () => {

			const p = attribute( 'position', 'vec3' );
			const seed = floor( inst.w.div( 2048 ) );
			const shirt = mx_hsvtorgb( vec3( hashF( seed, 13 ), hashF( seed, 14 ).mul( .4 ).add( .2 ), hashF( seed, 15 ).mul( .5 ).add( .4 ) ) );
			crowd.vColor.assign( pow( shirt, vec3( 2.2 ) ) );
			return vec3( inst.x, .9, inst.z ).add( this.cameraRight.mul( p.x.mul( .65 ) ) ).add( this.cameraUp.mul( p.y.mul( 1.8 ) ) );

		} )();
		m.colorNode = crowd.vColor;
		m.side = THREE.DoubleSide; m.name = 'City distant citizen';
		return m;

	}

	update( crowd, dt, time, camera, viewportHeight ) {

		const fixed = 1 / 30;
		if ( ! this.paused ) {

			this.accumulator += Math.min( dt, .25 );
			this.droppedSeconds += Math.max( 0, dt - .25 );

		}
		let steps = 0;
		while ( this.accumulator >= fixed && steps < 3 ) {

			this.step( crowd );
			this.accumulator -= fixed; steps ++;

		}
		if ( this.accumulator >= fixed ) { this.droppedSeconds += this.accumulator - this.accumulator % fixed; this.accumulator %= fixed; }
		this.alpha.value = this.paused ? 1 : this.accumulator / fixed;
		camera.updateMatrixWorld();
		this.cameraRight.value.setFromMatrixColumn( camera.matrixWorld, 0 ); this.cameraUp.value.setFromMatrixColumn( camera.matrixWorld, 1 );
		crowd._updateCullUniforms( camera, viewportHeight );
		const passes = crowd.tier >= 2 ? crowd.cullPasses : crowd.cullPasses.slice( 0, 1 );
		for ( const p of passes ) p.count = crowd.count;
		crowd.renderer.compute( [ crowd.resetCompute, ...passes ] );
		crowd._maybeReadback();

	}

	step( crowd ) {

		this.simTime += 1 / 30; crowd.u.time.value = this.simTime; crowd.u.dt.value = 1 / 30;
		crowd.u.count.value = crowd.count;
		for ( const kernel of this.stepKernels ) kernel.count = crowd.count;
		this.clearGrid.count = this.gridSize;
		crowd.renderer.compute( [ this.clearGrid, ...this.stepKernels ] );
		this.ticks ++;

	}

	free( crowd ) {

		for ( const k of [ this.upload, this.clearGrid, ...( this.stepKernels || [] ), this.resetValidation, this.validateAll ] ) k?.dispose();
		for ( const b of this.buffers || [] ) crowd.renderer._attributes?.delete( b.value );
		this.models[ 0 ].geometry.dispose();

	}

}
