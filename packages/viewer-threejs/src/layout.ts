// v1 continent placement, per docs/02's noted UV->world-unit gap: Valora
// (west) and Seradia (east) are laid out side by side with a gap between
// their tiles standing in for the Luna Sea. This is viewer-side only -- the
// generator itself still emits continent-local normalized UV coordinates
// (docs/02 "v1 implementation note").

export function continentOriginX(continent: string, tileSize: number): number {
  return continent === "seradia" ? tileSize * 1.4 : 0;
}

export function uvToWorld(u: number, v: number, continent: string, tileSize: number): [number, number] {
  const originX = continentOriginX(continent, tileSize);
  return [originX + u * tileSize, v * tileSize];
}
