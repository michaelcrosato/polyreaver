import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { resolve } from 'node:path';

// Polyreaver (the showcase game) as ONE self-contained HTML file:
//   npm run build:game -> dist-game/game.html -> copied to polyreaver.html
// During development the normal dev server serves it at /game.html.
export default defineConfig( {
	base: './',
	plugins: [ viteSingleFile( { removeViteModuleLoader: true } ) ],
	build: {
		outDir: 'dist-game',
		emptyOutDir: true,
		target: 'es2022',
		assetsInlineLimit: 100000000,
		chunkSizeWarningLimit: 100000,
		cssCodeSplit: false,
		reportCompressedSize: false,
		rollupOptions: { input: resolve( import.meta.dirname, 'game.html' ) }
	},
	optimizeDeps: { exclude: [ '@dimforge/rapier3d-compat' ] }
} );
