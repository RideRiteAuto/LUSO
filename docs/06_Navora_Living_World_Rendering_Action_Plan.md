# Navora Living World Rendering Action Plan

Status: approved direction; Phase 1 implementation started 2026-08-12.

## 1. Outcome

Turn the current continent-scale inspection mesh into a modern browser game-world
foundation that can be explored at human height. The finished system must support:

- convincing ground materials at walking distance and continental readability at altitude;
- deterministic grasses, bushes, reeds, rocks, scree, litter, driftwood, and similar
  non-gameplay dressing;
- ocean, lake, and river rendering backed by water data usable by swimming and boats;
- a real traversal controller rather than a camera snapped to the heightfield;
- streaming and level of detail across a world more than 200 km wide;
- WebGPU acceleration on modern hardware with a tested WebGL 2 fallback;
- reproducible generation from a seed, with authored masks and overrides taking priority;
- measurable quality tiers and performance budgets rather than screenshot-only approval.

Gameplay trees, harvestable plants, ore nodes, and other interactive resources are outside
the initial dressing pass. Their exclusion masks and future attachment points are in scope.

## 1a. Canon and Bible-fidelity gate

The creative source of truth for this work is
`data/lore/Navora_Worldbuilding_Bible_v11_TAILORING_FISHING_COOKING.docx`
(SHA-256 `08E30746B4B1745DA287E4E1A7EA0EC48615B696BEA4A80D0518C25FBB5310B9`).
The older, smaller v11 snapshot already in the repository is retained for provenance but
must not silently override this supplied edition where they differ.

The renderer is not allowed to turn Navora into a generic procedural-fantasy landscape.
Before a biome, terrain material, water body, dressing profile, settlement clearing, road,
port, or travel corridor is approved, it must be checked against the Bible's rules for:

- Valora and Seradia being equivalent in progression but environmentally distinct;
- zone-first geography and overlapping resource progression;
- Portuguese inspiration expressed through material culture and landscape rather than
  superficial labels;
- housing, farming, trade packs, roads, ports, waterways, and property geography being
  planned alongside combat terrain;
- environmental magic intensifying by region and progression instead of appearing as
  uniform decorative effects;
- permanent economic relevance of early regions;
- meaningful river, wetland, lake, coast, fishing, cooking, and maritime ecosystems;
- the Lusaran history remaining a layered environmental mystery rather than random ruins.

Every visual vertical slice therefore needs a short Bible-fidelity checklist naming the
specific zone identity, economy, travel role, water ecology, settlement relationship, and
environmental-magic cues it is implementing. A technically impressive scene that fails that
check does not pass the phase gate.

## 2. Non-negotiable architecture

1. `packages/generator` stays renderer-independent. It emits data, never Three.js objects.
2. Rendering consumes versioned tile manifests and raster/vector fields.
3. World coordinates remain meters. Rendering becomes camera-relative before dense detail.
4. Macro simulation and local presentation are separate:
   - macro terrain establishes continents, watersheds, biomes, roads, and settlements;
   - streamed local tiles add meter-scale surface relief and presentation-only detail.
5. Visual dressing is deterministic for `(world seed, tile coordinate, layer version)`.
6. Swimming, boats, buoyancy, shores, and water visuals query the same water-body contract.
7. Every expensive feature has a quality tier and can be measured independently.

## 3. Target technology

- Three.js current stable line (`r184` at plan creation).
- `WebGPURenderer` imported from `three/webgpu`.
- TSL/node materials for portable WGSL/WebGL shader generation.
- Automatic WebGL 2 backend fallback plus an explicit forced-fallback test mode.
- KTX2/Basis Universal for GPU-compressed terrain and prop textures.
- glTF/GLB with Meshopt/Draco where appropriate for environmental meshes.
- Web Workers for tile generation/decompression and non-render-thread spatial work.
- GPU storage buffers, compute culling, and indirect drawing only after measured CPU or
  draw-submission bottlenecks justify them.

WebGPU is a foundation, not an excuse to move every algorithm onto the GPU. Deterministic
world rules and canonical placement remain CPU/generator data; high-volume visibility,
animation, and local simulation are GPU candidates.

## 4. Performance and quality budgets

Primary reference: a current mid-range Windows laptop at 1920x1080.

| Metric | High | Balanced | Compatibility |
| --- | ---: | ---: | ---: |
| Frame target | 60 fps | 60 fps | 30+ fps |
| CPU frame p95 | <= 8 ms | <= 10 ms | <= 20 ms |
| GPU frame p95 | <= 12 ms | <= 14 ms | <= 28 ms |
| Visible draw submissions | <= 1,200 | <= 800 | <= 500 |
| Active terrain tiles | <= 220 | <= 150 | <= 90 |
| GPU texture budget | <= 1.5 GB | <= 768 MB | <= 384 MB |
| Initial playable download | <= 40 MB | <= 25 MB | <= 15 MB |
| Walk-mode tile stall | none > 50 ms | none > 75 ms | none > 120 ms |

Every phase records median and p95 frame time, draw calls, triangles, active instances,
texture memory estimates, tile queue depth, and renderer backend.

## 5. Delivery phases

### Phase 1 — Modern renderer and measurement foundation

Purpose: establish the renderer we will build materials, water, and vegetation on.

Deliverables:

- upgrade Three.js and type definitions to the current stable line;
- replace `WebGLRenderer` with `WebGPURenderer`;
- use WebGPU when available and automatic WebGL 2 fallback otherwise;
- support `?renderer=webgl` for forced compatibility testing;
- report requested backend, active backend, WebGPU availability, FPS, frame time, draw
  calls, triangles, geometries, and textures in the inspector;
- cap device pixel ratio according to `?quality=high|balanced|compatibility`;
- preserve all current terrain, overlay, fly, and walk behavior;
- produce both the Vite build and the self-contained inspector artifact;
- document an evidence baseline for the next phase.

Acceptance gate:

- TypeScript, generator tests, production viewer build, and artifact build pass;
- the same seed loads under WebGPU and `?renderer=webgl`;
- HUD identifies the actual backend without relying only on `navigator.gpu`;
- no unexplained source or generated-file changes remain.

### Phase 2 — Streamed terrain and world precision

Purpose: replace the single global inspection mesh with terrain suitable for a player.

Deliverables:

- camera-relative origin rebasing;
- quadtree or geometry-clipmap terrain tiles;
- crack-free LOD transitions and skirts/stitching;
- macro height plus deterministic local-detail synthesis;
- worker-backed tile building with cancellation and bounded queues;
- collision-height cache independent from render LOD;
- tile debug view, freeze controls, and streaming telemetry.

Acceptance gate:

- continuous traversal for 10 km with no visible world jitter or terrain cracks;
- no main-thread tile-generation stall above the selected quality budget;
- near-player ground spacing reaches 2–4 m while the far world remains visible.

### Phase 3 — Real traversal controller

Purpose: make ground-level review feel like a game.

Deliverables:

- pointer-lock mouse look with drag-look fallback;
- capsule controller, gravity, acceleration, friction, jumping, slope limits, and stepping;
- collision against the stable collision-height cache and static rock proxies;
- deterministic safe spawn selector with named teleport/debug bookmarks;
- first- and optional third-person review cameras;
- water entry, wading state, and temporary swim locomotion interface.

Acceptance gate:

- reliable spawn on dry traversable land;
- walk, run, jump, slope, and shoreline tests pass at 30/60/144 Hz;
- camera never falls through unloaded visual tiles.

### Phase 4 — Alvora ground-material vertical slice

Purpose: prove final-quality terrain appearance in one coastal corridor.

Deliverables:

- TSL terrain material using slope, height, biome, moisture, curvature, shore distance,
  roads, and authored masks;
- sand, wet sand, grass, soil, forest floor, rock, scree, snow, mud, and seabed layers;
- triplanar cliff projection, macro-color breakup, detail normals, roughness, and height
  blending;
- KTX2 texture pipeline with mipmaps and anisotropy limits;
- material debug modes for every blend input;
- lighting-neutral material calibration scene.

Acceptance gate:

- no obvious texture stretching or repetitive tiling during a 2 km walk;
- shore, slope, and biome transitions have no hard grid edges;
- material pass stays within the High/Balanced GPU budget.
- Alvora's material palette, coast-to-settlement transition, agriculture/trade geography,
  and permanent low-band economic value pass the Bible-fidelity checklist.

### Phase 5 — Water-body data contract and ocean foundation

Purpose: make water physically coherent enough for later swimming and boats.

Compiler outputs:

- stable water-body IDs and type (`ocean`, `lake`, `river`, `wetland`);
- surface elevation, bathymetry/depth, shoreline distance, flow direction/strength,
  navigability, wave climate, and connected-body relationships;
- shoreline, foam, and exclusion masks per streamed tile.

Renderer deliverables:

- camera-centered ocean clipmap;
- layered Gerstner/spectral-style waves with a CPU-evaluable matching height function;
- depth absorption, refraction, Fresnel reflection, wind normals, shoreline foam, and
  underwater transition;
- calmer lake material and flow-directed river material;
- quality-tiered reflection and caustic options;
- local disturbance interface for swimmers, rain, hulls, and wakes.

Acceptance gate:

- a test boat and rendered surface agree on wave height within a documented tolerance;
- shorelines remain stable across terrain LOD changes;
- ocean horizon has no visible mesh edge or precision shimmer.
- rivers, wetlands, lakes, coasts, ports, and fishing waters support the distinct regional
  economies and transportation roles defined by the Bible.

### Phase 6 — Environmental dressing system

Purpose: make the vertical slice feel inhabited without adding gameplay resources.

Deliverables:

- deterministic tile dressing records generated from biome, moisture, slope, elevation,
  exposure, shore distance, and disturbance masks;
- grass, ground cover, ferns, reeds, low bushes, scrub, pebbles, boulders, scree, fallen
  branches, litter, shells, and driftwood;
- road, settlement, water, steep-slope, future-tree, and future-resource exclusions;
- instanced near meshes, simplified mid-distance clusters, and far material integration;
- wind response in TSL with shared weather direction;
- GPU culling/indirect drawing spike after the instanced CPU baseline is measured.

Acceptance gate:

- deterministic placement hashes match between runs;
- no dressing blocks roads, settlement pads, waterways, or reserved gameplay-resource cells;
- density transitions do not form visible chunk boundaries.
- dressing profiles reinforce each zone's authored ecology and environmental-magic level
  instead of using one generic fantasy scatter library everywhere.

### Phase 7 — Lighting, atmosphere, and image quality

Deliverables:

- physical sun/sky and environment lighting;
- cascaded or near-camera terrain/prop shadows;
- aerial perspective, height fog, cloud-shadow interface, and weather color response;
- restrained TSL post-processing: tone mapping, AO or SSGI tier, bloom, color grade, and
  temporal anti-aliasing when stable;
- underwater fog, distortion, particulate, and caustic tiers.

Acceptance gate:

- readable terrain at noon, overcast, dawn, and night reference conditions;
- no effect is required for navigation-critical contrast;
- compatibility tier remains playable with advanced passes disabled.

### Phase 8 — Biome scale-out and content pipeline

Deliverables:

- propagate the proven system through all 16 zones;
- per-biome material/dressing profiles and validation captures;
- asset intake rules, licenses, poly/texture budgets, KTX2 conversion, LOD generation,
  collision proxies, and naming conventions;
- golden seed captures and automated regression tours;
- hand-authored override layers that survive regeneration.

Acceptance gate:

- every zone has a distinct but coherent material and dressing identity;
- a full-world flight and representative ground tour pass visual and performance gates;
- regeneration never erases authored overrides.

## 6. Immediate Phase 1 work order

1. Capture the current `r169` WebGL build status and repository state.
2. Upgrade Three.js and types; resolve migration changes without altering generated world data.
3. Introduce an asynchronous renderer bootstrap and `setAnimationLoop`.
4. Add query-selectable renderer and quality profiles.
5. Add backend/performance HUD telemetry with rolling median/p95-friendly samples.
6. Update the standalone artifact shell so it cannot drift from the development HUD.
7. Run generator tests, TypeScript builds, Vite production build, and artifact build.
8. Manually load default and forced-WebGL modes and record the baseline in this document.

## 7. Decisions deferred until measured

- quadtree versus concentric geometry clipmaps;
- CPU-worker versus GPU-compute foliage culling threshold;
- screen-space reflection versus probe/planar hybrid water reflections;
- SSGI versus lighter GTAO/ambient-lighting combination;
- texture-array layout and exact KTX2 ETC1S/UASTC split;
- whether WebGPU becomes mandatory for the highest quality tier.

These decisions must follow Phase 1 and Phase 2 measurements, not novelty alone.

## 8. Phase 1 implementation baseline — 2026-08-12

Status: implemented and verified on the portable development laptop with seed `48291`.

Foundation delivered:

- Three.js `r184` with `WebGPURenderer`, automatic WebGL 2 fallback, asynchronous renderer
  initialization, and `setAnimationLoop`;
- `renderer=webgl` compatibility override and `quality=high|balanced|compatibility` profiles;
- live backend, rolling median/p95 frame time, draw-call, triangle, geometry, and texture HUD;
- Three.js `Timer` integration with page-visibility handling;
- Vite `8.2.1` and esbuild `0.28.2`, with `npm audit` reporting zero known
  vulnerabilities at this checkpoint;
- standalone artifact generation sourced from the real development HTML shell, removing the
  previous duplicate/stale inspector markup.

Measured steady-state inspector baseline (Codex in-app Chromium, one renderer tab active):

| Mode | Result | Median | p95 | Scene |
| --- | ---: | ---: | ---: | --- |
| WebGPU, balanced | 60 fps | 16.7 ms | 16.8 ms | 46 draws / 2,115,607 triangles |
| forced WebGL 2, compatibility | 60 fps | 16.7 ms | 16.9 ms | 46 draws / 2,115,607 triangles |

Both modes loaded the same generated `0.4.0` world without browser warnings or errors. These
numbers are a development-machine baseline, not a shipping performance claim; later phase gates
must add representative low/mid/high hardware and traversal captures.

## 9. Phase 2 implementation baseline — 2026-08-12

Status: implemented and verified with seed `48291`.

Selected structure: a camera-centered adaptive quadtree. It preserves the full-world silhouette
with coarse distant leaves while concentrating geometry around the player, and is a better fit for
the current authored world bounds than an always-square geometry clipmap. Every tile uses
deterministic parent-aligned coordinates and a vertical skirt, so neighboring levels cannot expose
open cracks at T-junctions.

Foundation delivered:

- balanced/high/compatibility quadtree budgets with bounded 200/240/140-tile working sets;
- 4 m near-player vertex spacing in balanced, 2 m in high, and 8 m in compatibility;
- deterministic 32 m and 8 m local-relief synthesis shared by rendering and collision;
- one or two terrain workers (hardware-dependent), bounded generation queues, obsolete-generation
  rejection, and atomic visible-set swaps so a rebuild does not expose a temporarily empty world;
- camera-relative origin rebasing at an 8 km threshold on a 4 km quantum;
- independent, bounded 4 m collision-height patch cache;
- LOD-color debug mode, wireframe mode, streaming freeze, generation/origin counters, queue depth,
  tile counts, and main/worker timing telemetry;
- a deterministic `?streamTour=1` ten-kilometer traversal check.

Measured balanced WebGPU stream tour:

| Distance | Tile generations | Origin rebases | Frame result | Max main update | Max worker tile |
| ---: | ---: | ---: | --- | ---: | ---: |
| 10.0 km | 49 | 2 | 60 fps / 16.7 ms median / 16.9 ms p95 | 1.4 ms | 12.4 ms |

The tour completed with 199/199 desired tiles active, an empty queue, and no browser warnings or
errors. The forced-WebGL compatibility pass completed at 60 fps with 139/139 tiles and a 0.3 ms
maximum streaming update before the final telemetry-only revision. The worker maximum does not
block the render thread; the measured main-thread streaming work remains below the Phase 2 budget.

## 10. Combined Phase 3–4 playable milestone — 2026-08-12

Status: implemented and verified with seed `48291`.

Traversal delivered:

- first-person kinematic capsule with acceleration, friction, gravity, jumping, ground snapping,
  slope rejection, wading, and surface-seeking swim locomotion;
- 3.4 m/s walk, 6.8 m/s sprint, and 2.6 m/s temporary swim tuning;
- pointer-lock mouse look with drag-look fallback for local files and sandboxed embeds;
- collision driven only by the stable 4 m collision cache, never by visual tile availability;
- deterministic dry/low-slope safe-position search and named Alvora, Valedouro, Serravela,
  Cavora, and Solmara review bookmarks;
- HUD locomotion state and one-click bookmark teleport;
- static circular collision-proxy interface reserved for the later rock-dressing pass.

Alvora material slice delivered:

- `MeshStandardNodeMaterial`/TSL terrain shading shared by WebGPU and the WebGL fallback;
- deterministic tileable sand, wet sand, grass, soil, forest-floor, mud, rock, scree, snow, and
  seabed calibration layers;
- world-space triplanar projection, slope/height/shore/moisture masks, biome modulation, macro and
  fine breakup, detail normals, roughness response, and origin-stable coordinates;
- high/balanced/compatibility texture resolution, anisotropy, and normal-detail tiers;
- final, biome, height, slope, shore, moisture, and macro-breakup debug views;
- KTX2 intake script using ETC1S for albedo and UASTC for normal/data maps, with generated mipmaps
  and documented source/license rules.

Validation:

- movement and jump results pass at 30, 60, and 144 Hz;
- steep-slope rejection, swimming, safe-spawn, LOD, collision-cache, and deterministic-detail
  tests pass;
- live Alvora teleport reports grounded at a 1.7 m eye height and live jump returns to grounded;
- balanced WebGPU: 60 fps, 16.7 ms median, 16.9–17.0 ms p95, 199/199 tiles;
- compatibility WebGL 2: 60 fps, 16.7 ms median, 17.0 ms p95, 139/139 tiles;
- both renderer passes compile every material debug mode without warnings or errors.

Bible fidelity: the Alvora palette is deliberately temperate, agricultural, woodland, and coastal
rather than generic high-fantasy terrain. Sand/wet-sand/soil/grass/forest-floor continuity supports
the Crownlands coast-to-farm-to-settlement identity and preserves permanent low-band gathering,
fishing, farming, trade-route, and housing value without placing gameplay trees or resource nodes.
