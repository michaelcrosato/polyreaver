// Optional city surface constraints within the original simulation. This is
// free wandering with wall sliding, not a second citizen/schedule simulation.
import { textureLoad, ivec2, vec2, floor, clamp, float, min, If, length } from 'three/tsl';

function lookup( crowd, position ) {

	const cell = floor( position.add( 1024 ).div( 2 ) ).toVar();
	const sample = textureLoad( crowd.citySurface, ivec2( clamp( cell, 0, 1023 ) ) ).mul( 255 ).round().toVar();
	return { cell, nearest: vec2( sample.x.add( sample.y.mul( 256 ) ), sample.z.add( sample.w.mul( 256 ) ) ) };

}

export function projectSurface( crowd, position ) {

	if ( ! crowd.citySurface ) return position;
	return lookup( crowd, position ).nearest.mul( 2 ).sub( 1023 );

}

export function surfaceHome( crowd, position ) {

	if ( ! crowd.citySurface ) return position;
	const radius = crowd.u.count.div( crowd.u.density.mul( Math.PI ) ).sqrt();
	// Preserve density's radial distribution until it meets the finite city bounds.
	return projectSurface( crowd, position.mul( min( float( 850 ).div( radius ), 1 ) ).add( crowd.cityOrigin ) );

}

function walkable( crowd, position ) {

	const { cell, nearest } = lookup( crowd, position );
	return cell.x.equal( nearest.x ).and( cell.y.equal( nearest.y ) );

}

export function constrainSurface( crowd, position, previous, timer, heading ) {

	if ( ! crowd.citySurface ) return;
	If( walkable( crowd, position ).not(), () => {

		const alongX = vec2( position.x, previous.y ), alongZ = vec2( previous.x, position.y );
		If( walkable( crowd, alongX ), () => { position.assign( alongX ); } )
			.ElseIf( walkable( crowd, alongZ ), () => { position.assign( alongZ ); } )
			.Else( () => { position.assign( projectSurface( crowd, previous ) ); } );
		// A new local target lets wandering agents turn a corner instead of pushing
		// into a wall forever. Chase/flee still aim at their original destinations.
		If( length( position.sub( previous ) ).lessThan( .01 ), () => {

			timer.assign( 0 ); heading.addAssign( Math.PI / 2 );

		} );

	} );

}
