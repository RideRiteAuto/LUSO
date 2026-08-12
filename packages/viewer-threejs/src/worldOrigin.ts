import * as THREE from "three/webgpu";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";

/** Keeps camera-space values small while preserving authoritative meter coordinates. */
export class CameraRelativeOrigin {
  readonly offset = new THREE.Vector3();
  private rebases = 0;

  constructor(private readonly root: THREE.Group, private readonly threshold = 8192, private readonly quantum = 4096) {}

  update(camera: THREE.Camera, controls: OrbitControls): boolean {
    if (Math.abs(camera.position.x) < this.threshold && Math.abs(camera.position.z) < this.threshold) return false;
    const shiftX = Math.round(camera.position.x / this.quantum) * this.quantum;
    const shiftZ = Math.round(camera.position.z / this.quantum) * this.quantum;
    this.offset.x += shiftX;
    this.offset.z += shiftZ;
    camera.position.x -= shiftX;
    camera.position.z -= shiftZ;
    controls.target.x -= shiftX;
    controls.target.z -= shiftZ;
    this.root.position.set(-this.offset.x, 0, -this.offset.z);
    this.rebases++;
    return true;
  }

  get rebaseCount(): number { return this.rebases; }

  worldX(localX: number): number { return localX + this.offset.x; }
  worldZ(localZ: number): number { return localZ + this.offset.z; }
  localX(worldX: number): number { return worldX - this.offset.x; }
  localZ(worldZ: number): number { return worldZ - this.offset.z; }

  worldPoint(local: THREE.Vector3): THREE.Vector3 {
    return new THREE.Vector3(this.worldX(local.x), local.y, this.worldZ(local.z));
  }

  localPoint(world: THREE.Vector3): THREE.Vector3 {
    return new THREE.Vector3(this.localX(world.x), world.y, this.localZ(world.z));
  }
}
