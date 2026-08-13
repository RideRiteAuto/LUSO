import test from "node:test";
import assert from "node:assert/strict";
import { riverWidthAt, sampleRiverCarvedHeight, scenicRiverDepthM, SEGMENT_KIND_SCENIC, SEGMENT_KIND_WATERWAY, type RiverChannelField } from "./riverChannelField.js";

// One 100 m scenic segment: surface rises 9 -> 10 m, width 40 m, depth 3.4 m,
// bank width 28 m — creek-to-trunk scale, not shipping scale.
const scenicField: RiverChannelField = {
  segments: new Float32Array([0, 0, 100, 0, 9, 10, 40, 40, 3.4, 3.4, SEGMENT_KIND_SCENIC, 28]),
  offsets: new Uint32Array([0, 1]),
  indices: new Uint32Array([0]),
  minX: -256,
  minZ: -256,
  gridWidth: 1,
  gridHeight: 1,
  cellSize: 512,
};

test("scenic brush digs a bed below the water surface", () => {
  const waterSurface = 9.5;
  const center = sampleRiverCarvedHeight(scenicField, 50, 0, 50);
  assert.ok(Math.abs(center - (waterSurface - 3.4)) < 1e-6, `bed ${center} is not surface - depth`);

  const channelEdge = sampleRiverCarvedHeight(scenicField, 50, 19, 50);
  assert.ok(channelEdge > center, "waterline shelf should be shallower than mid-channel");
  assert.ok(channelEdge < waterSurface, "waterline shelf must stay submerged");
});

test("scenic brush raises a freeboard levee where the bank is below the water", () => {
  // Ground at 4 m sits well below the 9.5 m water surface. The old
  // carve-only brush left this bank hanging; now it must rise above the
  // surface so the water is contained.
  const waterSurface = 9.5;
  const lowBank = sampleRiverCarvedHeight(scenicField, 50, 26, 4);
  assert.ok(lowBank > waterSurface, `bank ${lowBank} does not contain the ${waterSurface} m water surface`);

  // A bank already higher than the levee crest is left alone.
  const highBank = sampleRiverCarvedHeight(scenicField, 50, 40, 60);
  assert.equal(highBank, 60);

  // Ocean cells are never raised into a dam.
  const oceanCell = sampleRiverCarvedHeight(scenicField, 50, 26, -3);
  assert.ok(oceanCell <= -3 + 1e-6);
});

test("brush leaves terrain outside its reach unchanged", () => {
  assert.equal(sampleRiverCarvedHeight(scenicField, 50, 400, 50), 50);
  assert.equal(sampleRiverCarvedHeight(scenicField, 800, 0, 50), 50);
});

// One 200 m waterway segment: 120 m surface width, 11 m bed, 90 m banks —
// a sea-level trade channel the global ocean fills.
const waterwayField: RiverChannelField = {
  segments: new Float32Array([0, 0, 200, 0, 0, 0, 120, 120, 11, 11, SEGMENT_KIND_WATERWAY, 90]),
  offsets: new Uint32Array([0, 1]),
  indices: new Uint32Array([0]),
  minX: -1024,
  minZ: -1024,
  gridWidth: 1,
  gridHeight: 1,
  cellSize: 2048,
};

test("waterway brush carves a below-sea-level channel through land", () => {
  const bed = sampleRiverCarvedHeight(waterwayField, 100, 0, 25);
  assert.ok(Math.abs(bed - -11) < 1e-6, `channel bed ${bed} is not the authored -11 m`);

  const waterline = sampleRiverCarvedHeight(waterwayField, 100, 60, 25);
  assert.ok(waterline <= -2, `channel edge ${waterline} would beach a hull`);

  const bank = sampleRiverCarvedHeight(waterwayField, 100, 100, 25);
  assert.ok(bank > waterline && bank < 25, "bank should climb from the waterline toward natural terrain");

  // Existing deeper water is never shallowed.
  const bay = sampleRiverCarvedHeight(waterwayField, 100, 0, -30);
  assert.equal(bay, -30);
});

test("river widths come from the exported per-point profile", () => {
  const river = {
    id: "test-river",
    path: [[0, 0], [0.5, 0.5], [1, 1]] as [number, number][],
    terminatesIn: { type: "ocean" as const, featureId: "luna-sea" },
    mouthKind: "estuary" as const,
    widthProfileM: [12, 20, 44],
    profile: { widthM: [12, 44] as [number, number], depthM: [1.4, 4.2] as [number, number], currentMps: [1.6, 0.45] as [number, number], navigableFromT: 1 },
  };
  assert.equal(riverWidthAt(river, 0), 12);
  assert.equal(riverWidthAt(river, 1), 44);
  assert.ok(Math.abs(riverWidthAt(river, 0.5) - 20) < 1e-6, "mid-course width should read the profile array");
  assert.ok(scenicRiverDepthM(44) < 5, "scenic depth stays swimmable, not shipping draft");
});
