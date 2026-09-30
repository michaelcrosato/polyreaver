// On-screen buttons and keyboard shortcuts, mapped onto app.action() / app.set().

export function bindButtons( app ) {

	for ( const btn of document.querySelectorAll( '[data-action]' ) ) {

		const a = btn.dataset.action;
		if ( a === 'run' ) {

			btn.addEventListener( 'click', () => {

				app.input.run = ! app.input.run;
				btn.classList.toggle( 'on', app.input.run );

			} );

		} else if ( [ 'wave', 'cheer', 'dance' ].includes( a ) ) {

			const on = ( e ) => {

				e.preventDefault();
				app.input.action = a;

			};

			const off = () => ( app.input.action = null );
			btn.addEventListener( 'pointerdown', on );
			btn.addEventListener( 'pointerup', off );
			btn.addEventListener( 'pointerleave', off );
			btn.addEventListener( 'pointercancel', off );

		} else {

			btn.addEventListener( 'click', () => app.action( a ) );

		}

	}

}

export function hotkey( app, e ) {

	const map = { KeyQ: 'rotL', KeyE: 'rotR', KeyC: 'recenter', KeyH: 'hideUI', KeyP: 'panel', Equal: 'zoomIn', Minus: 'zoomOut', KeyX: 'explode' };
	if ( map[ e.code ] ) app.action( map[ e.code ] );
	const modes = [ 'iso', 'top', 'orbit', 'chase', 'eye' ];
	const n = parseInt( e.key );
	if ( n >= 1 && n <= 5 ) app.set( 'camera', modes[ n - 1 ] );

}
