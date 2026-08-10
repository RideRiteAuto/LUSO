import * as THREE from "three";

// Free-fly camera: drag with the mouse to look around, WASD (+ Space/Ctrl)
// to move, hold Shift to go fast, scroll to change the base speed. This is
// deliberately NOT built on the Pointer Lock API -- this viewer is also
// published as a self-contained claude.ai artifact, and Pointer Lock is
// commonly blocked inside sandboxed iframes (no reliable way to grant the
// permission from here), so drag-to-look is the version that actually works
// everywhere this page runs, not just in a normal browser tab.

const MIN_SPEED = 200;
const MAX_SPEED = 40000;
const LOOK_SENSITIVITY = 0.0025;
const MAX_PITCH = Math.PI / 2 - 0.02;

export class FlightController {
  private speed = 3000; // world units / second
  private readonly boostMultiplier = 4;
  private readonly move = { forward: false, back: false, left: false, right: false, up: false, down: false, boost: false };
  private enabled = false;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private yaw = 0;
  private pitch = 0;
  private onExit: (() => void) | null = null;

  constructor(private camera: THREE.PerspectiveCamera, private domElement: HTMLElement) {
    domElement.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
    document.addEventListener("keydown", this.onKeyDown);
    document.addEventListener("keyup", this.onKeyUp);
    domElement.addEventListener("wheel", this.onWheel, { passive: false });
  }

  get currentSpeed(): number {
    return this.speed;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** Seeds yaw/pitch from the camera's current orientation so entering fly mode doesn't snap the view. */
  enable(onExit: () => void) {
    this.enabled = true;
    this.onExit = onExit;
    const euler = new THREE.Euler().setFromQuaternion(this.camera.quaternion, "YXZ");
    this.yaw = euler.y;
    this.pitch = euler.x;
  }

  disable() {
    this.enabled = false;
    this.dragging = false;
  }

  private onPointerDown = (e: PointerEvent) => {
    if (!this.enabled || e.button !== 0) return;
    this.dragging = true;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
  };

  private onPointerMove = (e: PointerEvent) => {
    if (!this.enabled || !this.dragging) return;
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.yaw -= dx * LOOK_SENSITIVITY;
    this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch - dy * LOOK_SENSITIVITY));
    this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, "YXZ"));
  };

  private onPointerUp = () => {
    this.dragging = false;
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.enabled) return;
    switch (e.code) {
      case "KeyW": case "ArrowUp": this.move.forward = true; break;
      case "KeyS": case "ArrowDown": this.move.back = true; break;
      case "KeyA": case "ArrowLeft": this.move.left = true; break;
      case "KeyD": case "ArrowRight": this.move.right = true; break;
      case "Space": this.move.up = true; e.preventDefault(); break;
      case "ControlLeft": case "KeyC": this.move.down = true; break;
      case "ShiftLeft": case "ShiftRight": this.move.boost = true; break;
      case "Escape": this.onExit?.(); break;
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    switch (e.code) {
      case "KeyW": case "ArrowUp": this.move.forward = false; break;
      case "KeyS": case "ArrowDown": this.move.back = false; break;
      case "KeyA": case "ArrowLeft": this.move.left = false; break;
      case "KeyD": case "ArrowRight": this.move.right = false; break;
      case "Space": this.move.up = false; break;
      case "ControlLeft": case "KeyC": this.move.down = false; break;
      case "ShiftLeft": case "ShiftRight": this.move.boost = false; break;
    }
  };

  private onWheel = (e: WheelEvent) => {
    if (!this.enabled) return;
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.001);
    this.speed = Math.min(MAX_SPEED, Math.max(MIN_SPEED, this.speed * factor));
  };

  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly worldUp = new THREE.Vector3(0, 1, 0);

  update(deltaSeconds: number) {
    if (!this.enabled) return;
    const effectiveSpeed = this.speed * (this.move.boost ? this.boostMultiplier : 1);
    const step = effectiveSpeed * deltaSeconds;

    this.camera.getWorldDirection(this.forward);
    this.right.crossVectors(this.forward, this.worldUp).normalize();

    if (this.move.forward) this.camera.position.addScaledVector(this.forward, step);
    if (this.move.back) this.camera.position.addScaledVector(this.forward, -step);
    if (this.move.right) this.camera.position.addScaledVector(this.right, step);
    if (this.move.left) this.camera.position.addScaledVector(this.right, -step);
    if (this.move.up) this.camera.position.y += step;
    if (this.move.down) this.camera.position.y -= step;
  }

  dispose() {
    this.domElement.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    document.removeEventListener("keydown", this.onKeyDown);
    document.removeEventListener("keyup", this.onKeyUp);
    this.domElement.removeEventListener("wheel", this.onWheel);
  }
}
