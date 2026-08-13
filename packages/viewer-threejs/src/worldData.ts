// Loads generator output over HTTP from /world-data/<seed>/... (served by
// vite.config.ts's dev middleware, which just reads the repo's output/
// directory). This is the ONLY place the viewer knows about the generator's
// file layout -- everything downstream works with plain in-memory data,
// per the engine-independence contract (docs/01 §7).

export interface Manifest {
  seed: number;
  generatorVersion: string;
  generatedAt: string;
  worldScale: { continentTileSize: number; heightmapResolution: number };
  continents: string[];
  continentLayout: Record<string, { worldOffset: [number, number] }>;
  worldHeightmap: { width: number; height: number; bounds: { minX: number; minZ: number; maxX: number; maxZ: number } };
}

export interface SeaRegionRecord {
  id: string;
  name: string;
  center: [number, number];
  radiusUnits: number;
  magicalIntensity: string;
  notes: string;
}

export interface ZoneRecord {
  id: string;
  properName: string;
  descriptor: string;
  continent: string;
  band: number;
  approxLevelRange: [number, number];
  boundary: [number, number][];
  biomeSummary: string[];
  climate: { avgTemperatureC: number; avgMoisture: number };
}

export interface SettlementRecord {
  id: string;
  name: string | null;
  tier: number;
  type: string;
  reason: string;
  position: [number, number];
  zoneId: string;
}

export interface RiverRecord {
  id: string;
  path: [number, number][];
  sourceElevationM?: number;
  terminatesIn?: { type: "ocean" | "lake"; featureId: string };
  profile?: {
    widthM: [number, number];
    depthM: [number, number];
    currentMps: [number, number];
    navigableFromT: number;
  };
}

export interface ControlFieldChannel {
  field: string;
  kind: "continuous" | "category";
  min: number;
  max: number;
  labels?: string[];
}

export interface ControlFieldPack {
  id: string;
  channels: [ControlFieldChannel, ControlFieldChannel, ControlFieldChannel, ControlFieldChannel];
}

export interface ControlFieldManifest {
  version: number;
  encoding: "rgba8";
  packs: ControlFieldPack[];
  continents: Record<string, { width: number; height: number; files: Record<string, string> }>;
}

/** A closed-basin pit lake (hydrology/index.ts) -- generated since Phase 2 but never wired into the viewer until now, which is why low inland basins rendered as flat "ocean" biome color with no actual water surface (Kevin: "not sure if it's water or a lake"). */
export interface LakeRecord {
  id: string;
  polygon: [number, number][];
  depthM: number;
}

export interface BridgePointRecord {
  id: string;
  start: [number, number];
  end: [number, number];
}

export interface RoadRecord {
  id: string;
  kind: "road" | "trail";
  path: [number, number][];
  bridges: BridgePointRecord[];
}

export interface ContinentData {
  id: string;
  heightData: Float32Array;
  resolution: number;
  biomeImage: HTMLImageElement;
  rivers: RiverRecord[];
  lakes: LakeRecord[];
  roads: RoadRecord[];
  controlWidth: number;
  controlHeight: number;
  controlPacks: Uint8Array[];
}

/** The unified world heightfield (docs/01 §3 stage 3) -- both continents plus the connecting seabed between them, one grid. */
export interface WorldHeightData {
  data: Float32Array;
  width: number;
  height: number;
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number };
}

export interface WorldData {
  manifest: Manifest;
  zones: ZoneRecord[];
  settlements: SettlementRecord[];
  seaRegions: SeaRegionRecord[];
  continents: Record<string, ContinentData>;
  worldHeight: WorldHeightData;
  controlFields: ControlFieldManifest;
}

function base(seed: number) {
  return `/world-data/${seed}`;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.json() as Promise<T>;
}

async function fetchFloat32(url: string): Promise<Float32Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  const buf = await res.arrayBuffer();
  return new Float32Array(buf);
}

async function fetchUint8(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

// --- Embedded-data loading path -------------------------------------------
// Used by the self-contained claude.ai artifact build (scripts/build-artifact.mjs),
// which has no dev server to fetch /world-data/* from and instead inlines
// everything into window.__NEVORA_WORLD__ at publish time. The fetch-based
// loadWorld() above stays the path for local `npm run viewer` dev.

export interface EmbeddedWorld {
  manifest: Manifest;
  zones: ZoneRecord[];
  settlements: SettlementRecord[];
  seaRegions: SeaRegionRecord[];
  roads: RoadRecord[];
  waterways: { continents: Record<string, { rivers: RiverRecord[]; lakes: LakeRecord[] }> };
  continents: Record<string, { heightDataBase64: string; biomeImageDataUri: string }>;
  worldHeightBase64: string;
  controlFields: {
    manifest: ControlFieldManifest;
    continents: Record<string, Record<string, string>>;
  };
}

function base64ToFloat32Array(b64: string): Float32Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function loadEmbeddedWorld(onProgress?: (msg: string) => void): Promise<WorldData> {
  const embedded = (globalThis as unknown as { __NEVORA_WORLD__?: EmbeddedWorld }).__NEVORA_WORLD__;
  if (!embedded) throw new Error("window.__NEVORA_WORLD__ was not found -- this build was expected to have embedded world data.");

  const continents: Record<string, ContinentData> = {};
  const controlFields = embedded.controlFields.manifest;
  for (const id of embedded.manifest.continents) {
    onProgress?.(`decoding ${id}…`);
    const src = embedded.continents[id];
    const heightData = base64ToFloat32Array(src.heightDataBase64);
    const biomeImage = await loadImage(src.biomeImageDataUri);
    continents[id] = {
      id,
      heightData,
      resolution: embedded.manifest.worldScale.heightmapResolution,
      biomeImage,
      rivers: embedded.waterways.continents[id]?.rivers ?? [],
      lakes: embedded.waterways.continents[id]?.lakes ?? [],
      roads: embedded.roads.filter((r) => r.id.startsWith(id)),
      controlWidth: controlFields.continents[id].width,
      controlHeight: controlFields.continents[id].height,
      controlPacks: controlFields.packs.map((pack) => base64ToUint8Array(embedded.controlFields.continents[id][pack.id])),
    };
  }

  onProgress?.("decoding ocean floor…");
  const worldHeight: WorldHeightData = {
    data: base64ToFloat32Array(embedded.worldHeightBase64),
    width: embedded.manifest.worldHeightmap.width,
    height: embedded.manifest.worldHeightmap.height,
    bounds: embedded.manifest.worldHeightmap.bounds,
  };

  return {
    manifest: embedded.manifest,
    zones: embedded.zones,
    settlements: embedded.settlements,
    seaRegions: embedded.seaRegions,
    continents,
    worldHeight,
    controlFields,
  };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

export async function loadWorld(seed: number, onProgress?: (msg: string) => void): Promise<WorldData> {
  const b = base(seed);
  onProgress?.("manifest…");
  const manifest = await fetchJson<Manifest>(`${b}/manifest.json`);

  onProgress?.("zones…");
  const zonesRaw = await fetchJson<{ zones: ZoneRecord[] }>(`${b}/zones.json`);

  onProgress?.("settlements…");
  const poi = await fetchJson<{ settlements: SettlementRecord[] }>(`${b}/poi.json`);

  onProgress?.("waterways…");
  const waterways = await fetchJson<{ continents: Record<string, { rivers: RiverRecord[]; lakes: LakeRecord[] }> }>(
    `${b}/waterways.json`
  );

  onProgress?.("roads…");
  const roadsData = await fetchJson<{ roads: RoadRecord[] }>(`${b}/roads.json`);

  onProgress?.("sea regions…");
  const seaRegionsData = await fetchJson<{ regions: SeaRegionRecord[] }>(`${b}/seaRegions.json`);

  onProgress?.("environmental controls");
  const controlFields = await fetchJson<ControlFieldManifest>(`${b}/controlFields.json`);
  if (controlFields.version !== 1 || controlFields.encoding !== "rgba8") {
    throw new Error(`Unsupported environmental control contract v${controlFields.version}/${controlFields.encoding}`);
  }

  const continents: Record<string, ContinentData> = {};
  for (const continent of manifest.continents) {
    onProgress?.(`heightmap ${continent}…`);
    const heightData = await fetchFloat32(`${b}/heightmap.${continent}.raw`);
    const biomeImage = await loadImage(`${b}/biome_map.${continent}.png`);
    const controlRecord = controlFields.continents[continent];
    if (!controlRecord) throw new Error(`Control manifest is missing ${continent}`);
    const controlPacks = await Promise.all(controlFields.packs.map((pack) => fetchUint8(`${b}/${controlRecord.files[pack.id]}`)));
    for (let i = 0; i < controlPacks.length; i++) {
      if (controlPacks[i].length !== controlRecord.width * controlRecord.height * 4) {
        throw new Error(`Invalid ${continent}/${controlFields.packs[i].id} control-map dimensions`);
      }
    }
    continents[continent] = {
      id: continent,
      heightData,
      resolution: manifest.worldScale.heightmapResolution,
      biomeImage,
      rivers: waterways.continents[continent]?.rivers ?? [],
      lakes: waterways.continents[continent]?.lakes ?? [],
      roads: roadsData.roads.filter((r) => r.id.startsWith(continent)),
      controlWidth: controlRecord.width,
      controlHeight: controlRecord.height,
      controlPacks,
    };
  }

  onProgress?.("ocean floor…");
  const worldHeightData = await fetchFloat32(`${b}/heightmap.world.raw`);
  const worldHeight: WorldHeightData = {
    data: worldHeightData,
    width: manifest.worldHeightmap.width,
    height: manifest.worldHeightmap.height,
    bounds: manifest.worldHeightmap.bounds,
  };

  return { manifest, zones: zonesRaw.zones, settlements: poi.settlements, seaRegions: seaRegionsData.regions, continents, worldHeight, controlFields };
}
