// Benchmark "ballast": a fixed amount of dummy compute work per frame.
//
// A fast GPU that is mostly idle (light scene, frame rate capped by vsync) drops
// to power-saving clock speeds, and its timings then jump around by several
// milliseconds between identical runs - measured on an RTX 3060 Ti: 0.5 / 4.3 /
// 4.4 ms for the same settings, and bloom "costing" -0.8 ms. Under a steady load
// the same GPU reports the same time to within 1 %. So while the effect benchmark
// runs, this kernel keeps the GPU busy enough to stay at full clock. Its own cost
// is identical in the "with" and "without" measurements, so it cancels out of the
// deltas. It is never used outside benchmarks.

import { Fn, Loop, uint, fract, uniform, instancedArray, instanceIndex } from 'three/tsl';

const THREADS = 262144; // a few waves on any GPU; 4 MB of scratch memory

export class Ballast {

	constructor( renderer ) {

		this.renderer = renderer;
		this.iterations = uniform( 0, 'uint' );
		this.kernel = null;

	}

	get active() {

		return this.iterations.value > 0;

	}

	set( iterations ) {

		if ( iterations > 0 && ! this.kernel ) this._build();
		this.iterations.value = iterations;

	}

	// Call once per frame, before rendering.
	update() {

		if ( this.iterations.value > 0 ) this.renderer.compute( this.kernel );

	}

	_build() {

		const buf = instancedArray( THREADS, 'vec4' ).setName( 'ballast' );
		const iterations = this.iterations;
		this.kernel = Fn( () => {

			const v = buf.element( instanceIndex ).toVar();
			// a dependent chain of cheap ALU ops; writing the result back stops the
			// shader compiler from removing the loop
			Loop( { start: uint( 0 ), end: iterations, type: 'uint', condition: '<' }, () => {

				v.assign( fract( v.mul( 1.618 ).add( 0.1 ) ) );

			} );
			buf.element( instanceIndex ).assign( v );

		} )().compute( THREADS ).setName( 'Benchmark ballast' );

	}

}
