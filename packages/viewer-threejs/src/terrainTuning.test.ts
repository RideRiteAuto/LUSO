import test from "node:test";
import assert from "node:assert/strict";
import { defaultTerrainRenderTuning } from "./terrainStreaming.js";

test("terrain tuning defaults favor visible detail over the old short fade", () => {
  const compatibility = defaultTerrainRenderTuning("compatibility");
  const high = defaultTerrainRenderTuning("high");
  assert.ok(compatibility.highDetailDistanceM >= 5_000);
  assert.ok(compatibility.midDetailDistanceM > compatibility.highDetailDistanceM);
  assert.ok(compatibility.drawDistanceM < 18_000);
  assert.ok(compatibility.meshDetailPercent > 100);
  assert.ok(high.highDetailDistanceM > compatibility.highDetailDistanceM);
  assert.ok(high.drawDistanceM > compatibility.drawDistanceM);
});
