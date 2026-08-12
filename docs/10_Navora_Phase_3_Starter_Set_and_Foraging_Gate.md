# Phase 3 Starter Set and Foraging Gate

Date: 2026-08-12  
Status: Birch and Stone implemented as review candidates; named Foraging expansion blocked by design authority.

## Implemented canon families

Phase 3 adds the two remaining locked Bible v11 starter families:

- **Birch Tree (Woodcutting 5):** three genuinely different statures with pale bark,
  charcoal lenticel bands, fine forked branches, and airy light-green crowns. Each has
  LOD0/1/2, grounded pivot, trunk capsule, and stable foliage-wind metadata.
- **Stone (Mining 1):** three cluster scales using weathered fieldstone forms, subdued
  mineral-free values, LOD0/1/2, grounded pivot, and convex collision metadata.

The Alvora review exhibit now contains 18 variants across Pine, Birch, Copper, Tin,
Stone, and provisional Redberry. The trees occupy the final shared row so Pine and
Birch can be compared directly for silhouette, crown density, bark value, and scale.

## Foraging design gate

Bible v11 locks common starter **categories**—fibers, herbs, mushrooms, berries,
food plants, and medicinal plants—but explicitly states that the complete Foraging
progression is not finalized. It does not authorize exact named item families, unlock
levels, region placement, processing recipes, or final visual signals.

Phase 3 therefore does not invent a canonical flax, herb, mushroom, or medicinal plant.
The provisional Redberry review family remains clearly labeled. To release the gate,
the design source of truth must approve at least:

1. item/resource ID and display name;
2. canon or provisional status;
3. starter unlock level and profession action;
4. Alvora/Fonteira availability and abundance relationship;
5. harvested output and major cooking/alchemy/tailoring dependencies;
6. recognizable real-world biological reference;
7. depleted/regrowth behavior and collision/interaction footprint.

Once approved, each family uses the same three-variant, three-LOD, manifest, collision,
review-yard, and performance gates as Redberry. Until then, the machine-readable design
catalog remains the authority and no placeholder name enters natural spawning.

## Technical counts

| Family | LOD0 | LOD1 | LOD2 | Materials |
|---|---:|---:|---:|---:|
| Birch small/standard/mature | 12,840 / 13,496 / 13,496 | 3,360 / 3,616 / 3,872 | 660 / 730 / 800 | 1 |
| Stone small/standard/mature | 2,560 each | 720 each | 160 each | 1 |

The exporter now produces 54 deterministic GLBs for six families. Final shared KTX2
material bake, wind shader animation, and natural zone placement remain gated behind
visual approval and the later runtime phase.
