// Action timeline: every attack, spell, monster ability and emote runs on it, so
// the player and the monsters share one notion of windup / active / recovery,
// cancel windows and hit frames. That is what makes combat feel responsive:
// inputs are buffered, recovery can be cancelled into a dodge or the next combo
// step, and the rig layer always knows which phase it should be posing.
//
// An action DEF (skills and monster abilities build these):
//   id         unique id;   anim: rig action name (defaults to id)
//   duration   seconds at 100% speed;   speedStat: 'attack_speed' | 'cast_speed' | null
//   windup     fraction of the timeline where the active part starts (default 0.35)
//   active     fraction where recovery starts (default 0.6)
//   cancelAt   fraction from which another action / dodge may interrupt (default = active)
//   moveMult   movement speed multiplier while acting (default 0.2)
//   turn       true: keeps turning toward the aim point during windup
//   lunge      { from, to, speed }: forward root motion between two fractions
//   unstoppable  true: hits and stuns do not interrupt it
//   events     [ { at: 0.4, fn( world, entity, act ) } ] fired once when t passes `at`
//   onStart( world, e, act ), onEnd( world, e, act ), onCancel( world, e, act )
// An action INSTANCE (entity.action): { def, time, duration, t, phase, fired, aimX, aimZ, target, ctx }

export function startAction( world, e, def, { aimX = e.anim.aimX, aimZ = e.anim.aimZ, target = null, ctx = {}, force = false } = {} ) {

	if ( ! e.alive ) return null;
	const cur = e.action;
	if ( cur && ! force && cur.t < ( cur.def.cancelAt ?? cur.def.active ?? 0.6 ) ) return null;
	if ( cur ) cancelAction( world, e, 'replaced' );
	if ( e.flags.stunned || e.flags.frozen ) return null;

	const speed = def.speedStat ? Math.max( 0.1, e.stats.get( def.speedStat, def.tags || [] ) ) : 1;
	const act = {
		def, time: 0, duration: Math.max( 0.05, ( def.duration ?? 0.5 ) / speed ), t: 0,
		phase: 'windup', fired: new Set(), aimX, aimZ, target, ctx
	};
	e.action = act;
	if ( def.faceAim !== false ) faceToward( e, aimX, aimZ );
	const a = e.anim;
	a.state = 'action';
	a.action = def.anim || def.id;
	a.phase = 'windup';
	a.t = 0;
	a.duration = act.duration;
	a.seq ++;
	a.variant = ctx.variant ?? 0;
	a.aimX = aimX; a.aimZ = aimZ;
	def.onStart?.( world, e, act );
	world.events.emit( 'action', { entity: e, action: a.action, duration: act.duration, x: e.x, z: e.z } );
	return act;

}

export function cancelAction( world, e, reason = 'cancel' ) {

	const act = e.action;
	if ( ! act ) return;
	e.action = null;
	act.def.onCancel?.( world, e, act, reason );
	e.anim.phase = null;

}

export function faceToward( e, x, z ) {

	const dx = x - e.x, dz = z - e.z;
	if ( dx * dx + dz * dz > 1e-6 ) e.facing = Math.atan2( dx, dz );

}

// Fraction of the timeline left before the action can be cancelled (0 = cancellable now).
export function canAct( e ) {

	const act = e.action;
	return ! act || act.t >= ( act.def.cancelAt ?? act.def.active ?? 0.6 );

}

export function updateActions( world, dt ) {

	for ( const e of world.entities ) {

		const act = e.action;
		if ( ! act ) continue;
		if ( ! e.alive ) {

			e.action = null;
			continue;

		}

		const def = act.def;
		act.time += dt;
		act.t = Math.min( 1, act.time / act.duration );
		const windup = def.windup ?? 0.35, active = def.active ?? 0.6;
		act.phase = act.t < windup ? 'windup' : act.t < active ? 'active' : 'recovery';
		e.anim.phase = act.phase;
		e.anim.t = act.t;

		if ( def.turn && act.phase === 'windup' ) {

			const tgt = act.target;
			if ( tgt && tgt.alive ) {

				act.aimX = tgt.x; act.aimZ = tgt.z;

			}

			faceToward( e, act.aimX, act.aimZ );

		}

		if ( def.lunge && act.t >= def.lunge.from && act.t <= def.lunge.to ) {

			const sp = def.lunge.speed;
			e.forced = { vx: Math.sin( e.facing ) * sp, vz: Math.cos( e.facing ) * sp, time: dt * 1.5, keepAction: true };

		}

		if ( def.events ) for ( let i = 0; i < def.events.length; i ++ ) {

			const ev = def.events[ i ];
			if ( act.t >= ev.at && ! act.fired.has( i ) ) {

				act.fired.add( i );
				ev.fn( world, e, act );
				if ( e.action !== act ) break; // the event cancelled / replaced the action

			}

		}

		if ( e.action === act && act.t >= 1 ) {

			e.action = null;
			e.anim.phase = null;
			def.onEnd?.( world, e, act );

		}

	}

}
