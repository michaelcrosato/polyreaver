import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

// A content-derived build ID is stable across checkouts and committed standalone
// rebuilds, unlike a timestamp or a commit that changes when its HTML is committed.
export function bootMetadata() {

	const hash = createHash( 'sha256' );
	const walk = ( dir ) => {

		for ( const entry of readdirSync( dir, { withFileTypes: true } ).sort( ( a, b ) => a.name.localeCompare( b.name, 'en' ) ) ) {

			const path = `${dir}/${entry.name}`;
			if ( entry.isDirectory() ) walk( path );
			else { hash.update( path ); hash.update( readFileSync( path ) ); }

		}

	};
	walk( 'src' ); walk( 'scripts' );
	for ( const path of [ 'package.json', 'package-lock.json', 'vite.config.js', 'index.html', 'game.html', 'city.html', 'classic.html' ] ) hash.update( readFileSync( path ) );
	return { version: JSON.parse( readFileSync( 'package.json' ) ).version, build: hash.digest( 'hex' ).slice( 0, 12 ) };

}

export function bootPlugin( metadata ) {

	return {
		name: 'standard-boot-shell',
		transformIndexHtml( html ) {

			const shell = readFileSync( resolve( 'src/boot/shell.html' ), 'utf8' ).replaceAll( '__BOOT_VERSION__', metadata.version ).replaceAll( '__BOOT_BUILD__', metadata.build );
			const watchdog = readFileSync( resolve( 'src/boot/watchdog.js' ), 'utf8' );
			const icon = '<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 32 32%22%3E%3Crect width=%2232%22 height=%2232%22 rx=%226%22 fill=%22%230b1016%22/%3E%3Ctext x=%2216%22 y=%2224%22 text-anchor=%22middle%22 font-family=%22monospace%22 font-size=%2224%22 fill=%22%23f3d284%22%3EP%3C/text%3E%3C/svg%3E">';
			return html.replace( '</head>', icon + '\n</head>' ).replace( '<!-- boot-shell -->', `${shell}\n<script>${watchdog}</script>` );

		}
	};

}
