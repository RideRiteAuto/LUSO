import test from "node:test";
import assert from "node:assert/strict";
import { buildResourceModel, disposeResourceModel, type ResourceFamilyId, type ResourceLod } from "./resourceModels.js";

const families: ResourceFamilyId[] = ["pine", "birch", "copper", "tin", "stone", "redberry"];
const budgets: Record<ResourceFamilyId, [[number, number], [number, number], [number, number]]> = {
  pine: [[3500, 7000], [1500, 3000], [300, 800]],
  birch: [[8000, 14000], [2200, 5000], [400, 1200]],
  copper: [[2500, 6000], [700, 1800], [120, 400]],
  tin: [[2500, 6000], [700, 1800], [120, 400]],
  stone: [[2500, 6000], [700, 1800], [120, 400]],
  redberry: [[1200, 3000], [400, 900], [150, 400]],
};

test("resource families produce deterministic, decreasing LOD geometry within budget", () => {
  for (const family of families) {
    for (let variant = 0; variant < 3; variant++) {
      const counts: number[] = [];
      for (let lod = 0; lod < 3; lod++) {
        const model = buildResourceModel(family, variant, lod as ResourceLod);
        const duplicate = buildResourceModel(family, variant, lod as ResourceLod);
        assert.equal(model.info.triangles, duplicate.info.triangles);
        assert.equal(model.info.height, duplicate.info.height);
        assert.ok(model.info.triangles >= budgets[family][lod][0], `${family} v${variant} LOD${lod} below budget`);
        assert.ok(model.info.triangles <= budgets[family][lod][1], `${family} v${variant} LOD${lod} above budget: ${model.info.triangles}`);
        assert.ok(model.info.materials >= 1 && model.info.materials <= 2);
        assert.ok(model.info.height > 0);
        counts.push(model.info.triangles);
        disposeResourceModel(model.group); disposeResourceModel(duplicate.group);
      }
      assert.ok(counts[0] > counts[1] && counts[1] > counts[2], `${family} LODs must decrease`);
    }
  }
});

test("resource families have three visibly different primary bounds", () => {
  for (const family of families) {
    const heights = [0, 1, 2].map((variant) => {
      const model = buildResourceModel(family, variant, 1);
      const height = model.info.height;
      disposeResourceModel(model.group);
      return height;
    });
    assert.ok(new Set(heights.map((height) => height.toFixed(2))).size === 3, `${family} variants need distinct stature`);
  }
});
