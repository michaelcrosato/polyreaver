// Styles for every progression panel. Colours come from the CSS variables in
// game.html (--fg, --dim, --accent, --magic, --rare, --unique ...) and panels use
// near-opaque backgrounds so text stays readable over a bright level (contrast
// matters: text is >= 7:1 on the panel background, dropdowns are styled explicitly).
// All class names start with `pg-` to stay out of other features' way.

export const CSS = `
.pg-panel { position: absolute; background: rgba(11, 13, 19, 0.97); border: 1px solid #3a4458; border-radius: 10px; padding: 10px 12px;
	color: var(--fg); font-size: 13px; line-height: 1.35; box-shadow: 0 10px 40px rgba(0,0,0,0.6); pointer-events: auto;
	max-height: calc(100vh - 16px); max-height: calc(100dvh - 16px); overflow: auto; overscroll-behavior: contain; }
.pg-panel h2 { font-size: 17px; margin: 0; letter-spacing: 0.03em; }
.pg-panel h3 { font-size: 13px; margin: 10px 0 6px; color: var(--accent); text-transform: uppercase; letter-spacing: 0.08em; }
.pg-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.pg-head .pg-grow { flex: 1; }
.pg-x { width: 30px; height: 30px; padding: 0; font-size: 16px; line-height: 1; flex: none; }
.pg-gold { color: #ffd34d; font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }
.pg-dim { color: var(--dim); }
.pg-small { font-size: 12px; }
.pg-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.pg-cols { display: flex; gap: 14px; align-items: flex-start; flex-wrap: wrap; }
.pg-cols > * { flex: 1 1 320px; min-width: 0; }
.pg-btn { font: inherit; color: var(--fg); background: #1b2230; border: 1px solid #46516a; border-radius: 7px; padding: 6px 11px; cursor: pointer; }
.pg-btn:hover:not(:disabled) { border-color: var(--accent); background: #232c3d; }
.pg-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.pg-btn.pg-on { border-color: var(--accent); color: var(--accent); background: #2a2614; }
.pg-btn.pg-primary { background: #3a2f10; border-color: #c9a227; color: #ffe08a; }
.pg-tabs { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 8px; }
.pg-select { font: inherit; color: var(--fg); background: #1b2230; border: 1px solid #46516a; border-radius: 6px; padding: 4px 6px; color-scheme: dark; }
.pg-select option { background: #1b2230; color: #eef1f6; }
.pg-input { font: inherit; color: var(--fg); background: #1b2230; border: 1px solid #46516a; border-radius: 6px; padding: 5px 8px; min-width: 0; }
.pg-input::placeholder { color: #8a93a6; }

/* item grids and cells */
.pg-grid { display: grid; grid-template-columns: repeat(10, minmax(0, 1fr)); gap: 3px; }
.pg-cell { position: relative; aspect-ratio: 1; background: #121722; border: 1px solid #2b3345; border-radius: 5px; min-width: 0; touch-action: none; }
.pg-cell.pg-has { cursor: pointer; }
.pg-cell.pg-has:hover, .pg-cell.pg-drop { border-color: #c8d2e8; }
.pg-cell img { position: absolute; inset: 6%; width: 88%; height: 88%; image-rendering: auto; pointer-events: none; }
.pg-cell.r-normal { background: #171b24; border-color: #4b5262; }
.pg-cell.r-magic { background: linear-gradient(160deg, #18213a, #121722); border-color: #4f6fc4; }
.pg-cell.r-rare { background: linear-gradient(160deg, #2c2610, #121722); border-color: #b99a2c; }
.pg-cell.r-unique { background: linear-gradient(160deg, #331c0c, #121722); border-color: #d8782a; box-shadow: inset 0 0 8px rgba(255,140,40,0.35); }
.pg-cell.pg-bad::after { content: ''; position: absolute; inset: 0; background: rgba(200, 30, 30, 0.28); border-radius: 4px; pointer-events: none; }
.pg-cell.pg-sel { outline: 2px solid var(--accent); outline-offset: 1px; }
.pg-cell .pg-badge { position: absolute; right: 2px; bottom: 1px; font-size: 10px; font-weight: 700; color: #fff; text-shadow: 0 1px 2px #000, 0 0 3px #000; pointer-events: none; }
.pg-cell .pg-slotname { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; text-align: center; font-size: 10px; color: #6f7a90; pointer-events: none; padding: 2px; }
.pg-cell .pg-charge { position: absolute; left: 3px; right: 3px; bottom: 2px; height: 4px; background: rgba(0,0,0,0.7); border-radius: 2px; overflow: hidden; pointer-events: none; }
.pg-cell .pg-charge > i { display: block; height: 100%; background: #e0e6f0; }
.pg-ghost { position: fixed; width: 52px; height: 52px; pointer-events: none; z-index: 60; opacity: 0.9; transform: translate(-50%, -50%); }

/* equipment doll */
.pg-doll { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); grid-template-rows: repeat(3, auto); gap: 5px; max-width: 300px; margin: 0 auto 8px; }
.pg-doll .pg-cell { aspect-ratio: 1; }
.pg-doll .s-weapon { grid-column: 1; grid-row: 1 / span 2; aspect-ratio: auto; }
.pg-doll .s-offhand { grid-column: 4; grid-row: 1 / span 2; aspect-ratio: auto; }
.pg-flaskrow { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 5px; max-width: 220px; margin: 0 auto 8px; }
.pg-flaskrow .pg-cell { aspect-ratio: 0.75; }
.pg-curr { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
.pg-orb { display: flex; align-items: center; gap: 3px; background: #151a25; border: 1px solid #2f3749; border-radius: 6px; padding: 2px 6px 2px 2px; font-size: 12px; font-variant-numeric: tabular-nums; }
.pg-orb img { width: 22px; height: 22px; }
.pg-orb.pg-pick { cursor: pointer; }
.pg-orb.pg-pick:hover { border-color: #c8d2e8; }
.pg-orb.pg-off { opacity: 0.4; }
.pg-orb.pg-sel { border-color: var(--accent); background: #2a2614; }

/* tooltips */
.pg-tip { position: fixed; z-index: 70; width: min(360px, 94vw); background: #07090d; border: 1px solid #555; border-radius: 6px; color: #e6e9ef;
	font-size: 13px; line-height: 1.35; pointer-events: none; box-shadow: 0 8px 30px rgba(0,0,0,0.75); }
.pg-tip.pg-pinned { pointer-events: auto; }
.pg-tip .t-head { padding: 7px 10px 6px; text-align: center; font-weight: 700; font-size: 15px; border-bottom: 1px solid #333; border-radius: 6px 6px 0 0; }
.pg-tip .t-head .t-base { display: block; font-size: 13px; font-weight: 600; }
.pg-tip .t-body { padding: 6px 10px 8px; text-align: center; }
.pg-tip .t-sep { height: 1px; margin: 6px 12px; background: linear-gradient(90deg, transparent, #6b5a3a, transparent); }
.pg-tip .t-prop { color: #9aa3b5; }
.pg-tip .t-prop b { color: #fff; font-weight: 600; }
.pg-tip .t-req { color: #9aa3b5; font-size: 12px; }
.pg-tip .t-req .bad { color: #ff6b6b; font-weight: 700; }
.pg-tip .t-imp { color: #b9c7ff; }
.pg-tip .t-mod { color: #8fb0ff; display: flex; justify-content: center; gap: 6px; }
.pg-tip .t-mod .t-tier { color: #6f7a90; font-size: 10px; align-self: center; white-space: nowrap; }
.pg-tip .t-mech { color: #ffb35a; }
.pg-tip .t-flav { color: #b78b5a; font-style: italic; font-size: 12px; }
.pg-tip .t-corrupt { color: #ff5050; font-weight: 700; }
.pg-tip .t-cmp { text-align: left; font-size: 12px; }
.pg-tip .t-cmp .up { color: #6fe08a; }
.pg-tip .t-cmp .down { color: #ff6b6b; }
.pg-tip .t-foot { color: #7f889b; font-size: 11px; margin-top: 4px; }
.pg-tip .t-actions { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; padding: 0 10px 10px; }
.pg-tip.r-normal { border-color: #8a8f99; } .pg-tip.r-normal .t-head { background: #1d2028; color: #e8e8e8; }
.pg-tip.r-magic { border-color: #5a7fd8; } .pg-tip.r-magic .t-head { background: #141c33; color: #8fb0ff; }
.pg-tip.r-rare { border-color: #c9a227; } .pg-tip.r-rare .t-head { background: #2a2410; color: #ffe066; }
.pg-tip.r-unique { border-color: #d8782a; } .pg-tip.r-unique .t-head { background: #2e1a0c; color: #ff9a3c; }
.pg-tip.r-plain .t-head { background: #182030; color: #ffe08a; }
.pg-tip .t-left { text-align: left; }

/* lists */
.pg-list { display: grid; gap: 4px; }
.pg-li { display: flex; align-items: center; gap: 8px; padding: 5px 7px; background: #141924; border: 1px solid #2a3142; border-radius: 6px; }
.pg-li.pg-click { cursor: pointer; }
.pg-li.pg-click:hover { border-color: #8090b0; }
.pg-li.pg-sel { border-color: var(--accent); background: #221f12; }
.pg-li .pg-grow { flex: 1; min-width: 0; }
.pg-stat { display: flex; justify-content: space-between; gap: 8px; padding: 2px 4px; border-radius: 4px; cursor: help; }
.pg-stat:hover { background: #1b2230; }
.pg-stat b { font-variant-numeric: tabular-nums; color: #fff; }
.pg-stat .pg-capped { color: #6fe08a; }
.pg-stat .pg-uncap { color: #ffb35a; }

/* HUD */
/* the belt sits left of the skill bar (combat HUD, ~470px wide, centred); on narrow
   screens and phones it sits under the life / mana bars (top-left in touch mode),
   away from the touch controls */
.pg-hud-flasks { position: absolute; left: calc(50% - 246px); transform: translateX(-100%); bottom: calc(max(14px, env(safe-area-inset-bottom)) + 48px);
	display: flex; gap: 6px; align-items: flex-end; pointer-events: none; }
@media (max-width: 820px), (pointer: coarse) {
	.pg-hud-flasks { left: max(10px, env(safe-area-inset-left)); top: calc(max(8px, env(safe-area-inset-top)) + 122px); bottom: auto; transform: none; align-items: flex-start; }
	.pg-hud-flasks .pg-buffs, .pg-hud-flasks .pg-points { order: 1; }
}
.pg-flask { pointer-events: auto; width: 30px; height: 44px; position: relative; background: rgba(0,0,0,0.6); border: 1px solid #4b5262; border-radius: 6px 6px 9px 9px; cursor: pointer; overflow: hidden; touch-action: manipulation; }
.pg-flask > i { position: absolute; left: 0; right: 0; bottom: 0; }
.pg-flask.pg-ready { border-color: #c8d2e8; }
.pg-flask.pg-active { box-shadow: 0 0 10px 2px rgba(255,255,255,0.45); }
.pg-flask span { position: absolute; top: 1px; left: 0; right: 0; text-align: center; font-size: 10px; font-weight: 700; text-shadow: 0 1px 2px #000; }
.pg-flask.pg-empty { opacity: 0.35; }
.pg-buffs { display: flex; gap: 4px; margin-left: 8px; pointer-events: none; }
.pg-buff { min-width: 26px; height: 26px; padding: 0 4px; border-radius: 6px; background: rgba(20,24,34,0.85); border: 1px solid #7a6a3a; font-size: 10px; font-weight: 700; display: flex; align-items: center; justify-content: center; color: #ffe08a; position: relative; overflow: hidden; }
.pg-buff > i { position: absolute; left: 0; bottom: 0; height: 2px; background: #ffd34d; }
.pg-points { pointer-events: auto; cursor: pointer; margin-left: 8px; padding: 4px 8px; border-radius: 12px; background: #3a2f10; border: 1px solid #c9a227; color: #ffe08a; font-weight: 700; font-size: 12px; animation: pg-pulse 1.6s ease-in-out infinite; white-space: nowrap; }
@keyframes pg-pulse { 50% { box-shadow: 0 0 12px rgba(255, 210, 80, 0.7); } }
.pg-menu { position: absolute; top: max(8px, env(safe-area-inset-top)); right: max(8px, env(safe-area-inset-right)); display: flex; gap: 5px; pointer-events: auto; }
.pg-menu button { width: 38px; height: 38px; padding: 0; font-size: 11px; font-weight: 700; background: rgba(20,24,34,0.85); border: 1px solid #46516a; border-radius: 8px; color: #dfe5f0; }
.pg-menu button .k { display: block; font-size: 9px; color: #8a93a6; font-weight: 600; }
.pg-labels { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.pg-label { position: absolute; left: 0; top: 0; padding: 2px 6px; border-radius: 4px; background: rgba(6, 8, 12, 0.86); border: 1px solid #333; font-size: 12px; font-weight: 600;
	white-space: nowrap; pointer-events: auto; cursor: pointer; transform: translate(-50%, -100%); will-change: transform; }
.pg-label:hover { background: rgba(30, 36, 50, 0.95); border-color: #ddd; }
.pg-label.l-gold { font-size: 11px; color: #ffd34d; border-color: #5a4a1a; }
.pg-label.l-normal { color: #e8e8e8; border-color: #555; }
.pg-label.l-magic { color: #8fb0ff; border-color: #3a5aa8; }
.pg-label.l-rare { color: #ffe066; border-color: #a8902a; }
.pg-label.l-unique { color: #ff9a3c; border-color: #d8782a; background: rgba(40, 18, 4, 0.92); }
.pg-label.l-currency { color: #f0dfa8; border-color: #6a5a3a; }
.pg-label.l-rune { color: #6fe0c8; border-color: #2a6a5a; }
.pg-feed { position: absolute; right: max(10px, env(safe-area-inset-right)); bottom: 120px; display: flex; flex-direction: column; align-items: flex-end; gap: 3px; pointer-events: none; }
.pg-feed div { background: rgba(6,8,12,0.8); border-radius: 4px; padding: 2px 7px; font-size: 12px; font-weight: 600; transition: opacity 0.6s; }
.toast.unique { color: var(--unique); border-color: #d8782a; }
.toast.rare { color: var(--rare); }

/* panels placement */
.pg-inv { right: max(8px, env(safe-area-inset-right)); top: 8px; width: min(440px, calc(100vw - 16px)); }
.pg-char { left: max(8px, env(safe-area-inset-left)); top: 8px; width: min(380px, calc(100vw - 16px)); }
.pg-center { left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(900px, calc(100vw - 16px)); }
.pg-full { inset: 6px; padding: 0; display: flex; flex-direction: column; overflow: hidden; max-height: none; }

/* passive tree */
.pg-tree-bar { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid #2a3142; flex-wrap: wrap; }
.pg-tree-wrap { position: relative; flex: 1; min-height: 0; }
.pg-tree-wrap canvas { position: absolute; inset: 0; width: 100%; height: 100%; touch-action: none; cursor: grab; display: block; }
.pg-tree-wrap canvas.pg-grabbing { cursor: grabbing; }
.pg-tree-side { position: absolute; top: 8px; left: 8px; width: min(300px, calc(100% - 16px)); max-height: calc(100% - 16px); overflow: auto; background: rgba(8,10,15,0.94);
	border: 1px solid #2f3749; border-radius: 8px; padding: 8px 10px; font-size: 12px; }
.pg-tree-side .pg-modline { color: #b9c7ff; }
.pg-tree-points { font-weight: 800; color: #ffe08a; font-size: 15px; }
.pg-tree-hint { position: absolute; bottom: 8px; left: 50%; transform: translateX(-50%); font-size: 12px; color: #a9b1c2; background: rgba(8,10,15,0.85); padding: 3px 10px; border-radius: 10px; pointer-events: none; white-space: nowrap; max-width: 96%; overflow: hidden; text-overflow: ellipsis; }
.pg-asc-cards { position: absolute; inset: 0; display: flex; gap: 12px; align-items: center; justify-content: center; flex-wrap: wrap; padding: 16px; overflow: auto; }
.pg-asc-card { width: min(260px, 90%); background: #121722; border: 1px solid #3a4458; border-radius: 10px; padding: 12px; }
.pg-asc-card h3 { margin-top: 0; }

/* skills */
.pg-bar { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 6px; max-width: 420px; }
.pg-skill { position: relative; aspect-ratio: 1; border-radius: 8px; border: 1px solid #46516a; background: #151a25; display: flex; align-items: center; justify-content: center; text-align: center;
	font-size: 11px; font-weight: 700; cursor: pointer; padding: 3px; overflow: hidden; }
.pg-skill .k { position: absolute; top: 2px; left: 4px; font-size: 9px; color: #8a93a6; }
.pg-skill.pg-sel { outline: 2px solid var(--accent); }
.pg-skill .lv { position: absolute; bottom: 2px; right: 4px; font-size: 9px; color: #cfd6e4; }
.pg-xp { height: 4px; background: #222a38; border-radius: 2px; overflow: hidden; margin-top: 3px; }
.pg-xp > i { display: block; height: 100%; background: var(--xp); }
.pg-sock { display: inline-flex; align-items: center; gap: 4px; padding: 3px 7px; border-radius: 12px; border: 1px dashed #4b5262; color: #8a93a6; font-size: 12px; }
.pg-sock.pg-full { border-style: solid; border-color: #3fa88a; color: #6fe0c8; cursor: pointer; }
.pg-tag { display: inline-block; font-size: 10px; padding: 0 5px; border-radius: 8px; background: #222a38; color: #b8c2d6; margin: 1px 2px 1px 0; }

@media (max-width: 600px) {
	.pg-panel { font-size: 12px; padding: 8px; }
	.pg-center { top: 6px; transform: translateX(-50%); max-height: calc(100dvh - 12px); }
	.pg-inv, .pg-char { top: 6px; left: 6px; right: 6px; width: auto; max-height: calc(100dvh - 120px); }
	.pg-grid { gap: 2px; }
	.pg-tip { font-size: 12px; }
	.pg-menu button { width: 34px; height: 34px; }
	.pg-feed { bottom: 140px; }
}
`;

let injected = false;

export function injectCss() {

	if ( injected ) return;
	injected = true;
	const el = document.createElement( 'style' );
	el.textContent = CSS;
	document.head.append( el );

}
