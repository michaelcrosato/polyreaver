// Small analytical CPU reference for validating travel on one legal corridor.
// The PCG hash matches three.js's documented installed Hash.js primitive; geometry
// and movement are evaluated in ordinary double precision for comparison to GPU f32.
export function citizenRandom( id, salt ) {

	const seed = ( Math.imul( id, 7919 ) + salt ) >>> 0;
	const state = ( Math.imul( seed, 747796405 ) + 2891336453 ) >>> 0;
	const word = Math.imul( ( ( state >>> ( ( state >>> 28 ) + 4 ) ) ^ state ) >>> 0, 277803737 ) >>> 0;
	return Math.fround( ( ( word >>> 22 ) ^ word ) >>> 0 ) / 4294967296;

}

export const citizenWalkSpeed = ( id ) => ( .8 + .45 * citizenRandom( id, 7 ) ) * 1.35;

export function pointOnEdge( edge, distance, lateral = 0 ) {

	const bend = Math.max( 0, Math.min( 1, distance / 8, ( edge.length - distance ) / 8 ) );
	return { x: edge.x + edge.dx * distance - edge.dz * lateral * bend, z: edge.z + edge.dz * distance + edge.dx * lateral * bend };

}

export function advanceSingleEdge( edge, distance, lateral, seconds, speed ) {

	const t = Math.min( edge.length, distance + speed * seconds );
	return { distance: t, ...pointOnEdge( edge, t, lateral ) };

}
