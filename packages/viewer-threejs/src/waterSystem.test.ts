import test from "node:test";
import assert from "node:assert/strict";
import { NAVORA_OCEAN_WAVES, NAVIGABLE_RIVER_WIDTH_M, sampleOceanWaves } from "./waterSystem.js";

test("ocean spectrum is deterministic, bounded, and normalized", () => {
  const a = sampleOceanWaves(12_345.5, 6_789.25, 42.125);
  const b = sampleOceanWaves(12_345.5, 6_789.25, 42.125);
  assert.deepEqual(a, b);
  const maximumAmplitude = NAVORA_OCEAN_WAVES.reduce((total, wave) => total + wave.amplitude, 0);
  assert.ok(Math.abs(a.surfaceY) <= maximumAmplitude + 1e-6);
  assert.ok(Math.abs(Math.hypot(a.normalX, a.normalY, a.normalZ) - 1) < 1e-6);
  assert.ok(NAVORA_OCEAN_WAVES.every((wave) => wave.wavelength > 0 && wave.amplitude > 0));
});

test("ocean phase changes continuously and navigable river threshold supports real craft", () => {
  const before = sampleOceanWaves(800, 1200, 8);
  const after = sampleOceanWaves(800, 1200, 8.016);
  assert.ok(Math.abs(after.surfaceY - before.surfaceY) < 0.05);
  assert.notEqual(after.surfaceY, before.surfaceY);
  assert.ok(NAVIGABLE_RIVER_WIDTH_M >= 15);
});
