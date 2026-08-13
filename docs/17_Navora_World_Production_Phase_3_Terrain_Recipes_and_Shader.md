# Navora World Production — Phase 3 Terrain Recipes and Shader

Status: complete on `codex/world-production-completion`

Canonical seed: `48291`; recipe contract: `navora-terrain-recipes-v1`

## Outcome

Phase 3 replaces the seven generic final-layer decisions with an engine-independent recipe system covering every canonical launch zone. The authoritative `data/design/terrain-recipes.json` contains **16 zone recipes** and uses **all 33 Phase 2 material families**. Every recipe declares:

- canonical zone and supported biomes;
- allowed material-family set;
- primary, secondary, tertiary, shore, steep, wet, and cold roles;
- secondary environmental driver and range;
- macro tertiary breakup and strength;
- shoreline, slope, wetness, and snow thresholds;
- macro tint limit;
- explicit forbidden material pairs.

The compiler validates this data against canonical zone order, biome IDs, the Phase 2 family library, numeric ranges, role membership, forbidden pairs, and complete family use. It exports `terrainMaterialRecipes.json`. Both HTTP and standalone viewers validate that recipe order against the compiler's categorical `zone-class` control contract before rendering.

## Recipe coverage

| Continent | Zone | Recipe identity | Dominant material logic |
|---|---|---|---|
| Valora | Alvora | fertile coastal basin | meadow / agricultural soil / deciduous loam; pale beach; grey rock |
| Valora | Valedouro | valley woodland | lush grass / deciduous loam / moss; river silt; grey rock |
| Valora | Serravela | foothill mountain | highland grass / pine floor / roots; dark Serravela stone |
| Valora | Cavora | storm coast cliffs | sparse coastal grass / dry soil / pine; storm sand; cliff rock |
| Valora | Azurama | deep mineral forest | moss / forest loam / roots; ore-host rock; peat |
| Valora | Montemoura | Elderwall highland | highland grass / roots / leaf litter; mountain rock; frost |
| Valora | Corvento | Tempest alpine | frost rock / snow / slush; alpine scree |
| Valora | Lumevara | Verdelume basin | ancient luminous / moss / lush grass; ore-host rock |
| Seradia | Fonteira | Firstwater floodplain | agricultural soil / lush grass / leaf litter; silt / mud |
| Seradia | Riveira | Reedwater marsh | marsh grass / peat / moss; river sediment / stone |
| Seradia | Vermara | Redwater steppe | dry steppe / red earth / path; red escarpment |
| Seradia | Solmara | Sunreach delta | marsh / agricultural soil / lush grass; silt / peat |
| Seradia | Vidrala | Glassmere lakes | meadow / moss / pebble shore; riverbed stone |
| Seradia | Altavera | Skyplain | highland / dry steppe / path; alpine scree / snow |
| Seradia | Fendoura | shattered canyon | dry steppe / red earth / gravel; red escarpment |
| Seradia | Lumeira | luminous hollow | ancient luminous / moss / leaf litter; ore-host rock |

## Shader architecture

The WebGPU terrain material now:

1. Loads texture channels strictly from the Phase 2 residency profile.
2. Samples the seven shared physical albedos in world space.
3. Uses rotated/warped planar sampling on horizontal materials and triplanar rock/scree sampling on steep surfaces.
4. Resolves the exact canonical zone from a nearest-filtered world-space `zone-class` texture.
5. Selects the authored recipe and blends family roles from compiler moisture, wetness, vegetation, exposure, shoreline, drainage, slope, erosion/scree, temperature, and elevation.
6. Uses procedural macro fields only for breakup and bounded tint, never as environmental truth.
7. Applies scanned normal/roughness response at High where resident and scalar family response elsewhere.
8. Removes the legacy RGB biome-paint vertex buffer and final biome-color tint. Biome debug color now derives from the categorical compiler field.

Continuous controls remain streamed vertex attributes. Zone class is deliberately not interpolated as a vertex value: at coarse LOD that created false intermediate recipe bands. Nearest per-fragment lookup preserves exact zone identity at every terrain LOD.

## WebGPU binding budget correction

Runtime validation caught two adapter limits that ordinary build/tests could not expose:

- Binding all 21 PBR maps exceeded the practical pipeline texture/sampler budget.
- Adding six control packs on top of position, normal, UV, and legacy biome RGB exceeded the adapter's eight-vertex-buffer limit.

The final High profile binds **13 KTX2 maps**: seven albedos, five normals, and rock roughness. One additional nearest-filtered zone-control texture leaves the terrain pipeline under the limit. Forest/scree reuse compatible soil/rock normal structure; all other roughness comes from authored family scalars. All 21 complete KTX2 maps remain on disk for a later channel-packing or virtual-texture system.

Removing the redundant RGB biome buffer fixes the vertex-buffer limit and reduces worker sampling, transfer, and GPU input bandwidth. The compiler's ecology pack already contains biome class.

## Debug and review tooling

The HUD now offers **22 exercised debug modes**, including the required final, material ID, moisture, geology, slope, shoreline, recipe, biome, and LOD/mip stress views. Exact zone recipe debug remains stable at world overview LOD; material ID debug shows the selected semantic family after role blending.

A deterministic **Alvora Starter Beach** bookmark finds low, flat, compiler-authored Alvora shoreline and faces the lowest neighboring water cell. It prevents review drift to an inland generic bookmark when checking the starter coast.

Visual artifacts are under `docs/artifacts/phase3-terrain-recipes/`:

- `alvora-starter-beach.png` — required starter sand/grass/soil/stone viewpoint;
- `alvora-high-final.png` — inland basin and starter-resource material review;
- `valedouro-high-final.png` — valley woodland;
- `serravela-high-final.png` — foothill/mountain;
- `cavora-high-final.png` — storm coast;
- `solmara-high-final.png` — floodplain/delta;
- `recipe-debug-world.png` — exact canonical recipe regions at world LOD;
- `alvora-material-id.png` and `alvora-lod-mip.png` — semantic material and distance stress diagnostics.

Phase 3 changes the terrain vocabulary and rendering logic only. Sparse/generic vegetation and hydrology/geography defects visible in these captures remain assigned to Phases 4–7; they are not disguised as terrain-shader completion.

## Verification

- Generator tests: **13/13 passed**.
- Viewer tests: **26/26 passed**.
- Generator TypeScript build: passed.
- Viewer production build: passed; `1,060.56 kB` minified / `307.12 kB` gzip main bundle, with the existing chunk-size advisory.
- Canonical 1024 generation: passed in **22.584 s**; 16 zones, 543 resources, 16 spawn regions, 38 settlements, 36 roads.
- Standalone artifact: passed at **203.94 MiB**.
- High WebGPU final exported profile: clean console; observed snapshot `105 fps`, `9.5 ms` median, `17.7 ms` p95, adaptive `0.95×` pixel ratio.
- Balanced WebGPU: clean console; observed snapshot `115 fps`, `8.7 ms` median, `17.2 ms` p95, `1.00×` pixel ratio.
- Compatibility WebGPU: clean console; observed snapshot `119 fps`, `8.4 ms` median, `9.1 ms` p95, `0.90×` pixel ratio.
- All 22 material/debug modes exercised in High without console errors or warnings.

Runtime figures are single review-host snapshots, not sustained Phase 13 benchmarks.

## Acceptance result

- **Terrain works at WebGPU quality levels:** pass; High, Balanced, and Compatibility compile and render cleanly.
- **Compatibility remains usable:** pass.
- **Debug modes prove compiler fields and recipe selection:** pass.
- **No hard biome-color smear in final look:** pass; legacy biome RGB input/tint removed.
- **Alvora starter beach reads through actual scanned sand/grass/soil/stone recipes:** pass; dedicated canonical shoreline bookmark and artifact added.
- **Anti-repetition architecture remains active:** pass; rotated/warped planar sampling, triplanar cliff sampling, and distance-aware macro/micro detail are preserved.
