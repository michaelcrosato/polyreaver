// Minimap: a corner map that reveals the level as you explore it, plus a large
// overlay (Tab / M, input action 'map').
//
// The layout is painted ONCE per world into an offscreen canvas at one pixel per
// tile - but only tiles you have seen (within EXPLORE metres) get their colour, so
// unexplored space stays dark. Every frame (throttled) the visible part of that
// image is scaled up into the corner canvas without smoothing (crisp pixels) and
// markers are drawn on top: you, monsters, the boss, loot, NPCs, mechanic objects
// and the exit.

import { define } from '../../../core/registry.js';
import { TILE } from '../../../core/layout.js';
import { h } from '../../../ui/shell.js';

const EXPLORE = 13; // metres revealed around the player
const TILE_RGB = {
	[ TILE.FLOOR ]: [ 92, 88, 80 ], [ TILE.DOOR ]: [ 110, 96, 80 ], [ TILE.ICE ]: [ 140, 200, 235 ], [ TILE.LAVA ]: [ 240, 100, 30 ],
	[ TILE.WATER ]: [ 40, 80, 120 ], [ TILE.BRIDGE ]: [ 130, 96, 60 ], [ TILE.WALL ]: [ 170, 164, 150 ], [ TILE.PIT ]: [ 6, 6, 8 ]
};
const MARK = { keg: '#ff7a2a', brazier: '#ffcf5a', pylon: '#7ad0ff', rift: '#d07aff', well: '#a070ff', shrine: '#e8fff0', vent: '#9cff3a', hive: '#c87a30', portal: '#7af0ff', waypoint: '#7ab8ff', stash: '#d8b060', dummy: '#c8b078' };

class MapState {

	constructor( world ) {

		const L = world.layout;
		this.world = world;
		this.L = L;
		this.seen = new Uint8Array( L.w * L.h );
		this.canvas = document.createElement( 'canvas' );
		this.canvas.width = L.w; this.canvas.height = L.h;
		this.ctx = this.canvas.getContext( '2d' );
		this.img = this.ctx.createImageData( L.w, L.h );
		this.dirty = true;
		if ( world.kind === 'town' ) this.reveal( 0, 0, 1e4 ); // the town is home: fully known

	}

	reveal( x, z, r ) {

		const L = this.L;
		const [ cx, cz ] = L.toTile( x, z ), rt = Math.ceil( r / L.cell );
		for ( let tz = cz - rt; tz <= cz + rt; tz ++ ) for ( let tx = cx - rt; tx <= cx + rt; tx ++ ) {

			if ( ! L.inside( tx, tz ) ) continue;
			const i = L.idx( tx, tz );
			if ( this.seen[ i ] || ( tx - cx ) ** 2 + ( tz - cz ) ** 2 > rt * rt ) continue;
			this.seen[ i ] = 1;
			const t = L.tiles[ i ];
			const c = TILE_RGB[ t ];
			if ( ! c ) continue;
			const lo = L.elev?.[ i ] === - 1 ? 0.75 : 1;
			this.img.data.set( [ c[ 0 ] * lo, c[ 1 ] * lo, c[ 2 ] * lo, 255 ], i * 4 );
			this.dirty = true;

		}

	}

	flush() {

		if ( ! this.dirty ) return;
		this.ctx.putImageData( this.img, 0, 0 );
		this.dirty = false;

	}

}

let state = null;

function mapFor( world ) {

	if ( ! state || state.world !== world ) state = new MapState( world );
	return state;

}

// Draw the map into ctx (W x H px): `view` = { cx, cz, scale (px per tile) } or null (fit).
function draw( ctx, W, H, world, view ) {

	const ms = mapFor( world ), L = ms.L, p = world.player;
	if ( p ) ms.reveal( p.x, p.z, EXPLORE );
	ms.flush();
	ctx.clearRect( 0, 0, W, H );
	const scale = view ? view.scale : Math.min( W / L.w, H / L.h ) * 0.95;
	const [ ptx, ptz ] = p ? L.toTile( p.x, p.z ) : [ L.w / 2, L.h / 2 ];
	const ox = view ? W / 2 - ( ptx + 0.5 ) * scale : ( W - L.w * scale ) / 2;
	const oz = view ? H / 2 - ( ptz + 0.5 ) * scale : ( H - L.h * scale ) / 2;
	ctx.imageSmoothingEnabled = false;
	ctx.globalAlpha = 0.92;
	ctx.drawImage( ms.canvas, ox, oz, L.w * scale, L.h * scale );
	ctx.globalAlpha = 1;
	const toPx = ( x, z ) => [ ox + ( x - L.ox ) / L.cell * scale, oz + ( z - L.oz ) / L.cell * scale ];
	const seen = ( x, z ) => {

		const [ tx, tz ] = L.toTile( x, z );
		return L.inside( tx, tz ) && ms.seen[ L.idx( tx, tz ) ];

	};

	const dot = ( x, z, r, color ) => {

		const [ px, pz ] = toPx( x, z );
		if ( px < - 4 || pz < - 4 || px > W + 4 || pz > H + 4 ) return;
		ctx.fillStyle = color;
		ctx.beginPath();
		ctx.arc( px, pz, r, 0, Math.PI * 2 );
		ctx.fill();

	};

	const r = Math.max( 1.6, scale * 0.45 );
	for ( const e of world.entities ) {

		if ( ! e.alive || e === p ) continue;
		if ( e.kind === 'monster' && seen( e.x, e.z ) ) dot( e.x, e.z, r, '#ff4a3a' );
		else if ( e.kind === 'boss' && seen( e.x, e.z ) ) dot( e.x, e.z, r * 2.2, '#c04aff' );
		else if ( e.kind === 'npc' ) dot( e.x, e.z, r * 1.3, '#5ad1ff' );
		else if ( e.kind === 'loot' && seen( e.x, e.z ) ) dot( e.x, e.z, r * 0.9, e.data.color || '#ffffff' );
		else if ( e.model?.type === 'mech' && MARK[ e.model.id ] && seen( e.x, e.z ) ) {

			const [ px, pz ] = toPx( e.x, e.z ), s = e.model.id === 'portal' || e.model.id === 'waypoint' ? r * 2.6 : r * 1.4;
			ctx.fillStyle = MARK[ e.model.id ];
			if ( e.model.id === 'brazier' && ! e.data.lit ) ctx.fillStyle = '#6a5a3a';
			ctx.fillRect( px - s / 2, pz - s / 2, s, s );

		}

	}

	// the exit portal pulses so you can always find it
	const portal = world.state.flow?.portal;
	if ( portal ) {

		const [ px, pz ] = toPx( portal.x, portal.z );
		ctx.strokeStyle = '#7af0ff';
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.arc( px, pz, r * 3 + Math.sin( performance.now() / 200 ) * 2, 0, Math.PI * 2 );
		ctx.stroke();

	}

	if ( p ) {

		// you: a yellow arrow along your facing (0 = +z = map down)
		const [ px, pz ] = toPx( p.x, p.z ), s = Math.max( 5, scale * 1.4 );
		ctx.save();
		ctx.translate( px, pz );
		ctx.rotate( - p.facing );
		ctx.fillStyle = '#ffd23f';
		ctx.strokeStyle = '#000';
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.moveTo( 0, s ); ctx.lineTo( s * 0.65, - s * 0.6 ); ctx.lineTo( 0, - s * 0.25 ); ctx.lineTo( - s * 0.65, - s * 0.6 );
		ctx.closePath();
		ctx.fill();
		ctx.stroke();
		ctx.restore();

	}

}

define( 'uiPanel', { id: 'minimap', order: 16, startOpen: true,
	mount() {

		this.canvas = h( 'canvas', { class: 'w-minimap' } );
		this.size = 0;
		this.acc = 0;
		return h( 'div', { class: 'w-layer' }, this.canvas );

	},
	update( ui, game, dt ) {

		const w = game.world;
		if ( ! w || ui.isOpen( 'map' ) ) return;
		this.acc += dt;
		if ( this.acc < 1 / 20 ) return; // 20 Hz is plenty for a map
		this.acc = 0;
		const css = Math.round( Math.min( 190, Math.max( 120, innerWidth * 0.16 ) ) );
		const dpr = Math.min( 2, devicePixelRatio || 1 );
		if ( this.size !== css ) {

			this.size = css;
			this.canvas.width = this.canvas.height = css * dpr;
			this.canvas.style.width = this.canvas.style.height = css + 'px';

		}

		draw( this.canvas.getContext( '2d' ), this.canvas.width, this.canvas.height, w, { scale: 3.4 * dpr } );

	}
} );

define( 'uiPanel', { id: 'map', order: 17, toggle: 'map', startOpen: false,
	mount() {

		this.canvas = h( 'canvas', { class: 'w-bigmap' } );
		this.title = h( 'div', { class: 'w-maptitle' } );
		const legend = h( 'div', { class: 'w-legend' }, ...[ [ '#ffd23f', 'you' ], [ '#ff4a3a', 'monster' ], [ '#c04aff', 'boss' ], [ '#5ad1ff', 'NPC' ], [ '#7af0ff', 'exit' ],
			[ '#ff7a2a', 'keg' ], [ '#ffcf5a', 'brazier' ], [ '#7ad0ff', 'pylon' ], [ '#d07aff', 'rift' ], [ '#a070ff', 'well' ], [ '#e8fff0', 'shrine' ], [ '#c87a30', 'hive' ] ]
			.map( ( [ c, t ] ) => h( 'span', {}, h( 'i', { style: { background: c } } ), t ) ) );
		return h( 'div', { class: 'w-mapwrap' }, this.title, this.canvas, legend );

	},
	update( ui, game ) {

		const w = game.world;
		if ( ! w ) return;
		const W = Math.round( Math.min( innerWidth * 0.86, innerHeight * 0.78 ) ), dpr = Math.min( 2, devicePixelRatio || 1 );
		if ( this.canvas.width !== W * dpr ) {

			this.canvas.width = this.canvas.height = W * dpr;
			this.canvas.style.width = this.canvas.style.height = W + 'px';

		}

		const name = w.kind === 'town' ? 'Hearthmoor' : `${w.spec?.name ?? 'Level'} - depth ${w.spec?.depth ?? ''}`;
		if ( this.title.textContent !== name ) this.title.textContent = name;
		draw( this.canvas.getContext( '2d' ), this.canvas.width, this.canvas.height, w, null );

	}
} );

document.head.append( h( 'style', { text: `
.w-minimap { position: absolute; top: calc(max(12px, env(safe-area-inset-top)) + 40px); right: 12px; border-radius: 50%; background: rgba(6,8,12,0.7); border: 2px solid rgba(255,255,255,0.18); box-shadow: 0 2px 12px rgba(0,0,0,0.5); }
.w-mapwrap { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; background: rgba(4,6,10,0.55); }
.w-bigmap { border-radius: 12px; background: rgba(6,8,12,0.6); border: 1px solid var(--line); }
.w-maptitle { font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 6px; text-shadow: 0 1px 3px #000; }
.w-legend { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 8px; font-size: 12px; color: var(--dim); justify-content: center; max-width: 90vw; }
.w-legend i { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-right: 4px; }
` } ) );
