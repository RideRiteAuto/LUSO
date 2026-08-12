---
name: navora-resource-modeler
description: Design, author, optimize, validate, and integrate Navora gathering-resource 3D model families for browser and future engine runtimes. Use for trees, ores, stones, forage plants, fibers, herbs, mushrooms, resource variants, LODs, PBR/KTX2 materials, collision proxies, review-yard placement, performance budgets, or converting licensed reference/source models into Navora's realistic and efficient art language.
---

# Navora Resource Modeler

Build resource families as measurable runtime products, not isolated pretty meshes. Follow
Bible v11's recognizable-reality-first rule and preserve the classification of every item as
canon, working, or provisional.

## Required references

Read `references/art-direction.md` before visual design or source selection. Read
`references/technical-contract.md` before modeling, export, optimization, validation, or
integration. Treat the repository's `data/design/starter-resource-art.json` as the current
machine-readable scope and budget authority.

## Workflow

1. **Classify the resource.** Cite the Bible/design source and record `canon`, `working`, or
   `provisional`. Never promote a generic Bible category into a locked item name.
2. **Research reality.** Collect real biological/geological references and at least one gameplay-
   distance silhouette reference. Prefer authoritative botany/geology and CC0 art sources.
   Record source URL, creator, license, acquisition date, and hashes for downloaded sources.
3. **Write a family brief.** Define real-world identity, scale, interaction distance, silhouette,
   color/value signal, three variant roles, harvest/depleted states, collision, wind/animation,
   and worst-case crowded-scene count.
4. **Budget before authoring.** Choose the applicable tree, ore/stone, or forage budget from
   `references/technical-contract.md`. Explain any requested exception before building it.
5. **Author a reusable source.** Work in meters with +Y up and a grounded pivot. Keep geometry
   parts and materials semantically named. Prefer shared atlases, trim sheets, decals, vertex
   color, and normal detail over unique materials or invisible polygons.
6. **Create three variants.** Produce small/young, standard, and mature/large silhouettes. Share
   materials and compatible LOD structure while varying primary form—not just scale or yaw.
7. **Build LODs and collision.** Preserve silhouette, interaction signals, and berries/ore seams
   longer than micro-detail. Use simple trunk capsules or convex rock/bush hulls.
8. **Export and optimize.** Produce GLB/glTF 2.0. Apply mesh quantization/meshopt only when the
   target loader supports it. Use KTX2/Basis textures with mipmaps and alpha-coverage-aware
   compression for foliage.
9. **Write a manifest.** Start from `assets/resource-family-manifest.template.json`. Fill every
   field and run `scripts/validate_resource_family.py <manifest>`.
10. **Review in engine.** Place all variants and LODs in the Alvora Resource Review Yard. Inspect
    silhouette, scale, material, wind, transition behavior, collision, p95/p99 frame time, draw
    calls, triangles, textures, and streaming hitches. Do not procedurally spawn before approval.
11. **Publish intentionally.** Commit the source brief, runtime files, manifest, provenance,
    validation results, tests, and viewer integration as one reviewable phase.

## Quality decisions

- Favor believable shape and material response over gratuitous scan density.
- Make different resources recognizable by silhouette plus a plausible color/value signal.
- Keep host rock rough and nonmetal; restrict metallic response to exposed metal/mineral areas.
- Use alpha-tested foliage rather than blended transparency unless a measured need proves otherwise.
- Keep wind phase and bend amount deterministic per instance; do not move trunks or roots.
- Use stable world-seed variation. Never regenerate identity from camera position or current LOD.
- Reject sources whose license is missing, incompatible, or ambiguous.
- Reject an asset that passes average FPS but causes bad p95/p99 frame time or streaming stalls.

## Deliverables per family

- family brief and reference/provenance record;
- three authored variants with LOD0/LOD1/LOD2;
- shared PBR texture set and material contract;
- collision and interaction metadata;
- validated resource-family manifest;
- review-yard integration and screenshots;
- crowded-scene performance report;
- source and optimized runtime assets.
