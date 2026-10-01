// Player controller: turns the INPUT STATE ( game.input ) into movement, dodge rolls
// and skills. Everything that makes the hero feel responsive lives here:
//
//   * INPUT BUFFER - a press is remembered for BUFFER seconds (and for as long as it
//     waits on the current swing or roll), so pressing attack early still lands the
//     next combo step on the first possible frame. Combos never drop.
//   * HOLD TO REPEAT - a held slot re-casts as soon as its action reaches chainAt,
//     so holding attack plays the full combo back to back; another skill may cut in
//     earlier, at cancelAt (animation cancelling is a skill, mashing is not).
//   * CANCEL WINDOWS - dodge cancels any action (except mid-leap); a skill cancels
//     the tail of a roll; MOVING cancels an action's recovery once its hit is out.
//   * DODGE ROLL - a fixed-distance roll with an ease-out speed curve, i-frames for
//     most of it, passing through enemies (ghost), cooldown from the dodge_cooldown
//     stat, direction = move input (or facing when standing still).
//   * CHANNELS - a channelled skill loops while its button is held (continueChannel
//     is called from the loop's onEnd, in the same step: no gap frame).
//   * POTION - emits world event 'potion' { entity }; progression's flasks drink it.
//
// The controller never touches rendering; it only writes entity state the core
// systems already understand (moveIntent, forced, flags, anim, actions).

import { define, get } from '../../core/registry.js';
import { cancelAction } from '../../core/actions.js';
import { SLOT_ACTIONS, readLoadout, castSkill } from './skill-core.js';

export const BUFFER = 0.22; // seconds a press stays queued
export const DODGE = {
	time: 0.32, // roll duration (s)
	iframes: 0.78, // fraction of the roll that is invulnerable
	cancel: 0.55, // fraction after which an attack / skill may cut the roll
	profile: 0.72 // speed falls off linearly by this much over the roll (snappy start, soft landing)
};

define( 'controller', { id: 'player', create: ( game, e ) => new PlayerController( game, e ) } );

export class PlayerController {

	constructor( game, e ) {

		this.game = game;
		this.buffer = null; // { kind: 'dodge' | 'slot', slot, time }
		this.dodge = null; // roll in progress { t, dur, dx, dz, peak }
		this.channel = - 1; // bar slot being channelled
		this.lastSlot = 0; // most recently pressed slot: wins when several are held
		this.failAt = - 9; // throttles "not enough mana" feedback while a button is held
		this.sig = null;
		this.loadout = readLoadout( game.save );
		this.syncLoadout( e, false );

	}

	// Re-read the loadout when the save's skills field changes (progression's skill UI)
	// and rebuild the player's stats so support modifiers follow.
	syncLoadout( e, apply = true ) {

		const save = this.game.save;
		const sig = JSON.stringify( save?.skills ?? null );
		if ( sig === this.sig ) return;
		this.sig = sig;
		this.loadout = readLoadout( save );
		if ( apply ) this.game.applyPlayerStats?.( e );

	}

	update( world, e, dt ) {

		const inp = world.input;
		if ( ! inp || ! e.alive ) {

			if ( this.dodge ) this.endDodge( world, e );
			return;

		}

		this.syncLoadout( e );
		const now = world.time;

		// 1. remember the newest press (a dodge pressed in the same step wins)
		for ( let i = 0; i < SLOT_ACTIONS.length; i ++ ) {

			if ( ! inp.pressed.has( SLOT_ACTIONS[ i ] ) ) continue;
			this.buffer = { kind: 'slot', slot: i, time: now };
			this.lastSlot = i;

		}

		if ( inp.pressed.has( 'dodge' ) ) this.buffer = { kind: 'dodge', time: now };
		if ( inp.pressed.has( 'potion' ) ) world.events.emit( 'potion', { entity: e, x: e.x, z: e.z } );
		if ( this.buffer && now - this.buffer.time > BUFFER ) this.buffer = null;

		// 2. movement intent (world space; the input layer already made it camera-relative)
		const mx = inp.move.x, mz = inp.move.z, ml = Math.hypot( mx, mz );
		e.moveIntent.x = mx; e.moveIntent.z = mz;
		const act = e.action;
		if ( ! act ) {

			e.anim.aimX = inp.aim.x; e.anim.aimZ = inp.aim.z;

		} else if ( act.def.turn && act.phase === 'windup' && ! act.target ) {

			// until the release frame the aim keeps following the cursor / stick
			act.aimX = inp.aim.x; act.aimZ = inp.aim.z;
			e.anim.aimX = inp.aim.x; e.anim.aimZ = inp.aim.z;

		}

		// 3. a roll in progress
		if ( this.dodge ) this.stepDodge( world, e, dt );

		// 4. channels end the moment their button is released; while spinning, the body
		// leans into the move direction
		if ( this.channel >= 0 ) {

			if ( ! inp.held.has( SLOT_ACTIONS[ this.channel ] ) ) this.stopChannel( world, e );
			else if ( ml > 0.1 ) {

				const want = Math.atan2( mx, mz );
				e.facing += Math.atan2( Math.sin( want - e.facing ), Math.cos( want - e.facing ) ) * Math.min( 1, 12 * dt );

			}

		}

		// 5. act: the buffered press first, otherwise a held button (hold to attack)
		const req = this.buffer ?? this.heldRequest( inp, now );
		if ( req ) this.handle( world, e, req, inp );

		// 6. moving cancels recovery: once the hit is out, a move input takes over at once
		const cur = e.action;
		if ( cur && ml > 0.3 && ! cur.def.channel && cur.t >= ( cur.def.cancelAt ?? cur.def.active ?? 0.6 ) && ! ( req && req.kind === 'slot' ) ) {

			cancelAction( world, e, 'move' );

		}

	}

	heldRequest( inp, now ) {

		if ( inp.held.has( SLOT_ACTIONS[ this.lastSlot ] ) ) return { kind: 'slot', slot: this.lastSlot, time: now, held: true };
		for ( let i = 0; i < SLOT_ACTIONS.length; i ++ ) if ( inp.held.has( SLOT_ACTIONS[ i ] ) ) return { kind: 'slot', slot: i, time: now, held: true };
		return null;

	}

	handle( world, e, req, inp ) {

		if ( e.flags.stunned || e.flags.frozen ) return; // stays buffered for when it wears off
		if ( req.kind === 'dodge' ) {

			if ( ! this.canDodge( world, e ) ) return;
			this.startDodge( world, e, inp );
			this.buffer = null;
			return;

		}

		const id = this.loadout.bar[ req.slot ];
		if ( ! id ) {

			this.buffer = null;
			return;

		}

		// attacks cut the tail of a roll
		if ( this.dodge ) {

			if ( this.dodge.t / this.dodge.dur < DODGE.cancel ) return this.hold( req );
			this.endDodge( world, e );

		}

		const act = e.action;
		if ( act ) {

			if ( act.def.channel && act.def.skill === id ) {

				this.buffer = null;
				return;

			}

			// not yet: stays buffered. The same skill waits for chainAt, others for cancelAt.
			const gate = act.def.skill === id ? act.def.chainAt ?? act.def.cancelAt : act.def.cancelAt;
			if ( act.t < ( gate ?? act.def.active ?? 0.6 ) ) return this.hold( req );

		}

		const r = castSkill( world, e, id, { aimX: inp.aim.x, aimZ: inp.aim.z, slot: req.slot, cone: inp.device === 'keyboard' ? 45 : 75 } );
		if ( r === 'ok' ) {

			this.buffer = null;
			if ( get( 'skill', id ).tags.includes( 'channel' ) ) this.channel = req.slot;

		} else if ( r === 'mana' || r === 'invalid' ) {

			this.buffer = null;
			this.fail( world, e, id, req.slot, r );

		} else if ( r === 'cooldown' ) {

			// keep it queued only if the cooldown ends inside the buffer window
			if ( ( e.cooldowns.get( id ) ?? 0 ) - world.time > BUFFER ) {

				this.buffer = null;
				if ( ! req.held ) this.fail( world, e, id, req.slot, r );

			}

		}

	}

	// A press waiting on the current swing or roll stays queued until that gate opens
	// (then BUFFER more): clicking early in a long swing never loses the next step.
	hold( req ) {

		if ( req === this.buffer ) req.time = this.game.world?.time ?? req.time;

	}

	fail( world, e, skill, slot, reason ) {

		if ( world.time - this.failAt < 0.6 ) return;
		this.failAt = world.time;
		world.events.emit( 'skillFail', { entity: e, skill, slot, reason, x: e.x, z: e.z } );

	}

	// --- channels -----------------------------------------------------------------------

	continueChannel( world, e, id ) {

		if ( this.channel < 0 ) return;
		const inp = world.input;
		if ( ! inp || ! inp.held.has( SLOT_ACTIONS[ this.channel ] ) || this.loadout.bar[ this.channel ] !== id ) {

			this.channel = - 1;
			return;

		}

		const r = castSkill( world, e, id, { aimX: inp.aim.x, aimZ: inp.aim.z, slot: this.channel } );
		if ( r !== 'ok' ) {

			if ( r === 'mana' ) this.fail( world, e, id, this.channel, r );
			this.channel = - 1;

		}

	}

	stopChannel( world, e ) {

		this.channel = - 1;
		if ( e.action?.def.channel ) cancelAction( world, e, 'release' );

	}

	// --- dodge roll ---------------------------------------------------------------------

	canDodge( world, e ) {

		if ( this.dodge ) return false;
		if ( ( e.cooldowns.get( 'dodge' ) ?? 0 ) > world.time ) return false;
		const act = e.action;
		if ( act && act.def.noDodgeCancel !== undefined && act.t < act.def.noDodgeCancel ) return false;
		return true;

	}

	startDodge( world, e, inp ) {

		let dx = inp.move.x, dz = inp.move.z;
		if ( Math.hypot( dx, dz ) < 0.2 ) {

			dx = Math.sin( e.facing );
			dz = Math.cos( e.facing );

		}

		const l = Math.hypot( dx, dz );
		dx /= l; dz /= l;
		if ( e.action ) cancelAction( world, e, 'dodge' );
		this.channel = - 1;
		const S = e.stats;
		const dist = Math.max( 1, S.get( 'dodge_distance' ) ), dur = DODGE.time;
		// v(u) = peak * ( 1 - profile * u ) integrates to exactly `dist` over the roll
		const peak = dist / ( dur * ( 1 - DODGE.profile / 2 ) );
		this.dodge = { t: 0, dur, dx, dz, peak };
		e.facing = Math.atan2( dx, dz );
		e.flags.invulnerable = true;
		e.flags.ghost = true;
		e.data.dodging = true;
		e.forced = { vx: dx * peak, vz: dz * peak, time: 99, dodge: true };
		const a = e.anim;
		a.state = 'dodge'; a.action = null; a.phase = null; a.t = 0; a.duration = dur;
		a.seq ++;
		const cd = S.get( 'dodge_cooldown' );
		e.cooldowns.set( 'dodge', world.time + cd );
		( e.data.cdTotal || ( e.data.cdTotal = {} ) ).dodge = cd;
		world.events.emit( 'dodge', { entity: e, x: e.x, z: e.z, dx, dz } );

	}

	stepDodge( world, e, dt ) {

		const d = this.dodge;
		d.t += dt;
		const u = Math.min( 1, d.t / d.dur );
		if ( u >= 1 || ! e.forced?.dodge ) {

			this.endDodge( world, e );
			return;

		}

		const v = d.peak * ( 1 - DODGE.profile * u );
		e.forced.vx = d.dx * v;
		e.forced.vz = d.dz * v;
		if ( u > DODGE.iframes ) e.flags.invulnerable = false;
		e.anim.t = u;

	}

	endDodge( world, e ) {

		this.dodge = null;
		if ( e.forced?.dodge ) e.forced = null;
		e.flags.invulnerable = false;
		e.flags.ghost = false;
		e.data.dodging = false;

	}

}
