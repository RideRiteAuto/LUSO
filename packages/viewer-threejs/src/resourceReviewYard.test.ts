import test from "node:test";
import assert from "node:assert/strict";
import { ResourceReviewYard } from "./resourceReviewYard.js";

test("review yard contains three variants per locked starter family within its scene budget", async () => {
  const yard = await ResourceReviewYard.create((x, z) => 10 + x * 0.001 + z * 0.002);
  yard.setAnchor({ x: 500, z: 800 });
  assert.equal(yard.stats.variants, 18);
  assert.ok(yard.stats.triangles > 90_000 && yard.stats.triangles < 115_000);
  assert.ok(yard.stats.draws <= 36);
  assert.ok(yard.group.children.every((child) => child.position.y > 10));
  yard.visible = true;
  const before = yard.group.children.map((child) => child.children.map((part) => part.rotation.z));
  yard.updateWind(3.25);
  assert.ok(yard.group.children.some((child, index) => child.children.some((part, partIndex) => part.rotation.z !== before[index][partIndex])));
  yard.dispose();
});
