# Browser-first resource asset contract

## Coordinate and delivery

- Author in meters, +Y up, pivot centered at the terrain contact footprint.
- Deliver GLB/glTF 2.0 with semantic node/mesh/material names.
- Use one shared atlas/material per family when possible; maximum two only with justification.
- Supply LOD0/LOD1/LOD2 and collision. Record screen/distance thresholds in the manifest.
- Use KTX2/Basis Universal textures with mipmaps for runtime; keep lossless/working masters outside
  runtime delivery. Use sRGB only for color; treat normal/ORM/alpha data as linear.
- Use mesh quantization/meshopt when supported and measured. Validate the final runtime file, not
  only the source model.

## Starting budgets

| Family | LOD0 tris | LOD1 tris | LOD2 tris | Textures |
|---|---:|---:|---:|---|
| Tree | 8,000–14,000 | 2,500–5,000 | 400–1,200 or impostor | Shared 2K color, normal, ORM |
| Ore/stone | 2,500–6,000 | 700–1,800 | 120–400 | Shared 1K–2K color, normal, ORM |
| Forage bush | 2,000–5,000 | 600–1,500 | 150–400 or card | Shared 1K color, normal, ORM |

## Runtime behavior

- Batch repeated mesh/material/LOD combinations with instancing.
- Derive deterministic scale, yaw, hue/roughness range, and wind phase from stable instance IDs.
- Transition LODs outside the interaction focus; use dither/crossfade or haze to hide swaps.
- Keep foliage alpha-tested and alpha-to-coverage where supported; avoid sorted blended leaves.
- Use a trunk capsule for trees and simple convex hulls for rock/bush interaction.
- Load families asynchronously and admit sectors incrementally. Never rebuild the whole bubble on a
  cell boundary.

## Validation gates

- correct scale/pivot/up-axis and finite bounds;
- three variants and three LOD entries per variant;
- monotonic triangle reduction and triangle budgets;
- material and texture-set budgets;
- collision and interaction metadata;
- license/provenance with cryptographic hashes for external sources;
- review-yard visual approval;
- crowded-scene draws, triangles, texture count/memory, stream cost, FPS, 1% low, p95, and p99.

Official delivery references: Khronos glTF/KTX guidance and Three.js `KTX2Loader` and
`InstancedMesh` documentation. Prefer primary documentation when updating this contract.
