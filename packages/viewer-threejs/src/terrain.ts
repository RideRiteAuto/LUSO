import * as THREE from "three";
import type { ContinentData, Manifest } from "./worldData.js";
import { continentOriginX, continentOriginZ } from "./layout.js";

// World-unit horizontal scale (docs/01 §5) has no defined real-world meter
// correspondence, so this is a chosen-for-legibility vertical exaggeration:
// max elevation (~2000-3000m) reads as roughly 10% of the tile width.
const ELEVATION_SCALE = 0.35;

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

/** Samples the (undownsampled) heightfield for overlay placement (rivers, settlement markers, etc). */
export function sampleHeight(continent: ContinentData, u: number, v: number): number {
  const res = continent.resolution;
  const x = Math.min(res - 1, Math.max(0, Math.round(u * (res - 1))));
  const y = Math.min(res - 1, Math.max(0, Math.round(v * (res - 1))));
  return continent.heightData[y * res + x];
}
