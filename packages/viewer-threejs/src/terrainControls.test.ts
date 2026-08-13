import test from "node:test";
import assert from "node:assert/strict";
import { buildTerrainControlMap } from "./terrain.js";
import type { WorldData } from "./worldData.js";

test("terrain control reprojection preserves compiler pack order and bytes", () => {
  const packIds = ["climate", "hydrology", "terrain", "ecology", "resources", "habitat"];
  const controlPacks = packIds.map((_id, pack) => new Uint8Array(Array.from({ length: 16 }, (_, index) => pack * 24 + index)));
  const world = {
    manifest: {
      seed: 1,
      generatorVersion: "test",
      generatedAt: "test",
      worldScale: { continentTileSize: 100, heightmapResolution: 2 },
      continents: ["valora"],
      continentLayout: { valora: { worldOffset: [0, 0] } },
      worldHeightmap: { width: 2, height: 2, bounds: { minX: 0, minZ: 0, maxX: 100, maxZ: 100 } },
    },
    continents: {
      valora: { controlWidth: 2, controlHeight: 2, controlPacks },
    },
    controlFields: {
      version: 1,
      encoding: "rgba8",
      packs: packIds.map((id) => ({ id, channels: [] })),
      continents: { valora: { width: 2, height: 2, files: {} } },
    },
    worldHeight: { width: 2, height: 2, bounds: { minX: 0, minZ: 0, maxX: 100, maxZ: 100 }, data: new Float32Array([1, 1, 1, 1]) },
  } as unknown as WorldData;

  const result = buildTerrainControlMap(world, 2);
  assert.deepEqual([result.width, result.height, result.packCount], [2, 2, 6]);
  assert.deepEqual([...result.data.slice(0, 24)], packIds.flatMap((_id, pack) => [...controlPacks[pack].slice(0, 4)]));
  assert.deepEqual([...result.data.slice(72, 96)], packIds.flatMap((_id, pack) => [...controlPacks[pack].slice(12, 16)]));
});
