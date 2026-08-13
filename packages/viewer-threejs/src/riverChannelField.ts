import * as THREE from "three/webgpu";
import type { RiverRecord, WorldData } from "./worldData.js";
import { uvToWorld } from "./layout.js";

const STRIDE = 10;
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
    return {
      x, z, y: (surfaces[Math.min(surfaces.length - 1, surfaceIndex)] ?? 0) + 0.08, progress,
      width: profileValue(river.profile?.widthM, progress, [70, 320], 1.35) * widthScale,
      depth: profileValue(river.profile?.depthM, progress, [3.5, 13], 1.15),
      current: profileValue(river.profile?.currentMps, progress, [2, 0.42]),
    };
  });
  const controlPoints = [authoredPoints[0]];
  // A navigable channel cannot turn through a radius smaller than its own
  // beam. Drainage-grid detail remains in the watershed, while the water-body
  // spline uses ship-scale controls so its two banks never fold across one
  // another at a bend.
  const controlSpacing = Math.max(140, Math.min(650, (river.profile?.widthM[1] ?? 320) * widthScale * 1.15));
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
  const sampleCount = Math.max(2, Math.ceil(length / 28));
  const curve = new THREE.CatmullRomCurve3(
    controlPoints.map((point) => new THREE.Vector3(point.x, point.y, point.z)), false, "centripetal", 0.2,
  );
  return curve.getSpacedPoints(sampleCount).map((point, index) => {
    const t = index / sampleCount;
    const progress = progressStart + t * (1 - progressStart);
    return {
      x: point.x, y: point.y, z: point.z, progress,
      width: profileValue(river.profile?.widthM, progress, [70, 320], 1.35) * widthScale,
      depth: profileValue(river.profile?.depthM, progress, [3.5, 13], 1.15),
      current: profileValue(river.profile?.currentMps, progress, [2, 0.42]),
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
  }

  const segments = new Float32Array(values);
  const bounds = world.worldHeight.bounds;
  const gridWidth = Math.ceil((bounds.maxX - bounds.minX) / RIVER_CHANNEL_GRID_M);
  const gridHeight = Math.ceil((bounds.maxZ - bounds.minZ) / RIVER_CHANNEL_GRID_M);
  const bins = Array.from({ length: gridWidth * gridHeight }, () => [] as number[]);
  for (let segment = 0; segment < segments.length / STRIDE; segment++) {
    const offset = segment * STRIDE;
    const maxWidth = Math.max(segments[offset + 6], segments[offset + 7]);
    const reach = maxWidth * 0.5 + Math.max(110, maxWidth * 0.7);
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

/** Applies the river terrain brush with the same min-blend used by the compiler. */
export function sampleRiverCarvedHeight(field: RiverChannelField, worldX: number, worldZ: number, baseHeight: number): number {
  const cellX = Math.floor((worldX - field.minX) / field.cellSize);
  const cellZ = Math.floor((worldZ - field.minZ) / field.cellSize);
  if (cellX < 0 || cellZ < 0 || cellX >= field.gridWidth || cellZ >= field.gridHeight) return baseHeight;
  const cell = cellZ * field.gridWidth + cellX;
  let height = baseHeight;
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
    const halfWidth = width * 0.5;
    const bankWidth = Math.max(110, width * 0.7);
    if (distance > halfWidth + bankWidth) continue;
    let target: number;
    if (distance <= halfWidth) {
      const across = distance / Math.max(1, halfWidth);
      const edge = smoothstep((across - 0.58) / 0.42);
      target = surface - depth * (1 - edge * 0.82);
    } else {
      const bank = smoothstep((distance - halfWidth) / bankWidth);
      target = surface - depth * 0.18 + bank * (depth * 0.18 + Math.min(14, 3.5 + width * 0.025));
    }
    height = Math.min(height, target);
  }
  return height;
}
