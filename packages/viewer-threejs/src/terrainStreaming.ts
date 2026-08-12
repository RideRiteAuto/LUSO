import * as THREE from "three/webgpu";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { WorldData } from "./worldData.js";
import { buildTerrainColorMap, SKIRT_REACH } from "./terrain.js";
import { selectTerrainTiles, type TerrainLodSettings, type TerrainTileSpec } from "./terrainLod.js";
import { AlvoraTerrainMaterial, type TerrainMaterialDebugMode, type TerrainQuality } from "./terrainMaterial.js";

export interface TerrainStreamingStats {
  active: number;
  desired: number;
  queued: number;
  building: number;
  generation: number;
  lastWorkerMs: number;
  maxWorkerMs: number;
  maxUpdateMs: number;
  frozen: boolean;
  minSpacing: number;
}

interface TileResult {
  token: number;
  spec: TerrainTileSpec;
  positions: ArrayBuffer;
  normals: ArrayBuffer;
  colors: ArrayBuffer;
  uvs: ArrayBuffer;
  indices: ArrayBuffer;
  workerMs: number;
}

interface WorkerSlot {
  worker: Worker;
  busy: boolean;
}

function terrainWorkerMain() {
  type WorkerState = {
    heights: Float32Array;
    width: number;
    height: number;
    bounds: { minX: number; minZ: number; maxX: number; maxZ: number };
    colorData: Uint8Array;
    colorWidth: number;
    colorHeight: number;
    seed: number;
    skirtReach: number;
  };
  type WorkerTile = { id: string; minX: number; minZ: number; size: number; level: number; segments: number; stitchMask: number; stitchRatios: [number, number, number, number] };
  const scope = self as unknown as {
    onmessage: ((event: MessageEvent) => void) | null;
    postMessage: (message: unknown, transfer?: Transferable[]) => void;
  };
  let state: WorkerState | null = null;
  const abyssDepth = -3550;

  function smoothstep(a: number, b: number, x: number): number {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  }
  function hash2(x: number, z: number, seed: number): number {
    let h = Math.imul(x, 0x1f123bb5) ^ Math.imul(z, 0x5f356495) ^ Math.imul(seed | 0, 0x6c8e9cf5);
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  }
  function fade(t: number): number { return t * t * (3 - 2 * t); }
  function valueNoise(x: number, z: number, scale: number, seed: number): number {
    const fx = x / scale, fz = z / scale;
    const x0 = Math.floor(fx), z0 = Math.floor(fz);
    const tx = fade(fx - x0), tz = fade(fz - z0);
    const a = hash2(x0, z0, seed), b = hash2(x0 + 1, z0, seed);
    const c = hash2(x0, z0 + 1, seed), d = hash2(x0 + 1, z0 + 1, seed);
    return ((a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * tz) * 2 - 1;
  }
  function detail(x: number, z: number, macro: number): number {
    const s = state!;
    const exposure = macro <= -8 ? 0.08 : macro < 2 ? 0.25 : 1;
    return (valueNoise(x, z, 32, s.seed ^ 0x36a9f17) * 1.15
      + valueNoise(x, z, 8, s.seed ^ 0x4b1d2c3) * 0.32) * exposure;
  }
  function macroHeight(x: number, z: number): number {
    const s = state!;
    const b = s.bounds;
    const cx = Math.max(b.minX, Math.min(b.maxX, x));
    const cz = Math.max(b.minZ, Math.min(b.maxZ, z));
    const u = (cx - b.minX) / (b.maxX - b.minX);
    const v = (cz - b.minZ) / (b.maxZ - b.minZ);
    const fx = Math.max(0, Math.min(s.width - 1, u * (s.width - 1)));
    const fz = Math.max(0, Math.min(s.height - 1, v * (s.height - 1)));
    const x0 = Math.floor(fx), z0 = Math.floor(fz);
    const x1 = Math.min(s.width - 1, x0 + 1), z1 = Math.min(s.height - 1, z0 + 1);
    const tx = fx - x0, tz = fz - z0;
    const north = s.heights[z0 * s.width + x0] * (1 - tx) + s.heights[z0 * s.width + x1] * tx;
    const south = s.heights[z1 * s.width + x0] * (1 - tx) + s.heights[z1 * s.width + x1] * tx;
    let h = north * (1 - tz) + south * tz;
    const dx = Math.max(0, b.minX - x, x - b.maxX);
    const dz = Math.max(0, b.minZ - z, z - b.maxZ);
    const past = Math.max(dx, dz);
    if (past > 0) {
      h = Math.min(h, -100);
      h += (abyssDepth - h) * smoothstep(0, s.skirtReach, past);
    }
    return h;
  }
  function terrainHeight(x: number, z: number): number {
    const macro = macroHeight(x, z);
    return macro + detail(x, z, macro);
  }
  function sampleColor(x: number, z: number, out: Float32Array, index: number): void {
    const s = state!;
    const b = s.bounds;
    const cx = Math.max(b.minX, Math.min(b.maxX, x));
    const cz = Math.max(b.minZ, Math.min(b.maxZ, z));
    const px = Math.round((cx - b.minX) / (b.maxX - b.minX) * (s.colorWidth - 1));
    const pz = Math.round((cz - b.minZ) / (b.maxZ - b.minZ) * (s.colorHeight - 1));
    const ci = (pz * s.colorWidth + px) * 3;
    let r = s.colorData[ci] / 255, g = s.colorData[ci + 1] / 255, bl = s.colorData[ci + 2] / 255;
    const past = Math.max(0, b.minX - x, x - b.maxX, b.minZ - z, z - b.maxZ);
    if (past > 0) {
      const t = smoothstep(0, s.skirtReach, past);
      r += (0.031 - r) * t; g += (0.110 - g) * t; bl += (0.200 - bl) * t;
    }
    out[index] = r; out[index + 1] = g; out[index + 2] = bl;
  }
  function buildTile(spec: WorkerTile) {
    const started = performance.now();
    const n = spec.segments + 1;
    const coreCount = n * n;
    const positions = new Float32Array(coreCount * 3);
    const normals = new Float32Array(coreCount * 3);
    const colors = new Float32Array(coreCount * 3);
    const uvs = new Float32Array(coreCount * 2);
    const step = spec.size / spec.segments;
    const centerX = spec.minX + spec.size * 0.5;
    const centerZ = spec.minZ + spec.size * 0.5;
    // Lighting derivatives must not change when a patch changes render LOD.
    // This shared world-space scale gives identical normals at shared points.
    const normalStep = 4;

    function stitchedHeight(x: number, z: number, worldX: number, worldZ: number): number {
      let total = 0, count = 0;
      const interpolateEdge = (coordinate: number, ratio: number, fixed: number, horizontal: boolean): number => {
        const lower = Math.floor(coordinate / ratio) * ratio;
        const upper = Math.min(spec.segments, lower + ratio);
        const t = upper === lower ? 0 : (coordinate - lower) / (upper - lower);
        const ax = horizontal ? spec.minX + lower * step : fixed;
        const az = horizontal ? fixed : spec.minZ + lower * step;
        const bx = horizontal ? spec.minX + upper * step : fixed;
        const bz = horizontal ? fixed : spec.minZ + upper * step;
        return terrainHeight(ax, az) * (1 - t) + terrainHeight(bx, bz) * t;
      };
      if (z === 0 && spec.stitchRatios[0] > 1) { total += interpolateEdge(x, spec.stitchRatios[0], spec.minZ, true); count++; }
      if (z === spec.segments && spec.stitchRatios[1] > 1) { total += interpolateEdge(x, spec.stitchRatios[1], spec.minZ + spec.size, true); count++; }
      if (x === 0 && spec.stitchRatios[2] > 1) { total += interpolateEdge(z, spec.stitchRatios[2], spec.minX, false); count++; }
      if (x === spec.segments && spec.stitchRatios[3] > 1) { total += interpolateEdge(z, spec.stitchRatios[3], spec.minX + spec.size, false); count++; }
      return count ? total / count : terrainHeight(worldX, worldZ);
    }

    for (let z = 0; z < n; z++) {
      for (let x = 0; x < n; x++) {
        const worldX = spec.minX + x * step;
        const worldZ = spec.minZ + z * step;
        const vi = z * n + x;
        const i = vi * 3;
        const h = stitchedHeight(x, z, worldX, worldZ);
        positions[i] = worldX - centerX; positions[i + 1] = h; positions[i + 2] = worldZ - centerZ;
        const nx = terrainHeight(worldX - normalStep, worldZ) - terrainHeight(worldX + normalStep, worldZ);
        const nz = terrainHeight(worldX, worldZ - normalStep) - terrainHeight(worldX, worldZ + normalStep);
        const ny = normalStep * 2;
        const length = Math.hypot(nx, ny, nz) || 1;
        normals[i] = nx / length; normals[i + 1] = ny / length; normals[i + 2] = nz / length;
        sampleColor(worldX, worldZ, colors, i);
        uvs[vi * 2] = x / spec.segments;
        uvs[vi * 2 + 1] = z / spec.segments;
      }
    }

    const coreIndexCount = spec.segments * spec.segments * 6;
    const indices = new Uint32Array(coreIndexCount);
    let ii = 0;
    for (let z = 0; z < spec.segments; z++) {
      for (let x = 0; x < spec.segments; x++) {
        const a = z * n + x, b = a + 1, c = a + n, d = c + 1;
        indices[ii++] = a; indices[ii++] = c; indices[ii++] = b;
        indices[ii++] = b; indices[ii++] = c; indices[ii++] = d;
      }
    }
    return { positions, normals, colors, uvs, indices, workerMs: performance.now() - started };
  }

  scope.onmessage = (event: MessageEvent) => {
    const message = event.data as { type: string; token?: number; spec?: WorkerTile; state?: Omit<WorkerState, "heights" | "colorData"> & { heights: ArrayBuffer; colorData: ArrayBuffer } };
    if (message.type === "init" && message.state) {
      state = { ...message.state, heights: new Float32Array(message.state.heights), colorData: new Uint8Array(message.state.colorData) };
      scope.postMessage({ type: "ready" });
      return;
    }
    if (message.type !== "build" || !state || !message.spec) return;
    const result = buildTile(message.spec);
    const response = {
      type: "tile", token: message.token, spec: message.spec, workerMs: result.workerMs,
      positions: result.positions.buffer, normals: result.normals.buffer,
      colors: result.colors.buffer, uvs: result.uvs.buffer, indices: result.indices.buffer,
    };
    scope.postMessage(response, [response.positions, response.normals, response.colors, response.uvs, response.indices]);
  };
}

export class TerrainStreamer {
  readonly group = new THREE.Group();
  private readonly settings: TerrainLodSettings;
  private readonly workers: WorkerSlot[] = [];
  private readonly active = new Map<string, THREE.Mesh>();
  private readonly staging = new Map<string, THREE.Mesh>();
  private mergedTerrain: THREE.Mesh | null = null;
  private desired = new Set<string>();
  private queue: TerrainTileSpec[] = [];
  private generation = 0;
  private pending = 0;
  private frozen = false;
  private debugLod = false;
  private lastSelectionX = Number.NaN;
  private lastSelectionZ = Number.NaN;
  private lastWorkerMs = 0;
  private maxWorkerMs = 0;
  private maxUpdateMs = 0;
  private readonly terrainMaterial: AlvoraTerrainMaterial;
  private readonly debugMaterials = [0x42d4f4, 0x64e572, 0xf4dd4b, 0xf49a45, 0xe75d87, 0x9a72ed, 0x5669d8].map(
    (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, wireframe: true, side: THREE.FrontSide }),
  );
  private readonly expandedBounds: { minX: number; minZ: number; maxX: number; maxZ: number };

  static async create(world: WorldData, quality: TerrainQuality, renderer: THREE.WebGPURenderer): Promise<TerrainStreamer> {
    return new TerrainStreamer(world, quality, await AlvoraTerrainMaterial.create(renderer, quality));
  }

  private constructor(private readonly world: WorldData, quality: TerrainQuality, terrainMaterial: AlvoraTerrainMaterial) {
    this.terrainMaterial = terrainMaterial;
    this.settings = quality === "high"
      ? { minTileSize: 128, splitDistance: 1.8, maxTiles: 240 }
      : quality === "compatibility"
        ? { minTileSize: 512, splitDistance: 1.55, maxTiles: 140 }
        : { minTileSize: 256, splitDistance: 1.7, maxTiles: 200 };
    const b = world.worldHeight.bounds;
    this.expandedBounds = { minX: b.minX - SKIRT_REACH, minZ: b.minZ - SKIRT_REACH, maxX: b.maxX + SKIRT_REACH, maxZ: b.maxZ + SKIRT_REACH };

    const colorMap = buildTerrainColorMap(world, quality === "compatibility" ? 512 : 1024);
    const workerUrl = URL.createObjectURL(new Blob([`(${terrainWorkerMain.toString()})()`], { type: "text/javascript" }));
    const workerCount = Math.max(1, Math.min(2, Math.floor((navigator.hardwareConcurrency || 4) / 4)));
    for (let i = 0; i < workerCount; i++) {
      const worker = new Worker(workerUrl);
      const slot = { worker, busy: false };
      worker.onmessage = (event) => this.onWorkerMessage(slot, event.data);
      worker.onerror = (event) => {
        slot.busy = false;
        console.error("terrain worker failed", event.message);
        this.dispatch();
      };
      const heights = world.worldHeight.data.slice().buffer;
      const colors = colorMap.data.slice().buffer;
      worker.postMessage({
        type: "init",
        state: {
          heights, width: world.worldHeight.width, height: world.worldHeight.height,
          bounds: world.worldHeight.bounds, colorData: colors,
          colorWidth: colorMap.width, colorHeight: colorMap.height,
          seed: world.manifest.seed, skirtReach: SKIRT_REACH,
        },
      }, [heights, colors]);
      this.workers.push(slot);
    }
    URL.revokeObjectURL(workerUrl);
  }

  update(cameraWorldX: number, cameraWorldZ: number): void {
    if (this.frozen) return;
    const started = performance.now();
    if (!Number.isFinite(this.lastSelectionX)
      || Math.hypot(cameraWorldX - this.lastSelectionX, cameraWorldZ - this.lastSelectionZ) >= this.settings.minTileSize * 0.75) {
      this.lastSelectionX = cameraWorldX;
      this.lastSelectionZ = cameraWorldZ;
      this.beginGeneration(selectTerrainTiles(this.expandedBounds, cameraWorldX, cameraWorldZ, this.settings));
    }
    this.maxUpdateMs = Math.max(this.maxUpdateMs, performance.now() - started);
  }

  setFrozen(frozen: boolean): void { this.frozen = frozen; }
  get isFrozen(): boolean { return this.frozen; }

  setDebugLod(enabled: boolean): void {
    this.debugLod = enabled;
    for (const mesh of [...this.active.values(), ...this.staging.values()]) this.applyMaterial(mesh);
    if (this.mergedTerrain) this.mergedTerrain.visible = !enabled;
    for (const mesh of this.active.values()) mesh.visible = enabled;
  }

  setWireframe(enabled: boolean): void {
    this.terrainMaterial.material.wireframe = enabled;
  }

  setMaterialDebugMode(mode: TerrainMaterialDebugMode): void { this.terrainMaterial.setDebugMode(mode); }
  updateWorldOrigin(offset: THREE.Vector3): void { this.terrainMaterial.updateOrigin(offset); }

  get stats(): TerrainStreamingStats {
    return {
      active: this.active.size,
      desired: this.desired.size,
      queued: this.queue.length,
      building: this.workers.filter((worker) => worker.busy).length,
      generation: this.generation,
      lastWorkerMs: this.lastWorkerMs,
      maxWorkerMs: this.maxWorkerMs,
      maxUpdateMs: this.maxUpdateMs,
      frozen: this.frozen,
      minSpacing: this.settings.minTileSize / 64,
    };
  }

  dispose(): void {
    for (const slot of this.workers) slot.worker.terminate();
    for (const mesh of [...this.active.values(), ...this.staging.values()]) mesh.geometry.dispose();
    this.active.clear(); this.staging.clear(); this.queue = [];
    if (this.mergedTerrain) {
      this.group.remove(this.mergedTerrain);
      this.mergedTerrain.geometry.dispose();
      this.mergedTerrain = null;
    }
    this.terrainMaterial.dispose();
    for (const material of this.debugMaterials) material.dispose();
  }

  private beginGeneration(specs: TerrainTileSpec[]): void {
    const nextIds = new Set(specs.map((spec) => spec.id));
    if (nextIds.size === this.desired.size && [...nextIds].every((id) => this.desired.has(id))) return;
    this.generation++;
    this.desired = nextIds;
    this.queue = [];
    for (const mesh of this.staging.values()) { this.group.remove(mesh); mesh.geometry.dispose(); }
    this.staging.clear();
    const missing = specs.filter((spec) => !this.active.has(spec.id));
    this.pending = missing.length;
    this.queue.push(...missing.slice(0, this.settings.maxTiles));
    if (this.pending === 0) this.commitGeneration();
    else this.dispatch();
  }

  private dispatch(): void {
    for (const slot of this.workers) {
      if (slot.busy) continue;
      const spec = this.queue.shift();
      if (!spec) continue;
      slot.busy = true;
      slot.worker.postMessage({ type: "build", token: this.generation, spec });
    }
  }

  private onWorkerMessage(slot: WorkerSlot, message: { type: string } & Partial<TileResult>): void {
    if (message.type === "ready") { this.dispatch(); return; }
    if (message.type !== "tile") return;
    slot.busy = false;
    if (message.token === this.generation && message.spec && this.desired.has(message.spec.id)
      && message.positions && message.normals && message.colors && message.uvs && message.indices) {
      const mesh = this.createMesh(message as TileResult);
      mesh.visible = false;
      this.staging.set(message.spec.id, mesh);
      this.group.add(mesh);
      this.pending--;
      this.lastWorkerMs = message.workerMs ?? 0;
      this.maxWorkerMs = Math.max(this.maxWorkerMs, this.lastWorkerMs);
      if (this.pending === 0) this.commitGeneration();
    }
    this.dispatch();
  }

  private createMesh(result: TileResult): THREE.Mesh {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(result.positions), 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(result.normals), 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(result.colors), 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(result.uvs), 2));
    geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(result.indices), 1));
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, this.terrainMaterial.material);
    mesh.position.set(result.spec.minX + result.spec.size * 0.5, 0, result.spec.minZ + result.spec.size * 0.5);
    mesh.receiveShadow = true;
    mesh.userData.terrainLevel = result.spec.level;
    mesh.userData.terrainTileId = result.spec.id;
    this.applyMaterial(mesh);
    return mesh;
  }

  private applyMaterial(mesh: THREE.Mesh): void {
    mesh.material = this.debugLod
      ? this.debugMaterials[(mesh.userData.terrainLevel as number) % this.debugMaterials.length]
      : this.terrainMaterial.material;
  }

  private commitGeneration(): void {
    for (const [id, mesh] of this.active) {
      if (this.desired.has(id)) continue;
      this.group.remove(mesh);
      mesh.geometry.dispose();
      this.active.delete(id);
    }
    for (const [id, mesh] of this.staging) {
      mesh.visible = this.debugLod;
      this.active.set(id, mesh);
    }
    this.staging.clear();
    this.rebuildMergedTerrain();
  }

  /**
   * All committed tiles share one terrain material. Combining their geometry
   * turns up to ~200 terrain submissions into one draw while the original
   * tile meshes remain as an invisible streaming cache and LOD debug view.
   */
  private rebuildMergedTerrain(): void {
    if (this.mergedTerrain) {
      this.group.remove(this.mergedTerrain);
      this.mergedTerrain.geometry.dispose();
      this.mergedTerrain = null;
    }
    const translated = [...this.active.values()].map((mesh) => {
      const geometry = mesh.geometry.clone();
      geometry.translate(mesh.position.x, mesh.position.y, mesh.position.z);
      return geometry;
    });
    if (!translated.length) return;
    const merged = mergeGeometries(translated, false);
    for (const geometry of translated) geometry.dispose();
    if (!merged) throw new Error("Unable to batch terrain tile geometries");
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, this.terrainMaterial.material);
    mesh.name = "terrain-batch";
    mesh.receiveShadow = true;
    mesh.visible = !this.debugLod;
    this.group.add(mesh);
    this.mergedTerrain = mesh;
  }
}
