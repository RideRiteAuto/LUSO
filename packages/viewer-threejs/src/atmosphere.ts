import * as THREE from "three/webgpu";
import { color, exponentialHeightFogFactor, fog, rangeFogFactor } from "three/tsl";

export type ViewMode = "ground" | "flight" | "overview";

const FOG_COLOR = new THREE.Color(0x8da5b4);

/**
 * Shared sky, horizon, camera clipping, and TSL aerial perspective profile.
 * Ground travel gets a believable render horizon; cartographic modes retain
 * the explicit long-range inspector view.
 */
export class NavoraAtmosphere {
  private mode: ViewMode | null = null;

  constructor(private readonly scene: THREE.Scene, private readonly camera: THREE.PerspectiveCamera) {
    scene.background = FOG_COLOR.clone().multiplyScalar(0.72);
    const distance = rangeFogFactor(6500, 22000);
    const lowHaze = exponentialHeightFogFactor(0.000004, 90);
    scene.fogNode = fog(color(FOG_COLOR), distance.max(lowHaze.mul(0.72)));
    this.setMode("overview");
  }

  setMode(mode: ViewMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    if (mode === "ground") {
      this.camera.far = 24000;
      this.scene.fogNode = fog(
        color(FOG_COLOR),
        rangeFogFactor(6000, 22000).max(exponentialHeightFogFactor(0.000004, 90).mul(0.74)),
      );
    } else if (mode === "flight") {
      this.camera.far = 70000;
      this.scene.fogNode = fog(
        color(FOG_COLOR),
        rangeFogFactor(18000, 62000).max(exponentialHeightFogFactor(0.0000015, 180).mul(0.42)),
      );
    } else {
      this.camera.far = 500000;
      this.scene.fogNode = fog(color(FOG_COLOR), rangeFogFactor(90000, 280000));
    }
    this.camera.updateProjectionMatrix();
  }

  get currentMode(): ViewMode { return this.mode ?? "overview"; }
}
