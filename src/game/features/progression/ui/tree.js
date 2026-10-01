// Passive tree panel (T; the Mystic's 'tree' service enables refunds and respec).
// A 2D canvas draws ~1500 nodes and their links; it only redraws when something
// changed (pan, zoom, hover, allocation), so an open tree costs nothing per frame.
//
//   mouse   drag = pan, wheel = zoom at the cursor, hover = tooltip + path preview,
//           click = allocate the whole shortest path / refund
//   touch   one finger pans, two fingers pinch-zoom, tap = select (tooltip with an
//           Allocate button), tap the selected node again = allocate
//   search  highlights every node whose name or text matches
//
// Nodes allocated since the panel opened can be undone for free; older ones are
// refunded at the Mystic for gold (respec resets everything).

import { define, all } from '../../../core/registry.js';
import { h } from '../../../ui/shell.js';
import { PG, hideTip, showTextTip, toast, btn, dirty } from './common.js';
import { getTree, pathTo, allocatePath, refund, canRefund, pointsLeft, pointsTotal, treeState, treeMods, summarizeMods, respec, respecCost, refundCost,
	START_INFO, SECTORS, ascPointsLeft, ascPointsTotal, chooseAscendancy, ascAllocate, allocatedNodes } from '../tree.js';
import { modsToLines, modLine } from '../text.js';
import { ASCENDANCY_LEVEL } from '../data/ascendancy.js';

const THEME = {
	life: '#e05050', armour: '#b8a888', evasion: '#5fbf6a', shield: '#4dd0e1', mana: '#4a7ae0', block: '#c0b090', resistance: '#c080e0', leech: '#d03850',
	fire: '#ff7043', cold: '#64b5f6', lightning: '#ffe95a', chaos: '#b07ae0', elemental: '#ffb060', physical: '#d0b090', melee: '#e09060', speed: '#8fe0a0',
	projectile: '#a8e070', area: '#e0a040', crit: '#ffd84d', 'dual-wield': '#90d0a0', 'two-handed': '#d07050', weapon: '#d0c0a0', spell: '#9ab8ff', minion: '#a0a0e0',
	utility: '#a0c8c8', movement: '#80f0c0', flask: '#e06080', loot: '#ffd34d', conditional: '#f0a0c0', attribute: '#9aa3b5', keystone: '#ffcf5a', start: '#ffffff'
};
const RADIUS = { travel: 7, small: 10, notable: 17, keystone: 26, start: 30 };
const TYPE_NAME = { travel: 'Attribute', small: 'Passive', notable: 'Notable', keystone: 'Keystone', start: 'Start' };

function searchText( n ) {

	if ( n._search === undefined ) n._search = [ n.name, n.clusterName, n.theme, ...modsToLines( n.mods || [] ), ...( n.lines || [] ) ].join( ' ' ).toLowerCase();
	return n._search;

}

function nodeLines( n ) {

	const lines = n.lines ? [ ...n.lines ] : [];
	if ( ! n.keystone || ! n.lines ) for ( const l of modsToLines( n.mods || [] ) ) if ( ! lines.includes( l ) ) lines.push( l );
	return lines;

}

define( 'uiPanel', { id: 'tree', order: 50, toggle: 'tree', modal: true,
	mount( ui ) {

		PG.ui = ui; PG.game = ui.game;
		this.view = null;
		this.mode = 'main';
		this.session = [];
		this.matches = new Set();
		this.points = h( 'span', { class: 'pg-tree-points' } );
		this.searchEl = h( 'input', { class: 'pg-input', type: 'search', placeholder: 'Search passives (e.g. fire, life, crit)', style: { width: 'min(260px, 40vw)' } } );
		this.searchEl.addEventListener( 'input', () => this.setSearch( this.searchEl.value ) );
		this.searchEl.addEventListener( 'keydown', ( e ) => e.stopPropagation() );
		this.modeBtn = btn( 'Ascendancy', () => this.setMode( this.mode === 'main' ? 'asc' : 'main' ) );
		this.undoBtn = btn( 'Undo', () => this.undo(), { title: 'Refund the passives allocated since you opened the tree (free)' } );
		this.respecBtn = btn( 'Respec', () => this.askRespec(), { title: 'Reset the whole tree for gold (Mystic only)' } );
		this.startSel = h( 'select', { class: 'pg-select', title: 'Starting region (free while nothing else is allocated)' }, Object.entries( START_INFO ).map( ( [ id, s ] ) => h( 'option', { value: id, text: `Start: ${s.name}` } ) ) );
		this.startSel.addEventListener( 'change', () => this.setStart( this.startSel.value ) );
		this.statsBtn = btn( 'Stats', () => {

			this.side.classList.toggle( 'hidden' );
			this.statsBtn.classList.toggle( 'pg-on', ! this.side.classList.contains( 'hidden' ) );

		} );
		this.cv = h( 'canvas' );
		this.side = h( 'div', { class: 'pg-tree-side' } );
		this.hint = h( 'div', { class: 'pg-tree-hint' } );
		this.cards = h( 'div', { class: 'pg-asc-cards hidden' } );
		this.wrap = h( 'div', { class: 'pg-tree-wrap' }, this.cv, this.side, this.cards, this.hint );
		this.bindInput();
		new ResizeObserver( () => this.resize() ).observe( this.wrap );
		return h( 'div', { class: 'pg-panel pg-full' },
			h( 'div', { class: 'pg-tree-bar' }, h( 'h2', { text: 'Passive Tree' } ), this.points, this.searchEl, btn( 'Fit', () => this.fit() ), this.statsBtn, this.modeBtn, this.startSel, this.undoBtn, this.respecBtn,
				h( 'span', { class: 'pg-grow', style: { flex: 1 } } ),
				h( 'button', { class: 'pg-btn pg-x', title: 'Close', onclick: () => ui.open( 'tree', false ) }, '✕' ) ),
			this.wrap );

	},

	// --- state changes -------------------------------------------------------------------------------

	changed() {

		PG.game.applyPlayerStats();
		dirty();
		this.dirty = true;
		this.pathIds = null;

	},
	setSearch( q ) {

		q = q.trim().toLowerCase();
		this.matches = new Set();
		if ( q.length >= 2 ) for ( const n of getTree().nodes.values() ) if ( searchText( n ).includes( q ) ) this.matches.add( n.id );
		this.dirty = true;

	},
	setMode( m ) {

		this.mode = m;
		this.modeBtn.textContent = m === 'main' ? 'Ascendancy' : 'Passive Tree';
		hideTip();
		this.dirty = true;

	},
	setStart( region ) {

		const save = PG.game.save, t = treeState( save );
		if ( t.allocated.length > 1 ) {

			toast( 'Changing the start region needs a respec', 'error' );
			this.startSel.value = t.start;
			return;

		}

		t.start = region;
		t.allocated = [ `s.${region}` ];
		this.centerOn( `s.${region}` );
		this.changed();

	},
	allocate( n ) {

		const save = PG.game.save;
		if ( this.mode === 'asc' ) {

			const r = ascAllocate( save, n.id );
			if ( ! r.ok ) toast( r.reason, 'error' ); else this.changed();
			return;

		}

		const r = allocatePath( save, n.id );
		if ( ! r.ok ) toast( r.reason, 'error' );
		else {

			this.session.push( r.path );
			this.changed();

		}

	},
	tryRefund( n ) {

		const save = PG.game.save;
		const fresh = this.session.some( ( chunk ) => chunk.includes( n.id ) );
		const why = canRefund( save, n.id );
		if ( why ) return toast( why, 'error' );
		if ( fresh ) {

			refund( save, n.id );
			for ( const c of this.session ) {

				const i = c.indexOf( n.id );
				if ( i >= 0 ) c.splice( i, 1 );

			}

			return this.changed();

		}

		if ( ! this.mystic ) return toast( 'Refund passives at the Mystic in town', 'error' );
		const cost = refundCost( save.level );
		if ( save.gold < cost ) return toast( `Refunding costs ${cost} gold`, 'error' );
		PG.game.gainGold( - cost );
		refund( save, n.id );
		toast( `Refunded ${n.name} (${cost} gold)` );
		this.changed();

	},
	undo() {

		const save = PG.game.save;
		const chunk = this.session.pop();
		if ( ! chunk ) return toast( 'Nothing to undo since the tree was opened' );
		for ( const id of [ ...chunk ].reverse() ) refund( save, id );
		this.changed();

	},
	askRespec() {

		const save = PG.game.save;
		if ( ! this.mystic ) return toast( 'Visit the Mystic in town to respec', 'error' );
		const cost = respecCost( save );
		showTextTip( 'Respec the passive tree?', [ `Every passive point and ascendancy point is refunded.`, `Cost: ${cost.toLocaleString()} gold (you have ${save.gold.toLocaleString()})` ], this.respecBtn, { lineClass: 't-prop', actions: [
			{ label: `Respec (${cost.toLocaleString()} gold)`, primary: true, fn: () => {

				if ( save.gold < cost ) return toast( `Needs ${cost} gold`, 'error' );
				PG.game.gainGold( - cost );
				respec( save );
				this.session = [];
				this.changed();

			} },
			{ label: 'Cancel', fn: () => {} }
		] } );

	},

	// --- view ------------------------------------------------------------------------------------------------

	resize() {

		const r = this.wrap.getBoundingClientRect();
		if ( ! r.width ) return;
		const dpr = Math.min( 2, devicePixelRatio || 1 );
		this.W = r.width; this.H = r.height; this.dpr = dpr;
		this.cv.width = Math.round( r.width * dpr );
		this.cv.height = Math.round( r.height * dpr );
		this.dirty = true;

	},
	fit() {

		const b = getTree().bounds;
		this.view = { x: ( b.minX + b.maxX ) / 2, y: ( b.minY + b.maxY ) / 2, z: Math.min( this.W / ( b.maxX - b.minX + 400 ), this.H / ( b.maxY - b.minY + 500 ) ) };
		this.dirty = true;

	},
	centerOn( id, z = null ) {

		const n = getTree().nodes.get( id );
		if ( ! n ) return;
		this.view = { x: n.x, y: n.y - 200, z: z ?? this.view?.z ?? 0.32 };
		this.dirty = true;

	},
	toWorld( px, py ) {

		const v = this.view;
		return { x: ( px - this.W / 2 ) / v.z + v.x, y: ( py - this.H / 2 ) / v.z + v.y };

	},
	zoomAt( px, py, f ) {

		const v = this.view;
		const before = this.toWorld( px, py );
		v.z = Math.max( 0.05, Math.min( 2.2, v.z * f ) );
		const after = this.toWorld( px, py );
		v.x += before.x - after.x; v.y += before.y - after.y;
		this.dirty = true;

	},
	nodes() {

		if ( this.mode === 'asc' ) {

			const t = treeState( PG.game.save );
			const A = getTree().asc[ t.asc.id ];
			return A ? A.nodes : null;

		}

		return getTree().nodes;

	},
	// asc nodes live around (0,0) on a small scale; draw them magnified in the centre
	ascScale() {

		return Math.min( this.W, this.H ) / 560;

	},
	nodeAt( px, py ) {

		const nodes = this.nodes();
		if ( ! nodes ) return null;
		let best = null, bd = Infinity;
		if ( this.mode === 'asc' ) {

			const k = this.ascScale();
			for ( const n of nodes.values() ) {

				const d = Math.hypot( this.W / 2 + n.x * k - px, this.H / 2 + n.y * k - py );
				if ( d < ( n.type === 'notable' ? 26 : 18 ) * k && d < bd ) {

					bd = d;
					best = n;

				}

			}

			return best;

		}

		const w = this.toWorld( px, py ), z = this.view.z;
		for ( const n of nodes.values() ) {

			const r = ( RADIUS[ n.type ] ?? 10 ) + 8 / z;
			const d = Math.hypot( n.x - w.x, n.y - w.y );
			if ( d < r && d < bd ) {

				bd = d;
				best = n;

			}

		}

		return best;

	},

	// --- input -------------------------------------------------------------------------------------------------

	bindInput() {

		const cv = this.cv;
		const pts = new Map();
		let pan = null, pinch = null;
		const pos = ( e ) => {

			const r = cv.getBoundingClientRect();
			return { x: e.clientX - r.left, y: e.clientY - r.top };

		};

		cv.addEventListener( 'pointerdown', ( e ) => {

			cv.setPointerCapture( e.pointerId );
			const p = pos( e );
			pts.set( e.pointerId, p );
			if ( pts.size === 1 ) pan = { x: p.x, y: p.y, vx: this.view.x, vy: this.view.y, moved: false, type: e.pointerType };
			if ( pts.size === 2 ) {

				const [ a, b ] = [ ...pts.values() ];
				pinch = { d: Math.hypot( a.x - b.x, a.y - b.y ), z: this.view.z, mid: this.toWorld( ( a.x + b.x ) / 2, ( a.y + b.y ) / 2 ) };
				if ( pan ) pan.moved = true;

			}

		} );
		cv.addEventListener( 'pointermove', ( e ) => {

			const p = pos( e );
			if ( pts.has( e.pointerId ) ) pts.set( e.pointerId, p );
			if ( pinch && pts.size >= 2 ) {

				const [ a, b ] = [ ...pts.values() ];
				const d = Math.hypot( a.x - b.x, a.y - b.y );
				this.view.z = Math.max( 0.05, Math.min( 2.2, pinch.z * d / Math.max( 1, pinch.d ) ) );
				const mx = ( a.x + b.x ) / 2, my = ( a.y + b.y ) / 2;
				this.view.x = pinch.mid.x - ( mx - this.W / 2 ) / this.view.z;
				this.view.y = pinch.mid.y - ( my - this.H / 2 ) / this.view.z;
				this.dirty = true;
				return;

			}

			if ( pan && pts.size === 1 ) {

				if ( Math.hypot( p.x - pan.x, p.y - pan.y ) > 6 ) pan.moved = true;
				if ( pan.moved && this.mode === 'main' ) {

					this.view.x = pan.vx - ( p.x - pan.x ) / this.view.z;
					this.view.y = pan.vy - ( p.y - pan.y ) / this.view.z;
					cv.classList.add( 'pg-grabbing' );
					hideTip();
					this.dirty = true;

				}

				return;

			}

			if ( e.pointerType === 'mouse' ) this.setHover( this.nodeAt( p.x, p.y ), e );

		} );
		const up = ( e ) => {

			const p = pos( e );
			const wasPan = pan;
			pts.delete( e.pointerId );
			if ( pts.size < 2 ) pinch = null;
			if ( pts.size === 0 ) {

				pan = null;
				cv.classList.remove( 'pg-grabbing' );
				if ( wasPan && ! wasPan.moved && e.type === 'pointerup' ) this.tap( this.nodeAt( p.x, p.y ), e );

			}

		};

		cv.addEventListener( 'pointerup', up );
		cv.addEventListener( 'pointercancel', up );
		cv.addEventListener( 'pointerleave', ( e ) => {

			if ( e.pointerType === 'mouse' ) this.setHover( null );

		} );
		cv.addEventListener( 'wheel', ( e ) => {

			e.preventDefault();
			if ( this.mode !== 'main' ) return;
			const p = pos( e );
			this.zoomAt( p.x, p.y, Math.exp( - e.deltaY * 0.0015 ) );

		}, { passive: false } );

	},
	setHover( n, e ) {

		if ( n === this.hover && ! e ) return;
		if ( n !== this.hover ) {

			this.hover = n;
			this.pathIds = null;
			this.dirty = true;

		}

		if ( n && e ) this.showNodeTip( n, { x: e.clientX, y: e.clientY } );
		else if ( ! n ) hideTip();

	},
	tap( n, e ) {

		if ( ! n ) {

			this.sel = null;
			hideTip();
			this.dirty = true;
			return;

		}

		const save = PG.game.save;
		const allocated = this.mode === 'asc' ? treeState( save ).asc.allocated.includes( n.id ) : treeState( save ).allocated.includes( n.id );
		const touch = e.pointerType !== 'mouse';
		if ( touch && this.sel !== n ) {

			this.sel = n;
			this.hover = n;
			this.pathIds = null;
			this.dirty = true;
			this.showNodeTip( n, { x: e.clientX, y: e.clientY }, true );
			return;

		}

		hideTip();
		if ( allocated ) {

			if ( this.mode === 'main' ) this.tryRefund( n );

		} else this.allocate( n );
		this.sel = null;

	},
	showNodeTip( n, at, pinned = false ) {

		const save = PG.game.save;
		const t = treeState( save );
		const isAsc = this.mode === 'asc';
		const allocated = isAsc ? t.asc.allocated.includes( n.id ) : t.allocated.includes( n.id );
		const lines = nodeLines( n );
		let status, action = null;
		if ( allocated ) {

			const fresh = this.session.some( ( c ) => c.includes( n.id ) );
			status = n.type === 'start' ? 'Your starting point' : fresh ? 'Allocated - click to undo (free)' : this.mystic ? `Allocated - click to refund (${refundCost( save.level )} gold)` : 'Allocated (refund at the Mystic)';
			if ( pinned && n.type !== 'start' && ! isAsc ) action = { label: fresh ? 'Undo' : 'Refund', fn: () => this.tryRefund( n ) };

		} else if ( isAsc ) {

			status = ascPointsLeft( save ) > 0 ? 'Click to allocate' : 'No ascendancy points left';
			if ( pinned ) action = { label: 'Allocate', primary: true, fn: () => this.allocate( n ) };

		} else {

			const path = pathTo( save, n.id );
			const cost = path?.length ?? 0;
			const left = pointsLeft( save );
			status = path === null ? 'Unreachable' : cost > left ? `Needs ${cost} points - you have ${left}` : `Click to allocate (${cost} point${cost === 1 ? '' : 's'})`;
			if ( pinned && path ) action = { label: `Allocate (${cost})`, primary: true, fn: () => this.allocate( n ) };

		}

		const cls = n.type === 'keystone' ? 'r-unique' : n.type === 'notable' ? 'r-rare' : 'r-plain';
		const sub = [ TYPE_NAME[ n.type ] ?? n.type, n.clusterName ].filter( Boolean ).join( ' · ' );
		showTextTip( n.name, [ ...lines, h( 'div', { class: 't-foot', text: status } ) ], at, { cls, sub, actions: action ? [ action ] : null } );

	},

	// --- drawing -------------------------------------------------------------------------------------------------

	draw() {

		const g = this.cv.getContext( '2d' );
		const { W, H, dpr } = this;
		if ( ! W ) return;
		g.setTransform( dpr, 0, 0, dpr, 0, 0 );
		g.fillStyle = '#06080c';
		g.fillRect( 0, 0, W, H );
		if ( this.mode === 'asc' ) return this.drawAsc( g );
		this.cards.classList.add( 'hidden' );
		const T = getTree(), save = PG.game.save, t = treeState( save );
		const v = this.view, z = v.z;
		const alloc = new Set( t.allocated );
		const X = ( x ) => ( x - v.x ) * z + W / 2, Y = ( y ) => ( y - v.y ) * z + H / 2;
		const vis = ( n, pad = 40 ) => {

			const x = X( n.x ), y = Y( n.y );
			return x > - pad && x < W + pad && y > - pad && y < H + pad;

		};

		// region tint wedges
		for ( const s of SECTORS ) {

			const a0 = - ( s.angle + 30 ) * Math.PI / 180, a1 = - ( s.angle - 30 ) * Math.PI / 180;
			const grd = g.createRadialGradient( X( 0 ), Y( 0 ), 0, X( 0 ), Y( 0 ), 3300 * z );
			grd.addColorStop( 0, 'rgba(0,0,0,0)' );
			grd.addColorStop( 0.5, s.color + '14' );
			grd.addColorStop( 1, s.color + '05' );
			g.fillStyle = grd;
			g.beginPath();
			g.moveTo( X( 0 ), Y( 0 ) );
			g.arc( X( 0 ), Y( 0 ), 3300 * z, a0, a1 );
			g.closePath();
			g.fill();
			if ( z < 0.3 ) {

				g.fillStyle = s.color + 'aa';
				g.font = `700 ${Math.max( 12, 22 )}px system-ui, sans-serif`;
				g.textAlign = 'center';
				const ang = s.angle * Math.PI / 180;
				g.fillText( s.name.toUpperCase(), X( Math.cos( ang ) * 1650 ), Y( - Math.sin( ang ) * 1650 ) );

			}

		}

		// preview path from the allocated tree to the hovered node
		if ( this.hover && ! this.pathIds && ! alloc.has( this.hover.id ) ) this.pathIds = new Set( pathTo( save, this.hover.id ) || [] );
		const path = this.pathIds || new Set();

		// links, batched by style
		const styles = { idle: [], avail: [], path: [], alloc: [] };
		for ( const [ a, b ] of T.edges ) {

			const na = T.nodes.get( a ), nb = T.nodes.get( b );
			if ( ! vis( na, 400 ) && ! vis( nb, 400 ) ) continue;
			const A = alloc.has( a ), B = alloc.has( b );
			const k = A && B ? 'alloc' : ( path.has( a ) || A ) && ( path.has( b ) || B ) && ( path.has( a ) || path.has( b ) ) ? 'path' : A || B ? 'avail' : 'idle';
			styles[ k ].push( na, nb );

		}

		const stroke = ( list, color, width, dash = null ) => {

			if ( ! list.length ) return;
			g.beginPath();
			for ( let i = 0; i < list.length; i += 2 ) {

				g.moveTo( X( list[ i ].x ), Y( list[ i ].y ) );
				g.lineTo( X( list[ i + 1 ].x ), Y( list[ i + 1 ].y ) );

			}

			g.strokeStyle = color;
			g.lineWidth = width;
			g.setLineDash( dash || [] );
			g.stroke();
			g.setLineDash( [] );

		};

		const lw = Math.max( 1, 4 * z );
		stroke( styles.idle, '#2c3444', lw );
		stroke( styles.avail, '#6a6040', lw * 1.2 );
		stroke( styles.path, '#ffffff', lw * 1.3, [ 6, 5 ] );
		stroke( styles.alloc, '#e8c26a', lw * 1.6 );

		// nodes
		const labels = [];
		for ( const n of T.nodes.values() ) {

			if ( ! vis( n ) ) continue;
			const r = Math.max( n.type === 'keystone' ? 5 : n.type === 'notable' || n.type === 'start' ? 3.5 : 2, ( RADIUS[ n.type ] ?? 10 ) * z );
			const x = X( n.x ), y = Y( n.y );
			const col = THEME[ n.theme ] || '#9aa3b5';
			const on = alloc.has( n.id );
			const avail = ! on && n.links.some( ( l ) => alloc.has( l ) );
			const inPath = path.has( n.id );
			g.beginPath();
			if ( n.type === 'keystone' ) {

				for ( let i = 0; i < 8; i ++ ) {

					const a = i / 8 * Math.PI * 2 + Math.PI / 8;
					g[ i ? 'lineTo' : 'moveTo' ]( x + Math.cos( a ) * r, y + Math.sin( a ) * r );

				}

				g.closePath();

			} else g.arc( x, y, r, 0, Math.PI * 2 );
			g.fillStyle = on ? col : n.type === 'start' ? '#2a3140' : '#121722';
			g.fill();
			if ( r > 2.5 ) {

				g.lineWidth = Math.max( 1, ( n.type === 'notable' || n.type === 'keystone' ? 3 : 2 ) * Math.min( 1, z * 2 ) );
				g.strokeStyle = on ? '#ffe08a' : inPath ? '#ffffff' : avail ? col : col + '70';
				g.stroke();
				if ( n.type === 'notable' || n.type === 'start' ) {

					g.beginPath();
					g.arc( x, y, r * 0.62, 0, Math.PI * 2 );
					g.strokeStyle = on ? '#3a2a10' : col + ( avail ? 'cc' : '55' );
					g.stroke();

				}

			}

			if ( this.matches.has( n.id ) ) {

				g.beginPath();
				g.arc( x, y, r + Math.max( 4, 8 * z ), 0, Math.PI * 2 );
				g.strokeStyle = '#3ef0ff';
				g.lineWidth = 2.5;
				g.stroke();

			}

			if ( this.hover === n || this.sel === n ) {

				g.beginPath();
				g.arc( x, y, r + 3, 0, Math.PI * 2 );
				g.strokeStyle = '#ffffff';
				g.lineWidth = 2;
				g.stroke();

			}

			if ( n.type === 'start' || ( n.type === 'keystone' && z > 0.09 ) || ( n.type === 'notable' && z > 0.42 ) ) labels.push( [ n, x, y + r + 4 ] );

		}

		// labels last so links never cover them; most important first, overlapping ones skipped
		g.textAlign = 'center';
		g.textBaseline = 'top';
		const RANK = { start: 0, keystone: 1, notable: 2 };
		labels.sort( ( a, b ) => RANK[ a[ 0 ].type ] - RANK[ b[ 0 ].type ] );
		const placed = [];
		for ( const [ n, x, y ] of labels ) {

			const size = n.type === 'start' ? 15 : n.type === 'keystone' ? ( z < 0.2 ? 10 : 13 ) : 11;
			g.font = `${n.type === 'small' ? 500 : 700} ${size}px system-ui, sans-serif`;
			const w = g.measureText( n.name ).width;
			if ( placed.some( ( r ) => Math.abs( r.x - x ) < ( r.w + w ) / 2 + 4 && Math.abs( r.y - y ) < size + 4 ) ) continue;
			placed.push( { x, y, w } );
			g.fillStyle = 'rgba(5,7,10,0.8)';
			g.fillRect( x - w / 2 - 3, y - 1, w + 6, size + 4 );
			g.fillStyle = n.type === 'keystone' ? '#ffcf5a' : n.type === 'start' ? '#ffffff' : alloc.has( n.id ) ? '#ffe08a' : '#dfe5f0';
			g.fillText( n.name, x, y + 1 );

		}

		g.textBaseline = 'alphabetic';

	},
	drawAsc( g ) {

		const save = PG.game.save, t = treeState( save );
		const A = getTree().asc[ t.asc.id ];
		this.cards.classList.toggle( 'hidden', !! A );
		if ( ! A ) return this.renderCards();
		const k = this.ascScale(), cx = this.W / 2, cy = this.H / 2;
		const col = A.def.color;
		g.beginPath();
		g.arc( cx, cy, 250 * k, 0, Math.PI * 2 );
		g.fillStyle = col + '14';
		g.fill();
		g.strokeStyle = col + '66';
		g.lineWidth = 2;
		g.stroke();
		const alloc = new Set( t.asc.allocated );
		for ( const n of A.nodes.values() ) for ( const l of n.links ) {

			const o = A.nodes.get( l );
			if ( n.id > o.id ) continue;
			g.beginPath();
			g.moveTo( cx + n.x * k, cy + n.y * k );
			g.lineTo( cx + o.x * k, cy + o.y * k );
			g.strokeStyle = alloc.has( n.id ) && alloc.has( o.id ) ? '#e8c26a' : '#3a4458';
			g.lineWidth = 4;
			g.stroke();

		}

		g.textAlign = 'center';
		g.textBaseline = 'top';
		for ( const n of A.nodes.values() ) {

			const r = ( n.type === 'start' ? 34 : n.type === 'notable' ? 24 : 13 ) * k;
			const on = alloc.has( n.id );
			g.beginPath();
			g.arc( cx + n.x * k, cy + n.y * k, r, 0, Math.PI * 2 );
			g.fillStyle = on ? col : '#121722';
			g.fill();
			g.lineWidth = 3;
			g.strokeStyle = this.hover === n ? '#ffffff' : on ? '#ffe08a' : col;
			g.stroke();
			if ( n.type !== 'small' ) {

				g.font = `700 ${Math.round( 13 * Math.max( 0.8, k ) )}px system-ui, sans-serif`;
				g.fillStyle = on ? '#ffe08a' : '#dfe5f0';
				g.fillText( n.name, cx + n.x * k, cy + n.y * k + r + 4 );

			}

		}

		g.textBaseline = 'alphabetic';

	},
	renderCards() {

		const save = PG.game.save;
		const locked = save.level < ASCENDANCY_LEVEL;
		this.cards.replaceChildren( ...all( 'ascendancy' ).map( ( a ) => h( 'div', { class: 'pg-asc-card' },
			h( 'h3', { style: { color: a.color }, text: a.name } ),
			h( 'div', { class: 'pg-small', text: a.desc } ),
			h( 'div', { class: 'pg-small pg-dim', style: { margin: '6px 0' } }, a.nodes.filter( ( n ) => n.type === 'notable' ).map( ( n ) => h( 'div', { text: '• ' + n.name } ) ) ),
			btn( locked ? `Unlocks at level ${ASCENDANCY_LEVEL}` : `Become a ${a.name}`, () => {

				const r = chooseAscendancy( save, a.id );
				if ( ! r.ok ) toast( r.reason, 'error' ); else this.changed();

			}, { disabled: locked, cls: 'pg-primary' } ) ) ) );

	},
	renderSide() {

		const save = PG.game.save;
		const mods = summarizeMods( treeMods( save ) );
		const nodes = allocatedNodes( save );
		const ks = nodes.filter( ( n ) => n.type === 'keystone' );
		this.side.replaceChildren(
			h( 'div', { style: { fontWeight: 700 } }, `${treeState( save ).allocated.length - 1} / ${pointsTotal( save.level, treeState( save ).bonus ?? 0 )} points allocated` ),
			ks.length ? h( 'div', { style: { color: '#ffcf5a', margin: '4px 0' } }, 'Keystones: ' + ks.map( ( n ) => n.name ).join( ', ' ) ) : null,
			h( 'div', { class: 'pg-dim', style: { margin: '4px 0' }, text: `Notables: ${nodes.filter( ( n ) => n.type === 'notable' ).length}` } ),
			...mods.sort( ( a, b ) => a.stat.localeCompare( b.stat ) ).map( ( m ) => h( 'div', { class: 'pg-modline', text: modLine( m ) } ) ) );

	},
	update( ui, game ) {

		const save = game.save;
		if ( this.v !== PG.version ) {

			this.v = PG.version;
			const asc = treeState( save ).asc;
			this.points.textContent = this.mode === 'asc' ? `${ascPointsLeft( save )} / ${ascPointsTotal( save.level )} ascendancy points` : `${pointsLeft( save )} points left`;
			this.undoBtn.disabled = ! this.session.length;
			this.respecBtn.classList.toggle( 'hidden', ! this.mystic );
			this.startSel.value = treeState( save ).start;
			this.startSel.disabled = treeState( save ).allocated.length > 1;
			this.modeBtn.title = asc.id ? '' : `Ascendancy unlocks at level ${ASCENDANCY_LEVEL}`;
			this.hint.textContent = this.mode === 'asc' ? 'Click a node to allocate · ascendancy points at levels 30, 45, 60, 75' : ( matchMedia( '(pointer: coarse)' ).matches ? 'Drag to pan · pinch to zoom · tap a node, tap again to allocate' : 'Drag to pan · wheel to zoom · click to allocate the highlighted path' ) + ( this.mystic ? ' · Mystic: refunds available' : '' );
			this.renderSide();
			this.dirty = true;

		}

		if ( this.dirty ) {

			this.dirty = false;
			this.draw();

		}

	},
	onOpen() {

		if ( ! this.W ) this.resize();
		if ( ! this.view ) {

			this.view = { x: 0, y: 0, z: 0.32 };
			this.centerOn( `s.${treeState( PG.game.save ).start}`, 0.32 );

		}

		this.session = [];
		this.setMode( 'main' );
		if ( innerWidth < 700 ) this.side.classList.add( 'hidden' );
		this.statsBtn.classList.toggle( 'pg-on', ! this.side.classList.contains( 'hidden' ) );
		this.v = - 1;
		this.dirty = true;

	},
	onClose() {

		hideTip();
		this.mystic = false;
		this.sel = null;
		PG.game.applyPlayerStats();

	}
} );
