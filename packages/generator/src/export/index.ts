// Stage 14 (docs/01 §14, docs/02): export.
// Writes the 8+1 output files under output/<seed>/. Implementation note vs.
// the schema doc: heightmap.png and biome_map.png are written as 8-bit RGBA
// PNGs (pngjs's reliable high-level API) rather than 16-bit/indexed —
// heightmap.raw (float32) remains the lossless, authoritative elevation
// export the doc calls for; the PNGs exist purely for quick visual QA.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import { BIOMES } from "../biomes/palette.js";
import { GEOLOGY_CLASSES, SOIL_CLASSES, WEATHER_REGION_CLASSES, ZONE_CLASSES } from "../environment/index.js";
import type { WorldOutput, ContinentId, EnvironmentalFields } from "../types/index.js";

type ControlFieldKind = "continuous" | "category";
interface ControlChannelSpec {
  field: string;
  kind: ControlFieldKind;
  min: number;
  max: number;
  labels?: readonly string[];
  values: (environment: EnvironmentalFields, biome: WorldOutput["biomeFields"][ContinentId]) => Float32Array | null;
}
interface ControlPackSpec { id: string; channels: [ControlChannelSpec, ControlChannelSpec, ControlChannelSpec, ControlChannelSpec]; }

const continuous = (
  field: string,
  min: number,
  max: number,
  values: ControlChannelSpec["values"],
): ControlChannelSpec => ({ field, kind: "continuous", min, max, values });
const category = (
  field: string,
  labels: readonly string[],
  values: ControlChannelSpec["values"],
): ControlChannelSpec => ({ field, kind: "category", min: 0, max: labels.length - 1, labels, values });

const CONTROL_PACKS: ControlPackSpec[] = [
  { id: "climate", channels: [
    continuous("temperature-c", -30, 40, (environment) => environment.temperatureC.data),
    continuous("precipitation", 0, 1, (environment) => environment.precipitation.data),
    continuous("moisture", 0, 1, (environment) => environment.moisture.data),
    continuous("wetness", 0, 1, (environment) => environment.wetness.data),
  ] },
  { id: "hydrology", channels: [
    continuous("drainage", 0, 1, (environment) => environment.drainage.data),
    continuous("distance-to-water-m", 0, 20000, (environment) => environment.distanceToWaterM.data),
    continuous("shoreline-influence", 0, 1, (environment) => environment.shorelineInfluence.data),
    continuous("slope-degrees", 0, 60, (environment) => environment.slopeDegrees.data),
  ] },
  { id: "terrain", channels: [
    category("soil-class", SOIL_CLASSES, (environment) => environment.soilClass.data),
    category("geology-class", GEOLOGY_CLASSES, (environment) => environment.geologyClass.data),
    continuous("exposure", 0, 1, (environment) => environment.exposure.data),
    continuous("erosion-scree", 0, 1, (environment) => environment.erosionScree.data),
  ] },
  { id: "ecology", channels: [
    continuous("buildability", 0, 1, (environment) => environment.buildability.data),
    continuous("vegetation-eligibility", 0, 1, (environment) => environment.vegetationEligibility.data),
    category("biome-class", BIOMES.map((biome) => biome.id), (_environment, biome) => biome.data),
    category("weather-region", WEATHER_REGION_CLASSES, (environment) => environment.weatherRegionClass.data),
  ] },
  { id: "resources", channels: [
    continuous("resource-forest", 0, 1, (environment) => environment.resources.forest.data),
    continuous("resource-forage", 0, 1, (environment) => environment.resources.forage.data),
    continuous("resource-ore", 0, 1, (environment) => environment.resources.ore.data),
    continuous("resource-stone", 0, 1, (environment) => environment.resources.stone.data),
  ] },
  { id: "habitat", channels: [
    continuous("resource-reeds", 0, 1, (environment) => environment.resources.reeds.data),
    continuous("resource-aquatic", 0, 1, (environment) => environment.resources.aquatic.data),
    continuous("resource-generic", 0, 1, (environment) => environment.resources.generic.data),
    category("zone-class", ZONE_CLASSES, (environment) => environment.zoneClass.data),
  ] },
];

function writeHeightmapPng(outDir: string, continent: ContinentId, height: WorldOutput["heightFields"][ContinentId]) {
  const { width, height: h, data } = height;
  // Land and ocean are normalized independently (land -> [128,255], ocean ->
  // [0,127]) so both bands get visible contrast — a single global min/max
  // would compress land detail into a sliver near white, since ocean depth
  // (~-3500m) dwarfs the land elevation range (~0-2400m).
  let landMax = 1;
  let oceanMin = -1;
  for (const v of data) {
    if (v > 0 && v > landMax) landMax = v;
    if (v <= 0 && v < oceanMin) oceanMin = v;
  }

  const png = new PNG({ width, height: h });
  for (let i = 0; i < width * h; i++) {
    const v = data[i];
    // Mild gamma (v^0.6) on the land band so mid-elevation terrain — most of
    // any given zone — doesn't visually wash out under a long high-mountain tail.
    const norm =
      v > 0
        ? 128 + Math.round(Math.pow(v / landMax, 0.6) * 127)
        : Math.round((1 - v / oceanMin) * 127);
    const o = i * 4;
    png.data[o] = norm;
    png.data[o + 1] = norm;
    png.data[o + 2] = norm;
    png.data[o + 3] = 255;
  }
  writeFileSync(path.join(outDir, `heightmap.${continent}.png`), PNG.sync.write(png));

  // Lossless float32 companion, row-major, little-endian, no header.
  const raw = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  writeFileSync(path.join(outDir, `heightmap.${continent}.raw`), raw);
}

/** The unified world field (docs/01 §3 stage 3) -- mostly ocean by area, so normalize purely by the land/ocean split like writeHeightmapPng, and write the lossless raw buffer the viewer's seabed mesh actually reads. */
function writeWorldHeightmap(outDir: string, height: WorldOutput["worldHeightField"]) {
  const { width, height: h, data } = height;
  let landMax = 1;
  let oceanMin = -1;
  for (const v of data) {
    if (v > 0 && v > landMax) landMax = v;
    if (v <= 0 && v < oceanMin) oceanMin = v;
  }

  const png = new PNG({ width, height: h });
  for (let i = 0; i < width * h; i++) {
    const v = data[i];
    const norm = v > 0 ? 128 + Math.round(Math.pow(v / landMax, 0.6) * 127) : Math.round((1 - v / oceanMin) * 127);
    const o = i * 4;
    png.data[o] = norm;
    png.data[o + 1] = norm;
    png.data[o + 2] = norm;
    png.data[o + 3] = 255;
  }
  writeFileSync(path.join(outDir, "heightmap.world.png"), PNG.sync.write(png));

  const raw = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  writeFileSync(path.join(outDir, "heightmap.world.raw"), raw);
}

function writeBiomeMapPng(outDir: string, continent: ContinentId, biomes: WorldOutput["biomeFields"][ContinentId]) {
  const { width, height: h, data } = biomes;
  const png = new PNG({ width, height: h });
  for (let i = 0; i < width * h; i++) {
    const biome = BIOMES[data[i]] ?? BIOMES[0];
    const o = i * 4;
    png.data[o] = biome.color[0];
    png.data[o + 1] = biome.color[1];
    png.data[o + 2] = biome.color[2];
    png.data[o + 3] = 255;
  }
  writeFileSync(path.join(outDir, `biome_map.${continent}.png`), PNG.sync.write(png));
}

function writeControlFields(outDir: string, output: WorldOutput): void {
  const continents: Record<string, { width: number; height: number; files: Record<string, string> }> = {};
  for (const continent of output.manifest.continents) {
    const environment = output.environmentalFields[continent];
    const biome = output.biomeFields[continent];
    const { width, height } = environment.moisture;
    const files: Record<string, string> = {};
    for (const pack of CONTROL_PACKS) {
      const bytes = new Uint8Array(width * height * 4);
      for (let channelIndex = 0; channelIndex < 4; channelIndex++) {
        const channel = pack.channels[channelIndex];
        const values = channel.values(environment, biome);
        if (!values) continue;
        if (values.length !== width * height) throw new Error(`${continent}/${channel.field} has invalid dimensions`);
        const span = Math.max(0.000001, channel.max - channel.min);
        for (let i = 0; i < values.length; i++) {
          const normalized = Math.max(0, Math.min(1, (values[i] - channel.min) / span));
          bytes[i * 4 + channelIndex] = Math.round(normalized * 255);
        }
      }
      const file = `control.${continent}.${pack.id}.rgba`;
      writeFileSync(path.join(outDir, file), bytes);
      files[pack.id] = file;
    }
    continents[continent] = { width, height, files };
  }
  const manifest = {
    version: 1,
    encoding: "rgba8",
    packs: CONTROL_PACKS.map((pack) => ({
      id: pack.id,
      channels: pack.channels.map(({ values: _values, ...channel }) => channel),
    })),
    continents,
  };
  writeFileSync(path.join(outDir, "controlFields.json"), JSON.stringify(manifest, null, 2));
}

export function writeWorldOutput(output: WorldOutput, outputRootDir: string) {
  const outDir = path.join(outputRootDir, String(output.manifest.seed));
  mkdirSync(outDir, { recursive: true });

  for (const continent of output.manifest.continents) {
    writeHeightmapPng(outDir, continent, output.heightFields[continent]);
    writeBiomeMapPng(outDir, continent, output.biomeFields[continent]);
  }
  writeControlFields(outDir, output);
  writeWorldHeightmap(outDir, output.worldHeightField);

  const waterways = {
    oceanLevelM: 0,
    continents: Object.fromEntries(
      output.manifest.continents.map((c) => [c, {
        rivers: output.water[c].rivers,
        lakes: output.water[c].lakes,
        waterways: output.water[c].waterways,
      }])
    ),
  };

  writeFileSync(path.join(outDir, "waterways.json"), JSON.stringify(waterways, null, 2));
  writeFileSync(path.join(outDir, "zones.json"), JSON.stringify({ zones: output.zones }, null, 2));
  writeFileSync(path.join(outDir, "resources.json"), JSON.stringify({ resources: output.resources }, null, 2));
  writeFileSync(path.join(outDir, "spawns.json"), JSON.stringify({ spawnRegions: output.spawns }, null, 2));
  writeFileSync(
    path.join(outDir, "roads.json"),
    JSON.stringify({ roads: output.roads, seaRoutes: output.seaRoutes }, null, 2)
  );
  writeFileSync(
    path.join(outDir, "poi.json"),
    JSON.stringify(
      {
        settlements: output.settlements,
        landmarks: output.landmarks,
        ruinsAndDungeons: [],
      },
      null,
      2
    )
  );
  writeFileSync(path.join(outDir, "seaRegions.json"), JSON.stringify({ regions: output.seaRegions }, null, 2));
  writeFileSync(path.join(outDir, "terrainMaterials.json"), JSON.stringify(output.terrainMaterialLibrary, null, 2));
  writeFileSync(path.join(outDir, "terrainMaterialRecipes.json"), JSON.stringify(output.terrainMaterialRecipes, null, 2));
  writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(output.manifest, null, 2));

  return outDir;
}
