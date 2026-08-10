# Nevora Civilization Map

Defines continents, kingdoms, the 16 launch zones, and the settlement/naming rules the generator's Settlement and Naming stages implement. Source: world bible v11, Sections 10, 13–27.

## 1. World context (canonical, locked)

| Concept | Name |
|---|---|
| World | Navora |
| Western continent | Valora |
| Western faction | the Valorin Crown |
| Eastern continent | Seradia |
| Eastern faction | the Seradian Concord |
| Central ocean | the Luna Sea |
| Mysterious central waters | the Bruma |
| Ancient vanished civilization/homeland | Lusara |
| High-level emerald region | Verdelume |
| Legendary Lusaran figure | Sebastião the Last Navigator (working title) |

Valora and Seradia are **progression-equivalent, not mirrored**. Same mechanical role per band (same resource tiers available, same rough danger curve), different geography, culture, architecture, and creatures. Valora reads as vertical/rugged/ocean-facing (fjords, mountain passes, deep harbors); Seradia reads as broad/river-driven (deltas, plateaus, plains). The generator must therefore run two distinct terrain "grammars" per continent, not one grammar with a palette swap — this is a load-bearing constraint, called out explicitly and repeatedly in the bible (Sections 6, 13, 17).

## 2. The 16 launch zones

Working target: 8 major progression zones per continent. Level ranges describe expected danger, not a hard access gate — low-level characters can physically enter high-level zones; the danger is enforced through mobs/hazards/gear requirements, not invisible walls.

| Band | Levels | Valora (proper / descriptor) | Seradia (proper / descriptor) |
|---|---|---|---|
| 1 | 1–15 | **Alvora** / The Crownlands | **Fonteira** / Firstwater Basin |
| 2 | 10–25 | **Valedouro** / Greenvale | **Riveira** / Reedwater |
| 3 | 20–35 | **Serravela** / The Greyspines | **Vermara** / The Redwater Steppe |
| 4 | 30–50 | **Cavora** / Stormbreak Coast | **Solmara** / Sunreach Delta |
| 5 | 45–60 | **Azurama** / Azurewood Reach | **Vidrala** / Glassmere Expanse |
| 6 | 55–75 | **Montemoura** / Elderwall Highlands | **Altavera** / The Skyplain |
| 7 | 70–90 | **Corvento** / The Tempest Crown | **Fendoura** / The Shattered Reach |
| 8 | 85–100 | **Lumevara** / Verdelume Vale | **Lumeira** / The Luminous Hollow |

**Proper names are the primary identifier everywhere in code and data** (`zones.json` uses `alvora`, not `crownlands`) — the bible is explicit that descriptors are legacy map-label flavor text, not IDs.

## 3. Per-zone civilization detail (Bands 1–4, fully specified in the bible)

The generator's settlement stage reads this directly for the validation corridor; Bands 5–8 have only ecology/creature detail today (see doc 04 §4) and get placeholder settlement anchors until a future design pass fleshes them out — the generator must not silently invent lore-contradicting cities for those bands.

### Band 1 — Alvora (Crownlands) / Fonteira (Firstwater Basin)
Shared purpose: teach explore→gather→craft→home→trade-pack→market loop. Low danger near settlements, rising at edges.
- **Alvora**: fertile coastal basin, forested hills, mountains of interior Valora visible in the distance. Stone roads, bridges, farms, mills, orchards, watchtowers, old villages, fishing settlements. Housing: agricultural heartland district, woodland district, coastal district (highest long-term value — maritime access). Signature trade good: Crownlands Provision Pack (food/agricultural). Threats: wolves, boars, bandits, highwaymen. Lore: ancient inland stone lighthouse.
- **Fonteira**: large navigable river + broad floodplain — reed beds, farms, irrigation channels, ferries, fishing settlements, wooded ridges. Transportation identity: road→river→ocean (vs. Alvora's road→coast→ocean). Housing: floodplain agricultural district, wooded upland district, riverfront district (highest value — cargo access). Signature trade good: Firstwater Harvest Pack. Threats: boars, bandits, river/marsh predators. Lore: an impossible well that never runs dry, sharing a geometric symbol with Alvora's lighthouse.

### Band 2 — Valedouro (Greenvale) / Riveira (Reedwater)
- **Valedouro**: inland valleys narrowing between wooded ridges; waterfalls, mills, sawyards, logging camps, hillside mines, stone bridges. Oak becomes signature structural timber, Ash along wet valley bottoms. Housing: river-valley farming, woodland homestead, mining settlement, river-road junction (merchant land). This is where the Basic Prefab House becomes available. Lore: ancient stone waymarkers pointing at nonsensical destinations.
- **Riveira**: Firstwater's channel network broadening into marshes, floodplain meadows, forested islands, reed beds, ferries, raised settlements. Ash-rich (vs. Valedouro's Oak-rich). Housing: floodplain farming, forested-island homestead, dry ridge settlement, canal-front (premium). Sailing Raft (Carpentry 15) and Basic Dock (Carpentry 20) unlock here — Seradia's water-logistics identity begins concretely. Lore: precisely-worked ancient stone dredged from channels.

### Band 3 — Serravela (The Greyspines) / Vermara (The Redwater Steppe)
- **Serravela**: rugged foothills/lower mountains — exposed dark stone, waterfalls, old quarries, fortified mining towns, narrow roads, strategic passes. Coal becomes the important new mineral. Housing includes highly strategic pass settlements (poor farmland, exceptional trade-chokepoint value). Carpentry 30 Cutter (first proper sailing vessel) milestone tied to a river/lake route reaching navigable water. Lore: miners expose an engineered chamber with a passage continuing deeper than the mine.
- **Vermara**: broad elevated grassland, red-rock escarpments, winding rivers, wooded gullies, huge skies — emphasizes distance/overland travel vs. Serravela's constrained passes. Housing: steppe farmsteads, river-gully properties, mining settlements, crossroads/river-crossing merchant land — wagon/caravan country. Lore: erosion exposes part of an enormous buried structure; first optional archaeology quest chain.

### Band 4 — Cavora (Stormbreak Coast) / Solmara (Sunreach Delta)
- **Cavora**: sharp descent from the Greyspines to a violent stretch of the Luna Sea — sea cliffs, deep natural harbors, wind-cut headlands, sheltered coves, coastal mines, shipyards, fishing towns, fortified ports. Valora's maritime identity becomes fully tangible; first genuinely impressive shipyard. Housing: sheltered coastal-valley farms, clifftop homesteads, harbor-edge merchant district (scarce/high value), inland shipwright/lumber district. Lore: a ruined Lusaran beacon oriented toward the Bruma, not shipping lanes.
- **Solmara**: enormous warm river delta meeting the ocean — distributaries, fertile islands, estuaries, cultivated levees, market towns, ship channels, major port complex. Payoff of Seradia's river→water-logistics arc. Housing: levee/island farms, canal homesteads, upland merchant district, estuary waterfront (premium). Lore: dredging exposes an enormous Lusaran stone ring beneath the delta.

## 4. Settlement generation rule (implements the master prompt's "Civilization Generation" section)

Civilization is **not** sprinkled onto finished wilderness — the pipeline places settlement anchors (stage 10, doc 01) before roads (stage 11), from three inputs:

1. **Water** — prefer river mouths, natural harbors, lake shores, protected bays; a Tier-1 "major port" anchor requires a protected bay *and* a trade-route intersection (see `poi.json` schema, doc 02 §8, which mirrors the master prompt's own example verbatim).
2. **Resources** — prefer proximity to mines/forests/farmland/fishing water/trade routes; mining-town housing districts trade farmland quality for extraction access, exactly as Valedouro's spec does.
3. **Defense** — castles/fortresses prefer mountain passes, river crossings, borders, chokepoints — Serravela's "highly strategic pass settlements" is the concrete precedent the algorithm generalizes from.

Anchor tiers (1 = most important) come from a weighted score over those three inputs plus the zone's band (higher-band zones bias toward smaller, more remote settlements per the bible's "Housing is optional [in Band 8] and should exist only where it supports the environment and lore").

## 5. Naming system

Portuguese/Iberian-maritime-inspired, never generic fantasy (explicitly: no "Shadowfang," "Darkmoor," "Stormhaven"). The bible already supplies the canonical zone names (Alvora, Valedouro, Serravela, Fonteira, Riveira, Vermara...) and this pattern is what the generator's name generator is fit to when it needs to invent minor-settlement or landmark names:

- Favor Portuguese/Iberian phonotactics: `-ora`, `-eira`, `-ela`, `-ura`, `-ança` endings; roots evoking sea, crown, stone, river (as in Alvora, Fonteira, Serravela, Vermara).
- The generator names **location, importance, and purpose first**; it should be able to run and produce a fully structured `poi.json` with `"name": null` on settlements, per the bible's own "Working-Name Policy" (Section 22) — final names are a deliberate, separate creative pass, not a blocking dependency for world generation. A name-generator module exists and is wired in, but is allowed to be the last thing turned on.
- Canonical names that already exist in the bible (all 16 zone proper names, Alvora/Serravela/etc.) are **never** overwritten by the generator, even if the naming module could produce something plausible-sounding — those are locked lore, not generated content.

## 6. Bands 5–8 status

Named and level-ranged in the canonical crosswalk (§2 above) with ecology detail for Skinning (doc 04 §4), but **no settlement/housing/trade prose exists yet** for Azurama, Vidrala, Montemoura, Altavera, Corvento, Fendoura, Lumevara, or Lumeira — the bible's own "Next Planned Pass" notes stop after Band 4. The generator still produces terrain and biomes for these zones (doc 04 covers their elevation/climate targets from the crosswalk + descriptor names), but settlement anchors there are placed generically (water/resource/defense scoring only, no bespoke housing-district lore) until a future design pass — this is called out in `zones.json` via an absent `housingDistricts` array rather than fabricated content, per the audit doc's stance on not inventing lore.
