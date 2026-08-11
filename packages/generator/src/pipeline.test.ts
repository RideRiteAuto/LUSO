import test from "node:test";
import assert from "node:assert/strict";
import { generateWorld } from "./pipeline.js";

function edgeValues(data: Float32Array, width: number, height: number): number[] {
  const values: number[] = [];
  for (let x = 0; x < width; x++) values.push(data[x], data[(height - 1) * width + x]);
  for (let y = 1; y < height - 1; y++) values.push(data[y * width], data[y * width + width - 1]);
  return values;
}

test("same seed produces identical authoritative terrain", () => {
  const a = generateWorld({ seed: 48291, heightmapResolution: 96 });
  const b = generateWorld({ seed: 48291, heightmapResolution: 96 });
  assert.deepEqual(a.worldHeightField.data, b.worldHeightField.data);
  assert.deepEqual(a.roads, b.roads);
  assert.deepEqual(a.resources, b.resources);
});

test("different seeds produce different terrain", () => {
  const a = generateWorld({ seed: 48291, heightmapResolution: 64 });
  const b = generateWorld({ seed: 48292, heightmapResolution: 64 });
  assert.notDeepEqual(a.worldHeightField.data, b.worldHeightField.data);
});

test("Valora and Seradia have distinct macro silhouettes", () => {
  const world = generateWorld({ seed: 48291, heightmapResolution: 128 });
  const signatures = world.manifest.continents.map((continent) => {
    const field = world.heightFields[continent];
    let minX = field.width, maxX = 0, minY = field.height, maxY = 0, land = 0;
    for (let y = 0; y < field.height; y++) {
      for (let x = 0; x < field.width; x++) {
        if (field.data[y * field.width + x] <= 0) continue;
        land++;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
    }
    return { aspect: (maxX - minX + 1) / (maxY - minY + 1), land };
  });
  assert.ok(Math.abs(signatures[0].aspect - signatures[1].aspect) > 0.08, "continent aspect ratios are too similar");
  assert.ok(Math.abs(signatures[0].land - signatures[1].land) > 128, "continent land areas are suspiciously similar");
});

test("world scale and relief meet the regional terrain floor", () => {
  const world = generateWorld({ seed: 48291, heightmapResolution: 192 });
  assert.ok(world.manifest.worldScale.continentTileSize >= 65_536, "continents are smaller than the approved doubled scale");
  for (const continent of world.manifest.continents) {
    const field = world.heightFields[continent];
    let peak = 0;
    let reliefSamples = 0;
    let reliefSum = 0;
    for (let y = 1; y < field.height; y++) {
      for (let x = 1; x < field.width; x++) {
        const i = y * field.width + x;
        if (field.data[i] <= 0) continue;
        peak = Math.max(peak, field.data[i]);
        reliefSum += Math.abs(field.data[i] - field.data[i - 1]);
        reliefSum += Math.abs(field.data[i] - field.data[i - field.width]);
        reliefSamples += 2;
      }
    }
    assert.ok(peak > 2_000, `${continent} lacks major mountain relief`);
    assert.ok(reliefSum / reliefSamples > 20, `${continent} remains excessively smooth`);
  }
});

test("authoritative world boundary is entirely underwater", () => {
  const world = generateWorld({ seed: 48291, heightmapResolution: 96 });
  const { data, width, height } = world.worldHeightField;
  const edges = edgeValues(data, width, height);
  assert.equal(edges.filter((v) => v >= 0).length, 0, "positive land reached the external world boundary");
  assert.ok(Math.max(...edges) < -10, "world boundary lacks a safe bathymetric margin");
});

test("unresolved drainage pits are not rendered as fake ponds", () => {
  const world = generateWorld({ seed: 48291, heightmapResolution: 128 });
  for (const continent of world.manifest.continents) {
    assert.equal(world.water[continent].lakes.length, 0);
    assert.ok(world.water[continent].rivers.every((river) => river.terminatesIn.type === "ocean"));
  }
});

test("resources never duplicate a cell and ecology respects settlements", () => {
  const world = generateWorld({ seed: 48291, heightmapResolution: 96 });
  for (const resource of world.resources) {
    const keys = resource.instances.map((i) => `${i.zoneId}:${i.position[0]}:${i.position[1]}`);
    assert.equal(new Set(keys).size, keys.length, `${resource.resourceId} contains duplicate cells`);
  }
  const tileSize = world.manifest.worldScale.continentTileSize;
  for (const spawn of world.spawns) {
    for (const point of spawn.region) {
      for (const settlement of world.settlements.filter((s) => s.zoneId === spawn.zoneId)) {
        const distance = Math.hypot(point[0] - settlement.position[0], point[1] - settlement.position[1]) * tileSize;
        assert.ok(distance >= spawn.minDistanceFromSettlementM, `${spawn.creatureId} overlaps ${settlement.id}`);
      }
    }
  }
});
