# Navora World Production Completion — Phase 1 Environmental Truth

Date: 2026-08-12 (America/Los_Angeles)  
Branch: `codex/world-production-completion`  
Golden seed: `48291`  
Status: accepted for Phase 2 entry

## Outcome

The compiler now owns the environmental fields required by the world plan.
The terrain renderer no longer creates final moisture from shader noise. It
receives versioned compiler control packs as streamed terrain attributes and
uses those same values for material decisions and visual debug modes.

Regional input is explicit in `data/design/environment-regions.json` for all
16 launch zones. Profiles encode Bible v11 intent for temperature,
precipitation, moisture, exposure, vegetation, housing, soil, geology, and
weather regions. Procedural noise remains inside the compiler for deterministic
physical variation and inside the shader only for presentation breakup.

## Compiler field contract

The in-memory `EnvironmentalFields` contract contains:

- temperature;
- precipitation;
- moisture;
- wetness;
- normalized drainage/flow accumulation;
- distance to water in meters;
- shoreline influence;
- slope in degrees;
- soil class;
- geology class;
- exposure;
- erosion/scree tendency;
- buildability/housing suitability;
- vegetation eligibility;
- weather region class;
- forest, forage, ore, stone, reed, aquatic, and generic resource eligibility.

Elevation remains the authoritative heightfield and biome/ecoregion remains the
existing biome field. Together they cover the Phase 1 acceptance list.

### Transport

`controlFields.json` is a versioned manifest for six RGBA8 packs per continent:

1. `climate`: temperature, precipitation, moisture, wetness;
2. `hydrology`: drainage, water distance, shoreline influence, slope;
3. `terrain`: soil, geology, exposure, erosion/scree;
4. `ecology`: buildability, vegetation, biome, weather region;
5. `resources`: forest, forage, ore, stone;
6. `habitat`: reeds, aquatic, generic resources, reserved channel.

Each channel records its field name, numeric range or categorical labels. The
1024-resolution golden world therefore adds 12 files × 4 MiB = 48 MiB of raw
control data. The standalone artifact grows from 144.64 MiB to 208.73 MiB
because raw maps are base64-embedded. Compression/regional bundle work belongs
to Phase 11; the current cost is explicit rather than hidden.

## Field sanity summary

Low-resolution deterministic audit of seed 48291:

| Field | Valora min / max / mean | Seradia min / max / mean |
|---|---|---|
| Temperature °C | -11.447 / 23.946 / 16.734 | -1.544 / 25.718 / 19.260 |
| Precipitation | 0.362 / 0.968 / 0.597 | 0.151 / 0.940 / 0.548 |
| Moisture | 0 / 1 / 0.774 | 0 / 1 / 0.757 |
| Wetness | 0 / 1 / 0.716 | 0 / 1 / 0.727 |
| Drainage | 0 / 1 / 0.123 | 0 / 1 / 0.112 |
| Water distance m | 0 / 12,384.756 / 2,009.229 | 0 / 13,416.818 / 1,846.394 |
| Shore influence | 0 / 1 / 0.562 | 0 / 1 / 0.595 |
| Slope degrees | 0 / 58.779 / 11.033 | 0 / 56.028 / 8.757 |
| Exposure | 0.052 / 1 / 0.670 | 0.126 / 0.936 / 0.649 |
| Erosion/scree | 0 / 1 / 0.055 | 0 / 1 / 0.028 |
| Buildability | 0 / 1 / 0.271 | 0 / 1 / 0.303 |
| Vegetation | 0 / 1 / 0.299 | 0 / 1 / 0.253 |

Means include ocean cells, which correctly have zero terrestrial
buildability/vegetation.

## Viewer integration

The viewer loads and dimension-checks every control file. Terrain workers
reproject the packs from continent-local fields into their unified world tile
geometry and attach six `vec4` attributes to every streamed vertex. The final
material reads compiler moisture, wetness, drainage, shoreline, slope,
geology, exposure, scree, vegetation, and resource values. Macro/fine shader
noise remains visual breakup only.

Nineteen material/debug modes were exercised without browser warnings or
errors: final, biome, height, temperature, rainfall, slope, shore, moisture,
wetness, drainage, water distance, soil, geology, exposure, scree,
buildability, vegetation, resource, and macro breakup.

## Validation

| Gate | Result |
|---|---:|
| Generator tests | 10/10 pass |
| Viewer tests | 21/21 pass |
| Generator TypeScript build | Pass |
| Viewer Vite build | Pass |
| Golden generation | Pass, 18.145 s wall time |
| Standalone artifact build | Pass, 208.73 MiB |
| Clean WebGPU compatibility runtime | Pass, no console warnings/errors |
| All debug modes | Pass, 19/19 selectable |

The clean runtime sample reported 88 FPS median / 87 FPS 1% low while multiple
other WebGPU baseline tabs were also open, with 124/124 terrain tiles settled.
This is a functional Phase 1 check, not a replacement for the controlled Phase
12 benchmark.

## Defects found and fixed during the phase

- The first environmental range test found infinite water-distance cells. The
  fixed-size BFS queue was re-enqueueing cells due to float comparisons until
  it overflowed. Mark-on-discovery now guarantees one queue entry per cell.
- Categorical attributes initially produced rainbow interpolation at geology
  boundaries. Debug rendering now rounds transported class values back to the
  declared integer class before palette selection.

## Known follow-ups

- The compiler fields are full-resolution and uncompressed on disk. Phase 11
  must introduce compressed/versioned regional delivery without changing the
  manifest semantics.
- Terrain class boundaries currently follow nearest-cell/vertex interpolation.
  Phase 3 recipes should add presentation blending that preserves underlying
  categorical truth.
- Buildability is environmental suitability only. Phase 4 must add authored
  road/access/flood/housing reservations and inspect them as part of landform
  completion.
- Resource placement still uses its older zone/biome constraints. Phase 5 must
  reconcile every visible resource with these new eligibility fields.

Phase 2 may now expand the material vocabulary without moving environmental
truth back into the renderer.
