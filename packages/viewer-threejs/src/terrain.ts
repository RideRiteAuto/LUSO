import * as THREE from "three/webgpu";
import type { ContinentData, Manifest, WorldData, WorldHeightData } from "./worldData.js";
import { continentOriginX, continentOriginZ } from "./layout.js";

// World units ARE meters now (docs/01 §5, data/design/continents.json) --
// no vertical exaggeration. A prior version faked a 0.35x vertical scale to
// make an undersized world look more reasonable; the actual fix was to
// stop lying about the scale (see docs/01 §5's "corrected 2nd pass" note).
const ELEVATION_SCALE = 1;

// Matches elevation/index.ts's deep-ocean asymptote (-(50 + depthFactor*3500)
// as depthFactor -> 1), so the skirt below settles at the same depth the real
// generated bathymetry itself levels out to -- no visible "floor changes"
// where the real data hands off to the synthetic skirt.
const ABYSS_DEPTH = -3550;

// How far past the real generated world bounds the synthetic ocean skirt
// extends before it's fully at ABYSS_DEPTH. Chosen well beyond the scene's
// fog-far distance (main.ts sets fog far at 160000) so the skirt's own outer
// edge is never actually visible -- it's fully fogged out first, which is
// what makes the ocean read as boundless instead of ending in a wall
// (Kevin: "I should be able to swim off the beach on any edge of the world
// ... right now our game world ends in a flat blank wall").
export const SKIRT_REACH = 60000;
const SKIRT_STEP_FRACTIONS = [0.025, 0.05, 0.085, 0.13, 0.19, 0.27, 0.37, 0.49, 0.63, 0.8, 1.0];

// --- TEMPORARY DIAGNOSTIC INSTRUMENTATION (streak-bug investigation, see
// docs handoff notes) -----------------------------------------------------
// All three flags below default to false/off. They exist to let a later
// pass reproduce and verify the "diagonal streaks in the World view" bug
// without hunting for injection points. Search "DIAG_" to find every use.
// Toggle via URL query params, e.g. ?diagCoreSkirt=1&diagWireframe=1 --
// or flip the literal `false` defaults below for a hardcoded override.
const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;

// DIAG_CORE_SKIRT_COLOR: when true, ignores the normal biome/water vertex
// color entirely and instead colors every skirt vertex (skirtT > 0) bright
// magenta (1,0,1) and every core vertex bright cyan (0,1,1). Used to check
// whether the observed streaks fall in the skirt region, the core region,
// or straddle the boundary between them.
export const DIAG_CORE_SKIRT_COLOR = (params?.get("diagCoreSkirt") === "1") || false;

// DIAG_WIREFRAME: when true, the material returned by buildWorldMesh has
// wireframe rendering enabled, to inspect triangle shape/degeneracy near
// the core/skirt seam.
export const DIAG_WIREFRAME = (params?.get("diagWireframe") === "1") || false;

// DIAG_FORCE_SKIRT_UNDERWATER: when true, every skirt vertex's starting
// elevation (the "realH" that then gets blended toward ABYSS_DEPTH) is
// forced to a fixed, safely-underwater -100 instead of the normal
// clamped-boundary sample. Tests whether the streaks are caused by that
// boundary sample carrying a positive (land) elevation out into the skirt.
export const DIAG_FORCE_SKIRT_UNDERWATER = (params?.get("diagForceUnderwater") === "1") || false;
// --- END TEMPORARY DIAGNOSTIC INSTRUMENTATION -----------------------------

const SHALLOW_WATER = new THREE.Color(0x1c5a78);
const DEEP_WATER = new THREE.Color(0x081c33);
const BEACH_SAND = new THREE.Color(0xe3d6a8);
const LAND_FALLBACK = new THREE.Color(0x4c8c4a);

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function waterColor(h: number): THREE.Color {
  const depthT = Math.max(0, Math.min(1, -h / 3500));
  return SHALLOW_WATER.clone().lerp(DEEP_WATER, depthT);
}

/**
 * Per-continent blurred biome-color field, sampled from the (otherwise
 * hard-edged, one-flat-color-per-pixel) indexed biome PNG. The classifier
 * assigns one discrete biome per grid cell with no blending between
 * neighbors, which is what reads as "blocky jagged paintings" up close
 * (Kevin's report) rather than a coastline that gradually shifts from wet
 * sand to dry grass. A small box blur softens those hard cell boundaries
 * before they're baked into the mesh's vertex colors -- purely a rendering
 * smoothing pass, the underlying biome *data* (used for spawns/resources)
 * is untouched.
 */
interface BlurredBiomeField {
  width: number;
  height: number;
  rgb: Float32Array; // 3 floats per pixel, 0..1
}

function buildBlurredBiomeField(image: HTMLImageElement): BlurredBiomeField {
  const w = image.naturalWidth;
  const h = image.naturalHeight;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(image, 0, 0);
  const src = ctx.getImageData(0, 0, w, h).data;

  const RADIUS = 2;
  const rgb = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, count = 0;
      for (let dy = -RADIUS; dy <= RADIUS; dy++) {
        const sy = y + dy;
        if (sy < 0 || sy >= h) continue;
        for (let dx = -RADIUS; dx <= RADIUS; dx++) {
          const sx = x + dx;
          if (sx < 0 || sx >= w) continue;
          const i = (sy * w + sx) * 4;
          r += src[i];
          g += src[i + 1];
          b += src[i + 2];
          count++;
        }
      }
      const outIdx = (y * w + x) * 3;
      rgb[outIdx] = r / count / 255;
      rgb[outIdx + 1] = g / count / 255;
      rgb[outIdx + 2] = b / count / 255;
    }
  }
  return { width: w, height: h, rgb };
}

function sampleBlurredBiome(field: BlurredBiomeField, u: number, v: number, out: THREE.Color): void {
  // Biome PNG is authored (0,0)=top-left in image space but (0,0)=south in
  // our v-down grid convention (docs/01 §3 stage 3) -- flip v to match, same
  // convention the old texture-mapped mesh applied via texture.repeat.set(1,-1).
  const px = Math.min(field.width - 1, Math.max(0, Math.round(u * (field.width - 1))));
  const py = Math.min(field.height - 1, Math.max(0, Math.round((1 - v) * (field.height - 1))));
  const i = (py * field.width + px) * 3;
  out.setRGB(field.rgb[i], field.rgb[i + 1], field.rgb[i + 2]);
}

/** Nearest-sample lookup into a continent's own local heightfield. Used for overlay placement (rivers, settlement markers, etc). */
export function sampleHeight(continent: ContinentData, u: number, v: number): number {
  const res = continent.resolution;
  const x = Math.min(res - 1, Math.max(0, Math.round(u * (res - 1))));
  const y = Math.min(res - 1, Math.max(0, Math.round(v * (res - 1))));
  return continent.heightData[y * res + x];
}

/**
 * A softened copy of the unified heightfield, used ONLY for building the
 * visual mesh below -- never for gameplay-facing height queries (walk-mode
 * grounding, lake surface elevation, etc. all keep reading the raw,
 * authoritative worldHeight.data via nearestUnifiedHeight/sampleWorldHeight/
 * sampleHeightWithSkirt).
 *
 * The coastline read as "jagged, not an actual beach" even after softening
 * how quickly the ocean floor drops (elevation/index.ts) -- because that
 * doesn't touch the actual land/water boundary LINE, which is wherever the
 * terrain mesh's own triangulation crosses sea level. That line is exactly
 * as jagged as the underlying grid's small-scale height variation, at any
 * resolution. A small blur on the height values feeding the visual mesh
 * removes that small-scale bumpiness -- mountains (which vary over
 * kilometers) are essentially untouched by a ~200m-radius blur, but the
 * coastline crossing, sensitive to every small local bump, comes out
 * visibly smoother.
 *
 * (An earlier attempt at this fix added a separate flat, semi-transparent
 * water plane covering the whole world at a fixed sea-level height, on the
 * theory that a flat surface has no facets to hide underwater jaggedness
 * behind. It didn't touch the boundary line either, so it was removed --
 * and worse, being nearly coincident in extent with this mesh, it
 * z-fought with the actual terrain across large areas: flickering "static"
 * wherever land sat close to that fixed height, and a striped Moire
 * pattern out past the coast where the flat plane's height repeatedly
 * crossed the sloping seabed's. Kevin caught both from screenshots.)
 */
function buildSoftenedHeights(worldHeight: WorldHeightData, radiusCells: number): Float32Array {
  const { width, height: gridH, data } = worldHeight;
  // Separable box blur (horizontal pass then vertical pass) instead of a
  // full 2D kernel per cell -- O(n*r) each pass instead of O(n*r^2), which
  // matters at this grid's ~1M-cell size (a naive 7x7 kernel over a
  // 2048x512 field was slow enough to stall the page during mesh build).
  const tmp = new Float32Array(width * gridH);
  for (let y = 0; y < gridH; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let sum = 0, count = 0;
      for (let dx = -radiusCells; dx <= radiusCells; dx++) {
        const sx = x + dx;
        if (sx < 0 || sx >= width) continue;
        sum += data[row + sx];
        count++;
      }
      tmp[row + x] = sum / count;
    }
  }
  const out = new Float32Array(width * gridH);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < gridH; y++) {
      let sum = 0, count = 0;
      for (let dy = -radiusCells; dy <= radiusCells; dy++) {
        const sy = y + dy;
        if (sy < 0 || sy >= gridH) continue;
        sum += tmp[sy * width + x];
        count++;
      }
      out[y * width + x] = sum / count;
    }
  }
  return out;
}

function sampleField(field: Float32Array, width: number, gridH: number, bounds: WorldHeightData["bounds"], worldX: number, worldZ: number): number {
  const u = (worldX - bounds.minX) / (bounds.maxX - bounds.minX);
  const v = (worldZ - bounds.minZ) / (bounds.maxZ - bounds.minZ);
  const gx = Math.min(width - 1, Math.max(0, Math.round(u * (width - 1))));
  const gy = Math.min(gridH - 1, Math.max(0, Math.round(v * (gridH - 1))));
  return field[gy * width + gx];
}

function nearestUnifiedHeight(worldHeight: WorldHeightData, worldX: number, worldZ: number): number {
  const { width, height: gridH, data, bounds } = worldHeight;
  const u = (worldX - bounds.minX) / (bounds.maxX - bounds.minX);
  const v = (worldZ - bounds.minZ) / (bounds.maxZ - bounds.minZ);
  const fx = Math.min(width - 1, Math.max(0, u * (width - 1)));
  const fy = Math.min(gridH - 1, Math.max(0, v * (gridH - 1)));
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(gridH - 1, y0 + 1);
  const tx = fx - x0, ty = fy - y0;
  const a = data[y0 * width + x0] * (1 - tx) + data[y0 * width + x1] * tx;
  const b = data[y1 * width + x0] * (1 - tx) + data[y1 * width + x1] * tx;
  return a * (1 - ty) + b * ty;
}

/**
 * Ground/seabed height at an arbitrary world (x,z), including the synthetic
 * ocean skirt beyond the real generated bounds -- shared by the mesh builder
 * below and by the walk/fly camera's grounding, so a flown or walked path
 * out past the coast sees the exact same seabed the mesh actually renders,
 * not a flat clamp at the boundary's edge value.
 */
export function sampleHeightWithSkirt(worldHeight: WorldHeightData, worldX: number, worldZ: number): number {
  const { bounds } = worldHeight;
  const cx = Math.max(bounds.minX, Math.min(bounds.maxX, worldX));
  const cz = Math.max(bounds.minZ, Math.min(bounds.maxZ, worldZ));
  const real = nearestUnifiedHeight(worldHeight, cx, cz);

  const dx = Math.max(0, bounds.minX - worldX, worldX - bounds.maxX);
  const dz = Math.max(0, bounds.minZ - worldZ, worldZ - bounds.maxZ);
  const distPastEdge = Math.max(dx, dz);
  if (distPastEdge <= 0) return real;

  const t = smoothstep(0, SKIRT_REACH, distPastEdge);
  return real + (ABYSS_DEPTH - real) * t;
}

function findOwningContinent(
  worldX: number,
  worldZ: number,
  continentIds: string[],
  manifest: Manifest
): { id: string; u: number; v: number } | null {
  const tileSize = manifest.worldScale.continentTileSize;
  let best: { id: string; u: number; v: number; dist: number } | null = null;
  for (const id of continentIds) {
    const ox = continentOriginX(id, manifest);
    const oz = continentOriginZ(id, manifest);
    const u = (worldX - ox) / tileSize;
    const v = (worldZ - oz) / tileSize;
    if (u >= 0 && u <= 1 && v >= 0 && v <= 1) return { id, u, v };
    // Distance outside [0,1]^2, for the fallback below (a sliver of land
    // just outside its own nominal tile square, at the continent mask's
    // outer edge -- rare, but real elevation/index.ts math does allow it).
    const du = Math.max(0, -u, u - 1);
    const dv = Math.max(0, -v, v - 1);
    const dist = Math.hypot(du, dv);
    if (!best || dist < best.dist) best = { id, u: Math.max(0, Math.min(1, u)), v: Math.max(0, Math.min(1, v)), dist };
  }
  return best;
}

export interface TerrainColorMap {
  data: Uint8Array;
  width: number;
  height: number;
}

/**
 * Builds a compact, unified lookup texture for worker-generated terrain
 * tiles. The source remains the generated biome maps; this merely avoids
 * sending DOM images into workers and keeps the current zone colors intact
 * until Phase 4 replaces them with layered terrain materials.
 */
export function buildTerrainColorMap(world: WorldData, targetWidth = 1024): TerrainColorMap {
  const { manifest, worldHeight, continents } = world;
  const { bounds } = worldHeight;
  const width = Math.min(targetWidth, worldHeight.width);
  const height = Math.max(2, Math.round(width * (bounds.maxZ - bounds.minZ) / (bounds.maxX - bounds.minX)));
  const data = new Uint8Array(width * height * 3);
  const biomeFields = new Map<string, BlurredBiomeField>();
  for (const id of manifest.continents) biomeFields.set(id, buildBlurredBiomeField(continents[id].biomeImage));
  const color = new THREE.Color();
  const biome = new THREE.Color();

  for (let z = 0; z < height; z++) {
    const worldZ = bounds.minZ + (z / (height - 1)) * (bounds.maxZ - bounds.minZ);
    for (let x = 0; x < width; x++) {
      const worldX = bounds.minX + (x / (width - 1)) * (bounds.maxX - bounds.minX);
      const h = nearestUnifiedHeight(worldHeight, worldX, worldZ);
      if (h <= 0) color.copy(waterColor(h));
      else if (h <= 8) color.copy(waterColor(0)).lerp(BEACH_SAND, smoothstep(0, 8, h));
      else {
        const owner = findOwningContinent(worldX, worldZ, manifest.continents, manifest);
        if (owner) {
          sampleBlurredBiome(biomeFields.get(owner.id)!, owner.u, owner.v, biome);
          color.copy(biome);
        } else color.copy(LAND_FALLBACK);
      }
      const i = (z * width + x) * 3;
      data[i] = Math.round(color.r * 255);
      data[i + 1] = Math.round(color.g * 255);
      data[i + 2] = Math.round(color.b * 255);
    }
  }
  return { data, width, height };
}

function buildAxis(coreCount: number, min: number, max: number, reach: number): number[] {
  const core: number[] = [];
  for (let i = 0; i < coreCount; i++) core.push(min + (i / (coreCount - 1)) * (max - min));
  const leftSkirt = [...SKIRT_STEP_FRACTIONS].reverse().map((f) => min - f * reach);
  const rightSkirt = SKIRT_STEP_FRACTIONS.map((f) => max + f * reach);
  return [...leftSkirt, ...core, ...rightSkirt];
}

/**
 * The single, seamless world mesh: both continents, the connecting seabed
 * between them, AND a smoothly-blended synthetic skirt beyond the real
 * generated bounds so the ocean reads as boundless instead of ending at a
 * wall. Replaces the old buildTerrainMesh (per-continent) + buildSeabedMesh
 * (separate, differently-resolved, differently-colored) pair -- those were
 * two independently built, independently sampled meshes that only
 * approximately lined up at the coast, which is exactly what read as "two
 * separate models stitched together" with the seabed "peeking through" at
 * the seams (Kevin's report after the previous pass). One continuous
 * BufferGeometry, one height source, one color function: there is no seam
 * left to peek through.
 */
export function buildWorldMesh(world: WorldData): THREE.Mesh {
  const { manifest, worldHeight, continents } = world;
  const { bounds } = worldHeight;
  const continentIds = manifest.continents;

  const biomeFields = new Map<string, BlurredBiomeField>();
  for (const id of continentIds) biomeFields.set(id, buildBlurredBiomeField(continents[id].biomeImage));

  // Preserve generated landform detail. The former three-cell blur erased
  // roughly 400m of ridges and drainage at the default scale; a one-cell
  // visual filter only suppresses single-sample coastline spikes.
  const softHeights = buildSoftenedHeights(worldHeight, 1);

  // Core resolution: half the unified field's native resolution (which is
  // already a downsample of the per-continent 64m/cell data) -- detailed
  // enough for a coastline to read as a coastline, not so dense that the
  // per-vertex color pass (continent lookup + blurred-biome sample) becomes
  // the load bottleneck.
  const coreW = Math.min(1536, worldHeight.width);
  const coreD = Math.max(2, Math.round(coreW * ((bounds.maxZ - bounds.minZ) / (bounds.maxX - bounds.minX))));

  const xs = buildAxis(coreW, bounds.minX, bounds.maxX, SKIRT_REACH);
  const zs = buildAxis(coreD, bounds.minZ, bounds.maxZ, SKIRT_REACH);
  const gridW = xs.length;
  const gridD = zs.length;

  const positions = new Float32Array(gridW * gridD * 3);
  const colors = new Float32Array(gridW * gridD * 3);
  const tmpColor = new THREE.Color();
  const biomeSample = new THREE.Color();

  for (let iz = 0; iz < gridD; iz++) {
    const z = zs[iz];
    const dz = Math.max(0, bounds.minZ - z, z - bounds.maxZ);
    for (let ix = 0; ix < gridW; ix++) {
      const x = xs[ix];
      const dx = Math.max(0, bounds.minX - x, x - bounds.maxX);
      const distPastEdge = Math.max(dx, dz);
      const skirtT = distPastEdge > 0 ? smoothstep(0, SKIRT_REACH, distPastEdge) : 0;

      const cx = Math.max(bounds.minX, Math.min(bounds.maxX, x));
      const cz = Math.max(bounds.minZ, Math.min(bounds.maxZ, z));
      let realH = sampleField(softHeights, worldHeight.width, worldHeight.height, bounds, cx, cz);
      // DIAG_FORCE_SKIRT_UNDERWATER: see flag doc above -- overrides the
      // skirt's starting elevation before the abyss blend below, regardless
      // of what the (possibly land-carrying) boundary sample says.
      if (DIAG_FORCE_SKIRT_UNDERWATER && skirtT > 0) realH = -100;
      // Never propagate positive boundary elevation into the synthetic ocean
      // margin. Generated worlds now include an ocean-only safety margin too,
      // but this guard keeps older exported seeds safe to inspect.
      if (skirtT > 0) realH = Math.min(realH, -100);
      const h = realH + (ABYSS_DEPTH - realH) * skirtT;

      // Color follows height, not "which mesh this used to be": pure
      // depth-shaded water at/under sea level, a smooth sand blend just
      // above it, and only clearly-dry land samples the biome image --
      // this is what makes the shoreline itself the transition instead of
      // two flatly-colored surfaces butting up against each other.
      if (realH <= 0) {
        tmpColor.copy(waterColor(realH));
      } else if (realH <= 8) {
        tmpColor.copy(waterColor(0)).lerp(BEACH_SAND, smoothstep(0, 8, realH));
      } else {
        const owner = findOwningContinent(cx, cz, continentIds, manifest);
        if (owner) {
          const field = biomeFields.get(owner.id)!;
          sampleBlurredBiome(field, owner.u, owner.v, biomeSample);
          tmpColor.copy(biomeSample);
        } else {
          tmpColor.copy(LAND_FALLBACK);
        }
      }
      if (skirtT > 0) tmpColor.lerp(DEEP_WATER, skirtT);

      // DIAG_CORE_SKIRT_COLOR: see flag doc above -- unmistakable debug
      // colors that ignore the normal shading entirely, applied last so
      // nothing above this point can dilute them.
      if (DIAG_CORE_SKIRT_COLOR) {
        if (skirtT > 0) tmpColor.setRGB(1, 0, 1);
        else tmpColor.setRGB(0, 1, 1);
      }

      const vi = iz * gridW + ix;
      positions[vi * 3] = x;
      positions[vi * 3 + 1] = h * ELEVATION_SCALE;
      positions[vi * 3 + 2] = z;
      colors[vi * 3] = tmpColor.r;
      colors[vi * 3 + 1] = tmpColor.g;
      colors[vi * 3 + 2] = tmpColor.b;
    }
  }

  const indices: number[] = [];
  for (let iz = 0; iz < gridD - 1; iz++) {
    for (let ix = 0; ix < gridW - 1; ix++) {
      const a = iz * gridW + ix;
      const b = iz * gridW + ix + 1;
      const c = (iz + 1) * gridW + ix;
      const d = (iz + 1) * gridW + ix + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0.02 });
  // DIAG_WIREFRAME: see flag doc above.
  if (DIAG_WIREFRAME) material.wireframe = true;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  return mesh;
}

/** Samples the unified world heightfield at an arbitrary world position, clamped to the real generated bounds -- used where the skirt's synthetic falloff isn't relevant (e.g. deciding whether a point is under water for gameplay logic). For camera grounding use sampleHeightWithSkirt instead. */
export function sampleWorldHeight(worldHeight: WorldHeightData, worldX: number, worldZ: number): number {
  return nearestUnifiedHeight(worldHeight, worldX, worldZ);
}
