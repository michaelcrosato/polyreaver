import js from '@eslint/js';
import globals from 'globals';

export default [
	{ ignores: [ 'dist/', 'dist-game/', 'dist-city/', '.vercel/', 'node_modules/', '.claude/', 'webgpu-crowd-stress.html', 'polyreaver.html', 'city-demo.html', 'classic-crowd.html' ] },
	js.configs.recommended,
	{
		languageOptions: {
			ecmaVersion: 'latest',
			sourceType: 'module',
			globals: { ...globals.browser, GPUBufferUsage: 'readonly', GPUShaderStage: 'readonly', GPUTexture: 'readonly', __BOOT_VERSION__: 'readonly', __BOOT_BUILD__: 'readonly', __ENGINE_PATHS__: 'readonly' }
		},
		rules: {
			'no-unused-vars': [ 'warn', { args: 'none', caughtErrors: 'none' } ],
			'no-empty': [ 'error', { allowEmptyCatch: true } ]
		}
	},
	{
		files: [ 'scripts/**', 'vite*.config.js', 'eslint.config.js' ],
		languageOptions: { globals: { ...globals.node } }
	}
];
