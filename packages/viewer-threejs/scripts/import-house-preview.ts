import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import * as THREE from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";

class NodeFileReader {
  result: string | ArrayBuffer | null = null;
  onloadend: ((event: { target: NodeFileReader }) => void) | null = null;

  readAsArrayBuffer(blob: Blob): void {
    void blob.arrayBuffer().then((buffer) => { this.result = buffer; this.onloadend?.({ target: this }); });
  }

  readAsDataURL(blob: Blob): void {
    void blob.arrayBuffer().then((buffer) => {
      this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString("base64")}`;
      this.onloadend?.({ target: this });
    });
  }
}

// The delivery references texture files that are not inside any of the three
// downloaded archives. Keep FBXLoader from trying to create browser images;
// the model is separated into semantic PBR surfaces below instead.
Object.assign(globalThis, {
  FileReader: NodeFileReader,
  document: { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, get src() { return ""; }, set src(_value: string) {} }) },
});

const input = process.argv[2];
const output = process.argv[3];
if (!input || !output) throw new Error("Usage: import-house-preview.ts <input.fbx> <output.glb>");

type Surface = "timber" | "wall" | "roof" | "metal";
interface ComponentStats {
  root: number;
  faces: number[];
  materialIndex: number;
  min: THREE.Vector3;
  max: THREE.Vector3;
}

const materials: Record<Surface, THREE.MeshStandardMaterial> = {
  timber: new THREE.MeshStandardMaterial({ name: "house-003-timber", color: 0x5a3823, roughness: 0.82, metalness: 0, vertexColors: true }),
  wall: new THREE.MeshStandardMaterial({ name: "house-003-wall-infill", color: 0x9b7951, roughness: 0.94, metalness: 0, vertexColors: true }),
  roof: new THREE.MeshStandardMaterial({ name: "house-003-weathered-roof", color: 0x40342d, roughness: 0.91, metalness: 0, vertexColors: true }),
  metal: new THREE.MeshStandardMaterial({ name: "house-003-forged-metal", color: 0x34383a, roughness: 0.48, metalness: 0.76, vertexColors: true }),
};

function hash01(value: number): number {
  const x = Math.sin(value * 91.733 + 17.13) * 43758.5453;
  return x - Math.floor(x);
}

function classify(component: ComponentStats): Surface | "ground" {
  const size = component.max.clone().sub(component.min);
  const centerY = (component.min.y + component.max.y) * 0.5;
  const broadGround = size.x > 12 && size.z > 12 && size.y < 0.65 && component.faces.length > 10_000;
  if (broadGround) return "ground";
  if (component.materialIndex > 0) return "metal";
  const barrelHoop = size.y < 0.14 && size.x > 0.42 && size.z > 0.42
    && size.x < 0.9 && size.z < 0.9 && centerY < 1.35 && component.faces.length <= 160;
  if (barrelHoop) return "metal";
  const horizontalSpan = Math.max(size.x, size.z);
  const thickness = Math.min(size.x, size.z);
  if (centerY > 4.35 || (component.max.y > 5 && horizontalSpan > 1.25)) return "roof";
  if (size.y > 0.8 && horizontalSpan > 0.9 && thickness < 0.28 && component.max.y < 4.8) return "wall";
  return "timber";
}

function classifyMesh(sourceMesh: THREE.Mesh): { group: THREE.Group; removedFaces: number; keptFaces: number; surfaces: Record<Surface, number> } {
  const transformed = sourceMesh.geometry.clone();
  transformed.applyMatrix4(sourceMesh.matrixWorld);
  const geometry = transformed.index ? transformed.toNonIndexed() : transformed;
  if (geometry !== transformed) transformed.dispose();
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const uv = geometry.getAttribute("uv");
  const triangleCount = Math.floor(position.count / 3);
  const vertexRoot = new Int32Array(position.count);
  const canonical = new Map<string, number>();
  for (let vertex = 0; vertex < position.count; vertex++) {
    const key = `${position.getX(vertex).toFixed(5)}:${position.getY(vertex).toFixed(5)}:${position.getZ(vertex).toFixed(5)}`;
    const root = canonical.get(key);
    if (root === undefined) { canonical.set(key, vertex); vertexRoot[vertex] = vertex; }
    else vertexRoot[vertex] = root;
  }
  const parent = Int32Array.from({ length: position.count }, (_, index) => index);
  const find = (value: number): number => {
    let current = value;
    while (parent[current] !== current) { parent[current] = parent[parent[current]]; current = parent[current]; }
    return current;
  };
  const join = (a: number, b: number): void => {
    const rootA = find(a), rootB = find(b);
    if (rootA !== rootB) parent[rootB] = rootA;
  };
  for (let triangle = 0; triangle < triangleCount; triangle++) {
    const a = vertexRoot[triangle * 3], b = vertexRoot[triangle * 3 + 1], c = vertexRoot[triangle * 3 + 2];
    join(a, b); join(a, c);
  }
  const triangleMaterial = new Uint16Array(triangleCount);
  for (const sourceGroup of geometry.groups) {
    const first = Math.floor(sourceGroup.start / 3), last = Math.ceil((sourceGroup.start + sourceGroup.count) / 3);
    for (let triangle = first; triangle < Math.min(last, triangleCount); triangle++) triangleMaterial[triangle] = sourceGroup.materialIndex;
  }
  const components = new Map<number, ComponentStats>();
  for (let triangle = 0; triangle < triangleCount; triangle++) {
    const root = find(vertexRoot[triangle * 3]);
    let component = components.get(root);
    if (!component) {
      component = { root, faces: [], materialIndex: triangleMaterial[triangle], min: new THREE.Vector3(Infinity, Infinity, Infinity), max: new THREE.Vector3(-Infinity, -Infinity, -Infinity) };
      components.set(root, component);
    }
    component.faces.push(triangle);
    for (let corner = 0; corner < 3; corner++) {
      const vertex = triangle * 3 + corner;
      component.min.x = Math.min(component.min.x, position.getX(vertex));
      component.min.y = Math.min(component.min.y, position.getY(vertex));
      component.min.z = Math.min(component.min.z, position.getZ(vertex));
      component.max.x = Math.max(component.max.x, position.getX(vertex));
      component.max.y = Math.max(component.max.y, position.getY(vertex));
      component.max.z = Math.max(component.max.z, position.getZ(vertex));
    }
  }

  const buckets = new Map<Surface, { position: number[]; normal: number[]; uv: number[]; color: number[] }>();
  for (const surface of Object.keys(materials) as Surface[]) buckets.set(surface, { position: [], normal: [], uv: [], color: [] });
  let removedFaces = 0, keptFaces = 0;
  const surfaceFaces: Record<Surface, number> = { timber: 0, wall: 0, roof: 0, metal: 0 };
  for (const component of components.values()) {
    const surface = classify(component);
    if (surface === "ground") { removedFaces += component.faces.length; continue; }
    const bucket = buckets.get(surface)!;
    const tint = 0.82 + hash01(component.root) * 0.28;
    for (const triangle of component.faces) {
      keptFaces++; surfaceFaces[surface]++;
      for (let corner = 0; corner < 3; corner++) {
        const vertex = triangle * 3 + corner;
        bucket.position.push(position.getX(vertex), position.getY(vertex), position.getZ(vertex));
        if (normal) bucket.normal.push(normal.getX(vertex), normal.getY(vertex), normal.getZ(vertex));
        if (uv) bucket.uv.push(uv.getX(vertex), uv.getY(vertex));
        bucket.color.push(tint, tint, tint);
      }
    }
  }
  geometry.dispose();

  const group = new THREE.Group();
  for (const [surface, bucket] of buckets) {
    if (!bucket.position.length) continue;
    const result = new THREE.BufferGeometry();
    result.setAttribute("position", new THREE.Float32BufferAttribute(bucket.position, 3));
    if (bucket.normal.length) result.setAttribute("normal", new THREE.Float32BufferAttribute(bucket.normal, 3));
    else result.computeVertexNormals();
    if (bucket.uv.length) result.setAttribute("uv", new THREE.Float32BufferAttribute(bucket.uv, 2));
    result.setAttribute("color", new THREE.Float32BufferAttribute(bucket.color, 3));
    result.computeBoundingBox(); result.computeBoundingSphere();
    const mesh = new THREE.Mesh(result, materials[surface]);
    mesh.name = `house-003-${surface}`;
    mesh.userData.surface = surface;
    mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh);
  }
  return { group, removedFaces, keptFaces, surfaces: surfaceFaces };
}

const bytes = await readFile(input);
const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const source = new FBXLoader().parse(arrayBuffer, "");
source.scale.setScalar(0.01); // FBX authored in centimetres; Navora uses metres.
source.updateMatrixWorld(true);

const result = new THREE.Group();
result.name = "house-003-review";
let removedGroundFaces = 0, triangles = 0, sourceMeshes = 0;
const surfaceFaces: Record<Surface, number> = { timber: 0, wall: 0, roof: 0, metal: 0 };
source.traverse((object) => {
  if (!(object instanceof THREE.Mesh)) return;
  sourceMeshes++;
  const classified = classifyMesh(object);
  removedGroundFaces += classified.removedFaces;
  triangles += classified.keptFaces;
  for (const surface of Object.keys(surfaceFaces) as Surface[]) surfaceFaces[surface] += classified.surfaces[surface];
  result.add(classified.group);
});
result.updateMatrixWorld(true);
const originalBounds = new THREE.Box3().setFromObject(result);
const center = originalBounds.getCenter(new THREE.Vector3());
result.position.set(-center.x, -originalBounds.min.y, -center.z);
result.updateMatrixWorld(true);
const bounds = new THREE.Box3().setFromObject(result);
const size = bounds.getSize(new THREE.Vector3());
result.userData.review = {
  source: "CGTrader house 003 FBX",
  delivery: "semantic PBR reconstruction; referenced texture maps absent from delivery",
  removedGroundFaces, triangles, sourceMeshes, surfaceFaces, sizeMeters: size.toArray(),
};

const binary = await new GLTFExporter().parseAsync(result, { binary: true, onlyVisible: false, trs: true });
if (!(binary instanceof ArrayBuffer)) throw new Error("House preview did not export as binary GLB");
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, Buffer.from(binary));
console.log(JSON.stringify({ output, bytes: binary.byteLength, removedGroundFaces, triangles, sourceMeshes, surfaceFaces, sizeMeters: size.toArray() }, null, 2));
