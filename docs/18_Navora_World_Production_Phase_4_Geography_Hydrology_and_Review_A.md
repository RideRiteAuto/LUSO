# Phase 4 geography, hydrology, and Review A

Status: first review rejected; corrective implementation complete; awaiting revised Review A approval.
Branch: `codex/world-production-completion`
Canonical review seed: `48291`

## Approval decision

Review A is the gate between terrain truth and natural-world dressing. Approve
the landform, material language, and environmental truth shown here before
Phase 5 adds vegetation and resources that could hide terrain defects. No Phase
5 work has started.

The original evidence is in [`artifacts/phase4-review-a/`](artifacts/phase4-review-a/README.md).
The five-location corrective evidence is in
[`artifacts/phase4-review-a-revision/`](artifacts/phase4-review-a-revision/README.md).

## Rejection corrections

- River paths now carve resolved beds and sloped banks into both the local and
  unified authoritative heightfields before export. They are not merely blue
  meshes laid over unmodified terrain.
- Physical river profiles are 24–150 m for ordinary trunks, 32–210 m at
  estuaries, and up to 260 m at deltas, with 1.8–12 m authored depths. A 30 m
  surface width is the runtime craft-navigation threshold.
- Tributaries terminate at an existing downstream river identity instead of
  re-exporting and rendering the shared trunk once per source. Delta branches
  receive a narrower physical profile than the main channel.
- Compatibility and balanced materials sample compiler control fields per
  fragment in world space. Near physical scans fade into stable material
  averages before becoming sub-pixel, and adjacent zone recipes receive a
  short categorical-safe feather.
- Streamed terrain tiles carry shallow edge skirts to conceal precision cracks
  at distant LOD boundaries. Strategic-altitude views do not render the
  near-water river strip through terrain too coarse to resolve its channel.
- The viewer accepts exact reproducibility cameras through `reviewX`,
  `reviewY`, `reviewZ`, `reviewYaw`, and `reviewPitch` URL parameters.

## What Phase 4 now guarantees

- The 65.5 km Valora and Seradia tiles keep distinct macro-geography while the
  65.5 km Luna Sea remains an authored gameplay distance.
- Ocean terrain transitions from roughly -1 m shore water through named
  shallows, shelf, slope, abyss, and trench bands. The Bruma has a deep-water
  shaping hook that cannot overwrite nearshore terrain.
- A shoreline-seeded priority flood gives every land cell a drainage route to
  open water. Rivers cannot terminate in unresolved terrain pits.
- Retained lakes are computed basins with a fill surface, lowest spill level,
  shoreline, depth, outlet, and explicit outlet river. Glassmere is authored as
  terrain and resolved by hydrology; it is not a decorative water disc.
- River surfaces descend monotonically. Mouths are classified as open coast,
  estuary, delta, lake inlet, or lake outlet. Solmara exposes one canonical
  delta with two distributaries under one watershed identity.
- River beds and banks are physically carved beneath those surfaces; profiles
  carry width, depth, and current values for visible water, swimming, fish,
  craft navigation, and future buoyancy to share.
- Beach, rocky coast, cliff, and estuary material selection uses slope,
  geology, exposure, wetness, and drainage compiler fields. The `Coast type`
  viewer mode makes the selection inspectable.
- Final housing suitability runs after roads, resources, and settlements. It
  rewards natural benches with access and rejects cliffs, swamp, severe flood
  risk, and high mountains without flattening terrain.
- Lakes render at their exact compiler surface with a small non-coplanar
  offset and no depth write. The reviewed shorelines show no z-fighting.

## Canonical output evidence

The final seed `48291` run generated a 3,584 × 1,536 world heightfield, 16
zones, 549 resources, 16 spawn regions, 38 settlements, and 36 roads.

| Measure | Valora | Seradia |
| --- | ---: | ---: |
| Land cells | 511,485 | 480,858 |
| Land coverage | 48.8% | 45.9% |
| Silhouette aspect | 1.182 | 0.779 |
| Peak elevation | 3,940.6 m | 3,366.0 m |
| Mean housing suitability | 0.287 | 0.356 |
| High-suitability cells | 50,846 | 69,976 |
| Rivers | 8 | 12 |
| Lakes | 0 | 2 |

Seradia's two retained basins are physically resolved:

| Feature | Surface | Maximum depth | Shore vertices |
| --- | ---: | ---: | ---: |
| `seradia-lake-0` | 264.4 m | 234.3 m | 17 |
| `seradia-lake-1` | 227.4 m | 226.4 m | 12 |

The world bathymetry reaches -4,280 m. Of 5,505,024 world samples, 72,504 are
navigable shallows, 278,425 shelf, 694,889 slope, 3,364,978 abyss, and 100,760
trench. The remainder is land.

## Verification gates

The phase is accepted technically when all of these remain green:

- generator test suite, including watershed/lake/bathymetry/housing contracts;
- viewer test suite;
- generator TypeScript build;
- production Vite viewer build;
- `git diff --check`;
- interactive WebGPU review with no browser console errors or warnings.

The clean Alvora review snapshot measured 86 FPS, 11.6 ms median frame time,
16.3 ms p95, 65 draws, and 160,411 triangles on the review machine. This is a
single visual-review snapshot, not a Phase 12 benchmark.

## Review A checklist

Inspect the linked evidence and, if desired, regenerate seed `48291` and use
the viewer bookmarks/debug modes. Confirm:

- Alvora's starter coast has a readable beach-to-inland transition and inland
  mountain presence;
- Valora and Seradia silhouettes do not read as the same procedural blob;
- valleys, river courses, mouths, estuaries, and Solmara's delta make sense;
- Glassmere reads as a lake in a terrain basin with a stable shoreline;
- beach/rock/cliff/estuary selections agree with the visible landform;
- housing suitability favors plausible corridors and avoids hazardous ground;
- the Luna Sea has usable shallows and credible deep structure;
- no shoreline z-fighting or ocean checker/Moiré pattern is visible.

## Deliberately deferred

This review approves world truth, not final water beauty. Distance-gated
near-water normals, Fresnel/glitter, breakers, wet-sand transitions, riverbank
presentation, and underwater optics belong to Phase 9. The current ocean uses
clean, mesh-resolvable long swells so Phase 4 terrain can be judged without the
former kilometre-scale checker/Moiré artifact.

Approval wording can be as simple as: **“Review A approved; proceed to Phase
5.”** Requested changes should identify the artifact or zone and the landform
or truth-field issue to revise.
