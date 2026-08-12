import test from "node:test";
import assert from "node:assert/strict";
import { CollisionHeightCache, sampleLocalTerrainDetail, selectTerrainTiles } from "./terrainLod.js";

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
