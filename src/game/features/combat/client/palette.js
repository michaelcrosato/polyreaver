// Element colours shared by every combat visual (projectiles, trails, sparks, decals,
// lights, damage numbers, icons) so fire always reads as the same fire. `core` is
// the hot centre, `glow` the halo / particle colour, `hdr` how far above 1.0 the
// additive layers push it (tone mapping turns that into a bloom-like hot core).

import * as THREE from 'three/webgpu';

const E = ( core, glow, hdr, text ) => ( { core: new THREE.Color( core ), glow: new THREE.Color( glow ), hdr, text } );

export const ELEMENTS = {
	physical: E( '#fff4e0', '#ffd9a0', 1.6, '#f4efe6' ),
	fire: E( '#ffe08a', '#ff6a1a', 3.0, '#ffa34a' ),
	cold: E( '#effcff', '#5cc8ff', 2.6, '#8fdcff' ),
	lightning: E( '#f6f0ff', '#9a6bff', 3.2, '#cdb6ff' ),
	chaos: E( '#e6ffc0', '#5fd23a', 2.4, '#9cf06a' ),
	spectral: E( '#e8fbff', '#64e0ff', 2.4, '#9fefff' ),
	warcry: E( '#ffe2b0', '#ff8a2a', 2.2, '#ffb060' ),
	holy: E( '#fffbe0', '#ffd84a', 2.6, '#ffe58a' ),
	enemy: E( '#ffd0c0', '#ff3b2f', 2.2, '#ff6b5a' ),
	blood: E( '#ff8080', '#b0101a', 1.2, '#ff5a5a' )
};

// statuses / buff ids that double as visual "elements"
const ALIAS = { ignite: 'fire', chill: 'cold', freeze: 'cold', shock: 'lightning', poison: 'chaos', bleed: 'blood', rage: 'warcry', haste: 'holy', fortify: 'warcry', 'ice-armour': 'cold', warcry: 'warcry' };

export function elementOf( id ) {

	return ELEMENTS[ id ] || ELEMENTS[ ALIAS[ id ] ] || ELEMENTS.physical;

}

// The dominant damage type of a hit result ( byType: { fire: 12, physical: 3 } ).
export function dominantType( byType ) {

	let best = 'physical', v = - 1;
	for ( const k in byType ) if ( byType[ k ] > v ) {

		v = byType[ k ];
		best = k;

	}

	return best;

}
