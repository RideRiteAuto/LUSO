// Deterministic PRNG + named sub-streams.
// No pipeline stage may call Math.random() or read wall-clock time — every
// source of randomness must come from a Rng handed down from here.

/** mulberry32 — small, fast, good-enough statistical quality for terrain generation. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a string hash, used to derive stable per-stage sub-seeds from the master seed. */
function fnv1a(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export type StageName =
  | "elevation"
  | "hydrology"
  | "climate"
  | "biomes"
  | "resources"
  | "settlements"
  | "roads"
  | "naming"
  | "ecology";

export class Rng {
  private readonly next: () => number;

  constructor(seed: number) {
    this.next = mulberry32(seed);
  }

  /** Uniform float in [0, 1). */
  float(): number {
    return this.next();
  }

  /** Uniform float in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Uniform integer in [min, max]. */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(0, items.length - 1)];
  }
}

export class SeedRegistry {
  constructor(private readonly masterSeed: number) {}

  /** Deterministic per-stage sub-seed derived from the master seed + stage name. */
  subSeed(stage: StageName, salt = ""): number {
    return fnv1a(`${this.masterSeed}:${stage}:${salt}`);
  }

  rngFor(stage: StageName, salt = ""): Rng {
    return new Rng(this.subSeed(stage, salt));
  }
}
