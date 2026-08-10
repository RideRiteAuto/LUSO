// Stage 3 (docs/01 §3): elevation.
// Produces a per-continent heightfield shaped by (a) a radial continent mask
// so land is surrounded by ocean, (b) an inverse-distance-weighted "zone
// elevation target" field so each zone's terrain roughly matches the bible's
// geography (coastal zones stay low, mountain zones get pushed up), and
// (c) multi-octave domain-warped noise for local detail (hills, ridges).

import { createNoise2D } from "simplex-noise";
import type { Rng } from "../seed/index.js";
import type { ContinentId, HeightField, ZoneDesign } from "../types/index.js";

export interface ElevationOptions {
  resolution: number;
  continent: ContinentId;
  zones: ZoneDesign[];
}

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

/** Inverse-distance-weighted blend of each zone's target elevation midpoint, in continent-local UV space. */
function zoneTargetElevationAt(u: number, v: number, zones: ZoneDesign[]): number {
  let weightSum = 0;
  let valueSum = 0;
  for (const zone of zones) {
    const [zu, zv] = zone.anchor;
    const dx = u - zu;
    const dy = v - zv;
    const dist = Math.sqrt(dx * dx + dy * dy) + 1e-4;
    // Falloff tuned so a zone's own radius dominates its target elevation,
    // while distant zones contribute negligibly.
    const weight = 1 / Math.pow(dist, 2.2);
    const midpoint = (zone.elevationTargetM[0] + zone.elevationTargetM[1]) / 2;
    weightSum += weight;
    valueSum += weight * midpoint;
  }
  return weightSum > 0 ? valueSum / weightSum : 0;
}

/** Radial-ish continent mask: 1.0 deep in the landmass, 0.0 in open ocean, noise-perturbed coastline. */
function continentMaskAt(u: number, v: number, coastNoise: number): number {
  // Land occupies roughly the zone-anchor footprint; bias mask toward the
  // union of zone circles rather than a single global radius, so an
  // irregular archipelago-free single landmass emerges that still traces
  // the zones.json layout.
  const cx = 0.5;
  const cy = 0.5;
  const dx = u - cx;
  const dy = v - cy;
  const radial = 1 - Math.sqrt(dx * dx + dy * dy) / 0.62; // ~0 near tile edges
  const perturbed = radial + coastNoise * 0.18;
  return Math.max(0, Math.min(1, (perturbed + 0.15) * 1.3));
}

export function generateHeightField(rng: Rng, opts: ElevationOptions): HeightField {
  const { resolution, zones } = opts;
  const seed = Math.floor(rng.float() * 2 ** 31);
  const baseNoise = createNoise2D(() => seed / 2 ** 31);
  const detailNoise = createNoise2D(() => (seed + 101) / 2 ** 31);
  const warpNoiseX = createNoise2D(() => (seed + 202) / 2 ** 31);
  const warpNoiseY = createNoise2D(() => (seed + 303) / 2 ** 31);
  const ridgeNoise = createNoise2D(() => (seed + 404) / 2 ** 31);
  const coastNoise = createNoise2D(() => (seed + 505) / 2 ** 31);

  const data = new Float32Array(resolution * resolution);

  for (let y = 0; y < resolution; y++) {
    const v = y / (resolution - 1);
    for (let x = 0; x < resolution; x++) {
      const u = x / (resolution - 1);

      // Domain warp for more organic coastlines/ridges.
      const warpScale = 2.2;
      const warpAmount = 0.06;
      const wx = u + warpAmount * warpNoiseX(u * warpScale, v * warpScale);
      const wy = v + warpAmount * warpNoiseY(u * warpScale, v * warpScale);

      const coastN = coastNoise(u * 3.5, v * 3.5);
      const mask = continentMaskAt(wx, wy, coastN);

      const target = zoneTargetElevationAt(u, v, zones);

      const detail = fractalNoise2D(detailNoise, wx * 4, wy * 4, 5, 2.05, 0.5);
      const ridge = 1 - Math.abs(fractalNoise2D(ridgeNoise, wx * 2.5, wy * 2.5, 4, 2.0, 0.55));

      // Ridged contribution scales with how mountainous the local zone
      // target is (mountains get sharp ridges; lowlands stay smooth).
      const mountainFactor = Math.max(0, Math.min(1, (target - 200) / 1400));
      const localDetailM = detail * 120 + ridge * mountainFactor * 900;

      let elevation: number;
      if (mask > 0.5) {
        // Land: target elevation (zone-driven) + local detail, scaled up
        // smoothly from the coastline (mask ~0.5) to full expression inland.
        const landStrength = Math.min(1, (mask - 0.5) * 2.4);
        elevation = target * landStrength + localDetailM;
        elevation = Math.max(1, elevation); // keep land strictly above sea level
      } else {
        // Ocean: shallow shelf near the coast, deeper further out.
        const depthFactor = Math.min(1, (0.5 - mask) * 2.2);
        elevation = -(50 + depthFactor * 3500) + detail * 40;
      }

      data[y * resolution + x] = elevation;
    }
  }

  return { width: resolution, height: resolution, data };
}
