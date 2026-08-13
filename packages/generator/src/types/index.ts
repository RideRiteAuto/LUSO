// Core types shared across the generator pipeline.
// Mirrors docs/02_Nevora_World_Data_Schema.md — keep them in sync.

export type Vec2 = [number, number];

export type ContinentId = "valora" | "seradia";

export interface WorldRules {
  seed: number;
  worldScale: {
    continentTileSize: number;
    heightmapResolution: number;
  };
}

export interface ContinentLayoutDesign {
  continentTileSize: number;
  lunaSeaGapUnits: number;
  continents: { id: ContinentId; worldOffset: Vec2 }[];
  bruma: {
    id: string;
    name: string;
    center: Vec2;
    radiusUnits: number;
    magicalIntensity: string;
    notes: string;
  };
}

export interface SeaRegion {
  id: string;
  name: string;
  center: Vec2;
  radiusUnits: number;
  magicalIntensity: string;
  notes: string;
}

export interface ZoneDesign {
  id: string;
  properName: string;
  descriptor: string;
  continent: ContinentId;
  band: number;
  approxLevelRange: [number, number];
  /** Anchor point in normalized continent-local space [0,1]x[0,1], hand-placed to match the bible's geography. */
  anchor: Vec2;
  /** Rough target radius as a fraction of continent tile size. */
  radius: number;
  biomeHints: string[];
  elevationTargetM: [number, number];
  housingDistricts?: { name: string; kind: string }[];
  loreBreadcrumb?: { type: string; notes: string };
  signatureTradeGood?: string;
  threats?: string[];
}

export interface ResourceDesign {
  resourceId: string;
  displayName: string;
  profession: string;
  unlockLevel: number;
  category: string;
  allowedZones: string[];
  elevationRangeM?: [number, number];
  biomeAffinity?: string[];
  density: "sparse" | "medium" | "dense";
}

export interface CreatureDesign {
  creatureId: string;
  displayName: string;
  family: string;
  zoneId: string;
  skinningLevel: number;
  primaryDrop: string;
  rareDrop?: string;
  elevationRangeM: [number, number];
  minDistanceFromSettlementM: number;
}

export interface HeightField {
  width: number;
  height: number;
  /** row-major, meters, sea level = 0 */
  data: Float32Array;
}

export interface ScalarField {
  width: number;
  height: number;
  data: Float32Array;
}

export interface CategoricalField {
  width: number;
  height: number;
  /** Integer class index stored in a float array for pipeline consistency. */
  data: Float32Array;
}

export interface EnvironmentalRegionDesign {
  zoneId: string;
  temperatureOffsetC: number;
  precipitationBias: number;
  moistureBias: number;
  exposureBias: number;
  vegetationBias: number;
  housingBias: number;
  soilPrimary: string;
  soilSecondary: string;
  geologyPrimary: string;
  geologySecondary: string;
  weatherRegion: string;
}

export type TerrainTextureChannel = "albedo" | "normal" | "roughness";
export type TerrainResidencyQuality = "compatibility" | "balanced" | "high";

export interface TerrainTextureSetDesign {
  id: string;
  displayName: string;
  provider: string;
  sourceAssetId: string;
  sourceUrl: string;
  license: "CC0";
  sourceDimensionsM?: Vec2;
  channels: Record<TerrainTextureChannel, { file: string; colorSpace: "srgb" | "linear" }>;
}

export interface TerrainMaterialFamilyDesign {
  id: string;
  displayName: string;
  textureSet: string;
  category: "grass" | "forest-floor" | "soil" | "shore" | "rock" | "snow" | "special";
  tint: [number, number, number];
  metersPerRepeat: number;
  normalStrength: number;
  roughnessBias: number;
  heightBlendM: number;
  controlDrivers: string[];
  tags: string[];
}

export interface TerrainMaterialLibraryDesign {
  version: number;
  libraryId: string;
  textureSets: TerrainTextureSetDesign[];
  families: TerrainMaterialFamilyDesign[];
  residencyProfiles: Record<TerrainResidencyQuality, {
    anisotropy: number;
    maxResolution: number;
    channelsByTextureSet: Record<string, TerrainTextureChannel[]>;
  }>;
}

export type TerrainRecipeDriver = "moisture" | "wetness" | "vegetation" | "exposure" | "macro";

export interface TerrainMaterialRecipeDesign {
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
    secondaryDriver: TerrainRecipeDriver;
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

export interface TerrainMaterialRecipeLibraryDesign {
  version: number;
  libraryId: string;
  zoneOrder: string[];
  recipes: TerrainMaterialRecipeDesign[];
}

export interface ResourceEligibilityFields {
  forest: ScalarField;
  forage: ScalarField;
  ore: ScalarField;
  stone: ScalarField;
  reeds: ScalarField;
  aquatic: ScalarField;
  generic: ScalarField;
}

/** Compiler-authored environmental truth consumed by rendering and gameplay. */
export interface EnvironmentalFields {
  temperatureC: ScalarField;
  precipitation: ScalarField;
  moisture: ScalarField;
  wetness: ScalarField;
  drainage: ScalarField;
  distanceToWaterM: ScalarField;
  shorelineInfluence: ScalarField;
  slopeDegrees: ScalarField;
  exposure: ScalarField;
  erosionScree: ScalarField;
  buildability: ScalarField;
  vegetationEligibility: ScalarField;
  soilClass: CategoricalField;
  geologyClass: CategoricalField;
  weatherRegionClass: CategoricalField;
  zoneClass: CategoricalField;
  resources: ResourceEligibilityFields;
}

export interface River {
  id: string;
  path: Vec2[];
  sourceElevationM: number;
  terminatesIn: { type: "ocean" | "lake" | "river"; featureId: string };
  mouthKind: "open-coast" | "estuary" | "delta" | "lake-inlet" | "lake-outlet" | "confluence";
  /** Compiler-resolved, monotonically descending surface used by rendering and navigation. */
  surfaceElevationM: number[];
  /** Per-path-point bank-to-bank width, derived from upstream flow accumulation. */
  widthProfileM?: number[];
  /** Steep drops emitted as explicit waterfall/rapids nodes for rendering and navigation blocking. */
  falls?: { t: number; position: Vec2; dropM: number }[];
  /** Canonical deltas may split near the mouth while retaining one watershed ID. */
  distributaries?: Vec2[][];
  /** Runtime water contract sampled along the source-to-mouth path. */
  profile: {
    widthM: [number, number];
    depthM: [number, number];
    currentMps: [number, number];
    navigableFromT: number;
  };
}

export interface Lake {
  id: string;
  kind: "lake" | "wetland-pool" | "coastal-pool" | "pond";
  polygon: Vec2[];
  depthM: number;
  surfaceElevationM: number;
  spillElevationM: number;
  outlet: Vec2;
}

/** Hand-authored channel cross-section shared by every waterway of a class. */
export interface WaterwayChannelClassDesign {
  surfaceWidthM: number;
  bedDepthM: number;
  bankWidthM: number;
}

export interface WaterwayNetworkDesign {
  id: string;
  name: string;
  continent: ContinentId;
  class: string;
  nodes: { id: string; kind: "sea" | "port"; name?: string; uv: Vec2; headOfNavigation?: boolean }[];
  edges: [string, string][];
}

export interface WaterwayDesign {
  channelClasses: Record<string, WaterwayChannelClassDesign>;
  networks: WaterwayNetworkDesign[];
}

/**
 * A routed, carved, boat-navigable trade waterway. Its bed sits below sea
 * level for its whole length, so the global ocean is its water surface —
 * flat, continuous, and lock-free from the sea to every port.
 */
export interface NavigableWaterway {
  id: string;
  name: string;
  class: string;
  surfaceWidthM: number;
  bedDepthM: number;
  /** Continent-local uv polyline routed along low ground, sea end first. */
  path: Vec2[];
  ports: { id: string; name: string; uv: Vec2; headOfNavigation: boolean }[];
}

export interface WaterData {
  oceanLevelM: number;
  rivers: River[];
  lakes: Lake[];
  waterways: NavigableWaterway[];
}

export interface ResolvedZone {
  id: string;
  properName: string;
  descriptor: string;
  continent: ContinentId;
  band: number;
  approxLevelRange: [number, number];
  boundary: Vec2[];
  biomeSummary: string[];
  climate: { avgTemperatureC: number; avgMoisture: number };
  housingDistricts?: { name: string; kind: string; anchor: Vec2 }[];
  loreBreadcrumb?: { type: string; anchor: Vec2; notes: string };
}

export interface ResourceInstance {
  position: Vec2;
  zoneId: string;
  elevationM: number;
  density: string;
}

export interface PlacedResource {
  resourceId: string;
  profession: string;
  unlockLevel: number;
  instances: ResourceInstance[];
}

export interface SpawnRegion {
  creatureId: string;
  family: string;
  zoneId: string;
  region: Vec2[];
  skinningLevel: number;
  primaryDrop: string;
  elevationRangeM: [number, number];
  minDistanceFromSettlementM: number;
}

export interface SettlementAnchor {
  id: string;
  name: string | null;
  tier: 1 | 2 | 3 | 4;
  type: string;
  reason: string;
  position: Vec2;
  zoneId: string;
}

export interface Landmark {
  id: string;
  type: string;
  position: Vec2;
  zoneId: string;
}

export interface BridgePoint {
  id: string;
  /** continent-local UV */
  start: Vec2;
  end: Vec2;
}

export interface Road {
  id: string;
  kind: "road" | "trail";
  path: Vec2[];
  connects: [string, string];
  /** Where this road's terrain-aware route crosses water -- see roads/index.ts. */
  bridges: BridgePoint[];
}

export interface SeaRoute {
  id: string;
  path: Vec2[];
  connects: [string, string];
  risk: "low" | "medium" | "high";
}

export interface WorldOutput {
  manifest: {
    seed: number;
    generatorVersion: string;
    generatedAt: string;
    worldScale: WorldRules["worldScale"];
    continents: ContinentId[];
    continentLayout: Record<ContinentId, { worldOffset: Vec2 }>;
    /** Dimensions + extent of heightmap.world.raw (docs/02 §11b), so the viewer knows how to index into it. */
    worldHeightmap: { width: number; height: number; bounds: { minX: number; minZ: number; maxX: number; maxZ: number } };
  };
  seaRegions: SeaRegion[];
  /** The single unified heightfield spanning the whole world (both continents + the connecting seabed between them) -- see elevation/index.ts. */
  worldHeightField: HeightField;
  worldBounds: { minX: number; minZ: number; maxX: number; maxZ: number };
  heightFields: Record<ContinentId, HeightField>;
  biomeFields: Record<ContinentId, ScalarField>;
  environmentalFields: Record<ContinentId, EnvironmentalFields>;
  terrainMaterialLibrary: TerrainMaterialLibraryDesign;
  terrainMaterialRecipes: TerrainMaterialRecipeLibraryDesign;
  water: Record<ContinentId, WaterData>;
  zones: ResolvedZone[];
  resources: PlacedResource[];
  spawns: SpawnRegion[];
  settlements: SettlementAnchor[];
  landmarks: Landmark[];
  roads: Road[];
  seaRoutes: SeaRoute[];
}
