# WebGPU Crowd Stress Test

A mass-crowd stress test built on **three.js r186 + WebGPU only** (no WebGL fallback on purpose).
Thousands to millions of low-poly "triangle people" wander a plaza, simulated by a compute
shader and animated in the vertex shader. Every rendering feature starts **off**, and each one
can be switched on individually with a note on what it does, what it costs, and which part of
the GPU it stresses. The idea: find out how big a crowd (or monster horde) your game can afford,
and which effects cut off which hardware.

* **`webgpu-crowd-stress.html`** – the whole app in **one self-contained file** (three.js, Rapier WASM,
  code, CSS all inlined, ~3.2 MB). Put it anywhere and open it.
* **`src/`** – the readable source (plain ES modules, no framework).

## Running it

| Where | How |
|---|---|
| Desktop | Open `webgpu-crowd-stress.html` directly (double-click), or `npm install && npm run dev`. |
| Phone (easiest) | Host the single file on any **https** URL. With GitHub Pages: *Settings → Pages → Deploy from a branch → `main` / `(root)`*, then open `https://<you>.github.io/<repo>/webgpu-crowd-stress.html`. |
| Phone on your LAN | `npm run dev:lan` starts an **https** dev server (self-signed certificate: accept the warning) and prints a `https://192.168.x.x:5173` address. Plain `http://` on a LAN IP will **not** work: WebGPU needs a secure context. |
| Rebuild the single file | `npm run build` → writes `dist/index.html` and copies it to `webgpu-crowd-stress.html`. |

Browsers with WebGPU: Chrome / Edge 113+ (desktop), Chrome for Android 121+ (Android 12+, most
Qualcomm/ARM GPUs), Safari 26+ (iOS / iPadOS 26, macOS Tahoe), Firefox 141+ (Windows). If WebGPU is
missing the page says so and stops. That's intentional: this is a WebGPU stress test.

Settings live in the URL hash, so a configuration can be shared or bookmarked, e.g.
`webgpu-crowd-stress.html#count=200000&shading=lambert&blobShadows=1` or
`webgpu-crowd-stress.html#preset=console`. The *Copy settings link* button builds one for you.

## Controls

| Action | Keyboard / mouse | Touch |
|---|---|---|
| Move hero | WASD / arrows (camera-relative) | left joystick |
| Run | hold Shift | *Run* toggle or push the stick to the edge |
| Wave / cheer / dance | R / Space / F | action buttons |
| Pan (iso & top) / orbit (perspective) | left-drag | one-finger drag |
| Rotate | Q / E (90° steps in iso), right-drag | two-finger twist |
| Zoom | wheel, + / − | pinch |
| Camera modes | 1 iso · 2 top · 3 orbit · 4 chase · 5 eye level | camera menu |
| Recenter on hero / hide UI / settings / physics blast | C / H / P / X | ◎ button, ⚙ |

The primary view is a **true isometric** orthographic camera (45° yaw, 35.264° pitch). The other
modes exist because perspective views stress very different things (depth range, LOD, overdraw
toward the horizon).

## How to use it as a hardware test

1. **Standard benchmark** (in *Benchmark & report*) is the one to compare devices with. It pins
   everything that changes the result: it renders exactly 1920×1080 (letterboxed into the window,
   whatever its size or pixel ratio), uses a fixed camera that shows the whole crowd (zoomed in,
   the GPU-driven path culls almost everyone, so the test would measure the simulation instead of
   rendering) and starts from default settings. It runs three tests and takes 1-3 minutes:
   max crowd on the direct path (Tetra), max crowd on the GPU-driven path (Box-man + LOD), and
   the Console look with 50,000 agents. The score is the first result in thousands of agents.
   When the page runs as a claude.ai artifact, every device's runs appear side by side under
   *Results from all devices* (see Claude link below).
2. For your own scene, start from **Bare** (the default: everything off, unlit flat colours, no
   post-processing) and open *Benchmark & report* → **Find max crowd** at 30 or 60 fps. It ramps the agent count until
   the frame no longer fits the target, then narrows it down. With GPU timestamps (most desktop
   browsers) it judges GPU and CPU time against the frame budget rather than the frame rate,
   because vsync caps the frame rate: on an RTX 3060 Ti every size up to a million agents "ran at
   60 fps" while the GPU was only 35 % busy. It grows the crowd buffer as needed, up to 4M agents.
3. Turn on the features you want in your game (or pick a preset) and run it again. Or run
   **Measure effect costs**: it switches each feature on top of your current settings and records
   the extra milliseconds. A mostly idle GPU drops to power-saving clocks and its timings become
   noise (identical runs measured 0.5 and 4.4 ms), so when the scene is light the benchmark first
   adds a fixed dummy compute load (the "ballast", `src/ballast.js`) to keep the clocks up. It
   costs the same with and without each effect, so it cancels out. Each effect is measured
   between two baselines (before and after), which cancels slow drift. The table has a CPU column
   too: physics and other JavaScript work cost CPU time, not GPU time. Differences under ~0.5 ms
   are still within the noise.
4. **Copy report** and paste it somewhere. It includes the GPU/adapter, browser, resolution, all
   non-default settings and both benchmark results. Do the same on each device you care about.

Reading the HUD:

* **frame ms** is what the player feels. Browsers cap it at the display refresh (vsync), so on a
  60 Hz screen you can't see anything faster than 16.7 ms.
* **GPU ms** (when the browser exposes `timestamp-query`) is the real GPU work per frame and is *not*
  capped by vsync. Use it to see headroom: at 60 fps the budget is 16.7 ms, and you want to stay well
  under it on the weakest device you target.
* **CPU ms** is JavaScript time per frame. The crowd costs almost no CPU because it all lives on the GPU.
  Turn on Rapier to see what CPU-side simulation looks like.
* **triangles/frame** counts every pass (a shadow pass or outline pass re-draws the crowd).

## Claude link (remote benchmarking)

When the page is opened as a **claude.ai artifact**, it can talk to Claude through the artifact's
small shared database. A pill in the corner says `Claude link: linked`. Claude can then queue
commands for your device, and the page runs them and writes the results back, without you
copying anything:

| Command | What it does |
|---|---|
| `ping` | GPU / browser / screen info and the settings you changed |
| `preset` `{id}` · `set` `{values}` · `reset` | change settings (keys and value types are checked against the feature list) |
| `measure` `{seconds}` | steady-state fps, median / p95 / p99 / worst frame time, GPU ms, triangles, draw calls |
| `standard` · `maxCrowd` `{targetFps}` · `effects` | the built-in benchmarks (standard = fixed 1080p conditions, comparable across devices) |
| `screenshot` | the current frame, stored as an artifact asset |
| `report` · `settings` | the same text as *Copy report*, or the full settings object |
| `sequence` `{steps: [...]}` | run several of the above in order |

Benchmarks you start yourself from the panel are recorded as well (`runs/`). Commands live in
`commands/<id>` with `status: "pending"`, results in `results/<id>`. Only people with edit access
can queue commands, if several devices have the page open a command is claimed by exactly one of
them (or by the one named in its `device` field, or by the first `mobile` / `desktop` device to
open the page when it has a `target` field), and nothing from the database is ever run as code.
Outside claude.ai (dev server, the HTML file from disk) the link is simply off.

Every saved run also shows up in the page itself under *Benchmark & report* → *Results from all
devices*: standard-benchmark scores in one table (comparable), other runs below (made with
whatever settings were on at the time, so only roughly comparable).

The tab has to stay in the foreground while a command runs: browsers pause background tabs.

## What's inside

**Characters** (`src/crowd/models.js`) are built procedurally from convex primitives in four tiers:
*Tetra* (24 triangles, every body part is a tetrahedron), *Prism* (52, Star Fox style),
*Box-man* (168, Alone in the Dark style, elbows and knees) and *Hi* (436). There are no normals
(flat shading comes from screen-space derivatives). Every vertex stores its body part, the joint it
pivots around, and two bone weights for skeletal skinning.

**Simulation** (`src/crowd/sim.js`) is one compute shader per frame. Each agent picks an
activity (idle, walk, run, wave, cheer, dance, talk, plus "knocked" when physics hits it), walks to
random targets near its "home" on a sunflower spiral (so the crowd grows outward as the count
rises), and writes a packed `vec4` (`x, animPhase, z, state + heading + colourSeed`) plus a second
`vec4` of cross-fade data. Behaviour modes (converge on the hero, flee, dance party, stadium wave)
are just branches in the same shader.

### Animation systems (`src/crowd/anim.js`, `src/crowd/clips.js`)

Six systems drive the same eight activities, so you can compare looks and costs directly:

| System | Where the work happens | Looks | Cost profile |
|---|---|---|---|
| None | nowhere | static A-pose | baseline transform cost |
| Procedural sine | vertex shader, per vertex | lively but mechanical; activities *pop* when they change | cheapest moving option |
| Keyframe clips | vertex shader, per vertex, samples a 32-key table | hand-keyed poses (walk contact/passing, jumps, disco points), smooth cross-fades | more ALU and uniform reads per vertex; scales with vertices |
| Skeletal skinning | compute pass per **agent** builds 10 bone matrices, vertex shader skins | same clips, plus smooth elbows/knees from blended weights | 480 bytes per agent per frame (capped at 131k agents / 63 MB); needs storage buffers in the vertex stage |
| Skeletal, baked bone texture | load time: the 10 bone matrices of every clip key baked into one float texture (30 × 256 texels, 120 KB); vertex shader fetches the two keys around the agent's phase, interpolates, skins | same as skeletal (matrices are interpolated between keys: sub-millimetre differences on average); cross-fades blend matrices, so a limb cuts a straight line instead of an arc for 0.25 s | no per-agent memory, no compute pass, **no agent cap**; 12 texture reads per vertex (24 while cross-fading); no storage buffers needed |
| Baked VAT | load time: every vertex of every clip frame baked into a float texture | identical to keyframe (it *is* the keyframe result) | 2-4 texture reads per vertex, zero joint maths; memory grows with vertices × frames |

The clips are 8 authored key poses per activity, resampled with a Catmull-Rom spline into 32 keys,
over 16 joint channels. The same data feeds the GPU keyframe sampler, the skeletal compute pass,
and the CPU bone-texture and VAT bakers, so they all show the same motion.

Skeletal vs. baked bone texture is the classic crowd trade: per-agent bones cost memory and a
compute pass that scales with the crowd, but only 6 reads per vertex; baked bones cost nothing per
agent, but every vertex fetches and interpolates its bones from the texture. As a rule of thumb,
many low-poly characters favour the texture and fewer, detailed ones favour per-agent bones -
compare both with *Measure effect costs*.

**Two render paths:**

* *Direct*: one instanced draw call for the whole crowd. Simple, and every agent is transformed
  even when it's off screen.
* *GPU-driven*: a compute pass frustum-culls every agent, estimates its on-screen height in
  pixels, picks one of the four models (LOD), and appends it to a per-LOD list with an atomic
  counter. Each list is drawn with `drawIndexedIndirect`, so the CPU never knows how many are
  visible. This is the technique modern engines use for massive crowds.

The hero is agent #0: same buffers and shader, driven by uniforms instead of AI.

### Physics (`src/physics.js` + `src/physics/`, `src/crowd/collide.js`)

With **Enable physics** on, everything collides:

| Pair | How |
|---|---|
| bodies ↔ bodies, ground, trees (trunk + canopy), lamps, monument | Rapier 0.19.3 (CPU / WebAssembly) |
| trees and lamp posts themselves | sleeping dynamic bodies: the wrecking ball, piles or the hero can knock them over |
| hero ↔ props and bodies | Rapier kinematic character controller: slides along trees, shoves balls |
| people ↔ people, props, bodies | GPU spatial hash: every agent is binned into a 1 m grid with atomic bucket counters, then pushes itself out of neighbours; fast bodies knock people over (stagger animation) |
| bodies ↔ people near the hero (two-way) | a compute pass lists people within 18 m of the hero, the list is read back to the CPU and each gets a kinematic Rapier capsule, so balls bounce off heads |
| or: the first *N* people as real Rapier bodies | *Rapier* crowd mode: the GPU AI writes a desired velocity, the CPU reads it back, Rapier simulates dynamic capsules, and positions are uploaded back to the GPU every frame |

The options expose the usual knobs of a real physics setup: body count, shape (sphere, box,
capsule, cylinder, convex hull), size variation, spawn pattern (rain, pile, brick wall, towers),
bounciness, friction, gravity, simulation rate (fixed timestep with an accumulator), solver
iterations, continuous collision detection, sleeping, recycling, and a collider debug view. There
are also buttons for an explosion and a wrecking ball.

### Looks

* **Cel shading** (`src/cel.js`) is a custom three.js `LightingModel`. It snaps N·L into hard
  anti-aliased bands, gives the shadow side a *coloured* tint instead of grey, and adds hard rim
  and specular bands. There are two styles: *Wind Waker* (soft blue shadows, warm light, no
  outlines) and *Jet Set Radio* (hard split, saturated colours, purple shadows, meant for thick
  inverted-hull outlines). Presets set up the rest of each look.
* **Pixel-art filters** (`src/post.js`) render the scene at a console-like resolution, upscale with
  nearest-neighbour sampling, and quantise every pixel with 4×4 Bayer ordered dithering. The modes
  are PICO-8 (16-colour palette), Game Boy (4 greens), 16-bit console (15-bit colour) and CRT
  arcade (scanlines, colour bleed, screen curvature). Because they really render at low
  resolution, they usually *save* GPU time.

## Feature reference

Cost: ●○○○ cheap → ●●●● very heavy. *Bound by* is the resource the feature leans on:
**vertex** (scales with crowd × model triangles), **fill** (scales with pixels), **bandwidth**
(full-screen buffer reads/writes), **compute**, **cpu**, or **compile** (toggling it recompiles
shaders, so expect a one-off hitch).

### Crowd

| Setting | Default | Cost | Bound by | What it does / why it costs |
|---|---|---|---|---|
| Crowd size | 20000 | ●●○○ moderate | vertex / compute | How many agents are simulated and drawn. Every agent runs the compute shader once per frame and every one of its vertices runs the vertex shader. Triangles on screen = agents x triangles per model. **Mobile:** Rough starting point only: expect a phone to hold somewhere in the tens of thousands of Tetra agents at 60 fps and a desktop GPU far more. Run "Find max crowd" to get the real number for each device. |
| Max crowd (GPU buffer size) | Auto | ●○○○ cheap | memory | How big the storage buffers are. Each agent costs 32 bytes (plus 64 more in GPU-driven mode). Changing it re-allocates buffers and resets the crowd. **Mobile:** 256k is a safe mobile ceiling; 4M agents need about 384 MB of GPU memory in GPU-driven mode. |
| Character model | Tetra - 24 tris | ●●○○ moderate | vertex | Triangles per character. Vertex cost scales linearly with it. In GPU-driven mode this is the MAXIMUM detail: distant agents drop to cheaper models automatically. **Mobile:** Mobile GPUs are often vertex-limited long before fill-limited with tiny triangles. Sub-pixel triangles are wasted work on every GPU. |
| Render path | Direct: 1 instanced draw, no culling | ●○○○ cheap | vertex / compute | Direct draws every agent even if it is off screen. GPU-driven runs a compute pass that frustum-culls each agent, picks a level of detail from its on-screen size, and writes compacted per-LOD lists that are drawn with drawIndexedIndirect. The CPU never learns how many are visible. This is how modern engines draw huge crowds. **Mobile:** GPU-driven wins as soon as a large part of the crowd is off screen or far away (perspective views). In a zoomed-out isometric view everything is visible and it can be slightly slower. |
| Automatic LOD (GPU-driven only) | on | ●○○○ free | vertex | Swap to cheaper models when a character is only a few pixels tall. Thresholds: >150 px Hi, >60 px Box-man, >22 px Prism, otherwise Tetra. |
| Animation system | Procedural sine (per vertex) | ●●○○ moderate | vertex / compute / memory | Six ways to animate the same crowd, all driving the same 8 activities. Procedural: sine curves per joint, cheapest, states pop. Keyframe: hand-keyed clips (walk contact/passing poses, jumps, disco points...) sampled per vertex from a table, with cross-fades - nicer motion, more ALU per vertex. Skeletal: the clips are sampled ONCE per agent in a compute pass that builds 10 bone matrices (480 bytes/agent/frame), then the vertex shader skins with smooth weights (elbows and knees bend instead of hinging) - the standard game-engine approach, heavy on memory and bandwidth. Baked bone texture: the same bone matrices, but computed once at load time for every clip key and stored in one 120 KB texture; the vertex shader fetches the two keys around the phase of each agent, interpolates and skins - no compute pass and no memory per agent (so no 131k cap), paid for with 12 texture reads per vertex (24 while cross-fading). The classic way to skin huge crowds. VAT: every vertex position of every clip frame is baked into a float texture at load time - the vertex shader just reads it back, zero joint maths. **Mobile:** Skeletal needs storage buffers in the vertex stage (some older phones have none - it falls back to keyframe) and ~63 MB for 131k agents. The baked bone texture needs neither (plain texture reads, 120 KB in total), so it brings smooth skinning to those phones too, but its 12-24 reads per vertex add up on vertex-limited GPUs - pair it with low-poly models. VAT and procedural remain the mobile-friendly choices. |
| Cross-fade between activities | on | ●○○○ cheap | vertex | Keyframe / skeletal / baked bones / VAT blend the outgoing and incoming clip over 0.25 s instead of snapping. Costs a second clip sample per vertex (or per agent for skeletal; baked bones only pay it while an agent is fading). |
| Behaviour | Wander (random activities) | ●○○○ cheap | compute | All simulation runs in one compute shader, so behaviour changes are free on the CPU. "Converge" packs everyone around the hero: huge overdraw hot-spot. |
| Density (people / m²) | 0.35 | ●○○○ cheap | fill | How tightly the crowd is packed. Denser crowds overlap more on screen (overdraw) and the world gets smaller. |
| Activity (share walking) | 0.6 | ●○○○ free | compute | Chance that an agent picks walking/running over standing activities when its timer runs out. |
| Walk speed | 1 | ●○○○ free | compute | Global speed multiplier. |

### Shading & lighting

| Setting | Default | Cost | Bound by | What it does / why it costs |
|---|---|---|---|---|
| Shading model | Unlit (flat colour) | ●●○○ moderate | fill / compile | Per-pixel lighting maths for every material. Unlit = one colour. Lambert = N·L. Phong adds a specular highlight. Standard is physically based (GGX microfacets, energy conserving). Physical adds clearcoat and sheen layers: noticeably more ALU per pixel. Toon quantises light into bands. The two cel styles use a custom lighting model: hard anti-aliased light bands, coloured (not grey) shadows, rim and specular bands - Wind Waker is soft and blue-shadowed, Jet Set Radio is a hard split with saturated colours (pair it with thick outlines). **Mobile:** Lambert/Phong or Standard with few lights is the usual mobile sweet spot. Physical is rarely worth it on phones. |
| Ambient (hemisphere light) | on | ●○○○ cheap | fill | Sky/ground colour fill so shadowed sides are not pitch black. One cheap light term. Only matters with a lit shading model. |
| Environment map (IBL) | off | ●●○○ moderate | fill / bandwidth | Image-based lighting from a pre-filtered (PMREM) cube map: soft ambient + reflections for Standard/Physical materials. Costs texture samples per pixel. **Mobile:** Fine on phones; the pre-filtering happens once at startup. |
| Sun shadows | Off | ●●●○ heavy | vertex / fill | Shadow mapping renders the scene a second time from the sun into a depth texture, then every lit pixel samples it. With the crowd casting, the vertex work DOUBLES: every agent is drawn twice. Bigger maps and soft filters add fill and sampling cost. **Mobile:** Real-time shadows for thousands of characters are one of the most expensive things you can turn on for a phone. Use blob shadows instead, or only let nearby agents cast. |
| Crowd casts shadows | on | ●●●○ heavy | vertex | When off, only the props cast shadows and the crowd only receives them - the shadow pass no longer re-draws every agent. |
| Blob shadows (fake) | off | ●○○○ cheap | fill | A soft dark quad under each agent: 2 triangles and a little alpha blending. The classic cheap crowd shadow (used by nearly every game with big crowds). **Mobile:** Almost free - the best value visual upgrade on this list. |
| Point lights (street lamps) | None | ●●●○ heavy | fill / compile | Forward rendering loops over EVERY light for EVERY pixel of every lit material, and the light count is baked into the shader (changing it recompiles). 64+ lights in forward mode gets very slow. |
| Clustered (Forward+) lighting | off | ●●○○ moderate | compute / fill | A compute pass bins lights into screen tiles x depth slices; each pixel only evaluates the lights touching its cluster. Makes 100s of lights affordable. **Mobile:** Needs compute + storage buffers in the fragment stage; supported on most WebGPU phones. |
| Rim light (fresnel) | off | ●○○○ cheap | fill | Brightens edges facing away from the camera (1 - N·V)^p. A few ALU ops per pixel; makes silhouettes pop in a crowd. |
| Outline thickness | 0.03 | ●○○○ free | fill | How far the inverted hull is pushed out (metres). Jet Set Radio style wants it thick. |
| Toon outlines (inverted hull) | off | ●●●○ heavy | vertex | Draws every character a second time, inflated along its surface direction, back faces only, in black. Classic cel-shade outline - but it DOUBLES the crowd vertex work. **Mobile:** Consider the screen-space "Ink edges" stylize option instead: fixed cost regardless of crowd size. |

### Environment

| Setting | Default | Cost | Bound by | What it does / why it costs |
|---|---|---|---|---|
| Sky | Flat colour | ●○○○ cheap | fill | Only visible where no geometry covers the screen (mostly in perspective / eye-level views). The physical sky evaluates atmospheric scattering per pixel. |
| Fog | Off | ●○○○ cheap | fill | Blends every pixel toward a fog colour by distance or height. A few ALU ops per pixel. Distance fog also hides LOD pops and lets you shrink the draw distance. |
| Props (trees, lamps, monument) | on | ●○○○ cheap | vertex | A few thousand instanced props (~20-40 tris each) so it looks like a place. |
| Procedural paving | on | ●○○○ cheap | fill | Ground pattern computed per pixel (tiles, grout, rings) instead of a texture. The ground covers the whole screen, so every ALU op here is multiplied by the pixel count. |

### Resolution & anti-aliasing

| Setting | Default | Cost | Bound by | What it does / why it costs |
|---|---|---|---|---|
| Pixel ratio cap | 2x | ●●●○ heavy | fill | Phones have 2-3.5 device pixels per CSS pixel. At 3x you shade 9x the pixels of 1x. Capping the pixel ratio is the single biggest mobile performance lever. |
| Render scale | 1 | ●●●○ heavy | fill | Renders fewer (or more) pixels than the display and upscales. Pixel cost scales with the square: 0.5 = a quarter of the pixels. |
| Upscaler (when scale < 1) | Browser bilinear (free) | ●○○○ cheap | fill | FSR 1 reconstructs edges and sharpens. It costs two extra full-screen passes at output resolution - only worth it when you are heavily fill-rate bound. |
| Anti-aliasing | None | ●●○○ moderate | fill / bandwidth | MSAA samples geometry edges 4x in hardware (memory/bandwidth heavy, very cheap on tile-based mobile GPUs). FXAA/SMAA blur jaggies in a post pass. TRAA jitters the camera each frame and accumulates history: smoothest result, some ghosting, needs velocity buffers. **Mobile:** On tile-based phone GPUs (Apple, Mali, Adreno) MSAA is resolved in on-chip tile memory, so it is usually much cheaper than on desktop - often the best AA choice for mobile. |

### Post-processing

| Setting | Default | Cost | Bound by | What it does / why it costs |
|---|---|---|---|---|
| Tone mapping | None | ●○○○ cheap | fill | Maps HDR light values into the 0-1 display range with a film-like curve. A handful of ALU ops per pixel - essentially free. |
| Exposure | 1 | ●○○○ free | fill | Brightness multiplier before tone mapping. |
| Ambient occlusion | Off | ●●●○ heavy | fill / bandwidth | Darkens creases and contact points by sampling the depth + normal buffers around each pixel (16 samples, half resolution). Requires writing a normal buffer (MRT) in the main pass. GTAO is more accurate and looks best with TRAA. **Mobile:** Expensive on phones; run at half resolution (already done here) or skip. |
| Bloom | off | ●●○○ moderate | bandwidth | Bright pixels bleed light: a threshold pass then 5 progressively downsampled blur levels. Mostly bandwidth. |
| Depth of field | Off | ●●●○ heavy | fill / bandwidth | Tilt-shift blurs the top and bottom of the screen: the classic "miniature" isometric look for the price of one blur. Bokeh DOF computes a circle of confusion from depth and gathers a disc of samples - much heavier. |
| Motion blur | off | ●●○○ moderate | bandwidth | Smears pixels along their screen-space velocity (requires a velocity buffer). What the crowd writes into that buffer is set by "Crowd motion vectors". |
| Crowd motion vectors | Root motion (walk velocity) | ●●○○ moderate | vertex / compile | Motion blur, TRAA and SSGI read a velocity buffer: how far each pixel moved on screen since the last frame. three.js works it out per vertex from last frame's camera and the vertex's previous position, but the crowd is placed by our vertex shader from GPU data, so it has to supply that position itself. Camera only: previous = current, so walking people get no motion blur and TRAA smears them. Root motion: the shader rebuilds each agent's walking velocity from data it already has (state, heading, agent index - the simulation's own speed formula) and steps one frame back: a hash and a sin/cos per vertex, no extra buffers. Full: also re-runs the animation one frame earlier (previous phase and cross-fade), so swinging arms and legs blur too - roughly doubles the per-vertex animation cost. Skeletal uses root motion here: its bone buffer only holds the current frame's pose. Nothing is computed unless a velocity buffer is rendered; changing it recompiles the crowd shaders. **Mobile:** Root motion is close to free; Full doubles the animation work of a vertex-bound crowd, so keep it for desktop. |
| Screen-space reflections | off | ●●●● very heavy | fill / bandwidth | Makes the plaza wet and ray-marches the depth buffer to find reflected pixels. Needs normal + metal/roughness buffers. Only reflects what is on screen. Works best with Standard/Physical shading. **Mobile:** Usually too heavy for phones. |
| Screen-space GI | off | ●●●● very heavy | fill / bandwidth | Screen-space global illumination: bounced light + AO from the depth/normal buffers, temporally accumulated. The heaviest effect here - a "what does ultra cost" knob. |
| Colour grading | off | ●○○○ cheap | fill | Saturation, contrast and warmth adjustments. A few ALU ops per pixel. |
| Vignette | off | ●○○○ cheap | fill | Darkens the screen edges. Trivial ALU. |
| Film grain | off | ●○○○ cheap | fill | Animated noise over the image. Trivial ALU. |
| Chromatic aberration | off | ●○○○ cheap | bandwidth | Offsets the colour channels toward the edges: 3 texture reads per pixel. |
| Sharpen (RCAS) | off | ●○○○ cheap | fill | Contrast-adaptive sharpening. Recovers crispness after TRAA/FXAA or upscaling. |
| Stylize | None | ●●○○ moderate | fill | Screen-space outlines cost the same whatever the crowd size (compare with inverted-hull outlines). Pixel/PS1 modes render at low resolution, so they can actually be faster than the default. The palette modes quantise every pixel to a fixed console palette with 4x4 ordered (Bayer) dithering: PICO-8 (16 colours, ~320x180), Game Boy (4 greens, 144 lines), 16-bit (15-bit colour, 224 lines), CRT arcade (240 lines + scanlines, colour bleed and screen curvature). |

### Physics (Rapier 0.19.3 + GPU)

| Setting | Default | Cost | Bound by | What it does / why it costs |
|---|---|---|---|---|
| Enable physics | off | ●●●○ heavy | cpu / compute | Turns on physics for everything: rigid bodies fall and collide with each other, the ground, trees, lamps and the monument; the hero becomes a character controller that shoves them; people collide with each other, with props and with bodies (and get knocked over). Rapier (Rust compiled to WebAssembly) runs on the CPU; crowd collisions run on the GPU. **Mobile:** Rapier is single-threaded CPU work: watch "step" in the HUD and keep it well under 16.7 ms. The GPU crowd collisions scale much better on phones. |
| undefined | undefined |  undefined | undefined | undefined |
| Crowd collisions | GPU spatial hash (every agent) | ●●●○ heavy | compute / cpu | GPU: a compute pass bins every agent into a 1 m grid (atomic bucket counters) and each agent pushes itself out of neighbours, props and bodies - scales to millions, but it is position-based and one-way against bodies. Rapier: the first N agents become real dynamic capsules - fully two-way (balls bounce off people, people shove each other and pile up) - with the GPU AI steering them. That needs a GPU->CPU readback of steering and a CPU->GPU upload of positions every frame. |
| Rapier agents (Rapier mode) | 2,000 | ●●●○ heavy | cpu / bandwidth | How many agents (nearest the plaza centre) get a real Rapier body. CPU step cost grows roughly linearly with contacts; the readback/upload grows linearly with N. |
| Person radius (personal space) | 0.28 | ●○○○ cheap | compute | Collision radius of each person. Bigger = more neighbours overlap per frame = more work (and a less dense crowd). |
| Two-way: bodies bounce off people near the hero | on | ●●○○ moderate | cpu / bandwidth | GPU mode is one-way (bodies push people). With this on, a compute pass lists the people within 18 m of the hero, the list is read back to the CPU, and each gets a kinematic Rapier capsule - so falling balls bounce off heads and roll away. A classic "physics proxies near the player" technique. |
| Proxy budget | 1,024 | ●●○○ moderate | cpu | Maximum number of kinematic people-proxies inside Rapier. |
| Knockdowns | on | ●○○○ cheap | compute | People hit by fast bodies (or the explosion / wrecking ball) are thrown back and play a stagger animation. |
| Props are solid | on | ●○○○ cheap | cpu | Trees (trunk + canopy cone), lamp posts and the monument get static colliders. Static colliders are cheap: they only cost when something touches them. |
| Props can be knocked over | on | ●○○○ cheap | cpu | Every tree and lamp post is a sleeping dynamic body instead of a static collider: it costs almost nothing until something heavy (the wrecking ball, a pile of boxes, the hero) hits it, then it wakes up and topples. Toppled props stop blocking people. |
| Rigid bodies | 1,000 | ●●●○ heavy | cpu | Number of dynamic bodies. Each one is a CPU-simulated rigid body whose transform is copied into an instanced mesh every frame. |
| Body shape | Mixed | ●●○○ moderate | cpu | Contact cost order, cheapest first: sphere, capsule, box, cylinder, convex hull. Spheres touch at one point; boxes and hulls need contact manifolds with several points. |
| Body sizes | Uniform | ●○○○ cheap | cpu | Mixed sizes stack less neatly and make the broad phase work harder. |
| Spawn pattern | Rain around the hero | ●●○○ moderate | cpu | Rain keeps bodies moving (and recycles them). A pile creates a huge contact island all at once. Walls and towers are stacking tests: they need enough solver iterations to stand still. |
| Bounciness | 0.25 | ●○○○ free | cpu | Coefficient of restitution for the bodies. |
| Friction | 0.7 | ●○○○ free | cpu | Coulomb friction of the bodies. |
| Gravity (m/s²) | -9.81 | ●○○○ free | cpu | World gravity. 0 = everything floats. |
| Simulation rate | 60 Hz | ●●○○ moderate | cpu | Fixed timestep with an accumulator (up to 4 steps per frame). Doubling the rate doubles the physics CPU cost but makes fast objects and stacks more stable. |
| Solver iterations | 4 (Rapier default) | ●●○○ moderate | cpu | How many times per step the constraint solver refines contacts. More = stiffer stacks and less jitter, linearly more CPU. |
| Continuous collision detection | off | ●●○○ moderate | cpu | Sweeps fast bodies between steps so they cannot tunnel through thin objects. Costs extra time-of-impact queries per moving body. |
| Allow sleeping | on | ●○○○ free | cpu | Bodies that come to rest are skipped until something touches them. Turning this off shows the cost of simulating everything every step. |
| Recycle fallen / distant bodies | on | ●○○○ free | cpu | Rain mode only: bodies that fall off the world or are left behind respawn above the hero. |
| Debug draw colliders | off | ●●●○ heavy | cpu / bandwidth | Draws every collider as wireframe lines straight from Rapier. Useful for learning, expensive with many bodies: all the line vertices are rebuilt on the CPU and uploaded every frame. |

**Presets:** *Bare* (all off), *Mobile friendly* (Lambert, blob shadows, fog, MSAA, rim light, 1.5×
pixel ratio cap), *Console* (PBR, IBL, medium shadows, SSAO, bloom, SMAA, GPU-driven path), *Ultra*
(everything heavy on), *Toon*, *PS1 retro*, *Wind Waker* (cel shading, keyframe animation, soft
shadows), *Jet Set Radio* (hard cel shading, thick outlines), *Game Boy* (4-shade pixel filter, VAT
animation) and *Physics playground* (Rapier bodies raining on a colliding crowd).

## Things worth trying

* **Shadows with the crowd casting vs. not casting.** The shadow pass re-draws every agent, so
  crowd vertex cost doubles. Blob shadows give most of the visual benefit for almost nothing.
* **Toon outlines (inverted hull) vs. Stylize → Ink edges.** The same look at a very different
  cost: one scales with crowd size, the other with pixels.
* **Isometric vs. eye-level with the GPU-driven path.** In iso nearly everything is visible and
  the same size. At eye level most agents are culled or dropped to the cheapest LOD.
* **Pixel ratio cap** on a phone. Going from 3× to 1.5× cuts the pixel count by 4×, usually the
  biggest single win.
* **16 → 64 point lights, forward vs. clustered.** Forward rendering evaluates every light for every
  pixel; clustered only evaluates the lights near that pixel.
* **Converge on hero** piles the whole crowd into one spot: an overdraw worst case. With physics on,
  the GPU collisions keep people from overlapping and the pile spreads out instead.
* **Animation systems** at the same crowd size: procedural vs keyframe vs skeletal vs baked bones vs
  VAT. Zoom in on Box-man models to see the difference in motion and joints, then run *Measure effect
  costs*. Above 131k agents skeletal leaves the extra agents in their rest pose; baked bones animate
  everyone.
* **GPU vs Rapier crowd collisions**: GPU handles every agent for a few milliseconds of compute;
  Rapier handles a few thousand with exact two-way contacts but costs CPU time and a round trip.
* **Crowd motion vectors** with Motion blur or TRAA on: *camera only* leaves walking people sharp
  under motion blur and lets TRAA smear them; *root* fixes both for a few ALU ops per vertex; *full*
  also blurs swinging limbs for about twice the vertex animation cost. Best seen up close (chase or
  eye-level camera) with a high walk speed.
* **Pixel filters** often make the frame *cheaper*, because the scene really renders at 144-240 lines.

## Development

| Command | What |
|---|---|
| `npm run dev` | dev server with hot reload |
| `npm run lint` | ESLint (catches undefined names, unused code) |
| `npm run build` | single-file build → `dist/index.html` + `webgpu-crowd-stress.html` |
| `npm run smoke` | after a build: headless Chromium with a software GPU walks every preset, animation system, stylize mode and physics action, and checks the Claude link against a fake database. Fails on any page or WebGPU error. `--quick` for a 1-2 minute version, `--shots dir/` saves screenshots. |

GitHub runs two automatic jobs (*Actions* tab): **Build** (lint + build on every push, the built
HTML is downloadable from the run) and **Smoke test** (the full smoke test, nightly if something
was pushed that day, or on demand with *Run workflow*). The smoke test proves things run, not how
fast: the software GPU is a CPU rasteriser.

## Project layout

```
index.html              UI shell + styles (Vite entry)
src/main.js             App: settings -> subsystems, frame loop (entry module)
src/app/                config + key groups, settings appliers, hero, HUD/report, buttons/hotkeys
src/gpu.js              WebGPU device creation (real hardware limits, no fallback)
src/crowd/crowd.js      Crowd class: lifecycle, settings, per-frame compute order, stats
src/crowd/sim.js        compute kernels: init, simulation/AI, skeletal bones, physics proxies
src/crowd/cull.js       GPU-driven path: frustum + screen-size LOD cull, indirect draws
src/crowd/materials.js  crowd vertex shader per animation system, materials, meshes
src/crowd/motion.js     per-agent motion vectors (velocity buffer) for motion blur / TRAA
src/crowd/anim.js       the six animation systems (procedural, keyframe, skeletal, baked bones, VAT)
src/crowd/clips.js      hand-keyed animation clips + CPU pose chain (bone texture + VAT baking)
src/crowd/models.js     procedural low-poly character tiers (+ skin weights)
src/crowd/collide.js    GPU spatial-hash crowd collisions
src/world.js            World: plaza, props, settings entry points
src/world/              prop geometry, shading models + ground, lights/shadows/sky/fog
src/physics.js          PhysicsDemo: Rapier world lifecycle, hero controller, per-step order
src/physics/            bodies + spawn patterns, crowd coupling, prop colliders, debug draw
src/camera.js           isometric / top / orbit / chase / eye-level camera rig + input
src/post.js             post-processing graph (RenderPipeline + TSL nodes)
src/cel.js              Wind Waker / Jet Set Radio cel-shading lighting model
src/features.js         every setting with its cost and teaching note (drives the UI)
src/bench.js            max-crowd, effect-cost and steady-state benchmarks
src/bridge.js           Claude link (artifact database command runner)
src/ui.js, input.js     settings panel, HUD graph, keyboard / touch controls
scripts/                post-build copy, README table generator, smoke test
.github/workflows/      Build (every push) and Smoke test (nightly / on demand)
```

## Notes and limits

* Agents are positioned entirely by the vertex shader, so three.js can't derive their motion vectors
  (the velocity buffer for motion blur / TRAA / SSGI) itself. *Crowd motion vectors*
  (`src/crowd/motion.js`) rebuilds them in the shader: *root* steps each agent back by one frame of
  its walking velocity (same speed formula as the simulation, no extra buffers), *full* also
  re-evaluates last frame's animation pose (skeletal falls back to root: its bone buffer only holds
  the current pose). GPU-collision pushes, knockbacks and turning are not captured.
* GPU crowd collisions are position-based and use fixed-size grid buckets (8 per 1 m cell); in an
  extremely dense pile a few overlaps are missed each frame. Rapier-mode agents stay upright
  (rotations locked) and are kept on the ground plane.
* The two-way proxies and Rapier crowd depend on an asynchronous GPU→CPU readback, so Rapier
  sees people positions one or two frames late.
* In the GPU-driven path, culling uses the main camera, so agents just outside the view don't cast
  shadows into it.
* r186 details handled here: `PCFSoftShadowMap` was folded into `PCFShadowMap` (+ radius), and
  `PassNode.getViewZNode()` assumes a perspective camera, so depth of field computes an
  orthographic view-Z itself for the isometric camera. The velocity buffer holds NDC offsets (y up)
  while `motionBlur()` steps in UV space (y down), so motion blur converts it the way TRAA does
  (otherwise diagonal motion smears along the mirrored diagonal, at twice the length).
* Built and smoke-tested in headless Chromium with a software WebGPU adapter (SwiftShader). That
  checks correctness, not speed, so all real performance numbers have to come from real devices.
