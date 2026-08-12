import * as THREE from "three/webgpu";

// Free camera movement, in two modes:
//  - "fly": unconstrained 3D movement at high speed, for scouting the whole
//    world quickly.
//  - "walk": grounded at human eye height, human walking/running pace, so
//    Kevin can actually judge world scale by standing in it -- this is the
//    direct answer to "I need a way to walk around at normal size."
// Both share drag-to-look (not the Pointer Lock API -- this viewer is also
// published as a claude.ai artifact, and Pointer Lock is commonly blocked
// inside sandboxed iframes with no way to grant it from here).

export type MovementMode = "fly" | "walk";

const LOOK_SENSITIVITY = 0.0025;
const MAX_PITCH = Math.PI / 2 - 0.02;
const EYE_HEIGHT_M = 1.7; // average human eye height, standing

const MODE_SPEED: Record<MovementMode, { base: number; min: number; max: number; boost: number }> = {
  // Deliberately not realistic -- this is a scouting camera, not a physical
  // vehicle. Crossing the ~131km world in well under a minute is the point.
  // (Previously max:200000 * boost:5 = up to 1,000,000 m/s -- fast enough to
  // fly clean off the rendered world in a couple of seconds, which is
  // exactly what happened during a scale-verification pass: full speed +
  // boost for 2.5s covered ~448km, ~3.4x the world's own width, landing the
  // camera far outside any geometry with nothing left to render. The
  // position clamp below is the real fix; these numbers are tuned down too
  // so a max-speed boosted run crosses the world in a few seconds, not a
  // single frame.)
  fly: { base: 4000, min: 200, max: 20000, boost: 4 },
  // Real human paces, now that world units are actually meters (docs/01 §5):
  // ~1.4 m/s walk, ~5x boost (Shift) for a light run.
  walk: { base: 1.4, min: 0.6, max: 8, boost: 5 },
};

export interface FlightControllerOptions {
  /** Ground/seabed height at an arbitrary world (x,z), used only in "walk" mode. */
  getGroundHeight: (worldX: number, worldZ: number) => number;
  /** Current camera-relative world origin. */
  getWorldOffset: () => { x: number; z: number };
  /** World extent, used to clamp the camera so fly mode can't outrun the rendered geometry (docs/01 §5). */
  worldBounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

export class FlightController {
  private mode: MovementMode = "fly";
  private speed = MODE_SPEED.fly.base;
  private readonly move = { forward: false, back: false, left: false, right: false, up: false, down: false, boost: false };
  private enabled = false;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private yaw = 0;
  private pitch = 0;
  private onExit: (() => void) | null = null;
  // Clamped to the ACTUAL rendered footprint (the seabed mesh spans exactly
  // worldBounds, not some padded region around it) -- a first attempt at
  // this padded 40% past the edge on the theory that you'd want to pull back
  // and see the whole world from outside, but the seabed mesh doesn't extend
  // into that padding, so a boosted fly could still coast off the mesh into
  // a dead zone with nothing there to render (the exact bug this is fixing).
  // A tiny inset keeps the camera a hair off the literal edge vertex.
  private readonly clampBounds: { minX: number; maxX: number; minZ: number; maxZ: number };

  constructor(private camera: THREE.PerspectiveCamera, private domElement: HTMLElement, private opts: FlightControllerOptions) {
    const b = opts.worldBounds;
    const insetX = (b.maxX - b.minX) * 0.01;
    const insetZ = (b.maxZ - b.minZ) * 0.01;
    this.clampBounds = { minX: b.minX + insetX, maxX: b.maxX - insetX, minZ: b.minZ + insetZ, maxZ: b.maxZ - insetZ };
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

  get currentMode(): MovementMode {
    return this.mode;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Seeds yaw/pitch from the camera's current orientation so entering a mode
   * doesn't snap the view. For "walk", also takes an explicit ground anchor
   * (x,z) to stand at -- the camera's raw current position is frequently
   * miles away in open ocean (e.g. right after the World overview), so
   * blindly dropping the eye height onto whatever's under the *camera*
   * rather than under a sensible point of interest left Walk mode standing
   * in the middle of nowhere with nothing in view.
   */
  enable(onExit: () => void, mode: MovementMode = "fly", walkAnchorWorld?: { x: number; z: number }) {
    this.enabled = true;
    this.mode = mode;
    this.speed = MODE_SPEED[mode].base;
    this.onExit = onExit;
    const euler = new THREE.Euler().setFromQuaternion(this.camera.quaternion, "YXZ");
    this.yaw = euler.y;
    this.pitch = mode === "walk" ? Math.max(-0.6, Math.min(0.6, euler.x)) : euler.x; // walking shouldn't start looking straight up/down
    if (mode === "walk") {
      const offset = this.opts.getWorldOffset();
      const x = walkAnchorWorld?.x ?? this.camera.position.x + offset.x;
      const z = walkAnchorWorld?.z ?? this.camera.position.z + offset.z;
      this.camera.position.set(x - offset.x, this.opts.getGroundHeight(x, z) + EYE_HEIGHT_M, z - offset.z);
      this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, "YXZ"));
    }
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
    const maxPitch = this.mode === "walk" ? MAX_PITCH * 0.85 : MAX_PITCH;
    this.pitch = Math.max(-maxPitch, Math.min(maxPitch, this.pitch - dy * LOOK_SENSITIVITY));
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
    const { min, max } = MODE_SPEED[this.mode];
    const factor = Math.exp(-e.deltaY * 0.001);
    this.speed = Math.min(max, Math.max(min, this.speed * factor));
  };

  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly worldUp = new THREE.Vector3(0, 1, 0);

  update(deltaSeconds: number) {
    if (!this.enabled) return;
    const { boost: boostMultiplier } = MODE_SPEED[this.mode];
    const effectiveSpeed = this.speed * (this.move.boost ? boostMultiplier : 1);
    const step = effectiveSpeed * deltaSeconds;

    this.camera.getWorldDirection(this.forward);
    this.right.crossVectors(this.forward, this.worldUp).normalize();

    if (this.mode === "walk") {
      // Movement is flattened to the ground plane -- looking up/down
      // shouldn't make you fly or burrow, it should just look up/down.
      const flatForward = new THREE.Vector3(this.forward.x, 0, this.forward.z).normalize();
      const flatRight = new THREE.Vector3(this.right.x, 0, this.right.z).normalize();
      const delta = new THREE.Vector3();
      if (this.move.forward) delta.addScaledVector(flatForward, step);
      if (this.move.back) delta.addScaledVector(flatForward, -step);
      if (this.move.right) delta.addScaledVector(flatRight, step);
      if (this.move.left) delta.addScaledVector(flatRight, -step);
      const offset = this.opts.getWorldOffset();
      const worldX = Math.max(this.clampBounds.minX, Math.min(this.clampBounds.maxX, this.camera.position.x + offset.x + delta.x));
      const worldZ = Math.max(this.clampBounds.minZ, Math.min(this.clampBounds.maxZ, this.camera.position.z + offset.z + delta.z));
      this.camera.position.x = worldX - offset.x;
      this.camera.position.z = worldZ - offset.z;
      this.camera.position.y = this.opts.getGroundHeight(worldX, worldZ) + EYE_HEIGHT_M;
      return;
    }

    if (this.move.forward) this.camera.position.addScaledVector(this.forward, step);
    if (this.move.back) this.camera.position.addScaledVector(this.forward, -step);
    if (this.move.right) this.camera.position.addScaledVector(this.right, step);
    if (this.move.left) this.camera.position.addScaledVector(this.right, -step);
    if (this.move.up) this.camera.position.y += step;
    if (this.move.down) this.camera.position.y -= step;

    // Clamp so a max-speed boosted run bottoms out at the padded world edge
    // instead of sailing off into space with nothing left to render -- the
    // actual root cause of a blank "flew toward the mountains" screenshot
    // during scale verification (2.5s at old max*boost covered ~448km,
    // ~3.4x the world's own width).
    const offset = this.opts.getWorldOffset();
    const worldX = Math.max(this.clampBounds.minX, Math.min(this.clampBounds.maxX, this.camera.position.x + offset.x));
    const worldZ = Math.max(this.clampBounds.minZ, Math.min(this.clampBounds.maxZ, this.camera.position.z + offset.z));
    this.camera.position.x = worldX - offset.x;
    this.camera.position.z = worldZ - offset.z;

    // Floor collision: fly mode has no ground clamp on Y at all, so pointing
    // down and holding forward tunnels straight through the terrain mesh --
    // and since materials only render front faces, being embedded inside/
    // under the ground renders nothing (the other half of the same "flew
    // into a blank void" bug during scale verification: a modest downward
    // pitch held for ~1.5s was enough to dive underground). Clamping to a
    // small clearance above the real terrain lets you swoop low without
    // being able to clip through it.
    const floor = this.opts.getGroundHeight(worldX, worldZ) + 5;
    if (this.camera.position.y < floor) this.camera.position.y = floor;
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
