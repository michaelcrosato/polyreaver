// One test entry point; legacy smoke commands remain available for CI.
import { spawnSync } from 'node:child_process';
const args = process.argv.slice( 2 ), index = args.indexOf( '--suite' );
const suite = index < 0 ? 'options' : args.splice( index, 2 )[ 1 ];
const suites = { options: [ 'scripts/city-options-smoke.mjs' ], boot: [ 'scripts/boot-smoke.mjs' ], plaza: [ 'scripts/smoke.mjs' ], validate: [ '--test', 'scripts/city-validate.mjs' ], zoom: [ 'scripts/zoom-smoke.mjs' ] };
if ( ! suites[ suite ] ) throw new Error( `Unknown test suite: ${suite}` );
const result = spawnSync( process.execPath, [ ...suites[ suite ], ...args ], { stdio: 'inherit' } );
if ( result.error ) throw result.error;
process.exit( result.status ?? 1 );
