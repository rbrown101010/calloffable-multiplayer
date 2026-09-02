export type WeaponClass = 'ar' | 'smg' | 'sniper' | 'shotgun' | 'pistol';
export type FireMode = 'auto' | 'semi' | 'bolt' | 'pump';

export interface ModelDef {
  url: string;                 // gltf/glb path or 'proc:intervention'
  scale: number;
  rot: [number, number, number];      // base orientation fix (radians)
  offset?: [number, number, number];  // model pivot correction (weapon local, after rot/scale)
  hip: [number, number, number];      // camera-space position (x right, y up, z back)
  ads: [number, number, number];
  sprint: [number, number, number];
  sprintRot: [number, number, number];
  muzzle: [number, number, number];   // camera-space, relative to hip pose (weapon holder space)
  eject: [number, number, number];
  worldScale?: number;                // scale when held by bots (world model)
  worldOffset?: [number, number, number];
  worldRot?: [number, number, number];
}

export interface WeaponDef {
  id: string; name: string; cls: WeaponClass; mode: FireMode;
  damage: number; headMul: number; legMul: number; falloffStart: number; falloffEnd: number; falloffMin: number;
  rpm: number; pellets: number; pelletSpread: number;
  mag: number; reserve: number; reloadTime: number; reloadEmptyTime: number; magOutT: number;
  adsTime: number; adsFov: number; scope: boolean;
  hipSpread: number; adsSpread: number; moveSpread: number; jumpSpread: number; crouchMul: number;
  bloom: number; bloomMax: number; bloomDecay: number;
  recoilPitch: number; recoilYaw: number; recoilRand: number; viewKick: number;
  speedMul: number; bulletSpeed: number; range: number; boltTime: number; drawTime: number;
  sounds: { shot: string; far: string; reload: string; extra?: string; shotVol?: number };
  model: ModelDef;
  tracer: boolean; flashScale: number; shell: 'rifle' | 'pistol' | 'shotgun' | 'sniper';
  killIcon?: string;
}

const D = Math.PI / 180;

export const WEAPONS: Record<string, WeaponDef> = {
  scarh: {
    id: 'scarh', name: 'SCAR-H', cls: 'ar', mode: 'auto',
    damage: 40, headMul: 1.4, legMul: 0.85, falloffStart: 28, falloffEnd: 60, falloffMin: 0.7,
    rpm: 625, pellets: 1, pelletSpread: 0,
    mag: 20, reserve: 100, reloadTime: 2.1, reloadEmptyTime: 2.7, magOutT: 0.45,
    adsTime: 0.24, adsFov: 58, scope: false,
    hipSpread: 3.2, adsSpread: 0.12, moveSpread: 1.6, jumpSpread: 4, crouchMul: 0.8,
    bloom: 0.28, bloomMax: 2.2, bloomDecay: 6,
    recoilPitch: 0.95 * D, recoilYaw: 0.28 * D, recoilRand: 0.5, viewKick: 1.0,
    speedMul: 0.95, bulletSpeed: 720, range: 300, boltTime: 0, drawTime: 0.45,
    sounds: { shot: 'shot_ar_near', far: 'shot_ar_far', reload: 'reload_rifle', shotVol: 0.9 },
    model: { url: '/models/weapons/scarh.glb', scale: 0.079, rot: [0, Math.PI, 0], hip: [0.2, -0.2, -0.5], ads: [0, -0.148, -0.42], sprint: [0.16, -0.26, -0.45], sprintRot: [0.35, -0.5, 0.1], muzzle: [0, 0.02, 0], eject: [0.04, 0.02, 0.05], worldScale: 1 },
    tracer: true, flashScale: 1.0, shell: 'rifle',
  },
  intervention: {
    id: 'intervention', name: 'INTERVENTION', cls: 'sniper', mode: 'bolt',
    damage: 100, headMul: 1.5, legMul: 0.7, falloffStart: 200, falloffEnd: 400, falloffMin: 1.0,
    rpm: 45, pellets: 1, pelletSpread: 0,
    mag: 5, reserve: 25, reloadTime: 3.4, reloadEmptyTime: 3.9, magOutT: 0.4,
    adsTime: 0.42, adsFov: 14, scope: true,
    hipSpread: 9, adsSpread: 0.02, moveSpread: 3, jumpSpread: 12, crouchMul: 0.85,
    bloom: 0.5, bloomMax: 2, bloomDecay: 3,
    recoilPitch: 3.6 * D, recoilYaw: 0.9 * D, recoilRand: 0.5, viewKick: 2.4,
    speedMul: 0.86, bulletSpeed: 950, range: 500, boltTime: 1.05, drawTime: 0.75,
    sounds: { shot: 'shot_bolt_near', far: 'shot_bolt_far', reload: 'reload_rifle', extra: 'shot_bolt2_near', shotVol: 1.0 },
    model: { url: 'proc:intervention', scale: 1, rot: [0, 0, 0], hip: [0.24, -0.27, -0.72], ads: [0, -0.105, -0.36], sprint: [0.2, -0.32, -0.6], sprintRot: [0.4, -0.55, 0.1], muzzle: [0, 0.008, 0], eject: [0.04, 0.02, 0.1], worldScale: 1 },
    tracer: true, flashScale: 1.6, shell: 'sniper',
  },
  mp5: {
    id: 'mp5', name: 'MP5', cls: 'smg', mode: 'auto',
    damage: 30, headMul: 1.4, legMul: 0.9, falloffStart: 14, falloffEnd: 32, falloffMin: 0.65,
    rpm: 800, pellets: 1, pelletSpread: 0,
    mag: 30, reserve: 150, reloadTime: 1.8, reloadEmptyTime: 2.3, magOutT: 0.4,
    adsTime: 0.17, adsFov: 64, scope: false,
    hipSpread: 2.6, adsSpread: 0.18, moveSpread: 1.0, jumpSpread: 3.2, crouchMul: 0.85,
    bloom: 0.22, bloomMax: 1.8, bloomDecay: 7,
    recoilPitch: 0.62 * D, recoilYaw: 0.32 * D, recoilRand: 0.6, viewKick: 0.7,
    speedMul: 1.03, bulletSpeed: 480, range: 220, boltTime: 0, drawTime: 0.35,
    sounds: { shot: 'shot_smg_near', far: 'shot_smg_far', reload: 'reload_rifle', shotVol: 0.75 },
    model: { url: '/models/weapons/mp5.glb', scale: 85, rot: [0, Math.PI, 0], hip: [0.2, -0.19, -0.42], ads: [-0.02, -0.125, -0.45], sprint: [0.16, -0.24, -0.38], sprintRot: [0.3, -0.5, 0.1], muzzle: [0, 0.02, 0], eject: [0.035, 0.02, 0.02], worldScale: 1 },
    tracer: true, flashScale: 0.75, shell: 'pistol',
  },
  ak47: {
    id: 'ak47', name: 'AK-47', cls: 'ar', mode: 'auto',
    damage: 42, headMul: 1.4, legMul: 0.85, falloffStart: 26, falloffEnd: 60, falloffMin: 0.7,
    rpm: 600, pellets: 1, pelletSpread: 0,
    mag: 30, reserve: 120, reloadTime: 2.3, reloadEmptyTime: 2.9, magOutT: 0.45,
    adsTime: 0.26, adsFov: 58, scope: false,
    hipSpread: 3.6, adsSpread: 0.14, moveSpread: 1.7, jumpSpread: 4.5, crouchMul: 0.8,
    bloom: 0.34, bloomMax: 2.6, bloomDecay: 5.5,
    recoilPitch: 1.25 * D, recoilYaw: 0.45 * D, recoilRand: 0.55, viewKick: 1.2,
    speedMul: 0.94, bulletSpeed: 715, range: 300, boltTime: 0, drawTime: 0.5,
    sounds: { shot: 'shot_ak_near', far: 'shot_ak_far', reload: 'reload_rifle', shotVol: 0.95 },
    model: { url: '/models/weapons/ak47.glb', scale: 0.95, rot: [0, Math.PI, 0], hip: [0.2, -0.2, -0.5], ads: [0, -0.1, -0.4], sprint: [0.16, -0.26, -0.45], sprintRot: [0.35, -0.5, 0.1], muzzle: [0, 0.03, 0], eject: [0.04, 0.03, 0.05], worldScale: 1 },
    tracer: true, flashScale: 1.0, shell: 'rifle',
  },
  spas12: {
    id: 'spas12', name: 'SPAS-12', cls: 'shotgun', mode: 'pump',
    damage: 22, headMul: 1.2, legMul: 0.9, falloffStart: 6, falloffEnd: 16, falloffMin: 0.25,
    rpm: 80, pellets: 8, pelletSpread: 3.4,
    mag: 8, reserve: 32, reloadTime: 0.62, reloadEmptyTime: 0.62, magOutT: 0.5,
    adsTime: 0.28, adsFov: 62, scope: false,
    hipSpread: 2.2, adsSpread: 1.2, moveSpread: 0.6, jumpSpread: 2, crouchMul: 0.9,
    bloom: 0.6, bloomMax: 1.5, bloomDecay: 4,
    recoilPitch: 2.6 * D, recoilYaw: 0.6 * D, recoilRand: 0.6, viewKick: 2.2,
    speedMul: 0.93, bulletSpeed: 400, range: 60, boltTime: 0.7, drawTime: 0.5,
    sounds: { shot: 'shot_shotgun_near', far: 'shot_shotgun_far', reload: 'shotgun_pump', extra: 'shotgun_pump', shotVol: 1.0 },
    model: { url: '/models/weapons/spas12.glb', scale: 1.0, rot: [0, Math.PI / 2, 0], hip: [0.2, -0.2, -0.5], ads: [0, -0.095, -0.4], sprint: [0.16, -0.26, -0.45], sprintRot: [0.35, -0.5, 0.1], muzzle: [0, 0.02, 0], eject: [0.04, 0.02, 0.0], worldScale: 1 },
    tracer: false, flashScale: 1.3, shell: 'shotgun',
  },
  deagle: {
    id: 'deagle', name: 'DESERT EAGLE', cls: 'pistol', mode: 'semi',
    damage: 55, headMul: 1.5, legMul: 0.85, falloffStart: 12, falloffEnd: 30, falloffMin: 0.6,
    rpm: 260, pellets: 1, pelletSpread: 0,
    mag: 7, reserve: 35, reloadTime: 1.9, reloadEmptyTime: 2.3, magOutT: 0.4,
    adsTime: 0.16, adsFov: 66, scope: false,
    hipSpread: 3.0, adsSpread: 0.3, moveSpread: 1.2, jumpSpread: 3, crouchMul: 0.85,
    bloom: 0.9, bloomMax: 3, bloomDecay: 5,
    recoilPitch: 2.4 * D, recoilYaw: 0.7 * D, recoilRand: 0.5, viewKick: 2.0,
    speedMul: 1.0, bulletSpeed: 470, range: 120, boltTime: 0, drawTime: 0.3,
    sounds: { shot: 'shot_pistol_near', far: 'shot_pistol_far', reload: 'reload_pistol', shotVol: 0.9 },
    model: { url: '/models/weapons/deagle.glb', scale: 0.0098, rot: [0, Math.PI, 0], hip: [0.17, -0.17, -0.36], ads: [0, -0.078, -0.3], sprint: [0.16, -0.24, -0.34], sprintRot: [0.3, -0.45, 0.1], muzzle: [0, 0.03, 0], eject: [0.03, 0.03, 0.0], worldScale: 1 },
    tracer: true, flashScale: 0.9, shell: 'pistol',
  },
  m1911: {
    id: 'm1911', name: 'M1911 .45', cls: 'pistol', mode: 'semi',
    damage: 38, headMul: 1.5, legMul: 0.85, falloffStart: 10, falloffEnd: 26, falloffMin: 0.6,
    rpm: 420, pellets: 1, pelletSpread: 0,
    mag: 8, reserve: 48, reloadTime: 1.6, reloadEmptyTime: 2.0, magOutT: 0.4,
    adsTime: 0.14, adsFov: 68, scope: false,
    hipSpread: 2.4, adsSpread: 0.25, moveSpread: 1.0, jumpSpread: 2.5, crouchMul: 0.85,
    bloom: 0.55, bloomMax: 2.2, bloomDecay: 6,
    recoilPitch: 1.3 * D, recoilYaw: 0.4 * D, recoilRand: 0.5, viewKick: 1.2,
    speedMul: 1.0, bulletSpeed: 420, range: 100, boltTime: 0, drawTime: 0.28,
    sounds: { shot: 'shot_pistol2_near', far: 'shot_pistol_far', reload: 'reload_pistol', shotVol: 0.8 },
    model: { url: '/models/weapons/m1911.glb', scale: 1.1, rot: [0, 0, 0], hip: [0.17, -0.17, -0.36], ads: [0, -0.085, -0.3], sprint: [0.16, -0.24, -0.34], sprintRot: [0.3, -0.45, 0.1], muzzle: [0, 0.03, 0], eject: [0.03, 0.03, 0.0], worldScale: 1 },
    tracer: true, flashScale: 0.7, shell: 'pistol',
  },
};

export interface Loadout { id: string; name: string; tag: string; desc: string; primary: string; secondary: string; lethal: number; }
export const LOADOUTS: Loadout[] = [
  { id: 'assault', name: 'ASSAULT', tag: 'ALL-ROUNDER', desc: 'SCAR-H · DESERT EAGLE · FRAG', primary: 'scarh', secondary: 'deagle', lethal: 1 },
  { id: 'sniper', name: 'SNIPER', tag: 'ONE SHOT', desc: 'INTERVENTION · M1911 · FRAG', primary: 'intervention', secondary: 'm1911', lethal: 1 },
  { id: 'rusher', name: 'RUSHER', tag: 'CLOSE QUARTERS', desc: 'MP5 · DESERT EAGLE · FRAG ×2', primary: 'mp5', secondary: 'deagle', lethal: 2 },
  { id: 'overkill', name: 'OVERKILL', tag: 'TWO PRIMARIES', desc: 'AK-47 · SPAS-12 · FRAG', primary: 'ak47', secondary: 'spas12', lethal: 1 },
];
