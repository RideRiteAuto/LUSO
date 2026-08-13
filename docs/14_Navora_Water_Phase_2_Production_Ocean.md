# Navora water Phase 2 — production ocean renderer

Date: 2026-08-13
Authority: Navora Worldbuilding Bible v11 and the accepted architecture in `docs/13_Navora_Water_Production_Roadmap_and_Phase_1.md`.

## Delivered

- Replaced Three.js `WaterMesh` and its full-scene planar reflection render with a single-pass WebGPU node material.
- Added a 180 km+ camera-relative radial ocean grid. Compatibility mode spends its 12,800 triangles close to the viewer and stretches the same grid toward the fog horizon, avoiding an exposed rectangular plane edge.
- Moved the ocean continuously with the true camera position while retaining true-world wave phase. Recentring therefore cannot make waves or future buoyancy samples jump.
- Uses the same four deterministic wave coefficients for GPU displacement and CPU gameplay queries.
- Replaced repeated normal textures with three non-commensurate analytic capillary bands. Fine detail fades with distance to prevent horizon shimmer and moire.
- Added Schlick Fresnel, sky-color reflection, sun glitter, subdued crest scattering, and shallow/shelf/deep ocean coloration.
- Built a compact depth-band texture from the authoritative unified world heightfield. It creates the turquoise coastal shelf and transitions through blue water to the Luna Sea's deep tone without a second terrain query pass.
- Retained the Phase 1 river/query/swimming contract. Rivers remain the target of Phase 3 and do not yet claim final bank, foam, or navigation visuals.

## Performance architecture

The removed planar reflector rendered the visible world a second time before drawing the ocean. Phase 2 performs no reflection scene pass and adds one ocean draw. The compatibility grid has 6,561 vertices / 12,800 triangles; the balanced and high grids spend more vertices nearby but retain the same 180 km+ reach. Ocean depth coloration is a single 512×256 RGBA texture derived at load time.

In live WebGPU compatibility overview QA on the portable laptop:

- 60 FPS median;
- 59 FPS 1% low after warm-up;
- 16.8 ms p95 and 16.9 ms p99;
- 37 draws, 41,197 scene triangles, 36 geometries, 12 textures.

This is an inspector result rather than a full-game budget guarantee. Moving ground mode still includes terrain-streaming/dressing work that will continue to be profiled independently.

## Visual acceptance

- no planar-reflector seam or second-scene reflection block;
- no exposed ocean rectangle in world overview;
- depth-aware cyan shore shelf reads continuously around land;
- capillary detail no longer presents as a square texture tile and is distance-filtered at the horizon;
- ocean mesh and CPU water queries use the same deterministic wave constants;
- water stays readable under the current sky without becoming black or mirror-chrome.

## Validation

- Viewer test suite: 21/21 passing, including deterministic spectrum and radial-grid density/extent tests.
- Viewer production build passes.
- Live WebGPU browser render loaded without shader or console-visible failure.
- Phase 2 portable seed-48291 artifact rebuilt.

## Phase 3 entry gates

Phase 3 builds navigable rivers on top of the shared water contract:

- continuous spline/tessellated channels with stable joins;
- source-to-mouth width, depth, current, and navigation clearance;
- river-specific flow normals and surface motion;
- bank-aware geometry that does not float over or cut through terrain;
- river/ocean handoff suitable for estuaries in Phase 4;
- shared queries for swimmers, fish, NPC water navigation, and later boat pontoons.

The already locked post-water resource work remains unchanged: denser birch/redberry foliage in Phase 11, full conifer crown reconstruction in Phase 12, and watertight ore/stone meshes with exterior mineral signals in Phase 13.
