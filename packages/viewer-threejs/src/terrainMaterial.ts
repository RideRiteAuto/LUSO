import * as THREE from "three/webgpu";
import {
  color,
  float,
  mix,
  mx_noise_float,
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

interface LayerDefinition {
  name: string;
  low: THREE.ColorRepresentation;
  high: THREE.ColorRepresentation;
  grain: number;
  streak: number;
}

function seededNoise(x: number, y: number, seed: number): number {
  let value = Math.imul(x + seed, 374761393) ^ Math.imul(y - seed, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function buildLayerTexture(definition: LayerDefinition, size: number, anisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d")!;
  const image = context.createImageData(size, size);
  const low = new THREE.Color(definition.low);
  const high = new THREE.Color(definition.high);
  const seed = [...definition.name].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const broad = seededNoise(Math.floor(x / 8), Math.floor(y / 8), seed);
      const grain = seededNoise(x, y, seed * 7) * definition.grain;
      const streak = (Math.sin((x + y * definition.streak) * 0.17 + broad * 4) * 0.5 + 0.5) * (1 - definition.grain);
      const t = Math.max(0, Math.min(1, broad * 0.45 + grain + streak * 0.22));
      const r = THREE.MathUtils.lerp(low.r, high.r, t);
      const g = THREE.MathUtils.lerp(low.g, high.g, t);
      const b = THREE.MathUtils.lerp(low.b, high.b, t);
      const i = (y * size + x) * 4;
      image.data[i] = Math.round(THREE.MathUtils.clamp(r, 0, 1) * 255);
      image.data[i + 1] = Math.round(THREE.MathUtils.clamp(g, 0, 1) * 255);
      image.data[i + 2] = Math.round(THREE.MathUtils.clamp(b, 0, 1) * 255);
      image.data[i + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  const result = new THREE.CanvasTexture(canvas);
  result.name = `navora-${definition.name}`;
  result.wrapS = result.wrapT = THREE.RepeatWrapping;
  result.colorSpace = THREE.SRGBColorSpace;
  result.anisotropy = anisotropy;
  result.needsUpdate = true;
  return result;
}

function buildDetailNormalTexture(size: number, anisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d")!;
  const image = context.createImageData(size, size);
  const heightAt = (x: number, y: number) => seededNoise((x + size) % size, (y + size) % size, 9187);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = heightAt(x - 1, y) - heightAt(x + 1, y);
      const dy = heightAt(x, y - 1) - heightAt(x, y + 1);
      const normal = new THREE.Vector3(dx * 0.65, dy * 0.65, 1).normalize();
      const i = (y * size + x) * 4;
      image.data[i] = Math.round((normal.x * 0.5 + 0.5) * 255);
      image.data[i + 1] = Math.round((normal.y * 0.5 + 0.5) * 255);
      image.data[i + 2] = Math.round((normal.z * 0.5 + 0.5) * 255);
      image.data[i + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  const result = new THREE.CanvasTexture(canvas);
  result.name = "navora-terrain-detail-normal";
  result.wrapS = result.wrapT = THREE.RepeatWrapping;
  result.colorSpace = THREE.NoColorSpace;
  result.anisotropy = anisotropy;
  result.needsUpdate = true;
  return result;
}

export class AlvoraTerrainMaterial {
  readonly material: THREE.MeshStandardNodeMaterial;
  private readonly originNode = uniform(new THREE.Vector3());
  private readonly debugNodes = new Map<TerrainMaterialDebugMode, any>();
  private readonly textures: THREE.Texture[] = [];
  private debugMode: TerrainMaterialDebugMode = "final";

  constructor(quality: "high" | "balanced" | "compatibility") {
    const textureSize = quality === "high" ? 256 : quality === "balanced" ? 128 : 64;
    const anisotropy = quality === "high" ? 16 : quality === "balanced" ? 8 : 4;
    const definitions: LayerDefinition[] = [
      { name: "sand", low: 0x9f8456, high: 0xe1c98d, grain: 0.48, streak: 0.15 },
      { name: "grass", low: 0x253f24, high: 0x70834a, grain: 0.35, streak: 0.7 },
      { name: "soil", low: 0x30261b, high: 0x72543a, grain: 0.5, streak: 0.4 },
      { name: "rock", low: 0x454b4a, high: 0x8d8f82, grain: 0.3, streak: 1.7 },
      { name: "snow", low: 0xb7c1bf, high: 0xf3f4e9, grain: 0.2, streak: 0.2 },
      { name: "seabed", low: 0x132b34, high: 0x49695f, grain: 0.55, streak: 0.9 },
    ];
    const layers = Object.fromEntries(definitions.map((definition) => {
      const layer = buildLayerTexture(definition, textureSize, anisotropy);
      this.textures.push(layer);
      return [definition.name, layer];
    })) as Record<string, THREE.CanvasTexture>;
    const detailNormal = buildDetailNormalTexture(textureSize, anisotropy);
    this.textures.push(detailNormal);

    const worldPosition = positionWorld.add(this.originNode);
    const biome = vertexColor();
    const height = worldPosition.y;
    const slope = normalWorld.y.abs().oneMinus();
    const moisture = smoothstep(0.16, 0.62, biome.g);
    const shore = smoothstep(-3, 5, height);
    const macro = mx_noise_float(worldPosition.xz.mul(0.00042)).mul(0.5).add(0.5);
    const fineMacro = mx_noise_float(worldPosition.xz.mul(0.0021).add(vec2(31.7, -14.2))).mul(0.5).add(0.5);

    const sampleLayer = (layer: THREE.Texture, scale: number) => triplanarTexture(
      texture(layer), null, null, float(scale), worldPosition, normalWorld,
    ).rgb;
    const sand = sampleLayer(layers.sand, 0.16);
    const grass = sampleLayer(layers.grass, 0.13);
    const soil = sampleLayer(layers.soil, 0.12);
    const rock = sampleLayer(layers.rock, 0.09);
    const snow = sampleLayer(layers.snow, 0.1);
    const seabed = sampleLayer(layers.seabed, 0.1);

    const wetSand = sand.mul(color(0x6d6955));
    const mud = soil.mul(color(0x4f4436));
    const forestFloor = mix(soil, grass.mul(color(0x687356)), 0.28);
    const grassSoil = mix(soil, grass, moisture.mul(0.72).add(0.18));
    const lowland = mix(mud, grassSoil, smoothstep(1.5, 12, height));
    const landMask = smoothstep(1, 9, height);
    const sandMask = smoothstep(-0.5, 2.5, height).mul(smoothstep(4, 11, height).oneMinus());
    const wetMask = smoothstep(-2, 0.4, height).mul(smoothstep(0.8, 3.2, height).oneMinus());
    const forestMask = moisture.mul(smoothstep(18, 90, height)).mul(smoothstep(0.16, 0.42, slope).oneMinus());
    const screeMask = smoothstep(0.2, 0.42, slope).mul(smoothstep(0.42, 0.68, slope).oneMinus());
    const rockMask = smoothstep(0.34, 0.7, slope);
    const snowMask = smoothstep(1050, 1450, height).mul(smoothstep(0.05, 0.25, slope).oneMinus());

    let finalColor = mix(seabed, wetSand, shore);
    finalColor = mix(finalColor, lowland, landMask);
    finalColor = mix(finalColor, sand, sandMask);
    finalColor = mix(finalColor, wetSand, wetMask);
    finalColor = mix(finalColor, forestFloor, forestMask.mul(0.7));
    finalColor = mix(finalColor, mix(soil, rock, 0.55), screeMask);
    finalColor = mix(finalColor, rock, rockMask);
    finalColor = mix(finalColor, snow, snowMask);
    finalColor = finalColor.mul(macro.mul(0.16).add(fineMacro.mul(0.08)).add(0.86));
    finalColor = mix(finalColor, biome, 0.12);

    const material = new THREE.MeshStandardNodeMaterial();
    material.name = "Alvora layered terrain";
    material.colorNode = finalColor;
    material.roughnessNode = mix(float(0.98), float(0.72), rockMask).sub(wetMask.mul(0.12));
    material.metalnessNode = float(0);
    material.side = THREE.DoubleSide;
    if (quality !== "compatibility") {
      const normalSample = sampleLayer(detailNormal, quality === "high" ? 0.42 : 0.3);
      material.normalNode = normalMap(normalSample, vec2(quality === "high" ? 0.42 : 0.28));
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
