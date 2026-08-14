import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import * as THREE from "three/webgpu";
import { buildRiverChannelField, sampleRiverCarvedHeight } from "./riverChannelField.js";
import { sampleHeightWithSkirt } from "./terrain.js";
import { sampleLocalTerrainDetail } from "./terrainLod.js";
import { findSafeReviewYardPoint, findSafeTraversalPoint } from "./traversalSpawns.js";
import { uvToWorld } from "./layout.js";
import { NavoraWaterSystem } from "./waterSystem.js";
import type { WorldData, ZoneRecord } from "./worldData.js";

test("generated seed keeps the complete resource yard and house footprint dry", async (t) => {
  const outputDir = path.resolve("output/48291");
  if (!existsSync(path.join(outputDir, "manifest.json"))) {
    t.skip("output/48291 is regenerable and is not present in this checkout");
    return;
  }
  const json = async <T>(name: string): Promise<T> => JSON.parse(await readFile(path.join(outputDir, name), "utf8")) as T;
  const manifest = await json<WorldData["manifest"]>("manifest.json");
  const zones = (await json<{ zones: ZoneRecord[] }>("zones.json")).zones;
  const waterways = await json<{ continents: Record<string, Pick<WorldData["continents"][string], "rivers" | "lakes" | "waterways">> }>("waterways.json");
  const worldBytes = await readFile(path.join(outputDir, "heightmap.world.raw"));
  const worldHeightData = new Float32Array(worldBytes.buffer, worldBytes.byteOffset, worldBytes.byteLength / 4).slice();
  const continents: WorldData["continents"] = {};
  for (const id of manifest.continents) {
    const heightBytes = await readFile(path.join(outputDir, `heightmap.${id}.raw`));
    continents[id] = {
      id,
      heightData: new Float32Array(heightBytes.buffer, heightBytes.byteOffset, heightBytes.byteLength / 4).slice(),
      resolution: manifest.worldScale.heightmapResolution,
      biomeImage: null as unknown as HTMLImageElement,
      rivers: waterways.continents[id]?.rivers ?? [], lakes: waterways.continents[id]?.lakes ?? [], waterways: waterways.continents[id]?.waterways ?? [],
      roads: [], controlWidth: 0, controlHeight: 0, controlPacks: [],
    };
  }
  const world = {
    manifest, zones, continents,
    worldHeight: { data: worldHeightData, width: manifest.worldHeightmap.width, height: manifest.worldHeightmap.height, bounds: manifest.worldHeightmap.bounds },
    settlements: [], seaRegions: [], controlFields: { packs: [], continents: {} }, terrainMaterialLibrary: {}, terrainMaterialRecipes: {},
  } as unknown as WorldData;
  const riverChannels = buildRiverChannelField(world);
  const sampleGround = (x: number, z: number) => {
    const macro = sampleHeightWithSkirt(world.worldHeight, x, z);
    return sampleRiverCarvedHeight(riverChannels, x, z, macro + sampleLocalTerrainDetail(x, z, manifest.seed, macro));
  };
  const water = new NavoraWaterSystem(world, "compatibility", new THREE.Vector3(0.4, 0.8, 0.3).normalize());
  const isWater = (x: number, z: number) => water.sample(x, z, 0) !== null;
  const alvora = zones.find((zone) => zone.id === "alvora");
  assert.ok(alvora);
  const u = alvora.boundary.reduce((sum, point) => sum + point[0], 0) / alvora.boundary.length;
  const v = alvora.boundary.reduce((sum, point) => sum + point[1], 0) / alvora.boundary.length;
  const [centerX, centerZ] = uvToWorld(u, v, alvora.continent, manifest);
  const alvoraSafe = findSafeTraversalPoint(sampleGround, centerX, centerZ);
  const review = findSafeReviewYardPoint(sampleGround, isWater, alvoraSafe.x + 180, alvoraSafe.z + 120);
  const yardHeights: number[] = [];
  let wetSamples = 0;
  for (let z = -92; z <= 8; z += 10) for (let x = -36; x <= 46; x += 10) {
    yardHeights.push(sampleGround(review.x + x, review.z + z));
    if (isWater(review.x + x, review.z + z)) wetSamples++;
  }
  const houseHeights = [-10, 0, 10].flatMap((x) => [-90, -80, -70].map((z) => sampleGround(review.x + x, review.z + z)));
  const report = {
    generatedAt: manifest.generatedAt, anchor: review, wetSamples,
    minimumGroundM: Math.min(...yardHeights), maximumGroundM: Math.max(...yardHeights),
    houseFootprintReliefM: Math.max(...houseHeights) - Math.min(...houseHeights),
  };
  water.dispose();
  t.diagnostic(JSON.stringify(report));
  assert.equal(wetSamples, 0);
  assert.ok(report.minimumGroundM >= 5);
  assert.ok(report.houseFootprintReliefM <= 1.35);
});
