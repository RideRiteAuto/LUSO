import type { WorldData, ZoneRecord } from "./worldData.js";
import { uvToWorld } from "./layout.js";

export interface TraversalBookmark {
  id: string;
  label: string;
  x: number;
  z: number;
  heading: number;
  /** Optional aerial QA altitude above the authoritative ground. */
  altitudeM?: number;
  pitch?: number;
}

function zoneCenter(zone: ZoneRecord, world: WorldData): { x: number; z: number } {
  const u = zone.boundary.reduce((sum, point) => sum + point[0], 0) / zone.boundary.length;
  const v = zone.boundary.reduce((sum, point) => sum + point[1], 0) / zone.boundary.length;
  const [x, z] = uvToWorld(u, v, zone.continent, world.manifest);
  return { x, z };
}

function slopeDegrees(sampleHeight: (x: number, z: number) => number, x: number, z: number): number {
  const radius = 4;
  const dx = sampleHeight(x + radius, z) - sampleHeight(x - radius, z);
  const dz = sampleHeight(x, z + radius) - sampleHeight(x, z - radius);
  return Math.atan(Math.hypot(dx, dz) / (radius * 2)) * 180 / Math.PI;
}

export function findSafeTraversalPoint(
  sampleHeight: (x: number, z: number) => number,
  centerX: number,
  centerZ: number,
  searchRadius = 6000,
): { x: number; z: number } {
  let best: { x: number; z: number; score: number } | null = null;
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < 1200; i++) {
    const radius = searchRadius * Math.sqrt(i / 1199);
    const angle = i * goldenAngle;
    const x = centerX + Math.cos(angle) * radius;
    const z = centerZ + Math.sin(angle) * radius;
    const height = sampleHeight(x, z);
    if (height < 3) continue;
    const slope = slopeDegrees(sampleHeight, x, z);
    if (slope > 28) continue;
    const score = radius + slope * 35 + Math.max(0, height - 350) * 0.2;
    if (!best || score < best.score) best = { x, z, score };
  }
  return best ? { x: best.x, z: best.z } : { x: centerX, z: centerZ };
}

// The review exhibit extends well behind its teleport anchor: the imported
// house is centered 80 m forward and has a roughly 19 m square footprint.
// Validate the whole exhibit, not only the player's arrival point, whenever a
// new compiler pass reshapes Alvora.
const REVIEW_YARD_OFFSETS = (() => {
  const offsets: Array<{ x: number; z: number }> = [];
  for (let z = -92; z <= 8; z += 10) {
    for (let x = -36; x <= 46; x += 10) offsets.push({ x, z });
  }
  return offsets;
})();

const REVIEW_HOUSE_OFFSETS = [
  { x: -10, z: -90 }, { x: 0, z: -90 }, { x: 10, z: -90 },
  { x: -10, z: -80 }, { x: 0, z: -80 }, { x: 10, z: -80 },
  { x: -10, z: -70 }, { x: 0, z: -70 }, { x: 10, z: -70 },
];

export function findSafeReviewYardPoint(
  sampleHeight: (x: number, z: number) => number,
  isWater: (x: number, z: number) => boolean,
  centerX: number,
  centerZ: number,
  searchRadius = 2400,
): { x: number; z: number } {
  let best: { x: number; z: number; score: number } | null = null;
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < 1800; i++) {
    const radius = searchRadius * Math.sqrt(i / 1799);
    if (best && radius > best.score) break;
    const angle = i * goldenAngle;
    const x = centerX + Math.cos(angle) * radius;
    const z = centerZ + Math.sin(angle) * radius;
    let wet = false;
    let minHeight = Number.POSITIVE_INFINITY;
    let maxHeight = Number.NEGATIVE_INFINITY;
    for (const offset of REVIEW_YARD_OFFSETS) {
      const sampleX = x + offset.x, sampleZ = z + offset.z;
      const height = sampleHeight(sampleX, sampleZ);
      if (height < 5 || isWater(sampleX, sampleZ)) { wet = true; break; }
      minHeight = Math.min(minHeight, height);
      maxHeight = Math.max(maxHeight, height);
    }
    if (wet) continue;
    const houseHeights = REVIEW_HOUSE_OFFSETS.map((offset) => sampleHeight(x + offset.x, z + offset.z));
    const houseRelief = Math.max(...houseHeights) - Math.min(...houseHeights);
    if (houseRelief > 1.35) continue;
    const arrivalSlope = slopeDegrees(sampleHeight, x, z);
    if (arrivalSlope > 10) continue;
    const score = radius + houseRelief * 260 + arrivalSlope * 22 + (maxHeight - minHeight) * 2;
    if (!best || score < best.score) best = { x, z, score };
  }
  if (!best) throw new Error("No fully dry, flat Alvora resource-review footprint was found");
  return { x: best.x, z: best.z };
}

export function findZoneShoreBookmark(world: WorldData, zoneId: string): TraversalBookmark | null {
  const zone = world.zones.find((candidate) => candidate.id === zoneId);
  const continent = zone ? world.continents?.[zone.continent] : null;
  if (!zone || !continent) return null;
  const habitatIndex = world.controlFields.packs.findIndex((pack) => pack.id === "habitat");
  const hydrologyIndex = world.controlFields.packs.findIndex((pack) => pack.id === "hydrology");
  const zoneChannel = world.controlFields.packs[habitatIndex]?.channels[3];
  const zoneClass = zoneChannel?.labels?.indexOf(zoneId) ?? -1;
  if (habitatIndex < 0 || hydrologyIndex < 0 || zoneClass < 1) return null;
  const habitat = continent.controlPacks[habitatIndex];
  const hydrology = continent.controlPacks[hydrologyIndex];
  const width = continent.controlWidth, height = continent.controlHeight;
  let best: { x: number; z: number; gridX: number; gridZ: number; score: number } | null = null;
  for (let gridZ = 0; gridZ < height; gridZ++) {
    for (let gridX = 0; gridX < width; gridX++) {
      const pixel = gridZ * width + gridX;
      const decodedZone = Math.round((habitat[pixel * 4 + 3] / 255) * zoneChannel.max);
      if (decodedZone !== zoneClass) continue;
      const elevation = continent.heightData[pixel];
      const shore = hydrology[pixel * 4 + 2] / 255;
      const slope = (hydrology[pixel * 4 + 3] / 255) * 60;
      if (elevation < 3.2 || elevation > 18 || shore < 0.58 || slope > 12) continue;
      const score = Math.abs(elevation - 6) * 4 + (1 - shore) * 45 + slope * 0.4;
      if (!best || score < best.score) {
        const [x, z] = uvToWorld(gridX / Math.max(1, width - 1), gridZ / Math.max(1, height - 1), zone.continent, world.manifest);
        best = { x, z, gridX, gridZ, score };
      }
    }
  }
  if (!best) return null;
  let oceanDx = 0, oceanDz = -1, lowest = Number.POSITIVE_INFINITY;
  // The compiler shore influence intentionally extends inland; search far
  // enough to find actual sub-sea terrain, not merely the lowest nearby dune.
  for (let dz = -40; dz <= 40; dz++) for (let dx = -40; dx <= 40; dx++) {
    const x = Math.max(0, Math.min(width - 1, best.gridX + dx));
    const z = Math.max(0, Math.min(height - 1, best.gridZ + dz));
    const elevation = continent.heightData[z * width + x];
    if (elevation < lowest) { lowest = elevation; oceanDx = dx; oceanDz = dz; }
  }
  return {
    id: `${zoneId}-shore`,
    label: `${zone.properName} — Starter Beach`,
    x: best.x,
    z: best.z,
    heading: Math.atan2(-oceanDx, -oceanDz),
  };
}

export function buildTraversalBookmarks(
  world: WorldData,
  sampleHeight: (x: number, z: number) => number,
  isWater: (x: number, z: number) => boolean = () => false,
): TraversalBookmark[] {
  const preferred = ["alvora", "valedouro", "serravela", "cavora", "solmara"];
  const bookmarks: TraversalBookmark[] = [];
  for (const id of preferred) {
    const zone = world.zones.find((candidate) => candidate.id === id);
    if (!zone) continue;
    const center = zoneCenter(zone, world);
    const safe = findSafeTraversalPoint(sampleHeight, center.x, center.z);
    bookmarks.push({ id: zone.id, label: `${zone.properName} — ${zone.descriptor}`, ...safe, heading: Math.PI });
  }
  const alvoraShore = findZoneShoreBookmark(world, "alvora");
  if (alvoraShore) bookmarks.splice(1, 0, alvoraShore);
  const seradia = world.continents?.seradia;
  const delta = seradia?.rivers.find((river) => river.mouthKind === "delta");
  if (delta?.path.length) {
    const approachIndex = Math.max(1, delta.path.length - 9);
    const approach = delta.path[approachIndex];
    const previous = delta.path[approachIndex - 1];
    const [approachX, approachZ] = uvToWorld(approach[0], approach[1], "seradia", world.manifest);
    const [previousX, previousZ] = uvToWorld(previous[0], previous[1], "seradia", world.manifest);
    const tangentX = approachX - previousX, tangentZ = approachZ - previousZ;
    const tangentLength = Math.max(1, Math.hypot(tangentX, tangentZ));
    const reviewX = approachX - tangentZ / tangentLength * 85;
    const reviewZ = approachZ + tangentX / tangentLength * 85;
    const safe = findSafeTraversalPoint(sampleHeight, reviewX, reviewZ, 260);
    bookmarks.push({
      id: "solmara-delta",
      label: "Solmara — Delta Mouth",
      ...safe,
      heading: Math.atan2(-(approachX - safe.x), -(approachZ - safe.z)),
      altitudeM: 1_050,
      pitch: -1.02,
    });
  }
  const glassmere = seradia?.lakes[0];
  if (glassmere?.polygon.length) {
    const centerU = glassmere.polygon.reduce((sum, point) => sum + point[0], 0) / glassmere.polygon.length;
    const centerV = glassmere.polygon.reduce((sum, point) => sum + point[1], 0) / glassmere.polygon.length;
    const shore = glassmere.polygon.reduce((best, point) => point[0] < best[0] ? point : best, glassmere.polygon[0]);
    const [centerX, centerZ] = uvToWorld(centerU, centerV, "seradia", world.manifest);
    const [shoreX, shoreZ] = uvToWorld(shore[0], shore[1], "seradia", world.manifest);
    const outwardX = shoreX - centerX, outwardZ = shoreZ - centerZ;
    const outwardLength = Math.max(1, Math.hypot(outwardX, outwardZ));
    const safe = findSafeTraversalPoint(sampleHeight, shoreX + outwardX / outwardLength * 180, shoreZ + outwardZ / outwardLength * 180, 700);
    bookmarks.push({
      id: "vidrala-glassmere",
      label: "Vidrala — Glassmere Lake",
      ...safe,
      heading: Math.atan2(-(centerX - safe.x), -(centerZ - safe.z)),
    });
  }
  const alvora = bookmarks.find((bookmark) => bookmark.id === "alvora");
  if (alvora) {
    const review = findSafeReviewYardPoint(sampleHeight, isWater, alvora.x + 180, alvora.z + 120);
    bookmarks.push({
      id: "alvora-resource-review",
      label: "Alvora — Resource Review Yard",
      ...review,
      heading: 0,
    });
  }
  return bookmarks;
}
