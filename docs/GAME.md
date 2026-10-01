# Polyreaver — design language and engine contracts

Polyreaver is the showcase game for this engine: a fast, fluid isometric hack-and-slash with a deep
passive tree, Diablo IV / Path of Exile 2 style loot and progression, one named mechanic per level,
a town hub, and endless procedural depth built from Spore-style modular monsters. It is also a
**reference for AI agents**: everything is data, everything is registered, everything can be
inspected, generated and tested headless.

Build: `npm run build:game` → `polyreaver.html` (one self-contained file). Dev: `npm run dev` →
`http://localhost:5173/game.html`. Headless: `npm run sim`, `npm run smoke:game`.
**AI agents start with [`AGENTS.md`](AGENTS.md)**: recipes, the Workshop, the bot, balance, the Claude link.

Content today (`kindsList()`): 36 monster families, 14 archetypes, 42 monster abilities, 28 elite affixes,
12 bosses with 29 patterns, 8 body plans, 83 body parts, 152 models, 34 skills, 28 supports, 35 statuses,
165 item bases, 136 affixes, 35 uniques, 12 currencies, 1,483 passive nodes (58 clusters, 26 keystones,
3 ascendancies), 13 themes, 12 mechanics, 20 designed levels + endless, 58 agent commands.

---

## 1. Architecture

```
src/game/
  core/            SHARED KERNEL (renderer-agnostic, runs in Node) — rng, registry, events, stats,
                   entity, layout, spatial, actions, effects, combat, world, tuning
  game.js          Game: save, tuning, input state, worlds (town/levels), fixed-step clock
  sim-entry.js     imports every feature's sim.js (Node scripts import this)
  main.js          browser boot: WebGPU renderer, RenderContext, UI, input, frame loop
  render/          RenderContext + grey-box placeholder renderers (replaced feature by feature)
  ui/shell.js      UI shell: panel registry, HUD, toasts, pause/debug menu (difficulty sliders)
  input.js         baseline keyboard/mouse input (combat feature replaces it)
  content/baseline.js   minimal playable defs (fallbacks; features override by redefining ids)
  features/<name>/sim.js      simulation side of a feature (NO three.js / DOM / window)
  features/<name>/client.js   presentation side (render systems, UI panels, audio, input)
```

**The golden rule: the simulation never knows how it is drawn.** Sim code emits events and fills the
animation contract; render code reads entities and listens to events. That is what lets the same
game run in a browser, in Node for balance bots, and in agent tools.

Features and owners (each owns its folder; edit other folders only with minimal additive changes
and list them in your report):

| Feature | Folder | Owns |
|---|---|---|
| creatures | `features/creatures` | genome (Spore-style monster DNA), segmented rig renderer, procedural animation, model/part library, hero / NPC / prop / loot models, Creature Lab |
| combat | `features/combat` | player controller, input (kb/mouse/gamepad/touch), active skills + supports, statuses & ailments, VFX, camera, hitstop/shake, damage numbers, audio |
| monsters | `features/monsters` | monster families, behaviour archetypes (AI), monster abilities, elite affixes, bosses, encounter director, procedural monsters & bosses |
| progression | `features/progression` | XP rewards, items/affixes/rarities/uniques/currency, loot drops & pickup, inventory/equipment/stash/vendor/crafting, passive tree (+UI), skills & supports UI/loadout, flasks, save fields |
| world | `features/world` | level layout generators, themes (palette, props, lighting, fog), level mechanics, campaign + endless level provider, town hub + NPC placement/services, level renderer, minimap, waypoint |
| tools | `features/tools` | agent API, playtest bot, inspector, Workshop (lab worlds, loot roller, balance table), Claude link game commands |
| examples | `features/examples` | small complete game modes built only from the registry (Horde: wave survival, `mode.horde`) — templates for new modes |

## 2. The registry (design language)

Every piece of content and every pluggable piece of code is `define( kind, def )`
(`core/registry.js`). Defs have `id`, `name`, `tags`, optional `weight`, `level`. Generators pick by
tags with `query( kind, { tags, any, none, level } )`. Redefining an id replaces the def (features
override baseline). Kinds:

| Kind | Owner | Shape (essentials) |
|---|---|---|
| `system` | any | `{ id, order, init?(world), update(world, dt) }` — sim systems, see order table below |
| `renderSystem` | any client | `{ id, order, init?(rc), onWorld?(rc, world, game), update?(rc, world, alpha, dt), resize?(rc) }` |
| `uiPanel` | any client | `{ id, order, toggle?, modal?, startOpen?, pauseButton?, mount(ui) → el, update?(ui, game, dt), onOpen?, onClose? }` (`pauseButton: 'Label'` adds a pause-menu button) |
| `bootHook` | any client | `{ id, order, boot({ game, rc, ui, renderer, gpu, opts }) }` — after boot, before the first world |
| `worldHook` | any sim | `{ id, order, onWorld(game, world) }` — populate a new world (spawns, mechanics, NPCs, listeners) |
| `saveField` | any sim | `{ id, init() }` — persistent character data (plain JSON) |
| `statSource` | any sim | `{ id, mods(game, player) → mods[] }` — gear, tree, level, buffs from save |
| `inputProvider` | combat | `{ id: 'default', install(game, rc, dom, onUiAction) → poll(dt) }` — replaces `src/game/input.js` |
| `controller` | combat / monsters | `{ id, create(game, entity) → { update(world, e, dt) } }` |
| `status` | combat (+ any) | `{ id, name, tags, duration, stack: 'refresh'\|'add'\|'max', maxStacks, flags[], mods(s, e) → mods, onApply, onTick(world, e, s, dt), onExpire, immuneFlag }` |
| `skill` | combat | player active skill — see §6 |
| `support` | combat | skill modifier (more projectiles, area, chain, conversion…) — see §6 |
| `monsterAbility` | monsters | action def builders for monsters (bite, slam, spit, charge…) |
| `archetype` | monsters | behaviour archetype (chaser, charger, ranged, caster, summoner, exploder…) |
| `monsterFamily` | monsters | genome constraints + archetypes + abilities + palette + tags |
| `monsterAffix` | monsters | elite modifier (hasted, armoured, vampiric, explodes, frost aura…) |
| `boss` | monsters | designed boss (genome, phases, patterns) |
| `bossPattern` | monsters | reusable boss attack pattern (slam ring, bullet spiral, charge, summon…) |
| `itemBase` | progression | `{ id, slot, name, tags, implicit, damage?, attackSpeed?, weaponClass?, model }` |
| `affix` | progression | `{ id, affixType: 'prefix'\|'suffix', tags (base tags it can roll on), text, stats: [{ stat, type, tags? }], tiers: [{ level, ranges }], weight }` (not `kind`: define() overwrites `def.kind`) |
| `unique` | progression | named item with fixed mods + a unique mechanic hook |
| `currency` | progression | crafting orbs |
| `treeCluster` / `keystone` / `ascendancy` | progression | passive tree building blocks (the 1,483-node tree is generated from them; see `tree.js`) |
| `theme` | world | `{ id, name, palette, floor, wall, props, lighting, fog, sky, post, music? }` |
| `mechanic` | world | `{ id, name, desc, tip, tags, theme, depth, words, combinesWith, conflicts, decorate(L, rng, ctx), setup(game, world, ctx), preMove / postMove / postEffects / update(world, dt, ctx), field(world, ctx, x, z, out), describe(world, ctx) }` (`mechanics/index.js`) |
| `level` | world | designed campaign level (§8) |
| `levelGenerator` | world | `{ id, generate(game, spec, rng) → Layout }` (dungeon, caves, arena, town) |
| `roomTemplate` | world | room shapes the dungeon generator stamps (`gen/rooms.js`) |
| `levelProvider` | world | `{ id, order, spec(game, depth) → spec \| null }` (campaign first, endless after) |
| `palette` | creatures/world | named colour sets (`primary, secondary, accent, skin, metal, glow, dark`) |
| `bodyPlan` / `bodyPart` | creatures | genome building blocks (§5) |
| `model` | creatures (+ any) | part-list model (§5) — props, loot, weapons, NPC outfits |
| `modelType` | creatures | `{ id }` — model.type values drawn by the rig renderer (placeholder skips them) |
| `apiCommand` | tools (+ any) | `{ id, desc, args, run(game, args) → JSON }` (§10) |

## 3. Simulation kernel (core/)

* **Fixed step** 60 Hz (`SIM_HZ`); render interpolates (`rc.lerp(e)` uses `e.px/pz/py/pf`).
* **World system order**: 10–15 input/controllers · 20 AI · 30 actions · 40 skills · 50 movement ·
  60 projectiles/areas · 70 statuses · 80 regen · 85 mechanics · 90 director · 95 loot/pickup · 100 cleanup.
* **Entity** (`core/entity.js`): `kind` (`player|monster|boss|npc|prop|loot`), `team` (`TEAM.PLAYER/ENEMY/NEUTRAL`),
  `x z y`, `vx vz vy`, `facing` (rad, 0 = +z, π/2 = +x), `radius height mass solid`, `moveIntent {x,z}` (0..1),
  `impulse` (knockback), `forced {vx,vz,time,onEnd}` (dashes/dodges), `stats` (StatBlock), `life mana shield`,
  `alive`, `statuses` (Map), `flags` (invulnerable, untargetable, stunned, frozen, rooted, unstoppable, ghost, inert),
  `tags` (Set), `action` (running action), `cooldowns` (Map id→time), `controller`, `data` (free), `model`, `anim`.
* **Animation contract** (sim → render, read-only for renderers): `anim.state` (`idle move action dodge hit stun dead spawn`),
  `anim.action` (action name, §4), `anim.phase` (`windup active recovery`), `anim.t` 0..1, `anim.duration`,
  `anim.seq` (increments per new action/death/dodge), `anim.speed` (m/s), `anim.aimX/Z`, `anim.hitDirX/Z`,
  `anim.hitTime`, `anim.variant` (combo step etc.).
* **Actions** (`core/actions.js`): one timeline for every attack/spell/ability: `{ id, anim, duration, speedStat,
  windup, active, cancelAt, moveMult, turn, lunge {from,to,speed}, unstoppable, events:[{at, fn(world,e,act)}],
  onStart, onEnd, onCancel }`; `world.act(e, def, { aimX, aimZ, target, ctx, force })`; `canAct(e)`.
* **Delivery** (`core/effects.js`): `world.melee(owner, { range, angle, hit, fx, element })`,
  `world.projectile(owner, { dir|tx,tz, speed, range, radius, pierce, chain, homing, returns, hit, fx, color, element, onHit, onEnd })`,
  `world.area(owner, { x, z, radius, shape: circle|ring|cone|line, delay (telegraph), duration, interval, hit, hitOnce, follow, fx, element, onTick, onHit, friendly })`.
* **Hit template** (`core/combat.js`): `{ damage: { physical:[min,max], fire, cold, lightning, chaos }, tags, effectiveness,
  addFlat, critChance, knockback, stun, ailments: { ignite: 25 … }, skill, noAilments, noLeech, canBlock, canEvade, onHit }`.
  `world.dealDamage(src, tgt, hit)` → `{ total, byType, crit, killed }`. Sliders apply here.
* **Statuses**: `world.applyStatus(e, id, { source, duration, stacks, …data })`, `world.removeStatus(e, id)`.
  Ailment ids used by combat.js: `ignite chill freeze shock poison bleed` (+ `stun`).
* **Kill**: `world.kill(e, killer, hit)` emits `death`; corpses stay `data.corpseTime` (default 4 s) for death animations.

### Stats (canonical names; tags filter with `get(stat, tags)`)
`life mana shield life_regen life_regen_pct mana_regen mana_regen_pct move_speed attack_speed cast_speed
damage (multiplier, base 1) added_<type>_min added_<type>_max crit_chance crit_multi area (radius mult)
projectile_count projectile_speed pierce chain duration cooldown_recovery mana_cost armor evade_chance
block_chance res_<type> max_res_<type> pen_<type> pen_armor damage_taken life_leech mana_leech life_on_hit
<ailment>_chance knockback stun_threshold pickup_radius item_rarity item_quantity gold_find xp_gain
dodge_cooldown dodge_distance strength dexterity intelligence minion_damage minion_life`.
`damage_taken` has a base of 1 on players and monsters (so "increased damage taken" mods work).
`<type>` ∈ `physical fire cold lightning chaos`. Mod: `{ stat, type: flat|inc|more|override, value, tags?, when? }`.

### Events (`world.events`, payload fields)
`spawn {entity}` · `despawn` · `hit {source,target,total,byType,crit,killed,x,z,skill,tags}` · `evade` · `block` ·
`death {entity,killer,hit,x,z}` · `action {entity,action,duration}` · `melee {owner,x,z,dir,range,angle,hits,fx,element}` ·
`projectile {p}` · `projectile:end {p,reason}` · `area {a}` · `area:tick` · `area:end` · `status {entity,id,stacks}` ·
`dodge {entity}` · `shake {amount}` · `hitstop {time}` · `sfx {id,x,z,volume}` · `loot {item,x,z}` · `pickup {item}` ·
`interact {entity,target}` · `mechanic {id,…}` · `bossPhase {boss,phase}` · `objective {text}` · `exitOpen {x,z}`.
Game-level (`game.events`): `world`, `levelup`, `gold`, `levelComplete`, `playerDeath`, `tuning`.

### Input state (`game.input`, also written by bots and the agent API)
`move {x,z}` (length ≤ 1, world-space; screen-up = −z), `aim {x,z}` (world point), `held` / `pressed` Sets of
action names: `attack skill1…skill5` (the six bar slots), `dodge interact potion flask2 flask3 flask4`. `pressed` lasts
one sim step. Default keys: LMB, RMB, 1–4, Space, F/E, Q (best flask), R/Z/X (flask slots 2–4); gamepad and touch twin-stick
in `features/combat/client/input.js`.

### World state (`world.state`)
Plain per-world data, **namespaced by feature**: `flow` (world: level flow, exit, timer), `mech` (world: mechanic
contexts by id), `objectives`, `director` / `bossActive` / `navField` (monsters), `labels` / `labCamera` (tools labs),
`complete`. Pick a key that names your feature: two features writing `state.flow` once broke the level timer.

## 4. Animation vocabulary (actions the rig layer must pose)

Humanoids (hero, NPCs, humanoid monsters): `slash` (variant 0/1/2 = combo L→R, R→L, overhead), `thrust`,
`overhead`, `spin`, `slam`, `leap`, `dash`, `cast`, `cast_aoe`, `channel`, `shoot`, `throw`, `shout`, `block`,
`kick`, `drink`; NPC emotes `hammer sweep talk wave count meditate idle_look`.
Creatures (any body plan): `bite claw slam charge spit roar stomp tail leap cast summon burrow breath`.
Unknown names fall back to a generic attack pose driven by `phase` (windup = draw back, active = strike, recovery = settle).
States `dodge` (roll), `hit` (flinch along `hitDir`), `stun` (wobble), `dead` (`t` 0..1 collapse/dissolve), `spawn` (rise in).

## 5. Models, rigs and genomes (creatures feature)

* **Part list** — the geometry language for EVERYTHING (monsters, hero, NPCs, props, loot, weapons):
  `{ parts: [ { shape, bone?, pos:[x,y,z], rot:[x,y,z], scale:[x,y,z], color: '#rrggbb' | paletteKey, emissive?: 0..1 } ] }`.
  Shapes: `box wedge cyl cone sphere tetra prism spike blade ring disc capsule octa`. Palette keys
  `primary secondary accent skin metal glow dark`. Rendered by one instanced draw per shape (thousands of parts).
* **Genome** (sim-safe, `features/creatures/genome.js`): `generateGenome(rng, { plan?, size?, tags?, palette?, level? })`
  → plain JSON `{ seed, plan, size, palette, parts…, gait… }`; `mutateGenome(g, rng, amount)`, `crossGenomes(a, b, rng)`,
  `genomeMetrics(g)` → `{ radius, height, mass, reach, speedMul, flying, attackStyles }`. Body plans: `biped quadruped
  hexapod serpent floater blob arachnid avian` (registry `bodyPlan`, extendable). Monsters carry
  `model = { type: 'creature', genome }`; bosses use `size` ≥ 2.
* **Hero**: `model = { type: 'hero', id: 'reaver', weapon: { base, rarity, color }, gear: {…tints} }` — keep the engine's
  triangle-person hero look (see `src/crowd/models.js`, yellow marker ring) as a segmented rig.
* **Model fields the rig renderer reads**: `type id genome seed scale palette tint glow rarity color state emote hidden`
  (`hidden`: burrowed / lab — the instance is kept, nothing is drawn; `state`: pose of state props such as chest lids and
  braziers; `seed`: per-entity variation of a model def). One shared material; 13 instanced draws for the whole cast.

### Cross-feature hand-offs (who emits / who consumes)

* **Rewards**: monsters set `data.xp`, `data.rarity` (`normal magic rare unique boss`), `data.lootMult`; progression's
  reward hook (redefine worldHook id `baseline-rewards`) grants XP/gold/loot on `death`.
* **Population**: monsters' director replaces worldHook id `baseline-population`; it reads `world.layout.spawns`,
  `layout.rooms` (`kind: 'boss'`) and the level spec (`families`, `boss`).
* **Exit**: the boss's death (or the director when a level has no boss) emits `exitOpen {x,z}`; the world feature spawns
  the portal; using it calls `game.completeLevel()` and sets `world.state.complete = true`.
* **Interact**: the world feature's sim emits `interact {entity, target}` when the player presses interact near an NPC /
  prop; NPCs carry `data.service` (`vendor craft stash tree skills waypoint gamble dummy`); the client opens the panel with
  that id (progression owns `vendor craft stash tree skills inventory character`, world owns `waypoint`).
* **Potion**: the player controller emits `potion {entity}` on the potion input (best flask); `flask2..4` inputs emit
  `potion {entity, slot}`; progression's flasks consume both.
* **Rig attachments**: the rig renderer publishes `rc.attach` = Map(entity id → `{ weaponBase, weaponTip, handL, handR,
  head, chest }` THREE.Vector3s) every frame; VFX use it for weapon trails and cast origins (fallback: from facing).
* **Hit flash**: renderers flash entities from `e.anim.hitTime` (sim time of the last hit) — no extra wiring.
* **Equipment look**: progression sets `player.model.weapon = { base, rarity, color }` and `model.gear`.

## 6. Skills (combat feature)

`define( 'skill', { id, name, tags: [ 'attack'|'spell', 'melee'|'projectile'|'area'|'movement'|'buff'|'minion', element… ],
icon, manaCost, cooldown, levelReq, time, reach, desc, hits: { name: () => hit numbers }, action( level, ctx ) → action def } )`
— `ctx` is the SKILL CONTEXT (`ctx.stats` the caster's StatBlock, `ctx.hit()`, `ctx.radius`, `ctx.element`…), see the header of
`features/combat/skill-core.js`. Supports: `define( 'support', { id, name, tags (skill tags it fits), excludes, manaMult,
mods( level ) | [mods] (scoped to the skill by a private `sk:<id>` tag), transform?( ctx ) } )`. Tooltips:
`skillTooltip( game, id )` / api `combat.tooltip`. Loadout lives in `game.save.skills = { known: [ids], bar: [6 ids|null] (LMB, RMB, 1–4),
supports: { skillId: [supportIds] }, levels: { skillId: n } }` (progression owns the save field and UI; combat reads it).

## 7. Loot & progression (progression feature)

Rarities `normal magic rare unique` (+ `set` optional); item level = area level; affix tiers by item level; drops on `death`;
gold auto-pickup; items pick up on walk-over/click with on-ground labels and rarity beams; inventory grid, equipment
slots `weapon offhand helm chest gloves boots belt amulet ring1 ring2`, stash, vendor (buy/sell/gamble), crafting
currencies. Player stats come from `statSource` defs (level, attributes, gear, tree). Equipment changes update
`player.model.weapon/gear` for the renderer and call `game.applyPlayerStats()`.

## 8. Levels (world feature) — one mechanic per level, named after it

Designed campaign (depth → name, mechanic, theme). Casual players can ignore each mechanic and just fight; experts
exploit it (chain reactions, crowd control, speed tech).

| Depth | Level (= mechanic) | Theme | Idea |
|---|---|---|---|
| 1 | **Powder Keg** | Ember Quarry | explosive barrels chain-react; blow up packs |
| 2 | **Spike Field** | Sunken Crypt | timed floor spikes hurt everything — lure monsters |
| 3 | **Lightless** | Gloom Catacombs | darkness, light radius, ignitable braziers; monsters weaker in light (dynamic lights) |
| 4 | **Black Ice** | Frostfang Pass | slippery momentum floors; frozen enemies shatter |
| 5 | **Conduits** | Storm Foundry | pylons linked by lightning beams; knock enemies through |
| 6 | **Rift Gates** | Shattered Observatory | paired portals move players, enemies and projectiles |
| 7 | **Magma Tide** | Cinder Caldera | lava floods and recedes; high ground |
| 8 | **Gravity Wells** | Hollow Moon | wells pull everything together — perfect for AoE |
| 9 | **Echoes** | Mirror Halls | a ghost replays your actions 2 s later (double damage if you plan) |
| 10 | **The Swarm** | Ashen Hive | a GPU-crowd horde of thousands (engine showcase) |
| 11 | **Chrono Fields** | Clockwork Ruins | zones slow or haste everything inside |
| 12 | **Miasma** | Blightmarsh | spreading poison fog; cleanse shrines |
| 13–20 | combinations | mixed | e.g. *Powder Ice*, *Dark Conduits*, *Echo Tide*, *Gravity Kegs*, *Rift Swarm*, *Chrono Miasma*, *Lightless Spikes*, *The Gauntlet* (3 mechanics) |
| 21+ | **endless** | procedural | combine 1–3 mechanics × theme × palette × monster families × boss composition; names generated from the mechanics |

Level spec: `{ id, depth, name, level (area level), theme, mechanics: [ids], generator, families: [ids], boss, seed, rules? }`.
Optional spec fields for game modes: `mode` (e.g. `'horde'`), `record` (key for clears / best times instead of the depth),
`progress: false` (finishing does not unlock the next depth); a mode that runs its own encounters sets
`world.state.populated = true` before order 90 (the director stands down) and `world.state.flow.hold = true` (no
"cleared" exit fallback). Generation always leaves every room reachable on foot from the start (bridges over gaps; floor pockets a pool cut off are
sealed), so neither a leap nor a spawn can strand anything.

**Balance baseline** (`npm run sim`, the bot with `player.kit` at character level 2×depth−1): every campaign depth 1–20
clears in about 1–3.5 minutes; endless clears to about depth 60 (area level ~100) and walls around depth 75. Starter
gear alone (`--naked`) clears the early depths and dies from depth ~10, so gear and passives matter. Monster scaling
(`core/tuning.js` `monsterScaling`) keeps kill times within ~1.5–4.7× and hits-to-die within ~0.4–1.15× of level 1 up to
level 100 for a geared character; damage ramps to ×1.3 over the first ten levels.
Each level ends with a boss (designed for 1–12, combinations reuse/remix, procedural after); killing it opens the exit portal
(`exitOpen`); `game.completeLevel()`; portal returns to town or continues deeper.

## 9. Town hub

NPC entities (`kind: 'npc'`, `data.service`): Blacksmith (`craft`), Merchant (`vendor`, `gamble`), Mystic (`tree`
respec, `skills`), Stash chest (`stash`), Waypoint obelisk (`waypoint` level select incl. endless depth), Training dummy
(DPS meter). Pressing interact near one emits `interact`; the owning panel opens. NPCs are fluidly animated (emotes,
head look-at, idle variety); ambient townsfolk can use the GPU crowd.

## 10. Agent tools (tools feature)

`game.api( id, args )` runs a registered `apiCommand` and returns plain JSON — the same commands are exposed to Node
(`scripts/sim.mjs`), to the browser console (`window.api`, the ` inspector) and to the Claude link. `help` lists all 58.
Groups: world & entities (`describe entities inspect stat events step teleport kill.all spawn`), levels (`town level.enter
level.spec level.ascii level.describe level.campaign mechanic.list mechanic.describe theme.list world.state`), monsters
(`monsters.*`), loot & character (`loot.roll loot.sim items.* tree.* stats.player flask.drink player.set player.kit`), combat
(`combat.tooltip combat.cast combat.camera`), tuning (`tuning.get/set/reset`), bot (`bot.create bot.run`), Workshop labs
(`lab.genomes lab.monsters lab.bosses lab.actions lab.models lab.clear`), browser-only `perf`. The Creature Lab is
`game.creatureLab.*` / `#lab=creature`; the Workshop panel `#lab=workshop`. Claude link commands: `ping api play perf
screenshot sequence` (`features/tools/link.js`). Recipes and workflow: [`AGENTS.md`](AGENTS.md).

## 11. Budgets and conventions

* 60 fps on a mid phone at ~150 active monsters; desktop: 500+. Instanced rendering for anything numerous.
* WebGPU only. ≤ 8 storage buffers per shader stage (phones). No texture assets: everything is procedural.
* three.js "mdcs" style (tabs, `foo( a, b )`, blank lines inside function bodies). Comments are teaching notes.
* Tests: `npm run lint`, `npm run build:game`, `npm run smoke:game` (town, a level with the bot, every UI panel, Workshop
  galleries), `npm run sim`. CI: lint + both builds + a short sim on every push; the smoke tests nightly.

## 12. Monsters feature — contracts it adds (`features/monsters`, map in its `sim.js`)

* **Spawning**: `spawnMonster( world, { family, level, rarity: normal|magic|rare|unique, affixes?, archetype?, x, z, genome? } )`,
  `spawnBoss( world, id|def, { x, z, level, arena, dormant } )`, `composeFamily( seed, depth )`, `composeBoss( seed, depth, { mechanics } )`,
  `describeFamily / describeBoss / describeMonster` (exported from `features/monsters/sim.js`); agent commands `monsters.*`
  ( `catalog families family compose composeBoss boss spawn spawnBoss inspect encounter` ).
* **Level spec** (world feature): `families: [ monsterFamily ids ]`, `boss: id | null` (null = no boss: the exit opens when the level is
  cleared), `level`, `depth`, `theme`, `mechanics`. Unknown or missing ids fall back to the campaign families / boss of the depth,
  theme or mechanic (13–20: designed boss "Ascended" remix, 21+: composed). Campaign ids, depth 1–12:
  `cinder-imp slag-hound quarry-brute blastling` / `drowned crypt-crawler bone-archer` / `gloom-stalker lantern-wisp grave-warden` /
  `frostfang-wolf rime-yeti ice-wraith` / `spark-drone forge-golem coil-sentry` / `star-weaver rift-stalker` / `magma-crab ember-drake lava-spawn` /
  `void-maw moon-mite watcher-eye` / `glass-sentinel mirror-shade` / `ash-drone hive-warrior hive-spitter` / `clock-sentry gear-knight cog-spider` /
  `bog-lurker plague-toad rot-shaman rot-grub`; bosses `gorrak-blastjaw morvane umbra hrimgar voltrix nyx pyrrhox hollow-maw vitreus cindrel horologist mother-rot`.
  The boss is placed at the centre of the `kind: 'boss'` room (arena = that room); Lightless reads `layout.lights` ( `{ x, z, range, lit }` ).
* **Model fields** for the rig renderer: `model.rarity`, `model.glow` / `model.tint` (CSS colours), `model.affixes` ( `[ { id, color } ]` ),
  `model.hidden` (burrowed / vanished — do not draw the body), `model.boss`; `data.guarding` (shield raised), `data.charging`. Powder kegs are
  `kind: 'prop'`, `model { type: 'prop', id: 'barrel' }`.
* **fx hints** on areas / projectiles: `slash bite claw thrust slam quake spikes lava erupt explosion meteor fire ice lightning poison void dust
  beam charge drain web shout ward heal summon emerge rift echo time frost-aura conduit-shield telegraph` and projectiles
  `bolt arrow shard spit lob barrel fire ice lightning poison`. An area in its `delay` is a telegraph ( `data.telegraph` marks
  pure warnings and fuses); `color` and `element` are always set.
* **Events**: `bossIntro { boss, name, title, text, duration }`, `bossPhase { boss, phase, index, name, total }`, `bossEnrage`, `bossPattern
  { boss, pattern, name }`, `aggro { entity, target }`, `ambush { x, z, count }`, `summon { entity, minions }`, `affix { entity, id, kind }`,
  `blink { entity, x, z, tx, tz }`, `burrow` / `vanish` / `emerge { entity }`, `explode { entity, x, z, radius }`, `heal { entity, amount }`,
  `guardBreak { entity }`, `exitOpen { x, z, reason: 'boss' | 'cleared' }`.
* **Statuses** (monster-side, `m-` prefix): `m-frenzy m-ward m-slow m-haste m-enraged m-exposed m-root m-burrowed m-vanished`.
* **World state**: `world.state.director` (families, boss, packs), `world.state.bossActive` (boss entity after its intro), `world.state.exitOpen`.
* **Rewards**: `data.xp`, `data.rarity`, `data.lootMult` (normal 1, magic 2.5, rare 6, unique 12, boss 30; summons × 0.3, illusions 0).
