// Every kernel binds at most eight storage buffers. Neighbors always read an
// immutable tick snapshot; navigation, separation and animation are separate.
import {
	Fn, If, Loop, float, uint, vec2, vec4, ivec2, instanceIndex, bitcast,
	floor, fract, min, max, clamp, length, dot, atan, select, sin, cos,
	atomicAdd, atomicStore, atomicLoad, atomicOr, atomicAnd
} from 'three/tsl';
import { hashF, TAU } from '../../crowd/sim.js';

const CELL = 2, BUCKET = 8;
const hashCell = ( p, mask ) => uint( p.x ).mul( 73856093 ).bitXor( uint( p.y ).mul( 19349663 ) ).bitAnd( mask );
const f = ( value ) => bitcast( value, 'float' );
const toward = ( current, target, amount ) => current.add( clamp( target.sub( current ), amount.negate(), amount ) );

export function buildCityKernels( crowd, profile ) {

	const p = profile, u = crowd.u, { nodeBase, addressBase, signalBase, localBase, clusters } = p.packed;
	const map = p.map, nav = p.nav, sim = crowd.simBuf, render = crowd.renderBuf, anim = crowd.animBuf;
	const mask = uint( p.gridSize - 1 );
	const edgePos = ( id ) => map.element( id.mul( 3 ) );
	const edgeMeta = ( id ) => map.element( id.mul( 3 ).add( 1 ) );
	const edgeFlags = ( id ) => map.element( id.mul( 3 ).add( 2 ) );
	p.upload = Fn( () => {

		const i = instanceIndex;
		If( i.lessThan( crowd.capacity ), () => {

			nav.element( i ).assign( nav.element( i ) ); sim.element( i ).assign( sim.element( i ) );
			render.element( i ).assign( render.element( i ) ); anim.element( i ).assign( anim.element( i ) );
			p.previous.element( i ).assign( p.previous.element( i ) );

		} );
		If( i.lessThan( p.city.addresses.length ), () => { atomicStore( p.occupancy.element( i ), uint( 0 ) ); } );

	} )().compute( Math.max( crowd.capacity, p.city.addresses.length ) ).setName( 'City initialize navigation state' );

	p.clearGrid = Fn( () => {

		const i = instanceIndex;
		atomicStore( p.grid.element( i.mul( BUCKET + 1 ) ), uint( 0 ) );
		If( i.lessThan( p.city.signals.length ), () => { atomicStore( p.crossings.element( i ), uint( 0 ) ); } );
		If( i.lessThan( 8 ), () => { atomicStore( p.counters.element( i ), uint( 0 ) ); } );

	} )().compute( p.gridSize ).setName( 'City reset grid and diagnostics' );

	p.snapshot = Fn( () => {

		const i = instanceIndex, rd = render.element( i );
		const position = vec2( rd.x, rd.z );
		p.previous.element( i ).assign( position );
		const bucket = hashCell( ivec2( floor( position.div( CELL ) ) ), mask ).mul( 9 );
		const slot = atomicAdd( p.grid.element( bucket ), uint( 1 ) ).toVar();
		If( slot.lessThan( 8 ), () => { atomicStore( p.grid.element( bucket.add( 1 ).add( slot ) ), i ); } )
			.Else( () => { atomicAdd( p.counters.element( 0 ), uint( 1 ) ); } );
		If( i.greaterThan( 0 ), () => {

			const flags = edgeFlags( nav.element( i ).x );
			If( flags.z.equal( 1 ), () => { atomicAdd( p.crossings.element( flags.y.sub( 1 ) ), uint( 1 ) ); } );

		} );

	} )().compute( crowd.count ).setName( 'City snapshot and spatial insertion' );

	p.navigate = Fn( () => {

		const i = instanceIndex;
		If( i.greaterThan( 0 ), () => {

			const nd = nav.element( i ).toVar(), sd = sim.element( i ).toVar(), rd = render.element( i ).toVar();
			const e = nd.x.toVar();
			If( u.behaviour.equal( 1 ).or( u.behaviour.equal( 2 ) ), () => {

				const destination = select( u.behaviour.equal( 1 ), p.heroAddress, p.fleeAddress );
				If( nd.y.notEqual( destination ), () => {

					If( nd.w.greaterThan( 0 ), () => { atomicAnd( p.occupancy.element( nd.y ), uint( 0xffffffff ).bitXor( uint( 1 ).shiftLeft( nd.w.sub( 1 ) ) ) ); } );
					nd.w.assign( 0 ); nd.y.assign( destination );

				} );

			} );
			const address = map.element( uint( addressBase ).add( nd.y.mul( 2 ) ) ).toVar();
			const addressF = map.element( uint( addressBase + 1 ).add( nd.y.mul( 2 ) ) ).toVar();
			const speed = hashF( i, 7 ).mul( .45 ).add( .8 ).mul( 1.35 ).mul( u.speedScale ).mul( select( u.activity.greaterThan( 0 ), 1, 0 ) );
			const walkLateral = hashF( i, 23 ).sub( .5 ).mul( 2.4 ).mul( clamp( float( .35 ).div( u.density ), .2, 2 ) );
			const wasDwelling = nd.w.greaterThan( 0 ).toVar();
			If( wasDwelling, () => {

				const slot = nd.w.sub( 1 ), bit = uint( 1 ).shiftLeft( slot );
				const targetT = f( addressF.x ).add( float( slot.div( 4 ) ).sub( 1.5 ).mul( 1.2 ) );
				const width = f( edgeMeta( e ).y );
				const sign = select( f( addressF.y ).lessThan( 0 ), float( - 1 ), float( 1 ) );
				const targetLateral = sign.mul( width.div( 2 ).sub( .45 ).sub( float( slot.mod( 4 ) ).mul( .4 ) ) );
				sd.x.assign( toward( sd.x, targetT, speed.mul( u.dt ) ) );
				sd.y.assign( toward( sd.y, targetLateral, speed.mul( u.dt ) ) );
				sd.z.subAssign( u.dt );
				If( sd.z.lessThanEqual( 0 ), () => {

					atomicAnd( p.occupancy.element( nd.y ), uint( 0xffffffff ).bitXor( bit ) );
					nd.z.assign( nd.z.add( 1 ).mod( 3 ) );
					const identity = p.identity.element( i );
					nd.y.assign( select( nd.z.equal( 0 ), identity.x, select( nd.z.equal( 1 ), identity.y, identity.z ) ) );
					nd.w.assign( 0 );

				} );

			} ).Else( () => {

				const oldT = sd.x.toVar();
				sd.x.addAssign( speed.mul( u.dt ) );
				sd.y.assign( toward( sd.y, walkLateral, u.dt.mul( .7 ) ) );
				If( e.equal( address.x ).and( oldT.lessThanEqual( f( addressF.x ).add( .001 ) ) ).and( sd.x.greaterThanEqual( f( addressF.x ) ) ), () => {

					sd.x.assign( f( addressF.x ) );
					// At most sixteen citizens occupy a door apron, with exclusive slots.
					// Failed arrivals wait and retry without overwriting a reserved slot.
					Loop( 4, ( { i: attempt } ) => {

						If( nd.w.equal( 0 ), () => {

							const slot = i.add( uint( attempt ) ).mod( address.w ), bit = uint( 1 ).shiftLeft( slot );
							const old = atomicOr( p.occupancy.element( nd.y ), bit ).toVar();
							If( old.bitAnd( bit ).equal( 0 ), () => {

								nd.w.assign( slot.add( 1 ) ); sd.z.assign( hashF( i, 31 ).mul( 35 ).add( 5 ).mul( float( .6 ).div( max( u.activity, .01 ) ) ) );

							} );

						} );

					} );

				} ).Else( () => {

					// Real speeds and graph lengths require at most one junction per tick.
					const meta = edgeMeta( e ).toVar();
					If( sd.x.greaterThanEqual( f( meta.x ) ), () => {

						const node = meta.z, nodeData = map.element( uint( nodeBase ).add( node ) ).toVar();
						const targetData = map.element( uint( nodeBase ).add( address.y ) ).toVar();
						const next = uint( 0 ).toVar();
						If( node.equal( address.y ), () => { next.assign( address.x ); } ).ElseIf( nodeData.x.notEqual( address.z ), () => {

							next.assign( p.routes.element( node.mul( clusters ).add( address.z ) ) );

						} ).Else( () => { next.assign( p.routes.element( uint( localBase ).add( nodeData.w ).add( nodeData.y.mul( nodeData.z ) ).add( targetData.y ) ) ); } );
						const flags = edgeFlags( next ).toVar();
						const mayEnter = uint( 1 ).toVar();
						If( flags.z.equal( 1 ), () => {

							const offset = float( map.element( uint( signalBase ).add( flags.y.sub( 1 ) ) ).x );
							mayEnter.assign( uint( u.time.add( offset ).mod( 80 ).lessThan( 18 ) ) );

						} );
						If( mayEnter.equal( 1 ), () => { e.assign( next ); sd.x.assign( sd.x.sub( f( meta.x ) ) ); } )
							.Else( () => { sd.x.assign( f( meta.x ) ); } );

					} );

				} );

			} );
			const position = edgePos( e ).toVar(), meta = edgeMeta( e ).toVar();
			const bend = clamp( min( sd.x.div( 8 ), f( meta.x ).sub( sd.x ).div( 8 ) ), 0, 1 );
			const actualLateral = sd.y.mul( bend );
			const x = f( position.x ).add( f( position.z ).mul( sd.x ) ).sub( f( position.w ).mul( actualLateral ) );
			const z = f( position.y ).add( f( position.w ).mul( sd.x ) ).add( f( position.z ).mul( actualLateral ) );
			render.element( i ).assign( vec4( x, rd.y, z, rd.w ) ); nd.x.assign( e );
			nav.element( i ).assign( nd ); sim.element( i ).assign( sd );

		} );

	} )().compute( crowd.count ).setName( 'City route following and door reservations' );

	p.separate = Fn( () => {

		const i = instanceIndex;
		If( i.greaterThan( 0 ), () => {

			const rd = render.element( i ).toVar(), sd = sim.element( i ).toVar();
			const position = vec2( rd.x, rd.z ).toVar(), push = vec2( 0 ).toVar();
			const cell = ivec2( floor( position.div( CELL ) ) );
			for ( let z = - 1; z <= 1; z ++ ) for ( let x = - 1; x <= 1; x ++ ) {

				const bucket = hashCell( cell.add( ivec2( x, z ) ), mask ).mul( 9 ).toVar();
				const count = min( atomicLoad( p.grid.element( bucket ) ), uint( 8 ) ).toVar();
				Loop( { start: uint( 0 ), end: count, type: 'uint', condition: '<' }, ( { i: candidate } ) => {

					const neighbor = atomicLoad( p.grid.element( bucket.add( 1 ).add( candidate ) ) ).toVar();
					If( neighbor.notEqual( i ), () => {

						const delta = position.sub( p.previous.element( neighbor ) ), d2 = dot( delta, delta );
						If( d2.lessThan( p.radius.mul( 2 ).pow( 2 ) ), () => {

							atomicAdd( p.counters.element( 1 ), uint( 1 ) );
							If( d2.greaterThan( 1e-8 ), () => {

								const d = length( delta ); push.addAssign( delta.div( d ).mul( p.radius.mul( 2 ).sub( d ).mul( .25 ) ) );

							} ).Else( () => {

								const angle = hashF( i.add( neighbor ), 77 ).mul( TAU ), sign = select( i.lessThan( neighbor ), float( 1 ), float( - 1 ) );
								push.addAssign( vec2( sin( angle ), cos( angle ) ).mul( sign ).mul( .02 ) );

							} );

						} );

					} );

				} );

			}
			push.assign( push.mul( min( float( 1 ), float( .025 ).div( max( length( push ), .0001 ) ) ) ) );
			const nd = nav.element( i ), ep = edgePos( nd.x ).toVar(), em = edgeMeta( nd.x ).toVar();
			const direction = vec2( f( ep.z ), f( ep.w ) ), normal = vec2( f( ep.w ).negate(), f( ep.z ) );
			// Reservation holders keep their destination distance; others may slow down.
			If( nd.w.equal( 0 ), () => { sd.x.assign( clamp( sd.x.add( dot( push, direction ) ), 0, f( em.x ) ) ); } );
			const bend = clamp( min( sd.x.div( 8 ), f( em.x ).sub( sd.x ).div( 8 ) ), 0, 1 );
			If( bend.greaterThan( .2 ), () => { sd.y.addAssign( dot( push, normal ).div( bend ) ); } );
			sd.y.assign( clamp( sd.y, f( em.y ).div( 2 ).sub( .3 ).negate(), f( em.y ).div( 2 ).sub( .3 ) ) );
			const result = vec2( f( ep.x ), f( ep.y ) ).add( direction.mul( sd.x ) ).add( normal.mul( sd.y.mul( bend ) ) );
			render.element( i ).assign( vec4( result.x, rd.y, result.y, rd.w ) ); sim.element( i ).assign( sd );

		} );

	} )().compute( crowd.count ).setName( 'City bounded soft separation' );

	p.finalize = Fn( () => {

		const i = instanceIndex, rd = render.element( i ).toVar(), sd = sim.element( i ).toVar(), ad = anim.element( i ).toVar();
		const delta = vec2( rd.x, rd.z ).sub( p.previous.element( i ) ), movement = length( delta );
		const speed = movement.div( u.dt ).toVar();
		const state = select( movement.greaterThan( .0005 ), float( 1 ), float( 0 ) ).toVar();
		const heading = select( movement.greaterThan( .0001 ), atan( delta.x, delta.y ), sd.w ).toVar();
		const seed = floor( rd.w.div( 2048 ) ).toVar();
		If( i.equal( 0 ), () => {

			rd.x.assign( u.heroPos.x ); rd.z.assign( u.heroPos.y ); heading.assign( u.heroHeading ); state.assign( u.heroState ); seed.assign( 0 ); speed.assign( u.heroSpeed );

		} );
		If( i.greaterThan( 0 ), () => {

			If( u.behaviour.equal( 3 ), () => { state.assign( 5 ); } );
			If( u.behaviour.equal( 4 ), () => { state.assign( select( u.time.mul( 2 ).sub( rd.x.mul( .12 ) ).mod( 6 ).lessThan( 1.5 ), 4, 0 ) ); } );
			if ( crowd.collide && crowd.collider ) If( crowd.collider.phys.element( i ).z.greaterThan( 0 ), () => { state.assign( 7 ); } );
			if ( crowd.rapierAgents ) If( i.lessThan( u.rapierCount ).and( crowd.rapierIO.element( i.mul( 2 ) ).z.greaterThan( 0 ) ), () => { state.assign( 7 ); } );

		} );
		const oldState = rd.w.mod( 8 ), changed = state.notEqual( oldState );
		ad.x.assign( select( changed, oldState, ad.x ) ); ad.z.assign( select( changed, rd.y, ad.z ) );
		ad.y.assign( select( u.blendOn.lessThan( .5 ), float( 1 ), select( changed, float( 0 ), min( ad.y.add( u.dt.mul( 4 ) ), 1 ) ) ) ); ad.w.assign( float( i ) );
		rd.y.assign( rd.y.add( select( u.behaviour.equal( 5 ).and( i.greaterThan( 0 ) ), float( 0 ), select( state.equal( 1 ), speed.mul( u.dt ).mul( 4.8 ), select( state.equal( 2 ), speed.mul( u.dt ).mul( 3.2 ), u.dt.mul( 2.5 ) ) ) ) ).mod( TAU ) );
		const quantized = floor( fract( heading.div( TAU ) ).mul( 256 ) ).mod( 256 );
		rd.w.assign( state.add( quantized.mul( 8 ) ).add( seed.mul( 2048 ) ) ); sd.w.assign( heading );
		render.element( i ).assign( rd ); sim.element( i ).assign( sd ); anim.element( i ).assign( ad );

	} )().compute( crowd.count ).setName( 'City actual movement animation' );

	p.stepKernels = [ p.snapshot, p.navigate, p.separate, p.finalize ];
	crowd._needsInit = false;

}
