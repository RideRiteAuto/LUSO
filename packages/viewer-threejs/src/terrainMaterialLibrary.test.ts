import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateTerrainMaterialLibrary, type TerrainMaterialLibrary } from "./worldData.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const library = JSON.parse(readFileSync(path.join(repoRoot, "data", "design", "terrain-materials.json"), "utf8")) as TerrainMaterialLibrary;

test("viewer accepts the canonical terrain material library", () => {
  assert.equal(validateTerrainMaterialLibrary(library), library);
});

test("viewer rejects incomplete terrain residency profiles", () => {
  const invalid = structuredClone(library);
  delete invalid.residencyProfiles.compatibility.channelsByTextureSet.grass;
  assert.throws(() => validateTerrainMaterialLibrary(invalid), /grass\/albedo/);
});
