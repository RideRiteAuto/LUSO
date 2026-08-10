// Stage 5 (docs/01 §5): climate.
// Temperature from latitude + elevation lapse rate; moisture from noise
// modulated by distance-to-water and a simple orographic (rain-shadow) term
// derived from the elevation field's gradient. Two independent scalar
// fields, not yet a biome classification (that's stage 7 / biomes/).

import { createNoise2D } from "simplex-noise";
import type { HeightField, ScalarField } from "../types/index.js";
import type { Rng } from "../seed/index.js";

const LAPSE_RATE_C_PER_M = 0.0065; // ~6.5C per 1000m, standard atmospheric lapse rate

export interface ClimateFields {
  temperatureC: ScalarField;
  moisture: ScalarField;
}

function distanceToWaterField(height: HeightField, riverCellMask?: Uint8Array): Float32Array {
  const { width, height: h, data } = height;
  const n = width * h;
  const dist = new Float32Array(n).fill(Infinity);
  const queue: number[] = [];

  for (let i = 0; i < n; i++) {
    if (data[i] <= 0 || riverCellMask?.[i]) {
      dist[i] = 0;
      queue.push(i);
    }
  }

  // Multi-source BFS for approximate distance-to-ocean in grid cells.
  let head = 0;
  while (head < queue.length) {
    const i = queue[head++];
    const x = i % width;
    const y = Math.floor(i / width);
    const d = dist[i];
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= h) continue;
      const j = ny * width + nx;
      if (dist[j] > d + 1) {
        dist[j] = d + 1;
        queue.push(j);
      }
    }
  }
  return dist;
}

export function generateClimateFields(rng: Rng, height: HeightField, riverCellMask?: Uint8Array): ClimateFields {
  const { width, height: h, data } = height;
  const n = width * h;

  const seed = Math.floor(rng.float() * 2 ** 31);
  const moistureNoise = createNoise2D(() => seed / 2 ** 31);
  const shadowNoise = createNoise2D(() => (seed + 77) / 2 ** 31);

  const distWater = distanceToWaterField(height, riverCellMask);
  let maxDist = 1;
  for (const d of distWater) if (Number.isFinite(d) && d > maxDist) maxDist = d;

  const temperatureC = new Float32Array(n);
  const moisture = new Float32Array(n);

  for (let y = 0; y < h; y++) {
    const v = y / (h - 1);
    // Equator at the middle of the tile; temperature falls off toward both edges.
    const latitudeFactor = 1 - Math.abs(v - 0.5) * 2; // 1 at equator, 0 at poles-of-the-tile
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const elevation = Math.max(0, data[i]);
      const baseTemp = -2 + latitudeFactor * 30; // roughly -2C to 28C band
      temperatureC[i] = baseTemp - elevation * LAPSE_RATE_C_PER_M;

      const u = x / (width - 1);
      const waterProximity = 1 - Math.min(1, distWater[i] / (maxDist * 0.5));
      const n1 = fractal(moistureNoise, u * 3, v * 3);
      const shadow = fractal(shadowNoise, u * 2, v * 2);
      // Tuned so most of a zone's interior (not just cells adjacent to
      // water) reads as vegetated per the bible's descriptions -- only
      // genuinely high/dry/rain-shadowed terrain should read as arid.
      const elevationDryness = Math.min(0.3, elevation / 6000);
      moisture[i] = Math.max(
        0,
        Math.min(1, 0.5 + waterProximity * 0.35 + n1 * 0.18 - elevationDryness - Math.max(0, shadow) * 0.12)
      );
    }
  }

  return {
    temperatureC: { width, height: h, data: temperatureC },
    moisture: { width, height: h, data: moisture },
  };
}

function fractal(noise2D: (x: number, y: number) => number, x: number, y: number): number {
  return (noise2D(x, y) + noise2D(x * 2, y * 2) * 0.5 + noise2D(x * 4, y * 4) * 0.25) / 1.75;
}
