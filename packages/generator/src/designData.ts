// Loads the hand-authored world-rule tables from /data/design (see docs/01 §2).
// Uses plain fs + JSON.parse rather than ESM JSON import assertions to keep
// tsx/node module resolution simple across the monorepo.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type {
  ZoneDesign, ResourceDesign, CreatureDesign, ContinentLayoutDesign, EnvironmentalRegionDesign,
  TerrainMaterialLibraryDesign, TerrainResidencyQuality, TerrainTextureChannel,
} from "./types/index.js";

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

export function loadEnvironmentalRegionDesigns(): EnvironmentalRegionDesign[] {
  const { regions } = loadJson<{ regions: EnvironmentalRegionDesign[] }>("environment-regions.json");
  const seen = new Set<string>();
  for (const region of regions) {
    if (!region.zoneId || seen.has(region.zoneId)) throw new Error(`environment-regions.json contains duplicate zoneId: ${region.zoneId}`);
    seen.add(region.zoneId);
    for (const [key, value] of Object.entries(region)) {
      if (typeof value === "number" && !Number.isFinite(value)) throw new Error(`Environmental region ${region.zoneId} has invalid ${key}`);
    }
  }
  const zoneIds = new Set(loadZoneDesigns().map((zone) => zone.id));
  for (const id of zoneIds) if (!seen.has(id)) throw new Error(`environment-regions.json is missing zone ${id}`);
  for (const id of seen) if (!zoneIds.has(id)) throw new Error(`environment-regions.json references unknown zone ${id}`);
  return regions;
}

export function loadTerrainMaterialLibrary(): TerrainMaterialLibraryDesign {
  const library = loadJson<TerrainMaterialLibraryDesign>("terrain-materials.json");
  if (library.version !== 1 || !library.libraryId) throw new Error("terrain-materials.json has an unsupported or missing version");
  if (library.families.length < 25 || library.families.length > 35) {
    throw new Error(`terrain-materials.json must define 25-35 families; found ${library.families.length}`);
  }
  assertUniqueIds(library.textureSets, "terrain-materials.json textureSets");
  assertUniqueIds(library.families, "terrain-materials.json families");
  const textureSetIds = new Set(library.textureSets.map((set) => set.id));
  const channels: TerrainTextureChannel[] = ["albedo", "normal", "roughness"];
  for (const set of library.textureSets) {
    if (set.license !== "CC0" || !set.provider || !set.sourceAssetId || !set.sourceUrl) throw new Error(`Texture set ${set.id} has incomplete provenance`);
    if (set.sourceDimensionsM?.some((value) => !(value > 0))) throw new Error(`Texture set ${set.id} has invalid source dimensions`);
    for (const channel of channels) {
      const record = set.channels[channel];
      if (!record?.file.endsWith(`_${channel}.ktx2`)) throw new Error(`Texture set ${set.id} has invalid ${channel} file`);
      const expectedColorSpace = channel === "albedo" ? "srgb" : "linear";
      if (record.colorSpace !== expectedColorSpace) throw new Error(`Texture set ${set.id}/${channel} must be ${expectedColorSpace}`);
    }
  }
  for (const family of library.families) {
    if (!textureSetIds.has(family.textureSet)) throw new Error(`Material family ${family.id} references unknown texture set ${family.textureSet}`);
    if (family.tint.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) throw new Error(`Material family ${family.id} has invalid tint`);
    if (!(family.metersPerRepeat > 0) || family.normalStrength < 0 || family.normalStrength > 2 || Math.abs(family.roughnessBias) > 0.5 || !(family.heightBlendM > 0)) {
      throw new Error(`Material family ${family.id} has invalid material parameters`);
    }
    if (family.controlDrivers.length === 0 || family.tags.length === 0) throw new Error(`Material family ${family.id} is missing semantic controls`);
  }
  for (const quality of ["compatibility", "balanced", "high"] satisfies TerrainResidencyQuality[]) {
    const profile = library.residencyProfiles[quality];
    if (!profile || !(profile.anisotropy > 0) || !(profile.maxResolution > 0)) throw new Error(`Material residency profile ${quality} is invalid`);
    for (const [setId, residentChannels] of Object.entries(profile.channelsByTextureSet)) {
      if (!textureSetIds.has(setId) || residentChannels.length === 0 || residentChannels.some((channel) => !channels.includes(channel))) {
        throw new Error(`Material residency profile ${quality}/${setId} is invalid`);
      }
    }
    for (const setId of textureSetIds) if (!profile.channelsByTextureSet[setId]?.includes("albedo")) throw new Error(`Material residency profile ${quality} is missing ${setId}/albedo`);
  }
  return library;
}
