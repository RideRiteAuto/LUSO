# Navora terrain texture intake

The visual-quality correction pass uses reviewed CC0 Poly Haven PBR sets plus
ambientCG Grass001 for the greener meadow-floor layer. Run
`npm run textures:download -w @nevora/viewer-threejs -- --2k` to reproduce the source intake and
its checksummed `PROVENANCE.json`, then run `npm run textures:ktx2 -w @nevora/viewer-threejs`.

- `_albedo_2k.jpg`: sRGB color, converted with high-quality ETC1S;
- `_normal_2k.jpg`: linear OpenGL normal, converted with UASTC and renormalized mipmaps;
- `_roughness_2k.jpg`: linear scalar data, converted with high-quality ETC1S.

The converter writes KTX2 files to `public/terrain-ktx2/` and copies Three.js's official Basis WASM
transcoder to `public/basis/`. Keep albedo and data maps separate; never bake gameplay-resource
placement into terrain material masks.

The runtime uses warped, dual-scale planar projection for horizontal ground and
reserves triplanar projection for exposed rock faces. This breaks up obvious
repetition while keeping the browser shader within its texture-sampling budget.
