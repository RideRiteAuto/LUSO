import * as THREE from "three/webgpu";
import type { ContinentData, Manifest, RiverRecord, RoadRecord, SeaRegionRecord, SettlementRecord, ZoneRecord } from "./worldData.js";
import { sampleHeight } from "./terrain.js";
import { uvToWorld } from "./layout.js";

const OVERLAY_LIFT = 3; // scene units above terrain so lines/markers don't z-fight with the mesh

function heightAtWorld(continent: ContinentData, u: number, v: number): number {
  return Math.max(sampleHeight(continent, u, v), -40) + OVERLAY_LIFT;
}

/**
 * Subdivides a polyline (in continent-local UV) into many short steps and
 * samples terrain height at each one, so the resulting line hugs the
 * ground instead of cutting through hills as a straight chord between two
 * sparse vertices. This is the fix for zone-boundary lines looking like
 * "wires that run through the land" -- they were only ever elevated at
 * their original (few, far-apart) vertices before.
 */
function drapeOnTerrain(points: [number, number][], continent: ContinentData, manifest: Manifest, stepsPerSegment = 24): THREE.Vector3[] {
  const draped: THREE.Vector3[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [u0, v0] = points[i];
    const [u1, v1] = points[i + 1];
    const steps = i === points.length - 2 ? stepsPerSegment + 1 : stepsPerSegment; // include the final endpoint once
    for (let s = 0; s < steps; s++) {
      const t = s / stepsPerSegment;
      const u = u0 + (u1 - u0) * t;
      const v = v0 + (v1 - v0) * t;
      const [x, z] = uvToWorld(u, v, continent.id, manifest);
      draped.push(new THREE.Vector3(x, heightAtWorld(continent, u, v), z));
    }
  }
  return draped;
}

export function buildZoneBoundaries(zones: ZoneRecord[], continents: Record<string, ContinentData>, manifest: Manifest): THREE.Group {
  const group = new THREE.Group();
  group.name = "zoneBoundaries";

  const bandColors = [0xffffff, 0xffe08a, 0xffb37a, 0xff8a8a, 0x8affe0, 0x8ab3ff, 0xd08aff, 0xff8ad0];

  for (const zone of zones) {
    const continent = continents[zone.continent];
    if (!continent || zone.boundary.length < 3) continue;
    const color = bandColors[(zone.band - 1) % bandColors.length];

    const points = drapeOnTerrain([...zone.boundary, zone.boundary[0]], continent, manifest);
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({ color, linewidth: 2, transparent: true, opacity: 0.85 });
    const line = new THREE.Line(geometry, material);
    line.userData = { zoneId: zone.id, properName: zone.properName, descriptor: zone.descriptor, band: zone.band };
    group.add(line);
  }

  return group;
}

const RIVER_SOURCE_WIDTH = 5;
const RIVER_MOUTH_WIDTH = 26;

/**
 * Builds a flat ribbon (a real strip of triangles with actual width) instead
 * of a THREE.Line -- WebGL ignores CSS-style line-width on essentially every
 * platform (a long-standing spec limitation, not a bug in this code), so a
 * Line's `linewidth` renders as a constant ~1px hairline regardless of the
 * value set, which is why rivers read as "so skinny" no matter how the
 * material was configured. Width tapers from source to mouth, since the
 * path is already ordered source->mouth (hydrology/index.ts).
 */
function buildRiverRibbon(path3D: THREE.Vector3[]): THREE.Mesh {
  const n = path3D.length;
  const positions = new Float32Array(n * 2 * 3);
  const up = new THREE.Vector3(0, 1, 0);

  for (let i = 0; i < n; i++) {
    const prev = path3D[Math.max(0, i - 1)];
    const next = path3D[Math.min(n - 1, i + 1)];
    const tangent = next.clone().sub(prev);
    if (tangent.lengthSq() < 1e-6) tangent.set(1, 0, 0);
    tangent.normalize();
    const side = tangent.clone().cross(up).normalize();

    const width = RIVER_SOURCE_WIDTH + (RIVER_MOUTH_WIDTH - RIVER_SOURCE_WIDTH) * (i / Math.max(1, n - 1));
    const p = path3D[i];
    const left = p.clone().addScaledVector(side, -width / 2);
    const right = p.clone().addScaledVector(side, width / 2);

    positions[i * 6] = left.x;
    positions[i * 6 + 1] = left.y;
    positions[i * 6 + 2] = left.z;
    positions[i * 6 + 3] = right.x;
    positions[i * 6 + 4] = right.y;
    positions[i * 6 + 5] = right.z;
  }

  const indices: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
    indices.push(a, c, b, b, c, d);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    color: 0x5ec8ff, transparent: true, opacity: 0.88, roughness: 0.35, metalness: 0.05, side: THREE.DoubleSide,
  });
  return new THREE.Mesh(geometry, material);
}

export function buildRivers(continents: Record<string, ContinentData>, manifest: Manifest): THREE.Group {
  const group = new THREE.Group();
  group.name = "rivers";

  for (const continent of Object.values(continents)) {
    for (const river of continent.rivers as RiverRecord[]) {
      if (river.path.length < 2) continue;
      // River paths already carry one point per grid cell traversed (from
      // the flow-accumulation trace in hydrology/index.ts), which is
      // already dense enough to hug terrain without further subdivision --
      // unlike the zone-boundary hull, these aren't sparse chords.
      const points = river.path.map(([u, v]) => {
        const [x, z] = uvToWorld(u, v, continent.id, manifest);
        return new THREE.Vector3(x, heightAtWorld(continent, u, v) + 0.5, z);
      });
      group.add(buildRiverRibbon(points));
    }
  }

  return group;
}

export function buildRoads(continents: Record<string, ContinentData>, manifest: Manifest): THREE.Group {
  const group = new THREE.Group();
  group.name = "roads";

  for (const continent of Object.values(continents)) {
    for (const road of continent.roads as RoadRecord[]) {
      const points = drapeOnTerrain(road.path as [number, number][], continent, manifest, 40);
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const color = road.kind === "road" ? 0xd8c48a : 0x9a8a6a;
      const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.6 });
      group.add(new THREE.Line(geometry, material));

      // Bridge points: where this road's terrain-aware route actually
      // crosses water (roads/index.ts) -- a flat plank spanning the
      // crossing, sitting right at the waterline, so it reads as "a bridge
      // goes here" rather than the road just silently walking on water.
      for (const bridge of road.bridges) {
        const [sx, sz] = uvToWorld(bridge.start[0], bridge.start[1], continent.id, manifest);
        const [ex, ez] = uvToWorld(bridge.end[0], bridge.end[1], continent.id, manifest);
        const mid = new THREE.Vector3((sx + ex) / 2, OVERLAY_LIFT + 1, (sz + ez) / 2);
        const length = Math.hypot(ex - sx, ez - sz);
        const angle = Math.atan2(ez - sz, ex - sx);

        const deckGeometry = new THREE.BoxGeometry(Math.max(length, 8), 1.5, 10);
        const deckMaterial = new THREE.MeshStandardMaterial({ color: 0xd9a75c, roughness: 0.7 });
        const deck = new THREE.Mesh(deckGeometry, deckMaterial);
        deck.position.copy(mid);
        deck.rotation.y = -angle;
        deck.userData = { kind: "bridge", roadId: road.id };
        group.add(deck);
      }
    }
  }

  return group;
}

const TIER_COLORS: Record<number, number> = { 1: 0xffd24a, 2: 0xf0f0f0, 3: 0xa8a8a8, 4: 0x707070 };
// Sized to stay legible at true 1:1 scale against a 32768m continent tile,
// not to scale realistically against terrain features -- these are debug
// markers (a settlement isn't literally a 60m-wide cone).
const TIER_SIZE: Record<number, number> = { 1: 180, 2: 130, 3: 90, 4: 65 };

export function buildSettlements(settlements: SettlementRecord[], zonesById: Map<string, ZoneRecord>, continents: Record<string, ContinentData>, manifest: Manifest): THREE.Group {
  const group = new THREE.Group();
  group.name = "settlements";

  for (const s of settlements) {
    const zone = zonesById.get(s.zoneId);
    const continent = zone ? continents[zone.continent] : undefined;
    if (!zone || !continent) continue;

    const [x, z] = uvToWorld(s.position[0], s.position[1], zone.continent, manifest);
    const y = heightAtWorld(continent, s.position[0], s.position[1]) + 3;

    const geometry = new THREE.ConeGeometry(TIER_SIZE[s.tier] ?? 60, (TIER_SIZE[s.tier] ?? 60) * 2, 6);
    const material = new THREE.MeshStandardMaterial({ color: TIER_COLORS[s.tier] ?? 0x888888, emissive: 0x221100, emissiveIntensity: 0.2 });
    const marker = new THREE.Mesh(geometry, material);
    marker.position.set(x, y, z);
    marker.userData = { name: s.name, type: s.type, reason: s.reason, tier: s.tier, zoneId: s.zoneId };
    group.add(marker);
  }

  return group;
}

/** The Bruma: a glowing marker + ring in the middle of the Luna Sea, per docs/01 §5 / docs/03 §1. */
export function buildSeaRegions(seaRegions: SeaRegionRecord[]): THREE.Group {
  const group = new THREE.Group();
  group.name = "seaRegions";

  for (const region of seaRegions) {
    const [x, z] = region.center;
    const ringGeometry = new THREE.RingGeometry(region.radiusUnits * 0.94, region.radiusUnits, 64);
    ringGeometry.rotateX(-Math.PI / 2);
    const ringMaterial = new THREE.MeshBasicMaterial({ color: 0x7a4de0, transparent: true, opacity: 0.55, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.position.set(x, -2, z);
    ring.userData = { name: region.name, notes: region.notes };
    group.add(ring);

    const coreGeometry = new THREE.SphereGeometry(region.radiusUnits * 0.08, 16, 16);
    const coreMaterial = new THREE.MeshStandardMaterial({ color: 0x9a6bff, emissive: 0x5a2ea6, emissiveIntensity: 1.2 });
    const core = new THREE.Mesh(coreGeometry, coreMaterial);
    core.position.set(x, 200, z);
    core.userData = { name: region.name, notes: region.notes };
    group.add(core);
  }

  return group;
}
