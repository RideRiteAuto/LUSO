import test from "node:test";
import assert from "node:assert/strict";
import { NAVORA_OCEAN_WAVES, NAVIGABLE_WATER_DEPTH_M, OCEAN_RENDER_EXTENT_M, OCEAN_RIVER_HANDOFF_M, sampleOceanWaves } from "./waterSystem.js";

test("ocean spectrum is deterministic, bounded, and normalized", () => {
  const a = sampleOceanWaves(12_345.5, 6_789.25, 42.125);
  const b = sampleOceanWaves(12_345.5, 6_789.25, 42.125);
  assert.deepEqual(a, b);
  const maximumAmplitude = NAVORA_OCEAN_WAVES.reduce((total, wave) => total + wave.amplitude, 0);
  assert.ok(Math.abs(a.surfaceY) <= maximumAmplitude + 1e-6);
  assert.ok(Math.abs(Math.hypot(a.normalX, a.normalY, a.normalZ) - 1) < 1e-6);
  assert.ok(NAVORA_OCEAN_WAVES.every((wave) => wave.wavelength > 0 && wave.amplitude > 0));
});

test("ocean phase changes continuously and the navigable depth supports real craft", () => {
  const before = sampleOceanWaves(800, 1200, 8);
  const after = sampleOceanWaves(800, 1200, 8.016);
  assert.ok(Math.abs(after.surfaceY - before.surfaceY) < 0.05);
  assert.notEqual(after.surfaceY, before.surfaceY);
  // Waterway channel beds (11 m) must clear the navigable-depth rule so the
  // whole authored network reads as ship water.
  assert.ok(NAVIGABLE_WATER_DEPTH_M >= 7 && NAVIGABLE_WATER_DEPTH_M <= 11);
});

test("single-surface shoreline swell remains gentle enough for hull stability", () => {
  const quarterCycle = Math.PI / (2 * 0.92);
  const crest = sampleOceanWaves(0, 0, quarterCycle);
  const sameLocationWithoutSwell = NAVORA_OCEAN_WAVES.reduce((height, wave) => height + Math.sin(quarterCycle * wave.speed) * wave.amplitude, 0);
  assert.ok(Math.abs((crest.surfaceY - sameLocationWithoutSwell) - 0.22) < 1e-6);
});

test("camera-relative ocean extends beyond the fully fogged overview horizon", () => {
  const overviewFogEndM = 280_000;
  assert.ok(OCEAN_RENDER_EXTENT_M * 0.5 > overviewFogEndM);
});

test("ocean fills the lower estuary without an overlapping river sheet", () => {
  const completeWaveEnvelope = NAVORA_OCEAN_WAVES.reduce((total, wave) => total + wave.amplitude, 0) + 0.22;
  assert.ok(OCEAN_RIVER_HANDOFF_M > completeWaveEnvelope);
});
