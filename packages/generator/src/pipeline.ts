// Orchestrates the pipeline stages in the order defined by docs/01 §3.
// Each stage is a pure function of (seed-derived rng, upstream data, rules).

import { SeedRegistry } from "./seed/index.js";
import { generateHeightField } from "./elevation/index.js";
import { generateWaterData } from "./hydrology/index.js";
import { generateClimateFields } from "./climate/index.js";
import { assignZones, resolveZones } from "./zones/index.js";
import { classifyBiomes } from "./biomes/index.js";
import { placeResources } from "./resources/index.js";
import { placeEcology } from "./ecology/index.js";
import { placeSettlements } from "./settlements/index.js";
import { generateRoads } from "./roads/index.js";
import { generateSettlementName } from "./naming/index.js";
import { loadZoneDesigns, loadResourceDesigns, loadCreatureDesigns } from "./designData.js";
import type { ContinentId, Landmark, ResolvedZone, WorldOutput } from "./types/index.js";

const GENERATOR_VERSION = "0.1.0";

export interface GenerateOptions {
  seed: number;
  heightmapResolution?: number;
  continentTileSize?: number;
  continents?: ContinentId[];
  nameSettlements?: boolean;
}

export function generateWorld(opts: GenerateOptions): WorldOutput {
  const resolution = opts.heightmapResolution ?? 512;
  const continentTileSize = opts.continentTileSize ?? 8192;
  const continents: ContinentId[] = opts.continents ?? ["valora", "seradia"];
  const nameSettlements = opts.nameSettlements ?? true;

  const seeds = new SeedRegistry(opts.seed);
  const zoneDesigns = loadZoneDesigns();
  const resourceDesigns = loadResourceDesigns();
  const creatureDesigns = loadCreatureDesigns();

  const heightFields: WorldOutput["heightFields"] = {} as any;
  const biomeFields: WorldOutput["biomeFields"] = {} as any;
  const water: WorldOutput["water"] = {} as any;
  const allZones: ResolvedZone[] = [];
  const allResources: WorldOutput["resources"] = [];
  const allSpawns: WorldOutput["spawns"] = [];
  const allSettlements: WorldOutput["settlements"] = [];
  const allLandmarks: Landmark[] = [];
  const allRoads: WorldOutput["roads"] = [];

  for (const continent of continents) {
    const elevationRng = seeds.rngFor("elevation", continent);
    const height = generateHeightField(elevationRng, { resolution, continent, zones: zoneDesigns });
    heightFields[continent] = height;

    const { water: waterData, riverCellMask } = generateWaterData(height, continent);
    water[continent] = waterData;

    const climateRng = seeds.rngFor("climate", continent);
    const climate = generateClimateFields(climateRng, height, riverCellMask);

    const zoneAssignment = assignZones(zoneDesigns, continent, resolution);
    const zoneRng = seeds.rngFor("resources", `${continent}:zones`);
    const resolvedZones = resolveZones(zoneDesigns, continent, zoneAssignment, climate, zoneRng);
    allZones.push(...resolvedZones);

    const biomes = classifyBiomes(height, climate, zoneAssignment, zoneDesigns, continent);
    biomeFields[continent] = biomes;

    const resourceRng = seeds.rngFor("resources", continent);
    const resources = placeResources(resourceRng, resourceDesigns, zoneDesigns, continent, height, biomes, zoneAssignment);
    allResources.push(...resources);

    const ecologyRng = seeds.rngFor("ecology", continent);
    const spawns = placeEcology(ecologyRng, creatureDesigns, zoneDesigns, continent, height, zoneAssignment);
    allSpawns.push(...spawns);

    const settlementRng = seeds.rngFor("settlements", continent);
    const settlements = placeSettlements(settlementRng, resolvedZones, continent, height);

    if (nameSettlements) {
      const namingRng = seeds.rngFor("naming", continent);
      for (const s of settlements) s.name = generateSettlementName(namingRng);
    }
    allSettlements.push(...settlements);

    for (const zone of resolvedZones) {
      if (zone.loreBreadcrumb) {
        allLandmarks.push({
          id: `${zone.id}-lore-${zone.loreBreadcrumb.type}`,
          type: zone.loreBreadcrumb.type,
          position: zone.loreBreadcrumb.anchor,
          zoneId: zone.id,
        });
      }
    }

    allRoads.push(...generateRoads(settlements, continent));
  }

  return {
    manifest: {
      seed: opts.seed,
      generatorVersion: GENERATOR_VERSION,
      generatedAt: new Date().toISOString(),
      worldScale: { continentTileSize, heightmapResolution: resolution },
      continents,
    },
    heightFields,
    biomeFields,
    water,
    zones: allZones,
    resources: allResources,
    spawns: allSpawns,
    settlements: allSettlements,
    landmarks: allLandmarks,
    roads: allRoads,
    seaRoutes: [],
  };
}
