# Nevora World Data Schema

Defines the exact output contract of `packages/generator` — the interface between the generator and any consumer (Three.js viewer today, Unreal pipeline later, or a future server). All files live under `output/<seed>/`.

## 1. File manifest

| File | Format | Produced by pipeline stage |
|---|---|---|
| `heightmap.<continent>.png` | 16-bit grayscale PNG, one per continent tile | Elevation (03) |
| `heightmap.<continent>.raw` | Raw float32 array, row-major, same dimensions, for lossless re-import | Elevation (03) |
| `heightmap.world.png` | 16-bit grayscale PNG of the **unified world heightfield** — both continents *and* the connecting seabed between them, one grid | Elevation (03) |
| `heightmap.world.raw` | Raw float32 array of the same unified field, row-major, no header — dimensions/bounds come from `manifest.json`'s `worldHeightmap` | Elevation (03) |
| `biome_map.png` | 8-bit indexed PNG, palette = biome IDs | Biomes (07) |
| `controlFields.json` | versioned RGBA8 control-pack schema, channel ranges/class labels, dimensions, and file names | Environmental truth (05) |
| `control.<continent>.<pack>.rgba` | raw RGBA8 compiler control pack, row-major, six packs per continent | Environmental truth (05) |
| `waterways.json` | rivers, lakes, ocean boundary polylines/polygons | Hydrology (04) |
| `zones.json` | zone boundaries, identity, climate/resource/danger summary | Zone resolution (06) |
| `resources.json` | resource node type, location, density, tier | Resources (08) |
| `spawns.json` | creature/ecology regions | Ecology (09) |
| `roads.json` | roads, trails, bridge points, sea routes | Roads (11) |
| `poi.json` | settlements, ruins, landmarks, dungeons | Settlements (10) + POI (12) |
| `seaRegions.json` | named open-ocean regions (currently just the Bruma) | Continental layout (02), see §11 |
| `manifest.json` | seed, generator version, rule-config hash, generation timestamp, world scale, **continent world placement**, unified world heightmap dimensions/bounds | Export (14) |

All coordinates are in **world units** (see doc 01 §5), origin at the southwest corner of the combined world bounds, `+x` east, `+y` north. Elevation is meters above/below sea level (float).

> **v1 implementation note:** the current generator emits most positions (zones, resources, spawns, settlements, roads, rivers) as **continent-local normalized `[0,1]×[0,1]` UV coordinates** rather than unified world-unit coordinates — every position-bearing record also carries (or is reachable from) a `continent`/`zoneId` field that disambiguates which continent's UV space it's in. The one exception is elevation: `heightmap.world.raw`/`.png` (§9) already IS a single unified world-unit heightfield spanning both continents (docs/01 §3 stage 3), since the connecting seabed between them has no continent to be local to. Converting the remaining position-bearing records to the same unified frame (continents placed side-by-side per doc 01 §5, with the Luna Sea gap between them) is straightforward follow-up work, and is a pure export-layer change — it does not touch any generation logic above stage 14. `seaRegions.json` (§8b) is the other existing exception, for the same reason.

## 2. `manifest.json`

```jsonc
{
  "seed": 48291,
  "generatorVersion": "0.2.0",
  "ruleConfigHash": "sha256:...",   // hash of everything in data/design/ used
  "generatedAt": "2026-08-10T00:00:00Z",
  // World units are meters, both horizontally and vertically (docs/01 §5).
  "worldScale": { "continentTileSize": 32768, "heightmapResolution": 512 },
  "continents": ["valora", "seradia"],
  // World-unit (meter) placement of each continent tile's origin, sourced
  // from data/design/continents.json -- the ONLY thing that gets consumers
  // (viewer, future Unreal exporter) to agree on where Valora and Seradia
  // sit relative to each other and to the Luna Sea/Bruma between them.
  // See docs/01 §5 for why this exists and what the numbers mean.
  "continentLayout": {
    "valora": { "worldOffset": [0, 0] },
    "seradia": { "worldOffset": [98304, 0] }
  },
  // Dimensions/bounds of heightmap.world.raw -- the unified heightfield
  // spanning both continents and the connecting seabed between them
  // (docs/01 §3 stage 3). bounds are in the same world-unit (meter) frame
  // as continentLayout above.
  "worldHeightmap": {
    "width": 2048,
    "height": 512,
    "bounds": { "minX": 0, "minZ": 0, "maxX": 131072, "maxZ": 32768 }
  }
}
```

## 3. `zones.json`

```jsonc
{
  "zones": [
    {
      "id": "alvora",
      "properName": "Alvora",
      "descriptor": "The Crownlands",
      "continent": "valora",
      "band": 1,
      "approxLevelRange": [1, 15],
      "boundary": { "type": "Polygon", "coordinates": [[...]] },  // GeoJSON-style ring in world units
      "biomeSummary": ["coastal-plain", "temperate-woodland"],
      "climate": { "avgTemperatureC": 16, "avgMoisture": 0.55 },
      "resourceTierRange": { "mining": [1, 5], "woodcutting": [1, 5] },
      "dangerProfile": "low-near-settlements-rising-at-edges",
      "housingDistricts": [
        { "name": "Agricultural heartland district", "kind": "farmland", "anchor": [x, y] },
        { "name": "Woodland district", "kind": "rustic", "anchor": [x, y] },
        { "name": "Coastal district", "kind": "maritime", "anchor": [x, y] }
      ],
      "loreBreadcrumb": { "type": "lusaran-lighthouse", "anchor": [x, y], "notes": "ancient stone lighthouse, inexplicably inland" }
    }
    // ...16 zones total, 8 per continent
  ]
}
```

`id` values are the lowercase proper names from the bible's canonical crosswalk (`alvora`, `valedouro`, `serravela`, `cavora`, `azurama`, `montemoura`, `corvento`, `lumevara` for Valora; `fonteira`, `riveira`, `vermara`, `solmara`, `vidrala`, `altavera`, `fendoura`, `lumeira` for Seradia) — never the working descriptors, per the bible's own instruction that "future profession CSVs, map data, ecosystem tables, and implementation data should use the proper zone name as the primary identifier."

## 4. `resources.json`

```jsonc
{
  "resources": [
    {
      "resourceId": "IRON_ORE",
      "profession": "mining",
      "unlockLevel": 15,
      "instances": [
        { "position": [x, y], "zoneId": "valedouro", "elevationM": 340, "density": "medium", "nodeType": "IRON_VEIN" }
        // ...
      ]
    }
  ]
}
```

`resourceId` and `unlockLevel` are pulled from the profession progression tables (design-authored per doc 01 §6 for the launch corridor; extend from the full CSVs once a proper sync exists — see audit doc §1). `instances` are what the generator actually placed given zone/elevation/biome affinity — this is the generative step; the design table only supplies the *rule*, not the placement.

## 5. `spawns.json`

```jsonc
{
  "spawnRegions": [
    {
      "creatureId": "crown_deer",
      "family": "CERVID",
      "zoneId": "alvora",
      "region": { "type": "Polygon", "coordinates": [[...]] },
      "skinningLevel": 1,
      "primaryDrop": "LIGHT_HIDE",
      "elevationRangeM": [0, 200],
      "minDistanceFromSettlementM": 150
    }
  ]
}
```

Mirrors the bible's Skinning ecosystem table exactly (creature name, family, required Skinning level, primary/rare drop) — see doc 04 §4.

## 6. `waterways.json`

```jsonc
{
  "ocean": { "type": "MultiPolygon", "coordinates": [[[...]]] },
  "rivers": [
    {
      "id": "river-alvora-01",
      "path": [[x0,y0], [x1,y1], "..."],   // ordered source→mouth polyline
      "sourceElevationM": 610,
      "terminatesIn": { "type": "ocean", "featureId": "luna-sea" },
      "widthProfile": [ [0.0, 2], [0.5, 8], [1.0, 20] ]  // (t along path, width in world units)
    }
  ],
  "lakes": [ { "id": "...", "polygon": { "type": "Polygon", "coordinates": [[...]] }, "depthM": 12 } ]
}
```

## 7. `roads.json`

```jsonc
{
  "roads": [
    {
      "id": "...",
      "kind": "road|trail",
      "path": [[x,y], "..."],   // A*-resolved route over the real heightfield (docs/01 §3 stage 11), not a straight line between endpoints
      "connects": ["alvora-crownkeep", "valedouro-greenmarket"],
      // Every contiguous water crossing along `path`, as an explicit anchor
      // point a renderer can place a bridge asset at instead of the road
      // silently walking on water. Empty if the route never crosses water.
      "bridges": [ { "id": "...", "start": [x,y], "end": [x,y] } ]
    }
  ],
  "seaRoutes": [ { "id": "...", "path": [[x,y], "..."], "connects": ["port-a", "port-b"], "risk": "low|medium|high" } ]
}
```

## 8. `poi.json`

```jsonc
{
  "settlements": [
    {
      "id": "alvora-crownkeep",
      "name": null,               // null = not yet named; see doc 03 §5
      "tier": 1,
      "type": "major-port",
      "reason": "protected bay + trade route intersection",
      "position": [x, y],
      "zoneId": "alvora"
    }
  ],
  "landmarks": [ { "id": "...", "type": "lusaran-lighthouse", "position": [x,y], "zoneId": "alvora" } ],
  "ruinsAndDungeons": [ { "id": "...", "type": "lusaran-chamber", "position": [x,y], "zoneId": "serravela", "accessNote": "exposed by mining activity" } ]
}
```

This is the exact "Settlement Anchor" object shape the master prompt specifies (`Type`, `Reason`, `Importance`/tier).

## 8b. `seaRegions.json`

Named open-ocean regions that don't belong to either continent's UV space — currently just the Bruma, but the shape generalizes to future mid-ocean features (storm bands, sea monster territories, ...). Positions here are the one deliberate exception to the "continent-local UV" v1 coordinate note in §1: a sea region between two continents has no single continent to be local to, so it's expressed directly in world units against `manifest.json`'s `continentLayout`.

```jsonc
{
  "regions": [
    {
      "id": "bruma",
      "name": "The Bruma",
      "center": [65536, 16384],   // world units (meters); midpoint of the Luna Sea gap -- (valora edge 32768 + seradia edge 98304) / 2
      "radiusUnits": 10000,
      "magicalIntensity": "high",
      "notes": "Mysterious central waters of the Luna Sea -- storm-prone, magically anomalous, avoided by ordinary sailors. See docs/01 §5, docs/03 §1."
    }
  ]
}
```

## 9. Raster formats

- `heightmap.<continent>.png` / `heightmap.world.png`: 16-bit grayscale, value `0..65535` maps linearly to `[-maxDepthM, +maxHeightM]` — the world variant uses a dual land/ocean gamma curve so both abyssal depth and mountain peaks stay visually legible in one 16-bit image.
- `heightmap.<continent>.raw` / `heightmap.world.raw`: float32, little-endian, row-major, no header — dimensions come from `manifest.json` (`worldScale.heightmapResolution` for the per-continent files, `worldHeightmap.width`/`height` for the world file); kept alongside the PNGs because PNG's 16-bit quantization is lossy for downstream erosion/re-processing. `heightmap.world.raw` is the authoritative source for the connecting seabed between continents (docs/01 §3 stage 3) and for grounding the viewer's walk-mode camera anywhere in the world, including mid-ocean.
- `biome_map.png`: 8-bit indexed color; the palette-to-biome-ID mapping is fixed and versioned in `packages/generator/src/biomes/palette.ts` and mirrored in this doc's biome table (doc 04 §2).
- `controlFields.json` + `control.<continent>.<pack>.rgba`: version 1 exports six four-channel RGBA8 packs (`climate`, `hydrology`, `terrain`, `ecology`, `resources`, `habitat`). The manifest records each channel's field name, continuous range or categorical labels, so clients never hard-code byte interpretation. The source fields remain float32/integer arrays inside `WorldOutput`; RGBA8 is the browser/asset transport. The viewer reprojects these values into streamed terrain vertex attributes and uses the same attributes for final material selection and debug modes.

## 10. Versioning & regeneration contract

`manifest.json`'s `ruleConfigHash` is a hash of every file under `data/design/` that fed the run. Any consumer (viewer, future Unreal importer) can check that hash against its own copy of the design data to know whether output is stale. **Nothing in `output/` is hand-edited or treated as a source of truth** — it is always fully reproducible from `(seed, data/design/*, generatorVersion)`, which is the determinism guarantee the master prompt asks for under "Seed System."

## 5b. Future Unreal export (not built in Phase 2)

When the Unreal pipeline is built, it adds an **additional** export module under `packages/generator/src/export/unreal/` that reads the same in-memory pipeline output and writes: Unreal Landscape-compatible heightmaps (16-bit RAW, power-of-two+1 dimensions), biome masks as per-layer weight textures for the Landscape layer system, PCG placement data (points + rotation/scale/density per resource-and-ecology entry above) as a PCG-readable data table, spline data for rivers/roads (control points + width), and flattened resource/spawn tables as UE DataTable-compatible CSV/JSON. This is additive — it does not change anything in sections 1–9 above, which is the point of keeping the generator engine-independent.
