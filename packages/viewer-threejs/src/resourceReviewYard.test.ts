import test from "node:test";
import assert from "node:assert/strict";
import { ResourceReviewYard } from "./resourceReviewYard.js";

test("review yard contains three variants per Phase 2 family within its scene budget", () => {
  const yard = new ResourceReviewYard((x, z) => 10 + x * 0.001 + z * 0.002);
  yard.setAnchor({ x: 500, z: 800 });
  assert.equal(yard.stats.variants, 12);
  assert.ok(yard.stats.triangles > 55_000 && yard.stats.triangles < 80_000);
  assert.ok(yard.stats.draws <= 18);
  assert.ok(yard.group.children.every((child) => child.position.y > 10));
  yard.dispose();
});
