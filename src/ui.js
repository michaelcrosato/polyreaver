// DOM UI: settings panel (built from the feature catalog), HUD, touch controls.

import { SECTIONS, PRESETS, COUNT_STEPS, formatCount } from './features.js';

const COST_LABEL = [ 'free', 'cheap', 'moderate', 'heavy', 'very heavy' ];

const h = ( tag, attrs = {}, ...children ) => {

	const el = document.createElement( tag );
	for ( const [ k, v ] of Object.entries( attrs ) ) {

		if ( k === 'class' ) el.className = v;
		else if ( k === 'text' ) el.textContent = v;
		else if ( k === 'html' ) el.innerHTML = v;
		else if ( k.startsWith( 'on' ) ) el.addEventListener( k.slice( 2 ), v );
		else el.setAttribute( k, v );

	}

	for ( const c of children ) if ( c != null ) el.append( c );
	return el;

};

export class UI {

	constructor( S, { onChange, onPreset, onAction } ) {

		this.S = S;
		this.onChange = onChange;
		this.onPreset = onPreset;
		this.onAction = onAction;
		this.controls = new Map();
		this.maxCount = COUNT_STEPS[ COUNT_STEPS.length - 1 ];

		this.panel = document.getElementById( 'panel' );
		this.body = document.getElementById( 'panel-body' );
		this.hud = document.getElementById( 'hud' );
		this.warnEl = document.getElementById( 'warnings' );

		document.getElementById( 'panel-toggle' ).addEventListener( 'click', () => this.togglePanel() );
		document.getElementById( 'hud' ).addEventListener( 'click', () => this.hud.classList.toggle( 'expanded' ) );

		this._buildPresets();
		this._buildCamera();
		for ( const section of SECTIONS ) this._buildSection( section );
		this._buildBench();

		if ( window.matchMedia( '(min-width: 900px)' ).matches ) this.panel.classList.add( 'open' );

	}

	togglePanel( force ) {

		this.panel.classList.toggle( 'open', force );

	}

	_buildPresets() {

		const row = h( 'div', { class: 'presets' } );
		for ( const [ id, p ] of Object.entries( PRESETS ) ) {

			row.append( h( 'button', { class: 'chip', text: p.label, onclick: () => this.onPreset( id ) } ) );

		}

		this.body.append( h( 'div', { class: 'section open' },
			h( 'div', { class: 'section-title static', text: 'Presets' } ),
			h( 'p', { class: 'hint', text: 'Everything starts OFF. Turn features on one at a time and watch the frame time. Tap ⓘ for what each one costs and why.' } ),
			row ) );

	}

	_buildCamera() {

		const sel = h( 'select', { onchange: ( e ) => this.onChange( 'camera', e.target.value ) } );
		for ( const [ id, label ] of [ [ 'iso', 'Isometric (follow hero)' ], [ 'top', 'Top-down (orthographic)' ], [ 'orbit', 'Perspective orbit' ], [ 'chase', 'Third-person chase' ], [ 'eye', 'Eye level (inside the crowd)' ] ] ) {

			sel.append( h( 'option', { value: id, text: label } ) );

		}

		sel.value = this.S.camera;
		this.controls.set( 'camera', { el: sel, set: ( v ) => ( sel.value = v ) } );
		const btn = ( text, action, title ) => h( 'button', { class: 'chip', text, title, onclick: () => this.onAction( action ) } );
		const body = h( 'div', { class: 'section-body' },
			h( 'div', { class: 'row' }, h( 'label', { text: 'Camera' } ), sel ),
			h( 'div', { class: 'presets' }, btn( '⟲ Rotate', 'rotL', 'Q' ), btn( '⟳ Rotate', 'rotR', 'E' ), btn( '◎ Recenter', 'recenter', 'C' ), btn( '− Zoom', 'zoomOut' ), btn( '+ Zoom', 'zoomIn' ) ),
			h( 'p', { class: 'hint', html: 'Move: <b>WASD</b>/arrows or joystick · Run: <b>Shift</b> · Wave <b>R</b> · Cheer <b>Space</b> · Dance <b>F</b><br>Drag: pan (iso/top) or orbit · Right-drag / 2-finger twist: rotate · Wheel / pinch: zoom · <b>H</b>: hide UI' } ) );
		this.body.append( this._sectionShell( 'Camera & controls', body, true ) );

	}

	_sectionShell( title, body, open = false ) {

		const sec = h( 'div', { class: 'section' + ( open ? ' open' : '' ) } );
		const head = h( 'button', { class: 'section-title', text: title, onclick: () => sec.classList.toggle( 'open' ) } );
		sec.append( head, body );
		return sec;

	}

	_buildSection( section ) {

		const body = h( 'div', { class: 'section-body' } );
		for ( const item of section.items ) body.append( this._buildItem( item ) );
		this.body.append( this._sectionShell( section.title, body, section.id === 'crowd' ) );

	}

	_buildItem( item ) {

		const S = this.S;
		let control, set;
		const valueLabel = h( 'span', { class: 'value' } );

		if ( item.type === 'toggle' ) {

			control = h( 'input', { type: 'checkbox', onchange: ( e ) => this.onChange( item.key, e.target.checked ) } );
			set = ( v ) => ( control.checked = !! v );

		} else if ( item.type === 'select' ) {

			control = h( 'select', { onchange: ( e ) => {

				const opt = item.options.find( ( o ) => String( o[ 0 ] ) === e.target.value );
				this.onChange( item.key, opt ? opt[ 0 ] : e.target.value );

			} } );
			for ( const [ v, label ] of item.options ) control.append( h( 'option', { value: String( v ), text: label } ) );
			set = ( v ) => ( control.value = String( v ) );

		} else if ( item.type === 'range' ) {

			control = h( 'input', { type: 'range', min: item.min, max: item.max, step: item.step, oninput: ( e ) => {

				const v = parseFloat( e.target.value );
				valueLabel.textContent = v.toFixed( 2 );
				this.onChange( item.key, v );

			} } );
			set = ( v ) => {

				control.value = v;
				valueLabel.textContent = Number( v ).toFixed( 2 );

			};

		} else if ( item.type === 'count' ) {

			control = h( 'input', { type: 'range', min: 0, max: COUNT_STEPS.length - 1, step: 1, oninput: ( e ) => {

				const v = COUNT_STEPS[ parseInt( e.target.value ) ];
				valueLabel.textContent = formatCount( v );
				this.onChange( item.key, v );

			} } );
			set = ( v ) => {

				let idx = COUNT_STEPS.findIndex( ( s ) => s >= v );
				if ( idx < 0 ) idx = COUNT_STEPS.length - 1;
				control.value = idx;
				valueLabel.textContent = formatCount( v );

			};

		}

		const dots = h( 'span', { class: 'cost cost' + item.cost, title: `Cost: ${COST_LABEL[ item.cost ]} · ${item.bound}` },
			'●'.repeat( Math.max( 1, item.cost ) ) + '○'.repeat( 4 - Math.max( 1, item.cost ) ) );
		const info = h( 'div', { class: 'info' },
			h( 'div', { html: `<b>${COST_LABEL[ item.cost ]}</b> · bound by <i>${item.bound}</i>` } ),
			h( 'div', { text: item.info } ),
			item.mobile ? h( 'div', { class: 'mobile', text: '📱 ' + item.mobile } ) : null );
		const row = h( 'div', { class: 'row item', 'data-key': item.key },
			h( 'label', { text: item.label } ),
			h( 'div', { class: 'ctrl' }, control, valueLabel ),
			dots,
			h( 'button', { class: 'info-btn', text: 'ⓘ', title: 'What does this cost?', onclick: () => row.classList.toggle( 'show-info' ) } ),
			info );

		set( S[ item.key ] );
		this.controls.set( item.key, { el: control, set } );
		return row;

	}

	_buildBench() {

		const target = h( 'select', {}, h( 'option', { value: '60', text: '60 fps' } ), h( 'option', { value: '30', text: '30 fps' } ), h( 'option', { value: '120', text: '120 fps' } ) );
		this.benchTarget = target;
		this.benchOut = h( 'div', { class: 'bench-out' } );
		const btn = ( text, action ) => h( 'button', { class: 'chip', text, onclick: () => this.onAction( action ) } );
		const body = h( 'div', { class: 'section-body' },
			h( 'p', { class: 'hint', text: 'Run these on each device you care about, then copy the report. "Max crowd" ramps the agent count with the current settings until the frame rate drops below the target. "Effect costs" toggles each feature on top of your current settings and measures the extra milliseconds.' } ),
			h( 'div', { class: 'row' }, h( 'label', { text: 'Target' } ), target ),
			h( 'div', { class: 'presets' }, btn( '▶ Find max crowd', 'benchCrowd' ), btn( '▶ Measure effect costs', 'benchFx' ), btn( '■ Stop', 'benchStop' ) ),
			h( 'div', { class: 'presets' }, btn( '📋 Copy report', 'report' ), btn( '🔗 Copy settings link', 'share' ), btn( '💥 Physics explosion', 'explode' ) ),
			this.benchOut );
		this.body.append( this._sectionShell( 'Benchmark & report', body, true ) );

	}

	sync() {

		for ( const [ key, c ] of this.controls ) if ( key in this.S ) c.set( this.S[ key ] );

	}

	setWarnings( list ) {

		this.warnEl.textContent = list.join( ' · ' );
		this.warnEl.style.display = list.length ? 'block' : 'none';

	}

	setBenchOutput( html ) {

		this.benchOut.innerHTML = html;

	}

	setHud( html ) {

		this.hudBody = this.hudBody || document.getElementById( 'hud-body' );
		this.hudBody.innerHTML = html;

	}

}

// Tiny frame-time graph.
export class Graph {

	constructor( canvas ) {

		this.canvas = canvas;
		this.ctx = canvas.getContext( '2d' );
		this.samples = new Float32Array( 120 );
		this.gpu = new Float32Array( 120 );
		this.i = 0;

	}

	push( ms, gpuMs ) {

		this.samples[ this.i ] = ms;
		this.gpu[ this.i ] = gpuMs;
		this.i = ( this.i + 1 ) % this.samples.length;

	}

	draw() {

		const { ctx, canvas } = this;
		const w = canvas.width, hh = canvas.height;
		ctx.clearRect( 0, 0, w, hh );
		const maxMs = 50;
		const n = this.samples.length;
		const y = ( ms ) => hh - Math.min( ms / maxMs, 1 ) * hh;
		ctx.strokeStyle = 'rgba(255,255,255,0.18)';
		ctx.beginPath();
		for ( const t of [ 1000 / 60, 1000 / 30 ] ) {

			ctx.moveTo( 0, y( t ) );
			ctx.lineTo( w, y( t ) );

		}

		ctx.stroke();
		const line = ( arr, color ) => {

			ctx.strokeStyle = color;
			ctx.beginPath();
			for ( let k = 0; k < n; k ++ ) {

				const v = arr[ ( this.i + k ) % n ];
				const x = ( k / ( n - 1 ) ) * w;
				if ( k === 0 ) ctx.moveTo( x, y( v ) ); else ctx.lineTo( x, y( v ) );

			}

			ctx.stroke();

		};

		line( this.gpu, '#ffb454' );
		line( this.samples, '#7ee787' );

	}

}
