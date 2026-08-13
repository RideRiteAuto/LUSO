import * as THREE from "three/webgpu";
import type { NavigableWaterwayRecord, RiverRecord, WorldData } from "./worldData.js";
import { uvToWorld } from "./layout.js";

// Segment layout: ax, az, bx, bz, surfaceA, surfaceB, widthA, widthB,
// depthA, depthB, kind, bankWidth. Kind 0 = scenic river (carved bed +
// raised freeboard banks), kind 1 = navigable waterway (sea-level channel,
// carve only — the ocean is its surface).
const STRIDE = 12;
export const SEGMENT_KIND_SCENIC = 0;
export const SEGMENT_KIND_WATERWAY = 1;
export const RIVER_CHANNEL_GRID_M = 512;

/** Compact spatial index shared by streamed terrain, collision and dressing. */
export interface RiverChannelField {
  segments: Float32Array;
  offsets: Uint32Array;
  indices: Uint32Array;
  minX: number;
  minZ: number;
  gridWidth: number;
  gridHeight: number;
  cellSize: number;
}

function profileValue(range: [number, number] | undefined, progress: number, fallback: [number, number], power = 1): number {
  const [start, end] = range ?? fallback;
  return start + Math.pow(progress, power) * (end - start);
}

export function isOceanReceivingRiver(river: RiverRecord): boolean {
  return river.terminatesIn?.type === "ocean" || river.mouthKind === "estuary" || river.mouthKind === "delta";
}

/** Mirror of the compiler's scenic depth rule — one cross-section everywhere. */
export function scenicRiverDepthM(widthM: number): number {
  return Math.max(1.3, Math.min(4.6, widthM * 0.085));
}

/**
 * Authoritative bank-to-bank width used by terrain, rendering, collision and
 * water queries. The compiler now exports the exact per-point width profile
 * it carved with (flow-accumulation driven), so the presentation surface can
 * never disagree with the carved channel; the profile-range interpolation
 * remains only as a fallback for older data.
 */
export function riverWidthAt(river: RiverRecord, progress: number, widthScale = 1): number {
  const t = Math.max(0, Math.min(1, progress));
  const samples = river.widthProfileM;
  if (samples && samples.length >= 2) {
    const position = t * (samples.length - 1);
    const low = Math.floor(position), high = Math.min(samples.length - 1, low + 1);
    return (samples[low] + (samples[high] - samples[low]) * (position - low)) * widthScale;
  }
  return profileValue(river.profile?.widthM, t, [10, 40], 1.35) * widthScale;
}

export interface RiverCenterPoint {
  x: number;
  y: number;
  z: number;
  progress: number;
  width: number;
  depth: number;
  current: number;
}

export function buildRiverCenterline(
  river: RiverRecord,
  worldPath: [number, number][],
  progressStart = 0,
  widthScale = 1,
): RiverCenterPoint[] {
  if (worldPath.length < 2) return [];
  const surfaces = river.surfaceElevationM ?? [];
  const authoredPoints = worldPath.map(([x, z], index) => {
    const localProgress = index / Math.max(1, worldPath.length - 1);
    const progress = progressStart + localProgress * (1 - progressStart);
    const surfaceIndex = progressStart > 0 ? Math.round(progress * Math.max(0, surfaces.length - 1)) : index;
    const width = riverWidthAt(river, progress, widthScale);
    return {
      x, z, y: (surfaces[Math.min(surfaces.length - 1, surfaceIndex)] ?? 0) + 0.08, progress,
      width,
      depth: scenicRiverDepthM(width),
      current: profileValue(river.profile?.currentMps, progress, [1.6, 0.45]),
    };
  });
  const controlPoints = [authoredPoints[0]];
  // Water-body spline controls stay a few channel-widths apart so the two
  // banks never fold across one another at a bend, while remaining tight
  // enough that the centreline cannot cut across a valley spur — that
  // corner-cutting was one of the floating-ribbon causes.
  const controlSpacing = Math.max(90, Math.min(240, (river.profile?.widthM[1] ?? 40) * widthScale * 2.2));
  let distanceSinceControl = 0;
  for (let i = 1; i < authoredPoints.length - 1; i++) {
    distanceSinceControl += Math.hypot(authoredPoints[i].x - authoredPoints[i - 1].x, authoredPoints[i].z - authoredPoints[i - 1].z);
    if (distanceSinceControl < controlSpacing) continue;
    controlPoints.push(authoredPoints[i]);
    distanceSinceControl = 0;
  }
  controlPoints.push(authoredPoints[authoredPoints.length - 1]);
  let length = 0;
  for (let i = 1; i < controlPoints.length; i++) length += Math.hypot(
    controlPoints[i].x - controlPoints[i - 1].x,
    controlPoints[i].z - controlPoints[i - 1].z,
  );
  const sampleCount = Math.max(2, Math.ceil(length / 22));
  const curve = new THREE.CatmullRomCurve3(
    controlPoints.map((point) => new THREE.Vector3(point.x, point.y, point.z)), false, "centripetal", 0.2,
  );
  return curve.getSpacedPoints(sampleCount).map((point, index) => {
    const t = index / sampleCount;
    const progress = progressStart + t * (1 - progressStart);
    const width = riverWidthAt(river, progress, widthScale);
    return {
      x: point.x, y: point.y, z: point.z, progress,
      width,
      depth: scenicRiverDepthM(width),
      current: profileValue(river.profile?.currentMps, progress, [1.6, 0.45]),
    };
  });
}

function appendRiverSegments(
  output: number[],
  points: RiverCenterPoint[],
): void {
  if (points.length < 2) return;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    output.push(
      a.x, a.z, b.x, b.z, a.y - 0.08, b.y - 0.08,
      a.width, b.width, a.depth, b.depth,
      SEGMENT_KIND_SCENIC, Math.max(14, Math.max(a.width, b.width) * 0.7),
    );
  }
}

function appendWaterwaySegments(
  output: number[],
  waterway: NavigableWaterwayRecord,
  worldPath: [number, number][],
): void {
  for (let i = 0; i < worldPath.length - 1; i++) {
    output.push(
      worldPath[i][0], worldPath[i][1], worldPath[i + 1][0], worldPath[i + 1][1],
      0, 0,
      waterway.surfaceWidthM, waterway.surfaceWidthM,
      waterway.bedDepthM, waterway.bedDepthM,
      SEGMENT_KIND_WATERWAY, Math.max(90, waterway.bankWidthM ?? 90),
    );
  }
}

export function buildRiverChannelField(world: WorldData): RiverChannelField {
  const values: number[] = [];
  for (const continent of Object.values(world.continents)) {
    for (const river of continent.rivers) {
      appendRiverSegments(values, buildRiverCenterline(
        river, river.path.map(([u, v]) => uvToWorld(u, v, continent.id, world.manifest)),
      ));
      for (const branch of river.distributaries ?? []) {
        appendRiverSegments(values, buildRiverCenterline(
          river, branch.map(([u, v]) => uvToWorld(u, v, continent.id, world.manifest)), 0.68, 0.68,
        ));
      }
    }
    for (const waterway of continent.waterways ?? []) {
      appendWaterwaySegments(values, waterway,
        waterway.path.map(([u, v]) => uvToWorld(u, v, continent.id, world.manifest)));
    }
  }

  const segments = new Float32Array(values);
  const bounds = world.worldHeight.bounds;
  const gridWidth = Math.ceil((bounds.maxX - bounds.minX) / RIVER_CHANNEL_GRID_M);
  const gridHeight = Math.ceil((bounds.maxZ - bounds.minZ) / RIVER_CHANNEL_GRID_M);
  const bins = Array.from({ length: gridWidth * gridHeight }, () => [] as number[]);
  for (let segment = 0; segment < segments.length / STRIDE; segment++) {
    const offset = segment * STRIDE;
    const maxWidth = Math.max(segments[offset + 6], segments[offset + 7]);
    const bankWidth = segments[offset + 11];
    // Banks widen dynamically with cut depth (up to terrain*1.6), so the bin
    // reach is padded well past the static bank width.
    const reach = maxWidth * 0.5 + Math.max(110, bankWidth * 2.4);
    const minCellX = Math.max(0, Math.floor((Math.min(segments[offset], segments[offset + 2]) - reach - bounds.minX) / RIVER_CHANNEL_GRID_M));
    const maxCellX = Math.min(gridWidth - 1, Math.floor((Math.max(segments[offset], segments[offset + 2]) + reach - bounds.minX) / RIVER_CHANNEL_GRID_M));
    const minCellZ = Math.max(0, Math.floor((Math.min(segments[offset + 1], segments[offset + 3]) - reach - bounds.minZ) / RIVER_CHANNEL_GRID_M));
    const maxCellZ = Math.min(gridHeight - 1, Math.floor((Math.max(segments[offset + 1], segments[offset + 3]) + reach - bounds.minZ) / RIVER_CHANNEL_GRID_M));
    for (let z = minCellZ; z <= maxCellZ; z++) for (let x = minCellX; x <= maxCellX; x++) bins[z * gridWidth + x].push(segment);
  }
  const offsets = new Uint32Array(bins.length + 1);
  for (let i = 0; i < bins.length; i++) offsets[i + 1] = offsets[i] + bins[i].length;
  const indices = new Uint32Array(offsets[offsets.length - 1]);
  for (let i = 0; i < bins.length; i++) indices.set(bins[i], offsets[i]);
  return { segments, offsets, indices, minX: bounds.minX, minZ: bounds.minZ, gridWidth, gridHeight, cellSize: RIVER_CHANNEL_GRID_M };
}

function smoothstep(value: number): number {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

/**
 * Applies the water terrain brush with the same math as the compiler:
 * scenic rivers carve their bed AND raise a freeboard levee where the bank
 * sits below the water surface; waterways carve their sea-level channel.
 * Raises are collected first and carves win, so a tributary's levee can
 * never dam the deeper channel it joins.
 */
export function sampleRiverCarvedHeight(field: RiverChannelField, worldX: number, worldZ: number, baseHeight: number): number {
  const cellX = Math.floor((worldX - field.minX) / field.cellSize);
  const cellZ = Math.floor((worldZ - field.minZ) / field.cellSize);
  if (cellX < 0 || cellZ < 0 || cellX >= field.gridWidth || cellZ >= field.gridHeight) return baseHeight;
  const cell = cellZ * field.gridWidth + cellX;
  let raised = baseHeight;
  let carved = Number.POSITIVE_INFINITY;
  for (let entry = field.offsets[cell]; entry < field.offsets[cell + 1]; entry++) {
    const offset = field.indices[entry] * STRIDE;
    const ax = field.segments[offset], az = field.segments[offset + 1];
    const dx = field.segments[offset + 2] - ax, dz = field.segments[offset + 3] - az;
    const lengthSq = dx * dx + dz * dz;
    const t = lengthSq > 0 ? Math.max(0, Math.min(1, ((worldX - ax) * dx + (worldZ - az) * dz) / lengthSq)) : 0;
    const distance = Math.hypot(worldX - (ax + dx * t), worldZ - (az + dz * t));
    const surface = field.segments[offset + 4] + (field.segments[offset + 5] - field.segments[offset + 4]) * t;
    const width = field.segments[offset + 6] + (field.segments[offset + 7] - field.segments[offset + 6]) * t;
    const depth = field.segments[offset + 8] + (field.segments[offset + 9] - field.segments[offset + 8]) * t;
    const kind = field.segments[offset + 10];
    const bankWidth = field.segments[offset + 11];
    const halfWidth = width * 0.5;
    if (kind === SEGMENT_KIND_WATERWAY) {
      const effectiveBank = Math.max(bankWidth, Math.max(0, baseHeight) * 1.6);
      if (distance > halfWidth + effectiveBank) continue;
      const bedHalf = halfWidth * 0.55;
      let target: number;
      if (distance <= bedHalf) target = -depth;
      else if (distance <= halfWidth) target = -depth + (depth - 2.2) * smoothstep((distance - bedHalf) / Math.max(1, halfWidth - bedHalf));
      else target = -2.2 + (baseHeight + 2.2) * smoothstep((distance - halfWidth) / effectiveBank);
      carved = Math.min(carved, target);
    } else if (distance <= halfWidth) {
      const across = distance / Math.max(1, halfWidth);
      const eased = smoothstep((across - 0.5) / 0.5);
      carved = Math.min(carved, surface - depth + (depth - 0.5) * eased);
    } else if (distance <= halfWidth + bankWidth && baseHeight > 0.3) {
      const freeboard = 1.2 + width * 0.015;
      const bankT = (distance - halfWidth) / bankWidth;
      const crest = bankT <= 0.4
        ? surface - 0.5 + (freeboard + 0.5) * smoothstep(bankT / 0.4)
        : surface + freeboard;
      const settle = bankT <= 0.4 ? crest : crest + (baseHeight - crest) * smoothstep((bankT - 0.4) / 0.6);
      raised = Math.max(raised, Math.min(settle, baseHeight + 8));
    }
  }
  return Math.min(raised, carved);
}
