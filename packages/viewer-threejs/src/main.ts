import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { loadWorld, loadEmbeddedWorld } from "./worldData.js";
import { sampleHeightWithSkirt, SKIRT_REACH } from "./terrain.js";
import { CollisionHeightCache, sampleLocalTerrainDetail } from "./terrainLod.js";
import { defaultTerrainRenderTuning, TerrainStreamer, type TerrainRenderTuning } from "./terrainStreaming.js";
import { buildZoneBoundaries, buildRoads, buildSettlements, buildSeaRegions } from "./overlays.js";
import { uvToWorld } from "./layout.js";
import { FlightController, resolveWalkTransitionAnchor, type InteractionMode } from "./flightControls.js";
import { CameraRelativeOrigin } from "./worldOrigin.js";
import { buildTraversalBookmarks, findSafeTraversalPoint, type TraversalBookmark } from "./traversalSpawns.js";
import type { TerrainMaterialDebugMode } from "./terrainMaterial.js";
import { EnvironmentDressing } from "./environmentDressing.js";
import { NavoraAtmosphere } from "./atmosphere.js";
import { ResourceReviewYard } from "./resourceReviewYard.js";
import { NavoraWaterSystem } from "./waterSystem.js";
import { buildRiverChannelField, sampleRiverCarvedHeight } from "./riverChannelField.js";
import { TouchControls } from "./touchControls.js";

const params = new URLSearchParams(location.search);
const seed = Number(params.get("seed") ?? 48291);
const streamTourRequested = params.get("streamTour") === "1";
const requestedRenderer = params.get("renderer") === "webgl" ? "webgl" : "auto";
const requestedQuality = params.get("quality");
const suppliedReviewCamera = {
  x: Number(params.get("reviewX")),
  y: Number(params.get("reviewY")),
  z: Number(params.get("reviewZ")),
  yaw: Number(params.get("reviewYaw")),
  pitch: Number(params.get("reviewPitch")),
};
const reviewCameraKeys = ["reviewX", "reviewY", "reviewZ", "reviewYaw", "reviewPitch"] as const;
const hasSuppliedReviewCamera = reviewCameraKeys.every((key) => params.has(key))
  && [suppliedReviewCamera.x, suppliedReviewCamera.y, suppliedReviewCamera.z,
    suppliedReviewCamera.yaw, suppliedReviewCamera.pitch].every(Number.isFinite);
const qualityExplicit = requestedQuality === "high" || requestedQuality === "balanced" || requestedQuality === "compatibility";
// The portable artifact opens at the frame-paced tier. Balanced and High stay
// available as explicit review tiers via ?quality=balanced and ?quality=high.
const qualityName = qualityExplicit
  ? requestedQuality!
  : "compatibility";
const quality = {
  high: { pixelRatioCap: 1.5, pixelRatioFloor: 0.8 },
  balanced: { pixelRatioCap: 1.1, pixelRatioFloor: 0.7 },
  compatibility: { pixelRatioCap: 0.9, pixelRatioFloor: 0.65 },
}[qualityName];

const statusEl = document.getElementById("status")!;
const seedValEl = document.getElementById("seedVal")!;
const zoneCountEl = document.getElementById("zoneCount")!;
const settleCountEl = document.getElementById("settleCount")!;
const cameraPosEl = document.getElementById("cameraPos")!;
const altitudeEl = document.getElementById("altitude")!;
const movementEl = document.getElementById("movement")!;
const locomotionEl = document.getElementById("locomotion")!;
const rendererBackendEl = document.getElementById("rendererBackend")!;
const performanceEl = document.getElementById("performance")!;
const framePacingEl = document.getElementById("framePacing")!;
const sceneStatsEl = document.getElementById("sceneStats")!;
const streamingStatsEl = document.getElementById("streamingStats")!;
const dressingStatsEl = document.getElementById("dressingStats")!;
const legendEl = document.getElementById("legend")!;
const hudEl = document.getElementById("hud")!;
const interactionStatusEl = document.getElementById("interactionStatus")!;
const interactionNoteEl = document.getElementById("interactionNote")!;
const toggleInteractionBtn = document.getElementById("toggleInteraction") as HTMLButtonElement;
const highDetailDistanceInput = document.getElementById("highDetailDistance") as HTMLInputElement;
const midDetailDistanceInput = document.getElementById("midDetailDistance") as HTMLInputElement;
const terrainDrawDistanceInput = document.getElementById("terrainDrawDistance") as HTMLInputElement;
const meshDetailReachInput = document.getElementById("meshDetailReach") as HTMLInputElement;
const highDetailDistanceValue = document.getElementById("highDetailDistanceValue")!;
const midDetailDistanceValue = document.getElementById("midDetailDistanceValue")!;
const terrainDrawDistanceValue = document.getElementById("terrainDrawDistanceValue")!;
const meshDetailReachValue = document.getElementById("meshDetailReachValue")!;
const terrainQualityNote = document.getElementById("terrainQualityNote")!;
let touchControls: TouchControls | null = null;

seedValEl.textContent = String(seed);

const app = document.getElementById("app")!;
const renderer = new THREE.WebGPURenderer({
  antialias: qualityName !== "compatibility",
  forceWebGL: requestedRenderer === "webgl",
});
renderer.setSize(window.innerWidth, window.innerHeight);
let renderPixelRatio = Math.min(window.devicePixelRatio, quality.pixelRatioCap);
renderer.setPixelRatio(renderPixelRatio);
renderer.shadowMap.enabled = false;
app.appendChild(renderer.domElement);

type RendererBackend = { isWebGPUBackend?: boolean; compatibilityMode?: boolean };

function activeBackendLabel(): string {
  const backend = (renderer as unknown as { backend: RendererBackend }).backend;
  if (backend.isWebGPUBackend) return backend.compatibilityMode ? "WebGPU compatibility" : "WebGPU";
  return "WebGL 2 fallback";
}

function updateBackendLabel() {
  const gpuAvailable = "gpu" in navigator;
  rendererBackendEl.textContent = `${activeBackendLabel()} · ${qualityName} · GPU API ${gpuAvailable ? "available" : "unavailable"}`;
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a1626);
// World units are true meters now (docs/01 §5) and the world is ~131km
// across, so fog/camera-far distances are scaled up accordingly from the
// pre-rescale version of this file.

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 4, 500000);
camera.position.set(-12000, 16000, 36000);
const atmosphere = new NavoraAtmosphere(scene, camera, qualityName);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(16000, 0, 16000);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.49;
controls.minDistance = 3;
controls.maxDistance = 280000;
controls.update();

const worldRoot = new THREE.Group();
scene.add(worldRoot);
const worldOrigin = new CameraRelativeOrigin(worldRoot);

let flight: FlightController | null = null; // created once world data (needed for walk-mode grounding) has loaded
let flying = false;
const timer = new THREE.Timer();
timer.connect(document);

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
let lakeOverlay: THREE.Group | null = null;
let roadOverlay: THREE.Group | null = null;
let settlementOverlay: THREE.Group | null = null;
let worldFrame: { center: THREE.Vector3; distance: number } | null = null;
let terrainStreamer: TerrainStreamer | null = null;
let environmentDressing: EnvironmentDressing | null = null;
let collisionHeights: CollisionHeightCache | null = null;
let traversalBookmarks: TraversalBookmark[] = [];
let loadedWorld: Awaited<ReturnType<typeof loadWorld>> | null = null;
let resourceReviewYard: ResourceReviewYard | null = null;
let waterSystem: NavoraWaterSystem | null = null;
const terrainTuningDefaults = defaultTerrainRenderTuning(qualityName);

function readTerrainTuning(): TerrainRenderTuning {
  return {
    highDetailDistanceM: Number(highDetailDistanceInput.value) * 1_000,
    midDetailDistanceM: Number(midDetailDistanceInput.value) * 1_000,
    drawDistanceM: Number(terrainDrawDistanceInput.value) * 1_000,
    meshDetailPercent: Number(meshDetailReachInput.value),
  };
}

function writeTerrainTuning(tuning: TerrainRenderTuning): void {
  highDetailDistanceInput.value = String(tuning.highDetailDistanceM / 1_000);
  midDetailDistanceInput.value = String(tuning.midDetailDistanceM / 1_000);
  terrainDrawDistanceInput.value = String(tuning.drawDistanceM / 1_000);
  meshDetailReachInput.value = String(tuning.meshDetailPercent);
  updateTerrainTuningLabels();
}

function updateTerrainTuningLabels(): void {
  const tuning = readTerrainTuning();
  highDetailDistanceValue.textContent = `${(tuning.highDetailDistanceM / 1_000).toFixed(1)} km`;
  midDetailDistanceValue.textContent = `${(tuning.midDetailDistanceM / 1_000).toFixed(1)} km`;
  terrainDrawDistanceValue.textContent = `${Math.round(tuning.drawDistanceM / 1_000)} km`;
  meshDetailReachValue.textContent = `${tuning.meshDetailPercent}%`;
}

function applyTerrainTuning(): void {
  const tuning = readTerrainTuning();
  if (tuning.midDetailDistanceM <= tuning.highDetailDistanceM) {
    tuning.midDetailDistanceM = tuning.highDetailDistanceM + 500;
    midDetailDistanceInput.value = String(tuning.midDetailDistanceM / 1_000);
  }
  updateTerrainTuningLabels();
  terrainStreamer?.setRenderTuning(tuning);
}

writeTerrainTuning(terrainTuningDefaults);
terrainQualityNote.textContent = qualityName === "high"
  ? "High: albedo + available normal/roughness maps."
  : `${qualityName[0].toUpperCase()}${qualityName.slice(1)}: scanned albedo only; use ?quality=high for surface normals.`;
for (const input of [highDetailDistanceInput, midDetailDistanceInput, terrainDrawDistanceInput, meshDetailReachInput]) {
  input.addEventListener("input", applyTerrainTuning);
}
document.getElementById("resetTerrainTuning")!.addEventListener("click", () => {
  writeTerrainTuning(terrainTuningDefaults);
  applyTerrainTuning();
});

function updateInteractionUi(mode: InteractionMode | "orbit"): void {
  const navigating = mode === "navigate";
  hudEl.classList.toggle("navigation-active", navigating);
  interactionStatusEl.textContent = navigating ? "Navigating" : mode === "ui" ? "Controls active" : "Inspector ready";
  interactionNoteEl.textContent = mode === "ui"
    ? "Movement paused. Tab or Enter world resumes."
    : "Choose Fly or Walk to enter the world.";
  toggleInteractionBtn.disabled = mode === "orbit";
  toggleInteractionBtn.textContent = mode === "orbit" ? "Choose Fly / Walk" : "Enter world";
  if (flying) {
    crosshairEl.classList.toggle("visible", navigating);
    flyHintEl.textContent = navigating
      ? `${flight?.currentMode === "walk" ? "WASD move · Shift sprint · Space jump/swim" : "WASD move · Space/Ctrl altitude · Shift boost · scroll speed"} · Tab controls · Esc mouse`
      : "Controls open · movement paused · Tab resumes · Esc exits Fly/Walk";
  }
  touchControls?.sync(mode);
}

async function boot() {
  statusEl.textContent = "loading manifest…";
  const isEmbedded = Boolean((globalThis as unknown as { __NEVORA_WORLD__?: unknown }).__NEVORA_WORLD__);
  const world = isEmbedded
    ? await loadEmbeddedWorld((msg) => (statusEl.textContent = `loading ${msg}`))
    : await loadWorld(seed, (msg) => (statusEl.textContent = `loading ${msg}`));
  const manifest = world.manifest;
  loadedWorld = world;

  statusEl.textContent = "loading scanned terrain materials…";
  const riverChannels = buildRiverChannelField(world);
  const carveRiverHeight = (x: number, z: number, height: number) => sampleRiverCarvedHeight(riverChannels, x, z, height);
  collisionHeights = new CollisionHeightCache(world.worldHeight, manifest.seed, sampleHeightWithSkirt, 128, 4, 64, carveRiverHeight);
  terrainStreamer = await TerrainStreamer.create(world, qualityName, renderer, riverChannels);
  terrainStreamer.setRenderTuning(readTerrainTuning());
  worldRoot.add(terrainStreamer.group);
  statusEl.textContent = "initializing navigable water…";
  waterSystem = new NavoraWaterSystem(world, qualityName, sun.position.clone().normalize());
  worldRoot.add(waterSystem.group);
  statusEl.textContent = "loading environmental models…";
  // Dressing only needs exact deterministic surface samples; routing hundreds
  // of placement probes through CollisionHeightCache synchronously constructed
  // a 33x33 collision patch at cell boundaries and caused the visible hitch.
  // Sampling the same macro height + local detail formula directly preserves
  // placement while keeping each admitted dressing cell cheap.
  const sampleDressingGround = (x: number, z: number) => {
    const macro = sampleHeightWithSkirt(world.worldHeight, x, z);
    return carveRiverHeight(x, z, macro + sampleLocalTerrainDetail(x, z, manifest.seed, macro));
  };
  environmentDressing = await EnvironmentDressing.create(world, sampleDressingGround, qualityName);
  worldRoot.add(environmentDressing.group);
  traversalBookmarks = buildTraversalBookmarks(
    world,
    (x, z) => collisionHeights!.sample(x, z),
    (x, z) => waterSystem!.sample(x, z) !== null,
  );
  const reviewBookmark = traversalBookmarks.find((candidate) => candidate.id === "alvora-resource-review");
  resourceReviewYard = await ResourceReviewYard.create(sampleDressingGround);
  if (reviewBookmark) resourceReviewYard.setAnchor(reviewBookmark);
  worldRoot.add(resourceReviewYard.group);
  const bookmarkSelect = document.getElementById("bookmarkSelect") as HTMLSelectElement;
  bookmarkSelect.replaceChildren(...traversalBookmarks.map((bookmark) => {
    const option = document.createElement("option");
    option.value = bookmark.id;
    option.textContent = bookmark.label;
    return option;
  }));
  const resourceReview = document.getElementById("resourceReview")!;
  resourceReview.addEventListener("click", () => {
    const bookmark = traversalBookmarks.find((candidate) => candidate.id === "alvora-resource-review");
    if (!bookmark || !flight) return;
    resourceReviewYard!.visible = true;
    environmentDressing?.setEnabled(false);
    document.getElementById("toggleDressing")!.classList.remove("active");
    resourceReview.classList.add("active");
    document.getElementById("reviewLegend")!.classList.add("visible");
    controls.enabled = false;
    setActiveView(viewWalkBtn);
    flying = true;
    setGroundCameraProjection(true);
    flyHintEl.classList.add("visible");
    if (!flight.isEnabled || flight.currentMode !== "walk") flight.enable(exitFlight, "walk", bookmark);
    flight.teleport(bookmark.x, bookmark.z, bookmark.heading);
  });

  // Let fly/walk roam well past the real generated coastline into the
  // synthetic ocean skirt (terrain.ts) -- the skirt itself reaches full
  // abyssal depth at SKIRT_REACH, so clamping camera travel to most of that
  // distance means "swim off the beach on any edge" actually holds, instead
  // of hitting a wall right at the data's own boundary.
  const worldBoundsRaw = world.worldHeight.bounds;
  const expandedBounds = {
    minX: worldBoundsRaw.minX - SKIRT_REACH * 0.85, maxX: worldBoundsRaw.maxX + SKIRT_REACH * 0.85,
    minZ: worldBoundsRaw.minZ - SKIRT_REACH * 0.85, maxZ: worldBoundsRaw.maxZ + SKIRT_REACH * 0.85,
  };
  flight = new FlightController(camera, renderer.domElement, {
    getGroundHeight: (x, z) => collisionHeights!.sample(x, z),
    getWorldOffset: () => ({ x: worldOrigin.offset.x, z: worldOrigin.offset.z }),
    getWater: (x, z) => {
      const water = waterSystem?.sample(x, z);
      return water ? { surfaceY: water.surfaceY, velocityX: water.velocityX, velocityZ: water.velocityZ } : null;
    },
    onInteractionModeChange: updateInteractionUi,
    worldBounds: expandedBounds,
  });
  touchControls = new TouchControls(flight);
  touchControls.sync("orbit");

  const zonesById = new Map(world.zones.map((z) => [z.id, z]));

  zoneOverlay = buildZoneBoundaries(world.zones, world.continents, manifest);
  // Cartographic guides are useful from orbit, but their long, sparsely
  // draped line segments can cut through terrain and sky at ground level.
  // Keep them opt-in so screenshots and playable review show renderer output
  // rather than debug geometry.
  zoneOverlay.visible = false;
  worldRoot.add(zoneOverlay);

  riverOverlay = waterSystem.riverGroup;
  lakeOverlay = waterSystem.lakeGroup;

  roadOverlay = buildRoads(world.continents, manifest);
  roadOverlay.visible = false;
  worldRoot.add(roadOverlay);

  settlementOverlay = buildSettlements(world.settlements, zonesById, world.continents, manifest);
  settlementOverlay.visible = false;
  worldRoot.add(settlementOverlay);

  const seaRegionOverlay = buildSeaRegions(world.seaRegions);
  seaRegionOverlay.visible = false;
  worldRoot.add(seaRegionOverlay);

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
    controls.target.set(worldOrigin.localX(wx), 800, worldOrigin.localZ(wz));
    camera.position.set(worldOrigin.localX(wx - 7000), 7000, worldOrigin.localZ(wz + 9500));
    controls.update();
  }

  // Reproducible visual-defect camera. This keeps user-supplied screenshot
  // coordinates and viewing angles stable across hot reloads/regeneration so
  // fixes are judged from the failing view rather than a flattering preset.
  if (hasSuppliedReviewCamera && flight) {
    controls.enabled = false;
    flying = true;
    camera.near = 1;
    camera.fov = 58;
    atmosphere.setMode("flight");
    terrainStreamer.setViewMode("flight");
    camera.updateProjectionMatrix();
    flight.enable(() => undefined, "fly");
    const ground = collisionHeights.sample(suppliedReviewCamera.x, suppliedReviewCamera.z);
    const altitudeAboveCapsule = Math.max(0, suppliedReviewCamera.y - ground - 1.72);
    flight.teleport(
      suppliedReviewCamera.x,
      suppliedReviewCamera.z,
      suppliedReviewCamera.yaw,
      altitudeAboveCapsule,
      suppliedReviewCamera.pitch,
    );
  }

  const cameraWorld = worldOrigin.worldPoint(camera.position);
  terrainStreamer.update(cameraWorld.x, cameraWorld.z);
}

const frameSamples: number[] = [];
const hitchWindow: number[] = [];
let telemetryElapsed = 0;
let scaleAdjustmentElapsed = 0;
let streamTourDistance = 0;

function animate(timestamp: number) {
  timer.update(timestamp);
  const rawDelta = timer.getDelta();
  const delta = Math.min(0.1, rawDelta); // clamp so a stalled tab doesn't teleport the camera on resume
  if (streamTourRequested && terrainStreamer && streamTourDistance < 10000) {
    const stream = terrainStreamer.stats;
    if (stream.active === stream.desired && stream.queued === 0 && stream.building === 0) {
      const step = Math.min(10000 - streamTourDistance, delta * 1000);
      camera.position.x += step;
      controls.target.x += step;
      streamTourDistance += step;
    }
  }
  if (flying && flight) {
    flight.update(delta);
  } else {
    controls.update();
  }
  if (terrainStreamer) {
    worldOrigin.update(camera, controls);
    terrainStreamer.updateWorldOrigin(worldOrigin.offset);
    terrainStreamer.update(worldOrigin.worldX(camera.position.x), worldOrigin.worldZ(camera.position.z));
  }
  if (environmentDressing) environmentDressing.update(
    worldOrigin.worldX(camera.position.x), worldOrigin.worldZ(camera.position.z),
  );
  resourceReviewYard?.updateWind(timer.getElapsed());
  if (waterSystem) waterSystem.update(
    timer.getElapsed(), worldOrigin.worldX(camera.position.x), worldOrigin.worldZ(camera.position.z), camera.position.y,
  );
  renderer.render(scene, camera);
  frameSamples.push(rawDelta * 1000);
  if (frameSamples.length > 180) frameSamples.shift();
  hitchWindow.push(rawDelta * 1000);
  if (hitchWindow.length > 600) hitchWindow.shift();
  telemetryElapsed += rawDelta;
  scaleAdjustmentElapsed += rawDelta;
  if (telemetryElapsed >= 0.25 && frameSamples.length > 0) {
    telemetryElapsed = 0;
    const sorted = [...frameSamples].sort((a, b) => a - b);
    const medianMs = sorted[Math.floor(sorted.length * 0.5)];
    const p95Ms = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
    const p99Ms = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))];
    const onePercentLow = 1000 / Math.max(0.01, p99Ms);
    const hitches = hitchWindow.filter((sample) => sample >= 50).length;
    const severeHitches = hitchWindow.filter((sample) => sample >= 100).length;
    const streamSettled = !terrainStreamer || (terrainStreamer.stats.queued === 0 && terrainStreamer.stats.building === 0);
    if (scaleAdjustmentElapsed >= 3 && streamSettled && frameSamples.length >= 120) {
      scaleAdjustmentElapsed = 0;
      // Median-only scaling allowed a nominal 60 FPS readout while every
      // second/third frame missed v-sync. Drive resolution from the tail as
      // well so the renderer reacts to the choppiness the player feels.
      const nextRatio = p95Ms > 24 || p99Ms > 30
        ? Math.max(quality.pixelRatioFloor, renderPixelRatio - 0.1)
        : medianMs < 13.8 && p95Ms < 18
          ? Math.min(Math.min(window.devicePixelRatio, quality.pixelRatioCap), renderPixelRatio + 0.05)
          : renderPixelRatio;
      if (Math.abs(nextRatio - renderPixelRatio) > 0.001) {
        renderPixelRatio = nextRatio;
        renderer.setPixelRatio(renderPixelRatio);
        frameSamples.length = 0;
      }
    }
    performanceEl.textContent = `${(1000 / medianMs).toFixed(0)} fps · ${medianMs.toFixed(1)} ms med · ${p95Ms.toFixed(1)} ms p95 · ${renderPixelRatio.toFixed(2)}x`;
    framePacingEl.textContent = `${onePercentLow.toFixed(0)} fps 1% low · ${p99Ms.toFixed(1)} ms p99 · ${hitches}/${severeHitches} >50/100ms`;
    const info = renderer.info;
    sceneStatsEl.textContent = `${info.render.drawCalls} draws · ${info.render.triangles.toLocaleString()} tris · ${info.memory.geometries} geo · ${info.memory.textures} tex`;
    if (terrainStreamer) {
      const stream = terrainStreamer.stats;
      const tour = streamTourRequested ? ` · tour ${(streamTourDistance / 1000).toFixed(1)}/10km` : "";
      const bubble = Number.isFinite(stream.viewDistance) ? `${(stream.viewDistance / 1000).toFixed(0)}km bubble` : "world overview";
      streamingStatsEl.textContent = `${stream.active}/${stream.desired} tiles · ${bubble} · g${stream.generation}/o${worldOrigin.rebaseCount} · q${stream.queued}+${stream.building} · ${stream.minSpacing}m near · ${stream.maxUpdateMs.toFixed(1)}ms select/${stream.maxCommitMs.toFixed(1)}ms commit/${stream.maxWorkerMs.toFixed(1)}ms worker${stream.frozen ? " · frozen" : ""}${tour}`;
    }
    if (environmentDressing) {
      const dress = environmentDressing.stats;
      dressingStatsEl.textContent = `${dress.instances.toLocaleString()} items / ${dress.cells} cells · ${dress.grass} grass · ${dress.bushes} bush · ${dress.rocks} rock · q${dress.queued} · ${dress.maxStreamMs.toFixed(1)}ms max${environmentDressing.isEnabled ? "" : " · hidden"}`;
    }
  }
  if (loadedWorld) {
    const worldX = worldOrigin.worldX(camera.position.x);
    const worldZ = worldOrigin.worldZ(camera.position.z);
    const ground = collisionHeights?.sample(worldX, worldZ) ?? sampleHeightWithSkirt(loadedWorld.worldHeight, worldX, worldZ);
    cameraPosEl.textContent = `${worldX.toFixed(0)}, ${worldZ.toFixed(0)} m`;
    altitudeEl.textContent = `${camera.position.y.toFixed(1)} / ${ground.toFixed(1)} m`;
    movementEl.textContent = flying && flight
      ? flight.currentInteractionMode === "ui"
        ? `${flight.currentMode} / controls open`
        : `${flight.currentMode} / ${flight.currentSpeed.toFixed(1)} m/s`
      : "orbit";
    locomotionEl.textContent = flying && flight ? flight.locomotionState : "camera orbit";
  }
}

async function startRenderer() {
  statusEl.textContent = "initializing renderer…";
  await renderer.init();
  updateBackendLabel();
  renderer.setAnimationLoop(animate);
  await boot();
}

startRenderer().catch((err) => {
  console.error(err);
  statusEl.textContent = `renderer startup failed: ${err instanceof Error ? err.message : String(err)}`;
});

// --- HUD wiring ---
const viewOrbitBtn = document.getElementById("viewOrbit")!;
const viewTopBtn = document.getElementById("viewTop")!;
const viewWorldBtn = document.getElementById("viewWorld")!;
const viewFlyBtn = document.getElementById("viewFly")!;
const viewWalkBtn = document.getElementById("viewWalk")!;
const flyHintEl = document.getElementById("flyHint")!;
const crosshairEl = document.getElementById("crosshair")!;

toggleInteractionBtn.addEventListener("click", () => {
  if (!flight?.isEnabled) return;
  flight.setInteractionMode("navigate", true);
});
updateInteractionUi("orbit");

function setActiveView(active: HTMLElement) {
  for (const btn of [viewOrbitBtn, viewTopBtn, viewWorldBtn, viewFlyBtn, viewWalkBtn]) btn.classList.remove("active");
  active.classList.add("active");
}

function setGroundCameraProjection(grounded: boolean) {
  // A 4 m near plane intersects the ground under a 1.72 m eye and literally
  // cuts away the foreground. Use an FPS projection for walking and retain
  // the long-range precision settings for scouting/overview modes.
  camera.near = grounded ? 0.08 : 4;
  camera.fov = grounded ? 62 : 55;
  atmosphere.setMode(grounded ? "ground" : "overview");
  terrainStreamer?.setViewMode(grounded ? "ground" : "overview");
  camera.updateProjectionMatrix();
}

function exitFlight() {
  flight?.disable();
  flying = false;
  controls.enabled = true;
  setGroundCameraProjection(false);
  flyHintEl.classList.remove("visible");
  crosshairEl.classList.remove("visible");
  updateInteractionUi("orbit");
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
  setGroundCameraProjection(false);
  controls.maxPolarAngle = Math.PI * 0.49;
  updateInteractionUi("orbit");
});
viewTopBtn.addEventListener("click", () => {
  flight?.disable();
  controls.enabled = true;
  setActiveView(viewTopBtn);
  setGroundCameraProjection(false);
  const target = controls.target.clone();
  // Preserve the current zoom distance rather than a fixed height, so
  // "top-down" behaves sensibly whether the last view was a close-up
  // corridor orbit or the pulled-back World view.
  const distance = Math.max(3000, camera.position.distanceTo(target));
  camera.position.set(target.x, distance, target.z + 0.01);
  controls.maxPolarAngle = 0.01;
  controls.update();
  updateInteractionUi("orbit");
});
viewWorldBtn.addEventListener("click", () => {
  flight?.disable();
  controls.enabled = true;
  setActiveView(viewWorldBtn);
  setGroundCameraProjection(false);
  if (!worldFrame) return;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.target.copy(worldOrigin.localPoint(worldFrame.center));
  camera.position.set(
    worldOrigin.localX(worldFrame.center.x),
    worldFrame.distance * 0.55,
    worldOrigin.localZ(worldFrame.center.z + worldFrame.distance * 0.75),
  );
  controls.update();
  updateInteractionUi("orbit");
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
  camera.near = 1;
  camera.fov = 58;
  atmosphere.setMode("flight");
  terrainStreamer?.setViewMode("flight");
  camera.updateProjectionMatrix();
  flyHintEl.classList.add("visible");
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
  setGroundCameraProjection(true);
  flyHintEl.classList.add("visible");
  // Coming from Fly, start walking right where you were flying (the camera
  // IS the current viewpoint there). Coming from Orbit/Top-down/World,
  // stand at whatever point the camera was last looking AT (controls.target)
  // instead of the camera's own eye position, which after e.g. the World
  // overview is tens of km out in open ocean.
  const anchor = resolveWalkTransitionAnchor(
    wasFlying,
    { x: worldOrigin.worldX(camera.position.x), z: worldOrigin.worldZ(camera.position.z) },
    { x: worldOrigin.worldX(controls.target.x), z: worldOrigin.worldZ(controls.target.z) },
    (target) => collisionHeights
      ? findSafeTraversalPoint((x, z) => collisionHeights!.sample(x, z), target.x, target.z)
      : target,
  );
  flight.enable(exitFlight, "walk", anchor);
});

document.getElementById("teleportBookmark")!.addEventListener("click", () => {
  if (!flight) return;
  const selected = (document.getElementById("bookmarkSelect") as HTMLSelectElement).value;
  const bookmark = traversalBookmarks.find((candidate) => candidate.id === selected);
  if (!bookmark) return;
  if (resourceReviewYard) {
    resourceReviewYard.visible = bookmark.id === "alvora-resource-review";
    environmentDressing?.setEnabled(!resourceReviewYard.visible);
    document.getElementById("toggleDressing")!.classList.toggle("active", !resourceReviewYard.visible);
    document.getElementById("resourceReview")!.classList.toggle("active", resourceReviewYard.visible);
    document.getElementById("reviewLegend")!.classList.toggle("visible", resourceReviewYard.visible);
  }
  controls.enabled = false;
  const reviewMode = bookmark.altitudeM ? "fly" : "walk";
  setActiveView(reviewMode === "fly" ? viewFlyBtn : viewWalkBtn);
  flying = true;
  setGroundCameraProjection(reviewMode === "walk");
  flyHintEl.classList.add("visible");
  if (!flight.isEnabled || flight.currentMode !== reviewMode) flight.enable(exitFlight, reviewMode, bookmark);
  flight.teleport(bookmark.x, bookmark.z, bookmark.heading, bookmark.altitudeM, bookmark.pitch);
});

(document.getElementById("materialDebug") as HTMLSelectElement).addEventListener("change", (event) => {
  terrainStreamer?.setMaterialDebugMode((event.currentTarget as HTMLSelectElement).value as TerrainMaterialDebugMode);
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
wireToggle("toggleRivers", () => riverOverlay);
wireToggle("toggleLakes", () => lakeOverlay);
wireToggle("toggleSettlements", () => settlementOverlay);
document.getElementById("toggleDressing")!.addEventListener("click", (event) => {
  if (!environmentDressing) return;
  const enabled = !environmentDressing.isEnabled;
  environmentDressing.setEnabled(enabled);
  (event.currentTarget as HTMLElement).classList.toggle("active", enabled);
});
document.getElementById("toggleWireframe")!.addEventListener("click", (event) => {
  if (!terrainStreamer) return;
  const active = !(event.currentTarget as HTMLElement).classList.contains("active");
  terrainStreamer.setWireframe(active);
  (event.currentTarget as HTMLElement).classList.toggle("active", active);
});
document.getElementById("toggleTileLod")!.addEventListener("click", (event) => {
  if (!terrainStreamer) return;
  const active = !(event.currentTarget as HTMLElement).classList.contains("active");
  terrainStreamer.setDebugLod(active);
  (event.currentTarget as HTMLElement).classList.toggle("active", active);
});
document.getElementById("freezeStreaming")!.addEventListener("click", (event) => {
  if (!terrainStreamer) return;
  terrainStreamer.setFrozen(!terrainStreamer.isFrozen);
  (event.currentTarget as HTMLElement).classList.toggle("active", terrainStreamer.isFrozen);
});
