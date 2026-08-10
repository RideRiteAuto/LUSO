// Stage 7 (docs/01 §7, docs/04 §2): biome classification.
// elevation + moisture + temperature + zone override -> biome index.
// Zone overrides come from zones.json's biomeHints and are given a scoring
// bonus so a zone's declared identity wins ties against the generic rule,
// without ever overriding physically implausible combinations (e.g. a
// "luminous-basin" hint won't win at -50m in open ocean).

import { BIOMES, BIOME_INDEX } from "./palette.js";
import type { ClimateFields } from "../climate/index.js";
import type { HeightField, ScalarField } from "../types/index.js";
import type { ZoneAssignment } from "../zones/index.js";
import type { ZoneDesign, ContinentId } from "../types/index.js";

function inRange(value: number, [min, max]: [number, number]): boolean {
  return value >= min && value <= max;
}

export function classifyBiomes(
  height: HeightField,
  climate: ClimateFields,
  zoneAssignment: ZoneAssignment,
  zones: ZoneDesign[],
  continent: ContinentId
): ScalarField {
  const { width, height: h, data: elev } = height;
  const n = width * h;
  const out = new Float32Array(n);

  const continentZones = zones.filter((z) => z.continent === continent);
  const oceanIdx = BIOME_INDEX["ocean"];
  const beachIdx = BIOME_INDEX["beach"];

  for (let i = 0; i < n; i++) {
    const e = elev[i];
    if (e <= 0) {
      out[i] = oceanIdx;
      continue;
    }
    if (e <= 5) {
      out[i] = beachIdx;
      continue;
    }

    const temp = climate.temperatureC.data[i];
    const moist = climate.moisture.data[i];
    const zoneIdx = zoneAssignment.zoneIndexGrid[i];
    const zoneHints = zoneIdx >= 0 ? continentZones[zoneIdx]?.biomeHints ?? [] : [];

    let bestScore = -Infinity;
    let bestBiomeIdx = BIOME_INDEX["temperate-woodland"];

    for (let bi = 0; bi < BIOMES.length; bi++) {
      const b = BIOMES[bi];
      if (b.id === "ocean" || b.id === "beach") continue;
      if (!inRange(e, b.elevationM) || !inRange(moist, b.moisture) || !inRange(temp, b.temperatureC)) continue;

      // Score: how centered the cell is within this biome's ranges (closer to
      // the middle of each range scores higher), plus a zone-hint bonus.
      const elevMid = (b.elevationM[0] + b.elevationM[1]) / 2;
      const elevSpan = Math.max(1, b.elevationM[1] - b.elevationM[0]);
      const moistMid = (b.moisture[0] + b.moisture[1]) / 2;
      const moistSpan = Math.max(0.01, b.moisture[1] - b.moisture[0]);

      let score = 1 - Math.abs(e - elevMid) / elevSpan - Math.abs(moist - moistMid) / moistSpan;
      if (zoneHints.includes(b.id)) score += 2; // strong bias toward the zone's declared identity

      if (score > bestScore) {
        bestScore = score;
        bestBiomeIdx = bi;
      }
    }

    out[i] = bestBiomeIdx;
  }

  return { width, height: h, data: out };
}
