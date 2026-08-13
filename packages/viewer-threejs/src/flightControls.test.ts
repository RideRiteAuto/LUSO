import test from "node:test";
import assert from "node:assert/strict";
import { WALK_ENTRY_PITCH_RAD, WALK_EYE_HEIGHT_M } from "./flightControls.js";

test("walk camera starts at adult eye height with a near-horizontal gaze", () => {
  assert.ok(WALK_EYE_HEIGHT_M >= 1.75 && WALK_EYE_HEIGHT_M <= 1.85);
  assert.ok(Math.abs(WALK_ENTRY_PITCH_RAD) <= THREE_DEGREES_RAD);
});

const THREE_DEGREES_RAD = Math.PI / 60;
