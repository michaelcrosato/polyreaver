// Classic, deliberately ES5: even a browser unable to parse the module gets a report.
( function () {

	var stage = document.getElementById( 'boot-stage' );
	var platform = navigator.userAgent;
	document.getElementById( 'boot-platform' ).textContent = platform;
	function fail( code, message ) {

		if ( window.__boot ) return;
		window.__boot = { protocol: 1, status: 'failed', stage: 'BOOT', platform: platform,
			version: document.getElementById( 'boot-version' ).textContent,
			build: document.getElementById( 'boot-build' ).textContent,
			errors: [ { code: code, stage: 'BOOT', message: message } ] };
		stage.textContent = code + ' / Startup module did not load';
		var error = document.getElementById( 'boot-error' );
		error.hidden = false;
		error.textContent = message + ' Check the connection, reload, or try a current browser. Keep this screen for your bug report.';
		document.getElementById( 'boot-retry' ).hidden = false;

	}
	window.__bootWatchdog = setTimeout( function () {

		fail( 'BOOT-TIME', 'Startup module timed out.' );

	}, 20000 );
	window.addEventListener( 'error', function ( event ) {

		if ( event.message ) fail( 'BOOT-JS', event.message );

	} );
	document.getElementById( 'boot-retry' ).onclick = function () { location.reload(); };
	document.getElementById( 'boot-copy' ).onclick = function () {

		var report = document.getElementById( 'boot-report' );
		report.value = document.getElementById( 'boot' ).innerText;
		report.hidden = false;
		report.focus();
		report.select();

	};

} )();
