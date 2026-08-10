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
3. **Elevation** — generates **one unified heightfield spanning the entire world** (both continent tiles *and* the open Luna Sea between them), not two independent per-continent tiles stitched together later. Each continent gets its own noise-seeded sampler (domain-warped multi-octave simplex, plus a ridged-noise mountain term) so Valora and Seradia keep distinct terrain character, but every sampler is evaluated across the full world grid and combined with `max()` — because each continent's own ocean-depth falloff already smoothly reaches full abyssal depth far from that continent's coast, the connecting seabed between the two continents just falls out of the existing per-continent formula once it's actually evaluated out there, with no separate "ocean floor" model needed. Per-continent-local `[0,1]×[0,1]` views are then resampled back out of the unified field for every downstream stage (hydrology onward), which still see exactly the per-continent heightfield shape they always did. A zone's target elevation (from `data/design/zones.json`'s `elevationTargetM`) blends across the continent via inverse-distance weighting from each zone's anchor — this exponent controls how sharply a mountain zone's high elevation hands off to a neighboring low zone versus spreading into a broad shared plateau (see §5's scale note below for why this matters at real-world scale). Ridged-noise mountain relief is layered on top of that blended baseline, scaled by how "mountainous" the local target elevation is.
4. **Hydrology** — for every cell above sea level, compute flow direction via steepest descent, accumulate flow to derive river networks (D8 or similar flow-accumulation algorithm), carve river channels back into the heightmap (mild bed erosion), pool low-accumulation basins into lakes. Rivers must originate high and terminate at a lake or the ocean — no closed-loop or dead-end decorative rivers.
5. **Climate** — derive temperature from latitude + elevation (lapse rate) and moisture from distance-to-water + prevailing wind/orographic shadow off the mountain belts from stage 3. Output is two scalar fields, not a biome map yet.
6. **Zone resolution** — assign every cell to one of the 16 launch zones (or "unclaimed wilderness" outside the launch footprint) using a Voronoi-like region growth seeded from each zone's anchor point in `data/design/zones.json`, constrained by continent and by the elevation/hydrology features already generated (a zone boundary should follow a mountain ridge or river where the lore says it should, not cut arbitrarily).
7. **Biomes** — classify each cell from elevation + moisture + temperature + latitude, with **zone overrides** where the bible specifies a concrete regional identity (e.g. Alvora is fertile coastal basin + temperate woodland; Serravela is exposed dark stone + steep forested ridges) — see doc 04 for the full rule table.
8. **Resources** — place resource nodes from `data/design/resources.json` (transcribed from the profession CSVs/bible) using each resource's declared zones, elevation band, and biome affinity, following the bible's "overlapping progression" rule (older-tier resources remain placeable in newer zones).
9. **Ecology / spawns** — place creature regions using the Skinning ecosystem table (7 reusable creature-model families × per-zone variant), respecting biome, elevation range, and distance-from-settlement rules.
10. **Settlements** — derive settlement anchors from water access (river mouth, natural harbor, lake), resource proximity, and defensibility (mountain pass, river crossing, chokepoint), tag each with a tier and purpose (capital/port/mining town/fortress/...), per doc 03. This stage runs *before* final road placement — settlements are not sprinkled onto a finished wilderness.
11. **Roads & trade routes** — a minimum spanning tree over settlement anchors decides network *topology* (which settlements connect at all), then each edge is routed independently with A* over a coarsened cost field derived from the real heightfield: steep slope is expensive (routes bend around a cliff instead of running straight through it), and crossing water is expensive-but-possible (a route only crosses where it's clearly the best option, e.g. a narrow point, rather than wherever a straight line happened to fall). Every place a route's resolved path actually crosses water is recorded as an explicit bridge point (start/end coordinates) in the output — a renderer has a real anchor to place a bridge asset at instead of the road silently walking on water. Sea lanes between coastal ports are marked separately (not yet implemented — tracked as a gap, see doc 00).
12. **POI / lore placement** — place the bible's named landmarks and Lusaran breadcrumbs (inland lighthouse, impossible well, waymarkers, engineered chamber, ...) at zone-appropriate, out-of-the-way locations.
13. **Naming** — assign names to unnamed generated features (minor settlements, landmarks) using a rule-based Portuguese/Iberian-maritime name generator (see doc 03 §5); canonical zone/major-settlement names from the bible are never overwritten.
14. **Export** — write the 8 output files described in doc 02.

## 4. Seed system

- Master seed: a single integer or string, e.g. `48291`.
- Sub-seeds: `hash(masterSeed, stageName)` → per-stage 32/64-bit seed, so `generate(48291)` is byte-identical every run, and `generate(48291, {onlyRegenerate: 'settlements'})` during iteration only reshuffles settlement placement, not the coastline.
- No stage may read wall-clock time, external randomness, or network state. This is enforced by only ever passing a seeded PRNG instance into stage functions — no stage is allowed to call `Math.random()` directly (lint rule).

## 5. World scale (working default, not yet locked)

No numeric scale exists anywhere in the source material, so this is a default, revisit as the viewer keeps getting used. Two corrections have happened since Phase 1, both from actually looking at the world in the viewer rather than reasoning about numbers on paper:

**Corrected 2026-08-10 (1st pass — continent separation)**: the first implementation pass got the *proportions* wrong — it never actually specified how much ocean separates the two continents, so the viewer defaulted to a gap smaller than either continent, which read as one landmass with a strait, not "two continents divided by a large ocean" (master prompt, "World Scale Requirements"). `data/design/continents.json` was introduced as the single source of truth for continent placement.

**Corrected 2026-08-10 (2nd pass — real-world units)**: the numbers from the 1st pass were internally consistent but not tied to anything physical — elevation was in "world units" that didn't obviously correspond to horizontal distance, and the viewer applied an undocumented 0.35× vertical-exaggeration fudge factor to make an undersized-feeling world look more reasonable. That's backwards: faking the vertical scale instead of fixing the horizontal one is exactly the kind of thing that "breaks everything later" when the world is brought into the actual game (Kevin: *"we need to get the scale properly in this whole compiler... we don't have to resize everything later on and break it"*). The fix: **`data/design/continents.json` declares `unitsAreMeters: true`, and world units are now literally meters in both axes** — the viewer's vertical exaggeration is gone (`ELEVATION_SCALE = 1`), and every horizontal number below was scaled up 4× so elevation-to-width ratios stay physically sane instead of producing a world that's tall for its footprint.

- **Per-continent footprint**: **32768 × 32768 meters** (`continentTileSize`) per continent tile — roughly the size of a small real-world country, large enough that an 8-band, level-1-to-100 continent reads as a subcontinent walked or ridden across over real in-game hours, not a dungeon-sized island.
- **The Luna Sea**: the open-water gap between Valora's east coast and Seradia's west coast is **65536 meters** (`lunaSeaGapUnits`) — 2× a continent's own width, not a strait. `data/design/continents.json`'s `worldOffset` fields encode this directly (Valora at `[0,0]`, Seradia at `[98304,0]` = one continent width + the sea gap); the viewer reads continent placement from `manifest.json`, it does not invent its own layout.
- **The Bruma**: placed at the horizontal midpoint of the sea gap, `data/design/continents.json`'s `bruma` entry, with a working radius of **10000 meters** — a genuinely large, sail-around-it feature. Exported as a named `seaRegions` record (doc 02 §11) so it's inspectable; still the intended anchor for the magical-intensity field's mid-ocean spike (doc 04 §3) once that field exists — not built yet, tracked as a gap, not silently dropped.
- **Mountain relief**: the inverse-distance-weighting exponent that blends each zone's target elevation across the continent controls how sharply a high zone's elevation hands off to a lower neighbor. At the original exponent (2.2), that handoff happened over 8-12km, so a mountain zone's peak sat on a broad shared plateau with its surroundings already elevated — physically tall by the numbers, but nothing you'd call a climb, since there was no nearby low ground for it to rise *from*. Raised to **4.5** (plus the ridge-noise mountain term's amplitude raised 900m → 1600m and its frequency tightened for less spread-out relief) so a mountain zone's neighbor reads as an actual valley floor within a few kilometers, giving faces with real 30-50° grades near a summit rather than a uniform ~20° dome. Verified in the viewer by teleporting to a walk-mode vantage a few km from a summit and confirming the peak actually requires looking up, not just checking the elevation number.
- **Fly/walk camera**: both are true human/vehicle-scale now that units are meters — walking is ~1.4 m/s (real pace) with a 5× run boost, eye height 1.7m; flying is a scouting camera (not a physical vehicle) at up to a few tens of km/h boosted, clamped to the world's own rendered footprint so a fast, sustained run can't fly the camera off the edge of the generated geometry into empty space.
- Heightmap generation resolution for iteration: **512×512** per continent (~64m/cell at the current tile size) — fast regeneration, seconds not minutes.
- These numbers are still tuning defaults, not locked — the next thing worth re-checking as the world gets used more is whether 32768m continents feel like the right *time-to-cross* at actual player movement speed once movement speed itself is settled in the game, not just the compiler's own scouting camera.

## 6. What Phase 1 code will NOT do

Per the master prompt's explicit "do not focus initially on" list: no combat, NPCs, quests, animation, or detailed prop placement. POI output records *that* a dungeon/ruin/landmark exists, its type, and its location — never its interior layout or encounter design.

## 7. Engine-independence contract

`packages/generator` has zero dependencies on any rendering or game-engine library. Its only third-party dependencies are: a noise library (pure math), and Node's built-in `fs`/`zlib`/PNG-encoding for raster output. This is the boundary that makes the eventual Unreal exporter (doc 02 §5) a new *export* module, not a rewrite of the generator.
