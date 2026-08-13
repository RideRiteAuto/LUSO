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
} from "three/tsl";
import type { TerrainMaterialLibrary, TerrainMaterialRecipeLibrary, TerrainTextureChannel } from "./worldData.js";
import type { TerrainControlMap } from "./terrain.js";

export type TerrainMaterialDebugMode =
  | "final" | "biome" | "height" | "temperature" | "rainfall" | "moisture" | "wetness"
  | "drainage" | "distanceWater" | "slope" | "shore" | "soil" | "geology"
  | "exposure" | "scree" | "buildability" | "vegetation" | "resource" | "macro"
  | "coastType" | "materialId" | "recipe" | "lodMip";
export type TerrainQuality = "high" | "balanced" | "compatibility";

type TerrainLayer = "sand" | "grass" | "soil" | "forest" | "rock" | "scree" | "snow";
type TerrainTextureSet = Record<TerrainLayer, Partial<Record<TerrainTextureChannel, THREE.Texture>>>;

type EmbeddedTerrainAssets = Partial<Record<TerrainLayer, Partial<Record<TerrainTextureChannel, string>>>>;

const LAYERS: TerrainLayer[] = ["sand", "grass", "soil", "forest", "rock", "scree", "snow"];

function configureTexture(map: THREE.Texture, channel: TerrainTextureChannel, anisotropy: number): THREE.Texture {
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = channel === "albedo" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  map.anisotropy = anisotropy;
  map.needsUpdate = true;
  return map;
}

async function loadTerrainTextures(renderer: THREE.WebGPURenderer, quality: TerrainQuality, library: TerrainMaterialLibrary): Promise<TerrainTextureSet> {
  const profile = library.residencyProfiles[quality];
  const anisotropy = profile.anisotropy;
  const embedded = (globalThis as unknown as { __NEVORA_TERRAIN_ASSETS__?: EmbeddedTerrainAssets }).__NEVORA_TERRAIN_ASSETS__;
  const result = Object.fromEntries(LAYERS.map((layer) => [layer, {}])) as TerrainTextureSet;
  const textureSets = new Map(library.textureSets.map((set) => [set.id, set]));
  const channelsFor = (layer: TerrainLayer): TerrainTextureChannel[] => profile.channelsByTextureSet[layer] ?? [];

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
      const record = textureSets.get(layer);
      if (!record) throw new Error(`Terrain material library is missing texture set ${layer}`);
      const uri = new URL(`${record.channels[channel].file}?v=${library.libraryId}`, document.baseURI).href;
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

  static async create(
    renderer: THREE.WebGPURenderer,
    quality: TerrainQuality,
    library: TerrainMaterialLibrary,
    recipes: TerrainMaterialRecipeLibrary,
    controlMap: TerrainControlMap,
    worldBounds: { minX: number; minZ: number; maxX: number; maxZ: number },
  ): Promise<AlvoraTerrainMaterial> {
    return new AlvoraTerrainMaterial(await loadTerrainTextures(renderer, quality, library), quality, library, recipes, controlMap, worldBounds);
  }

  private constructor(
    layers: TerrainTextureSet,
    quality: TerrainQuality,
    library: TerrainMaterialLibrary,
    recipeLibrary: TerrainMaterialRecipeLibrary,
    controlMap: TerrainControlMap,
    worldBounds: { minX: number; minZ: number; maxX: number; maxZ: number },
  ) {
    this.textures = LAYERS.flatMap((layer) => Object.values(layers[layer])).filter((map): map is THREE.Texture => Boolean(map));
    const habitatPackIndex = 5;
    const zoneBytes = new Uint8Array(controlMap.width * controlMap.height);
    for (let pixel = 0; pixel < zoneBytes.length; pixel++) zoneBytes[pixel] = controlMap.data[(pixel * controlMap.packCount + habitatPackIndex) * 4 + 3];
    const zoneTexture = new THREE.DataTexture(zoneBytes, controlMap.width, controlMap.height, THREE.RedFormat, THREE.UnsignedByteType);
    zoneTexture.minFilter = zoneTexture.magFilter = THREE.NearestFilter;
    zoneTexture.wrapS = zoneTexture.wrapT = THREE.ClampToEdgeWrapping;
    zoneTexture.colorSpace = THREE.NoColorSpace;
    zoneTexture.needsUpdate = true;
    this.textures.push(zoneTexture);
    const worldPosition = positionWorld.add(this.originNode);
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
    const slopeDegrees = controlHydrology.a.mul(60);
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
    const biomeClass = controlEcology.b;
    const resourceEligibility = controlHabitat.b.max(controlResources.r.max(controlResources.g).max(controlResources.b).max(controlResources.a));
    const zoneUv = vec2(
      worldPosition.x.sub(worldBounds.minX).div(worldBounds.maxX - worldBounds.minX),
      worldPosition.z.sub(worldBounds.minZ).div(worldBounds.maxZ - worldBounds.minZ),
    );
    const zoneIndex = texture(zoneTexture, zoneUv).r.mul(recipeLibrary.zoneOrder.length).add(0.5).floor();
    const viewDistance = cameraPosition.sub(positionWorld).length();
    const microVisibility = smoothstep(180, 900, viewDistance).oneMinus();
    const landTransition = smoothstep(-3, 5, height);
    const macro = mx_noise_float(worldPosition.xz.mul(0.00042)).mul(0.5).add(0.5);
    const fineMacro = mx_noise_float(worldPosition.xz.mul(0.0021).add(vec2(31.7, -14.2))).mul(0.5).add(0.5);
    // High keeps independent stochastic fields and spatial warping. Balanced
    // reuses its two macro fields, cutting five expensive procedural-noise
    // evaluations per terrain fragment while preserving large-scale breakup.
    const localPatch = quality === "high"
      ? smoothstep(0.18, 0.82, mx_noise_float(worldPosition.xz.mul(0.011).add(vec2(19.4, 91.7))).mul(0.5).add(0.5))
      : smoothstep(0.14, 0.86, fineMacro);
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

    // Seven physical scans stay shared and resident. Authored family/recipe
    // tables choose semantic tint and response over these common samples,
    // avoiding a texture-fetch explosion while giving all 16 zones distinct
    // compiler-driven terrain identities.
    const sand = planarAlbedo("sand", 1 / 30, macro);
    const grass = planarAlbedo("grass", 1 / 1.4, localPatch);
    const soil = planarAlbedo("soil", 1 / 1.3, fineMacro);
    const forest = planarAlbedo("forest", 1 / 2, localPatch);
    const rock = triplanarSample(layers.rock.albedo!, 1 / 12).rgb;
    const scree = triplanarSample(layers.scree.albedo!, 1 / 18).rgb;
    const snow = planarAlbedo("snow", 1 / 2, fineMacro);
    const baseAlbedo: Record<TerrainLayer, any> = { sand, grass, soil, forest, rock, scree, snow };
    const familyById = new Map(library.families.map((family) => [family.id, family]));
    const familyIndex = new Map(library.families.map((family, index) => [family.id, index]));
    const recipeByZone = new Map(recipeLibrary.recipes.map((recipe) => [recipe.zoneId, recipe]));
    const orderedRecipes = recipeLibrary.zoneOrder.map((zoneId) => {
      const recipe = recipeByZone.get(zoneId);
      if (!recipe) throw new Error(`Terrain material recipe is missing zone ${zoneId}`);
      return recipe;
    });
    const family = (id: string) => {
      const entry = familyById.get(id);
      if (!entry) throw new Error(`Terrain material family is missing ${id}`);
      return entry;
    };
    const familyColor = (id: string) => {
      const entry = family(id);
      return baseAlbedo[entry.textureSet as TerrainLayer].mul(vec3(entry.tint[0], entry.tint[1], entry.tint[2]));
    };
    const scalarRoughness = (id: string) => float(THREE.MathUtils.clamp(0.88 + family(id).roughnessBias, 0.48, 1));
    const familyIdNode = (id: string) => float(familyIndex.get(id) ?? 0);

    const baseRoughness = quality === "high" ? {
      rock: triplanarSample(layers.rock.roughness!, 1 / 12).r,
    } as Partial<Record<TerrainLayer, any>> : null;
    const familyRoughness = (id: string) => {
      const entry = family(id);
      const scanned = baseRoughness?.[entry.textureSet as TerrainLayer];
      return scanned ? scanned.add(entry.roughnessBias).clamp(0.48, 1) : scalarRoughness(id);
    };
    const baseNormal = quality === "high" ? {
      sand: planarSample(layers.sand.normal!, 1 / 30).rgb,
      grass: planarSample(layers.grass.normal!, 1 / 1.4).rgb,
      soil: planarSample(layers.soil.normal!, 1 / 1.3).rgb,
      forest: planarSample(layers.soil.normal!, 1 / 2).rgb,
      rock: triplanarSample(layers.rock.normal!, 1 / 12).rgb,
      scree: triplanarSample(layers.rock.normal!, 1 / 18).rgb,
      snow: planarSample(layers.snow.normal!, 1 / 2).rgb,
    } as Record<TerrainLayer, any> : null;
    const familyNormal = (id: string) => baseNormal![family(id).textureSet as TerrainLayer];
    const familyNormalStrength = (id: string) => float(family(id).normalStrength);

    const recipeDriver = (driver: typeof orderedRecipes[number]["rules"]["secondaryDriver"]) => ({
      moisture,
      wetness,
      vegetation: vegetationEligibility,
      exposure,
      macro,
    })[driver];
    // Coast type is derived from compiler truth, never painted: sheltered
    // low-slope/alluvial margins become beach or estuary, exposed geology
    // becomes rock, and steep exposed margins become cliffs.
    const coastPresence: any = smoothstep(0.36, 0.76, shoreInfluence);
    const rockGeology: any = smoothstep(0.29, 0.42, geologyClass);
    const sedimentGeology: any = smoothstep(0.18, 0.34, geologyClass).oneMinus();
    const coastCliff: any = coastPresence.mul(smoothstep(15, 31, slopeDegrees)).mul(exposure.mul(0.45).add(0.65)).clamp(0, 1);
    const coastEstuary: any = coastPresence.mul(smoothstep(0.54, 0.84, wetness)).mul(smoothstep(0.56, 0.88, drainage))
      .mul(smoothstep(5, 15, slopeDegrees).oneMinus()).mul(sedimentGeology.mul(0.45).add(0.72));
    const coastRock: any = coastPresence.mul(smoothstep(0.48, 0.76, exposure).max(rockGeology.mul(0.78))).mul(smoothstep(4, 18, slopeDegrees))
      .mul(coastCliff.oneMinus()).mul(coastEstuary.oneMinus());
    const coastBeach: any = coastPresence.mul(rockGeology.mul(0.72).oneMinus())
      .mul(coastCliff.oneMinus()).mul(coastRock.oneMinus()).mul(coastEstuary.oneMinus());
    const masksFor = (recipe: typeof orderedRecipes[number]) => {
      const rules = recipe.rules;
      let secondary = smoothstep(rules.secondaryRange[0], rules.secondaryRange[1], recipeDriver(rules.secondaryDriver));
      if (rules.secondaryInvert) secondary = secondary.oneMinus();
      const tertiary = smoothstep(rules.tertiaryMacroRange[0], rules.tertiaryMacroRange[1], fineMacro).mul(rules.tertiaryStrength);
      const steep: any = smoothstep(rules.steepSlopeDegrees[0], rules.steepSlopeDegrees[1], slopeDegrees)
        .max(screeTendency.mul(0.74)).max(coastCliff).max(coastRock.mul(0.82));
      const shore: any = smoothstep(rules.shoreRange[0], rules.shoreRange[1], shoreInfluence)
        .mul(coastBeach.max(coastEstuary.mul(0.42))).mul(steep.oneMinus());
      const wet: any = smoothstep(rules.wetnessRange[0], rules.wetnessRange[1], wetness)
        .mul(shoreInfluence.mul(0.55).add(drainage.mul(0.45))).max(coastEstuary.mul(0.9));
      const cold = smoothstep(rules.snowElevationM[0], rules.snowElevationM[1], height)
        .mul(smoothstep(0.42, 0.62, temperature).oneMinus())
        .mul(smoothstep(24, 44, slopeDegrees).oneMinus());
      return { secondary, tertiary, shore, steep, wet, cold };
    };
    const compose = (recipe: typeof orderedRecipes[number], getter: (id: string) => any, masks: ReturnType<typeof masksFor>) => {
      let value = mix(getter(recipe.primary), getter(recipe.secondary), masks.secondary);
      value = mix(value, getter(recipe.tertiary), masks.tertiary);
      value = mix(value, getter(recipe.wet), masks.wet);
      value = mix(value, getter(recipe.shore), masks.shore);
      value = mix(value, getter(recipe.steep), masks.steep);
      value = mix(value, getter(recipe.cold), masks.cold);
      return value;
    };
    const compiledRecipes = orderedRecipes.map((recipe) => {
      const masks = masksFor(recipe);
      return {
        color: compose(recipe, familyColor, masks).mul(macro.sub(0.5).mul(recipe.rules.macroTintStrength).add(1)),
        roughness: compose(recipe, familyRoughness, masks),
        normal: baseNormal ? compose(recipe, familyNormal, masks) : null,
        normalStrength: compose(recipe, familyNormalStrength, masks),
        materialId: compose(recipe, familyIdNode, masks),
      };
    });
    const zoneMask = (recipeIndex: number) => smoothstep(0.1, 0.49, zoneIndex.sub(recipeIndex + 1).abs()).oneMinus();
    const selectRecipe = (key: keyof typeof compiledRecipes[number]) => {
      let selected = compiledRecipes[0][key];
      for (let i = 1; i < compiledRecipes.length; i++) selected = mix(selected, compiledRecipes[i][key], zoneMask(i));
      return selected;
    };
    const seabed = mix(sand, color(0xcab88e), macro.mul(0.25)).mul(color(0x31525a));
    const recipeColor = selectRecipe("color");
    let finalColor = mix(seabed, recipeColor, landTransition);
    finalColor = finalColor.mul(macro.mul(0.07).add(fineMacro.mul(0.03)).add(0.95));
    const recipeRoughness = selectRecipe("roughness");
    const recipeMaterialId = selectRecipe("materialId");
    const wetSurfaceMask = wetness.mul(shoreInfluence.mul(0.55).add(drainage.mul(0.45)));

    const material = new THREE.MeshStandardNodeMaterial();
    material.name = "Navora scanned PBR terrain";
    material.colorNode = finalColor;
    material.metalnessNode = float(0);
    // Terrain has no visible underside. Front-side culling prevents any
    // accidental below-surface geometry from appearing as black walls at
    // grazing angles and saves the corresponding fragment work.
    material.side = THREE.FrontSide;

    material.roughnessNode = recipeRoughness.sub(wetSurfaceMask.mul(quality === "high" ? 0.18 : 0.12)).clamp(0.48, 1);
    if (quality === "high") {
      const recipeNormal = selectRecipe("normal");
      const normalStrength = selectRecipe("normalStrength").mul(microVisibility).mul(0.72);
      material.normalNode = normalMap(recipeNormal, vec2(normalStrength));
    }
    this.material = material;

    this.debugNodes.set("final", finalColor);
    this.debugNodes.set("height", mix(color(0x163755), color(0xf4ead0), smoothstep(-300, 1500, height)));
    this.debugNodes.set("temperature", mix(color(0x2b63b8), color(0xf28b48), temperature));
    this.debugNodes.set("rainfall", mix(color(0xb99a68), color(0x3977bc), rainfall));
    this.debugNodes.set("wetness", mix(color(0x9a7a50), color(0x225f68), wetness));
    this.debugNodes.set("drainage", mix(color(0x2d2520), color(0x49a4d8), drainage));
    this.debugNodes.set("distanceWater", mix(color(0x297fbc), color(0xc9ad6a), distanceWater));
    this.debugNodes.set("slope", mix(color(0x1f4b32), color(0xe6563d), slope));
    this.debugNodes.set("shore", mix(color(0x203a59), color(0xf2ce85), shoreInfluence));
    let coastDebug: any = mix(color(0x27323a), color(0xe8cf8f), coastBeach);
    coastDebug = mix(coastDebug, color(0x87909b), coastRock);
    coastDebug = mix(coastDebug, color(0x4c5662), coastCliff);
    coastDebug = mix(coastDebug, color(0x5d8d70), coastEstuary);
    this.debugNodes.set("coastType", coastDebug);
    this.debugNodes.set("moisture", mix(color(0xa56b3b), color(0x3d7a55), moisture));
    const categoryColor = (value: any) => vec3(
      value.mul(37.1).sin().mul(0.5).add(0.5),
      value.mul(53.7).add(1.9).sin().mul(0.5).add(0.5),
      value.mul(71.3).add(4.1).sin().mul(0.5).add(0.5),
    );
    this.debugNodes.set("biome", categoryColor(biomeClass.mul(19).add(0.5).floor()));
    this.debugNodes.set("soil", categoryColor(soilClass.mul(11).add(0.5).floor()));
    this.debugNodes.set("geology", categoryColor(geologyClass.mul(8).add(0.5).floor()));
    this.debugNodes.set("exposure", mix(color(0x27485b), color(0xf0d09a), exposure));
    this.debugNodes.set("scree", mix(color(0x315f3e), color(0x8d8175), screeTendency));
    this.debugNodes.set("buildability", mix(color(0x9a3f3f), color(0x58c67a), buildability));
    this.debugNodes.set("vegetation", mix(color(0x6a4b2f), color(0x2dc45a), vegetationEligibility));
    this.debugNodes.set("resource", mix(color(0x242638), color(0xe9c45a), resourceEligibility));
    this.debugNodes.set("macro", vec3(macro));
    this.debugNodes.set("materialId", categoryColor(recipeMaterialId.add(0.5).floor()));
    this.debugNodes.set("recipe", categoryColor(zoneIndex));
    this.debugNodes.set("lodMip", categoryColor(viewDistance.div(300).floor()));
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
