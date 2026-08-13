// Stage 4 (docs/01 §4): hydrology.
// D8 flow direction + flow accumulation over the heightfield, then river
// polylines traced downhill from high-accumulation sources to the ocean or
// a closed basin (recorded as a lake). Rivers always originate at elevation
// and flow downhill to a terminus — no decorative/closed-loop rivers.

import type { HeightField, River, ScalarField, Vec2, WaterData } from "../types/index.js";

const NEIGHBORS: [number, number][] = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
];

function idx(x: number, y: number, w: number): number {
  return y * w + x;
}

export interface HydrologyResult {
  water: WaterData;
  /** grid-resolution mask (1 = part of a traced river path), consumed by climate/index.ts so moisture accounts for river proximity, not just ocean proximity. */
  riverCellMask: Uint8Array;
  /** Log-normalized upstream flow accumulation, compiler truth for drainage/wetness/resource rules. */
  drainage: ScalarField;
}

export function generateWaterData(height: HeightField, riverIdPrefix: string): HydrologyResult {
  const { width, height: h, data } = height;
  const n = width * h;

  const flowTo = new Int32Array(n).fill(-1); // index of downhill neighbor, -1 = pit or ocean cell
  const order = new Int32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  // Process from highest to lowest elevation so accumulation can be summed downstream in one pass.
  order.sort((a, b) => data[b] - data[a]);

  // D8 steepest descent.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < width; x++) {
      const i = idx(x, y, width);
      const e = data[i];
      if (e <= 0) continue; // ocean cells don't need a flow direction
      let bestSlope = 0;
      let bestJ = -1;
      for (const [dx, dy] of NEIGHBORS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= h) continue;
        const j = idx(nx, ny, width);
        const dist = dx !== 0 && dy !== 0 ? Math.SQRT2 : 1;
        const slope = (e - data[j]) / dist;
        if (slope > bestSlope) {
          bestSlope = slope;
          bestJ = j;
        }
      }
      flowTo[i] = bestJ;
    }
  }

  const accumulation = new Float64Array(n).fill(1); // each cell contributes its own area
  for (const i of order) {
    const e = data[i];
    if (e <= 0) continue;
    const j = flowTo[i];
    if (j >= 0) accumulation[j] += accumulation[i];
  }

  // Threshold: top ~0.4% of accumulation among land cells marks a river
  // cell. A looser threshold (previously 1.5%) produced a lot of very short
  // parallel tributaries that read as visual noise rather than a legible
  // drainage network -- this keeps only the trunks with real accumulated
  // watershed behind them, which is also just a more honest picture of
  // where a river would actually exist.
  const landAcc: number[] = [];
  for (let i = 0; i < n; i++) if (data[i] > 0) landAcc.push(accumulation[i]);
  landAcc.sort((a, b) => a - b);
  const thresholdIdx = Math.floor(landAcc.length * 0.996);
  const threshold = landAcc[Math.min(thresholdIdx, landAcc.length - 1)] ?? Infinity;

  const visited = new Uint8Array(n);
  const rivers: River[] = [];
  // Closed depressions are deliberately not emitted as lakes. A previous
  // placeholder turned every D8 pit into a small circular pond without
  // flooding/carving the terrain beneath it, producing unnatural blue dots
  // across both continents. Real lakes require basin filling and spill-level
  // calculation; until that stage exists, an unresolved pit is not water.
  const lakes: WaterData["lakes"] = [];
  let riverCount = 0;

  // Candidate sources: river cells whose upstream contributors are all below threshold
  // (i.e. this is where a river network segment begins), sorted by elevation descending
  // so headwaters are traced before their downstream continuations get visited.
  const isRiverCell = (i: number) => data[i] > 0 && accumulation[i] >= threshold;
  const upstreamCount = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const j = flowTo[i];
    if (j >= 0 && isRiverCell(i)) upstreamCount[j]++;
  }

  const sources = order.filter((i) => isRiverCell(i) && upstreamCount[i] === 0);

  for (const src of sources) {
    if (visited[src]) continue;
    const path: Vec2[] = [];
    let cur = src;
    let steps = 0;
    const sourceElevationM = data[src];
    let terminatesIn: River["terminatesIn"] = { type: "ocean", featureId: "luna-sea" };
    let reachedOcean = false;

    while (steps < width * 2) {
      const x = cur % width;
      const y = Math.floor(cur / width);
      path.push([x / (width - 1), y / (height.height - 1)]);
      visited[cur] = 1;

      if (data[cur] <= 0) {
        terminatesIn = { type: "ocean", featureId: "luna-sea" };
        reachedOcean = true;
        break;
      }
      const next = flowTo[cur];
      if (next < 0 || visited[next]) {
        break;
      }
      cur = next;
      steps++;
    }

    if (path.length > 10 && reachedOcean) {
      rivers.push({
        id: `${riverIdPrefix}-river-${riverCount++}`,
        path,
        sourceElevationM,
        terminatesIn,
        profile: {
          widthM: [7, 52],
          depthM: [0.8, 5.5],
          currentMps: [2, 0.45],
          // Firstwater/Riveira need a genuinely boat-usable lower course;
          // headwaters remain swimmer/fish water and are intentionally narrow.
          navigableFromT: 0.48,
        },
      });
    }
  }

  let maxLogAccumulation = 1;
  for (let i = 0; i < n; i++) {
    if (data[i] <= 0) continue;
    maxLogAccumulation = Math.max(maxLogAccumulation, Math.log1p(accumulation[i]));
  }
  const drainageData = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    drainageData[i] = data[i] > 0 ? Math.log1p(accumulation[i]) / maxLogAccumulation : 0;
  }

  return {
    water: { oceanLevelM: 0, rivers, lakes },
    riverCellMask: visited,
    drainage: { width, height: h, data: drainageData },
  };
}
