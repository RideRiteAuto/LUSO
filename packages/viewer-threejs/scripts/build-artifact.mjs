#!/usr/bin/env node
// Builds a single self-contained HTML file for one generated world: bundles
// the viewer's TS/JS (three.js included) with esbuild, and inlines that
// seed's output/<seed>/* files as base64/JSON instead of fetching them --
// so the result is a page that runs with no server and no network requests,
// suitable for publishing as a claude.ai artifact. Local dev (`npm run
// viewer`) is unaffected; this is an alternate, additional build target.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(PKG_ROOT, "..", "..");

const seed = process.argv.includes("--seed")
  ? Number(process.argv[process.argv.indexOf("--seed") + 1])
  : 48291;

const outputDir = path.join(REPO_ROOT, "output", String(seed));

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
  // The unified world heightfield (the connecting seabed between continents,
  // docs/01 §3 stage 3) -- worldData.ts's loadEmbeddedWorld() expects this
  // field to build the seabed mesh and to ground the walk-mode camera.
  worldHeightBase64: readBase64("heightmap.world.raw"),
};

console.log("Bundling viewer JS with esbuild…");
const buildResult = await esbuild.build({
  entryPoints: [path.join(PKG_ROOT, "src", "main.ts")],
  bundle: true,
  format: "iife",
  target: "es2020",
  minify: true,
  write: false,
  logLevel: "warning",
});
const bundledJs = buildResult.outputFiles[0].text;

// JSON.stringify can legally emit "</script>" inside a string value (e.g. a
// stray note field) which would prematurely close the inline <script> tag --
// escape it defensively even though nothing in today's data contains it.
const embeddedJson = JSON.stringify(embedded).replace(/<\/script/gi, "<\\/script");

const htmlBody = `<meta charset="UTF-8">
<style>
  :root {
    /* A night-chart/star-atlas palette, deliberately single-theme: this
       renders a 3D scene of an ocean and continents at night, so a
       light-mode HUD would fight the content rather than frame it. */
    --void: #070b14;
    --panel: rgba(13, 19, 33, 0.86);
    --panel-border: rgba(184, 208, 255, 0.14);
    --ink: #eef1f8;
    --ink-dim: #8b9ab3;
    --gold: #d9a75c;
    --teal: #4fd1c0;
    --violet: #9a6bff;
    --font-display: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
    --font-ui: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    --font-mono: ui-monospace, "SF Mono", "Cascadia Mono", Menlo, monospace;
  }
  html, body { margin: 0; height: 100%; background: var(--void); overflow: hidden; font-family: var(--font-ui); }
  #app { position: relative; width: 100%; height: 100%; }
  canvas { display: block; }

  #hud {
    position: absolute; top: 14px; left: 14px; z-index: 10;
    color: var(--ink); background: var(--panel); border: 1px solid var(--panel-border);
    border-top: 2px solid var(--gold);
    border-radius: 10px; padding: 14px 18px 16px; font-size: 13px; line-height: 1.5; max-width: 350px;
    backdrop-filter: blur(8px);
    box-shadow: 0 12px 32px rgba(0,0,0,0.35);
  }
  #hud h1 {
    font-family: var(--font-display); font-weight: 600; font-style: italic;
    font-size: 17px; margin: 0 0 10px; letter-spacing: 0.01em; color: #fff; text-wrap: balance;
  }
  #hud .row { display: flex; justify-content: space-between; gap: 12px; padding: 1px 0; }
  #hud .row .val { font-family: var(--font-mono); font-variant-numeric: tabular-nums; color: var(--teal); }
  #hud .muted { color: var(--ink-dim); }
  #hud .group { margin-top: 10px; }
  #hud .group-label {
    display: block; font-size: 10px; text-transform: uppercase; letter-spacing: 0.09em;
    color: var(--ink-dim); margin-bottom: 5px;
  }
  #hud button {
    background: rgba(255,255,255,0.04); color: var(--ink); border: 1px solid var(--panel-border);
    border-radius: 6px; padding: 5px 10px; cursor: pointer; font-size: 12px; font-family: var(--font-ui);
    margin-right: 6px; margin-bottom: 6px; transition: background 120ms, border-color 120ms;
  }
  #hud button:hover { background: rgba(255,255,255,0.09); }
  #hud button:focus-visible { outline: 2px solid var(--teal); outline-offset: 1px; }
  #hud button.active { background: rgba(217, 167, 92, 0.16); border-color: var(--gold); color: #ffe3b0; }
  #legend { margin-top: 10px; font-size: 11px; color: var(--ink-dim); line-height: 1.5; }

  #status {
    position: absolute; bottom: 14px; left: 14px; z-index: 10; color: var(--ink-dim);
    font-size: 11px; font-family: var(--font-mono);
  }
  #flyHint {
    position: absolute; bottom: 14px; left: 50%; transform: translateX(-50%); z-index: 10;
    color: var(--ink); background: var(--panel); border: 1px solid var(--panel-border);
    border-radius: 10px; padding: 9px 18px; font-size: 12px; display: none; text-align: center;
    backdrop-filter: blur(8px);
  }
  #flyHint.visible { display: block; }
  #crosshair {
    position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 9;
    width: 5px; height: 5px; border-radius: 50%; background: rgba(255,255,255,0.65); display: none;
    box-shadow: 0 0 6px rgba(255,255,255,0.5);
    /* Sits pixel-perfect at screen center -- exactly where a look-drag
       naturally starts. Without this, a pointerdown there lands on the
       crosshair div instead of the canvas underneath, and the drag
       listener (bound to the canvas element specifically) never fires,
       so look-drag silently does nothing. */
    pointer-events: none;
  }
  #crosshair.visible { display: block; }
</style>
<div id="app">
  <div id="hud">
    <h1>Nevora World Compiler — Inspector</h1>
    <div class="row"><span class="muted">Seed</span><span id="seedVal" class="val">—</span></div>
    <div class="row"><span class="muted">Zones</span><span id="zoneCount" class="val">—</span></div>
    <div class="row"><span class="muted">Settlements</span><span id="settleCount" class="val">—</span></div>
    <div class="group">
      <span class="group-label">Camera</span>
      <button id="viewOrbit" class="active">Orbit</button>
      <button id="viewTop">Top-down</button>
      <button id="viewWorld">World</button>
      <button id="viewFly">Fly ✈</button>
      <button id="viewWalk">Walk 🚶</button>
    </div>
    <div class="group">
      <span class="group-label">Layers</span>
      <button id="toggleZones" class="active">Zone bounds</button>
      <button id="toggleWater" class="active">Rivers</button>
      <button id="toggleSettlements" class="active">Settlements</button>
    </div>
    <div class="legend" id="legend"></div>
  </div>
  <div id="status">loading…</div>
  <div id="flyHint">Drag to look · WASD move · Space/Ctrl up-down · Shift boost · scroll = speed · Esc to exit</div>
  <div id="crosshair"></div>
</div>
<script>
window.__NEVORA_WORLD__ = ${embeddedJson};
</script>
<script>
${bundledJs}
</script>
`;

const outDir = path.join(PKG_ROOT, "dist-artifact");
mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `nevora-inspector-${seed}.html`);
writeFileSync(outFile, htmlBody);

const sizeMb = (Buffer.byteLength(htmlBody) / (1024 * 1024)).toFixed(2);
console.log(`Wrote ${outFile} (${sizeMb} MB)`);
