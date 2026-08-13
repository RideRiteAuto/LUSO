// Continent silhouette treatments (docs/21, Phase 0).
//
// The continent outline is authored, not emergent: a composed field where
// land is anything above a threshold. This module holds the alternative
// treatments so the world's shape is a deliberate art-direction choice
// rather than a single hard-coded pair of ellipses.
//
// `legacy` reproduces the pre-redesign silhouette exactly and stays the
// default until a treatment is approved.

import type { ContinentId, Vec2, ZoneDesign } from "../types/index.js";

export type SilhouetteTreatment = "legacy" | "ridge-cape" | "broken-shield" | "archipelagic";

export const SILHOUETTE_TREATMENTS: SilhouetteTreatment[] = [
  "legacy", "ridge-cape", "broken-shield", "archipelagic",
];

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
 * Authored deep gulfs — the navigability feature of the redesign. Each is a
 * capsule cut from open water toward the interior, carrying sea-level water
 * (and therefore ports and trade routes) into ground that ships previously
 * could not reach. Positions are chosen to clear every zone anchor.
 */
interface GulfCut { a: Vec2; b: Vec2; radius: number; depth: number }

const AUTHORED_GULFS: Record<ContinentId, GulfCut[]> = {
  valora: [
    // Northern gulf between the Stormbreak coast and the Tempest Crown
    // highlands, opening Azurewood Reach's northern shore to shipping.
    { a: [0.56, -0.06], b: [0.47, 0.32], radius: 0.105, depth: 1.15 },
    // Southern bight below Greenvale, giving the southern interior a coast.
    { a: [0.71, 1.05], b: [0.665, 0.77], radius: 0.090, depth: 1.05 },
  ],
  seradia: [
    // Eastern bight between the Luminous Hollow and the Shattered Reach —
    // the only realistic sea access for Seradia's eastern zones.
    { a: [1.07, 0.60], b: [0.855, 0.565], radius: 0.088, depth: 1.05 },
    // Northern inlet toward the Glassmere Expanse's lowland margin.
    { a: [0.42, -0.06], b: [0.395, 0.215], radius: 0.080, depth: 0.95 },
  ],
};

function authoredGulfs(u: number, v: number, continent: ContinentId, noise: SilhouetteNoise): number {
  let cut = 0;
  for (const gulf of AUTHORED_GULFS[continent]) {
    const dx = gulf.b[0] - gulf.a[0], dy = gulf.b[1] - gulf.a[1];
    const lengthSq = Math.max(1e-9, dx * dx + dy * dy);
    const t = clamp01(((u - gulf.a[0]) * dx + (v - gulf.a[1]) * dy) / lengthSq);
    const distance = Math.hypot(u - (gulf.a[0] + dx * t), v - (gulf.a[1] + dy * t));
    // A real gulf is broad at its mouth and narrows to its head, and its
    // shores wander. A constant-radius capsule reads as a stamped pill.
    const wobble = 1 + noise.cape(u * 7.5, v * 7.5) * 0.38;
    const radius = gulf.radius * (1 - 0.60 * t * t) * Math.max(0.25, wobble);
    if (distance >= radius) continue;
    cut = Math.max(cut, smoothstep(0, 1, 1 - distance / radius) * gulf.depth);
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
function zoneMassField(u: number, v: number, zones: ZoneDesign[], reach: number): number {
  // Additive (metaball) accumulation rather than a union of cones: adjacent
  // zones reinforce each other and fuse into one continuous mass, where a
  // max-of-cones left visible disc lobes and open water between neighbours.
  let presence = 0;
  for (const zone of zones) {
    const normalized = Math.hypot(u - zone.anchor[0], v - zone.anchor[1]) / Math.max(1e-6, zone.radius * reach);
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
function redesignBody(u: number, v: number, continent: ContinentId, zones: ZoneDesign[], reach: number): number {
  return zoneMassField(u, v, zones, reach);
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
    field = body
      + (grain + fine) * 0.40 * coastalBand(body, 0.46)
      + coastN * 0.07
      + authoredCapes(u, v, continent) * 0.6
      - authoredGulfs(u, v, continent, noise) * 0.62;
  } else if (treatment === "broken-shield") {
    // One deliberate mass, deeply bitten: bold headlands and long gulfs that
    // read as intentional geography from the map view.
    const [bu, bv] = warped(wu, wv, noise, 0.065, 1.15);
    const body = redesignBody(bu, bv, continent, zones, 1.28) - canonicalCuts(u, v, continent, zones, false);
    field = body
      + authoredCapes(u, v, continent)
      - authoredGulfs(u, v, continent, noise) * 0.78
      + fbm(noise.cape, u * 4.2, v * 4.2, 3) * 0.10 * coastalBand(body, 0.30)
      + coastN * 0.065;
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
    field = body
      + shatter * rim
      + skerries * offshore * 0.62
      + authoredCapes(u, v, continent) * 0.7
      - authoredGulfs(u, v, continent, noise) * 0.62
      + coastN * 0.11;
  }

  return field;
}
