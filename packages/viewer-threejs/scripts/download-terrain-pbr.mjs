#!/usr/bin/env node
// Reproducible CC0 terrain-material intake from Poly Haven's public API.

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = path.join(packageRoot, "assets", "terrain", "source");
const resolution = process.argv.includes("--2k") ? "2k" : "1k";
const assets = {
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
const provenance = { source: "Poly Haven + ambientCG", license: "CC0", resolution, assets: {} };

await mkdir(outputRoot, { recursive: true });

// Grass001 is a genuinely green meadow-floor set. The former sparse-grass
// scan was technically detailed but predominantly exposed brown soil.
const ambientResolution = resolution.toUpperCase();
const grassArchiveUrl = `https://ambientcg.com/get?file=Grass001_${ambientResolution}-JPG.zip`;
const grassArchiveResponse = await fetch(grassArchiveUrl, { headers });
if (!grassArchiveResponse.ok) throw new Error(`ambientCG download failed: ${grassArchiveResponse.status}`);
const grassArchive = new Uint8Array(await grassArchiveResponse.arrayBuffer());
const grassFiles = unzipSync(grassArchive);
const ambientChannels = {
  albedo: `Grass001_${ambientResolution}-JPG_Color.jpg`,
  normal: `Grass001_${ambientResolution}-JPG_NormalGL.jpg`,
  roughness: `Grass001_${ambientResolution}-JPG_Roughness.jpg`,
};
provenance.assets.grass = {
  id: "Grass001",
  provider: "ambientCG",
  url: "https://ambientcg.com/view?id=Grass001",
  archiveUrl: grassArchiveResponse.url,
  dimensionsMeters: [1.4, 1.4],
  files: {},
};
for (const [channel, archivedFilename] of Object.entries(ambientChannels)) {
  const bytes = grassFiles[archivedFilename];
  if (!bytes) throw new Error(`Grass001 archive is missing ${archivedFilename}`);
  const filename = `grass_${channel}_${resolution}.jpg`;
  await writeFile(path.join(outputRoot, filename), bytes);
  provenance.assets.grass.files[channel] = {
    filename,
    archivedFilename,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.length,
  };
  console.log(`Downloaded ${filename} (${(bytes.length / 1048576).toFixed(2)} MB)`);
}

for (const [role, assetId] of Object.entries(assets)) {
  const response = await fetch(`https://api.polyhaven.com/files/${assetId}`, { headers });
  if (!response.ok) throw new Error(`Poly Haven metadata failed for ${assetId}: ${response.status}`);
  const files = await response.json();
  provenance.assets[role] = { id: assetId, provider: "Poly Haven", url: `https://polyhaven.com/a/${assetId}`, files: {} };
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
