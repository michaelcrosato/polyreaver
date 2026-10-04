// Physics nudges are projected onto the current street corridor. Pedestrian
// addresses/routes remain valid even when a rigid body or explosion hits them.
import { Fn, If, instanceIndex, vec2, vec4, float, clamp, min, max, dot, length, bitcast } from 'three/tsl';

export function buildCityPhysics( crowd, p ) {

	const f = ( v ) => bitcast( v, 'float' ), u = crowd.u;
	const project = ( i, desired ) => {

		const nd = p.nav.element( i ), sd = crowd.simBuf.element( i ).toVar();
		const e = p.map.element( nd.x.mul( 3 ) ), m = p.map.element( nd.x.mul( 3 ).add( 1 ) );
		const origin = vec2( f( e.x ), f( e.y ) ), direction = vec2( f( e.z ), f( e.w ) ), normal = vec2( direction.y.negate(), direction.x );
		const delta = desired.sub( origin );
		If( nd.w.equal( 0 ), () => { sd.x.assign( clamp( dot( delta, direction ), 0, f( m.x ) ) ); } );
		const bend = clamp( min( sd.x.div( 8 ), f( m.x ).sub( sd.x ).div( 8 ) ), 0, 1 );
		sd.y.assign( clamp( dot( delta, normal ).div( max( bend, .2 ) ), f( m.y ).div( 2 ).sub( .3 ).negate(), f( m.y ).div( 2 ).sub( .3 ) ) );
		const pos = origin.add( direction.mul( sd.x ) ).add( normal.mul( sd.y.mul( bend ) ) );
		const rd = crowd.renderBuf.element( i ).toVar(); rd.x.assign( pos.x ); rd.z.assign( pos.y );
		crowd.renderBuf.element( i ).assign( rd ); crowd.simBuf.element( i ).assign( sd );

	};
	p.physicsStep = null;
	if ( crowd.collide && crowd.collider ) {

		const col = crowd.collider;
		p.physicsStep = Fn( () => {

			const i = instanceIndex;
			If( i.greaterThan( 0 ).and( i.greaterThanEqual( u.rapierCount ) ), () => {

				const rd = crowd.renderBuf.element( i ), pos = vec2( rd.x, rd.z ).toVar();
				const result = col.emitResolve( i, pos ), phys = col.phys.element( i ).toVar();
				If( result.hit.greaterThan( .5 ).and( col.u.knockOn.greaterThan( .5 ) ), () => { phys.xy.addAssign( result.knock ); phys.z.assign( 1.3 ); } );
				phys.z.assign( max( 0, phys.z.sub( u.dt ) ) ); phys.xy.mulAssign( .9 );
				const push = result.push.add( phys.xy.mul( u.dt ) ).toVar();
				push.mulAssign( min( float( 1 ), float( .1 ).div( max( length( push ), .0001 ) ) ) );
				project( i, pos.add( push ) ); col.phys.element( i ).assign( phys );

			} );

		} )().compute( crowd.count ).setName( 'City projected GPU body collisions' );

	}
	p.rapierStep = null;
	if ( crowd.rapierAgents ) p.rapierStep = Fn( () => {

		const i = instanceIndex;
		If( i.greaterThan( 0 ).and( i.lessThan( u.rapierCount ) ), () => {

			const rd = crowd.renderBuf.element( i ), before = p.previous.element( i );
			const steer = vec2( rd.x, rd.z ).sub( before ).div( max( u.dt, .0001 ) );
			crowd.rapierIO.element( i.mul( 2 ).add( 1 ) ).assign( vec4( steer, 0, 1 ) );
			project( i, crowd.rapierIO.element( i.mul( 2 ) ).xy );

		} );

	} )().compute( crowd.count ).setName( 'City Rapier steering and street projection' );

}
