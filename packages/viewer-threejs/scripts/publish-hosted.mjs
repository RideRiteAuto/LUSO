#!/usr/bin/env node
// Publishes the viewer + a seed's generator output to the `navora-hosted`
// branch, which GitHub Pages serves.
//
// This is the delivery path for "let me fly around the world on my phone".
// The standalone `build:artifact` inlines everything into a single HTML file,
// which suits a file:// open but is ~156 MB once base64'd — far past what any
// chat artifact host accepts. Pages serves ordinary files, so the full
// world (heightmaps, control fields, KTX2 terrain, prop models) ships intact.
//
// The site is three parts:
//   index.html            preloader; caches the whole payload via a service
//                         worker, shows progress, then hands off to viewer.html
//   viewer.html           the Vite-built inspector (dist/index.html, renamed)
//   world-data/<seed>/    generator output, fetched at runtime
//
// The preloader and worker are carried over from the existing branch so this
// script only ever refreshes the build, the data, and the cache version. Run:
//   npm run generate -- --seed 48291
//   npm run build -w @nevora/viewer-threejs
//   node packages/viewer-threejs/scripts/publish-hosted.mjs --seed 48291

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(packageRoot, "..", "..");

const argv = process.argv.slice(2);
const seed = argv.includes("--seed") ? argv[argv.indexOf("--seed") + 1] : "48291";
const branch = argv.includes("--branch") ? argv[argv.indexOf("--branch") + 1] : "navora-hosted";
const push = !argv.includes("--no-push");

const dist = path.join(packageRoot, "dist");
const output = path.join(repoRoot, "output", seed);
const staging = path.join(repoRoot, ".hosted-staging");

for (const [label, dir] of [["viewer build", dist], ["generator output", output]]) {
  try { statSync(dir); } catch {
    throw new Error(`Missing ${label} at ${dir}. Run the build/generate step first.`);
  }
}

const git = (...args) => execFileSync("git", args, { cwd: repoRoot, encoding: "utf-8" }).trim();

console.log(`Publishing seed ${seed} to ${branch}…`);

// Stage the site: the built viewer, then the world data beside it.
rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });
cpSync(dist, staging, { recursive: true });
// The built entry becomes viewer.html; index.html is the preloader shell.
cpSync(path.join(staging, "index.html"), path.join(staging, "viewer.html"));
rmSync(path.join(staging, "index.html"));
cpSync(output, path.join(staging, "world-data", seed), { recursive: true });
writeFileSync(path.join(staging, ".nojekyll"), "");

// Carry the preloader and service worker across from the published branch:
// they are hand-authored and independent of any world regeneration.
for (const file of ["index.html", "navora-cache-worker.js"]) {
  const contents = execFileSync("git", ["show", `origin/${branch}:${file}`], { cwd: repoRoot });
  writeFileSync(path.join(staging, file), contents);
}

// Everything the preloader must cache before launch, with a content-derived
// cache name so a republished world invalidates stale browser caches.
const files = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(full); continue; }
    const rel = path.relative(staging, full).split(path.sep).join("/");
    if (rel === "index.html" || rel === "navora-cache-worker.js"
      || rel === "preload-manifest.json" || rel === ".nojekyll") continue;
    files.push({ path: rel, size: statSync(full).size });
  }
};
walk(staging);
files.sort((a, b) => a.path.localeCompare(b.path));

const fingerprint = createHash("sha256")
  .update(files.map((f) => `${f.path}:${f.size}`).join("\n"))
  .digest("hex").slice(0, 12);
const cacheName = `navora-world-${seed}-${fingerprint}`;
const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
writeFileSync(path.join(staging, "preload-manifest.json"), JSON.stringify({ cacheName, totalBytes, files }));

const workerPath = path.join(staging, "navora-cache-worker.js");
const worker = readFileSync(workerPath, "utf-8");
const updated = worker.replace(/const CURRENT_CACHE = "[^"]*";/, `const CURRENT_CACHE = "${cacheName}";`);
if (updated === worker) throw new Error("Could not update CURRENT_CACHE in navora-cache-worker.js");
writeFileSync(workerPath, updated);

console.log(`Staged ${files.length} files, ${(totalBytes / 1024 / 1024).toFixed(0)} MB, cache ${cacheName}`);

// Commit the staged tree as the branch's new content. The branch holds only
// build output, so each publish replaces it wholesale rather than merging.
const worktree = path.join(repoRoot, ".hosted-worktree");
rmSync(worktree, { recursive: true, force: true });
git("worktree", "prune");
execFileSync("git", ["worktree", "add", "--force", "-B", branch, worktree, `origin/${branch}`],
  { cwd: repoRoot, stdio: "inherit" });

for (const entry of readdirSync(worktree)) {
  if (entry === ".git") continue;
  rmSync(path.join(worktree, entry), { recursive: true, force: true });
}
cpSync(staging, worktree, { recursive: true });

execFileSync("git", ["add", "-A"], { cwd: worktree, stdio: "inherit" });
const status = execFileSync("git", ["status", "--porcelain"], { cwd: worktree, encoding: "utf-8" });
if (!status.trim()) {
  console.log("No changes to publish.");
} else {
  execFileSync("git", ["commit", "-m", `Publish seed ${seed} (${fingerprint})`], { cwd: worktree, stdio: "inherit" });
  if (push) execFileSync("git", ["push", "origin", branch], { cwd: worktree, stdio: "inherit" });
  else console.log("Committed; skipping push (--no-push).");
}

rmSync(staging, { recursive: true, force: true });
execFileSync("git", ["worktree", "remove", "--force", worktree], { cwd: repoRoot, stdio: "inherit" });
console.log(`Done. https://rideriteauto.github.io/LUSO/`);
