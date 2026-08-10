// Stage 13 (docs/01 §13, docs/03 §5): naming.
// Portuguese/Iberian-maritime-inspired name generation for settlements and
// landmarks the bible doesn't already name. Canonical names (all 16 zone
// proper names) are never touched by this module — they're locked lore.
// This stage is deliberately optional: everything upstream produces valid
// output with name: null, per the bible's own "Working-Name Policy."

import type { Rng } from "../seed/index.js";

const ROOTS = [
  "Alv", "Brav", "Velam", "Corv", "Estrel", "Montev", "Serr", "Vale", "Font",
  "Riv", "Verm", "Sol", "Vidr", "Alta", "Fend", "Lume", "Mour", "Cav", "Azur",
  "Douran", "Reed", "Prata", "Noite", "Bruma",
];
const MID_LINKERS = ["", "a", "e", "o", "an", "in"];
const SUFFIXES_TOWN = ["ora", "eira", "ela", "ura", "ança", "vado", "amar", "in"];
const SUFFIXES_FEATURE = ["ora Point", "eira Head", " Bluff", " Landing", " Reach", " Hollow", " Crossing"];

export function generateSettlementName(rng: Rng): string {
  const root = rng.pick(ROOTS);
  const linker = rng.pick(MID_LINKERS);
  const suffix = rng.pick(SUFFIXES_TOWN);
  return capitalize(`${root}${linker}${suffix}`);
}

export function generateLandmarkName(rng: Rng): string {
  const root = rng.pick(ROOTS);
  const suffix = rng.pick(SUFFIXES_FEATURE);
  return capitalize(`${root}${suffix}`);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
