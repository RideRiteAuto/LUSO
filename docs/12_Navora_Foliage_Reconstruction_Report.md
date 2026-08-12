# Navora foliage reconstruction report

Date: 2026-08-12  
Scope: Pine, birch, and provisional redberry review-yard models only. Runtime spawning remains disabled pending visual approval.

## Rejected implementation

The former foliage helper stretched a complete branch atlas over long intersecting planes attached directly to structural limbs. The pine source is a packed atlas containing cones, bare wood, and multiple sprigs, so sampling the whole image produced dark horizontal bands. Birch and redberry repeated the same branch-sized card at regular intervals, which produced bottle-brush trees and flat oval foliage masses.

## Reconstructed architecture

- Preserve trunk and primary boughs as structural geometry.
- Generate irregular secondary and tertiary twigs near the outer crown.
- Keep the inner crown partly open so light and sky break up the silhouette.
- Put foliage only on terminal growth: compact needle modules for pine and individual ovate leaf meshes for birch and redberry.
- Use deterministic pruning, size, roll, hue, and wind phase from the family seed.
- Merge each wood and foliage layer to retain two draws per model.
- Use alpha test/alpha-to-coverage for pine and opaque two-sided leaf geometry for birch/redberry.

## Reference-derived decisions

SpeedTree's current generator guidance favors proportional/bifurcating growth, variance, terminal extensions, and leaf meshes/cards with resolution-aware LOD. NVIDIA's production vegetation guidance separates broad plant bending from per-leaf detail phase and uses double-sided alpha-tested foliage for the quality/performance balance. Three.js recommends alpha test for sharp leaf cutouts and alpha-to-coverage to smooth cut edges with multisampling.

## Validation

- 17/17 viewer tests pass.
- Deterministic geometry and monotonic LOD reduction pass for all six resource families.
- Review yard: 18 variants, 61 draws, 230,999 scene triangles in the complete live inspector scene.
- Stationary live review: 60 FPS median, 30 FPS 1% low in the local WebGPU compatibility path.
- The single-file seed-48291 artifact was rebuilt after the visual pass.

## Remaining gate

This pass is ready for user silhouette/art-direction review, but the families must not be scattered into the world until approved. A later production pass should replace the procedural foliage color maps with a shared KTX2 color/normal/ORM set, move wind detail into the vertex shader, and validate LOD transitions in a crowded forest benchmark.
