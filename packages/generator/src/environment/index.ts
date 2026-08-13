// Compiler-authored environmental truth. Rendering may break these values up
// visually, but it must never replace them with final climate/ecology truth.

import { createNoise2D } from "simplex-noise";
import { mulberry32, type Rng } from "../seed/index.js";
import type {
  ContinentId,
  EnvironmentalFields,
  EnvironmentalRegionDesign,
  HeightField,
  ScalarField,
  ZoneDesign,
} from "../types/index.js";
import type { ZoneAssignment } from "../zones/index.js";

export const SOIL_CLASSES = [
  "ocean-sediment", "beach-sand", "coastal-loam", "fertile-loam",
  "forest-loam", "river-silt", "peat", "rocky-thin", "red-earth",
  "alpine-tundra", "frost", "ancient-humus",
] as const;

export const GEOLOGY_CLASSES = [
  "ocean-sediment", "alluvium", "limestone", "granite", "slate", "basalt",
  "metamorphic", "red-sandstone", "ancient-crystal",
] as const;

export const WEATHER_REGION_CLASSES = [
  "luna-sea", "valora-south-coast", "valora-interior-valleys",
  "greyspine-orographic", "stormbreak-coast", "azurewood-rainbelt",
  "elderwall-highland", "tempest-crown", "verdelume-basin",
  "firstwater-basin", "reedwater-wetlands", "redwater-steppe",
  "sunreach-delta", "glassmere-lakes", "skyplain", "shattered-reach",
  "luminous-hollow",
] as const;

export const ZONE_CLASSES = [
  "ocean-unclaimed",
  "alvora", "valedouro", "serravela", "cavora", "azurama", "montemoura", "corvento", "lumevara",
  "fonteira", "riveira", "vermara", "solmara", "vidrala", "altavera", "fendoura", "lumeira",
] as const;

const soilIndex = new Map<string, number>(SOIL_CLASSES.map((id, index) => [id, index]));
const geologyIndex = new Map<string, number>(GEOLOGY_CLASSES.map((id, index) => [id, index]));
const weatherIndex = new Map<string, number>(WEATHER_REGION_CLASSES.map((id, index) => [id, index]));

function clamp01(value: number): number { return Math.max(0, Math.min(1, value)); }
function smoothstep(a: number, b: number, value: number): number {
  const t = clamp01((value - a) / Math.max(0.000001, b - a));
  return t * t * (3 - 2 * t);
}
function scalar(width: number, height: number, data?: Float32Array): ScalarField {
  return { width, height, data: data ?? new Float32Array(width * height) };
}

function fractal(noise: (x: number, y: number) => number, x: number, y: number): number {
  return (noise(x, y) + noise(x * 2, y * 2) * 0.5 + noise(x * 4, y * 4) * 0.25) / 1.75;
}

function distanceField(mask: Uint8Array, width: number, height: number, metersPerCell: number): Float32Array {
  const count = width * height;
  const distance = new Float32Array(count);
  distance.fill(Number.POSITIVE_INFINITY);
  const queue = new Int32Array(count);
  let head = 0, tail = 0;
  for (let i = 0; i < count; i++) {
    if (!mask[i]) continue;
    distance[i] = 0;
    queue[tail++] = i;
  }
  while (head < tail) {
    const index = queue[head++];
    const x = index % width, y = Math.floor(index / width);
    const nextDistance = distance[index] + metersPerCell;
    // Uniform edge weights make first discovery shortest. Mark-on-discovery
    // prevents float round-off from re-queueing the same cell until the fixed
    // queue overflows and leaves a disconnected-looking Infinity fringe.
    if (x > 0 && !Number.isFinite(distance[index - 1])) { distance[index - 1] = nextDistance; queue[tail++] = index - 1; }
    if (x + 1 < width && !Number.isFinite(distance[index + 1])) { distance[index + 1] = nextDistance; queue[tail++] = index + 1; }
    if (y > 0 && !Number.isFinite(distance[index - width])) { distance[index - width] = nextDistance; queue[tail++] = index - width; }
    if (y + 1 < height && !Number.isFinite(distance[index + width])) { distance[index + width] = nextDistance; queue[tail++] = index + width; }
  }
  return distance;
}

function classIndex(map: Map<string, number>, id: string, label: string): number {
  const value = map.get(id);
  if (value === undefined) throw new Error(`Unknown ${label} class: ${id}`);
  return value;
}

export interface GenerateEnvironmentalFieldsOptions {
  rng: Rng;
  continent: ContinentId;
  continentTileSize: number;
  height: HeightField;
  drainage: ScalarField;
  riverCellMask: Uint8Array;
  lakeCellMask: Uint8Array;
  zoneAssignment: ZoneAssignment;
  zones: ZoneDesign[];
  regions: EnvironmentalRegionDesign[];
}

export function generateEnvironmentalFields(options: GenerateEnvironmentalFieldsOptions): EnvironmentalFields {
  const { rng, continent, continentTileSize, height, drainage, riverCellMask, lakeCellMask, zoneAssignment, zones, regions } = options;
  const { width, height: fieldHeight, data: elevations } = height;
  const count = width * fieldHeight;
  if (width !== fieldHeight || zoneAssignment.gridResolution !== width) throw new Error("Environmental fields require zone and height grids at the same resolution");
  const metersPerCell = continentTileSize / Math.max(1, width - 1);
  const continentZones = zones.filter((zone) => zone.continent === continent);
  const regionByZone = new Map(regions.map((region) => [region.zoneId, region]));
  const profiles = continentZones.map((zone) => {
    const profile = regionByZone.get(zone.id);
    if (!profile) throw new Error(`Missing environmental profile for ${zone.id}`);
    classIndex(soilIndex, profile.soilPrimary, "soil");
    classIndex(soilIndex, profile.soilSecondary, "soil");
    classIndex(geologyIndex, profile.geologyPrimary, "geology");
    classIndex(geologyIndex, profile.geologySecondary, "geology");
    classIndex(weatherIndex, profile.weatherRegion, "weather region");
    return profile;
  });

  const oceanMask = new Uint8Array(count);
  const allWaterMask = new Uint8Array(count);
  const coastAndLakeMask = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    oceanMask[i] = elevations[i] <= 0 ? 1 : 0;
    allWaterMask[i] = oceanMask[i] || riverCellMask[i] || lakeCellMask[i] ? 1 : 0;
    coastAndLakeMask[i] = oceanMask[i] || lakeCellMask[i] ? 1 : 0;
  }
  const distanceToOcean = distanceField(oceanMask, width, fieldHeight, metersPerCell);
  const distanceToWater = distanceField(allWaterMask, width, fieldHeight, metersPerCell);
  const distanceToCoastOrLake = distanceField(coastAndLakeMask, width, fieldHeight, metersPerCell);

  const seed = Math.floor(rng.float() * 0x7fffffff);
  const climateNoise = createNoise2D(mulberry32(seed));
  const geologyNoise = createNoise2D(mulberry32(seed ^ 0x51f2a9d));
  const localNoise = createNoise2D(mulberry32(seed ^ 0x2c9277b));
  const fields = {
    temperatureC: scalar(width, fieldHeight), precipitation: scalar(width, fieldHeight),
    moisture: scalar(width, fieldHeight), wetness: scalar(width, fieldHeight),
    drainage: scalar(width, fieldHeight, drainage.data.slice()),
    distanceToWaterM: scalar(width, fieldHeight, distanceToWater), shorelineInfluence: scalar(width, fieldHeight),
    slopeDegrees: scalar(width, fieldHeight), exposure: scalar(width, fieldHeight), erosionScree: scalar(width, fieldHeight),
    buildability: scalar(width, fieldHeight), vegetationEligibility: scalar(width, fieldHeight),
    soilClass: scalar(width, fieldHeight), geologyClass: scalar(width, fieldHeight), weatherRegionClass: scalar(width, fieldHeight),
    zoneClass: scalar(width, fieldHeight),
    resources: {
      forest: scalar(width, fieldHeight), forage: scalar(width, fieldHeight), ore: scalar(width, fieldHeight),
      stone: scalar(width, fieldHeight), reeds: scalar(width, fieldHeight), aquatic: scalar(width, fieldHeight),
      generic: scalar(width, fieldHeight),
    },
  } satisfies EnvironmentalFields;

  const prevailingX = continent === "valora" ? -0.86 : 0.68;
  const prevailingZ = continent === "valora" ? 0.32 : -0.44;
  const prevailingLength = Math.hypot(prevailingX, prevailingZ);
  const windX = prevailingX / prevailingLength, windZ = prevailingZ / prevailingLength;

  for (let y = 0; y < fieldHeight; y++) {
    const v = y / Math.max(1, fieldHeight - 1);
    for (let x = 0; x < width; x++) {
      const u = x / Math.max(1, width - 1);
      const index = y * width + x;
      const elevation = elevations[index];
      const zoneIndex = zoneAssignment.zoneIndexGrid[index];
      const profile = zoneIndex >= 0 ? profiles[zoneIndex] : null;
      const zoneId = zoneIndex >= 0 ? continentZones[zoneIndex]?.id : null;
      const zoneClass = zoneId ? ZONE_CLASSES.indexOf(zoneId as typeof ZONE_CLASSES[number]) : 0;
      if (zoneId && zoneClass <= 0) throw new Error(`Unknown canonical zone class: ${zoneId}`);
      const west = elevations[y * width + Math.max(0, x - 1)];
      const east = elevations[y * width + Math.min(width - 1, x + 1)];
      const north = elevations[Math.max(0, y - 1) * width + x];
      const south = elevations[Math.min(fieldHeight - 1, y + 1) * width + x];
      const gradientX = (east - west) / Math.max(1, metersPerCell * 2);
      const gradientZ = (south - north) / Math.max(1, metersPerCell * 2);
      const slopeDegrees = Math.atan(Math.hypot(gradientX, gradientZ)) * 180 / Math.PI;
      const oceanShore = elevation > 0 ? 1 - smoothstep(120, 2600, distanceToOcean[index]) : 1;
      const lakeShore = elevation > 0 ? 1 - smoothstep(80, 900, distanceToCoastOrLake[index]) : 0;
      const shore = Math.max(oceanShore, lakeShore);
      const waterProximity = 1 - smoothstep(100, 6200, distanceToWater[index]);
      const macroNoise = fractal(climateNoise, u * 2.6 + 19.3, v * 2.6 - 8.7);
      const fineNoise = fractal(localNoise, u * 7.2 - 41.1, v * 7.2 + 23.8);
      const windward = clamp01(0.5 + (gradientX * windX + gradientZ * windZ) * 2.6);

      const temperature = 23 - Math.abs(v - 0.5) * 12 - Math.max(0, elevation) * 0.0065 + (profile?.temperatureOffsetC ?? 0);
      const precipitation = elevation <= 0 ? clamp01(0.55 + macroNoise * 0.08) : clamp01(
        0.43 + (profile?.precipitationBias ?? 0) + shore * 0.13 + windward * 0.16 + macroNoise * 0.12,
      );
      const moisture = elevation <= 0 ? 1 : clamp01(
        precipitation * 0.57 + waterProximity * 0.22 + drainage.data[index] * 0.16
        + (profile?.moistureBias ?? 0) + fineNoise * 0.07 - smoothstep(900, 2200, elevation) * 0.18,
      );
      const wetness = elevation <= 0 ? 1 : clamp01(
        moisture * 0.58 + drainage.data[index] * 0.30 + waterProximity * 0.20 - smoothstep(8, 32, slopeDegrees) * 0.24,
      );
      const exposure = elevation <= 0 ? clamp01(0.55 + shore * 0.25) : clamp01(
        0.24 + shore * 0.30 + smoothstep(180, 1500, elevation) * 0.25 + windward * 0.17
        + (profile?.exposureBias ?? 0) + macroNoise * 0.06,
      );
      const scree = elevation <= 0 ? 0 : clamp01(
        smoothstep(17, 42, slopeDegrees) * (0.52 + exposure * 0.48) + smoothstep(950, 1900, elevation) * 0.16,
      );
      const temperatureSuitability = 1 - smoothstep(18, 35, Math.abs(temperature - 14));
      const vegetation = elevation <= 0 ? 0 : clamp01(
        moisture * 0.62 + precipitation * 0.18 + temperatureSuitability * 0.18
        + (profile?.vegetationBias ?? 0) - smoothstep(20, 42, slopeDegrees) * 0.42 - scree * 0.22,
      );

      let soil = classIndex(soilIndex, "ocean-sediment", "soil");
      let geology = classIndex(geologyIndex, "ocean-sediment", "geology");
      let weather = 0;
      if (profile && elevation > 0) {
        const secondary = geologyNoise(u * 5.5, v * 5.5) > 0.18;
        soil = classIndex(soilIndex, secondary ? profile.soilSecondary : profile.soilPrimary, "soil");
        geology = classIndex(geologyIndex, secondary ? profile.geologySecondary : profile.geologyPrimary, "geology");
        weather = classIndex(weatherIndex, profile.weatherRegion, "weather region");
        if (shore > 0.72 && slopeDegrees < 12) soil = classIndex(soilIndex, "beach-sand", "soil");
        else if (wetness > 0.78 && distanceToWater[index] < 900) soil = classIndex(soilIndex, "peat", "soil");
        else if (distanceToWater[index] < 520 && distanceToOcean[index] > 700 && slopeDegrees < 10) soil = classIndex(soilIndex, "river-silt", "soil");
        else if (elevation > 1750) soil = classIndex(soilIndex, temperature < -4 ? "frost" : "alpine-tundra", "soil");
        else if (slopeDegrees > 30) soil = classIndex(soilIndex, "rocky-thin", "soil");
        if (drainage.data[index] > 0.80 && slopeDegrees < 10) geology = classIndex(geologyIndex, "alluvium", "geology");
      }

      const floodRisk = clamp01(wetness * 0.62 + drainage.data[index] * 0.48 + (distanceToWater[index] < 180 ? 0.35 : 0));
      const slopeSuitability = 1 - smoothstep(7, 20, slopeDegrees);
      const waterAccess = smoothstep(80, 500, distanceToWater[index]) * (1 - smoothstep(5500, 12000, distanceToWater[index]));
      const buildability = elevation <= 0 ? 0 : clamp01(
        slopeSuitability * 0.46 + waterAccess * 0.20 + (1 - floodRisk) * 0.30
        + (profile?.housingBias ?? 0) - shore * 0.18 - smoothstep(1100, 2100, elevation) * 0.30,
      );

      const mineralGeology = ["granite", "slate", "basalt", "metamorphic", "red-sandstone", "ancient-crystal"]
        .includes(GEOLOGY_CLASSES[geology]);
      const forest = clamp01(vegetation * (0.50 + moisture * 0.50) * (1 - smoothstep(22, 38, slopeDegrees)));
      const forage = clamp01(vegetation * (0.48 + wetness * 0.34 + temperatureSuitability * 0.18));
      const ore = elevation <= 0 ? 0 : clamp01((mineralGeology ? 0.58 : 0.12) + scree * 0.24 + smoothstep(180, 900, elevation) * 0.18 - shore * 0.16);
      const stone = elevation <= 0 ? 0 : clamp01(0.20 + smoothstep(8, 34, slopeDegrees) * 0.48 + scree * 0.32);
      const reeds = elevation <= 0 ? 0 : clamp01(wetness * waterProximity * (1 - smoothstep(7, 18, slopeDegrees)) * 1.35);
      const aquatic = elevation <= 0 ? clamp01(0.55 + shore * 0.35) : clamp01(waterProximity * wetness * 0.85);
      const genericResource = Math.max(forest, forage, ore, stone, reeds, aquatic);

      fields.temperatureC.data[index] = temperature;
      fields.precipitation.data[index] = precipitation;
      fields.moisture.data[index] = moisture;
      fields.wetness.data[index] = wetness;
      fields.shorelineInfluence.data[index] = shore;
      fields.slopeDegrees.data[index] = slopeDegrees;
      fields.exposure.data[index] = exposure;
      fields.erosionScree.data[index] = scree;
      fields.buildability.data[index] = buildability;
      fields.vegetationEligibility.data[index] = vegetation;
      fields.soilClass.data[index] = soil;
      fields.geologyClass.data[index] = geology;
      fields.weatherRegionClass.data[index] = weather;
      fields.zoneClass.data[index] = zoneClass;
      fields.resources.forest.data[index] = forest;
      fields.resources.forage.data[index] = forage;
      fields.resources.ore.data[index] = ore;
      fields.resources.stone.data[index] = stone;
      fields.resources.reeds.data[index] = reeds;
      fields.resources.aquatic.data[index] = aquatic;
      fields.resources.generic.data[index] = genericResource;
    }
  }

  return fields;
}
