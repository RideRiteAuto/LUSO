import * as THREE from "three/webgpu";
import { buildResourceModel, disposeResourceModel, type ResourceFamilyId } from "./resourceModels.js";

interface YardAnchor { x: number; z: number }

const FAMILY_LAYOUT: Array<{ family: ResourceFamilyId; x: number; z: number }> = [
  // The visitor enters at local origin looking toward -Z. Put the smallest
  // family first and the tall silhouettes last so the yard reads as an
  // exhibit instead of teleporting the camera into a mature tree crown.
  { family: "redberry", x: -12, z: -18 },
  { family: "copper", x: 9, z: -30 },
  { family: "tin", x: 9, z: -44 },
  { family: "pine", x: -26, z: -62 },
];

export interface ResourceReviewStats {
  variants: number;
  triangles: number;
  draws: number;
}

/**
 * Fixed Phase-2 review arrangement. It is intentionally authored rather than
 * procedurally scattered so scale, silhouettes, and family differences are
 * judged at the same location after every rebuild.
 */
export class ResourceReviewYard {
  readonly group = new THREE.Group();
  private readonly models: THREE.Group[] = [];
  private anchor: YardAnchor = { x: 0, z: 0 };
  private _stats: ResourceReviewStats = { variants: 0, triangles: 0, draws: 0 };

  constructor(private readonly sampleGround: (x: number, z: number) => number) {
    this.group.name = "alvora-resource-review-yard";
    this.group.visible = false;
    this.build();
  }

  setAnchor(anchor: YardAnchor): void {
    this.anchor = anchor;
    this.group.position.set(anchor.x, 0, anchor.z);
    this.placeOnTerrain();
  }

  set visible(visible: boolean) { this.group.visible = visible; }
  get visible(): boolean { return this.group.visible; }
  get stats(): ResourceReviewStats { return this._stats; }

  private build(): void {
    let triangles = 0, draws = 0, variants = 0;
    for (const layout of FAMILY_LAYOUT) {
      for (let variant = 0; variant < 3; variant++) {
        const model = buildResourceModel(layout.family, variant, 0);
        const spacing = layout.family === "pine" ? 17 : layout.family === "redberry" ? 5.5 : 7;
        model.group.position.set(layout.x + variant * spacing, 0, layout.z);
        model.group.rotation.y = variant * 0.83 + (layout.family === "tin" ? 0.4 : 0);
        model.group.userData.reviewLabel = `${layout.family} ${["small", "standard", "mature"][variant]}`;
        this.group.add(model.group); this.models.push(model.group);
        triangles += model.info.triangles; draws += model.info.materials; variants++;
      }
    }
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
    this.models.length = 0; this.group.clear();
  }
}
