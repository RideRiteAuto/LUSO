import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CAPSULE_SETTINGS, stepCapsule, type CapsuleState } from "./traversalPhysics.js";

function simulate(rate: number, seconds: number, input: (time: number) => { moveX: number; moveZ: number; sprint: boolean; jump: boolean; descend: boolean }, ground = (_x: number, _z: number) => 0) {
  const state: CapsuleState = { x: 0, z: 0, feetY: 0, velocityX: 0, velocityY: 0, velocityZ: 0, state: "grounded" };
  let peak = 0;
  for (let frame = 0; frame < rate * seconds; frame++) {
    stepCapsule(state, input(frame / rate), 1 / rate, ground);
    peak = Math.max(peak, state.feetY);
  }
  return { ...state, peak };
}

test("inspector sprint distance stays stable at 30, 60, and 144 Hz", () => {
  const results = [30, 60, 144].map((rate) => simulate(rate, 5, () => ({ moveX: 1, moveZ: 0, sprint: true, jump: false, descend: false })));
  assert.ok(Math.max(...results.map((r) => r.x)) - Math.min(...results.map((r) => r.x)) < 0.12);
  assert.ok(results.every((result) => result.x > 152 && result.x < 154));
});

test("jump arc lands consistently at 30, 60, and 144 Hz", () => {
  const results = [30, 60, 144].map((rate) => simulate(rate, 2, (time) => ({ moveX: 0, moveZ: 0, sprint: false, jump: time < 1 / rate, descend: false })));
  assert.ok(results.every((result) => result.state === "grounded" && result.feetY === 0));
  assert.ok(Math.max(...results.map((r) => r.peak)) - Math.min(...results.map((r) => r.peak)) < 0.2);
});

test("capsule refuses a slope above the configured limit", () => {
  const result = simulate(60, 2, () => ({ moveX: 1, moveZ: 0, sprint: false, jump: false, descend: false }), (x) => x * 2);
  assert.ok(result.x < 0.1);
});

test("deep water enters swim state and keeps the capsule near the surface", () => {
  const state: CapsuleState = { x: 0, z: 0, feetY: -2, velocityX: 0, velocityY: 0, velocityZ: 0, state: "grounded" };
  for (let i = 0; i < 240; i++) stepCapsule(state, { moveX: 0, moveZ: 1, sprint: false, jump: false, descend: false }, 1 / 60, () => -4, DEFAULT_CAPSULE_SETTINGS);
  assert.equal(state.state, "swimming");
  assert.ok(state.feetY > -1.4 && state.feetY < -0.9);
});

test("swimming follows a queried wave surface and receives river current", () => {
  const state: CapsuleState = { x: 0, z: 0, feetY: -1, velocityX: 0, velocityY: 0, velocityZ: 0, state: "swimming" };
  stepCapsule(state, { moveX: 0, moveZ: 0, sprint: false, jump: false, descend: false }, 1 / 60, () => -4, DEFAULT_CAPSULE_SETTINGS, () => ({ surfaceY: 1.5, velocityX: 1.2, velocityZ: -0.4 }));
  assert.equal(state.state, "swimming");
  assert.ok(state.velocityX > 0);
  assert.ok(state.velocityZ < 0);
  assert.ok(state.velocityY > 0);
});
