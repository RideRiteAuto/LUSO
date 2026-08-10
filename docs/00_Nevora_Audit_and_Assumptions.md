# Nevora World Compiler — Audit & Assumptions

*Phase 1 deliverable, written before any generator code. Per the project's own instructions: understand and plan first.*

## 1. What I actually found

The master prompt names a specific set of source files to audit (`GRIM-WORLD-CONTENT-BIBLE.md`, `zones.csv`, `nodes.csv`, `recipes.csv`, `quests.csv`, `bonus_drops.csv`, `editor_objects.csv`). **None of those files exist in this project.** They appear to be filenames from a template/prior project (there is a separate, unrelated title called "Grim World" in `RideRiteAuto/grim-arena`, not this repo). I did not find them in this repo, in `RideRiteAuto/LUSO` on GitHub (the repo is currently empty — no commits, no branches other than this one), or in the attached Google Drive folder.

What *does* exist, and what I'm treating as the actual source of truth:

- **`Navora_Worldbuilding_Bible_v11_TAILORING_FISHING_COOKING.docx`** — the file you attached and the one also sitting in your Google Drive folder "NAVORA GAME DESIGN". Extracted losslessly via a small script (python `xml.etree` over the docx's `word/document.xml` — deterministic, not hand-transcribed) to `data/lore/Navora_Worldbuilding_Bible_v11_extracted.md`, and the original `.docx` is committed alongside it at `data/lore/Navora_Worldbuilding_Bible_v11.docx`.
- **30 profession CSVs** in the same Drive folder — three per profession (`*_progression.csv`, `*_items.csv`, and either `*_resources.csv` for gathering skills or `*_recipes.csv` for crafting skills) across 10 professions: Mining, Smithing, Carpentry, Farming, Woodcutting, Foraging, Skinning, Tailoring, Fishing, Cooking.

**I did not vendor copies of the 30 CSVs into this repo.** I started to, decoding them from the Drive API's base64 payloads via hand-typed `base64 -d` heredocs, and caught myself corrupting data partway through — a "meal" silently became "mo eal" in one file and a recipe file got truncated, both without the decode step itself failing. That's a transcription error a language model can make and not reliably self-detect, and I was about to leave those files sitting in the repo labeled as authoritative source data. I deleted everything I'd hand-copied rather than ship silent corruption. **Google Drive remains the canonical source for the 30 CSVs** (folder "NAVORA GAME DESIGN", owned by Kevin@riderite.us) until they're synced by an actual programmatic tool (e.g. a small authenticated fetch script, or by pulling them through the same Drive connector at generation time) rather than by me retyping base64 by hand. I did read every CSV's contents once via the Drive API to inform the design docs below and my understanding of the resource/zone/creature data — the design facts in this document and the ones that follow are accurate; what I declined to do is claim a byte-for-byte local mirror I can't fully vouch for.

## 2. Naming: Navora vs. Nevora

Your spoken instructions call the project the "**Nevora** World Compiler." The world bible itself, its Drive folder, and every zone/lore name in it consistently say "**Navora**" (Valora, Seradia, the Valorin Crown, the Seradian Concord, the Luna Sea, Lusara, Verdelume — all built around "Navora," never "Nevora"). I'm treating this as a dictation slip and using **Navora** as the world's name everywhere it matters (lore, data, zone files), while keeping **"Nevora World Compiler"** as the tool/codebase's own product name only if you want that — otherwise I'd default the repo/tool name to "Navora World Compiler" too, for consistency. Flagging this rather than guessing wrong silently. Happy to rename either direction — it's a find-and-replace at this stage.

## 3. Reconciling the master prompt's "first prototype target" with actual zone names

The master prompt says the first validation slice should be **"Crownlands → Greyspines → Velamoss."** The world bible's canonical zone crosswalk (Section "V10 CANONICAL ZONE AND SKINNING UPDATE") gives the real Band 1→2→3 chain on Valora as:

| Band | Proper name | Descriptor | Levels |
|---|---|---|---|
| 1 | Alvora | The Crownlands | 1–15 |
| 2 | Valedouro | Greenvale | 10–25 |
| 3 | Serravela | The Greyspines | 20–35 |

There is no "Velamoss" anywhere in the bible. There *is* a Foraging resource called `VELAMOSS` (a level-90 "Rare Moss," Band 8) in `foraging_progression.csv` — almost certainly what got conflated in speech. **Assumption:** the intended validation corridor is **Alvora (Crownlands) → Valedouro (Greenvale) → Serravela (Greyspines)** — the actual first three Valora zones, coast → river valley → mountains, which is also exactly the geography the "first prototype target" section asks for (coastline, forest region, mountain range, river system). I'm building to that.

## 4. World scale vs. "first prototype" — how I'm resolving the tension

The master prompt asks for two things that pull in different directions: "do not create a tiny demo island... two major continents, large ocean" *and* "first validate Crownlands → Greyspines → Velamoss." Resolution: the **generator itself is written at full-continent scale** from day one (Valora + Seradia + the Luna Sea + the Bruma, per the world bible's actual geography) — it is never a toy single-island generator. But the **first rendered/inspected output** focuses the Three.js viewer's default camera and the visual-QA pass on the Alvora→Valedouro→Serravela corridor, because that's the one region I have deep, specific design detail for (ecology, resources, settlements, lore beats) to check the output against. Both requirements are satisfied; neither is quietly dropped.

## 5. What the world bible actually gives the generator to work with

This is unusually rich, non-generic worldbuilding — the generator should be built to *honor* it, not paper over it with generic Perlin-noise fantasy terrain:

- **16 launch zones**, 8 per continent, in explicit level/geography bands, each with a named "proper" identity (Alvora, Fonteira, ...) and a working descriptor (Crownlands, Firstwater Basin, ...).
- **Valora vs. Seradia are progression-equivalent, not mirrored**: Valora is vertical/rugged/ocean-facing (cliffs, fjords, mountain passes); Seradia is broad/river-driven (deltas, plains, plateaus). The generator's zone-shape rules need two distinct geographic "grammars," not one grammar recolored.
- **A resource-tier ladder shared across zones** (Stone/Copper→Tin→Iron→Coal→Cobalt→Titanium→Pedral for Mining; Pine→Birch→Oak→Ash→Maple→Teak→Ironwood→Lumeiro for Woodcutting, etc.), where older resources persist into newer zones rather than being replaced — "Resource Placement Rule: Overlapping Progression" is explicit about this.
- **A full creature/ecology pass already exists for Skinning** — 7 reusable creature-model families (Cervid, Boar, Canid, Bear, Feline, Crocodilian, Grazer) placed per zone with named regional variants — this is effectively the "Monster Ecology" spec the master prompt asks for, already authored, per zone, per band.
- **Settlement/housing logic tied to geography**: named housing districts per zone (e.g. Crownlands: agricultural / woodland / coastal districts), each justified by terrain (river-valley farmland, mining-town rough ground, harbor-edge merchant land) — this is the "Settlement Anchors" system the master prompt asks for, already partially specified in prose for Bands 1–4.
- **A Lusaran mystery layer** — ancient ruins/breadcrumbs seeded per zone (inland lighthouse in Alvora, impossible well in Fonteira, waymarkers in Valedouro, an engineered chamber in Serravela...) that the POI/ruins output should be able to place.
- **A Portuguese/Iberian-maritime naming register**, explicitly *not* generic fantasy — already exemplified by every zone and creature name in the bible.

## 6. Open questions / decisions I'm making by default rather than blocking on

You said to ask if I had questions, but also that you were about to sleep and wanted me to just start — so where a default is reasonable and reversible, I'm taking it and noting it here rather than waiting:

- **Tech stack**: TypeScript throughout — an engine-independent `packages/generator` (pure TS/Node, no rendering deps) and a `packages/viewer-threejs` (Vite + Three.js) that only *consumes* the generator's output files. This directly matches the master prompt's "generator shouldn't know its renderer" architecture and its explicit naming of Three.js for the inspection tool.
- **Determinism**: a single integer seed drives a splittable PRNG (e.g. a small xoshiro/mulberry32-style generator), with named sub-streams per subsystem (elevation, hydrology, biomes, resources, settlements) so that, say, changing settlement-placement logic later doesn't reshuffle the coastline.
- **World scale**: no numeric world size is given anywhere in the source material. I'm picking a working default (documented in the architecture doc) sized so that Valora and Seradia each read as a real subcontinent, not a level's worth of terrain, while keeping the first-pass heightmap resolution something a laptop can regenerate in seconds during iteration.
- **CSV ingestion**: the generator's resource/creature placement tables are hand-authored in `data/design/*.json` for the Alvora→Valedouro→Serravela slice, transcribed carefully (small, checked by hand, not blind base64) from the world bible's own prose (Section 21 "Band 1 Continental Design," Section "Zone-by-Zone Skinning Ecosystem") rather than from the CSVs I couldn't safely mirror. Extending this to all 16 zones and to the full CSV set is Phase 2 follow-up work, ideally done by a proper data-sync step rather than by hand.

## 7. What I'm doing next, unprompted

Per your instructions and the master prompt's own closing advice ("make Claude spend its first response on audit and architecture, not a terrain demo"): four architecture documents next (`01`–`04` in `docs/`), then repo scaffolding, then a real working generator for the validation corridor, then the Three.js viewer, committed and pushed incrementally so nothing is lost if the container recycles.
