// entity.model -> rig template. One entry point for every model type the rig
// renderer draws ( modelType defs 'hero' 'creature' 'npc' 'prop' 'loot' ):
//
//   { type: 'hero', id: 'reaver', weapon: { base, rarity, color }, gear: { chest, legs, boots, gloves, helm, cape } }
//   { type: 'creature', genome }                  monsters (monsters feature)
//   { type: 'creature', id: 'husk', seed }        a fixed design from the model library, varied by seed
//   { type: 'creature', seed }                    a random genome from the seed
//   { type: 'npc', id: 'blacksmith' | 'merchant' | 'mystic' | 'guard' | 'townsfolk', seed?, emote? }
//   { type: 'prop', id: 'brazier', state?, palette? }      { type: 'loot', id: 'potion' | 'weapon-axe', rarity?, color? }
//
// Shared by every model with the same look (templates are immutable), cached by a
// key built from the fields that change the look. Sim-safe.

import { get } from '../../core/registry.js';
import { RNG, hashStr } from '../../core/rng.js';
import { builderFromPartList, RigBuilder } from './rig.js';
import { buildBody } from './body.js';
import { generateGenome, mutateGenome } from './genome.js';
import { buildHumanoid, REAVER_LOOK, resolveWeapon, RARITY_GLOW, RARITY_METAL } from './humanoid.js';
import { townsfolkLook, PROP_PALETTE } from './library.js';

const cache = new Map();
const genomeCache = new Map();
const MAX_CACHE = 600;

function remember( key, make ) {

	let v = cache.get( key );
	if ( v ) return v;
	v = make();
	if ( cache.size > MAX_CACHE ) cache.delete( cache.keys().next().value );
	cache.set( key, v );
	return v;

}

// Genome for a creature model (explicit, library design + seed, or random from seed).
export function creatureGenome( model ) {

	if ( model.genome ) return model.genome;
	const key = `${model.id ?? ''}:${model.seed ?? 0}`;
	let g = genomeCache.get( key );
	if ( g ) return g;
	const def = model.id ? get( 'model', model.id ) : null;
	if ( def?.genome ) g = model.seed ? mutateGenome( def.genome, new RNG( hashStr( key ) ), 0.12 ) : def.genome;
	else g = generateGenome( new RNG( hashStr( key ) ) );
	if ( genomeCache.size > MAX_CACHE ) genomeCache.delete( genomeCache.keys().next().value );
	genomeCache.set( key, g );
	return g;

}

// -> { T, emote } (emote: NPC idle loop)
export function templateFor( model ) {

	const type = model?.type;
	if ( type === 'creature' ) return { T: buildBody( creatureGenome( model ) ), emote: null };
	if ( type === 'hero' ) {

		const w = model.weapon, gr = model.gear;
		const key = `hero:${model.id ?? 'reaver'}:${w ? `${w.base}|${w.rarity}|${w.color}` : '-'}:${gr ? JSON.stringify( gr ) : '-'}`;
		return remember( key, () => {

			const def = get( 'model', model.id );
			return { T: buildHumanoid( def?.look || REAVER_LOOK, { id: model.id ?? 'reaver', kind: 'hero', weapon: w, gear: gr } ), emote: null };

		} );

	}

	if ( type === 'npc' ) {

		const def = get( 'model', model.id ) || get( 'model', 'townsfolk' );
		const key = `npc:${def.id}:${model.seed ?? 0}`;
		return remember( key, () => {

			let look = def.look, emote = def.emote;
			if ( def.random || ! look ) {

				const r = townsfolkLook( model.seed ?? hashStr( String( model.id ) ) );
				look = r.look; emote = r.emote;

			}

			if ( def.parts ) return { T: partListTemplate( def, model, 'prop' ), emote: null };
			return { T: buildHumanoid( look, { id: def.id, kind: 'npc' } ), emote };

		} );

	}

	if ( type === 'prop' || type === 'loot' ) {

		const id = model.id ?? ( type === 'loot' ? 'bag' : 'crate' );
		const key = `${type}:${id}:${model.rarity ?? ''}:${model.color ?? ''}:${model.palette ? JSON.stringify( model.palette ) : ''}`;
		return remember( key, () => ( { T: partListTemplate( get( 'model', id ) || ( id.startsWith( 'weapon' ) ? resolveWeapon( id.replace( /^weapon-/, '' ) ) : null ) || get( 'model', type === 'loot' ? 'bag' : 'crate' ), model, type ), emote: null } ) );

	}

	return null;

}

// Part-list model -> template. Weapons dropped as loot lie tilted on the ground with
// rarity colours; everything else uses its palette (+ the entity's palette override).
function partListTemplate( def, model, type ) {

	const rar = model.rarity || 'normal';
	const glow = model.color || RARITY_GLOW[ rar ] || def.palette?.glow;
	const palette = { ...PROP_PALETTE, ...( def.palette || {} ), ...( model.palette || {} ) };
	if ( glow ) palette.glow = glow;
	if ( def.type === 'weapon' || def.type === 'tool' ) {

		const B = new RigBuilder( 'loot', def.id );
		const holder = B.bone( 'item', 'root', [ 0, 0.25, 0 ], { rot: [ Math.PI / 2 - 0.35, 0.6, 0 ] } );
		const k = 0.85, len = def.length ?? 0.8;
		palette.metal = RARITY_METAL[ rar ] || palette.metal;
		palette.accent = rar === 'normal' ? '#8a6a3a' : glow;
		const emis = { normal: 0.15, magic: 0.5, rare: 0.65, unique: 0.9, set: 0.7 }[ rar ] ?? 0.5;
		for ( const p of def.parts ) B.part( holder, p.shape, [ p.pos[ 0 ] * k, ( p.pos[ 1 ] - len * 0.45 ) * k, p.pos[ 2 ] * k ], p.rot, p.scale.map( ( v ) => v * k ), p.color, { emissive: p.color === 'glow' ? emis : p.emissive, shine: p.shine || p.color === 'metal' } );
		return B.build( palette );

	}

	const B = builderFromPartList( def, type );
	if ( type === 'loot' && rar !== 'normal' ) {

		// rarer drops glow: boost every emissive part
		for ( const p of B.parts ) if ( p.color === 'glow' ) p.emissive = Math.max( p.emissive, 0.8 );

	}

	return B.build( palette );

}
