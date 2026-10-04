// App-wide constants, the setting-key groups that decide what a change rebuilds,
// URL hash parsing and the fatal-error screen.

import * as THREE from 'three/webgpu';
import { defaults, PRESETS } from '../features.js';

export const TONE = {
	none: THREE.NoToneMapping, linear: THREE.LinearToneMapping, reinhard: THREE.ReinhardToneMapping,
	cineon: THREE.CineonToneMapping, aces: THREE.ACESFilmicToneMapping, agx: THREE.AgXToneMapping, neutral: THREE.NeutralToneMapping
};

export const IS_MOBILE = matchMedia( '(pointer: coarse)' ).matches || /Android|iPhone|iPad/i.test( navigator.userAgent );
export const DPR = window.devicePixelRatio || 1;

export const CROWD_KEYS = new Set( [ 'count', 'capacity', 'tier', 'path', 'lod', 'anim', 'animBlend', 'behaviour', 'density', 'activity', 'speed', 'outlines', 'outlineWidth', 'rim', 'blobShadows', 'crowdShadows', 'motionVectors' ] );
export const SHADING_KEYS = new Set( [ 'shading', 'hemi', 'env', 'shadows', 'pointLights', 'clustered' ] );
export const WORLD_KEYS = new Set( [ 'sky', 'fog', 'props', 'groundDetail' ] );
export const RES_KEYS = new Set( [ 'maxDpr', 'renderScale', 'upscaler' ] );
export const POST_KEYS = new Set( [ 'aa', 'toneMapping', 'exposure', 'ao', 'bloom', 'dof', 'motionBlur', 'ssr', 'ssgi', 'grading', 'vignette', 'grain', 'chromatic', 'sharpen', 'stylize' ] );
export const PHYS_KEYS = new Set( [ 'physics', 'crowdMode', 'rapierAgents', 'agentRadius', 'proxies', 'proxyCount', 'knockdown', 'physProps', 'propsDynamic', 'bodies', 'shape', 'sizeVar', 'spawn', 'restitution', 'friction', 'gravity', 'hz', 'iterations', 'ccd', 'sleep', 'recycle', 'physDebug' ] );

export function fatal( title, detail ) {

	if ( window.__bootFail ) return window.__bootFail( new Error( title + ': ' + detail ) );
	const el = document.getElementById( 'fatal' );
	el.querySelector( 'h2' ).textContent = title;
	el.querySelector( '.detail' ).textContent = detail;
	el.style.display = 'flex';
	document.title = 'DONE';
	window.__fatal = title + ': ' + detail;

}

export function readHash() {

	const out = {};
	const params = new URLSearchParams( location.hash.slice( 1 ) );
	const base = defaults();
	for ( const [ k, raw ] of params ) {

		if ( k === 'preset' && PRESETS[ raw ] ) {

			Object.assign( out, PRESETS[ raw ].values );
			continue;

		}

		if ( ! ( k in base ) ) continue;
		const d = base[ k ];
		out[ k ] = typeof d === 'number' ? Number( raw ) : typeof d === 'boolean' ? raw === '1' || raw === 'true' : raw;

	}

	return out;

}
