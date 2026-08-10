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

Writes `output/48291/*` (heightmaps, biome maps, zones, resources, creature spawns, settlements, roads, waterways — see `docs/02_Nevora_World_Data_Schema.md` for the full file contract).

## Inspect it

```bash
npm run viewer
# open http://localhost:5183/?seed=48291
```

Orbit/top-down camera toggle, zone-boundary/river/settlement overlay toggles. The viewer only reads files under `output/<seed>/` — it never talks to the generator directly, per the engine-independence contract in `docs/01_Nevora_World_Generation_Architecture.md`.

## Current status (see `docs/00` for the full audit)

Phase 1 (architecture docs) and an initial Phase 2 pass (working pipeline: elevation, hydrology, climate, biomes, zones, resources, ecology, settlements, roads, naming, export + viewer) are done for all 16 launch zones, with the deepest fidelity on the Alvora → Valedouro → Serravela validation corridor per the project's own first-prototype target. Known gaps, tracked rather than hidden:

- Only Mining + Woodcutting resource tables are wired in (`data/design/resources.json`); the other 8 professions' CSVs weren't safely transcribable by hand (see `docs/00` §1) and need a proper data-sync step.
- Zone boundaries are convex-hull approximations of a Voronoi-style assignment, not yet snapped to ridgelines/rivers.
- Roads are a minimum-spanning-tree of straight lines, not least-cost terrain paths.
- Bands 5–8 (Azurama, Montemoura, Corvento, Lumevara, Vidrala, Altavera, Fendoura, Lumeira) have terrain/ecology but no bible-sourced settlement/housing detail yet — the bible itself doesn't specify it past Band 4.
- Coordinates are continent-local normalized UV, not yet unified world-unit coordinates (docs/02 §1 note).
