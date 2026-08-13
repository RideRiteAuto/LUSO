# Nevora World Compiler

An engine-independent procedural world generator for **Navora**, plus a Three.js tool for inspecting its output. The generator is the asset; the viewer is a replaceable debug tool. See `docs/` for the full design — start with `docs/00_Nevora_Audit_and_Assumptions.md`.

```
docs/           architecture + design documents (read these first)
data/lore/      the world bible (source docx + extracted text)
data/design/    hand-authored world rules the generator reads (zones, resources, creatures)
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

Writes `output/48291/*` (heightmaps, biome maps, versioned environmental control packs, zones, resources, creature spawns, settlements, roads, waterways — see `docs/02_Nevora_World_Data_Schema.md` for the full file contract).

Version 0.4 generates 65.5 km continent tiles at 1024 samples by default;
`--hq` uses 2048. Terrain geometry combines multi-scale mountain spines,
secondary ridges, fault relief, drainage incision, and fine local variation.

## Inspect it

```bash
npm run viewer
# open http://localhost:5183/?seed=48291
```

Orbit / top-down / "World" (frames both continents + the Bruma) camera presets, a free-fly mode (drag to look, WASD to move, Space/Ctrl for up-down, hold Shift to go fast, scroll to change speed — click **Fly** in the HUD), and zone-boundary/river/settlement overlay toggles. The viewer only reads files under `output/<seed>/` — it never talks to the generator directly, per the engine-independence contract in `docs/01_Nevora_World_Generation_Architecture.md`.

## Sharing it as a link (no server required)

```bash
npm run build:artifact -w @nevora/viewer-threejs -- --seed 48291
```

Bundles the viewer (three.js included) and inlines that seed's `output/48291/*` data directly into one HTML file at `packages/viewer-threejs/dist-artifact/nevora-inspector-48291.html` — no dev server, no fetch calls, works from a plain `file://` open or as a published claude.ai artifact. Flight controls here deliberately use drag-to-look rather than the Pointer Lock API, since Pointer Lock is commonly blocked inside sandboxed iframes.

## Current status (see `docs/00` for the full audit)

Phase 1 (architecture docs) and an initial Phase 2 pass (working pipeline: elevation, hydrology, climate, biomes, zones, resources, ecology, settlements, roads, naming, export + viewer) are done for all 16 launch zones, with the deepest fidelity on the Alvora → Valedouro → Serravela validation corridor per the project's own first-prototype target. Known gaps, tracked rather than hidden:

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
