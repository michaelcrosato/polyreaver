// Device-local, opt-in resolution control. Frame intervals measure the experience
// including CPU work and GPU back-pressure; fresh GPU timestamps can veto a raise
// when vsync conceals how little headroom remains. No benchmark settings are used.
export const QUALITY_MODES = [ 'manual', 'adaptive30', 'adaptive60' ];

const clampScale = ( v, fallback = 1 ) => Number.isFinite( v ) ? Math.min( 1, Math.max( 0.5, v ) ) : fallback;
const percentile = ( values, fraction ) => {

	const sorted = values.slice().sort( ( a, b ) => a - b );
	return sorted[ Math.floor( ( sorted.length - 1 ) * fraction ) ];

};

export function normalizeGraphics( input = {} ) {

	return {
		post: [ 'auto', 'on', 'off' ].includes( input?.post ) ? input.post : 'auto',
		bloom: Number.isFinite( input?.bloom ) ? Math.min( 2, Math.max( 0, input.bloom ) ) : 1,
		scale: clampScale( input?.scale ),
		msaa: typeof input?.msaa === 'boolean' ? input.msaa : true,
		quality: QUALITY_MODES.includes( input?.quality ) ? input.quality : 'manual'
	};

}

export class AdaptiveQuality {

	constructor( options = {} ) {

		// Hardware-specific thresholds remain opt-in. Two bad windows lower quality;
		// four good windows plus a longer cooldown raise it one step at a time.
		this.options = { warmupMs: 3000, windowMs: 2000, minSamples: 24, downCooldownMs: 4000, upCooldownMs: 12000, badWindows: 2, goodWindows: 4, ...options };
		this.mode = 'manual';
		this.ceiling = 1;
		this.scale = 1;
		this.configure( options );

	}

	configure( { quality = this.mode, scale = this.ceiling } = {} ) {

		this.mode = QUALITY_MODES.includes( quality ) ? quality : 'manual';
		this.ceiling = clampScale( scale );
		this.scale = this.ceiling;
		this.reset();
		return this.status();

	}

	reset() {

		this.startedAt = null;
		this.windowAt = null;
		this.lastChange = null;
		this.samples = [];
		this.bad = 0;
		this.good = 0;
		this.frameMs = null;
		this.gpuMs = null;
		this.reason = this.mode === 'manual' ? 'manual' : 'warming-up';

	}

	status() {

		return { quality: this.mode, targetFps: this.mode === 'manual' ? null : this.mode === 'adaptive30' ? 30 : 60,
			scale: this.scale, ceiling: this.ceiling, floor: 0.5, reason: this.reason,
			frameMs: this.frameMs, gpuMs: this.gpuMs, samples: this.samples.length };

	}

	sample( { now, frameMs, gpuMs = null, active = true, hidden = false, startup = false } ) {

		if ( this.mode === 'manual' ) return this.status();
		if ( ! active || hidden || startup ) {

			this.reset();
			this.reason = hidden ? 'hidden' : startup ? 'warming-up' : 'paused';
			return this.status();

		}
		if ( ! Number.isFinite( now ) || ! Number.isFinite( frameMs ) || frameMs <= 0 ) return this.status();
		if ( this.startedAt === null || now < this.startedAt || ( this.samples.length && now < this.samples.at( - 1 ).now ) ) {

			this.reset();
			this.startedAt = now;
			this.lastChange = now;

		}
		if ( now - this.startedAt < this.options.warmupMs ) return this.status();
		if ( this.windowAt === null ) this.windowAt = now;
		this.samples.push( { now, frameMs, gpuMs: Number.isFinite( gpuMs ) && gpuMs > 0 ? gpuMs : null } );
		if ( [ 'warming-up', 'paused', 'hidden' ].includes( this.reason ) ) this.reason = 'collecting';
		if ( now - this.windowAt < this.options.windowMs || this.samples.length < this.options.minSamples ) return this.status();

		const budget = 1000 / this.status().targetFps;
		this.frameMs = percentile( this.samples.map( ( s ) => s.frameMs ), 0.75 );
		const gpu = this.samples.map( ( s ) => s.gpuMs ).filter( ( v ) => v !== null );
		this.gpuMs = gpu.length ? percentile( gpu, 0.75 ) : null;
		const slow = this.frameMs > budget * 1.18 || ( this.gpuMs !== null && this.gpuMs > budget * 1.18 );
		// Vsync commonly caps frame intervals at the target, so headroom cannot be
		// inferred from intervals below the budget alone. GPU timing adds a margin;
		// without it, recovery is a conservative trial after sustained stable frames.
		const fast = this.frameMs <= budget * 1.04 && ( this.gpuMs === null || this.gpuMs < budget * 0.75 );
		this.bad = slow ? this.bad + 1 : 0;
		this.good = fast ? this.good + 1 : 0;
		this.reason = slow && this.scale <= 0.5 ? 'floor' : 'stable';
		const elapsed = now - this.lastChange;
		if ( this.bad >= this.options.badWindows && elapsed >= this.options.downCooldownMs && this.scale > 0.5 ) {

			this.scale = Math.max( 0.5, Math.round( ( this.scale - 0.1 ) * 100 ) / 100 );
			this.reason = 'lowered';
			this.lastChange = now;
			this.bad = this.good = 0;

		} else if ( this.good >= this.options.goodWindows && elapsed >= this.options.upCooldownMs && this.scale < this.ceiling ) {

			this.scale = Math.min( this.ceiling, Math.round( ( this.scale + 0.1 ) * 100 ) / 100 );
			this.reason = 'raised';
			this.lastChange = now;
			this.bad = this.good = 0;

		}
		this.samples = [];
		this.windowAt = null;
		return this.status();

	}

}

export function qualityStatusText( status ) {

	const resolution = `${Math.round( status.scale * 100 )}% resolution`;
	if ( status.quality === 'manual' ) return `Manual · ${resolution}`;
	const detail = {
		'warming-up': 'Warming up', paused: 'Paused', hidden: 'Tab hidden', collecting: 'Measuring',
		stable: 'Stable', lowered: 'Resolution reduced', raised: 'Resolution restored', floor: 'At the 50% minimum; target not reached'
	}[ status.reason ] || 'Measuring';
	const fps = status.frameMs > 0 ? ` · ${Math.round( 1000 / status.frameMs )} fps measured` : '';
	return `Adaptive ${status.targetFps} fps · ${resolution} · ${detail}${fps}`;

}
