import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import * as THREE from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";

class NodeFileReader {
  result = null;
  onloadend = null;

  readAsArrayBuffer(blob) {
    void blob.arrayBuffer().then((buffer) => {
      this.result = buffer;
      this.onloadend?.({ target: this });
    });
  }

  readAsDataURL(blob) {
    void blob.arrayBuffer().then((buffer) => {
      this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString("base64")}`;
      this.onloadend?.({ target: this });
    });
  }
}

// FBXLoader creates image elements as soon as it sees external texture paths.
// The downloaded preview did not include those maps, so provide an inert image
// target and replace the incomplete materials below before exporting.
Object.assign(globalThis, {
  FileReader: NodeFileReader,
  document: {
    createElementNS: () => ({
      addEventListener() {},
      removeEventListener() {},
      get src() { return ""; },
      set src(_value) {},
    }),
  },
});

const input = process.argv[2];
const output = process.argv[3];
if (!input || !output) throw new Error("Usage: import-house-preview.ts <input.fbx> <output.glb>");

const bytes = await readFile(input);
const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const source = new FBXLoader().parse(arrayBuffer, "");
source.name = "house-003-review";

const wallMaterial = new THREE.MeshStandardMaterial({
  name: "house-003-neutral-review",
  color: 0xb5a78e,
  roughness: 0.88,
  metalness: 0,
});
const accentMaterial = new THREE.MeshStandardMaterial({
  name: "house-003-metal-review",
  color: 0x49443d,
  roughness: 0.66,
  metalness: 0.32,
});

let triangles = 0;
let meshes = 0;
source.traverse((object) => {
  if (!object.isMesh) return;
  const mesh = object;
  const geometry = mesh.geometry;
  triangles += geometry.index ? geometry.index.count / 3 : geometry.attributes.position.count / 3;
  meshes++;
  const count = Array.isArray(mesh.material) ? mesh.material.length : 1;
  mesh.material = count > 1 ? [wallMaterial, accentMaterial] : wallMaterial;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
});

// The FBX is authored in centimeters. Normalize to Navora's meter-scale,
// center its terrain footprint, and move its lowest point to ground level.
source.scale.setScalar(0.01);
source.updateMatrixWorld(true);
const originalBounds = new THREE.Box3().setFromObject(source);
const center = originalBounds.getCenter(new THREE.Vector3());
source.position.set(-center.x, -originalBounds.min.y, -center.z);
source.updateMatrixWorld(true);
const bounds = new THREE.Box3().setFromObject(source);
const size = bounds.getSize(new THREE.Vector3());
source.userData.review = {
  source: "CGTrader house 003 FBX",
  delivery: "neutral-material scale preview; purchased texture maps not supplied",
  triangles,
  meshes,
  sizeMeters: [size.x, size.y, size.z],
};

const binary = await new GLTFExporter().parseAsync(source, {
  binary: true,
  onlyVisible: false,
  trs: true,
});
if (!(binary instanceof ArrayBuffer)) throw new Error("House preview did not export as binary GLB");
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, Buffer.from(binary));
console.log(JSON.stringify({ output, bytes: binary.byteLength, triangles, meshes, sizeMeters: size.toArray() }, null, 2));
