# Navora World Production Completion — Phase 0 Baseline

Date: 2026-08-12 (America/Los_Angeles)  
Target branch: `codex/world-production-completion`  
Baseline commit: `b4fe4f7` (`origin/codex/terrain-visual-quality`)  
Golden seed: `48291`

## Gate status

Phase 0 is complete. The repository was clean before the baseline work, the
completion branch was created directly from the latest remote
`codex/terrain-visual-quality` head, both test suites and both production
builds pass, the golden world and standalone inspector reproduce, and the
visual baseline is stored under `docs/artifacts/phase0-baseline/`.

Phase 1 must treat the compiler as authoritative. This baseline confirms that
the renderer still invents moisture and several other environmental decisions,
so later visual work must not extend that prototype behavior.

## Branch and ancestry audit

- The workspace root is not a Git repository; `LUSO-review/` is the actual
  `RideRiteAuto/LUSO` clone.
- The clone had a narrow fetch refspec and initially exposed only the old
  Claude branch. The exact remote terrain branch was fetched explicitly.
- `codex/world-production-completion` now points at `b4fe4f7`.
- `agent/nevora-world-overhaul` is not an ancestor of the terrain branch. It
  contains useful but divergent compiler work (macro geography, housing,
  bathymetry, scale reports, and additional invariants). Phase 1–4 should port
  reviewed ideas deliberately instead of merging that branch wholesale.

## Reproduction commands

The repository contract uses npm and its committed `package-lock.json`:

```powershell
npm install
npm test
npm run build
npm run generate -- --seed 48291
npm run build:artifact -w @nevora/viewer-threejs -- --seed 48291
npm run viewer
```

Open the baseline viewer at:

```text
http://127.0.0.1:5183/?seed=48291&quality=compatibility
http://127.0.0.1:5183/?seed=48291&quality=compatibility&streamTour=1
```

The Codex desktop runtime did not expose an `npm` executable, so the same
package-local commands were invoked directly with the bundled Node runtime:

```powershell
packages/generator/node_modules/.bin/tsx.cmd --test "src/**/*.test.ts"
packages/viewer-threejs/node_modules/.bin/tsx.cmd --test "src/**/*.test.ts"
packages/generator/node_modules/.bin/tsc.cmd -p tsconfig.json
packages/viewer-threejs/node_modules/.bin/vite.cmd build
packages/generator/node_modules/.bin/tsx.cmd src/cli.ts --seed 48291
node packages/viewer-threejs/scripts/build-artifact.mjs --seed 48291
```

## Validation results

| Check | Result | Measured time / notes |
|---|---:|---|
| Generator tests | 7/7 pass | 3.408 s wall time; 3.044 s test runner time |
| Viewer tests | 20/20 pass | 1.499 s wall time; 1.292 s test runner time |
| Generator TypeScript build | Pass | 3.343 s |
| Viewer Vite production build | Pass | 0.864 s; 35 modules |
| Golden-seed generation | Pass | 16.110 s wall time; generator reports 15.398 s |
| Standalone artifact | Pass | 0.810 s after documented CC0 source intake |
| Browser runtime errors | None | No console warnings/errors in the stationary or tour tabs |

The first standalone-artifact attempt correctly failed because the gitignored
2K terrain source JPGs were absent. Running the documented CC0 Poly
Haven/ambientCG intake reproduced all files and their committed checksums; the
artifact then passed. The source JPGs remain ignored.

### Dependency baseline defect

`pnpm-lock.yaml` is stale relative to
`packages/viewer-threejs/package.json`. A frozen pnpm install reports the added
`basis_universal`, `fflate`, and `tsx` dependencies plus version mismatches for
Three.js, Vite, esbuild, and `@types/three`. `package-lock.json` contains the new
dependency versions. Shipping/CI must choose and enforce one package-manager
lock contract; Phase 0 does not silently rewrite the stale lock.

## Generated and distribution size baseline

| Payload | Files | Size |
|---|---:|---:|
| Current golden-world files | 17 | 31.97 MiB |
| Viewer public assets | 87 | 85.11 MiB |
| Environment GLBs | 5 | 28.12 MiB |
| Terrain KTX2 + Basis assets | 17 | 33.44 MiB |
| Resource assets/textures | 65 | 23.55 MiB |
| Production `dist/` | 89 | 86.12 MiB |
| Standalone inspector HTML | 1 | 144.64 MiB |

The main JS chunk is 1,054.26 kB minified / 305.13 kB gzip. Vite warns that it
exceeds the 500 kB chunk guideline. No service worker, versioned regional asset
manifest, persistent browser cache strategy, or desktop/local asset-path
abstraction exists yet.

The full `output/48291` directory measured 78 files / 64.97 MiB because the
generator does not clean three stale scale-bakeoff subdirectories left by the
previous branch. The active manifest and viewer use the 17 root files only.
Reproducible generation needs an explicit stale-output policy before CI treats
the directory size as a transfer budget.

## Runtime baseline

Host used for this capture:

- Windows 11 Pro 64-bit, build `10.0.26200`;
- AMD Ryzen 7 5700X, 8 cores / 16 logical processors;
- 31.93 GiB system RAM;
- NVIDIA GeForce RTX 4070 Ti, 12,282 MiB VRAM, driver 581.57;
- in-app Chromium/WebGPU compatibility renderer at a 0.90 pixel ratio.

These figures are an engineering baseline, not a shipping claim. The browser
surface is unthrottled and the GPU is well above the compatibility target.

| View | Median / 1% low | Scene | Streaming / dressing |
|---|---|---|---|
| Alvora overview | 175 / 172 FPS | 78 draws, 69,593 tris, 15 textures | 124 tiles; 2,885 items |
| Alvora ground | 175 / 172 FPS | 55 draws, 4,570,333 tris, 18 textures | 70 tiles; 2,939 items |
| Valedouro ground | 175 / 172 FPS | 49 draws, 242,309 tris, 23 textures | 68 tiles; 3,582 items |
| Serravela ground | 175 / 172 FPS | 77 draws, 242,437 tris, 23 textures | 74 tiles; 1,650 items |
| Cavora ground | 175 / 172 FPS | 53 draws, 205,287 tris, 23 textures | 67 tiles; 2,159 items |
| Solmara ground | 175 / 87 FPS | 44 draws, **51,520,045 tris**, 23 textures | 74 tiles; 4,089 items |
| Resource yard | 175 / 172 FPS | 95 draws, 370,735 tris, 27 textures | 62 tiles; dressing hidden |
| Solmara overhead | 175 / 172 FPS | 219 draws, **14,091,165 tris**, 29 textures | 139 tiles; 3,441 items |
| 10 km stream tour final | 175 / 87 FPS | 77 draws, 82,905 tris, 15 textures | 139 tiles; **0 items in 32 cells** |

The automatic 10 km tour completed. Maximum observed terrain work was 5.4 ms
selection, 0.7 ms commit, and 3.8 ms worker time. The final dressing count of
zero is a correctness failure even though the streaming timers are low.

A cached reload reached the generated-world status in 2.229 seconds. Cold
network load was not measured because the local browser API does not expose a
cache-reset/network trace. Client JS heap and live VRAM consumption are also
not exposed by the viewer. The dev server process itself reached 556.7 MiB peak
working set and 632.2 MiB private memory after dependency optimization; this is
not a client-memory measurement. Phase 11–12 needs first-class client RAM/VRAM
telemetry rather than proxies.

## Subsystem audit

### Compiler truth

Current compiler outputs are height, biome ID, zones, resources, spawns,
settlements, roads, waterways, sea regions, and the unified world heightfield.
Temperature and moisture are computed internally, but only zone averages
survive export. Slope, rainfall, wetness, drainage/accumulation, water distance,
shore influence, soil, geology, exposure, scree/erosion, buildability,
vegetation eligibility, and resource eligibility fields do not exist in the
shipping contract or viewer.

### Terrain materials and shader

Seven terrain layers exist: sand, grass, soil, forest, rock, scree, and snow.
They use licensed KTX2 albedo plus a subset of normal/roughness maps. There is
no 25–35-family library and no biome/zone recipe system. Most selection remains
height/slope plus shader noise. In particular, `terrainMaterial.ts` explicitly
creates a procedural `climateMoisture` field in the renderer. Debug modes show
that renderer result, not compiler truth.

### Geography, hydrology, housing, and bathymetry

The unified world field and basic D8 rivers exist. Closed pits are intentionally
not emitted as fake lakes, but real basin fill/spill/outlet logic does not
exist. River profiles contain width/depth/current/navigability metadata, while
river surfaces are laid over terrain rather than backed by compiler-authored
channel/bank fields. Housing/buildability, geology-aware coasts, flood risk,
and authored bathymetry fields are absent on this branch.

### Resources and ecology

Canonical data currently covers five mining resources and four tree resources.
The six visual review families are pine, birch, copper, tin, stone, and a
provisional redberry. Redberry is not in canonical resource data, and the
review models are not placed from `resources.json` in the world. World dressing
is explicitly non-interactive. The visible-world/gameplay-resource contract is
therefore not yet met.

### Vegetation and clutter

Instanced deterministic dressing supports grass, flowers, bushes, reeds, rocks,
and debris. Only Alvora, Valedouro, Serravela, Cavora, and Solmara have explicit
profiles; the other eleven zones use one default profile. No production tree
canopy is placed in the world. Five large environment GLBs are resident, and
some hot-swap into shared batches, which contributes to the Solmara triangle
spike.

### Streaming, LOD, and identity

Terrain quadtree selection, worker generation, staged terrain commits, origin
rebasing, and deterministic dressing cells are useful foundations. Tests prove
determinism and bounded queues. Dressing records do not expose a stable object
ID or gameplay identity, all mass-scatter batches use one `distant` tier, and
there is no crossfade/hysteresis/object-ID overlay/pop metric. The 10 km tour
proves that stable cell count does not guarantee visible object persistence.

### Wind, water, and atmosphere

Water already has a valuable unified query for ocean and river surface,
normal, depth, velocity, and navigability. The deterministic Gerstner spectrum
is shared between ocean queries and visible geometry. Wind is not a world
service: grass and resource-yard foliage use separate sine functions and water
has hard-coded wave directions. The ocean has visible square/checker repetition
and reflection seams, while shoreline foam, wet-sand/breaker integration and
an underwater presentation baseline are absent. Atmosphere is static background
color plus fog with one hemisphere and one directional light; there are no
sky, weather, cloud, wind-region, time-of-day, or QA preset services.

### Distribution and hardware tiers

The URL exposes high, balanced, and compatibility settings, but their budgets
are hard-coded across renderer classes and are not documented as one tier
contract. The production build copies the full 85 MiB public tree and has no
regional/startup bundle split. Browser cache and desktop/Steam delivery paths
are not abstracted.

## Visible shortcomings captured before modification

1. Ocean/reflection rendering contains obvious square/checker repetition and
   large rectangular seams.
2. Walking-height terrain frequently reads as broad green or brown paint with
   weak soil/rock/geology identity.
3. Forest and canopy mass are absent; ground objects are sparse silhouettes.
4. Serravela reads as grass-covered rounded terrain rather than dark, exposed
   mountain geology.
5. The five traversal bookmarks are generic safe points, not canonical beach,
   river, cliff, wetland, housing, or benchmark compositions.
6. Solmara submits 51.5 million triangles in compatibility mode despite sparse
   visible detail.
7. The completed stream tour retains 32 dressing cells but renders zero
   dressing instances.
8. The settled overhead view contains a large rectangular terrain/water seam.
9. Resource candidates exist only in a review yard and are disconnected from
   canonical visible-world harvest instances.
10. The sky, light, haze, and water/sky color relationship are flat and static.
11. Only five of sixteen zones have authored dressing profiles or bookmarks.
12. No client heap, VRAM consumption, pop-in metric, record/replay path, or
    all-zone benchmark harness exists.

## Phase 1 entry requirements

Phase 1 should add a versioned compiler control-field contract, deterministic
export files, validation/range tests, viewer loading, and debug modes before
the material library expands. Renderer procedural noise may remain only as
presentation breakup. Phase 1 must not encode final climate, geology, resource,
or buildability truth in the shader.
