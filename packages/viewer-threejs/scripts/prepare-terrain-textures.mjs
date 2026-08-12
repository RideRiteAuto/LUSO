#!/usr/bin/env node
// Converts the reviewed Poly Haven JPEG sources to browser-universal KTX2.
// Albedo uses high-quality ETC1S; normals use UASTC; scalar roughness maps
// use linear ETC1S. Every output includes a complete mip chain.

import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "..", "..");
const sourceDir = path.join(packageRoot, "assets", "terrain", "source");
const outputDir = path.join(packageRoot, "public", "terrain-ktx2");
const basisDir = path.join(packageRoot, "public", "basis");
const basisExecutable = path.join(repoRoot, "node_modules", "basis_universal", "bin", "basisu.exe");
if (!existsSync(basisExecutable)) throw new Error("Run npm install first; basis_universal is required.");

const required = new Set([
  "sand_albedo", "sand_normal", "sand_roughness",
  "grass_albedo", "grass_normal", "grass_roughness",
  "soil_albedo", "soil_normal", "forest_albedo",
  "rock_albedo", "rock_normal", "rock_roughness",
  "scree_albedo", "snow_albedo", "snow_normal",
]);
const sources = existsSync(sourceDir)
  ? readdirSync(sourceDir).filter((file) => file.endsWith("_2k.jpg") && required.has(file.replace(/_2k\.jpg$/i, "")))
  : [];
if (sources.length === 0) throw new Error(`No reviewed 2K JPEG sources found in ${sourceDir}. Run npm run textures:download first.`);
mkdirSync(outputDir, { recursive: true });

for (const source of sources) {
  const input = path.join(sourceDir, source);
  const output = path.join(outputDir, source.replace(/_2k\.jpg$/i, ".ktx2"));
  if (existsSync(output)) {
    console.log(`Keeping existing ${path.basename(output)}`);
    continue;
  }
  const isNormal = source.includes("_normal_");
  const isLinear = isNormal || source.includes("_roughness_");
  const args = ["-ktx2", "-mipmap", "-mip_filter", "kaiser", "-file", input, "-output_file", output];
  if (isNormal) args.push("-uastc", "-uastc_level", "2", "-uastc_rdo_l", "0.75", "-normal_map", "-mip_renorm");
  else args.push("-q", "255", "-comp_level", "3", ...(isLinear ? ["-linear", "-mip_linear"] : ["-mip_srgb"]));
  const result = spawnSync(basisExecutable, args, { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`Basis Universal failed for ${source}`);
}

// Three's KTX2Loader runs the official Basis transcoder in a worker.
const threeBasis = path.join(repoRoot, "node_modules", "three", "examples", "jsm", "libs", "basis");
mkdirSync(basisDir, { recursive: true });
for (const filename of ["basis_transcoder.js", "basis_transcoder.wasm"]) {
  copyFileSync(path.join(threeBasis, filename), path.join(basisDir, filename));
}
console.log(`Wrote ${sources.length} KTX2 textures and Basis transcoder assets.`);
