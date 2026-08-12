# Navora water production roadmap and Phase 1 report

Date: 2026-08-12  
Authority: Navora Worldbuilding Bible v11, especially the Luna Sea, Bruma, Firstwater/Riveira river-logistics identity, fishing, swimming, ships, and naval travel/combat requirements.

## Decision

Water is one gameplay service with several renderers, not a collection of decorative planes. Ocean rendering, river rendering, characters, fish, aquatic NPC navigation, multi-pontoon boat buoyancy, currents, wakes, projectiles, and server-side naval simulation must all query the same water-body records and deterministic surface functions.

The production architecture is hybrid:

- camera-relative tiled ocean geometry;
- a deterministic Gerstner spectrum for immediately queryable ocean height/normal/velocity;
- a WebGPU spectral FFT path reserved for higher sea states and graphics tiers after profiling;
- spline rivers carrying width, depth, surface elevation, flow velocity, and navigability;
- shallow-water attenuation and shoreline/bank transitions;
- localized GPU ripple/wake fields overlaid near actors instead of globally simulating the entire Luna Sea;
- CPU/server-compatible sampling for physics and authoritative gameplay.

This follows the same separation found in modern production water systems: unified water-body data and meshing; different ocean/river surface behavior; queryable depth/flow/waves; cheap pontoon buoyancy; and localized interactive fluid effects.

## Fourteen delivery phases

1. Unified water data and queries.
2. Production ocean rendering.
3. Navigable spline rivers.
4. Shorelines, breakers, banks, estuaries, and transitions.
5. Underwater rendering.
6. Ripples, swimmer disturbances, and wakes.
7. Swimming, fish, and aquatic NPC gameplay.
8. Multi-pontoon boat buoyancy and hydrodynamic forces.
9. Naval-combat splashes, wakes, storms, spray, and whitecaps.
10. Water performance/scalability QA and portable artifact delivery.
11. Birch/redberry 50–60% foliage-density review.
12. Full pine crown/needle-tier reconstruction.
13. Watertight ore/stone topology and exterior mineral-signal repair.
14. Final resource visual/performance approval.

## Phase 1 delivered

- Generator river records now carry source/mouth width, depth, current, and the point where the channel becomes boat-navigable.
- The viewer has a unified `NavoraWaterSystem` with deterministic ocean sampling and river-segment queries.
- Four physically parameterized ocean wave bands provide queryable surface height and normal.
- Procedural normal masters provide multi-frequency high-resolution ripple detail without external licensing risk.
- River ribbons share a material and carry source-to-mouth width/current behavior.
- Swimming queries the moving water surface and receives current advection instead of assuming a global flat `y=0` plane.
- The same query contract is ready for fish volumes, NPCs, buoyancy pontoons, wakes, and projectiles.
- Phase 1 intentionally does not claim final water art. Live review found visible provisional normal/reflection tiling near shore; eliminating that is a Phase 2 acceptance gate.

## Validation

- Viewer: 20/20 tests pass.
- Generator: 7/7 tests pass.
- Generator and viewer production builds pass.
- Seed 48291 regenerated at 1024 resolution with the new river metadata.
- Portable seed-48291 artifact rebuilt.
- Local WebGPU compatibility live check: 60 FPS median, roughly 29–30 FPS 1% low, no sustained streaming hitch during the stationary overview sample.

## Phase 2 acceptance gates

- no visible square/checker repetition from gameplay or coastal overview distances;
- no reflection seams or planar-reflector horizon blocks;
- ocean displacement and gameplay surface sampling stay within a documented tolerance;
- Fresnel, sun glitter, roughness, depth color, and foam remain readable without black water;
- compatibility tier stays within the established frame-pacing envelope;
- shore mesh never z-fights with the terrain or exposes the ocean rectangle edge.

## Post-water resource corrections already scheduled

- Birch and redberry: increase the existing terminal-leaf population by about 50–60%, preserving open species structure rather than returning to opaque foliage blobs.
- Pine: rebuild around full conical tier/whorl silhouettes with dense needle sprays and a readable Christmas-tree-like taper; density alone is insufficient.
- Ore/stone: enforce watertight coherent host meshes, eliminate cracks/open shells, project copper/tin identity geometry onto the final exterior surface, and test that mineral indicators remain visible from normal approach angles and through LOD1.
