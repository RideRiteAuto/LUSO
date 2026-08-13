import test from "node:test";
import assert from "node:assert/strict";
import { resolveWalkTransitionAnchor, shouldToggleInspector, WALK_ENTRY_PITCH_RAD, WALK_EYE_HEIGHT_M } from "./flightControls.js";

test("walk camera starts at adult eye height with a near-horizontal gaze", () => {
  assert.ok(WALK_EYE_HEIGHT_M >= 1.75 && WALK_EYE_HEIGHT_M <= 1.85);
  assert.ok(Math.abs(WALK_ENTRY_PITCH_RAD) <= THREE_DEGREES_RAD);
});

const THREE_DEGREES_RAD = Math.PI / 60;

test("direct Fly to Walk transition preserves the exact horizontal coordinate", () => {
  let safetySearches = 0;
  const anchor = resolveWalkTransitionAnchor(
    true,
    { x: 42_505.25, z: 10_908.75 },
    { x: 50_000, z: 40_000 },
    () => { safetySearches++; return { x: 1, z: 2 }; },
  );
  assert.deepEqual(anchor, { x: 42_505.25, z: 10_908.75 });
  assert.equal(safetySearches, 0);
});

test("entering Walk from orbit still resolves a safe player coordinate", () => {
  const anchor = resolveWalkTransitionAnchor(
    false,
    { x: 90_000, z: 80_000 },
    { x: 42_000, z: 11_000 },
    (target) => ({ x: target.x + 12, z: target.z - 8 }),
  );
  assert.deepEqual(anchor, { x: 42_012, z: 10_992 });
});

test("Tab consistently toggles the inspector from world and panel focus", () => {
  const world = { closest: () => null } as unknown as EventTarget;
  const control = { closest: (selector: string) => selector === "#hud" ? {} : null } as unknown as EventTarget;
  assert.equal(shouldToggleInspector({ code: "Tab", target: world }), true);
  assert.equal(shouldToggleInspector({ code: "Tab", target: control }), true);
  assert.equal(shouldToggleInspector({ code: "KeyW", target: world }), false);
});
