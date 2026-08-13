import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadTerrainMaterialLibrary } from "./designData.js";
import { generateWorld } from "./pipeline.js";
import { writeWorldOutput } from "./export/index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

test("terrain material library defines a bounded semantic vocabulary over complete CC0 PBR sets", () => {
  const library = loadTerrainMaterialLibrary();
  assert.equal(library.version, 1);
  assert.equal(library.textureSets.length, 7);
  assert.equal(library.families.length, 33);
  const provenance = JSON.parse(readFileSync(path.join(repoRoot, "packages", "viewer-threejs", "assets", "terrain", "source", "PROVENANCE.json"), "utf8")) as {
    license: string;
    assets: Record<string, { id: string; provider: string; url: string }>;
  };
  assert.equal(provenance.license, "CC0");
  for (const set of library.textureSets) {
    const source = provenance.assets[set.id];
    assert.ok(source, `${set.id} is missing source provenance`);
    assert.deepEqual([set.sourceAssetId, set.provider, set.sourceUrl], [source.id, source.provider, source.url]);
    for (const channel of ["albedo", "normal", "roughness"] as const) {
      assert.ok(existsSync(path.join(repoRoot, "packages", "viewer-threejs", "public", set.channels[channel].file)), `${set.id}/${channel} KTX2 is missing`);
    }
  }
  assert.equal(Object.values(library.residencyProfiles.compatibility.channelsByTextureSet).flat().length, 7);
  assert.equal(Object.values(library.residencyProfiles.balanced.channelsByTextureSet).flat().length, 7);
  assert.equal(Object.values(library.residencyProfiles.high.channelsByTextureSet).flat().length, 21);
});

test("world output exports the versioned terrain material contract", () => {
  const root = mkdtempSync(path.join(tmpdir(), "navora-materials-"));
  try {
    const outDir = writeWorldOutput(generateWorld({ seed: 48291, heightmapResolution: 32 }), root);
    const exported = JSON.parse(readFileSync(path.join(outDir, "terrainMaterials.json"), "utf8")) as { version: number; families: unknown[] };
    assert.equal(exported.version, 1);
    assert.equal(exported.families.length, 33);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
