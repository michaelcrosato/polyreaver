// Every knob in the demo, with a teaching note.
//
//  cost:  0 = free, 1 = cheap, 2 = moderate, 3 = heavy, 4 = very heavy
//  bound: what part of the GPU (or CPU) the feature leans on
//    vertex    - scales with triangles/vertices (crowd size x model detail)
//    fill      - scales with pixels (resolution x overdraw)
//    bandwidth - reads/writes of full-screen buffers (render targets, G-buffer)
//    compute   - compute shader work (scales with agent count)
//    cpu       - JavaScript / WASM work on the main thread
//    compile   - causes shader recompiles (hitch when toggled)

export const COUNT_STEPS = [ 100, 500, 1000, 2000, 5000, 10000, 20000, 35000, 50000, 75000, 100000, 150000, 200000, 300000, 500000, 750000, 1000000, 1500000, 2000000, 3000000, 4000000 ];

export const CAPACITIES = [ 65536, 262144, 1048576, 2097152, 4194304 ];

const fmt = ( n ) => n >= 1e6 ? ( n / 1e6 ).toFixed( n % 1e6 ? 1 : 0 ) + 'M' : n >= 1000 ? Math.round( n / 1000 ) + 'k' : String( n );
export { fmt as formatCount };

export const SECTIONS = [
	{
		id: 'crowd',
		title: 'Crowd',
		items: [
			{
				key: 'count', label: 'Crowd size', type: 'count', def: 20000, cost: 2, bound: 'vertex / compute',
				info: 'How many agents are simulated and drawn. Every agent runs the compute shader once per frame and every one of its vertices runs the vertex shader. Triangles on screen = agents x triangles per model.',
				mobile: 'Rough starting point only: expect a phone to hold somewhere in the tens of thousands of Tetra agents at 60 fps and a desktop GPU far more. Run "Find max crowd" to get the real number for each device.'
			},
			{
				key: 'capacity', label: 'Max crowd (GPU buffer size)', type: 'select', def: 'auto', cost: 1, bound: 'memory',
				options: [ [ 'auto', 'Auto' ], ...CAPACITIES.map( ( c ) => [ c, fmt( c ) ] ) ],
				info: 'How big the storage buffers are. Each agent costs 32 bytes (plus 64 more in GPU-driven mode). Changing it re-allocates buffers and resets the crowd.',
				mobile: '256k is a safe mobile ceiling; 4M agents need about 384 MB of GPU memory in GPU-driven mode.'
			},
			{
				key: 'tier', label: 'Character model', type: 'select', def: 0, cost: 2, bound: 'vertex',
				options: [ [ 0, 'Tetra - 24 tris' ], [ 1, 'Prism (Star Fox) - 52 tris' ], [ 2, 'Box-man (Alone in the Dark) - 168 tris' ], [ 3, 'Hi - 436 tris' ] ],
				info: 'Triangles per character. Vertex cost scales linearly with it. In GPU-driven mode this is the MAXIMUM detail: distant agents drop to cheaper models automatically.',
				mobile: 'Mobile GPUs are often vertex-limited long before fill-limited with tiny triangles. Sub-pixel triangles are wasted work on every GPU.'
			},
			{
				key: 'path', label: 'Render path', type: 'select', def: 'direct', cost: 1, bound: 'vertex / compute',
				options: [ [ 'direct', 'Direct: 1 instanced draw, no culling' ], [ 'gpu', 'GPU-driven: compute cull + LOD + indirect draw' ] ],
				info: 'Direct draws every agent even if it is off screen. GPU-driven runs a compute pass that frustum-culls each agent, picks a level of detail from its on-screen size, and writes compacted per-LOD lists that are drawn with drawIndexedIndirect. The CPU never learns how many are visible. This is how modern engines draw huge crowds.',
				mobile: 'GPU-driven wins as soon as a large part of the crowd is off screen or far away (perspective views). In a zoomed-out isometric view everything is visible and it can be slightly slower.'
			},
			{
				key: 'lod', label: 'Automatic LOD (GPU-driven only)', type: 'toggle', def: true, cost: 0, bound: 'vertex',
				info: 'Swap to cheaper models when a character is only a few pixels tall. Thresholds: >150 px Hi, >60 px Box-man, >22 px Prism, otherwise Tetra.'
			},
			{
				key: 'anim', label: 'Animation system', type: 'select', def: 'procedural', cost: 2, bound: 'vertex / compute / memory',
				options: [ [ 'none', 'None (static pose)' ], [ 'procedural', 'Procedural sine (per vertex)' ], [ 'keyframe', 'Keyframe clips + blending (per vertex)' ], [ 'skeletal', 'Skeletal skinning (bones per agent)' ], [ 'bat', 'Skeletal (baked bone texture, no agent cap)' ], [ 'vat', 'Baked vertex animation texture (VAT)' ] ],
				info: 'Six ways to animate the same crowd, all driving the same 8 activities. Procedural: sine curves per joint, cheapest, states pop. Keyframe: hand-keyed clips (walk contact/passing poses, jumps, disco points...) sampled per vertex from a table, with cross-fades - nicer motion, more ALU per vertex. Skeletal: the clips are sampled ONCE per agent in a compute pass that builds 10 bone matrices (480 bytes/agent/frame), then the vertex shader skins with smooth weights (elbows and knees bend instead of hinging) - the standard game-engine approach, heavy on memory and bandwidth. Baked bone texture: the same bone matrices, but computed once at load time for every clip key and stored in one 120 KB texture; the vertex shader fetches the two keys around the phase of each agent, interpolates and skins - no compute pass and no memory per agent (so no 131k cap), paid for with 12 texture reads per vertex (24 while cross-fading). The classic way to skin huge crowds. VAT: every vertex position of every clip frame is baked into a float texture at load time - the vertex shader just reads it back, zero joint maths.',
				mobile: 'Skeletal needs storage buffers in the vertex stage (some older phones have none - it falls back to keyframe) and ~63 MB for 131k agents. The baked bone texture needs neither (plain texture reads, 120 KB in total), so it brings smooth skinning to those phones too, but its 12-24 reads per vertex add up on vertex-limited GPUs - pair it with low-poly models. VAT and procedural remain the mobile-friendly choices.'
			},
			{ key: 'animBlend', label: 'Cross-fade between activities', type: 'toggle', def: true, cost: 1, bound: 'vertex', info: 'Keyframe / skeletal / baked bones / VAT blend the outgoing and incoming clip over 0.25 s instead of snapping. Costs a second clip sample per vertex (or per agent for skeletal; baked bones only pay it while an agent is fading).' },
			{
				key: 'behaviour', label: 'Behaviour', type: 'select', def: 0, cost: 1, bound: 'compute',
				options: [ [ 0, 'Wander (random activities)' ], [ 1, 'Converge on hero (mass rush)' ], [ 2, 'Flee from hero' ], [ 3, 'Dance party' ], [ 4, 'Stadium wave' ], [ 5, 'Freeze (simulation off)' ] ],
				info: 'All simulation runs in one compute shader, so behaviour changes are free on the CPU. "Converge" packs everyone around the hero: huge overdraw hot-spot.'
			},
			{ key: 'density', label: 'Density (people / m²)', type: 'range', def: 0.35, min: 0.05, max: 3, step: 0.05, cost: 1, bound: 'fill', info: 'How tightly the crowd is packed. Denser crowds overlap more on screen (overdraw) and the world gets smaller.' },
			{ key: 'activity', label: 'Activity (share walking)', type: 'range', def: 0.6, min: 0, max: 1, step: 0.05, cost: 0, bound: 'compute', info: 'Chance that an agent picks walking/running over standing activities when its timer runs out.' },
			{ key: 'speed', label: 'Walk speed', type: 'range', def: 1, min: 0, max: 3, step: 0.1, cost: 0, bound: 'compute', info: 'Global speed multiplier.' }
		]
	},
	{
		id: 'lighting',
		title: 'Shading & lighting',
		items: [
			{
				key: 'shading', label: 'Shading model', type: 'select', def: 'unlit', cost: 2, bound: 'fill / compile',
				options: [ [ 'unlit', 'Unlit (flat colour)' ], [ 'lambert', 'Lambert (diffuse)' ], [ 'phong', 'Phong (diffuse + specular)' ], [ 'standard', 'Standard PBR' ], [ 'physical', 'Physical PBR (clearcoat + sheen)' ], [ 'toon', 'Toon (three.js default)' ], [ 'celWW', 'Cel - Wind Waker style' ], [ 'celJSR', 'Cel - Jet Set Radio style' ] ],
				info: 'Per-pixel lighting maths for every material. Unlit = one colour. Lambert = N·L. Phong adds a specular highlight. Standard is physically based (GGX microfacets, energy conserving). Physical adds clearcoat and sheen layers: noticeably more ALU per pixel. Toon quantises light into bands. The two cel styles use a custom lighting model: hard anti-aliased light bands, coloured (not grey) shadows, rim and specular bands - Wind Waker is soft and blue-shadowed, Jet Set Radio is a hard split with saturated colours (pair it with thick outlines).',
				mobile: 'Lambert/Phong or Standard with few lights is the usual mobile sweet spot. Physical is rarely worth it on phones.'
			},
			{ key: 'hemi', label: 'Ambient (hemisphere light)', type: 'toggle', def: true, cost: 1, bound: 'fill', info: 'Sky/ground colour fill so shadowed sides are not pitch black. One cheap light term. Only matters with a lit shading model.' },
			{ key: 'env', label: 'Environment map (IBL)', type: 'toggle', def: false, cost: 2, bound: 'fill / bandwidth', info: 'Image-based lighting from a pre-filtered (PMREM) cube map: soft ambient + reflections for Standard/Physical materials. Costs texture samples per pixel.', mobile: 'Fine on phones; the pre-filtering happens once at startup.' },
			{
				key: 'shadows', label: 'Sun shadows', type: 'select', def: 'off', cost: 3, bound: 'vertex / fill',
				options: [ [ 'off', 'Off' ], [ 'low', 'Low (1024, hard)' ], [ 'medium', 'Medium (2048, PCF)' ], [ 'high', 'High (4096, wide PCF)' ], [ 'vsm', 'VSM (2048, blurred)' ] ],
				info: 'Shadow mapping renders the scene a second time from the sun into a depth texture, then every lit pixel samples it. With the crowd casting, the vertex work DOUBLES: every agent is drawn twice. Bigger maps and soft filters add fill and sampling cost.',
				mobile: 'Real-time shadows for thousands of characters are one of the most expensive things you can turn on for a phone. Use blob shadows instead, or only let nearby agents cast.'
			},
			{ key: 'crowdShadows', label: 'Crowd casts shadows', type: 'toggle', def: true, cost: 3, bound: 'vertex', info: 'When off, only the props cast shadows and the crowd only receives them - the shadow pass no longer re-draws every agent.' },
			{ key: 'blobShadows', label: 'Blob shadows (fake)', type: 'toggle', def: false, cost: 1, bound: 'fill', info: 'A soft dark quad under each agent: 2 triangles and a little alpha blending. The classic cheap crowd shadow (used by nearly every game with big crowds).', mobile: 'Almost free - the best value visual upgrade on this list.' },
			{
				key: 'pointLights', label: 'Point lights (street lamps)', type: 'select', def: 0, cost: 3, bound: 'fill / compile',
				options: [ [ 0, 'None' ], [ 4, '4' ], [ 16, '16' ], [ 64, '64' ], [ 256, '256' ] ],
				info: 'Forward rendering loops over EVERY light for EVERY pixel of every lit material, and the light count is baked into the shader (changing it recompiles). 64+ lights in forward mode gets very slow.'
			},
			{ key: 'clustered', label: 'Clustered (Forward+) lighting', type: 'toggle', def: false, cost: 2, bound: 'compute / fill', info: 'A compute pass bins lights into screen tiles x depth slices; each pixel only evaluates the lights touching its cluster. Makes 100s of lights affordable.', mobile: 'Needs compute + storage buffers in the fragment stage; supported on most WebGPU phones.' },
			{ key: 'rim', label: 'Rim light (fresnel)', type: 'toggle', def: false, cost: 1, bound: 'fill', info: 'Brightens edges facing away from the camera (1 - N·V)^p. A few ALU ops per pixel; makes silhouettes pop in a crowd.' },
			{ key: 'outlineWidth', label: 'Outline thickness', type: 'range', def: 0.03, min: 0.01, max: 0.15, step: 0.005, cost: 0, bound: 'fill', info: 'How far the inverted hull is pushed out (metres). Jet Set Radio style wants it thick.' },
			{ key: 'outlines', label: 'Toon outlines (inverted hull)', type: 'toggle', def: false, cost: 3, bound: 'vertex', info: 'Draws every character a second time, inflated along its surface direction, back faces only, in black. Classic cel-shade outline - but it DOUBLES the crowd vertex work.', mobile: 'Consider the screen-space "Ink edges" stylize option instead: fixed cost regardless of crowd size.' }
		]
	},
	{
		id: 'environment',
		title: 'Environment',
		items: [
			{ key: 'sky', label: 'Sky', type: 'select', def: 'flat', cost: 1, bound: 'fill', options: [ [ 'flat', 'Flat colour' ], [ 'gradient', 'Gradient + sun glow' ], [ 'physical', 'Physical sky (scattering + clouds)' ] ], info: 'Only visible where no geometry covers the screen (mostly in perspective / eye-level views). The physical sky evaluates atmospheric scattering per pixel.' },
			{ key: 'fog', label: 'Fog', type: 'select', def: 'off', cost: 1, bound: 'fill', options: [ [ 'off', 'Off' ], [ 'distance', 'Distance fog' ], [ 'height', 'Height fog (low mist)' ] ], info: 'Blends every pixel toward a fog colour by distance or height. A few ALU ops per pixel. Distance fog also hides LOD pops and lets you shrink the draw distance.' },
			{ key: 'props', label: 'Props (trees, lamps, monument)', type: 'toggle', def: true, cost: 1, bound: 'vertex', info: 'A few thousand instanced props (~20-40 tris each) so it looks like a place.' },
			{ key: 'groundDetail', label: 'Procedural paving', type: 'toggle', def: true, cost: 1, bound: 'fill', info: 'Ground pattern computed per pixel (tiles, grout, rings) instead of a texture. The ground covers the whole screen, so every ALU op here is multiplied by the pixel count.' }
		]
	},
	{
		id: 'post',
		title: 'Resolution & anti-aliasing',
		items: [
			{ key: 'maxDpr', label: 'Pixel ratio cap', type: 'select', def: '2', cost: 3, bound: 'fill', options: [ [ '1', '1x' ], [ '1.5', '1.5x' ], [ '2', '2x' ], [ 'native', 'Native' ] ], info: 'Phones have 2-3.5 device pixels per CSS pixel. At 3x you shade 9x the pixels of 1x. Capping the pixel ratio is the single biggest mobile performance lever.' },
			{ key: 'renderScale', label: 'Render scale', type: 'range', def: 1, min: 0.25, max: 1.5, step: 0.05, cost: 3, bound: 'fill', info: 'Renders fewer (or more) pixels than the display and upscales. Pixel cost scales with the square: 0.5 = a quarter of the pixels.' },
			{ key: 'upscaler', label: 'Upscaler (when scale < 1)', type: 'select', def: 'browser', cost: 1, bound: 'fill', options: [ [ 'browser', 'Browser bilinear (free)' ], [ 'fsr1', 'AMD FSR 1 (edge-adaptive + sharpen)' ] ], info: 'FSR 1 reconstructs edges and sharpens. It costs two extra full-screen passes at output resolution - only worth it when you are heavily fill-rate bound.' },
			{ key: 'aa', label: 'Anti-aliasing', type: 'select', def: 'none', cost: 2, bound: 'fill / bandwidth', options: [ [ 'none', 'None' ], [ 'msaa', 'MSAA 4x (hardware)' ], [ 'fxaa', 'FXAA (post, cheapest)' ], [ 'smaa', 'SMAA (post, sharper)' ], [ 'traa', 'TRAA (temporal)' ] ], info: 'MSAA samples geometry edges 4x in hardware (memory/bandwidth heavy, very cheap on tile-based mobile GPUs). FXAA/SMAA blur jaggies in a post pass. TRAA jitters the camera each frame and accumulates history: smoothest result, some ghosting, needs velocity buffers.', mobile: 'On tile-based phone GPUs (Apple, Mali, Adreno) MSAA is resolved in on-chip tile memory, so it is usually much cheaper than on desktop - often the best AA choice for mobile.' }
		]
	},
	{
		id: 'fx',
		title: 'Post-processing',
		items: [
			{ key: 'toneMapping', label: 'Tone mapping', type: 'select', def: 'none', cost: 1, bound: 'fill', options: [ [ 'none', 'None' ], [ 'linear', 'Linear' ], [ 'reinhard', 'Reinhard' ], [ 'cineon', 'Cineon' ], [ 'aces', 'ACES Filmic' ], [ 'agx', 'AgX' ], [ 'neutral', 'Khronos Neutral' ] ], info: 'Maps HDR light values into the 0-1 display range with a film-like curve. A handful of ALU ops per pixel - essentially free.' },
			{ key: 'exposure', label: 'Exposure', type: 'range', def: 1, min: 0.2, max: 3, step: 0.05, cost: 0, bound: 'fill', info: 'Brightness multiplier before tone mapping.' },
			{ key: 'ao', label: 'Ambient occlusion', type: 'select', def: 'off', cost: 3, bound: 'fill / bandwidth', options: [ [ 'off', 'Off' ], [ 'ssao', 'SSAO (+ blur)' ], [ 'gtao', 'GTAO (ground truth)' ] ], info: 'Darkens creases and contact points by sampling the depth + normal buffers around each pixel (16 samples, half resolution). Requires writing a normal buffer (MRT) in the main pass. GTAO is more accurate and looks best with TRAA.', mobile: 'Expensive on phones; run at half resolution (already done here) or skip.' },
			{ key: 'bloom', label: 'Bloom', type: 'toggle', def: false, cost: 2, bound: 'bandwidth', info: 'Bright pixels bleed light: a threshold pass then 5 progressively downsampled blur levels. Mostly bandwidth.' },
			{ key: 'dof', label: 'Depth of field', type: 'select', def: 'off', cost: 3, bound: 'fill / bandwidth', options: [ [ 'off', 'Off' ], [ 'tiltshift', 'Tilt-shift (cheap screen blur)' ], [ 'bokeh', 'Bokeh DOF (physically based)' ] ], info: 'Tilt-shift blurs the top and bottom of the screen: the classic "miniature" isometric look for the price of one blur. Bokeh DOF computes a circle of confusion from depth and gathers a disc of samples - much heavier.' },
			{ key: 'motionBlur', label: 'Motion blur', type: 'toggle', def: false, cost: 2, bound: 'bandwidth', info: 'Smears pixels along their screen-space velocity (requires a velocity buffer). What the crowd writes into that buffer is set by "Crowd motion vectors".' },
			{
				key: 'motionVectors', label: 'Crowd motion vectors', type: 'select', def: 'root', cost: 2, bound: 'vertex / compile',
				options: [ [ 'camera', 'Camera only (agents count as still)' ], [ 'root', 'Root motion (walk velocity)' ], [ 'full', 'Full (walk + previous animation pose)' ] ],
				info: 'Motion blur, TRAA and SSGI read a velocity buffer: how far each pixel moved on screen since the last frame. three.js works it out per vertex from last frame\'s camera and the vertex\'s previous position, but the crowd is placed by our vertex shader from GPU data, so it has to supply that position itself. Camera only: previous = current, so walking people get no motion blur and TRAA smears them. Root motion: the shader rebuilds each agent\'s walking velocity from data it already has (state, heading, agent index - the simulation\'s own speed formula) and steps one frame back: a hash and a sin/cos per vertex, no extra buffers. Full: also re-runs the animation one frame earlier (previous phase and cross-fade), so swinging arms and legs blur too - roughly doubles the per-vertex animation cost. Skeletal uses root motion here: its bone buffer only holds the current frame\'s pose. Nothing is computed unless a velocity buffer is rendered; changing it recompiles the crowd shaders.',
				mobile: 'Root motion is close to free; Full doubles the animation work of a vertex-bound crowd, so keep it for desktop.'
			},
			{ key: 'ssr', label: 'Screen-space reflections', type: 'toggle', def: false, cost: 4, bound: 'fill / bandwidth', info: 'Makes the plaza wet and ray-marches the depth buffer to find reflected pixels. Needs normal + metal/roughness buffers. Only reflects what is on screen. Works best with Standard/Physical shading.', mobile: 'Usually too heavy for phones.' },
			{ key: 'ssgi', label: 'Screen-space GI', type: 'toggle', def: false, cost: 4, bound: 'fill / bandwidth', info: 'Screen-space global illumination: bounced light + AO from the depth/normal buffers, temporally accumulated. By far the heaviest effect here - a "what does ultra cost" knob. Measured on an RTX 3060 Ti at 1924x1960: +16.8 ms GPU, about four times SSR (+3.8 ms) and roughly as much as all the other effects in this panel put together. It traces many rays per pixel, so its cost scales with the pixel count: Render scale 0.5 leaves a quarter of the pixels.', mobile: 'Not realistic on phones: expect single-digit fps.' },
			{ key: 'grading', label: 'Colour grading', type: 'toggle', def: false, cost: 1, bound: 'fill', info: 'Saturation, contrast and warmth adjustments. A few ALU ops per pixel.' },
			{ key: 'vignette', label: 'Vignette', type: 'toggle', def: false, cost: 1, bound: 'fill', info: 'Darkens the screen edges. Trivial ALU.' },
			{ key: 'grain', label: 'Film grain', type: 'toggle', def: false, cost: 1, bound: 'fill', info: 'Animated noise over the image. Trivial ALU.' },
			{ key: 'chromatic', label: 'Chromatic aberration', type: 'toggle', def: false, cost: 1, bound: 'bandwidth', info: 'Offsets the colour channels toward the edges: 3 texture reads per pixel.' },
			{ key: 'sharpen', label: 'Sharpen (RCAS)', type: 'toggle', def: false, cost: 1, bound: 'fill', info: 'Contrast-adaptive sharpening. Recovers crispness after TRAA/FXAA or upscaling.' },
			{ key: 'stylize', label: 'Stylize', type: 'select', def: 'none', cost: 2, bound: 'fill', options: [ [ 'none', 'None' ], [ 'ink', 'Ink edges (screen-space Sobel)' ], [ 'pixel', 'Pixel art (low-res + edge lines)' ], [ 'pico8', 'Pixel: PICO-8 16-colour palette' ], [ 'gameboy', 'Pixel: Game Boy 4-shade green' ], [ 'snes', 'Pixel: 16-bit console (15-bit colour)' ], [ 'crt', 'Pixel: CRT arcade (scanlines, curvature)' ], [ 'retro', 'PS1 retro (vertex snap, low-res, dither)' ] ], info: 'Screen-space outlines cost the same whatever the crowd size (compare with inverted-hull outlines). Pixel/PS1 modes render at low resolution, so they can actually be faster than the default. The palette modes quantise every pixel to a fixed console palette with 4x4 ordered (Bayer) dithering: PICO-8 (16 colours, ~320x180), Game Boy (4 greens, 144 lines), 16-bit (15-bit colour, 224 lines), CRT arcade (240 lines + scanlines, colour bleed and screen curvature).' }
		]
	},
	{
		id: 'physics',
		title: 'Physics (Rapier 0.19.3 + GPU)',
		items: [
			{ key: 'physics', label: 'Enable physics', type: 'toggle', def: false, cost: 3, bound: 'cpu / compute', info: 'Turns on physics for everything: rigid bodies fall and collide with each other, the ground, trees, lamps and the monument; the hero becomes a character controller that shoves them; people collide with each other, with props and with bodies (and get knocked over). Rapier (Rust compiled to WebAssembly) runs on the CPU; crowd collisions run on the GPU.', mobile: 'Rapier is single-threaded CPU work: watch "step" in the HUD and keep it well under 16.7 ms. The GPU crowd collisions scale much better on phones.' },
			{ type: 'actions', actions: [ [ 'explode', '💥 Explosion' ], [ 'wrecking', '⚫ Drop wrecking ball' ], [ 'respawn', '↻ Respawn bodies' ] ] },
			{ key: 'crowdMode', label: 'Crowd collisions', type: 'select', def: 'gpu', cost: 3, bound: 'compute / cpu', options: [ [ 'off', 'Off (people walk through everything)' ], [ 'gpu', 'GPU spatial hash (every agent)' ], [ 'rapier', 'Rapier rigid bodies (first N agents) + GPU for the rest' ] ], info: 'GPU: a compute pass bins every agent into a 1 m grid (atomic bucket counters) and each agent pushes itself out of neighbours, props and bodies - scales to millions, but it is position-based and one-way against bodies. Rapier: the first N agents become real dynamic capsules - fully two-way (balls bounce off people, people shove each other and pile up) - with the GPU AI steering them. That needs a GPU->CPU readback of steering and a CPU->GPU upload of positions every frame.' },
			{ key: 'rapierAgents', label: 'Rapier agents (Rapier mode)', type: 'select', def: 2000, cost: 3, bound: 'cpu / bandwidth', options: [ [ 500, '500' ], [ 1000, '1,000' ], [ 2000, '2,000' ], [ 5000, '5,000' ], [ 10000, '10,000' ], [ 20000, '20,000' ] ], info: 'How many agents (nearest the plaza centre) get a real Rapier body. CPU step cost grows roughly linearly with contacts; the readback/upload grows linearly with N.' },
			{ key: 'agentRadius', label: 'Person radius (personal space)', type: 'range', def: 0.28, min: 0.15, max: 0.6, step: 0.01, cost: 1, bound: 'compute', info: 'Collision radius of each person. Bigger = more neighbours overlap per frame = more work (and a less dense crowd).' },
			{ key: 'proxies', label: 'Two-way: bodies bounce off people near the hero', type: 'toggle', def: true, cost: 2, bound: 'cpu / bandwidth', info: 'GPU mode is one-way (bodies push people). With this on, a compute pass lists the people within 18 m of the hero, the list is read back to the CPU, and each gets a kinematic Rapier capsule - so falling balls bounce off heads and roll away. A classic "physics proxies near the player" technique.' },
			{ key: 'proxyCount', label: 'Proxy budget', type: 'select', def: 1024, cost: 2, bound: 'cpu', options: [ [ 256, '256' ], [ 1024, '1,024' ], [ 4096, '4,096' ] ], info: 'Maximum number of kinematic people-proxies inside Rapier.' },
			{ key: 'knockdown', label: 'Knockdowns', type: 'toggle', def: true, cost: 1, bound: 'compute', info: 'People hit by fast bodies (or the explosion / wrecking ball) are thrown back and play a stagger animation.' },
			{ key: 'physProps', label: 'Props are solid', type: 'toggle', def: true, cost: 1, bound: 'cpu', info: 'Trees (trunk + canopy cone), lamp posts and the monument get static colliders. Static colliders are cheap: they only cost when something touches them.' },
			{ key: 'propsDynamic', label: 'Props can be knocked over', type: 'toggle', def: true, cost: 1, bound: 'cpu', info: 'Every tree and lamp post is a sleeping dynamic body instead of a static collider: it costs almost nothing until something heavy (the wrecking ball, a pile of boxes, the hero) hits it, then it wakes up and topples. Toppled props stop blocking people.' },
			{ key: 'bodies', label: 'Rigid bodies', type: 'select', def: 1000, cost: 3, bound: 'cpu', options: [ [ 0, 'None' ], [ 100, '100' ], [ 250, '250' ], [ 1000, '1,000' ], [ 2500, '2,500' ], [ 5000, '5,000' ], [ 10000, '10,000' ] ], info: 'Number of dynamic bodies. Each one is a CPU-simulated rigid body whose transform is copied into an instanced mesh every frame.' },
			{ key: 'shape', label: 'Body shape', type: 'select', def: 'mixed', cost: 2, bound: 'cpu', options: [ [ 'mixed', 'Mixed' ], [ 'ball', 'Balls' ], [ 'box', 'Boxes' ], [ 'capsule', 'Capsules' ], [ 'cylinder', 'Cylinders' ], [ 'rock', 'Convex rocks' ] ], info: 'Contact cost order, cheapest first: sphere, capsule, box, cylinder, convex hull. Spheres touch at one point; boxes and hulls need contact manifolds with several points.' },
			{ key: 'sizeVar', label: 'Body sizes', type: 'select', def: 'uniform', cost: 1, bound: 'cpu', options: [ [ 'uniform', 'Uniform' ], [ 'varied', 'Varied (0.6x - 1.8x)' ] ], info: 'Mixed sizes stack less neatly and make the broad phase work harder.' },
			{ key: 'spawn', label: 'Spawn pattern', type: 'select', def: 'rain', cost: 2, bound: 'cpu', options: [ [ 'rain', 'Rain around the hero' ], [ 'pile', 'Drop a pile' ], [ 'wall', 'Brick wall' ], [ 'towers', 'Box towers' ] ], info: 'Rain keeps bodies moving (and recycles them). A pile creates a huge contact island all at once. Walls and towers are stacking tests: they need enough solver iterations to stand still.' },
			{ key: 'restitution', label: 'Bounciness', type: 'range', def: 0.25, min: 0, max: 1, step: 0.05, cost: 0, bound: 'cpu', info: 'Coefficient of restitution for the bodies.' },
			{ key: 'friction', label: 'Friction', type: 'range', def: 0.7, min: 0, max: 1.5, step: 0.05, cost: 0, bound: 'cpu', info: 'Coulomb friction of the bodies.' },
			{ key: 'gravity', label: 'Gravity (m/s²)', type: 'range', def: - 9.81, min: - 30, max: 0, step: 0.5, cost: 0, bound: 'cpu', info: 'World gravity. 0 = everything floats.' },
			{ key: 'hz', label: 'Simulation rate', type: 'select', def: 60, cost: 2, bound: 'cpu', options: [ [ 30, '30 Hz' ], [ 60, '60 Hz' ], [ 120, '120 Hz' ] ], info: 'Fixed timestep with an accumulator (up to 4 steps per frame). Doubling the rate doubles the physics CPU cost but makes fast objects and stacks more stable.' },
			{ key: 'iterations', label: 'Solver iterations', type: 'select', def: 4, cost: 2, bound: 'cpu', options: [ [ 1, '1' ], [ 2, '2' ], [ 4, '4 (Rapier default)' ], [ 8, '8' ], [ 16, '16' ] ], info: 'How many times per step the constraint solver refines contacts. More = stiffer stacks and less jitter, linearly more CPU.' },
			{ key: 'ccd', label: 'Continuous collision detection', type: 'toggle', def: false, cost: 2, bound: 'cpu', info: 'Sweeps fast bodies between steps so they cannot tunnel through thin objects. Costs extra time-of-impact queries per moving body.' },
			{ key: 'sleep', label: 'Allow sleeping', type: 'toggle', def: true, cost: 0, bound: 'cpu', info: 'Bodies that come to rest are skipped until something touches them. Turning this off shows the cost of simulating everything every step.' },
			{ key: 'recycle', label: 'Recycle fallen / distant bodies', type: 'toggle', def: true, cost: 0, bound: 'cpu', info: 'Rain mode only: bodies that fall off the world or are left behind respawn above the hero.' },
			{ key: 'physDebug', label: 'Debug draw colliders', type: 'toggle', def: false, cost: 3, bound: 'cpu / bandwidth', info: 'Draws every collider as wireframe lines straight from Rapier. Useful for learning, expensive with many bodies: all the line vertices are rebuilt on the CPU and uploaded every frame.' }
		]
	}
];

export function defaults() {

	const out = {};
	for ( const s of SECTIONS ) for ( const it of s.items ) if ( it.key ) out[ it.key ] = it.def;
	out.camera = 'iso';
	return out;

}

export function findItem( key ) {

	for ( const s of SECTIONS ) for ( const it of s.items ) if ( it.key === key ) return it;
	return null;

}

// Presets only override what they list; everything else returns to default.
export const PRESETS = {
	bare: { label: 'Bare (all off)', values: {} },
	mobile: {
		label: 'Mobile friendly',
		values: { shading: 'lambert', blobShadows: true, fog: 'distance', aa: 'msaa', toneMapping: 'aces', maxDpr: '1.5', rim: true }
	},
	console: {
		label: 'Console',
		values: { shading: 'standard', env: true, shadows: 'medium', blobShadows: false, fog: 'distance', aa: 'smaa', toneMapping: 'aces', bloom: true, ao: 'ssao', vignette: true, grading: true, sky: 'gradient', pointLights: 16, tier: 1, path: 'gpu' }
	},
	ultra: {
		label: 'Ultra (everything)',
		values: { shading: 'physical', env: true, shadows: 'high', fog: 'distance', aa: 'traa', toneMapping: 'agx', bloom: true, ao: 'gtao', dof: 'bokeh', motionBlur: true, ssr: true, vignette: true, grading: true, grain: true, chromatic: true, sharpen: true, sky: 'physical', pointLights: 64, clustered: true, rim: true, tier: 3, path: 'gpu' }
	},
	toon: {
		label: 'Toon',
		values: { shading: 'toon', outlines: true, blobShadows: true, toneMapping: 'neutral', bloom: true, aa: 'fxaa', sky: 'gradient', tier: 2 }
	},
	retro: {
		label: 'PS1 retro',
		values: { shading: 'lambert', stylize: 'retro', fog: 'distance', blobShadows: true, tier: 1 }
	},
	windwaker: {
		label: 'Wind Waker',
		values: { shading: 'celWW', anim: 'keyframe', tier: 2, sky: 'gradient', hemi: true, shadows: 'medium', crowdShadows: true, fog: 'distance', toneMapping: 'none', bloom: true, aa: 'smaa', grading: true, rim: false }
	},
	jsr: {
		label: 'Jet Set Radio',
		values: { shading: 'celJSR', anim: 'keyframe', tier: 2, outlines: true, outlineWidth: 0.09, sky: 'gradient', hemi: true, toneMapping: 'none', grading: true, aa: 'fxaa', blobShadows: true }
	},
	gameboy: {
		label: 'Game Boy',
		values: { shading: 'lambert', stylize: 'gameboy', blobShadows: true, tier: 1, anim: 'vat' }
	},
	physics: {
		label: 'Physics playground',
		values: { physics: true, crowdMode: 'gpu', proxies: true, bodies: 1000, shading: 'lambert', shadows: 'low', blobShadows: true, anim: 'keyframe', tier: 1 }
	}
};
