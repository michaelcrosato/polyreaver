import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AdaptiveQuality, normalizeGraphics, qualityStatusText } from '../src/game/render/adaptive-quality.js';
import '../src/game/render/post.js';
import { get } from '../src/game/core/registry.js';

const quick = { quality: 'adaptive60', warmupMs: 100, windowMs: 100, minSamples: 6, downCooldownMs: 200, upCooldownMs: 600, badWindows: 2, goodWindows: 4 };
const sampleFor = ( control, duration, frameMs, { from = 0, step = 20, ...rest } = {} ) => {

	let result;
	for ( let now = from; now <= from + duration; now += step ) result = control.sample( { now, frameMs, ...rest } );
	return result;

};

test( 'defaults and malformed device preferences keep manual control with bounded settings', () => {

	assert.deepEqual( normalizeGraphics(), { post: 'auto', bloom: 1, scale: 1, msaa: true, quality: 'manual' } );
	assert.deepEqual( normalizeGraphics( null ), normalizeGraphics() );
	assert.deepEqual( normalizeGraphics( { post: 'invalid', bloom: 999, scale: - 10, msaa: 'true', quality: 'auto' } ),
		{ post: 'auto', bloom: 2, scale: 0.5, msaa: true, quality: 'manual' } );
	const control = new AdaptiveQuality();
	assert.equal( sampleFor( control, 10000, 100 ).scale, 1 );
	assert.equal( control.status().reason, 'manual' );

} );

test( 'startup and insufficient samples do not lower resolution', () => {

	const control = new AdaptiveQuality( quick );
	sampleFor( control, 80, 50 );
	assert.equal( control.status().scale, 1 );
	assert.equal( control.status().reason, 'warming-up' );
	control.sample( { now: 1000, frameMs: 50 } );
	assert.equal( control.status().scale, 1 );
	assert.equal( control.status().samples, 1 );

} );

test( 'sustained slow frames lower one step with cooldown and stop at the quality floor', () => {

	const control = new AdaptiveQuality( quick );
	sampleFor( control, 300, 30 );
	assert.equal( control.status().scale, 1 ); // one bad window cannot change resolution
	sampleFor( control, 80, 30, { from: 320 } );
	assert.equal( control.status().scale, 0.9 );
	sampleFor( control, 120, 30, { from: 420 } );
	assert.equal( control.status().scale, 0.9 );
	sampleFor( control, 3000, 30, { from: 560 } );
	assert.equal( control.status().scale, 0.5 );
	assert.equal( control.status().reason, 'floor' );
	assert.match( qualityStatusText( control.status() ), /50% minimum; target not reached/ );

} );

test( 'hysteresis ignores isolated stalls and sustained borderline frame times', () => {

	const control = new AdaptiveQuality( quick );
	for ( let now = 0; now <= 2000; now += 20 ) control.sample( { now, frameMs: now % 200 === 0 ? 500 : 16.7 } );
	assert.equal( control.status().scale, 1 );
	sampleFor( control, 2000, 18.5, { from: 2020 } );
	assert.equal( control.status().scale, 1 ); // between raise and lower thresholds

} );

test( 'recovery waits longer and GPU saturation vetoes raising a vsync-limited resolution', () => {

	const control = new AdaptiveQuality( quick );
	sampleFor( control, 380, 30 );
	assert.equal( control.status().scale, 0.9 );
	sampleFor( control, 700, 16.7, { from: 400, gpuMs: 16 });
	assert.equal( control.status().scale, 0.9 );
	sampleFor( control, 300, 16.7, { from: 1120, gpuMs: 8 });
	assert.equal( control.status().scale, 0.9 ); // too few healthy windows
	sampleFor( control, 500, 16.7, { from: 1440, gpuMs: 8 });
	assert.equal( control.status().scale, 1 );
	assert.match( qualityStatusText( control.status() ), /Adaptive 60 fps · 100% resolution/ );

} );

test( 'GPU overload lowers resolution even when submitted frames remain vsync limited', () => {

	const control = new AdaptiveQuality( quick );
	sampleFor( control, 380, 16.7, { gpuMs: 24 } );
	assert.equal( control.scale, 0.9 );
	assert.equal( control.status().frameMs, 16.7 );
	assert.equal( control.status().gpuMs, 24 );

} );

test( 'without GPU timing recovery uses sustained real frame intervals and respects a chosen ceiling', () => {

	const control = new AdaptiveQuality( { ...quick, scale: 0.75 } );
	sampleFor( control, 700, 30 );
	assert.ok( control.scale < 0.75 );
	sampleFor( control, 3000, 16.7, { from: 720 } );
	assert.equal( control.scale, 0.75 );

} );

test( 'paused, hidden and startup samples discard partial windows and restart warmup', () => {

	for ( const flags of [ { active: false }, { hidden: true }, { startup: true } ] ) {

		const control = new AdaptiveQuality( quick );
		sampleFor( control, 300, 30 );
		sampleFor( control, 5000, 999, { from: 320, ...flags } );
		assert.equal( control.scale, 1 );
		assert.equal( control.status().samples, 0 );
		sampleFor( control, 80, 30, { from: 5340 } );
		assert.equal( control.status().reason, 'warming-up' );
		assert.equal( control.scale, 1 );
		sampleFor( control, 300, 30, { from: 5440 } );
		assert.equal( control.scale, 0.9 );

	}

} );

test( 'manual override restores the specified scale and ignores later load', () => {

	const control = new AdaptiveQuality( quick );
	sampleFor( control, 700, 40 );
	assert.ok( control.scale < 1 );
	control.configure( { quality: 'manual', scale: 0.75 } );
	assert.equal( sampleFor( control, 5000, 200, { from: 720 } ).scale, 0.75 );
	assert.equal( qualityStatusText( control.status() ), 'Manual · 75% resolution' );

} );

test( '30 fps budget tolerates 30 fps frames and rejects invalid timing samples', () => {

	const control = new AdaptiveQuality( { ...quick, quality: 'adaptive30' } );
	sampleFor( control, 2000, 33.3 );
	assert.equal( control.scale, 1 );
	const before = control.status();
	for ( const frameMs of [ 0, - 1, NaN, Infinity ] ) control.sample( { now: 2020, frameMs } );
	control.sample( { now: NaN, frameMs: 100 } );
	assert.deepEqual( control.status(), before );
	sampleFor( control, 400, 45, { from: 2020 } );
	assert.equal( control.scale, 0.9 );
	assert.equal( control.status().targetFps, 30 );

} );

test( 'game Graphics API persists device preferences and an explicit manual resolution cancels adaptation', () => {

	const stored = new Map();
	const originalStorage = Object.getOwnPropertyDescriptor( globalThis, 'localStorage' );
	Object.defineProperty( globalThis, 'localStorage', { configurable: true, value: {
		getItem: ( key ) => stored.get( key ) ?? null,
		setItem: ( key, value ) => stored.set( key, value )
	} } );
	try {

		const game = {};
		get( 'bootHook', 'game-gfx' ).boot( { game } );
		game.gfx.set( { quality: 'adaptive60', scale: 0.75 } );
		assert.equal( game.gfx.get().adaptive.targetFps, 60 );
		assert.match( game.gfx.status(), /Adaptive 60 fps · 75% resolution/ );
		assert.equal( JSON.parse( stored.get( 'polyreaver.gfx' ) ).quality, 'adaptive60' );
		assert.equal( JSON.parse( stored.get( 'polyreaver.gfx' ) ).adaptive, undefined ); // transient measured state is not a preference
		game.gfx.set( { bloom: 0.5 } );
		assert.equal( game.gfx.get().quality, 'adaptive60' );
		game.gfx.set( { scale: 1 } );
		assert.equal( game.gfx.get().quality, 'manual' );
		assert.equal( game.gfx.status(), 'Manual · 100% resolution' );
		assert.equal( JSON.parse( stored.get( 'polyreaver.gfx' ) ).quality, 'manual' );
		game.gfx.set( { quality: 'bogus', scale: Infinity, post: 'bogus' } );
		assert.equal( game.gfx.get().quality, 'manual' );
		assert.equal( game.gfx.get().scale, 1 );
		assert.equal( game.gfx.get().post, 'auto' );

	} finally {

		if ( originalStorage ) Object.defineProperty( globalThis, 'localStorage', originalStorage );
		else delete globalThis.localStorage;

	}

} );

test( 'render integration uses real frame intervals, applies scale, and excludes hidden and paused frames', () => {

	const originals = new Map( [ 'document', 'performance', 'devicePixelRatio' ].map( ( key ) => [ key, Object.getOwnPropertyDescriptor( globalThis, key ) ] ) );
	let now = 0, ratio = 1, resizes = 0;
	const listeners = new Map();
	const doc = { hidden: false, addEventListener: ( type, fn ) => listeners.set( type, fn ), removeEventListener: ( type ) => listeners.delete( type ) };
	for ( const [ key, value ] of [ [ 'document', doc ], [ 'performance', { now: () => now } ], [ 'devicePixelRatio', 1 ] ] ) Object.defineProperty( globalThis, key, { configurable: true, value } );
	const system = get( 'renderSystem', 'game-post' );
	try {

		const game = { paused: false };
		get( 'bootHook', 'game-gfx' ).boot( { game } );
		game.gfx.set( { quality: 'adaptive60', scale: 1, post: 'off' } );
		const rc = { game, world: { paused: false }, gpu: { timestamps: false },
			renderer: { getPixelRatio: () => ratio, setPixelRatio: ( value ) => { ratio = value; } }, resize: () => { resizes ++; } };
		system.init( rc ); system.onWorld( rc, rc.world );
		for ( let frame = 0; frame < 201; frame ++ ) {

			now += 40;
			system.update( rc, rc.world, 0, 0.001 ); // dt is deliberately misleading; wall time measures 25 fps

		}
		assert.equal( game.gfx.get().currentScale, 0.9 );
		assert.equal( game.gfx.get().adaptive.frameMs, 40 );
		assert.equal( ratio, 0.9 );
		assert.equal( resizes, 1 );
		game.paused = true;
		for ( let frame = 0; frame < 40; frame ++ ) { now += 1000; system.update( rc ); }
		assert.equal( game.gfx.get().adaptive.reason, 'paused' );
		assert.equal( game.gfx.get().currentScale, 0.9 );
		game.paused = false; doc.hidden = true; listeners.get( 'visibilitychange' )();
		for ( let frame = 0; frame < 40; frame ++ ) { now += 1000; system.update( rc ); }
		assert.equal( game.gfx.get().adaptive.reason, 'hidden' );
		assert.equal( ratio, 0.9 );
		doc.hidden = false; listeners.get( 'visibilitychange' )();
		for ( let frame = 0; frame < 30; frame ++ ) { now += 40; system.update( rc ); }
		assert.equal( game.gfx.get().adaptive.reason, 'warming-up' );
		assert.equal( ratio, 0.9 );
		game.gfx.set( { scale: 0.75 } );
		assert.equal( ratio, 0.75 );
		assert.equal( game.gfx.get().quality, 'manual' );

	} finally {

		system.dispose();
		for ( const [ key, original ] of originals ) {

			if ( original ) Object.defineProperty( globalThis, key, original ); else delete globalThis[ key ];

		}

	}
	assert.equal( listeners.size, 0 );

} );
