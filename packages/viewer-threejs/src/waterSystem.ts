import * as THREE from "three/webgpu";
import { WaterMesh } from "three/addons/objects/WaterMesh.js";
import { Fn, positionLocal, sin, time, vec3 } from "three/tsl";
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

export const NAVIGABLE_RIVER_WIDTH_M = 18;

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

function makeNormalTexture(size: number, phase: number): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d")!;
  const image = context.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size * Math.PI * 2, v = y / size * Math.PI * 2;
    const sx = Math.cos(u * 3 + v * 1.3 + phase) * 0.35 + Math.cos(u * 7.2 - v * 4.1 + phase * 1.7) * 0.17 + Math.sin(u * 13.1 + v * 9.3) * 0.06;
    const sz = Math.sin(v * 4 - u * 0.8 + phase) * 0.32 + Math.sin(v * 8.4 + u * 3.7 - phase * 1.2) * 0.16 + Math.cos(v * 15.3 - u * 11.2) * 0.05;
    const inv = 1 / Math.hypot(sx, 1, sz);
    const index = (y * size + x) * 4;
    image.data[index] = Math.round((-sx * inv * 0.5 + 0.5) * 255);
    image.data[index + 1] = Math.round((inv * 0.5 + 0.5) * 255);
    image.data[index + 2] = Math.round((-sz * inv * 0.5 + 0.5) * 255);
    image.data[index + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  const texture = new THREE.Texture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

function riverWidth(progress: number, river: RiverRecord): number {
  // Headwaters remain fish/swimmer water; the lower half grows into the
  // navigable 18-52 m channel required by early rafts and cutters.
  const [source, mouth] = river.profile?.widthM ?? [7, 52];
  return source + Math.pow(progress, 1.35) * (mouth - source);
}

function riverCurrent(progress: number, river: RiverRecord): number {
  const [source, mouth] = river.profile?.currentMps ?? [2, 0.45];
  return source + (mouth - source) * progress;
}

function buildRiverGeometry(continent: ContinentData, river: RiverRecord, manifest: Manifest, segments: RiverSegment[]): THREE.BufferGeometry | null {
  if (river.path.length < 2) return null;
  const points = river.path.map(([u, v], index) => {
    const [x, z] = uvToWorld(u, v, continent.id, manifest);
    const progress = index / Math.max(1, river.path.length - 1);
    return { x, z, y: sampleHeight(continent, u, v) + 0.42, width: riverWidth(progress, river), current: riverCurrent(progress, river), progress };
  });
  const positions: number[] = [], uvs: number[] = [], colors: number[] = [], indices: number[] = [];
  let distanceAlong = 0;
  for (let i = 0; i < points.length; i++) {
    const previous = points[Math.max(0, i - 1)], next = points[Math.min(points.length - 1, i + 1)], point = points[i];
    const [tx, tz] = normalizedDirection(next.x - previous.x, next.z - previous.z);
    const sideX = -tz, sideZ = tx;
    if (i > 0) distanceAlong += Math.hypot(point.x - points[i - 1].x, point.z - points[i - 1].z);
    positions.push(point.x + sideX * point.width * 0.5, point.y, point.z + sideZ * point.width * 0.5);
    positions.push(point.x - sideX * point.width * 0.5, point.y, point.z - sideZ * point.width * 0.5);
    uvs.push(0, distanceAlong / 18, 1, distanceAlong / 18);
    const shallow = 0.72 + point.progress * 0.18;
    colors.push(0.58 * shallow, 0.88 * shallow, 1 * shallow, 0.58 * shallow, 0.88 * shallow, 1 * shallow);
    if (i < points.length - 1) segments.push({
      riverId: river.id, ax: point.x, az: point.z, ay: point.y,
      bx: next.x, bz: next.z, by: next.y,
      widthA: point.width, widthB: next.width,
      currentA: point.current, currentB: next.current,
    });
  }
  for (let i = 0; i < points.length - 1; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    indices.push(a, c, b, b, c, d);
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
  readonly ocean: WaterMesh;
  private readonly riverMesh: THREE.Mesh | null;
  private readonly oceanNormal: THREE.Texture;
  private readonly riverNormal: THREE.Texture;
  private elapsed = 0;

  constructor(private readonly world: WorldData, quality: "high" | "balanced" | "compatibility", sunDirection: THREE.Vector3) {
    this.group.name = "navora-unified-water";
    this.riverGroup.name = "navora-river-surfaces";
    this.oceanNormal = makeNormalTexture(quality === "high" ? 1024 : quality === "balanced" ? 768 : 512, 0.37);
    this.riverNormal = makeNormalTexture(quality === "high" ? 1024 : 512, 2.11);
    const extent = quality === "compatibility" ? 30000 : quality === "balanced" ? 48000 : 70000;
    const segments = quality === "compatibility" ? 64 : quality === "balanced" ? 96 : 128;
    const oceanGeometry = new THREE.PlaneGeometry(extent, extent, segments, segments);
    oceanGeometry.rotateX(-Math.PI / 2);
    this.ocean = new WaterMesh(oceanGeometry, {
      waterNormals: this.oceanNormal,
      sunDirection: sunDirection.clone().normalize(),
      sunColor: 0xfff1d2,
      waterColor: 0x06354a,
      distortionScale: quality === "compatibility" ? 2.4 : 3.8,
      size: 0.7,
      alpha: 0.96,
      resolutionScale: quality === "compatibility" ? 0.16 : quality === "balanced" ? 0.24 : 0.34,
    });
    this.ocean.name = "camera-relative-gerstner-ocean";
    // Four low-cost geometry waves provide parallax and real height changes;
    // the HD normal map supplies capillary detail without tessellating it.
    this.ocean.material.positionNode = Fn(() => {
      const p = positionLocal.toVar();
      const wave = sin(p.x.mul(0.185).add(p.z.mul(0.067)).add(time.mul(1.15))).mul(0.52)
        .add(sin(p.x.mul(0.31).add(p.z.mul(0.29)).add(time.mul(0.93))).mul(0.27))
        .add(sin(p.x.mul(-0.13).add(p.z.mul(0.72)).add(time.mul(0.71))).mul(0.14))
        .add(sin(p.x.mul(0.72).add(p.z.mul(-1.31)).add(time.mul(0.54))).mul(0.07));
      return p.add(vec3(0, wave, 0));
    })();
    this.ocean.renderOrder = 1;
    this.group.add(this.ocean);

    const riverGeometries: THREE.BufferGeometry[] = [];
    for (const continent of Object.values(world.continents)) for (const river of continent.rivers) {
      const geometry = buildRiverGeometry(continent, river, world.manifest, this.riverSegments);
      if (geometry) riverGeometries.push(geometry);
    }
    const merged = riverGeometries.length ? mergeGeometries(riverGeometries, false) : null;
    for (const geometry of riverGeometries) geometry.dispose();
    if (merged) {
      const material = new THREE.MeshStandardMaterial({
        color: 0x63b9cf, vertexColors: true, normalMap: this.riverNormal,
        normalScale: new THREE.Vector2(0.48, 0.48), transparent: true, opacity: 0.86,
        roughness: 0.16, metalness: 0.02, side: THREE.DoubleSide, depthWrite: false,
      });
      this.riverNormal.repeat.set(0.7, 1);
      this.riverMesh = new THREE.Mesh(merged, material);
      this.riverMesh.name = "spline-rivers-shared-flow-material";
      this.riverMesh.renderOrder = 2;
      this.riverGroup.add(this.riverMesh);
    } else this.riverMesh = null;
    this.group.add(this.riverGroup);
  }

  update(elapsedSeconds: number, cameraWorldX: number, cameraWorldZ: number): void {
    this.elapsed = elapsedSeconds;
    const snap = 256;
    this.ocean.position.x = Math.round(cameraWorldX / snap) * snap;
    this.ocean.position.z = Math.round(cameraWorldZ / snap) * snap;
    this.riverNormal.offset.set(elapsedSeconds * 0.004, -elapsedSeconds * 0.028);
    this.riverNormal.needsUpdate = true;
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
    const ground = sampleWorldHeight(this.world.worldHeight, worldX, worldZ);
    if (ground > 0.15) return null;
    const wave = sampleOceanWaves(worldX, worldZ, elapsedSeconds);
    return { body: "ocean", bodyId: "luna-sea", ...wave, depth: Math.max(0, wave.surfaceY - ground), velocityX: 0.18, velocityZ: 0.08, navigable: true };
  }

  dispose(): void {
    this.ocean.geometry.dispose(); this.ocean.material.dispose(); this.oceanNormal.dispose(); this.riverNormal.dispose();
    if (this.riverMesh) { this.riverMesh.geometry.dispose(); (this.riverMesh.material as THREE.Material).dispose(); }
    this.group.clear();
  }
}
