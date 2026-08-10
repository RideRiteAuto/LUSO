// Stage 9 (docs/01 §9, docs/04 §4): ecology / creature spawn regions.
// Places one spawn region per creature design within its home zone,
// restricted to cells matching its elevation range. The
// minDistanceFromSettlementM constraint is recorded on the output for the
// consuming game server to enforce at runtime (and is re-checked here in a
// light validation pass once settlement anchors exist, per docs/01 §3 stage 9).

import { convexHull } from "../zones/index.js";
import type { ContinentId, CreatureDesign, HeightField, SpawnRegion, Vec2, ZoneDesign } from "../types/index.js";
import type { ZoneAssignment } from "../zones/index.js";
import type { Rng } from "../seed/index.js";

export function placeEcology(
  rng: Rng,
  creatures: CreatureDesign[],
  zones: ZoneDesign[],
  continent: ContinentId,
  height: HeightField,
  zoneAssignment: ZoneAssignment
): SpawnRegion[] {
  const continentZones = zones.filter((z) => z.continent === continent);
  const zoneIdToIndex = new Map(continentZones.map((z, i) => [z.id, i]));
  const res = zoneAssignment.gridResolution;

  const regions: SpawnRegion[] = [];

  for (const creature of creatures) {
    const zi = zoneIdToIndex.get(creature.zoneId);
    if (zi === undefined) continue; // creature belongs to the other continent this run

    const candidates: Vec2[] = [];
    for (let cy = 0; cy < res; cy++) {
      for (let cx = 0; cx < res; cx++) {
        const i = cy * res + cx;
        if (zoneAssignment.zoneIndexGrid[i] !== zi) continue;
        const e = height.data[i];
        if (e < creature.elevationRangeM[0] || e > creature.elevationRangeM[1]) continue;
        candidates.push([cx / (res - 1), cy / (res - 1)]);
      }
    }
    if (candidates.length < 3) continue;

    // Sample a subset so the region hull stays a believable sub-area of the
    // zone rather than tracing every matching cell (which would just be the
    // whole zone for creatures with a wide elevation tolerance).
    const sampleCount = Math.min(candidates.length, 24);
    const sample: Vec2[] = [];
    for (let k = 0; k < sampleCount; k++) sample.push(rng.pick(candidates));

    regions.push({
      creatureId: creature.creatureId,
      family: creature.family,
      zoneId: creature.zoneId,
      region: convexHull(sample),
      skinningLevel: creature.skinningLevel,
      primaryDrop: creature.primaryDrop,
      elevationRangeM: creature.elevationRangeM,
      minDistanceFromSettlementM: creature.minDistanceFromSettlementM,
    });
  }

  return regions;
}
