// Loads the hand-authored world-rule tables from /data/design (see docs/01 §2).
// Uses plain fs + JSON.parse rather than ESM JSON import assertions to keep
// tsx/node module resolution simple across the monorepo.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { ZoneDesign, ResourceDesign, CreatureDesign } from "./types/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// packages/generator/src -> repo root is four levels up (src -> generator -> packages -> root)
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const DESIGN_DIR = path.join(REPO_ROOT, "data", "design");

function loadJson<T>(fileName: string): T {
  const raw = readFileSync(path.join(DESIGN_DIR, fileName), "utf-8");
  return JSON.parse(raw) as T;
}

export function loadZoneDesigns(): ZoneDesign[] {
  const { zones } = loadJson<{ zones: ZoneDesign[] }>("zones.json");
  return zones;
}

export function loadResourceDesigns(): ResourceDesign[] {
  const { resources } = loadJson<{ resources: ResourceDesign[] }>("resources.json");
  return resources;
}

export function loadCreatureDesigns(): CreatureDesign[] {
  const { creatures } = loadJson<{ creatures: CreatureDesign[] }>("creatures.json");
  return creatures;
}
