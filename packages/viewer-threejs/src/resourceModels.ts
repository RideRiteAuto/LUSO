import * as THREE from "three/webgpu";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

export type ResourceFamilyId = "pine" | "birch" | "copper" | "tin" | "stone" | "redberry";
export type ResourceLod = 0 | 1 | 2;

export interface ResourceModelInfo {
  family: ResourceFamilyId;
  variant: number;
  lod: ResourceLod;
  triangles: number;
  materials: number;
  height: number;
}

export interface ResourceModel {
  group: THREE.Group;
  info: ResourceModelInfo;
}

const FAMILY_SEEDS: Record<ResourceFamilyId, number> = {
  pine: 17011, birch: 23003, copper: 31013, tin: 47017, stone: 53009, redberry: 59021,
};

function rng(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function tintGeometry(geometry: THREE.BufferGeometry, base: THREE.ColorRepresentation, variation = 0, random = rng(1)): THREE.BufferGeometry {
  const copy = geometry.clone();
  const count = copy.getAttribute("position").count;
  const colors = new Float32Array(count * 3);
  const color = new THREE.Color(base);
  for (let i = 0; i < count; i++) {
    const shade = (random() - 0.5) * variation;
    const altered = color.clone().offsetHSL((random() - 0.5) * variation * 0.08, 0, shade);
    colors[i * 3] = altered.r; colors[i * 3 + 1] = altered.g; colors[i * 3 + 2] = altered.b;
  }
  copy.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return copy;
}

function between(geometry: THREE.BufferGeometry, start: THREE.Vector3, end: THREE.Vector3, radiusScale = 1): THREE.BufferGeometry {
  const direction = end.clone().sub(start);
  const length = direction.length();
  const result = geometry.clone();
  result.scale(radiusScale, length, radiusScale);
  result.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()));
  result.translate((start.x + end.x) / 2, (start.y + end.y) / 2, (start.z + end.z) / 2);
  return result;
}

function merged(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const compatible = geometries.map((geometry) => {
    const result = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    for (const attribute of Object.keys(result.attributes)) {
      if (attribute !== "position" && attribute !== "normal" && attribute !== "color") result.deleteAttribute(attribute);
    }
    if (!result.getAttribute("normal")) result.computeVertexNormals();
    return result;
  });
  const result = mergeGeometries(compatible, false);
  if (!result) throw new Error("Resource geometry merge failed");
  result.computeVertexNormals(); result.computeBoundingBox(); result.computeBoundingSphere();
  for (const geometry of compatible) geometry.dispose();
  for (const geometry of geometries) geometry.dispose();
  return result;
}

function triangleCount(object: THREE.Object3D): number {
  let triangles = 0;
  object.traverse((candidate) => {
    if (!(candidate as THREE.Mesh).isMesh) return;
    const geometry = (candidate as THREE.Mesh).geometry;
    triangles += geometry.index ? geometry.index.count / 3 : geometry.getAttribute("position").count / 3;
  });
  return Math.round(triangles);
}

function materialCount(object: THREE.Object3D): number {
  const materials = new Set<THREE.Material>();
  object.traverse((candidate) => {
    if (!(candidate as THREE.Mesh).isMesh) return;
    const material = (candidate as THREE.Mesh).material;
    for (const entry of Array.isArray(material) ? material : [material]) materials.add(entry);
  });
  return materials.size;
}

function irregularRock(radius: number, detail: number, seed: number, squash: THREE.Vector3): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(radius, detail);
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  const random = rng(seed);
  const phaseA = random() * Math.PI * 2, phaseB = random() * Math.PI * 2;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
    const length = Math.max(0.001, Math.hypot(x, y, z));
    const nx = x / length, ny = y / length, nz = z / length;
    const form = 1
      + Math.sin(nx * 5.1 + phaseA) * 0.09
      + Math.sin(ny * 7.3 + nz * 4.7 + phaseB) * 0.07
      + (random() - 0.5) * 0.075;
    position.setXYZ(i, x * form * squash.x, y * form * squash.y, z * form * squash.z);
  }
  geometry.computeVertexNormals();
  return geometry;
}

function buildPine(variant: number, lod: ResourceLod): THREE.Group {
  const random = rng(FAMILY_SEEDS.pine + variant * 101 + lod * 1009);
  const group = new THREE.Group(); group.name = `pine-v${variant + 1}-lod${lod}`;
  const heights = [12.5, 18.5, 23.5], crowns = [4.3, 6.4, 7.5];
  const height = heights[variant], crownRadius = crowns[variant];
  const radial = lod === 0 ? 14 : lod === 1 ? 10 : 7;
  const bodyParts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(height * 0.042, height * 0.075, height, radial, lod === 0 ? 8 : 3, false);
  trunk.translate(0, height / 2, 0);
  bodyParts.push(tintGeometry(trunk, 0x6c3d25, 0.11, random));
  const rootCount = lod === 0 ? 7 : lod === 1 ? 5 : 3;
  const branchBase = new THREE.CylinderGeometry(1, 1, 1, radial, 1, false);
  for (let i = 0; i < rootCount; i++) {
    const angle = i / rootCount * Math.PI * 2 + random() * 0.35;
    const start = new THREE.Vector3(Math.cos(angle) * height * 0.018, height * 0.08, Math.sin(angle) * height * 0.018);
    const end = new THREE.Vector3(Math.cos(angle) * height * (0.065 + random() * 0.025), 0.06, Math.sin(angle) * height * (0.065 + random() * 0.025));
    bodyParts.push(tintGeometry(between(branchBase, start, end, height * 0.017), 0x74452a, 0.08, random));
  }
  const tiers = lod === 0 ? [8, 10, 11][variant] : lod === 1 ? [6, 7, 8][variant] : [5, 6, 7][variant];
  const branchesPerTier = lod === 0 ? 4 : 3;
  const foliageParts: THREE.BufferGeometry[] = [];
  const clusterDetail = lod === 2 ? 0 : 1;
  const clusterBase = new THREE.IcosahedronGeometry(1, clusterDetail);
  for (let tier = 0; tier < tiers; tier++) {
    const t = tier / Math.max(1, tiers - 1);
    const y = height * (0.27 + t * 0.65);
    const taper = Math.pow(1 - t, 0.63);
    const tierRadius = crownRadius * (0.25 + taper * 0.75) * (0.82 + random() * 0.24);
    const tierRotation = tier * 2.399 + variant * 0.57 + random() * 0.3;
    for (let branch = 0; branch < branchesPerTier; branch++) {
      if (random() < (lod === 0 ? 0.06 : 0.12)) continue;
      const angle = tierRotation + branch / branchesPerTier * Math.PI * 2;
      const reach = tierRadius * (0.68 + random() * 0.34);
      const start = new THREE.Vector3(0, y, 0);
      const end = new THREE.Vector3(Math.cos(angle) * reach, y - reach * (0.05 + random() * 0.1), Math.sin(angle) * reach);
      if (lod < 2) bodyParts.push(tintGeometry(between(branchBase, start, end, Math.max(0.045, height * (0.009 + taper * 0.006))), 0x62402a, 0.08, random));
      const clusters = lod === 0 ? 3 : lod === 1 ? 2 : 1;
      for (let cluster = 0; cluster < clusters; cluster++) {
        const along = lod === 2 ? 0.8 : 0.48 + cluster * 0.23 + random() * 0.08;
        const center = start.clone().lerp(end, along);
        const geometry = clusterBase.clone();
        const long = reach * (lod === 2 ? 0.54 : 0.23 + random() * 0.08);
        geometry.scale(long, long * (0.38 + random() * 0.16), long * (0.52 + random() * 0.2));
        geometry.rotateY(-angle + (random() - 0.5) * 0.35);
        geometry.translate(center.x, center.y + long * 0.1, center.z);
        foliageParts.push(tintGeometry(geometry, variant === 0 ? 0x244e2c : 0x1e4727, 0.14, random));
      }
    }
  }
  const top = clusterBase.clone(); top.scale(crownRadius * 0.28, height * 0.12, crownRadius * 0.28); top.translate(0, height * 0.94, 0);
  foliageParts.push(tintGeometry(top, 0x234f2c, 0.12, random));
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94, metalness: 0, flatShading: lod === 2 });
  const mesh = new THREE.Mesh(merged([...bodyParts, ...foliageParts]), material); mesh.name = "pine-trunk-branches-needles";
  group.add(mesh); group.userData.collision = { type: "capsule", radius: height * 0.075, height: height * 0.82 };
  return group;
}

function buildBirch(variant: number, lod: ResourceLod): THREE.Group {
  const random = rng(FAMILY_SEEDS.birch + variant * 107 + lod * 1019);
  const group = new THREE.Group(); group.name = `birch-v${variant + 1}-lod${lod}`;
  const heights = [10.5, 15.5, 19.5], widths = [4.2, 6.1, 7.4];
  const height = heights[variant], crownWidth = widths[variant];
  const radial = lod === 0 ? 12 : lod === 1 ? 8 : 5;
  const parts: THREE.BufferGeometry[] = [];
  const trunkBase = new THREE.CylinderGeometry(1, 1, 1, radial, lod === 0 ? 6 : 2, false);
  const trunk = trunkBase.clone();
  trunk.scale(height * 0.043, height, height * 0.043);
  trunk.translate(0, height / 2, 0);
  parts.push(tintGeometry(trunk, 0xd8d3c4, 0.09, random));

  // Sparse charcoal lenticels are geometry at review distance, then collapse
  // into the vertex-color silhouette in cheaper LODs.
  const lenticels = lod === 0 ? 12 : lod === 1 ? 5 : 0;
  for (let i = 0; i < lenticels; i++) {
    const y = height * (0.12 + i / Math.max(1, lenticels) * 0.64 + random() * 0.025);
    const mark = new THREE.TorusGeometry(height * 0.044, height * 0.0032, 3, radial);
    mark.rotateX(Math.PI / 2); mark.scale(1, 1, 0.35 + random() * 0.35); mark.translate(0, y, 0);
    parts.push(tintGeometry(mark, 0x443f3a, 0.06, random));
  }

  const branchCount = lod === 0 ? [18, 19, 19][variant] : lod === 1 ? [12, 13, 14][variant] : [9, 10, 11][variant];
  const foliageDetail = lod === 2 ? 0 : 1;
  const foliageBase = new THREE.IcosahedronGeometry(1, foliageDetail);
  for (let i = 0; i < branchCount; i++) {
    const t = i / Math.max(1, branchCount - 1);
    const angle = i * 2.399 + variant * 0.61 + random() * 0.55;
    const start = new THREE.Vector3(0, height * (0.28 + t * 0.56), 0);
    const reach = crownWidth * (0.38 + (1 - t) * 0.42) * (0.75 + random() * 0.38);
    const end = new THREE.Vector3(
      Math.cos(angle) * reach,
      start.y + height * (0.08 + random() * 0.16),
      Math.sin(angle) * reach,
    );
    parts.push(tintGeometry(between(trunkBase, start, end, height * (0.008 + (1 - t) * 0.004)), 0x7f7466, 0.11, random));
    if (lod < 2) {
      const forkAngle = angle + (random() - 0.5) * 1.2;
      const forkStart = start.clone().lerp(end, 0.62);
      const forkEnd = end.clone().add(new THREE.Vector3(Math.cos(forkAngle) * reach * 0.28, height * 0.07, Math.sin(forkAngle) * reach * 0.28));
      parts.push(tintGeometry(between(trunkBase, forkStart, forkEnd, height * 0.0055), 0x756b60, 0.1, random));
    }
    const leafClusters = lod === 0 ? 4 : 2;
    for (let cluster = 0; cluster < leafClusters; cluster++) {
      const along = 0.48 + cluster / Math.max(1, leafClusters - 1) * 0.5;
      const center = start.clone().lerp(end, Math.min(0.98, along));
      const leaf = foliageBase.clone();
      const scale = crownWidth * (lod === 2 ? 0.12 : 0.075 + random() * 0.035);
      leaf.scale(scale * (1.1 + random() * 0.45), scale * (0.55 + random() * 0.24), scale * (0.85 + random() * 0.3));
      leaf.rotateY(angle + random() * 0.8);
      leaf.translate(center.x + (random() - 0.5) * scale, center.y + (random() - 0.5) * scale, center.z + (random() - 0.5) * scale);
      parts.push(tintGeometry(leaf, variant === 0 ? 0x6e923f : 0x64863a, 0.18, random));
    }
  }
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.91, metalness: 0, flatShading: lod === 2 });
  const mesh = new THREE.Mesh(merged(parts), material); mesh.name = "birch-bark-branches-leaf-masses";
  group.add(mesh);
  group.userData.collision = { type: "capsule", radius: height * 0.05, height: height * 0.78 };
  group.userData.wind = { mode: "foliage-only", phaseSeed: FAMILY_SEEDS.birch + variant * 107 };
  return group;
}

function orePalette(family: "copper" | "tin") {
  return family === "copper"
    ? { host: 0x514b42, ore: 0xb76532, accent: 0x3f7664 }
    : { host: 0x3f4650, ore: 0xc5c8c4, accent: 0x8f969c };
}

function buildOre(family: "copper" | "tin", variant: number, lod: ResourceLod): THREE.Group {
  const random = rng(FAMILY_SEEDS[family] + variant * 131 + lod * 1013);
  const group = new THREE.Group(); group.name = `${family}-v${variant + 1}-lod${lod}`;
  const palette = orePalette(family);
  const scales = family === "copper" ? [1.25, 1.75, 2.3] : [1.15, 1.65, 2.15];
  const size = scales[variant];
  const detail = lod === 0 ? 3 : lod === 1 ? 2 : 1;
  const hostParts: THREE.BufferGeometry[] = [];
  const oreParts: THREE.BufferGeometry[] = [];
  const boulders = lod === 2 ? 2 : lod === 0 ? 5 : variant === 0 ? 3 : 4;
  for (let i = 0; i < boulders; i++) {
    const angle = i / boulders * Math.PI * 2 + random() * 0.8;
    const radius = size * (i === 0 ? 0.72 : 0.34 + random() * 0.24);
    const squash = new THREE.Vector3(0.85 + random() * 0.35, 0.72 + random() * 0.45, 0.8 + random() * 0.4);
    const rock = irregularRock(radius, detail, FAMILY_SEEDS[family] + variant * 71 + i * 19 + lod, squash);
    const px = i === 0 ? 0 : Math.cos(angle) * size * (0.42 + random() * 0.3);
    const pz = i === 0 ? 0 : Math.sin(angle) * size * (0.42 + random() * 0.3);
    rock.rotateY(angle + random()); rock.translate(px, radius * squash.y * 0.78, pz);
    hostParts.push(tintGeometry(rock, palette.host, 0.13, random));
  }
  const veinCount = lod === 0 ? 7 : lod === 1 ? 4 : 2;
  for (let i = 0; i < veinCount; i++) {
    const angle = (i / veinCount) * Math.PI * 2 + variant * 0.41 + random() * 0.7;
    const points: THREE.Vector3[] = [];
    const segments = lod === 0 ? 7 : lod === 1 ? 5 : 3;
    for (let p = 0; p < segments; p++) {
      const t = p / Math.max(1, segments - 1);
      const sweep = angle + (t - 0.5) * (0.4 + random() * 0.35);
      const radial = size * (0.57 + Math.sin(t * Math.PI) * 0.09);
      points.push(new THREE.Vector3(
        Math.cos(sweep) * radial,
        size * (0.28 + t * 0.75 + Math.sin(t * Math.PI * 2 + angle) * 0.07),
        Math.sin(sweep) * radial,
      ));
    }
    const curve = new THREE.CatmullRomCurve3(points);
    const tube = new THREE.TubeGeometry(curve, lod === 0 ? 12 : lod === 1 ? 7 : 4, size * (lod === 2 ? 0.045 : 0.035), lod === 0 ? 6 : 4, false);
    oreParts.push(tintGeometry(tube, i % 4 === 0 ? palette.accent : palette.ore, 0.09, random));
  }
  const hostMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0.02, flatShading: false });
  const mineralMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: family === "copper" ? 0.46 : 0.58, metalness: family === "copper" ? 0.72 : 0.35 });
  const hostMesh = new THREE.Mesh(merged(hostParts), hostMaterial); hostMesh.name = `${family}-host-rock`;
  const oreMesh = new THREE.Mesh(merged(oreParts), mineralMaterial); oreMesh.name = `${family}-mineral-seams`;
  group.add(hostMesh, oreMesh); group.userData.collision = { type: "convex-hull", radius: size, height: size * 1.65 };
  return group;
}

function buildStone(variant: number, lod: ResourceLod): THREE.Group {
  const random = rng(FAMILY_SEEDS.stone + variant * 137 + lod * 1021);
  const group = new THREE.Group(); group.name = `stone-v${variant + 1}-lod${lod}`;
  const sizes = [1.2, 1.75, 2.35], size = sizes[variant];
  const detail = lod === 0 ? 3 : lod === 1 ? 2 : 1;
  const parts: THREE.BufferGeometry[] = [];
  const boulders = lod === 0 ? 8 : lod === 1 ? 4 : 2;
  for (let i = 0; i < boulders; i++) {
    const angle = i / boulders * Math.PI * 2 + random() * 0.7;
    const radius = size * (i === 0 ? 0.68 : 0.32 + random() * 0.18);
    const squash = new THREE.Vector3(0.82 + random() * 0.42, 0.58 + random() * 0.35, 0.78 + random() * 0.46);
    const rock = irregularRock(radius, detail, FAMILY_SEEDS.stone + variant * 79 + i * 23 + lod, squash);
    const offset = i === 0 ? 0 : size * (0.38 + random() * 0.2);
    rock.rotateY(angle + random() * 0.6);
    rock.translate(Math.cos(angle) * offset, radius * squash.y * 0.8, Math.sin(angle) * offset);
    const palette = [0x68665e, 0x5c615d, 0x746c5f];
    parts.push(tintGeometry(rock, palette[(variant + i) % palette.length], 0.14, random));
  }
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0, flatShading: false });
  const mesh = new THREE.Mesh(merged(parts), material); mesh.name = "weathered-fieldstone";
  group.add(mesh); group.userData.collision = { type: "convex-hull", radius: size, height: size * 1.35 };
  return group;
}

function buildRedberry(variant: number, lod: ResourceLod): THREE.Group {
  const random = rng(FAMILY_SEEDS.redberry + variant * 149 + lod * 1031);
  const group = new THREE.Group(); group.name = `redberry-v${variant + 1}-lod${lod}`;
  const heights = [0.85, 1.25, 1.65], height = heights[variant];
  const width = height * [1.2, 1.35, 1.48][variant];
  const parts: THREE.BufferGeometry[] = [];
  const radial = lod === 0 ? 7 : 5;
  const stemBase = new THREE.CylinderGeometry(1, 1, 1, radial, 1, false);
  const stems = lod === 0 ? [10, 14, 15][variant] : lod === 1 ? [6, 8, 9][variant] : [3, 4, 5][variant];
  const endpoints: THREE.Vector3[] = [];
  for (let i = 0; i < stems; i++) {
    const angle = i / stems * Math.PI * 2 + random() * 0.9;
    const end = new THREE.Vector3(Math.cos(angle) * width * (0.25 + random() * 0.27), height * (0.62 + random() * 0.34), Math.sin(angle) * width * (0.25 + random() * 0.27));
    endpoints.push(end);
    parts.push(tintGeometry(between(stemBase, new THREE.Vector3((random() - 0.5) * 0.12, 0.06, (random() - 0.5) * 0.12), end, height * (0.016 + random() * 0.007)), 0x5b3827, 0.1, random));
  }
  const leafDetail = lod === 2 ? 0 : 1;
  const leafBase = new THREE.IcosahedronGeometry(1, leafDetail);
  const leafCount = lod === 0 ? [22, 30, 32][variant] : lod === 1 ? [8, 10, 11][variant] : [6, 7, 8][variant];
  for (let i = 0; i < leafCount; i++) {
    const anchor = endpoints[i % endpoints.length];
    const leaf = leafBase.clone();
    const scale = width * (lod === 2 ? 0.18 : 0.105 + random() * 0.045);
    leaf.scale(scale * (1.1 + random() * 0.35), scale * (0.55 + random() * 0.2), scale);
    leaf.rotateY(random() * Math.PI); leaf.translate(anchor.x + (random() - 0.5) * width * 0.35, anchor.y + (random() - 0.5) * height * 0.25, anchor.z + (random() - 0.5) * width * 0.35);
    parts.push(tintGeometry(leaf, 0x315f2e, 0.15, random));
  }
  const berries = lod === 0 ? [18, 26, 30][variant] : lod === 1 ? [9, 12, 14][variant] : [5, 6, 7][variant];
  for (let i = 0; i < berries; i++) {
    const anchor = endpoints[(i * 5 + 2) % endpoints.length];
    const berry = new THREE.SphereGeometry(height * (lod === 2 ? 0.035 : 0.025), lod === 0 ? 7 : 5, lod === 0 ? 5 : 3);
    berry.translate(anchor.x + (random() - 0.5) * width * 0.28, anchor.y - random() * height * 0.2, anchor.z + (random() - 0.5) * width * 0.28);
    parts.push(tintGeometry(berry, i % 7 === 0 ? 0x8f171d : 0xc42b32, 0.12, random));
  }
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0, flatShading: lod === 2 });
  const mesh = new THREE.Mesh(merged(parts), material); mesh.name = "redberry-stems-leaves-fruit";
  group.add(mesh); group.userData.collision = { type: "convex-hull", radius: width * 0.48, height };
  return group;
}

export function buildResourceModel(family: ResourceFamilyId, variant: number, lod: ResourceLod): ResourceModel {
  if (!Number.isInteger(variant) || variant < 0 || variant > 2) throw new Error(`Invalid ${family} variant: ${variant}`);
  const group = family === "pine" ? buildPine(variant, lod)
    : family === "birch" ? buildBirch(variant, lod)
    : family === "stone" ? buildStone(variant, lod)
    : family === "redberry" ? buildRedberry(variant, lod)
      : buildOre(family, variant, lod);
  group.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(group);
  const info = {
    family, variant, lod,
    triangles: triangleCount(group),
    materials: materialCount(group),
    height: bounds.max.y - bounds.min.y,
  };
  group.userData.resource = info;
  return { group, info };
}

export function disposeResourceModel(group: THREE.Group): void {
  group.traverse((candidate) => {
    if (!(candidate as THREE.Mesh).isMesh) return;
    const mesh = candidate as THREE.Mesh;
    mesh.geometry.dispose();
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) material.dispose();
  });
}
