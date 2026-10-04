// Switching reloads the current document: this releases every renderer, worker,
// event listener and module singleton, including in a downloaded standalone file.
export function installSwitcher( boot ) {

	const nav = document.getElementById( 'engine-nav' );
	const select = document.getElementById( 'engine-select' );
	const remember = () => {

		const engine = boot.state.mode === 'stress' ? window.city : boot.state.mode === 'classic' ? window.app : null;
		const hash = engine?.shareLink ? new URL( engine.shareLink() ).hash : location.hash;
		try { sessionStorage.setItem( 'polyreaver.mode.' + boot.state.mode, hash ); } catch { /* optional */ }

	};
	const navigate = ( mode ) => {

		remember();
		const url = new URL( location.href );
		url.searchParams.set( 'engine', mode );
		try { url.hash = sessionStorage.getItem( 'polyreaver.mode.' + mode ) || ''; } catch { url.hash = ''; }
		location.assign( url.href );

	};
	select.value = boot.state.mode;
	select.onchange = () => navigate( select.value );
	document.getElementById( 'engine-home' ).onclick = () => navigate( 'choose' );
	nav.hidden = false;
	document.body.dataset.runningMode = boot.state.mode;
	// Internal links use the same switch path, so one downloaded file is sufficient.
	for ( const link of document.querySelectorAll( '[data-engine]' ) ) link.onclick = ( event ) => { event.preventDefault(); navigate( link.dataset.engine ); };

}
