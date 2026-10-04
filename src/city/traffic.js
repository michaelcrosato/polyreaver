// Small CPU traffic fleet. This is separate from the 100K GPU pedestrians.
// Signal clearance and GPU crossing-presence readbacks gate vehicle junction entry.
import * as THREE from 'three/webgpu';
import { positionLocal, normalLocal, vec2, vec3, float, abs, step, smoothstep, length, mix } from 'three/tsl';
import { boxGeometry, mergedGeometry } from './render/geometry.js';
import { laneGraph } from './lanes.js';

export class CityTraffic {

	constructor( city, scene ) {

		this.graph = city.laneGraph || laneGraph( city ); this.city = city; this.scene = scene; this.accumulator = 0;
		this.presence = new Uint32Array( city.signals.length ).fill( 1 );
		const fleetEdges = this.graph.edges.filter( ( e ) => e.kind !== 'alley' && e.length > 45 );
		this.states = Array.from( { length: 72 }, ( _, i ) => ( { edge: fleetEdges[ i * 37 % fleetEdges.length ].id, t: 12 + i % 31, speed: i >= 64 ? 6 : 8 + i % 4, previous: new THREE.Vector3(), current: new THREE.Vector3() } ) );
		const box = boxGeometry(), material = new THREE.MeshBasicNodeMaterial( { vertexColors: true } );
		const geometry = mergedGeometry( [ { geometry: box, x: 0, z: 0, sx: 1.7, sy: .65, sz: 3.6, color: 0xb7bfc0 }, { geometry: box, x: 0, y: .65, z: -.2, sx: 1.45, sy: .6, sz: 2, color: 0x849a9e } ] );
		geometry.computeVertexNormals();
		const side = step( .5, abs( normalLocal.x ) );
		const wheel = float( 1 ).sub( smoothstep( .22, .28, length( vec2( abs( positionLocal.z ).sub( 1.15 ), positionLocal.y.sub( .28 ) ) ) ) ).mul( side );
		const windowMask = step( .75, positionLocal.y ).mul( float( 1 ).sub( step( 1.2, abs( positionLocal.z ) ) ) ).mul( side );
		material.colorNode = mix( mix( vec3( 1 ), vec3( .45, .6, .65 ), windowMask ), vec3( .13 ), wheel );
		box.dispose(); this.geometry = geometry; this.material = material;
		this.mesh = new THREE.InstancedMesh( geometry, material, 72 ); this.mesh.name = 'City cars and buses'; this.mesh.frustumCulled = false;
		for ( let i = 0; i < 72; i ++ ) { this.mesh.setColorAt( i, new THREE.Color( [ 0xddc9a4, 0xabcfbe, 0xadbfcb, 0xb1907c, 0xc0bda8 ][ i % 5 ] ) ); this.states[ i ].current.copy( this.position( this.states[ i ] ) ); this.states[ i ].previous.copy( this.states[ i ].current ); }
		scene.add( this.mesh ); this.matrix = new THREE.Matrix4(); this.quaternion = new THREE.Quaternion(); this.scale = new THREE.Vector3();
		this.bytes = geometry.attributes.position.array.byteLength + geometry.attributes.color.array.byteLength + this.mesh.instanceMatrix.array.byteLength + this.mesh.instanceColor.array.byteLength;
		this.signalGeometry = boxGeometry(); this.signalMaterial = new THREE.MeshBasicNodeMaterial();
		this.signalMesh = new THREE.InstancedMesh( this.signalGeometry, this.signalMaterial, city.signals.length * 2 ); this.signalMesh.name = 'City working traffic signals'; this.signalMesh.frustumCulled = false;
		for ( const s of city.signals ) {

			const i = s.id % 17, j = Math.floor( s.id / 17 ), halfX = city.halves[ i ], halfZ = city.halves[ j ];
			this.signalMesh.setMatrixAt( s.id * 2, new THREE.Matrix4().makeScale( .35, .6, .25 ).setPosition( s.x + halfX + city.config.sidewalk + .4, 2.8, s.z - halfZ - city.config.sidewalk / 2 ) );
			this.signalMesh.setMatrixAt( s.id * 2 + 1, new THREE.Matrix4().makeScale( .25, .6, .35 ).setPosition( s.x - halfX - city.config.sidewalk / 2, 2.8, s.z + halfZ + city.config.sidewalk + .4 ) );
			this.signalMesh.setColorAt( s.id * 2, new THREE.Color( 0xb96555 ) ); this.signalMesh.setColorAt( s.id * 2 + 1, new THREE.Color( 0xb96555 ) );

		}
		scene.add( this.signalMesh ); this.triangles = 72 * 20 + city.signals.length * 20;
		this.bytes += this.signalGeometry.attributes.position.array.byteLength + this.signalMesh.instanceMatrix.array.byteLength + this.signalMesh.instanceColor.array.byteLength;

	}

	position( state ) {

		const e = this.graph.edges[ state.edge ], n = this.graph.nodes[ e.a ];
		const lane = 1.6 * Math.min( 1, n.signal < 0 ? 1 : state.t / 8, this.graph.nodes[ e.b ].signal < 0 ? 1 : ( e.length - state.t ) / 8 );
		return new THREE.Vector3( n.x + e.dx * state.t - e.dz * lane, .04, n.z + e.dz * state.t + e.dx * lane );

	}

	update( dt, time, paused ) {

		if ( ! paused ) this.accumulator += dt;
		if ( this.accumulator >= .1 ) {

			this.accumulator %= .1;
			for ( const signal of this.city.signals ) {

				const phase = ( time + signal.offset ) % 80;
				this.signalMesh.setColorAt( signal.id * 2, new THREE.Color( phase >= 42 && phase < 58 ? 0x79b794 : phase >= 58 && phase < 60 ? 0xf2cf76 : 0xb96555 ) );
				this.signalMesh.setColorAt( signal.id * 2 + 1, new THREE.Color( phase >= 60 && phase < 76 ? 0x79b794 : phase >= 76 ? 0xf2cf76 : 0xb96555 ) );

			}
			this.signalMesh.instanceColor.needsUpdate = true;
			for ( const [ i, s ] of this.states.entries() ) {

				s.previous.copy( s.current );
				const e = this.graph.edges[ s.edge ], limit = e.length - 3;
				let distance = s.speed * .1;
				for ( const [ otherId, other ] of this.states.entries() ) if ( other !== s && other.edge === s.edge && other.t > s.t ) {

					const gap = ( i >= 64 ? 3.96 : 1.8 ) + ( otherId >= 64 ? 3.96 : 1.8 ) + 1;
					distance = Math.min( distance, Math.max( 0, other.t - s.t - gap ) );

				}
				const signal = this.graph.nodes[ e.b ].signal;
				const light = signal < 0 ? 0 : ( time + this.city.signals[ signal ].offset ) % 80;
				const green = signal < 0 || ( e.dx ? light >= 60 && light < 76 : light >= 42 && light < 58 );
				if ( ! green || signal >= 0 && this.presence[ signal ] ) s.t = Math.min( limit, s.t + distance );
				else s.t += distance;
				if ( s.t >= e.length ) {

					const options = this.graph.nodes[ e.b ].out.filter( ( id ) => id !== e.reverse && this.graph.edges[ id ].kind !== 'alley' );
					s.edge = options.length ? options[ ( i + Math.floor( time / 80 ) ) % options.length ] : e.reverse;
					s.t -= e.length;

				}
				s.current.copy( this.position( s ) );

			}

		}
		for ( const [ i, s ] of this.states.entries() ) {

			const e = this.graph.edges[ s.edge ];
			this.quaternion.setFromAxisAngle( THREE.Object3D.DEFAULT_UP, Math.atan2( e.dx, e.dz ) );
			this.matrix.compose( new THREE.Vector3().lerpVectors( s.previous, s.current, paused ? 1 : this.accumulator / .1 ), this.quaternion, this.scale.set( 1, 1, i >= 64 ? 2.2 : 1 ) );
			this.mesh.setMatrixAt( i, this.matrix );

		}
		this.mesh.instanceMatrix.needsUpdate = true;

	}

	dispose() { this.scene.remove( this.mesh, this.signalMesh ); this.mesh.dispose(); this.geometry.dispose(); this.material.dispose(); this.signalMesh.dispose(); this.signalGeometry.dispose(); this.signalMaterial.dispose(); }

}
