// Prints the README feature table from src/features.js (keeps docs and UI in sync).
// Usage: node scripts/feature-table.mjs
import { SECTIONS } from '../src/features.js';

const COST = [ 'free', 'cheap', 'moderate', 'heavy', 'very heavy' ];
const DOTS = ( c ) => '●'.repeat( Math.max( 1, c ) ) + '○'.repeat( 4 - Math.max( 1, c ) );
const fmtDef = ( it ) => {

	if ( it.type === 'toggle' ) return it.def ? 'on' : 'off';
	if ( it.options ) {

		const o = it.options.find( ( x ) => x[ 0 ] === it.def );
		return o ? o[ 1 ] : String( it.def );

	}

	return String( it.def );

};

for ( const s of SECTIONS ) {

	console.log( `\n### ${s.title}\n` );
	console.log( '| Setting | Default | Cost | Bound by | What it does / why it costs |' );
	console.log( '|---|---|---|---|---|' );
	for ( const it of s.items.filter( ( item ) => item.key ) ) {

		const text = ( it.info + ( it.mobile ? ` **Mobile:** ${it.mobile}` : '' ) ).replace( /\|/g, '\\|' );
		console.log( `| ${it.label} | ${fmtDef( it )} | ${DOTS( it.cost )} ${COST[ it.cost ]} | ${it.bound} | ${text} |` );

	}

}
