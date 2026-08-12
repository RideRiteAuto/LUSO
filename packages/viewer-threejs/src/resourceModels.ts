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

type ProceduralTextureId = "pine-foliage" | "birch-foliage" | "redberry-foliage" | "pine-bark" | "birch-bark" | "rock";
const proceduralTextures = new Map<ProceduralTextureId, THREE.Texture>();
let photographicPineFoliage: THREE.Texture | null = null;
let photographicPineBark: THREE.Texture | null = null;

export async function loadResourceTextureSources(): Promise<void> {
  if (typeof document === "undefined" || photographicPineFoliage) return;
  const loader = new THREE.TextureLoader();
  const embedded = (window as unknown as { __NAVORA_RESOURCE_TEXTURES__?: Record<string, string> }).__NAVORA_RESOURCE_TEXTURES__;
  const asset = (file: string) => embedded?.[file] ?? new URL(`assets/resource-textures/${file}`, document.baseURI).href;
  const [color, alpha, bark] = await Promise.all([
    loader.loadAsync(asset("pine-twig-diff.png")),
    loader.loadAsync(asset("pine-twig-alpha.png")),
    loader.loadAsync(asset("pine-bark-diff.jpg")),
  ]);
  color.colorSpace = THREE.SRGBColorSpace; color.wrapS = color.wrapT = THREE.ClampToEdgeWrapping;
  color.generateMipmaps = false; color.minFilter = THREE.LinearFilter; color.anisotropy = 4;
  alpha.colorSpace = THREE.NoColorSpace; alpha.wrapS = alpha.wrapT = THREE.ClampToEdgeWrapping;
  alpha.generateMipmaps = false; alpha.minFilter = THREE.LinearFilter; alpha.anisotropy = 4;
  bark.colorSpace = THREE.SRGBColorSpace; bark.wrapS = bark.wrapT = THREE.RepeatWrapping; bark.repeat.set(2, 5); bark.anisotropy = 4;
  photographicPineFoliage = color; photographicPineFoliage.userData.alphaMap = alpha;
  photographicPineBark = bark;
}

function proceduralTexture(id: ProceduralTextureId): THREE.Texture | null {
  if (typeof document === "undefined") return null;
  const cached = proceduralTextures.get(id);
  if (cached) return cached;
  const foliage = id.endsWith("foliage");
  const canvas = document.createElement("canvas");
  canvas.width = foliage ? 256 : 256; canvas.height = foliage ? 192 : 512;
  const context = canvas.getContext("2d")!;
  const random = rng(9001 + [...id].reduce((total, letter) => total + letter.charCodeAt(0), 0));
  if (foliage) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    const twig = id === "pine-foliage" ? "#554127" : "#51402c";
    context.strokeStyle = twig; context.lineCap = "round"; context.lineWidth = id === "pine-foliage" ? 5 : 4;
    context.beginPath(); context.moveTo(18, 108); context.quadraticCurveTo(126, 98, 242, 82); context.stroke();
    if (id === "pine-foliage") {
      const greens = ["#173e22", "#24542c", "#326237", "#3c6f3f"];
      // A ragged branch-level frond supplies middle-distance crown mass while
      // punched gaps and needle strokes keep it from reading as a solid oval.
      const edgeTop: Array<[number, number]> = [], edgeBottom: Array<[number, number]> = [];
      for (let i = 0; i <= 28; i++) {
        const x = 15 + i / 28 * 226, centerY = 108 - x * 0.105;
        const half = Math.sin(i / 28 * Math.PI) * (23 + random() * 20);
        edgeTop.push([x, centerY - half * (0.55 + random() * 0.45)]);
        edgeBottom.push([x, centerY + half * (0.55 + random() * 0.45)]);
      }
      context.fillStyle = greens[1]; context.beginPath();
      context.moveTo(edgeTop[0][0], edgeTop[0][1]);
      for (const point of edgeTop.slice(1)) context.lineTo(point[0], point[1]);
      for (const point of edgeBottom.reverse()) context.lineTo(point[0], point[1]);
      context.closePath(); context.fill();
      context.save(); context.globalCompositeOperation = "destination-out";
      for (let i = 0; i < 24; i++) {
        context.globalAlpha = 0.78; context.beginPath();
        context.ellipse(35 + random() * 190, 57 + random() * 75, 3 + random() * 9, 2 + random() * 5, random() * Math.PI, 0, Math.PI * 2); context.fill();
      }
      context.restore();
      for (let i = 0; i < 210; i++) {
        const x = 28 + random() * 205, centerY = 108 - x * 0.105;
        const length = 12 + random() * 24, direction = random() < 0.5 ? -1 : 1;
        context.strokeStyle = greens[Math.floor(random() * greens.length)];
        context.lineWidth = 2.2 + random() * 2.6;
        context.beginPath(); context.moveTo(x, centerY);
        context.lineTo(x - length * (0.15 + random() * 0.25), centerY + direction * length); context.stroke();
      }
    } else {
      const birch = id === "birch-foliage";
      const greens = birch ? ["#537f31", "#6f9b3e", "#83aa49", "#426d2d"] : ["#244f27", "#356a32", "#477d3d", "#2f602d"];
      const count = birch ? 105 : 125;
      for (let i = 0; i < count; i++) {
        const x = 30 + random() * 200, y = 33 + random() * 112;
        const width = (birch ? 8 : 10) + random() * (birch ? 10 : 14), height = width * (1.25 + random() * 0.42);
        context.save(); context.translate(x, y); context.rotate((random() - 0.5) * 2.6);
        context.fillStyle = greens[Math.floor(random() * greens.length)];
        context.beginPath(); context.moveTo(0, -height / 2);
        context.bezierCurveTo(width * 0.72, -height * 0.18, width * 0.62, height * 0.32, 0, height / 2);
        context.bezierCurveTo(-width * 0.62, height * 0.32, -width * 0.72, -height * 0.18, 0, -height / 2);
        context.fill(); context.restore();
      }
    }
  } else if (id.endsWith("bark")) {
    const birch = id === "birch-bark";
    context.fillStyle = birch ? "#eee9dc" : "#b47b50"; context.fillRect(0, 0, 256, 512);
    for (let i = 0; i < (birch ? 85 : 150); i++) {
      const x = random() * 256, y = random() * 512;
      context.strokeStyle = birch
        ? `rgba(45,42,38,${0.18 + random() * 0.42})`
        : `rgba(${45 + random() * 35},${25 + random() * 20},${16 + random() * 13},${0.2 + random() * 0.42})`;
      context.lineWidth = birch ? 1 + random() * 3 : 1 + random() * 5;
      context.beginPath();
      if (birch) { context.moveTo(x, y); context.lineTo(x + 12 + random() * 48, y + (random() - 0.5) * 4); }
      else { context.moveTo(x, y); context.lineTo(x + (random() - 0.5) * 8, y + 18 + random() * 70); }
      context.stroke();
    }
  } else {
    context.fillStyle = "#77766f"; context.fillRect(0, 0, 256, 512);
    for (let i = 0; i < 420; i++) {
      const shade = 65 + Math.floor(random() * 90), alpha = 0.08 + random() * 0.22;
      context.fillStyle = `rgba(${shade},${shade - 2},${shade - 7},${alpha})`;
      context.beginPath(); context.arc(random() * 256, random() * 512, 1 + random() * 13, 0, Math.PI * 2); context.fill();
    }
  }
  // Texture(image) is intentionally used instead of CanvasTexture here: the
  // standalone artifact's aggressive esbuild pass can tree-shake the latter's
  // constructor even though the live Vite graph retains it.
  const texture = new THREE.Texture(canvas);
  texture.name = id; texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  if (foliage) {
    // Preserve sub-pixel leaf/needle coverage in the portable renderer. The
    // review cards are already LOD geometry, so a blurred alpha mip would make
    // their silhouettes vanish before the geometry LOD transition.
    texture.generateMipmaps = false; texture.minFilter = THREE.LinearFilter;
  } else texture.repeat.set(id.endsWith("bark") ? 2 : 1.5, id.endsWith("bark") ? 5 : 2.5);
  texture.anisotropy = 4; texture.needsUpdate = true;
  proceduralTextures.set(id, texture);
  return texture;
}

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
      if (attribute !== "position" && attribute !== "normal" && attribute !== "color" && attribute !== "uv") result.deleteAttribute(attribute);
    }
    if (!result.getAttribute("normal")) result.computeVertexNormals();
    return result;
  });
  const result = mergeGeometries(compatible, false);
  if (!result) throw new Error("Resource geometry merge failed");
  // Preserve the smooth input normals. Recomputing after toNonIndexed() makes
  // every triangle its own smoothing island—the source of the faceted rocks
  // visible in the rejected review screenshots.
  result.computeBoundingBox(); result.computeBoundingSphere();
  for (const geometry of compatible) geometry.dispose();
  for (const geometry of geometries) geometry.dispose();
  return result;
}

function foliageCard(start: THREE.Vector3, end: THREE.Vector3, width: number, roll: number): THREE.BufferGeometry {
  const direction = end.clone().sub(start);
  const length = direction.length();
  const geometry = new THREE.PlaneGeometry(length, width, 1, 1);
  geometry.rotateX(roll);
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), direction.normalize()));
  geometry.translate((start.x + end.x) / 2, (start.y + end.y) / 2, (start.z + end.z) / 2);
  return geometry;
}

function foliageSpray(parts: THREE.BufferGeometry[], start: THREE.Vector3, end: THREE.Vector3, width: number, random: () => number, planes = 2): void {
  for (let plane = 0; plane < planes; plane++) {
    const geometry = foliageCard(start, end, width * (0.88 + random() * 0.24), plane / planes * Math.PI + (random() - 0.5) * 0.3);
    parts.push(tintGeometry(geometry, 0xffffff, 0.035, random));
  }
}

function groundBlendGeometry(radius: number, random: () => number): THREE.BufferGeometry {
  const segments = 24;
  const positions: number[] = [0, -0.055, 0];
  const uvs: number[] = [0.5, 0.5];
  for (let i = 0; i <= segments; i++) {
    const angle = i / segments * Math.PI * 2;
    const edge = radius * (0.78 + random() * 0.32);
    positions.push(Math.cos(angle) * edge, -0.075 - random() * 0.035, Math.sin(angle) * edge);
    uvs.push(0.5 + Math.cos(angle) * 0.5, 0.5 + Math.sin(angle) * 0.5);
  }
  const indices: number[] = [];
  for (let i = 1; i <= segments; i++) indices.push(0, i, i + 1);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
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
  const radial = lod === 0 ? 18 : lod === 1 ? 12 : 8;
  const woodParts: THREE.BufferGeometry[] = [];
  const foliageParts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(height * 0.038, height * 0.07, height * 1.035, radial, lod === 0 ? 9 : 4, false);
  trunk.translate(0, height * 0.495, 0);
  woodParts.push(tintGeometry(trunk, 0x8a5938, 0.08, random));
  const branchBase = new THREE.CylinderGeometry(0.58, 1, 1, lod === 0 ? 8 : 6, 1, false);
  const rootCount = lod === 2 ? 4 : [6, 7, 8][variant];
  let rootAngle = random() * Math.PI * 2;
  for (let i = 0; i < rootCount; i++) {
    rootAngle += (Math.PI * 2 / rootCount) * (0.62 + random() * 0.72);
    const length = height * (0.045 + random() * 0.075) * (i === 0 ? 1.35 : 1);
    const start = new THREE.Vector3(Math.cos(rootAngle) * height * 0.024, height * (0.035 + random() * 0.035), Math.sin(rootAngle) * height * 0.024);
    // The end is deliberately buried. No root may terminate as a visible cap.
    const end = new THREE.Vector3(Math.cos(rootAngle) * length, -0.16 - random() * 0.18, Math.sin(rootAngle) * length);
    woodParts.push(tintGeometry(between(branchBase, start, end, height * (0.012 + random() * 0.011)), 0x795038, 0.075, random));
  }
  woodParts.push(tintGeometry(groundBlendGeometry(height * (0.075 + variant * 0.005), random), 0x443829, 0.11, random));
  const tiers = lod === 0 ? [10, 12, 14][variant] : lod === 1 ? [8, 9, 10][variant] : [6, 7, 8][variant];
  const branchesPerTier = lod === 2 ? 3 : 5;
  for (let tier = 0; tier < tiers; tier++) {
    const t = tier / Math.max(1, tiers - 1);
    const y = height * (0.22 + t * 0.7) + (random() - 0.5) * height * 0.035;
    const taper = Math.pow(1 - t, 0.7);
    const tierRadius = crownRadius * (0.18 + taper * 0.82) * (0.78 + random() * 0.28);
    const tierRotation = tier * 2.399 + variant * 0.57 + random() * 0.3;
    for (let branch = 0; branch < branchesPerTier; branch++) {
      if (random() < (lod === 0 ? 0.1 : 0.16)) continue;
      const angle = tierRotation + branch / branchesPerTier * Math.PI * 2;
      const reach = tierRadius * (0.68 + random() * 0.34);
      const start = new THREE.Vector3(0, y, 0);
      const end = new THREE.Vector3(Math.cos(angle) * reach, y - reach * (0.02 + random() * 0.08), Math.sin(angle) * reach);
      if (lod < 2) woodParts.push(tintGeometry(between(branchBase, start, end, Math.max(0.04, height * (0.006 + taper * 0.004))), 0x67462f, 0.07, random));
      const sprays = lod === 0 ? 9 : lod === 1 ? 6 : 3;
      for (let spray = 0; spray < sprays; spray++) {
        const from = start.clone().lerp(end, 0.25 + spray / sprays * 0.62);
        const to = start.clone().lerp(end, 0.45 + spray / sprays * 0.55);
        to.y += (random() - 0.5) * reach * 0.08;
        foliageSpray(foliageParts, from, to, Math.max(0.82, reach * (0.34 + random() * 0.16)), random, lod === 2 ? 2 : 3);
      }
    }
  }
  for (let i = 0; i < (lod === 0 ? 7 : 4); i++) {
    const y = height * (0.82 + i * 0.022);
    foliageSpray(foliageParts, new THREE.Vector3(0, y, 0), new THREE.Vector3((random() - 0.5) * crownRadius * 0.28, y + height * 0.08, (random() - 0.5) * crownRadius * 0.28), crownRadius * 0.22, random, 3);
  }
  const pineMap = photographicPineFoliage ?? proceduralTexture("pine-foliage");
  const woodMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, map: photographicPineBark ?? proceduralTexture("pine-bark"), roughness: 0.9, metalness: 0 });
  const foliageMaterial = new THREE.MeshStandardMaterial({ color: 0xe4f1dc, vertexColors: true, map: pineMap, alphaMap: photographicPineFoliage?.userData.alphaMap ?? null, alphaTest: photographicPineFoliage ? 0.16 : 0.045, side: THREE.DoubleSide, roughness: 0.86, metalness: 0 });
  const woodMesh = new THREE.Mesh(merged(woodParts), woodMaterial); woodMesh.name = "pine-trunk-branches-buried-roots-ground-blend";
  const foliageMesh = new THREE.Mesh(merged(foliageParts), foliageMaterial); foliageMesh.name = "pine-needle-sprays"; foliageMesh.userData.windPart = true;
  group.add(woodMesh, foliageMesh); group.userData.collision = { type: "capsule", radius: height * 0.075, height: height * 0.82 };
  group.userData.wind = { amplitude: 0.018, frequency: 0.58, phase: random() * Math.PI * 2 };
  return group;
}

function buildBirch(variant: number, lod: ResourceLod): THREE.Group {
  const random = rng(FAMILY_SEEDS.birch + variant * 107 + lod * 1019);
  const group = new THREE.Group(); group.name = `birch-v${variant + 1}-lod${lod}`;
  const heights = [10.5, 15.5, 19.5], widths = [4.2, 6.1, 7.4];
  const height = heights[variant], crownWidth = widths[variant];
  const radial = lod === 0 ? 16 : lod === 1 ? 10 : 7;
  const woodParts: THREE.BufferGeometry[] = [], foliageParts: THREE.BufferGeometry[] = [];
  const trunkBase = new THREE.CylinderGeometry(1, 1, 1, radial, lod === 0 ? 6 : 2, false);
  const trunk = trunkBase.clone();
  trunk.scale(height * 0.039, height * 1.03, height * 0.039);
  trunk.translate(0, height * 0.495, 0);
  woodParts.push(tintGeometry(trunk, 0xd8d3c4, 0.06, random));

  // Sparse charcoal lenticels are geometry at review distance, then collapse
  // into the vertex-color silhouette in cheaper LODs.
  const lenticels = lod === 0 ? 12 : lod === 1 ? 5 : 0;
  for (let i = 0; i < lenticels; i++) {
    const y = height * (0.12 + i / Math.max(1, lenticels) * 0.64 + random() * 0.025);
    const mark = new THREE.TorusGeometry(height * 0.044, height * 0.0032, 3, radial);
    mark.rotateX(Math.PI / 2); mark.scale(1, 1, 0.35 + random() * 0.35); mark.translate(0, y, 0);
    woodParts.push(tintGeometry(mark, 0x443f3a, 0.06, random));
  }

  const rootCount = lod === 2 ? 3 : [5, 6, 7][variant];
  let rootAngle = random() * Math.PI * 2;
  for (let i = 0; i < rootCount; i++) {
    rootAngle += Math.PI * 2 / rootCount * (0.65 + random() * 0.7);
    const length = height * (0.032 + random() * 0.055);
    const start = new THREE.Vector3(Math.cos(rootAngle) * height * 0.016, height * (0.025 + random() * 0.035), Math.sin(rootAngle) * height * 0.016);
    const end = new THREE.Vector3(Math.cos(rootAngle) * length, -0.12 - random() * 0.15, Math.sin(rootAngle) * length);
    woodParts.push(tintGeometry(between(trunkBase, start, end, height * (0.007 + random() * 0.008)), 0x8a8176, 0.08, random));
  }
  woodParts.push(tintGeometry(groundBlendGeometry(height * 0.055, random), 0x4d4435, 0.1, random));

  const branchCount = lod === 0 ? [20, 22, 22][variant] : lod === 1 ? [15, 18, 20][variant] : [9, 10, 11][variant];
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
    woodParts.push(tintGeometry(between(trunkBase, start, end, height * (0.006 + (1 - t) * 0.003)), 0x7f7466, 0.09, random));
    if (lod < 2) {
      const forkAngle = angle + (random() - 0.5) * 1.2;
      const forkStart = start.clone().lerp(end, 0.62);
      const forkEnd = end.clone().add(new THREE.Vector3(Math.cos(forkAngle) * reach * 0.28, height * 0.07, Math.sin(forkAngle) * reach * 0.28));
      woodParts.push(tintGeometry(between(trunkBase, forkStart, forkEnd, height * 0.0045), 0x756b60, 0.08, random));
    }
    const leafClusters = lod === 0 ? 7 : lod === 1 ? 4 : 2;
    for (let cluster = 0; cluster < leafClusters; cluster++) {
      const along = 0.48 + cluster / Math.max(1, leafClusters - 1) * 0.5;
      const center = start.clone().lerp(end, Math.min(0.98, along));
      const tip = center.clone().add(new THREE.Vector3(Math.cos(angle + (random() - 0.5) * 0.8) * crownWidth * 0.18, (random() - 0.35) * crownWidth * 0.12, Math.sin(angle + (random() - 0.5) * 0.8) * crownWidth * 0.18));
      foliageSpray(foliageParts, center, tip, crownWidth * (lod === 2 ? 0.22 : 0.2 + random() * 0.07), random, lod === 2 ? 2 : 3);
    }
  }
  const woodMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, map: proceduralTexture("birch-bark"), roughness: 0.91, metalness: 0 });
  const foliageMaterial = new THREE.MeshStandardMaterial({ color: 0xc5dca2, vertexColors: true, map: proceduralTexture("birch-foliage"), alphaTest: 0.045, side: THREE.DoubleSide, roughness: 0.84, metalness: 0 });
  const woodMesh = new THREE.Mesh(merged(woodParts), woodMaterial); woodMesh.name = "birch-bark-branches-buried-roots-ground-blend";
  const foliageMesh = new THREE.Mesh(merged(foliageParts), foliageMaterial); foliageMesh.name = "birch-leaf-sprays"; foliageMesh.userData.windPart = true;
  group.add(woodMesh, foliageMesh);
  group.userData.collision = { type: "capsule", radius: height * 0.05, height: height * 0.78 };
  group.userData.wind = { mode: "foliage-only", amplitude: 0.026, frequency: 0.78, phase: random() * Math.PI * 2 };
  return group;
}

function orePalette(family: "copper" | "tin") {
  return family === "copper"
    ? { host: 0x85796a, ore: 0xd07b47, accent: 0x55917a }
    : { host: 0x65717e, ore: 0xdaddd9, accent: 0xaab1b7 };
}

function buildOre(family: "copper" | "tin", variant: number, lod: ResourceLod): THREE.Group {
  const random = rng(FAMILY_SEEDS[family] + variant * 131 + lod * 1013);
  const group = new THREE.Group(); group.name = `${family}-v${variant + 1}-lod${lod}`;
  const palette = orePalette(family);
  const scales = family === "copper" ? [1.25, 1.75, 2.3] : [1.15, 1.65, 2.15];
  const size = scales[variant];
  const detail = lod === 0 ? 10 : lod === 1 ? 4 : 1;
  const hostParts: THREE.BufferGeometry[] = [];
  const oreParts: THREE.BufferGeometry[] = [];
  // One coherent host body avoids the detached, tiled-shell appearance of
  // several overlapping icospheres. Mineral seams carry the ore identity.
  const boulders = 1;
  for (let i = 0; i < boulders; i++) {
    const angle = i / boulders * Math.PI * 2 + random() * 0.8;
    const radius = size * 0.72;
    const squash = new THREE.Vector3(0.85 + random() * 0.35, 0.72 + random() * 0.45, 0.8 + random() * 0.4);
    const rock = irregularRock(radius, detail, FAMILY_SEEDS[family] + variant * 71 + i * 19 + lod, squash);
    rock.rotateY(angle + random()); rock.translate(0, radius * squash.y * 0.7 - size * 0.08, 0);
    hostParts.push(tintGeometry(rock, palette.host, 0.13, random));
  }
  const noduleCount = lod === 0 ? 10 : lod === 1 ? 6 : 3;
  const noduleDetail = lod === 0 ? 2 : lod === 1 ? 1 : 0;
  for (let i = 0; i < noduleCount; i++) {
    const angle = i / noduleCount * Math.PI * 2 + variant * 0.41 + random() * 0.55;
    const radial = size * (0.18 + random() * 0.34);
    const nodule = irregularRock(size * (0.09 + random() * 0.055), noduleDetail, FAMILY_SEEDS[family] + variant * 307 + lod * 37 + i, new THREE.Vector3(1.25, 0.42, 0.72));
    nodule.rotateY(-angle + (random() - 0.5) * 0.45);
    // Upper-surface approximation deliberately sinks most of the mineral
    // body into the host, leaving a broken readable exposure instead of a
    // floating tube or fantasy crystal arch.
    const normalizedRadius = radial / (size * 0.55);
    const surfaceY = size * (0.62 - normalizedRadius * normalizedRadius * 0.17);
    nodule.translate(Math.cos(angle) * radial, surfaceY, Math.sin(angle) * radial);
    oreParts.push(tintGeometry(nodule, i % 5 === 0 ? palette.accent : palette.ore, 0.08, random));
  }
  const hostMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, map: proceduralTexture("rock"), roughness: 0.94, metalness: 0.01, flatShading: false });
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
  const detail = lod === 0 ? 11 : lod === 1 ? 5 : 2;
  const shapes = [
    new THREE.Vector3(1.18, 0.68, 0.92),
    new THREE.Vector3(0.96, 0.78, 1.22),
    new THREE.Vector3(1.3, 0.72, 0.84),
  ];
  const rock = irregularRock(size * 0.72, detail, FAMILY_SEEDS.stone + variant * 79 + lod, shapes[variant]);
  rock.rotateY(random() * Math.PI); rock.translate(0, size * shapes[variant].y * 0.5, 0);
  const palette = [0x8a8980, 0x79817d, 0x958979];
  const geometry = tintGeometry(rock, palette[variant], 0.1, random);
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, map: proceduralTexture("rock"), roughness: 0.97, metalness: 0, flatShading: false });
  const mesh = new THREE.Mesh(geometry, material); mesh.name = "coherent-weathered-fieldstone";
  group.add(mesh); group.userData.collision = { type: "convex-hull", radius: size, height: size * 1.35 };
  return group;
}

function buildRedberry(variant: number, lod: ResourceLod): THREE.Group {
  const random = rng(FAMILY_SEEDS.redberry + variant * 149 + lod * 1031);
  const group = new THREE.Group(); group.name = `redberry-v${variant + 1}-lod${lod}`;
  const heights = [0.85, 1.25, 1.65], height = heights[variant];
  const width = height * [1.2, 1.35, 1.48][variant];
  const woodParts: THREE.BufferGeometry[] = [], foliageParts: THREE.BufferGeometry[] = [], berryParts: THREE.BufferGeometry[] = [];
  const radial = lod === 0 ? 7 : 5;
  const stemBase = new THREE.CylinderGeometry(1, 1, 1, radial, 1, false);
  const stems = lod === 0 ? [10, 14, 15][variant] : lod === 1 ? [6, 8, 9][variant] : [3, 4, 5][variant];
  const endpoints: THREE.Vector3[] = [];
  for (let i = 0; i < stems; i++) {
    const angle = i / stems * Math.PI * 2 + random() * 0.9;
    const end = new THREE.Vector3(Math.cos(angle) * width * (0.25 + random() * 0.27), height * (0.62 + random() * 0.34), Math.sin(angle) * width * (0.25 + random() * 0.27));
    endpoints.push(end);
    const base = new THREE.Vector3((random() - 0.5) * width * 0.22, -0.08 - random() * 0.07, (random() - 0.5) * width * 0.22);
    woodParts.push(tintGeometry(between(stemBase, base, end, height * (0.016 + random() * 0.007)), 0x5b3827, 0.1, random));
  }
  woodParts.push(tintGeometry(groundBlendGeometry(width * 0.38, random), 0x463a2b, 0.1, random));
  const leafCount = lod === 0 ? [44, 60, 72][variant] : lod === 1 ? [24, 32, 38][variant] : [8, 10, 12][variant];
  for (let i = 0; i < leafCount; i++) {
    const anchor = endpoints[i % endpoints.length];
    const center = anchor.clone().add(new THREE.Vector3((random() - 0.5) * width * 0.55, (random() - 0.65) * height * 0.42, (random() - 0.5) * width * 0.55));
    const angle = random() * Math.PI * 2;
    const tip = center.clone().add(new THREE.Vector3(Math.cos(angle) * width * (0.16 + random() * 0.12), (random() - 0.35) * height * 0.13, Math.sin(angle) * width * (0.16 + random() * 0.12)));
    foliageSpray(foliageParts, center, tip, width * (0.13 + random() * 0.07), random, lod === 2 ? 2 : 3);
  }
  const berries = lod === 0 ? [18, 26, 30][variant] : lod === 1 ? [9, 12, 14][variant] : [5, 6, 7][variant];
  for (let i = 0; i < berries; i++) {
    const anchor = endpoints[(i * 5 + 2) % endpoints.length];
    const berry = new THREE.SphereGeometry(height * (lod === 2 ? 0.035 : 0.025), lod === 0 ? 7 : 5, lod === 0 ? 5 : 3);
    berry.translate(anchor.x + (random() - 0.5) * width * 0.28, anchor.y - random() * height * 0.2, anchor.z + (random() - 0.5) * width * 0.28);
    berryParts.push(tintGeometry(berry, i % 7 === 0 ? 0x8f171d : 0xc42b32, 0.12, random));
  }
  const woodMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  const foliageMaterial = new THREE.MeshStandardMaterial({ color: 0xc3d8ad, vertexColors: true, map: proceduralTexture("redberry-foliage"), alphaTest: 0.07, side: THREE.DoubleSide, roughness: 0.84, metalness: 0 });
  const woodMesh = new THREE.Mesh(merged([...woodParts, ...berryParts]), woodMaterial); woodMesh.name = "redberry-buried-stems-ground-blend-and-fruit";
  const foliageMesh = new THREE.Mesh(merged(foliageParts), foliageMaterial); foliageMesh.name = "redberry-leaf-sprays"; foliageMesh.userData.windPart = true;
  group.add(woodMesh, foliageMesh); group.userData.collision = { type: "convex-hull", radius: width * 0.48, height };
  group.userData.wind = { amplitude: 0.04, frequency: 1.05, phase: random() * Math.PI * 2 };
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
