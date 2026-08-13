# Review A revision evidence — seed 48291

Review A was rejected after the first evidence pass. These five WebGPU
compatibility captures revisit the exact recorded world coordinates from the
rejection screenshots after the river-channel and terrain-material rebuild.
Phase 5 remains blocked until this revision is explicitly approved.

| Artifact | Recorded position | Revision check |
| --- | ---: | --- |
| [Wide river valley](01-river-wide-revised.png) | 39,236, 26,183 | One connected water network, wider navigable trunk, carved banks, no stacked blue source-to-mouth ribbons. |
| [River channel](02-river-valley-revised.png) | 40,128, 25,231 | Single descending channel, transparent water surface over an authored bed, no repeated slope texture. |
| [Estuary](03-estuary-revised.png) | 42,424, 11,219 | River-to-ocean transition without the former square/triangular water flaps. |
| [Mountain material](04-mountain-material-revised.png) | 31,618, 45,038 | Physical scan detail is distance-gated; no dot-grid or tiled weave across slopes. |
| [High aerial material](05-aerial-material-revised.png) | 167,930, 22,765 | Fragment-sampled compiler controls, feathered zone recipes, and terrain skirts remove the former kilometre-scale blocks, repeated patterns, and blue LOD cracks. |
| [Ocean horizon](06-ocean-horizon-revised.png) | 90,000, 35,000 at 20 km altitude | Camera-relative ocean coverage continues beyond the fully fogged flight horizon; no plane edge or blue-square corner is visible. |

The URLs can reproduce any recorded camera with `reviewX`, `reviewY`,
`reviewZ`, `reviewYaw`, and `reviewPitch` query parameters. This turns the
screenshots into repeatable regression views rather than one-off captures.
