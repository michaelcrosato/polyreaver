import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { bootMetadata, bootPlugin } from './scripts/boot-plugin.mjs';

export default defineConfig( ( { mode } ) => {

	const metadata = bootMetadata();
	return {
		base: './',
		plugins: [ mode === 'lan' ? basicSsl() : null, bootPlugin( metadata ) ].filter( Boolean ),
		define: { __BOOT_VERSION__: JSON.stringify( metadata.version ), __BOOT_BUILD__: JSON.stringify( metadata.build ), __ENGINE_PATHS__: '{}' },
		server: { host: mode === 'lan' ? true : 'localhost' },
		optimizeDeps: { exclude: [ '@dimforge/rapier3d-compat' ] }
	};

} );
