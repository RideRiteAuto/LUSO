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

test("lakes are filled basins with spill outlets and all rivers terminate in canonical water", () => {
  const world = generateWorld({ seed: 48291, heightmapResolution: 128 });
  assert.ok(world.water.seradia.lakes.length >= 1, "Vidrala lacks its authored Glassmere basin");
  for (const continent of world.manifest.continents) {
    for (const lake of world.water[continent].lakes) {
      assert.ok(lake.polygon.length >= 3, `${lake.id} lacks a shoreline`);
      assert.ok(lake.depthM >= 10, `${lake.id} is a noise cup, not a lake basin`);
      assert.ok(lake.surfaceElevationM > 0 && lake.spillElevationM === lake.surfaceElevationM, `${lake.id} lacks a valid spill level`);
      assert.ok(lake.outlet.every((coordinate) => coordinate >= 0 && coordinate <= 1), `${lake.id} has an invalid outlet`);
      assert.ok(world.water[continent].rivers.some((river) => river.mouthKind === "lake-outlet" && Math.abs(river.sourceElevationM - lake.surfaceElevationM) < 0.1), `${lake.id} has no compiled outlet river`);
    }
    for (const river of world.water[continent].rivers) {
      assert.ok(
        river.terminatesIn.type === "ocean"
        || world.water[continent].lakes.some((lake) => lake.id === river.terminatesIn.featureId)
        || world.water[continent].rivers.some((candidate) => candidate.id === river.terminatesIn.featureId),
      );
      assert.equal(river.path.length, river.surfaceElevationM.length);
      assert.ok(river.profile.widthM[1] >= 100, `${river.id} cannot grow into a credible channel`);
      assert.ok(river.profile.depthM[1] >= 6, `${river.id} lacks a fish/boat-scale lower channel`);
      if (river.mouthKind === "estuary") {
        assert.ok(river.profile.widthM[1] >= 400, `${river.id} estuary is not ship-scale`);
        assert.ok(river.profile.depthM[1] >= 14, `${river.id} estuary lacks a navigable bed`);
      }
      if (river.mouthKind === "delta") {
        assert.ok(river.profile.widthM[1] >= 500, `${river.id} delta is not ship-scale`);
        assert.ok(river.profile.depthM[1] >= 16, `${river.id} delta lacks a navigable bed`);
      }
      for (let i = 1; i < river.surfaceElevationM.length; i++) {
        assert.ok(river.surfaceElevationM[i] <= river.surfaceElevationM[i - 1] + 0.001, `${river.id} flows uphill`);
      }
      const sampleIndex = Math.max(1, Math.min(river.path.length - 2, Math.floor(river.path.length * 0.65)));
      const [u, v] = river.path[sampleIndex];
      const field = world.heightFields[continent];
      const x = Math.round(u * (field.width - 1)), y = Math.round(v * (field.height - 1));
      const bed = field.data[y * field.width + x];
      assert.ok(bed < river.surfaceElevationM[sampleIndex] - 0.5, `${river.id} surface is not backed by a carved riverbed`);
    }
  }
});

test("bathymetry contains navigable shallows, shelves, a deep Luna Sea, and the Bruma hook", () => {
  const world = generateWorld({ seed: 48291, heightmapResolution: 128 });
  let shallows = 0, shelves = 0, deep = 0, minimum = 0;
  for (const elevation of world.worldHeightField.data) {
    minimum = Math.min(minimum, elevation);
    if (elevation < 0 && elevation >= -80) shallows++;
    else if (elevation < -80 && elevation >= -700) shelves++;
    else if (elevation <= -2_800) deep++;
  }
  assert.ok(shallows > 250, "coasts lack navigable shallows");
  assert.ok(shelves > 1_000, "continental shelves are underdeveloped");
  assert.ok(deep > 500, "the Luna Sea lacks deep-water area");
  assert.ok(minimum < -4_000, "the trench/Bruma depth hook is missing");
  const bruma = world.seaRegions[0];
  const { data, width, height } = world.worldHeightField;
  const bounds = world.worldBounds;
  const bx = Math.round((bruma.center[0] - bounds.minX) / (bounds.maxX - bounds.minX) * (width - 1));
  const by = Math.round((bruma.center[1] - bounds.minZ) / (bounds.maxZ - bounds.minZ) * (height - 1));
  assert.ok(data[by * width + bx] < -3_800, "Bruma is not represented in authoritative bathymetry");
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
