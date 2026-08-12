import type { WorldData, ZoneRecord } from "./worldData.js";
import { uvToWorld } from "./layout.js";

export interface TraversalBookmark {
  id: string;
  label: string;
  x: number;
  z: number;
  heading: number;
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

export function buildTraversalBookmarks(world: WorldData, sampleHeight: (x: number, z: number) => number): TraversalBookmark[] {
  const preferred = ["alvora", "valedouro", "serravela", "cavora", "solmara"];
  const bookmarks: TraversalBookmark[] = [];
  for (const id of preferred) {
    const zone = world.zones.find((candidate) => candidate.id === id);
    if (!zone) continue;
    const center = zoneCenter(zone, world);
    const safe = findSafeTraversalPoint(sampleHeight, center.x, center.z);
    bookmarks.push({ id: zone.id, label: `${zone.properName} — ${zone.descriptor}`, ...safe, heading: Math.PI });
  }
  const alvora = bookmarks.find((bookmark) => bookmark.id === "alvora");
  if (alvora) {
    const review = findSafeTraversalPoint(sampleHeight, alvora.x + 180, alvora.z + 120, 240);
    bookmarks.push({
      id: "alvora-resource-review",
      label: "Alvora — Resource Review Yard",
      ...review,
      heading: Math.PI * 1.25,
    });
  }
  return bookmarks;
}
