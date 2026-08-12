#!/usr/bin/env node
// Builds one self-contained inspector from the same HTML shell and TypeScript
// entry point used by Vite. Keeping a second hand-copied HUD here previously
// made standalone artifacts silently lose controls and diagnostics.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");

const seed = process.argv.includes("--seed")
  ? Number(process.argv[process.argv.indexOf("--seed") + 1])
  : 48291;
const outputDir = path.join(repoRoot, "output", String(seed));

function readJson(name) {
  return JSON.parse(readFileSync(path.join(outputDir, name), "utf-8"));
}

function readBase64(name) {
  return readFileSync(path.join(outputDir, name)).toString("base64");
}

function readTerrainTexture(layer, channel) {
  const file = path.join(packageRoot, "assets", "terrain", "source", `${layer}_${channel}_2k.jpg`);
  return `data:image/jpeg;base64,${readFileSync(file).toString("base64")}`;
}

console.log(`Building artifact for seed ${seed} from ${outputDir}`);

const manifest = readJson("manifest.json");
const zones = readJson("zones.json").zones;
const settlements = readJson("poi.json").settlements;
const seaRegions = readJson("seaRegions.json").regions;
const roads = readJson("roads.json").roads;
const waterways = readJson("waterways.json");

const continents = {};
for (const id of manifest.continents) {
  continents[id] = {
    heightDataBase64: readBase64(`heightmap.${id}.raw`),
    biomeImageDataUri: `data:image/png;base64,${readBase64(`biome_map.${id}.png`)}`,
  };
}

const embedded = {
  manifest,
  zones,
  settlements,
  seaRegions,
  roads,
  waterways: { continents: waterways.continents },
  continents,
  worldHeightBase64: readBase64("heightmap.world.raw"),
};

// Standalone file:// artifacts cannot fetch KTX2 transcoder workers. Embed the
// reviewed 2K sources instead; the normal Vite build uses GPU-compressed KTX2.
const terrainAssets = {};
for (const layer of ["sand", "grass", "soil", "forest", "rock", "scree", "snow"]) {
  terrainAssets[layer] = { albedo: readTerrainTexture(layer, "albedo") };
}
for (const layer of ["sand", "grass", "soil", "rock", "snow"]) {
  terrainAssets[layer].normal = readTerrainTexture(layer, "normal");
}
for (const layer of ["sand", "grass", "rock"]) {
  terrainAssets[layer].roughness = readTerrainTexture(layer, "roughness");
}

const environmentAssetIds = [
  "celandine_01", "shrub_03", "rock_07", "dead_tree_trunk",
  "fern_02",
];
const environmentAssets = Object.fromEntries(environmentAssetIds.map((id) => [
  id,
  readFileSync(path.join(packageRoot, "public", "environment", `${id}.glb`)).toString("base64"),
]));

console.log("Bundling viewer JS with esbuild…");
const buildResult = await esbuild.build({
  entryPoints: [path.join(packageRoot, "src", "main.ts")],
  bundle: true,
  format: "iife",
  target: "es2022",
  minify: true,
  write: false,
  logLevel: "warning",
});
const bundledJs = buildResult.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const embeddedJson = JSON.stringify(embedded).replace(/<\/script/gi, "<\\/script");
const terrainJson = JSON.stringify(terrainAssets).replace(/<\/script/gi, "<\\/script");
const environmentJson = JSON.stringify(environmentAssets).replace(/<\/script/gi, "<\\/script");
const resourceTextureAssets = Object.fromEntries([
  ["pine-twig-diff.png", "image/png"],
  ["pine-twig-alpha.png", "image/png"],
  ["pine-bark-diff.jpg", "image/jpeg"],
].map(([file, mime]) => [file, `data:${mime};base64,${readFileSync(path.join(packageRoot, "public", "assets", "resource-textures", file)).toString("base64")}`]));
const resourceTextureJson = JSON.stringify(resourceTextureAssets).replace(/<\/script/gi, "<\\/script");

const moduleTag = '<script type="module" src="/src/main.ts"></script>';
const inlineScripts = `<script>window.__NEVORA_WORLD__ = ${embeddedJson};window.__NEVORA_TERRAIN_ASSETS__ = ${terrainJson};window.__NAVORA_ENVIRONMENT_ASSETS__ = ${environmentJson};window.__NAVORA_RESOURCE_TEXTURES__ = ${resourceTextureJson};</script>\n<script>${bundledJs}</script>`;
const sourceHtml = readFileSync(path.join(packageRoot, "index.html"), "utf-8");
if (!sourceHtml.includes(moduleTag)) throw new Error(`Expected module tag not found in ${path.join(packageRoot, "index.html")}`);
const html = sourceHtml.replace(moduleTag, inlineScripts);

const outDir = path.join(packageRoot, "dist-artifact");
mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `nevora-inspector-${seed}.html`);
writeFileSync(outFile, html);

const sizeMb = (Buffer.byteLength(html) / (1024 * 1024)).toFixed(2);
console.log(`Wrote ${outFile} (${sizeMb} MB)`);
