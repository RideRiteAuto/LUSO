// Loads the hand-authored world-rule tables from /data/design (see docs/01 §2).
// Uses plain fs + JSON.parse rather than ESM JSON import assertions to keep
// tsx/node module resolution simple across the monorepo.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { ZoneDesign, ResourceDesign, CreatureDesign, ContinentLayoutDesign } from "./types/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// packages/generator/src -> repo root is four levels up (src -> generator -> packages -> root)
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const DESIGN_DIR = path.join(REPO_ROOT, "data", "design");

function loadJson<T>(fileName: string): T {
  const raw = readFileSync(path.join(DESIGN_DIR, fileName), "utf-8");
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    throw new Error(`Invalid JSON in data/design/${fileName}: ${(error as Error).message}`);
  }
}

function assertUniqueIds(records: { id: string }[], label: string): void {
  const seen = new Set<string>();
  for (const record of records) {
    if (!record.id || seen.has(record.id)) throw new Error(`${label} contains missing or duplicate id: ${record.id}`);
    seen.add(record.id);
  }
}

function validateZones(zones: ZoneDesign[]): ZoneDesign[] {
  assertUniqueIds(zones, "zones.json");
  for (const zone of zones) {
    if (!(["valora", "seradia"] as string[]).includes(zone.continent)) throw new Error(`Zone ${zone.id} has invalid continent`);
    if (zone.anchor.some((v) => !Number.isFinite(v) || v < 0 || v > 1)) throw new Error(`Zone ${zone.id} has invalid anchor`);
    if (!(zone.radius > 0) || zone.elevationTargetM[0] > zone.elevationTargetM[1]) throw new Error(`Zone ${zone.id} has invalid ranges`);
  }
  return zones;
}

export function loadZoneDesigns(): ZoneDesign[] {
  const { zones } = loadJson<{ zones: ZoneDesign[] }>("zones.json");
  return validateZones(zones);
}

export function loadResourceDesigns(): ResourceDesign[] {
  const { resources } = loadJson<{ resources: ResourceDesign[] }>("resources.json");
  const seen = new Set<string>();
  for (const resource of resources) {
    if (!resource.resourceId || seen.has(resource.resourceId)) throw new Error(`resources.json contains duplicate resourceId: ${resource.resourceId}`);
    seen.add(resource.resourceId);
    if (resource.elevationRangeM && resource.elevationRangeM[0] > resource.elevationRangeM[1]) throw new Error(`Resource ${resource.resourceId} has invalid elevation range`);
  }
  return resources;
}

export function loadCreatureDesigns(): CreatureDesign[] {
  const { creatures } = loadJson<{ creatures: CreatureDesign[] }>("creatures.json");
  const seen = new Set<string>();
  for (const creature of creatures) {
    if (!creature.creatureId || seen.has(creature.creatureId)) throw new Error(`creatures.json contains duplicate creatureId: ${creature.creatureId}`);
    seen.add(creature.creatureId);
    if (creature.elevationRangeM[0] > creature.elevationRangeM[1] || creature.minDistanceFromSettlementM < 0) throw new Error(`Creature ${creature.creatureId} has invalid ranges`);
  }
  return creatures;
}

export function loadContinentLayout(): ContinentLayoutDesign {
  const layout = loadJson<ContinentLayoutDesign>("continents.json");
  assertUniqueIds(layout.continents, "continents.json");
  if (!(layout.continentTileSize > 0) || !(layout.lunaSeaGapUnits >= 0)) throw new Error("continents.json has invalid scale values");
  return layout;
}
