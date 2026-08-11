// Orchestrates the pipeline stages in the order defined by docs/01 §3.
// Each stage is a pure function of (seed-derived rng, upstream data, rules).

import { SeedRegistry } from "./seed/index.js";
import { generateWorldHeightField, sliceContinentField } from "./elevation/index.js";
import { generateWaterData } from "./hydrology/index.js";
import { generateClimateFields } from "./climate/index.js";
import { assignZones, resolveZones } from "./zones/index.js";
import { classifyBiomes } from "./biomes/index.js";
import { placeResources } from "./resources/index.js";
import { placeEcology } from "./ecology/index.js";
import { placeSettlements } from "./settlements/index.js";
import { generateRoads } from "./roads/index.js";
import { generateSettlementName } from "./naming/index.js";
import { loadZoneDesigns, loadResourceDesigns, loadCreatureDesigns, loadContinentLayout } from "./designData.js";
import type { ContinentId, Landmark, ResolvedZone, WorldOutput } from "./types/index.js";

const GENERATOR_VERSION = "0.3.0";

export interface GenerateOptions {
  seed: number;
  heightmapResolution?: number;
  continentTileSize?: number;
  continents?: ContinentId[];
  nameSettlements?: boolean;
}

export function generateWorld(opts: GenerateOptions): WorldOutput {
  const resolution = opts.heightmapResolution ?? 512;
  const continentLayout = loadContinentLayout();
  const continentTileSize = opts.continentTileSize ?? continentLayout.continentTileSize;
  const continents: ContinentId[] = opts.continents ?? ["valora", "seradia"];
  const nameSettlements = opts.nameSettlements ?? true;
  // Same physical density the old per-continent `resolution` flag implied
  // (continentTileSize / resolution meters per grid cell), just now applied
  // to one unified world grid instead of two independent tiles.
  const metersPerCell = continentTileSize / resolution;

  const seeds = new SeedRegistry(opts.seed);
  const zoneDesigns = loadZoneDesigns();
  const resourceDesigns = loadResourceDesigns();
  const creatureDesigns = loadCreatureDesigns();

  const worldHeight = generateWorldHeightField(seeds, continentLayout, zoneDesigns, metersPerCell);

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
    // Slice this continent's own local [0,1]x[0,1] region back out of the
    // unified field -- every downstream stage still works exactly as it did
    // before the unified-heightfield change (docs/01 §3 stage 3 note).
    const height = sliceContinentField(worldHeight, continentLayout, continent, resolution);
    heightFields[continent] = height;

    const { water: waterData, riverCellMask } = generateWaterData(height, continent);
    water[continent] = waterData;

    const climateRng = seeds.rngFor("climate", continent);
    const climate = generateClimateFields(climateRng, height, riverCellMask);

    const zoneAssignment = assignZones(zoneDesigns, continent, resolution, height);
    const zoneRng = seeds.rngFor("resources", `${continent}:zones`);
    const resolvedZones = resolveZones(zoneDesigns, continent, zoneAssignment, climate, zoneRng);
    allZones.push(...resolvedZones);

    const biomes = classifyBiomes(height, climate, zoneAssignment, zoneDesigns, continent);
    biomeFields[continent] = biomes;

    const resourceRng = seeds.rngFor("resources", continent);
    const resources = placeResources(resourceRng, resourceDesigns, zoneDesigns, continent, height, biomes, zoneAssignment);
    allResources.push(...resources);

    const settlementRng = seeds.rngFor("settlements", continent);
    const settlements = placeSettlements(settlementRng, resolvedZones, continent, height);

    if (nameSettlements) {
      const namingRng = seeds.rngFor("naming", continent);
      for (const s of settlements) s.name = generateSettlementName(namingRng);
    }
    allSettlements.push(...settlements);

    const ecologyRng = seeds.rngFor("ecology", continent);
    const spawns = placeEcology(
      ecologyRng,
      creatureDesigns,
      zoneDesigns,
      continent,
      height,
      zoneAssignment,
      settlements,
      continentTileSize
    );
    allSpawns.push(...spawns);

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

    allRoads.push(...generateRoads(settlements, continent, height, continentTileSize));
  }

  const continentLayoutByIdEntries = continentLayout.continents
    .filter((c) => continents.includes(c.id))
    .map((c) => [c.id, { worldOffset: c.worldOffset }] as const);

  const seaRegions: WorldOutput["seaRegions"] = [
    {
      id: continentLayout.bruma.id,
      name: continentLayout.bruma.name,
      center: continentLayout.bruma.center,
      radiusUnits: continentLayout.bruma.radiusUnits,
      magicalIntensity: continentLayout.bruma.magicalIntensity,
      notes: continentLayout.bruma.notes,
    },
  ];

  return {
    manifest: {
      seed: opts.seed,
      generatorVersion: GENERATOR_VERSION,
      generatedAt: new Date().toISOString(),
      worldScale: { continentTileSize, heightmapResolution: resolution },
      continents,
      continentLayout: Object.fromEntries(continentLayoutByIdEntries) as WorldOutput["manifest"]["continentLayout"],
      worldHeightmap: {
        width: worldHeight.field.width,
        height: worldHeight.field.height,
        bounds: worldHeight.bounds,
      },
    },
    seaRegions,
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
    worldHeightField: worldHeight.field,
    worldBounds: worldHeight.bounds,
  };
}
