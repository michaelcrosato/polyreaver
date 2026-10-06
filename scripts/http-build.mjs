// Local HTTP fixture server shared by integration suites. Production bundles and
// headless source modules come from the same repository origin for multi-tab tests.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';

export async function serveBuild() {

	const root = resolve( '.' );
	const server = createServer( async ( req, res ) => {

		try {

			const path = resolve( root, '.' + decodeURIComponent( new URL( req.url, 'http://localhost' ).pathname ) );
			if ( ! path.startsWith( root + sep ) ) throw new Error( 'Invalid path' );
			const body = await readFile( path );
			res.setHeader( 'Content-Type', ( { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' } )[ extname( path ) ] || 'application/octet-stream' );
			res.end( body );

		} catch { res.writeHead( 404 ); res.end(); }

	} );
	await new Promise( ( done ) => server.listen( 0, '127.0.0.1', done ) );
	return { origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise( ( done ) => server.close( done ) ) };

}
