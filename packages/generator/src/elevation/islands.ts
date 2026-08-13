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
import { RIFT_COAST_BASE } from "./silhouettes.js";
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
  // Fewer, better-placed islands: ~3 lone anchors, 2 companions per coast
  // plus the occasional trailing skerry, one sandbar. ArcheAge's sea carries
  // roughly this many between Nuia and Haranya, and it reads as authored
  // geography precisely because it is not two dozen.
  count: 10,
  minRadiusM: 700,
  maxRadiusM: 3_400,
  // No exclusion: the anomaly is a place to sail into and build on, and
  // islands standing in it are the most interesting ground in the sea.
  brumaKeepOutM: 0,
  // Minimum water between a coast and its companion islets — a short boat
  // trip, close enough that the islet is visible from the beach.
  coastKeepOutM: 3_200,
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
 * Lays the sea out the way ArcheAge lays out the water between Nuia and
 * Haranya. Measured off its world map, that sea has a grammar, not a
 * scatter:
 *
 *  - The open ocean is almost empty. A handful of true mid-sea islands
 *    (Freedich, Growlgate, Mirage) each stand ALONE, a third to half the
 *    sea's width from the nearer coast, and each is a destination — roughly
 *    5–15% of a continent's width across, far from zone-sized.
 *  - Nearly everything else hugs a coastline: skerries 2–4% of a continent's
 *    width, sitting 2–7% offshore in loose trails of one to three — visible
 *    from the beach, reachable only by boat.
 *
 * The previous jittered lattice did the opposite: it filled the middle of
 * the sea uniformly and left the coasts bare, which read as one random
 * cluster in a small radius mid-ocean. Placement is now by role — lone
 * anchors, coastal companions, one sandbar — each sized and separated to
 * the proportions above.
 *
 * `riftOffsetAt` is the same wandering curve that shapes the two facing
 * coastlines, so both the seam line and the coast estimates below stay
 * honest when the tear wanders.
 */
export function planIslands(
  layout: ContinentLayoutDesign,
  noise: IslandNoise,
  riftOffsetAt: (v: number) => number,
  config: IslandFieldConfig = DEFAULT_ISLAND_CONFIG,
  isLandAt?: (worldX: number, worldZ: number) => boolean,
): Island[] {
  const tile = layout.continentTileSize;
  const valora = layout.continents.find((continent) => continent.id === "valora")!;
  const seradia = layout.continents.find((continent) => continent.id === "seradia")!;
  const zMin = layout.continents[0].worldOffset[1];
  if (seradia.worldOffset[0] <= valora.worldOffset[0] + tile * RIFT_COAST_BASE.valora) return [];

  // Where each rift-facing coast roughly falls at a given latitude, from the
  // seam clip alone. Only a fallback: the mass often stops well SHORT of the
  // seam — the clip only bites where land actually reached it — so the true
  // shoreline can sit over ten kilometres inboard of this line. Placing
  // "coastal" islets against the estimate strands them mid-sea, which is
  // exactly the randomly-scattered look this planner exists to kill.
  const coastEstimate = (side: "valora" | "seradia", v: number): number =>
    side === "valora"
      ? valora.worldOffset[0] + (RIFT_COAST_BASE.valora + riftOffsetAt(v)) * tile
      : seradia.worldOffset[0] + (RIFT_COAST_BASE.seradia + riftOffsetAt(v)) * tile;

  // The real coast, found by marching from the tile edge into the land until
  // the probe reports shore. Null when a latitude has no land in range (open
  // bays, the continents' tapered ends) — roles simply retry elsewhere.
  const COAST_SCAN_M = 32_000;
  const COAST_STEP_M = 400;
  const coastXOf = (side: "valora" | "seradia", v: number): number | null => {
    if (!isLandAt) return coastEstimate(side, v);
    const z = zMin + v * tile;
    const from = side === "valora" ? valora.worldOffset[0] + tile : seradia.worldOffset[0];
    const inland = side === "valora" ? -1 : 1;
    for (let step = 0; step * COAST_STEP_M <= COAST_SCAN_M; step++) {
      const x = from + inland * step * COAST_STEP_M;
      if (isLandAt(x, z)) return x - inland * COAST_STEP_M * 0.5;
    }
    return null;
  };

  const rng = mulberry32(noise.seed + 4_001);
  const islands: Island[] = [];

  const blockedByBruma = (x: number, z: number): boolean => {
    if (config.brumaKeepOutM <= 0) return false;
    return Math.hypot(x - layout.bruma.center[0], z - layout.bruma.center[1])
      < config.brumaKeepOutM + layout.bruma.radiusUnits;
  };

  const place = (
    x: number, z: number, radiusM: number, peakM: number, size: number, minSeparationM: number,
  ): boolean => {
    if (islands.length >= config.count) return false;
    if (z < zMin + tile * 0.04 || z > zMin + tile * 0.96) return false;
    if (blockedByBruma(x, z)) return false;
    // Stay in open water. With a probe this is exact — the island's whole
    // footprint must miss the land; without one, fall back to the seam
    // estimate with the keep-out as slack.
    if (isLandAt) {
      for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        if (isLandAt(x + dx * radiusM * 1.3, z + dz * radiusM * 1.3)) return false;
      }
    } else {
      const v = (z - zMin) / tile;
      if (x < coastEstimate("valora", v) + config.coastKeepOutM * 0.7) return false;
      if (x > coastEstimate("seradia", v) - config.coastKeepOutM * 0.7) return false;
    }
    const tooClose = islands.some((existing) =>
      Math.hypot(existing.x - x, existing.z - z)
      < Math.max(minSeparationM, (existing.radiusM + radiusM) * 1.1));
    if (tooClose) return false;
    islands.push(shapeIsland(x, z, radiusM, peakM, (islands.length * 7.3 + 3.1) % 41, size, rng));
    return true;
  };

  // --- Lone anchors: the Freedich islands of the Luna Sea. Each stands in
  // open water, sized to be lived on, and far enough from the next that the
  // map reads as placed islands rather than a cluster. Stratified latitudes
  // keep them spread down the whole sea instead of bunching at one end.
  const anchorCount = Math.max(2, Math.min(4, Math.round(config.count * 0.3)));
  // A sea-crossing apart. ArcheAge's lone islands sit half a map from each
  // other; at anything much tighter the anchors read as one loose cluster in
  // the middle of the ocean, which is the look this planner replaces.
  const anchorSeparationM = Math.max(16_000, tile * 0.24);
  for (let index = 0; index < anchorCount; index++) {
    // Banded latitude first so the anchors spread down the whole sea; if a
    // band offers no water (a continent's tapered end returns no coast
    // there), fall back to any latitude rather than dropping the anchor.
    for (let attempt = 0; attempt < 26; attempt++) {
      const band = (index + 0.5) / anchorCount;
      const v = attempt < 14
        ? Math.min(0.94, Math.max(0.06, band + (rng() - 0.5) * (1.1 / anchorCount)))
        : 0.08 + rng() * 0.84;
      // Where only one continent still has land at this latitude (past a
      // tapered end), the sea is open in that direction — bound it at a
      // crossing's width from the coast that exists instead of skipping the
      // whole latitude, or the southern reaches would never hold an anchor.
      let west = coastXOf("valora", v);
      let east = coastXOf("seradia", v);
      if (west === null && east !== null) west = east - 40_000;
      if (east === null && west !== null) east = west + 40_000;
      if (west === null || east === null || east - west < 16_000) continue;
      const across = 0.24 + rng() * 0.52; // roam most of the sea's width
      const x = west + (east - west) * across;
      const size = index === 0 ? 0.85 + rng() * 0.15 : 0.5 + rng() * 0.3;
      const radiusM = config.minRadiusM + size * (config.maxRadiusM - config.minRadiusM);
      const peakM = 160 + Math.pow(size, 1.25) * 340;
      if (place(x, zMin + v * tile, radiusM, peakM, size, anchorSeparationM)) break;
    }
  }

  // --- Coastal companions: small islands a short sail off each rift coast,
  // near enough to see from the beach. Roughly half bring a smaller partner,
  // the loose pairs and trails every real coast collects.
  const perSide = Math.max(1, Math.min(3, Math.round(config.count * 0.2)));
  for (const side of ["valora", "seradia"] as const) {
    const seaward = side === "valora" ? 1 : -1;
    for (let index = 0; index < perSide; index++) {
      for (let attempt = 0; attempt < 12; attempt++) {
        const v = 0.10 + rng() * 0.80;
        const coast = coastXOf(side, v);
        if (coast === null) continue;
        const offshoreM = config.coastKeepOutM + rng() * 3_200;
        const x = coast + seaward * offshoreM;
        const size = 0.10 + rng() * 0.20;
        const radiusM = 520 + size * 2_600;
        const peakM = 25 + size * 220;
        if (!place(x, zMin + v * tile, radiusM, peakM, size, 7_000)) continue;
        const lead = islands[islands.length - 1];
        if (rng() < 0.55) {
          const angle = rng() * Math.PI * 2;
          const spacing = (lead.radiusM * (1.6 + rng() * 1.2)) + 600;
          place(
            lead.x + Math.cos(angle) * spacing, lead.z + Math.sin(angle) * spacing,
            lead.radiusM * (0.38 + rng() * 0.25), 18 + rng() * 40, 0.08, 0,
          );
        }
        break;
      }
    }
  }

  // --- One sandbar: a low mid-sea sliver that barely clears the swell.
  // Flavor, not a destination — proof the sea has a floor.
  if (config.count >= 8) {
    for (let attempt = 0; attempt < 10; attempt++) {
      const v = 0.15 + rng() * 0.70;
      const west = coastXOf("valora", v);
      const east = coastXOf("seradia", v);
      if (west === null || east === null || east - west < 12_000) continue;
      const x = west + (east - west) * (0.30 + rng() * 0.40);
      if (place(x, zMin + v * tile, 380 + rng() * 260, 4, 0.05, 6_500)) break;
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
