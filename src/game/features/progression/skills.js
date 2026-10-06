// Skill loadout: which active skills the hero knows, which six are on the action bar
// (LMB, RMB, 1-4), which support runes are socketed into each, and skill levels.
// The COMBAT feature defines the skills ( 'skill' / 'support' defs ) and reads
// game.save.skills; progression owns the data and the UI.
//
//   save.skills = { known: [ ids ], bar: [ 6 ids | null ], supports: { skillId: [ supportIds ] },
//                   levels: { skillId: n }, xp: { skillId: n }, runes: { supportId: count } }
//
// SKILL LEVELS grow like PoE gems: skills on the bar share the XP you earn and level
// up to a cap set by your character level. Gear and passives add +levels on top
// ( stat `skill_level`, tagged by skill tag ); skillLevel() returns the total.
// SUPPORT RUNES drop from monsters; socketing one consumes it, removing returns it.

import { all, get } from '../../core/registry.js';
import { xpToNext } from '../../core/tuning.js';

export const BAR_LABELS = [ 'LMB', 'RMB', '1', '2', '3', '4' ];
// Preferred starting bar (the combat feature's showcase set: melee combo on LMB,
// a slam, a projectile spell, a movement skill, a nova and a warcry). Ids that are
// not registered are skipped and the slots are filled by tag heuristics instead.
const STARTER_BAR = [ 'slash', 'ground-slam', 'fireball', 'leap-slam', 'frost-nova', 'war-cry' ];
const STARTER_MELEE = [ 'slash', 'cleave', 'heavy-strike', 'strike', 'basic-slash', 'double-strike' ];

export function newSkillsSave() {

	return { known: [], bar: [ null, null, null, null, null, null ], supports: {}, levels: {}, xp: {}, runes: {} };

}

function skillsOf( save ) {

	save.skills ||= newSkillsSave();
	return save.skills;

}

const levelReq = ( d ) => d.levelReq ?? d.level ?? 1;

// Starting loadout from whatever skills the combat feature registered: a melee
// attack on LMB, the next most useful low-level skill on RMB.
export function defaultLoadout() {

	const skills = all( 'skill' ).filter( ( d ) => levelReq( d ) <= 1 );
	if ( ! skills.length ) return null;
	const melee = STARTER_MELEE.map( ( id ) => get( 'skill', id ) ).find( ( d ) => d && levelReq( d ) <= 1 ) ||
		skills.find( ( d ) => d.tags.includes( 'melee' ) && d.tags.includes( 'attack' ) ) || skills[ 0 ];
	const bar = [ melee ];
	for ( const id of STARTER_BAR ) {

		const d = get( 'skill', id );
		if ( d && levelReq( d ) <= 1 && ! bar.includes( d ) && bar.length < 6 ) bar.push( d );

	}

	// heuristics for whatever the preferred list did not cover
	const want = [ ( d ) => d.tags.includes( 'projectile' ) || d.tags.includes( 'spell' ), ( d ) => d.tags.includes( 'movement' ), ( d ) => d.tags.includes( 'area' ) ];
	for ( const f of want ) {

		const d = skills.find( ( x ) => ! bar.includes( x ) && f( x ) );
		if ( d && bar.length < 6 ) bar.push( d );

	}

	while ( bar.length < 6 ) bar.push( null );
	return { bar: bar.map( ( d ) => d?.id ?? null ), known: bar.filter( Boolean ).map( ( d ) => d.id ) };

}

// Keep the loadout valid as skills get registered / removed (also fixes saves made
// before the combat feature existed: their bar is filled in on first load).
// Save migrations request full content repair once; ordinary stat/loot calls
// only maintain the small active bar and known-skill list.
export function ensureLoadout( save, { repair = false } = {} ) {

	const s = skillsOf( save );
	if ( ! all( 'skill' ).length ) return;
	const unlocked = ( id ) => typeof id === 'string' && get( 'skill', id ) && levelReq( get( 'skill', id ) ) <= save.level;
	const seen = new Set();
	for ( let i = 0; i < 6; i ++ ) {

		const id = s.bar[ i ];
		if ( ! unlocked( id ) || seen.has( id ) ) s.bar[ i ] = null;
		else seen.add( id );

	}
	s.known = s.known.filter( unlocked );
	if ( repair ) {

		for ( const key of [ 'levels', 'xp' ] ) for ( const id of Object.keys( s[ key ] ) ) {

			if ( ! get( 'skill', id ) ) { delete s[ key ][ id ]; continue; }
			const value = s[ key ][ id ];
			s[ key ][ id ] = key === 'levels' ? Math.min( maxSkillLevel( save.level ), Math.max( 1, Math.round( value ) ) ) : value;

		}
		for ( const id of Object.keys( s.runes ) ) {

			if ( ! get( 'support', id ) ) delete s.runes[ id ];
			else s.runes[ id ] = Math.round( s.runes[ id ] );

		}
		// Returning known runes preserves owned content when their old sockets no
		// longer fit. Removed registry ids remain available in the original Recovery.
		for ( const [ id, supports ] of Object.entries( s.supports ) ) {

			const skill = get( 'skill', id ), kept = [];
			for ( const sid of supports ) {

				const support = get( 'support', sid );
				if ( ! support ) continue;
				if ( skill && supportFits( skill, support ) && levelReq( support ) <= save.level && ! kept.includes( sid ) && kept.length < supportSlots( save ) ) kept.push( sid );
				else s.runes[ sid ] = Math.min( Number.MAX_SAFE_INTEGER, ( s.runes[ sid ] || 0 ) + 1 );

			}
			if ( skill ) s.supports[ id ] = kept;
			else delete s.supports[ id ];

		}

	}
	if ( ! s.bar[ 0 ] ) {

		const d = defaultLoadout();
		if ( d ) {

			for ( let i = 0; i < 6; i ++ ) if ( ! s.bar[ i ] && d.bar[ i ] && ! s.bar.includes( d.bar[ i ] ) ) s.bar[ i ] = d.bar[ i ];
			for ( const id of d.known ) if ( ! s.known.includes( id ) ) s.known.push( id );

		}

	}

	for ( const id of s.bar ) if ( id && ! s.known.includes( id ) ) s.known.push( id );
	for ( const id of s.known ) s.levels[ id ] ??= 1;

}

// Validate content before a portable character can replace the stored one.
// Missing legacy maps are filled by migrations; supplied ids and values must be
// real registry content and obey the same rules as learning/socketing in play.
export function validateSkillsSave( save ) {

	const s = save.skills, known = s.known;
	const unlocked = ( id ) => typeof id === 'string' && get( 'skill', id ) && levelReq( get( 'skill', id ) ) <= save.level;
	if ( known.some( ( id ) => ! unlocked( id ) ) || new Set( known ).size !== known.length ) throw new Error( 'Known skills must be registered, unique and unlocked.' );
	const bar = s.bar.filter( ( id ) => id !== null );
	if ( bar.some( ( id ) => ! unlocked( id ) ) || new Set( bar ).size !== bar.length ) throw new Error( 'Skill bar entries must be registered, unique and unlocked.' );
	for ( const key of [ 'levels', 'xp', 'runes', 'supports' ] ) {

		if ( s[ key ] === undefined ) continue;
		if ( ! s[ key ] || typeof s[ key ] !== 'object' || Array.isArray( s[ key ] ) ) throw new Error( `Invalid skill ${key} map.` );
		for ( const [ id, value ] of Object.entries( s[ key ] ) ) {

			const def = get( key === 'runes' ? 'support' : 'skill', id );
			if ( ! def ) throw new Error( `Unknown ${key === 'runes' ? 'support rune' : 'skill'} in ${key}.` );
			if ( key === 'supports' ) {

				if ( ! Array.isArray( value ) || value.length > supportSlots( save ) || new Set( value ).size !== value.length ) throw new Error( 'Invalid support sockets.' );
				for ( const sid of value ) {

					const support = typeof sid === 'string' ? get( 'support', sid ) : null;
					if ( ! support || ! supportFits( def, support ) || levelReq( support ) > save.level ) throw new Error( 'Unknown, incompatible or locked support.' );

				}

			} else if ( key === 'levels' ) {

				if ( ! Number.isInteger( value ) || value < 1 || value > maxSkillLevel( save.level ) ) throw new Error( 'Invalid skill level for the character level.' );

			} else if ( ! Number.isFinite( value ) || value < 0 || value > Number.MAX_SAFE_INTEGER || key === 'runes' && ! Number.isInteger( value ) ) throw new Error( `Invalid skill ${key} value.` );

		}

	}

}

export function canLearn( save, id ) {

	const d = get( 'skill', id );
	if ( ! d ) return 'Unknown skill';
	if ( skillsOf( save ).known.includes( id ) ) return 'Already known';
	if ( save.level < levelReq( d ) ) return `Requires level ${levelReq( d )}`;
	return null;

}

export function learnSkill( save, id ) {

	const why = canLearn( save, id );
	if ( why ) return { ok: false, reason: why };
	const s = skillsOf( save );
	s.known.push( id );
	s.levels[ id ] ??= 1;
	return { ok: true };

}

// Put skill `id` (or null) in bar slot `index`; a skill sits in one slot at a time.
export function assignSkill( save, index, id ) {

	const s = skillsOf( save );
	if ( index < 0 || index > 5 ) return { ok: false, reason: 'Bad slot' };
	if ( id && ! s.known.includes( id ) ) {

		const r = learnSkill( save, id );
		if ( ! r.ok ) return r;

	}

	// weapon-restricted skills ( def.weapon ) may sit on the bar; combat decides whether they fire
	if ( id ) {

		const prev = s.bar.indexOf( id );
		if ( prev >= 0 ) s.bar[ prev ] = s.bar[ index ];

	}

	s.bar[ index ] = id;
	return { ok: true };

}

export function supportSlots( save ) {

	return Math.min( 5, 2 + Math.floor( save.level / 15 ) );

}

// Same rule as the combat feature: ANY of the support's tags is on the skill (or in the
// skill's extra `supports` tags) and NONE of the support's `excludes`.
export function supportFits( skill, support ) {

	const tags = skill.supports ? skill.tags.concat( skill.supports ) : skill.tags;
	if ( support.excludes?.some( ( t ) => tags.includes( t ) ) ) return false;
	return ! support.tags.length || support.tags.some( ( t ) => tags.includes( t ) );

}

export function socketSupport( save, skillId, supportId ) {

	const s = skillsOf( save );
	const sk = get( 'skill', skillId ), sp = get( 'support', supportId );
	if ( ! sk || ! sp ) return { ok: false, reason: 'Unknown skill or support' };
	if ( ( s.runes[ supportId ] ?? 0 ) <= 0 ) return { ok: false, reason: 'You have no rune of that support' };
	if ( ! supportFits( sk, sp ) ) return { ok: false, reason: `${sp.name} cannot support ${sk.name}` };
	const list = ( s.supports[ skillId ] ||= [] );
	if ( list.includes( supportId ) ) return { ok: false, reason: 'Already socketed' };
	if ( list.length >= supportSlots( save ) ) return { ok: false, reason: 'No free support socket' };
	list.push( supportId );
	s.runes[ supportId ] --;
	return { ok: true };

}

export function unsocketSupport( save, skillId, supportId ) {

	const s = skillsOf( save );
	const list = s.supports[ skillId ] || [];
	const i = list.indexOf( supportId );
	if ( i < 0 ) return { ok: false, reason: 'Not socketed' };
	list.splice( i, 1 );
	s.runes[ supportId ] = ( s.runes[ supportId ] ?? 0 ) + 1;
	return { ok: true };

}

export function addRune( save, supportId, n = 1 ) {

	const s = skillsOf( save );
	s.runes[ supportId ] = ( s.runes[ supportId ] ?? 0 ) + n;

}

// --- levels -------------------------------------------------------------------------------------

export function maxSkillLevel( playerLevel ) {

	return Math.min( 20, 1 + Math.floor( playerLevel / 3 ) );

}

export function skillXpToNext( level ) {

	return Math.round( xpToNext( level * 2 ) * 0.35 );

}

// Skills on the bar gain `amount` XP each; returns the ids that levelled up.
export function addSkillXp( save, amount ) {

	const s = skillsOf( save );
	const cap = maxSkillLevel( save.level );
	const ups = [];
	for ( const id of new Set( s.bar.filter( Boolean ) ) ) {

		let lvl = s.levels[ id ] ?? 1;
		if ( lvl >= cap ) continue;
		s.xp[ id ] = ( s.xp[ id ] ?? 0 ) + amount;
		while ( lvl < cap && s.xp[ id ] >= skillXpToNext( lvl ) ) {

			s.xp[ id ] -= skillXpToNext( lvl );
			lvl ++;
			ups.push( id );

		}

		s.levels[ id ] = lvl;
		if ( lvl >= cap ) s.xp[ id ] = Math.min( s.xp[ id ], skillXpToNext( lvl ) - 1 );

	}

	return ups;

}

// Total level: own level + `skill_level` from gear / tree whose tags fit the skill.
export function skillLevel( game, id ) {

	const base = game.save.skills?.levels?.[ id ] ?? 1;
	const d = get( 'skill', id );
	const p = game.world?.player;
	if ( ! d || ! p ) return base;
	return base + Math.round( p.stats.get( 'skill_level', d.tags ) );

}
