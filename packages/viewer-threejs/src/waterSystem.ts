import * as THREE from "three/webgpu";
import { attribute, cameraPosition, color, float, Fn, mix, mx_noise_float, normalWorld, positionLocal, positionWorld, sin, smoothstep, time, vec3 } from "three/tsl";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { sampleWorldHeight } from "./terrain.js";
import { uvToWorld } from "./layout.js";
import type { ContinentData, Manifest, RiverRecord, WorldData } from "./worldData.js";
import { buildRiverCenterline, isOceanReceivingRiver } from "./riverChannelField.js";

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
  /** Maximum recommended hull draft with a two-metre bottom clearance. */
  maxDraftM: number;
  /** True when this sample contains enough submerged volume for fish/NPCs. */
  supportsAquaticLife: boolean;
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
  oceanReceiver: boolean;
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

/** Ship navigability lives on the waterway network and the open sea — both
 * are the global sea-level surface. Scenic rivers are never navigable. */
export const NAVIGABLE_WATER_DEPTH_M = 9;
// Overview fog is fully opaque at 280 km. Keeping every edge of this
// camera-relative plane beyond that distance makes the ocean meet the visual
// horizon in ground, flight, and cartographic modes instead of exposing a
// blue square. The mesh remains camera-centred, so this is coverage rather
// than a second world-sized simulation.
export const OCEAN_RENDER_EXTENT_M = 600_000;
/** Above the complete ocean wave envelope, an elevated reach takes over.
 * Below this elevation the global ocean itself fills the carved estuary. */
export const OCEAN_RIVER_HANDOFF_M = 1.35;

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

function buildLakeGeometry(surface: LakeSurface): THREE.BufferGeometry | null {
  if (surface.polygon.length < 3) return null;
  const contour = surface.polygon.map(([x, z]) => new THREE.Vector2(x, z));
  // Natural lakes are concave. A centroid fan crosses the shoreline whenever
  // the centroid cannot see every edge, producing the sliced wedges reported
  // in review. Ear clipping preserves the exact irregular boundary.
  const triangles = THREE.ShapeUtils.triangulateShape(contour, []);
  const positions: number[] = [];
  for (const [x, z] of surface.polygon) positions.push(x, surface.surfaceY + 0.08, z);
  const indices = triangles.flat();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const vertexCount = positions.length / 3;
  geometry.setAttribute("waterMode", new THREE.Float32BufferAttribute(new Float32Array(vertexCount).fill(1), 1));
  geometry.setAttribute("oceanBlend", new THREE.Float32BufferAttribute(new Float32Array(vertexCount), 1));
  geometry.setAttribute("flowX", new THREE.Float32BufferAttribute(new Float32Array(vertexCount).fill(0.025), 1));
  geometry.setAttribute("flowZ", new THREE.Float32BufferAttribute(new Float32Array(vertexCount).fill(0.01), 1));
  geometry.setAttribute("flowSpeed", new THREE.Float32BufferAttribute(new Float32Array(vertexCount).fill(0.08), 1));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
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
  // This is the same broad vertical swell used by the one-piece rendered
  // ocean, keeping the shoreline contact and hull query in agreement.
  height += Math.sin(elapsedSeconds * 0.92) * 0.22;
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
  const centerline = buildRiverCenterline(
    river, path.map(([u, v]) => uvToWorld(u, v, continent.id, manifest)), progressStart, widthScale,
  );
  const oceanMouth = isOceanReceivingRiver(river);
  for (let i = 0; i < centerline.length - 1; i++) {
    const point = centerline[i], next = centerline[i + 1];
    segments.push({
      riverId: river.id, oceanReceiver: oceanMouth,
      ax: point.x, az: point.z, ay: point.y,
      bx: next.x, bz: next.z, by: next.y,
      widthA: point.width, widthB: next.width,
      depthA: point.depth, depthB: next.depth,
      currentA: point.current, currentB: next.current,
    });
  }
  // Never stack a second surface over sea-level water. The ocean directly
  // fills the carved lower estuary; only genuinely elevated reach points are
  // meshed. This removes z-fighting and makes the mouth literally ocean water.
  const points = oceanMouth ? centerline.filter((point) => point.y > OCEAN_RIVER_HANDOFF_M) : centerline;
  if (points.length < 2) return null;
  const positions: number[] = [], uvs: number[] = [], colors: number[] = [], oceanBlends: number[] = [];
  const waterModes: number[] = [], flowXs: number[] = [], flowZs: number[] = [], flowSpeeds: number[] = [], indices: number[] = [];
  let distanceAlong = 0;
  for (let i = 0; i < points.length; i++) {
    const previous = points[Math.max(0, i - 1)], next = points[Math.min(points.length - 1, i + 1)], point = points[i];
    const [tangentX, tangentZ] = normalizedDirection(next.x - previous.x, next.z - previous.z);
    const sideX = -tangentZ, sideZ = tangentX;
    if (i > 0) distanceAlong += Math.hypot(point.x - points[i - 1].x, point.z - points[i - 1].z);
    // The extra cross-water tessellation costs little compared with terrain
    // streaming and prevents bank silhouettes from resolving as broad facets
    // on high-density displays.
    const crossSegments = 16;
    for (let cross = 0; cross <= crossSegments; cross++) {
      const across = cross / crossSegments * 2 - 1;
      // Width already includes organic reach variation and mouth flare. The
      // terrain brush consumes this exact value, eliminating the old painted
      // apron that extended beyond the carved banks.
      const offset = across * point.width * 0.485;
      positions.push(point.x + sideX * offset, point.y, point.z + sideZ * offset);
      uvs.push(cross / crossSegments, distanceAlong / 28);
      const edge = Math.pow(Math.abs(across), 1.7);
      colors.push(0.48 + edge * 0.28, 0.72 + edge * 0.22, 0.82 + edge * 0.18);
      oceanBlends.push(oceanMouth ? Math.max(0, Math.min(1, (point.progress - 0.68) / 0.24)) : 0);
      waterModes.push(1);
      flowXs.push(tangentX);
      flowZs.push(tangentZ);
      flowSpeeds.push(point.current);
    }
  }
  const rowSize = 17;
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
  geometry.setAttribute("waterMode", new THREE.Float32BufferAttribute(waterModes, 1));
  geometry.setAttribute("flowX", new THREE.Float32BufferAttribute(flowXs, 1));
  geometry.setAttribute("flowZ", new THREE.Float32BufferAttribute(flowZs, 1));
  geometry.setAttribute("flowSpeed", new THREE.Float32BufferAttribute(flowSpeeds, 1));
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
  readonly lakeGroup = new THREE.Group();
  private readonly riverSegments: RiverSegment[] = [];
  private readonly lakeSurfaces: LakeSurface[] = [];
  readonly ocean: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalNodeMaterial>;
  private readonly waterMaterial: THREE.MeshPhysicalNodeMaterial;
  private readonly reachMaterial: THREE.MeshPhysicalNodeMaterial;
  private readonly riverMesh: THREE.Mesh | null;
  private readonly lakeMesh: THREE.Mesh | null;
  private readonly reviewCraft: THREE.Group | null;
  private readonly reviewCraftSegment: RiverSegment | null;
  private elapsed = 0;

  constructor(private readonly world: WorldData, quality: "high" | "balanced" | "compatibility", _sunDirection: THREE.Vector3) {
    this.group.name = "navora-unified-water";
    this.riverGroup.name = "navora-river-surfaces";
    this.lakeGroup.name = "navora-lake-and-wetland-surfaces";
    const viewDirection = cameraPosition.sub(positionWorld).normalize();
    const waterFresnel = normalWorld.dot(viewDirection).abs().oneMinus().pow(3).clamp(0, 1);
    const extent = OCEAN_RENDER_EXTENT_M;
    const segments = quality === "compatibility" ? 256 : quality === "balanced" ? 320 : 384;
    const oceanGeometry = new THREE.PlaneGeometry(extent, extent, segments, segments);
    oceanGeometry.rotateX(-Math.PI / 2);
    const oceanVertexCount = oceanGeometry.getAttribute("position").count;
    oceanGeometry.setAttribute("waterMode", new THREE.Float32BufferAttribute(new Float32Array(oceanVertexCount), 1));
    oceanGeometry.setAttribute("oceanBlend", new THREE.Float32BufferAttribute(new Float32Array(oceanVertexCount).fill(1), 1));
    oceanGeometry.setAttribute("flowX", new THREE.Float32BufferAttribute(new Float32Array(oceanVertexCount), 1));
    oceanGeometry.setAttribute("flowZ", new THREE.Float32BufferAttribute(new Float32Array(oceanVertexCount), 1));
    oceanGeometry.setAttribute("flowSpeed", new THREE.Float32BufferAttribute(new Float32Array(oceanVertexCount), 1));

    // One live material is shared by ocean, rivers and lakes. Geometry-level
    // attributes select ocean swell versus downstream reach motion, allowing
    // elevated river surfaces without creating a second kind of water.
    const waterMaterial = new THREE.MeshPhysicalNodeMaterial();
    const oceanMacro = mx_noise_float(positionWorld.xz.mul(0.00018)).mul(0.5).add(0.5);
    const oceanColor = mix(color(0x052b3d), color(0x0b5368), oceanMacro.mul(0.42));
    const waterMode = smoothstep(0, 1, attribute("waterMode", "float"));
    const mouthBlend = smoothstep(0, 1, attribute("oceanBlend", "float"));
    const movingReach = waterMode.mul(mouthBlend.oneMinus());
    const flowX = attribute("flowX", "float"), flowZ = attribute("flowZ", "float"), flowSpeed = attribute("flowSpeed", "float");
    const flowPhase = positionWorld.x.mul(flowX).add(positionWorld.z.mul(flowZ)).mul(0.032).sub(time.mul(flowSpeed.mul(1.45).add(0.22)));
    const reachMacro = mx_noise_float(positionWorld.xz.mul(0.0034)).mul(0.5).add(0.5);
    const reachPulse = sin(flowPhase).mul(0.5).add(0.5);
    const reachColor = mix(color(0x073646), color(0x17677a), reachMacro.mul(0.25).add(reachPulse.mul(0.07)));
    waterMaterial.colorNode = mix(mix(oceanColor, reachColor, movingReach), color(0x7894a5), waterFresnel.mul(0.5));
    waterMaterial.roughnessNode = mix(float(quality === "compatibility" ? 0.30 : 0.20), float(0.15), movingReach);
    waterMaterial.metalnessNode = float(0.02);
    waterMaterial.positionNode = Fn(() => {
      const point = positionLocal.toVar();
      const oceanSwell = sin(time.mul(0.92)).mul(0.22);
      const reachRipple = sin(flowPhase).mul(0.075).add(sin(flowPhase.mul(0.53).add(positionWorld.x.mul(0.009))).mul(0.035));
      return point.add(vec3(0, mix(oceanSwell, reachRipple, movingReach), 0));
    })();
    // River mouths overlap the receiving ocean by design. Alpha-sorting two
    // moving transparent surfaces exposes triangle order as dark shards, so
    // the shared deep-water surface is depth-stable and opaque. Shallows are
    // communicated by the carved bed/material boundary rather than a second
    // composited sheet.
    waterMaterial.transparent = false;
    waterMaterial.opacity = 1;
    waterMaterial.depthWrite = true;
    waterMaterial.side = THREE.DoubleSide;
    waterMaterial.ior = 1.333;
    waterMaterial.transmission = 0;
    waterMaterial.thickness = 0;
    waterMaterial.clearcoat = 0.72;
    waterMaterial.clearcoatRoughness = 0.12;
    this.waterMaterial = waterMaterial;
    // Same node graph and optical constants, separate raster state: reaches
    // are drawn after the global ocean and receive a small depth bias where
    // their transition patch becomes coplanar at sea level.
    const reachMaterial = waterMaterial.clone();
    reachMaterial.polygonOffset = true;
    reachMaterial.polygonOffsetFactor = -2;
    reachMaterial.polygonOffsetUnits = -2;
    this.reachMaterial = reachMaterial;
    this.ocean = new THREE.Mesh(oceanGeometry, waterMaterial);
    this.ocean.name = "camera-relative-gerstner-ocean";
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
      this.riverMesh = new THREE.Mesh(merged, reachMaterial);
      this.riverMesh.name = "carved-river-reaches-shared-water-material";
      this.riverMesh.renderOrder = 2;
      this.riverGroup.add(this.riverMesh);
    } else this.riverMesh = null;

    const lakeGeometries = this.lakeSurfaces.map(buildLakeGeometry).filter((geometry): geometry is THREE.BufferGeometry => geometry !== null);
    const mergedLakes = lakeGeometries.length ? mergeGeometries(lakeGeometries, false) : null;
    for (const geometry of lakeGeometries) geometry.dispose();
    if (mergedLakes) {
      this.lakeMesh = new THREE.Mesh(mergedLakes, reachMaterial);
      this.lakeMesh.name = "carved-lakes-shared-water-material";
      this.lakeMesh.renderOrder = 2;
      this.lakeGroup.add(this.lakeMesh);
    } else this.lakeMesh = null;
    this.group.add(this.lakeGroup);
    // The review barge floats on the navigable waterway network — flat
    // sea-level ship water — rather than on a scenic river.
    let craftSegment: RiverSegment | null = null;
    for (const continent of Object.values(world.continents)) {
      const waterway = (continent.waterways ?? [])[0];
      if (!waterway || waterway.path.length < 2) continue;
      const mid = Math.floor(waterway.path.length / 2);
      const [ax, az] = uvToWorld(waterway.path[mid - 1][0], waterway.path[mid - 1][1], continent.id, world.manifest);
      const [bx, bz] = uvToWorld(waterway.path[mid][0], waterway.path[mid][1], continent.id, world.manifest);
      craftSegment = {
        riverId: waterway.id, oceanReceiver: true,
        ax, az, ay: 0, bx, bz, by: 0,
        widthA: waterway.surfaceWidthM, widthB: waterway.surfaceWidthM,
        depthA: waterway.bedDepthM, depthB: waterway.bedDepthM,
        currentA: 0.5, currentB: 0.5,
      };
      break;
    }
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
      const authoredSurfaceY = segment.ay + (segment.by - segment.ay) * nearest.t;
      const oceanHandoff = segment.oceanReceiver && authoredSurfaceY <= OCEAN_RIVER_HANDOFF_M;
      const wave = oceanHandoff ? sampleOceanWaves(worldX, worldZ, elapsedSeconds) : null;
      const surfaceY = wave?.surfaceY ?? authoredSurfaceY + Math.sin(elapsedSeconds * 2.1 + worldX * 0.19 + worldZ * 0.13) * 0.035;
      const width = segment.widthA + (segment.widthB - segment.widthA) * nearest.t;
      const [dx, dz] = normalizedDirection(segment.bx - segment.ax, segment.bz - segment.az);
      const current = segment.currentA + (segment.currentB - segment.currentA) * nearest.t;
      const depth = segment.depthA + (segment.depthB - segment.depthA) * nearest.t;
      return {
        body: "river", bodyId: segment.riverId, surfaceY, depth,
        normalX: wave?.normalX ?? 0, normalY: wave?.normalY ?? 1, normalZ: wave?.normalZ ?? 0,
        velocityX: dx * current + (oceanHandoff ? 0.18 : 0), velocityZ: dz * current + (oceanHandoff ? 0.08 : 0),
        // Scenic rivers never carry ships; a reach that has handed off to
        // the ocean is ocean water and follows the ocean rule instead.
        navigable: oceanHandoff && depth >= NAVIGABLE_WATER_DEPTH_M,
        maxDraftM: Math.max(0, depth - 2), supportsAquaticLife: depth >= 2.5,
      };
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
        const depth = Math.max(0, surfaceY - ground);
        return {
          body: "lake", bodyId: lake.id, surfaceY, depth,
          normalX: 0, normalY: 1, normalZ: 0, velocityX: 0.025, velocityZ: 0.01,
          navigable: depth >= NAVIGABLE_WATER_DEPTH_M,
          maxDraftM: Math.max(0, depth - 2), supportsAquaticLife: depth >= 2.5,
        };
      }
    }
    const ground = sampleWorldHeight(this.world.worldHeight, worldX, worldZ);
    if (ground > 0.15) return null;
    const wave = sampleOceanWaves(worldX, worldZ, elapsedSeconds);
    const depth = Math.max(0, wave.surfaceY - ground);
    return {
      body: "ocean", bodyId: "luna-sea", ...wave, depth,
      velocityX: 0.18, velocityZ: 0.08,
      navigable: depth >= NAVIGABLE_WATER_DEPTH_M,
      maxDraftM: Math.max(0, depth - 2), supportsAquaticLife: depth >= 2.5,
    };
  }

  dispose(): void {
    this.ocean.geometry.dispose();
    if (this.riverMesh) this.riverMesh.geometry.dispose();
    if (this.lakeMesh) this.lakeMesh.geometry.dispose();
    this.waterMaterial.dispose();
    this.reachMaterial.dispose();
    this.reviewCraft?.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.geometry.dispose();
      if (Array.isArray(child.material)) child.material.forEach((material) => material.dispose());
      else child.material.dispose();
    });
    this.group.clear();
  }
}
