// In-game inspector (toggle with the ` key): the human-facing twin of the agent
// API. Shows performance, the world summary and any entity's live data (click an
// entity while the inspector is open), and can draw collision circles, attack
// areas and the bot's path on top of the scene. Everything it shows comes from the
// same game.api() commands an agent would call.

import * as THREE from 'three/webgpu';
import { define } from '../../core/registry.js';
import { h } from '../../ui/shell.js';

const state = { selected: null, overlay: false, perf: { fps: 0, frames: 0, acc: 0 } };

define( 'uiPanel', { id: 'inspector', order: 95, toggle: 'debug',
	mount( ui ) {

		this.pre = h( 'pre', { class: 'insp-pre' } );
		this.perf = h( 'div', { class: 'insp-perf' } );
		const overlay = h( 'input', { type: 'checkbox', onchange: () => ( state.overlay = overlay.checked ) } );
		const cmd = h( 'input', { type: 'text', placeholder: 'api command, e.g. level.ascii', class: 'insp-cmd' } );
		const run = () => {

			const [ id, ...rest ] = cmd.value.trim().split( ' ' );
			try {

				const args = rest.length ? JSON.parse( rest.join( ' ' ) ) : {};
				const out = ui.game.api( id, args );
				this.pre.textContent = typeof out?.ascii === 'string' ? out.ascii : JSON.stringify( out, null, 1 ).slice( 0, 20000 );
				this.hold = 5;

			} catch ( e ) {

				this.pre.textContent = 'error: ' + e.message;
				this.hold = 5;

			}

		};

		cmd.addEventListener( 'keydown', ( e ) => {

			e.stopPropagation();
			if ( e.key === 'Enter' ) run();

		} );
		this.hold = 0;
		return h( 'div', { class: 'panel inspector' },
			h( 'div', { class: 'insp-head' }, h( 'b', { text: 'Inspector' } ), h( 'label', {}, overlay, ' hitboxes & areas' ) ),
			this.perf, h( 'div', { class: 'insp-row' }, cmd, h( 'button', { text: 'Run', onclick: run } ) ),
			h( 'div', { class: 'dim', text: 'Click an entity to inspect it. game.api( "help" ) lists every command.' } ), this.pre );

	},
	onOpen( ui ) {

		ui.game.rc.renderer.domElement.addEventListener( 'pointerdown', pick );

	},
	onClose( ui ) {

		ui.game.rc.renderer.domElement.removeEventListener( 'pointerdown', pick );
		state.overlay = false;

	},
	update( ui, game, dt ) {

		const p = state.perf;
		p.frames ++; p.acc += dt;
		if ( p.acc >= 0.5 ) {

			p.fps = p.frames / p.acc;
			p.frames = 0; p.acc = 0;
			const info = game.rc.renderer.info;
			const w = game.world;
			this.perf.textContent = `${p.fps.toFixed( 0 )} fps · draws ${info.render.drawCalls} · tris ${( info.render.triangles / 1000 ).toFixed( 0 )}k · entities ${w.entities.length} · proj ${w.projectiles.length} · areas ${w.areas.length}`;
			if ( this.hold > 0 ) this.hold -= 0.5;
			else {

				const sel = state.selected && w.byId.get( state.selected );
				this.pre.textContent = JSON.stringify( sel ? game.api( 'inspect', { id: sel.id } ) : w.describe(), null, 1 );

			}

		}

	}
} );

function pick( e ) {

	const game = window.game, inp = game.input, w = game.world;
	if ( ! w ) return;
	const best = w.spatial.nearest( inp.aim.x, inp.aim.z, 2.5, ( o ) => o.kind !== 'player' );
	state.selected = best ? best.id : null;

}

// Overlay: entity collision circles, area shapes, projectile radii.
define( 'renderSystem', { id: 'tools-overlay', order: 90,
	init( rc ) {

		const ring = new THREE.RingGeometry( 0.94, 1, 24 ).rotateX( - Math.PI / 2 );
		this.mesh = new THREE.InstancedMesh( ring, new THREE.MeshBasicNodeMaterial( { transparent: true, opacity: 0.8, depthTest: false } ), 4096 );
		this.mesh.frustumCulled = false;
		this.mesh.renderOrder = 10;
		this.mesh.count = 0;
		rc.scene.add( this.mesh );
		this.m = new THREE.Matrix4(); this.c = new THREE.Color(); this.l = {};

	},
	update( rc, world ) {

		const mesh = this.mesh;
		if ( ! state.overlay ) {

			mesh.count = 0;
			return;

		}

		let n = 0;
		const put = ( x, z, r, col ) => {

			if ( n >= 4096 ) return;
			this.m.makeScale( r, 1, r ).setPosition( x, 0.06, z );
			mesh.setMatrixAt( n, this.m );
			mesh.setColorAt( n, this.c.set( col ) );
			n ++;

		};

		for ( const e of world.entities ) {

			if ( ! e.alive && e.kind !== 'loot' ) continue;
			const l = rc.lerp( e, this.l );
			put( l.x, l.z, e.radius, e.id === state.selected ? 0xffffff : e.team === 0 ? 0x5aff8a : e.team === 1 ? 0xff5a5a : 0x5ab4ff );

		}

		for ( const a of world.areas ) put( a.x, a.z, a.shape === 'line' ? a.length : a.radius, a.age < a.delay ? 0xffd23f : 0xff8a3a );
		for ( const p of world.projectiles ) put( p.x, p.z, p.radius, 0xc78aff );
		mesh.count = n;
		mesh.instanceMatrix.needsUpdate = true;
		if ( mesh.instanceColor ) mesh.instanceColor.needsUpdate = true;

	}
} );

define( 'bootHook', { id: 'tools-inspector-css', boot() {

	document.head.append( h( 'style', { text: `
.inspector { position: absolute; right: 10px; top: 60px; width: min(420px, 92vw); max-height: 70vh; display: flex; flex-direction: column; gap: 6px; font-size: 12px; }
.insp-head { display: flex; justify-content: space-between; align-items: center; }
.insp-perf { color: var(--accent); font-variant-numeric: tabular-nums; }
.insp-row { display: flex; gap: 6px; }
.insp-cmd { flex: 1; font: 12px ui-monospace, monospace; color: var(--fg); background: var(--field); border: 1px solid var(--field-line); border-radius: 6px; padding: 4px 6px; }
.insp-pre { margin: 0; overflow: auto; font: 11px/1.3 ui-monospace, monospace; white-space: pre; color: #d8deea; background: rgba(0,0,0,0.35); padding: 6px; border-radius: 6px; flex: 1; }
` } ) );

} } );
