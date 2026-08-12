import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(packageRoot, "public", "assets", "resource-textures");
const sourcePage = "https://polyhaven.com/a/pine_tree_01";
const files = [
  { file: "pine-twig-diff.png", url: "https://dl.polyhaven.org/file/ph-assets/Models/png/1k/pine_tree_01/pine_tree_01_twig_diff_1k.png", role: "pine foliage color" },
  { file: "pine-twig-alpha.png", url: "https://dl.polyhaven.org/file/ph-assets/Models/png/1k/pine_tree_01/pine_tree_01_twig_alpha_1k.png", role: "pine foliage opacity" },
  { file: "pine-bark-diff.jpg", url: "https://dl.polyhaven.org/file/ph-assets/Models/jpg/1k/pine_tree_01/pine_tree_01_bark_diff_1k.jpg", role: "pine bark color" },
];

await mkdir(outputDir, { recursive: true });
const provenance = { sourcePage, creator: "Rico Cilliers / Rob Tuytel / Poly Haven", license: "CC0 1.0", acquiredAt: new Date().toISOString(), files: [] };
for (const entry of files) {
  const response = await fetch(entry.url);
  if (!response.ok) throw new Error(`${response.status} downloading ${entry.url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(path.join(outputDir, entry.file), bytes);
  provenance.files.push({ ...entry, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
}
await writeFile(path.join(outputDir, "provenance.json"), `${JSON.stringify(provenance, null, 2)}\n`);
console.log(`Downloaded ${files.length} CC0 resource textures to ${outputDir}`);
