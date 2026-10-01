// Shared handles between the skill-bar HUD (which builds the on-screen touch
// controls) and the input layer (which listens to them). The HUD mounts first
// ( ui.init() ), then main.js installs the input provider, which binds these.

export const touchUI = {
	root: null, // the touch overlay element (shown / hidden by the HUD)
	stickBase: null, // left virtual stick visuals
	stickKnob: null,
	buttons: [], // [ { el, action } ] - attack, skill1..5, dodge, potion
	visible: false
};

// Screen-space drag on a skill button -> where the skill should aim (set by input.js,
// drawn by fx.js as a ground preview): game.input.touchAim = { active, x, z, skill }.
