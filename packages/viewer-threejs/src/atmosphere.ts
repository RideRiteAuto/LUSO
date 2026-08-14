import * as THREE from "three/webgpu";
import { color, exponentialHeightFogFactor, float, fog, mix, positionWorldDirection, rangeFogFactor, smoothstep, vec3 } from "three/tsl";

export type ViewMode = "ground" | "flight" | "overview";
export type AtmosphereQuality = "high" | "balanced" | "compatibility";

const FOG_COLOR = new THREE.Color(0x8da5b4);

/**
 * Shared sky, horizon, camera clipping, and TSL aerial perspective profile.
 * Ground travel gets a believable render horizon; cartographic modes retain
 * the explicit long-range inspector view.
 */
export class NavoraAtmosphere {
  private mode: ViewMode | null = null;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly quality: AtmosphereQuality = "balanced",
  ) {
    scene.background = FOG_COLOR.clone().multiplyScalar(0.72);
    const skyHeight = smoothstep(float(-0.08), float(0.82), positionWorldDirection.y);
    const horizonBand = smoothstep(float(-0.04), float(0.16), positionWorldDirection.y);
    const baseSky = mix(color(0xb9c7c8), color(0x527da0), skyHeight);
    const warmHorizon = mix(color(0xd8b78e), baseSky, horizonBand);
    const sunDirection = vec3(-0.5345, 0.8018, 0.2673).normalize();
    const sunHalo = smoothstep(float(0.965), float(0.9995), positionWorldDirection.dot(sunDirection));
    scene.backgroundNode = mix(warmHorizon, color(0xffe5b1), sunHalo.mul(float(0.82)));
    const distance = rangeFogFactor(6500, 22000);
    const lowHaze = exponentialHeightFogFactor(0.000004, 90);
    scene.fogNode = fog(color(FOG_COLOR), distance.max(lowHaze.mul(0.72)));
    this.setMode("overview");
  }

  setMode(mode: ViewMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    if (mode === "ground") {
      const portable = this.quality === "compatibility";
      const fogStart = portable ? 4500 : 6000;
      const fogEnd = portable ? 13500 : 22000;
      this.camera.far = portable ? 15000 : 24000;
      this.scene.fogNode = fog(
        color(FOG_COLOR),
        rangeFogFactor(fogStart, fogEnd).max(exponentialHeightFogFactor(0.000004, 90).mul(portable ? 0.8 : 0.74)),
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
