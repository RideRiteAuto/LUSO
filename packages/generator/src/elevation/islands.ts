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
//
// Each island is built the way the continents are — a small metaball mass
// over several offset lobes, in its own rotated and stretched frame. An
// island defined as "within radius R of a point" is a disc, and no amount of
// edge noise rescues it: the earlier arc read as a field of fried eggs,
// eighteen circles each ringed by a perfectly concentric shelf. Lobes are
// what make an island long, or bent, or forked, or trailing a skerry.

import { createNoise2D } from "simplex-noise";
import { mulberry32 } from "../seed/index.js";
import type { ContinentLayoutDesign } from "../types/index.js";

type Noise2D = (x: number, y: number) => number;

export interface IslandNoise {
  placement: Noise2D;
  shape: Noise2D;
  relief: Noise2D;
  /** Kept so island geometry can draw stable per-island random variation. */
  seed: number;
}

export function buildIslandNoise(seed: number): IslandNoise {
  return {
    placement: createNoise2D(mulberry32(seed + 3001)),
    shape: createNoise2D(mulberry32(seed + 3002)),
    relief: createNoise2D(mulberry32(seed + 3003)),
    seed,
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
  minRadiusM: 700,
  maxRadiusM: 3_400,
  // No exclusion: the anomaly is a place to sail into and build on, and
  // islands standing in it are the most interesting ground in the sea.
  brumaKeepOutM: 0,
  coastKeepOutM: 4_500,
};

/** One rounded swelling of an island's mass, in the island's local frame. */
interface IslandLobe { dx: number; dz: number; radius: number }

export interface Island {
  x: number;
  z: number;
  /** Nominal size — the scale the lobes and relief are derived from. */
  radiusM: number;
  /** Cull radius: no sample beyond this can be affected by this island. */
  reachM: number;
  peakM: number;
  phase: number;
  lobes: IslandLobe[];
  /** Long axis direction and how pronounced it is. */
  rotation: number;
  stretch: number;
  warpAmplitudeM: number;
  warpScaleM: number;
}

/**
 * Where the island mass ends and where its underwater platform does, as
 * contours of the summed lobe field. A lone lobe contributes 1.0 at its own
 * centre, so the land contour has to sit below that or a single-lobe island
 * would be a point.
 */
const ISLAND_LAND_ISOLINE = 0.62;
const ISLAND_SHELF_ISOLINE = 0.22;

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
 * Builds one island's lobes, proportions and orientation from a stream of
 * random numbers. Everything that could make two islands look alike is varied
 * here: how many swellings the mass has, how far off centre they sit, how
 * elongated the whole thing is, and which way it lies.
 */
function shapeIsland(
  x: number, z: number, radiusM: number, peakM: number, phase: number, size: number, rng: () => number,
): Island {
  const lobes: IslandLobe[] = [
    { dx: 0, dz: 0, radius: radiusM * (0.60 + rng() * 0.24) },
  ];
  // Two to five swellings. Fewer reads as a lump, more as a splatter.
  const lobeCount = 2 + Math.floor(rng() * 3.6);
  for (let index = 1; index < lobeCount; index++) {
    const angle = rng() * Math.PI * 2;
    const reach = radiusM * (0.34 + rng() * 0.66);
    lobes.push({
      dx: Math.cos(angle) * reach,
      dz: Math.sin(angle) * reach,
      radius: radiusM * (0.26 + rng() * 0.44),
    });
  }

  const rotation = rng() * Math.PI;
  // Elongation is earned by size. A big island can afford to be a long ridge;
  // the same stretch applied to a skerry a few cells across draws a hairline
  // that reads as a scratch on the map rather than as land.
  const spread = 0.15 + size * 0.42;
  const stretch = 1 - spread + rng() * spread * 2;
  // The warp bends the outline; the lobes are what make it irregular. So the
  // warp wants a wavelength LONGER than the island — at a shorter one it
  // chews the shore into a fringe, and on a skerry only a dozen cells across
  // that renders as a starburst. Amplitude eases off on the small ones too:
  // a rock does not have a coastline's worth of detail to show.
  const warpAmplitudeM = radiusM * (0.14 + rng() * 0.20) * (0.55 + size * 0.45);
  const warpScaleM = Math.max(900, radiusM * (1.1 + rng() * 1.3));

  // Cull radius. A lobe's field reaches the shelf contour at
  // radius * sqrt(ln(1 / ISLAND_SHELF_ISOLINE)); the anisotropic frame can
  // stretch that either way, and the warp can push a sample further still.
  const shelfSpan = Math.sqrt(Math.log(1 / ISLAND_SHELF_ISOLINE));
  const anisotropy = Math.max(stretch, 1 / stretch);
  let localReach = 0;
  for (const lobe of lobes) {
    localReach = Math.max(localReach, Math.hypot(lobe.dx, lobe.dz) + lobe.radius * shelfSpan);
  }
  const reachM = localReach * anisotropy + warpAmplitudeM;

  return { x, z, radiusM, reachM, peakM, phase, lobes, rotation, stretch, warpAmplitudeM, warpScaleM };
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
  const maxRadiusM = Math.min(config.maxRadiusM, bandWidth * 0.15);
  const minRadiusM = Math.min(config.minRadiusM, maxRadiusM * 0.22);

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

      // One RNG stream per lattice cell, so an island's shape is stable
      // against the seed and independent of how many were placed before it.
      const rng = mulberry32(noise.seed + row * 8_191 + column * 131 + 17);

      // Skewed hard, and taken from the RNG rather than from a smooth noise
      // field: sampling fbm for size gave neighbouring islands near-identical
      // sizes, because that is exactly what a smooth field is for.
      const size = Math.pow(rng(), 2.3);
      const radiusM = minRadiusM + size * (maxRadiusM - minRadiusM);
      // Small islands are low and rounded; the larger ones earn a real summit.
      const peakM = 40 + Math.pow(size, 1.25) * 460;
      const candidate = shapeIsland(worldX, worldZ, radiusM, peakM, (row * 7.3 + column * 3.1) % 41, size, rng);

      // Keep them from fusing into one mass, but allow real clusters: an
      // archipelago has islands lying close enough to shelter a channel
      // between them, which a wide exclusion radius forbids outright.
      const tooClose = islands.some((existing) =>
        Math.hypot(existing.x - candidate.x, existing.z - candidate.z)
        < (existing.radiusM + candidate.radiusM) * 0.95);
      if (tooClose) continue;
      islands.push(candidate);
    }
  }
  return islands;
}

/**
 * The summed lobe field at a world point, in the island's own frame.
 *
 * The sample is warped in world space first (which bends the whole outline),
 * then rotated and stretched into the island's local axes, then measured
 * against each lobe. Warping the sample rather than modulating a radius
 * against the polar angle matters: an angular radius function turns noise
 * octaves into radial spikes and renders as a starburst.
 */
function islandFieldAt(worldX: number, worldZ: number, island: Island, noise: IslandNoise): number {
  const scale = island.warpScaleM;
  const warpX = fbm(noise.shape, worldX / scale + island.phase, worldZ / scale, 2) * island.warpAmplitudeM;
  const warpZ = fbm(noise.shape, worldX / scale + 31.7, worldZ / scale + island.phase, 2) * island.warpAmplitudeM;

  const px = worldX + warpX - island.x;
  const pz = worldZ + warpZ - island.z;
  const cos = Math.cos(island.rotation), sin = Math.sin(island.rotation);
  const localX = (px * cos - pz * sin) / island.stretch;
  const localZ = (px * sin + pz * cos) * island.stretch;

  let field = 0;
  for (const lobe of island.lobes) {
    const dx = localX - lobe.dx, dz = localZ - lobe.dz;
    const normalized = Math.hypot(dx, dz) / Math.max(1e-6, lobe.radius);
    field += Math.exp(-normalized * normalized);
  }
  return field;
}

/**
 * Island elevation at a world point, or `-Infinity` where the arc has no
 * opinion. Returns a positive height inside an island, and a raised (but
 * still submerged) shelf value around it — an island rising sheer from the
 * abyss reads as a spike, where a real one sits on its own platform. The
 * shelf is a contour of the same field as the shore, so it is a lobed apron
 * following the island's true outline rather than a ring drawn around a disc.
 */
export function islandElevationAt(worldX: number, worldZ: number, islands: Island[], noise: IslandNoise): number {
  let best = -Infinity;
  for (const island of islands) {
    if (Math.abs(worldX - island.x) > island.reachM || Math.abs(worldZ - island.z) > island.reachM) continue;
    const field = islandFieldAt(worldX, worldZ, island, noise);
    if (field < ISLAND_SHELF_ISOLINE) continue;

    if (field >= ISLAND_LAND_ISOLINE) {
      const inland = Math.min(1, (field - ISLAND_LAND_ISOLINE) / 0.55);
      // Relief scaled to the island: a fixed noise wavelength gives a small
      // skerry the same detail as a large island, which reads as spikes.
      const reliefScale = Math.max(700, island.radiusM * 1.15);
      const relief = fbm(noise.relief, worldX / reliefScale, worldZ / reliefScale, 2) * 0.18;
      const height = Math.pow(inland, 0.72) * island.peakM * (1 + relief);
      best = Math.max(best, Math.max(2, height));
    } else {
      const out = 1 - (field - ISLAND_SHELF_ISOLINE) / (ISLAND_LAND_ISOLINE - ISLAND_SHELF_ISOLINE);
      const eased = out * out * (3 - 2 * out);
      best = Math.max(best, -14 - eased * 620);
    }
  }
  return best;
}
