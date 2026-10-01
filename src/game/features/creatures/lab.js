// Creature Lab - the Workshop tool for the creatures feature. Open it with the URL
// hash #lab=creature (optionally &sheet=24&kind=creature&seed=abc&plan=quadruped)
// or the "Creature Lab" button in the pause menu corner.
//
//   genome editor     plan, skeleton sliders, part slots, palette, pattern, size
//   randomize / mutate / breed (parent B), export / import genome JSON
//   live preview      turntable camera, skeleton overlay, play any state or action
//                     (looping, or frozen at a phase for inspection)
//   contact sheets    a labelled grid of N seeded monsters (all plans), the hero's
//                     actions, NPC emotes, props or loot - for screenshots and AI review
//
// Plain functions exported for the tools feature / agent API:
//   openLab( game, rc, opts ), closeLab( game ), contactSheet( game, { kind, n, seed, plan, action, phase, t } ),
//   labShow( game, { model | genome, state, action, variant, speed, t } ), labState()
//
// The lab runs in its own GameWorld (kind 'lab', no player) that the simulation
// does not step: a small DRIVER plays the animation contract on each preview entity
// exactly like the sim would (state, action, phase, t, seq, speed, hitTime...).

import * as THREE from 'three/webgpu';
import { define, get, all } from '../../core/registry.js';
import { GameWorld } from '../../core/world.js';
import { Entity } from '../../core/entity.js';
import { makeArena } from '../../core/layout.js';
import { RNG, hashStr } from '../../core/rng.js';
import { TEAM } from '../../core/tuning.js';
import { h } from '../../ui/shell.js';
import { generateGenome, mutateGenome, crossGenomes, validateGenome, describeGenome, genomeMetrics, BODY_PLANS, SLOTS, PATTERNS, partChoices } from './genome.js';
import { harmonyPalette } from './palettes.js';
import { templateFor } from './models.js';

export const HUMANOID_ACTIONS = [ 'slash', 'thrust', 'overhead', 'spin', 'slam', 'leap', 'dash', 'cast', 'cast_aoe', 'channel', 'shoot', 'throw', 'shout', 'block', 'kick', 'drink' ];
export const CREATURE_ACTIONS_LIST = [ 'bite', 'claw', 'slam', 'charge', 'spit', 'roar', 'stomp', 'tail', 'leap', 'cast', 'summon', 'burrow', 'breath' ];
export const EMOTE_LIST = [ 'hammer', 'sweep', 'talk', 'wave', 'count', 'meditate', 'idle_look' ];
export const STATES = [ 'idle', 'move', 'action', 'dodge', 'hit', 'stun', 'dead', 'spawn' ];
const PHASES = { windup: 0.2, active: 0.45, recovery: 0.8 };

const lab = {
	open: false, game: null, rc: null, world: null, prevWorld: null,
	mode: 'single', genome: null, parentB: null, model: null,
	entities: [], labels: [], drive: { state: 'idle', action: 'bite', variant: 0, speed: 4, freeze: null, duration: 0.8 },
	turntable: true, skeleton: false, camAngle: 0.6, camDist: 6, camTarget: new THREE.Vector3( 0, 0.8, 0 ), camHeight: 0.55,
	ui: null, bones: null
};

export function labState() {

	return { open: lab.open, mode: lab.mode, genome: lab.genome, drive: { ...lab.drive }, entities: lab.entities.length, metrics: lab.genome ? genomeMetrics( lab.genome ) : null };

}

// --- world ---------------------------------------------------------------------------------

export function openLab( game, rc, opts = {} ) {

	if ( ! lab.open ) lab.prevWorld = game.world;
	lab.open = true; lab.game = game; lab.rc = rc;
	const world = new GameWorld( { seed: 'creature-lab', layout: makeArena( 40, 40 ), kind: 'lab', level: 1, spec: { id: 'lab', name: 'Creature Lab' } } );
	world.game = game;
	world.input = game.input;
	world.init();
	lab.world = world;
	game.world = world;
	game.mode = 'lab';
	game.paused = true;
	rc.setWorld( world );
	game.ui?.open( 'creature-lab', true );
	game.ui?.root.classList.add( 'lab-active' );
	const seed = opts.seed ?? 'lab';
	if ( opts.sheet ) contactSheet( game, { kind: opts.kind || 'creature', n: + opts.sheet || 24, seed, plan: opts.plan, action: opts.action, phase: opts.phase } );
	else if ( opts.genome ) labShow( game, { genome: typeof opts.genome === 'string' ? JSON.parse( opts.genome ) : opts.genome } );
	else labShow( game, { genome: generateGenome( new RNG( hashStr( String( seed ) ) ), { plan: opts.plan || null } ) } );
	lab.ui?.sync();
	return world;

}

export function closeLab( game = lab.game ) {

	if ( ! lab.open ) return;
	lab.open = false;
	clearEntities();
	game.ui?.open( 'creature-lab', false );
	game.ui?.root.classList.remove( 'lab-active' );
	game.paused = false;
	lab.world = null;
	game.enterTown();

}

function clearEntities() {

	for ( const e of lab.entities ) lab.world?.remove( e );
	lab.entities = [];
	for ( const l of lab.labels ) l.el.remove();
	lab.labels = [];

}

function addEntity( model, x, z, label = null, drive = null ) {

	const e = new Entity( { kind: model.type === 'creature' || model.type === 'hero' ? 'monster' : model.type, team: TEAM.NEUTRAL, x, z, facing: lab.mode === 'sheet' ? lab.sheetFacing : 0 } );
	e.model = model;
	e.solid = false;
	e.data.drive = drive || lab.drive;
	e.data.clock = 0;
	e.data.label = label;
	if ( model.type === 'creature' ) {

		const m = genomeMetrics( model.genome );
		e.radius = m.radius; e.height = m.height;

	}

	lab.world.add( e );
	// heroes keep kind 'player' for the animator, without becoming world.player
	if ( model.type === 'hero' ) e.kind = 'player';
	lab.entities.push( e );
	if ( label && lab.labelRoot ) {

		const el = h( 'div', { class: 'lab-label', text: label } );
		lab.labelRoot.append( el );
		lab.labels.push( { e, el } );

	}

	return e;

}

// Show one model (genome or any model def) in the single-subject preview.
export function labShow( game, { model = null, genome = null, state, action, variant, speed, t } = {} ) {

	if ( ! lab.open ) openLab( game, game.rc );
	clearEntities();
	lab.mode = 'single';
	if ( genome ) {

		lab.genome = validateGenome( genome );
		model = { type: 'creature', genome: lab.genome };

	}

	lab.model = model || { type: 'creature', genome: lab.genome };
	if ( lab.model.type !== 'creature' ) lab.genome = null;
	if ( state ) lab.drive.state = state;
	if ( action ) lab.drive.action = action;
	if ( variant !== undefined ) lab.drive.variant = variant;
	if ( speed !== undefined ) lab.drive.speed = speed;
	lab.drive.freeze = t ?? null;
	addEntity( lab.model, 0, 0 );
	const { T } = templateFor( lab.model );
	const s = ( lab.genome?.size ?? 1 ) * ( lab.model.scale ?? 1 );
	const r = Math.max( T.dims.height, T.dims.length, T.dims.width ) * s;
	lab.camTarget.set( 0, T.dims.height * s * 0.45, 0 );
	lab.camDist = 1.6 + r * 2.1;
	lab.camHeight = 0.5;
	lab.ui?.sync();
	return labState();

}

// A labelled grid. kind: 'creature' (n genomes cycling through every body plan),
// 'hero' (every humanoid action), 'npc' (NPCs and their emotes), 'prop', 'loot',
// 'weapon'. Returns the labels in grid order (row-major) for AI inspection.
export function contactSheet( game, { kind = 'creature', n = 24, seed = 'sheet', plan = null, action = null, phase = null, t = null, facing = 0.75, strip = {}, drive = null, normalize = true } = {} ) {

	if ( ! lab.open ) openLab( game, game.rc );
	clearEntities();
	lab.mode = 'sheet';
	lab.sheetFacing = facing;
	const items = [];
	const freeze = t ?? ( phase ? PHASES[ phase ] : null );
	if ( kind === 'creature' ) {

		const rng = new RNG( hashStr( String( seed ) ) );
		for ( let i = 0; i < n; i ++ ) {

			const g = generateGenome( rng, { plan: plan || BODY_PLANS[ i % BODY_PLANS.length ] } );
			// sheets show every body at a comparable size (labels keep the real numbers)
			const { T } = templateFor( { type: 'creature', genome: g } );
			const scale = normalize ? Math.max( 0.6, Math.min( 2.2, 1.7 / Math.max( T.dims.height, T.dims.length, T.dims.width ) ) ) : 1;
			items.push( { model: { type: 'creature', genome: g, scale }, label: `${i + 1} ${describeGenome( g )}`, drive: action ? { state: 'action', action, variant: 0, freeze, duration: 0.9 } : { state: 'idle' } } );

		}

	} else if ( kind === 'hero' ) {

		const weapon = { base: plan || 'sword', rarity: 'rare' };
		const acts = action ? [ action ] : [ 'idle', 'move', ...HUMANOID_ACTIONS, 'dodge', 'hit', 'stun', 'dead' ];
		for ( const a of acts.slice( 0, n ) ) {

			const st = STATES.includes( a ) ? a : 'action';
			items.push( { model: { type: 'hero', id: 'reaver', weapon }, label: a, drive: { state: st, action: a, variant: 0, speed: 6.5, freeze, duration: 0.7 } } );

		}

		if ( ! action ) for ( const v of [ 1, 2 ] ) items.push( { model: { type: 'hero', id: 'reaver', weapon }, label: 'slash v' + v, drive: { state: 'action', action: 'slash', variant: v, freeze, duration: 0.6 } } );

	} else if ( kind === 'weapons' ) {

		for ( const w of all( 'model' ).filter( ( d ) => d.type === 'weapon' ) ) items.push( { model: { type: 'hero', id: 'reaver', weapon: { base: w.id, rarity: 'unique' } }, label: w.id, drive: { state: action ? 'action' : 'idle', action: action || 'slash', freeze, duration: 0.7 } } );

	} else if ( kind === 'npc' ) {

		const npcs = [ 'blacksmith', 'merchant', 'mystic', 'guard' ];
		for ( const id of npcs ) items.push( { model: { type: 'npc', id }, label: id, drive: { state: 'idle' } } );
		for ( let i = 0; i < Math.max( 4, n - 4 - EMOTE_LIST.length ); i ++ ) items.push( { model: { type: 'npc', id: 'townsfolk', seed: i + 1 }, label: 'townsfolk ' + ( i + 1 ), drive: { state: 'idle' } } );
		for ( const em of EMOTE_LIST ) items.push( { model: { type: 'npc', id: 'townsfolk', seed: 40 + em.length }, label: 'emote ' + em, drive: { state: 'action', action: em, duration: 2.5 } } );

	} else {

		for ( const d of all( 'model' ).filter( ( m ) => m.type === kind ) ) items.push( { model: { type: kind, id: d.id, state: d.id === 'chest' || d.id === 'stash' || d.id === 'door' ? 'open' : d.id === 'spike-trap' ? 'up' : undefined, rarity: kind === 'loot' ? 'rare' : undefined }, label: d.id, drive: { state: 'idle' } } );
		if ( kind === 'loot' ) for ( const w of [ 'sword', 'axe', 'staff', 'bow' ] ) items.push( { model: { type: 'loot', id: 'weapon-' + w, rarity: 'unique' }, label: 'weapon-' + w, drive: { state: 'idle' } } );

	}

	if ( kind === 'actions' ) {

		// one genome performing every creature verb (frozen at `phase`, default active)
		const g = strip.genome || generateGenome( new RNG( hashStr( String( seed ) ) ), { plan: plan || null } );
		const fz = freeze ?? 0.45;
		const model = { type: 'creature', genome: g };
		for ( const a of [ ...CREATURE_ACTIONS_LIST, 'idle', 'move', 'hit', 'stun', 'dead', 'dodge' ] ) {

			const st = STATES.includes( a ) ? a : 'action';
			items.push( { model, label: a, drive: { state: st, action: a, variant: 0, fixedVariant: true, freeze: st === 'idle' || st === 'move' || st === 'stun' ? null : st === 'dead' ? 0.6 : fz, speed: 4, duration: 0.9 } } );

		}

	}

	if ( kind === 'strip' ) {

		// one action frozen at several points of its timeline (pose tuning)
		items.length = 0;
		const model = strip.model || { type: 'hero', id: 'reaver', weapon: { base: plan || 'sword', rarity: 'rare' } };
		const ts = strip.ts || [ 0.05, 0.2, 0.32, 0.4, 0.5, 0.65, 0.8, 0.95 ];
		const st = STATES.includes( action ) ? action : 'action';
		for ( const tt of ts ) items.push( { model, label: `${action}${strip.variant ? ' v' + strip.variant : ''} t=${tt}`, drive: { state: st, action, variant: strip.variant || 0, fixedVariant: true, freeze: tt, duration: 0.7 } } );

	}

	// grid sized from the biggest body
	let cell = 2.2;
	for ( const it of items ) {

		const { T } = templateFor( it.model );
		const s = ( it.model.genome?.size ?? 1 ) * ( it.model.scale ?? 1 );
		cell = Math.max( cell, Math.max( T.dims.width, T.dims.length ) * s * 1.05 + 0.6 );

	}

	if ( kind === 'strip' ) cell = Math.max( 1.5, cell * 0.75 );
	const cols = kind === 'strip' ? items.length : Math.ceil( Math.sqrt( items.length * 1.5 ) ), rows = Math.ceil( items.length / cols );
	items.forEach( ( it, i ) => {

		const cx = ( i % cols - ( cols - 1 ) / 2 ) * cell, cz = ( Math.floor( i / cols ) - ( rows - 1 ) / 2 ) * cell * 0.95;
		addEntity( it.model, cx, cz, it.label, { state: 'idle', action: 'bite', variant: 0, speed: 4, duration: 0.8, ...it.drive, ...( drive || {} ) } );

	} );
	lab.camTarget.set( 0, kind === 'strip' ? 0.8 : 0, cell * 0.1 );
	lab.camDist = kind === 'strip' ? cols * cell * 0.8 : Math.max( cols * cell * 0.92, rows * cell * 1.2 ) + 1;
	lab.camHeight = kind === 'strip' ? 0.35 : 0.85;
	lab.turntable = false;
	lab.camAngle = 0;
	lab.ui?.sync();
	return { kind, count: items.length, cols, labels: items.map( ( it ) => it.label ) };

}

// --- driver: plays the animation contract on lab entities ---------------------------------------

function drive( e, dt, world ) {

	const d = e.data.drive, a = e.anim;
	e.data.clock += dt;
	const c = e.data.clock;
	const alive = d.state !== 'dead';
	if ( ! alive && e.alive ) {

		e.alive = false; a.state = 'dead'; a.seq ++; e.data.deadAt = c;

	}

	if ( alive && ! e.alive ) {

		e.alive = true; a.state = 'spawn'; e.data.deadAt = - 1;

	}

	e.vx = 0; e.vz = 0;
	a.speed = 0;
	a.aimX = e.x + Math.sin( e.facing ) * 4; a.aimZ = e.z + Math.cos( e.facing ) * 4;
	switch ( d.state ) {

		case 'move':
			a.state = 'move'; a.speed = d.speed;
			e.vx = Math.sin( e.facing ) * d.speed; e.vz = Math.cos( e.facing ) * d.speed;
			break;
		case 'action': {

			const dur = d.duration || 0.8, cyc = dur + 0.45;
			const k = Math.floor( c / cyc ), u = d.freeze ?? ( c % cyc ) / dur;
			if ( a.state !== 'action' || e.data.k !== k ) {

				e.data.k = k;
				a.seq ++;

			}

			if ( u > 1 ) {

				a.state = 'idle'; a.action = null; a.phase = null;

			} else {

				a.state = 'action'; a.action = d.action; a.t = Math.min( 1, u ); a.duration = dur;
				const w = d.action === 'slash' ? 0.3 : 0.4, ac = d.action === 'slash' ? 0.55 : 0.62;
				a.phase = a.t < w ? 'windup' : a.t < ac ? 'active' : 'recovery';
				a.variant = d.variant ?? 0;
				if ( d.action === 'slash' && d.freeze == null && ! d.fixedVariant ) a.variant = ( d.variant + k ) % 3;

			}

			break;

		}

		case 'dodge': {

			if ( d.freeze != null ) break;
			const k = Math.floor( c / 0.9 );
			if ( e.data.k !== k ) {

				e.data.k = k; a.seq ++;

			}

			a.state = ( c % 0.9 ) < 0.3 ? 'dodge' : 'idle';
			if ( a.state === 'dodge' ) {

				e.vx = Math.sin( e.facing ) * 16; e.vz = Math.cos( e.facing ) * 16;

			}

			break;

		}

		case 'hit': {

			const k = Math.floor( c / 0.8 );
			if ( e.data.k !== k ) {

				e.data.k = k;
				const ang = k * 2.1;
				a.hitTime = world.time; a.hitDirX = Math.sin( ang ); a.hitDirZ = Math.cos( ang );

			}

			a.state = world.time - a.hitTime < 0.18 ? 'hit' : 'idle';
			break;

		}

		case 'stun': a.state = 'stun'; break;
		case 'dead': {

			a.state = 'dead';
			a.t = Math.min( 1, ( c - ( e.data.deadAt ?? 0 ) ) / 1.2 );
			if ( c - ( e.data.deadAt ?? 0 ) > 3.6 && d.freeze == null ) {

				// revive and die again so the death plays on a loop
				e.alive = true; a.state = 'spawn'; e.data.deadAt = c + 0.7;
				setTimeout( () => {

					if ( e.data.drive.state === 'dead' ) {

						e.alive = false; a.state = 'dead'; a.seq ++; e.data.deadAt = e.data.clock;

					}

				}, 700 );

			}

			break;

		}

		case 'spawn': {

			const u = ( c % 1.4 ) / 0.6;
			a.state = u <= 1 ? 'spawn' : 'idle'; a.t = Math.min( 1, u );
			break;

		}

		default: a.state = 'idle'; a.action = null;

	}

	if ( d.freeze != null && d.state === 'dead' ) a.t = d.freeze;
	// frozen reactions: dodge / death / hit run on the animator's own clock, so the
	// lab sets that clock directly (lab only - the sim never touches rig instances)
	if ( d.freeze != null ) {

		const inst = lab.rc?.rigs?.insts.get( e.id );
		if ( d.state === 'dodge' ) {

			// the animator adds this frame's dt after us: pre-compensate
			a.state = 'dodge';
			if ( inst ) inst.stateTime = d.freeze * 0.3 - dt;

		} else if ( d.state === 'dead' && inst ) inst.stateTime = d.freeze * 1.3 - dt;
		else if ( d.state === 'hit' ) {

			a.hitTime = world.time - d.freeze * 0.45; a.hitDirX = 0; a.hitDirZ = - 1; a.state = 'hit';

		}

	}

}

// --- render system: driver, camera, labels, skeleton overlay -------------------------------------

const _v = new THREE.Vector3();

define( 'renderSystem', { id: 'creature-lab', order: 19,
	init( rc ) {

		const geo = new THREE.BufferGeometry();
		geo.setAttribute( 'position', new THREE.BufferAttribute( new Float32Array( 6 * 4096 ), 3 ) );
		const mat = new THREE.LineBasicNodeMaterial( { color: 0x7fffd4, depthTest: false, transparent: true } );
		const lines = new THREE.LineSegments( geo, mat );
		lines.frustumCulled = false;
		lines.renderOrder = 10;
		lines.visible = false;
		rc.scene.add( lines );
		lab.bones = lines;
		lab.rc = rc;

	},
	update( rc, world, alpha, dt ) {

		if ( ! lab.open || world !== lab.world ) {

			lab.bones.visible = false;
			return;

		}

		lab.game.paused = true;
		world.time += dt;
		for ( const e of lab.entities ) drive( e, dt, world );
		// camera: turntable orbit around the subject (or a fixed view over a sheet)
		if ( lab.turntable ) lab.camAngle += dt * 0.35;
		const t = lab.camTarget, d = lab.camDist;
		rc.camera.position.set( t.x + Math.sin( lab.camAngle ) * d * Math.cos( lab.camHeight ), t.y + Math.sin( lab.camHeight ) * d, t.z + Math.cos( lab.camAngle ) * d * Math.cos( lab.camHeight ) );
		rc.camera.lookAt( t );
		rc.sun.position.set( t.x + 12, 30, t.z + 8 );
		rc.sun.target.position.copy( t );
		// labels follow their entity (projected to the screen)
		const w = innerWidth, hh = innerHeight;
		for ( const { e, el } of lab.labels ) {

			_v.set( e.x, - 0.1, e.z + 0.3 ).project( rc.camera );
			el.style.transform = `translate(${( _v.x * 0.5 + 0.5 ) * w}px, ${( - _v.y * 0.5 + 0.5 ) * hh}px) translate(-50%, 0)`;

		}

	}
} );

// Skeleton overlay runs after the rigs pass so it sees this frame's bones.
define( 'renderSystem', { id: 'creature-lab-bones', order: 21,
	update( rc, world ) {

		const L = lab.bones;
		if ( ! lab.open || ! lab.skeleton || world !== lab.world ) {

			if ( L ) L.visible = false;
			return;

		}

		const arr = L.geometry.attributes.position.array;
		let n = 0;
		for ( const e of lab.entities ) {

			const inst = rc.rigs?.insts.get( e.id );
			if ( ! inst ) continue;
			const T = inst.T, W = inst.W;
			for ( let b = 1; b < T.nb && n < 4090; b ++ ) {

				const p = T.parent[ b ];
				arr[ n * 6 ] = W[ p * 12 + 9 ]; arr[ n * 6 + 1 ] = W[ p * 12 + 10 ]; arr[ n * 6 + 2 ] = W[ p * 12 + 11 ];
				arr[ n * 6 + 3 ] = W[ b * 12 + 9 ]; arr[ n * 6 + 4 ] = W[ b * 12 + 10 ]; arr[ n * 6 + 5 ] = W[ b * 12 + 11 ];
				n ++;

			}

		}

		L.geometry.setDrawRange( 0, n * 2 );
		L.geometry.attributes.position.needsUpdate = true;
		L.visible = true;

	}
} );

// --- UI ---------------------------------------------------------------------------------------------

const CSS = `
.lab-panel { position: absolute; left: 10px; top: 10px; bottom: 10px; width: 300px; overflow-y: auto; font-size: 12px; display: flex; flex-direction: column; gap: 6px; }
.lab-panel h2 { font-size: 15px; margin: 0; }
.lab-panel h3 { font-size: 12px; margin: 6px 0 0; color: var(--accent); text-transform: uppercase; letter-spacing: 0.05em; }
.lab-row { display: flex; align-items: center; gap: 6px; }
.lab-row > span:first-child { width: 78px; color: var(--dim); flex: none; }
.lab-row input[type=range] { flex: 1; min-width: 0; }
.lab-row select { flex: 1; min-width: 0; }
.lab-btns { display: flex; flex-wrap: wrap; gap: 4px; }
.lab-btns button { padding: 3px 8px; font-size: 12px; }
.lab-btns button.on { border-color: var(--accent); color: var(--accent); }
.lab-panel textarea { width: 100%; height: 90px; font: 10px monospace; background: var(--field); color: var(--fg); border: 1px solid var(--field-line); border-radius: 6px; }
.lab-labels { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.lab-label { position: absolute; left: 0; top: 0; font: 10px system-ui; color: #fff; background: rgba(0,0,0,0.55); padding: 1px 4px; border-radius: 4px; white-space: nowrap; max-width: 190px; overflow: hidden; text-overflow: ellipsis; }
.lab-info { color: var(--dim); font-size: 11px; white-space: pre-wrap; }
.lab-open-btn { position: absolute; right: 10px; bottom: 10px; font-size: 12px; }
.lab-active .hud { display: none; }
`;

define( 'uiPanel', { id: 'creature-lab', order: 85, toggle: 'creature-lab',
	mount( ui ) {

		document.head.append( h( 'style', { text: CSS } ) );
		const game = ui.game;
		const labels = h( 'div', { class: 'lab-labels' } );
		lab.labelRoot = labels;
		const body = h( 'div', { class: 'lab-body' } );
		const info = h( 'div', { class: 'lab-info' } );
		const json = h( 'textarea', { spellcheck: 'false' } );
		const btn = ( text, fn, cls = '' ) => h( 'button', { text, onclick: fn, class: cls } );
		const sel = ( options, value, onchange ) => {

			const s = h( 'select', { onchange: () => onchange( s.value ) } );
			for ( const o of options ) s.append( h( 'option', { value: o, text: o } ) );
			s.value = value;
			return s;

		};

		const rng = () => new RNG( ( Math.random() * 2 ** 31 ) >>> 0 );
		const apply = ( g ) => labShow( game, { genome: g } );
		let mutateAmt = 0.25;

		const rebuild = () => {

			body.textContent = '';
			const g = lab.genome;
			const d = lab.drive;
			// subject
			body.append( h( 'h3', { text: 'Subject' } ) );
			const kinds = [ 'creature', 'hero', 'npc', 'prop', 'loot' ];
			const kind = lab.model?.type || 'creature';
			body.append( h( 'div', { class: 'lab-row' }, h( 'span', { text: 'type' } ), sel( kinds, kind, ( v ) => {

				if ( v === 'creature' ) apply( generateGenome( rng() ) );
				else if ( v === 'hero' ) labShow( game, { model: { type: 'hero', id: 'reaver', weapon: { base: 'sword', rarity: 'rare' } } } );
				else {

					const first = all( 'model' ).find( ( m ) => m.type === v );
					labShow( game, { model: { type: v, id: first?.id } } );

				}

			} ) ) );
			if ( kind === 'hero' ) {

				const ws = all( 'model' ).filter( ( m ) => m.type === 'weapon' ).map( ( m ) => m.id.replace( 'weapon-', '' ) );
				const cur = lab.model.weapon?.base || 'sword';
				body.append( h( 'div', { class: 'lab-row' }, h( 'span', { text: 'weapon' } ), sel( ws, cur, ( v ) => labShow( game, { model: { ...lab.model, weapon: { ...lab.model.weapon, base: v } } } ) ) ) );
				body.append( h( 'div', { class: 'lab-row' }, h( 'span', { text: 'rarity' } ), sel( [ 'normal', 'magic', 'rare', 'unique', 'set' ], lab.model.weapon?.rarity || 'normal', ( v ) => labShow( game, { model: { ...lab.model, weapon: { ...lab.model.weapon, rarity: v } } } ) ) ) );

			} else if ( kind !== 'creature' ) {

				const ids = all( 'model' ).filter( ( m ) => m.type === kind ).map( ( m ) => m.id );
				body.append( h( 'div', { class: 'lab-row' }, h( 'span', { text: 'model' } ), sel( ids, lab.model.id, ( v ) => labShow( game, { model: { type: kind, id: v, seed: 1 } } ) ) ) );

			}

			if ( g ) {

				const planDef = get( 'bodyPlan', g.plan );
				body.append( h( 'h3', { text: 'Genome' } ) );
				body.append( h( 'div', { class: 'lab-row' }, h( 'span', { text: 'plan' } ), sel( BODY_PLANS, g.plan, ( v ) => apply( generateGenome( new RNG( g.seed ), { plan: v, palette: g.palette } ) ) ) ) );
				const slider = ( label, min, max, value, step, onset ) => {

					const out = h( 'span', { text: value.toFixed( 2 ) } );
					const r = h( 'input', { type: 'range', min, max, step, value, oninput: () => {

						out.textContent = ( + r.value ).toFixed( 2 );

					}, onchange: () => onset( + r.value ) } );
					return h( 'div', { class: 'lab-row' }, h( 'span', { text: label } ), r, out );

				};

				body.append( slider( 'size', 0.4, 4, g.size, 0.05, ( v ) => apply( { ...g, size: v } ) ) );
				for ( const [ k, [ a, b ] ] of Object.entries( planDef.params ) ) body.append( slider( k, a, b, g.body[ k ], ( b - a ) / 100, ( v ) => apply( { ...g, body: { ...g.body, [ k ]: v } } ) ) );
				for ( const slot of SLOTS ) {

					if ( slot === 'extra' || ! ( planDef.slots[ slot ] > 0 ) ) continue;
					const opts = [ 'none', ...partChoices( g.plan, slot ).map( ( c ) => c.d.id ) ];
					body.append( h( 'div', { class: 'lab-row' }, h( 'span', { text: slot } ), sel( opts, g.parts[ slot ]?.id || 'none', ( v ) => apply( { ...g, parts: { ...g.parts, [ slot ]: v === 'none' ? null : { id: v, s: 1, v: 0 } } } ) ) ) );

				}

				const extras = [ 'none', ...partChoices( g.plan, 'extra' ).map( ( c ) => c.d.id ) ];
				body.append( h( 'div', { class: 'lab-row' }, h( 'span', { text: 'extra' } ), sel( extras, g.parts.extra[ 0 ]?.id || 'none', ( v ) => apply( { ...g, parts: { ...g.parts, extra: v === 'none' ? [] : [ { id: v, s: 1, v: 0 } ] } } ) ) ) );
				const pals = [ 'random harmony', ...all( 'palette' ).map( ( p ) => p.id ) ];
				body.append( h( 'div', { class: 'lab-row' }, h( 'span', { text: 'palette' } ), sel( pals, all( 'palette' ).some( ( p ) => p.id === g.palette.id ) ? g.palette.id : 'random harmony', ( v ) => {

					const P = v === 'random harmony' ? harmonyPalette( rng() ) : { ...get( 'palette', v ) };
					apply( { ...g, palette: P } );

				} ) ) );
				body.append( h( 'div', { class: 'lab-row' }, h( 'span', { text: 'pattern' } ), sel( [ ...new Set( PATTERNS ) ], g.pattern, ( v ) => apply( { ...g, pattern: v } ) ) ) );
				body.append( h( 'div', { class: 'lab-btns' },
					btn( 'Randomize', () => apply( generateGenome( rng(), { plan: null } ) ) ),
					btn( 'Same plan', () => apply( generateGenome( rng(), { plan: g.plan } ) ) ),
					btn( 'Mutate', () => apply( mutateGenome( g, rng(), mutateAmt ) ) ),
					btn( 'Set parent B', () => {

						lab.parentB = g;
						rebuild();

					} ),
					btn( lab.parentB ? 'Breed with B' : 'Breed (random B)', () => apply( crossGenomes( g, lab.parentB || generateGenome( rng() ), rng() ) ) ) ) );
				body.append( slider( 'mutation', 0.05, 1, mutateAmt, 0.05, ( v ) => ( mutateAmt = v ) ) );

			}

			// animation
			body.append( h( 'h3', { text: 'Animation' } ) );
			body.append( h( 'div', { class: 'lab-btns' }, STATES.map( ( s ) => btn( s, () => {

				d.state = s;
				rebuild();

			}, d.state === s ? 'on' : '' ) ) ) );
			const acts = kind === 'creature' ? CREATURE_ACTIONS_LIST : [ ...HUMANOID_ACTIONS, ...CREATURE_ACTIONS_LIST, ...EMOTE_LIST ];
			body.append( h( 'div', { class: 'lab-row' }, h( 'span', { text: 'action' } ), sel( [ ...new Set( acts ) ], d.action, ( v ) => {

				d.action = v; d.state = 'action';
				rebuild();

			} ) ) );
			const num = ( label, min, max, value, step, onset ) => {

				const r = h( 'input', { type: 'range', min, max, step, value, oninput: () => onset( + r.value ) } );
				return h( 'div', { class: 'lab-row' }, h( 'span', { text: label } ), r );

			};

			body.append( num( 'variant', 0, 2, d.variant, 1, ( v ) => ( d.variant = v ) ) );
			body.append( num( 'speed m/s', 0, 10, d.speed, 0.1, ( v ) => ( d.speed = v ) ) );
			body.append( num( 'duration', 0.3, 3, d.duration, 0.05, ( v ) => ( d.duration = v ) ) );
			body.append( h( 'div', { class: 'lab-btns' },
				btn( d.freeze == null ? 'Freeze' : 'Play', () => {

					d.freeze = d.freeze == null ? 0.45 : null;
					rebuild();

				} ) ) );
			if ( d.freeze != null ) body.append( num( 't', 0, 1, d.freeze, 0.01, ( v ) => ( d.freeze = v ) ) );
			// view
			body.append( h( 'h3', { text: 'View' } ) );
			body.append( h( 'div', { class: 'lab-btns' },
				btn( 'Turntable', () => {

					lab.turntable = ! lab.turntable;
					rebuild();

				}, lab.turntable ? 'on' : '' ),
				btn( 'Skeleton', () => {

					lab.skeleton = ! lab.skeleton;
					rebuild();

				}, lab.skeleton ? 'on' : '' ),
				btn( 'Sheet 24', () => contactSheet( game, { kind: 'creature', n: 24, seed: Math.random().toString( 36 ).slice( 2 ) } ) ),
				btn( 'Hero sheet', () => contactSheet( game, { kind: 'hero' } ) ),
				btn( 'NPCs', () => contactSheet( game, { kind: 'npc', n: 16 } ) ),
				btn( 'Props', () => contactSheet( game, { kind: 'prop' } ) ),
				btn( 'Loot', () => contactSheet( game, { kind: 'loot' } ) ) ) );
			// import / export
			body.append( h( 'h3', { text: 'Genome JSON' } ) );
			json.value = g ? JSON.stringify( g ) : '';
			body.append( json, h( 'div', { class: 'lab-btns' },
				btn( 'Import', () => {

					try {

						apply( JSON.parse( json.value ) );

					} catch ( err ) {

						ui.toast( 'Bad genome JSON: ' + err.message, 'error' );

					}

				} ),
				btn( 'Copy', () => navigator.clipboard?.writeText( json.value ) ),
				btn( 'Exit lab', () => closeLab( game ) ) ) );
			const m = g ? genomeMetrics( g ) : null;
			info.textContent = g ? `${describeGenome( g )}\nradius ${m.radius}  height ${m.height}  mass ${m.mass}\nreach ${m.reach}  speed x${m.speedMul}  ${m.flying ? 'flying' : 'walking'}\nparts ${m.parts}  bones ${m.bones}  legs ${m.legs}\nattacks: ${m.attackStyles.join( ', ' )}` : '';

		};

		this.sync = rebuild;
		lab.ui = this;
		const panel = h( 'div', { class: 'panel lab-panel' }, h( 'h2', { text: 'Creature Lab' } ), body, info );
		return h( 'div', { class: 'lab-root' }, labels, panel );

	},
	onOpen() {

		this.sync?.();

	}
} );

// A small corner button (visible while the pause menu is open) to enter the lab.
define( 'uiPanel', { id: 'creature-lab-button', order: 96,
	mount( ui ) {

		this.el = h( 'button', { class: 'lab-open-btn', text: 'Creature Lab', onclick: () => {

			ui.open( 'pause', false );
			openLab( ui.game, ui.game.rc, {} );

		} } );
		return h( 'div', {}, this.el );

	},
	update( ui ) {

		const show = ui.isOpen( 'pause' ) && ! lab.open;
		if ( this.el.style.display !== ( show ? '' : 'none' ) ) this.el.style.display = show ? '' : 'none';

	}
} );

define( 'bootHook', { id: 'creature-lab', order: 60,
	boot( { game, rc, opts } ) {

		// console / agent access: game.creatureLab.sheet( { kind: 'creature', n: 24 } )
		game.creatureLab = {
			open: ( o ) => openLab( game, rc, o ), close: () => closeLab( game ), state: labState,
			sheet: ( o ) => contactSheet( game, o ), show: ( o ) => labShow( game, o ),
			set: ( o ) => Object.assign( lab, o ),
			genome: ( seed, opts ) => generateGenome( new RNG( hashStr( String( seed ) ) ), opts || {} )
		};
		if ( opts.lab !== 'creature' ) return;
		openLab( game, rc, { sheet: opts.sheet, kind: opts.kind, seed: opts.seed, plan: opts.plan, action: opts.action, phase: opts.phase } );

	}
} );

export { lab };
