import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import basicSsl from '@vitejs/plugin-basic-ssl';

// `npm run build`  -> dist/index.html: ONE self-contained file (three.js, Rapier WASM,
//                    all code and CSS inlined). Copy it anywhere, open it, done.
// `npm run dev`    -> local dev server with hot reload (http://localhost:5173).
// `npm run dev:lan`-> https dev server on your LAN so a phone can test it
//                    (WebGPU requires a secure context: https or localhost).
export default defineConfig( ( { mode } ) => ( {
	base: './',
	plugins: [
		mode === 'lan' ? basicSsl() : null,
		viteSingleFile( { removeViteModuleLoader: true } )
	].filter( Boolean ),
	build: {
		target: 'es2022',
		assetsInlineLimit: 100000000,
		chunkSizeWarningLimit: 100000,
		cssCodeSplit: false,
		reportCompressedSize: false
	},
	server: { host: mode === 'lan' ? true : 'localhost' },
	optimizeDeps: { exclude: [ '@dimforge/rapier3d-compat' ] }
} ) );
