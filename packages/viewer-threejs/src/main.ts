import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { loadWorld } from "./worldData.js";
import { buildTerrainMesh } from "./terrain.js";
import { buildZoneBoundaries, buildRivers, buildRoads, buildSettlements, buildOceanPlane, buildSeaRegions } from "./overlays.js";
import { uvToWorld } from "./layout.js";

const params = new URLSearchParams(location.search);
const seed = Number(params.get("seed") ?? 48291);

const statusEl = document.getElementById("status")!;
const seedValEl = document.getElementById("seedVal")!;
const zoneCountEl = document.getElementById("zoneCount")!;
const settleCountEl = document.getElementById("settleCount")!;
const legendEl = document.getElementById("legend")!;

seedValEl.textContent = String(seed);

const app = document.getElementById("app")!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = false;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a1626);
scene.fog = new THREE.Fog(0x0a1626, 12000, 42000);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 1, 90000);
camera.position.set(-3000, 4200, 9000);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(4000, 0, 4000);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.49;
controls.minDistance = 200;
controls.maxDistance = 70000;
controls.update();

const hemi = new THREE.HemisphereLight(0xbcd4ff, 0x1a2a1a, 0.9);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2d8, 1.6);
sun.position.set(-4000, 6000, 2000);
scene.add(sun);

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

let zoneOverlay: THREE.Group | null = null;
let riverOverlay: THREE.Group | null = null;
let roadOverlay: THREE.Group | null = null;
let settlementOverlay: THREE.Group | null = null;
let worldFrame: { center: THREE.Vector3; distance: number } | null = null;

async function boot() {
  statusEl.textContent = "loading manifest…";
  const world = await loadWorld(seed, (msg) => (statusEl.textContent = `loading ${msg}`));
  const manifest = world.manifest;
  const tileSize = manifest.worldScale.continentTileSize;

  const ocean = buildOceanPlane(manifest);
  scene.add(ocean);

  for (const continent of Object.values(world.continents)) {
    statusEl.textContent = `building terrain (${continent.id})…`;
    const mesh = buildTerrainMesh(continent, manifest);
    scene.add(mesh);
  }

  const zonesById = new Map(world.zones.map((z) => [z.id, z]));

  zoneOverlay = buildZoneBoundaries(world.zones, world.continents, manifest);
  scene.add(zoneOverlay);

  riverOverlay = buildRivers(world.continents, manifest);
  scene.add(riverOverlay);

  roadOverlay = buildRoads(world.continents, manifest);
  scene.add(roadOverlay);

  settlementOverlay = buildSettlements(world.settlements, zonesById, world.continents, manifest);
  scene.add(settlementOverlay);

  scene.add(buildSeaRegions(world.seaRegions));

  zoneCountEl.textContent = String(world.zones.length);
  settleCountEl.textContent = String(world.settlements.length);
  const brumaNote = world.seaRegions[0] ? ` · ${world.seaRegions[0].name} marked mid-sea (purple ring).` : "";
  legendEl.innerHTML = `Band 1 (white) → Band 8 (pink) zone outlines. Yellow markers = Tier 1 settlements.${brumaNote}`;
  statusEl.textContent = `seed ${seed} — ${manifest.generatorVersion}, generated ${new Date(manifest.generatedAt).toLocaleString()}`;

  // Compute a "frame the whole world" camera target (both continents + the
  // Luna Sea/Bruma between them), used by the World view button below.
  const offsets = Object.values(manifest.continentLayout).map((c) => c.worldOffset[0]);
  const minX = Math.min(...offsets);
  const maxX = Math.max(...offsets) + tileSize;
  const worldWidth = maxX - minX;
  worldFrame = {
    center: new THREE.Vector3((minX + maxX) / 2, 0, tileSize / 2),
    distance: worldWidth * 0.85,
  };

  // Frame the camera on the first continent's Band-1 validation corridor by
  // default (Alvora), since that's the region this pass is meant to validate
  // (docs/00 §3-4) -- not a claim that the rest of the world is unfinished.
  const alvora = world.zones.find((z) => z.id === "alvora");
  if (alvora) {
    const cx = alvora.boundary.reduce((s, p) => s + p[0], 0) / alvora.boundary.length;
    const cz = alvora.boundary.reduce((s, p) => s + p[1], 0) / alvora.boundary.length;
    const [wx, wz] = uvToWorld(cx, cz, "valora", manifest);
    controls.target.set(wx, 200, wz);
    camera.position.set(wx - 1800, 1800, wz + 2400);
    controls.update();
  }
}

boot().catch((err) => {
  console.error(err);
  statusEl.textContent = `error: ${err.message} — did you run "npm run generate -- --seed ${seed}" first?`;
});

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();

// --- HUD wiring ---
const viewOrbitBtn = document.getElementById("viewOrbit")!;
const viewTopBtn = document.getElementById("viewTop")!;
const viewWorldBtn = document.getElementById("viewWorld")!;

function setActiveView(active: HTMLElement) {
  for (const btn of [viewOrbitBtn, viewTopBtn, viewWorldBtn]) btn.classList.remove("active");
  active.classList.add("active");
}

viewOrbitBtn.addEventListener("click", () => {
  setActiveView(viewOrbitBtn);
  controls.maxPolarAngle = Math.PI * 0.49;
});
viewTopBtn.addEventListener("click", () => {
  setActiveView(viewTopBtn);
  const target = controls.target.clone();
  // Preserve the current zoom distance rather than a fixed height, so
  // "top-down" behaves sensibly whether the last view was a close-up
  // corridor orbit or the pulled-back World view.
  const distance = Math.max(2000, camera.position.distanceTo(target));
  camera.position.set(target.x, distance, target.z + 0.01);
  controls.maxPolarAngle = 0.01;
  controls.update();
});
viewWorldBtn.addEventListener("click", () => {
  setActiveView(viewWorldBtn);
  if (!worldFrame) return;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.target.copy(worldFrame.center);
  camera.position.set(worldFrame.center.x, worldFrame.distance * 0.55, worldFrame.center.z + worldFrame.distance * 0.75);
  controls.update();
});

function wireToggle(id: string, group: () => THREE.Group | null) {
  const btn = document.getElementById(id)!;
  btn.addEventListener("click", () => {
    const g = group();
    if (!g) return;
    g.visible = !g.visible;
    btn.classList.toggle("active", g.visible);
  });
}
wireToggle("toggleZones", () => zoneOverlay);
wireToggle("toggleWater", () => riverOverlay);
wireToggle("toggleSettlements", () => settlementOverlay);
