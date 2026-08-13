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
  terminatesIn?: { type: "ocean" | "lake" | "river"; featureId: string };
  mouthKind?: "open-coast" | "estuary" | "delta" | "lake-inlet" | "lake-outlet" | "confluence";
  surfaceElevationM?: number[];
  /** Per-path-point bank-to-bank width from upstream flow accumulation. */
  widthProfileM?: number[];
  /** Explicit waterfall/rapids nodes emitted where the surface drops steeply. */
  falls?: { t: number; position: [number, number]; dropM: number }[];
  distributaries?: [number, number][][];
  profile?: {
    widthM: [number, number];
    depthM: [number, number];
    currentMps: [number, number];
    navigableFromT: number;
  };
}

/** Authored, routed trade waterway: its bed sits below sea level, so the
 * global ocean is its flat navigable surface from the sea to every port. */
export interface NavigableWaterwayRecord {
  id: string;
  name: string;
  class: string;
  surfaceWidthM: number;
  bedDepthM: number;
  bankWidthM: number;
  path: [number, number][];
  ports: { id: string; name: string; uv: [number, number]; headOfNavigation: boolean }[];
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

export type TerrainTextureChannel = "albedo" | "normal" | "roughness";
export type TerrainResidencyQuality = "compatibility" | "balanced" | "high";

export interface TerrainTextureSetRecord {
  id: string;
  displayName: string;
  provider: string;
  sourceAssetId: string;
  sourceUrl: string;
  license: "CC0";
  sourceDimensionsM?: [number, number];
  channels: Record<TerrainTextureChannel, { file: string; colorSpace: "srgb" | "linear" }>;
}

export interface TerrainMaterialFamilyRecord {
  id: string;
  displayName: string;
  textureSet: string;
  category: string;
  tint: [number, number, number];
  metersPerRepeat: number;
  normalStrength: number;
  roughnessBias: number;
  heightBlendM: number;
  controlDrivers: string[];
  tags: string[];
}

export interface TerrainMaterialLibrary {
  version: number;
  libraryId: string;
  textureSets: TerrainTextureSetRecord[];
  families: TerrainMaterialFamilyRecord[];
  residencyProfiles: Record<TerrainResidencyQuality, {
    anisotropy: number;
    maxResolution: number;
    channelsByTextureSet: Record<string, TerrainTextureChannel[]>;
  }>;
}

export interface TerrainMaterialRecipe {
  id: string;
  zoneId: string;
  biomeIds: string[];
  allowedMaterialFamilies: string[];
  primary: string;
  secondary: string;
  tertiary: string;
  shore: string;
  steep: string;
  wet: string;
  cold: string;
  rules: {
    secondaryDriver: "moisture" | "wetness" | "vegetation" | "exposure" | "macro";
    secondaryRange: [number, number];
    secondaryInvert: boolean;
    tertiaryMacroRange: [number, number];
    tertiaryStrength: number;
    shoreRange: [number, number];
    steepSlopeDegrees: [number, number];
    wetnessRange: [number, number];
    snowElevationM: [number, number];
    macroTintStrength: number;
  };
  forbiddenCombinations: [string, string][];
}

export interface TerrainMaterialRecipeLibrary {
  version: number;
  libraryId: string;
  zoneOrder: string[];
  recipes: TerrainMaterialRecipe[];
}

export function validateTerrainMaterialLibrary(library: TerrainMaterialLibrary): TerrainMaterialLibrary {
  if (library.version !== 1) throw new Error(`Unsupported terrain material library v${library.version}`);
  if (library.families.length < 25 || library.families.length > 35) throw new Error(`Terrain material family count ${library.families.length} is outside 25-35`);
  const setIds = new Set(library.textureSets.map((set) => set.id));
  if (setIds.size !== library.textureSets.length) throw new Error("Terrain material library has duplicate texture sets");
  if (new Set(library.families.map((family) => family.id)).size !== library.families.length) throw new Error("Terrain material library has duplicate families");
  for (const family of library.families) if (!setIds.has(family.textureSet)) throw new Error(`Terrain material family ${family.id} references missing set ${family.textureSet}`);
  for (const quality of ["compatibility", "balanced", "high"] as const) {
    const profile = library.residencyProfiles[quality];
    if (!profile) throw new Error(`Terrain material library is missing ${quality} residency`);
    for (const setId of setIds) if (!profile.channelsByTextureSet[setId]?.includes("albedo")) throw new Error(`${quality} residency is missing ${setId}/albedo`);
  }
  return library;
}

export function validateTerrainMaterialRecipes(
  recipes: TerrainMaterialRecipeLibrary,
  materials: TerrainMaterialLibrary,
  controls: ControlFieldManifest,
): TerrainMaterialRecipeLibrary {
  if (recipes.version !== 1) throw new Error(`Unsupported terrain material recipe library v${recipes.version}`);
  if (recipes.recipes.length !== recipes.zoneOrder.length || new Set(recipes.zoneOrder).size !== recipes.zoneOrder.length) throw new Error("Terrain recipe zone coverage is invalid");
  const materialIds = new Set(materials.families.map((family) => family.id));
  const recipeZones = new Set<string>();
  for (const recipe of recipes.recipes) {
    if (recipeZones.has(recipe.zoneId) || !recipes.zoneOrder.includes(recipe.zoneId)) throw new Error(`Terrain recipe has duplicate or unknown zone ${recipe.zoneId}`);
    recipeZones.add(recipe.zoneId);
    for (const role of ["primary", "secondary", "tertiary", "shore", "steep", "wet", "cold"] as const) {
      if (!materialIds.has(recipe[role]) || !recipe.allowedMaterialFamilies.includes(recipe[role])) throw new Error(`Terrain recipe ${recipe.id}/${role} is invalid`);
    }
  }
  const zoneChannel = controls.packs.flatMap((pack) => pack.channels).find((channel) => channel.field === "zone-class");
  if (!zoneChannel?.labels || zoneChannel.labels.slice(1).join(",") !== recipes.zoneOrder.join(",")) throw new Error("Terrain recipes do not match the compiler zone-class contract");
  return recipes;
}

/** A depression-resolved lake with an explicit spill saddle and outlet. */
export interface LakeRecord {
  id: string;
  kind?: "lake" | "wetland-pool" | "coastal-pool";
  polygon: [number, number][];
  depthM: number;
  surfaceElevationM: number;
  spillElevationM: number;
  outlet: [number, number];
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
  waterways: NavigableWaterwayRecord[];
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
  terrainMaterialLibrary: TerrainMaterialLibrary;
  terrainMaterialRecipes: TerrainMaterialRecipeLibrary;
}

function base(seed: number) {
  return new URL(`world-data/${seed}`, document.baseURI).href.replace(/\/$/, "");
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
  waterways: { continents: Record<string, { rivers: RiverRecord[]; lakes: LakeRecord[]; waterways?: NavigableWaterwayRecord[] }> };
  continents: Record<string, { heightDataBase64: string; biomeImageDataUri: string }>;
  worldHeightBase64: string;
  controlFields: {
    manifest: ControlFieldManifest;
    continents: Record<string, Record<string, string>>;
  };
  terrainMaterialLibrary: TerrainMaterialLibrary;
  terrainMaterialRecipes: TerrainMaterialRecipeLibrary;
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
  const terrainMaterialLibrary = validateTerrainMaterialLibrary(embedded.terrainMaterialLibrary);
  const terrainMaterialRecipes = validateTerrainMaterialRecipes(embedded.terrainMaterialRecipes, terrainMaterialLibrary, controlFields);
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
      waterways: embedded.waterways.continents[id]?.waterways ?? [],
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
    terrainMaterialLibrary,
    terrainMaterialRecipes,
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
  const waterways = await fetchJson<{ continents: Record<string, { rivers: RiverRecord[]; lakes: LakeRecord[]; waterways?: NavigableWaterwayRecord[] }> }>(
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
  onProgress?.("terrain material library");
  const terrainMaterialLibrary = validateTerrainMaterialLibrary(await fetchJson<TerrainMaterialLibrary>(`${b}/terrainMaterials.json`));
  const terrainMaterialRecipes = validateTerrainMaterialRecipes(
    await fetchJson<TerrainMaterialRecipeLibrary>(`${b}/terrainMaterialRecipes.json`),
    terrainMaterialLibrary,
    controlFields,
  );

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
      waterways: waterways.continents[continent]?.waterways ?? [],
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

  return { manifest, zones: zonesRaw.zones, settlements: poi.settlements, seaRegions: seaRegionsData.regions, continents, worldHeight, controlFields, terrainMaterialLibrary, terrainMaterialRecipes };
}
