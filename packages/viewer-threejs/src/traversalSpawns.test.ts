import test from "node:test";
import assert from "node:assert/strict";
import { findSafeTraversalPoint } from "./traversalSpawns.js";

test("safe traversal selection rejects water and steep terrain", () => {
  const sample = (x: number, z: number) => x < 50 ? -2 : 12 + Math.sin(z * 0.001);
  const point = findSafeTraversalPoint(sample, 0, 0, 500);
  assert.ok(point.x >= 50);
  assert.ok(sample(point.x, point.z) > 3);
});
