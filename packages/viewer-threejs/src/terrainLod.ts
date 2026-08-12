import type { WorldHeightData } from "./worldData.js";

export interface TerrainTileSpec {
  id: string;
  minX: number;
  minZ: number;
  size: number;
  level: number;
  segments: number;
}

export interface TerrainLodSettings {
  minTileSize: number;
  splitDistance: number;
  maxTiles: number;
}

function distanceToSquare(x: number, z: number, minX: number, minZ: number, size: number): number {
  const dx = Math.max(minX - x, 0, x - (minX + size));
  const dz = Math.max(minZ - z, 0, z - (minZ + size));
  return Math.hypot(dx, dz);
}

function nextPowerOfTwo(value: number): number {
  return 2 ** Math.ceil(Math.log2(value));
}

/**
 * Camera-centered quadtree leaves. Every child remains aligned to its parent,
 * which makes borders deterministic; vertical skirts handle the remaining
 * T-junction between leaves whose resolutions differ by one or more levels.
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
  const leaves = [{ minX: rootMinX, minZ: rootMinZ, size: rootSize }];

  // Refine the nearest eligible leaf first. A depth-first walk can exhaust
  // the tile budget inside whichever far quadrant happened to be pushed
  // last, leaving the player's own leaf coarse despite reporting a 4 m
  // profile. Nearest-first makes the quality guarantee real.
  while (leaves.length + 3 <= settings.maxTiles) {
    let bestIndex = -1;
    let bestPriority = Infinity;
    for (let i = 0; i < leaves.length; i++) {
      const tile = leaves[i];
      if (tile.size <= settings.minTileSize) continue;
      const distance = distanceToSquare(cameraX, cameraZ, tile.minX, tile.minZ, tile.size);
      if (distance >= tile.size * settings.splitDistance) continue;
      const priority = distance / tile.size;
      if (priority < bestPriority || (priority === bestPriority && tile.size > (leaves[bestIndex]?.size ?? 0))) {
        bestPriority = priority;
        bestIndex = i;
      }
    }
    if (bestIndex < 0) break;
    const tile = leaves[bestIndex];
    const half = tile.size * 0.5;
    leaves.splice(bestIndex, 1,
      { minX: tile.minX, minZ: tile.minZ, size: half },
      { minX: tile.minX + half, minZ: tile.minZ, size: half },
      { minX: tile.minX, minZ: tile.minZ + half, size: half },
      { minX: tile.minX + half, minZ: tile.minZ + half, size: half },
    );
  }

  return leaves.map((tile) => {
    const level = Math.max(0, Math.round(Math.log2(tile.size / settings.minTileSize)));
    const segments = level <= 1 ? 64 : level <= 3 ? 32 : 16;
    return {
      ...tile,
      level,
      segments,
      id: `${tile.minX.toFixed(2)}:${tile.minZ.toFixed(2)}:${tile.size.toFixed(2)}:${segments}`,
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
        values[z * stride + x] = macro + sampleLocalTerrainDetail(worldX, worldZ, this.seed, macro);
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
