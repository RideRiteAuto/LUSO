import * as THREE from "three/webgpu";
import type { WorldData } from "./worldData.js";
import { buildTerrainControlMap, SKIRT_REACH, type TerrainControlMap } from "./terrain.js";
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
  visible: number;
  viewDistance: number;
  lastCommitMs: number;
  maxCommitMs: number;
}

interface TileResult {
  token: number;
  spec: TerrainTileSpec;
  positions: ArrayBuffer;
  normals: ArrayBuffer;
  uvs: ArrayBuffer;
  indices: ArrayBuffer;
  controls: ArrayBuffer[];
  workerMs: number;
}

const CONTROL_PACK_IDS = ["climate", "hydrology", "terrain", "ecology", "resources", "habitat"] as const;

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
    controlData: Uint8Array;
    controlWidth: number;
    controlHeight: number;
    controlPackCount: number;
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
  function sampleControls(x: number, z: number, outputs: Float32Array[], vertexIndex: number): void {
    const s = state!;
    const b = s.bounds;
    const cx = Math.max(b.minX, Math.min(b.maxX, x));
    const cz = Math.max(b.minZ, Math.min(b.maxZ, z));
    const px = Math.round((cx - b.minX) / (b.maxX - b.minX) * (s.controlWidth - 1));
    const pz = Math.round((cz - b.minZ) / (b.maxZ - b.minZ) * (s.controlHeight - 1));
    const pixel = pz * s.controlWidth + px;
    for (let pack = 0; pack < s.controlPackCount; pack++) {
      const sourceOffset = (pixel * s.controlPackCount + pack) * 4;
      const outputOffset = vertexIndex * 4;
      outputs[pack][outputOffset] = s.controlData[sourceOffset] / 255;
      outputs[pack][outputOffset + 1] = s.controlData[sourceOffset + 1] / 255;
      outputs[pack][outputOffset + 2] = s.controlData[sourceOffset + 2] / 255;
      outputs[pack][outputOffset + 3] = s.controlData[sourceOffset + 3] / 255;
    }
  }
  function buildTile(spec: WorkerTile) {
    const started = performance.now();
    const n = spec.segments + 1;
    const coreCount = n * n;
    const skirtCount = n * 4;
    const vertexCount = coreCount + skirtCount;
    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);
    const controls = Array.from({ length: state!.controlPackCount }, () => new Float32Array(vertexCount * 4));
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
        sampleControls(worldX, worldZ, controls, vi);
        uvs[vi * 2] = x / spec.segments;
        uvs[vi * 2 + 1] = z / spec.segments;
      }
    }

    const coreIndexCount = spec.segments * spec.segments * 6;
    const skirtIndexCount = spec.segments * 4 * 6;
    const indices = new Uint32Array(coreIndexCount + skirtIndexCount);
    let ii = 0;
    for (let z = 0; z < spec.segments; z++) {
      for (let x = 0; x < spec.segments; x++) {
        const a = z * n + x, b = a + 1, c = a + n, d = c + 1;
        indices[ii++] = a; indices[ii++] = c; indices[ii++] = b;
        indices[ii++] = b; indices[ii++] = c; indices[ii++] = d;
      }
    }

    // Conceal sub-pixel precision gaps between independently streamed LOD
    // patches. Edge stitching aligns the top surface; these shallow skirts
    // cover the remaining raster crack that otherwise reveals the ocean as
    // blue diagonal slashes in strategic-altitude views.
    const skirtDepth = Math.max(8, step * 0.1);
    let skirtVertex = coreCount;
    const addSkirt = (topIndices: number[], outward: "minZ" | "maxZ" | "minX" | "maxX") => {
      const firstSkirt = skirtVertex;
      for (const top of topIndices) {
        const source3 = top * 3, target3 = skirtVertex * 3;
        positions[target3] = positions[source3];
        positions[target3 + 1] = positions[source3 + 1] - skirtDepth;
        positions[target3 + 2] = positions[source3 + 2];
        normals[target3] = normals[source3];
        normals[target3 + 1] = normals[source3 + 1];
        normals[target3 + 2] = normals[source3 + 2];
        uvs[skirtVertex * 2] = uvs[top * 2];
        uvs[skirtVertex * 2 + 1] = uvs[top * 2 + 1];
        for (const pack of controls) pack.set(pack.subarray(top * 4, top * 4 + 4), skirtVertex * 4);
        skirtVertex++;
      }
      for (let edge = 0; edge < spec.segments; edge++) {
        const a = topIndices[edge], b = topIndices[edge + 1];
        const lowerA = firstSkirt + edge, lowerB = lowerA + 1;
        if (outward === "minZ" || outward === "maxX") {
          indices[ii++] = a; indices[ii++] = b; indices[ii++] = lowerA;
          indices[ii++] = b; indices[ii++] = lowerB; indices[ii++] = lowerA;
        } else {
          indices[ii++] = a; indices[ii++] = lowerA; indices[ii++] = b;
          indices[ii++] = b; indices[ii++] = lowerA; indices[ii++] = lowerB;
        }
      }
    };
    addSkirt(Array.from({ length: n }, (_, x) => x), "minZ");
    addSkirt(Array.from({ length: n }, (_, x) => spec.segments * n + x), "maxZ");
    addSkirt(Array.from({ length: n }, (_, z) => z * n), "minX");
    addSkirt(Array.from({ length: n }, (_, z) => z * n + spec.segments), "maxX");
    return { positions, normals, uvs, indices, controls, workerMs: performance.now() - started };
  }

  scope.onmessage = (event: MessageEvent) => {
    const message = event.data as { type: string; token?: number; spec?: WorkerTile; state?: Omit<WorkerState, "heights" | "controlData"> & { heights: ArrayBuffer; controlData: ArrayBuffer } };
    if (message.type === "init" && message.state) {
      state = {
        ...message.state,
        heights: new Float32Array(message.state.heights),
        controlData: new Uint8Array(message.state.controlData),
      };
      scope.postMessage({ type: "ready" });
      return;
    }
    if (message.type !== "build" || !state || !message.spec) return;
    const result = buildTile(message.spec);
    const response = {
      type: "tile", token: message.token, spec: message.spec, workerMs: result.workerMs,
      positions: result.positions.buffer, normals: result.normals.buffer,
      uvs: result.uvs.buffer, indices: result.indices.buffer,
      controls: result.controls.map((control) => control.buffer),
    };
    scope.postMessage(response, [response.positions, response.normals, response.uvs, response.indices, ...response.controls]);
  };
}

export class TerrainStreamer {
  readonly group = new THREE.Group();
  private readonly settings: TerrainLodSettings;
  private readonly groundViewDistance: number;
  private readonly workers: WorkerSlot[] = [];
  private readonly active = new Map<string, THREE.Mesh>();
  private readonly staging = new Map<string, THREE.Mesh>();
  private desired = new Set<string>();
  private queue: TerrainTileSpec[] = [];
  private generation = 0;
  private pending = 0;
  private frozen = false;
  private debugLod = false;
  private lastSelectionX = Number.NaN;
  private lastSelectionZ = Number.NaN;
  private lastSelectionAt = Number.NEGATIVE_INFINITY;
  private lastWorkerMs = 0;
  private maxWorkerMs = 0;
  private maxUpdateMs = 0;
  private lastCommitMs = 0;
  private maxCommitMs = 0;
  private readonly terrainMaterial: AlvoraTerrainMaterial;
  private readonly debugMaterials = [0x42d4f4, 0x64e572, 0xf4dd4b, 0xf49a45, 0xe75d87, 0x9a72ed, 0x5669d8].map(
    (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, wireframe: true, side: THREE.FrontSide }),
  );
  private readonly expandedBounds: { minX: number; minZ: number; maxX: number; maxZ: number };

  static async create(world: WorldData, quality: TerrainQuality, renderer: THREE.WebGPURenderer): Promise<TerrainStreamer> {
    // Fragment-space material sampling needs enough regional resolution to
    // preserve riverbanks and slope transitions in the compatibility tier.
    const controlMap = buildTerrainControlMap(world, quality === "high" ? 1536 : 1024);
    return new TerrainStreamer(world, quality, await AlvoraTerrainMaterial.create(
      renderer,
      quality,
      world.terrainMaterialLibrary,
      world.terrainMaterialRecipes,
      controlMap,
      world.worldHeight.bounds,
    ), controlMap);
  }

  private constructor(
    private readonly world: WorldData,
    quality: TerrainQuality,
    terrainMaterial: AlvoraTerrainMaterial,
    controlMap: TerrainControlMap,
  ) {
    this.terrainMaterial = terrainMaterial;
    this.settings = quality === "high"
      ? { minTileSize: 128, splitDistance: 1.8, maxTiles: 240 }
      : quality === "compatibility"
        ? { minTileSize: 512, splitDistance: 1.55, maxTiles: 140 }
        : { minTileSize: 256, splitDistance: 1.7, maxTiles: 200 };
    this.groundViewDistance = quality === "high" ? 30000 : quality === "compatibility" ? 12000 : 22000;
    const b = world.worldHeight.bounds;
    this.expandedBounds = { minX: b.minX - SKIRT_REACH, minZ: b.minZ - SKIRT_REACH, maxX: b.maxX + SKIRT_REACH, maxZ: b.maxZ + SKIRT_REACH };

    const packIds = world.controlFields.packs.map((pack) => pack.id);
    if (packIds.join(",") !== CONTROL_PACK_IDS.join(",")) throw new Error(`Unsupported terrain control-pack order: ${packIds.join(",")}`);
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
      const controls = controlMap.data.slice().buffer;
      worker.postMessage({
        type: "init",
        state: {
          heights, width: world.worldHeight.width, height: world.worldHeight.height,
          bounds: world.worldHeight.bounds,
          controlData: controls, controlWidth: controlMap.width, controlHeight: controlMap.height,
          controlPackCount: controlMap.packCount,
          seed: world.manifest.seed, skirtReach: SKIRT_REACH,
        },
      }, [heights, controls]);
      this.workers.push(slot);
    }
    URL.revokeObjectURL(workerUrl);
  }

  update(cameraWorldX: number, cameraWorldZ: number): void {
    if (this.frozen) return;
    const started = performance.now();
    const now = performance.now();
    if (!Number.isFinite(this.lastSelectionX)
      || (now - this.lastSelectionAt >= 500
        && Math.hypot(cameraWorldX - this.lastSelectionX, cameraWorldZ - this.lastSelectionZ) >= this.settings.minTileSize * 1.5)) {
      this.lastSelectionX = cameraWorldX;
      this.lastSelectionZ = cameraWorldZ;
      this.lastSelectionAt = now;
      this.beginGeneration(selectTerrainTiles(this.expandedBounds, cameraWorldX, cameraWorldZ, this.settings));
    }
    this.maxUpdateMs = Math.max(this.maxUpdateMs, performance.now() - started);
  }

  setFrozen(frozen: boolean): void { this.frozen = frozen; }
  get isFrozen(): boolean { return this.frozen; }

  setDebugLod(enabled: boolean): void {
    this.debugLod = enabled;
    for (const mesh of [...this.active.values(), ...this.staging.values()]) this.applyMaterial(mesh);
    for (const mesh of this.active.values()) mesh.visible = true;
  }

  setWireframe(enabled: boolean): void {
    this.terrainMaterial.material.wireframe = enabled;
  }

  setMaterialDebugMode(mode: TerrainMaterialDebugMode): void { this.terrainMaterial.setDebugMode(mode); }
  updateWorldOrigin(offset: THREE.Vector3): void { this.terrainMaterial.updateOrigin(offset); }

  setViewMode(mode: "ground" | "flight" | "overview"): void {
    const next = mode === "ground" ? this.groundViewDistance
      : mode === "flight" ? this.groundViewDistance * 2.5
        : undefined;
    if (this.settings.viewDistance === next) return;
    this.settings.viewDistance = next;
    this.lastSelectionX = Number.NaN;
    this.lastSelectionZ = Number.NaN;
    this.lastSelectionAt = Number.NEGATIVE_INFINITY;
  }

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
      visible: this.active.size,
      viewDistance: this.settings.viewDistance ?? Infinity,
      lastCommitMs: this.lastCommitMs,
      maxCommitMs: this.maxCommitMs,
    };
  }

  dispose(): void {
    for (const slot of this.workers) slot.worker.terminate();
    for (const mesh of [...this.active.values(), ...this.staging.values()]) mesh.geometry.dispose();
    this.active.clear(); this.staging.clear(); this.queue = [];
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
      && message.positions && message.normals && message.uvs && message.indices && message.controls) {
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
    // Biome class is already in controlEcology.z. Keeping the legacy RGB
    // color attribute would push this adapter beyond its eight vertex-buffer
    // limit and reintroduce biome-paint tinting into the final material.
    geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(result.uvs), 2));
    geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(result.indices), 1));
    result.controls.forEach((control, index) => {
      const id = CONTROL_PACK_IDS[index];
      const name = `control${id[0].toUpperCase()}${id.slice(1)}`;
      geometry.setAttribute(name, new THREE.BufferAttribute(new Float32Array(control), 4));
    });
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
    const started = performance.now();
    for (const [id, mesh] of this.active) {
      if (this.desired.has(id)) continue;
      this.group.remove(mesh);
      mesh.geometry.dispose();
      this.active.delete(id);
    }
    for (const [id, mesh] of this.staging) {
      mesh.visible = true;
      this.active.set(id, mesh);
    }
    this.staging.clear();
    this.lastCommitMs = performance.now() - started;
    this.maxCommitMs = Math.max(this.maxCommitMs, this.lastCommitMs);
  }
}
