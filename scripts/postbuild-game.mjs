// Copies the single-file game build to the repo root (polyreaver.html).
import fs from 'node:fs';

const src = 'dist-game/game.html';
const dst = 'polyreaver.html';
fs.copyFileSync( src, dst );
const mb = ( fs.statSync( dst ).size / 1048576 ).toFixed( 2 );
const html = fs.readFileSync( dst, 'utf8' );
const external = [ ...html.matchAll( /(?:src|href)="(?!data:|#)([^"]+)"/g ) ].map( ( m ) => m[ 1 ] );
console.log( `\n✔ ${dst} (${mb} MB, self-contained)` );
if ( external.length ) console.warn( '⚠ external references found:', external );
