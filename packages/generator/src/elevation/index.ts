// Stage 3 (docs/01 §3): elevation.
//
// Generates ONE unified heightfield spanning the whole world (both
// continent tiles AND the open Luna Sea between them), not two independent
// per-continent tiles stitched together by the viewer. Each continent still
// gets its own noise-seeded "sampler" (so Valora and Seradia keep distinct
// terrain character, per docs/03 §1's two-grammar requirement), but every
// sampler is evaluated across the FULL world grid and combined with max() --
// which, because each continent's own ocean-depth falloff already smoothly
// reaches full abyssal depth far from that continent's coast (see
// sampleContinentElevation below), means the connecting seabed just falls
// out of the existing per-continent formula once it's actually evaluated
// out there, with no separate "ocean floor" model needed. This is the fix
// for the "why is the gap between continents just empty ocean" bug Kevin
// flagged -- there was no seafloor data at all out there before this.
//
// Downstream stages (hydrology/climate/zones/biomes/resources/ecology/
// settlements/roads) still want a per-continent-local [0,1]x[0,1] UV grid
// exactly like before -- sliceContinentField() below extracts that from the
// unified field so none of those stages needed to change.

import { createNoise2D } from "simplex-noise";
import { mulberry32, type Rng, type SeedRegistry } from "../seed/index.js";
import type { ContinentId, ContinentLayoutDesign, HeightField, ZoneDesign } from "../types/index.js";

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const smoothstep = (a: number, b: number, value: number): number => {
  const t = clamp01((value - a) / Math.max(0.000001, b - a));
  return t * t * (3 - 2 * t);
};

/** Named bathymetric bands used by QA, navigation, and future sea ecology. */
export const BATHYMETRY_BANDS_M = {
  navigableShallows: [-80, 0] as [number, number],
  continentalShelf: [-700, -80] as [number, number],
  continentalSlope: [-2_800, -700] as [number, number],
  lunaSeaAbyss: [-3_850, -2_800] as [number, number],
  trench: [-4_350, -3_850] as [number, number],
};

function fractalNoise2D(noise2D: (x: number, y: number) => number, x: number, y: number, octaves: number, lacunarity: number, persistence: number): number {
  let amplitude = 1;
  let frequency = 1;
  let sum = 0;
  let maxAmp = 0;
  for (let o = 0; o < octaves; o++) {
    sum += noise2D(x * frequency, y * frequency) * amplitude;
    maxAmp += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }
  return sum / maxAmp; // normalized to roughly [-1, 1]
}

/**
 * Inverse-distance-weighted blend of each zone's target elevation midpoint,
 * in continent-local UV space.
 *
 * Exponent raised from 2.2 to 4.5 (Kevin: "these mountains need to be
 * genuinely big... I should have to look up"). At 2.2 a high zone's pull
 * reached ~8-12km into its neighbors, so a peak sat on a broad shared
 * plateau with everything around it already elevated -- Corvento's 2288m
 * summit was still standing on ~1500m of "base" 3km out, an ~20 degree
 * average grade the whole way, nothing you'd call a climb. At 4.5 each
 * zone's target dominates its own neighborhood and hands off to the next
 * zone over a much shorter span, so a mountain zone's low-elevation
 * neighbor actually reads as a nearby valley floor instead of a highland
 * shelf, and the ridge/detail terms below (evaluated independently of this
 * blend) supply the local relief on top of that sharper base.
 */
function zoneTargetElevationAt(u: number, v: number, zones: ZoneDesign[]): number {
  let weightSum = 0;
  let valueSum = 0;
  for (const zone of zones) {
    const [zu, zv] = zone.anchor;
    const dx = u - zu;
    const dy = v - zv;
    const dist = Math.sqrt(dx * dx + dy * dy) + 1e-4;
    const weight = 1 / Math.pow(dist, 4.5);
    const midpoint = (zone.elevationTargetM[0] + zone.elevationTargetM[1]) / 2;
    weightSum += weight;
    valueSum += weight * midpoint;
  }
  return weightSum > 0 ? valueSum / weightSum : 0;
}

function continentMaskAt(u: number, v: number, coastNoise: number, continent: ContinentId, zones: ZoneDesign[]): number {
  const dx = u - 0.5;
  const dy = v - 0.5;
  const anchor = (zoneId: string, fallback: [number, number]): [number, number] =>
    zones.find((zone) => zone.id === zoneId)?.anchor ?? fallback;
  let macro: number;
  if (continent === "valora") {
    // Broad, diagonally-oriented mainland with a southwestern peninsula and
    // a northeastern coastal bite. It remains recognizably Valora across
    // seeds while small-scale coast noise changes the shoreline.
    const angle = -0.28;
    const rx = dx * Math.cos(angle) - dy * Math.sin(angle);
    const ry = dx * Math.sin(angle) + dy * Math.cos(angle);
    const body = 1 - Math.hypot(rx / 0.58, ry / 0.45);
    const peninsula = 0.35 - Math.hypot((u - 0.2) / 0.24, (v - 0.73) / 0.3);
    const cavora = anchor("cavora", [0.8, 0.25]);
    const alvora = anchor("alvora", [0.85, 0.5]);
    const gulf = 0.38 - Math.hypot((u - (cavora[0] - 0.02)) / 0.2, (v - (cavora[1] + 0.02)) / 0.22);
    // These two macro cuts are canon geography, not arbitrary coast noise:
    // the Stormbreak gulf supplies Cavora's deep natural harbor coast, while
    // the Crownlands bay supports Alvora's fishing/coastal transport identity.
    const crownlandsBay = 0.18 - Math.hypot((u - (alvora[0] + 0.11)) / 0.13, (v - (alvora[1] + 0.03)) / 0.18);
    macro = Math.max(body, peninsula)
      - Math.max(0, gulf) * 0.70
      - Math.max(0, crownlandsBay) * 0.38;
  } else {
    // Seradia is a taller crescent with a broken eastern coast, deliberately
    // unlike Valora's broad diagonal body.
    const outer = 1 - Math.hypot(dx / 0.43, dy / 0.59);
    const innerBay = 0.42 - Math.hypot((u - 0.34) / 0.29, (v - 0.5) / 0.43);
    const northernShoulder = 0.28 - Math.hypot((u - 0.67) / 0.24, (v - 0.2) / 0.24);
    // Sunreach's broad estuarine bight is the ocean receiver for its authored
    // delta/distributary system; it is not a generic decorative bay.
    const solmara = anchor("solmara", [0.2, 0.75]);
    const sunreachBight = 0.20 - Math.hypot((u - (solmara[0] - 0.05)) / 0.13, (v - (solmara[1] + 0.03)) / 0.17);
    macro = Math.max(outer - Math.max(0, innerBay) * 0.9 - Math.max(0, sunreachBight) * 0.45, northernShoulder);
  }
  // Coast noise supplies natural bays and headlands, but it must remain
  // subordinate to the continental silhouette. The former 0.14 amplitude
  // produced similarly sized scallops every few height cells, which read as
  // a repeated saw-tooth pattern from flight altitude.
  const perturbed = macro + coastNoise * (continent === "valora" ? 0.10 : 0.12);
  return Math.max(0, Math.min(1, (perturbed + 0.15) * 1.3));
}

interface ContinentSampler {
  (u: number, v: number): number;
}

/** Builds a continent's own noise-seeded elevation sampler. Safe to call with UV far outside [0,1] -- it just smoothly bottoms out at abyssal ocean depth. */
function buildContinentSampler(rng: Rng, zones: ZoneDesign[], continent: ContinentId): ContinentSampler {
  const seed = Math.floor(rng.float() * 2 ** 31);
  // simplex-noise expects a stateful random sequence while it builds its
  // permutation table. Passing a constant function creates biased and highly
  // correlated fields even when the constant itself differs by seed.
  const detailNoise = createNoise2D(mulberry32(seed + 101));
  const warpNoiseX = createNoise2D(mulberry32(seed + 202));
  const warpNoiseY = createNoise2D(mulberry32(seed + 303));
  const ridgeNoise = createNoise2D(mulberry32(seed + 404));
  const coastNoise = createNoise2D(mulberry32(seed + 505));
  const secondaryRidgeNoise = createNoise2D(mulberry32(seed + 606));
  const valleyNoise = createNoise2D(mulberry32(seed + 707));
  const faultNoise = createNoise2D(mulberry32(seed + 808));
  const microNoise = createNoise2D(mulberry32(seed + 909));

  return (u: number, v: number): number => {
    const warpScale = 2.2;
    const warpAmount = 0.06;
    const wx = u + warpAmount * warpNoiseX(u * warpScale, v * warpScale);
    const wy = v + warpAmount * warpNoiseY(u * warpScale, v * warpScale);

    const coastN = coastNoise(u * 2.6, v * 2.6);
    const mask = continentMaskAt(wx, wy, coastN, continent, zones);

    const detail = fractalNoise2D(detailNoise, wx * 3.2, wy * 3.2, 6, 2.05, 0.5);
    // Ridge frequency raised 2.5 -> 3.4 and amplitude 900 -> 1600 (docs/01 §5
    // "genuinely big" pass): the old amplitude, layered on top of the old
    // gentle target blend above, produced rolling highland texture rather
    // than a real summit-to-shoulder drop; the higher frequency also tightens
    // individual ridgelines instead of one broad hump spanning the whole
    // mountain zone.
    const majorRidgeRaw = 1 - Math.abs(fractalNoise2D(ridgeNoise, wx * 3.1, wy * 3.1, 5, 2.0, 0.54));
    const majorRidge = Math.pow(Math.max(0, majorRidgeRaw), 3.2);
    const secondaryRidgeRaw = 1 - Math.abs(fractalNoise2D(secondaryRidgeNoise, wx * 9, wy * 9, 4, 2.1, 0.5));
    const secondaryRidge = Math.pow(Math.max(0, secondaryRidgeRaw), 4.5);
    const microRidgeRaw = 1 - Math.abs(fractalNoise2D(microNoise, wx * 27, wy * 27, 3, 2.15, 0.48));
    const microRidge = Math.pow(Math.max(0, microRidgeRaw), 6);
    const drainageRaw = 1 - Math.abs(fractalNoise2D(valleyNoise, wx * 7, wy * 7, 4, 2.0, 0.52));
    const drainage = Math.pow(Math.max(0, drainageRaw), 9);
    const fault = fractalNoise2D(faultNoise, wx * 5.5, wy * 5.5, 4, 2.05, 0.5);
    const brokenRelief = Math.sign(fault) * Math.pow(Math.abs(fault), 0.58);
    const fineRelief = fractalNoise2D(microNoise, wx * 48, wy * 48, 3, 2.2, 0.46);

    if (mask > 0.5) {
      const target = zoneTargetElevationAt(u, v, zones);
      const mountainFactor = Math.max(0, Math.min(1, (target - 200) / 1400));
      const uplandFactor = Math.max(0.18, Math.min(1, (target + 100) / 1100));
      const localDetailM =
        detail * 170 +
        majorRidge * mountainFactor * 2100 +
        secondaryRidge * uplandFactor * 520 +
        microRidge * uplandFactor * 135 +
        brokenRelief * uplandFactor * 210 +
        fineRelief * 58 -
        drainage * (90 + uplandFactor * 260);
      const landStrength = Math.min(1, (mask - 0.5) * 2.4);
      const coastDetailStrength = Math.max(0.12, Math.min(1, landStrength * 1.7));
      let landElevation = Math.max(1, target * landStrength + localDetailM * coastDetailStrength);

      // Vidrala's Glassmere is authored as an actual positive-elevation
      // basin in the authoritative terrain. Hydrology later computes its
      // fill surface, lowest spill saddle, outlet, and shoreline from this
      // depression; this is terrain authorship, not a decorative water disc.
      if (continent === "seradia") {
        const lakeX = (u - 0.545) / 0.060;
        const lakeY = (v - 0.305) / 0.044;
        const lakeRadius = Math.hypot(lakeX, lakeY);
        const irregularLakeRadius = lakeRadius + detail * 0.095 + fault * 0.035 + fineRelief * 0.018;
        const basinBlend = 1 - smoothstep(0.74, 1.13, irregularLakeRadius);
        if (basinBlend > 0) {
          const glassmereBed = 168 + Math.min(1, Math.max(0, irregularLakeRadius)) ** 1.7 * 46 + fineRelief * 4;
          landElevation += (Math.min(landElevation, glassmereBed) - landElevation) * basinBlend;
        }
      }
      return Math.max(1, landElevation);
    } else {
      // Ocean branch: depthFactor -> 1 as mask -> 0 (or below, once UV is far
      // outside this continent's own tile), so this naturally reaches full
      // abyssal depth far from the continent instead of only near its coast.
      // Multiplier softened 2.2 -> 1.1 (docs/01 §5 coastline pass): the old
      // rate hit full depthFactor (and thus near-abyssal depth) within
      // ~2km of the shore, which combined with any renderable mesh
      // resolution reads as a stair-stepped cliff at the waterline rather
      // than a beach -- there's no grid fine enough to make a near-vertical
      // drop look smooth. Spreading the same drop over roughly 2x the
      // distance gives an actual shelf a coastline mesh can resolve, and
      // matches most real coastlines better than an offshore cliff anyway.
      const depthFactor = Math.min(1, (0.5 - mask) * 2.0);
      // Begin at roughly one meter below sea level and ease into depth with
      // a super-linear curve. The old fixed -50m first ocean sample made an
      // underwater cliff at every beach; this curve produces real shallows,
      // a broad shelf, then a continental slope without flattening the coast.
      const shelfDepth = 1 + Math.pow(depthFactor, 1.48) * 3549;
      return -shelfDepth + detail * 24 * Math.sqrt(depthFactor);
    }
  };
}

/**
 * Adds world-scale Luna Sea structure after the two continent grammars have
 * been combined. Nearshore values are preserved; only established deep water
 * receives the abyss, trench, and Bruma basin hooks.
 */
export function shapeOceanBathymetry(
  baseElevationM: number,
  worldX: number,
  worldZ: number,
  layout: ContinentLayoutDesign,
): number {
  if (baseElevationM >= 0) return baseElevationM;
  const tileSize = layout.continentTileSize;
  const valora = layout.continents.find((continent) => continent.id === "valora")!;
  const seradia = layout.continents.find((continent) => continent.id === "seradia")!;
  const gapWest = valora.worldOffset[0] + tileSize;
  const gapEast = seradia.worldOffset[0];
  const insideLunaGap = worldX > gapWest && worldX < gapEast;
  const distanceFromNominalCoast = insideLunaGap ? Math.min(worldX - gapWest, gapEast - worldX) : 0;
  const establishedDeepWater = smoothstep(900, 2_300, -baseElevationM);
  const openSea = insideLunaGap ? smoothstep(tileSize * 0.08, tileSize * 0.36, distanceFromNominalCoast) : 0;

  let result = baseElevationM;
  const abyssTarget = -2_850 - openSea * 550;
  result += (Math.min(result, abyssTarget) - result) * establishedDeepWater * openSea;

  const brumaDistance = Math.hypot(worldX - layout.bruma.center[0], worldZ - layout.bruma.center[1]);
  const brumaHook = (1 - smoothstep(layout.bruma.radiusUnits * 0.32, layout.bruma.radiusUnits * 1.05, brumaDistance))
    * establishedDeepWater;
  result += (Math.min(result, -4_080) - result) * brumaHook;

  // A narrow, curved deep-water feature south of Bruma gives the Luna Sea
  // a legible abyssal grammar without turning the whole gap into one bowl.
  const trenchX = layout.bruma.center[0] + tileSize * 0.11;
  const trenchZ = layout.bruma.center[1] + tileSize * 0.28;
  const trenchDistance = Math.hypot((worldX - trenchX) / (tileSize * 0.055), (worldZ - trenchZ) / (tileSize * 0.20));
  const trenchHook = (1 - smoothstep(0.55, 1.35, trenchDistance)) * establishedDeepWater;
  result += (Math.min(result, -4_280) - result) * trenchHook;
  return result;
}

export interface WorldBounds {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export function computeWorldBounds(continentLayout: ContinentLayoutDesign): WorldBounds {
  const tileSize = continentLayout.continentTileSize;
  const xOffsets = continentLayout.continents.map((c) => c.worldOffset[0]);
  const zOffsets = continentLayout.continents.map((c) => c.worldOffset[1]);
  // The continent mask intentionally reaches beyond the nominal tile square.
  // The old bounds ended exactly on that square, allowing positive land at a
  // heightfield edge. The viewer then copied those edge elevations into its
  // ocean skirt, producing the enormous diagonal "extrusions". A generated
  // ocean margin makes every authoritative outer edge bathymetry, not land.
  const oceanMargin = tileSize * 0.25;
  return {
    minX: Math.min(...xOffsets) - oceanMargin,
    maxX: Math.max(...xOffsets) + tileSize + oceanMargin,
    minZ: Math.min(...zOffsets) - oceanMargin,
    maxZ: Math.max(...zOffsets) + tileSize + oceanMargin,
  };
}

export interface UnifiedWorldField {
  field: HeightField;
  bounds: WorldBounds;
}

/**
 * Generates the single unified heightfield for the whole world.
 * metersPerCell controls resolution -- same knob as the old per-continent
 * `resolution` CLI flag, just now expressed as an actual physical unit
 * since world units are meters (docs/01 §5).
 */
export function generateWorldHeightField(
  seeds: SeedRegistry,
  continentLayout: ContinentLayoutDesign,
  zoneDesigns: ZoneDesign[],
  metersPerCell: number
): UnifiedWorldField {
  const bounds = computeWorldBounds(continentLayout);
  const tileSize = continentLayout.continentTileSize;

  const samplers = new Map<ContinentId, ContinentSampler>();
  const offsets = new Map<ContinentId, [number, number]>();
  for (const c of continentLayout.continents) {
    const rng = seeds.rngFor("elevation", c.id);
    const zonesForContinent = zoneDesigns.filter((z) => z.continent === c.id);
    samplers.set(c.id, buildContinentSampler(rng, zonesForContinent, c.id));
    offsets.set(c.id, c.worldOffset);
  }

  const width = Math.max(2, Math.round((bounds.maxX - bounds.minX) / metersPerCell));
  const height = Math.max(2, Math.round((bounds.maxZ - bounds.minZ) / metersPerCell));
  const data = new Float32Array(width * height);

  for (let gy = 0; gy < height; gy++) {
    const wz = bounds.minZ + (gy / (height - 1)) * (bounds.maxZ - bounds.minZ);
    for (let gx = 0; gx < width; gx++) {
      const wx = bounds.minX + (gx / (width - 1)) * (bounds.maxX - bounds.minX);

      let best = -Infinity;
      for (const [id, sampler] of samplers) {
        const [ox, oz] = offsets.get(id)!;
        const u = (wx - ox) / tileSize;
        const v = (wz - oz) / tileSize;
        const e = sampler(u, v);
        if (e > best) best = e;
      }
      data[gy * width + gx] = shapeOceanBathymetry(best, wx, wz, continentLayout);
    }
  }

  return { field: { width, height, data }, bounds };
}

/** Resamples a continent's own [0,1]x[0,1] local region out of the unified world field, for the existing per-continent pipeline stages (hydrology, biomes, resources, ...). */
export function sliceContinentField(world: UnifiedWorldField, continentLayout: ContinentLayoutDesign, continentId: ContinentId, targetResolution: number): HeightField {
  const tileSize = continentLayout.continentTileSize;
  const continent = continentLayout.continents.find((c) => c.id === continentId);
  if (!continent) throw new Error(`Unknown continent in continents.json: ${continentId}`);
  const [ox, oz] = continent.worldOffset;

  const { field, bounds } = world;
  const data = new Float32Array(targetResolution * targetResolution);

  for (let ly = 0; ly < targetResolution; ly++) {
    const v = ly / (targetResolution - 1);
    const wz = oz + v * tileSize;
    const gy = Math.min(field.height - 1, Math.max(0, Math.round(((wz - bounds.minZ) / (bounds.maxZ - bounds.minZ)) * (field.height - 1))));
    for (let lx = 0; lx < targetResolution; lx++) {
      const u = lx / (targetResolution - 1);
      const wx = ox + u * tileSize;
      const gx = Math.min(field.width - 1, Math.max(0, Math.round(((wx - bounds.minX) / (bounds.maxX - bounds.minX)) * (field.width - 1))));
      data[ly * targetResolution + lx] = field.data[gy * field.width + gx];
    }
  }

  return { width: targetResolution, height: targetResolution, data };
}
