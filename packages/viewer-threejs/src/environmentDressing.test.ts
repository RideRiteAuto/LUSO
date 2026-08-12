import test from "node:test";
import assert from "node:assert/strict";
import { EnvironmentDressing } from "./environmentDressing.js";

const world = {
  manifest: { seed: 48291, worldScale: { continentTileSize: 65536 }, continents: [], continentLayout: {} },
  zones: [], settlements: [], seaRegions: [], continents: {},
} as any;

test("dressing placement is deterministic and bounded", () => {
  const a = new EnvironmentDressing(world, (x, z) => 20 + Math.sin(x * 0.01) + Math.cos(z * 0.01), "balanced");
  const b = new EnvironmentDressing(world, (x, z) => 20 + Math.sin(x * 0.01) + Math.cos(z * 0.01), "balanced");
  a.update(0, 0); b.update(0, 0);
  assert.deepEqual(a.stats, b.stats);
  assert.ok(a.stats.cells > 0 && a.stats.cells <= 64);
  assert.ok(a.stats.instances > 0);
  a.update(2000, 2000);
  assert.ok(a.stats.cells <= 64);
  a.dispose(); b.dispose();
});

test("dressing can be disabled without changing generated state", () => {
  const dressing = new EnvironmentDressing(world, () => 30, "compatibility");
  dressing.update(0, 0);
  const before = dressing.stats;
  dressing.setEnabled(false);
  dressing.update(1000, 1000);
  assert.deepEqual(dressing.stats, before);
  assert.equal(dressing.group.visible, false);
  dressing.dispose();
});
