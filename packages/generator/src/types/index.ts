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

export interface River {
  id: string;
  path: Vec2[];
  sourceElevationM: number;
  terminatesIn: { type: "ocean" | "lake"; featureId: string };
}

export interface Lake {
  id: string;
  polygon: Vec2[];
  depthM: number;
}

export interface WaterData {
  oceanLevelM: number;
  rivers: River[];
  lakes: Lake[];
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

export interface Road {
  id: string;
  kind: "road" | "trail";
  path: Vec2[];
  connects: [string, string];
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
  };
  heightFields: Record<ContinentId, HeightField>;
  biomeFields: Record<ContinentId, ScalarField>;
  water: Record<ContinentId, WaterData>;
  zones: ResolvedZone[];
  resources: PlacedResource[];
  spawns: SpawnRegion[];
  settlements: SettlementAnchor[];
  landmarks: Landmark[];
  roads: Road[];
  seaRoutes: SeaRoute[];
}
