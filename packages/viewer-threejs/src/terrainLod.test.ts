import test from "node:test";
import assert from "node:assert/strict";
import { CollisionHeightCache, sampleLocalTerrainDetail, selectTerrainTiles, TERRAIN_EDGE } from "./terrainLod.js";

function touching(a: ReturnType<typeof selectTerrainTiles>[number], b: ReturnType<typeof selectTerrainTiles>[number]): boolean {
  const overlapX = Math.min(a.minX + a.size, b.minX + b.size) - Math.max(a.minX, b.minX) > 1e-5;
  const overlapZ = Math.min(a.minZ + a.size, b.minZ + b.size) - Math.max(a.minZ, b.minZ) > 1e-5;
  return (overlapX && (Math.abs(a.minZ - b.minZ - b.size) < 1e-5 || Math.abs(b.minZ - a.minZ - a.size) < 1e-5))
    || (overlapZ && (Math.abs(a.minX - b.minX - b.size) < 1e-5 || Math.abs(b.minX - a.minX - a.size) < 1e-5));
}

test("quadtree selection is bounded and reaches four-meter near spacing", () => {
  const tiles = selectTerrainTiles(
    { minX: -60000, minZ: -60000, maxX: 260000, maxZ: 130000 },
    42000,
    31000,
    { minTileSize: 256, splitDistance: 1.7, maxTiles: 200 },
  );
  assert.ok(tiles.length > 1 && tiles.length <= 200);
  assert.ok(tiles.some((tile) => tile.size === 256 && tile.segments === 64));
  assert.ok(tiles.every((tile) => tile.size / tile.segments >= 4));
  for (let i = 0; i < tiles.length; i++) {
    for (let j = i + 1; j < tiles.length; j++) {
      if (touching(tiles[i], tiles[j])) assert.ok(Math.max(tiles[i].size, tiles[j].size) <= Math.min(tiles[i].size, tiles[j].size) * 2);
    }
  }
  assert.ok(tiles.some((tile) => tile.stitchMask !== 0));
  assert.ok(tiles.every((tile) => tile.stitchRatios.every((ratio, edge) => ratio === 1 || (tile.stitchMask & [TERRAIN_EDGE.MIN_Z, TERRAIN_EDGE.MAX_Z, TERRAIN_EDGE.MIN_X, TERRAIN_EDGE.MAX_X][edge]) !== 0)));
});

test("local terrain detail is deterministic and seed-dependent", () => {
  const a = sampleLocalTerrainDetail(1234.5, 9876.25, 48291, 42);
  const b = sampleLocalTerrainDetail(1234.5, 9876.25, 48291, 42);
  const c = sampleLocalTerrainDetail(1234.5, 9876.25, 48292, 42);
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test("collision heights remain stable and the patch cache stays bounded", () => {
  const worldHeight = {
    data: new Float32Array([0, 0, 0, 0]),
    width: 2,
    height: 2,
    bounds: { minX: 0, minZ: 0, maxX: 1000, maxZ: 1000 },
  };
  const cache = new CollisionHeightCache(worldHeight, 48291, (_height, x, z) => x * 0.01 + z * 0.02, 128, 4, 4);
  const first = cache.sample(12.5, 18.25);
  assert.equal(first, cache.sample(12.5, 18.25));
  for (let i = 0; i < 12; i++) cache.sample(i * 160, i * 160);
  assert.ok(cache.patchCount <= 4);
});
