import { PhysicsDemo } from '../physics.js';
import { RAPIER } from '../physics/bodies.js';

// Reuse the full Rapier playground, with the city's actual ground/buildings and
// instanced street props. Static architecture remains fixed while props can topple.
export class CityPhysics extends PhysicsDemo {

	constructor( app ) {

		super( app.scene, app.world, app.crowd );
		this.app = app;
		this.buildingColliders = [];
		this.worldGfx.createPhysicsGround = ( world, R ) => {

			const city = this.app.data;
			const box = ( x0, z0, x1, z1 ) => world.createCollider( R.ColliderDesc.cuboid( ( x1 - x0 ) / 2, .5, ( z1 - z0 ) / 2 ).setTranslation( ( x0 + x1 ) / 2, -.5, ( z0 + z1 ) / 2 ) );
			box( - 1024, - 1024, city.water.x0, 1024 ); box( city.water.x1, - 1024, 1024, 1024 );
			for ( const row of city.bridgeRows ) box( city.water.x0, city.zs[ row ] - city.halves[ row ] - city.config.sidewalk, city.water.x1, city.zs[ row ] + city.halves[ row ] + city.config.sidewalk );

		};

	}

	rebuildPropColliders() {

		super.rebuildPropColliders();
		for ( const c of this.buildingColliders ) this.world.removeCollider( c, false );
		this.buildingColliders = [];
		for ( const b of this.app.data.buildings ) {

			this.buildingColliders.push( this.world.createCollider( RAPIER.ColliderDesc.cuboid( ( b.x1 - b.x0 ) / 2, b.height / 2, ( b.z1 - b.z0 ) / 2 ).setTranslation( ( b.x0 + b.x1 ) / 2, b.height / 2, ( b.z0 + b.z1 ) / 2 ) ) );

		}

	}

	_fillObstacles() {

		super._fillObstacles();
		// The plaza monument does not exist in the city.
		this.crowd.collider?.u.big.array[ 0 ].set( 0, - 1000, 0, 0 );

	}

	dispose() {

		this.disable();
		this.world?.free();
		this.world = null; this.ready = false;

	}

}
