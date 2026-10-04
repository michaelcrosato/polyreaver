// The city shares the original feature catalog, UI, post chain and benchmarks.
// Population is bounded by the authored city's 100K navigation scenario; geometry,
// shading, animation and physics still use the same underlying engine controls.
import { ClusteredLighting } from 'three/addons/lighting/ClusteredLighting.js';
import { defaults, SECTIONS, PRESETS, COUNT_STEPS, CAPACITIES } from '../features.js';
import { readHash, CROWD_KEYS, SHADING_KEYS, WORLD_KEYS, RES_KEYS, POST_KEYS, PHYS_KEYS, DPR } from '../app/config.js';
import { applyPost, applyPhysics } from '../app/apply.js';
import { PostFX, needsPost } from '../post.js';
import { UI } from '../ui.js';
import { Bench } from '../bench.js';
import { isCel, makeCelMaterial } from '../cel.js';
import { getModels } from '../crowd/models.js';
import { CityEnvironment } from './render/environment.js';
import { CityPhysics } from './physics.js';

export const cityDefaults = () => ( { ...defaults(), count: 100000, tier: 0, path: 'gpu', maxDpr: '1' } );
const descriptions = {
	count: { info: 'Persistent citizens with real city addresses. This city scenario supports up to 100,000 citizens; the classic test supports millions on a plaza.' },
	capacity: { info: 'GPU buffer allocation for this city. Auto uses the next power of two above citizens + player. Larger buffers measure memory overhead without adding citizens.' },
	behaviour: { options: [ [ 0, 'City home/work/leisure routes' ], [ 1, 'Converge on address near player' ], [ 2, 'Flee to distant city address' ], [ 3, 'Dance party' ], [ 4, 'Stadium wave' ], [ 5, 'Freeze pedestrians' ] ], info: 'Converge and flee follow streets to a nearby/distant address. Dance, wave and freeze keep citizens on their current street.' },
	density: { label: 'Lane density', info: 'Concentrates walkers near the center of each sidewalk, changing local congestion. Street layout and citizen count stay fixed.' },
	activity: { label: 'Activity (shorter visits)', info: 'Changes destination dwell time: more activity means shorter visits. Zero stops walking. Street signals and address reservations remain active.' },
	props: { label: 'Street props', info: 'Show trees, lamps, benches and other street furniture. Buildings and the street network remain present.' },
	crowdMode: { options: [ [ 'off', 'Off (citizen separation disabled)' ], [ 'gpu', 'GPU collisions + street navigation' ], [ 'rapier', 'Rapier first N + GPU for the rest' ] ], info: 'Off disables citizen separation. GPU adds body collisions; Rapier uses rigid-body citizens. Physics displacement is projected onto the current street so people keep valid routes.' },
	physProps: { label: 'Street props are solid', info: 'Adds tree and lamp colliders. Buildings, canal banks and bridge ground stay solid.' },
	propsDynamic: { label: 'Street props can topple', info: 'Trees and lamps use sleeping rigid bodies and can be knocked over. City buildings remain static.' }
};

export function initOptions( app ) {

	app.S = { ...cityDefaults(), ...readHash() };
	app.defaultLighting = app.renderer.lighting;
	app.environment = new CityEnvironment( app.renderer, app.scene );
	app.post = new PostFX( app.renderer, app.scene );
	app.optionQueue = Promise.resolve();
	app._optionsReady = false;
	app.crowdLimitNote = 'city scenario limit reached (100,000 citizens); use the classic test to measure larger crowds';
	app.hardMaxCapacity = 100000; // max crowd benchmark: citizens, excluding the player
	app.storageLimit = app.gpu.limits.maxStorageBuffersPerShaderStage;
	const maxBufferCapacity = 2 ** Math.floor( Math.log2( Math.min( 4194304, app.gpu.limits.maxStorageBufferBindingSize / 72 ) ) );
	app.maxBufferCapacity = maxBufferCapacity;
	const capacities = [ ...new Set( [ 65536, 131072, ...CAPACITIES ] ) ].filter( ( c ) => c <= maxBufferCapacity ).sort( ( a, b ) => a - b );
	const sections = SECTIONS.map( ( section ) => ( { ...section, items: section.items.map( ( item ) => ( {
		...item, ...( descriptions[ item.key ] || {} ),
		...( item.key === 'capacity' ? { options: [ [ 'auto', 'Auto' ], ...capacities.map( ( c ) => [ c, c.toLocaleString() ] ) ] } : {} )
	} ) ) } ) );
	app.ui = new UI( app.S, {
		body: document.getElementById( 'city-options' ), panel: document.getElementById( 'panel' ), warnings: document.getElementById( 'city-warnings' ),
		camera: false, bindPanel: false, sections, countSteps: [ 1, ...COUNT_STEPS.filter( ( n ) => n > 1 && n <= 100000 ), 100000 ].filter( ( n, i, a ) => a.indexOf( n ) === i ).sort( ( a, b ) => a - b ),
		hint: 'The same graphics, animation and physics controls as the classic crowd test, applied to this city. Tap ⓘ for cost notes and city-specific behavior.',
		benchHint: 'Standard runs the four city scenarios at 1080p with 100,000 citizens. Max crowd searches up to this city’s 100K capacity. Effect costs compare the current settings. Stop cancels either benchmark.',
		onChange: ( key, value ) => app.set( key, value ).catch( ( error ) => app.ui.setWarnings( [ error.message ] ) ),
		onPreset: ( id ) => app.preset( id ).catch( ( error ) => app.ui.setWarnings( [ error.message ] ) ),
		onAction: ( id ) => Promise.resolve( app.action( id ) ).catch( ( error ) => app.ui.setWarnings( [ error.message ] ) )
	} );
	app.bench = new Bench( app );
	app.bench.standard = () => action( app, 'benchStandard' );
	app.set = ( key, value ) => enqueue( app, { [ key ]: value } );
	app.applyAll = ( values ) => enqueue( app, values );
	app.preset = ( id ) => {

		const preset = PRESETS[ id ].values;
		const values = { ...cityDefaults(), ...preset };
		for ( const key of [ 'count', 'capacity', 'camera', 'physics', 'bodies', 'shape', 'behaviour', 'density', 'crowdMode' ] ) if ( ! ( key in preset ) ) values[ key ] = app.S[ key ];
		return app.applyAll( values );

	};
	app.action = ( id ) => action( app, id );
	app.shareLink = () => {

		const url = new URL( location.href ); url.searchParams.set( 'engine', 'stress' );
		const params = new URLSearchParams( { seed: app.config.seed, population: String( app.config.population ) } );
		for ( const [ key, value ] of Object.entries( app.S ) ) params.set( key, typeof value === 'boolean' ? value ? '1' : '0' : String( value ) );
		url.hash = params.toString(); return url.href;

	};
	app.resize = () => resize( app );
	app.setFixedResolution = ( res ) => { app.fixedResolution = res; resize( app ); };

}

function enqueue( app, values ) {

	const run = app.optionQueue.catch( () => {} ).then( () => change( app, values ) );
	app.optionQueue = run;
	return run;

}

async function change( app, values ) {

	if ( app.benchmarking ) throw new Error( 'Stop the city benchmark before changing settings.' );
	const keys = Object.keys( values );
	const before = { ...app.S };
	Object.assign( app.S, values );
	app.S.count = Math.max( 1, Math.min( 100000, Math.floor( Number( app.S.count ) ) ) );
	if ( ! Number.isFinite( app.S.count ) ) { Object.assign( app.S, before ); throw new Error( 'Invalid citizen count.' ); }
	const allocation = app.S.capacity === 'auto' ? 'auto' : Math.min( app.maxBufferCapacity, Math.max( 2 ** Math.ceil( Math.log2( app.S.count + 1 ) ), Number( app.S.capacity ) ) );
	app.S.capacity = allocation;
	try {

		if ( app.S.count !== app.config.population || app.S.capacity !== before.capacity ) await app.regenerate( { population: app.S.count } );
		else await applyOptions( app, keys );
		app.ui.sync();
		location.hash = new URL( app.shareLink() ).hash;

	} catch ( error ) {

		Object.assign( app.S, before ); app.ui.sync(); throw error;

	}

}

export async function attachOptions( app ) {

	app.S.count = app.config.population;
	app.crowd.materialFactory = ( kind ) => isCel( kind ) ? makeCelMaterial( kind ) : null;
	app.environment.attach( app.world, app.traffic );
	app.physics = new CityPhysics( app );
	app._shadingKey = null;
	await applyOptions( app );
	app._optionsReady = true;
	app.ui.sync();

}

async function applyOptions( app, keys = null ) {

	const has = ( group ) => ! keys || keys.some( ( k ) => group.has( k ) );
	const S = app.S, env = app.environment;
	if ( has( SHADING_KEYS ) ) {

		const lighting = S.clustered ? app.clusteredLighting ||= new ClusteredLighting( 1024 ) : app.defaultLighting;
		app.renderer.lighting = lighting;
		if ( ! app._shadingKey || app._shadingKey !== `${S.shading}|${S.shadows}` ) {

			env.setShadows( S.shadows ); app.world.setShading( S.shading ); app.physics.setShading( S.shading ); app.physics.setShadows( S.shadows !== 'off' );
			app._shadingKey = `${S.shading}|${S.shadows}`;

		}
		env.hemi.visible = S.hemi; env.setEnvironment( S.env ); env.setPointLights( Number( S.pointLights ) );

	}
	if ( has( CROWD_KEYS ) || has( SHADING_KEYS ) ) {

		const crowd = app.crowd;
		// Preserve the city's two-triangle far markers, while exposing all four
		// original character models for the nearest tier and the direct path.
		const top = getModels()[ Number( S.tier ) >= 3 ? 3 : 2 ];
		if ( crowd.models[ 3 ] !== top ) {

			crowd.models[ 3 ] = top;
			for ( const geo of [ crowd.lodGeos?.[ 3 ], crowd.casterGeos?.[ 3 ] ].filter( Boolean ) ) {

				for ( const name of Object.keys( geo.attributes ) ) geo.deleteAttribute( name );
				for ( const [ name, attr ] of Object.entries( top.geometry.attributes ) ) geo.setAttribute( name, attr );
				geo.setIndex( top.geometry.index );

			}
			if ( crowd.drawArgs ) { crowd.drawArgs.array[ 15 ] = crowd.drawArgs.array[ 35 ] = top.geometry.index.count; crowd.drawArgs.needsUpdate = true; }
			crowd.vatTextures[ 3 ]?.dispose(); crowd.vatTextures[ 3 ] = null;
			crowd.materialKind = null;

		}
		crowd.shadowLight = env.sun;
		crowd.set( { tier: Math.min( 3, Number( S.tier ) + 1 ), path: S.path, animSystem: S.anim, animBlend: S.animBlend,
			materialKind: S.shading, outlines: S.outlines, rim: S.rim, blobShadows: S.blobShadows, lodEnabled: S.lod, motionVectors: S.motionVectors,
			castShadow: S.shadows !== 'off' && S.crowdShadows, receiveShadow: S.shadows !== 'off' } );
		crowd.u.outline.value = S.outlineWidth; crowd.u.density.value = S.density; crowd.u.activity.value = S.activity; crowd.u.speedScale.value = S.speed; crowd.u.behaviour.value = Number( S.behaviour );
		document.getElementById( 'quality' ).value = String( S.tier );

	}
	if ( has( WORLD_KEYS ) ) {

		env.setSky( S.sky ); env.setFog( S.fog ); app.world.setProps( S.props ); app.world.setGroundDetail( S.groundDetail );
		if ( app.physics.enabled ) app.physics.rebuildPropColliders();

	}
	if ( ! keys || keys.includes( 'camera' ) ) app.cameraMode( S.camera );
	if ( has( RES_KEYS ) ) resize( app );
	if ( has( POST_KEYS ) || has( RES_KEYS ) || has( SHADING_KEYS ) || ! keys || keys.includes( 'camera' ) ) applyPost( app );
	if ( has( PHYS_KEYS ) ) {

		applyPhysics( app );
		if ( app.physicsStartup ) await app.physicsStartup;
		app.profile.separation = S.crowdMode !== 'off'; app.profile.radius.value = S.agentRadius;

	}

}

function resize( app ) {

	const fixed = app.fixedResolution;
	const cap = app.S.maxDpr === 'native' ? DPR : Math.min( DPR, Number( app.S.maxDpr ) );
	const fsr = app.S.upscaler === 'fsr1' && app.S.renderScale < 1 && needsPost( app.S );
	app.renderer.setPixelRatio( fixed ? 1 : cap * ( fsr ? 1 : app.S.renderScale ) );
	app.renderer.setSize( fixed?.width || innerWidth, fixed?.height || innerHeight );
	app.rig.setAspect( ( fixed?.width || innerWidth ) / ( fixed?.height || innerHeight ) );
	app.post.onResize();

}

async function action( app, id ) {

	if ( id === 'benchStop' ) { app.bench.stop(); app.cancelBenchmark = true; return; }
	if ( app.benchmarking && [ 'benchCrowd', 'benchFx' ].includes( id ) ) throw new Error( 'Stop the city benchmark before starting another benchmark.' );
	if ( id === 'benchCrowd' ) return app.bench.findMaxCrowd( Number( app.ui.benchTarget.value ) );
	if ( id === 'benchFx' ) return app.bench.measureEffects();
	if ( id === 'benchStandard' ) {

		const report = await app.benchmark();
		app.bench.results.standard = report;
		const text = document.getElementById( 'report-text' ); text.value = JSON.stringify( report, null, 2 ); text.hidden = false;
		app.ui.setBenchOutput( 'City benchmark complete. The full report is above.' );
		return report;

	}
	if ( id === 'report' || id === 'share' ) {

		const report = id === 'share' ? app.shareLink() : JSON.stringify( { ...app.describe(), settings: app.S, benchmarks: app.bench.results }, null, 2 );
		const text = document.getElementById( 'report-text' ); text.value = report; text.hidden = false; text.select();
		try { await navigator.clipboard.writeText( report ); } catch { /* The text remains selectable. */ }
		return;

	}
	if ( [ 'explode', 'wrecking', 'respawn' ].includes( id ) ) {

		if ( ! app.S.physics ) await app.set( 'physics', true );
		if ( app.physicsStartup ) await app.physicsStartup;
		if ( id === 'explode' ) app.physics.explode( app.hero.pos );
		if ( id === 'wrecking' ) app.physics.dropWreckingBall( app.hero.pos, app.hero.heading );
		if ( id === 'respawn' ) app.physics.respawn();

	}

}
