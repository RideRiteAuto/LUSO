# Nevora scale, naval traversal, and QA

## Scale is a gameplay decision

The compiler keeps physical dimensions in `data/design/continents.json`.
The central sea must not be resized to improve a screenshot: choose its
width from ship speed, desired uninterrupted travel time, island density,
Bruma encounters, and port placement.

`crossing distance = ship speed × desired crossing duration`

The current 65,536 m open-water gap provides these direct-crossing examples:

| Ship pace | Approximate direct crossing |
| --- | ---: |
| 6 m/s (working vessel) | 3 h 2 min |
| 12 m/s (fast sailing vessel) | 1 h 31 min |
| 25 m/s (fantasy fast travel) | 44 min |

These are real-time values before route curvature, weather, encounters, and
island stops. Product approval is required before changing the gap. Islands
can convert a long empty crossing into several purposeful legs without making
the sea geographically small.

## Current geography contract

- Valora and Seradia use distinct authored macro grammars; seeds vary local
  coastline and relief without erasing continental identity.
- The authoritative heightfield includes a 25%-of-tile ocean safety margin.
  No positive elevation may reach its outer boundary.
- The renderer never propagates positive boundary elevation into its
  synthetic inspection margin. This keeps legacy outputs safe too.
- World coordinates are meters. Gameplay records retain continent-local UVs
  until the canonical-coordinate export migration is completed.

## Required seed QA

Automated checks currently cover:

- deterministic authoritative output for the same seed;
- meaningful terrain changes for different seeds;
- entirely underwater external world boundaries;
- unique resource cells; and
- creature-region exclusion distances from settlements.

Future QA should add silhouette similarity, coastline complexity, watershed
connectivity, road-grade limits, lake spill outlets, island counts, and direct
naval route metrics.

## Inspector diagnostics

The HUD reports camera position, camera/ground altitude, movement mode, and
speed. Rivers and lakes are independent layers. Wireframe is available from
the HUD. Existing URL diagnostics remain available for regression work:

- `?diagCoreSkirt=1`
- `?diagWireframe=1`
- `?diagForceUnderwater=1`

Walk mode uses bilinear ground sampling and searches for nearby valid land if
the selected orbit target lies in water.
