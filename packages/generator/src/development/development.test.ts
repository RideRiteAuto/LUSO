import test from "node:test";
import assert from "node:assert/strict";
import { refineHousingSuitability } from "./index.js";
import type { EnvironmentalFields, ScalarField } from "../types/index.js";

const size = 21;
const scalar = (value: number): ScalarField => ({ width: size, height: size, data: new Float32Array(size * size).fill(value) });

test("housing suitability rewards infrastructure and rejects cliffs and deep flood risk", () => {
  const environment = {
    temperatureC: scalar(14), precipitation: scalar(0.5), moisture: scalar(0.5), wetness: scalar(0.35),
    drainage: scalar(0.35), distanceToWaterM: scalar(1_200), shorelineInfluence: scalar(0), slopeDegrees: scalar(4),
    exposure: scalar(0.35), erosionScree: scalar(0), buildability: scalar(0.62), vegetationEligibility: scalar(0.6),
    soilClass: scalar(3), geologyClass: scalar(2), weatherRegionClass: scalar(1), zoneClass: scalar(1),
    resources: { forest: scalar(0.5), forage: scalar(0.5), ore: scalar(0.3), stone: scalar(0.3), reeds: scalar(0.1), aquatic: scalar(0.1), generic: scalar(0.5) },
  } satisfies EnvironmentalFields;
  const cliff = 10 * size + 4, swamp = 10 * size + 16;
  environment.slopeDegrees.data[cliff] = 42;
  environment.wetness.data[swamp] = 0.99;
  environment.drainage.data[swamp] = 0.99;
  environment.distanceToWaterM.data[swamp] = 40;
  const result = refineHousingSuitability({
    continentTileSize: 20_000,
    height: { width: size, height: size, data: new Float32Array(size * size).fill(120) },
    environment,
    roads: [{ id: "road", kind: "road", connects: ["a", "b"], bridges: [], path: [[0.2, 0.5], [0.8, 0.5]] }],
    settlements: [{ id: "a", name: "A", tier: 2, type: "town", reason: "test", position: [0.5, 0.5], zoneId: "alvora" }],
    resources: [{ resourceId: "STONE", profession: "mining", unlockLevel: 1, instances: [{ position: [0.55, 0.5], zoneId: "alvora", elevationM: 120, density: "medium" }] }],
    continentZoneIds: new Set(["alvora"]),
  });
  const corridor = result.data[10 * size + 10];
  const remote = result.data[1 * size + 1];
  assert.ok(corridor > remote + 0.12, `infrastructure corridor ${corridor} should beat remote land ${remote}`);
  assert.equal(result.data[cliff], 0);
  assert.equal(result.data[swamp], 0);
});
