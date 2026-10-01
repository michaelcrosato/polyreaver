// Global tuning: the difficulty sliders in the pause / debug menu, plus the
// constants the whole game agrees on. Multipliers are applied at ONE place each
// (combat.js for damage, entity creation for life, movement for speed) so a slider
// always means exactly what its label says.

export const TUNING_DEFAULTS = {
	playerDamage: 1, playerLife: 1, playerSpeed: 1,
	enemyDamage: 1, enemyLife: 1, enemySpeed: 1,
	enemyDensity: 1, lootQuantity: 1, lootRarity: 1, xpGain: 1, goldGain: 1,
	gameSpeed: 1, godMode: false, oneShot: false
};

// Shown in the debug menu in this order. Agents can read this list to know which
// knobs exist ( game.api.call( 'tuning.set', { enemyLife: 2 } ) ).
export const TUNING_SLIDERS = [
	{ key: 'playerDamage', label: 'Player damage', min: 0.1, max: 10, step: 0.05, log: true },
	{ key: 'playerLife', label: 'Player life', min: 0.1, max: 10, step: 0.05, log: true },
	{ key: 'playerSpeed', label: 'Player speed', min: 0.5, max: 2.5, step: 0.05 },
	{ key: 'enemyDamage', label: 'Enemy damage', min: 0.1, max: 10, step: 0.05, log: true },
	{ key: 'enemyLife', label: 'Enemy life', min: 0.1, max: 10, step: 0.05, log: true },
	{ key: 'enemySpeed', label: 'Enemy speed', min: 0.3, max: 2.5, step: 0.05 },
	{ key: 'enemyDensity', label: 'Enemy density', min: 0.2, max: 4, step: 0.05 },
	{ key: 'lootQuantity', label: 'Loot quantity', min: 0, max: 10, step: 0.1 },
	{ key: 'lootRarity', label: 'Loot rarity', min: 0, max: 10, step: 0.1 },
	{ key: 'xpGain', label: 'XP gain', min: 0, max: 20, step: 0.1 },
	{ key: 'goldGain', label: 'Gold gain', min: 0, max: 20, step: 0.1 },
	{ key: 'gameSpeed', label: 'Game speed', min: 0.1, max: 3, step: 0.05 },
	{ key: 'godMode', label: 'God mode (no damage taken)', type: 'toggle' },
	{ key: 'oneShot', label: 'One-shot enemies', type: 'toggle' }
];

export const SIM_HZ = 60; // fixed simulation rate; rendering interpolates between steps
export const TEAM = { PLAYER: 0, ENEMY: 1, NEUTRAL: 2 };

// Monster level -> stat multipliers. Exponential so the game scales forever:
// level 100 monsters have ~550x the life of level 1 ones, and the player keeps up
// through gear tiers and the tree (balanced by scripts/sim.mjs).
export function monsterScaling( level ) {

	const l = Math.max( 1, level );
	return {
		life: Math.pow( 1.065, l - 1 ) * ( 1 + ( l - 1 ) * 0.04 ),
		damage: Math.pow( 1.055, l - 1 ) * ( 1 + ( l - 1 ) * 0.02 ),
		xp: Math.pow( 1.06, l - 1 ) * ( 1 + ( l - 1 ) * 0.05 ),
		armor: 5 * l,
		res: Math.min( 40, Math.floor( l / 3 ) )
	};

}

// XP needed to go from `level` to level + 1.
export function xpToNext( level ) {

	return Math.round( 120 * Math.pow( level, 1.85 ) + 80 * level );

}
