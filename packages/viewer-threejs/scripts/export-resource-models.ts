import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import {
  buildResourceModel,
  disposeResourceModel,
  type ResourceFamilyId,
  type ResourceLod,
} from "../src/resourceModels.js";

// GLTFExporter uses FileReader to assemble a binary GLB. Node has Blob but no
// FileReader, so this deliberately small adapter keeps the export deterministic
// and avoids introducing a second modeling/runtime dependency.
class NodeFileReader {
  result: ArrayBuffer | string | null = null;
  onloadend: ((event: { target: NodeFileReader }) => void) | null = null;

  readAsArrayBuffer(blob: Blob): void {
    void blob.arrayBuffer().then((buffer) => {
      this.result = buffer;
      this.onloadend?.({ target: this });
    });
  }

  readAsDataURL(blob: Blob): void {
    void blob.arrayBuffer().then((buffer) => {
      this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString("base64")}`;
      this.onloadend?.({ target: this });
    });
  }
}

Object.assign(globalThis, { FileReader: NodeFileReader });

// Review runtime uses photographic/procedural texture sources, while portable
// GLBs keep vertex colors and material response. Exporting in Node must not
// attempt to serialize a DOM canvas that does not exist here.

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const outputRoot = path.resolve(scriptDir, "../public/assets/resources");
const families: ResourceFamilyId[] = ["pine", "birch", "copper", "tin", "stone", "redberry"];
const variantNames = ["small", "standard", "mature"];
const exporter = new GLTFExporter();
const report: Record<string, unknown> = {
  generatedAt: new Date().toISOString(),
  generator: "packages/viewer-threejs/scripts/export-resource-models.ts",
  families: {},
};

for (const family of families) {
  const familyDir = path.join(outputRoot, family);
  await mkdir(familyDir, { recursive: true });
  const familyRows: unknown[] = [];
  for (let variant = 0; variant < 3; variant++) {
    const lods: unknown[] = [];
    for (let lod = 0; lod < 3; lod++) {
      const model = buildResourceModel(family, variant, lod as ResourceLod);
      const binary = await exporter.parseAsync(model.group, {
        binary: true,
        onlyVisible: false,
        trs: false,
      });
      if (!(binary instanceof ArrayBuffer)) throw new Error(`${family} v${variant + 1} LOD${lod} did not export binary GLB`);
      const file = `${variantNames[variant]}-lod${lod}.glb`;
      await writeFile(path.join(familyDir, file), Buffer.from(binary));
      lods.push({ file, triangles: model.info.triangles, bytes: binary.byteLength });
      disposeResourceModel(model.group);
    }
    familyRows.push({ variant: variantNames[variant], lods });
  }
  (report.families as Record<string, unknown>)[family] = familyRows;
}

await writeFile(path.join(outputRoot, "export-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`Exported ${families.length * 9} deterministic GLBs to ${outputRoot}`);
