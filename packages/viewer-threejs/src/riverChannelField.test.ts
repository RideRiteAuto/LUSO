import test from "node:test";
import assert from "node:assert/strict";
import { sampleRiverCarvedHeight, type RiverChannelField } from "./riverChannelField.js";

const field: RiverChannelField = {
  // One 100 m segment. Surface rises 9 -> 10 m, width 200 m,
  // and the navigable bed is twelve metres below the surface.
  segments: new Float32Array([0, 0, 100, 0, 9, 10, 200, 200, 12, 12]),
  offsets: new Uint32Array([0, 1]),
  indices: new Uint32Array([0]),
  minX: -256,
  minZ: -256,
  gridWidth: 1,
  gridHeight: 1,
  cellSize: 512,
};

test("river terrain brush creates a deep bed and sloped banks", () => {
  const center = sampleRiverCarvedHeight(field, 50, 0, 50);
  const waterSurface = 9.5;
  assert.ok(Math.abs(center - (waterSurface - 12)) < 1e-6);

  const channelEdge = sampleRiverCarvedHeight(field, 50, 100, 50);
  assert.ok(channelEdge > center);
  assert.ok(channelEdge < waterSurface);

  const outerBank = sampleRiverCarvedHeight(field, 50, 230, 50);
  assert.ok(outerBank > channelEdge);
});

test("river terrain brush leaves terrain outside its watershed reach unchanged", () => {
  assert.equal(sampleRiverCarvedHeight(field, 50, 400, 50), 50);
  assert.equal(sampleRiverCarvedHeight(field, 800, 0, 50), 50);
});
