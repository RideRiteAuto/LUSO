#!/usr/bin/env node
// Reproducible CC0 terrain-material intake from Poly Haven's public API.

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = path.join(packageRoot, "assets", "terrain", "source");
const resolution = process.argv.includes("--2k") ? "2k" : "1k";
const assets = {
  grass: "sparse_grass",
  soil: "brown_mud",
  forest: "forrest_ground_01",
  sand: "aerial_beach_01",
  rock: "aerial_rocks_02",
  scree: "rocky_terrain_02",
  snow: "snow_02",
};
const channels = {
  albedo: ["Diffuse", "jpg"],
  normal: ["nor_gl", "jpg"],
  roughness: ["Rough", "jpg"],
};
const headers = { "User-Agent": "NavoraTerrainPipeline/1.0 (RideRiteAuto/LUSO)" };
const provenance = { source: "Poly Haven", license: "CC0", api: "https://api.polyhaven.com", resolution, assets: {} };

await mkdir(outputRoot, { recursive: true });
for (const [role, assetId] of Object.entries(assets)) {
  const response = await fetch(`https://api.polyhaven.com/files/${assetId}`, { headers });
  if (!response.ok) throw new Error(`Poly Haven metadata failed for ${assetId}: ${response.status}`);
  const files = await response.json();
  provenance.assets[role] = { id: assetId, url: `https://polyhaven.com/a/${assetId}`, files: {} };
  for (const [channel, [mapName, extension]] of Object.entries(channels)) {
    const record = files?.[mapName]?.[resolution]?.[extension];
    if (!record?.url) throw new Error(`${assetId} has no ${mapName}/${resolution}/${extension}`);
    const binaryResponse = await fetch(record.url, { headers });
    if (!binaryResponse.ok) throw new Error(`Download failed: ${record.url}`);
    const bytes = new Uint8Array(await binaryResponse.arrayBuffer());
    const filename = `${role}_${channel}_${resolution}.${extension}`;
    await writeFile(path.join(outputRoot, filename), bytes);
    provenance.assets[role].files[channel] = {
      filename,
      sourceUrl: record.url,
      sourceMd5: record.md5,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.length,
    };
    console.log(`Downloaded ${filename} (${(bytes.length / 1048576).toFixed(2)} MB)`);
  }
}
await writeFile(path.join(outputRoot, "PROVENANCE.json"), `${JSON.stringify(provenance, null, 2)}\n`);
