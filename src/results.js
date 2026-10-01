// "Results from all devices". When the page runs as a claude.ai artifact, every
// benchmark run on any device that opened it is kept in the artifact database
// (runs/, written by the Claude link). This turns those documents into a side-by-
// side comparison: standard-benchmark scores first (the only numbers measured
// under identical conditions), then the latest other runs.
//
// The documents were written by whoever ran the page, so everything taken from
// them is escaped before it becomes HTML.

import { formatCount } from './features.js';

const esc = ( v ) => String( v ?? '' ).replace( /[&<>"']/g, ( c ) => ( { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' } )[ c ] );
const num = ( v ) => typeof v === 'number' && isFinite( v ) ? v : null;
const count = ( v ) => num( v ) === null ? '–' : formatCount( v );
const when = ( iso ) => {

	const d = new Date( iso );
	return isNaN( d ) ? '' : d.toLocaleDateString( undefined, { month: 'short', day: 'numeric' } ) + ' ' + d.toLocaleTimeString( undefined, { hour: '2-digit', minute: '2-digit' } );

};

// `devices` (id -> devices/<id> document) names runs saved before runs carried
// the GPU name themselves.
function deviceLabel( run, thisDevice, devices ) {

	const dev = devices[ run.device ] || {};
	const name = run.gpu || dev.gpu || 'device ' + String( run.device || '?' ).slice( 0, 6 );
	const kind = run.deviceKind || dev.kind ? ` (${run.deviceKind || dev.kind})` : '';
	return esc( name + kind ) + ( run.device === thisDevice ? ' <span class="dim">· this one</span>' : '' ) +
		`<br><span class="dim">${esc( when( run.at ) )}</span>`;

}

function summary( run ) {

	const d = run.data || {};
	if ( run.kind === 'maxCrowd' ) return `Max crowd @ ${esc( d.targetFps )} fps: <b>${count( d.maxAgents )}</b> <span class="dim">${esc( d.model )}, ${esc( d.path )}${d.hitCapacity ? ', buffer limit' : ''}</span>`;
	if ( run.kind === 'effects' ) {

		const rows = Array.isArray( d.rows ) ? d.rows : [];
		const cost = ( r ) => Math.max( num( r.gpuDelta ) ?? num( r.frameDelta ) ?? 0, num( r.cpuDelta ) ?? 0 );
		const top = [ ...rows ].sort( ( a, b ) => cost( b ) - cost( a ) ).slice( 0, 3 );
		return 'Effect costs: ' + top.map( ( r ) => `${esc( r.label )} <b>+${cost( r ).toFixed( 1 )}</b>` ).join( ', ' ) + ' ms';

	}

	return esc( run.kind );

}

export function renderRuns( runs, thisDevice, devices = {} ) {

	if ( ! runs.length ) return '<p class="hint">No runs saved yet. Benchmarks you run here (on any device that opens this page) will appear in this list.</p>';

	const standard = runs.filter( ( r ) => r.kind === 'standard' && r.data );
	let html = '';
	if ( standard.length ) {

		html += '<b>Standard benchmark</b> <span class="dim">(1920×1080, same conditions everywhere; agents at 60 fps)</span>' +
			'<table><tr><th>Device</th><th>Score</th><th>Tetra direct</th><th>Box-man direct</th><th>Box-man GPU + LOD</th><th>Console look</th></tr>' +
			standard.map( ( r ) => {

				const d = r.data, l = d.looks || {};
				const cap = ( t ) => t?.hitCapacity ? '+' : '';
				return `<tr><td>${deviceLabel( r, thisDevice, devices )}</td><td><b>${esc( d.score )}</b></td><td>${count( d.direct?.agents )}${cap( d.direct )}</td>` +
					`<td>${d.boxDirect ? count( d.boxDirect.agents ) + cap( d.boxDirect ) : '<span class="dim">v1</span>'}</td><td>${count( d.gpuDriven?.agents )}${cap( d.gpuDriven )}</td>` +
					`<td>${esc( l.fps )} fps${num( l.gpuMs ) !== null ? ` · ${esc( l.gpuMs )} ms GPU` : ''}</td></tr>`;

			} ).join( '' ) + '</table>';

	}

	const other = runs.filter( ( r ) => r.kind !== 'standard' ).slice( 0, 8 );
	if ( other.length ) {

		html += '<b>Other runs</b> <span class="dim">(your settings at the time, so not directly comparable)</span>' +
			'<table>' + other.map( ( r ) => `<tr><td>${deviceLabel( r, thisDevice, devices )}</td><td>${summary( r )}</td></tr>` ).join( '' ) + '</table>';

	}

	return html;

}
