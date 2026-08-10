// Continent placement -- reads manifest.json's continentLayout rather than
// guessing. There used to be a hardcoded 1.4x-tileSize offset here, which
// produced a sea gap smaller than either continent (reads as a strait, not
// "two large continents separated by an ocean" per the master prompt) --
// data/design/continents.json is now the single source of truth for this,
// and manifest.json is just carrying its numbers through (docs/01 §5).

import type { Manifest } from "./worldData.js";

export function continentOriginX(continent: string, manifest: Manifest): number {
  return manifest.continentLayout[continent]?.worldOffset[0] ?? 0;
}

export function continentOriginZ(continent: string, manifest: Manifest): number {
  return manifest.continentLayout[continent]?.worldOffset[1] ?? 0;
}

export function uvToWorld(u: number, v: number, continent: string, manifest: Manifest): [number, number] {
  const tileSize = manifest.worldScale.continentTileSize;
  return [continentOriginX(continent, manifest) + u * tileSize, continentOriginZ(continent, manifest) + v * tileSize];
}
