// Game post-processing: each THEME's `post` block ( { bloom, saturation, contrast,
// vignette, tint } in features/world/themes.js ) becomes one full-screen pass after
// the scene: bloom on the HDR colour, then tone mapping, then the grade. All the
// knobs are uniforms, so walking from the Ember Quarry into the Frostfang Pass
// changes numbers, not shaders (no recompile, no hitch).
//
// Cost: one extra read + write of every pixel plus the bloom mip chain. Phones skip
// it by default (pointer: coarse); the Graphics panel (pause menu) overrides that:
//   game.gfx.set( { post: 'on' | 'off' | 'auto', bloom: 0..2, scale: 0.5..1 } )

import * as THREE from 'three/webgpu';
import { pass, renderOutput, uniform, vec4, saturation, screenUV, smoothstep, float } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { define, get } from '../core/registry.js';
import { h } from '../ui/shell.js';

const KEY = 'polyreaver.gfx';
const gfx = { post: 'auto', bloom: 1, scale: 1 };
try {

	Object.assign( gfx, JSON.parse( localStorage.getItem( KEY ) || '{}' ) );

} catch { /* storage blocked: defaults */ }

const coarse = () => typeof matchMedia === 'function' && matchMedia( '(pointer: coarse)' ).matches;
const postOn = () => gfx.post === 'on' || ( gfx.post === 'auto' && ! coarse() );

const u = {
	bloom: uniform( 0.6 ), sat: uniform( 1 ), contrast: uniform( 1 ), vignette: uniform( 0.35 ), tint: uniform( new THREE.Color( 1, 1, 1 ) )
};

function build( rc ) {

	const pipeline = new THREE.RenderPipeline( rc.renderer );
	const scene = pass( rc.scene, rc.camera, { samples: coarse() ? 0 : 4 } );
	const glow = bloom( scene, u.bloom, 0.45, 0.88 );
	let out = renderOutput( vec4( scene.rgb.add( glow.rgb ), 1 ) );
	let rgb = saturation( out.rgb, u.sat );
	rgb = rgb.sub( 0.5 ).mul( u.contrast ).add( 0.5 ).mul( u.tint );
	const edge = smoothstep( float( 0.3 ), float( 0.85 ), screenUV.sub( 0.5 ).length() );
	out = vec4( rgb.mul( float( 1 ).sub( edge.mul( u.vignette ) ) ), 1 );
	pipeline.outputColorTransform = false; // renderOutput() above already tone-mapped
	pipeline.outputNode = out;
	return pipeline;

}

function applyScale( rc ) {

	const base = Math.min( devicePixelRatio, rc.baseDpr ?? 2 );
	rc.renderer.setPixelRatio( base * Math.min( 1, Math.max( 0.5, gfx.scale ) ) );
	rc.resize();

}

define( 'renderSystem', { id: 'game-post', order: 98,
	init( rc ) {

		rc.baseDpr = rc.renderer.getPixelRatio();
		this.rc = rc;
		this.pipeline = null;
		if ( gfx.scale !== 1 ) applyScale( rc );

	},
	onWorld( rc, world ) {

		const theme = get( 'theme', world.layout?.theme ?? world.spec?.theme );
		const p = theme?.post || {};
		u.bloom.value = ( p.bloom ?? 0.5 ) * 0.55 * gfx.bloom;
		u.sat.value = p.saturation ?? 1;
		u.contrast.value = p.contrast ?? 1;
		u.vignette.value = p.vignette ?? 0.3;
		u.tint.value.set( p.tint ?? '#ffffff' );

	},
	update( rc ) {

		if ( postOn() ) {

			this.pipeline ||= build( rc );
			rc.post = this.pipeline;

		} else rc.post = null;

	}
} );

// --- Graphics panel (pause menu) ---------------------------------------------------------

define( 'uiPanel', { id: 'graphics', order: 87, modal: true, startOpen: false, pauseButton: 'Graphics',
	mount( ui ) {

		const save = () => {

			try {

				localStorage.setItem( KEY, JSON.stringify( gfx ) );

			} catch { /* not saved: fine for this session */ }

		};

		const mode = h( 'select', { onchange: () => {

			gfx.post = mode.value;
			save();

		} }, [ [ 'auto', 'Auto (on for desktop, off for phones)' ], [ 'on', 'On' ], [ 'off', 'Off' ] ].map( ( [ v, t ] ) => h( 'option', { value: v, text: t } ) ) );
		const glow = h( 'input', { type: 'range', min: 0, max: 200, step: 5, oninput: () => {

			gfx.bloom = + glow.value / 100;
			const theme = ui.game.world && get( 'theme', ui.game.world.layout?.theme );
			u.bloom.value = ( theme?.post?.bloom ?? 0.5 ) * 0.55 * gfx.bloom;
			save();

		} } );
		const scale = h( 'select', { onchange: () => {

			gfx.scale = + scale.value;
			applyScale( ui.game.rc );
			save();

		} }, [ [ 1, 'Full' ], [ 0.75, '75%' ], [ 0.5, '50%' ] ].map( ( [ v, t ] ) => h( 'option', { value: v, text: t } ) ) );
		this.sync = () => {

			mode.value = gfx.post; glow.value = Math.round( gfx.bloom * 100 ); scale.value = String( gfx.scale );

		};

		return h( 'div', { class: 'panel menu' },
			h( 'h2', { text: 'Graphics' } ),
			h( 'div', { class: 'tuning' },
				h( 'div', { class: 'trow' }, h( 'span', { text: 'Post-processing' } ), mode, h( 'span' ) ),
				h( 'div', { class: 'trow' }, h( 'span', { text: 'Bloom' } ), glow, h( 'span' ) ),
				h( 'div', { class: 'trow' }, h( 'span', { text: 'Resolution' } ), scale, h( 'span' ) ) ),
			h( 'p', { class: 'dim', text: 'Post-processing applies each area\'s bloom and colour grade in one extra full-screen pass. Lower the resolution first if a phone runs hot.' } ),
			h( 'div', { class: 'btns' }, h( 'button', { text: 'Done', onclick: () => ui.open( 'graphics', false ) } ) ) );

	},
	onOpen() {

		this.sync();

	}
} );

define( 'bootHook', { id: 'game-gfx', order: 2, boot( { game } ) {

	game.gfx = { get: () => ( { ...gfx, active: postOn() } ), set: ( o ) => Object.assign( gfx, o ) };

} } );
