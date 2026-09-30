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

1. Start from **Bare** (the default). Everything is off: unlit flat colours, no post-processing.
2. Open *Benchmark & report* → **Find max crowd** at 30 or 60 fps. It ramps the agent count until
   the frame rate falls below the target, then narrows it down.
3. Turn on the features you want in your game (or pick a preset) and run it again. Or run
   **Measure effect costs**: it switches each feature on top of your current settings and records
   the extra milliseconds.
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

## What's inside

**Characters** (`src/crowd/models.js`) are built procedurally from convex primitives in four tiers:
*Tetra* (24 triangles, every body part is a tetrahedron), *Prism* (52, Star Fox style),
*Box-man* (168, Alone in the Dark style, elbows and knees) and *Hi* (436). There are no normals
(flat shading comes from screen-space derivatives) and no skeleton: every vertex stores the id of
its body part and the joint it pivots around.

**Simulation** (`src/crowd/crowd.js`) is one compute shader per frame. Each agent picks an
activity (idle, walk, run, wave, cheer, dance, talk), walks to random targets near its "home" on a
sunflower spiral (so the crowd grows outward as the count rises), and writes a single packed
`vec4` per agent: `x, animPhase, z, state + heading + colourSeed`. Behaviour modes (converge on the
hero, flee, dance party, stadium wave) are just branches in the same shader. There's no collision
between agents, by design.

**Animation** happens in the vertex shader: each part rotates around its joint (hips, knees,
shoulders, elbows, neck) using sine curves driven by the agent's phase and state. This is how most
huge-crowd games do it: far cheaper than GPU skinning.

**Two render paths:**

* *Direct*: one instanced draw call for the whole crowd. Simple, and every agent is transformed
  even when it's off screen.
* *GPU-driven*: a compute pass frustum-culls every agent, estimates its on-screen height in
  pixels, picks one of the four models (LOD), and appends it to a per-LOD list with an atomic
  counter. Each list is drawn with `drawIndexedIndirect`, so the CPU never knows how many are
  visible. This is the technique modern engines use for massive crowds.

The hero is agent #0: same buffers and shader, driven by uniforms instead of AI.

**Rapier 0.19.3** (`src/physics.js`) is an optional side demo: boxes and balls rain around the
hero, who is a kinematic capsule that shoves them. It's the opposite architecture to the crowd
(CPU/WASM simulation with transforms uploaded every frame), so you can compare the two cost models.
The crowd itself has no physics.

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
| Vertex animation | on | ●○○○ cheap | vertex / compile | Walk / run / wave / cheer / dance are procedural: each body part rotates around its joint inside the vertex shader (no skeleton, no bone matrices). Turning it off shows what the pure transform cost is. **Mobile:** Procedural vertex animation is far cheaper than GPU skinning with bone textures; it is what most huge-crowd games do. |
| Behaviour | Wander (random activities) | ●○○○ cheap | compute | All simulation runs in one compute shader, so behaviour changes are free on the CPU. "Converge" packs everyone around the hero: huge overdraw hot-spot. |
| Density (people / m²) | 0.35 | ●○○○ cheap | fill | How tightly the crowd is packed. Denser crowds overlap more on screen (overdraw) and the world gets smaller. |
| Activity (share walking) | 0.6 | ●○○○ free | compute | Chance that an agent picks walking/running over standing activities when its timer runs out. |
| Walk speed | 1 | ●○○○ free | compute | Global speed multiplier. |

### Shading & lighting

| Setting | Default | Cost | Bound by | What it does / why it costs |
|---|---|---|---|---|
| Shading model | Unlit (flat colour) | ●●○○ moderate | fill / compile | Per-pixel lighting maths for every material. Unlit = one colour. Lambert = N·L. Phong adds a specular highlight. Standard is physically based (GGX microfacets, energy conserving). Physical adds clearcoat and sheen layers: noticeably more ALU per pixel. Toon quantises light into bands. **Mobile:** Lambert/Phong or Standard with few lights is the usual mobile sweet spot. Physical is rarely worth it on phones. |
| Ambient (hemisphere light) | on | ●○○○ cheap | fill | Sky/ground colour fill so shadowed sides are not pitch black. One cheap light term. Only matters with a lit shading model. |
| Environment map (IBL) | off | ●●○○ moderate | fill / bandwidth | Image-based lighting from a pre-filtered (PMREM) cube map: soft ambient + reflections for Standard/Physical materials. Costs texture samples per pixel. **Mobile:** Fine on phones; the pre-filtering happens once at startup. |
| Sun shadows | Off | ●●●○ heavy | vertex / fill | Shadow mapping renders the scene a second time from the sun into a depth texture, then every lit pixel samples it. With the crowd casting, the vertex work DOUBLES: every agent is drawn twice. Bigger maps and soft filters add fill and sampling cost. **Mobile:** Real-time shadows for thousands of characters are one of the most expensive things you can turn on for a phone. Use blob shadows instead, or only let nearby agents cast. |
| Crowd casts shadows | on | ●●●○ heavy | vertex | When off, only the props cast shadows and the crowd only receives them - the shadow pass no longer re-draws every agent. |
| Blob shadows (fake) | off | ●○○○ cheap | fill | A soft dark quad under each agent: 2 triangles and a little alpha blending. The classic cheap crowd shadow (used by nearly every game with big crowds). **Mobile:** Almost free - the best value visual upgrade on this list. |
| Point lights (street lamps) | None | ●●●○ heavy | fill / compile | Forward rendering loops over EVERY light for EVERY pixel of every lit material, and the light count is baked into the shader (changing it recompiles). 64+ lights in forward mode gets very slow. |
| Clustered (Forward+) lighting | off | ●●○○ moderate | compute / fill | A compute pass bins lights into screen tiles x depth slices; each pixel only evaluates the lights touching its cluster. Makes 100s of lights affordable. **Mobile:** Needs compute + storage buffers in the fragment stage; supported on most WebGPU phones. |
| Rim light (fresnel) | off | ●○○○ cheap | fill | Brightens edges facing away from the camera (1 - N·V)^p. A few ALU ops per pixel; makes silhouettes pop in a crowd. |
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
| Motion blur | off | ●●○○ moderate | bandwidth | Smears pixels along their screen-space velocity (requires a velocity buffer). Camera motion only for the crowd, because agents are positioned by the GPU. |
| Screen-space reflections | off | ●●●● very heavy | fill / bandwidth | Makes the plaza wet and ray-marches the depth buffer to find reflected pixels. Needs normal + metal/roughness buffers. Only reflects what is on screen. Works best with Standard/Physical shading. **Mobile:** Usually too heavy for phones. |
| Screen-space GI | off | ●●●● very heavy | fill / bandwidth | Screen-space global illumination: bounced light + AO from the depth/normal buffers, temporally accumulated. The heaviest effect here - a "what does ultra cost" knob. |
| Colour grading | off | ●○○○ cheap | fill | Saturation, contrast and warmth adjustments. A few ALU ops per pixel. |
| Vignette | off | ●○○○ cheap | fill | Darkens the screen edges. Trivial ALU. |
| Film grain | off | ●○○○ cheap | fill | Animated noise over the image. Trivial ALU. |
| Chromatic aberration | off | ●○○○ cheap | bandwidth | Offsets the colour channels toward the edges: 3 texture reads per pixel. |
| Sharpen (RCAS) | off | ●○○○ cheap | fill | Contrast-adaptive sharpening. Recovers crispness after TRAA/FXAA or upscaling. |
| Stylize | None | ●●○○ moderate | fill | Screen-space outlines cost the same whatever the crowd size (compare with inverted-hull outlines). Pixel/PS1 modes render at low resolution, so they can actually be faster than the default. |

### Physics (Rapier 0.19.3)

| Setting | Default | Cost | Bound by | What it does / why it costs |
|---|---|---|---|---|
| Enable Rapier demo | off | ●●●○ heavy | cpu | Rapier (Rust compiled to WebAssembly) simulates rigid bodies on the CPU. Their transforms are copied into an instanced mesh every frame. This is the opposite model to the crowd: CPU simulation + upload vs. GPU compute. The crowd itself has no collision. **Mobile:** Physics cost is CPU/WASM-bound and single-threaded here, so phones hit their limit much earlier than desktops. Watch the "step" time in the HUD: keep it well under your frame budget (16.7 ms at 60 fps). |
| Rigid bodies | 1,000 | ●●●○ heavy | cpu | Boxes and balls raining onto the plaza around the hero. The hero is a kinematic capsule that shoves them around. |
| Shape | Mixed | ●○○○ cheap | cpu | Box-box contacts are more expensive to solve than sphere contacts. |

**Presets:** *Bare* (all off), *Mobile friendly* (Lambert, blob shadows, fog, MSAA, rim light, 1.5×
pixel ratio cap), *Console* (PBR, IBL, medium shadows, SSAO, bloom, SMAA, GPU-driven path), *Ultra*
(everything heavy on), *Toon*, *PS1 retro*.

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
* **Converge on hero** piles the whole crowd into one spot: an overdraw worst case.

## Project layout

```
index.html            UI shell + styles (Vite entry)
src/main.js           app wiring: settings, frame loop, hero, HUD, report
src/gpu.js            WebGPU device creation (real hardware limits, no fallback)
src/crowd/models.js   procedural low-poly character tiers
src/crowd/crowd.js    compute simulation, vertex animation, direct + GPU-driven paths
src/world.js          plaza, props, lights, shadows, sky, fog, environment
src/camera.js         isometric / top / orbit / chase / eye-level camera rig + input
src/post.js           post-processing graph (RenderPipeline + TSL nodes)
src/physics.js        Rapier 0.19.3 demo
src/features.js       every setting with its cost and teaching note (drives the UI)
src/bench.js          max-crowd and effect-cost benchmarks
src/ui.js, input.js   settings panel, HUD graph, keyboard / touch controls
scripts/              post-build copy + README table generator
```

## Notes and limits

* The velocity buffer (for motion blur / TRAA) captures camera motion but not each agent's own
  motion, because agents are positioned entirely by the GPU.
* In the GPU-driven path, culling uses the main camera, so agents just outside the view don't cast
  shadows into it.
* r186 details handled here: `PCFSoftShadowMap` was folded into `PCFShadowMap` (+ radius), and
  `PassNode.getViewZNode()` assumes a perspective camera, so depth of field computes an
  orthographic view-Z itself for the isometric camera.
* Built and smoke-tested in headless Chromium with a software WebGPU adapter (SwiftShader). That
  checks correctness, not speed, so all real performance numbers have to come from real devices.
