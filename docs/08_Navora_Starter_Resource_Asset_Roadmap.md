# Navora Starter-Resource Asset Roadmap

Status: Phase 1 implemented on 2026-08-12. This roadmap is subordinate to the v11
Worldbuilding Bible and deliberately separates gameplay resources from decorative
ground dressing.

## 1. Outcome

Build a reusable, browser-first production pipeline for gathering resources that:

- reads as recognizable reality before fantasy, following Bible v11's core rule;
- gives every resource a distinct silhouette and color/value signature at gameplay distance;
- supports natural variation without making a different material and draw call per instance;
- preserves stable frame pacing on integrated-GPU laptops;
- produces validated glTF/GLB assets with explicit LOD, texture, collision, scale, pivot,
  provenance, and interaction metadata;
- can later export the same authored source assets to a full game engine.

## 2. Starter-zone canon snapshot

Bible v11 Sections 21 and 24–25 define Band 1 as overlapping progression. Alvora
and Fonteira contain plentiful Stone and Copper Ore, accessible but less-abundant
Tin Ore, Pine and Birch, with Oak beginning only near more dangerous edges. Common
Foraging includes fibers, herbs, mushrooms, berries, and food/medicinal plants, but
the Bible explicitly says the complete Foraging progression is not finalized.

| Family | Status | Starter role | Visual identity |
|---|---|---|---|
| Pine | Canon, Woodcutting 1 | Primary starter timber | Reddish plated bark, irregular conical crown, deep-green needle masses |
| Birch | Canon, Woodcutting 5 | Secondary starter timber | Pale peeling bark, fine branching, airy light-green crown |
| Copper Ore | Canon, Mining 1 | Primary starter metal | Warm copper-orange seams with restrained green oxidation in gray-brown host rock |
| Tin Ore | Canon, Mining 5 | Less-abundant bronze partner | Cool charcoal/slate host rock with pale silver-gray mineral seams |
| Stone | Canon, Mining 1 | Foundational masonry | Region-matched weathered fieldstone with no ore-color signal |
| Redberry Bush | Provisional review name | Common berry/food forage candidate | Irregular woody bush, readable red clusters, natural leaves; not locked canon |
| Common herb/mushroom/fiber families | Canon category; exact items open | Starter Foraging support | Await the dedicated Foraging progression pass before names are locked |

Iron, Coal, Oak, and Ash remain visible in the broader pipeline but are not Phase 2
starter-review deliverables. They enter later bands per Bible v11.

## 3. Navora resource-art philosophy

### Recognizable reality

Use real species, geology, scale, growth patterns, fracture, weathering, and material
response as the base. Fantasy color or resonance effects may enhance later resources,
but must not replace readable natural structure.

### Silhouette first, texture second

An asset must be identifiable in a flat-color silhouette at its interaction distance.
Use albedo, normal, ORM, vertex variation, and decals for close detail; do not spend
geometry on detail that occupies less than a pixel. Avoid both voxel/block forms and
indiscriminate scan density.

### Families, not clones

Each gatherable family begins with three authored variants: young/small, standard,
and mature/large. Share one material/atlas and compatible LOD conventions. Permit
small deterministic scale, yaw, hue, roughness, and branch/rock-cluster variation.
Never use camera-relative randomness.

### Performance is an asset property

Every source asset ships with measured vertices, triangles, materials, texture memory,
screen-size LOD thresholds, collision proxy, and worst-case instances per cell. A pretty
asset that cannot meet its crowded-scene budget is unfinished.

## 4. Phase 1 budgets

These are starting gates for the integrated-GPU portable tier. They are adjusted only
from measured review scenes, not by intuition.

| Asset family | LOD0 triangles | LOD1 | LOD2 | Materials | Texture set | Runtime notes |
|---|---:|---:|---:|---:|---|---|
| Pine/Birch | 8k–14k | 2.5k–5k | 400–1.2k or impostor | 1 shared atlas | 2K KTX2 color + normal + packed ORM | Alpha-tested leaf clusters; wind bends foliage only; trunk collision capsule |
| Ore/Stone | 2.5k–6k | 700–1.8k | 120–400 | 1 shared geology atlas | 1K–2K KTX2 color + normal + packed ORM | Mineral identity uses seams/decals plus silhouette; convex collision hull |
| Berry/herb bush | 2k–5k | 600–1.5k | 150–400 or card | 1 shared forage atlas | 1K KTX2 color + normal + packed ORM | Alpha-tested foliage; berries preserved longer than leaf micro-detail |

Cross-family gates:

- GLB/glTF 2.0, meter scale, +Y up, grounded pivot, forward convention recorded;
- meshopt/quantized geometry where runtime support is verified;
- KTX2/Basis Universal GPU textures with mipmaps; alpha coverage preserved;
- no more than two runtime materials per family and one draw per mesh/material/LOD batch;
- deterministic instancing; no unique texture copies per variant;
- normals/tangents valid, no baked scene lighting, rough nonmetal host rock, metal response
  restricted to physically plausible ore surfaces;
- billboard/impostor transition hidden by distance haze and dither/crossfade when supported.

## 5. Phased delivery

### Phase 1 — foundation (implemented)

- canon/provisional starter catalog and art philosophy;
- measurable geometry, texture, LOD, collision, and batching budgets;
- reusable `navora-resource-modeler` Codex skill and manifest validator;
- shorter portable walking horizon: 12 km terrain bubble with atmospheric fade from
  4.5–13.5 km, while Balanced/High and flight/overview retain larger inspection ranges;
- deterministic Alvora resource-review-yard bookmark and toggle framework, ready to
  receive Phase 2 assets without mixing them into natural resource spawning.

### Phase 2 — first review families

- author three Pine variants, three Copper Ore variants, three Tin Ore variants, and
  three provisional Redberry Bush variants;
- build LOD0/LOD1/LOD2, shared material sets, pivots, collision proxies, and manifests;
- place all variants with scale markers in the Alvora review yard;
- capture near, interaction-distance, and far review images; record GPU/frame telemetry;
- accept, revise, or reject each family before any procedural spawning.

### Phase 3 — complete starter set

- author Birch and Stone families;
- lock the starter Foraging list with the design source of truth, then author the approved
  herb, mushroom, fiber, and additional food/medicinal families;
- expand atlas families only when texture resolution and material identity require it.

### Phase 4 — gameplay/resource runtime

- deterministic resource placement driven by zone, biome, slope, elevation, roads,
  settlements, housing reservations, and minimum spacing;
- interaction IDs, harvesting requirements, collision, depletion/regrowth states, and
  server-authoritative placement contract;
- sector instancing, LOD/impostors, occlusion/frustum rejection, asynchronous admission,
  and stable placement across streaming boundaries.

### Phase 5 — starter ecology and optimization gate

- populate Alvora and Fonteira with distinct but progression-equivalent ecologies;
- tune clusters, negative space, age/size distribution, landmarks, and anti-repetition;
- test integrated-GPU, mainstream dedicated-GPU, and high-tier profiles;
- shipping target: stable 30 FPS minimum on the agreed integrated-GPU target and 60 FPS
  on the mainstream target in the populated starter review route, with frame-time tails
  reported alongside average FPS.

## 6. Reference and licensing policy

Use online assets as references or source masters only when the license is compatible and
recorded. CC0 sources such as Poly Haven are preferred. The Poly Haven Pine Tree 01 scan is
a useful proportion, bark, branch, and needle reference, but its roughly 17 million source
triangles are not a runtime budget. Retopologize or author purpose-built meshes and preserve
source URL, author, license, hashes, acquisition date, and transformation history.

The delivery stack follows Khronos glTF guidance: glTF/GLB for runtime delivery,
`KHR_texture_basisu`/KTX2 for GPU texture compression, geometry quantization/meshopt where
supported, and GPU instancing for repeated assets. Three.js `InstancedMesh` is the current
viewer batching primitive; resource-family manifests keep the pipeline engine-independent.

## 7. Phase gates

Do not advance a family from review yard to spawning until it passes:

1. Bible/design-source classification: canon, working, or provisional is explicit.
2. Silhouette: identifiable without texture at interaction distance.
3. Material: plausible roughness/metalness and no plastic shine or baked lighting.
4. Variation: three variants remain related but visibly non-identical.
5. Technical validation: scale, pivot, normals/tangents, bounds, LOD ordering, textures,
   collision, manifest, license, and hashes pass automatically.
6. Performance: crowded reference scene remains within draw, triangle, texture-memory,
   streaming, p95, and p99 budgets on the target laptop.
7. In-engine approval: the review yard passes the user's scale, readability, and style review.
