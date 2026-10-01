// ECHOES (depth 9, Mirror Halls) - a ghost replays your actions two seconds later.
//
// Everything you do is recorded: your path and every action you start (attacks,
// skills, dodges). Your ECHO walks the same path and performs the same actions,
// with your stats, two seconds behind. Its hits are real (and its kills are yours).
//
// Casual: a free second helping of damage wherever you just fought. Expert: PLAN -
// attack a spot, then step aside and kite the pack back through it as your echo
// swings; or stand still and double every hit. At high intensity a second echo
// follows at twice the delay.
//
// How replay stays safe with ANY skill (the combat feature owns them): the echo
// runs the very same action defs through world.act(), wrapped so a skill that
// assumes "I am the player" cannot crash the simulation; its StatBlock is a
// read-only view of the player's, so buffs it casts cannot stack onto you.

import { define } from '../../../core/registry.js';
import { Entity } from '../../../core/entity.js';
import { TEAM } from '../../../core/tuning.js';

const RATE = 60;

define( 'mechanic', {
	id: 'echoes', name: 'Echoes', tags: [ 'mirror', 'time', 'player' ], theme: 'mirror-halls', depth: 9,
	desc: 'Your echo replays everything you do two seconds later - every swing, every spell, every step.',
	tip: 'Your echo hits for real. Fight in one place to double your damage, or lead packs back through the spot you just attacked.',
	words: { adj: [ 'Echo', 'Mirrored', 'Resonant' ], noun: [ 'Echoes', 'Mirrors', 'Reflections' ] },
	combinesWith: [ 'magma-tide', 'rift-gates', 'lightless', 'swarm', 'powder-keg' ],
	conflicts: [ 'chrono-fields' ],

	setup( game, world, ctx ) {

		const st = ctx.state, p = world.player;
		if ( ! p ) return;
		st.delays = ctx.intensity >= 1.4 ? [ 2, 4 ] : [ 2 ];
		const cap = Math.ceil( ( st.delays[ st.delays.length - 1 ] + 1 ) * RATE );
		st.cap = cap;
		st.t = new Float32Array( cap ); st.x = new Float32Array( cap ); st.z = new Float32Array( cap ); st.f = new Float32Array( cap );
		st.head = 0; st.count = 0;
		st.actions = []; // { t, def, aimX, aimZ, ctx }
		st.echoes = st.delays.map( ( delay, i ) => {

			const e = new Entity( { kind: 'echo', name: i ? 'Second echo' : 'Echo', team: TEAM.PLAYER, x: p.x, z: p.z, radius: p.radius, height: p.height, solid: false } );
			e.flags.invulnerable = e.flags.untargetable = e.flags.ghost = true;
			e.stats = readOnlyView( p.stats );
			e.life = 1; e.mana = 1e9;
			e.model = { type: 'hero', id: p.model?.id ?? 'reaver', ghost: true, opacity: i ? 0.3 : 0.45, weapon: p.model?.weapon, gear: p.model?.gear };
			e.data.delay = delay;
			e.data.next = 0; // index of the next recorded action to replay
			e.px = e.x; e.pz = e.z;
			world.add( e );
			return e;

		} );

		world.events.on( 'action', ( a ) => {

			if ( a.entity !== world.player || ! a.entity.action ) return;
			const act = a.entity.action;
			st.actions.push( { t: world.time, def: act.def, aimX: act.aimX, aimZ: act.aimZ, ctx: { ...act.ctx } } );

		} );

		world.events.on( 'dodge', ( d ) => {

			if ( d.entity === world.player ) st.actions.push( { t: world.time, dodge: true } );

		} );

	},

	postMove( world, dt, ctx ) {

		const st = ctx.state, p = world.player;
		if ( ! st.echoes ) return;
		// record this step
		st.t[ st.head ] = world.time; st.x[ st.head ] = p.x; st.z[ st.head ] = p.z; st.f[ st.head ] = p.facing;
		st.head = ( st.head + 1 ) % st.cap;
		st.count = Math.min( st.count + 1, st.cap );

		for ( const e of st.echoes ) {

			const target = world.time - e.data.delay;
			const s = sample( st, target );
			if ( s ) {

				e.vx = ( s.x - e.x ) / Math.max( dt, 1e-4 ); e.vz = ( s.z - e.z ) / Math.max( dt, 1e-4 );
				e.x = s.x; e.z = s.z;
				if ( ! e.action ) e.facing = s.f;

			}

			// replay due actions
			while ( e.data.next < st.actions.length && st.actions[ e.data.next ].t <= target ) {

				const a = st.actions[ e.data.next ++ ];
				if ( a.dodge ) {

					e.data.dodging = true;
					e.anim.seq ++;
					e.forced = { vx: 0, vz: 0, time: 0.28, onEnd: ( w, en ) => ( en.data.dodging = false ) };
					continue;

				}

				world.act( e, safeDef( a.def ), { aimX: a.aimX, aimZ: a.aimZ, ctx: a.ctx, force: true } );
				world.events.emit( 'mechanic', { id: 'echoes', event: 'replay', x: e.x, z: e.z, entity: e } );

			}

		}

		// forget actions every echo has replayed
		const done = Math.min( ...st.echoes.map( ( e ) => e.data.next ) );
		if ( done > 64 ) {

			st.actions.splice( 0, done );
			for ( const e of st.echoes ) e.data.next -= done;

		}

	},

	describe( world, ctx ) {

		return { echoes: ctx.state.echoes?.length ?? 0, delays: ctx.state.delays, queued: ctx.state.actions?.length ?? 0 };

	}
} );

// Interpolated recorded pose at time t (null until enough history exists).
function sample( st, t ) {

	if ( st.count < 2 ) return null;
	const newest = ( st.head - 1 + st.cap ) % st.cap;
	const oldest = ( st.head - st.count + st.cap ) % st.cap;
	if ( t <= st.t[ oldest ] ) return { x: st.x[ oldest ], z: st.z[ oldest ], f: st.f[ oldest ] };
	if ( t >= st.t[ newest ] ) return { x: st.x[ newest ], z: st.z[ newest ], f: st.f[ newest ] };
	// samples are evenly spaced at the fixed step: jump close, then walk
	let i = ( newest - Math.round( ( st.t[ newest ] - t ) * RATE ) + st.cap * 2 ) % st.cap;
	for ( let k = 0; k < 4 && st.t[ i ] > t; k ++ ) i = ( i - 1 + st.cap ) % st.cap;
	const j = ( i + 1 ) % st.cap;
	const span = st.t[ j ] - st.t[ i ];
	const a = span > 0 ? Math.max( 0, Math.min( 1, ( t - st.t[ i ] ) / span ) ) : 0;
	return { x: st.x[ i ] + ( st.x[ j ] - st.x[ i ] ) * a, z: st.z[ i ] + ( st.z[ j ] - st.z[ i ] ) * a, f: st.f[ j ] };

}

// A StatBlock view that reads the player's numbers but ignores writes, so a buff
// the echo casts on "itself" never lands on the player.
function readOnlyView( stats ) {

	const v = Object.create( stats );
	v.setSource = () => {};
	v.setBase = () => {};
	v.setFlag = () => {};
	return v;

}

// Action defs wrapped so an exception inside someone else's skill code ends that
// echo action quietly instead of stopping the world.
const wrapped = new WeakMap();
const safe = ( fn ) => fn ? ( ...args ) => {

	try {

		return fn( ...args );

	} catch {

		return undefined;

	}

} : undefined;

function safeDef( def ) {

	let w = wrapped.get( def );
	if ( ! w ) {

		w = { ...def, onStart: safe( def.onStart ), onEnd: safe( def.onEnd ), onCancel: safe( def.onCancel ), events: def.events?.map( ( ev ) => ( { ...ev, fn: safe( ev.fn ) } ) ) };
		wrapped.set( def, w );

	}

	return w;

}
