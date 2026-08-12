import * as THREE from "three/webgpu";
import { stepCapsule, type CapsuleState, type LocomotionState } from "./traversalPhysics.js";

export type MovementMode = "fly" | "walk";

const LOOK_SENSITIVITY = 0.0023;
const MAX_PITCH = Math.PI / 2 - 0.02;
// Neutral adult standing eye height; this is camera height above the
// capsule's feet, not total character height.
const EYE_HEIGHT_M = 1.72;
const CAPSULE_RADIUS_M = 0.35;
const FLY_SPEED = { base: 4000, min: 200, max: 20000, boost: 4 };

export interface StaticCollisionProxy {
  x: number;
  z: number;
  radius: number;
}

export interface FlightControllerOptions {
  getGroundHeight: (worldX: number, worldZ: number) => number;
  getWorldOffset: () => { x: number; z: number };
  worldBounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  getStaticObstacles?: () => StaticCollisionProxy[];
  getWater?: (worldX: number, worldZ: number) => { surfaceY: number; velocityX: number; velocityZ: number } | null;
}

/** Scouting flight plus a physical first-person capsule used by Walk mode. */
export class FlightController {
  private mode: MovementMode = "fly";
  private flySpeed = FLY_SPEED.base;
  private readonly move = { forward: false, back: false, left: false, right: false, up: false, down: false, boost: false };
  private enabled = false;
  private dragging = false;
  private jumpQueued = false;
  private lastX = 0;
  private lastY = 0;
  private yaw = 0;
  private pitch = 0;
  private onExit: (() => void) | null = null;
  private capsule: CapsuleState = { x: 0, z: 0, feetY: 0, velocityX: 0, velocityY: 0, velocityZ: 0, state: "grounded" };
  private readonly clampBounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly worldUp = new THREE.Vector3(0, 1, 0);

  constructor(private camera: THREE.PerspectiveCamera, private domElement: HTMLElement, private opts: FlightControllerOptions) {
    const b = opts.worldBounds;
    const insetX = (b.maxX - b.minX) * 0.01;
    const insetZ = (b.maxZ - b.minZ) * 0.01;
    this.clampBounds = { minX: b.minX + insetX, maxX: b.maxX - insetX, minZ: b.minZ + insetZ, maxZ: b.maxZ - insetZ };
    domElement.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
    document.addEventListener("pointerlockchange", this.onPointerLockChange);
    document.addEventListener("keydown", this.onKeyDown);
    document.addEventListener("keyup", this.onKeyUp);
    domElement.addEventListener("wheel", this.onWheel, { passive: false });
  }

  get currentSpeed(): number {
    return this.mode === "fly" ? this.flySpeed : Math.hypot(this.capsule.velocityX, this.capsule.velocityZ);
  }
  get currentMode(): MovementMode { return this.mode; }
  get locomotionState(): LocomotionState | "flying" { return this.mode === "fly" ? "flying" : this.capsule.state; }
  get isEnabled(): boolean { return this.enabled; }

  enable(onExit: () => void, mode: MovementMode = "fly", walkAnchorWorld?: { x: number; z: number }) {
    this.enabled = true;
    this.mode = mode;
    this.flySpeed = FLY_SPEED.base;
    this.onExit = onExit;
    const euler = new THREE.Euler().setFromQuaternion(this.camera.quaternion, "YXZ");
    this.yaw = euler.y;
    this.pitch = mode === "walk" ? Math.max(-0.6, Math.min(0.6, euler.x)) : euler.x;
    if (mode === "walk") {
      const offset = this.opts.getWorldOffset();
      const x = walkAnchorWorld?.x ?? this.camera.position.x + offset.x;
      const z = walkAnchorWorld?.z ?? this.camera.position.z + offset.z;
      this.capsule = {
        x, z, feetY: this.opts.getGroundHeight(x, z),
        velocityX: 0, velocityY: 0, velocityZ: 0, state: "grounded",
      };
      this.syncCameraToCapsule();
      this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, "YXZ"));
    }
  }

  teleport(worldX: number, worldZ: number, heading = this.yaw): void {
    this.capsule.x = worldX;
    this.capsule.z = worldZ;
    this.capsule.feetY = this.opts.getGroundHeight(worldX, worldZ);
    this.capsule.velocityX = this.capsule.velocityY = this.capsule.velocityZ = 0;
    this.capsule.state = "grounded";
    this.yaw = heading;
    this.pitch = -0.2;
    this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, "YXZ"));
    this.syncCameraToCapsule();
  }

  disable() {
    this.enabled = false;
    this.dragging = false;
    this.clearMovement();
    if (document.pointerLockElement === this.domElement) document.exitPointerLock();
  }

  update(deltaSeconds: number) {
    if (!this.enabled) return;
    if (this.mode === "fly") this.updateFly(deltaSeconds);
    else this.updateWalk(deltaSeconds);
  }

  private updateWalk(deltaSeconds: number): void {
    this.camera.getWorldDirection(this.forward);
    this.forward.y = 0;
    if (this.forward.lengthSq() < 0.001) this.forward.set(0, 0, -1);
    else this.forward.normalize();
    this.right.crossVectors(this.forward, this.worldUp).normalize();

    let inputX = 0, inputZ = 0;
    if (this.move.forward) { inputX += this.forward.x; inputZ += this.forward.z; }
    if (this.move.back) { inputX -= this.forward.x; inputZ -= this.forward.z; }
    if (this.move.right) { inputX += this.right.x; inputZ += this.right.z; }
    if (this.move.left) { inputX -= this.right.x; inputZ -= this.right.z; }

    stepCapsule(this.capsule, {
      moveX: inputX,
      moveZ: inputZ,
      sprint: this.move.boost,
      jump: this.jumpQueued || this.move.up,
      descend: this.move.down,
    }, deltaSeconds, this.opts.getGroundHeight, undefined, this.opts.getWater);
    this.jumpQueued = false;
    this.resolveStaticObstacles();
    this.capsule.x = Math.max(this.clampBounds.minX, Math.min(this.clampBounds.maxX, this.capsule.x));
    this.capsule.z = Math.max(this.clampBounds.minZ, Math.min(this.clampBounds.maxZ, this.capsule.z));
    this.syncCameraToCapsule();
  }

  private updateFly(deltaSeconds: number): void {
    const step = this.flySpeed * (this.move.boost ? FLY_SPEED.boost : 1) * deltaSeconds;
    this.camera.getWorldDirection(this.forward);
    this.right.crossVectors(this.forward, this.worldUp).normalize();
    if (this.move.forward) this.camera.position.addScaledVector(this.forward, step);
    if (this.move.back) this.camera.position.addScaledVector(this.forward, -step);
    if (this.move.right) this.camera.position.addScaledVector(this.right, step);
    if (this.move.left) this.camera.position.addScaledVector(this.right, -step);
    if (this.move.up) this.camera.position.y += step;
    if (this.move.down) this.camera.position.y -= step;
    const offset = this.opts.getWorldOffset();
    const worldX = Math.max(this.clampBounds.minX, Math.min(this.clampBounds.maxX, this.camera.position.x + offset.x));
    const worldZ = Math.max(this.clampBounds.minZ, Math.min(this.clampBounds.maxZ, this.camera.position.z + offset.z));
    this.camera.position.x = worldX - offset.x;
    this.camera.position.z = worldZ - offset.z;
    this.camera.position.y = Math.max(this.camera.position.y, this.opts.getGroundHeight(worldX, worldZ) + 5);
  }

  private syncCameraToCapsule(): void {
    const offset = this.opts.getWorldOffset();
    this.camera.position.set(this.capsule.x - offset.x, this.capsule.feetY + EYE_HEIGHT_M, this.capsule.z - offset.z);
  }

  private resolveStaticObstacles(): void {
    for (const obstacle of this.opts.getStaticObstacles?.() ?? []) {
      const dx = this.capsule.x - obstacle.x;
      const dz = this.capsule.z - obstacle.z;
      const minDistance = CAPSULE_RADIUS_M + obstacle.radius;
      const distance = Math.hypot(dx, dz);
      if (distance >= minDistance || distance < 0.0001) continue;
      const push = minDistance - distance;
      this.capsule.x += dx / distance * push;
      this.capsule.z += dz / distance * push;
    }
  }

  private applyLook(dx: number, dy: number): void {
    this.yaw -= dx * LOOK_SENSITIVITY;
    const maxPitch = this.mode === "walk" ? MAX_PITCH * 0.85 : MAX_PITCH;
    this.pitch = Math.max(-maxPitch, Math.min(maxPitch, this.pitch - dy * LOOK_SENSITIVITY));
    this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, "YXZ"));
  }

  private onPointerDown = (event: PointerEvent) => {
    if (!this.enabled || event.button !== 0) return;
    this.dragging = true;
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    if (document.pointerLockElement !== this.domElement && this.domElement.requestPointerLock) {
      this.domElement.requestPointerLock().catch(() => { /* drag-look remains active */ });
    }
  };
  private onPointerMove = (event: PointerEvent) => {
    if (!this.enabled) return;
    if (document.pointerLockElement === this.domElement) {
      this.applyLook(event.movementX, event.movementY);
      return;
    }
    if (!this.dragging) return;
    const dx = event.clientX - this.lastX, dy = event.clientY - this.lastY;
    this.lastX = event.clientX; this.lastY = event.clientY;
    this.applyLook(dx, dy);
  };
  private onPointerUp = () => { this.dragging = false; };
  private onPointerLockChange = () => {
    if (document.pointerLockElement !== this.domElement) this.dragging = false;
  };
  private onKeyDown = (event: KeyboardEvent) => {
    if (!this.enabled) return;
    switch (event.code) {
      case "KeyW": case "ArrowUp": this.move.forward = true; break;
      case "KeyS": case "ArrowDown": this.move.back = true; break;
      case "KeyA": case "ArrowLeft": this.move.left = true; break;
      case "KeyD": case "ArrowRight": this.move.right = true; break;
      case "Space": this.move.up = true; if (!event.repeat) this.jumpQueued = true; event.preventDefault(); break;
      case "ControlLeft": case "KeyC": this.move.down = true; break;
      case "ShiftLeft": case "ShiftRight": this.move.boost = true; break;
      case "Escape": this.onExit?.(); break;
    }
  };
  private onKeyUp = (event: KeyboardEvent) => {
    switch (event.code) {
      case "KeyW": case "ArrowUp": this.move.forward = false; break;
      case "KeyS": case "ArrowDown": this.move.back = false; break;
      case "KeyA": case "ArrowLeft": this.move.left = false; break;
      case "KeyD": case "ArrowRight": this.move.right = false; break;
      case "Space": this.move.up = false; break;
      case "ControlLeft": case "KeyC": this.move.down = false; break;
      case "ShiftLeft": case "ShiftRight": this.move.boost = false; break;
    }
  };
  private onWheel = (event: WheelEvent) => {
    if (!this.enabled || this.mode !== "fly") return;
    event.preventDefault();
    this.flySpeed = Math.min(FLY_SPEED.max, Math.max(FLY_SPEED.min, this.flySpeed * Math.exp(-event.deltaY * 0.001)));
  };
  private clearMovement(): void {
    for (const key of Object.keys(this.move) as Array<keyof typeof this.move>) this.move[key] = false;
    this.jumpQueued = false;
  }

  dispose() {
    this.disable();
    this.domElement.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    document.removeEventListener("pointerlockchange", this.onPointerLockChange);
    document.removeEventListener("keydown", this.onKeyDown);
    document.removeEventListener("keyup", this.onKeyUp);
    this.domElement.removeEventListener("wheel", this.onWheel);
  }
}
