import * as THREE from "three";
import type { ContinentData, Manifest, RiverRecord, RoadRecord, SeaRegionRecord, SettlementRecord, ZoneRecord } from "./worldData.js";
import { sampleHeight } from "./terrain.js";
import { uvToWorld } from "./layout.js";

const OVERLAY_LIFT = 2.5; // scene units above terrain so lines/markers don't z-fight with the mesh

function heightAtWorld(continent: ContinentData, u: number, v: number): number {
  return Math.max(sampleHeight(continent, u, v), -40) * 0.35 + OVERLAY_LIFT;
}

export function buildZoneBoundaries(zones: ZoneRecord[], continents: Record<string, ContinentData>, manifest: Manifest): THREE.Group {
  const group = new THREE.Group();
  group.name = "zoneBoundaries";

  const bandColors = [0xffffff, 0xffe08a, 0xffb37a, 0xff8a8a, 0x8affe0, 0x8ab3ff, 0xd08aff, 0xff8ad0];

  for (const zone of zones) {
    const continent = continents[zone.continent];
    if (!continent || zone.boundary.length < 3) continue;
    const color = bandColors[(zone.band - 1) % bandColors.length];

    const points: THREE.Vector3[] = [];
    for (const [u, v] of [...zone.boundary, zone.boundary[0]]) {
      const [x, z] = uvToWorld(u, v, zone.continent, manifest);
      points.push(new THREE.Vector3(x, heightAtWorld(continent, u, v), z));
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({ color, linewidth: 2, transparent: true, opacity: 0.85 });
    const line = new THREE.Line(geometry, material);
    line.userData = { zoneId: zone.id, properName: zone.properName, descriptor: zone.descriptor, band: zone.band };
    group.add(line);
  }

  return group;
}

export function buildRivers(continents: Record<string, ContinentData>, manifest: Manifest): THREE.Group {
  const group = new THREE.Group();
  group.name = "rivers";

  for (const continent of Object.values(continents)) {
    for (const river of continent.rivers as RiverRecord[]) {
      if (river.path.length < 2) continue;
      const points = river.path.map(([u, v]) => {
        const [x, z] = uvToWorld(u, v, continent.id, manifest);
        return new THREE.Vector3(x, heightAtWorld(continent, u, v) + 0.5, z);
      });
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const material = new THREE.LineBasicMaterial({ color: 0x5ec8ff, transparent: true, opacity: 0.85 });
      group.add(new THREE.Line(geometry, material));
    }
  }

  return group;
}

export function buildRoads(continents: Record<string, ContinentData>, manifest: Manifest): THREE.Group {
  const group = new THREE.Group();
  group.name = "roads";

  for (const continent of Object.values(continents)) {
    for (const road of continent.roads as RoadRecord[]) {
      const points = road.path.map(([u, v]) => {
        const [x, z] = uvToWorld(u, v, continent.id, manifest);
        return new THREE.Vector3(x, heightAtWorld(continent, u, v) + 0.2, z);
      });
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const color = road.kind === "road" ? 0xd8c48a : 0x9a8a6a;
      const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.6 });
      group.add(new THREE.Line(geometry, material));
    }
  }

  return group;
}

const TIER_COLORS: Record<number, number> = { 1: 0xffd24a, 2: 0xf0f0f0, 3: 0xa8a8a8, 4: 0x707070 };
// Sized to stay legible against an 8192-unit continent tile, not to scale
// realistically against terrain features -- these are debug markers.
const TIER_SIZE: Record<number, number> = { 1: 45, 2: 32, 3: 22, 4: 16 };

export function buildSettlements(settlements: SettlementRecord[], zonesById: Map<string, ZoneRecord>, continents: Record<string, ContinentData>, manifest: Manifest): THREE.Group {
  const group = new THREE.Group();
  group.name = "settlements";

  for (const s of settlements) {
    const zone = zonesById.get(s.zoneId);
    const continent = zone ? continents[zone.continent] : undefined;
    if (!zone || !continent) continue;

    const [x, z] = uvToWorld(s.position[0], s.position[1], zone.continent, manifest);
    const y = heightAtWorld(continent, s.position[0], s.position[1]) + 3;

    const geometry = new THREE.ConeGeometry(TIER_SIZE[s.tier] ?? 3, (TIER_SIZE[s.tier] ?? 3) * 2, 6);
    const material = new THREE.MeshStandardMaterial({ color: TIER_COLORS[s.tier] ?? 0x888888, emissive: 0x221100, emissiveIntensity: 0.2 });
    const marker = new THREE.Mesh(geometry, material);
    marker.position.set(x, y, z);
    marker.userData = { name: s.name, type: s.type, reason: s.reason, tier: s.tier, zoneId: s.zoneId };
    group.add(marker);
  }

  return group;
}

/**
 * A flat ocean plane spanning the whole world (both continent tiles plus the
 * Luna Sea gap between them). Without this, the open water between Valora
 * and Seradia was just empty space rendering as the scene background color
 * -- it happened to be a similar navy blue, which is exactly why the gap
 * being too narrow read as "one continent" rather than "two continents and
 * a big sea" (the bug this file's Bruma marker and this plane both fix).
 */
export function buildOceanPlane(manifest: Manifest): THREE.Mesh {
  const tileSize = manifest.worldScale.continentTileSize;
  const offsets = Object.values(manifest.continentLayout).map((c) => c.worldOffset[0]);
  const minX = Math.min(...offsets);
  const maxX = Math.max(...offsets) + tileSize;
  const width = maxX - minX + tileSize; // padding so the plane extends past the outer coastlines
  const geometry = new THREE.PlaneGeometry(width, tileSize * 1.6);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.MeshStandardMaterial({ color: 0x123a5e, roughness: 0.6, metalness: 0.1, transparent: true, opacity: 0.92 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set((minX + maxX) / 2, -6, tileSize / 2);
  return mesh;
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
    core.position.set(x, 40, z);
    core.userData = { name: region.name, notes: region.notes };
    group.add(core);
  }

  return group;
}
