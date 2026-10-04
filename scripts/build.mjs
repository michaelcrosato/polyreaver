// Build the hosted site with truly deferred engine requests. Standalone downloads
// carry inert base64 payloads, decoded/imported only after boot and mode selection.
import { build } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { bootMetadata, bootPlugin } from './boot-plugin.mjs';

const metadata = bootMetadata();
const paths = {}, sources = {};
rmSync( 'dist', { recursive: true, force: true } );
mkdirSync( 'dist/engines', { recursive: true } );
for ( const [ id, entry ] of Object.entries( { game: 'src/game/main.js', stress: 'src/main.js', city: 'src/city/main.js' } ) ) {

	const result = await build( {
		configFile: false, base: './', worker: { format: 'iife' },
		build: {
			write: false, target: 'es2022', minify: true, reportCompressedSize: false,
			lib: { entry: resolve( entry ), formats: [ 'es' ], fileName: id },
			rollupOptions: { output: { codeSplitting: false } }
		}
	} );
	const output = result[ 0 ].output;
	if ( output.length !== 1 || output[ 0 ].type !== 'chunk' ) throw new Error( `${id} must be a single engine payload` );
	const code = output[ 0 ].code;
	const digest = createHash( 'sha256' ).update( code ).digest( 'hex' ).slice( 0, 12 );
	paths[ id ] = `./engines/${id}-${digest}.js`;
	sources[ id ] = Buffer.from( code ).toString( 'base64' );
	writeFileSync( `dist/engines/${id}-${digest}.js`, code );

}
await build( {
	configFile: false, base: './',
	plugins: [ bootPlugin( metadata ), viteSingleFile( { removeViteModuleLoader: true } ) ],
	define: { __BOOT_VERSION__: JSON.stringify( metadata.version ), __BOOT_BUILD__: JSON.stringify( metadata.build ), __ENGINE_PATHS__: JSON.stringify( paths ) },
	build: { emptyOutDir: false, target: 'es2022', reportCompressedSize: false }
} );
const shell = readFileSync( 'dist/index.html', 'utf8' );
if ( Buffer.byteLength( shell ) > 35000 ) throw new Error( 'Boot shell exceeded its 35 KB budget' );
const cityShell = shell.replace( 'data-boot-mode="choose"', 'data-boot-mode="city"' );
const classicShell = shell.replace( 'data-boot-mode="choose"', 'data-boot-mode="classic"' );
for ( const file of [ 'game.html', 'polyreaver.html', 'webgpu-crowd-stress.html' ] ) writeFileSync( `dist/${file}`, shell );
for ( const file of [ 'city.html', 'city-demo.html' ] ) writeFileSync( `dist/${file}`, cityShell );
for ( const file of [ 'classic.html', 'classic-crowd.html' ] ) writeFileSync( `dist/${file}`, classicShell );
const standalone = ( html, ids ) => html.replace( '</body>', ids.map( ( id ) => `<script type="application/octet-stream" id="boot-engine-${id}">${sources[ id ]}</script>` ).join( '\n' ) + '\n</body>' );
const chooser = standalone( shell, [ 'game', 'city', 'stress' ] );
const city = standalone( cityShell, [ 'game', 'city', 'stress' ] );
const classic = standalone( classicShell, [ 'game', 'city', 'stress' ] );
for ( const [ file, content ] of Object.entries( { 'webgpu-crowd-stress.html': chooser, 'polyreaver.html': chooser, 'city-demo.html': city, 'classic-crowd.html': classic, 'dist-game/game.html': chooser, 'dist-city/city.html': city } ) ) {

	mkdirSync( resolve( file, '..' ), { recursive: true } );
	writeFileSync( file, content );

}
console.log( `Boot ${metadata.version} / ${metadata.build}: ${Buffer.byteLength( shell )} bytes; hosted engines deferred; standalone payloads inert.` );
