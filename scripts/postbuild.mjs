// Copies the single-file build to the repo root so it can be grabbed directly
// (e.g. from GitHub) and opened on any device - no server, no other files.
import fs from 'node:fs';

const src = 'dist/index.html';
const dst = 'webgpu-crowd-stress.html';
fs.copyFileSync( src, dst );
const mb = ( fs.statSync( dst ).size / 1048576 ).toFixed( 2 );
const html = fs.readFileSync( dst, 'utf8' );
const external = [ ...html.matchAll( /(?:src|href)="(?!data:|#)([^"]+)"/g ) ].map( ( m ) => m[ 1 ] );
console.log( `\n✔ ${dst} (${mb} MB, self-contained)` );
if ( external.length ) console.warn( '⚠ external references found:', external );
