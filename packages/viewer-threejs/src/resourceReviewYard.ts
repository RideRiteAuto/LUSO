import * as THREE from "three/webgpu";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { color, float, mix, mx_noise_float, positionLocal, vec3 } from "three/tsl";
import { buildResourceModel, disposeResourceModel, loadResourceTextureSources, type ResourceFamilyId } from "./resourceModels.js";

interface YardAnchor { x: number; z: number }

const FAMILY_LAYOUT: Array<{ family: ResourceFamilyId; x: number; z: number }> = [
  // The visitor enters at local origin looking toward -Z. Put the smallest
  // family first and the tall silhouettes last so the yard reads as an
  // exhibit instead of teleporting the camera into a mature tree crown.
  { family: "redberry", x: -12, z: -18 },
  { family: "copper", x: 9, z: -30 },
  { family: "tin", x: 9, z: -44 },
  { family: "stone", x: 9, z: -48 },
  { family: "birch", x: -24, z: -44 },
  { family: "pine", x: 14, z: -44 },
];

export interface ResourceReviewStats {
  variants: number;
  triangles: number;
  draws: number;
}

function houseSurfaceMaterial(surface: string): THREE.MeshStandardNodeMaterial {
  const material = new THREE.MeshStandardNodeMaterial();
  material.name = `house-003-${surface}-procedural`;
  const broad = mx_noise_float(positionLocal.mul(0.38)).mul(0.5).add(0.5);
  if (surface === "metal") {
    const forged = mx_noise_float(positionLocal.mul(7.5)).mul(0.5).add(0.5);
    material.colorNode = mix(color(0x202629), color(0x4a5051), forged.mul(0.34).add(broad.mul(0.12)));
    material.roughnessNode = mix(float(0.34), float(0.58), forged);
    material.metalnessNode = float(0.82);
  } else if (surface === "wall") {
    const plaster = mx_noise_float(positionLocal.mul(vec3(1.8, 2.4, 1.8))).mul(0.5).add(0.5);
    material.colorNode = mix(color(0x6c4a2e), color(0xb08b5d), plaster.mul(0.42).add(broad.mul(0.18)));
    material.roughnessNode = mix(float(0.84), float(0.98), plaster);
    material.metalnessNode = float(0);
  } else if (surface === "roof") {
    const shakes = mx_noise_float(positionLocal.mul(vec3(3.2, 0.7, 3.2))).mul(0.5).add(0.5);
    material.colorNode = mix(color(0x241d19), color(0x554438), shakes.mul(0.48).add(broad.mul(0.12)));
    material.roughnessNode = mix(float(0.82), float(0.98), shakes);
    material.metalnessNode = float(0);
  } else {
    const grain = mx_noise_float(positionLocal.mul(vec3(0.65, 7.8, 0.65))).mul(0.5).add(0.5);
    const pores = mx_noise_float(positionLocal.mul(vec3(3.6, 18, 3.6))).mul(0.5).add(0.5);
    material.colorNode = mix(color(0x2f1b11), color(0x765039), grain.mul(0.55).add(pores.mul(0.12)).add(broad.mul(0.12)));
    material.roughnessNode = mix(float(0.68), float(0.92), pores);
    material.metalnessNode = float(0);
  }
  return material;
}

/**
 * Fixed starter-resource review arrangement. It is intentionally authored rather than
 * procedurally scattered so scale, silhouettes, and family differences are
 * judged at the same location after every rebuild.
 */
export class ResourceReviewYard {
  readonly group = new THREE.Group();
  private readonly models: THREE.Group[] = [];
  private readonly windParts: Array<{ object: THREE.Object3D; phase: number; amplitude: number; frequency: number }> = [];
  private anchor: YardAnchor = { x: 0, z: 0 };
  private _stats: ResourceReviewStats = { variants: 0, triangles: 0, draws: 0 };

  private constructor(
    private readonly sampleGround: (x: number, z: number) => number,
    private readonly housePreview: THREE.Group | null,
  ) {
    this.group.name = "alvora-resource-review-yard";
    this.group.visible = false;
    this.build();
  }

  static async create(sampleGround: (x: number, z: number) => number): Promise<ResourceReviewYard> {
    await loadResourceTextureSources();
    let housePreview: THREE.Group | null = null;
    if (typeof document !== "undefined") {
      try {
        const gltf = await new GLTFLoader().loadAsync(new URL("assets/review/house-003.glb", document.baseURI).href);
        housePreview = gltf.scene;
        housePreview.traverse((object) => {
          if (!(object as THREE.Mesh).isMesh) return;
          const mesh = object as THREE.Mesh;
          const surface = String(mesh.userData.surface ?? mesh.name.replace("house-003-", ""));
          const oldMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          mesh.material = houseSurfaceMaterial(surface);
          oldMaterials.forEach((material) => material.dispose());
          mesh.castShadow = true;
          mesh.receiveShadow = true;
        });
      } catch (error) {
        console.warn("House 003 review model was unavailable; continuing with resource families only.", error);
      }
    }
    return new ResourceReviewYard(sampleGround, housePreview);
  }

  setAnchor(anchor: YardAnchor): void {
    this.anchor = anchor;
    this.group.position.set(anchor.x, 0, anchor.z);
    this.placeOnTerrain();
  }

  set visible(visible: boolean) { this.group.visible = visible; }
  get visible(): boolean { return this.group.visible; }
  get stats(): ResourceReviewStats { return this._stats; }

  updateWind(elapsedSeconds: number): void {
    if (!this.visible) return;
    for (const wind of this.windParts) {
      const broad = Math.sin(elapsedSeconds * wind.frequency + wind.phase);
      const detail = Math.sin(elapsedSeconds * wind.frequency * 2.37 + wind.phase * 1.71) * 0.35;
      wind.object.rotation.z = (broad + detail) * wind.amplitude;
      wind.object.rotation.x = Math.sin(elapsedSeconds * wind.frequency * 0.73 + wind.phase * 0.6) * wind.amplitude * 0.42;
    }
  }

  private build(): void {
    let triangles = 0, draws = 0, variants = 0;
    for (const layout of FAMILY_LAYOUT) {
      for (let variant = 0; variant < 3; variant++) {
        const model = buildResourceModel(layout.family, variant, 0);
        const spacing = layout.family === "pine" || layout.family === "birch" ? 14 : layout.family === "redberry" ? 5.5 : 7;
        model.group.position.set(layout.x + variant * spacing, 0, layout.z);
        model.group.rotation.y = variant * 0.83 + (layout.family === "tin" ? 0.4 : 0);
        model.group.userData.reviewLabel = `${layout.family} ${["small", "standard", "mature"][variant]}`;
        const wind = model.group.userData.wind as { phase?: number; amplitude?: number; frequency?: number } | undefined;
        if (wind) model.group.traverse((object) => {
          if (!object.userData.windPart) return;
          this.windParts.push({
            object,
            phase: (wind.phase ?? 0) + variant * 0.73,
            amplitude: wind.amplitude ?? 0.02,
            frequency: wind.frequency ?? 0.7,
          });
        });
        this.group.add(model.group); this.models.push(model.group);
        triangles += model.info.triangles; draws += model.info.materials; variants++;
      }
    }
    if (this.housePreview) {
      this.housePreview.name = "house-003-review";
      this.housePreview.position.set(0, 0, -80);
      this.housePreview.rotation.y = Math.PI * 0.08;
      this.housePreview.userData.reviewLabel = "CGTrader house 003 — reconstructed PBR material preview";
      this.group.add(this.housePreview);
      this.models.push(this.housePreview);
      this.housePreview.traverse((object) => {
        if (!(object as THREE.Mesh).isMesh) return;
        const mesh = object as THREE.Mesh;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        triangles += mesh.geometry.index ? mesh.geometry.index.count / 3 : mesh.geometry.attributes.position.count / 3;
        draws += Array.isArray(mesh.material) ? mesh.material.length : 1;
      });
      variants++;
    }
    this.group.traverse((object) => {
      if (!(object as THREE.Mesh).isMesh) return;
      const mesh = object as THREE.Mesh;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });
    this._stats = { triangles, draws, variants };
  }

  private placeOnTerrain(): void {
    for (const model of this.models) {
      const worldX = this.anchor.x + model.position.x;
      const worldZ = this.anchor.z + model.position.z;
      model.position.y = this.sampleGround(worldX, worldZ) + 0.02;
    }
  }

  dispose(): void {
    for (const model of this.models) disposeResourceModel(model);
    this.models.length = 0; this.windParts.length = 0; this.group.clear();
  }
}
