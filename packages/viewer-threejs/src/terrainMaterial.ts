import * as THREE from "three/webgpu";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import {
  attribute,
  cameraPosition,
  color,
  float,
  mix,
  mx_noise_float,
  mx_noise_vec3,
  normalMap,
  normalWorld,
  positionWorld,
  smoothstep,
  texture,
  triplanarTexture,
  uniform,
  vec2,
  vec3,
  vertexColor,
} from "three/tsl";

export type TerrainMaterialDebugMode =
  | "final" | "biome" | "height" | "temperature" | "rainfall" | "moisture" | "wetness"
  | "drainage" | "distanceWater" | "slope" | "shore" | "soil" | "geology"
  | "exposure" | "scree" | "buildability" | "vegetation" | "resource" | "macro";
export type TerrainQuality = "high" | "balanced" | "compatibility";

type TerrainLayer = "sand" | "grass" | "soil" | "forest" | "rock" | "scree" | "snow";
type TerrainChannel = "albedo" | "normal" | "roughness";
type TerrainTextureSet = Record<TerrainLayer, Partial<Record<TerrainChannel, THREE.Texture>>>;

type EmbeddedTerrainAssets = Partial<Record<TerrainLayer, Partial<Record<TerrainChannel, string>>>>;

const LAYERS: TerrainLayer[] = ["sand", "grass", "soil", "forest", "rock", "scree", "snow"];
const NORMAL_LAYERS = new Set<TerrainLayer>(["sand", "grass", "soil", "rock", "snow"]);
const ROUGHNESS_LAYERS = new Set<TerrainLayer>(["sand", "grass", "rock"]);

function configureTexture(map: THREE.Texture, channel: TerrainChannel, anisotropy: number): THREE.Texture {
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = channel === "albedo" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  map.anisotropy = anisotropy;
  map.needsUpdate = true;
  return map;
}

async function loadTerrainTextures(renderer: THREE.WebGPURenderer, quality: TerrainQuality): Promise<TerrainTextureSet> {
  const anisotropy = quality === "high" ? 16 : quality === "balanced" ? 8 : 4;
  const embedded = (globalThis as unknown as { __NEVORA_TERRAIN_ASSETS__?: EmbeddedTerrainAssets }).__NEVORA_TERRAIN_ASSETS__;
  const result = Object.fromEntries(LAYERS.map((layer) => [layer, {}])) as TerrainTextureSet;
  const channelsFor = (layer: TerrainLayer): TerrainChannel[] => {
    const channels: TerrainChannel[] = ["albedo"];
    if (quality !== "compatibility" && NORMAL_LAYERS.has(layer)) channels.push("normal");
    if (quality !== "compatibility" && ROUGHNESS_LAYERS.has(layer)) channels.push("roughness");
    return channels;
  };

  if (embedded) {
    const loader = new THREE.TextureLoader();
    await Promise.all(LAYERS.flatMap((layer) => channelsFor(layer).map(async (channel) => {
      const uri = embedded[layer]?.[channel];
      if (!uri) throw new Error(`Embedded terrain texture is missing: ${layer}/${channel}`);
      result[layer][channel] = configureTexture(await loader.loadAsync(uri), channel, anisotropy);
    })));
    return result;
  }

  const loader = new KTX2Loader().setTranscoderPath(new URL("basis/", document.baseURI).href).detectSupport(renderer);
  try {
    await Promise.all(LAYERS.flatMap((layer) => channelsFor(layer).map(async (channel) => {
      const uri = new URL(`terrain-ktx2/${layer}_${channel}.ktx2?v=terrain-green-2`, document.baseURI).href;
      result[layer][channel] = configureTexture(await loader.loadAsync(uri), channel, anisotropy);
    })));
  } finally {
    loader.dispose();
  }
  return result;
}

export class AlvoraTerrainMaterial {
  readonly material: THREE.MeshStandardNodeMaterial;
  private readonly originNode = uniform(new THREE.Vector3());
  private readonly debugNodes = new Map<TerrainMaterialDebugMode, any>();
  private readonly textures: THREE.Texture[];
  private debugMode: TerrainMaterialDebugMode = "final";

  static async create(renderer: THREE.WebGPURenderer, quality: TerrainQuality): Promise<AlvoraTerrainMaterial> {
    return new AlvoraTerrainMaterial(await loadTerrainTextures(renderer, quality), quality);
  }

  private constructor(layers: TerrainTextureSet, quality: TerrainQuality) {
    this.textures = LAYERS.flatMap((layer) => Object.values(layers[layer])).filter((map): map is THREE.Texture => Boolean(map));
    const worldPosition = positionWorld.add(this.originNode);
    const biome = vertexColor();
    const height = worldPosition.y;
    const controlClimate: any = attribute("controlClimate", "vec4");
    const controlHydrology: any = attribute("controlHydrology", "vec4");
    const controlTerrain: any = attribute("controlTerrain", "vec4");
    const controlEcology: any = attribute("controlEcology", "vec4");
    const controlResources: any = attribute("controlResources", "vec4");
    const controlHabitat: any = attribute("controlHabitat", "vec4");
    const temperature = controlClimate.r;
    const rainfall = controlClimate.g;
    const moisture = controlClimate.b;
    const wetness = controlClimate.a;
    const drainage = controlHydrology.r;
    const distanceWater = controlHydrology.g;
    const shoreInfluence = controlHydrology.b;
    // The packed field stores 0..60 degrees. Convert it to the previous
    // 1-cos(theta) metric so existing physically meaningful thresholds stay
    // readable while their source becomes compiler-authoritative.
    const slope = controlHydrology.a.mul(Math.PI / 3).cos().oneMinus();
    const soilClass = controlTerrain.r;
    const geologyClass = controlTerrain.g;
    const exposure = controlTerrain.b;
    const screeTendency = controlTerrain.a;
    const buildability = controlEcology.r;
    const vegetationEligibility = controlEcology.g;
    const resourceEligibility = controlHabitat.b.max(controlResources.r.max(controlResources.g).max(controlResources.b).max(controlResources.a));
    const viewDistance = cameraPosition.sub(positionWorld).length();
    const microVisibility = smoothstep(180, 900, viewDistance).oneMinus();
    const landTransition = smoothstep(-3, 5, height);
    const macro = mx_noise_float(worldPosition.xz.mul(0.00042)).mul(0.5).add(0.5);
    const fineMacro = mx_noise_float(worldPosition.xz.mul(0.0021).add(vec2(31.7, -14.2))).mul(0.5).add(0.5);
    // High keeps independent stochastic fields and spatial warping. Balanced
    // reuses its two macro fields, cutting five expensive procedural-noise
    // evaluations per terrain fragment while preserving large-scale breakup.
    const regionalGreen = quality === "high"
      ? smoothstep(0.12, 0.88, mx_noise_float(worldPosition.xz.mul(0.0018).add(vec2(-83.1, 47.6))).mul(0.5).add(0.5))
      : smoothstep(0.1, 0.9, macro);
    const localPatch = quality === "high"
      ? smoothstep(0.18, 0.82, mx_noise_float(worldPosition.xz.mul(0.011).add(vec2(19.4, 91.7))).mul(0.5).add(0.5))
      : smoothstep(0.14, 0.86, fineMacro);
    const groundMottle = quality === "high"
      ? smoothstep(0.46, 0.84, mx_noise_float(worldPosition.xz.mul(0.027).add(vec2(-27.8, 64.3))).mul(0.5).add(0.5))
      : smoothstep(0.5, 0.86, fineMacro);
    const warpedPosition = quality === "high"
      ? worldPosition
        .add(mx_noise_vec3(worldPosition.mul(0.018).add(vec3(17.3, -41.8, 73.1))).mul(1.8))
        .add(mx_noise_vec3(worldPosition.mul(0.0032).add(vec3(-59.2, 11.6, 28.4))).mul(7.5))
      : worldPosition;

    // Horizontal surfaces use two differently oriented projections of the
    // same map. This costs fewer samples than full triplanar mapping while
    // concealing the fixed 2 m texture grid across large plains.
    const planarSample = (map: THREE.Texture, repeatsPerMeter: number, alternate = false) => {
      const coordinates = alternate
        ? warpedPosition.zx.mul(vec2(-1, 1)).add(vec2(137.2, -91.7))
        : warpedPosition.xz;
      return texture(map, coordinates.mul(repeatsPerMeter));
    };
    const planarAlbedo = (layer: TerrainLayer, scale: number, blendNode: any) => quality === "high"
      ? mix(
        planarSample(layers[layer].albedo!, scale).rgb,
        planarSample(layers[layer].albedo!, scale * 0.73, true).rgb,
        blendNode,
      )
      : planarSample(layers[layer].albedo!, scale).rgb;
    const triplanarSample = (map: THREE.Texture, repeatsPerMeter: number) => triplanarTexture(
      texture(map), null, null, float(repeatsPerMeter), warpedPosition, normalWorld,
    );

    // Scan dimensions determine world-space texel scale. Triplanar projection
    // remains on cliffs; warped planar projection is cheaper on flat ground.
    const sand = planarAlbedo("sand", 1 / 30, macro);
    const grass = planarAlbedo("grass", 1 / 1.4, localPatch);
    const soil = planarAlbedo("soil", 1 / 1.3, fineMacro);
    const forest = planarAlbedo("forest", 1 / 2, localPatch);
    const rockDetail = triplanarSample(layers.rock.albedo!, 1 / 12).rgb;
    const rock = quality === "high"
      ? mix(triplanarSample(layers.rock.albedo!, 1 / 52).rgb, rockDetail, microVisibility.mul(0.72))
      : rockDetail;
    const screeDetail = triplanarSample(layers.scree.albedo!, 1 / 18).rgb;
    const scree = quality === "high"
      ? mix(triplanarSample(layers.scree.albedo!, 1 / 80).rgb, screeDetail, microVisibility.mul(0.62))
      : screeDetail;
    const snow = planarAlbedo("snow", 1 / 2, fineMacro);

    const landMask = smoothstep(1, 9, height);
    const sandMask = smoothstep(-0.5, 2.5, height).mul(smoothstep(4, 11, height).oneMinus());
    const wetMask = wetness.mul(shoreInfluence.mul(0.65).add(drainage.mul(0.35))).mul(landTransition);
    // slope = 1-cos(theta): 0.06≈20°, 0.13≈30°, 0.23≈40°.
    // The previous 0.34 rock threshold was roughly 49°, leaving almost every
    // mountain grass-covered. Low-frequency breakup softens selection while
    // staying stable across geometry LOD.
    const slopeVariation = macro.sub(0.5).mul(0.045).add(fineMacro.sub(0.5).mul(0.018));
    const classifiedSlope = slope.add(slopeVariation);
    const forestMask = moisture.mul(vegetationEligibility).mul(smoothstep(18, 90, height)).mul(smoothstep(0.07, 0.16, classifiedSlope).oneMinus());
    const screeMask = smoothstep(0.075, 0.14, classifiedSlope).mul(smoothstep(0.21, 0.32, classifiedSlope).oneMinus()).max(screeTendency.mul(0.72));
    const rockMask = smoothstep(0.14, 0.27, classifiedSlope).max(geologyClass.mul(exposure).mul(0.16));
    const snowMask = smoothstep(1050, 1450, height).mul(smoothstep(0.05, 0.25, slope).oneMinus());

    const paleSand = mix(sand, color(0xcab88e), macro.mul(0.3));
    const mottledSand = mix(paleSand, sand.mul(color(0x7a7970)), localPatch.mul(0.34));
    const wetSand = mottledSand.mul(color(0x77786f));
    const mud = soil.mul(color(0x766d62));
    const meadowGreen = mix(grass, color(0x328c38), 0.72);
    const lushGreen = mix(grass, color(0x45b84c), 0.78);
    const variedGrass = mix(meadowGreen, lushGreen, regionalGreen.mul(0.68).add(localPatch.mul(0.32)));
    const dappledGrass = mix(variedGrass, color(0x2c6e32), groundMottle.mul(0.3));
    // Broad overlapping organic and exposed-soil patches fill the visual gap
    // between meshes without adding geometry. Balanced deliberately reuses
    // macro/fineMacro, so the richer coverage is effectively free.
    const dryPatch = smoothstep(0.64, 0.9, fineMacro.add(macro.mul(0.18)));
    const heathPatch = smoothstep(0.58, 0.86, macro.sub(fineMacro.mul(0.22)));
    const dirtyGrass = mix(dappledGrass, soil.mul(color(0x8b7e68)), dryPatch.mul(0.48));
    const heathGrass = mix(dirtyGrass, color(0x536c36), heathPatch.mul(0.22));
    const wornGround = mix(heathGrass, soil, smoothstep(0.78, 0.96, fineMacro).mul(0.34));
    const grassCoverage = vegetationEligibility.mul(0.18).add(moisture.mul(0.08)).add(regionalGreen.mul(0.08)).add(0.68).clamp(0, 1);
    const grassSoil = mix(soil, wornGround, grassCoverage);
    const lowland = mix(mud, grassSoil, smoothstep(1.5, 12, height));
    const variedScree = mix(scree, rock, localPatch.mul(0.38));
    const seabed = mottledSand.mul(color(0x31525a));

    let finalColor = mix(seabed, wetSand, landTransition);
    finalColor = mix(finalColor, lowland, landMask);
    finalColor = mix(finalColor, mottledSand, sandMask);
    finalColor = mix(finalColor, wetSand, wetMask);
    finalColor = mix(finalColor, forest, forestMask.mul(0.82));
    finalColor = mix(finalColor, variedScree, screeMask);
    finalColor = mix(finalColor, rock, rockMask);
    finalColor = mix(finalColor, snow, snowMask);
    finalColor = finalColor.mul(macro.mul(0.1).add(fineMacro.mul(0.04)).add(0.93));
    finalColor = mix(finalColor, biome.rgb, 0.035);

    const material = new THREE.MeshStandardNodeMaterial();
    material.name = "Navora scanned PBR terrain";
    material.colorNode = finalColor;
    material.metalnessNode = float(0);
    // Terrain has no visible underside. Front-side culling prevents any
    // accidental below-surface geometry from appearing as black walls at
    // grazing angles and saves the corresponding fragment work.
    material.side = THREE.FrontSide;

    if (quality !== "high") {
      material.roughnessNode = mix(float(0.96), float(0.78), rockMask).sub(wetMask.mul(0.14));
      // Balanced keeps geometry normals. Its former four-extra-sample detail
      // normal path dominated GPU time at the laptop's 0.70x resolution
      // floor; scanned albedo and scalar roughness retain surface identity.
    } else {
      const grassRoughness = planarSample(layers.grass.roughness!, 1 / 1.4).r;
      const sandRoughness = planarSample(layers.sand.roughness!, 1 / 30).r;
      const rockRoughness = triplanarSample(layers.rock.roughness!, 1 / 18).r;
      let roughness = mix(grassRoughness, sandRoughness, sandMask);
      roughness = mix(roughness, rockRoughness, rockMask.add(screeMask).clamp(0, 1));
      material.roughnessNode = roughness.sub(wetMask.mul(0.18)).clamp(0.48, 1);

      const soilNormal = planarSample(layers.soil.normal!, 1 / 1.3).rgb;
      const grassNormal = planarSample(layers.grass.normal!, 1 / 1.4).rgb;
      const sandNormal = planarSample(layers.sand.normal!, 1 / 30).rgb;
      const rockNormal = triplanarSample(layers.rock.normal!, 1 / 18).rgb;
      const snowNormal = planarSample(layers.snow.normal!, 1 / 2).rgb;
      let normalSample = mix(soilNormal, grassNormal, moisture);
      normalSample = mix(normalSample, sandNormal, sandMask);
      normalSample = mix(normalSample, rockNormal, rockMask.add(screeMask).clamp(0, 1));
      normalSample = mix(normalSample, snowNormal, snowMask);
      const normalStrength = microVisibility.mul(quality === "high" ? 0.72 : 0.52);
      material.normalNode = normalMap(normalSample, vec2(normalStrength));
    }
    this.material = material;

    this.debugNodes.set("final", finalColor);
    this.debugNodes.set("biome", biome.rgb);
    this.debugNodes.set("height", mix(color(0x163755), color(0xf4ead0), smoothstep(-300, 1500, height)));
    this.debugNodes.set("temperature", mix(color(0x2b63b8), color(0xf28b48), temperature));
    this.debugNodes.set("rainfall", mix(color(0xb99a68), color(0x3977bc), rainfall));
    this.debugNodes.set("wetness", mix(color(0x9a7a50), color(0x225f68), wetness));
    this.debugNodes.set("drainage", mix(color(0x2d2520), color(0x49a4d8), drainage));
    this.debugNodes.set("distanceWater", mix(color(0x297fbc), color(0xc9ad6a), distanceWater));
    this.debugNodes.set("slope", mix(color(0x1f4b32), color(0xe6563d), slope));
    this.debugNodes.set("shore", mix(color(0x203a59), color(0xf2ce85), shoreInfluence));
    this.debugNodes.set("moisture", mix(color(0xa56b3b), color(0x3d7a55), moisture));
    const categoryColor = (value: any) => vec3(
      value.mul(37.1).sin().mul(0.5).add(0.5),
      value.mul(53.7).add(1.9).sin().mul(0.5).add(0.5),
      value.mul(71.3).add(4.1).sin().mul(0.5).add(0.5),
    );
    this.debugNodes.set("soil", categoryColor(soilClass.mul(11).add(0.5).floor()));
    this.debugNodes.set("geology", categoryColor(geologyClass.mul(8).add(0.5).floor()));
    this.debugNodes.set("exposure", mix(color(0x27485b), color(0xf0d09a), exposure));
    this.debugNodes.set("scree", mix(color(0x315f3e), color(0x8d8175), screeTendency));
    this.debugNodes.set("buildability", mix(color(0x9a3f3f), color(0x58c67a), buildability));
    this.debugNodes.set("vegetation", mix(color(0x6a4b2f), color(0x2dc45a), vegetationEligibility));
    this.debugNodes.set("resource", mix(color(0x242638), color(0xe9c45a), resourceEligibility));
    this.debugNodes.set("macro", vec3(macro));
  }

  updateOrigin(offset: THREE.Vector3): void { this.originNode.value.copy(offset); }

  setDebugMode(mode: TerrainMaterialDebugMode): void {
    this.debugMode = mode;
    this.material.colorNode = this.debugNodes.get(mode) ?? this.debugNodes.get("final")!;
    this.material.needsUpdate = true;
  }

  get currentDebugMode(): TerrainMaterialDebugMode { return this.debugMode; }

  dispose(): void {
    this.material.dispose();
    for (const texture of this.textures) texture.dispose();
  }
}
