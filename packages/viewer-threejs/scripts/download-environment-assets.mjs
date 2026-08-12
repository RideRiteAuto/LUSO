#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptDir, "..");
const assetRoot = path.join(packageRoot, "assets", "environment");
const manifestPath = path.join(assetRoot, "asset-manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const resolution = process.argv.includes("--resolution") ? process.argv[process.argv.indexOf("--resolution") + 1] : "2k";
if (!new Set(["1k", "2k", "4k"]).has(resolution)) throw new Error(`Unsupported resolution: ${resolution}`);
const userAgent = "NavoraAssetPipeline/0.1 (RideRiteAuto LUSO)";

async function getJson(url) {
  const response = await fetch(url, { headers: { "User-Agent": userAgent } });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
}

async function download(url, target, expectedMd5) {
  const response = await fetch(url, { headers: { "User-Agent": userAgent } });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes);
  const md5 = createHash("md5").update(bytes).digest("hex");
  if (expectedMd5 && md5 !== expectedMd5) throw new Error(`MD5 mismatch for ${target}: ${md5}`);
  return { bytes: bytes.byteLength, md5, sha256: createHash("sha256").update(bytes).digest("hex") };
}

const lock = { generatedAt: new Date().toISOString(), resolution, source: manifest.sourceLibrary, assets: {} };
for (const asset of manifest.selected) {
  const files = await getJson(`https://api.polyhaven.com/files/${asset.id}`);
  const descriptor = files.gltf?.[resolution]?.gltf;
  if (!descriptor) throw new Error(`No ${resolution} glTF for ${asset.id}`);
  const destination = path.join(assetRoot, "source", asset.id);
  const records = [];
  records.push({ path: `${asset.id}.gltf`, url: descriptor.url, ...(await download(descriptor.url, path.join(destination, `${asset.id}.gltf`), descriptor.md5)) });
  for (const [relative, include] of Object.entries(descriptor.include ?? {})) {
    records.push({ path: relative, url: include.url, ...(await download(include.url, path.join(destination, relative), include.md5)) });
  }
  lock.assets[asset.id] = { ...asset, sourceUrl: `https://polyhaven.com/a/${asset.id}`, license: "CC0", files: records };
  console.log(`${asset.id}: ${records.length} files`);
}
await writeFile(path.join(assetRoot, "asset-lock.json"), `${JSON.stringify(lock, null, 2)}\n`);
console.log(`Wrote ${path.join(assetRoot, "asset-lock.json")}`);
