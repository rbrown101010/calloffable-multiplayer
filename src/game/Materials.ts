import * as THREE from 'three';

/** Which maps each texture set ships with (public/textures/<set>/...). */
const SETS: Record<string, string[]> = {
  aerial_sand: ['Diffuse', 'nor_gl', 'arm', 'Displacement'], blue_metal_plate: ['Diffuse', 'nor_gl', 'arm'], box_profile_metal_sheet: ['Diffuse', 'nor_gl', 'arm'],
  concrete_block_wall_02: ['Diffuse', 'nor_gl', 'arm'], concrete_floor_worn_001: ['Diffuse', 'nor_gl', 'arm'], concrete_wall_006: ['Diffuse', 'nor_gl', 'arm'],
  corrugated_iron_02: ['Diffuse', 'nor_gl', 'arm'], cracked_concrete: ['Diffuse', 'nor_gl', 'arm'], dark_planks: ['Diffuse', 'nor_gl', 'arm'],
  dirt_aerial_02: ['Diffuse', 'nor_gl', 'arm'], dirty_concrete: ['Diffuse', 'nor_gl', 'arm'], gravelly_sand: ['Diffuse', 'nor_gl', 'arm', 'Displacement'],
  green_metal_rust: ['Diffuse', 'nor_gl', 'arm'], large_sandstone_blocks: ['Diffuse', 'nor_gl', 'arm'], metal_grate_rusty: ['Diffuse', 'nor_gl', 'arm'],
  metal_plate: ['Diffuse', 'nor_gl', 'arm'], metal_plate_02: ['Diffuse', 'nor_gl', 'arm'], old_planks_02: ['Diffuse', 'nor_gl', 'arm'],
  painted_metal_shutter: ['Diffuse', 'nor_gl', 'arm'], plywood: ['Diffuse', 'nor_gl', 'arm'], red_laterite_soil_stones: ['Diffuse', 'nor_gl', 'arm'],
  rough_wood: ['Diffuse', 'nor_gl', 'arm'], rust_coarse_01: ['Diffuse', 'nor_gl', 'arm'], rusted_shutter: ['Diffuse', 'nor_gl', 'arm'],
  rusty_corrugated_iron: ['Diffuse', 'nor_gl', 'arm'], rusty_metal: ['Diffuse', 'nor_gl', 'arm'], rusty_metal_02: ['Diffuse', 'nor_gl', 'arm'], rusty_metal_04: ['Diffuse', 'nor_gl', 'arm'],
  rock_boulder_dry: ['Diffuse', 'nor_gl', 'arm'], cliff_side: ['Diffuse', 'nor_gl', 'arm'], rock_05: ['Diffuse', 'nor_gl', 'arm'],
  acg_Concrete034: ['Diffuse', 'nor_gl', 'Rough'], acg_CorrugatedSteel005: ['Diffuse', 'nor_gl', 'Rough', 'Metal', 'AO'], acg_Ground033: ['Diffuse', 'nor_gl', 'Rough', 'AO'],
  acg_Ground054: ['Diffuse', 'nor_gl', 'Rough', 'AO'], acg_Ground080: ['Diffuse', 'nor_gl', 'Rough', 'AO'], acg_Metal032: ['Diffuse', 'nor_gl', 'Rough', 'Metal'],
  acg_MetalPlates006: ['Diffuse', 'nor_gl', 'Rough', 'Metal'], acg_PaintedMetal009: ['Diffuse', 'nor_gl', 'Rough', 'Metal', 'AO'], acg_Rust004: ['Diffuse', 'nor_gl', 'Rough', 'Metal'],
};

export interface MatOpts {
  /** world meters per texture tile (u, v) */
  tile?: number | [number, number];
  color?: number | string;
  roughness?: number;
  metalness?: number;
  normalScale?: number;
  envMapIntensity?: number;
  side?: THREE.Side;
  emissive?: number;
  emissiveIntensity?: number;
  displacementScale?: number;
  flatShading?: boolean;
  transparent?: boolean;
  opacity?: number;
}

const loader = new THREE.TextureLoader();
const texCache = new Map<string, THREE.Texture>();
let maxAniso = 8;
export function setMaxAnisotropy(a: number) { maxAniso = a; }

export function loadTex(url: string, srgb = false): THREE.Texture {
  let t = texCache.get(url);
  if (!t) {
    t = loader.load(url);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = maxAniso;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    texCache.set(url, t);
  }
  return t;
}

/** Create a PBR material from a texture set with world-space tiling. Textures are shared; repeat is baked per material via cloned texture objects. */
export function pbr(set: string, o: MatOpts = {}): THREE.MeshStandardMaterial {
  const files = SETS[set];
  if (!files) throw new Error('unknown texture set ' + set);
  const base = `/textures/${set}/`;
  const rep = Array.isArray(o.tile) ? o.tile : [o.tile ?? 2, o.tile ?? 2];
  const withRepeat = (t: THREE.Texture) => { const c = t.clone(); c.repeat.set(1 / rep[0], 1 / rep[1]); if (c.image && (c.image as any).width) c.needsUpdate = true; return c; };
  const m = new THREE.MeshStandardMaterial({
    color: o.color ?? 0xffffff,
    roughness: o.roughness ?? 1,
    metalness: o.metalness ?? (files.includes('Metal') ? 1 : 0),
    side: o.side ?? THREE.FrontSide,
    envMapIntensity: o.envMapIntensity ?? 1,
    flatShading: o.flatShading ?? false,
    transparent: o.transparent ?? false,
    opacity: o.opacity ?? 1,
  });
  if (o.emissive !== undefined) { m.emissive = new THREE.Color(o.emissive); m.emissiveIntensity = o.emissiveIntensity ?? 1; }
  m.map = withRepeat(loadTex(base + 'Diffuse.jpg', true));
  if (files.includes('nor_gl')) { m.normalMap = withRepeat(loadTex(base + 'nor_gl.jpg')); m.normalScale.set(o.normalScale ?? 1, o.normalScale ?? 1); }
  if (files.includes('arm')) {
    const arm = withRepeat(loadTex(base + 'arm.jpg'));
    m.aoMap = arm; m.roughnessMap = arm; m.metalnessMap = arm; m.aoMapIntensity = 1;
    if (o.metalness === undefined) m.metalness = 1; // metalness from B channel
  } else {
    if (files.includes('Rough')) m.roughnessMap = withRepeat(loadTex(base + 'Rough.jpg'));
    if (files.includes('Metal')) m.metalnessMap = withRepeat(loadTex(base + 'Metal.jpg'));
    if (files.includes('AO')) { m.aoMap = withRepeat(loadTex(base + 'AO.jpg')); m.aoMapIntensity = 1; }
  }
  if (o.displacementScale && files.includes('Displacement')) { m.displacementMap = withRepeat(loadTex(base + 'Displacement.jpg')); m.displacementScale = o.displacementScale; m.displacementBias = -o.displacementScale / 2; }
  return m;
}

/** Simple untextured PBR material. */
export function flat(color: number | string, roughness = 0.8, metalness = 0, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
}
