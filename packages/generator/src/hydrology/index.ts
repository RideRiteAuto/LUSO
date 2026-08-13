// Stage 4 (docs/01 §4): depression-resolved hydrology.
//
// A shoreline-seeded priority flood establishes a drainage parent for every
// land cell. Unlike raw D8 steepest descent, this resolves flats and pits to
// their lowest spill saddle, so a traced river either reaches an authored
// lake or the ocean. Basins are emitted only after fill depth, area, spill,
// outlet, and shoreline have all been calculated.

import type { HeightField, Lake, River, ScalarField, Vec2, WaterData } from "../types/index.js";

const NEIGHBORS: [number, number][] = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
];

const idx = (x: number, y: number, width: number): number => y * width + x;

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
      while (true) {
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

interface BasinRecord {
  lake: Lake;
  cells: number[];
  outletIndex: number;
}

export interface HydrologyResult {
  water: WaterData;
  /** grid-resolution mask (1 = part of a traced river path). */
  riverCellMask: Uint8Array;
  /** grid-resolution mask (1 = compiler-resolved lake water). */
  lakeCellMask: Uint8Array;
  /** Log-normalized upstream flow accumulation. */
  drainage: ScalarField;
}

function convexHull(points: Vec2[]): Vec2[] {
  if (points.length <= 3) return points;
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Vec2, a: Vec2, b: Vec2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Vec2[] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper: Vec2[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const point = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

function buildPriorityDrainage(height: HeightField): {
  flowTo: Int32Array;
  filled: Float32Array;
  visitOrder: number[];
} {
  const { width, height: fieldHeight, data } = height;
  const count = width * fieldHeight;
  const flowTo = new Int32Array(count).fill(-1);
  const filled = data.slice();
  const seen = new Uint8Array(count);
  const heap = new MinHeap();

  // Only ocean cells touching land need to seed the flood. This has the same
  // drainage result as queueing the whole ocean while avoiding a huge heap.
  for (let y = 0; y < fieldHeight; y++) for (let x = 0; x < width; x++) {
    const index = idx(x, y, width);
    if (data[index] > 0) continue;
    let touchesLand = false;
    for (const [dx, dy] of NEIGHBORS) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < width && ny < fieldHeight && data[idx(nx, ny, width)] > 0) {
        touchesLand = true;
        break;
      }
    }
    if (touchesLand) {
      seen[index] = 1;
      heap.push(index, data[index]);
    }
  }

  // Defensive fallback for a cropped all-land test field: its boundary is
  // the only available outlet and is treated as external drainage.
  if (!heap.size) {
    for (let x = 0; x < width; x++) for (const y of [0, fieldHeight - 1]) {
      const index = idx(x, y, width);
      if (!seen[index]) { seen[index] = 1; heap.push(index, data[index]); }
    }
    for (let y = 1; y < fieldHeight - 1; y++) for (const x of [0, width - 1]) {
      const index = idx(x, y, width);
      if (!seen[index]) { seen[index] = 1; heap.push(index, data[index]); }
    }
  }

  const visitOrder: number[] = [];
  while (heap.size) {
    const current = heap.pop();
    visitOrder.push(current.index);
    const x = current.index % width, y = Math.floor(current.index / width);
    for (const [dx, dy] of NEIGHBORS) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= fieldHeight) continue;
      const neighbor = idx(nx, ny, width);
      if (seen[neighbor] || data[neighbor] <= 0) continue;
      seen[neighbor] = 1;
      flowTo[neighbor] = current.index;
      filled[neighbor] = Math.max(data[neighbor], current.priority);
      heap.push(neighbor, filled[neighbor]);
    }
  }
  return { flowTo, filled, visitOrder };
}

function resolveBasins(
  height: HeightField,
  filled: Float32Array,
  flowTo: Int32Array,
  prefix: string,
): { basins: BasinRecord[]; membership: Int32Array; lakeCellMask: Uint8Array } {
  const { width, height: fieldHeight, data } = height;
  const count = width * fieldHeight;
  const candidate = new Uint8Array(count);
  for (let i = 0; i < count; i++) candidate[i] = data[i] > 0 && filled[i] - data[i] >= 2 ? 1 : 0;
  const componentSeen = new Uint8Array(count);
  const components: { cells: number[]; maxDepth: number; meanDepth: number; centroid: Vec2 }[] = [];
  const minCells = Math.max(5, Math.floor(count * 0.00006));

  for (let start = 0; start < count; start++) {
    if (!candidate[start] || componentSeen[start]) continue;
    const queue = [start];
    componentSeen[start] = 1;
    const cells: number[] = [];
    let head = 0, depthSum = 0, maxDepth = 0;
    while (head < queue.length) {
      const current = queue[head++];
      cells.push(current);
      const depth = filled[current] - data[current];
      depthSum += depth;
      maxDepth = Math.max(maxDepth, depth);
      const x = current % width, y = Math.floor(current / width);
      for (const [dx, dy] of NEIGHBORS) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= fieldHeight) continue;
        const neighbor = idx(nx, ny, width);
        if (candidate[neighbor] && !componentSeen[neighbor]) {
          componentSeen[neighbor] = 1;
          queue.push(neighbor);
        }
      }
    }
    const meanDepth = depthSum / cells.length;
    const surface = cells.reduce((sum, cell) => sum + filled[cell], 0) / cells.length;
    if (cells.length >= minCells && maxDepth >= 10 && meanDepth >= 2.5 && surface > 15 && surface < 1_200) {
      const centroid: Vec2 = [
        cells.reduce((sum, cell) => sum + cell % width, 0) / cells.length / (width - 1),
        cells.reduce((sum, cell) => sum + Math.floor(cell / width), 0) / cells.length / (fieldHeight - 1),
      ];
      components.push({ cells, maxDepth, meanDepth, centroid });
    }
  }

  // Preserve only the largest physically valid basins. This removes tiny
  // noise cups without inventing water and leaves room for later authored
  // glacial-lake families.
  components.sort((a, b) => b.cells.length - a.cells.length);
  const canonicalTarget: Vec2 | null = prefix === "seradia" ? [0.545, 0.305] : prefix === "valora" ? [0.15, 0.30] : null;
  const selected = canonicalTarget
    ? components.filter((component) => Math.hypot(component.centroid[0] - canonicalTarget[0], component.centroid[1] - canonicalTarget[1]) < (prefix === "seradia" ? 0.15 : 0.10)).slice(0, prefix === "seradia" ? 2 : 1)
    : components.slice(0, 6);
  const membership = new Int32Array(count).fill(-1);
  const lakeCellMask = new Uint8Array(count);
  const basins: BasinRecord[] = [];

  selected.forEach((component, lakeIndex) => {
    const cellSet = new Set(component.cells);
    let outletIndex = component.cells[0];
    let outletScore = Number.POSITIVE_INFINITY;
    for (const cell of component.cells) {
      const parent = flowTo[cell];
      if (parent >= 0 && !cellSet.has(parent)) {
        const score = filled[cell] + (filled[cell] - data[cell]);
        if (score < outletScore) { outletScore = score; outletIndex = cell; }
      }
    }
    const surfaceElevationM = filled[outletIndex];
    const wetCells = component.cells.filter((cell) => data[cell] < surfaceElevationM - 0.5);
    const boundaryPoints: Vec2[] = [];
    for (const cell of wetCells) {
      membership[cell] = lakeIndex;
      lakeCellMask[cell] = 1;
      const x = cell % width, y = Math.floor(cell / width);
      if (NEIGHBORS.some(([dx, dy]) => {
        const nx = x + dx, ny = y + dy;
        return nx < 0 || ny < 0 || nx >= width || ny >= fieldHeight || !cellSet.has(idx(nx, ny, width));
      })) boundaryPoints.push([x / (width - 1), y / (fieldHeight - 1)]);
    }
    const polygon = convexHull(boundaryPoints);
    const outlet: Vec2 = [(outletIndex % width) / (width - 1), Math.floor(outletIndex / width) / (fieldHeight - 1)];
    basins.push({
      cells: wetCells,
      outletIndex,
      lake: {
        id: `${prefix}-lake-${lakeIndex}`,
        polygon,
        depthM: Math.max(...wetCells.map((cell) => surfaceElevationM - data[cell])),
        surfaceElevationM,
        spillElevationM: surfaceElevationM,
        outlet,
      },
    });
  });
  return { basins, membership, lakeCellMask };
}

function surfaceProfile(pathIndices: number[], height: HeightField, filled: Float32Array, lakeSurface?: number): number[] {
  const result: number[] = [];
  let previous = Number.POSITIVE_INFINITY;
  for (let i = 0; i < pathIndices.length; i++) {
    const cell = pathIndices[i];
    const candidate = height.data[cell] <= 0 ? 0 : Math.max(height.data[cell], filled[cell]);
    const surface = i === 0 && lakeSurface !== undefined ? lakeSurface : Math.min(previous, candidate);
    result.push(surface);
    previous = surface;
  }
  return result;
}

function smoothRiverPath(path: Vec2[], surfaces: number[], iterations = 2): { path: Vec2[]; surfaces: number[] } {
  let points = path;
  let elevations = surfaces;
  for (let iteration = 0; iteration < iterations && points.length > 2; iteration++) {
    const nextPoints: Vec2[] = [points[0]];
    const nextElevations: number[] = [elevations[0]];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      const surfaceA = elevations[i], surfaceB = elevations[i + 1];
      nextPoints.push(
        [a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25],
        [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75],
      );
      nextElevations.push(
        surfaceA * 0.75 + surfaceB * 0.25,
        surfaceA * 0.25 + surfaceB * 0.75,
      );
    }
    nextPoints.push(points[points.length - 1]);
    nextElevations.push(elevations[elevations.length - 1]);
    points = nextPoints;
    elevations = nextElevations;
  }
  // Floating-point interpolation can introduce sub-millimetre rises. Clamp
  // them so the exported navigation/rendering surface remains monotonic.
  for (let i = 1; i < elevations.length; i++) elevations[i] = Math.min(elevations[i - 1], elevations[i]);
  return { path: points, surfaces: elevations };
}

function profileForMouth(mouthKind: River["mouthKind"]): River["profile"] {
  switch (mouthKind) {
    case "delta":
      return { widthM: [120, 600], depthM: [5, 18], currentMps: [1.65, 0.28], navigableFromT: 0 };
    case "estuary":
      return { widthM: [100, 480], depthM: [4.5, 16], currentMps: [1.8, 0.32], navigableFromT: 0 };
    case "lake-outlet":
      return { widthM: [110, 360], depthM: [5, 14], currentMps: [0.85, 0.34], navigableFromT: 0 };
    case "lake-inlet":
      return { widthM: [70, 280], depthM: [3.5, 12], currentMps: [1.9, 0.42], navigableFromT: 0.08 };
    case "confluence":
      return { widthM: [55, 220], depthM: [3, 10], currentMps: [2.1, 0.62], navigableFromT: 0.12 };
    default:
      return { widthM: [70, 320], depthM: [3.5, 13], currentMps: [2, 0.42], navigableFromT: 0.08 };
  }
}

function closestPointOnSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): { t: number; distance: number } {
  const dx = bx - ax, dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq)) : 0;
  return { t, distance: Math.hypot(px - (ax + dx * t), py - (ay + dy * t)) };
}

/**
 * Cuts resolved watercourses into the authoritative terrain. The exported
 * water surface, navigation depth, fish volume, and visible river now share
 * one cross-section instead of a decorative strip floating over dry land.
 */
export function carveRiverChannels(
  height: HeightField,
  water: WaterData,
  continentTileSize: number,
  riverCellMask?: Uint8Array,
): void {
  const { width, height: fieldHeight, data } = height;
  const metersPerCellX = continentTileSize / Math.max(1, width - 1);
  const metersPerCellY = continentTileSize / Math.max(1, fieldHeight - 1);
  const carvePath = (
    path: Vec2[],
    surfaces: number[],
    profile: River["profile"],
    progressStart = 0,
    widthScale = 1,
  ) => {
    if (path.length < 2) return;
    for (let segment = 0; segment < path.length - 1; segment++) {
      const a = path[segment], b = path[segment + 1];
      const ax = a[0] * continentTileSize, ay = a[1] * continentTileSize;
      const bx = b[0] * continentTileSize, by = b[1] * continentTileSize;
      const segmentStart = progressStart + (segment / Math.max(1, path.length - 1)) * (1 - progressStart);
      const segmentEnd = progressStart + ((segment + 1) / Math.max(1, path.length - 1)) * (1 - progressStart);
      const maxWidth = (profile.widthM[0] + Math.pow(segmentEnd, 1.35) * (profile.widthM[1] - profile.widthM[0])) * widthScale;
      const outerRadius = maxWidth * 0.5 + Math.max(110, maxWidth * 0.7);
      const minX = Math.max(0, Math.floor((Math.min(ax, bx) - outerRadius) / metersPerCellX));
      const maxX = Math.min(width - 1, Math.ceil((Math.max(ax, bx) + outerRadius) / metersPerCellX));
      const minY = Math.max(0, Math.floor((Math.min(ay, by) - outerRadius) / metersPerCellY));
      const maxY = Math.min(fieldHeight - 1, Math.ceil((Math.max(ay, by) + outerRadius) / metersPerCellY));
      for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
        const hit = closestPointOnSegment(x * metersPerCellX, y * metersPerCellY, ax, ay, bx, by);
        const progress = segmentStart + (segmentEnd - segmentStart) * hit.t;
        const widthM = (profile.widthM[0] + Math.pow(progress, 1.35) * (profile.widthM[1] - profile.widthM[0])) * widthScale;
        const depthM = profile.depthM[0] + Math.pow(progress, 1.15) * (profile.depthM[1] - profile.depthM[0]);
        const halfWidth = Math.max(widthM * 0.5, Math.min(metersPerCellX, metersPerCellY) * 0.52);
        const bankWidth = Math.max(110, widthM * 0.7);
        if (hit.distance > halfWidth + bankWidth) continue;
        const surfaceM = surfaces[segment] + (surfaces[segment + 1] - surfaces[segment]) * hit.t;
        const index = y * width + x;
        let target: number;
        if (hit.distance <= halfWidth) {
          const across = hit.distance / Math.max(1, halfWidth);
          const edgeT = Math.max(0, Math.min(1, (across - 0.58) / 0.42));
          const smoothEdge = edgeT * edgeT * (3 - 2 * edgeT);
          target = surfaceM - depthM * (1 - smoothEdge * 0.82);
          if (riverCellMask) riverCellMask[index] = 1;
        } else {
          const bankT = (hit.distance - halfWidth) / bankWidth;
          const eased = bankT * bankT * (3 - 2 * bankT);
          target = surfaceM - depthM * 0.18 + eased * (depthM * 0.18 + Math.min(14, 3.5 + widthM * 0.025));
        }
        data[index] = Math.min(data[index], target);
      }
    }
  };

  for (const river of water.rivers) {
    carvePath(river.path, river.surfaceElevationM, river.profile);
    for (const branch of river.distributaries ?? []) {
      const startSurface = river.surfaceElevationM[Math.max(0, river.surfaceElevationM.length - 9)] ?? 0;
      const branchSurfaces = branch.map((_, index) => startSurface * (1 - index / Math.max(1, branch.length - 1)));
      carvePath(branch, branchSurfaces, river.profile, 0.68, 0.72);
    }
  }
}

function findDistributary(
  path: Vec2[],
  side: -1 | 1,
  height: HeightField,
): Vec2[] {
  const { width, height: fieldHeight, data } = height;
  const mouth = path[path.length - 1];
  const start = path[Math.max(0, path.length - 9)];
  const tangentX = mouth[0] - start[0], tangentY = mouth[1] - start[1];
  const tangentLength = Math.max(0.00001, Math.hypot(tangentX, tangentY));
  const sideX = -tangentY / tangentLength * side, sideY = tangentX / tangentLength * side;
  const mx = Math.round(mouth[0] * (width - 1)), my = Math.round(mouth[1] * (fieldHeight - 1));
  let endpoint = mouth, bestScore = Number.NEGATIVE_INFINITY;
  for (let dy = -12; dy <= 12; dy++) for (let dx = -12; dx <= 12; dx++) {
    const x = mx + dx, y = my + dy;
    if (x < 0 || y < 0 || x >= width || y >= fieldHeight || data[idx(x, y, width)] > 0) continue;
    const lateral = dx * sideX + dy * sideY;
    const outward = dx * tangentX / tangentLength + dy * tangentY / tangentLength;
    const score = lateral * 1.4 + outward * 0.45 - Math.hypot(dx, dy) * 0.12;
    if (score > bestScore) {
      bestScore = score;
      endpoint = [x / (width - 1), y / (fieldHeight - 1)];
    }
  }
  const branch: Vec2[] = [];
  for (let step = 0; step <= 18; step++) {
    const t = step / 18;
    const bend = Math.sin(t * Math.PI) * 0.006;
    branch.push([
      start[0] + (endpoint[0] - start[0]) * t + sideX * bend,
      start[1] + (endpoint[1] - start[1]) * t + sideY * bend,
    ]);
  }
  return branch;
}

export function generateWaterData(height: HeightField, riverIdPrefix: string): HydrologyResult {
  const { width, height: fieldHeight, data } = height;
  const count = width * fieldHeight;
  const { flowTo, filled, visitOrder } = buildPriorityDrainage(height);
  const { basins, membership, lakeCellMask } = resolveBasins(height, filled, flowTo, riverIdPrefix);

  const accumulation = new Float64Array(count).fill(1);
  for (let orderIndex = visitOrder.length - 1; orderIndex >= 0; orderIndex--) {
    const cell = visitOrder[orderIndex];
    if (data[cell] <= 0) continue;
    const parent = flowTo[cell];
    if (parent >= 0) accumulation[parent] += accumulation[cell];
  }
  const landAccumulation: number[] = [];
  for (let i = 0; i < count; i++) if (data[i] > 0 && membership[i] < 0) landAccumulation.push(accumulation[i]);
  landAccumulation.sort((a, b) => a - b);
  const threshold = landAccumulation[Math.min(landAccumulation.length - 1, Math.floor(landAccumulation.length * 0.996))] ?? Infinity;
  const isRiverCell = (cell: number) => data[cell] > 0 && membership[cell] < 0 && accumulation[cell] >= threshold;
  const upstreamCount = new Int32Array(count);
  for (let cell = 0; cell < count; cell++) {
    const parent = flowTo[cell];
    if (parent >= 0 && isRiverCell(cell)) upstreamCount[parent]++;
  }
  const sources = visitOrder
    .filter((cell) => isRiverCell(cell) && upstreamCount[cell] === 0)
    .sort((a, b) => data[b] - data[a]);

  const riverCellMask = new Uint8Array(count);
  // Each resolved terrain cell belongs to one visible downstream channel.
  // Tributaries terminate into that owner instead of exporting a second full
  // ribbon over the same trunk.
  const riverOwner = new Int32Array(count).fill(-1);
  const rivers: River[] = [];
  let riverCount = 0;
  const toUv = (cell: number): Vec2 => [(cell % width) / (width - 1), Math.floor(cell / width) / (fieldHeight - 1)];
  const makeRiver = (
    pathIndices: number[],
    terminatesIn: River["terminatesIn"],
    mouthKind: River["mouthKind"],
    lakeSurface?: number,
  ): River => {
    const ownerIndex = riverCount;
    for (const cell of pathIndices) {
      riverCellMask[cell] = 1;
      if (riverOwner[cell] < 0) riverOwner[cell] = ownerIndex;
    }
    const elevations = surfaceProfile(pathIndices, height, filled, lakeSurface);
    const smoothed = smoothRiverPath(pathIndices.map(toUv), elevations);
    return {
      id: `${riverIdPrefix}-river-${riverCount++}`,
      path: smoothed.path,
      sourceElevationM: smoothed.surfaces[0],
      surfaceElevationM: smoothed.surfaces,
      terminatesIn,
      mouthKind,
      profile: profileForMouth(mouthKind),
    };
  };

  // Lake outlets are compiled first so every lake has an explicit, visible
  // continuation to the sea rather than an implicit metadata-only spill.
  for (const basin of basins) {
    const path: number[] = [basin.outletIndex];
    let current = flowTo[basin.outletIndex], steps = 0;
    while (current >= 0 && steps++ < count) {
      path.push(current);
      if (data[current] <= 0) break;
      current = flowTo[current];
    }
    if (path.length >= 2 && data[path[path.length - 1]] <= 0) {
      rivers.push(makeRiver(path, { type: "ocean", featureId: "luna-sea" }, "lake-outlet", basin.lake.surfaceElevationM));
    }
  }

  for (const source of sources) {
    const path: number[] = [];
    let current = source, steps = 0;
    let terminal: River["terminatesIn"] | null = null;
    while (current >= 0 && steps++ < count) {
      const joinedRiver = riverOwner[current];
      if (joinedRiver >= 0) {
        path.push(current);
        terminal = { type: "river", featureId: rivers[joinedRiver].id };
        break;
      }
      path.push(current);
      const lakeIndex = membership[current];
      if (lakeIndex >= 0) {
        terminal = { type: "lake", featureId: basins[lakeIndex].lake.id };
        break;
      }
      if (data[current] <= 0) {
        terminal = { type: "ocean", featureId: "luna-sea" };
        break;
      }
      current = flowTo[current];
    }
    if (path.length > 10 && terminal) {
      const mouthKind: River["mouthKind"] = terminal.type === "lake" ? "lake-inlet"
        : terminal.type === "river" ? "confluence"
          : "open-coast";
      rivers.push(makeRiver(path, terminal, mouthKind));
    }
    if (rivers.length >= 24) break;
  }

  const oceanRivers = rivers.filter((river) => river.terminatesIn.type === "ocean" && river.mouthKind !== "lake-outlet");
  if (riverIdPrefix === "seradia" && oceanRivers.length) {
    const solmara: Vec2 = [0.2, 0.75];
    const delta = oceanRivers.reduce((best, river) => {
      const mouth = river.path[river.path.length - 1];
      const score = Math.hypot(mouth[0] - solmara[0], mouth[1] - solmara[1]);
      return score < best.score ? { river, score } : best;
    }, { river: oceanRivers[0], score: Number.POSITIVE_INFINITY }).river;
    delta.mouthKind = "delta";
    delta.distributaries = [findDistributary(delta.path, -1, height), findDistributary(delta.path, 1, height)];
  }
  for (const river of oceanRivers) {
    if (river.mouthKind === "delta") continue;
    const lastLand = river.surfaceElevationM[Math.max(0, river.surfaceElevationM.length - 2)];
    if (lastLand < 65) river.mouthKind = "estuary";
  }
  // Mouth classification determines the physical channel contract. Apply it
  // after delta/estuary selection so rendering, carving, navigation, boats,
  // and fish volumes all receive the same credible width and depth.
  for (const river of rivers) river.profile = profileForMouth(river.mouthKind);

  let maxLogAccumulation = 1;
  for (let i = 0; i < count; i++) if (data[i] > 0) maxLogAccumulation = Math.max(maxLogAccumulation, Math.log1p(accumulation[i]));
  const drainageData = new Float32Array(count);
  for (let i = 0; i < count; i++) drainageData[i] = data[i] > 0 ? Math.log1p(accumulation[i]) / maxLogAccumulation : 0;

  return {
    water: { oceanLevelM: 0, rivers, lakes: basins.map((basin) => basin.lake) },
    riverCellMask,
    lakeCellMask,
    drainage: { width, height: fieldHeight, data: drainageData },
  };
}
