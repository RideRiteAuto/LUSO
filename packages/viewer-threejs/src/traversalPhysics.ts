export type LocomotionState = "grounded" | "airborne" | "wading" | "swimming";

export interface CapsuleState {
  x: number;
  z: number;
  feetY: number;
  velocityX: number;
  velocityY: number;
  velocityZ: number;
  state: LocomotionState;
}

export interface TraversalInput {
  moveX: number;
  moveZ: number;
  sprint: boolean;
  jump: boolean;
  descend: boolean;
}

export interface CapsuleSettings {
  walkSpeed: number;
  sprintSpeed: number;
  swimSpeed: number;
  groundAcceleration: number;
  sprintAcceleration: number;
  airAcceleration: number;
  friction: number;
  sprintFriction: number;
  gravity: number;
  jumpSpeed: number;
  maxSlopeDegrees: number;
  stepHeight: number;
  groundSnap: number;
  swimDepth: number;
  wadeDepth: number;
  waterHeight: number;
}

export const DEFAULT_CAPSULE_SETTINGS: CapsuleSettings = {
  walkSpeed: 3.4,
  // Walking stays at a believable human pace so scale review remains useful.
  // Sprint is deliberately an inspector traversal speed: this world is more
  // than 200 km wide, and a realistic jog made iteration between landmarks
  // needlessly slow. Gameplay tuning can supply a separate settings object.
  sprintSpeed: 32,
  swimSpeed: 2.6,
  groundAcceleration: 24,
  sprintAcceleration: 72,
  airAcceleration: 7,
  friction: 18,
  sprintFriction: 54,
  gravity: 24,
  jumpSpeed: 7.2,
  maxSlopeDegrees: 48,
  stepHeight: 0.45,
  groundSnap: 0.65,
  swimDepth: 1.25,
  wadeDepth: 0.15,
  waterHeight: 0,
};

function approach(current: number, target: number, maxDelta: number): number {
  if (current < target) return Math.min(target, current + maxDelta);
  return Math.max(target, current - maxDelta);
}

/** Frame-rate-independent kinematic capsule step over a continuous heightfield. */
export function stepCapsule(
  state: CapsuleState,
  input: TraversalInput,
  deltaSeconds: number,
  sampleGround: (x: number, z: number) => number,
  settings: CapsuleSettings = DEFAULT_CAPSULE_SETTINGS,
): CapsuleState {
  const dt = Math.min(0.05, Math.max(0, deltaSeconds));
  const groundBefore = sampleGround(state.x, state.z);
  const waterDepthBefore = settings.waterHeight - groundBefore;
  const swimming = waterDepthBefore > settings.swimDepth;
  const inputLength = Math.hypot(input.moveX, input.moveZ);
  const moveX = inputLength > 1 ? input.moveX / inputLength : input.moveX;
  const moveZ = inputLength > 1 ? input.moveZ / inputLength : input.moveZ;

  if (swimming) {
    const targetSpeed = settings.swimSpeed * (input.sprint ? 1.35 : 1);
    state.velocityX = approach(state.velocityX, moveX * targetSpeed, 8 * dt);
    state.velocityZ = approach(state.velocityZ, moveZ * targetSpeed, 8 * dt);
    const verticalInput = (input.jump ? 1 : 0) - (input.descend ? 1 : 0);
    const targetFeetY = settings.waterHeight - 1.15;
    state.velocityY = verticalInput !== 0
      ? approach(state.velocityY, verticalInput * settings.swimSpeed, 7 * dt)
      : approach(state.velocityY, (targetFeetY - state.feetY) * 2.5, 5 * dt);
    state.x += state.velocityX * dt;
    state.z += state.velocityZ * dt;
    state.feetY = Math.max(sampleGround(state.x, state.z), state.feetY + state.velocityY * dt);
    state.state = "swimming";
    return state;
  }

  const wading = waterDepthBefore > settings.wadeDepth;
  const maxSpeed = (input.sprint ? settings.sprintSpeed : settings.walkSpeed) * (wading ? 0.55 : 1);
  const acceleration = state.state === "airborne"
    ? settings.airAcceleration
    : input.sprint ? settings.sprintAcceleration : settings.groundAcceleration;
  const hasInput = inputLength > 0.001;
  const horizontalSpeed = Math.hypot(state.velocityX, state.velocityZ);
  const braking = horizontalSpeed > settings.walkSpeed + 0.1 ? settings.sprintFriction : settings.friction;
  const previousVelocityX = state.velocityX;
  const previousVelocityZ = state.velocityZ;
  state.velocityX = approach(state.velocityX, hasInput ? moveX * maxSpeed : 0, (hasInput ? acceleration : braking) * dt);
  state.velocityZ = approach(state.velocityZ, hasInput ? moveZ * maxSpeed : 0, (hasInput ? acceleration : braking) * dt);

  // Integrating the average of the previous and new velocity keeps rapid
  // inspector acceleration stable across low and high refresh rates.
  const candidateX = state.x + (previousVelocityX + state.velocityX) * 0.5 * dt;
  const candidateZ = state.z + (previousVelocityZ + state.velocityZ) * 0.5 * dt;
  const candidateGround = sampleGround(candidateX, candidateZ);
  const rise = candidateGround - groundBefore;
  const slopeProbe = 0.5;
  const gradientX = sampleGround(candidateX + slopeProbe, candidateZ) - sampleGround(candidateX - slopeProbe, candidateZ);
  const gradientZ = sampleGround(candidateX, candidateZ + slopeProbe) - sampleGround(candidateX, candidateZ - slopeProbe);
  const slopeDegrees = Math.atan(Math.hypot(gradientX, gradientZ) / (slopeProbe * 2)) * 180 / Math.PI;
  if (rise <= 0 || slopeDegrees <= settings.maxSlopeDegrees) {
    state.x = candidateX;
    state.z = candidateZ;
  } else {
    state.velocityX = 0;
    state.velocityZ = 0;
  }

  const ground = sampleGround(state.x, state.z);
  const grounded = state.state !== "airborne" && state.feetY - ground <= settings.groundSnap;
  if (grounded && input.jump && !wading) {
    state.velocityY = settings.jumpSpeed;
    state.state = "airborne";
  } else if (grounded) {
    state.velocityY = 0;
    state.feetY = ground;
    state.state = wading ? "wading" : "grounded";
  } else {
    state.velocityY -= settings.gravity * dt;
    state.feetY += state.velocityY * dt;
    if (state.feetY <= ground) {
      state.feetY = ground;
      state.velocityY = 0;
      state.state = settings.waterHeight - ground > settings.wadeDepth ? "wading" : "grounded";
    } else state.state = "airborne";
  }
  return state;
}
