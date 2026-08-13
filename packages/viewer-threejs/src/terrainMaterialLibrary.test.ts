import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateTerrainMaterialLibrary,
  validateTerrainMaterialRecipes,
  type ControlFieldManifest,
  type TerrainMaterialLibrary,
  type TerrainMaterialRecipeLibrary,
} from "./worldData.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const library = JSON.parse(readFileSync(path.join(repoRoot, "data", "design", "terrain-materials.json"), "utf8")) as TerrainMaterialLibrary;
const recipes = JSON.parse(readFileSync(path.join(repoRoot, "data", "design", "terrain-recipes.json"), "utf8")) as TerrainMaterialRecipeLibrary;
const controls = {
  version: 1,
  encoding: "rgba8",
  packs: [{ id: "habitat", channels: [
    { field: "resource-reeds", kind: "continuous", min: 0, max: 1 },
    { field: "resource-aquatic", kind: "continuous", min: 0, max: 1 },
    { field: "resource-generic", kind: "continuous", min: 0, max: 1 },
    { field: "zone-class", kind: "category", min: 0, max: 16, labels: ["ocean-unclaimed", ...recipes.zoneOrder] },
  ] }],
  continents: {},
} as ControlFieldManifest;

test("viewer accepts the canonical terrain material library", () => {
  assert.equal(validateTerrainMaterialLibrary(library), library);
});

test("viewer rejects incomplete terrain residency profiles", () => {
  const invalid = structuredClone(library);
  delete invalid.residencyProfiles.compatibility.channelsByTextureSet.grass;
  assert.throws(() => validateTerrainMaterialLibrary(invalid), /grass\/albedo/);
});

test("viewer accepts recipes aligned to the compiler zone-class contract", () => {
  assert.equal(validateTerrainMaterialRecipes(recipes, library, controls), recipes);
});

test("viewer rejects recipes when the compiler zone-class order diverges", () => {
  const invalidControls = structuredClone(controls);
  invalidControls.packs[0].channels[3].labels!.reverse();
  assert.throws(() => validateTerrainMaterialRecipes(recipes, library, invalidControls), /zone-class/);
});
