// Character persistence: one writer per origin, guarded revisions, recoverable
// imports and previous-save snapshots. Storage denial never prevents gameplay.
// Browser integration supplies lifecycle events; this module also runs in Node.
import { ensureSave, validateSave } from './save.js';

export const SAVE_KEY = 'polyreaver.save.v1';
export const BACKUP_KEY = SAVE_KEY + '.previous';
export const SNAPSHOT_KEY = SAVE_KEY + '.autosave';
export const RECOVERY_KEY = SAVE_KEY + '.recovery';
const LOCK_KEY = 'polyreaver-character-writer';
export const MAX_SAVE_BYTES = 4 * 1024 * 1024;

const record = ( value ) => value && typeof value === 'object' && ! Array.isArray( value );
const clone = ( value ) => JSON.parse( JSON.stringify( value ) );

export function parseCharacter( raw, { strict = false } = {} ) {

	if ( typeof raw !== 'string' || raw.length > MAX_SAVE_BYTES ) throw new Error( 'Character files must be JSON smaller than 4 MB.' );
	const data = JSON.parse( raw );
	if ( ! record( data ) ) throw new Error( 'This file does not contain a character.' );
	if ( data.format && ( ! [ 'polyreaver-save', 'polyreaver-character' ].includes( data.format ) || data.formatVersion !== 1 ) ) throw new Error( 'Unsupported character file format.' );
	const save = data.format ? data.save : data;
	if ( ! record( save ) || save.version !== 1 ) throw new Error( 'Unsupported character save version.' );
	if ( strict ) validateSave( save );
	const before = JSON.stringify( save );
	ensureSave( save );
	return { save, repaired: before !== JSON.stringify( save ), revision: data.format === 'polyreaver-save' && Number.isSafeInteger( data.revision ) ? data.revision : 0 };

}

export function exportCharacter( save ) {

	const copy = clone( save );
	validateSave( copy );
	ensureSave( copy );
	return JSON.stringify( { format: 'polyreaver-character', formatVersion: 1, exportedAt: Date.now(), save: copy }, null, 2 );

}

function browserStorage() {

	try { return globalThis.localStorage || null; } catch { return null; }

}

export class SaveManager {

	constructor( { storage = browserStorage(), locks = globalThis.navigator?.locks, now = Date.now, id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`, events = globalThis.window } = {} ) {

		this.storage = storage; this.locks = locks; this.now = now; this.id = id;
		this.expected = null; this.revision = 0; this.writer = false; this.mode = 'active';
		this.writeEpoch = 0; this.lockEpoch = 0; this.transitions = 0;
		this.transitionQueue = Promise.resolve();
		this.listeners = new Set(); this.recoveryRaw = null; this.recoveryReason = '';
		this.recoveryPending = false;
		this.status = { code: 'loading', message: 'Checking character storage', savedAt: null };
		this.onStorage = ( event ) => {

			if ( event.key !== SAVE_KEY && event.key !== null ) return;
			try {

				// Storage events may wait in the browser queue while a tab is frozen.
				// latest() can already have adopted a newer revision by delivery time;
				// compare the actual current record rather than an obsolete event value.
				if ( this.read( SAVE_KEY ) !== this.expected ) this.conflict();

			} catch {

				this.release();
				this.setStatus( 'unavailable', 'Character storage became unavailable. Export this session before closing.' );

			}

		};
		this.events = events;
		events?.addEventListener( 'storage', this.onStorage );

	}

	setStatus( code, message ) {

		this.status = { ...this.status, code, message, writable: this.writer && this.mode === 'active' };
		for ( const fn of this.listeners ) fn( this.status );

	}

	onStatus( fn ) {

		this.listeners.add( fn );
		return () => this.listeners.delete( fn );

	}

	read( key ) {

		if ( ! this.storage ) throw new Error( 'Browser storage is unavailable.' );
		return this.storage.getItem( key );

	}

	// Explicit character changes suspend autosaves immediately, including while
	// waiting for a lock. Queue them so one operation's rollback cannot undo the
	// next operation's revision, and invalidate saves already awaiting ownership.
	transition( run ) {

		this.writeEpoch ++; this.transitions ++;
		const result = this.transitionQueue.then( run );
		this.transitionQueue = result.catch( () => {} );
		return result.finally( () => { this.transitions --; } );

	}

	load( options = {} ) {

		return this.transition( () => this.loadCharacter( options ) );

	}

	async loadCharacter( { fresh = false } = {} ) {

		let parsed = null;
		try {

			this.expected = this.read( SAVE_KEY );
			if ( this.expected ) {

				try {

					parsed = parseCharacter( this.expected );
					this.revision = parsed.revision;
					if ( parsed.repaired ) { this.recoveryRaw = this.expected; this.recoveryReason = 'An older or damaged character was repaired.'; this.recoveryPending = true; }

				} catch ( error ) {

					this.recoveryRaw = this.expected; this.recoveryReason = error.message;
					this.recoveryPending = true;
					this.mode = 'recovery';
					this.setStatus( 'recovery', 'Stored character needs recovery. Its original data is protected; open Character saves.' );

				}

			}

		} catch {

			this.storage = null;
			this.setStatus( 'unavailable', 'Saving is unavailable. Export your character before closing this page.' );

		}
		if ( fresh ) {

			this.mode = 'session';
			this.setStatus( 'session', 'Fresh session: your stored character is protected. Export or explicitly save this character.' );
			return null;

		}
		if ( this.storage && this.mode === 'active' ) {

			await this.claim();
			if ( this.writer ) this.setStatus( parsed?.repaired ? 'repaired' : 'ready', parsed?.repaired ? 'Character repaired; original data is available under Recovery.' : 'Character saving is ready.' );

		}
		return parsed?.save || null;

	}

	async claim() {

		if ( this.writer ) return true;
		if ( ! this.storage || this.disposed ) return false;
		if ( this.claiming ) return this.claiming;
		if ( ! this.locks?.request || this.lockDenied ) {

			this.setStatus( 'unavailable', 'This browser cannot exclusively lock character storage. The stored character is protected; use session play and export.' );
			return false;

		}
		if ( this.locks?.request ) {

			const epoch = this.lockEpoch;
			const claiming = new Promise( ( resolve ) => {

				let answered = false;
				const answer = ( value ) => { if ( ! answered ) { answered = true; resolve( value ); } };
				this.lockRequest = Promise.resolve().then( () => this.locks.request( LOCK_KEY, { ifAvailable: true, mode: 'exclusive' }, async ( lock ) => {

					if ( this.disposed || epoch !== this.lockEpoch ) { answer( false ); return; }
					if ( ! lock ) { this.setStatus( 'readonly', 'Another tab controls saving. Close it, then retry saving here, or export this session.' ); answer( false ); return; }
					this.writer = true;
					await new Promise( ( release ) => { this.releaseLock = release; answer( true ); } );

				} ) ).catch( ( error ) => {

					this.lockDenied = true;
					this.setStatus( 'error', `Saving permission is unavailable: ${error.message}. Export your character.` );
					answer( false );

				} );

			} );
			this.claiming = claiming;
			try { return await claiming; }
			finally { if ( this.claiming === claiming ) this.claiming = null; }

		}
		return false;

	}

	release() {

		this.lockEpoch ++;
		this.writer = false;
		this.releaseLock?.(); this.releaseLock = null;

	}

	conflict() {

		this.mode = 'conflict'; this.release();
		this.setStatus( 'conflict', 'A newer character exists in storage. Export this session or load the latest character; automatic saving has stopped.' );

	}

	async save( save ) {

		if ( this.mode !== 'active' || this.transitions ) return false;
		const epoch = this.writeEpoch, expected = this.expected;
		if ( ! this.storage ) { this.setStatus( 'unavailable', 'Saving is unavailable. Export your character before closing this page.' ); return false; }
		if ( ! await this.claim() ) return false;
		if ( epoch !== this.writeEpoch || expected !== this.expected || this.transitions || this.mode !== 'active' ) return false;
		return this.write( save );

	}

	write( save, { replacement = false } = {} ) {

		if ( this.mode !== 'active' || this.transitions && ! replacement ) return false;
		try {

			if ( ! this.writer || ! this.locks?.request || this.read( SAVE_KEY ) !== this.expected ) { this.conflict(); return false; }
			const copy = clone( save );
			validateSave( copy ); ensureSave( copy );
			let previous = null;
			try { if ( this.expected ) previous = parseCharacter( this.expected ).save; } catch { /* Damaged originals are retained in Recovery. */ }
			if ( previous ) {

				const a = clone( previous ), b = clone( copy );
				delete a.savedAt; delete b.savedAt;
				if ( ! this.recoveryPending && JSON.stringify( a ) === JSON.stringify( b ) ) {

					this.status.savedAt = previous.savedAt || null;
					this.setStatus( 'saved', 'Character is already saved.' );
					return true;

				}

			}
			const savedAt = this.now();
			copy.savedAt = savedAt;
			const next = JSON.stringify( { format: 'polyreaver-save', formatVersion: 1, revision: this.revision + 1, owner: this.id, savedAt, save: copy } );
			if ( next.length > MAX_SAVE_BYTES ) throw new Error( 'Character exceeds the 4 MB storage limit.' );
			if ( this.recoveryPending && this.recoveryRaw ) this.storage.setItem( RECOVERY_KEY, JSON.stringify( { at: savedAt, reason: this.recoveryReason, raw: this.recoveryRaw } ) );
			if ( previous ) {

				this.storage.setItem( SNAPSHOT_KEY, this.expected );
				// Explicit replacement has its own undo snapshot. World transitions and
				// autosaving the imported character must not immediately erase it.
				if ( replacement ) this.storage.setItem( BACKUP_KEY, this.expected );

			}
			if ( ! this.writer || this.read( SAVE_KEY ) !== this.expected ) { this.conflict(); return false; }
			this.storage.setItem( SAVE_KEY, next );
			this.expected = next; this.revision ++;
			this.recoveryPending = false;
			save.savedAt = savedAt;
			this.status.savedAt = savedAt;
			this.setStatus( 'saved', 'Character saved.' );
			return true;

		} catch ( error ) {

			this.setStatus( 'error', `Saving failed: ${error.message}. Your previous stored character is intact; export this session.` );
			return false;

		}

	}

	latest() {

		return this.transition( () => this.loadLatest() );

	}

	async loadLatest() {

		try {

			const raw = this.read( SAVE_KEY );
			if ( ! raw ) throw new Error( 'No stored character exists.' );
			const parsed = parseCharacter( raw );
			this.expected = raw; this.revision = parsed.revision; this.mode = 'active';
			if ( parsed.repaired ) { this.recoveryRaw = raw; this.recoveryReason = 'Stored character repaired during recovery.'; this.recoveryPending = true; }
			await this.claim();
			if ( this.writer ) this.setStatus( 'ready', 'Latest character loaded; saving is ready.' );
			else if ( ! this.locks?.request || this.lockDenied ) this.setStatus( 'unavailable', 'Latest character loaded. Shared saving is unavailable; export your session before closing.' );
			else this.setStatus( 'readonly', 'Latest character loaded. Another tab controls saving.' );
			return parsed.save;

		} catch ( error ) { this.setStatus( 'error', error.message ); return null; }

	}

	// Only explicit import/restore/use-session actions may replace a revision this
	// session did not load. The currently stored character becomes the backup.
	replace( save ) {

		return this.transition( () => this.replaceCharacter( save ) );

	}

	async replaceCharacter( save ) {

		validateSave( save );
		const sessionOnly = () => { this.mode = 'session'; this.setStatus( 'unavailable', 'Character loaded for this session. Shared saving is unavailable; the stored character is protected. Keep an exported copy.' ); return true; };
		if ( ! this.storage || ! this.locks?.request || this.lockDenied ) return sessionOnly();
		const before = { expected: this.expected, revision: this.revision, mode: this.mode, recoveryRaw: this.recoveryRaw, recoveryReason: this.recoveryReason, recoveryPending: this.recoveryPending };
		const rollback = () => { this.release(); Object.assign( this, before ); this.setStatus( 'error', this.status.message ); return false; };
		if ( ! await this.claim() ) return this.lockDenied ? sessionOnly() : false;
		try {

			const raw = this.read( SAVE_KEY );
			if ( raw ) {

				try { this.revision = parseCharacter( raw ).revision; }
				catch ( error ) { this.recoveryRaw = raw; this.recoveryReason = error.message; this.revision = 0; this.recoveryPending = true; }

			}
			this.expected = raw; this.mode = 'active';
			return this.write( save, { replacement: true } ) || rollback();

		} catch ( error ) { this.setStatus( 'error', `Replacement failed: ${error.message}` ); return rollback(); }

	}

	backup() {

		for ( const key of [ BACKUP_KEY, SNAPSHOT_KEY ] ) {

			try { const raw = this.read( key ); if ( raw ) return parseCharacter( raw ).save; } catch { /* Try the last valid autosave snapshot. */ }

		}
		return null;

	}

	recovery() {

		if ( this.recoveryRaw ) return { raw: this.recoveryRaw, reason: this.recoveryReason };
		try { return JSON.parse( this.read( RECOVERY_KEY ) || 'null' ); } catch { return null; }

	}

	dispose() {

		this.disposed = true; this.release();
		this.events?.removeEventListener( 'storage', this.onStorage );
		this.listeners.clear();

	}

}
