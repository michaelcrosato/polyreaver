// The build planner deliberately has its own state and DOM. It never shares the
// live tree panel's allocation/refund handlers or inventory drag/drop handlers.
import { define, get, all } from '../../../core/registry.js';
import { h } from '../../../ui/shell.js';
import { btn } from './common.js';
import { getTree, START_INFO, pathTo, canRefund, pointsTotal, ascPointsTotal } from '../tree.js';
import { supportFits, supportSlots, maxSkillLevel } from '../skills.js';
import { SLOT_ACTIONS } from '../../combat/skill-core.js';
import { controlLabel } from '../../combat/client/controls.js';
import { SLOT_NAMES, SLOT_ACCEPTS, EQUIP_SLOTS } from '../data/bases.js';
import { itemName, computeItem } from '../items.js';
import { modsToLines } from '../text.js';
import { createBuildPlan, validateBuildPlan, evaluateBuildPlan, allocatePlannedPath, refundPlannedNode,
	ownedBuildItems, catalogBuildItem, encodeBuildPlan, decodeBuildPlan, MAX_BUILD_LEVEL } from '../planner.js';

const DRAFT_KEY = 'polyreaver.buildDraft.v1';
const copy = ( v ) => structuredClone( v );
const reqLevel = ( d ) => d.levelReq ?? d.level ?? 1;
const slotLabel = ( game, index ) => {

	const device = game.input.device, label = controlLabel( SLOT_ACTIONS[ index ], device === 'gamepad' ? 'gamepad' : 'keyboard' );
	return device === 'touch' || label === '—' ? `Slot ${index + 1}` : label;

};
const field = ( label, input ) => h( 'label', { style: { display: 'grid', gap: '4px', marginBottom: '8px' } }, h( 'span', { text: label } ), input );

function select( label, options, value, change ) {

	const el = h( 'select', { class: 'pg-select', 'aria-label': label }, options.map( ( [ id, name ] ) => h( 'option', { value: id, text: name } ) ) );
	el.value = value;
	el.addEventListener( 'change', () => change( el.value ) );
	return el;

}

define( 'uiPanel', { id: 'planner', order: 58, modal: true, startOpen: false, pauseButton: 'Build Planner',
	mount( ui ) {

		this.ui = ui; this.tab = 'passives'; this.query = '';
		this.nameInput = h( 'input', { class: 'pg-input', maxlength: 100, 'aria-label': 'Build name' } );
		this.levelInput = h( 'input', { class: 'pg-input', type: 'number', min: 1, max: MAX_BUILD_LEVEL, 'aria-label': 'Target character level' } );
		this.nameInput.addEventListener( 'change', () => this.edit( ( draft ) => { draft.name = this.nameInput.value; } ) );
		this.levelInput.addEventListener( 'change', () => this.edit( ( draft ) => { draft.level = Number( this.levelInput.value ); } ) );
		this.summary = h( 'div', { class: 'pg-dim', style: { marginBottom: '10px' } } );
		this.status = h( 'div', { role: 'status', 'aria-live': 'polite', style: { minHeight: '24px', marginBottom: '6px' } } );
		this.tabs = h( 'div', { class: 'pg-tabs', style: { marginBottom: '12px', gap: '6px' } } );
		for ( const [ id, name ] of [ [ 'passives', 'Passives' ], [ 'equipment', 'Equipment' ], [ 'skills', 'Skills & supports' ], [ 'stats', 'Stat comparison' ], [ 'share', 'Share / import' ] ] ) {

			const button = btn( name, () => { this.tab = id; this.render(); } );
			button.dataset.tab = id; this.tabs.append( button );

		}
		this.content = h( 'div' );
		return h( 'div', { class: 'pg-panel pg-center', role: 'dialog', 'aria-label': 'Build planner', style: { width: 'min(1050px, calc(100vw - 16px))' } },
			h( 'div', { class: 'pg-head' }, h( 'h2', { text: 'Build Planner' } ), h( 'span', { class: 'pg-grow' } ),
				btn( 'Reset to character', () => { this.plan = createBuildPlan( ui.game.save ); this.persist(); this.render(); this.say( 'Copied current character into the draft.' ); } ),
				h( 'button', { class: 'pg-btn', 'aria-label': 'Close build planner', onclick: () => ui.open( 'planner', false ) }, '✕' ) ),
			h( 'p', { class: 'pg-dim pg-small', text: 'Plan a future character with a separate draft. Passive allocations, gear and skills here never change your character.' } ),
			h( 'div', { class: 'pg-cols', style: { gap: '10px' } }, field( 'Build name', this.nameInput ), field( 'Target level', this.levelInput ) ),
			this.summary, this.tabs, this.status, this.content );

	},
	say( text, error = false ) {

		this.status.textContent = text;
		this.status.style.color = error ? '#ff8f8f' : '#8fdbb7';

	},
	persist() {

		try { localStorage.setItem( DRAFT_KEY, encodeBuildPlan( this.plan ) ); }
		catch { /* Sharing stays available when browser storage is unavailable. */ }

	},
	edit( change ) {

		try {

			const draft = copy( this.plan );
			const replacement = change( draft );
			const next = replacement ?? draft, result = validateBuildPlan( next );
			if ( ! result.ok ) throw new Error( result.errors.join( '; ' ) );
			this.plan = next; this.persist(); this.render(); this.say( 'Draft updated.' );

		} catch ( error ) { this.render(); this.say( error.message, true ); }

	},
	render() {

		if ( ! this.plan ) return;
		this.nameInput.value = this.plan.name; this.levelInput.value = this.plan.level;
		const result = evaluateBuildPlan( this.ui.game, this.plan ), p = result.points;
		this.summary.textContent = `Character level ${result.currentLevel} → planned level ${result.level} · ${p.spent} / ${p.total} passive points (${p.remaining} free) · ${p.shortfall} more than your current point budget · ${p.ascSpent} / ${p.ascTotal} ascendancy points`;
		for ( const button of this.tabs.children ) {

			button.setAttribute( 'aria-pressed', button.dataset.tab === this.tab ? 'true' : 'false' );
			button.classList.toggle( 'pg-on', button.dataset.tab === this.tab );

		}
		this.content.replaceChildren();
		this[ `render${this.tab[ 0 ].toUpperCase()}${this.tab.slice( 1 )}` ]( result );

	},
	renderPassives() {

		const T = getTree(), plan = this.plan;
		const region = select( 'Starting region', Object.entries( START_INFO ).map( ( [ id, info ] ) => [ id, info.name ] ), plan.tree.start, ( id ) => this.edit( ( draft ) => {

			draft.tree.start = id; draft.tree.allocated = [ `s.${id}` ];

		} ) );
		this.content.append( field( 'Starting region (changing this resets planned passives)', region ) );
		const search = h( 'input', { class: 'pg-input', type: 'search', placeholder: 'Search names, stats or node IDs', 'aria-label': 'Search planned passives', style: { width: '100%' } } );
		search.value = this.query;
		const results = h( 'div', { style: { maxHeight: '280px', overflow: 'auto', marginTop: '8px' } } );
		const renderResults = () => {

			results.replaceChildren();
			const q = this.query.trim().toLowerCase(), have = new Set( plan.tree.allocated ), budget = pointsTotal( plan.level, plan.tree.bonus ) - have.size + 1;
			const candidates = [ ...T.nodes.values() ].filter( ( n ) => ! have.has( n.id ) && ( q ? [ n.id, n.name, n.theme, ...modsToLines( n.mods || [] ), ...( n.lines || [] ) ].join( ' ' ).toLowerCase().includes( q ) : n.links.some( ( id ) => have.has( id ) ) ) ).slice( 0, 80 );
			for ( const n of candidates ) {

				const path = pathTo( { tree: plan.tree }, n.id );
				const button = btn( `Plan path · ${path.length} point${path.length === 1 ? '' : 's'}`, () => this.edit( ( draft ) => allocatePlannedPath( draft, n.id ) ), { disabled: path.length > budget } );
				results.append( h( 'div', { class: 'pg-li', style: { display: 'block' } }, h( 'strong', { text: `${n.name} (${n.id})` } ),
					h( 'div', { class: 'pg-dim pg-small', text: [ ...( n.lines || [] ), ...modsToLines( n.mods || [] ) ].join( ' · ' ) } ), button,
					path.length > budget ? h( 'span', { class: 'pg-dim pg-small', text: ` Raise target level: ${path.length} needed, ${budget} free.` } ) : null ) );

			}
			if ( ! candidates.length ) results.append( h( 'p', { text: 'No matching unplanned nodes.' } ) );

		};
		search.addEventListener( 'input', () => { this.query = search.value; renderResults(); } );
		renderResults();
		const allocated = h( 'div', { style: { maxHeight: '220px', overflow: 'auto' } } );
		for ( const id of plan.tree.allocated ) {

			const n = T.nodes.get( id ), why = canRefund( { tree: plan.tree }, id );
			allocated.append( h( 'div', { class: 'pg-li' }, h( 'span', { text: n.name } ), btn( 'Remove', () => this.edit( ( draft ) => refundPlannedNode( draft, id ) ), { disabled: !! why, title: why || 'Remove from draft' } ) ) );

		}
		this.content.append( h( 'div', { class: 'pg-cols' }, h( 'div', {}, h( 'h3', { text: 'Find a passive / plan shortest path' } ), search, results ),
			h( 'div', {}, h( 'h3', { text: 'Planned passives' } ), allocated ) ) );
		const asc = plan.tree.asc;
		const selector = select( 'Planned ascendancy', [ [ '', 'None' ], ...all( 'ascendancy' ).map( ( d ) => [ d.id, d.name ] ) ], asc.id || '', ( id ) => this.edit( ( draft ) => {

			draft.tree.asc = { id: id || null, allocated: id ? [ `${id}:root` ] : [] };

		} ) );
		this.content.append( h( 'h3', { text: 'Ascendancy' } ), field( 'Choosing an ascendancy resets its planned nodes', selector ) );
		if ( asc.id ) {

			const a = T.asc[ asc.id ], chosen = new Set( asc.allocated ), budget = ascPointsTotal( plan.level ) - chosen.size + 1;
			for ( const n of a.nodes.values() ) if ( n.type !== 'start' ) {

				const selected = chosen.has( n.id ), reachable = n.links.some( ( id ) => chosen.has( id ) );
				const dependents = selected && n.type === 'small' && n.links.some( ( id ) => chosen.has( id ) && a.nodes.get( id ).type === 'notable' );
				this.content.append( h( 'div', { class: 'pg-li' }, h( 'span', { text: `${n.name} · ${modsToLines( n.mods || [] ).join( ' · ' )}` } ),
					btn( selected ? 'Remove' : 'Plan', () => this.edit( ( draft ) => {

						draft.tree.asc.allocated = selected ? draft.tree.asc.allocated.filter( ( id ) => id !== n.id ) : [ ...draft.tree.asc.allocated, n.id ];

					} ), { disabled: selected ? dependents : ! reachable || budget <= 0 } ) ) );

			}

		}

	},
	renderEquipment( result ) {

		const owned = ownedBuildItems( this.ui.game.save );
		const ownedIds = new Set( owned.map( ( item ) => item.uid ) );
		this.content.append( h( 'p', { class: 'pg-dim pg-small', text: 'Choose owned gear, or plan catalog bases and uniques with median rolls. Unmet attributes disable an item in the preview; no items are moved or created in your character.' } ) );
		const grid = h( 'div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '10px' } } );
		for ( const slot of EQUIP_SLOTS ) {

			const compatible = ( b ) => SLOT_ACCEPTS[ slot ].includes( b.slot ) && ! ( slot === 'offhand' && b.hands === 2 );
			const current = this.plan.equipment[ slot ];
			const items = owned.filter( ( item ) => compatible( get( 'itemBase', item.base ) ) );
			if ( current && ! items.some( ( item ) => item.uid === current.uid ) ) items.unshift( current );
			const options = [ [ '', 'Empty' ], ...items.map( ( item, i ) => [ `owned:${i}`, `${ownedIds.has( item.uid ) ? 'Owned' : 'Planned'}: ${itemName( item )}` ] ),
				...all( 'itemBase' ).filter( compatible ).map( ( b ) => [ `base:${b.id}`, `Base: ${b.name} (level ${b.level})` ] ),
				...all( 'unique' ).filter( ( u ) => compatible( get( 'itemBase', u.base ) ) ).map( ( u ) => [ `unique:${u.id}`, `Unique: ${u.name} (level ${u.level})` ] ) ];
			const index = current ? items.findIndex( ( item ) => item.uid === current.uid ) : - 1;
			const sel = select( SLOT_NAMES[ slot ], options, index >= 0 ? `owned:${index}` : '', ( value ) => this.edit( ( draft ) => {

				if ( ! value ) { draft.equipment[ slot ] = null; return; }
				const [ kind, id ] = value.split( ':' );
				const item = kind === 'owned' ? copy( items[ Number( id ) ] ) : catalogBuildItem( id, slot, kind === 'unique' );
				for ( const other of EQUIP_SLOTS ) if ( other !== slot && draft.equipment[ other ]?.uid === item.uid ) draft.equipment[ other ] = null;
				draft.equipment[ slot ] = item;
				// Selecting a new main hand clears incompatible planned offhand gear,
				// just as normal equipment does, without touching the live inventory.
				const w = get( 'itemBase', draft.equipment.weapon?.base ), o = get( 'itemBase', draft.equipment.offhand?.base );
				if ( slot === 'weapon' && o && ( ( w?.hands === 2 && ! ( w.weaponClass === 'bow' && o.tags.includes( 'quiver' ) ) ) || ( o.tags.includes( 'quiver' ) && w?.weaponClass !== 'bow' ) ) ) draft.equipment.offhand = null;

			} ) );
			const c = current ? computeItem( current ) : null;
			grid.append( h( 'div', {}, field( `${SLOT_NAMES[ slot ]}${slot.startsWith( 'ring' ) ? ' ' + slot.slice( - 1 ) : ''}`, sel ),
				c ? h( 'div', { class: 'pg-dim pg-small', text: `Requires level ${c.req.level || 1}, STR ${c.req.str || 0}, DEX ${c.req.dex || 0}, INT ${c.req.int || 0}` } ) : null ) );

		}
		this.content.append( grid ); this.renderWarnings( result );

	},
	renderSkills( result ) {

		this.content.append( h( 'p', { class: 'pg-dim pg-small', text: 'Skill levels and support runes are planned assumptions. Missing runes and weapon requirements are shown below. DPS estimates describe one target before enemy mitigation.' } ) );
		for ( let i = 0; i < 6; i ++ ) {

			const id = this.plan.skills.bar[ i ], def = id ? get( 'skill', id ) : null;
			const choose = select( `Skill ${slotLabel( this.ui.game, i )}`, [ [ '', 'Empty' ], ...all( 'skill' ).filter( ( d ) => reqLevel( d ) <= this.plan.level ).map( ( d ) => [ d.id, d.name ] ) ], id || '', ( next ) => this.edit( ( draft ) => {

				if ( next ) {

					const previous = draft.skills.bar.indexOf( next );
					if ( previous >= 0 ) draft.skills.bar[ previous ] = null;
					draft.skills.levels[ next ] ??= maxSkillLevel( draft.level ); draft.skills.supports[ next ] ??= [];

				}
				draft.skills.bar[ i ] = next || null;
				for ( const key of Object.keys( draft.skills.levels ) ) if ( ! draft.skills.bar.includes( key ) ) { delete draft.skills.levels[ key ]; delete draft.skills.supports[ key ]; }

			} ) );
			const row = h( 'div', { class: 'pg-li', style: { display: 'block' } }, field( `Bar slot ${slotLabel( this.ui.game, i )}`, choose ) );
			if ( def ) {

				const level = h( 'input', { class: 'pg-input', type: 'number', min: 1, max: maxSkillLevel( this.plan.level ), 'aria-label': `${def.name} skill level` } );
				level.value = this.plan.skills.levels[ id ];
				level.addEventListener( 'change', () => this.edit( ( draft ) => { draft.skills.levels[ id ] = Number( level.value ); } ) );
				row.append( field( `Skill level (cap ${maxSkillLevel( this.plan.level )})`, level ) );
				const supports = this.plan.skills.supports[ id ];
				const supportBox = h( 'div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px' } } );
				for ( const sup of all( 'support' ).filter( ( sp ) => supportFits( def, sp ) && reqLevel( sp ) <= this.plan.level ) ) {

					const input = h( 'input', { type: 'checkbox', 'aria-label': `${def.name}: ${sup.name}` } );
					input.checked = supports.includes( sup.id );
					input.disabled = ! input.checked && supports.length >= supportSlots( { level: this.plan.level } );
					input.addEventListener( 'change', () => this.edit( ( draft ) => {

						draft.skills.supports[ id ] = input.checked ? [ ...draft.skills.supports[ id ], sup.id ] : draft.skills.supports[ id ].filter( ( s ) => s !== sup.id );

					} ) );
					supportBox.append( h( 'label', { title: sup.desc }, input, ' ', sup.name ) );

				}
				const preview = result.skills[ i ];
				const comparison = result.skillComparisons[ i ];
				const delta = comparison.current ? ` (${comparison.dpsDelta >= 0 ? '+' : ''}${comparison.dpsDelta.toFixed( 1 )} vs current ${def.name})` : ' (new skill)';
				row.append( h( 'p', { class: 'pg-dim pg-small', text: `${supports.length} / ${supportSlots( { level: this.plan.level } )} supports · estimated DPS ${preview.dps.toFixed( 1 )}${delta} · mana ${preview.manaCost} · ${preview.castTime.toFixed( 2 )}s per use` } ), supportBox );

			}
			this.content.append( row );

		}
		this.renderWarnings( result );

	},
	renderStats( result ) {

		const table = h( 'table', { style: { width: '100%', borderCollapse: 'collapse', textAlign: 'right' } },
			h( 'thead', {}, h( 'tr', {}, ...[ 'Stat', 'Current', 'Planned', 'Change' ].map( ( name ) => h( 'th', { scope: 'col', text: name } ) ) ) ) );
		const body = h( 'tbody' );
		for ( const stat of result.stats ) {

			const delta = stat.after - stat.before, fmt = ( n ) => n.toFixed( stat.decimals ) + stat.unit;
			body.append( h( 'tr', {}, h( 'th', { scope: 'row', text: stat.label, style: { textAlign: 'left', padding: '5px' } } ),
				h( 'td', { text: fmt( stat.before ) } ), h( 'td', { text: fmt( stat.after ) } ), h( 'td', { text: `${delta > 0 ? '+' : ''}${fmt( delta )}`, style: { color: delta > 0 ? '#8fdbb7' : delta < 0 ? '#ff8f8f' : 'inherit' } } ) ) );

		}
		table.append( body ); this.content.append( table ); this.renderWarnings( result );

	},
	renderWarnings( result ) {

		if ( result.warnings.length ) this.content.append( h( 'h3', { text: 'Requirements to meet' } ), h( 'ul', {}, result.warnings.map( ( text ) => h( 'li', { text } ) ) ) );

	},
	renderShare() {

		const code = encodeBuildPlan( this.plan );
		const text = h( 'textarea', { class: 'pg-input', rows: 7, spellcheck: 'false', 'aria-label': 'Build code', style: { width: '100%', resize: 'vertical', boxSizing: 'border-box' } } );
		text.value = code;
		this.content.append( h( 'p', { text: 'Copy this versioned build code to share your draft. Paste a code here and import it to replace only the draft. Build codes include equipped item rolls, passives, levels and skill supports.' } ), field( 'PRB1 build code', text ),
			h( 'div', { class: 'pg-cols', style: { gap: '8px' } }, btn( 'Copy build code', async () => {

				text.value = encodeBuildPlan( this.plan );
				try { await navigator.clipboard.writeText( text.value ); this.say( 'Build code copied.' ); }
				catch { text.focus(); text.select(); this.say( 'Build code selected. Copy it using your keyboard or touch menu.' ); }

			} ), btn( 'Import to draft', () => {

				try { this.plan = decodeBuildPlan( text.value ); this.persist(); this.render(); this.say( 'Build imported into the draft. Your character is unchanged.' ); }
				catch ( error ) { this.say( error.message, true ); }

			} ), btn( 'Select code', () => { text.focus(); text.select(); } ) ) );

	},
	onOpen() {

		if ( ! this.plan ) {

			try { const code = localStorage.getItem( DRAFT_KEY ); if ( code ) this.plan = decodeBuildPlan( code ); } catch { /* Ignore stale or unavailable draft storage. */ }
			this.plan ||= createBuildPlan( this.ui.game.save );

		}
		this.render(); this.say( 'Planning draft; your character is unchanged.' );

	}
} );
