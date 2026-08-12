#!/usr/bin/env node
// Converts authored terrain PNGs to GPU-ready KTX2. Install the official
// Khronos KTX-Software package so `toktx` is available on PATH, then place
// tileable sources in assets/terrain/source and run `npm run textures:ktx2`.

import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = path.join(packageRoot, "assets", "terrain", "source");
const outputDir = path.join(packageRoot, "public", "terrain-ktx2");
const sources = existsSync(sourceDir) ? readdirSync(sourceDir).filter((file) => file.toLowerCase().endsWith(".png")) : [];
if (sources.length === 0) {
  console.log(`No PNG sources found in ${sourceDir}; runtime procedural layers remain active.`);
  process.exit(0);
}

const probe = spawnSync("toktx", ["--version"], { encoding: "utf8" });
if (probe.error) throw new Error("toktx was not found. Install Khronos KTX-Software and add it to PATH.");
mkdirSync(outputDir, { recursive: true });

for (const source of sources) {
  const input = path.join(sourceDir, source);
  const output = path.join(outputDir, source.replace(/\.png$/i, ".ktx2"));
  const isNormal = /normal|roughness|height|mask/i.test(source);
  const args = [
    "--t2", "--genmipmap", "--encode", isNormal ? "uastc" : "etc1s",
    "--assign_oetf", isNormal ? "linear" : "srgb",
    ...(isNormal ? ["--uastc_quality", "3"] : ["--clevel", "4", "--qlevel", "192"]),
    output, input,
  ];
  const result = spawnSync("toktx", args, { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`toktx failed for ${source}`);
  console.log(`Wrote ${output}`);
}
