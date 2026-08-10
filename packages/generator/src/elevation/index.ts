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
import type { Rng, SeedRegistry } from "../seed/index.js";
import type { ContinentId, ContinentLayoutDesign, HeightField, ZoneDesign } from "../types/index.js";

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

function continentMaskAt(u: number, v: number, coastNoise: number): number {
  const cx = 0.5;
  const cy = 0.5;
  const dx = u - cx;
  const dy = v - cy;
  const radial = 1 - Math.sqrt(dx * dx + dy * dy) / 0.62;
  const perturbed = radial + coastNoise * 0.18;
  return Math.max(0, Math.min(1, (perturbed + 0.15) * 1.3));
}

interface ContinentSampler {
  (u: number, v: number): number;
}

/** Builds a continent's own noise-seeded elevation sampler. Safe to call with UV far outside [0,1] -- it just smoothly bottoms out at abyssal ocean depth. */
function buildContinentSampler(rng: Rng, zones: ZoneDesign[]): ContinentSampler {
  const seed = Math.floor(rng.float() * 2 ** 31);
  const detailNoise = createNoise2D(() => (seed + 101) / 2 ** 31);
  const warpNoiseX = createNoise2D(() => (seed + 202) / 2 ** 31);
  const warpNoiseY = createNoise2D(() => (seed + 303) / 2 ** 31);
  const ridgeNoise = createNoise2D(() => (seed + 404) / 2 ** 31);
  const coastNoise = createNoise2D(() => (seed + 505) / 2 ** 31);

  return (u: number, v: number): number => {
    const warpScale = 2.2;
    const warpAmount = 0.06;
    const wx = u + warpAmount * warpNoiseX(u * warpScale, v * warpScale);
    const wy = v + warpAmount * warpNoiseY(u * warpScale, v * warpScale);

    const coastN = coastNoise(u * 3.5, v * 3.5);
    const mask = continentMaskAt(wx, wy, coastN);

    const detail = fractalNoise2D(detailNoise, wx * 4, wy * 4, 5, 2.05, 0.5);
    // Ridge frequency raised 2.5 -> 3.4 and amplitude 900 -> 1600 (docs/01 §5
    // "genuinely big" pass): the old amplitude, layered on top of the old
    // gentle target blend above, produced rolling highland texture rather
    // than a real summit-to-shoulder drop; the higher frequency also tightens
    // individual ridgelines instead of one broad hump spanning the whole
    // mountain zone.
    const ridge = 1 - Math.abs(fractalNoise2D(ridgeNoise, wx * 3.4, wy * 3.4, 4, 2.0, 0.55));

    if (mask > 0.5) {
      const target = zoneTargetElevationAt(u, v, zones);
      const mountainFactor = Math.max(0, Math.min(1, (target - 200) / 1400));
      const localDetailM = detail * 120 + ridge * mountainFactor * 1600;
      const landStrength = Math.min(1, (mask - 0.5) * 2.4);
      return Math.max(1, target * landStrength + localDetailM);
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
      const depthFactor = Math.min(1, (0.5 - mask) * 1.1);
      return -(50 + depthFactor * 3500) + detail * 40;
    }
  };
}

export interface WorldBounds {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export function computeWorldBounds(continentLayout: ContinentLayoutDesign): WorldBounds {
  const tileSize = continentLayout.continentTileSize;
  const offsets = continentLayout.continents.map((c) => c.worldOffset[0]);
  return {
    minX: Math.min(...offsets),
    maxX: Math.max(...offsets) + tileSize,
    minZ: 0,
    maxZ: tileSize,
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
    samplers.set(c.id, buildContinentSampler(rng, zonesForContinent));
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
      data[gy * width + gx] = best;
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
