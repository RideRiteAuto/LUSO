import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { generateWorld } from "./pipeline.js";
import { writeWorldOutput } from "./export/index.js";
import { GEOLOGY_CLASSES, SOIL_CLASSES, WEATHER_REGION_CLASSES } from "./environment/index.js";

function assertRange(label: string, values: Float32Array, min: number, max: number): void {
  let actualMin = Number.POSITIVE_INFINITY, actualMax = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    assert.ok(Number.isFinite(value), `${label} contains an invalid value`);
    actualMin = Math.min(actualMin, value);
    actualMax = Math.max(actualMax, value);
    assert.ok(value >= min && value <= max, `${label} value ${value} is outside [${min}, ${max}]`);
  }
  assert.ok(actualMax > actualMin, `${label} should not be constant`);
}

test("compiler environmental truth is finite, bounded, and ecologically varied", () => {
  const world = generateWorld({ seed: 48291, heightmapResolution: 96 });
  for (const continent of world.manifest.continents) {
    const fields = world.environmentalFields[continent];
    assertRange(`${continent}.temperature`, fields.temperatureC.data, -30, 40);
    for (const [name, field] of Object.entries({
      precipitation: fields.precipitation,
      moisture: fields.moisture,
      wetness: fields.wetness,
      drainage: fields.drainage,
      shoreline: fields.shorelineInfluence,
      exposure: fields.exposure,
      scree: fields.erosionScree,
      buildability: fields.buildability,
      vegetation: fields.vegetationEligibility,
      forest: fields.resources.forest,
      forage: fields.resources.forage,
      ore: fields.resources.ore,
      stone: fields.resources.stone,
      reeds: fields.resources.reeds,
      aquatic: fields.resources.aquatic,
      generic: fields.resources.generic,
    })) assertRange(`${continent}.${name}`, field.data, 0, 1);
    assertRange(`${continent}.distanceToWater`, fields.distanceToWaterM.data, 0, world.manifest.worldScale.continentTileSize * 2);
    assertRange(`${continent}.slope`, fields.slopeDegrees.data, 0, 90);
    for (const [name, values, classCount] of [
      ["soil", fields.soilClass.data, SOIL_CLASSES.length],
      ["geology", fields.geologyClass.data, GEOLOGY_CLASSES.length],
      ["weather", fields.weatherRegionClass.data, WEATHER_REGION_CLASSES.length],
    ] as const) for (const value of values) {
      assert.ok(Number.isInteger(value), `${continent}.${name} must contain integer class IDs`);
      assert.ok(value >= 0 && value < classCount, `${continent}.${name} class ${value} is invalid`);
    }
  }
});

test("compiler environmental truth is deterministic per seed", () => {
  const first = generateWorld({ seed: 71933, heightmapResolution: 64 });
  const second = generateWorld({ seed: 71933, heightmapResolution: 64 });
  for (const continent of first.manifest.continents) {
    const a = first.environmentalFields[continent];
    const b = second.environmentalFields[continent];
    for (const key of ["temperatureC", "precipitation", "moisture", "wetness", "drainage", "distanceToWaterM", "shorelineInfluence", "slopeDegrees", "exposure", "erosionScree", "buildability", "vegetationEligibility", "soilClass", "geologyClass", "weatherRegionClass"] as const) {
      assert.deepEqual(a[key].data, b[key].data, `${continent}.${key} changed for the same seed`);
    }
    for (const key of ["forest", "forage", "ore", "stone", "reeds", "aquatic", "generic"] as const) {
      assert.deepEqual(a.resources[key].data, b.resources[key].data, `${continent}.resources.${key} changed for the same seed`);
    }
  }
});

test("control-map export is versioned, complete, and dimensionally valid", () => {
  const root = mkdtempSync(path.join(tmpdir(), "navora-controls-"));
  try {
    const output = generateWorld({ seed: 48291, heightmapResolution: 48 });
    const outDir = writeWorldOutput(output, root);
    const manifest = JSON.parse(readFileSync(path.join(outDir, "controlFields.json"), "utf8")) as {
      version: number;
      encoding: string;
      packs: { id: string; channels: { field: string }[] }[];
      continents: Record<string, { width: number; height: number; files: Record<string, string> }>;
    };
    assert.equal(manifest.version, 1);
    assert.equal(manifest.encoding, "rgba8");
    assert.equal(manifest.packs.length, 6);
    assert.ok(manifest.packs.every((pack) => pack.channels.length === 4));
    for (const continent of output.manifest.continents) {
      const record = manifest.continents[continent];
      assert.deepEqual([record.width, record.height], [48, 48]);
      for (const pack of manifest.packs) {
        const file = record.files[pack.id];
        assert.ok(file, `${continent}/${pack.id} is missing from the manifest`);
        assert.equal(statSync(path.join(outDir, file)).size, 48 * 48 * 4);
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
