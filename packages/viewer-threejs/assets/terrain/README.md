# Navora terrain texture intake

The Phase 4 inspector currently generates deterministic, tileable calibration layers at runtime so
the standalone HTML remains self-contained. Production-authored replacements go in `source/` as
power-of-two PNG files using these suffixes:

- `_albedo.png`: sRGB color, converted with ETC1S;
- `_normal.png`, `_roughness.png`, `_height.png`, `_mask.png`: linear data, converted with UASTC.

Run `npm run textures:ktx2 -w @nevora/viewer-threejs`. The converter generates mipmaps and writes
KTX2 files to `public/terrain-ktx2/`. Keep albedo and data maps separate; never bake gameplay
resource placement into terrain material masks. Texture licenses and source provenance must be
recorded beside each authored set before check-in.
