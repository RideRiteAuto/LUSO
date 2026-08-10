import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { loadWorld } from "./worldData.js";
import { buildTerrainMesh } from "./terrain.js";
import { buildZoneBoundaries, buildRivers, buildRoads, buildSettlements } from "./overlays.js";

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
scene.fog = new THREE.Fog(0x0a1626, 6000, 18000);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 1, 40000);
camera.position.set(-3000, 4200, 9000);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(4000, 0, 4000);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.49;
controls.minDistance = 200;
controls.maxDistance = 20000;
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

async function boot() {
  statusEl.textContent = "loading manifest…";
  const world = await loadWorld(seed, (msg) => (statusEl.textContent = `loading ${msg}`));

  const tileSize = world.manifest.worldScale.continentTileSize;

  for (const continent of Object.values(world.continents)) {
    statusEl.textContent = `building terrain (${continent.id})…`;
    const mesh = buildTerrainMesh(continent, tileSize);
    scene.add(mesh);
  }

  const zonesById = new Map(world.zones.map((z) => [z.id, z]));

  zoneOverlay = buildZoneBoundaries(world.zones, world.continents, tileSize);
  scene.add(zoneOverlay);

  riverOverlay = buildRivers(world.continents, tileSize);
  scene.add(riverOverlay);

  roadOverlay = buildRoads(world.continents, tileSize);
  scene.add(roadOverlay);

  settlementOverlay = buildSettlements(world.settlements, zonesById, world.continents, tileSize);
  scene.add(settlementOverlay);

  zoneCountEl.textContent = String(world.zones.length);
  settleCountEl.textContent = String(world.settlements.length);
  legendEl.innerHTML = "Band 1 (white) → Band 8 (pink) zone outlines. Yellow markers = Tier 1 settlements.";
  statusEl.textContent = `seed ${seed} — ${world.manifest.generatorVersion}, generated ${new Date(world.manifest.generatedAt).toLocaleString()}`;

  // Frame the camera on the first continent's Band-1 validation corridor by
  // default (Alvora), since that's the region this pass is meant to validate
  // (docs/00 §3-4) -- not a claim that the rest of the world is unfinished.
  const alvora = world.zones.find((z) => z.id === "alvora");
  if (alvora) {
    const cx = alvora.boundary.reduce((s, p) => s + p[0], 0) / alvora.boundary.length;
    const cz = alvora.boundary.reduce((s, p) => s + p[1], 0) / alvora.boundary.length;
    controls.target.set(cx * tileSize, 200, cz * tileSize);
    camera.position.set(cx * tileSize - 1800, 1800, cz * tileSize + 2400);
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
viewOrbitBtn.addEventListener("click", () => {
  viewOrbitBtn.classList.add("active");
  viewTopBtn.classList.remove("active");
  controls.maxPolarAngle = Math.PI * 0.49;
});
viewTopBtn.addEventListener("click", () => {
  viewTopBtn.classList.add("active");
  viewOrbitBtn.classList.remove("active");
  const target = controls.target.clone();
  camera.position.set(target.x, 9000, target.z + 0.01);
  controls.maxPolarAngle = 0.01;
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
