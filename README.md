# Nevora World Compiler

An engine-independent procedural world generator for **Navora**, plus a Three.js tool for inspecting its output. The generator is the asset; the viewer is a replaceable debug tool. See `docs/` for the full design — start with `docs/00_Nevora_Audit_and_Assumptions.md`.

```
docs/           architecture + design documents (read these first)
data/lore/      the world bible (source docx + extracted text)
data/design/    hand-authored world rules the generator reads (zones, environment, materials, resources, creatures)
packages/generator/       pure TS/Node world generator, zero rendering dependencies
packages/viewer-threejs/  Vite + Three.js inspection tool (reads generator output only)
output/         generated worlds, one folder per seed (gitignored — always regenerable)
```

## Setup

```bash
npm install
```

## Generate a world

```bash
npm run generate -- --seed 48291
# or, for a higher-resolution pass:
npm run generate -- --seed 48291 --hq
```

Writes `output/48291/*` (heightmaps, biome maps, versioned environmental control packs and terrain-material recipes, zones, resources, creature spawns, settlements, roads, waterways — see `docs/02_Nevora_World_Data_Schema.md` for the full file contract).

Version 0.4 generates 65.5 km continent tiles at 1024 samples by default;
`--hq` uses 2048. Terrain geometry combines multi-scale mountain spines,
secondary ridges, fault relief, drainage incision, and fine local variation.

## Inspect it

```bash
npm run viewer
# open http://localhost:5183/?seed=48291
```

Orbit / top-down / "World" (frames both continents + the Bruma) camera presets, a free-fly mode (drag to look, WASD to move, Space/Ctrl for up-down, hold Shift to go fast, scroll to change speed — click **Fly** in the HUD), and zone-boundary/river/settlement overlay toggles. The viewer only reads files under `output/<seed>/` — it never talks to the generator directly, per the engine-independence contract in `docs/01_Nevora_World_Generation_Architecture.md`.

The shipping terrain library is generated with `npm run textures:ktx2 -w @nevora/viewer-threejs`. Its 33 semantic families share seven reviewed CC0 scan sets; `terrainMaterials.json` controls which albedo/normal/roughness channels become resident at each quality tier, while `terrainMaterialRecipes.json` maps all 16 canonical zones to compiler-driven primary/secondary/tertiary/shore/steep/wet/cold recipes. After generating a seed, open `http://localhost:5183/material-library.html?seed=48291` for the complete family review sheet. The viewer adds exact `Recipe / zone`, `Material ID`, and `LOD / mip stress` diagnostics to the environmental debug modes.

## Sharing it as a link (no server required)

```bash
npm run build:artifact -w @nevora/viewer-threejs -- --seed 48291
```

Bundles the viewer (three.js included) and inlines that seed's `output/48291/*` data directly into one HTML file at `packages/viewer-threejs/dist-artifact/nevora-inspector-48291.html` — no dev server, no fetch calls, works from a plain `file://` open or as a published claude.ai artifact. Flight controls here deliberately use drag-to-look rather than the Pointer Lock API, since Pointer Lock is commonly blocked inside sandboxed iframes.

## Current status (see `docs/00` for the full audit)

World-production Phases 0–4 are implemented on `codex/world-production-completion`. The first Review A was rejected for overlay-only rivers and blocky/repeating compatibility materials; the corrected five-location evidence now awaits approval before vegetation work begins. The compiler exports environmental truth fields, 33 terrain families, canonical zone recipes, physically carved river beds/banks, confluence-aware watersheds, real lake basin/spill/outlet data, classified coasts, Luna Sea bathymetry, and post-infrastructure housing suitability. See `docs/18_Navora_World_Production_Phase_4_Geography_Hydrology_and_Review_A.md` for the revised evidence and approval checklist. Known gaps, tracked rather than hidden:

- Only Mining + Woodcutting resource tables are wired in (`data/design/resources.json`); the other 8 professions' CSVs weren't safely transcribable by hand (see `docs/00` §1) and need a proper data-sync step.
- Zone boundaries are convex-hull approximations of a Voronoi-style assignment, not yet snapped to ridgelines/rivers.
- Road topology uses a minimum-spanning tree, while each connection follows a terrain-aware A* route and records water crossings as bridge anchors.
- Bands 5–8 (Azurama, Montemoura, Corvento, Lumevara, Vidrala, Altavera, Fendoura, Lumeira) have terrain/ecology but no bible-sourced settlement/housing detail yet — the bible itself doesn't specify it past Band 4.
- Coordinates are continent-local normalized UV, not yet unified world-unit coordinates (docs/02 §1 note).

## Verification and scale

Run `npm test` to validate deterministic generation, seed variation, safe
ocean boundaries, unique resource placement, and ecology/settlement distance
constraints. The production `npm run build` now builds both the generator and
the inspection viewer.

Naval traversal and world-scale tradeoffs are documented in
`docs/05_Nevora_Scale_QA_and_Traversal.md`; the central sea remains a deliberate
gameplay parameter rather than a camera-composition patch.
