import * as THREE from "three";
import type { ContinentData, Manifest, WorldHeightData } from "./worldData.js";
import { continentOriginX, continentOriginZ } from "./layout.js";

// World units ARE meters now (docs/01 §5, data/design/continents.json) --
// no vertical exaggeration. A prior version faked a 0.35x vertical scale to
// make an undersized world look more reasonable; the actual fix was to
// stop lying about the scale (see docs/01 §5's "corrected 2nd pass" note).
const ELEVATION_SCALE = 1;

/** Builds a displaced terrain mesh from a continent's raw heightfield, textured with its biome map. */
export function buildTerrainMesh(continent: ContinentData, manifest: Manifest): THREE.Mesh {
  const tileSize = manifest.worldScale.continentTileSize;
  const res = continent.resolution;
  // Downsample the geometry grid for performance; the biome texture still
  // samples the full-resolution PNG, so visual detail isn't lost, only the
  // mesh's vertex-level displacement fidelity (a minor, deliberate tradeoff).
  const gridRes = Math.min(res, 256);
  const step = res / gridRes;

  const geometry = new THREE.PlaneGeometry(tileSize, tileSize, gridRes - 1, gridRes - 1);
  geometry.rotateX(-Math.PI / 2);

  const position = geometry.attributes.position as THREE.BufferAttribute;
  for (let gy = 0; gy < gridRes; gy++) {
    for (let gx = 0; gx < gridRes; gx++) {
      const sx = Math.min(res - 1, Math.round(gx * step));
      const sy = Math.min(res - 1, Math.round(gy * step));
      const h = continent.heightData[sy * res + sx];
      const vertIndex = gy * gridRes + gx;
      // PlaneGeometry is centered at origin; shift so the mesh's local
      // (0,0) corresponds to UV (0,0), matching layout.ts's uvToWorld.
      // Clamped shallow so this stays a coastal apron -- the separate
      // seabed mesh (below) carries full ocean depth between continents.
      position.setY(vertIndex, Math.max(h, -40) * ELEVATION_SCALE);
    }
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();

  const texture = new THREE.Texture(continent.biomeImage);
  texture.needsUpdate = true;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  // The biome PNG is authored with (0,0) at the top-left in image space but
  // (0,0)=south in our v-down grid convention (docs/01 §3 stage 3 walks y
  // from 0..resolution as "north" increasing) -- flip V so the texture
  // aligns with the displaced geometry instead of appearing mirrored.
  texture.center.set(0.5, 0.5);
  texture.repeat.set(1, -1);

  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.95, metalness: 0.0 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(
    continentOriginX(continent.id, manifest) + tileSize / 2,
    0,
    continentOriginZ(continent.id, manifest) + tileSize / 2
  );
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * The connecting ocean floor between (and around) both continents, built
 * from the unified world heightfield (elevation/index.ts's
 * generateWorldHeightField). Land cells are clamped to just-underwater so
 * this stays a continuous, hidden-beneath-the-coast surface rather than
 * z-fighting with the higher-detail continent meshes above -- this is the
 * fix for the "the ocean is just blank, it doesn't feel like one piece of
 * land under it all" gap: there is now real generated bathymetry out there,
 * not a flat placeholder plane.
 */
export function buildSeabedMesh(worldHeight: WorldHeightData): THREE.Mesh {
  const { width, height: gridH, data, bounds } = worldHeight;
  const worldW = bounds.maxX - bounds.minX;
  const worldD = bounds.maxZ - bounds.minZ;

  // Downsample for performance -- the seabed doesn't need per-continent mesh
  // fidelity, just a believable connecting surface.
  const gridRes = 400;
  const aspect = worldD / worldW;
  const segX = gridRes - 1;
  const segY = Math.max(2, Math.round(gridRes * aspect)) - 1;

  const geometry = new THREE.PlaneGeometry(worldW, worldD, segX, segY);
  geometry.rotateX(-Math.PI / 2);

  const position = geometry.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array((segX + 1) * (segY + 1) * 3);
  const deep = new THREE.Color(0x081c33);
  const shallow = new THREE.Color(0x1c5a78);

  for (let gy = 0; gy <= segY; gy++) {
    const sampleY = Math.min(gridH - 1, Math.round((gy / segY) * (gridH - 1)));
    for (let gx = 0; gx <= segX; gx++) {
      const sampleX = Math.min(width - 1, Math.round((gx / segX) * (width - 1)));
      const h = data[sampleY * width + sampleX];
      const clamped = Math.min(h, -5);
      const vertIndex = gy * (segX + 1) + gx;
      position.setY(vertIndex, clamped);

      const depthT = Math.max(0, Math.min(1, -clamped / 3500));
      const c = shallow.clone().lerp(deep, depthT);
      colors[vertIndex * 3] = c.r;
      colors[vertIndex * 3 + 1] = c.g;
      colors[vertIndex * 3 + 2] = c.b;
    }
  }
  position.needsUpdate = true;
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.05 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(bounds.minX + worldW / 2, 0, bounds.minZ + worldD / 2);
  return mesh;
}

/** Samples the unified world heightfield at an arbitrary world position -- used by walk mode to stay grounded across both continents and the seabed between them. */
export function sampleWorldHeight(worldHeight: WorldHeightData, worldX: number, worldZ: number): number {
  const { width, height: gridH, data, bounds } = worldHeight;
  const u = (worldX - bounds.minX) / (bounds.maxX - bounds.minX);
  const v = (worldZ - bounds.minZ) / (bounds.maxZ - bounds.minZ);
  const gx = Math.min(width - 1, Math.max(0, Math.round(u * (width - 1))));
  const gy = Math.min(gridH - 1, Math.max(0, Math.round(v * (gridH - 1))));
  return data[gy * width + gx];
}

/** Samples the (undownsampled) heightfield for overlay placement (rivers, settlement markers, etc). */
export function sampleHeight(continent: ContinentData, u: number, v: number): number {
  const res = continent.resolution;
  const x = Math.min(res - 1, Math.max(0, Math.round(u * (res - 1))));
  const y = Math.min(res - 1, Math.max(0, Math.round(v * (res - 1))));
  return continent.heightData[y * res + x];
}
