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
}

export interface RoadRecord {
  id: string;
  kind: "road" | "trail";
  path: [number, number][];
}

export interface ContinentData {
  id: string;
  heightData: Float32Array;
  resolution: number;
  biomeImage: HTMLImageElement;
  rivers: RiverRecord[];
  roads: RoadRecord[];
}

export interface WorldData {
  manifest: Manifest;
  zones: ZoneRecord[];
  settlements: SettlementRecord[];
  continents: Record<string, ContinentData>;
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
  const waterways = await fetchJson<{ continents: Record<string, { rivers: RiverRecord[]; lakes: unknown[] }> }>(
    `${b}/waterways.json`
  );

  onProgress?.("roads…");
  const roadsData = await fetchJson<{ roads: RoadRecord[] }>(`${b}/roads.json`);

  const continents: Record<string, ContinentData> = {};
  for (const continent of manifest.continents) {
    onProgress?.(`heightmap ${continent}…`);
    const heightData = await fetchFloat32(`${b}/heightmap.${continent}.raw`);
    const biomeImage = await loadImage(`${b}/biome_map.${continent}.png`);
    continents[continent] = {
      id: continent,
      heightData,
      resolution: manifest.worldScale.heightmapResolution,
      biomeImage,
      rivers: waterways.continents[continent]?.rivers ?? [],
      roads: roadsData.roads.filter((r) => r.id.startsWith(continent)),
    };
  }

  return { manifest, zones: zonesRaw.zones, settlements: poi.settlements, continents };
}
