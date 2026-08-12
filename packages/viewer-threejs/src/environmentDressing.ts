import * as THREE from "three/webgpu";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { float, instanceIndex, positionLocal, sin, smoothstep, time, vec3 } from "three/tsl";
import type { WorldData, ZoneRecord } from "./worldData.js";
import type { TerrainQuality } from "./terrainMaterial.js";
import { continentOriginX, continentOriginZ } from "./layout.js";

export interface DressingStats {
  cells: number;
  instances: number;
  grass: number;
  flowers: number;
  bushes: number;
  reeds: number;
  rocks: number;
  debris: number;
  queued: number;
  lastStreamMs: number;
  maxStreamMs: number;
}

type DressingKind = "grass" | "flowers" | "bushes" | "reeds" | "rocks" | "debris";

interface DressingProfile {
  lushness: number;
  flowers: number;
  scrub: number;
  reeds: number;
  rocks: number;
}

interface InstanceRecord {
  x: number; y: number; z: number; rotation: number; scale: number; tint: number;
  variant: number; zoneId: string; normalX: number; normalY: number; normalZ: number;
  sectorX: number; sectorZ: number;
}

interface DressingCell {
  x: number;
  z: number;
  group: THREE.Group;
  instances: number;
  lastUse: number;
}

interface BatchState {
  key: string;
  kind: DressingKind;
  variant: number;
  tier: "hero" | "distant";
  mesh: THREE.InstancedMesh;
  owners: string[];
  records: InstanceRecord[];
  capacity: number;
}

type ExclusionShape =
  | { type: "circle"; x: number; z: number; radius: number }
  | { type: "segment"; ax: number; az: number; bx: number; bz: number; radius: number };

const KIND_ORDER: DressingKind[] = ["grass", "flowers", "bushes", "reeds", "rocks", "debris"];

const PROFILES: Record<string, DressingProfile> = {
  alvora: { lushness: 1.1, flowers: 1.15, scrub: 0.65, reeds: 1.0, rocks: 0.45 },
  valedouro: { lushness: 1.18, flowers: 0.8, scrub: 0.75, reeds: 1.05, rocks: 0.55 },
  serravela: { lushness: 0.58, flowers: 0.35, scrub: 0.9, reeds: 0.2, rocks: 1.55 },
  cavora: { lushness: 0.72, flowers: 0.45, scrub: 1.35, reeds: 0.55, rocks: 1.25 },
  solmara: { lushness: 1.12, flowers: 0.75, scrub: 0.8, reeds: 1.6, rocks: 0.35 },
};

const DEFAULT_PROFILE: DressingProfile = { lushness: 0.9, flowers: 0.55, scrub: 0.9, reeds: 0.65, rocks: 0.8 };

const ROCK_PALETTES: Record<string, [number, number, number]> = {
  alvora: [0x77766e, 0x898477, 0x5f675d],
  valedouro: [0x4d5750, 0x60685e, 0x39443e],
  serravela: [0x717a80, 0x8b8e8a, 0x555e64],
  cavora: [0x806f59, 0x69635a, 0x957e5f],
  solmara: [0x485553, 0x59645e, 0x394844],
};

const GRASS_PALETTES: Record<string, [number, number]> = {
  alvora: [0x377a32, 0x67a747],
  valedouro: [0x2d6e35, 0x55944b],
  serravela: [0x4f6c3e, 0x728251],
  cavora: [0x62713a, 0x8a8d4a],
  solmara: [0x2d7443, 0x4d9a59],
};

const ASSET_BINDINGS: Record<DressingKind, { id: string; targetSize: number; sizeByHeight?: boolean; foliage?: boolean }> = {
  // Dense meadow coverage uses the deliberately authored blade clump below.
  // The 2K scan remains in the licensed source pack as a visual reference,
  // but instancing its multi-thousand-triangle clump hundreds of times caused
  // avoidable overdraw and a double-digit frame-rate regression.
  grass: { id: "", targetSize: 1.05, sizeByHeight: true, foliage: true },
  flowers: { id: "celandine_01", targetSize: 0.7, sizeByHeight: true, foliage: true },
  bushes: { id: "shrub_03", targetSize: 1.55, sizeByHeight: true, foliage: true },
  reeds: { id: "", targetSize: 1.75, sizeByHeight: true, foliage: true },
  rocks: { id: "rock_07", targetSize: 1.4 },
  debris: { id: "dead_tree_trunk", targetSize: 3.2 },
};

const FOLIAGE_FAMILY_BINDINGS = [
  { id: "fern_02", targetSize: 1.15, zones: new Set(["valedouro", "solmara"]) },
] as const;

// Photogrammetry-grade assets are reserved for the immediate play space. The
// same deterministic records use light silhouettes farther out, where terrain
// detail and atmospheric perspective do the perceptual work. This avoids the
// multi-million-triangle "same scan everywhere" failure mode.
const HERO_RADIUS: Record<DressingKind, number> = {
  grass: 58,
  flowers: 96,
  bushes: 138,
  reeds: 92,
  rocks: 105,
  debris: 175,
};

function hash32(x: number, z: number, seed: number, salt: number): number {
  let h = Math.imul(x ^ salt, 0x1f123bb5) ^ Math.imul(z + salt, 0x5f356495) ^ Math.imul(seed, 0x6c8e9cf5);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return (h ^ (h >>> 16)) >>> 0;
}

function random01(x: number, z: number, seed: number, salt: number): number {
  return hash32(x, z, seed, salt) / 0xffffffff;
}

function pointInPolygon(u: number, v: number, polygon: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i], [xj, yj] = polygon[j];
    if ((yi > v) !== (yj > v) && u < (xj - xi) * (v - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function distanceToSegmentSquared(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az;
  const lengthSq = dx * dx + dz * dz;
  const t = lengthSq ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lengthSq)) : 0;
  const x = ax + dx * t, z = az + dz * t;
  return (px - x) ** 2 + (pz - z) ** 2;
}

function crossedPlanes(width: number, height: number): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const p = new Float32Array([
    -width / 2, 0, 0, width / 2, 0, 0, width / 2, height, 0, -width / 2, height, 0,
    0, 0, -width / 2, 0, 0, width / 2, 0, height, width / 2, 0, height, -width / 2,
  ]);
  geometry.setAttribute("position", new THREE.BufferAttribute(p, 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  geometry.computeVertexNormals();
  return geometry;
}

function grassClump(blades = 7, spread = 0.22): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i < blades; i++) {
    const angle = i * 2.39996;
    const offset = 0.06 + (i % 5) / 4 * spread;
    const cx = Math.cos(angle) * offset, cz = Math.sin(angle) * offset;
    const width = 0.026 + (i % 3) * 0.009;
    const height = 0.62 + (i % 4) * 0.12;
    const dx = Math.cos(angle) * width, dz = Math.sin(angle) * width;
    const leanX = Math.cos(angle + 0.7) * height * 0.16;
    const leanZ = Math.sin(angle + 0.7) * height * 0.16;
    const base = positions.length / 3;
    positions.push(
      cx - dz, 0, cz + dx,
      cx + dz, 0, cz - dx,
      cx + leanX + dz * 0.18, height, cz + leanZ - dx * 0.18,
      cx + leanX - dz * 0.18, height, cz + leanZ + dx * 0.18,
    );
    uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function grassMaterial(colorValue: number): THREE.MeshStandardNodeMaterial {
  const material = new THREE.MeshStandardNodeMaterial({
    color: colorValue, roughness: 1, metalness: 0, side: THREE.DoubleSide, vertexColors: true,
  });
  const phase = time.mul(1.45).add(float(instanceIndex).mul(2.399963));
  const tipWeight = smoothstep(0.08, 0.9, positionLocal.y);
  const gust = sin(time.mul(0.29).add(float(instanceIndex).mul(0.173))).mul(0.035);
  const swayX = sin(phase.add(positionLocal.x.mul(2.7))).mul(0.075).add(gust).mul(tipWeight);
  const swayZ = sin(phase.mul(0.73).add(positionLocal.z.mul(3.1))).mul(0.055).mul(tipWeight);
  material.positionNode = positionLocal.add(vec3(swayX, 0, swayZ));
  return material;
}

function rockVariants(source: THREE.BufferGeometry): THREE.BufferGeometry[] {
  const profiles = [
    [1.12, 0.74, 0.96, 0.08],
    [1.48, 0.48, 0.84, 0.16],
    [0.82, 1.28, 0.92, 0.11],
    [1.18, 0.82, 1.42, 0.2],
  ] as const;
  return profiles.map(([sx, sy, sz, warp], variant) => {
    const geometry = source.clone();
    const position = geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
      const irregular = 1 + Math.sin(x * 3.7 + z * 2.9 + variant * 1.8) * warp
        + Math.sin(y * 5.3 - x * 1.7 + variant) * warp * 0.45;
      position.setXYZ(i, x * sx * irregular, y * sy * (0.94 + irregular * 0.06), z * sz * irregular);
    }
    position.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    const center = box.getCenter(new THREE.Vector3());
    geometry.translate(-center.x, -box.min.y, -center.z);
    geometry.computeBoundingSphere();
    return geometry;
  });
}

function createMaterials(): Record<DressingKind, THREE.Material> {
  return {
    grass: grassMaterial(0x4f8e3b),
    flowers: new THREE.MeshStandardMaterial({ color: 0xe6c768, emissive: 0x251c08, emissiveIntensity: 0.12, roughness: 0.9, side: THREE.DoubleSide, vertexColors: true }),
    bushes: new THREE.MeshStandardMaterial({ color: 0x315f2e, roughness: 1, flatShading: true, vertexColors: true }),
    reeds: new THREE.MeshStandardMaterial({ color: 0x6d873c, roughness: 0.95, side: THREE.DoubleSide, vertexColors: true }),
    rocks: new THREE.MeshStandardMaterial({ color: 0x777971, roughness: 1, metalness: 0, flatShading: true, vertexColors: true }),
    debris: new THREE.MeshStandardMaterial({ color: 0x73523a, roughness: 1, flatShading: true, vertexColors: true }),
  };
}

function createGeometries(): Record<DressingKind, THREE.BufferGeometry> {
  const rock = new THREE.DodecahedronGeometry(1, 0);
  rock.scale(1.25, 0.7, 1);
  rock.translate(0, 0.65, 0);
  const bush = new THREE.IcosahedronGeometry(1, 1);
  bush.scale(1.15, 0.8, 1);
  bush.translate(0, 0.75, 0);
  const debris = new THREE.CylinderGeometry(0.18, 0.28, 2.8, 7);
  debris.rotateZ(Math.PI / 2);
  debris.translate(0, 0.24, 0);
  return {
    grass: grassClump(),
    flowers: crossedPlanes(0.45, 0.72),
    bushes: bush,
    reeds: crossedPlanes(0.55, 1.9),
    rocks: rock,
    debris,
  };
}

/**
 * Deterministic, camera-streamed presentation dressing. These records are
 * explicitly non-interactive and keep generous exclusions for later trees,
 * harvestable plants, mining nodes, roads, and settlements.
 */
export class EnvironmentDressing {
  readonly group = new THREE.Group();
  private readonly cells = new Map<string, DressingCell>();
  private readonly cellRecords = new Map<string, Record<DressingKind, InstanceRecord[]>>();
  private readonly desiredCells = new Set<string>();
  private readonly pendingCells: Array<{ key: string; x: number; z: number; distance: number }> = [];
  private readonly batches = new Map<string, BatchState>();
  private readonly dirtyBatches = new Set<string>();
  private readonly exclusions = new Map<string, ExclusionShape[]>();
  private readonly fallbackGeometries = createGeometries();
  private readonly fallbackMaterials = createMaterials();
  private readonly heroGeometries: Partial<Record<DressingKind, THREE.BufferGeometry>> = {};
  private readonly heroMaterials: Partial<Record<DressingKind, THREE.Material>> = {};
  private readonly foliageFamilies: Array<{ id: string; zones: Set<string>; geometry: THREE.BufferGeometry; material: THREE.Material }> = [];
  private readonly fallbackRockVariants: THREE.BufferGeometry[];
  private heroRockVariants: THREE.BufferGeometry[] = [];
  private readonly dummy = new THREE.Object3D();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly normal = new THREE.Vector3();
  private readonly twist = new THREE.Quaternion();
  private readonly tintColor = new THREE.Color();
  private enabled = true;
  private lastCenterX = Number.NaN;
  private lastCenterZ = Number.NaN;
  private tick = 0;
  private totalInstances = 0;
  private counts: Record<DressingKind, number> = { grass: 0, flowers: 0, bushes: 0, reeds: 0, rocks: 0, debris: 0 };
  private readonly cellSize: number;
  private readonly radius: number;
  private readonly maxCells: number;
  private readonly density: number;
  private lastStreamMs = 0;
  private maxStreamMs = 0;
  private assetsReady = false;

  static async create(
    world: WorldData,
    sampleGround: (x: number, z: number) => number,
    quality: TerrainQuality,
  ): Promise<EnvironmentDressing> {
    const dressing = new EnvironmentDressing(world, sampleGround, quality);
    // Do not make first paint or terrain streaming wait for model parsing.
    // Fallback silhouettes appear immediately and hot-swap to hero assets as
    // each pack becomes ready.
    void dressing.loadProductionAssets().then(() => {
      dressing.assetsReady = true;
      for (const key of dressing.batches.keys()) dressing.dirtyBatches.add(key);
    });
    return dressing;
  }

  constructor(
    private readonly world: WorldData,
    private readonly sampleGround: (x: number, z: number) => number,
    quality: TerrainQuality,
  ) {
    this.group.name = "environmentDressing";
    this.heroGeometries.grass = grassClump(15, 0.52);
    this.heroMaterials.grass = grassMaterial(0x4f8e3b);
    this.fallbackRockVariants = rockVariants(this.fallbackGeometries.rocks);
    this.cellSize = quality === "high" ? 96 : quality === "compatibility" ? 128 : 112;
    this.radius = quality === "high" ? 430 : quality === "compatibility" ? 260 : 350;
    this.maxCells = quality === "high" ? 96 : quality === "compatibility" ? 32 : 64;
    this.density = quality === "high" ? 1.1 : quality === "compatibility" ? 0.42 : 0.72;
    this.indexExclusions();
  }

  update(cameraX: number, cameraZ: number): void {
    if (!this.enabled) return;
    const centerX = Math.floor(cameraX / this.cellSize), centerZ = Math.floor(cameraZ / this.cellSize);
    if (!Number.isFinite(this.lastCenterX)
      || centerX !== Math.floor(this.lastCenterX / this.cellSize)
      || centerZ !== Math.floor(this.lastCenterZ / this.cellSize)) {
      this.lastCenterX = cameraX; this.lastCenterZ = cameraZ; this.tick++;
      this.queueDesiredCells(centerX, centerZ, cameraX, cameraZ);
    }
    const started = performance.now();
    // At most one deterministic cell and one batch are admitted per frame.
    // The first frame is allowed to fill synchronously so tests/first paint
    // have content; later motion never repeats the old whole-bubble rebuild.
    const firstFill = this.cells.size === 0;
    const cellBudget = firstFill ? Math.min(10, this.maxCells) : 1;
    for (let i = 0; i < cellBudget && this.pendingCells.length; i++) this.admitCell(this.pendingCells.shift()!);
    this.rebuildOneDirtyBatch();
    this.lastStreamMs = performance.now() - started;
    if (!firstFill) this.maxStreamMs = Math.max(this.maxStreamMs, this.lastStreamMs);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.group.visible = enabled;
    if (enabled) this.lastCenterX = Number.NaN;
  }

  get isEnabled(): boolean { return this.enabled; }

  get stats(): DressingStats {
    return {
      cells: this.cells.size, instances: this.totalInstances, ...this.counts,
      queued: this.pendingCells.length + this.dirtyBatches.size,
      lastStreamMs: this.lastStreamMs, maxStreamMs: this.maxStreamMs,
    };
  }

  dispose(): void {
    this.group.clear(); this.cells.clear(); this.batches.clear();
    for (const geometry of Object.values(this.fallbackGeometries)) geometry.dispose();
    for (const material of Object.values(this.fallbackMaterials)) material.dispose();
    for (const geometry of Object.values(this.heroGeometries)) geometry?.dispose();
    for (const material of Object.values(this.heroMaterials)) material?.dispose();
    for (const family of this.foliageFamilies) { family.geometry.dispose(); family.material.dispose(); }
    for (const geometry of this.fallbackRockVariants) geometry.dispose();
    for (const geometry of this.heroRockVariants) geometry.dispose();
  }

  private async loadProductionAssets(): Promise<void> {
    const loader = new GLTFLoader();
    const embedded = (globalThis as unknown as { __NAVORA_ENVIRONMENT_ASSETS__?: Record<string, string> }).__NAVORA_ENVIRONMENT_ASSETS__;
    await Promise.all(KIND_ORDER.map(async (kind) => {
      const binding = ASSET_BINDINGS[kind];
      if (!binding.id) return;
      try {
        const gltf = embedded?.[binding.id]
          ? await loader.parseAsync(this.decodeBase64(embedded[binding.id]), "")
          : await loader.loadAsync(new URL(`environment/${binding.id}.glb`, document.baseURI).href);
        gltf.scene.updateMatrixWorld(true);
        let selected: THREE.Mesh | null = null;
        gltf.scene.traverse((object) => {
          if (!(object as THREE.Mesh).isMesh) return;
          const mesh = object as THREE.Mesh;
          if (!selected || (mesh.geometry.getAttribute("position")?.count ?? 0) > (selected.geometry.getAttribute("position")?.count ?? 0)) selected = mesh;
        });
        if (!selected) throw new Error(`No mesh in ${binding.id}`);
        const source = selected as THREE.Mesh;
        const geometry = source.geometry.clone().applyMatrix4(source.matrixWorld);
        geometry.computeBoundingBox();
        const box = geometry.boundingBox!;
        const size = box.getSize(new THREE.Vector3());
        const reference = binding.sizeByHeight ? size.y : Math.max(size.x, size.y, size.z);
        const scale = binding.targetSize / Math.max(0.001, reference);
        geometry.scale(scale, scale, scale);
        geometry.computeBoundingBox();
        const normalized = geometry.boundingBox!;
        const center = normalized.getCenter(new THREE.Vector3());
        geometry.translate(-center.x, -normalized.min.y, -center.z);
        geometry.computeBoundingSphere();
        const sourceMaterial = Array.isArray(source.material) ? source.material[0] : source.material;
        const material = sourceMaterial.clone() as THREE.MeshStandardMaterial;
        material.roughness = kind === "rocks" ? 1 : Math.max(material.roughness ?? 0.8, binding.foliage ? 0.82 : 0.82);
        material.metalness = 0;
        if (kind === "rocks") {
          material.roughnessMap = null;
          material.envMapIntensity = 0.18;
        }
        if (binding.foliage) {
          material.side = THREE.DoubleSide;
          material.transparent = false;
          material.alphaTest = Math.max(material.alphaTest, 0.32);
          material.depthWrite = true;
        }
        if (kind === "rocks") this.heroRockVariants = rockVariants(geometry);
        else this.heroGeometries[kind] = geometry;
        this.heroMaterials[kind] = material;
      } catch (error) {
        console.warn(`Environment asset ${binding.id} failed; using calibrated fallback`, error);
      }
    }));
    await Promise.all(FOLIAGE_FAMILY_BINDINGS.map(async (binding) => {
      try {
        const gltf = embedded?.[binding.id]
          ? await loader.parseAsync(this.decodeBase64(embedded[binding.id]), "")
          : await loader.loadAsync(new URL(`environment/${binding.id}.glb`, document.baseURI).href);
        gltf.scene.updateMatrixWorld(true);
        let selected: THREE.Mesh | null = null;
        gltf.scene.traverse((object) => {
          if (!(object as THREE.Mesh).isMesh) return;
          const mesh = object as THREE.Mesh;
          if (!selected || (mesh.geometry.getAttribute("position")?.count ?? 0) > (selected.geometry.getAttribute("position")?.count ?? 0)) selected = mesh;
        });
        if (!selected) return;
        const source = selected as THREE.Mesh;
        const geometry = source.geometry.clone().applyMatrix4(source.matrixWorld);
        geometry.computeBoundingBox();
        const box = geometry.boundingBox!;
        const size = box.getSize(new THREE.Vector3());
        const scale = binding.targetSize / Math.max(0.001, size.y);
        geometry.scale(scale, scale, scale);
        geometry.computeBoundingBox();
        const normalized = geometry.boundingBox!;
        const center = normalized.getCenter(new THREE.Vector3());
        geometry.translate(-center.x, -normalized.min.y, -center.z);
        geometry.computeBoundingSphere();
        const sourceMaterial = Array.isArray(source.material) ? source.material[0] : source.material;
        const material = sourceMaterial.clone() as THREE.MeshStandardMaterial;
        material.side = THREE.DoubleSide; material.alphaTest = Math.max(0.36, material.alphaTest); material.transparent = false;
        material.roughness = Math.max(0.9, material.roughness); material.metalness = 0;
        this.foliageFamilies.push({ id: binding.id, zones: binding.zones, geometry, material });
      } catch (error) {
        console.warn(`Foliage family ${binding.id} failed; continuing with procedural ground cover`, error);
      }
    }));
  }

  private decodeBase64(value: string): ArrayBuffer {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  private generateCellRecords(cellX: number, cellZ: number): Record<DressingKind, InstanceRecord[]> {
    const records: Record<DressingKind, InstanceRecord[]> = { grass: [], flowers: [], bushes: [], reeds: [], rocks: [], debris: [] };
    const originX = cellX * this.cellSize, originZ = cellZ * this.cellSize;
    // One instance represents a multi-blade patch. The former 190 candidates
    // left tens of metres between patches, so the ground read as empty even
    // with perfect textures. This target keeps the GPU submission count fixed
    // while providing a continuous meadow in the immediate play space.
    const candidates = Math.round(520 * this.density);
    for (let i = 0; i < candidates; i++) {
      const x = originX + random01(cellX, cellZ, this.world.manifest.seed, i * 17 + 1) * this.cellSize;
      const z = originZ + random01(cellX, cellZ, this.world.manifest.seed, i * 17 + 2) * this.cellSize;
      const y = this.sampleGround(x, z);
      if (y <= 0.35 || !Number.isFinite(y) || this.excluded(x, z)) continue;
      const hL = this.sampleGround(x - 2, z), hR = this.sampleGround(x + 2, z);
      const hD = this.sampleGround(x, z - 2), hU = this.sampleGround(x, z + 2);
      const slope = Math.atan(Math.hypot(hR - hL, hU - hD) / 4) * 180 / Math.PI;
      const zone = this.zoneAt(x, z);
      const profile = PROFILES[zone?.id ?? ""] ?? DEFAULT_PROFILE;
      const shore = y < 9;
      const moisture = Math.max(0, Math.min(1, (zone?.climate.avgMoisture ?? 0.55) + (shore ? 0.18 : 0) - Math.max(0, y - 900) / 3200));
      const choice = random01(cellX, cellZ, this.world.manifest.seed, i * 17 + 3);
      const rotation = choice * Math.PI * 2;
      const sizeRandom = random01(cellX, cellZ, this.world.manifest.seed, i * 17 + 4);
      const variation = 0.72 + sizeRandom * 0.7;

      let kind: DressingKind | null = null;
      if (shore && y < 4.5 && choice < 0.035 * profile.reeds) kind = "debris";
      else if (shore && y < 8 && slope < 14 && choice < 0.22 * profile.reeds * moisture) kind = "reeds";
      else if (slope > 29 && choice < 0.09 * profile.rocks) kind = "rocks";
      else if (slope > 18 && choice < 0.045 * profile.rocks) kind = "rocks";
      else if (slope < 24 && choice < 0.04 * profile.scrub) kind = "bushes";
      else if (slope < 16 && choice < 0.05 * profile.flowers * moisture) kind = "flowers";
      else if (slope < 22 && choice < 0.68 * profile.lushness * (0.38 + moisture * 0.62)) kind = "grass";
      else if (choice < 0.016 * profile.rocks) kind = "rocks";
      if (!kind) continue;
      const tint = random01(cellX, cellZ, this.world.manifest.seed, i * 17 + 5);
      const scale = kind === "rocks" ? 0.28 + Math.pow(sizeRandom, 2.8) * 2.8 : variation;
      const rawVariant = hash32(cellX, cellZ, this.world.manifest.seed, i * 31 + 7) % 4;
      const zoneId = zone?.id ?? "alvora";
      const variant = kind === "bushes" && (zoneId === "valedouro" || zoneId === "solmara")
        ? rawVariant % 2
        : rawVariant;
      records[kind].push({
        x, y, z, rotation, scale, tint,
        variant, zoneId,
        normalX: hL - hR,
        normalY: 4,
        normalZ: hD - hU,
        sectorX: Math.floor(cellX / 8),
        sectorZ: Math.floor(cellZ / 8),
      });
    }

    return records;
  }

  private addBatch(
    kind: DressingKind,
    list: InstanceRecord[],
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    tier: "hero" | "distant",
    existing?: THREE.InstancedMesh,
  ): THREE.InstancedMesh | null {
      if (!list.length) return null;
      const mesh = existing
        ? existing
        : new THREE.InstancedMesh(geometry, material, Math.max(list.length, Math.ceil(list.length * 1.25)));
      mesh.geometry = geometry; mesh.material = material; mesh.count = list.length;
      mesh.name = `${kind}-${tier}`; mesh.userData.kind = kind; mesh.userData.tier = tier; mesh.frustumCulled = true;
      const color = new THREE.Color();
      list.forEach((record, index) => {
        if (kind === "bushes") this.dummy.scale.set(record.scale * 1.4, record.scale, record.scale * 1.25);
        else this.dummy.scale.setScalar(record.scale);
        this.dummy.position.set(record.x, record.y - (kind === "rocks" ? record.scale * 0.16 : 0.015), record.z);
        this.normal.set(record.normalX, record.normalY, record.normalZ).normalize();
        this.dummy.quaternion.setFromUnitVectors(this.up, this.normal);
        this.twist.setFromAxisAngle(this.normal, record.rotation);
        this.dummy.quaternion.premultiply(this.twist);
        if (kind === "debris") this.dummy.rotateZ((record.tint - 0.5) * 0.25);
        this.dummy.updateMatrix();
        mesh.setMatrixAt(index, this.dummy.matrix);
        if (kind === "grass") {
          const palette = GRASS_PALETTES[record.zoneId] ?? GRASS_PALETTES.alvora;
          color.set(palette[0]).lerp(this.tintColor.set(palette[1]), record.tint);
        }
        else if (kind === "flowers") color.setHSL(0.08 + record.tint * 0.72, 0.68, 0.58);
        else if (kind === "bushes") color.setRGB(0.12 + record.tint * 0.08, 0.29 + record.tint * 0.16, 0.11 + record.tint * 0.07);
        else if (kind === "reeds") color.setRGB(0.31 + record.tint * 0.13, 0.4 + record.tint * 0.18, 0.12);
        else if (kind === "rocks") {
          const palette = ROCK_PALETTES[record.zoneId] ?? ROCK_PALETTES.alvora;
          color.set(palette[record.variant % palette.length]);
          color.offsetHSL((record.tint - 0.5) * 0.025, -0.08, (record.tint - 0.5) * 0.12);
        }
        else color.setRGB(0.3 + record.tint * 0.12, 0.21 + record.tint * 0.07, 0.13 + record.tint * 0.04);
        mesh.setColorAt(index, color);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      // InstancedMesh does not automatically refresh its aggregate bounds
      // after setMatrixAt(). Without this call, opting into frustum culling
      // can either pop a batch or keep it alive forever.
      mesh.computeBoundingSphere();
      mesh.frustumCulled = true;
      if (!mesh.parent) this.group.add(mesh);
      return mesh;
  }

  private queueDesiredCells(centerX: number, centerZ: number, cameraX: number, cameraZ: number): void {
    const cellRadius = Math.ceil(this.radius / this.cellSize);
    const desired: Array<{ key: string; x: number; z: number; distance: number }> = [];
    for (let dz = -cellRadius; dz <= cellRadius; dz++) {
      for (let dx = -cellRadius; dx <= cellRadius; dx++) {
        const x = centerX + dx, z = centerZ + dz;
        const distance = Math.hypot((x + 0.5) * this.cellSize - cameraX, (z + 0.5) * this.cellSize - cameraZ);
        if (distance <= this.radius + this.cellSize * 0.75) desired.push({ key: `${x}:${z}`, x, z, distance });
      }
    }
    desired.sort((a, b) => a.distance - b.distance);
    this.desiredCells.clear();
    for (const candidate of desired.slice(0, this.maxCells)) this.desiredCells.add(candidate.key);
    this.pendingCells.length = 0;
    for (const candidate of desired.slice(0, this.maxCells)) {
      if (!this.cells.has(candidate.key)) this.pendingCells.push(candidate);
      else this.cells.get(candidate.key)!.lastUse = this.tick;
    }
    // Keep old sectors alive until replacements have been admitted. We only
    // retire over-capacity cells, farthest first, so movement cannot reveal a
    // simultaneous empty ring.
    // Obsolete cells are retired only after each incoming cell is ready.
  }

  private admitCell(candidate: { key: string; x: number; z: number }): void {
    if (this.cells.has(candidate.key)) return;
    const records = this.generateCellRecords(candidate.x, candidate.z);
    this.cellRecords.set(candidate.key, records);
    const instances = KIND_ORDER.reduce((sum, kind) => sum + records[kind].length, 0);
    this.cells.set(candidate.key, { x: candidate.x, z: candidate.z, group: this.group, instances, lastUse: this.tick });
    this.totalInstances += instances;
    for (const kind of KIND_ORDER) {
      this.counts[kind] += records[kind].length;
      for (const key of this.batchKeysForRecords(kind, records[kind])) this.dirtyBatches.add(key);
    }
    if (this.cells.size > this.maxCells) {
      const obsolete = [...this.cells.entries()]
        .filter(([key]) => !this.desiredCells.has(key))
        .sort((a, b) => a[1].lastUse - b[1].lastUse);
      if (obsolete[0]) this.retireCell(obsolete[0][0]);
    }
  }

  private retireCell(key: string): void {
    const records = this.cellRecords.get(key);
    if (records) {
      for (const kind of KIND_ORDER) {
        this.counts[kind] -= records[kind].length;
        this.totalInstances -= records[kind].length;
        for (const batchKey of this.batchKeysForRecords(kind, records[kind])) this.dirtyBatches.add(batchKey);
      }
    }
    this.cellRecords.delete(key);
    this.cells.delete(key);
  }

  private batchKeysForRecords(kind: DressingKind, records: InstanceRecord[]): string[] {
    const hasFamilyVariants = kind === "rocks" || kind === "bushes";
    return [...new Set(records.map((record) =>
      `${record.sectorX},${record.sectorZ}:${kind}:${hasFamilyVariants ? record.variant : 0}`,
    ))];
  }

  private rebuildOneDirtyBatch(): void {
    const key = this.dirtyBatches.values().next().value as string | undefined;
    if (!key) return;
    this.dirtyBatches.delete(key);
    const [sectorValue, kindValue, variantValue] = key.split(":");
    const [sectorX, sectorZ] = sectorValue.split(",").map(Number);
    const kind = kindValue as DressingKind;
    const tier = "distant" as const;
    const variant = Number(variantValue);
    const records: InstanceRecord[] = [];
    for (const cell of this.cellRecords.values()) {
      for (const record of cell[kind]) {
        const hasFamilyVariants = kind === "rocks" || kind === "bushes";
        if (record.sectorX === sectorX && record.sectorZ === sectorZ && (!hasFamilyVariants || record.variant === variant)) records.push(record);
      }
    }
    const previous = this.batches.get(key);
    if (!records.length) {
      if (previous) { this.group.remove(previous.mesh); previous.mesh.dispose(); this.batches.delete(key); }
      return;
    }
    // Stable world-space records always remain in the same LOD tier during
    // movement. A hero hot-swap happens once after the licensed asset loads,
    // never at a camera-distance boundary.
    let geometry = this.fallbackGeometries[kind], material = this.fallbackMaterials[kind];
    if (kind === "rocks") {
      // Keep the scan's calibrated PBR material, but use the lightweight
      // silhouette variants for mass scatter. The full scan is reserved for
      // later authored landmarks, never thousands of mountain instances.
      geometry = this.fallbackRockVariants[variant];
      material = this.fallbackMaterials.rocks;
    } else if (this.assetsReady && kind === "bushes" && variant > 0) {
      const family = this.foliageFamilies.find((candidate) => candidate.id === "fern_02" && records.some((record) => candidate.zones.has(record.zoneId)));
      if (family) { geometry = family.geometry; material = family.material; }
    } else if (kind === "debris" && this.assetsReady && this.heroGeometries[kind] && this.heroMaterials[kind]) {
      geometry = this.heroGeometries[kind]!; material = this.heroMaterials[kind]!;
    }
    const reusable = previous && previous.capacity >= records.length ? previous.mesh : undefined;
    if (previous && !reusable) { this.group.remove(previous.mesh); previous.mesh.dispose(); }
    const mesh = this.addBatch(kind, records, geometry, material, tier, reusable);
    if (!mesh) return;
    this.batches.set(key, { key, kind, variant, tier, mesh, owners: [...this.cells.keys()], records, capacity: mesh.instanceMatrix.count });
  }

  private indexExclusions(): void {
    const tileSize = this.world.manifest.worldScale.continentTileSize;
    const add = (shape: ExclusionShape, minX: number, minZ: number, maxX: number, maxZ: number) => {
      const minCellX = Math.floor(minX / this.cellSize), maxCellX = Math.floor(maxX / this.cellSize);
      const minCellZ = Math.floor(minZ / this.cellSize), maxCellZ = Math.floor(maxZ / this.cellSize);
      for (let z = minCellZ; z <= maxCellZ; z++) for (let x = minCellX; x <= maxCellX; x++) {
        const key = `${x}:${z}`;
        const list = this.exclusions.get(key) ?? [];
        list.push(shape); this.exclusions.set(key, list);
      }
    };
    for (const settlement of this.world.settlements) {
      const zone = this.world.zones.find((candidate) => candidate.id === settlement.zoneId);
      if (!zone) continue;
      const x = continentOriginX(zone.continent, this.world.manifest) + settlement.position[0] * tileSize;
      const z = continentOriginZ(zone.continent, this.world.manifest) + settlement.position[1] * tileSize;
      const radius = settlement.tier === 1 ? 260 : settlement.tier === 2 ? 180 : 120;
      add({ type: "circle", x, z, radius }, x - radius, z - radius, x + radius, z + radius);
    }
    for (const continent of Object.values(this.world.continents)) {
      const ox = continentOriginX(continent.id, this.world.manifest), oz = continentOriginZ(continent.id, this.world.manifest);
      for (const road of continent.roads) for (let i = 1; i < road.path.length; i++) {
        const a = road.path[i - 1], b = road.path[i];
        const shape: ExclusionShape = { type: "segment", ax: ox + a[0] * tileSize, az: oz + a[1] * tileSize, bx: ox + b[0] * tileSize, bz: oz + b[1] * tileSize, radius: 9 };
        add(shape, Math.min(shape.ax, shape.bx) - 9, Math.min(shape.az, shape.bz) - 9, Math.max(shape.ax, shape.bx) + 9, Math.max(shape.az, shape.bz) + 9);
      }
    }
  }

  private zoneAt(x: number, z: number): ZoneRecord | null {
    const tileSize = this.world.manifest.worldScale.continentTileSize;
    for (const continent of this.world.manifest.continents) {
      const u = (x - continentOriginX(continent, this.world.manifest)) / tileSize;
      const v = (z - continentOriginZ(continent, this.world.manifest)) / tileSize;
      if (u < 0 || u > 1 || v < 0 || v > 1) continue;
      for (const zone of this.world.zones) if (zone.continent === continent && pointInPolygon(u, v, zone.boundary)) return zone;
    }
    return null;
  }

  private excluded(x: number, z: number): boolean {
    const shapes = this.exclusions.get(`${Math.floor(x / this.cellSize)}:${Math.floor(z / this.cellSize)}`) ?? [];
    for (const shape of shapes) {
      if (shape.type === "circle") {
        if ((x - shape.x) ** 2 + (z - shape.z) ** 2 < shape.radius ** 2) return true;
      } else if (distanceToSegmentSquared(x, z, shape.ax, shape.az, shape.bx, shape.bz) < shape.radius ** 2) return true;
    }
    return false;
  }
}
