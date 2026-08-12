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

const moduleTag = '<script type="module" src="/src/main.ts"></script>';
const inlineScripts = `<script>window.__NEVORA_WORLD__ = ${embeddedJson};</script>\n<script>${bundledJs}</script>`;
const sourceHtml = readFileSync(path.join(packageRoot, "index.html"), "utf-8");
if (!sourceHtml.includes(moduleTag)) throw new Error(`Expected module tag not found in ${path.join(packageRoot, "index.html")}`);
const html = sourceHtml.replace(moduleTag, inlineScripts);

const outDir = path.join(packageRoot, "dist-artifact");
mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `nevora-inspector-${seed}.html`);
writeFileSync(outFile, html);

const sizeMb = (Buffer.byteLength(html) / (1024 * 1024)).toFixed(2);
console.log(`Wrote ${outFile} (${sizeMb} MB)`);
