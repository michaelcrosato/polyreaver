# Working on Polyreaver as an AI agent

This is the field guide for an AI agent (or a person) who wants to add to, inspect or tune
Polyreaver. Polyreaver is built so that you rarely have to guess. Everything is a registered
def you can list, every system is reachable from a JSON command, and the whole game runs
headless in Node with a bot that plays it. The workflow this page teaches is a loop:

```
  read the contract  ->  define something  ->  look at it  ->  play it  ->  measure  ->  adjust
  (GAME.md, headers)     (registry def)        (Workshop,      (bot, sim)   (tables,     (one number,
                                                screenshots)                 events)      re-run)
```

`docs/GAME.md` is the contract: architecture, registry kinds, kernel, events, animation
vocabulary. Each feature's entry files (`features/<name>/sim.js` and `client.js`) start with
a map of the folder and the API the feature offers to the others. Read those first; they are
kept accurate.

---

## 1. The ten-minute orientation

```bash
npm install
npm run sim -- --depth 1-3            # the real game, headless: a bot plays depths 1-3
npm run build:game                    # -> polyreaver.html (one self-contained file)
npm run dev                           # http://localhost:5173/game.html
```

In Node, for any question about the game:

```js
import { Game } from './src/game/sim-entry.js';

const game = new Game( { seed: 'my-test', headless: true } );
game.enterLevel( 4 );
game.api( 'help' );                          // every command with its arguments
game.api( 'describe' );                      // mode, save summary, tuning, world summary
game.api( 'level.ascii', { entities: true } );   // the level as text: walls, hazards, monsters
game.api( 'entities', { kind: 'monster', near: { x: 0, z: 0, r: 20 } } );
game.api( 'inspect', { id: 42, stats: [ 'life', 'damage' ] } );   // live entity + stat breakdowns
game.api( 'step', { seconds: 5 } );          // advance the simulation
game.api( 'events', { n: 20, type: 'hit' } );    // what just happened
```

In the browser the same commands are `window.api( id, args )`, and the inspector (the ` key)
has a command box. Through the Claude link (section 6) they run on the player's real device.

Determinism: every random choice comes from a seeded RNG (`core/rng.js`, `rng.fork( label )`).
The same seed, depth and inputs give the same level and the same fight. The playtest bot has
its own RNG, so running it does not change the world's random sequence. Use explicit seeds
in tests (`new Game( { seed } )`, `#seed=abc` in the URL).

## 2. Looking at things: the Workshop

Procedural content has to be seen, not only described. The Workshop builds **lab worlds**:
quiet arenas with a labelled grid of frozen things to look at.

| Command | Shows |
|---|---|
| `lab.genomes { n, plan?, tags?, seed, size? }` | N random creature genomes: a Spore-style variety check |
| `lab.monsters { families?, depth?, n, rarity? }` | designed monster families, or families composed for an endless depth |
| `lab.bosses { depth?, n? }` | the twelve designed bosses, or composed bosses for a depth |
| `lab.actions { plan?, seed?, t }` | one body frozen in every action and state: animation review |
| `lab.models { ids?, tags?, type? }` | part-list models: props, loot, weapons |
| `lab.clear` | back to town |

Open it from the pause menu (**Workshop**) or with `#lab=workshop`. It also has a loot roller
and an in-browser balance table. Its gallery camera pans with WASD and zooms with the wheel.
For single creatures, use the **Creature Lab** (`#lab=creature`, or `game.creatureLab.open()`).
It is a genome editor with a turntable, a skeleton overlay, breeding (mutate, cross) and
contact sheets.

To get an image you can actually look at:
- **Headless Chromium** (any machine): `node scripts/game-smoke.mjs --shots dir/`, or a short
  Playwright script calling `window.api( 'lab.monsters', … )` then `page.screenshot()`.
  SwiftShader is slow but faithful.
- **The player's real GPU**: the Claude link's `screenshot` command (section 6).

Lab entities are frozen: no controller, `flags.inert`, team neutral, optional pinned pose
`data.labPose = { state, action, phase, t }`. Labs are ordinary worlds (`world.kind === 'lab'`),
so `inspect`, `entities` and the renderer all work on them.

## 3. Recipes: adding content

Every recipe is "call `define( kind, def )` in the owning feature's folder, then look at it,
then play it". Redefining an existing id replaces it, so a later def is how you override one.
Generators pick content by **tags** (`query( kind, { tags, any, none, level } )`). Tagging a def
well is what lets the procedural systems use it.

### A monster family (`features/monsters/families.js`)
```js
family( { id: 'bog-witch', name: 'Bog Witch', element: 'chaos', tags: [ 'chaos', 'caster', 'swamp' ],
	depths: [ 12 ], themes: [ 'blightmarsh' ], mechanics: [ 'miasma' ], level: 12,
	desc: 'Hags that brew clouds from the bog and curse whoever stands in them.',
	genome: { plans: [ 'biped' ], size: [ 0.9, 1.05 ], tags: [ 'hood', 'glow' ] }, palette: PAL.blight,
	archetypes: { caster: 3, summoner: 1 }, abilities: [ 'bolt', 'poison-cloud', 'summon' ], pack: [ 2, 4 ] } );
```
The body is generated from `genome` constraints, so you never model a monster by hand.
Behaviour comes from **archetypes** (`archetypes.js`: chaser, charger, kiter, caster,
summoner…), and **abilities** are `monsterAbility` defs. Check it with
`lab.monsters { families: [ 'bog-witch' ] }`, then `monsters.spawn { family: 'bog-witch', count: 5 }`
in a level. The endless composer (`compose.js`) mixes families, palettes and archetypes on its
own once your family has good tags.

### A body part or body plan (`features/creatures/parts.js`, `plans.js`)
A part dresses the **anchors** of a slot (horns, tail, wings…) with primitives. Colours are
palette keys, so the part works in every palette. Keep monsters around 20-35 primitives.
Then run `lab.genomes { n: 48, tags: [ 'your-tag' ] }` and look at the sheet.

### A skill or support (`features/combat/skills-*.js`, `supports.js`)
Copy a neighbour. `ground-slam` in `skills-melee.js` is a complete melee area skill in 15 lines:
- **Hit numbers:** `hits: { main: () => ( { eff, knockback, stun } ) }`.
- **Timeline:** `action( level, ctx )` returns it: `anim`, `windup`, `active`, `cancelAt`, and
  `events` that call `world.area / world.projectile / world.melee`.
- **Values:** `ctx` carries the scaled values (`ctx.radius`, `ctx.element`, `ctx.hit()`).

Supports are stat modifiers scoped to one skill (`mods( level )`), or behaviour changes on
the context (`transform( ctx )`). Check the numbers with
`game.api( 'combat.tooltip', { id: 'your-skill' } )`, cast it with `combat.cast`, and give it
to the bot by putting it in `save.skills.bar`.

### An item base, affix or unique (`features/progression/data/*.js`)
Each file starts with its def shape:
- **Affixes:** roll on bases by tag and have tiers by item level.
- **Uniques:** fixed lines plus a signature `mechanic` built from hooks (`kill`, `hit`, `crit`,
  `dodge`…) with helpers like `ctx.nova()`.
- **Checking them:** roll with `loot.roll { n: 20, level: 60 }`, read the distributions with
  `loot.sim { n: 5000, level: 40 }`, and equip with `items.give { unique, equip: true }`.

### A level mechanic (`features/world/mechanics/`)
The runtime header (`mechanics/index.js`) lists the hooks. They run in this order:
1. `decorate` at layout time.
2. `setup` at world start.
3. `preMove`, `postMove` and `postEffects` around movement.
4. `update` for the main tick.
5. `field` to say what the mechanic does at a point, which other mechanics can read.
6. `describe` to give agents its state.

Shared helpers (props, hazard hits, blasts, free spots) live in `mechanics/kit.js`. Two rules:
- **The contract with players.** A casual player must be able to ignore the mechanic and
  still clear the level. An expert must be able to exploit it. Write both in the header, as
  the existing twelve do.
- **Combinations.** List `combinesWith` and `conflicts`. Endless levels pick pairs and trios
  from these, and `words` names them ("Molten" + "Kegs").

Test the mechanic with:
- `mechanic.describe { id }`, plus `world.state.mech[ id ]` for its live state;
- `level.enter` at its depth, then `level.ascii`;
- the bot (section 4): if the bot can't clear it, a casual player probably can't either.

### A campaign level (`features/world/levels.js`)
`L( depth, id, name, theme, mechanics, generator, families, boss, bossName, desc, extra )`.
Past depth 20 the endless provider composes everything. To change what endless produces,
change the parts (mechanic `combinesWith`, family tags, palettes), not a level list.

### An agent command (`apiCommand`, any feature)
```js
define( 'apiCommand', { id: 'myfeature.thing', desc: 'One line for help', args: { n: 'count' },
	run( game, { n = 5 } ) {

		return { ok: true, n };   // plain JSON only: it crosses Node, the console and the Claude link

	} } );
```
Put it in the feature's sim side when it doesn't need the DOM, so it works headless.

### A UI panel (`uiPanel`, client side)
`{ id, order, toggle?, modal?, pauseButton?, mount( ui ) -> el, update( ui, game, dt ), onOpen, onClose }`.
`pauseButton: 'Label'` adds a button to the pause menu. Panels must not cover the HUD
regions of other features. The smoke test opens every panel, so a broken panel fails CI.

## 4. Playing and measuring: the bot and the balance sim

The playtest bot (`features/tools/bot.js`) plays through the **same input state** a person
uses (`game.input.move / aim / held / pressed`). It never pokes the simulation, so anything
it gets stuck on, a player can get stuck on too. In priority order it:
1. dodges telegraphs;
2. drinks potions;
3. fights (sticky targets, skills from the bar);
4. picks up loot;
5. explores room by room with the boss room last (`rush: true` goes there first), then
   hunts whatever is left so the exit opens.

It skips targets it can't reach and goals it gets stuck on.

```bash
npm run sim -- --depth 1-20 --seconds 240        # campaign table (kill time, damage taken, clears)
npm run sim -- --depth 30 --naked                 # starter gear only (default: player.kit)
```

`player.kit { level }` turns the character into a **stand-in for someone who has played to that
level**:
- rare gear it can actually use, picked as the best of a few rolls per slot;
- passives spent greedily on life, damage and defences;
- bar skills at the level cap.

Without it a balance sim measures a naked character and every number lies.

What to look at:
- **Clears.** Every campaign depth should clear with the kit in roughly 1-3 minutes. A
  timeout with few enemies left usually means a navigation or level-flow bug, not difficulty.
- **Deaths.** Look at what killed the bot. Listen to `world.events.on( 'hit', … )` and
  `'dot'` and sum damage by `source.data.family` and `skill`. That is how the Miasma fog was
  found to deal 85% of the damage.
- **The curve.** `monsterScaling( level )` in `core/tuning.js` against the kit's DPS and life
  at levels 1-100. Kill time and hits-to-die should stay within a few times of level 1 until
  about level 100; past that, endless is supposed to become a wall.

When you change a number, re-run the same seeds and compare. The Workshop's balance table
runs the same simulation in the browser.

## 5. Rules that keep the engine whole

- **Sim and client stay apart.** `sim.js` files and everything they import: no three.js, no
  DOM, no `window`. They run in Node. Rendering reads entities and events and never writes the
  simulation.
- **Namespace world state.** Use `world.state.<yourFeature…>`. Two features once both used
  `world.state.flow`, and the level timer showed `NaN:0NaN`.
- **Phone limits.** WebGPU only. At most 8 storage buffers per shader stage. Instance
  anything numerous (the rig renderer draws every creature, hero, prop and loot item in 13
  instanced draws).
- **TSL traps found the hard way:**
  - Integer codes passed as instance attributes arrive interpolated, so round them before
    comparing.
  - A value used inside several `If` blocks must be `.toVar()`'d first.
- **Style.** three.js "mdcs": tabs, `foo( a, b )`, a blank line after an opening function
  brace and before the closing one. Comments are teaching notes; keep them true when you
  change the code.
- **Testing policy.** `npm run lint` always. Run `npm run smoke:game` (or the sim) when a
  change could break rendering or the simulation. CI runs lint, both builds and a short sim
  on every push, and the full smoke tests nightly.

## 6. The player's real device: the Claude link

When `polyreaver.html` runs as a claude.ai artifact (capabilities `db`, `user`, `assets`), an
agent can drive it on the player's real GPU through the artifact's database. Queue
`commands/<id>` = `{ cmd, args, status: 'pending' }`, then read `results/<id>`:

| cmd | does |
|---|---|
| `ping` | device and game summary |
| `api { id, args }` | any `game.api` command, live |
| `play { seconds, depth? }` | the bot plays live; returns its report plus real frame-time statistics |
| `perf { seconds }` | frame times of whatever is on screen |
| `screenshot` | the current frame, stored as an artifact asset (read it with the Artifact tool) |
| `sequence { steps }` | several of the above in order |

Only this fixed set exists, and nothing from the database is evaluated as code. The tab
must be in the foreground. The engine benchmark (`webgpu-crowd-stress.html`, `src/bridge.js`)
uses the same protocol with benchmark commands, and its notes on GPU timing apply here too.
A lightly loaded desktop GPU lowers its clocks, so compare settings under real load.

## 7. Other game types

Polyreaver is one game, but the pieces are not tied to it:

- **Perspective.** The combat camera already has isometric, over-the-shoulder (pointer lock)
  and top-down views (V key, `combat.camera`). A twin-stick shooter is the top view plus
  projectile skills.
- **Horde survival** is implemented as the worked example:
  - `features/examples/horde.js` (about 130 lines): a level spec with `mode: 'horde'`, a
    `worldHook` that makes the monster director stand down, a wave-director `system`, and
    the `mode.horde` command;
  - `features/examples/client.js`: a pause-menu panel to start it.

  It changes nothing in the other features. Copy it to start a new mode.
- **Hordes of thousands.** The Swarm mechanic (data-oriented arrays plus a flow field) and
  the GPU crowd (`src/crowd`) scale to thousands of agents. Use them for RTS-style crowds or
  ambient life (the town's townsfolk are the crowd engine).
- **Creature games.** The genome system (`generateGenome`, `mutateGenome`, `crossGenomes`)
  is a complete Spore-style breeding toy on its own. The Creature Lab is most of a creature
  editor.
- **Puzzle and physics.** The level mechanics (`field()`, props, kegs, conduits, rifts) are
  small rule systems. A puzzle game is mechanics with the monsters turned down (the debug
  menu's sliders).

When you build one, keep the same discipline: content as registered defs, a sim that runs in
Node, an `apiCommand` for everything an agent would want to ask, and a bot that can play it.
