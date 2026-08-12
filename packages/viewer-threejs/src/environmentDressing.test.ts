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
  for (let i = 0; i < 80; i++) { a.update(0, 0); b.update(0, 0); }
  const { lastStreamMs: _aLast, maxStreamMs: _aMax, ...aDeterministic } = a.stats;
  const { lastStreamMs: _bLast, maxStreamMs: _bMax, ...bDeterministic } = b.stats;
  assert.deepEqual(aDeterministic, bDeterministic);
  assert.ok(a.stats.cells > 0 && a.stats.cells <= 64);
  assert.ok(a.stats.instances > 0);
  a.update(2000, 2000);
  assert.ok(a.stats.cells <= 64);
  a.dispose(); b.dispose();
});

test("dressing can be disabled without changing generated state", () => {
  const dressing = new EnvironmentDressing(world, () => 30, "compatibility");
  for (let i = 0; i < 40; i++) dressing.update(0, 0);
  const before = dressing.stats;
  dressing.setEnabled(false);
  dressing.update(1000, 1000);
  assert.deepEqual(dressing.stats, before);
  assert.equal(dressing.group.visible, false);
  dressing.dispose();
});

test("streaming keeps deterministic records stable across cell boundaries", () => {
  const dressing = new EnvironmentDressing(world, (x, z) => 20 + x * 0.002 + z * 0.001, "balanced");
  for (let i = 0; i < 80; i++) dressing.update(0, 0);
  const before = dressing.stats.instances;
  dressing.update(120, 0);
  assert.ok(dressing.stats.instances >= before * 0.9, "old cells remain while replacements stream");
  assert.ok(dressing.stats.queued > 0, "streaming work is budgeted across frames");
  for (let i = 0; i < 80; i++) dressing.update(120, 0);
  assert.equal(dressing.stats.queued, 0);
  assert.ok(dressing.stats.maxStreamMs < 100, "incremental streaming avoids whole-bubble rebuild stalls");
  dressing.dispose();
});
