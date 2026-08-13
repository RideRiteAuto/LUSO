import type { WorldHeightData } from "./worldData.js";

export interface TerrainTileSpec {
  id: string;
  minX: number;
  minZ: number;
  size: number;
  level: number;
  segments: number;
  /** Fine edges that meet a tile exactly twice this size. */
  stitchMask: number;
  /** Coarse-edge sample spacing divided by this tile's spacing: minZ, maxZ, minX, maxX. */
  stitchRatios: [number, number, number, number];
}

export const TERRAIN_EDGE = {
  MIN_Z: 1,
  MAX_Z: 2,
  MIN_X: 4,
  MAX_X: 8,
} as const;

export interface TerrainLodSettings {
  minTileSize: number;
  splitDistance: number;
  maxTiles: number;
  /** Ground-view render bubble radius. Omit for the full-world inspector. */
  viewDistance?: number;
  /** World-space areas whose silhouette must survive strategic-view LOD. */
  refinementRegions?: TerrainRefinementRegion[];
}

export interface TerrainRefinementRegion {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  maxTileSize: number;
  /** Optional camera range. Long river corridors refine locally as the player
   * approaches instead of consuming the entire strategic-view tile budget. */
  activationDistance?: number;
}

function distanceToSquare(x: number, z: number, minX: number, minZ: number, size: number): number {
  const dx = Math.max(minX - x, 0, x - (minX + size));
  const dz = Math.max(minZ - z, 0, z - (minZ + size));
  return Math.hypot(dx, dz);
}

function squareIntersectsRegion(tile: QuadtreeLeaf, region: TerrainRefinementRegion): boolean {
  return tile.minX <= region.maxX && tile.minX + tile.size >= region.minX
    && tile.minZ <= region.maxZ && tile.minZ + tile.size >= region.minZ;
}

function regionDistanceToPoint(region: TerrainRefinementRegion, x: number, z: number): number {
  const dx = Math.max(region.minX - x, 0, x - region.maxX);
  const dz = Math.max(region.minZ - z, 0, z - region.maxZ);
  return Math.hypot(dx, dz);
}

function nextPowerOfTwo(value: number): number {
  return 2 ** Math.ceil(Math.log2(value));
}

interface QuadtreeLeaf { minX: number; minZ: number; size: number }

const EDGE_EPSILON = 1e-5;

function rangesOverlap(a0: number, a1: number, b0: number, b1: number): boolean {
  return Math.min(a1, b1) - Math.max(a0, b0) > EDGE_EPSILON;
}

function sharedEdge(a: QuadtreeLeaf, b: QuadtreeLeaf): [number, number] | null {
  const aMaxX = a.minX + a.size, aMaxZ = a.minZ + a.size;
  const bMaxX = b.minX + b.size, bMaxZ = b.minZ + b.size;
  if (Math.abs(a.minZ - bMaxZ) < EDGE_EPSILON && rangesOverlap(a.minX, aMaxX, b.minX, bMaxX)) {
    return [TERRAIN_EDGE.MIN_Z, TERRAIN_EDGE.MAX_Z];
  }
  if (Math.abs(aMaxZ - b.minZ) < EDGE_EPSILON && rangesOverlap(a.minX, aMaxX, b.minX, bMaxX)) {
    return [TERRAIN_EDGE.MAX_Z, TERRAIN_EDGE.MIN_Z];
  }
  if (Math.abs(a.minX - bMaxX) < EDGE_EPSILON && rangesOverlap(a.minZ, aMaxZ, b.minZ, bMaxZ)) {
    return [TERRAIN_EDGE.MIN_X, TERRAIN_EDGE.MAX_X];
  }
  if (Math.abs(aMaxX - b.minX) < EDGE_EPSILON && rangesOverlap(a.minZ, aMaxZ, b.minZ, bMaxZ)) {
    return [TERRAIN_EDGE.MAX_X, TERRAIN_EDGE.MIN_X];
  }
  return null;
}

function splitLeaf(leaves: QuadtreeLeaf[], index: number): void {
  const tile = leaves[index];
  const half = tile.size * 0.5;
  leaves.splice(index, 1,
    { minX: tile.minX, minZ: tile.minZ, size: half },
    { minX: tile.minX + half, minZ: tile.minZ, size: half },
    { minX: tile.minX, minZ: tile.minZ + half, size: half },
    { minX: tile.minX + half, minZ: tile.minZ + half, size: half },
  );
}

/** Split coarse neighbors until every shared edge differs by at most one level. */
function balanceLeaves(leaves: QuadtreeLeaf[], maxTiles: number): boolean {
  for (;;) {
    let coarseIndex = -1;
    for (let i = 0; i < leaves.length && coarseIndex < 0; i++) {
      for (let j = i + 1; j < leaves.length; j++) {
        if (!sharedEdge(leaves[i], leaves[j])) continue;
        const larger = Math.max(leaves[i].size, leaves[j].size);
        const smaller = Math.min(leaves[i].size, leaves[j].size);
        if (larger <= smaller * 2 + EDGE_EPSILON) continue;
        coarseIndex = leaves[i].size > leaves[j].size ? i : j;
        break;
      }
    }
    if (coarseIndex < 0) return true;
    if (leaves.length + 3 > maxTiles) return false;
    splitLeaf(leaves, coarseIndex);
  }
}

/**
 * Camera-centered, 2:1-balanced quadtree leaves. Fine edges that meet a
 * coarser neighbor are marked for geometric edge stitching in the worker.
 */
export function selectTerrainTiles(
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number },
  cameraX: number,
  cameraZ: number,
  settings: TerrainLodSettings,
): TerrainTileSpec[] {
  const span = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ);
  const rootSize = nextPowerOfTwo(span);
  const rootMinX = (bounds.minX + bounds.maxX - rootSize) * 0.5;
  const rootMinZ = (bounds.minZ + bounds.maxZ - rootSize) * 0.5;
  let leaves: QuadtreeLeaf[] = [{ minX: rootMinX, minZ: rootMinZ, size: rootSize }];

  // Refine the nearest eligible leaf first. A depth-first walk can exhaust
  // the tile budget inside whichever far quadrant happened to be pushed
  // last, leaving the player's own leaf coarse despite reporting a 4 m
  // profile. Nearest-first makes the quality guarantee real.
  // Reserve a small tail budget for 2:1 balancing. The previous algorithm
  // cloned and fully re-balanced the complete leaf array for every candidate
  // split, which becomes cubic enough to create 30–50 ms walking hitches at
  // ~200 tiles. Nearest-first refinement is safe to perform once, followed by
  // a single balance pass.
  const activeRegions = (settings.refinementRegions ?? []).filter((region) => {
    const limit = region.activationDistance ?? settings.viewDistance;
    return !limit || regionDistanceToPoint(region, cameraX, cameraZ) <= limit;
  });
  const refinementLimit = Math.max(4, Math.floor(settings.maxTiles * (activeRegions.length ? 0.68 : 0.58)));
  while (leaves.length + 3 <= refinementLimit) {
    const candidates: Array<{ index: number; priority: number; forced: boolean }> = [];
    for (let i = 0; i < leaves.length; i++) {
      const tile = leaves[i];
      if (tile.size <= settings.minTileSize) continue;
      const distance = distanceToSquare(cameraX, cameraZ, tile.minX, tile.minZ, tile.size);
      const forced = activeRegions.some((region) => tile.size > region.maxTileSize && squareIntersectsRegion(tile, region));
      if (!forced && distance >= tile.size * settings.splitDistance) continue;
      const priority = distance / tile.size;
      candidates.push({ index: i, priority, forced });
    }
    // Split every coarse water-bearing leaf before drilling farther into any
    // one basin. This prevents the tile budget from leaving later lakes as
    // flat presentation polygons while the first lake receives excess detail.
    candidates.sort((a, b) => Number(b.forced) - Number(a.forced)
      || (a.forced ? leaves[b.index].size - leaves[a.index].size : a.priority - b.priority)
      || a.priority - b.priority);
    if (!candidates.length) break;
    splitLeaf(leaves, candidates[0].index);
  }
  balanceLeaves(leaves, settings.maxTiles);

  const prepared = leaves.map((tile) => {
    const level = Math.max(0, Math.round(Math.log2(tile.size / settings.minTileSize)));
    // Coast silhouettes and broad river mouths remain gameplay-critical even
    // outside the innermost terrain ring. A 16-segment far patch produced
    // visibly straight/jagged shoreline chords, so distant terrain retains a
    // 32-segment floor while the nearest two levels keep 64 segments.
    const segments = level <= 1 ? 64 : 32;
    return { ...tile, level, segments };
  });
  const visible = settings.viewDistance
    ? prepared.filter((tile) => distanceToSquare(cameraX, cameraZ, tile.minX, tile.minZ, tile.size) <= settings.viewDistance!)
    : prepared;
  return visible.map((tile, tileIndex) => {
    let stitchMask = 0;
    const stitchRatios: [number, number, number, number] = [1, 1, 1, 1];
    for (let neighborIndex = 0; neighborIndex < visible.length; neighborIndex++) {
      const neighbor = visible[neighborIndex];
      if (neighborIndex === tileIndex || neighbor.size <= tile.size) continue;
      const edges = sharedEdge(tile, neighbor);
      if (edges && neighbor.size <= tile.size * 2 + EDGE_EPSILON) {
        stitchMask |= edges[0];
        const edgeIndex = edges[0] === TERRAIN_EDGE.MIN_Z ? 0 : edges[0] === TERRAIN_EDGE.MAX_Z ? 1 : edges[0] === TERRAIN_EDGE.MIN_X ? 2 : 3;
        stitchRatios[edgeIndex] = Math.max(1, Math.round((neighbor.size / neighbor.segments) / (tile.size / tile.segments)));
      }
    }
    return {
      ...tile,
      stitchMask,
      stitchRatios,
      id: `${tile.minX.toFixed(2)}:${tile.minZ.toFixed(2)}:${tile.size.toFixed(2)}:${tile.segments}:s${stitchRatios.join("-")}`,
    };
  });
}

function hash2(x: number, z: number, seed: number): number {
  let h = Math.imul(x, 0x1f123bb5) ^ Math.imul(z, 0x5f356495) ^ Math.imul(seed | 0, 0x6c8e9cf5);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function fade(t: number): number {
  return t * t * (3 - 2 * t);
}

function valueNoise(x: number, z: number, scale: number, seed: number): number {
  const fx = x / scale;
  const fz = z / scale;
  const x0 = Math.floor(fx);
  const z0 = Math.floor(fz);
  const tx = fade(fx - x0);
  const tz = fade(fz - z0);
  const a = hash2(x0, z0, seed);
  const b = hash2(x0 + 1, z0, seed);
  const c = hash2(x0, z0 + 1, seed);
  const d = hash2(x0 + 1, z0 + 1, seed);
  const north = a + (b - a) * tx;
  const south = c + (d - c) * tx;
  return (north + (south - north) * tz) * 2 - 1;
}

/** Meter-scale, deterministic presentation relief shared by render tiles and collision. */
export function sampleLocalTerrainDetail(worldX: number, worldZ: number, seed: number, macroHeight: number): number {
  const exposure = macroHeight <= -8 ? 0.08 : macroHeight < 2 ? 0.25 : 1;
  const broad = valueNoise(worldX, worldZ, 32, seed ^ 0x36a9f17) * 1.15;
  const fine = valueNoise(worldX, worldZ, 8, seed ^ 0x4b1d2c3) * 0.32;
  return (broad + fine) * exposure;
}

/**
 * A bounded, render-independent 4 m collision cache. Tile LOD can disappear,
 * rebuild, or be frozen without changing the height used by movement.
 */
export class CollisionHeightCache {
  private readonly patches = new Map<string, { values: Float32Array; lastUse: number }>();
  private tick = 0;

  constructor(
    private readonly worldHeight: WorldHeightData,
    private readonly seed: number,
    private readonly sampleMacro: (worldHeight: WorldHeightData, x: number, z: number) => number,
    private readonly patchSize = 128,
    private readonly spacing = 4,
    private readonly maxPatches = 64,
    private readonly modifyHeight: (worldX: number, worldZ: number, baseHeight: number) => number = (_x, _z, height) => height,
  ) {}

  sample(worldX: number, worldZ: number): number {
    const patchX = Math.floor(worldX / this.patchSize);
    const patchZ = Math.floor(worldZ / this.patchSize);
    const key = `${patchX}:${patchZ}`;
    let patch = this.patches.get(key);
    if (!patch) {
      patch = { values: this.buildPatch(patchX, patchZ), lastUse: ++this.tick };
      this.patches.set(key, patch);
      this.evictIfNeeded();
    } else patch.lastUse = ++this.tick;

    const cells = this.patchSize / this.spacing;
    const originX = patchX * this.patchSize;
    const originZ = patchZ * this.patchSize;
    const fx = Math.max(0, Math.min(cells, (worldX - originX) / this.spacing));
    const fz = Math.max(0, Math.min(cells, (worldZ - originZ) / this.spacing));
    const x0 = Math.floor(fx), z0 = Math.floor(fz);
    const x1 = Math.min(cells, x0 + 1), z1 = Math.min(cells, z0 + 1);
    const tx = fx - x0, tz = fz - z0;
    const stride = cells + 1;
    const a = patch.values[z0 * stride + x0] * (1 - tx) + patch.values[z0 * stride + x1] * tx;
    const b = patch.values[z1 * stride + x0] * (1 - tx) + patch.values[z1 * stride + x1] * tx;
    return a * (1 - tz) + b * tz;
  }

  get patchCount(): number {
    return this.patches.size;
  }

  private buildPatch(patchX: number, patchZ: number): Float32Array {
    const cells = this.patchSize / this.spacing;
    const stride = cells + 1;
    const values = new Float32Array(stride * stride);
    const originX = patchX * this.patchSize;
    const originZ = patchZ * this.patchSize;
    for (let z = 0; z <= cells; z++) {
      for (let x = 0; x <= cells; x++) {
        const worldX = originX + x * this.spacing;
        const worldZ = originZ + z * this.spacing;
        const macro = this.sampleMacro(this.worldHeight, worldX, worldZ);
        const baseHeight = macro + sampleLocalTerrainDetail(worldX, worldZ, this.seed, macro);
        values[z * stride + x] = this.modifyHeight(worldX, worldZ, baseHeight);
      }
    }
    return values;
  }

  private evictIfNeeded(): void {
    if (this.patches.size <= this.maxPatches) return;
    let oldestKey = "";
    let oldestUse = Infinity;
    for (const [key, patch] of this.patches) {
      if (patch.lastUse < oldestUse) {
        oldestUse = patch.lastUse;
        oldestKey = key;
      }
    }
    if (oldestKey) this.patches.delete(oldestKey);
  }
}
