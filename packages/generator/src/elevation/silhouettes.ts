// Continent silhouette treatments (docs/21, Phase 0).
//
// The continent outline is authored, not emergent: a composed field where
// land is anything above a threshold. This module holds the alternative
// treatments so the world's shape is a deliberate art-direction choice
// rather than a single hard-coded pair of ellipses.
//
// `ridge-cape` is the approved treatment; `legacy` reproduces the
// pre-redesign silhouette exactly and is kept for regression checks.

import type { ContinentId, Vec2, ZoneDesign } from "../types/index.js";

export type SilhouetteTreatment = "legacy" | "ridge-cape" | "broken-shield" | "archipelagic";

export const SILHOUETTE_TREATMENTS: SilhouetteTreatment[] = [
  "legacy", "ridge-cape", "broken-shield", "archipelagic",
];

/**
 * The approved world shape. `legacy` remains available for regenerating
 * pre-redesign output and for the byte-identity regression check.
 */
export const DEFAULT_SILHOUETTE: SilhouetteTreatment = "ridge-cape";

type Noise2D = (x: number, y: number) => number;

/** Noise channels a silhouette may draw on. All are continent-seeded. */
export interface SilhouetteNoise {
  coast: Noise2D;
  warpX: Noise2D;
  warpY: Noise2D;
  cape: Noise2D;
  islet: Noise2D;
}

/**
 * Land threshold in the composed field. The sampler maps the field through
 * `clamp01((field + 0.15) * 1.3)` and treats > 0.5 as land, so this is the
 * field value where a coastline falls.
 */
export const LAND_FIELD_THRESHOLD = 0.5 / 1.3 - 0.15;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const smoothstep = (a: number, b: number, value: number): number => {
  const t = clamp01((value - a) / Math.max(1e-6, b - a));
  return t * t * (3 - 2 * t);
};

function fbm(noise: Noise2D, x: number, y: number, octaves: number, lacunarity = 2.0, persistence = 0.5): number {
  let amplitude = 1, frequency = 1, sum = 0, maxAmplitude = 0;
  for (let octave = 0; octave < octaves; octave++) {
    sum += noise(x * frequency, y * frequency) * amplitude;
    maxAmplitude += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }
  return sum / maxAmplitude;
}

/** Ridged fractal in [0,1]; `power` sharpens crests into spines. */
function ridged(noise: Noise2D, x: number, y: number, octaves: number, power: number): number {
  const raw = 1 - Math.abs(fbm(noise, x, y, octaves, 2.05, 0.52));
  return Math.pow(Math.max(0, raw), power);
}

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq > 0 ? clamp01(((px - ax) * dx + (py - ay) * dy) / lengthSq) : 0;
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

/** Positive inside a rounded capsule, easing to zero at `radius`. */
function capsule(px: number, py: number, a: Vec2, b: Vec2, radius: number): number {
  return Math.max(0, radius - distanceToSegment(px, py, a[0], a[1], b[0], b[1])) / Math.max(1e-6, radius);
}

const anchorOf = (zones: ZoneDesign[], zoneId: string, fallback: Vec2): Vec2 =>
  zones.find((zone) => zone.id === zoneId)?.anchor ?? fallback;

/**
 * Canon geography that survives every treatment: Cavora's Stormbreak gulf and
 * Alvora's Crownlands bay on Valora, Solmara's Sunreach bight on Seradia.
 * These support authored zone identities (deep natural harbor, coastal
 * fishing/transport, the delta's ocean receiver) and are not decoration.
 */
function canonicalCuts(u: number, v: number, continent: ContinentId, zones: ZoneDesign[], legacyPlacement: boolean): number {
  // The legacy cuts are centred almost exactly on the zone anchors they were
  // meant to serve, which is why the pre-redesign world drowned Cavora,
  // Solmara and Lumeira. The redesign moves each cut seaward of its zone, so
  // the bay shapes that zone's coast instead of submerging its centre.
  if (continent === "valora") {
    const cavora = anchorOf(zones, "cavora", [0.8, 0.25]);
    const alvora = anchorOf(zones, "alvora", [0.85, 0.5]);
    const stormbreakOffset: Vec2 = legacyPlacement ? [-0.02, 0.02] : [0.05, -0.15];
    const stormbreak = 0.38 - Math.hypot(
      (u - (cavora[0] + stormbreakOffset[0])) / 0.2, (v - (cavora[1] + stormbreakOffset[1])) / 0.22);
    const crownlands = 0.18 - Math.hypot((u - (alvora[0] + 0.11)) / 0.13, (v - (alvora[1] + 0.03)) / 0.18);
    return Math.max(0, stormbreak) * 0.70 + Math.max(0, crownlands) * 0.38;
  }
  const solmara = anchorOf(zones, "solmara", [0.2, 0.75]);
  const sunreachOffset: Vec2 = legacyPlacement ? [-0.05, 0.03] : [-0.11, 0.12];
  const sunreach = 0.20 - Math.hypot(
    (u - (solmara[0] + sunreachOffset[0])) / 0.13, (v - (solmara[1] + sunreachOffset[1])) / 0.17);
  return Math.max(0, sunreach) * 0.45;
}

/**
 * Authored gulfs — the navigability feature of the redesign. Each carries
 * sea-level water (and therefore ports and trade routes) into ground that
 * ships could not otherwise reach, and each is placed to clear every zone
 * anchor.
 *
 * Shape matters as much as position. A straight axis with a linear taper
 * reads as one stencil stamped at four sizes: a sharp cone, too narrow for
 * its penetration, identical everywhere. Real bays instead have a curving
 * axis, stay broad well inland, round off at the head rather than closing to
 * a point, wander at two different scales, and — where they are drowned river
 * valleys — throw off side arms. Every gulf below is authored as its own kind
 * of bay, and `phase` decorrelates their shoreline noise so no two wander
 * alike.
 */
interface GulfCut {
  /** Curving axis, sea end first; the head is the last point. */
  axis: Vec2[];
  /** Half-width at the mouth and at the head, before shaping and wander. */
  mouthWidth: number;
  headWidth: number;
  /** Shoreline irregularity, 0 = smooth arc. */
  roughness: number;
  /** Decorrelates this gulf's wander from its neighbours'. */
  phase: number;
  /** How completely this bay floods, 0..1. */
  flood: number;
  /** Drowned side valleys branching off the main axis. */
  branches?: { at: number; direction: number; length: number; width: number }[];
}

const AUTHORED_GULFS: Record<ContinentId, GulfCut[]> = {
  valora: [
    // Stormwatch Gulf — enters through the natural northern embayment and
    // drives south into the body of the continent, putting deep water within
    // reach of Azurewood and the Crownlands' hinterland. Broad-mouthed and
    // generous: the kind of water a fleet anchors in.
    {
      axis: [[0.478, 0.150], [0.470, 0.255], [0.458, 0.360], [0.472, 0.462]],
      mouthWidth: 0.115, headWidth: 0.066, roughness: 0.34, phase: 0, flood: 1,
      branches: [{ at: 0.62, direction: -1, length: 0.080, width: 0.034 }],
    },
    // The Elderwall Ria — a drowned river valley on the south-west coast:
    // narrower, sinuous, and branching into side arms, so its shoreline
    // reads as flooded country rather than an excavation.
    {
      axis: [[0.302, 0.850], [0.296, 0.772], [0.284, 0.702], [0.302, 0.640]],
      mouthWidth: 0.086, headWidth: 0.046, roughness: 0.46, phase: 11.3, flood: 1,
      branches: [
        { at: 0.40, direction: 1, length: 0.082, width: 0.035 },
        { at: 0.72, direction: -1, length: 0.058, width: 0.026 },
      ],
    },
  ],
  seradia: [
    // The Hollow Bight — a wide scallop of a bay biting west between the
    // Luminous Hollow and the Shattered Reach; the only realistic sea access
    // for Seradia's eastern zones.
    {
      axis: [[0.960, 0.540], [0.902, 0.556], [0.846, 0.572], [0.792, 0.586]],
      mouthWidth: 0.112, headWidth: 0.078, roughness: 0.26, phase: 23.7, flood: 1,
    },
    // The Glassmere Inlet — a long, kinked reach running south off the north
    // coast toward the Glassmere lowland margin; sheltered small-craft water.
    {
      axis: [[0.442, 0.196], [0.436, 0.278], [0.452, 0.352], [0.434, 0.424]],
      mouthWidth: 0.080, headWidth: 0.044, roughness: 0.42, phase: 41.1, flood: 0.95,
      branches: [{ at: 0.55, direction: 1, length: 0.060, width: 0.027 }],
    },
  ],
};

/**
 * Full flood across the channel, feathering to land over the outer third.
 * Written out rather than via `smoothstep`, whose zero-denominator guard
 * (`Math.max(1e-6, b - a)`) silently collapses a descending range to zero.
 */
function shoreProfile(normalizedDistance: number): number {
  const t = clamp01((1 - clamp01(normalizedDistance)) / 0.34);
  return t * t * (3 - 2 * t);
}

/** Closest approach to a polyline, with normalized position along it. */
function polylineProjection(px: number, py: number, axis: Vec2[], lengths: number[], total: number): { distance: number; t: number } {
  let distance = Infinity, t = 0, travelled = 0;
  for (let i = 0; i < axis.length - 1; i++) {
    const a = axis[i], b = axis[i + 1];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const lengthSq = Math.max(1e-12, dx * dx + dy * dy);
    const local = clamp01(((px - a[0]) * dx + (py - a[1]) * dy) / lengthSq);
    const candidate = Math.hypot(px - (a[0] + dx * local), py - (a[1] + dy * local));
    if (candidate < distance) {
      distance = candidate;
      t = (travelled + local * lengths[i]) / total;
    }
    travelled += lengths[i];
  }
  return { distance, t };
}

/** Axis arc lengths, computed once — the gulf table is constant. */
const GULF_GEOMETRY = new Map<GulfCut, { lengths: number[]; total: number }>();
function geometryOf(gulf: GulfCut): { lengths: number[]; total: number } {
  let cached = GULF_GEOMETRY.get(gulf);
  if (!cached) {
    const lengths: number[] = [];
    let total = 0;
    for (let i = 0; i < gulf.axis.length - 1; i++) {
      const length = Math.hypot(gulf.axis[i + 1][0] - gulf.axis[i][0], gulf.axis[i + 1][1] - gulf.axis[i][1]);
      lengths.push(length);
      total += length;
    }
    cached = { lengths, total: Math.max(1e-9, total) };
    GULF_GEOMETRY.set(gulf, cached);
  }
  return cached;
}

/** Field value a fully flooded gulf reaches: solidly open water. */
const GULF_WATER_FLOOR = LAND_FIELD_THRESHOLD - 0.16;

/**
 * Floods the authored bays into a composed field. Subtracting a fixed amount
 * could not open a bay through the interior, where accumulated zone presence
 * far exceeds any constant; blending toward open water by the bay's own
 * profile floods it regardless of what it cuts through, and still feathers
 * naturally along its shores.
 */
function applyGulfs(field: number, u: number, v: number, continent: ContinentId, noise: SilhouetteNoise): number {
  const flood = authoredGulfs(u, v, continent, noise);
  return flood > 0 ? field + (Math.min(field, GULF_WATER_FLOOR) - field) * flood : field;
}

function authoredGulfs(u: number, v: number, continent: ContinentId, noise: SilhouetteNoise): number {
  let cut = 0;
  for (const gulf of AUTHORED_GULFS[continent]) {
    const { lengths, total } = geometryOf(gulf);
    const { distance, t } = polylineProjection(u, v, gulf.axis, lengths, total);

    // Stay broad along the reach, then round off at the head. A linear taper
    // would close the bay to a sharp cone; `(1 - t^3)^0.42` holds most of the
    // width until the last stretch and finishes as a rounded bowl.
    const along = Math.pow(Math.max(0, 1 - t * t * t), 0.42);
    const base = gulf.mouthWidth + (gulf.headWidth - gulf.mouthWidth) * t;
    // Two scales of wander: broad lobes and headlands, plus finer shoreline
    // detail. The per-gulf phase keeps each bay's shoreline its own.
    const broadWander = fbm(noise.cape, u * 3.4 + gulf.phase, v * 3.4 + gulf.phase, 2);
    const fineWander = fbm(noise.cape, u * 11 + gulf.phase, v * 11 + gulf.phase, 2);
    const wander = 1 + broadWander * gulf.roughness + fineWander * gulf.roughness * 0.45;
    const radius = base * along * Math.max(0.22, wander);
    if (radius > 0 && distance < radius) {
      // Flat-topped profile: open water across the bay's authored width,
      // feathering only near its shores. A profile that peaks solely at the
      // centreline floods a fraction of the width and reads as a slit.
      cut = Math.max(cut, shoreProfile(distance / radius) * gulf.flood);
    }

    // Drowned side valleys: short arms off the main axis, themselves
    // tapering and wandering, which turn a smooth bay into flooded country.
    for (const branch of gulf.branches ?? []) {
      const rootIndex = Math.min(gulf.axis.length - 2, Math.floor(branch.at * (gulf.axis.length - 1)));
      const root = gulf.axis[rootIndex], next = gulf.axis[rootIndex + 1];
      const tangentX = next[0] - root[0], tangentY = next[1] - root[1];
      const tangentLength = Math.max(1e-9, Math.hypot(tangentX, tangentY));
      const normalX = -tangentY / tangentLength * branch.direction;
      const normalY = tangentX / tangentLength * branch.direction;
      const start: Vec2 = [
        root[0] + tangentX * (branch.at * (gulf.axis.length - 1) - rootIndex),
        root[1] + tangentY * (branch.at * (gulf.axis.length - 1) - rootIndex),
      ];
      // Bend the arm as it runs inland so it does not read as a spur.
      const bend = 0.35;
      const mid: Vec2 = [
        start[0] + normalX * branch.length * 0.55 + tangentX / tangentLength * branch.length * bend * 0.5,
        start[1] + normalY * branch.length * 0.55 + tangentY / tangentLength * branch.length * bend * 0.5,
      ];
      const tip: Vec2 = [
        start[0] + normalX * branch.length + tangentX / tangentLength * branch.length * bend,
        start[1] + normalY * branch.length + tangentY / tangentLength * branch.length * bend,
      ];
      const armAxis = [start, mid, tip];
      const armLengths = [
        Math.hypot(mid[0] - start[0], mid[1] - start[1]),
        Math.hypot(tip[0] - mid[0], tip[1] - mid[1]),
      ];
      const armTotal = Math.max(1e-9, armLengths[0] + armLengths[1]);
      const arm = polylineProjection(u, v, armAxis, armLengths, armTotal);
      const armWander = 1 + fbm(noise.cape, u * 9 + gulf.phase * 1.7, v * 9 + gulf.phase * 1.7, 2) * 0.4;
      const armRadius = branch.width * Math.pow(Math.max(0, 1 - arm.t * arm.t * arm.t), 0.45) * Math.max(0.25, armWander);
      if (armRadius > 0 && arm.distance < armRadius) {
        cut = Math.max(cut, shoreProfile(arm.distance / armRadius) * gulf.flood * 0.92);
      }
    }
  }
  return cut;
}

/** Bold headlands that keep a gulf-cut continent from reading as a bitten disc. */
const AUTHORED_CAPES: Record<ContinentId, { a: Vec2; b: Vec2; radius: number; gain: number }[]> = {
  valora: [
    { a: [0.30, 0.78], b: [0.14, 0.90], radius: 0.085, gain: 0.42 },
    { a: [0.74, 0.20], b: [0.90, 0.10], radius: 0.070, gain: 0.34 },
  ],
  seradia: [
    { a: [0.36, 0.86], b: [0.28, 0.99], radius: 0.075, gain: 0.38 },
    { a: [0.82, 0.30], b: [0.95, 0.22], radius: 0.070, gain: 0.34 },
  ],
};

function authoredCapes(u: number, v: number, continent: ContinentId): number {
  let gain = 0;
  for (const cape of AUTHORED_CAPES[continent]) {
    const inside = capsule(u, v, cape.a, cape.b, cape.radius);
    if (inside > 0) gain = Math.max(gain, smoothstep(0, 1, inside) * cape.gain);
  }
  return gain;
}

/** Accumulated zone presence at the coastline, and the slope away from it. */
const MASS_ISOLINE = 0.86;
const MASS_GAIN = 0.62;
const OFFSHORE_SLOPE = 0.30;

/** Polynomial smooth maximum — merges two fields without a visible crease. */
function smoothMax(a: number, b: number, k: number): number {
  const h = Math.max(0, k - Math.abs(a - b)) / k;
  return Math.max(a, b) + h * h * k * 0.25;
}

/**
 * The landmass as the union of the ground its zones stand on.
 *
 * A continent exists because its regions do, so the outline is built from
 * the authored zone layout rather than drawn around it: each zone contributes
 * a soft cone at its anchor, smooth-merged into one organic mass. This makes
 * "every zone anchor is on land" true by construction (the previous ellipse
 * silhouette stranded Cavora, Solmara and Lumeira in open water on the
 * canonical seed) and gives a lumpier, less discoid base than any ellipse.
 */
function zoneMassField(u: number, v: number, zones: ZoneDesign[], reach: number, grain: ContinentGrain): number {
  // Additive (metaball) accumulation rather than a union of cones: adjacent
  // zones reinforce each other and fuse into one continuous mass, where a
  // max-of-cones left visible disc lobes and open water between neighbours.
  //
  // Each zone's contribution is measured in a rotated, anisotropic metric so
  // the two continents keep the distinct macro-grammar the bible calls for —
  // Valora a broad mainland on a diagonal, Seradia a taller crescent. Built
  // from an isotropic metric they converge on the same silhouette, because
  // both zone layouts have a similar spread.
  let presence = 0;
  const cos = Math.cos(grain.angle), sin = Math.sin(grain.angle);
  for (const zone of zones) {
    const dx = u - zone.anchor[0], dy = v - zone.anchor[1];
    const alongX = (dx * cos - dy * sin) / grain.stretchAlong;
    const alongY = (dx * sin + dy * cos) / grain.stretchAcross;
    const normalized = Math.hypot(alongX, alongY) / Math.max(1e-6, zone.radius * reach);
    presence += Math.exp(-normalized * normalized);
  }
  // The coastline is the `MASS_ISOLINE` contour of that field. Because a
  // zone contributes exactly 1.0 at its own anchor and the isoline sits
  // below 1.0, every anchor is land by construction.
  if (presence >= MASS_ISOLINE) return LAND_FIELD_THRESHOLD + (presence - MASS_ISOLINE) * MASS_GAIN;
  // Offshore, gaussian presence decays toward zero and would floor the field
  // in the shelf band, leaving the Luna Sea uniformly shallow. Invert the
  // gaussian instead to recover a distance-like measure that keeps falling,
  // so shallows -> shelf -> slope -> abyss all still have room to form.
  const beyondCoast = Math.sqrt(Math.log(MASS_ISOLINE / Math.max(presence, 1e-7)));
  return LAND_FIELD_THRESHOLD - beyondCoast * OFFSHORE_SLOPE;
}

/**
 * Base mass for the redesigned treatments: the zone union carrying the shape,
 * smooth-merged with a broad, heavily subdued ellipse that supplies only the
 * far-field falloff the ocean-depth curve needs offshore.
 */
/** Per-continent macro grammar: the axis and proportions of its landmass. */
interface ContinentGrain { angle: number; stretchAlong: number; stretchAcross: number }

const CONTINENT_GRAIN: Record<ContinentId, ContinentGrain> = {
  // A broad mainland lying on a north-east diagonal.
  valora: { angle: -0.28, stretchAlong: 1.16, stretchAcross: 0.88 },
  // A taller, narrower crescent — deliberately not Valora's proportions.
  seradia: { angle: 0.16, stretchAlong: 0.86, stretchAcross: 1.20 },
};

function redesignBody(u: number, v: number, continent: ContinentId, zones: ZoneDesign[], reach: number): number {
  return zoneMassField(u, v, zones, reach, CONTINENT_GRAIN[continent]);
}

/** The pre-redesign body shapes, kept for the legacy treatment. */
function legacyBody(u: number, v: number, continent: ContinentId, scale: number): number {
  const dx = u - 0.5, dy = v - 0.5;
  if (continent === "valora") {
    const angle = -0.28;
    const rx = dx * Math.cos(angle) - dy * Math.sin(angle);
    const ry = dx * Math.sin(angle) + dy * Math.cos(angle);
    const body = 1 - Math.hypot(rx / (0.58 * scale), ry / (0.45 * scale));
    const peninsula = 0.35 - Math.hypot((u - 0.2) / 0.24, (v - 0.73) / 0.3);
    return Math.max(body, peninsula);
  }
  const outer = 1 - Math.hypot(dx / (0.43 * scale), dy / (0.59 * scale));
  const innerBay = 0.42 - Math.hypot((u - 0.34) / 0.29, (v - 0.5) / 0.43);
  const northernShoulder = 0.28 - Math.hypot((u - 0.67) / 0.24, (v - 0.2) / 0.24);
  return Math.max(outer - Math.max(0, innerBay) * 0.9, northernShoulder);
}

/**
 * Low-frequency domain warp applied to the body coordinates. This is the
 * single most effective trick against "procedural blob": it bends the
 * underlying ellipse into an irregular landmass before any coast detail.
 */
function warped(u: number, v: number, noise: SilhouetteNoise, amount: number, frequency: number): Vec2 {
  return [
    u + amount * noise.warpX(u * frequency, v * frequency),
    v + amount * noise.warpY(u * frequency, v * frequency),
  ];
}

/** Weight that peaks at the coastline and fades inland and offshore. */
function coastalBand(field: number, reach: number): number {
  return 1 - smoothstep(0, reach, Math.abs(field - LAND_FIELD_THRESHOLD));
}

/**
 * One evaluation point. The sampler warps its coordinates before shaping
 * terrain, so a silhouette sees both: `u,v` are true continent-local space
 * (authored gulfs, capes and zone anchors must live here, or they would
 * drift kilometres from the geography they were placed against), while
 * `wu,wv` carry the sampler's warp and drive the organic body outline.
 */
export interface SilhouetteSample {
  u: number;
  v: number;
  wu: number;
  wv: number;
  coastN: number;
}

/**
 * Evaluates a treatment's composed silhouette field at one sample.
 * Land is `field > LAND_FIELD_THRESHOLD`.
 */
export function silhouetteFieldAt(
  sample: SilhouetteSample,
  continent: ContinentId,
  zones: ZoneDesign[],
  noise: SilhouetteNoise,
  treatment: SilhouetteTreatment,
): number {
  const { u, v, wu, wv, coastN } = sample;

  if (treatment === "legacy") {
    const body = legacyBody(wu, wv, continent, 1);
    const macro = body - canonicalCuts(wu, wv, continent, zones, true);
    return macro + coastN * (continent === "valora" ? 0.10 : 0.12);
  }

  let field: number;
  if (treatment === "ridge-cape") {
    // Mountain grain reaches the sea: spines become capes, the valleys
    // between them become inlets, so the coast is a consequence of the
    // land's structure rather than an outline drawn around it.
    const [bu, bv] = warped(wu, wv, noise, 0.085, 1.35);
    const body = redesignBody(bu, bv, continent, zones, 1.21) - canonicalCuts(u, v, continent, zones, false);
    const grain = ridged(noise.cape, u * 2.7, v * 2.7, 4, 1.25) * 2 - 1;
    const fine = fbm(noise.cape, u * 5.5, v * 5.5, 3) * 0.28;
    field = applyGulfs(body
      + (grain + fine) * 0.40 * coastalBand(body, 0.46)
      + coastN * 0.07
      + authoredCapes(u, v, continent) * 0.6, u, v, continent, noise);
  } else if (treatment === "broken-shield") {
    // One deliberate mass, deeply bitten: bold headlands and long gulfs that
    // read as intentional geography from the map view.
    const [bu, bv] = warped(wu, wv, noise, 0.065, 1.15);
    const body = redesignBody(bu, bv, continent, zones, 1.28) - canonicalCuts(u, v, continent, zones, false);
    field = applyGulfs(body
      + authoredCapes(u, v, continent)
      + fbm(noise.cape, u * 4.2, v * 4.2, 3) * 0.10 * coastalBand(body, 0.30)
      + coastN * 0.065, u, v, continent, noise);
  } else {
    // Compact core inside a busy fringe of headlands, skerries and islets —
    // the small-craft coastline.
    const [bu, bv] = warped(wu, wv, noise, 0.075, 1.5);
    const body = redesignBody(bu, bv, continent, zones, 1.26) - canonicalCuts(u, v, continent, zones, false);
    const rim = coastalBand(body, 0.30);
    const shatter = fbm(noise.cape, u * 4.3, v * 4.3, 3) * 0.24 + fbm(noise.cape, u * 9, v * 9, 2) * 0.08;
    // Skerries: sharp isolated crests just offshore, never a solid ring.
    const offshore = smoothstep(0.01, 0.07, LAND_FIELD_THRESHOLD - body)
      * (1 - smoothstep(0.07, 0.22, LAND_FIELD_THRESHOLD - body));
    const skerries = Math.max(0, ridged(noise.islet, u * 5.2, v * 5.2, 2, 5) - 0.46) * 2.4;
    field = applyGulfs(body
      + shatter * rim
      + skerries * offshore * 0.62
      + authoredCapes(u, v, continent) * 0.7
      + coastN * 0.11, u, v, continent, noise);
  }

  return field;
}
