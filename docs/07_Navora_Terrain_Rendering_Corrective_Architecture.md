# Navora Terrain Rendering Corrective Architecture

Status: root-cause audit complete; implementation work order approved by the August 12, 2026 visual review.

This document supersedes the screenshot-driven material tuning in Phases 2–4 of
`06_Navora_Living_World_Rendering_Action_Plan.md`. The Worldbuilding Bible v11 remains the
creative source of truth. This correction changes the rendering architecture, not Navora's
geography, zone identities, economy, resources, or ecology.

## 1. Executive decision

The current result cannot be brought to production quality by recoloring the grass or adding
more procedural noise. Four independent systems are being mistaken for one texture problem:

1. terrain LOD edges are not crack-free;
2. source elevation is too coarse for close and middle-distance silhouettes;
3. material classification is reconstructed from rendered vertex color and per-LOD normals;
4. the world has no continuous ocean surface, atmosphere, or coherent horizon.

The corrective direction is therefore:

- replace internal tile skirts with a crack-free terrain topology and morphing LOD;
- stream a quantized, mipmapped height pyramid instead of treating a 64 m macro grid as final
  walking terrain;
- compile semantic surface-control maps from Navora's real climate, geology, hydrology, and
  zone data;
- render a bounded number of height-blended PBR layers with near/mid/far frequency bands;
- add a depth-correct ocean surface and matching atmosphere before judging the coastline;
- enforce frame-time and visual-regression gates at representative ground bookmarks.

## 2. What the screenshots actually show

### 2.1 Bright white, yellow, orange, and purple lines

These are inspector overlays, not terrain shading. Zone boundaries were enabled by default and
are built as long line segments draped over a coarse per-continent field. At grazing angles a
segment can cut across terrain or sky. Road and Bruma markers have the same review-mode risk.

Correction: all cartographic/debug overlays start hidden. Rivers and lakes remain visible because
they currently stand in for world water features, but they will later share the water renderer.

### 2.2 Thin black lines and exposed strips

Each current quadtree leaf is generated independently. Its four edges are duplicated and dropped
vertically by `max(24 m, 2.5% of tile size)` to form skirts. The shared terrain material is
double-sided, so those skirts become visible walls at low angles. Neighboring tiles may also use
different segment densities, and there is no edge index stitching or geomorphing. Normals are
recalculated at a step tied to each tile's own resolution, so lighting changes across the same
world-space edge.

Correction: eliminate internal skirts. Adjacent active terrain patches must be 2:1 balanced,
share exact boundary samples, stitch the fine edge to the coarse edge, and morph between parent
and child heights over a stable screen-space transition band. Normals must come from a
world-space derivative field whose sampling scale is independent of render LOD.

### 2.3 Square mountains and repeating ground

Seed 48291's authoritative world field is 3584 x 1536 across approximately 229 km x 98 km. Its
base spacing is roughly 64 m per sample. Runtime noise adds local relief, but it cannot reconstruct
missing ridge topology, erosion channels, cliff structure, or middle-distance silhouettes. The
eye sees the macro grid through the smoothing and sees regularly repeating micro texture on top.

Correction: preserve this field as L0 macro geography, then compile a deterministic tiled height
pyramid. Regional authoring/simulation supplies 16 m and 8 m structure; selected playable tiles
supply 2–4 m surface geometry. Files are quantized R16 height tiles with per-tile min/max and
mip/parent consistency, not one enormous float texture.

### 2.4 Grass climbing cliffs and block-shaped rock

The material currently estimates moisture from the green channel of an RGB biome display color.
It estimates slope as `1 - abs(normal.y)` and begins strong rock near a value of 0.34—approximately
a 49 degree face. Most real mountain slopes therefore remain grass-colored. Worse, the normal is
interpolated from the current LOD mesh, so material classification changes and becomes coarser as
terrain LOD changes. A large aerial-rock texture then makes each selected patch especially obvious.

Correction: the generator emits explicit semantic fields. Material weights never come from a
display color and never depend on the current render mesh's triangle density.

### 2.5 The ocean and horizon

There is no continuous sea surface. Below-zero bathymetric terrain receives a dark seabed color,
so underwater tile skirts and LOD seams remain visible. The scene background is a flat dark color,
with no atmospheric scattering or aerial-perspective match between sky, fog, and water.

Correction: render a continuous sea surface at the canonical water level. Opaque/depth-correct
water hides bathymetric seams, while depth and shore fields control absorption, foam, and shallow
color. A physical sky, sun, and aerial perspective share one horizon model with the water.

## 3. Production terrain contract

### 3.1 Geometry tiles

Each streamed height tile contains:

- `tileId`, integer level/x/z, world bounds, data version, and content hash;
- R16 height samples with a one-sample shared border;
- per-tile minimum and maximum elevation;
- guaranteed parent-consistent samples at every second child vertex;
- optional residual/detail block, always deterministic from seed and tile version;
- collision samples generated from exactly the same height contract.

The first correction may retain the adaptive quadtree, provided it implements 2:1 neighbor
balancing, stitched edge index variants, and height geomorphing. If that cannot hold the visual and
frame-time gates, it is replaced by concentric geometry clipmaps. The acceptance test—not sunk
implementation cost—decides.

### 3.2 Semantic surface-control tiles

The world compiler emits two RGBA control maps plus auxiliary fields per tile:

| Channel | Meaning |
| --- | --- |
| control0.r | grass / organic cover |
| control0.g | soil / dirt |
| control0.b | exposed rock |
| control0.a | sand / beach |
| control1.r | scree / loose stone |
| control1.g | mud / wet ground |
| control1.b | snow / frost |
| control1.a | authored override / reserved |

Auxiliary values include actual moisture, temperature, shore distance, river/lake distance, flow
accumulation, slope in degrees, curvature/convexity, geology, exposure, disturbance, road distance,
and settlement exclusion. Weights are normalized after authored overrides. The biome ID remains a
semantic category; its palette color is never shader input.

For Navora, zone profiles bias these physical fields without erasing them. Alvora's Crownlands can
favor lush managed grass, loam, coast sand, and worn agricultural soil; Serravela can favor exposed
rock, scree, alpine grass, and snow. That preserves Bible-defined regional identity without painting
one material over an entire zone.

### 3.3 Frequency-separated material

The shader uses three distance bands:

- **macro (100–1000 m):** unique baked regional albedo/roughness and control-map variation;
- **meso (8–80 m):** material variants, erosion streaks, soil/rock transitions, and terrain form;
- **micro (0.15–4 m):** scanned albedo, normal, height, and roughness, faded out before aliasing.

Each screen region evaluates at most four active surface materials. Transitions use height-aware
blending instead of a linear color mix. Cliffs use world-space triplanar projection and dedicated
close-scale cliff PBR sets; steep convex outcrops may later receive deterministic rock meshes,
because a heightfield cannot create overhangs.

Tiling is broken with a small texture array of calibrated variants per surface, hashed cell
rotation/reflection, low-frequency control-map modulation, and stochastic boundary blending.
Sampling cost is distance-tiered: far terrain uses the baked macro result, not every micro layer.
Detail normal amplitude fades with projected texel size to prevent the gritty/moire appearance in
the distance.

### 3.4 Water and atmosphere

Ocean, lake, and river rendering share the canonical water-body IDs already planned in the data
architecture. The ocean begins as a camera-centered or horizon-extending surface at y=0 with:

- Fresnel reflection and roughness driven by wind;
- multi-scale normal waves and low-frequency displacement;
- depth absorption and shallow-water color from bathymetry;
- shore-distance foam and wet-sand coupling;
- a CPU-evaluable surface height hook for later swimmers and boats;
- quality-tiered reflection and refraction.

Water, fog, physical sky, and sun must be calibrated together. A coastline capture does not pass
while the water/sky horizon remains a flat color discontinuity.

## 4. Corrective implementation sequence

### Stage A — evidence and immediate review hygiene

- Default cartographic overlays off and label them as debug layers.
- Keep 3.4 m/s human walk; make Shift a 32 m/s inspector sprint.
- Add fixed golden-camera bookmarks matching the four reported views.
- Add views for surface weights, normal discontinuity, stitched edges, height mip, and water depth.
- Record frame median/p95, GPU timing where supported, texture samples, tiles, and memory.

Exit gate: clean review captures contain no accidental overlay geometry; 5-second sprint is
frame-rate stable; every later fix is comparable at the same camera and seed.

### Stage B — crack-free geometry

- Add 2:1 quadtree balancing.
- Generate stitched edge index variants for all neighbor combinations.
- Share boundary heights and fixed-world-scale derivative normals.
- Add parent/child geomorphing; remove all internal vertical skirts.
- Keep an outer world-boundary closure only where it is guaranteed beyond the visible horizon.

Exit gate: no open crack, dark wall, or normal seam during a continuous 10 km tour, including
grazing-angle views and LOD transitions. This is tested with flat diagnostic shading before PBR.

### Stage C — terrain data compiler

- Export the tiled, parent-consistent R16 height pyramid.
- Export the two surface-control maps and auxiliary physical fields.
- Derive slope/curvature/flow from canonical height data, not display geometry.
- Add versioned schemas, deterministic hashes, and golden-seed tests.

Exit gate: regenerated seed 48291 has byte-stable tile hashes; adjacent borders are identical;
weights sum to one within quantization tolerance; no field shows continent-tile seams.

### Stage D — bounded layered terrain material

- Replace biome-color moisture inference with compiled fields.
- Implement max-four height-blended layers, texture-array variants, and distance tiers.
- Calibrate grass/soil/sand/rock/scree/mud/snow and cliff profiles at neutral lighting.
- Fade micro normals and high-frequency albedo before they alias.
- Add explicit zone-level palette profiles checked against Bible v11.

Exit gate: no recognizable tile repetition in a 2 km walk; cliff selection is stable through LOD;
mountains do not inherit lowland grass; balanced terrain shading fits a 6 ms GPU budget at 1080p.

### Stage E — ocean, inland water, and atmosphere

- Add the continuous sea surface and depth-correct shoreline.
- Move lakes/rivers to the shared water material contract.
- Add physical sky, aerial perspective, and horizon-matched fog.
- Add wave-height query and navigability hooks before boats.

Exit gate: no visible ocean mesh edge or bathymetric seam; water/sky horizon is continuous;
shoreline remains stable while terrain LOD changes; surface and gameplay wave queries agree.

### Stage F — performance hardening

- Profile on the portable laptop in WebGPU and forced WebGL 2 modes.
- Cache/bake macro terrain shading and consider virtual texturing only after measurement.
- Bound shader permutations, active layers, anisotropy, tile uploads, and worker queues by tier.
- Run golden tours across Alvora coast/Crownlands, Valedouro, Serravela, Cavora, and Solmara.

Exit gate: Balanced holds 60 fps target with <=16.7 ms p95 in the representative tour; no
single terrain/water feature can silently exceed its declared budget.

## 5. Research basis

This architecture follows established production solutions rather than inventing more local noise:

- Epic's Landscape materials use weight-blended layers, height blending, macro distance textures,
  and LOD-aware terrain systems: <https://dev.epicgames.com/documentation/en-us/unreal-engine/landscape-materials-in-unreal-engine>
- GPU Gems geometry clipmaps center nested regular grids on the viewer and update elevation regions
  incrementally: <https://developer.nvidia.com/gpugems/gpugems2/part-i-geometric-complexity/chapter-2-terrain-rendering-using-gpu-based-geometry>
- Far Cry 5's terrain pipeline performs GPU LOD/culling/stitching and integrates procedural cliff
  generation rather than asking a tiled ground texture to create cliffs:
  <https://www.gdcvault.com/play/1025261/Terrain-Rendering-in-Far-Cry>
- Ghost Recon Wildlands describes a large material library with only a small number of simultaneous
  terrain materials in a region: <https://www.gdcvault.com/play/1024029/-Ghost-Recon-Wildlands-Terrain>
- Frostbite's procedural terrain framework uses interdependent data layers for surface selection,
  topology, seamless objects, and scatter: <https://www.gdcvault.com/play/1029086/From-Battlegrounds-to-Fairways-Terrain>
- Three.js provides a WebGPU `WaterMesh`, TSL/node materials, and water examples that validate the
  renderer direction, though Navora still needs its own scalable ocean/body data contract:
  <https://threejs.org/docs/pages/WaterMesh.html>

## 6. Explicitly rejected fixes

- increasing grass saturation without changing surface classification;
- adding more high-frequency noise to hide the 64 m height grid;
- making skirts darker or deeper instead of removing internal skirts;
- hiding cracks with fog before geometry correctness passes;
- sampling all terrain layers at all distances;
- using biome display RGB as moisture, geology, or material weight;
- treating an ocean-colored seabed as a water renderer;
- judging final PBR while debug lines and markers are enabled.

Those approaches may change a screenshot, but they do not solve the world renderer.
