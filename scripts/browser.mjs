// Prefer Playwright's matching browser. Workstations can reuse installed Chrome
// or select an executable explicitly instead of downloading another browser.
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

export function launchBrowser( options = {} ) {

	const executable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
	if ( executable ) return chromium.launch( { ...options, executablePath: executable } );
	if ( ! existsSync( chromium.executablePath() ) && existsSync( '/usr/bin/google-chrome' ) ) return chromium.launch( { ...options, channel: 'chrome' } );
	return chromium.launch( options );

}
