// Stage 11 (docs/01 §11): roads & trade routes.
// v1: a minimum spanning tree over settlement anchors (Euclidean cost),
// which guarantees every settlement is connected without redundant routes.
// Paths are straight lines for now — true least-cost pathing over the
// heightmap (penalizing slope and unbridged river crossings) is documented
// as the next step in docs/01 §3 stage 11 and is a good follow-up once the
// visual pass confirms the network's topology is right.

import type { ContinentId, Road, SettlementAnchor, Vec2 } from "../types/index.js";

function dist2(a: Vec2, b: Vec2): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

export function generateRoads(anchors: SettlementAnchor[], continent: ContinentId): Road[] {
  const nodes = anchors.filter((a) => a.tier <= 3); // skip the most minor anchors to avoid a tangled network
  if (nodes.length < 2) return [];

  const inTree = new Set<number>([0]);
  const roads: Road[] = [];

  while (inTree.size < nodes.length) {
    let bestFrom = -1;
    let bestTo = -1;
    let bestDist = Infinity;

    for (const i of inTree) {
      for (let j = 0; j < nodes.length; j++) {
        if (inTree.has(j)) continue;
        const d = dist2(nodes[i].position, nodes[j].position);
        if (d < bestDist) {
          bestDist = d;
          bestFrom = i;
          bestTo = j;
        }
      }
    }

    if (bestTo < 0) break;
    inTree.add(bestTo);

    const a = nodes[bestFrom];
    const b = nodes[bestTo];
    roads.push({
      id: `${continent}-road-${roads.length}`,
      kind: a.tier <= 2 && b.tier <= 2 ? "road" : "trail",
      path: [a.position, b.position],
      connects: [a.id, b.id],
    });
  }

  return roads;
}
