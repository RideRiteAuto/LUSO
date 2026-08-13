# Navora World Production — Phase 2 Terrain Material Library

Status: complete on `codex/world-production-completion`

Canonical seed: `48291`; library contract: `navora-terrain-materials-v1`

## Outcome

Phase 2 replaces the seven-layer proof-of-concept contract with a validated production vocabulary of **33 semantic terrain families** backed by **seven reviewed CC0 physical scan sets**. This is deliberate reuse, not texture spam: biome and zone identity comes from authored scale, tint, physical response, blend width, compiler-field drivers, and later Phase 3 recipe composition. The seven sources now all have complete albedo, OpenGL normal, and roughness channels as mipmapped KTX2 assets.

The authoritative design is `data/design/terrain-materials.json`. The compiler validates and exports it as `output/<seed>/terrainMaterials.json`; both HTTP and standalone viewer paths load and validate that same versioned contract. The terrain loader no longer owns hard-coded normal/roughness layer lists. It follows the selected manifest residency profile.

## Vocabulary

| Category | Count | Families |
|---|---:|---|
| Grass | 6 | temperate meadow, lush valley, highland, dry steppe, marsh, sparse coastal |
| Forest floor | 5 | deciduous loam, pine needle, mossy soil, leaf litter, rooty woodland |
| Soil | 6 | agricultural, riverbank mud, dry brown, red earth, peat, worn path |
| Shore | 5 | pale sand, storm sand, silt, gravel bar, pebble shore |
| Rock | 7 | grey mountain, Serravela, coastal cliff, Vermara escarpment, riverbed, alpine scree, ore host |
| Snow | 3 | clean snow, dirty slush, exposed frost rock |
| Special | 1 | ancient luminous ground, constrained by weather/geology controls |

Each family declares a shared physical set, normalized tint, meters per repeat, normal strength, roughness bias, height-like blend width, environmental control drivers, and tags. Phase 3 will compose these entries into zone/biome recipes; Phase 2 establishes and proves the complete material vocabulary and asset contract.

## Physical sources and provenance

| Texture set | Upstream asset | Provider | License |
|---|---|---|---|
| grass | `Grass001` | ambientCG | CC0 |
| soil | `brown_mud` | Poly Haven | CC0 |
| forest | `forrest_ground_01` | Poly Haven | CC0 |
| sand | `aerial_beach_01` | Poly Haven | CC0 |
| rock | `aerial_rocks_02` | Poly Haven | CC0 |
| scree | `rocky_terrain_02` | Poly Haven | CC0 |
| snow | `snow_02` | Poly Haven | CC0 |

Source URLs, original file names, byte counts, MD5 values where supplied upstream, and local SHA-256 hashes are retained in `packages/viewer-threejs/assets/terrain/source/PROVENANCE.json`. Generator tests reconcile the design manifest against this provenance record and require all 21 shipping KTX2 files.

## Residency and memory budget

Measured disk sizes use the committed 2048×2048 mipmapped KTX2 library:

| Profile / asset group | Resident maps | Measured disk/network | Estimated GPU residency* |
|---|---:|---:|---:|
| Compatibility | 7 albedo | 5.95 MiB | 19–37 MiB |
| Balanced | 7 albedo | 5.95 MiB | 19–37 MiB |
| High | 7 albedo + 5 normal + 1 roughness | 31.43 MiB | 48–72 MiB |
| Complete KTX2 disk library | 7 albedo + 7 normal + 7 roughness | 45.36 MiB | not all bound simultaneously |
| Reviewed JPEG source library | 21 source maps | 59.65 MiB | not runtime-resident in browser build |
| Canonical standalone HTML | all source maps + world data + viewer | 226.88 MiB | decoded on demand by selected profile |

\*GPU figures are conservative estimates for full 2K mip chains after Basis transcoding. The exact value depends on the device-selected BC/ETC/ASTC target and browser implementation; it is not presented as observed telemetry. Peak CPU memory also includes compressed downloads and temporary transcoder buffers. Budget **120–180 MiB transient CPU memory** for High material initialization and **30–70 MiB** for Compatibility/Balanced. Phase 13 must add observed RAM/VRAM telemetry before distribution lock.

Compatibility and Balanced intentionally resident albedo only. High binds 13 KTX2 maps, leaving room for recipe-control and engine bindings under the practical WebGPU per-stage texture/sampler ceiling: all seven albedos; sand/grass/soil/rock/snow normals; and rock roughness. Forest and scree reuse compatible soil/rock normal structure, while other families use their authored scalar roughness response. All 21 complete maps remain on disk for future channel packing or virtual-texture work. All tiers are manifest-driven; changing a recipe/profile does not require editing the loader. `maxResolution` and anisotropy are explicit profile fields.

## Browser and desktop distribution paths

- Browser/Vite: manifest paths such as `terrain-ktx2/grass_albedo.ktx2` resolve under `document.baseURI`; the Basis transcoder is shipped under `basis/`.
- Portable single-file artifact: `file://` cannot launch the KTX2 worker reliably in sandboxed review environments, so the build embeds the same reviewed JPEG sources as data URIs. Residency selection still follows `terrainMaterials.json`.
- Future desktop: the importer/cooker resolves the same relative manifest path beneath its packaged terrain content root, then either consumes KTX2 directly or transcodes/cooks it to the platform-native GPU format. Semantic family IDs and recipes remain engine-independent.

## Anti-tiling behavior

Walking-height grass/soil/sand use world-space sampling with a rotated alternate projection at High, plus compiler-driven masks and macro breakup. Rock and scree use triplanar projection; High mixes macro and detail frequencies. Balanced/Compatibility retain scan scale and macro breakup with fewer texture/noise samples. Procedural noise changes presentation only; it does not invent moisture, geology, slope, shoreline, or material eligibility.

## Visual artifact

`docs/artifacts/phase2-material-library/terrain-material-library.png` is a deterministic 33-family review sheet rendered from the generated material contract and the reviewed source scans. Runtime verification also loaded the canonical seed in clean WebGPU Compatibility and High sessions with no warnings or errors.

## Verification

- Generator tests: **12/12 passed**, including family bounds/uniqueness, parameter ranges, provenance reconciliation, complete KTX2 channels, profile residency, and exported contract.
- Viewer tests: **23/23 passed**, including manifest acceptance and incomplete-residency rejection.
- Generator TypeScript build: passed.
- Viewer production build: passed; `1,059.53 kB` minified / `306.88 kB` gzip main bundle, with the existing chunk-size advisory.
- Canonical production generation: passed at resolution 1024 in **18.924 s**; 16 zones, 543 resources, 16 spawn regions, 38 settlements, 36 roads.
- Standalone artifact build: passed at **226.88 MiB**.
- Visual review page: 33 cards, seven sources, 21 complete PBR maps / 13 High-resident maps, clean console.
- WebGPU Compatibility runtime: clean console; observed snapshot `172 fps`, `5.8 ms` median, `20.6 ms` p95, adaptive `0.85×` pixel ratio.
- WebGPU High runtime: clean console; observed snapshot `66 fps`, `15.1 ms` median, `18.9 ms` p95, adaptive `0.80×` pixel ratio.

Runtime frame figures are one review-host snapshot, not a formal benchmark. Phase 13 owns sustained benchmark gates.

## Acceptance result

- **Materials load by recipe/profile:** pass; residency comes from the exported library contract.
- **Provenance/licensing documented:** pass; all seven sources are CC0 with checksummed local records.
- **Browser and future desktop paths considered:** pass.
- **Material memory budget documented:** pass, with estimates clearly separated from observed sizes.
- **No obvious tiling strategy gap:** pass for the current shader path; rotated/warped planar, multi-scale macro/detail, and triplanar cliff sampling remain active. Phase 3 will prove the full regional recipe blends at Review A viewpoints.
