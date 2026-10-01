// Tiny event bus. The simulation never touches rendering, audio or UI: it emits
// events ( 'hit', 'death', 'loot', 'levelup', ... - see docs/GAME.md ) and the
// presentation layers listen. In Node the same events feed the balance reports.

export class EventBus {

	constructor() {

		this.map = new Map();

	}

	on( type, fn ) {

		if ( ! this.map.has( type ) ) this.map.set( type, new Set() );
		this.map.get( type ).add( fn );
		return () => this.map.get( type )?.delete( fn );

	}

	once( type, fn ) {

		const off = this.on( type, ( e ) => {

			off();
			fn( e );

		} );
		return off;

	}

	emit( type, data = {} ) {

		data.type = type;
		const set = this.map.get( type );
		if ( set ) for ( const fn of [ ...set ] ) fn( data );
		const any = this.map.get( '*' );
		if ( any ) for ( const fn of [ ...any ] ) fn( data );
		return data;

	}

	clear() {

		this.map.clear();

	}

}
