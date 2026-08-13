# Navigable waterways and scenic rivers

Date: 2026-08-13
Branch: `claude/flora-water-system-fix-ipf86y`
Status: implemented; both water test gates green.

## Why the water system was rebuilt

An audit of the previous river system measured, across ~1,250 transects on
seed `48291`, that only **12.7%** of inland river length was contained by
ground on both sides. The remaining 87% hung above the landscape — a third of
it by more than 100 m — because river surfaces were copied from the
priority-flood *spill* surface (a staircase of flats that hovers over every
unemitted basin), the carve brush could only dig downward (never build a
containing bank), channels were authored at shipping scale (240–1,800 m)
regardless of terrain, and the centreline wandered up to ~170 m off the
drainage line. Four successive "carve the rivers" fixes failed because the
carving was aimed at those wrong numbers.

A second constraint drove the redesign: **boats must navigate rivers**
(fishing mid-channel while two ships pass). Research across shipped naval
games (ArcheAge, Black Desert, Valheim, AC Rogue, Sea of Thieves, GW2) found
that no shipped game sails a boat above sea level — navigable "rivers" are
always flat, sea-level arms of the ocean, and elevated water is scenic or
disconnected. Real shipping rivers behave the same way (lower Mississippi:
~10 cm of drop per km; Rhine fairway: 120 m wide).

The world therefore has **two kinds of river**, matching the worldbuilding
bible's own split (Seradia's lowland water-logistics arc vs. Valedouro's
"waterfalls and mills"):

## 1. Navigable waterways (`data/design/waterways.json` → `waterways/`)

Authored infrastructure, like roads. Each network names nodes (sea entries
and ports, continent-local uv) and edges; channel classes give the physical
cross-section (trunk: 120 m surface width, 11 m bed, 90 m banks — sized from
PIANC/Dutch-waterway two-way-plus-one-lane rules at ~15 m ship beam).

The generator:

- **routes** each edge along real low ground (Dijkstra over the heightfield;
  cost grows quadratically with elevation, existing water is cheapest), then
  simplifies (Douglas-Peucker) and smooths (Chaikin) the path;
- **carves** the channel bed to 11 m *below sea level* for its entire
  length — flat bed, ~2 m-deep waterline shelf at the edges, banks blending
  into terrain (widening automatically where the corridor cuts higher
  ground);
- runs **before hydrology**, so the shoreline-seeded priority flood treats
  channels as ocean and scenic rivers resolve their drainage into them.

Because the bed sits below 0, **the global ocean fills every channel**: one
flat, lock-free, wave-carrying navigable surface from the open sea to every
port, with no new water-rendering or buoyancy code. River identity (current,
flow ripples, banks) is presentation dressing along the spline.

Authored networks: Seradia's **Firstwater Passage** (west coast → Fonteira →
Riveira → Vermara head of navigation) and **Reedwater Run** (Riveira →
Solmara delta → south coast) per the bible's water-logistics arc; Valora's
**Alvora Reach** (east coast → Alvora → Valedouro Falls Landing). Where a
network ends inland it ends at a **head-of-navigation port** — the fall-line
pattern — and roads take over.

## 2. Scenic rivers (`hydrology/`)

Natural landscape water traced from the drainage network, deliberately not
ship-navigable (`profile.navigableFromT = 1`). The rework:

- **Surface hugs the terrain.** Along the traced path the water level now
  follows the carved ground. Terrain pits shallower than 5 m
  (`SCENIC_RIVER_RULES.breachDepthM`) are *breached* — the bed is carved
  through them; only genuine basins pool.
- **Basins become ponds.** Every pooling basin a river crosses is emitted as
  a real `Lake` of kind `pond` at its spill elevation with its true flooded
  shoreline (previously these components were discarded, leaving the river
  as a flat shelf over an empty hole — the worst hover cases in the audit).
- **Steep runs become waterfall nodes.** Where the surface must drop faster
  than `fallSlope` (≈12°), the river exports `falls[]` (position, drop)
  for waterfall rendering and navigation blocking.
- **Widths from flow.** Channel width grows with upstream flow accumulation
  (7–64 m, creek → trunk, modest mouth flare), exported per point as
  `widthProfileM[]`; depth follows width (1.3–4.6 m). No more 240 m minimum.
- **Carve *and raise*.** The channel brush digs the bed below the surface
  and raises a freeboard levee (1.2 m + width×0.015) wherever the bank sits
  below the water line, capped at +8 m, never raising ocean/waterway/lake
  cells. Raises are collected first and carves win, so a tributary's levee
  cannot dam its trunk.
- The decorative lateral-migration wobble is gone; the centreline stays on
  the drainage line.

## Runtime parity

`riverChannelField.ts` (main thread) and the terrain worker in
`terrainStreaming.ts` apply the identical brush over macro height + detail
noise; segments carry `[…, kind, bankWidth]` (kind 0 scenic, 1 waterway).
Collision, dressing placement, and rendered tiles therefore agree with the
compiled heightfield to sub-metre precision. Waterway corridors join rivers
and lakes as LOD refinement regions.

Water queries: waterway channels answer as ocean (ground < 0 ⇒ global
sea surface; navigable when ≥ 9 m deep). Scenic river reaches answer with
their authored sloped surface and are never navigable.

## Test gates (generator suite)

- **Containment** — river surfaces must stay within breach depth (+ tolerance)
  of the ground beside them; ≤5% of stations may exceed it. The pre-rework
  system fails this gate catastrophically.
- **Navigability** — every waterway must reach full authored bed depth along
  its path, and a BFS over submerged cells must float a boat from the sea
  end to every port (Valheim's too-shallow-river failure is exactly what
  this catches).

Schema additions (`waterways.json`): per-continent `waterways[]` (routed
path, ports, class dimensions); rivers gain `widthProfileM[]` and `falls[]`;
lakes gain kind `pond`. All additions are backward compatible.

## Deliberately deferred

- Waterway current force on hulls/swimmers (dressing exists; physics push is
  a one-line addition to the water query when boat gameplay lands).
- Waterfall meshes/foam and pond-edge rapids at the exported `falls[]` nodes.
- Painting water into the far-LOD terrain material so rivers stay visible
  above the 2.2 km presentation fade.
- Ports as settlement/POI anchors (the port records carry names and
  positions ready for the settlement pass).
