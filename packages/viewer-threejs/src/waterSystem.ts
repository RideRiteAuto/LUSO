import * as THREE from "three/webgpu";
import { color, float, Fn, mix, mx_noise_float, positionLocal, positionWorld, sin, time, vec3 } from "three/tsl";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { sampleHeight, sampleWorldHeight } from "./terrain.js";
import { uvToWorld } from "./layout.js";
import type { ContinentData, Manifest, RiverRecord, WorldData } from "./worldData.js";

export type WaterBodyKind = "ocean" | "river" | "lake";

export interface WaterSurfaceSample {
  body: WaterBodyKind;
  bodyId: string;
  surfaceY: number;
  depth: number;
  normalX: number;
  normalY: number;
  normalZ: number;
  velocityX: number;
  velocityZ: number;
  navigable: boolean;
}

interface GerstnerWave {
  directionX: number;
  directionZ: number;
  amplitude: number;
  wavelength: number;
  speed: number;
  steepness: number;
}

interface RiverSegment {
  riverId: string;
  ax: number; az: number; ay: number;
  bx: number; bz: number; by: number;
  widthA: number; widthB: number;
  currentA: number; currentB: number;
}

interface LakeSurface {
  id: string;
  polygon: [number, number][];
  surfaceY: number;
  depthM: number;
}

export const NAVIGABLE_RIVER_WIDTH_M = 30;

// A compact, deterministic deep-water spectrum. Rendering and gameplay use
// the same coefficients so a hull pontoon, swimmer, fish, and visible crest
// never disagree about where the surface is.
export const NAVORA_OCEAN_WAVES: readonly GerstnerWave[] = [
  { directionX: 0.94, directionZ: 0.34, amplitude: 0.52, wavelength: 34, speed: 1.15, steepness: 0.48 },
  { directionX: 0.72, directionZ: 0.69, amplitude: 0.27, wavelength: 17, speed: 0.93, steepness: 0.36 },
  { directionX: -0.18, directionZ: 0.98, amplitude: 0.14, wavelength: 8.5, speed: 0.71, steepness: 0.25 },
  { directionX: 0.48, directionZ: -0.88, amplitude: 0.07, wavelength: 4.2, speed: 0.54, steepness: 0.16 },
];

function normalizedDirection(x: number, z: number): [number, number] {
  const length = Math.max(0.0001, Math.hypot(x, z));
  return [x / length, z / length];
}

export function sampleOceanWaves(worldX: number, worldZ: number, elapsedSeconds: number): Pick<WaterSurfaceSample, "surfaceY" | "normalX" | "normalY" | "normalZ"> {
  let height = 0, slopeX = 0, slopeZ = 0;
  for (const wave of NAVORA_OCEAN_WAVES) {
    const [dx, dz] = normalizedDirection(wave.directionX, wave.directionZ);
    const k = Math.PI * 2 / wave.wavelength;
    const phase = k * (dx * worldX + dz * worldZ) + elapsedSeconds * wave.speed;
    height += Math.sin(phase) * wave.amplitude;
    slopeX += Math.cos(phase) * wave.amplitude * k * dx * wave.steepness;
    slopeZ += Math.cos(phase) * wave.amplitude * k * dz * wave.steepness;
  }
  const inv = 1 / Math.max(0.0001, Math.hypot(slopeX, 1, slopeZ));
  return { surfaceY: height, normalX: -slopeX * inv, normalY: inv, normalZ: -slopeZ * inv };
}

function closestPointOnSegment(x: number, z: number, segment: RiverSegment): { t: number; distance: number; x: number; z: number } {
  const dx = segment.bx - segment.ax, dz = segment.bz - segment.az;
  const lengthSq = dx * dx + dz * dz;
  const t = lengthSq > 0 ? Math.max(0, Math.min(1, ((x - segment.ax) * dx + (z - segment.az) * dz) / lengthSq)) : 0;
  const px = segment.ax + dx * t, pz = segment.az + dz * t;
  return { t, distance: Math.hypot(x - px, z - pz), x: px, z: pz };
}

function riverWidth(progress: number, river: RiverRecord): number {
  const [source, mouth] = river.profile?.widthM ?? [24, 150];
  return source + Math.pow(progress, 1.35) * (mouth - source);
}

function riverCurrent(progress: number, river: RiverRecord): number {
  const [source, mouth] = river.profile?.currentMps ?? [2, 0.45];
  return source + (mouth - source) * progress;
}

function buildRiverGeometry(
  continent: ContinentData,
  river: RiverRecord,
  manifest: Manifest,
  segments: RiverSegment[],
  path: [number, number][] = river.path,
  progressStart = 0,
  widthScale = 1,
): THREE.BufferGeometry | null {
  if (path.length < 2) return null;
  const rawPoints = path.map(([u, v], index) => {
    const [x, z] = uvToWorld(u, v, continent.id, manifest);
    const localProgress = index / Math.max(1, path.length - 1);
    const progress = progressStart + localProgress * (1 - progressStart);
    const authoredSurface = path === river.path ? river.surfaceElevationM?.[index] : undefined;
    const terrainSurface = sampleHeight(continent, u, v);
    const surface = authoredSurface ?? Math.max(0, terrainSurface);
    return { x, z, y: surface + 0.10 + Math.pow(progress, 5) * 0.12, width: riverWidth(progress, river) * widthScale, current: riverCurrent(progress, river), progress };
  });
  const points = rawPoints.length >= 4
    ? (() => {
      const curve = new THREE.CatmullRomCurve3(rawPoints.map((point) => new THREE.Vector3(point.x, point.y, point.z)), false, "centripetal", 0.18);
      const sampleCount = (rawPoints.length - 1) * 4;
      return Array.from({ length: sampleCount + 1 }, (_, index) => {
        const t = index / sampleCount;
        const point = curve.getPoint(t);
        const progress = progressStart + t * (1 - progressStart);
        return { x: point.x, z: point.z, y: point.y, width: riverWidth(progress, river) * widthScale, current: riverCurrent(progress, river), progress };
      });
    })()
    : rawPoints;
  const positions: number[] = [], uvs: number[] = [], colors: number[] = [], indices: number[] = [];
  let distanceAlong = 0;
  for (let i = 0; i < points.length; i++) {
    const previous = points[Math.max(0, i - 1)], next = points[Math.min(points.length - 1, i + 1)], point = points[i];
    const [tx, tz] = normalizedDirection(next.x - previous.x, next.z - previous.z);
    const sideX = -tz, sideZ = tx;
    if (i > 0) distanceAlong += Math.hypot(point.x - points[i - 1].x, point.z - points[i - 1].z);
    positions.push(point.x + sideX * point.width * 0.5, point.y, point.z + sideZ * point.width * 0.5);
    positions.push(point.x, point.y, point.z);
    positions.push(point.x - sideX * point.width * 0.5, point.y, point.z - sideZ * point.width * 0.5);
    uvs.push(0, distanceAlong / 22, 0.5, distanceAlong / 22, 1, distanceAlong / 22);
    const shallow = 0.78 + point.progress * 0.12;
    const deep = 0.54 + point.progress * 0.10;
    colors.push(
      0.72 * shallow, 0.94 * shallow, 1 * shallow,
      0.60 * deep, 0.84 * deep, 0.94 * deep,
      0.72 * shallow, 0.94 * shallow, 1 * shallow,
    );
    if (i < points.length - 1) segments.push({
      riverId: river.id, ax: point.x, az: point.z, ay: point.y,
      bx: next.x, bz: next.z, by: next.y,
      widthA: point.width, widthB: next.width,
      currentA: point.current, currentB: next.current,
    });
  }
  for (let i = 0; i < points.length - 1; i++) {
    const a = i * 3, b = a + 1, c = a + 2;
    const d = a + 3, e = a + 4, f = a + 5;
    indices.push(a, d, b, b, d, e, b, e, c, c, e, f);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}

/**
 * Unified browser-first water runtime. One data/query layer drives the visible
 * ocean and rivers plus swimming, fish volumes, NPC water navigation, future
 * pontoon buoyancy, currents, wakes, and combat projectiles.
 */
export class NavoraWaterSystem {
  readonly group = new THREE.Group();
  readonly riverGroup = new THREE.Group();
  private readonly riverSegments: RiverSegment[] = [];
  private readonly lakeSurfaces: LakeSurface[] = [];
  readonly ocean: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardNodeMaterial>;
  private readonly riverMesh: THREE.Mesh | null;
  private elapsed = 0;

  constructor(private readonly world: WorldData, quality: "high" | "balanced" | "compatibility", _sunDirection: THREE.Vector3) {
    this.group.name = "navora-unified-water";
    this.riverGroup.name = "navora-river-surfaces";
    const extent = quality === "compatibility" ? 30000 : quality === "balanced" ? 48000 : 70000;
    const segments = quality === "compatibility" ? 64 : quality === "balanced" ? 96 : 128;
    const oceanGeometry = new THREE.PlaneGeometry(extent, extent, segments, segments);
    oceanGeometry.rotateX(-Math.PI / 2);
    const oceanMaterial = new THREE.MeshStandardNodeMaterial();
    const oceanMacro = mx_noise_float(positionWorld.xz.mul(0.00018)).mul(0.5).add(0.5);
    oceanMaterial.colorNode = mix(color(0x052b3d), color(0x0b5368), oceanMacro.mul(0.42));
    // Do not world-tile the short-wave normal map across this overview mesh:
    // even with mipmaps, kilometre-scale camera views turn it into moire.
    // Geometry swells carry the horizon. A future near-water clipmap can add
    // short normals only inside a distance where they remain sampleable.
    oceanMaterial.roughnessNode = float(quality === "compatibility" ? 0.30 : 0.20);
    oceanMaterial.metalnessNode = float(0.02);
    oceanMaterial.transparent = true;
    oceanMaterial.opacity = 0.94;
    oceanMaterial.depthWrite = true;
    this.ocean = new THREE.Mesh(oceanGeometry, oceanMaterial);
    this.ocean.name = "camera-relative-gerstner-ocean";
    // The camera-relative ocean spans tens of kilometres, so its geometry
    // grid can only carry long swells. The former 4-34m frequencies were
    // sampled on ~550m triangles and aliased into an enormous checkerboard.
    // Short gameplay waves remain in sampleOceanWaves; distance-gated surface
    // detail is a later water-presentation concern. These mesh-resolvable
    // swells provide silhouette/parallax without facets.
    oceanMaterial.positionNode = Fn(() => {
      const p = positionLocal.toVar();
      const wave = sin(p.x.mul(0.00074).add(p.z.mul(0.00027)).add(time.mul(0.31))).mul(0.52)
        .add(sin(p.x.mul(0.00116).add(p.z.mul(0.00111)).add(time.mul(0.43))).mul(0.27))
        .add(sin(p.x.mul(-0.00054).add(p.z.mul(0.00293)).add(time.mul(0.57))).mul(0.14))
        .add(sin(p.x.mul(0.00242).add(p.z.mul(-0.00440)).add(time.mul(0.71))).mul(0.07));
      return p.add(vec3(0, wave, 0));
    })();
    this.ocean.renderOrder = 1;
    this.group.add(this.ocean);

    const riverGeometries: THREE.BufferGeometry[] = [];
    for (const continent of Object.values(world.continents)) {
      for (const lake of continent.lakes) {
        this.lakeSurfaces.push({
          id: lake.id,
          polygon: lake.polygon.map(([u, v]) => uvToWorld(u, v, continent.id, world.manifest)),
          surfaceY: lake.surfaceElevationM,
          depthM: lake.depthM,
        });
      }
      for (const river of continent.rivers) {
        const geometry = buildRiverGeometry(continent, river, world.manifest, this.riverSegments);
        if (geometry) riverGeometries.push(geometry);
        for (const distributary of river.distributaries ?? []) {
          const branch = buildRiverGeometry(continent, river, world.manifest, this.riverSegments, distributary, 0.68, 0.68);
          if (branch) riverGeometries.push(branch);
        }
      }
    }
    const merged = riverGeometries.length ? mergeGeometries(riverGeometries, false) : null;
    for (const geometry of riverGeometries) geometry.dispose();
    if (merged) {
      const material = new THREE.MeshPhysicalMaterial({
        color: 0x276f83, vertexColors: true, transparent: true, opacity: 0.79,
        roughness: 0.19, metalness: 0.02, clearcoat: 0.38, clearcoatRoughness: 0.16,
        side: THREE.DoubleSide, depthWrite: false,
      });
      this.riverMesh = new THREE.Mesh(merged, material);
      this.riverMesh.name = "spline-rivers-shared-flow-material";
      this.riverMesh.renderOrder = 2;
      this.riverGroup.add(this.riverMesh);
    } else this.riverMesh = null;
    this.group.add(this.riverGroup);
  }

  update(elapsedSeconds: number, cameraWorldX: number, cameraWorldZ: number, cameraWorldY = 0): void {
    this.elapsed = elapsedSeconds;
    const snap = 256;
    this.ocean.position.x = Math.round(cameraWorldX / snap) * snap;
    this.ocean.position.z = Math.round(cameraWorldZ / snap) * snap;
    if (this.riverMesh) {
      // A flight LOD hundreds of metres across cannot resolve a 30-200 m
      // carved channel. Drawing the near-water strip through that coarse mesh
      // made distant rivers appear as disconnected blue slashes. Fade only
      // the presentation surface at strategic-view altitude; the authored
      // channel, hydrology, navigation, fish, and boat query data remain.
      const altitudeFade = THREE.MathUtils.clamp((cameraWorldY - 2200) / 1400, 0, 1);
      this.riverMesh.visible = altitudeFade < 0.995;
      (this.riverMesh.material as THREE.MeshPhysicalMaterial).opacity = 0.79 * (1 - altitudeFade);
    }
  }

  sample(worldX: number, worldZ: number, elapsedSeconds = this.elapsed): WaterSurfaceSample | null {
    let nearest: { segment: RiverSegment; t: number; distance: number } | null = null;
    for (const segment of this.riverSegments) {
      const hit = closestPointOnSegment(worldX, worldZ, segment);
      const width = segment.widthA + (segment.widthB - segment.widthA) * hit.t;
      if (hit.distance > width * 0.55) continue;
      if (!nearest || hit.distance < nearest.distance) nearest = { segment, t: hit.t, distance: hit.distance };
    }
    if (nearest) {
      const segment = nearest.segment;
      const surfaceY = segment.ay + (segment.by - segment.ay) * nearest.t + Math.sin(elapsedSeconds * 2.1 + worldX * 0.19 + worldZ * 0.13) * 0.035;
      const width = segment.widthA + (segment.widthB - segment.widthA) * nearest.t;
      const [dx, dz] = normalizedDirection(segment.bx - segment.ax, segment.bz - segment.az);
      const current = segment.currentA + (segment.currentB - segment.currentA) * nearest.t;
      const ground = sampleWorldHeight(this.world.worldHeight, worldX, worldZ);
      return { body: "river", bodyId: segment.riverId, surfaceY, depth: Math.max(0, surfaceY - ground), normalX: 0, normalY: 1, normalZ: 0, velocityX: dx * current, velocityZ: dz * current, navigable: width >= NAVIGABLE_RIVER_WIDTH_M };
    }
    for (const lake of this.lakeSurfaces) {
      let inside = false;
      for (let i = 0, j = lake.polygon.length - 1; i < lake.polygon.length; j = i++) {
        const [xi, zi] = lake.polygon[i], [xj, zj] = lake.polygon[j];
        if ((zi > worldZ) !== (zj > worldZ) && worldX < (xj - xi) * (worldZ - zi) / (zj - zi) + xi) inside = !inside;
      }
      if (inside) {
        const ripple = Math.sin(elapsedSeconds * 0.72 + worldX * 0.018 + worldZ * 0.014) * 0.035;
        const ground = sampleWorldHeight(this.world.worldHeight, worldX, worldZ);
        const surfaceY = lake.surfaceY + ripple;
        return { body: "lake", bodyId: lake.id, surfaceY, depth: Math.max(0, surfaceY - ground), normalX: 0, normalY: 1, normalZ: 0, velocityX: 0.025, velocityZ: 0.01, navigable: lake.depthM >= 2.5 };
      }
    }
    const ground = sampleWorldHeight(this.world.worldHeight, worldX, worldZ);
    if (ground > 0.15) return null;
    const wave = sampleOceanWaves(worldX, worldZ, elapsedSeconds);
    return { body: "ocean", bodyId: "luna-sea", ...wave, depth: Math.max(0, wave.surfaceY - ground), velocityX: 0.18, velocityZ: 0.08, navigable: true };
  }

  dispose(): void {
    this.ocean.geometry.dispose(); this.ocean.material.dispose();
    if (this.riverMesh) { this.riverMesh.geometry.dispose(); (this.riverMesh.material as THREE.Material).dispose(); }
    this.group.clear();
  }
}
