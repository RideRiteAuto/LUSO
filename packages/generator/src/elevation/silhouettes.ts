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
  /**
   * Seeded from the WORLD, not from either continent, so both sides of the
   * rift read the identical curve. This is what makes the facing coasts
   * complement instead of merely both being irregular.
   */
  rift: Noise2D;
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
 * How strongly a zone anchor is protected from cuts at this point.
 *
 * A bay exists to give its zone a coast, so it must never flood that zone's
 * centre — the original silhouette drowned Cavora, Solmara and Lumeira doing
 * exactly that. The zone-mass base already guarantees an anchor is land; this
 * keeps every subtractive term (canon bays, authored gulfs, the rift seam)
 * from taking it away again. It only ever scales cuts down, so it can never
 * conjure land where the mass has none.
 */
function anchorShield(u: number, v: number, zones: ZoneDesign[]): number {
  let shield = 0;
  for (const zone of zones) {
    const distance = Math.hypot(u - zone.anchor[0], v - zone.anchor[1]);
    shield = Math.max(shield, 1 - smoothstep(0.030, 0.085, distance));
  }
  return shield;
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
interface GulfLobe { at: Vec2; radius: number }

interface GulfCut {
  /**
   * Overlapping rounded basins that merge into one bay. Ordered sea end
   * first: the leading lobes form the entrance, the rest the body.
   */
  lobes: GulfLobe[];
  /** Shoreline irregularity, 0 = smooth arc. */
  roughness: number;
  /** Decorrelates this bay's wander from its neighbours'. */
  phase: number;
  /** How completely this bay floods, 0..1. */
  flood: number;
}

const AUTHORED_GULFS: Record<ContinentId, GulfCut[]> = {
  valora: [
    // The Southwatch Bight — one broad, shallow scoop out of Valora's
    // southern coast. Every other authored gulf is gone: bays that drove
    // deep into the interior read as the notches of a jigsaw piece rather
    // than as geography, which is exactly what a coastline should not do.
    // This one is wide and barely penetrates, the way a real bight sits in
    // a coast rather than biting through it.
    {
      // Ordered sea end first. The entrance lobe sits in open water beyond
      // the coast on purpose: a bay whose lobes all land inside the shoreline
      // cuts a lagoon parallel to the coast and leaves a thread of land
      // between it and the sea, which is what the first placement did.
      lobes: [
        { at: [0.330, 0.848], radius: 0.105 },
        { at: [0.328, 0.782], radius: 0.092 },
        { at: [0.428, 0.792], radius: 0.070 },
        { at: [0.243, 0.788], radius: 0.068 },
        { at: [0.330, 0.735], radius: 0.058 },
      ],
      roughness: 0.30, phase: 5.7, flood: 1,
    },
  ],
  seradia: [],
};

/**
 * A bay as a cluster of overlapping round basins rather than a width swept
 * along an axis. A swept profile always reads as a wedge — it is widest at
 * one end and narrows to the other, which is a cone however much its edges
 * wander. Merging round lobes instead gives a roughly round, lobed basin
 * whose outline is irregular without being circular, which is what a drowned
 * basin actually looks like from above.
 */
function authoredGulfs(u: number, v: number, continent: ContinentId, noise: SilhouetteNoise): number {
  let strongest = 0;
  for (const gulf of AUTHORED_GULFS[continent]) {
    // One wander field per bay, sampled at this point: the whole shoreline
    // breathes together rather than each lobe wobbling independently.
    const wander = 1
      + fbm(noise.cape, u * 4.2 + gulf.phase, v * 4.2 + gulf.phase, 2) * gulf.roughness
      + fbm(noise.cape, u * 11.5 + gulf.phase, v * 11.5 + gulf.phase, 2) * gulf.roughness * 0.42;
    const scale = Math.max(0.32, wander);
    let presence = 0;
    for (const lobe of gulf.lobes) {
      const normalized = Math.hypot(u - lobe.at[0], v - lobe.at[1]) / Math.max(1e-6, lobe.radius * scale);
      presence += Math.exp(-normalized * normalized);
    }
    // Flat-topped: open water through the basin, feathering only at the rim.
    const t = clamp01((presence - 0.46) / 0.34);
    strongest = Math.max(strongest, t * t * (3 - 2 * t) * gulf.flood);
  }
  return strongest;
}

/**
 * The rift seam.
 *
 * Valora and Seradia are authored as one landmass that tore in two: the
 * lateral wander of that tear is a single shared curve, so Valora's east
 * coast and Seradia's west coast are the SAME line, separated only by the
 * width of the sea that opened between them. Where the seam bulges east,
 * Valora throws a headland and Seradia opens a bay of the matching shape —
 * the two coasts nest, the way South America's shoulder sits in Africa's
 * bight. Neither continent knows about the other; they just read the seam.
 */
export function riftOffsetAt(v: number, noise: SilhouetteNoise): number {
  // Three scales, and the middle one is the one that reads. The long term
  // decides which continent is broader at a given latitude; the short term is
  // shore texture. What makes a pair of coasts look torn apart rather than
  // merely wiggly is matched headland-and-bay at roughly a zone's width, and
  // with only a long and a short term the margins had none.
  return fbm(noise.rift, v * 1.6, 0.37, 3) * 0.150
    + fbm(noise.rift, v * 2.9, 5.1, 2) * 0.080
    + fbm(noise.rift, v * 4.1, 11.3, 2) * 0.055;
}

/**
 * Where each continent's rift-facing coast sits before the seam wanders.
 *
 * This has to sit INSIDE the mass, not at the tile edge. The compact masses
 * stop around u=0.88/0.12 of their own accord, so a seam parked at the very
 * edge of the tile never touched them and the tear silently stopped existing.
 * Cutting a little inboard of the natural coast is also what gives each
 * continent its half-moon read: a torn, near-straight face toward the sea it
 * opened, and a rounded ocean-facing back.
 */
export const RIFT_COAST_BASE: Record<ContinentId, number> = { valora: 0.895, seradia: 0.105 };
/**
 * How fast land falls away past the seam.
 *
 * Steeper is not better. The coast displacement that gives this margin its
 * texture is a field offset, so the distance it moves the shoreline is that
 * offset divided by this slope: at 3.4 the whole grain budget bought under a
 * kilometre of wander and the tear came out pinned to the seam curve, arrow
 * straight. Slackening it lets the same grain break the margin up.
 */
const RIFT_FALLOFF = 2.6;
/**
 * Width of the blend where the seam takes over from the natural coast.
 *
 * Where a near-vertical seam crosses a near-horizontal shoreline, the minimum
 * of the two is an L. Too narrow a blend leaves that corner square, and a
 * right angle in a coastline reads as a rendering fault rather than as land.
 */
const RIFT_BLEND = 0.11;

/**
 * How far each margin wanders on its own, independent of the shared seam.
 *
 * A continent does not tear along a clean line. If both coasts read only the
 * shared curve they interlock exactly, and an exact jigsaw looks authored --
 * the real Atlantic margins rhyme at the scale of a thousand kilometres and
 * disagree at every scale below it, because the split shattered, overlapped,
 * and left fragments stranded on both sides. This is that disagreement: each
 * margin adds its own deviation, small enough that the two coasts still
 * obviously answer each other, large enough that they never quite mate.
 */
function riftDivergenceAt(v: number, noise: SilhouetteNoise): number {
  return fbm(noise.cape, v * 2.7 + 17.1, 4.9, 3) * 0.088
    + fbm(noise.coast, v * 6.4, 23.4, 2) * 0.042;
}

function applyRift(
  field: number, u: number, v: number, continent: ContinentId, noise: SilhouetteNoise, shield: number,
): number {
  // Shared seam plus this margin's own wander: the halves rhyme, they do not
  // mate. `noise.cape`/`noise.coast` are continent-seeded, so the deviation
  // differs on each side of the sea.
  const seam = RIFT_COAST_BASE[continent] + riftOffsetAt(v, noise) + riftDivergenceAt(v, noise);
  // Valora keeps the land west of the seam, Seradia the land east of it.
  // The shield has to fade the finished clip out, NOT shrink the distance fed
  // into it: scaling `past` toward zero lands a shielded point exactly on the
  // seam, where the clip pins it to the waterline and the anchor drowns.
  const past = continent === "valora" ? u - seam : seam - u;
  if (past <= -RIFT_BLEND || shield >= 1) return field;
  // Smooth minimum, not a hard one. A hard clip leaves a crease everywhere
  // the seam crosses the natural coastline, and those creases are what read
  // as the corners of a cut-out shape.
  const clipped = smoothMin(field, LAND_FIELD_THRESHOLD - past * RIFT_FALLOFF, RIFT_BLEND);
  return field + (clipped - field) * (1 - shield);
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
function applyGulfs(
  field: number, u: number, v: number, continent: ContinentId, noise: SilhouetteNoise, shield: number,
): number {
  const flood = authoredGulfs(u, v, continent, noise) * (1 - shield);
  return flood > 0 ? field + (Math.min(field, GULF_WATER_FLOOR) - field) * flood : field;
}

/**
 * Headlands that keep a rounded mass from reading as a plain oval.
 *
 * Each has to start on land and run out to sea; the pre-reshape capes were
 * anchored where the old, larger continents used to reach, so on the compact
 * masses they hung offshore and grew spurs out of open water. These are placed
 * against the measured coast, and are deliberately modest — the silhouette is
 * meant to be a rough semicircle with character, not a starfish.
 */
const AUTHORED_CAPES: Record<ContinentId, { a: Vec2; b: Vec2; radius: number; gain: number }[]> = {
  valora: [
    // The southwestern horn, closing the western side of the Southwatch Bight.
    { a: [0.185, 0.735], b: [0.145, 0.800], radius: 0.055, gain: 0.30 },
    // A blunt northern shoulder above Cavora.
    { a: [0.735, 0.265], b: [0.800, 0.205], radius: 0.058, gain: 0.26 },
  ],
  seradia: [
    // The southern tail's outer point, and a shoulder on the ocean-facing east.
    { a: [0.230, 0.900], b: [0.190, 0.975], radius: 0.055, gain: 0.30 },
    { a: [0.930, 0.640], b: [0.985, 0.680], radius: 0.050, gain: 0.26 },
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
const MASS_ISOLINE = 1.78;
const MASS_GAIN = 0.46;
const OFFSHORE_SLOPE = 0.34;

/**
 * The anchor guarantee.
 *
 * A zone's own gaussian peaks at exactly 1.0, so while the coastline isoline
 * sat below 1.0 "every anchor is land" held for free. The compact ArcheAge-like
 * masses moved the isoline to 2.0 — several zones' worth of presence — and the
 * guarantee died with it: Cavora and Lumeira sit out on their continents'
 * shoulders with few neighbours to lean on, and drowned. So each zone now also
 * plants a tight core of its own that carries its anchor over the isoline.
 *
 * The core is smooth-MAXed into the accumulated mass, never added to it.
 * Adding it lifted the field by a fixed amount at every anchor including the
 * inland ones that never needed it, and since field height drives elevation
 * that printed a smooth eleven-kilometre dome over each zone centre — plainly
 * visible on Vidrala as an oval plateau stamped into the hill country. Taken
 * as a maximum it does nothing at all where the mass is already ample, and
 * only lifts the anchors that would otherwise drown.
 */
const ANCHOR_CORE_MARGIN = 0.30;
const ANCHOR_CORE_REACH = 0.62;

/** Polynomial smooth maximum — merges two fields without a visible crease. */
function smoothMax(a: number, b: number, k: number): number {
  const h = Math.max(0, k - Math.abs(a - b)) / k;
  return Math.max(a, b) + h * h * k * 0.25;
}

/** Polynomial smooth minimum — clips one field by another without a crease. */
function smoothMin(a: number, b: number, k: number): number {
  const h = Math.max(0, k - Math.abs(a - b)) / k;
  return Math.min(a, b) - h * h * k * 0.25;
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
  let core = 0;
  const cos = Math.cos(grain.angle), sin = Math.sin(grain.angle);
  for (const zone of zones) {
    const dx = u - zone.anchor[0], dy = v - zone.anchor[1];
    const alongX = (dx * cos - dy * sin) / grain.stretchAlong;
    const alongY = (dx * sin + dy * cos) / grain.stretchAcross;
    const distance = Math.hypot(alongX, alongY);
    const normalized = distance / Math.max(1e-6, zone.radius * reach);
    presence += Math.exp(-normalized * normalized);
    const tight = distance / Math.max(1e-6, zone.radius * ANCHOR_CORE_REACH);
    core = Math.max(core, Math.exp(-tight * tight));
  }
  presence = smoothMax(presence, core * (MASS_ISOLINE + ANCHOR_CORE_MARGIN), 0.35);
  // The coastline is the `MASS_ISOLINE` contour of that field. A zone
  // contributes 1.0 at its own anchor plus its `ANCHOR_CORE_GAIN` core, which
  // together clear the isoline, so every anchor is land by construction.
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
  valora: { angle: -0.28, stretchAlong: 1.32, stretchAcross: 0.80 },
  // A taller, narrower crescent — deliberately not Valora's proportions.
  seradia: { angle: 0.16, stretchAlong: 0.78, stretchAcross: 1.34 },
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

  const shield = anchorShield(u, v, zones);
  let field: number;
  if (treatment === "ridge-cape") {
    // Mountain grain reaches the sea: spines become capes, the valleys
    // between them become inlets, so the coast is a consequence of the
    // land's structure rather than an outline drawn around it.
    const [ru, rv] = warped(wu, wv, noise, 0.085, 1.35);
    // Unwind the warp toward true coordinates near an anchor. The zone mass
    // is what guarantees a zone stands on land, but it is sampled in warped
    // space — so a warp of a few kilometres can slide an anchor off its own
    // mass peak and drown it. Away from anchors the warp is untouched.
    const bu = ru + (u - ru) * shield, bv = rv + (v - rv) * shield;
    const body = applyRift(
      redesignBody(bu, bv, continent, zones, 1.92) - canonicalCuts(u, v, continent, zones, false) * (1 - shield),
      u, v, continent, noise, shield);
    // Coast displacement, built long-wavelength first.
    //
    // Driving this from ridged noise alone — the obvious reading of
    // "ridge-cape" — gives a coastline of V-shaped creases, which at map
    // scale renders as straight facets meeting at corners: a low-poly
    // outline, not a shore. The smooth swell carries the shape, the ridged
    // spine supplies the capes and inlets the treatment is named for at a
    // fraction of the amplitude, and the fine octave keeps the edge from
    // looking drawn with a compass.
    const swell = fbm(noise.coast, u * 1.5 + 4.2, v * 1.5, 3);
    const spine = ridged(noise.cape, u * 3.1, v * 3.1, 3, 1.0) * 2 - 1;
    const fine = fbm(noise.cape, u * 7.0, v * 7.0, 2);
    // The two coasts carry different weather. Valora stays swell-dominant —
    // long smooth bends. Seradia leans back toward the ridged spine at higher
    // amplitude, recovering the craggier pre-reshape character of its shore
    // (art direction preferred it) without the old faceting: the swell still
    // outweighs the spine, it just no longer drowns it.
    const seradian = continent === "seradia";
    const grain = seradian
      ? swell * 0.46 + spine * 0.40 + fine * 0.14
      : swell * 0.62 + spine * 0.26 + fine * 0.12;
    const grainAmp = seradian ? 0.38 : 0.30;
    const grainBand = seradian ? 0.32 : 0.26;
    // Shielded like every other coast-shaping term. Grain is signed, so a
    // wide band around a zone anchor can subtract as easily as it adds, and
    // widening the band far enough to break up the rift margin was enough to
    // drown five inland zones outright.
    field = applyGulfs(body
      + (grain * grainAmp * coastalBand(body, grainBand) + coastN * 0.07) * (1 - shield)
      + authoredCapes(u, v, continent) * 0.6, u, v, continent, noise, shield);
  } else if (treatment === "broken-shield") {
    // One deliberate mass, deeply bitten: bold headlands and long gulfs that
    // read as intentional geography from the map view.
    const [ru, rv] = warped(wu, wv, noise, 0.065, 1.15);
    const bu = ru + (u - ru) * shield, bv = rv + (v - rv) * shield;
    const body = applyRift(
      redesignBody(bu, bv, continent, zones, 1.98) - canonicalCuts(u, v, continent, zones, false) * (1 - shield),
      u, v, continent, noise, shield);
    field = applyGulfs(body
      + authoredCapes(u, v, continent)
      + fbm(noise.cape, u * 4.2, v * 4.2, 3) * 0.10 * coastalBand(body, 0.30)
      + coastN * 0.065, u, v, continent, noise, shield);
  } else {
    // Compact core inside a busy fringe of headlands, skerries and islets —
    // the small-craft coastline.
    const [ru, rv] = warped(wu, wv, noise, 0.075, 1.5);
    const bu = ru + (u - ru) * shield, bv = rv + (v - rv) * shield;
    const body = applyRift(
      redesignBody(bu, bv, continent, zones, 1.94) - canonicalCuts(u, v, continent, zones, false) * (1 - shield),
      u, v, continent, noise, shield);
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
      + coastN * 0.11, u, v, continent, noise, shield);
  }

  return field;
}
