// The Luna Sea island arc.
//
// When a landmass rifts apart, the opening ocean is not empty: the stretched
// margin leaves continental fragments behind and the spreading axis builds a
// volcanic chain along it. That is the same reason ArcheAge's sea between
// Nuia and Haranya is a scatter of islands rather than blank water, and it
// gives the crossing something to navigate by.
//
// Islands are placed along the rift axis, deterministically from the world
// seed, kept far enough off both coasts to read as destinations rather than
// offshore rocks. The Bruma is deliberately NOT excluded: it is strange
// water rather than forbidden water, and islands standing in the anomaly are
// the most interesting ground the sea has to offer.

import { createNoise2D } from "simplex-noise";
import { mulberry32 } from "../seed/index.js";
import type { ContinentLayoutDesign } from "../types/index.js";

type Noise2D = (x: number, y: number) => number;

export interface IslandNoise {
  placement: Noise2D;
  shape: Noise2D;
  relief: Noise2D;
}

export function buildIslandNoise(seed: number): IslandNoise {
  return {
    placement: createNoise2D(mulberry32(seed + 3001)),
    shape: createNoise2D(mulberry32(seed + 3002)),
    relief: createNoise2D(mulberry32(seed + 3003)),
  };
}

export interface IslandFieldConfig {
  /** How many islands to attempt along the arc. */
  count: number;
  /** Island radius range in metres — content-sized, never a third continent. */
  minRadiusM: number;
  maxRadiusM: number;
  /**
   * The Bruma is strange water, not forbidden water — ships cross it and
   * anything found there is fair game to build on. Positive values pull the
   * arc away from it; zero lets the chain run straight through.
   */
  brumaKeepOutM: number;
  coastKeepOutM: number;
}

export const DEFAULT_ISLAND_CONFIG: IslandFieldConfig = {
  count: 16,
  minRadiusM: 1_100,
  maxRadiusM: 3_400,
  // No exclusion: the anomaly is a place to sail into and build on, and
  // islands standing in it are the most interesting ground in the sea.
  brumaKeepOutM: 0,
  coastKeepOutM: 4_500,
};

export interface Island {
  x: number;
  z: number;
  radiusM: number;
  peakM: number;
  phase: number;
}

function fbm(noise: Noise2D, x: number, y: number, octaves: number): number {
  let amplitude = 1, frequency = 1, sum = 0, maxAmplitude = 0;
  for (let octave = 0; octave < octaves; octave++) {
    sum += noise(x * frequency, y * frequency) * amplitude;
    maxAmplitude += amplitude;
    amplitude *= 0.5;
    frequency *= 2.05;
  }
  return sum / maxAmplitude;
}

/**
 * Lays the arc out along the sea gap. `riftOffsetAt` is the same wandering
 * curve that shapes the two facing coastlines, so the chain follows the seam
 * the continents tore along instead of running down an arbitrary straight
 * line through the middle of the sea.
 */
export function planIslands(
  layout: ContinentLayoutDesign,
  noise: IslandNoise,
  riftOffsetAt: (v: number) => number,
  config: IslandFieldConfig = DEFAULT_ISLAND_CONFIG,
): Island[] {
  const tile = layout.continentTileSize;
  const valora = layout.continents.find((continent) => continent.id === "valora")!;
  const seradia = layout.continents.find((continent) => continent.id === "seradia")!;
  const gapWest = valora.worldOffset[0] + tile;
  const gapEast = seradia.worldOffset[0];
  const usableWest = gapWest + config.coastKeepOutM;
  const usableEast = gapEast - config.coastKeepOutM;
  if (usableEast <= usableWest) return [];

  // A narrow sea holds smaller islands: sized as a fraction of the water
  // available, so a channel gets a scatter of skerries rather than two plugs
  // that nearly bridge it.
  const bandWidth = usableEast - usableWest;
  const maxRadiusM = Math.min(config.maxRadiusM, bandWidth * 0.11);
  // Hold the floor well below the cap. Tying the minimum to a fixed fraction
  // of the maximum means a narrow sea, whose cap is already low, squeezes the
  // two together and every island comes out the same size — which is the one
  // thing an archipelago never looks like.
  const minRadiusM = Math.min(config.minRadiusM, maxRadiusM * 0.28);

  const islands: Island[] = [];
  // Walk a jittered lattice over the whole sea, not a single file down the
  // middle: a chain of evenly spaced dots reads as a dotted line on a map,
  // where a real archipelago clusters and thins. Density is highest along the
  // seam — that is where the volcanism follows the tear — and falls off
  // toward each coast.
  const rows = Math.max(4, Math.round(Math.sqrt(config.count * 3)));
  const columns = Math.max(2, Math.ceil(config.count / rows) + 2);
  const seamOf = (worldZ: number) => {
    const v = (worldZ - layout.continents[0].worldOffset[1]) / tile;
    return (gapWest + gapEast) / 2 + riftOffsetAt(v) * tile;
  };

  for (let row = 0; row < rows && islands.length < config.count; row++) {
    for (let column = 0; column < columns && islands.length < config.count; column++) {
      const rowT = (row + 0.5) / rows;
      const columnT = (column + 0.5) / columns;
      const jitterZ = fbm(noise.placement, row * 3.1 + 0.5, column * 2.7, 2) * (tile / rows) * 0.92;
      const jitterX = fbm(noise.placement, column * 4.3, row * 1.9 + 7.7, 2) * ((usableEast - usableWest) / columns) * 0.95;
      const worldZ = layout.continents[0].worldOffset[1] + rowT * tile + jitterZ;
      const worldX = usableWest + columnT * (usableEast - usableWest) + jitterX;
      if (worldX < usableWest || worldX > usableEast) continue;
      if (worldZ < layout.continents[0].worldOffset[1] || worldZ > layout.continents[0].worldOffset[1] + tile) continue;

      // Thin the field out away from the seam, and leave gaps so the arc has
      // clusters and open water rather than uniform coverage.
      const seamDistance = Math.abs(worldX - seamOf(worldZ));
      const seamFalloff = 1 - Math.min(1, seamDistance / Math.max(1, (usableEast - usableWest) * 0.55));
      const clustering = fbm(noise.placement, worldX / 9_000, worldZ / 9_000, 2) * 0.5 + 0.5;
      if (clustering * (0.55 + seamFalloff * 0.85) < 0.26) continue;

      if (config.brumaKeepOutM > 0) {
        const brumaDistance = Math.hypot(worldX - layout.bruma.center[0], worldZ - layout.bruma.center[1]);
        if (brumaDistance < config.brumaKeepOutM + layout.bruma.radiusUnits) continue;
      }

      // Skewed so the sea is mostly skerries with a few real islands, the
      // way an archipelago actually reads. fbm concentrates around its
      // midpoint, so it is stretched before the skew — raw, it delivered
      // almost every island at the same middling size.
      const roll = Math.max(0, Math.min(1, fbm(noise.placement, worldX / 4_400, worldZ / 4_400, 2) * 0.95 + 0.5));
      const size = Math.pow(roll, 1.8);
      const radiusM = minRadiusM + size * (maxRadiusM - minRadiusM);
      // Small islands are low and rounded; the larger ones earn a real summit.
      const peakM = 60 + Math.pow(size, 1.4) * 420;
      const candidate: Island = { x: worldX, z: worldZ, radiusM, peakM, phase: (row * 7.3 + column * 3.1) % 41 };

      // Keep them distinct: never close enough to merge into one mass.
      const tooClose = islands.some((existing) =>
        Math.hypot(existing.x - candidate.x, existing.z - candidate.z) < (existing.radiusM + candidate.radiusM) * 1.5);
      if (tooClose) continue;
      islands.push(candidate);
    }
  }
  return islands;
}

/**
 * Island elevation at a world point, or `-Infinity` where the arc has no
 * opinion. Returns a positive height inside an island, and a raised (but
 * still submerged) shelf value around it — an island rising sheer from the
 * abyss reads as a spike, where a real one sits on its own platform.
 */
export function islandElevationAt(worldX: number, worldZ: number, islands: Island[], noise: IslandNoise): number {
  let best = -Infinity;
  for (const island of islands) {
    const rawDistance = Math.hypot(worldX - island.x, worldZ - island.z);
    const shelfReach = island.radiusM * 2.0;
    if (rawDistance > shelfReach) continue;

    // Deform the island by warping the sample point, not by modulating a
    // radius against the polar angle: an angular radius function turns noise
    // octaves into radial spikes, which renders as a starburst rather than
    // an island. Warping in x/z gives a lobed, organically bent outline.
    //
    // Both numbers here are about keeping that warp gentle relative to the
    // island. A wavelength shorter than the island turns the outline into a
    // ragged fringe, and an amplitude near half the radius folds the shore
    // back over itself into arms — together they were rendering the arc as a
    // field of sea urchins. One long, shallow bend per island instead.
    //
    // Two scales, because one is either a bend or a fringe and never both: the
    // long warp leans the whole island off-centre, the short one puts bays and
    // points along its shore. A single long warp on its own is close to an
    // affine transform of a circle, which is to say an ellipse — a field of
    // identical stamped ovals.
    const longScale = Math.max(1_400, island.radiusM * 2.1);
    const shortScale = Math.max(520, island.radiusM * 0.75);
    const warp = (x: number, z: number, salt: number): number =>
      fbm(noise.shape, x / longScale + island.phase + salt, z / longScale, 2) * island.radiusM * 0.20
      + fbm(noise.shape, x / shortScale + island.phase * 1.7 + salt, z / shortScale, 2) * island.radiusM * 0.17;
    const warpedX = worldX + warp(worldX, worldZ, 0);
    const warpedZ = worldZ + warp(worldX, worldZ, 31.7);
    const distance = Math.hypot(warpedX - island.x, warpedZ - island.z);
    const radius = island.radiusM;

    if (distance < radius) {
      const inland = 1 - distance / radius;
      // Relief scaled to the island: a fixed noise wavelength gives a 2 km
      // skerry the same detail as a 6 km island, which reads as spikes.
      const reliefScale = Math.max(700, island.radiusM * 1.15);
      const relief = fbm(noise.relief, worldX / reliefScale, worldZ / reliefScale, 2) * 0.18;
      const height = Math.pow(inland, 0.72) * island.peakM * (1 + relief);
      best = Math.max(best, Math.max(2, height));
    } else {
      // Surrounding platform, measured on the SAME warped distance as the
      // shore so it is a lobed apron rather than a ring drawn around a disc.
      const out = (distance - radius) / Math.max(1, shelfReach - radius);
      if (out > 1) continue;
      const eased = out * out * (3 - 2 * out);
      best = Math.max(best, -14 - eased * 620);
    }
  }
  return best;
}
