// Cel shading (Wind Waker / Jet Set Radio style) as a custom three.js lighting model.
//
// A normal lighting model returns a smooth N·L gradient. A cel model snaps it into
// hard bands, then paints the unlit band with a *coloured* shadow instead of a darker
// copy of the albedo, and adds hard-edged rim and specular bands. The band edges are
// anti-aliased with fwidth() so they stay crisp without shimmering.
//
//   celWW   Wind Waker: two soft-edged bands, cool blue shadows, warm light, a thin
//           white rim on the lit side, small specular dot. Bright, clean, no outlines.
//   celJSR  Jet Set Radio: hard two-tone split, saturated colours, purple shadows,
//           bold specular + rim, meant to be paired with thick black outlines.

import * as THREE from 'three/webgpu';
import {
	float, vec3, dot, smoothstep, fwidth, max, normalView, positionViewDirection, reflect, diffuseColor,
	BRDF_Lambert, uniform, saturation
} from 'three/tsl';

export const CEL_STYLES = {
	celWW: {
		threshold: 0.12, softness: 1.5, shadowTint: new THREE.Color( 0.62, 0.74, 1.15 ), lightTint: new THREE.Color( 1.06, 1.0, 0.9 ),
		ambient: 2.4, spec: 0.35, specSize: 0.965, rim: 0.35, rimSize: 0.72, saturate: 1.2
	},
	celJSR: {
		threshold: 0.02, softness: 0.6, shadowTint: new THREE.Color( 0.72, 0.52, 1.12 ), lightTint: new THREE.Color( 1.1, 1.05, 1.0 ),
		ambient: 1.9, spec: 0.8, specSize: 0.94, rim: 0.6, rimSize: 0.66, saturate: 1.5
	}
};

class CelLightingModel extends THREE.LightingModel {

	constructor( style ) {

		super();
		this.s = style;

	}

	direct( { lightDirection, lightColor, reflectedLight } ) {

		const s = this.s;
		const N = normalView, V = positionViewDirection;
		const ndl = dot( N, lightDirection );
		const w = max( fwidth( ndl ), 1e-3 ).mul( s.softness );
		const band = smoothstep( s.threshold.sub( w ), s.threshold.add( w ), ndl );
		const lit = lightColor.mul( band ).mul( s.lightTint );
		reflectedLight.directDiffuse.addAssign( lit.mul( BRDF_Lambert( { diffuseColor: diffuseColor.rgb } ) ) );

		// hard specular dot
		const r = dot( reflect( lightDirection.negate(), N ), V );
		const sw = max( fwidth( r ), 1e-3 );
		const spec = smoothstep( s.specSize.sub( sw ), s.specSize.add( sw ), r ).mul( band ).mul( s.spec );
		// rim band on the lit side only
		const fres = float( 1 ).sub( max( dot( N, V ), 0 ) );
		const rw = max( fwidth( fres ), 1e-3 );
		const rim = smoothstep( s.rimSize.sub( rw ), s.rimSize.add( rw ), fres ).mul( band ).mul( s.rim );
		reflectedLight.directSpecular.addAssign( lightColor.mul( spec.add( rim ) ).mul( 0.25 ) );

	}

	indirect( builder ) {

		// Ambient becomes the "shadow colour": albedo tinted cool/purple, not just darker.
		const { irradiance, reflectedLight } = builder.context;
		const s = this.s;
		reflectedLight.indirectDiffuse.addAssign( irradiance.mul( s.ambient ).mul( s.shadowTint ).mul( BRDF_Lambert( { diffuseColor } ) ) );

	}

}

export class CelNodeMaterial extends THREE.MeshToonNodeMaterial {

	static get type() {

		return 'CelNodeMaterial';

	}

	constructor( styleName = 'celWW', params = {} ) {

		super( params );
		const st = CEL_STYLES[ styleName ] || CEL_STYLES.celWW;
		this.celStyle = styleName;
		this.celUniforms = {
			threshold: uniform( st.threshold ), softness: uniform( st.softness ),
			shadowTint: uniform( st.shadowTint.clone() ), lightTint: uniform( st.lightTint.clone() ),
			ambient: uniform( st.ambient ), spec: uniform( st.spec ), specSize: uniform( st.specSize ),
			rim: uniform( st.rim ), rimSize: uniform( st.rimSize )
		};
		const sat = st.saturate;
		// Hook used by the crowd: punch up clothing colours for the style.
		this.userData.crowdColor = ( c ) => saturation( c, sat );

	}

	setupLightingModel() {

		return new CelLightingModel( this.celUniforms );

	}

}

export const isCel = ( kind ) => kind === 'celWW' || kind === 'celJSR';

export function makeCelMaterial( kind, params = {} ) {

	return new CelNodeMaterial( kind, params );

}

export { vec3 };
