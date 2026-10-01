// The Workshop: the human-facing front of the lab worlds (lab.js) and the other
// asset/balance tools. Open it from the pause menu or with the URL hash
// #lab=workshop. Everything it does is a game.api() call an agent can make too -
// the panel prints the call it ran, so a person can copy it into a script.
//
//   galleries     props, loot models, random genomes, monster families (designed or
//                 composed for any depth), bosses, hero/creature action poses
//   loot roller   roll N items at an item level and read them
//   balance       run the real simulation headlessly (bot plays each depth) right
//                 in the browser and print the same table as `npm run sim`
//
// The gallery camera ('tools-lab-view') frames world.state.labCamera; WASD / arrows
// pan it and the mouse wheel zooms. Labels come from world.state.labels.

import * as THREE from 'three/webgpu';
import { define } from '../../core/registry.js';
import { Game } from '../../game.js';
import { h } from '../../ui/shell.js';
import { BODY_PLANS } from '../creatures/genome.js';
import { RARITY_COLORS } from '../progression/text.js';

const view = { pan: new THREE.Vector3(), zoom: 1, world: null };

// --- gallery camera (after the follow camera, so it wins in lab worlds) ----------------------

define( 'renderSystem', { id: 'tools-lab-view', order: 7,
	init( rc ) {

		rc.renderer.domElement.addEventListener( 'wheel', ( e ) => {

			if ( ! rc.world?.state.labCamera ) return;
			view.zoom = Math.min( 4, Math.max( 0.15, view.zoom * Math.exp( e.deltaY * 0.001 ) ) );

		}, { passive: true } );

	},
	update( rc, world, alpha, dt ) {

		const cam = world.kind === 'lab' && world.state.labCamera;
		if ( ! cam ) return;
		if ( view.world !== world ) {

			view.world = world;
			view.pan.set( 0, 0, 0 );
			view.zoom = 1;

		}

		const m = world.input?.move, hgt = cam.height * view.zoom;
		if ( m ) view.pan.set( view.pan.x + m.x * hgt * 0.8 * dt, 0, view.pan.z + m.z * hgt * 0.8 * dt );
		// with the Workshop panel open, look a little left so the grid centres in the free area
		const panel = rc.game?.ui?.isOpen( 'workshop' ) ? Math.min( 400, innerWidth * 0.5 ) : 0;
		const halfW = hgt * 1.22 * Math.tan( THREE.MathUtils.degToRad( rc.camera.fov / 2 ) ) * rc.camera.aspect;
		const x = cam.x + view.pan.x - panel / innerWidth * halfW, z = cam.z + view.pan.z;
		rc.camera.position.set( x, hgt, z + hgt * 0.7 );
		rc.camera.lookAt( x, 0, z );
		rc.sun.position.set( x + 12, 30, z + 8 );
		rc.sun.target.position.set( x, 0, z );

	}
} );

// --- labels: one DOM tag per lab cell, projected every frame ---------------------------------

const _v = new THREE.Vector3();

define( 'uiPanel', { id: 'lab-labels', order: 12,
	mount() {

		this.el = h( 'div', { class: 'lab-tags' } );
		this.world = null;
		this.n = 0;
		return this.el;

	},
	update( ui, game ) {

		const w = game.world, labels = w?.kind === 'lab' ? w.state.labels : null;
		if ( w !== this.world || ( labels?.length ?? 0 ) !== this.n ) {

			this.world = w;
			this.n = labels?.length ?? 0;
			this.el.replaceChildren( ...( labels || [] ).map( ( l ) => h( 'div', { class: 'lab-tag', text: l.text } ) ) );

		}

		if ( ! this.n ) return;
		const cam = game.rc.camera, W = innerWidth, H = innerHeight;
		labels.forEach( ( l, i ) => {

			const e = w.byId.get( l.id );
			_v.set( e ? e.x : l.x, 0, ( e ? e.z : l.z ) + ( e?.radius ?? 0.5 ) + 0.4 ).project( cam );
			const el = this.el.children[ i ];
			const off = _v.z > 1 || Math.abs( _v.x ) > 1.1 || Math.abs( _v.y ) > 1.1;
			el.style.display = off ? 'none' : '';
			if ( ! off ) el.style.transform = `translate(${( _v.x * 0.5 + 0.5 ) * W}px, ${( - _v.y * 0.5 + 0.5 ) * H}px) translate(-50%, 0)`;

		} );

	}
} );

// --- the panel -------------------------------------------------------------------------------

const PLANS = BODY_PLANS.map( ( p ) => p.id || p );

function select( options, value ) {

	const s = h( 'select', {}, options.map( ( o ) => h( 'option', { value: o, text: o || '(any)' } ) ) );
	s.value = value;
	return s;

}

function num( value, min, max, width = 64 ) {

	return h( 'input', { type: 'number', value, min, max, style: { width: width + 'px' } } );

}

define( 'uiPanel', { id: 'workshop', order: 85, toggle: 'workshop', pauseButton: 'Workshop',
	mount( ui ) {

		const game = ui.game;
		this.out = h( 'pre', { class: 'ws-out' } );
		this.loot = h( 'div', { class: 'ws-loot' } );
		const log = ( call, result ) => {

			const n = Array.isArray( result ) ? result.length : 1;
			this.out.textContent = `game.api( '${call[ 0 ]}', ${JSON.stringify( call[ 1 ] )} )\n-> ${n} entr${n === 1 ? 'y' : 'ies'}\n` + JSON.stringify( Array.isArray( result ) ? result.slice( 0, 6 ) : result, null, 1 ).slice( 0, 3000 );

		};

		const run = ( id, args ) => {

			try {

				log( [ id, args ], game.api( id, args ) );

			} catch ( e ) {

				this.out.textContent = `${id}: ${e.message}`;

			}

		};

		const b = ( text, fn, title ) => h( 'button', { text, onclick: fn, title } );
		const gPlan = select( [ '', ...PLANS ], '' ), gN = num( 24, 1, 200 ), gSeed = num( 1, 0, 1e9, 80 );
		const mDepth = num( 0, 0, 9999, 70 ), mN = num( 12, 1, 60 );
		const bDepth = num( 0, 0, 9999, 70 );
		const aPlan = select( [ '', ...PLANS ], '' ), aT = h( 'input', { type: 'range', min: 0, max: 100, value: 50, style: { width: '110px' } } );
		const actions = () => run( 'lab.actions', { plan: aPlan.value || null, t: + aT.value / 100 } );
		aT.addEventListener( 'input', actions );
		const lLevel = num( 40, 1, 100 ), lN = num( 8, 1, 40 ), lRarity = select( [ '', 'normal', 'magic', 'rare', 'unique' ], '' );
		const sFrom = num( 1, 1, 9999 ), sTo = num( 6, 1, 9999 ), sSecs = num( 45, 5, 600 );
		this.simBtn = b( 'Run', () => this.balance( game, + sFrom.value, + sTo.value, + sSecs.value ) );

		const section = ( title, ...rows ) => h( 'div', { class: 'ws-sec' }, h( 'h3', { text: title } ), ...rows );
		const row = ( ...c ) => h( 'div', { class: 'ws-row' }, ...c );
		return h( 'div', { class: 'panel workshop' },
			h( 'div', { class: 'ws-head' }, h( 'h2', { text: 'Workshop' } ), b( '×', () => ui.open( 'workshop', false ), 'Close' ) ),
			h( 'p', { class: 'dim', text: 'Asset galleries, loot and balance tools. Each button is one game.api() call (shown below) - agents drive the same commands headlessly or through the Claude link. WASD pans, wheel zooms.' } ),
			section( 'Galleries',
				row( b( 'Props', () => run( 'lab.models', { tags: [ 'prop' ] } ) ), b( 'Loot', () => run( 'lab.models', { tags: [ 'loot' ], type: 'loot' } ) ), b( 'All models', () => run( 'lab.models', {} ) ) ),
				row( b( 'Genomes', () => run( 'lab.genomes', { n: + gN.value, plan: gPlan.value || null, seed: + gSeed.value } ) ), gPlan, 'n', gN, 'seed', gSeed ),
				row( b( 'Monsters', () => run( 'lab.monsters', { n: + mN.value, depth: + mDepth.value || null } ) ), 'depth', mDepth, 'n', mN ),
				row( b( 'Bosses', () => run( 'lab.bosses', { depth: + bDepth.value || null } ) ), 'depth', bDepth, h( 'span', { class: 'dim', text: '0 = designed' } ) ),
				row( b( 'Actions', actions ), aPlan, 'pose', aT ),
				row( game.creatureLab ? b( 'Creature Lab', () => {

					ui.open( 'workshop', false );
					game.creatureLab.open( {} );

				}, 'Genome editor with turntable, skeleton overlay and contact sheets' ) : null, b( 'Leave lab', () => run( 'lab.clear', {} ) ) ) ),
			section( 'Loot roller', row( b( 'Roll', () => this.roll( game, + lN.value, + lLevel.value, lRarity.value ) ), 'ilvl', lLevel, 'n', lN, lRarity ), this.loot ),
			section( 'Balance (headless sim)', row( this.simBtn, 'depth', sFrom, '-', sTo, 'secs', sSecs ), h( 'div', { class: 'dim', text: 'Plays each depth with the playtest bot in a separate, invisible game. Same numbers as npm run sim.' } ) ),
			this.out );

	},

	roll( game, n, level, rarity ) {

		const items = game.api( 'loot.roll', { n, level, rarity: rarity || undefined, seed: 'ws' + Math.floor( Math.random() * 1e6 ) } );
		this.loot.replaceChildren( ...items.map( ( it ) => {

			const lines = [ ...( it.properties || [] ).map( ( [ k, v ] ) => `${k}: ${v}` ), ...( it.implicits || [] ), ...( it.explicits || [] ), it.mechanic ].filter( Boolean );
			return h( 'div', { class: 'ws-item' },
				h( 'b', { text: it.name, style: { color: RARITY_COLORS[ it.rarity ] || '#ddd' } } ), h( 'span', { class: 'dim', text: ` ${it.baseName !== it.name ? it.baseName + ' · ' : ''}${it.slotName} · ilvl ${it.ilvl}` } ),
				...lines.map( ( l ) => h( 'div', { class: 'ws-line', text: l } ) ) );

		} ) );

	},

	// One depth per timer tick so the page keeps drawing while the table fills in.
	balance( game, from, to, seconds ) {

		if ( this.running ) return;
		this.running = true;
		this.simBtn.disabled = true;
		const rows = [];
		const print = () => {

			const cols = [ 'depth', 'name', 'lvl', 'secs', 'kills', 'dps', 'taken', 'left', 'done' ];
			this.out.textContent = `headless sim, ${seconds} s per depth\n` + cols.map( ( c ) => c.padEnd( c === 'name' ? 16 : 6 ) ).join( '' ) + '\n' +
				rows.map( ( r ) => cols.map( ( c ) => String( r[ c ] ).slice( 0, c === 'name' ? 15 : 6 ).padEnd( c === 'name' ? 16 : 6 ) ).join( '' ) ).join( '\n' );

		};

		let depth = from;
		const next = () => {

			if ( depth > to || ! this.running ) {

				this.running = false;
				this.simBtn.disabled = false;
				return;

			}

			rows.push( simDepth( game, depth, seconds ) );
			print();
			depth ++;
			setTimeout( next, 0 );

		};

		next();

	},

	onClose() {

		this.running = false;

	}
} );

export function simDepth( game, depth, seconds ) {

	const g = new Game( { seed: `${game.seed}:ws:${depth}`, headless: true } );
	g.save.level = Math.max( 1, depth * 2 - 1 );
	g.applyPlayerStats();
	const w = g.enterLevel( depth );
	const bot = g.api( 'bot.create', {} );
	let t = 0;
	while ( t < seconds && w.player.alive && ! w.state.complete ) {

		bot.step( 1 / 60 );
		g.update( 1 / 60 );
		t += 1 / 60;

	}

	const s = w.describe();
	return { depth, name: s.spec?.name ?? '?', lvl: s.level, secs: t.toFixed( 0 ), kills: s.stats.kills, dps: Math.round( s.stats.damageDealt / Math.max( 1, t ) ), taken: Math.round( s.stats.damageTaken ), left: s.entities, done: w.state.complete ? 'yes' : w.player.alive ? 'no' : 'died' };

}

define( 'bootHook', { id: 'tools-workshop', order: 70,
	boot( { game, ui, opts } ) {

		document.head.append( h( 'style', { text: CSS } ) );
		game.workshop = { open: () => ui.open( 'workshop', true ), simDepth: ( d, s = 45 ) => simDepth( game, d, s ) };
		if ( opts.lab === 'workshop' ) {

			game.enterTown();
			ui.open( 'workshop', true );

		}

	}
} );

const CSS = `
.workshop { position: absolute; left: 10px; top: 10px; bottom: 10px; width: min(380px, calc(100vw - 20px)); overflow-y: auto; font-size: 12px; display: flex; flex-direction: column; gap: 4px; }
.workshop .ws-head { display: flex; justify-content: space-between; align-items: center; }
.workshop h2 { margin: 0; font-size: 16px; }
.workshop h3 { margin: 6px 0 2px; font-size: 12px; color: var(--accent); text-transform: uppercase; letter-spacing: 0.05em; }
.ws-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 3px 0; }
.ws-out { white-space: pre; overflow-x: auto; font-size: 11px; background: rgba(0,0,0,0.35); padding: 6px; border-radius: 6px; min-height: 40px; margin: 6px 0 0; }
.ws-loot { display: grid; gap: 6px; }
.ws-item { background: rgba(0,0,0,0.35); border: 1px solid var(--line); border-radius: 6px; padding: 4px 6px; }
.ws-line { color: #9fb4ff; font-size: 11px; }
.lab-tags { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.lab-tag { position: absolute; left: 0; top: 0; font-size: 11px; font-weight: 600; padding: 1px 5px; border-radius: 4px; background: rgba(0,0,0,0.55); white-space: nowrap; text-shadow: 0 1px 2px #000; }
`;
