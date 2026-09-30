// Post-processing graph builder (three.js RenderPipeline + TSL nodes).
//
// When every post effect is off we skip the pipeline entirely and render
// straight to the canvas - an extra full-screen pass is itself a real cost on
// phones (one more read + write of every pixel).

import * as THREE from 'three/webgpu';
import {
	pass, mrt, output, normalView, velocity, metalness, roughness, diffuseColor, vec2, vec3, vec4, uniform, sample,
	screenUV, renderOutput, packNormalToRGB, unpackRGBToNormal, mix, smoothstep, abs, float, saturation, convertToTexture,
	orthographicDepthToViewZ
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
import { vignette } from 'three/addons/tsl/display/CRT.js';
import { bayerDither } from 'three/addons/tsl/math/Bayer.js';

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

			if ( S.upscaler === 'fsr1' && S.renderScale < 1 ) scenePass.setResolutionScale( S.renderScale );

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

			if ( S.upscaler === 'fsr1' && S.renderScale < 1 ) {

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

				const vel = scenePass.getTextureNode( 'velocity' ).mul( this.u.motion );
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

		pipeline.outputNode = out;
		this.pipeline = pipeline;
		this.passes += 1;
		return warnings;

	}

	render() {

		this.pipeline.render();

	}

}
