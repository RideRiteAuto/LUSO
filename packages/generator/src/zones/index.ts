// Stage 6 (docs/01 §6): zone resolution.
// Assigns every grid cell to the nearest zone anchor (radius-weighted,
// continent-constrained), then derives an approximate boundary polygon
// (convex hull of the assignment's edge cells) and per-zone climate
// summary. Boundaries are intentionally approximate for this first pass —
// snapping them to ridgelines/rivers is a documented follow-up (docs/01 §6).

import type { ClimateFields } from "../climate/index.js";
import type { ContinentId, ResolvedZone, Vec2, ZoneDesign } from "../types/index.js";
import type { Rng } from "../seed/index.js";

export function convexHull(points: Vec2[]): Vec2[] {
  if (points.length < 3) return points;
  const pts = [...points].sort((a, b) => (a[0] === b[0] ? a[1] - b[1] : a[0] - b[0]));
  const cross = (o: Vec2, a: Vec2, b: Vec2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

  const lower: Vec2[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Vec2[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

export interface ZoneAssignment {
  /** grid-resolution zone-id index per cell, per continent (-1 = unclaimed) */
  zoneIndexGrid: Int16Array;
  gridResolution: number;
}

export function assignZones(zones: ZoneDesign[], continent: ContinentId, resolution: number): ZoneAssignment {
  const continentZones = zones.filter((z) => z.continent === continent);
  const grid = new Int16Array(resolution * resolution).fill(-1);

  for (let y = 0; y < resolution; y++) {
    const v = y / (resolution - 1);
    for (let x = 0; x < resolution; x++) {
      const u = x / (resolution - 1);
      let best = -1;
      let bestScore = Infinity;
      for (let zi = 0; zi < continentZones.length; zi++) {
        const z = continentZones[zi];
        const dx = u - z.anchor[0];
        const dy = v - z.anchor[1];
        const dist = Math.sqrt(dx * dx + dy * dy);
        const score = dist / z.radius; // radius-normalized distance
        if (score < bestScore) {
          bestScore = score;
          best = zi;
        }
      }
      grid[y * resolution + x] = best;
    }
  }

  return { zoneIndexGrid: grid, gridResolution: resolution };
}

export function resolveZones(
  zones: ZoneDesign[],
  continent: ContinentId,
  assignment: ZoneAssignment,
  climate: ClimateFields,
  rng: Rng
): ResolvedZone[] {
  const continentZones = zones.filter((z) => z.continent === continent);
  const { zoneIndexGrid, gridResolution: res } = assignment;

  const results: ResolvedZone[] = [];

  for (let zi = 0; zi < continentZones.length; zi++) {
    const design = continentZones[zi];
    const edgePoints: Vec2[] = [];
    let tempSum = 0;
    let moistSum = 0;
    let count = 0;

    for (let y = 0; y < res; y++) {
      for (let x = 0; x < res; x++) {
        const i = y * res + x;
        if (zoneIndexGrid[i] !== zi) continue;
        count++;
        tempSum += climate.temperatureC.data[i];
        moistSum += climate.moisture.data[i];

        const isEdge =
          x === 0 || y === 0 || x === res - 1 || y === res - 1 ||
          zoneIndexGrid[i - 1] !== zi || zoneIndexGrid[i + 1] !== zi ||
          zoneIndexGrid[i - res] !== zi || zoneIndexGrid[i + res] !== zi;

        if (isEdge) edgePoints.push([x / (res - 1), y / (res - 1)]);
      }
    }

    const boundary = convexHull(edgePoints.length >= 3 ? edgePoints : [
      [design.anchor[0] - design.radius, design.anchor[1] - design.radius],
      [design.anchor[0] + design.radius, design.anchor[1] - design.radius],
      [design.anchor[0], design.anchor[1] + design.radius],
    ]);

    const housingDistricts = design.housingDistricts?.map((d, idx) => {
      const angle = (idx / Math.max(1, design.housingDistricts!.length)) * Math.PI * 2;
      const r = design.radius * 0.45;
      const anchor: Vec2 = [design.anchor[0] + Math.cos(angle) * r, design.anchor[1] + Math.sin(angle) * r];
      return { name: d.name, kind: d.kind, anchor };
    });

    const loreBreadcrumb = design.loreBreadcrumb
      ? {
          type: design.loreBreadcrumb.type,
          notes: design.loreBreadcrumb.notes,
          anchor: [
            design.anchor[0] + Math.cos(rng.range(0, Math.PI * 2)) * design.radius * 0.7,
            design.anchor[1] + Math.sin(rng.range(0, Math.PI * 2)) * design.radius * 0.7,
          ] as Vec2,
        }
      : undefined;

    results.push({
      id: design.id,
      properName: design.properName,
      descriptor: design.descriptor,
      continent: design.continent,
      band: design.band,
      approxLevelRange: design.approxLevelRange,
      boundary,
      biomeSummary: design.biomeHints,
      climate: {
        avgTemperatureC: count > 0 ? Math.round((tempSum / count) * 10) / 10 : 0,
        avgMoisture: count > 0 ? Math.round((moistSum / count) * 100) / 100 : 0,
      },
      housingDistricts,
      loreBreadcrumb,
    });
  }

  return results;
}
