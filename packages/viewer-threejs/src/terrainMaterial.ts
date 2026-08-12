import * as THREE from "three/webgpu";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import {
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

export type TerrainMaterialDebugMode = "final" | "biome" | "height" | "slope" | "shore" | "moisture" | "macro";
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
    const slope = normalWorld.y.abs().oneMinus();
    // `biome` is a presentation palette, not physical climate data. Until
    // the compiler emits explicit control maps, use a continuous regional
    // moisture field with altitude drying instead of the former RGB-green
    // proxy that painted whole biome grid cells alike.
    const climateMoisture = mx_noise_float(worldPosition.xz.mul(0.00018).add(vec2(71.4, -38.2))).mul(0.5).add(0.5);
    const altitudeDrying = smoothstep(650, 1750, height).mul(0.34);
    const biomeVegetationHint = smoothstep(0.22, 0.72, biome.g).mul(0.18);
    const moisture = climateMoisture.mul(0.62).add(0.28).add(biomeVegetationHint).sub(altitudeDrying).clamp(0, 1);
    const viewDistance = cameraPosition.sub(positionWorld).length();
    const microVisibility = smoothstep(180, 900, viewDistance).oneMinus();
    const shore = smoothstep(-3, 5, height);
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
    const wetMask = smoothstep(-2, 0.4, height).mul(smoothstep(0.8, 3.2, height).oneMinus());
    // slope = 1-cos(theta): 0.06≈20°, 0.13≈30°, 0.23≈40°.
    // The previous 0.34 rock threshold was roughly 49°, leaving almost every
    // mountain grass-covered. Low-frequency breakup softens selection while
    // staying stable across geometry LOD.
    const slopeVariation = macro.sub(0.5).mul(0.045).add(fineMacro.sub(0.5).mul(0.018));
    const classifiedSlope = slope.add(slopeVariation);
    const forestMask = moisture.mul(smoothstep(18, 90, height)).mul(smoothstep(0.07, 0.16, classifiedSlope).oneMinus());
    const screeMask = smoothstep(0.075, 0.14, classifiedSlope).mul(smoothstep(0.21, 0.32, classifiedSlope).oneMinus());
    const rockMask = smoothstep(0.14, 0.27, classifiedSlope);
    const snowMask = smoothstep(1050, 1450, height).mul(smoothstep(0.05, 0.25, slope).oneMinus());

    const paleSand = mix(sand, color(0xcab88e), macro.mul(0.3));
    const mottledSand = mix(paleSand, sand.mul(color(0x7a7970)), localPatch.mul(0.34));
    const wetSand = mottledSand.mul(color(0x77786f));
    const mud = soil.mul(color(0x766d62));
    const meadowGreen = mix(grass, color(0x328c38), 0.72);
    const lushGreen = mix(grass, color(0x45b84c), 0.78);
    const variedGrass = mix(meadowGreen, lushGreen, regionalGreen.mul(0.68).add(localPatch.mul(0.32)));
    const dappledGrass = mix(variedGrass, color(0x2c6e32), groundMottle.mul(0.18));
    const wornGround = mix(dappledGrass, soil, smoothstep(0.76, 0.94, fineMacro).mul(0.28));
    const grassCoverage = moisture.mul(0.12).add(regionalGreen.mul(0.1)).add(0.78).clamp(0, 1);
    const grassSoil = mix(soil, wornGround, grassCoverage);
    const lowland = mix(mud, grassSoil, smoothstep(1.5, 12, height));
    const variedScree = mix(scree, rock, localPatch.mul(0.38));
    const seabed = mottledSand.mul(color(0x31525a));

    let finalColor = mix(seabed, wetSand, shore);
    finalColor = mix(finalColor, lowland, landMask);
    finalColor = mix(finalColor, mottledSand, sandMask);
    finalColor = mix(finalColor, wetSand, wetMask);
    finalColor = mix(finalColor, forest, forestMask.mul(0.82));
    finalColor = mix(finalColor, variedScree, screeMask);
    finalColor = mix(finalColor, rock, rockMask);
    finalColor = mix(finalColor, snow, snowMask);
    finalColor = finalColor.mul(macro.mul(0.1).add(fineMacro.mul(0.04)).add(0.93));
    finalColor = mix(finalColor, biome, 0.035);

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
      if (quality === "balanced") {
        const grassNormal = planarSample(layers.grass.normal!, 1 / 1.4).rgb;
        const rockNormal = triplanarSample(layers.rock.normal!, 1 / 18).rgb;
        const normalSample = mix(grassNormal, rockNormal, rockMask.add(screeMask).clamp(0, 1));
        material.normalNode = normalMap(normalSample, vec2(microVisibility.mul(0.42)));
      }
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
    this.debugNodes.set("biome", biome);
    this.debugNodes.set("height", mix(color(0x163755), color(0xf4ead0), smoothstep(-300, 1500, height)));
    this.debugNodes.set("slope", mix(color(0x1f4b32), color(0xe6563d), slope));
    this.debugNodes.set("shore", mix(color(0x174d79), color(0xf2ce85), shore));
    this.debugNodes.set("moisture", mix(color(0xa56b3b), color(0x3d7a55), moisture));
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
