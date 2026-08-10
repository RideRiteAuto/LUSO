import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { loadWorld, loadEmbeddedWorld } from "./worldData.js";
import { buildTerrainMesh, buildSeabedMesh, sampleWorldHeight } from "./terrain.js";
import { buildZoneBoundaries, buildRivers, buildRoads, buildSettlements, buildSeaRegions } from "./overlays.js";
import { uvToWorld } from "./layout.js";
import { FlightController } from "./flightControls.js";

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
// World units are true meters now (docs/01 §5) and the world is ~131km
// across, so fog/camera-far distances are scaled up accordingly from the
// pre-rescale version of this file.
scene.fog = new THREE.Fog(0x0a1626, 40000, 160000);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.5, 400000);
camera.position.set(-12000, 16000, 36000);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(16000, 0, 16000);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.49;
controls.minDistance = 3;
controls.maxDistance = 280000;
controls.update();

let flight: FlightController | null = null; // created once world data (needed for walk-mode grounding) has loaded
let flying = false;
const clock = new THREE.Clock();

const hemi = new THREE.HemisphereLight(0xbcd4ff, 0x1a2a1a, 0.9);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2d8, 1.6);
sun.position.set(-16000, 24000, 8000);
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
  const isEmbedded = Boolean((globalThis as unknown as { __NEVORA_WORLD__?: unknown }).__NEVORA_WORLD__);
  const world = isEmbedded
    ? await loadEmbeddedWorld((msg) => (statusEl.textContent = `loading ${msg}`))
    : await loadWorld(seed, (msg) => (statusEl.textContent = `loading ${msg}`));
  const manifest = world.manifest;

  statusEl.textContent = "building ocean floor…";
  scene.add(buildSeabedMesh(world.worldHeight));

  for (const continent of Object.values(world.continents)) {
    statusEl.textContent = `building terrain (${continent.id})…`;
    const mesh = buildTerrainMesh(continent, manifest);
    scene.add(mesh);
  }

  flight = new FlightController(camera, renderer.domElement, {
    getGroundHeight: (x, z) => sampleWorldHeight(world.worldHeight, x, z),
    worldBounds: world.worldHeight.bounds,
  });

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

  seedValEl.textContent = String(manifest.seed);
  zoneCountEl.textContent = String(world.zones.length);
  settleCountEl.textContent = String(world.settlements.length);
  const brumaNote = world.seaRegions[0] ? ` · ${world.seaRegions[0].name} marked mid-sea (purple ring).` : "";
  legendEl.innerHTML = `Band 1 (white) → Band 8 (pink) zone outlines. Yellow markers = Tier 1 settlements.${brumaNote}`;
  statusEl.textContent = `seed ${seed} — ${manifest.generatorVersion}, generated ${new Date(manifest.generatedAt).toLocaleString()}`;

  // Compute a "frame the whole world" camera target (both continents + the
  // Luna Sea/Bruma between them), used by the World view button below.
  const b = world.worldHeight.bounds;
  worldFrame = {
    center: new THREE.Vector3((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2),
    distance: (b.maxX - b.minX) * 0.85,
  };

  // Frame the camera on the first continent's Band-1 validation corridor by
  // default (Alvora), since that's the region this pass is meant to validate
  // (docs/00 §3-4) -- not a claim that the rest of the world is unfinished.
  const alvora = world.zones.find((z) => z.id === "alvora");
  if (alvora) {
    const cx = alvora.boundary.reduce((s, p) => s + p[0], 0) / alvora.boundary.length;
    const cz = alvora.boundary.reduce((s, p) => s + p[1], 0) / alvora.boundary.length;
    const [wx, wz] = uvToWorld(cx, cz, "valora", manifest);
    controls.target.set(wx, 800, wz);
    camera.position.set(wx - 7000, 7000, wz + 9500);
    controls.update();
  }
}

boot().catch((err) => {
  console.error(err);
  statusEl.textContent = `error: ${err.message} — did you run "npm run generate -- --seed ${seed}" first?`;
});

function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(0.1, clock.getDelta()); // clamp so a stalled tab doesn't teleport the camera on resume
  if (flying && flight) {
    flight.update(delta);
  } else {
    controls.update();
  }
  renderer.render(scene, camera);
}
animate();

// --- HUD wiring ---
const viewOrbitBtn = document.getElementById("viewOrbit")!;
const viewTopBtn = document.getElementById("viewTop")!;
const viewWorldBtn = document.getElementById("viewWorld")!;
const viewFlyBtn = document.getElementById("viewFly")!;
const viewWalkBtn = document.getElementById("viewWalk")!;
const flyHintEl = document.getElementById("flyHint")!;
const crosshairEl = document.getElementById("crosshair")!;

function setActiveView(active: HTMLElement) {
  for (const btn of [viewOrbitBtn, viewTopBtn, viewWorldBtn, viewFlyBtn, viewWalkBtn]) btn.classList.remove("active");
  active.classList.add("active");
}

function exitFlight() {
  flying = false;
  controls.enabled = true;
  flyHintEl.classList.remove("visible");
  crosshairEl.classList.remove("visible");
  if (![viewOrbitBtn, viewTopBtn, viewWorldBtn].some((b) => b.classList.contains("active"))) {
    setActiveView(viewOrbitBtn);
  }
  // Point the orbit target at where the camera was looking so re-entering
  // orbit mode doesn't snap the view somewhere unrelated to the flyover.
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  controls.target.copy(camera.position).addScaledVector(forward, 500);
  controls.update();
}

viewOrbitBtn.addEventListener("click", () => {
  flight?.disable();
  controls.enabled = true;
  setActiveView(viewOrbitBtn);
  controls.maxPolarAngle = Math.PI * 0.49;
});
viewTopBtn.addEventListener("click", () => {
  flight?.disable();
  controls.enabled = true;
  setActiveView(viewTopBtn);
  const target = controls.target.clone();
  // Preserve the current zoom distance rather than a fixed height, so
  // "top-down" behaves sensibly whether the last view was a close-up
  // corridor orbit or the pulled-back World view.
  const distance = Math.max(3000, camera.position.distanceTo(target));
  camera.position.set(target.x, distance, target.z + 0.01);
  controls.maxPolarAngle = 0.01;
  controls.update();
});
viewWorldBtn.addEventListener("click", () => {
  flight?.disable();
  controls.enabled = true;
  setActiveView(viewWorldBtn);
  if (!worldFrame) return;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.target.copy(worldFrame.center);
  camera.position.set(worldFrame.center.x, worldFrame.distance * 0.55, worldFrame.center.z + worldFrame.distance * 0.75);
  controls.update();
});
viewFlyBtn.addEventListener("click", () => {
  if (!flight) return;
  // OrbitControls listens on the same canvas for pointer-drag and wheel
  // events that FlightController now uses for look/speed -- left enabled,
  // its own dolly-zoom (wheel) and orbit-rotate (drag) fight the flight
  // controller for the same camera every frame. A single test wheel tick
  // moved the camera by ~3000 units on its own with no WASD pressed; a 2.5s
  // combined-input flight landed the camera underground (y=-21708) with
  // nothing left to render. Disabling it here is the actual fix for what
  // looked like a "flew into the void" bug in fly/walk mode.
  controls.enabled = false;
  setActiveView(viewFlyBtn);
  flying = true;
  flyHintEl.textContent = "Drag to look · WASD move · Space/Ctrl up-down · Shift boost · scroll = speed · Esc to exit";
  flyHintEl.classList.add("visible");
  crosshairEl.classList.add("visible");
  flight.enable(exitFlight, "fly");
});
viewWalkBtn.addEventListener("click", () => {
  if (!flight) return;
  // Must read "were we already flying" BEFORE flipping `flying` to true
  // below -- otherwise this always reads true (we just set it) and the
  // anchor picks the wrong branch even when arriving from Orbit/Top-down/
  // World, standing the walker wherever the camera's raw eye position last
  // was (frequently tens of km out in open ocean) instead of the point the
  // view was actually framing.
  const wasFlying = flying && flight.isEnabled && flight.currentMode === "fly";
  controls.enabled = false; // see viewFlyBtn's handler for why this matters
  setActiveView(viewWalkBtn);
  flying = true;
  flyHintEl.textContent = "Drag to look · WASD walk · Shift to run · scroll = pace · Esc to exit -- ground-level, human eye height";
  flyHintEl.classList.add("visible");
  crosshairEl.classList.add("visible");
  // Coming from Fly, start walking right where you were flying (the camera
  // IS the current viewpoint there). Coming from Orbit/Top-down/World,
  // stand at whatever point the camera was last looking AT (controls.target)
  // instead of the camera's own eye position, which after e.g. the World
  // overview is tens of km out in open ocean.
  const anchor = wasFlying
    ? { x: camera.position.x, z: camera.position.z }
    : { x: controls.target.x, z: controls.target.z };
  flight.enable(exitFlight, "walk", anchor);
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
