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
import type { WorldOutput, ContinentId } from "../types/index.js";

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

export function writeWorldOutput(output: WorldOutput, outputRootDir: string) {
  const outDir = path.join(outputRootDir, String(output.manifest.seed));
  mkdirSync(outDir, { recursive: true });

  for (const continent of output.manifest.continents) {
    writeHeightmapPng(outDir, continent, output.heightFields[continent]);
    writeBiomeMapPng(outDir, continent, output.biomeFields[continent]);
  }

  const waterways = {
    oceanLevelM: 0,
    continents: Object.fromEntries(
      output.manifest.continents.map((c) => [c, { rivers: output.water[c].rivers, lakes: output.water[c].lakes }])
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
  writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(output.manifest, null, 2));

  return outDir;
}
