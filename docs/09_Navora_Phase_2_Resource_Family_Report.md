# Phase 2 Starter Resource Family Report

Date: 2026-08-12  
Status: implemented as review candidates; visual approval and final KTX2 material bake remain open.

## Scope and source authority

This phase implements the Bible v11 starter families Pine, Copper Ore, and Tin Ore,
plus the explicitly provisional Redberry Bush working family. It does not promote
Redberry into canon and does not place any resource into natural spawn tables.

All geometry is original deterministic project code. Real-world pine proportions and
surface structure were studied from botanical photography and the CC0 Poly Haven Pine
Tree 01 scan; no external mesh or texture was copied into the runtime files. Ore forms
follow weathered host-rock fracture and exposed-seam geology rather than fantasy crystal
clusters. Accordingly, the manifests have no external-source provenance entries.

## Deliverables

- four reusable family builders with three primary silhouettes per family;
- LOD0, LOD1, and LOD2 for all 12 variants;
- 36 deterministic binary glTF 2.0 files and an export report;
- grounded pivots and embedded capsule/convex collision metadata;
- validated family manifests with Bible/canon status and material budgets;
- a fixed Alvora review exhibit, presented nearest-to-farthest as Redberry, Copper,
  Tin, and Pine so scale can be judged without a tree filling the arrival camera;
- automated triangle, material, determinism, layout, and grounding tests.

The review models use shared vertex-color PBR materials. This is intentionally recorded
as a review delivery stage instead of falsely claiming that KTX2 textures already exist.
Approved families advance to the shared KTX2 normal/ORM bake and wind-ready material
pass; rejected silhouettes can be revised without churning production textures.

## Measured budgets

| Family | LOD0 range | LOD1 range | LOD2 range | Materials |
|---|---:|---:|---:|---:|
| Pine | 9,900-13,452 | 3,560-4,160 | 440-520 | 1 |
| Copper | 2,608 | 764-944 | 224 | 2 (host + mineral) |
| Tin | 2,608 | 764-944 | 224 | 2 (host + mineral) |
| Redberry | 3,048-4,660 | 940-1,340 | 280-400 | 1 |

The full 12-variant LOD0 review exhibit is 62,928 triangles and 18 material draws before
viewer frustum culling. Runtime spawning will use instancing and distance LODs rather
than 12 standalone review objects.

## Acceptance state

Technical gates pass. Visual approval remains intentionally false in every manifest
until the user reviews scale, silhouette, ore readability, and the pine/redberry art
language in the inspector. Natural spawning remains blocked until that review.
