import * as THREE from "three/webgpu";
import { attribute, cameraPosition, color, float, Fn, mix, mx_noise_float, normalMap, normalWorld, positionLocal, positionWorld, sin, smoothstep, texture, time, vec2, vec3 } from "three/tsl";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { sampleWorldHeight } from "./terrain.js";
import { uvToWorld } from "./layout.js";
import type { ContinentData, Manifest, RiverRecord, WorldData } from "./worldData.js";
import { buildRiverCenterline } from "./riverChannelField.js";

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
  depthA: number; depthB: number;
  currentA: number; currentB: number;
}

interface LakeSurface {
  id: string;
  polygon: [number, number][];
  surfaceY: number;
  depthM: number;
}

export const NAVIGABLE_RIVER_WIDTH_M = 30;
// Overview fog is fully opaque at 280 km. Keeping every edge of this
// camera-relative plane beyond that distance makes the ocean meet the visual
// horizon in ground, flight, and cartographic modes instead of exposing a
// blue square. The mesh remains camera-centred, so this is coverage rather
// than a second world-sized simulation.
export const OCEAN_RENDER_EXTENT_M = 600_000;

// A compact, deterministic deep-water spectrum. Rendering and gameplay use
// the same coefficients so a hull pontoon, swimmer, fish, and visible crest
// never disagree about where the surface is.
export const NAVORA_OCEAN_WAVES: readonly GerstnerWave[] = [
  { directionX: 0.94, directionZ: 0.34, amplitude: 0.52, wavelength: 34, speed: 1.15, steepness: 0.48 },
  { directionX: 0.72, directionZ: 0.69, amplitude: 0.27, wavelength: 17, speed: 0.93, steepness: 0.36 },
  { directionX: -0.18, directionZ: 0.98, amplitude: 0.14, wavelength: 8.5, speed: 0.71, steepness: 0.25 },
  { directionX: 0.48, directionZ: -0.88, amplitude: 0.07, wavelength: 4.2, speed: 0.54, steepness: 0.16 },
];

function createWaterNormalTexture(): THREE.DataTexture {
  const size = 256;
  const data = new Uint8Array(size * size * 4);
  let randomState = 0x48291;
  const random = () => {
    randomState = Math.imul(randomState ^ (randomState >>> 15), 1 | randomState);
    randomState ^= randomState + Math.imul(randomState ^ (randomState >>> 7), 61 | randomState);
    return ((randomState ^ (randomState >>> 14)) >>> 0) / 4294967296;
  };
  const waves = Array.from({ length: 28 }, () => {
    let kx = Math.round(random() * 28 - 14), kz = Math.round(random() * 28 - 14);
    if (kx === 0 && kz === 0) kx = 1;
    const frequency = Math.hypot(kx, kz);
    return [kx, kz, 0.17 / Math.max(1, frequency), random() * Math.PI * 2] as const;
  });
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    let dx = 0, dz = 0;
    for (const [kx, kz, amplitude, phaseOffset] of waves) {
      const phase = Math.PI * 2 * (kx * u + kz * v) + phaseOffset;
      dx += Math.cos(phase) * amplitude * kx;
      dz += Math.cos(phase) * amplitude * kz;
    }
    const length = Math.hypot(dx * 0.24, 1, dz * 0.24);
    const offset = (y * size + x) * 4;
    data[offset] = Math.round(((-dx * 0.24 / length) * 0.5 + 0.5) * 255);
    data[offset + 1] = Math.round(((-dz * 0.24 / length) * 0.5 + 0.5) * 255);
    data[offset + 2] = Math.round(((1 / length) * 0.5 + 0.5) * 255);
    data[offset + 3] = 255;
  }
  const map = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.magFilter = THREE.LinearFilter;
  map.colorSpace = THREE.NoColorSpace;
  map.generateMipmaps = true;
  map.needsUpdate = true;
  return map;
}

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
  const points = buildRiverCenterline(
    river, path.map(([u, v]) => uvToWorld(u, v, continent.id, manifest)), progressStart, widthScale,
  );
  const positions: number[] = [], uvs: number[] = [], colors: number[] = [], oceanBlends: number[] = [], indices: number[] = [];
  let distanceAlong = 0;
  for (let i = 0; i < points.length; i++) {
    const previous = points[Math.max(0, i - 1)], next = points[Math.min(points.length - 1, i + 1)], point = points[i];
    const [tangentX, tangentZ] = normalizedDirection(next.x - previous.x, next.z - previous.z);
    const sideX = -tangentZ, sideZ = tangentX;
    if (i > 0) distanceAlong += Math.hypot(point.x - points[i - 1].x, point.z - points[i - 1].z);
    const crossSegments = 8;
    for (let cross = 0; cross <= crossSegments; cross++) {
      const across = cross / crossSegments * 2 - 1;
      // Leave a real exposed bank inside the authored channel width. This also
      // keeps the water surface safely within the min-blended terrain brush
      // when smoothing shifts the visual centerline by a few metres.
      // Cover nearly the full carved bed. The final four percent on each side
      // stays exposed as a wet bank, without revealing low-resolution terrain
      // triangles through the water at tight estuary bends.
      const offset = across * point.width * 0.48;
      positions.push(point.x + sideX * offset, point.y, point.z + sideZ * offset);
      uvs.push(cross / crossSegments, distanceAlong / 28);
      const edge = Math.pow(Math.abs(across), 1.7);
      colors.push(0.48 + edge * 0.28, 0.72 + edge * 0.22, 0.82 + edge * 0.18);
      const oceanMouth = river.terminatesIn?.type === "ocean" || river.mouthKind === "estuary" || river.mouthKind === "delta";
      oceanBlends.push(oceanMouth ? Math.max(0, Math.min(1, (point.progress - 0.82) / 0.18)) : 0);
    }
    if (i < points.length - 1) segments.push({
      riverId: river.id, ax: point.x, az: point.z, ay: point.y,
      bx: next.x, bz: next.z, by: next.y,
      widthA: point.width, widthB: next.width,
      depthA: point.depth, depthB: next.depth,
      currentA: point.current, currentB: next.current,
    });
  }
  const rowSize = 9;
  for (let i = 0; i < points.length - 1; i++) {
    for (let cross = 0; cross < rowSize - 1; cross++) {
      const a = i * rowSize + cross, b = a + 1, c = a + rowSize, d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute("oceanBlend", new THREE.Float32BufferAttribute(oceanBlends, 1));
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
  readonly ocean: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalNodeMaterial>;
  private readonly riverMesh: THREE.Mesh | null;
  private readonly reviewCraft: THREE.Group | null;
  private readonly reviewCraftSegment: RiverSegment | null;
  private readonly waterNormalTexture: THREE.DataTexture;
  private elapsed = 0;

  constructor(private readonly world: WorldData, quality: "high" | "balanced" | "compatibility", _sunDirection: THREE.Vector3) {
    this.group.name = "navora-unified-water";
    this.riverGroup.name = "navora-river-surfaces";
    this.waterNormalTexture = createWaterNormalTexture();
    const waterViewDistance = cameraPosition.sub(positionWorld).length();
    // Short normals are boat/walking detail only. At flight distance they
    // become sub-pixel and must disappear before mip aliasing can turn the
    // periodic normal field into a visible dot grid.
    const nearNormalStrength = smoothstep(80, 430, waterViewDistance).oneMinus().mul(0.46);
    const waterNormalA = texture(this.waterNormalTexture, positionWorld.xz.mul(1 / 420).add(vec2(time.mul(0.0014), time.mul(-0.0009))));
    const waterNormalB = texture(this.waterNormalTexture, positionWorld.zx.mul(vec2(-1 / 267, 1 / 267)).add(vec2(time.mul(-0.0011), time.mul(0.0017))));
    const waterNormal = normalMap(mix(waterNormalA.rgb, waterNormalB.rgb, float(0.46)), vec2(nearNormalStrength));
    const viewDirection = cameraPosition.sub(positionWorld).normalize();
    const waterFresnel = normalWorld.dot(viewDirection).abs().oneMinus().pow(3).clamp(0, 1);
    const extent = OCEAN_RENDER_EXTENT_M;
    const segments = quality === "compatibility" ? 256 : quality === "balanced" ? 320 : 384;
    const oceanGeometry = new THREE.PlaneGeometry(extent, extent, segments, segments);
    oceanGeometry.rotateX(-Math.PI / 2);
    const oceanMaterial = new THREE.MeshPhysicalNodeMaterial();
    const oceanMacro = mx_noise_float(positionWorld.xz.mul(0.00018)).mul(0.5).add(0.5);
    const oceanBaseColor = mix(color(0x052b3d), color(0x0b5368), oceanMacro.mul(0.42));
    oceanMaterial.colorNode = mix(oceanBaseColor, color(0x7894a5), waterFresnel.mul(0.52));
    oceanMaterial.normalNode = waterNormal;
    // Do not world-tile the short-wave normal map across this overview mesh:
    // even with mipmaps, kilometre-scale camera views turn it into moire.
    // Geometry swells carry the horizon. A future near-water clipmap can add
    // short normals only inside a distance where they remain sampleable.
    oceanMaterial.roughnessNode = float(quality === "compatibility" ? 0.30 : 0.20);
    oceanMaterial.metalnessNode = float(0.02);
    oceanMaterial.transparent = true;
    oceanMaterial.opacity = 0.92;
    oceanMaterial.depthWrite = true;
    oceanMaterial.ior = 1.333;
    oceanMaterial.transmission = 0.1;
    oceanMaterial.thickness = 2.5;
    oceanMaterial.clearcoat = 0.8;
    oceanMaterial.clearcoatRoughness = 0.16;
    this.ocean = new THREE.Mesh(oceanGeometry, oceanMaterial);
    this.ocean.name = "camera-relative-gerstner-ocean";
    // The horizon plane is deliberately enormous. Its grid carries only
    // wavelengths that remain safely resolvable at this spacing; short
    // gameplay waves remain in sampleOceanWaves and future near-water detail.
    oceanMaterial.positionNode = Fn(() => {
      const p = positionLocal.toVar();
      const wave = sin(p.x.mul(0.00052).add(p.z.mul(0.00019)).add(time.mul(0.31))).mul(0.48)
        .add(sin(p.x.mul(-0.00028).add(p.z.mul(0.00043)).add(time.mul(0.43))).mul(0.22));
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
      const material = new THREE.MeshPhysicalNodeMaterial();
      const riverMacro = mx_noise_float(positionWorld.xz.mul(0.0042)).mul(0.5).add(0.5);
      const riverFlow = sin(positionWorld.x.mul(0.028).add(positionWorld.z.mul(0.017)).sub(time.mul(1.7))).mul(0.5).add(0.5);
      const riverColor = mix(color(0x063848), color(0x2d8190), riverMacro.mul(0.34).add(riverFlow.mul(0.1)));
      const oceanColor = mix(color(0x052b3d), color(0x0b5368), riverMacro.mul(0.42));
      const mouthBlend = smoothstep(0, 1, attribute("oceanBlend", "float"));
      const waterBodyColor = mix(riverColor, oceanColor, mouthBlend);
      material.colorNode = mix(waterBodyColor, color(0x7894a5), waterFresnel.mul(0.46));
      material.normalNode = waterNormal;
      material.roughnessNode = mix(float(0.13), float(quality === "compatibility" ? 0.30 : 0.20), mouthBlend);
      material.metalnessNode = float(0.02);
      material.positionNode = Fn(() => {
        const point = positionLocal.toVar();
        const ripple = sin(point.x.mul(0.035).add(point.z.mul(0.021)).sub(time.mul(1.8))).mul(0.055)
          .add(sin(point.x.mul(-0.019).add(point.z.mul(0.044)).sub(time.mul(1.15))).mul(0.03));
        return point.add(vec3(0, ripple, 0));
      })();
      // Deep rivers are optically opaque at an aerial viewing angle. Writing
      // depth prevents the global ocean surface underneath the carved mouth
      // from compositing through the river as black/blue triangular bands.
      material.transparent = false;
      material.opacity = 1;
      material.depthWrite = true;
      material.side = THREE.DoubleSide;
      material.ior = 1.333;
      material.transmission = 0;
      material.thickness = 0;
      material.clearcoat = 0.72;
      material.clearcoatRoughness = 0.12;
      this.riverMesh = new THREE.Mesh(merged, material);
      this.riverMesh.name = "spline-rivers-shared-flow-material";
      this.riverMesh.renderOrder = 2;
      this.riverGroup.add(this.riverMesh);
    } else this.riverMesh = null;
    const craftSegment = [...this.riverSegments].reverse().find((segment) =>
      segment.riverId === "valora-river-0" && segment.ay > 2.5 && segment.widthA >= 180,
    ) ?? null;
    this.reviewCraftSegment = craftSegment;
    this.reviewCraft = craftSegment ? this.buildReviewBarge(craftSegment) : null;
    if (this.reviewCraft) this.riverGroup.add(this.reviewCraft);
    this.group.add(this.riverGroup);
  }

  private buildReviewBarge(segment: RiverSegment): THREE.Group {
    const craft = new THREE.Group();
    craft.name = "river-buoyancy-review-barge";
    const timber = new THREE.MeshStandardMaterial({ color: 0x7d4c27, roughness: 0.72 });
    const darkTimber = new THREE.MeshStandardMaterial({ color: 0x30251f, roughness: 0.68 });
    const canvas = new THREE.MeshStandardMaterial({ color: 0xe5d5ad, roughness: 0.82, side: THREE.DoubleSide });
    for (const x of [-4.4, 4.4]) {
      const hull = new THREE.Mesh(new THREE.BoxGeometry(3.8, 2.4, 25), darkTimber);
      hull.position.set(x, -0.5, 0); craft.add(hull);
    }
    const deck = new THREE.Mesh(new THREE.BoxGeometry(12.5, 0.8, 23), timber);
    deck.position.y = 1; craft.add(deck);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(7, 3.8, 6), timber);
    cabin.position.set(0, 3.2, 4.5); craft.add(cabin);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 13, 10), darkTimber);
    mast.position.set(0, 7.7, -3); craft.add(mast);
    const sail = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), canvas);
    sail.position.set(0, 9, -2.75); sail.rotation.y = Math.PI / 2; craft.add(sail);
    craft.position.set((segment.ax + segment.bx) * 0.5, (segment.ay + segment.by) * 0.5 + 1.5, (segment.az + segment.bz) * 0.5);
    craft.rotation.y = Math.atan2(segment.bx - segment.ax, segment.bz - segment.az);
    craft.traverse((child) => { if (child instanceof THREE.Mesh) { child.castShadow = true; child.receiveShadow = true; } });
    return craft;
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
    }
    if (this.reviewCraft && this.reviewCraftSegment) {
      const segment = this.reviewCraftSegment;
      const surface = (segment.ay + segment.by) * 0.5;
      this.reviewCraft.position.y = surface + 1.5 + Math.sin(elapsedSeconds * 0.82) * 0.18;
      this.reviewCraft.rotation.z = Math.sin(elapsedSeconds * 0.57) * 0.018;
      this.reviewCraft.rotation.x = Math.sin(elapsedSeconds * 0.73 + 1.2) * 0.012;
      this.reviewCraft.visible = cameraWorldY < 3500;
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
      const depth = segment.depthA + (segment.depthB - segment.depthA) * nearest.t;
      return { body: "river", bodyId: segment.riverId, surfaceY, depth, normalX: 0, normalY: 1, normalZ: 0, velocityX: dx * current, velocityZ: dz * current, navigable: width >= NAVIGABLE_RIVER_WIDTH_M };
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
    this.waterNormalTexture.dispose();
    if (this.riverMesh) { this.riverMesh.geometry.dispose(); (this.riverMesh.material as THREE.Material).dispose(); }
    this.reviewCraft?.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.geometry.dispose();
      if (Array.isArray(child.material)) child.material.forEach((material) => material.dispose());
      else child.material.dispose();
    });
    this.group.clear();
  }
}
