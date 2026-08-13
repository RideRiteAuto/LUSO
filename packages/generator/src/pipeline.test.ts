import test from "node:test";
import assert from "node:assert/strict";
import { generateWorld } from "./pipeline.js";
import { SCENIC_RIVER_RULES } from "./hydrology/index.js";
import { loadContinentLayout, loadZoneDesigns } from "./designData.js";
import { generateWorldHeightField } from "./elevation/index.js";
import { DEFAULT_SILHOUETTE } from "./elevation/silhouettes.js";
import { SeedRegistry } from "./seed/index.js";

function edgeValues(data: Float32Array, width: number, height: number): number[] {
  const values: number[] = [];
  for (let x = 0; x < width; x++) values.push(data[x], data[(height - 1) * width + x]);
  for (let y = 1; y < height - 1; y++) values.push(data[y * width], data[y * width + width - 1]);
  return values;
}

function pointInPolygon(x: number, y: number, polygon: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i], [xj, yj] = polygon[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

test("same seed produces identical authoritative terrain", () => {
  const a = generateWorld({ seed: 48291, heightmapResolution: 96 });
  const b = generateWorld({ seed: 48291, heightmapResolution: 96 });
  assert.deepEqual(a.worldHeightField.data, b.worldHeightField.data);
  assert.deepEqual(a.roads, b.roads);
  assert.deepEqual(a.resources, b.resources);
});

test("different seeds produce different terrain", () => {
  const a = generateWorld({ seed: 48291, heightmapResolution: 64 });
  const b = generateWorld({ seed: 48292, heightmapResolution: 64 });
  assert.notDeepEqual(a.worldHeightField.data, b.worldHeightField.data);
});

test("Valora and Seradia have distinct macro silhouettes", () => {
  const world = generateWorld({ seed: 48291, heightmapResolution: 128 });
  const signatures = world.manifest.continents.map((continent) => {
    const field = world.heightFields[continent];
    let minX = field.width, maxX = 0, minY = field.height, maxY = 0, land = 0;
    for (let y = 0; y < field.height; y++) {
      for (let x = 0; x < field.width; x++) {
        if (field.data[y * field.width + x] <= 0) continue;
        land++;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
    }
    return { aspect: (maxX - minX + 1) / (maxY - minY + 1), land };
  });
  assert.ok(Math.abs(signatures[0].aspect - signatures[1].aspect) > 0.08, "continent aspect ratios are too similar");
  assert.ok(Math.abs(signatures[0].land - signatures[1].land) > 128, "continent land areas are suspiciously similar");
});

test("every zone anchor stands on dry land", () => {
  // A zone whose anchor is underwater has no region: its settlements, roads
  // and resources are placed into open sea. The silhouette is built from the
  // zone layout precisely so this holds by construction, but "by construction"
  // has failed twice — once when domain warp slid anchors off their own mass
  // peak, and again when the coastal grain was allowed to subtract at an
  // anchor — and in neither case did anything else in the suite notice.
  //
  // Two checks, because two different stages own the invariant. The BASE
  // terrain must hold land at the exact anchor — that is the silhouette's
  // guarantee, and both historical failures were here. The CARVED terrain
  // only has to keep dry ground within a settlement's reach of the anchor:
  // rivers are emergent, and a delta distributary legitimately brushes past
  // a low anchor (Solmara), with the settlement nudging to the levee beside
  // it. What carving must never do is drown the entire zone centre.
  const world = generateWorld({ seed: 48291, heightmapResolution: 192 });
  const drowned: string[] = [];
  for (const zone of loadZoneDesigns()) {
    const field = world.heightFields[zone.continent];
    const x = Math.round(zone.anchor[0] * (field.width - 1));
    const y = Math.round(zone.anchor[1] * (field.height - 1));
    // ~2.7 km at this resolution. Settlement placement nudges up to 40 cells
    // to find valid ground, so this is far stricter than placement needs —
    // but loose enough for authored low-lying centres: Solmara is a delta
    // whose zone centre is a lagoon, with the dry spit ~2 km away.
    const reachCells = 8;
    let driest = -Infinity;
    for (let dy = -reachCells; dy <= reachCells; dy++) {
      for (let dx = -reachCells; dx <= reachCells; dx++) {
        const nx = Math.max(0, Math.min(field.width - 1, x + dx));
        const ny = Math.max(0, Math.min(field.height - 1, y + dy));
        driest = Math.max(driest, field.data[ny * field.width + nx]);
      }
    }
    if (driest <= 0) drowned.push(`${zone.id} (${zone.continent}, best nearby ${driest.toFixed(1)}m)`);
  }
  assert.deepEqual(drowned, [], `zone centres with no dry land in reach: ${drowned.join(", ")}`);

  // The silhouette's own exact-cell guarantee, measured before any carving.
  const layout = loadContinentLayout();
  const zones = loadZoneDesigns();
  const base = generateWorldHeightField(
    new SeedRegistry(48291), layout, zones, layout.continentTileSize / 192, DEFAULT_SILHOUETTE,
  );
  const tile = layout.continentTileSize;
  const baseDrowned: string[] = [];
  for (const zone of zones) {
    const offset = layout.continents.find((continent) => continent.id === zone.continent)!.worldOffset;
    const gx = Math.round((offset[0] + zone.anchor[0] * tile - base.bounds.minX)
      / (base.bounds.maxX - base.bounds.minX) * (base.field.width - 1));
    const gy = Math.round((offset[1] + zone.anchor[1] * tile - base.bounds.minZ)
      / (base.bounds.maxZ - base.bounds.minZ) * (base.field.height - 1));
    const elevation = base.field.data[gy * base.field.width + gx];
    if (elevation <= 0) baseDrowned.push(`${zone.id} (${zone.continent}, ${elevation.toFixed(1)}m)`);
  }
  assert.deepEqual(baseDrowned, [], `anchors underwater in base terrain: ${baseDrowned.join(", ")}`);
});

test("world scale and relief meet the regional terrain floor", () => {
  const world = generateWorld({ seed: 48291, heightmapResolution: 192 });
  assert.ok(world.manifest.worldScale.continentTileSize >= 65_536, "continents are smaller than the approved doubled scale");
  for (const continent of world.manifest.continents) {
    const field = world.heightFields[continent];
    let peak = 0;
    let reliefSamples = 0;
    let reliefSum = 0;
    for (let y = 1; y < field.height; y++) {
      for (let x = 1; x < field.width; x++) {
        const i = y * field.width + x;
        if (field.data[i] <= 0) continue;
        peak = Math.max(peak, field.data[i]);
        reliefSum += Math.abs(field.data[i] - field.data[i - 1]);
        reliefSum += Math.abs(field.data[i] - field.data[i - field.width]);
        reliefSamples += 2;
      }
    }
    assert.ok(peak > 2_000, `${continent} lacks major mountain relief`);
    assert.ok(reliefSum / reliefSamples > 20, `${continent} remains excessively smooth`);
  }
});

test("authoritative world boundary is entirely underwater", () => {
  const world = generateWorld({ seed: 48291, heightmapResolution: 96 });
  const { data, width, height } = world.worldHeightField;
  const edges = edgeValues(data, width, height);
  assert.equal(edges.filter((v) => v >= 0).length, 0, "positive land reached the external world boundary");
  assert.ok(Math.max(...edges) < -10, "world boundary lacks a safe bathymetric margin");
});

test("lakes are filled basins with spill outlets and all rivers terminate in canonical water", () => {
  const world = generateWorld({ seed: 48291, heightmapResolution: 128 });
  assert.ok(world.water.seradia.lakes.length >= 1, "Vidrala lacks its authored Glassmere basin");
  for (const continent of world.manifest.continents) {
    for (const lake of world.water[continent].lakes) {
      assert.ok(lake.polygon.length >= 3, `${lake.id} lacks a shoreline`);
      const minimumDepth = lake.kind === "lake" ? 10
        : lake.kind === "pond" ? SCENIC_RIVER_RULES.breachDepthM * 0.8
          : SCENIC_RIVER_RULES.wetlandPoolDepthM;
      assert.ok(lake.depthM >= minimumDepth, `${lake.id} is too shallow for aquatic gameplay`);
      assert.ok(lake.surfaceElevationM > 0 && lake.spillElevationM === lake.surfaceElevationM, `${lake.id} lacks a valid spill level`);
      assert.ok(lake.outlet.every((coordinate) => coordinate >= 0 && coordinate <= 1), `${lake.id} has an invalid outlet`);
      if (lake.kind === "lake") assert.ok(world.water[continent].rivers.some((river) => river.mouthKind === "lake-outlet" && Math.abs(river.sourceElevationM - lake.surfaceElevationM) < 0.1), `${lake.id} has no compiled outlet river`);

      const localField = world.heightFields[continent];
      const minU = Math.min(...lake.polygon.map(([u]) => u)), maxU = Math.max(...lake.polygon.map(([u]) => u));
      const minV = Math.min(...lake.polygon.map(([, v]) => v)), maxV = Math.max(...lake.polygon.map(([, v]) => v));
      let localBed = Number.POSITIVE_INFINITY, localX = -1, localY = -1;
      for (let y = Math.max(0, Math.floor(minV * (localField.height - 1))); y <= Math.min(localField.height - 1, Math.ceil(maxV * (localField.height - 1))); y++) {
        for (let x = Math.max(0, Math.floor(minU * (localField.width - 1))); x <= Math.min(localField.width - 1, Math.ceil(maxU * (localField.width - 1))); x++) {
          const u = x / (localField.width - 1), v = y / (localField.height - 1);
          if (!pointInPolygon(u, v, lake.polygon)) continue;
          const bed = localField.data[y * localField.width + x];
          if (bed < localBed) { localBed = bed; localX = x; localY = y; }
        }
      }
      // Reduced-resolution fixtures can place a tiny pool between samples;
      // the compiler then anchors its nearest centroid sample deliberately.
      if (localX < 0) {
        const center = lake.polygon.reduce(([u, v], point) => [u + point[0], v + point[1]], [0, 0] as [number, number]);
        localX = Math.round(center[0] / lake.polygon.length * (localField.width - 1));
        localY = Math.round(center[1] / lake.polygon.length * (localField.height - 1));
        localBed = localField.data[localY * localField.width + localX];
      }
      assert.ok(localBed < lake.surfaceElevationM - Math.min(5, lake.depthM * 0.35), `${lake.id} is still only a flat surface over land`);

      const layout = world.manifest.continentLayout[continent];
      const worldX = layout.worldOffset[0] + localX / (localField.width - 1) * world.manifest.worldScale.continentTileSize;
      const worldZ = layout.worldOffset[1] + localY / (localField.height - 1) * world.manifest.worldScale.continentTileSize;
      const bounds = world.worldBounds;
      const unifiedX = Math.round((worldX - bounds.minX) / (bounds.maxX - bounds.minX) * (world.worldHeightField.width - 1));
      const unifiedY = Math.round((worldZ - bounds.minZ) / (bounds.maxZ - bounds.minZ) * (world.worldHeightField.height - 1));
      const unifiedBed = world.worldHeightField.data[unifiedY * world.worldHeightField.width + unifiedX];
      assert.ok(unifiedBed < lake.surfaceElevationM - 0.35, `${lake.id} carve was not copied into unified browser terrain`);
    }
    for (const river of world.water[continent].rivers) {
      assert.ok(
        river.terminatesIn.type === "ocean"
        || world.water[continent].lakes.some((lake) => lake.id === river.terminatesIn.featureId)
        || world.water[continent].rivers.some((candidate) => candidate.id === river.terminatesIn.featureId),
      );
      assert.equal(river.path.length, river.surfaceElevationM.length);
      assert.ok(river.widthProfileM && river.widthProfileM.length === river.path.length, `${river.id} lacks a width profile`);
      assert.ok(river.profile.widthM[0] >= SCENIC_RIVER_RULES.minWidthM * 0.9, `${river.id} begins implausibly narrow`);
      assert.ok(river.profile.widthM[1] <= SCENIC_RIVER_RULES.maxWidthM * (1 + SCENIC_RIVER_RULES.mouthFlare) + 1, `${river.id} is waterway-scale — scenic rivers must stay creek-to-trunk scale`);
      assert.equal(river.profile.navigableFromT, 1, `${river.id} claims ship navigability — boats belong to the waterway network`);
      for (let i = 1; i < river.widthProfileM!.length; i++) {
        assert.ok(river.widthProfileM![i] >= river.widthProfileM![i - 1] - 0.5, `${river.id} narrows downstream`);
      }
      for (let i = 1; i < river.surfaceElevationM.length; i++) {
        assert.ok(river.surfaceElevationM[i] <= river.surfaceElevationM[i - 1] + 0.001, `${river.id} flows uphill`);
      }
      const sampleIndex = Math.max(1, Math.min(river.path.length - 2, Math.floor(river.path.length * 0.65)));
      const [u, v] = river.path[sampleIndex];
      const field = world.heightFields[continent];
      const x = Math.round(u * (field.width - 1)), y = Math.round(v * (field.height - 1));
      const bed = field.data[y * field.width + x];
      assert.ok(bed < river.surfaceElevationM[sampleIndex] - 0.5, `${river.id} surface is not backed by a carved riverbed`);
    }
  }
});

test("scenic river surfaces hug the terrain — no floating ribbons", () => {
  // The audit that motivated the water rework measured 87% of river length
  // perched above the neighbouring ground, a third of it by >100 m. This
  // gate asserts the fixed invariant: away from resolved lake/pond water and
  // away from the falls the compiler deliberately exports, the water surface
  // stays within breach depth of the ground beside it.
  //
  // Resolution 192 rather than 128: on the mountainous Valora much of the
  // river network is genuinely waterfall, and at a coarser grid too few calm
  // reaches survive the fall filter for the measurement to mean anything.
  const world = generateWorld({ seed: 48291, heightmapResolution: 192 });
  for (const continent of world.manifest.continents) {
    const field = world.heightFields[continent];
    const lakes = world.water[continent].lakes;
    let stations = 0, violations = 0, worstHover = 0;
    for (const river of world.water[continent].rivers) {
      for (let i = 2; i < river.path.length - 2; i += 3) {
        const surface = river.surfaceElevationM[i];
        if (surface <= 1) continue; // sea-level handoff
        const [u, v] = river.path[i];
        if (lakes.some((lake) => pointInPolygon(u, v, lake.polygon))) continue;
        // Skip waterfall reaches: where the surface is descending steeply the
        // water is deliberately airborne, and its lateral neighbours on a
        // mountainside are far below it by definition. Those are the falls
        // the compiler exports, not floating ribbons.
        const runM = Math.hypot(
          river.path[i + 1][0] - u, river.path[i + 1][1] - v,
        ) * world.manifest.worldScale.continentTileSize;
        const dropM = surface - river.surfaceElevationM[i + 1];
        if (runM > 0 && dropM / runM > SCENIC_RIVER_RULES.fallSlope) continue;
        if ((river.falls ?? []).some((fall) => Math.hypot(fall.position[0] - u, fall.position[1] - v)
          * world.manifest.worldScale.continentTileSize < 900)) continue;
        const x = Math.round(u * (field.width - 1)), y = Math.round(v * (field.height - 1));
        // Both lateral neighbours (the cells beside the channel at this
        // resolution) must reach at least surface - breach - tolerance.
        let sideMax = Number.NEGATIVE_INFINITY;
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= field.width || ny >= field.height) continue;
          sideMax = Math.max(sideMax, field.data[ny * field.width + nx]);
        }
        stations++;
        const hover = surface - sideMax;
        worstHover = Math.max(worstHover, hover);
        if (hover > SCENIC_RIVER_RULES.breachDepthM + 8) violations++;
      }
    }
    assert.ok(stations > 10, `${continent} produced too few measurable river stations`);
    assert.ok(
      violations / stations <= 0.05,
      `${continent}: ${(100 * violations / stations).toFixed(1)}% of river stations float above the terrain (worst hover ${worstHover.toFixed(1)} m)`,
    );
  }
});

test("navigable waterways run below sea level from the sea to every port", () => {
  const world = generateWorld({ seed: 48291, heightmapResolution: 128 });
  for (const continent of world.manifest.continents) {
    const waterways = world.water[continent].waterways;
    assert.ok(waterways.length >= 1, `${continent} has no navigable waterway network`);
    const field = world.heightFields[continent];
    const cellOf = ([u, v]: [number, number]) => {
      const x = Math.max(0, Math.min(field.width - 1, Math.round(u * (field.width - 1))));
      const y = Math.max(0, Math.min(field.height - 1, Math.round(v * (field.height - 1))));
      return y * field.width + x;
    };
    for (const waterway of waterways) {
      assert.ok(waterway.path.length >= 2, `${waterway.id} has no routed path`);
      assert.ok(waterway.ports.length >= 1, `${waterway.id} serves no ports`);
      // Channel bed reaches full authored draft near every path point.
      for (let i = 0; i < waterway.path.length; i += 2) {
        const cell = cellOf(waterway.path[i]);
        const x = cell % field.width, y = Math.floor(cell / field.width);
        let deepest = field.data[cell];
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= field.width || ny >= field.height) continue;
          deepest = Math.min(deepest, field.data[ny * field.width + nx]);
        }
        assert.ok(deepest <= -(waterway.bedDepthM - 2), `${waterway.id} bed rises to ${deepest.toFixed(1)} m near path point ${i} — a hull would ground`);
      }
      // A boat can float (water >= 2 m deep) from the sea end to every port
      // without leaving the water: BFS over submerged cells.
      const startCell = cellOf(waterway.path[0]);
      const reachable = new Uint8Array(field.width * field.height);
      const queue = [startCell];
      reachable[startCell] = 1;
      let head = 0;
      while (head < queue.length) {
        const current = queue[head++];
        const x = current % field.width, y = Math.floor(current / field.width);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= field.width || ny >= field.height) continue;
          const neighbor = ny * field.width + nx;
          if (reachable[neighbor] || field.data[neighbor] > -2) continue;
          reachable[neighbor] = 1;
          queue.push(neighbor);
        }
      }
      for (const port of waterway.ports) {
        const portCell = cellOf(port.uv);
        const px = portCell % field.width, py = Math.floor(portCell / field.width);
        let portReachable = false;
        for (let dy = -2; dy <= 2 && !portReachable; dy++) for (let dx = -2; dx <= 2 && !portReachable; dx++) {
          const nx = px + dx, ny = py + dy;
          if (nx < 0 || ny < 0 || nx >= field.width || ny >= field.height) continue;
          if (reachable[ny * field.width + nx]) portReachable = true;
        }
        assert.ok(portReachable, `${waterway.id}: no floating route from the sea to ${port.name}`);
      }
    }
  }
});

test("bathymetry contains navigable shallows, shelves, a deep Luna Sea, and the Bruma hook", () => {
  const world = generateWorld({ seed: 48291, heightmapResolution: 128 });
  let shallows = 0, shelves = 0, deep = 0, minimum = 0;
  for (const elevation of world.worldHeightField.data) {
    minimum = Math.min(minimum, elevation);
    if (elevation < 0 && elevation >= -80) shallows++;
    else if (elevation < -80 && elevation >= -700) shelves++;
    else if (elevation <= -2_800) deep++;
  }
  assert.ok(shallows > 250, "coasts lack navigable shallows");
  assert.ok(shelves > 1_000, "continental shelves are underdeveloped");
  assert.ok(deep > 500, "the Luna Sea lacks deep-water area");
  assert.ok(minimum < -4_000, "the trench/Bruma depth hook is missing");
  const bruma = world.seaRegions[0];
  const { data, width, height } = world.worldHeightField;
  const bounds = world.worldBounds;
  const bx = Math.round((bruma.center[0] - bounds.minX) / (bounds.maxX - bounds.minX) * (width - 1));
  const by = Math.round((bruma.center[1] - bounds.minZ) / (bounds.maxZ - bounds.minZ) * (height - 1));
  assert.ok(data[by * width + bx] < -3_800, "Bruma is not represented in authoritative bathymetry");
});

test("resources never duplicate a cell and ecology respects settlements", () => {
  const world = generateWorld({ seed: 48291, heightmapResolution: 96 });
  for (const resource of world.resources) {
    const keys = resource.instances.map((i) => `${i.zoneId}:${i.position[0]}:${i.position[1]}`);
    assert.equal(new Set(keys).size, keys.length, `${resource.resourceId} contains duplicate cells`);
  }
  const tileSize = world.manifest.worldScale.continentTileSize;
  for (const spawn of world.spawns) {
    for (const point of spawn.region) {
      for (const settlement of world.settlements.filter((s) => s.zoneId === spawn.zoneId)) {
        const distance = Math.hypot(point[0] - settlement.position[0], point[1] - settlement.position[1]) * tileSize;
        assert.ok(distance >= spawn.minDistanceFromSettlementM, `${spawn.creatureId} overlaps ${settlement.id}`);
      }
    }
  }
});
