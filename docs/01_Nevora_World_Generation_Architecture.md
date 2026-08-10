# Nevora World Generation Architecture

Status: Phase 1 design document, precedes implementation. Companion documents: `02_Nevora_World_Data_Schema.md`, `03_Nevora_Civilization_Map.md`, `04_Nevora_Biome_and_Terrain_Rules.md`.

## 1. Core principle

> The world generator is the valuable asset. The renderer is replaceable.

Everything below is designed so the **generator package never imports, knows about, or depends on Three.js, Unreal, or any renderer**. It consumes a seed + rule config, and emits plain data (JSON + raster buffers written as PNG/RAW). A viewer is just one more consumer of that data.

```
Navora World Bible (lore, source of truth)
        │  (hand-authored, versioned)
        ▼
World Rules (data/design/*.json — zone graph, biome rules, resource tables)
        │
        ▼
Nevora World Compiler  (packages/generator — pure TS, no engine deps)
        │
        ▼
Generated World Data   (heightmap.png/.raw, biome_map.png, waterways.json,
                        zones.json, resources.json, spawns.json, roads.json, poi.json)
        │
   ┌────┴─────────────┐
   ▼                  ▼
Three.js Viewer   (future) Unreal Pipeline
(packages/viewer)  (Landscape/PCG import, not built yet)
```

## 2. Repo layout

```
/data/lore/                 world bible source (docx + extracted text) — read-only reference
/data/design/                hand-authored world rules the generator reads (zones, bands, resource tables)
/packages/generator/          engine-independent TS compiler
  /src/seed/                  PRNG + named sub-streams
  /src/elevation/              continent/mountain/coastline generation
  /src/hydrology/               rivers, lakes, watersheds
  /src/climate/                 temperature/moisture fields
  /src/biomes/                   biome classification from elevation+climate+zone overrides
  /src/zones/                     zone boundary + identity resolution
  /src/resources/                  resource placement from data/design tables
  /src/settlements/                 settlement anchor placement
  /src/ecology/                     creature/spawn region placement
  /src/roads/                       road & trade route generation
  /src/naming/                      naming pattern generator (Portuguese/Iberian-inspired)
  /src/export/                      writers for the 8 output files (see doc 02)
  /src/pipeline.ts                  orchestrates the stages above in order
  /src/cli.ts                       `generate --seed 48291 --region alvora-corridor`
/packages/viewer-threejs/    Vite + Three.js inspection tool, reads generator output only
/output/<seed>/               generated world data (gitignored; regenerable from seed + rules)
/docs/                       this document set
```

## 3. Pipeline stages (execution order)

Each stage is a pure function: `(seed, upstreamData, rules) → stageOutput`. Stages never mutate shared state; each is independently re-runnable and independently testable.

1. **Seed** — derive named sub-seeds (`elevation`, `hydrology`, `climate`, `biomes`, `resources`, `settlements`, `roads`, `naming`, `ecology`) from the master seed via a deterministic hash, so tuning one subsystem's algorithm doesn't reshuffle another's output.
2. **Continental layout** — place Valora and Seradia as two landmasses separated by the Luna Sea, with the Bruma as the mysterious central sub-region between them, at approximate positions/sizes given by `data/design/continents.json` (see doc 03). This stage is coarse: it produces a low-res "landmass mask" and named region anchors, not final coastline detail.
3. **Elevation** — multi-octave noise (domain-warped simplex/OpenSimplex) shaped by the continental mask, producing a heightmap: ocean floor → coastal shelf → plains → hills → mountains, with ridged-noise mountain belts placed to separate the 8 zone-bands per continent, per the world bible's per-zone geography (Section 13–27 of the bible — see doc 04 for the per-zone elevation targets).
4. **Hydrology** — for every cell above sea level, compute flow direction via steepest descent, accumulate flow to derive river networks (D8 or similar flow-accumulation algorithm), carve river channels back into the heightmap (mild bed erosion), pool low-accumulation basins into lakes. Rivers must originate high and terminate at a lake or the ocean — no closed-loop or dead-end decorative rivers.
5. **Climate** — derive temperature from latitude + elevation (lapse rate) and moisture from distance-to-water + prevailing wind/orographic shadow off the mountain belts from stage 3. Output is two scalar fields, not a biome map yet.
6. **Zone resolution** — assign every cell to one of the 16 launch zones (or "unclaimed wilderness" outside the launch footprint) using a Voronoi-like region growth seeded from each zone's anchor point in `data/design/zones.json`, constrained by continent and by the elevation/hydrology features already generated (a zone boundary should follow a mountain ridge or river where the lore says it should, not cut arbitrarily).
7. **Biomes** — classify each cell from elevation + moisture + temperature + latitude, with **zone overrides** where the bible specifies a concrete regional identity (e.g. Alvora is fertile coastal basin + temperate woodland; Serravela is exposed dark stone + steep forested ridges) — see doc 04 for the full rule table.
8. **Resources** — place resource nodes from `data/design/resources.json` (transcribed from the profession CSVs/bible) using each resource's declared zones, elevation band, and biome affinity, following the bible's "overlapping progression" rule (older-tier resources remain placeable in newer zones).
9. **Ecology / spawns** — place creature regions using the Skinning ecosystem table (7 reusable creature-model families × per-zone variant), respecting biome, elevation range, and distance-from-settlement rules.
10. **Settlements** — derive settlement anchors from water access (river mouth, natural harbor, lake), resource proximity, and defensibility (mountain pass, river crossing, chokepoint), tag each with a tier and purpose (capital/port/mining town/fortress/...), per doc 03. This stage runs *before* final road placement — settlements are not sprinkled onto a finished wilderness.
11. **Roads & trade routes** — connect settlement anchors and resource regions with roads/trails (least-cost path over the heightmap, penalizing steep slope and river crossings without a ford/bridge point) and mark sea lanes between coastal ports.
12. **POI / lore placement** — place the bible's named landmarks and Lusaran breadcrumbs (inland lighthouse, impossible well, waymarkers, engineered chamber, ...) at zone-appropriate, out-of-the-way locations.
13. **Naming** — assign names to unnamed generated features (minor settlements, landmarks) using a rule-based Portuguese/Iberian-maritime name generator (see doc 03 §5); canonical zone/major-settlement names from the bible are never overwritten.
14. **Export** — write the 8 output files described in doc 02.

## 4. Seed system

- Master seed: a single integer or string, e.g. `48291`.
- Sub-seeds: `hash(masterSeed, stageName)` → per-stage 32/64-bit seed, so `generate(48291)` is byte-identical every run, and `generate(48291, {onlyRegenerate: 'settlements'})` during iteration only reshuffles settlement placement, not the coastline.
- No stage may read wall-clock time, external randomness, or network state. This is enforced by only ever passing a seeded PRNG instance into stage functions — no stage is allowed to call `Math.random()` directly (lint rule).

## 5. World scale (working default, not yet locked)

No numeric scale exists anywhere in the source material, so this is a default, revisit after the first visual pass:

- Working canvas: **8192 × 8192 world units** per continent tile, two continent tiles plus ocean, laid out per doc 03's continental map — large enough that an 8-band, level-1-to-100 continent reads as a subcontinent, not a single dungeon-sized island.
- Heightmap generation resolution for iteration: **1024×1024** per continent (fast regeneration, seconds not minutes); a `--hq` flag doubles this for a final pass.
- These numbers are placeholders for tuning once the viewer is up and the Alvora→Valedouro→Serravela corridor is visually validated against the bible's descriptions (Section 21 "Band 1 Continental Design," etc.) — see the audit doc §4 for why this corridor is the first target while the generator itself still runs at full scale.

## 6. What Phase 1 code will NOT do

Per the master prompt's explicit "do not focus initially on" list: no combat, NPCs, quests, animation, or detailed prop placement. POI output records *that* a dungeon/ruin/landmark exists, its type, and its location — never its interior layout or encounter design.

## 7. Engine-independence contract

`packages/generator` has zero dependencies on any rendering or game-engine library. Its only third-party dependencies are: a noise library (pure math), and Node's built-in `fs`/`zlib`/PNG-encoding for raster output. This is the boundary that makes the eventual Unreal exporter (doc 02 §5) a new *export* module, not a rewrite of the generator.
