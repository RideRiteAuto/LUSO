#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateWorld } from "./pipeline.js";
import { writeWorldOutput } from "./export/index.js";
import type { ContinentId } from "./types/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

function parseArgs(argv: string[]) {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        args[key] = next;
        i++;
      } else {
        args[key] = "true";
      }
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const seed = args.seed ? Number(args.seed) : 48291;
const resolution = args.resolution ? Number(args.resolution) : args.hq ? 2048 : 1024;
const continents = (args.continents ? args.continents.split(",") : ["valora", "seradia"]) as ContinentId[];

console.log(`Generating Navora world — seed=${seed}, resolution=${resolution}, continents=${continents.join(",")}`);
const start = Date.now();

const world = generateWorld({
  seed,
  heightmapResolution: resolution,
  continents,
});

const outDir = writeWorldOutput(world, path.join(REPO_ROOT, "output"));

const elapsedMs = Date.now() - start;
console.log(`Done in ${elapsedMs}ms. Output written to ${outDir}`);
console.log(
  `  zones=${world.zones.length} resources=${world.resources.reduce((n, r) => n + r.instances.length, 0)} ` +
    `spawns=${world.spawns.length} settlements=${world.settlements.length} roads=${world.roads.length}`
);
