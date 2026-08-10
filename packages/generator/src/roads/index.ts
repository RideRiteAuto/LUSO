// Stage 11 (docs/01 §11): roads & trade routes.
//
// Previously: a minimum spanning tree of straight lines between settlement
// anchors -- literally "draw a line, call it a road," with no relationship
// to the terrain it supposedly crosses. Kevin correctly called this out:
// a real road network has to decide whether it cuts through land, climbs a
// slope, or needs a bridge, and that decision has to come from an actual
// algorithm reading the terrain, not from connecting two points and hoping.
//
// This version keeps the MST for *topology* (which settlements should be
// connected at all -- still a reasonable network-design choice), but routes
// each edge with A* over a coarsened cost field derived from the real
// heightfield: steep slope is expensive (routes bend around cliffs instead
// of running straight through them), and crossing water is expensive-but-
// possible (a route only crosses where it's clearly the best option, e.g.
// a narrow ford, rather than wherever the straight line happened to fall).
// Every place a route's cost path actually crosses water is recorded as an
// explicit bridge point in the output, so a renderer has a real anchor to
// place a bridge asset at instead of pretending the road just walks on water.

import type { BridgePoint, ContinentId, HeightField, Road, SettlementAnchor, Vec2 } from "../types/index.js";

// --- MST for network topology (unchanged in spirit from the original version) ---

function dist2(a: Vec2, b: Vec2): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

function buildMstEdges(anchors: SettlementAnchor[]): [SettlementAnchor, SettlementAnchor][] {
  const nodes = anchors.filter((a) => a.tier <= 3); // skip the most minor anchors to avoid a tangled network
  if (nodes.length < 2) return [];

  const inTree = new Set<number>([0]);
  const edges: [SettlementAnchor, SettlementAnchor][] = [];

  while (inTree.size < nodes.length) {
    let bestFrom = -1;
    let bestTo = -1;
    let bestDist = Infinity;
    for (const i of inTree) {
      for (let j = 0; j < nodes.length; j++) {
        if (inTree.has(j)) continue;
        const d = dist2(nodes[i].position, nodes[j].position);
        if (d < bestDist) {
          bestDist = d;
          bestFrom = i;
          bestTo = j;
        }
      }
    }
    if (bestTo < 0) break;
    inTree.add(bestTo);
    edges.push([nodes[bestFrom], nodes[bestTo]]);
  }

  return edges;
}

// --- Terrain-aware A* routing ---

const ROUTING_RES = 128; // coarsened routing grid -- fast A*, still fine-grained enough at continent scale (~256m/cell at the current 32768m tile)
const SLOPE_PENALTY = 14; // higher = routes bend harder to avoid steep grades
const WATER_CROSSING_PENALTY = 45; // flat cost added per step while crossing water -- expensive but not forbidden, so a route only crosses where it's clearly worth it

interface RoutingField {
  res: number;
  elevationM: Float32Array;
  cellSizeM: number;
}

function buildRoutingField(height: HeightField, continentTileSize: number): RoutingField {
  const res = ROUTING_RES;
  const elevationM = new Float32Array(res * res);
  const step = height.width / res;
  for (let ry = 0; ry < res; ry++) {
    const sy = Math.min(height.height - 1, Math.round(ry * step));
    for (let rx = 0; rx < res; rx++) {
      const sx = Math.min(height.width - 1, Math.round(rx * step));
      elevationM[ry * res + rx] = height.data[sy * height.width + sx];
    }
  }
  return { res, elevationM, cellSizeM: continentTileSize / res };
}

class MinHeap {
  private items: { priority: number; index: number }[] = [];
  push(priority: number, index: number) {
    this.items.push({ priority, index });
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.items[parent].priority <= this.items[i].priority) break;
      [this.items[parent], this.items[i]] = [this.items[i], this.items[parent]];
      i = parent;
    }
  }
  pop(): number | undefined {
    if (this.items.length === 0) return undefined;
    const top = this.items[0];
    const last = this.items.pop()!;
    if (this.items.length > 0) {
      this.items[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = i * 2 + 2;
        let smallest = i;
        if (l < this.items.length && this.items[l].priority < this.items[smallest].priority) smallest = l;
        if (r < this.items.length && this.items[r].priority < this.items[smallest].priority) smallest = r;
        if (smallest === i) break;
        [this.items[smallest], this.items[i]] = [this.items[i], this.items[smallest]];
        i = smallest;
      }
    }
    return top.index;
  }
  get size() {
    return this.items.length;
  }
}

const NEIGHBORS_8: [number, number, number][] = [
  [-1, 0, 1], [1, 0, 1], [0, -1, 1], [0, 1, 1],
  [-1, -1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [1, 1, Math.SQRT2],
];

/** A* over the routing grid, cost-penalized by slope and water crossings. Returns grid indices along the path, or null if unreachable. */
function findRoute(field: RoutingField, startIdx: number, goalIdx: number): number[] | null {
  const { res, elevationM, cellSizeM } = field;
  const n = res * res;
  const gScore = new Float64Array(n).fill(Infinity);
  const cameFrom = new Int32Array(n).fill(-1);
  const visited = new Uint8Array(n);
  gScore[startIdx] = 0;

  const gx = goalIdx % res;
  const gy = Math.floor(goalIdx / res);
  const heuristic = (i: number) => {
    const x = i % res;
    const y = Math.floor(i / res);
    return Math.hypot(x - gx, y - gy) * cellSizeM;
  };

  const open = new MinHeap();
  open.push(heuristic(startIdx), startIdx);

  while (open.size > 0) {
    const current = open.pop()!;
    if (current === goalIdx) break;
    if (visited[current]) continue;
    visited[current] = 1;

    const cx = current % res;
    const cy = Math.floor(current / res);
    const elevA = elevationM[current];

    for (const [dx, dy, distFactor] of NEIGHBORS_8) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= res || ny >= res) continue;
      const next = ny * res + nx;
      if (visited[next]) continue;

      const stepDist = distFactor * cellSizeM;
      const elevB = elevationM[next];
      const slope = Math.abs(elevB - elevA) / stepDist;
      let cost = stepDist * (1 + Math.min(10, slope * SLOPE_PENALTY));
      if (elevB <= 0) cost += WATER_CROSSING_PENALTY * stepDist * 0.05;

      const tentativeG = gScore[current] + cost;
      if (tentativeG < gScore[next]) {
        gScore[next] = tentativeG;
        cameFrom[next] = current;
        open.push(tentativeG + heuristic(next), next);
      }
    }
  }

  if (gScore[goalIdx] === Infinity) return null;

  const path: number[] = [];
  let cur = goalIdx;
  while (cur !== -1) {
    path.push(cur);
    cur = cameFrom[cur];
  }
  path.reverse();
  return path;
}

function toUv(gridIdx: number, res: number): Vec2 {
  const x = gridIdx % res;
  const y = Math.floor(gridIdx / res);
  return [x / (res - 1), y / (res - 1)];
}

export function generateRoads(anchors: SettlementAnchor[], continent: ContinentId, height: HeightField, continentTileSize: number): Road[] {
  const edges = buildMstEdges(anchors);
  if (edges.length === 0) return [];

  const field = buildRoutingField(height, continentTileSize);
  const roads: Road[] = [];
  let roadCount = 0;
  let bridgeCount = 0;

  for (const [a, b] of edges) {
    const startIdx = Math.round(a.position[1] * (field.res - 1)) * field.res + Math.round(a.position[0] * (field.res - 1));
    const goalIdx = Math.round(b.position[1] * (field.res - 1)) * field.res + Math.round(b.position[0] * (field.res - 1));

    const routeIndices = findRoute(field, startIdx, goalIdx);
    // Fall back to a straight line if pathfinding somehow fails (shouldn't
    // happen on a fully-connected grid, but never silently drop a road).
    const path: Vec2[] = routeIndices ? routeIndices.map((i) => toUv(i, field.res)) : [a.position, b.position];

    // Walk the resolved path and record every contiguous water crossing as
    // an explicit bridge point (start = last dry cell before the water,
    // end = first dry cell after it) -- this is the "put a dot where the
    // bridge goes" anchor a renderer needs.
    const bridges: BridgePoint[] = [];
    const resolvedIndices: number[] = routeIndices ?? [];
    let waterRunStart = -1;
    for (let i = 0; i < resolvedIndices.length; i++) {
      const idx = resolvedIndices[i];
      const isWater = field.elevationM[idx] <= 0;
      if (isWater && waterRunStart === -1) {
        waterRunStart = Math.max(0, i - 1);
      } else if (!isWater && waterRunStart !== -1) {
        bridges.push({
          id: `${continent}-bridge-${bridgeCount++}`,
          start: toUv(resolvedIndices[waterRunStart], field.res),
          end: toUv(idx, field.res),
        });
        waterRunStart = -1;
      }
    }

    roads.push({
      id: `${continent}-road-${roadCount++}`,
      kind: a.tier <= 2 && b.tier <= 2 ? "road" : "trail",
      path,
      connects: [a.id, b.id],
      bridges,
    });
  }

  return roads;
}
