// Post-processing graph builder (three.js RenderPipeline + TSL nodes).
//
// When every post effect is off we skip the pipeline entirely and render
// straight to the canvas - an extra full-screen pass is itself a real cost on
// phones (one more read + write of every pixel).

import * as THREE from 'three/webgpu';
import {
	pass, mrt, output, normalView, velocity, metalness, roughness, diffuseColor, vec2, vec3, vec4, uniform, sample,
	screenUV, renderOutput, packNormalToRGB, unpackRGBToNormal, mix, smoothstep, abs, float, saturation, convertToTexture,
	orthographicDepthToViewZ, Fn, Loop, If, int, floor, dot, clamp, uniformArray
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { ssao } from 'three/addons/tsl/display/SSAONode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { smaa } from 'three/addons/tsl/display/SMAANode.js';
import { motionBlur } from 'three/addons/tsl/display/MotionBlur.js';
import { chromaticAberration } from 'three/addons/tsl/display/ChromaticAberrationNode.js';
import { film } from 'three/addons/tsl/display/FilmNode.js';
import { pixelationPass } from 'three/addons/tsl/display/PixelationPassNode.js';
import { sobel } from 'three/addons/tsl/display/SobelOperatorNode.js';
import { retroPass } from 'three/addons/tsl/display/RetroPassNode.js';
import { fsr1 } from 'three/addons/tsl/display/FSR1Node.js';
import { sharpen } from 'three/addons/tsl/display/SharpenNode.js';
import { ssr } from 'three/addons/tsl/display/SSRNode.js';
import { ssgi } from 'three/addons/tsl/display/SSGINode.js';
import { gaussianBlur } from 'three/addons/tsl/display/GaussianBlurNode.js';
import { vignette, barrelUV, barrelMask, scanlines, colorBleeding } from 'three/addons/tsl/display/CRT.js';
import { bayerDither } from 'three/addons/tsl/math/Bayer.js';

// Pixel-art filters: render the whole scene at a console-like resolution, upscale with
// nearest-neighbour sampling, then quantise colours to a palette with ordered (Bayer)
// dithering. Because the scene really is rendered at low resolution these are FASTER
// than native rendering - a rare effect that saves GPU time.
const hexes = ( list ) => list.map( ( h ) => new THREE.Color().setHex( h, THREE.NoColorSpace ) );
export const PIXEL_MODES = {
	pico8: { height: 180, palette: hexes( [ 0x000000, 0x1d2b53, 0x7e2553, 0x008751, 0xab5236, 0x5f574f, 0xc2c3c7, 0xfff1e8, 0xff004d, 0xffa300, 0xffec27, 0x00e436, 0x29adff, 0x83769c, 0xff77a8, 0xffccaa ] ) },
	gameboy: { height: 144, palette: hexes( [ 0x0f380f, 0x306230, 0x8bac0f, 0x9bbc0f ] ) },
	snes: { height: 224, bits: 5 },
	crt: { height: 240, bits: 6, crt: true }
};

const BAYER4 = [ 0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5 ].map( ( v ) => ( v + 0.5 ) / 16 );

export function needsPost( S ) {

	return S.aa === 'fxaa' || S.aa === 'smaa' || S.aa === 'traa' || S.ao !== 'off' || S.bloom || S.dof !== 'off' ||
		S.motionBlur || S.ssr || S.ssgi || S.grading || S.vignette || S.grain || S.chromatic || S.sharpen ||
		S.stylize !== 'none' || ( S.upscaler === 'fsr1' && S.renderScale < 1 );

}

export class PostFX {

	constructor( renderer, scene ) {

		this.renderer = renderer;
		this.scene = scene;
		this.pipeline = null;
		this.nodes = [];
		this.passes = 0; // approximate number of full-screen passes (for the HUD)
		this.u = {
			focus: uniform( 30 ),
			focalLength: uniform( 12 ),
			bokeh: uniform( 2 ),
			motion: uniform( 1 ),
			bloomStrength: uniform( 0.45 ),
			grain: uniform( 0.12 ),
			ca: uniform( 0.25 ),
			tiltBand: uniform( 0.12 )
		};
		this.lowRes = uniform( new THREE.Vector2( 320, 180 ) );
		this.bayer = uniformArray( BAYER4, 'float' );

	}

	get active() {

		return this.pipeline !== null;

	}

	dispose() {

		for ( const n of this.nodes ) n.dispose?.();
		this.nodes = [];
		if ( this.pipeline ) this.pipeline.dispose();
		this.pipeline = null;

	}

	// Returns a list of warnings for the UI (effects skipped because of conflicts).
	build( S, camera ) {

		this.dispose();
		const warnings = [];
		this.passes = 0;
		this._pixelPass = null;
		this._pixelMode = null;
		this.scenePass = null;
		if ( ! needsPost( S ) ) return warnings;

		const renderer = this.renderer;
		const scene = this.scene;
		const keep = ( n ) => {

			this.nodes.push( n );
			this.passes ++;
			return n;

		};

		const pipeline = new THREE.RenderPipeline( renderer );
		pipeline.outputColorTransform = false; // we call renderOutput() ourselves so AA/grain run after tone mapping

		const styl = S.stylize;
		const special = styl === 'pixel' || styl === 'retro';
		let color;
		let scenePass;

		if ( special ) {

			for ( const k of [ 'ao', 'ssr', 'ssgi', 'motionBlur', 'dof' ] ) {

				if ( S[ k ] && S[ k ] !== 'off' ) warnings.push( `${k} is skipped while the ${styl} stylize mode is active` );

			}

			if ( S.aa === 'traa' ) warnings.push( 'TRAA is skipped in pixel/retro mode' );
			scenePass = keep( styl === 'retro'
				? retroPass( scene, camera, { affineDistortion: uniform( 1 ) } )
				: pixelationPass( scene, camera, uniform( 3 ), uniform( 0.3 ), uniform( 0.4 ) ) );
			color = scenePass;

		} else {

			const useMSAA = S.aa === 'msaa';
			scenePass = keep( pass( scene, camera, { samples: useMSAA ? 4 : 0 } ) );

			const needNormal = S.ao !== 'off' || S.ssr || S.ssgi;
			const needVelocity = S.aa === 'traa' || S.motionBlur || S.ssgi;
			const outs = { output };
			if ( needNormal ) outs.normal = packNormalToRGB( normalView );
			if ( needVelocity ) outs.velocity = velocity;
			if ( S.ssr ) outs.metalrough = vec2( metalness, roughness );
			if ( S.ssgi ) outs.diffuseColor = diffuseColor;
			if ( Object.keys( outs ).length > 1 ) scenePass.setMRT( mrt( outs ) );
			// Bandwidth optimisation: 8-bit normal / material buffers.
			if ( needNormal ) scenePass.getTexture( 'normal' ).type = THREE.UnsignedByteType;
			if ( S.ssr ) scenePass.getTexture( 'metalrough' ).type = THREE.UnsignedByteType;
			if ( S.ssgi ) scenePass.getTexture( 'diffuseColor' ).type = THREE.UnsignedByteType;

			const pix = PIXEL_MODES[ styl ];
			this._pixelPass = pix ? scenePass : null;
			this._pixelMode = pix || null;
			if ( pix ) {

				this._applyPixelScale();
				for ( const tex of [ scenePass.getTexture( 'output' ) ] ) tex.minFilter = tex.magFilter = THREE.NearestFilter;
				if ( S.upscaler === 'fsr1' ) warnings.push( 'FSR 1 upscaling is skipped in pixel-art modes' );

			} else if ( S.upscaler === 'fsr1' && S.renderScale < 1 ) scenePass.setResolutionScale( S.renderScale );

			const sceneColor = scenePass.getTextureNode( 'output' );
			const depth = scenePass.getTextureNode( 'depth' );
			const normalTex = needNormal ? scenePass.getTextureNode( 'normal' ) : null;
			const normal = needNormal ? sample( ( uv ) => unpackRGBToNormal( normalTex.sample( uv ) ) ) : null;
			color = sceneColor;

			if ( S.ssgi ) {

				const gi = keep( ssgi( sceneColor, depth, normal, camera ) );
				gi.sliceCount.value = 2;
				gi.stepCount.value = 8;
				gi.useTemporalFiltering = S.aa === 'traa';
				const diffuse = scenePass.getTextureNode( 'diffuseColor' );
				color = vec4( color.rgb.mul( gi.getAONode() ).add( diffuse.rgb.mul( gi.getGINode().rgb ) ), color.a );
				if ( S.ao !== 'off' ) warnings.push( 'AO is included in SSGI' );

			} else if ( S.ao !== 'off' ) {

				const aoPass = keep( S.ao === 'gtao' ? ao( depth, normal, camera ) : ssao( depth, normal, camera ) );
				aoPass.resolutionScale = 0.5;
				if ( S.ao === 'gtao' ) {

					aoPass.useTemporalFiltering = S.aa === 'traa';
					aoPass.radius.value = 0.6;

				} else {

					aoPass.radius.value = 0.6;
					aoPass.intensity.value = 1.4;

				}

				const occlusion = aoPass.getTextureNode().sample( screenUV ).r;
				color = vec4( color.rgb.mul( occlusion ), color.a );

			}

			if ( S.ssr ) {

				const mr = scenePass.getTextureNode( 'metalrough' );
				const ssrPass = keep( ssr( sceneColor, depth, normal, { metalnessNode: mr.r, roughnessNode: mr.g, camera } ) );
				ssrPass.resolutionScale = 0.5;
				ssrPass.maxDistance.value = 30;
				ssrPass.thickness.value = 0.3;
				color = vec4( color.rgb.add( ssrPass.rgb ), color.a );

			}

			if ( S.aa === 'traa' ) {

				const t = keep( traa( color, depth, scenePass.getTextureNode( 'velocity' ), camera ) );
				t.useSubpixelCorrection = false;
				color = t;

			}

			if ( S.upscaler === 'fsr1' && S.renderScale < 1 && ! pix ) {

				color = keep( fsr1( color ) );

			}

			if ( S.dof === 'bokeh' ) {

				// PassNode.getViewZNode() assumes a perspective depth buffer; the
				// isometric camera is orthographic (linear depth), so convert ourselves.
				const viewZ = camera.isOrthographicCamera
					? orthographicDepthToViewZ( depth, scenePass._cameraNear || uniform( camera.near ), scenePass._cameraFar || uniform( camera.far ) )
					: scenePass.getViewZNode();
				color = keep( dof( color, viewZ, this.u.focus, this.u.focalLength, this.u.bokeh ) );

			} else if ( S.dof === 'tiltshift' ) {

				const blurred = keep( gaussianBlur( color, null, 4 ) );
				const band = smoothstep( this.u.tiltBand, this.u.tiltBand.add( 0.3 ), abs( screenUV.y.sub( 0.5 ) ) );
				color = mix( color, blurred, band );

			}

			if ( S.motionBlur ) {

				// The velocity buffer holds NDC offsets (y up, 2 units across the screen) and the
				// blur steps in UV space (y down, 1 unit across): convert like TRAA does, or
				// diagonal motion smears along the mirrored diagonal at twice the length.
				const vel = scenePass.getTextureNode( 'velocity' ).xy.mul( vec2( 0.5, - 0.5 ) ).mul( this.u.motion );
				color = motionBlur( keep( convertToTexture( color ) ), vel );

			}

		}

		if ( S.bloom ) {

			const b = keep( bloom( color, this.u.bloomStrength, 0.4, 1.0 ) );
			color = vec4( color.rgb.add( b.rgb ), 1 );

		}

		// HDR -> display: tone mapping + sRGB. Everything after this works on display colours.
		let out = renderOutput( color );

		if ( ! special ) {

			if ( S.aa === 'fxaa' ) out = keep( fxaa( out ) );
			else if ( S.aa === 'smaa' ) out = keep( smaa( out ) );

		}

		if ( styl === 'ink' ) {

			const edges = keep( sobel( out ) ).r;
			out = vec4( out.rgb.mul( float( 1 ).sub( smoothstep( 0.35, 0.9, edges ).mul( 0.7 ) ) ), 1 );

		}

		if ( styl === 'retro' ) out = vec4( bayerDither( out, float( 24 ) ).rgb, 1 );
		if ( PIXEL_MODES[ styl ] ) out = this._quantize( out, PIXEL_MODES[ styl ] );

		if ( S.sharpen ) out = keep( sharpen( out, 0.25 ) );

		if ( S.grading ) {

			let rgb = saturation( out.rgb, 1.25 );
			rgb = rgb.sub( 0.5 ).mul( 1.08 ).add( 0.5 );
			rgb = rgb.mul( vec3( 1.04, 1.0, 0.94 ) );
			out = vec4( rgb, 1 );

		}

		if ( S.chromatic ) out = keep( chromaticAberration( out, this.u.ca, vec2( 0.5, 0.5 ), 1.1 ) );
		if ( S.vignette ) out = vec4( vignette( out.rgb, 0.5, 0.45 ), 1 );
		if ( S.grain ) out = vec4( film( out, this.u.grain ).rgb, 1 );

		this.scenePass = scenePass;
		pipeline.outputNode = out;
		this.pipeline = pipeline;
		this.passes += 1;
		return warnings;

	}

	// Keep the pixel-art render resolution at a fixed console-like height.
	_applyPixelScale() {

		const pix = this._pixelMode;
		if ( ! pix || ! this._pixelPass ) return;
		const size = this.renderer.getDrawingBufferSize( new THREE.Vector2() );
		const scale = Math.min( 1, pix.height / Math.max( 1, size.y ) );
		this._pixelPass.setResolutionScale( scale );
		this.lowRes.value.set( Math.max( 1, Math.floor( size.x * scale ) ), Math.max( 1, Math.floor( size.y * scale ) ) );

	}

	onResize() {

		this._applyPixelScale();

	}

	_quantize( out, pix ) {

		const lowRes = this.lowRes, bayer = this.bayer;
		const px = floor( screenUV.mul( lowRes ) );
		const threshold = bayer.element( int( px.y.mod( 4 ) ).mul( 4 ).add( int( px.x.mod( 4 ) ) ) );
		const dither = threshold.sub( 0.5 );
		let col;

		if ( pix.palette && pix.palette.length > 4 ) {

			// nearest colour in the palette (perceptually weighted), after dithering
			const pal = uniformArray( pix.palette, 'color' );
			const n = pix.palette.length;
			col = Fn( () => {

				const c = clamp( out.rgb.add( dither.mul( 0.18 ) ), 0, 1 ).toVar();
				const best = vec3( 0 ).toVar();
				const bestD = float( 1e9 ).toVar();
				Loop( n, ( { i } ) => {

					const d = c.sub( pal.element( i ) );
					const dd = dot( d.mul( d ), vec3( 0.3, 0.59, 0.11 ) );
					If( dd.lessThan( bestD ), () => {

						bestD.assign( dd );
						best.assign( pal.element( i ) );

					} );

				} );
				return best;

			} )();

		} else if ( pix.palette ) {

			// Game Boy: 4 shades of green picked by luminance
			const pal = uniformArray( pix.palette, 'color' );
			const lum = dot( out.rgb, vec3( 0.3, 0.59, 0.11 ) );
			const idx = clamp( floor( lum.mul( 3.6 ).add( dither.mul( 0.9 ) ).add( 0.25 ) ), 0, 3 );
			col = pal.element( int( idx ) );

		} else {

			// 15/18-bit colour: posterise each channel with dithering
			const levels = float( ( 1 << pix.bits ) - 1 );
			col = floor( clamp( out.rgb, 0, 1 ).mul( levels ).add( threshold ) ).div( levels );

		}

		let result = vec4( col, 1 );
		if ( pix.crt ) {

			// CRT: scanlines per low-res row, colour bleeding, barrel distortion, vignette
			result = vec4( colorBleeding( result, float( 0.0015 ) ), 1 );
			result = vec4( scanlines( result.rgb, float( 0.35 ), lowRes.y.mul( Math.PI * 2 ), float( 0 ), screenUV ), 1 );
			const tex = convertToTexture( result );
			this.nodes.push( tex );
			const buv = barrelUV( float( 0.06 ), screenUV );
			result = vec4( tex.sample( buv ).rgb.mul( barrelMask( buv ) ), 1 );
			result = vec4( vignette( result.rgb, 0.45, 0.4 ), 1 );

		}

		return result;

	}

	// Compile with the same attachments and output settings as the scene pass.
	// Compiling only the canvas path would miss MRT/MSAA pipelines used by post.
	async prepareScene( camera, onProgress ) {

		const renderer = this.renderer, pass = this.scenePass;
		if ( ! this.active ) return renderer.compileAsync( this.scene, camera, null, onProgress );
		const target = renderer.getRenderTarget(), mrt = renderer.getMRT();
		const toneMapping = renderer.toneMapping, colorSpace = renderer.outputColorSpace;
		try {

			renderer.toneMapping = THREE.NoToneMapping;
			renderer.outputColorSpace = THREE.ColorManagement.workingColorSpace;
			pass.renderTarget.samples = pass.options.samples ?? renderer.samples;
			pass.renderTarget.texture.type = renderer.getOutputBufferType();
			renderer.setRenderTarget( pass.renderTarget );
			renderer.setMRT( pass.getMRT() );
			await renderer.compileAsync( this.scene, camera, null, onProgress );

		} finally {

			renderer.setRenderTarget( target );
			renderer.setMRT( mrt );
			renderer.toneMapping = toneMapping;
			renderer.outputColorSpace = colorSpace;

		}

	}

	render() {

		this.pipeline.render();

	}

}
