# Nevora Biome and Terrain Rules

Defines elevation rules, climate rules, texture rules, and ecology rules — the concrete inputs to pipeline stages 3, 5, 7, and 9 (doc 01). This is the document that keeps the generator from producing "generic procedural terrain" instead of Navora.

## 1. Elevation rules

Terrain must follow believable geography: mountains create watersheds, influence rivers and climate, and form natural borders (master prompt, "Terrain Generation Requirements"). Per-continent shape grammar (doc 03 §1):

- **Valora**: long coastlines, cliffs, green valleys, old forests, mountain ranges, rivers descending toward the Luna Sea, constrained agricultural basins. Elevation should read as *vertical* — the band progression is a literal climb: Alvora (coastal basin) → Valedouro (valleys narrowing between ridges) → Serravela (rugged foothills/lower mountains) → Cavora (sharp descent to sea cliffs) → Azurama (deep forest, "rain-fed") → Montemoura ("ancient highland interior, tablelands") → Corvento ("extreme alpine high country, cliffs, glacial lakes") → Lumevara ("protected luminous basin").
- **Seradia**: wide plains, large river systems, inland lakes, wetlands, plateaus. Elevation reads as *lateral distance*, not height — Fonteira (floodplain) → Riveira (channel/marsh delta) → Vermara ("broad elevated interior... enormous skies") → Solmara (delta, near sea level) → Vidrala ("great lakes, mineral springs") → Altavera ("high open plateau") → Fendoura ("fractured canyon frontier, mesas, fault valleys") → Lumeira ("collapsed luminous basin, canyon wetlands, terraces, caverns").
- A continuous mountain spine separates zone bands within each continent and doubles as the watershed divide that stage 4 (hydrology) drains from — this is not decorative; it is the mechanism that makes "mountains should create watersheds, influence rivers, create natural borders" literally true rather than aspirational.
- The Bruma (central Luna Sea waters between the continents) is elevation-wise entirely submarine/ocean, but flagged as a distinct **climate/magic anomaly region** (doc §3) even though it contributes no landmass in the launch footprint.

## 2. Biome table

Biome classification inputs: elevation, moisture, temperature, latitude, **zone override** (a zone can pin a biome identity the generic rule alone wouldn't produce — e.g. Azurama's "blue-green mineral-stained woodland" is a zone override on top of generic deep-forest classification).

| Biome ID | Elevation | Moisture | Temp | Notes / example zones |
|---|---|---|---|---|
| `ocean` | < 0 | — | — | Luna Sea, the Bruma |
| `beach` | 0–5m | — | — | coastal zone edges |
| `coastal-plain` | 5–60m | med–high | temperate | Alvora, Solmara |
| `floodplain` | 0–30m, near river | high | temperate–warm | Fonteira, Riveira, Solmara |
| `wetland-marsh` | 0–20m, high accumulation | very high | temperate | Riveira |
| `grassland-steppe` | 100–400m | low–med | temperate–dry | Vermara |
| `temperate-woodland` | 20–300m | med | temperate | Alvora, Fonteira |
| `river-valley-forest` | 100–500m | med–high | temperate | Valedouro |
| `wooded-highland` | 300–800m | med | temperate–cool | Riveira uplands, Vermara gullies |
| `rugged-foothill` | 400–900m | low–med | cool | Serravela |
| `mountain-forest` | 500–1200m | med | cool | Serravela, Cavora hinterland |
| `sea-cliff-coastal` | 0–300m, adjacent ocean, high slope | med | temperate | Cavora |
| `deep-forest-mineral` | 300–900m | high | cool–temperate | Azurama ("blue-green mineral-stained") |
| `great-lakes-country` | 100–500m | high (lacustrine) | temperate–cool | Vidrala |
| `ancient-highland-tableland` | 800–1600m | low–med | cool | Montemoura |
| `high-plateau-grassland` | 900–1700m | low | cool | Altavera |
| `alpine-extreme` | 1600m+ | low–med (glacial) | cold | Corvento |
| `canyon-mesa-frontier` | 400–1200m, fault-line noise | very low | dry–cool | Fendoura |
| `luminous-basin` | 200–700m, Verdelume-flagged | high, magical | temperate, resonant | Lumevara, Lumeira |
| `alpine-snow-rock` | 1800m+ | low | cold | mountain caps, all continents |

Rule of thumb from the master prompt, honored directly: high elevation → alpine/snow/rock; wet lowlands → wetlands/marsh; temperate mid-elevation → forest/grassland; dry → desert/scrubland (Navora's dry biome, `grassland-steppe`/`canyon-mesa-frontier`, leans arid-steppe rather than true desert, matching Vermara/Fendoura's actual descriptions rather than a generic desert biome that has no basis in the bible).

## 3. Climate & magical-intensity rules

Two extra scalar fields ride alongside temperature/moisture, both required by the bible's own material-magic system (Section 2–3):

- **Magical intensity** — near-zero across most of Bands 1–4, rising through Bands 5–7, and spiking in Verdelume-flagged zones (Lumevara, Lumeira, Band 8) and in isolated Lusaran-ruin hotspots (the Serravela chamber, the Solmara ring) regardless of band. This field gates resource tiers that require it (Cobalt Ore "where Lusaran/magical geology supports it," Pedral Deposit, Verdehide/Noitehide/Lumehide creature variants) and should visually justify Verdelume's "vivid emerald luminosity... ancient, living, uncanny" description (Section 3) rather than reusing a generic "magic biome" shader.
- **Danger/ecology maturity** — derived from band + distance from settlement, used by both the ecology stage (creature tier selection) and resource placement (elite/rare variant chance), not a separate noise field — it is a deterministic function of the zone/band data already resolved in stage 6.

## 4. Ecology rules (creature/spawn placement)

This is the master prompt's "Monster Ecology" section — Navora already has this fully authored for one profession (Skinning), which the generator should treat as ground truth rather than re-deriving generic ecology from scratch. Seven reusable creature-model families cover the entire 8-band, 16-zone launch ecology: **Cervid, Boar, Canid, Bear, Feline, Crocodilian, Grazer.** A creature's *hide-quality output*, not its species, tracks progression — the same family can yield a low-tier or high-tier material depending on the local zone/variant, which is an ecology rule, not a species-gating rule:

| Band | Valora creature (family) | Seradia creature (family) | Primary drop |
|---|---|---|---|
| 1 | Crown Deer (CERVID), Bravio Boar (BOAR) | Firstwater Caiman (CROCODILIAN), River Deer (CERVID) | Light/Coarse Hide |
| 2 | Douran Stag (CERVID), Vale Wolf (CANID) | Reed Caiman (CROCODILIAN), Marsh Boar (BOAR) | Supple Hide |
| 3 | Greyspine Elk (CERVID), Serra Bear (BEAR) | Redwater Grazer (GRAZER), Vermara Panther (FELINE) | Heavy/Thick Hide |
| 4 | Storm Bear (BEAR), Cliff Boar (BOAR) | Sunreach Caiman (CROCODILIAN), Delta Cat (FELINE) | Thick/Rugged Hide |
| 5 | Azure Stag (CERVID), Azul Panther (FELINE) | Glassmere Grazer (GRAZER), Glassmere Caiman (CROCODILIAN) | Rugged Hide / first Pratahide |
| 6 | Elderwall Bear (BEAR), Moura Stag (CERVID) | Skyplain Grazer (GRAZER), Alta Wolf (CANID) | Pratahide |
| 7 | Tempest Bear (BEAR), Corvento Wolf (CANID) | Canyon Panther (FELINE), Fendoura Grazer (GRAZER) | Brumahide / rare Verdehide |
| 8 | Lume Stag (CERVID), Verdant Panther (FELINE) | Luminous Caiman (CROCODILIAN), Hollow Grazer (GRAZER) | Verdehide/Noitehide / rare Lumehide |

Guardrails the generator must respect (from the bible's "Skinning Geography Guardrails"):
- Any creature family may appear in any band where local ecology supports it — do not hard-gate a family to one band (reptiles exist from Band 1, not just late-game).
- The same family can yield different hide qualities in different zones — this is intentional and must not be "fixed" into a rigid per-species ladder.
- Earlier-tier materials remain available in later zones via weaker local variants; new bands *add* opportunities, they don't retire old ones (same overlapping-progression principle as resources, doc 02 §4).
- Spawn regions must respect a minimum distance from settlement anchors (placed in stage 10, read by ecology in stage 9's *validation* pass — ecology runs before settlements in raw generation order but is checked against them once settlements exist, since settlements bias toward safe, already-cleared ground).

## 5. Texture/visual rules (for the viewer, not gameplay)

Slope- and biome-driven, purely for the Three.js inspection tool's terrain shader — no gameplay logic depends on this:

- Steep slope (> ~35°) → exposed rock, regardless of biome.
- Flat/moderate terrain → biome-appropriate grass/soil blend.
- High elevation (above each continent's local snowline, derived from temperature field, not a fixed altitude) → snow/alpine rock.
- Wet, low-accumulation-but-flooded areas (wetland/marsh biome) → mud/marsh blend.
- Luminous-basin biome → a distinct emerald/turquoise treatment reserved *only* for Verdelume-flagged terrain, so "this is Verdelume" reads unmistakably against every other biome, per the master prompt's "should visually communicate" requirement.

The viewer must be able to toggle between this slope-based shading and a flat biome-ID color map (the literal `biome_map.png` palette) — the latter is what doc 02 exports; the former is a viewer-side enhancement layered on top of it, keeping the generator itself opinion-free about final pixel color.
