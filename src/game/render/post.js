// Game post-processing: each THEME's `post` block ( { bloom, saturation, contrast,
// vignette, tint } in features/world/themes.js ) becomes one full-screen pass after
// the scene: bloom on the HDR colour, then tone mapping, then the grade. All the
// knobs are uniforms, so walking from the Ember Quarry into the Frostfang Pass
// changes numbers, not shaders (no recompile, no hitch).
//
// Cost: one extra read + write of every pixel plus the bloom mip chain. Phones skip
// it by default (pointer: coarse); the Graphics panel (pause menu) overrides that:
//   game.gfx.set( { post: 'on' | 'off' | 'auto', bloom: 0..2, scale: 0.5..1,
//                  quality: 'manual' | 'adaptive30' | 'adaptive60' } )
// Manual resolution changes disable adaptation; only the opted-in game resolution
// is adjusted. Settings are local to this browser/device, separate from saves.

import * as THREE from 'three/webgpu';
import { pass, renderOutput, uniform, vec4, saturation, screenUV, smoothstep, float } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { define, get } from '../core/registry.js';
import { h } from '../ui/shell.js';
import { AdaptiveQuality, normalizeGraphics, qualityStatusText } from './adaptive-quality.js';

const KEY = 'polyreaver.gfx';
const gfx = normalizeGraphics();
try {

	Object.assign( gfx, normalizeGraphics( JSON.parse( localStorage.getItem( KEY ) || '{}' ) ) );

} catch { /* storage blocked: defaults */ }
const adaptive = new AdaptiveQuality( gfx );
let renderContext = null;

function saveGraphics() {

	try {

		localStorage.setItem( KEY, JSON.stringify( gfx ) );

	} catch { /* not saved: fine for this session */ }

}

function setGraphics( patch ) {

	if ( ! patch || typeof patch !== 'object' ) return;
	const next = { ...gfx, ...patch };
	// Explicit manual resolution wins unless the caller also explicitly opts in.
	if ( Object.hasOwn( patch, 'scale' ) && ! Object.hasOwn( patch, 'quality' ) ) next.quality = 'manual';
	const normalized = normalizeGraphics( next );
	const previousScale = adaptive.scale;
	const controlChanged = normalized.scale !== gfx.scale || normalized.quality !== gfx.quality;
	Object.assign( gfx, normalized );
	if ( controlChanged ) adaptive.configure( gfx );
	else adaptive.reset();
	if ( renderContext ) {

		if ( previousScale !== adaptive.scale ) applyScale( renderContext );
		updateBloom( renderContext.world );

	}
	saveGraphics();

}

const coarse = () => typeof matchMedia === 'function' && matchMedia( '(pointer: coarse)' ).matches;
const postOn = () => gfx.post === 'on' || ( gfx.post === 'auto' && ! coarse() );

const u = {
	bloom: uniform( 0.6 ), sat: uniform( 1 ), contrast: uniform( 1 ), vignette: uniform( 0.35 ), tint: uniform( new THREE.Color( 1, 1, 1 ) )
};

// The graph depends on two switches (MSAA in the scene pass, bloom on/off); the rest
// are uniforms. buildKey() changes -> the pipeline is rebuilt once.
const buildKey = () => `${gfx.msaa && ! coarse()}:${gfx.bloom > 0}`;

function build( rc ) {

	const pipeline = new THREE.RenderPipeline( rc.renderer );
	const scene = pass( rc.scene, rc.camera, { samples: gfx.msaa && ! coarse() ? 4 : 0 } );
	const color = gfx.bloom > 0 ? scene.rgb.add( bloom( scene, u.bloom, 0.45, 0.88 ).rgb ) : scene.rgb;
	let out = renderOutput( vec4( color, 1 ) );
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
	rc.renderer.setPixelRatio( base * adaptive.scale );
	rc.resize();

}

function updateBloom( world ) {

	const theme = get( 'theme', world?.layout?.theme ?? world?.spec?.theme );
	u.bloom.value = ( theme?.post?.bloom ?? 0.5 ) * 0.55 * gfx.bloom;

}

define( 'renderSystem', { id: 'game-post', order: 98,
	init( rc ) {

		rc.baseDpr = rc.renderer.getPixelRatio();
		renderContext = rc;
		this.rc = rc;
		this.pipeline = null;
		this.lastFrame = null;
		this.gpuSample = null;
		this.gpuPending = false;
		this.gpuFailed = false;
		this.gpuAt = - Infinity;
		this.generation = 0;
		adaptive.configure( gfx );
		this.visibility = () => {

			adaptive.reset();
			this.lastFrame = null;
			this.gpuSample = null;
			this.generation ++;

		};
		document.addEventListener( 'visibilitychange', this.visibility );
		if ( gfx.scale !== 1 ) applyScale( rc );

	},
	onWorld( rc, world ) {

		const theme = get( 'theme', world.layout?.theme ?? world.spec?.theme );
		const p = theme?.post || {};
		updateBloom( world );
		u.sat.value = p.saturation ?? 1;
		u.contrast.value = p.contrast ?? 1;
		u.vignette.value = p.vignette ?? 0.3;
		u.tint.value.set( p.tint ?? '#ffffff' );
		// World changes may compile shaders or upload meshes. Exclude that startup
		// and restart the measurement window while preserving the current scale.
		adaptive.reset();
		this.lastFrame = null;
		this.gpuSample = null;
		this.generation ++;

	},
	update( rc ) {

		const now = performance.now();
		const active = ! rc.game.paused && ! rc.world?.paused;
		const hidden = document.hidden;
		const frameMs = this.lastFrame === null ? NaN : now - this.lastFrame;
		this.lastFrame = now;
		const previousScale = adaptive.scale;
		const gpuMs = this.gpuSample && now - this.gpuSample.at < 1000 ? this.gpuSample.ms : null;
		adaptive.sample( { now, frameMs, gpuMs, active, hidden } );
		if ( previousScale !== adaptive.scale ) applyScale( rc );
		if ( ! active || hidden ) {

			this.lastFrame = null;
			this.gpuSample = null;
			this.generation ++;

		} else if ( gfx.quality !== 'manual' && rc.gpu?.timestamps && ! this.gpuPending && ! this.gpuFailed && now - this.gpuAt >= 250 ) {

			// Resolve the preceding frame's render/compute queries without blocking
			// rendering. Reject late results across world/pause/visibility changes.
			this.gpuPending = true;
			this.gpuAt = now;
			const generation = this.generation;
			Promise.all( [ rc.renderer.resolveTimestampsAsync( 'render' ), rc.renderer.resolveTimestampsAsync( 'compute' ) ] ).then( ( times ) => {

				if ( this.generation !== generation || rc.game.paused || document.hidden ) return;
				const ms = times.reduce( ( sum, value ) => sum + ( Number.isFinite( value ) ? value : 0 ), 0 );
				if ( ms > 0 ) this.gpuSample = { at: performance.now(), ms };

			} ).catch( () => {

				this.gpuFailed = true; // frame intervals remain usable without queries
				this.gpuSample = null;

			} ).finally( () => { this.gpuPending = false; } );

		}

		if ( postOn() ) {

			const key = buildKey();
			if ( this.key !== key ) {

				this.pipeline?.dispose();
				this.pipeline = build( rc );
				this.key = key;

			}

			rc.post = this.pipeline;

		} else rc.post = null;

	},
	dispose() {

		document.removeEventListener( 'visibilitychange', this.visibility );
		this.pipeline?.dispose();
		this.generation ++;
		renderContext = null;

	}
} );

// --- Graphics panel (pause menu) ---------------------------------------------------------

define( 'uiPanel', { id: 'graphics', order: 87, modal: true, startOpen: false, pauseButton: 'Graphics',
	mount( ui ) {

		const mode = h( 'select', { id: 'gfx-post', onchange: () => {

			setGraphics( { post: mode.value } );

		} }, [ [ 'auto', 'Auto (on for desktop, off for phones)' ], [ 'on', 'On' ], [ 'off', 'Off' ] ].map( ( [ v, t ] ) => h( 'option', { value: v, text: t } ) ) );
		const glow = h( 'input', { id: 'gfx-bloom', type: 'range', min: 0, max: 200, step: 5, oninput: () => {

			setGraphics( { bloom: + glow.value / 100 } );

		} } );
		const scale = h( 'select', { id: 'gfx-scale', 'aria-describedby': 'gfx-adaptive-help', onchange: () => {

			setGraphics( { scale: + scale.value } );
			this.sync();

		} }, [ [ 1, 'Full' ], [ 0.75, '75%' ], [ 0.5, '50%' ] ].map( ( [ v, t ] ) => h( 'option', { value: v, text: t } ) ) );
		const quality = h( 'select', { id: 'gfx-quality', 'aria-describedby': 'gfx-adaptive-help', onchange: () => {

			setGraphics( { quality: quality.value } );
			this.sync();

		} }, [ [ 'manual', 'Manual (default)' ], [ 'adaptive30', 'Adaptive · target 30 fps' ], [ 'adaptive60', 'Adaptive · target 60 fps' ] ].map( ( [ value, text ] ) => h( 'option', { value, text } ) ) );
		this.status = h( 'p', { id: 'gfx-quality-status', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true', class: 'dim' } );
		this.updateStatus = () => {

			const text = qualityStatusText( adaptive.status() );
			if ( this.status.textContent !== text ) this.status.textContent = text;

		};
		this.sync = () => {

			mode.value = gfx.post; glow.value = Math.round( gfx.bloom * 100 ); scale.value = String( gfx.scale ); quality.value = gfx.quality;
			this.updateStatus();

		};

		return h( 'div', { class: 'panel menu' },
			h( 'h2', { text: 'Graphics' } ),
			h( 'div', { class: 'tuning' },
				h( 'div', { class: 'trow' }, h( 'label', { for: 'gfx-post', text: 'Post-processing' } ), mode, h( 'span' ) ),
				h( 'div', { class: 'trow' }, h( 'label', { for: 'gfx-bloom', text: 'Bloom' } ), glow, h( 'span' ) ),
				h( 'div', { class: 'trow' }, h( 'label', { for: 'gfx-scale', text: 'Resolution ceiling' } ), scale, h( 'span' ) ),
				h( 'div', { class: 'trow' }, h( 'label', { for: 'gfx-quality', text: 'Quality control' } ), quality, h( 'span' ) ) ),
			this.status,
			h( 'p', { id: 'gfx-adaptive-help', class: 'dim', text: 'Adaptive quality adjusts resolution between 50% and your ceiling while playing. It measures several seconds before changing; paused or hidden tabs are excluded. Choosing a resolution switches to manual. This browser remembers your preference.' } ),
			h( 'p', { class: 'dim', text: 'Post-processing applies each area\'s bloom and colour grade in one extra full-screen pass. Lower the resolution first if a phone runs hot.' } ),
			h( 'div', { class: 'btns' }, h( 'button', { text: 'Done', onclick: () => ui.open( 'graphics', false ) } ) ) );

	},
	onOpen() {

		this.sync();

	},
	update() {

		this.updateStatus();

	}
} );

define( 'bootHook', { id: 'game-gfx', order: 2, boot( { game } ) {

	game.gfx = {
		get: () => ( { ...gfx, active: postOn(), currentScale: adaptive.scale, adaptive: adaptive.status() } ),
		set: setGraphics,
		status: () => qualityStatusText( adaptive.status() )
	};

} } );
