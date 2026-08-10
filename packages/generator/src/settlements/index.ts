// Stage 10 (docs/01 §10, docs/03 §4): settlement anchors.
// Placed BEFORE roads, from water access + resource proximity + defense,
// per the master prompt's "Settlement Logic" section. For zones where the
// bible specifies housing districts (Bands 1-4), one anchor is derived per
// district, nudged toward water for maritime/merchant districts since the
// bible ties their value directly to river-mouth/harbor/canal access. Zones
// without bible-specified districts (Bands 5-8) get a single generic anchor
// near the zone center, explicitly lower-confidence (docs/03 §6).

import type { ContinentId, HeightField, ResolvedZone, SettlementAnchor, Vec2 } from "../types/index.js";
import type { Rng } from "../seed/index.js";

const MARITIME_KINDS = new Set(["maritime", "merchant", "fortified-merchant"]);

function isWaterAdjacent(height: HeightField, cx: number, cy: number): boolean {
  const { width, height: h, data } = height;
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
    const nx = cx + dx;
    const ny = cy + dy;
    if (nx < 0 || ny < 0 || nx >= width || ny >= h) continue;
    if (data[ny * width + nx] <= 0) return true;
  }
  return false;
}

function nudgeTowardWater(height: HeightField, anchor: Vec2, searchRadiusCells: number): Vec2 {
  const res = height.width;
  const cx0 = Math.round(anchor[0] * (res - 1));
  const cy0 = Math.round(anchor[1] * (res - 1));
  let best: [number, number] | null = null;
  let bestDist = Infinity;

  for (let dy = -searchRadiusCells; dy <= searchRadiusCells; dy++) {
    for (let dx = -searchRadiusCells; dx <= searchRadiusCells; dx++) {
      const cx = cx0 + dx;
      const cy = cy0 + dy;
      if (cx < 0 || cy < 0 || cx >= res || cy >= height.height) continue;
      const e = height.data[cy * res + cx];
      if (e <= 0) continue; // must stay on land
      if (!isWaterAdjacent(height, cx, cy)) continue;
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) {
        bestDist = dist;
        best = [cx, cy];
      }
    }
  }

  if (!best) return anchor;
  return [best[0] / (res - 1), best[1] / (height.height - 1)];
}

function tierForKind(kind: string, band: number): 1 | 2 | 3 | 4 {
  if (MARITIME_KINDS.has(kind)) return band <= 4 ? 1 : 2;
  if (kind === "mining" || kind === "industry") return 2;
  return band <= 2 ? 2 : 3;
}

function reasonForKind(kind: string): string {
  switch (kind) {
    case "maritime": return "coastal access and fishing grounds";
    case "merchant": return "protected water access + trade route intersection";
    case "fortified-merchant": return "strategic chokepoint with logistical value";
    case "mining": return "proximity to mineral extraction";
    case "farmland": return "fertile, low-danger agricultural land";
    case "rustic": return "convenient for woodcutting, foraging, and hunting";
    case "industry": return "positioned between managed resources and the road network";
    default: return "generic placement pending design pass";
  }
}

export function placeSettlements(rng: Rng, resolvedZones: ResolvedZone[], continent: ContinentId, height: HeightField): SettlementAnchor[] {
  const anchors: SettlementAnchor[] = [];

  for (const zone of resolvedZones.filter((z) => z.continent === continent)) {
    if (zone.housingDistricts && zone.housingDistricts.length > 0) {
      for (const district of zone.housingDistricts) {
        const nudged = MARITIME_KINDS.has(district.kind) ? nudgeTowardWater(height, district.anchor, 40) : district.anchor;
        anchors.push({
          id: `${zone.id}-${district.kind}-${anchors.length}`,
          name: null,
          tier: tierForKind(district.kind, zone.band),
          type: district.kind,
          reason: `${district.name}: ${reasonForKind(district.kind)}`,
          position: nudged,
          zoneId: zone.id,
        });
      }
    } else {
      // Fallback for zones without bible-specified housing detail (Bands 5-8).
      anchors.push({
        id: `${zone.id}-generic-settlement`,
        name: null,
        tier: 3,
        type: "settlement",
        reason: "generic placement pending design pass (docs/03 §6)",
        position: zone.boundary[0] ?? [0.5, 0.5],
        zoneId: zone.id,
      });
    }
  }

  return anchors;
}
