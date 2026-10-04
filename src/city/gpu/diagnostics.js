// Explicit full-population GPU validation. Only eight aggregate uints come back
// to the CPU; individual/full state readback is reserved for debugging failures.
import { Fn, If, Loop, instanceIndex, uint, float, vec2, floor, min, max, abs, dot, bitcast, atomicStore, atomicAdd } from 'three/tsl';

export function buildCityDiagnostics( crowd, p ) {

	const map = p.map, counters = p.validationCounters;
	const f = ( n ) => bitcast( n, 'float' );
	const count = ( id, condition ) => { If( condition, () => { atomicAdd( counters.element( id ), uint( 1 ) ); } ); };
	p.resetValidation = Fn( () => {

		atomicStore( counters.element( instanceIndex ), uint( 0 ) );

	} )().compute( 8 ).setName( 'City reset full validation' );
	p.validateAll = Fn( () => {

		const i = instanceIndex;
		atomicAdd( counters.element( 0 ), uint( 1 ) );
		If( i.greaterThan( 0 ), () => {

			atomicAdd( counters.element( 1 ), uint( 1 ) );
			const rd = crowd.renderBuf.element( i ).toVar(), nd = p.nav.element( i ).toVar(), identity = p.identity.element( i );
			const position = vec2( rd.x, rd.z );
			const bounds = rd.x.equal( rd.x ).and( rd.z.equal( rd.z ) ).and( abs( rd.x ).lessThanEqual( 1024 ) ).and( abs( rd.z ).lessThanEqual( 1024 ) );
			count( 2, bounds.not() );
			const ids = nd.x.lessThan( p.city.graph.edges.length ).and( nd.y.lessThan( p.city.addresses.length ) ).and( nd.z.lessThan( 3 ) ).and( nd.w.lessThanEqual( 16 ) )
				.and( identity.x.lessThan( p.city.addresses.length ) ).and( identity.y.lessThan( p.city.addresses.length ) ).and( identity.z.lessThan( p.city.addresses.length ) );
			count( 3, ids.not() );
			If( bounds.and( ids ), () => {

				const e = map.element( nd.x.mul( 3 ) ).toVar(), meta = map.element( nd.x.mul( 3 ).add( 1 ) ).toVar();
				const delta = position.sub( vec2( f( e.x ), f( e.y ) ) ), direction = vec2( f( e.z ), f( e.w ) );
				const t = dot( delta, direction ), lateral = dot( delta, vec2( direction.y.negate(), direction.x ) );
				count( 4, t.lessThan( -.02 ).or( t.greaterThan( f( meta.x ).add( .02 ) ) ).or( abs( lateral ).greaterThan( f( meta.y ).div( 2 ).sub( .27 ) ) ) );
				const water = rd.x.greaterThan( p.city.water.x0 ).and( rd.x.lessThan( p.city.water.x1 ) );
				count( 5, water.and( map.element( nd.x.mul( 3 ).add( 2 ) ).z.notEqual( 2 ) ) );
				const cell = uint( clampCell( rd.z ) ).mul( 32 ).add( uint( clampCell( rd.x ) ) );
				const header = map.element( uint( p.packed.spatialBase ).add( cell ) ).toVar();
				Loop( { start: uint( 0 ), end: header.y, type: 'uint', condition: '<' }, ( { i: j } ) => {

					const offset = header.x.add( j ), building = map.element( uint( p.packed.spatialIndexBase ).add( offset.div( 4 ) ) ).element( offset.mod( 4 ) );
					const b = map.element( uint( p.packed.buildingBase ).add( building ) ).toVar();
					count( 6, rd.x.greaterThan( f( b.x ).sub( .28 ) ).and( rd.x.lessThan( f( b.z ).add( .28 ) ) ).and( rd.z.greaterThan( f( b.y ).sub( .28 ) ) ).and( rd.z.lessThan( f( b.w ).add( .28 ) ) ) );

				} );
				const moved = position.sub( p.previous.element( i ) );
				count( 7, dot( moved, moved ).greaterThan( .2 * .2 ) );

			} );

		} );

	} )().compute( crowd.count ).setName( 'City validate every live citizen' );

}

function clampCell( position ) {

	return min( float( 31 ), max( float( 0 ), floor( position.add( 1024 ).div( 64 ) ) ) );

}
