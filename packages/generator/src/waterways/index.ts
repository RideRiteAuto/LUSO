// Navigable trade waterways (docs/20). These are authored infrastructure,
// like roads: data/design/waterways.json names the corridors and ports, this
// stage routes each corridor along real low ground and carves its channel bed
// below sea level. The global ocean then fills every channel, which is what
// makes them navigable — one flat water surface from the sea to every port,
// no waterfalls, no steps, exactly the pattern shipped naval games use.
//
// This runs BEFORE hydrology on purpose: carved channels read as ocean to the
// shoreline-seeded priority flood, so scenic rivers resolve their drainage
// into the waterways and the two water classes meet seamlessly.

import type { ContinentId, HeightField, NavigableWaterway, Vec2, WaterwayDesign } from "../types/index.js";

class MinHeap {
  private values: { index: number; priority: number }[] = [];
  get size(): number { return this.values.length; }
  push(index: number, priority: number): void {
    const item = { index, priority };
    this.values.push(item);
    let child = this.values.length - 1;
    while (child > 0) {
      const parent = Math.floor((child - 1) / 2);
      if (this.values[parent].priority <= priority) break;
      this.values[child] = this.values[parent];
      child = parent;
    }
    this.values[child] = item;
  }
  pop(): { index: number; priority: number } {
    const root = this.values[0];
    const tail = this.values.pop()!;
    if (this.values.length) {
      let parent = 0;
      for (;;) {
        const left = parent * 2 + 1, right = left + 1;
        if (left >= this.values.length) break;
        let child = left;
        if (right < this.values.length && this.values[right].priority < this.values[left].priority) child = right;
        if (this.values[child].priority >= tail.priority) break;
        this.values[parent] = this.values[child];
        parent = child;
      }
      this.values[parent] = tail;
    }
    return root;
  }
}

const NEIGHBORS: [number, number, number][] = [
  [-1, -1, Math.SQRT2], [0, -1, 1], [1, -1, Math.SQRT2],
  [-1, 0, 1], [1, 0, 1],
  [-1, 1, Math.SQRT2], [0, 1, 1], [1, 1, Math.SQRT2],
];

/**
 * Terrain preference for routing. Existing water is cheapest, low coastal
 * ground is cheap, and cost grows quadratically with elevation so a corridor
 * crosses a short 30 m rise only when no valley detour exists — the routed
 * channel then reads as a river cut, not a canal blasted through a ridge.
 */
function cellCost(elevation: number): number {
  if (elevation <= -8) return 0.55;
  if (elevation <= 0.5) return 0.7;
  const rise = elevation / 8;
  return 1 + rise * rise;
}

function routeLowGround(
  height: HeightField, from: number, to: number, penalty: Float32Array | null,
): number[] | null {
  const { width, height: fieldHeight, data } = height;
  const count = width * fieldHeight;
  const dist = new Float64Array(count).fill(Infinity);
  const previous = new Int32Array(count).fill(-1);
  const done = new Uint8Array(count);
  const heap = new MinHeap();
  dist[from] = 0;
  heap.push(from, 0);
  while (heap.size) {
    const current = heap.pop();
    if (done[current.index]) continue;
    done[current.index] = 1;
    if (current.index === to) break;
    const x = current.index % width, y = Math.floor(current.index / width);
    for (const [dx, dy, stepLength] of NEIGHBORS) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= fieldHeight) continue;
      const neighbor = ny * width + nx;
      if (done[neighbor]) continue;
      const candidate = dist[current.index]
        + stepLength * (cellCost(data[neighbor]) + (penalty ? penalty[neighbor] : 0));
      if (candidate < dist[neighbor]) {
        dist[neighbor] = candidate;
        previous[neighbor] = current.index;
        heap.push(neighbor, candidate);
      }
    }
  }
  if (!Number.isFinite(dist[to])) return null;
  const path: number[] = [];
  for (let cell = to; cell >= 0; cell = previous[cell]) path.push(cell);
  path.reverse();
  return path;
}

/**
 * Routing penalty around zone anchors.
 *
 * A channel bed sits below sea level, so a route through a zone's anchor
 * drowns the zone's centre — settlements, roads and the anchor-on-land
 * invariant with it. That actually happened: on the reshaped terrain the
 * Reedwater Run's cheapest corridor to Solmara's port ran straight across
 * Solmara's anchor. The penalty is steep enough that a detour is always
 * preferred where one exists, but finite, because ports legitimately sit
 * near the zones they serve — a route that must enter the bubble's rim to
 * reach its terminal still can, paying for every cell.
 */
function buildAnchorPenalty(
  width: number, fieldHeight: number, zoneAnchorsUv: Vec2[],
): Float32Array | null {
  if (!zoneAnchorsUv.length) return null;
  const CORE_UV = 0.016, RIM_UV = 0.05, WEIGHT = 30;
  const penalty = new Float32Array(width * fieldHeight);
  for (let y = 0; y < fieldHeight; y++) {
    const v = y / Math.max(1, fieldHeight - 1);
    for (let x = 0; x < width; x++) {
      const u = x / Math.max(1, width - 1);
      let nearest = Infinity;
      for (const [au, av] of zoneAnchorsUv) nearest = Math.min(nearest, Math.hypot(u - au, v - av));
      if (nearest < RIM_UV) {
        penalty[y * width + x] = WEIGHT * (1 - smoothstep01((nearest - CORE_UV) / (RIM_UV - CORE_UV)));
      }
    }
  }
  return penalty;
}

function simplifyPath(points: Vec2[], toleranceUv: number): Vec2[] {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1; keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop()!;
    const [ax, ay] = points[start], [bx, by] = points[end];
    let worst = -1, worstDistance = toleranceUv;
    for (let i = start + 1; i < end; i++) {
      const [px, py] = points[i];
      const dx = bx - ax, dy = by - ay;
      const lengthSq = dx * dx + dy * dy;
      const t = lengthSq > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq)) : 0;
      const distance = Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
      if (distance > worstDistance) { worstDistance = distance; worst = i; }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([start, worst], [worst, end]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

function chaikinSmooth(points: Vec2[], iterations: number): Vec2[] {
  let current = points;
  for (let iteration = 0; iteration < iterations && current.length > 2; iteration++) {
    const next: Vec2[] = [current[0]];
    for (let i = 0; i < current.length - 1; i++) {
      const a = current[i], b = current[i + 1];
      next.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      next.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    next.push(current[current.length - 1]);
    current = next;
  }
  return current;
}

function smoothstep01(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return clamped * clamped * (3 - 2 * clamped);
}

function closestPointOnSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): { t: number; distance: number } {
  const dx = bx - ax, dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq)) : 0;
  return { t, distance: Math.hypot(px - (ax + dx * t), py - (ay + dy * t)) };
}

/**
 * Cuts one channel cross-section along a routed path: a flat bed at
 * -bedDepthM, easing up to a ~2 m-deep waterline shelf at the channel edge,
 * then bank slopes that blend back into untouched terrain. Strictly a
 * min-blend — existing bays and ocean stay as deep as they already are.
 */
function carveChannel(
  height: HeightField,
  pathUv: Vec2[],
  continentTileSize: number,
  surfaceWidthM: number,
  bedDepthM: number,
  bankWidthM: number,
  channelMask?: Uint8Array,
): void {
  const { width, height: fieldHeight, data } = height;
  const metersPerCellX = continentTileSize / Math.max(1, width - 1);
  const metersPerCellY = continentTileSize / Math.max(1, fieldHeight - 1);
  // Cell-size floor keeps the channel raster-connected in reduced-resolution
  // test fixtures; at production resolution (<=64 m cells) the authored width
  // always wins.
  const halfWidth = Math.max(surfaceWidthM / 2, Math.min(metersPerCellX, metersPerCellY) * 0.75);
  const bedHalf = halfWidth * 0.55;
  const WATERLINE_DEPTH_M = 2.2;
  for (let segment = 0; segment < pathUv.length - 1; segment++) {
    const ax = pathUv[segment][0] * continentTileSize, ay = pathUv[segment][1] * continentTileSize;
    const bx = pathUv[segment + 1][0] * continentTileSize, by = pathUv[segment + 1][1] * continentTileSize;
    // Bank width grows with cut depth so a corridor crossing higher ground
    // opens into a valley profile instead of a vertical-walled trench.
    const outerReach = halfWidth + Math.max(bankWidthM, 260);
    const minX = Math.max(0, Math.floor((Math.min(ax, bx) - outerReach) / metersPerCellX));
    const maxX = Math.min(width - 1, Math.ceil((Math.max(ax, bx) + outerReach) / metersPerCellX));
    const minY = Math.max(0, Math.floor((Math.min(ay, by) - outerReach) / metersPerCellY));
    const maxY = Math.min(fieldHeight - 1, Math.ceil((Math.max(ay, by) + outerReach) / metersPerCellY));
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const hit = closestPointOnSegment(x * metersPerCellX, y * metersPerCellY, ax, ay, bx, by);
      const index = y * width + x;
      const terrain = data[index];
      const effectiveBank = Math.max(bankWidthM, Math.max(0, terrain) * 1.6, Math.min(metersPerCellX, metersPerCellY) * 1.2);
      if (hit.distance > halfWidth + effectiveBank) continue;
      let target: number;
      if (hit.distance <= bedHalf) {
        target = -bedDepthM;
      } else if (hit.distance <= halfWidth) {
        const eased = smoothstep01((hit.distance - bedHalf) / Math.max(1, halfWidth - bedHalf));
        target = -bedDepthM + (bedDepthM - WATERLINE_DEPTH_M) * eased;
      } else {
        const eased = smoothstep01((hit.distance - halfWidth) / effectiveBank);
        target = -WATERLINE_DEPTH_M + (terrain + WATERLINE_DEPTH_M) * eased;
      }
      if (target < data[index]) data[index] = target;
      if (channelMask && hit.distance <= halfWidth) channelMask[index] = 1;
    }
  }
}

export interface WaterwayResult {
  waterways: NavigableWaterway[];
  /** grid-resolution mask (1 = inside a navigable channel's surface width). */
  channelMask: Uint8Array;
}

/**
 * Routes and carves every authored waterway network for one continent.
 * Mutates the heightfield; returns the routed geometry for export, rendering,
 * gameplay, and the navigability test gate.
 */
export function carveNavigableWaterways(
  height: HeightField,
  continent: ContinentId,
  design: WaterwayDesign,
  continentTileSize: number,
  zoneAnchorsUv: Vec2[] = [],
): WaterwayResult {
  const { width, height: fieldHeight } = height;
  const channelMask = new Uint8Array(width * fieldHeight);
  const anchorPenalty = buildAnchorPenalty(width, fieldHeight, zoneAnchorsUv);
  const waterways: NavigableWaterway[] = [];
  const toCell = (uv: Vec2): number => {
    const x = Math.max(0, Math.min(width - 1, Math.round(uv[0] * (width - 1))));
    const y = Math.max(0, Math.min(fieldHeight - 1, Math.round(uv[1] * (fieldHeight - 1))));
    return y * width + x;
  };
  const toUv = (cell: number): Vec2 => [
    (cell % width) / Math.max(1, width - 1),
    Math.floor(cell / width) / Math.max(1, fieldHeight - 1),
  ];

  for (const network of design.networks) {
    if (network.continent !== continent) continue;
    const channelClass = design.channelClasses[network.class];
    if (!channelClass) throw new Error(`waterways.json network ${network.id} references unknown channel class ${network.class}`);
    const nodesById = new Map(network.nodes.map((node) => [node.id, node]));
    const routedCells: number[] = [];
    for (const [fromId, toId] of network.edges) {
      const from = nodesById.get(fromId), to = nodesById.get(toId);
      if (!from || !to) throw new Error(`waterways.json network ${network.id} edge references unknown node ${fromId} or ${toId}`);
      const legCells = routeLowGround(height, toCell(from.uv), toCell(to.uv), anchorPenalty);
      if (!legCells) throw new Error(`waterway ${network.id} could not route ${fromId} -> ${toId}`);
      // Consecutive legs share their junction node; skip the duplicate cell.
      routedCells.push(...(routedCells.length ? legCells.slice(1) : legCells));
    }
    const cellSizeUv = 1 / Math.max(1, width - 1);
    const simplified = simplifyPath(routedCells.map(toUv), cellSizeUv * 1.5);
    const smoothed = chaikinSmooth(simplified, 2);
    carveChannel(
      height, smoothed, continentTileSize,
      channelClass.surfaceWidthM, channelClass.bedDepthM, channelClass.bankWidthM,
      channelMask,
    );
    waterways.push({
      id: network.id,
      name: network.name,
      class: network.class,
      surfaceWidthM: channelClass.surfaceWidthM,
      bedDepthM: channelClass.bedDepthM,
      bankWidthM: channelClass.bankWidthM,
      path: smoothed,
      ports: network.nodes
        .filter((node) => node.kind === "port")
        .map((node) => ({
          id: node.id,
          name: node.name ?? node.id,
          uv: node.uv,
          headOfNavigation: node.headOfNavigation === true,
        })),
    });
  }
  return { waterways, channelMask };
}
