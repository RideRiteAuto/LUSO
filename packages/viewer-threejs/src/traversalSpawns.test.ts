import test from "node:test";
import assert from "node:assert/strict";
import { buildTraversalBookmarks, findSafeTraversalPoint, findZoneShoreBookmark } from "./traversalSpawns.js";

test("safe traversal selection rejects water and steep terrain", () => {
  const sample = (x: number, z: number) => x < 50 ? -2 : 12 + Math.sin(z * 0.001);
  const point = findSafeTraversalPoint(sample, 0, 0, 500);
  assert.ok(point.x >= 50);
  assert.ok(sample(point.x, point.z) > 3);
});

test("resource review yard is deterministic and adjacent to Alvora", () => {
  const sample = (x: number, z: number) => 20 + Math.sin(x * 0.001) + Math.cos(z * 0.001);
  const world = {
    manifest: { worldScale: { continentTileSize: 1000 }, continentLayout: { valora: { worldOffset: [0, 0] } } },
    zones: [{ id: "alvora", properName: "Alvora", descriptor: "The Crownlands", continent: "valora", boundary: [[0.2, 0.2], [0.4, 0.2], [0.4, 0.4], [0.2, 0.4]] }],
  } as Parameters<typeof buildTraversalBookmarks>[0];
  const first = buildTraversalBookmarks(world, sample);
  const second = buildTraversalBookmarks(world, sample);
  const alvora = first.find((bookmark) => bookmark.id === "alvora")!;
  const review = first.find((bookmark) => bookmark.id === "alvora-resource-review")!;
  assert.deepEqual(first, second);
  assert.ok(review.label.includes("Resource Review Yard"));
  assert.ok(Math.hypot(review.x - alvora.x, review.z - alvora.z) < 500);
});

test("shore bookmark selects low, flat, compiler-authored zone coastline", () => {
  const width = 4;
  const heightData = new Float32Array([
    -2, -1, -1, -2,
    -1, 6, 7, -1,
    -1, 8, 12, -1,
    -2, -1, -1, -2,
  ]);
  const habitat = new Uint8Array(width * width * 4);
  const hydrology = new Uint8Array(width * width * 4);
  for (let i = 0; i < width * width; i++) {
    habitat[i * 4 + 3] = heightData[i] > 0 ? 16 : 0;
    hydrology[i * 4 + 2] = heightData[i] > 0 ? 230 : 255;
    hydrology[i * 4 + 3] = 8;
  }
  const world = {
    manifest: { worldScale: { continentTileSize: 1000 }, continentLayout: { valora: { worldOffset: [0, 0] } } },
    zones: [{ id: "alvora", properName: "Alvora", descriptor: "The Crownlands", continent: "valora", boundary: [[0, 0], [1, 0], [1, 1]] }],
    controlFields: { packs: [
      { id: "hydrology", channels: [{}, {}, {}, {}] },
      { id: "habitat", channels: [{}, {}, {}, { max: 16, labels: ["ocean-unclaimed", "alvora"] }] },
    ] },
    continents: { valora: { controlWidth: width, controlHeight: width, controlPacks: [hydrology, habitat], heightData } },
  } as unknown as Parameters<typeof findZoneShoreBookmark>[0];
  const bookmark = findZoneShoreBookmark(world, "alvora")!;
  assert.ok(bookmark.label.includes("Starter Beach"));
  assert.ok(bookmark.x > 0 && bookmark.x < 1000 && bookmark.z > 0 && bookmark.z < 1000);
});
