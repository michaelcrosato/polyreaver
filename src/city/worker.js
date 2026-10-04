import { generateCity } from './generate.js';

self.onmessage = ( { data: { id, config } } ) => {

	try {

		const city = generateCity( config, ( step, progress ) => self.postMessage( { id, step, progress } ) );
		const buffers = new Set();
		const visit = ( value ) => {

			if ( ArrayBuffer.isView( value ) ) buffers.add( value.buffer );
			else if ( value && typeof value === 'object' ) for ( const v of Object.values( value ) ) visit( v );

		};
		visit( city );
		self.postMessage( { id, city }, [ ...buffers ] );

	} catch ( error ) {

		self.postMessage( { id, error: error.message } );

	}

};
