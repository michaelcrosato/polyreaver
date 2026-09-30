import js from '@eslint/js';
import globals from 'globals';

export default [
	{ ignores: [ 'dist/', 'node_modules/', 'webgpu-crowd-stress.html' ] },
	js.configs.recommended,
	{
		languageOptions: {
			ecmaVersion: 'latest',
			sourceType: 'module',
			globals: { ...globals.browser, GPUBufferUsage: 'readonly', GPUShaderStage: 'readonly', GPUTexture: 'readonly' }
		},
		rules: {
			'no-unused-vars': [ 'warn', { args: 'none', caughtErrors: 'none' } ],
			'no-empty': [ 'error', { allowEmptyCatch: true } ]
		}
	},
	{
		files: [ 'scripts/**', 'vite.config.js', 'eslint.config.js' ],
		languageOptions: { globals: { ...globals.node } }
	}
];
