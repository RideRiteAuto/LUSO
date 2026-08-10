// Biome ID <-> palette index <-> RGB, versioned per docs/02_Nevora_World_Data_Schema.md §9.
// Order matters: index in this array IS the value written into biome_map.png.

export interface BiomeDef {
  id: string;
  color: [number, number, number];
  elevationM: [number, number];
  moisture: [number, number];
  temperatureC: [number, number];
}

export const BIOMES: BiomeDef[] = [
  { id: "ocean", color: [24, 60, 110], elevationM: [-100000, 0], moisture: [0, 1], temperatureC: [-100, 100] },
  { id: "beach", color: [227, 214, 168], elevationM: [0, 5], moisture: [0, 1], temperatureC: [-100, 100] },
  { id: "coastal-plain", color: [140, 196, 104], elevationM: [5, 60], moisture: [0.4, 1], temperatureC: [8, 100] },
  { id: "floodplain", color: [110, 176, 96], elevationM: [0, 30], moisture: [0.6, 1], temperatureC: [8, 100] },
  { id: "wetland-marsh", color: [86, 122, 90], elevationM: [0, 20], moisture: [0.75, 1], temperatureC: [8, 100] },
  { id: "grassland-steppe", color: [186, 172, 96], elevationM: [100, 400], moisture: [0.15, 0.5], temperatureC: [5, 100] },
  { id: "temperate-woodland", color: [76, 140, 74], elevationM: [20, 300], moisture: [0.35, 0.75], temperatureC: [8, 100] },
  { id: "river-valley-forest", color: [64, 128, 70], elevationM: [100, 500], moisture: [0.4, 0.8], temperatureC: [0, 100] },
  { id: "wooded-highland", color: [90, 130, 88], elevationM: [300, 800], moisture: [0.35, 0.75], temperatureC: [-5, 100] },
  { id: "rugged-foothill", color: [122, 116, 104], elevationM: [400, 900], moisture: [0.2, 0.6], temperatureC: [-10, 100] },
  { id: "mountain-forest", color: [58, 100, 66], elevationM: [500, 1200], moisture: [0.35, 0.75], temperatureC: [-10, 100] },
  { id: "sea-cliff-coastal", color: [150, 140, 128], elevationM: [0, 300], moisture: [0.3, 0.7], temperatureC: [0, 100] },
  { id: "deep-forest-mineral", color: [58, 132, 130], elevationM: [300, 900], moisture: [0.5, 1], temperatureC: [-10, 100] },
  { id: "great-lakes-country", color: [98, 150, 158], elevationM: [100, 500], moisture: [0.5, 1], temperatureC: [-10, 100] },
  { id: "ancient-highland-tableland", color: [150, 140, 110], elevationM: [800, 1600], moisture: [0.15, 0.55], temperatureC: [-20, 100] },
  { id: "high-plateau-grassland", color: [168, 164, 108], elevationM: [900, 1700], moisture: [0.1, 0.5], temperatureC: [-20, 100] },
  { id: "alpine-extreme", color: [180, 190, 198], elevationM: [1600, 100000], moisture: [0, 1], temperatureC: [-100, 8] },
  { id: "canyon-mesa-frontier", color: [176, 108, 80], elevationM: [400, 1200], moisture: [0, 0.25], temperatureC: [-20, 100] },
  { id: "luminous-basin", color: [72, 214, 168], elevationM: [150, 700], moisture: [0.4, 1], temperatureC: [-20, 100] },
  { id: "alpine-snow-rock", color: [235, 240, 245], elevationM: [1800, 100000], moisture: [0, 1], temperatureC: [-100, 100] },
];

export const BIOME_INDEX: Record<string, number> = Object.fromEntries(BIOMES.map((b, i) => [b.id, i]));
