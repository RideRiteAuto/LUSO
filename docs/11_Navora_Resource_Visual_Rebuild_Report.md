# Starter Resource Visual Rebuild Report

Date: 2026-08-12  
Status: second visual-review candidate; natural spawning remains disabled.

## Rejection addressed

The first asset pass was rejected after in-engine screenshots showed opaque ellipsoid
foliage, evenly spaced roots with visible cut ends, highly faceted detached rock shells,
floating ore tubes, and insufficient material variation. This pass replaces those
structures instead of tuning their colors.

## Rebuild

- Pine uses branch-level photographic needle/twig cutouts from Poly Haven's CC0 Pine
  Tree 01 source, project-authored branch/trunk geometry, alpha-tested two-sided foliage,
  and a licensed photographic bark source.
- Birch and Redberry use many intersecting leaf-bearing twig sprays with punched
  negative space. Their canopies are open, irregular, and species-specific rather than
  solid green geometry.
- Roots use unequal angular gaps, lengths, radii, and buried endpoints. Each tree and
  bush carries a low irregular ground-blend skirt so its base has a soil/litter transition
  without altering the world terrain mesh.
- Stone and ore host rocks are each one coherent high-resolution body. Preserved smooth
  normals remove the accidental per-triangle faceting. Stone variants use warmer/cooler
  weathered values without ore signals.
- Copper and Tin use partially embedded mineral exposures rather than tubes or crystal
  hoops floating above host rock.
- Foliage wind uses deterministic per-variant phase with slow broad bending and a smaller
  secondary frequency. Wood, trunks, roots, and rocks remain fixed.
- Entering the review yard automatically hides unrelated decorative ground dressing,
  isolating both the visual and performance review.

## Optimization result

The asset builders preserve three decreasing LODs, stable deterministic output, grounded
pivots, and 1-2 materials per family. Review-yard resource geometry remains under the
automated 115k-triangle scene gate. In the live integrated-GPU review, the isolated yard
reported 60 FPS median, 58 FPS 1% low, 61 draw calls, and roughly 203k total visible
triangles including terrain and the full 18-variant exhibit.

The runtime retains alpha testing instead of sorted transparency. Natural-world placement
and mass instancing remain intentionally deferred until the user approves this second
visual candidate.

## Provenance

Pine Tree 01 twig diffuse, twig alpha, and bark diffuse at 1K were downloaded from
Poly Haven under CC0 1.0. Creators: Rico Cilliers and Rob Tuytel. Exact URLs, acquisition
time, byte counts, and SHA-256 hashes are stored in
`packages/viewer-threejs/public/assets/resource-textures/provenance.json`.
