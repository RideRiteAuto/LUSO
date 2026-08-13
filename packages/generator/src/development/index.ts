// Post-infrastructure housing suitability.
//
// The environmental pass establishes physical constraints. This pass runs
// only after resources, settlements, and terrain-aware roads exist, allowing
// the final compiler field to describe plausible development land rather
// than generic flatness.

import type {
  EnvironmentalFields,
  HeightField,
  PlacedResource,
  Road,
  ScalarField,
  SettlementAnchor,
  Vec2,
} from "../types/index.js";

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const smoothstep = (a: number, b: number, value: number): number => {
  const t = clamp01((value - a) / Math.max(0.000001, b - a));
  return t * t * (3 - 2 * t);
};

function markPoint(mask: Uint8Array, width: number, height: number, point: Vec2): void {
  const x = Math.max(0, Math.min(width - 1, Math.round(point[0] * (width - 1))));
  const y = Math.max(0, Math.min(height - 1, Math.round(point[1] * (height - 1))));
  mask[y * width + x] = 1;
}

function markPolyline(mask: Uint8Array, width: number, height: number, path: Vec2[]): void {
  for (let pointIndex = 1; pointIndex < path.length; pointIndex++) {
    const start = path[pointIndex - 1], end = path[pointIndex];
    const dx = (end[0] - start[0]) * (width - 1), dy = (end[1] - start[1]) * (height - 1);
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) * 1.4));
    for (let step = 0; step <= steps; step++) {
      const t = step / steps;
      markPoint(mask, width, height, [start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t]);
    }
  }
}

function distanceField(mask: Uint8Array, width: number, height: number, metersPerCell: number): Float32Array {
  const result = new Float32Array(width * height);
  result.fill(Number.POSITIVE_INFINITY);
  const queue = new Int32Array(width * height);
  let head = 0, tail = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) {
    result[i] = 0;
    queue[tail++] = i;
  }
  while (head < tail) {
    const current = queue[head++];
    const x = current % width, y = Math.floor(current / width);
    const next = result[current] + metersPerCell;
    if (x > 0 && !Number.isFinite(result[current - 1])) { result[current - 1] = next; queue[tail++] = current - 1; }
    if (x + 1 < width && !Number.isFinite(result[current + 1])) { result[current + 1] = next; queue[tail++] = current + 1; }
    if (y > 0 && !Number.isFinite(result[current - width])) { result[current - width] = next; queue[tail++] = current - width; }
    if (y + 1 < height && !Number.isFinite(result[current + width])) { result[current + width] = next; queue[tail++] = current + width; }
  }
  return result;
}

export interface HousingSuitabilityOptions {
  continentTileSize: number;
  height: HeightField;
  environment: EnvironmentalFields;
  roads: Road[];
  settlements: SettlementAnchor[];
  resources: PlacedResource[];
  continentZoneIds: Set<string>;
}

export function refineHousingSuitability(options: HousingSuitabilityOptions): ScalarField {
  const { continentTileSize, height, environment, roads, settlements, resources, continentZoneIds } = options;
  const { width, height: fieldHeight } = height;
  const metersPerCell = continentTileSize / Math.max(1, width - 1);
  const roadMask = new Uint8Array(width * fieldHeight);
  const settlementMask = new Uint8Array(width * fieldHeight);
  const resourceMask = new Uint8Array(width * fieldHeight);
  for (const road of roads) markPolyline(roadMask, width, fieldHeight, road.path);
  for (const settlement of settlements) markPoint(settlementMask, width, fieldHeight, settlement.position);
  for (const resource of resources) for (const instance of resource.instances) {
    if (continentZoneIds.has(instance.zoneId)) markPoint(resourceMask, width, fieldHeight, instance.position);
  }
  const distanceToRoad = distanceField(roadMask, width, fieldHeight, metersPerCell);
  const distanceToSettlement = distanceField(settlementMask, width, fieldHeight, metersPerCell);
  const distanceToResource = distanceField(resourceMask, width, fieldHeight, metersPerCell);
  const output = new Float32Array(width * fieldHeight);

  for (let index = 0; index < output.length; index++) {
    if (height.data[index] <= 0) continue;
    const slope = environment.slopeDegrees.data[index];
    const wetness = environment.wetness.data[index];
    const drainage = environment.drainage.data[index];
    const distanceWater = environment.distanceToWaterM.data[index];
    const shore = environment.shorelineInfluence.data[index];
    const roadAccess = Number.isFinite(distanceToRoad[index]) ? 1 - smoothstep(350, 4_200, distanceToRoad[index]) : 0;
    const settlementAccess = Number.isFinite(distanceToSettlement[index]) ? 1 - smoothstep(500, 7_500, distanceToSettlement[index]) : 0;
    const resourceAccess = Number.isFinite(distanceToResource[index]) ? 1 - smoothstep(700, 6_500, distanceToResource[index]) : 0;
    const waterAccess = smoothstep(100, 650, distanceWater) * (1 - smoothstep(3_800, 10_000, distanceWater));
    const slopeSuitability = 1 - smoothstep(8, 23, slope);
    // A slight preference for non-zero relief keeps high scores on natural
    // benches and rolling ground, not only on suspiciously perfect planes.
    const naturalBench = 0.88 + smoothstep(0.35, 3.5, slope) * 0.12;
    const floodRisk = clamp01(wetness * 0.55 + drainage * 0.42 + (distanceWater < 140 ? 0.35 : 0));
    const cliffRisk = smoothstep(18, 32, slope) * (0.55 + environment.exposure.data[index] * 0.45);
    const swampRisk = smoothstep(0.72, 0.94, wetness) * smoothstep(0.62, 0.90, drainage);
    const highAltitudeRisk = smoothstep(1_250, 2_150, height.data[index]);

    let score = environment.buildability.data[index] * 0.28
      + slopeSuitability * naturalBench * 0.22
      + roadAccess * 0.19
      + waterAccess * 0.12
      + resourceAccess * 0.09
      + settlementAccess * 0.10;
    score *= 1 - floodRisk * 0.58;
    score *= 1 - cliffRisk * 0.88;
    score *= 1 - swampRisk * 0.82;
    score *= 1 - highAltitudeRisk * 0.48;
    score *= 1 - shore * smoothstep(0.56, 0.95, shore) * 0.18;
    if (slope > 34 || wetness > 0.97 || floodRisk > 0.96) score = 0;
    output[index] = clamp01(score);
  }
  return { width, height: fieldHeight, data: output };
}
