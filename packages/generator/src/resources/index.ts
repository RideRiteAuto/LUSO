// Stage 8 (docs/01 §8): resource placement.
// For each resource design, sample candidate cells within its allowed zones
// that satisfy elevation + biome-affinity constraints, then place a
// density-scaled number of instances. Implements the bible's "overlapping
// progression" rule implicitly: a resource's allowedZones already include
// both its introducing zone and later zones per data/design/resources.json.

import { BIOME_INDEX } from "../biomes/palette.js";
import type { Rng } from "../seed/index.js";
import type { ContinentId, HeightField, PlacedResource, ResourceDesign, ScalarField, Vec2, ZoneDesign } from "../types/index.js";
import type { ZoneAssignment } from "../zones/index.js";

const DENSITY_COUNT: Record<ResourceDesign["density"], number> = {
  sparse: 6,
  medium: 14,
  dense: 26,
};

export function placeResources(
  rng: Rng,
  resourceDesigns: ResourceDesign[],
  zones: ZoneDesign[],
  continent: ContinentId,
  height: HeightField,
  biomes: ScalarField,
  zoneAssignment: ZoneAssignment
): PlacedResource[] {
  const continentZones = zones.filter((z) => z.continent === continent);
  const zoneIdToIndex = new Map(continentZones.map((z, i) => [z.id, i]));
  const res = zoneAssignment.gridResolution;

  const results: PlacedResource[] = [];

  for (const design of resourceDesigns) {
    const relevantZoneIndices = design.allowedZones
      .map((id) => zoneIdToIndex.get(id))
      .filter((v): v is number => v !== undefined);
    if (relevantZoneIndices.length === 0) continue;

    const instances: PlacedResource["instances"] = [];
    const biomeAffinityIdx = design.biomeAffinity?.map((id) => BIOME_INDEX[id]).filter((v) => v !== undefined);

    for (const zi of relevantZoneIndices) {
      const zoneDesign = continentZones[zi];
      const candidates: number[] = [];
      for (let cy = 0; cy < res; cy++) {
        for (let cx = 0; cx < res; cx++) {
          const i = cy * res + cx;
          if (zoneAssignment.zoneIndexGrid[i] !== zi) continue;
          const e = height.data[i];
          if (e <= 0) continue;
          if (design.elevationRangeM && (e < design.elevationRangeM[0] || e > design.elevationRangeM[1])) continue;
          if (biomeAffinityIdx && biomeAffinityIdx.length > 0 && !biomeAffinityIdx.includes(biomes.data[i])) continue;
          candidates.push(i);
        }
      }
      if (candidates.length === 0) continue;

      const count = Math.min(DENSITY_COUNT[design.density], Math.ceil(candidates.length / 40));
      for (let k = 0; k < count; k++) {
        const i = rng.pick(candidates);
        const cx = i % res;
        const cy = Math.floor(i / res);
        const position: Vec2 = [cx / (res - 1), cy / (res - 1)];
        instances.push({
          position,
          zoneId: zoneDesign.id,
          elevationM: Math.round(height.data[i]),
          density: design.density,
        });
      }
    }

    if (instances.length > 0) {
      results.push({
        resourceId: design.resourceId,
        profession: design.profession,
        unlockLevel: design.unlockLevel,
        instances,
      });
    }
  }

  return results;
}
